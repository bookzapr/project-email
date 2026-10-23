import "server-only";
import { ImapFlow, type FetchMessageObject, type MessageStructureObject } from "imapflow";
import { db } from "./db";
import { formatDateTime } from "./format";
import { gmailUser } from "./mailer";
import type { ReplyFile } from "./types";

// ตรวจกล่องจดหมาย Gmail (IMAP) ว่าใครส่งงานกลับมาแล้ว และอีเมลไหนเด้งกลับ
// อ่านเฉพาะข้อความใหม่นับจากรอบก่อน (จำตำแหน่ง UID ไว้แยกต่อโฟลเดอร์) — อ่านอย่างเดียว ไม่แก้กล่องจดหมาย

const ACTIVE_DAYS = 60; //          ตรวจผู้รับที่ส่งไปไม่เกิน 60 วัน
const MAX_MESSAGES_PER_RUN = 300; // ที่เหลืออ่านต่อรอบถัดไป
const LOCK_SECONDS = 90;

type ActiveRecipient = {
  id: string;
  email: string;
  status: "sent" | "followed_up";
  sent_at: string;
  message_id: string | null;
  followup_message_id: string | null;
  campaign: { body_html: string; followup_body_html: string | null };
};

type FolderState = { uidValidity: string; lastUid: number };

export type ReplyCheckResult = {
  skipped?: "locked" | "no-active";
  scanned: number;
  replied: number;
  noFile: number;
  bounced: number;
};

export async function checkReplies(): Promise<ReplyCheckResult> {
  const result: ReplyCheckResult = { scanned: 0, replied: 0, noFile: 0, bounced: 0 };

  const { data: token } = await db().rpc("try_job_lock", { p_name: "imap", p_seconds: LOCK_SECONDS });
  if (!token) return { ...result, skipped: "locked" };

  try {
    const active = await loadActive();
    if (active.length === 0) {
      await saveCheck(null);
      return { ...result, skipped: "no-active" };
    }

    const { data: settings, error } = await db().from("settings").select("imap_state").eq("id", 1).single();
    if (error) throw new Error("อ่านการตั้งค่าไม่ได้: " + error.message);
    const state = (settings.imap_state ?? {}) as Record<string, FolderState>;

    const earliest = new Date(Math.min(...active.map((r) => new Date(r.sent_at).getTime())));
    const since = new Date(earliest.getTime() - 24 * 60 * 60 * 1000);

    const client = new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: { user: gmailUser(), pass: (process.env.GMAIL_APP_PASSWORD ?? "").replace(/\s+/g, "") },
      logger: false,
      disableAutoIdle: true,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });

    try {
      await client.connect();
      const folders = (await client.list()).filter((f) => f.specialUse === "\\All" || f.specialUse === "\\Junk");
      if (!folders.some((f) => f.specialUse === "\\All")) {
        throw new Error("ไม่พบโฟลเดอร์ “อีเมลทั้งหมด (All Mail)” — ตรวจว่าเปิด IMAP และแสดง All Mail ใน IMAP แล้ว");
      }

      const watched = new Set(active.map((a) => a.email));
      for (const folder of folders) {
        const messages = await readNewMessages(client, folder.path, state, since, watched);
        result.scanned += messages.length;
        for (const m of messages) {
          const outcome = await handleMessage(m, active);
          if (outcome) result[outcome]++;
        }
      }
    } finally {
      await client.logout().catch(() => client.close());
    }

    await db().from("settings").update({ imap_state: state }).eq("id", 1);
    await saveCheck(null);
    return result;
  } catch (err) {
    await saveCheck(describeImapError(err));
    throw err;
  } finally {
    await db().rpc("release_job_lock", { p_name: "imap", p_token: token });
  }
}

async function loadActive(): Promise<ActiveRecipient[]> {
  const since = new Date(Date.now() - ACTIVE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db()
    .from("recipients")
    .select("id,email,status,sent_at,message_id,followup_message_id,campaign:campaigns(body_html,followup_body_html)")
    .in("status", ["sent", "followed_up"])
    .gte("sent_at", since);
  if (error) throw new Error("อ่านรายชื่อผู้รับไม่ได้: " + error.message);
  return (data ?? []) as unknown as ActiveRecipient[];
}

async function saveCheck(error: string | null) {
  await db()
    .from("settings")
    .update({ last_imap_check_at: new Date().toISOString(), last_imap_error: error })
    .eq("id", 1);
}

// ---------------------------------------------------------------------
// อ่านข้อความใหม่ในโฟลเดอร์
// ---------------------------------------------------------------------

type Incoming = {
  uid: number;
  from: string;
  date: Date;
  references: string[];
  failedRecipients: string[];
  isBounce: boolean;
  files: ReplyFile[];
  driveLinks: string[];
  gmailUrl: string | null;
};

async function readNewMessages(
  client: ImapFlow,
  path: string,
  state: Record<string, FolderState>,
  since: Date,
  /** อีเมลของผู้รับที่กำลังรอส่งงาน — อ่านเนื้อหาเฉพาะข้อความจากคนกลุ่มนี้ */
  watched: Set<string>,
): Promise<Incoming[]> {
  const lock = await client.getMailboxLock(path, { readOnly: true });
  try {
    const box = client.mailbox;
    if (!box) return [];
    const validity = String(box.uidValidity);
    const prev = state[path];
    const fromUid = prev && prev.uidValidity === validity ? prev.lastUid + 1 : 1;

    const found = await client.search({ uid: `${fromUid}:*`, since }, { uid: true });
    // IMAP ตอบ UID ล่าสุดกลับมาเสมอแม้จะน้อยกว่า fromUid จึงต้องกรองซ้ำ
    const uids = (found || []).filter((u) => u >= fromUid).sort((a, b) => a - b).slice(0, MAX_MESSAGES_PER_RUN);
    if (uids.length === 0) {
      // ไม่มีอะไรใหม่ที่เกี่ยวข้อง: ขยับตำแหน่งไปท้ายโฟลเดอร์ (uidNext อ่านมาตอนเปิดโฟลเดอร์ ก่อนค้นหา จึงไม่ข้ามข้อความใหม่)
      state[path] = { uidValidity: validity, lastUid: Math.max(fromUid - 1, box.uidNext - 1) };
      return [];
    }

    const fetched: FetchMessageObject[] = await client.fetchAll(
      uids.join(","),
      {
        uid: true,
        envelope: true,
        bodyStructure: true,
        internalDate: true,
        headers: ["references", "in-reply-to", "x-failed-recipients", "content-type"],
      },
      { uid: true },
    );

    const incoming = fetched.map(toIncoming);

    // ตอบกลับโดยไม่มีไฟล์แนบ: อ่านเนื้อหาหาลิงก์ Google Drive (กรณีไฟล์ใหญ่เกิน 25 MB)
    for (const m of incoming) {
      if (!watched.has(m.from) || m.files.length > 0) continue;
      const src = fetched.find((f) => f.uid === m.uid)?.bodyStructure;
      for (const part of src ? textParts(src) : []) {
        const text = await downloadText(client, m.uid, part);
        m.driveLinks.push(...(text.match(DRIVE_LINK_RE) ?? []));
      }
      m.driveLinks = [...new Set(m.driveLinks.map((u) => u.replace(/&amp;/g, "&")))];
    }

    state[path] = { uidValidity: validity, lastUid: uids[uids.length - 1] };
    return incoming;
  } finally {
    lock.release();
  }
}

const DRIVE_LINK_RE = /https?:\/\/(?:drive|docs)\.google\.com\/[^\s"'<>)]+/gi;

/** ส่วนเนื้อหาที่เป็นข้อความ (text/plain, text/html) ที่ไม่ใช่ไฟล์แนบ */
function textParts(node: MessageStructureObject): string[] {
  if (node.childNodes?.length) return node.childNodes.flatMap(textParts);
  const type = (node.type ?? "").toLowerCase();
  if ((type === "text/plain" || type === "text/html") && node.disposition?.toLowerCase() !== "attachment") {
    return [node.part ?? "1"];
  }
  return [];
}

async function downloadText(client: ImapFlow, uid: number, part: string): Promise<string> {
  const dl = await client.download(String(uid), part, { uid: true, maxBytes: 300_000 });
  if (!dl.content) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of dl.content) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function toIncoming(m: FetchMessageObject): Incoming {
  // ต่อบรรทัดหัวอีเมลที่ถูกตัดขึ้นบรรทัดใหม่ (header folding) ก่อนอ่าน
  const headers = (m.headers?.toString("utf8") ?? "").replace(/\r?\n[ \t]+/g, " ");
  const header = (name: string) => headers.match(new RegExp(`^${name}:(.*)$`, "im"))?.[1]?.trim() ?? "";

  const from = (m.envelope?.from?.[0]?.address ?? "").toLowerCase();
  const references = `${header("references")} ${header("in-reply-to")} ${m.envelope?.inReplyTo ?? ""}`
    .match(/<[^>]+>/g) ?? [];
  const failedRecipients = header("x-failed-recipients")
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes("@"));
  const isBounce =
    /^(mailer-daemon|postmaster)@/i.test(from) || /multipart\/report/i.test(header("content-type"));

  return {
    uid: m.uid,
    from,
    date: new Date(m.internalDate ?? m.envelope?.date ?? Date.now()),
    references,
    failedRecipients,
    isBounce,
    files: m.bodyStructure ? findAttachments(m.bodyStructure) : [],
    driveLinks: [],
    gmailUrl: m.emailId
      ? `https://mail.google.com/mail/u/${encodeURIComponent(gmailUser())}/#all/${BigInt(m.emailId).toString(16)}`
      : null,
  };
}

/** หาไฟล์แนบจริง (ไม่นับรูปเล็กๆ ที่ฝังในลายเซ็นอีเมล) */
export function findAttachments(node: MessageStructureObject): ReplyFile[] {
  if (node.childNodes?.length) return node.childNodes.flatMap(findAttachments);

  const type = (node.type ?? "").toLowerCase();
  if (type.startsWith("multipart/") || type === "message/delivery-status") return [];
  const disposition = (node.disposition ?? "").toLowerCase();
  const filename = node.dispositionParameters?.filename ?? node.parameters?.name;
  const isImage = type.startsWith("image/");

  if (isImage) {
    // รูปที่ฝังในเนื้อหา/ลายเซ็น = ไม่ใช่ไฟล์งาน
    if (disposition !== "attachment") return [];
    if (node.id && (node.size ?? 0) < 20_000) return [];
  } else if (disposition !== "attachment" && !filename) {
    return []; // เนื้อหาอีเมล (text/plain, text/html)
  }
  return [{ name: filename || "(ไฟล์ไม่มีชื่อ)", kind: "attachment" }];
}

// ---------------------------------------------------------------------
// จับคู่ข้อความกับผู้รับ
// ---------------------------------------------------------------------

const DRIVE_RE = /https?:\/\/(drive|docs)\.google\.com\//i;

// Gmail ตอบอีเมลเด้งกลับเร็วมาก บางทีเวลาในอีเมลเด้งกลับมาก่อนเวลาที่เราบันทึกว่าส่ง จึงเผื่อไว้ 5 นาที
const CLOCK_SLACK_MS = 5 * 60_000;
const sentBefore = (a: ActiveRecipient, date: Date) => new Date(a.sent_at).getTime() - CLOCK_SLACK_MS <= date.getTime();

async function handleMessage(m: Incoming, active: ActiveRecipient[]): Promise<keyof ReplyCheckResult | null> {
  const me = gmailUser().toLowerCase();
  if (!m.from || m.from === me) return null;

  // ---- อีเมลเด้งกลับ ----
  if (m.isBounce) {
    let count = 0;
    for (const addr of m.failedRecipients) {
      for (const r of active.filter((a) => a.email === addr && sentBefore(a, m.date))) {
        const { data } = await db()
          .from("recipients")
          .update({
            status: "failed",
            error: "อีเมลเด้งกลับ: อีเมลผู้รับไม่มีอยู่จริง หรือรับอีเมลไม่ได้",
          })
          .eq("id", r.id)
          .in("status", ["sent", "followed_up"])
          .select("id");
        if (data?.length) count++;
      }
    }
    return count ? "bounced" : null;
  }

  // ---- ผู้รับตอบกลับ ----
  const candidates = active.filter((a) => a.email === m.from && sentBefore(a, m.date));
  if (candidates.length === 0) return null;

  // ถ้าตอบในเธรดของข้อความไหน ให้ยึดข้อความนั้น ไม่งั้นใช้ข้อความล่าสุดที่ส่งหาคนนี้
  const target =
    candidates.find((a) => m.references.some((ref) => ref === a.message_id || ref === a.followup_message_id)) ??
    candidates.sort((a, b) => b.sent_at.localeCompare(a.sent_at))[0];

  // ถ้าในอีเมลของเราเองมีลิงก์ Drive อยู่แล้ว (ติดมากับข้อความที่อ้างอิง) จะไม่นับลิงก์ Drive
  const ourBodyHasDrive =
    DRIVE_RE.test(target.campaign.body_html) || DRIVE_RE.test(target.campaign.followup_body_html ?? "");
  const files: ReplyFile[] = [...m.files];
  if (!ourBodyHasDrive) {
    for (const url of m.driveLinks.slice(0, 10)) files.push({ name: "ลิงก์ Google Drive", kind: "drive_link", url });
  }

  if (files.length > 0) {
    const { data } = await db()
      .from("recipients")
      .update({
        status: "replied",
        replied_at: m.date.toISOString(),
        reply_files: files,
        reply_url: m.gmailUrl,
        note: null,
      })
      .eq("id", target.id)
      .in("status", ["sent", "followed_up"])
      .select("id");
    if (data?.length) {
      active.splice(active.indexOf(target), 1); // กันนับซ้ำในรอบเดียวกัน
      return "replied";
    }
    return null;
  }

  await db()
    .from("recipients")
    .update({ note: `ตอบกลับแล้ว (${formatDateTime(m.date.toISOString())}) แต่ยังไม่แนบไฟล์`, reply_url: m.gmailUrl })
    .eq("id", target.id)
    .in("status", ["sent", "followed_up"]);
  return "noFile";
}

function describeImapError(err: unknown): string {
  const e = err as { authenticationFailed?: boolean; code?: string; responseText?: string; message?: string };
  if (e.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials/i.test(`${e.responseText} ${e.message}`)) {
    return "เข้าสู่ระบบ Gmail (IMAP) ไม่ได้ — ตรวจ App Password และว่าเปิด IMAP ใน Gmail แล้ว";
  }
  if (/IMAP access is disabled|not enabled for IMAP/i.test(`${e.responseText} ${e.message}`)) {
    return "Gmail ยังไม่ได้เปิด IMAP — เปิดที่ Gmail > ตั้งค่า > การส่งต่อและ POP/IMAP";
  }
  return `ตรวจกล่องจดหมายไม่สำเร็จ: ${e.message ?? String(err)}`.slice(0, 300);
}
