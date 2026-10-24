"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { isUuid } from "@/lib/data";
import { db } from "@/lib/db";
import { fromBangkokInput } from "@/lib/format";
import { classifySendError, createTransport, gmailUser, sendEmail } from "@/lib/mailer";
import { isValidEmail, parseRecipients, splitEmails, type ParsedRecipient } from "@/lib/parse-recipients";
import { sanitizeEmailHtml } from "@/lib/sanitize";
import { type Attachment, checkAttachment, checkImage } from "@/lib/attachments";
import { createUploadLink, deleteFiles, imagePathsInAll, loadMailFiles, verifyAttachments } from "@/lib/storage";
import { isBlankHtml } from "@/lib/template";
import { MANUAL_REPLY_NOTE, type FormState } from "@/lib/types";

const MAX_RECIPIENTS_PER_ADD = 2000;
const MAX_FOLLOWUP_MINUTES = 60 * 24 * 365;

// ---------------------------------------------------------------------
// ข้อความ (รับข้อมูลจากฟอร์มทีละขั้นเป็น object)
// ---------------------------------------------------------------------

export type CampaignDraft = {
  subject: string;
  body_html: string;
  followup_body_html: string;
  /** true = ส่งทันที (ภายใน 1 นาที) */
  send_now: boolean;
  /** เวลาไทย "2026-10-23T09:00" (ใช้เมื่อ send_now = false) */
  send_at_local: string;
  /** 0 = ไม่ส่งซ้ำ */
  followup_minutes: number;
  attachments: Attachment[];
  /** แนบไฟล์ไปกับอีเมลส่งซ้ำด้วย */
  followup_attach?: boolean;
  /** CC ทุกฉบับ */
  cc_emails?: string[];
};

type CampaignRow = {
  cc_emails: string[];
  subject: string;
  body_html: string;
  followup_body_html: string | null;
  send_at: string;
  followup_after_minutes: number;
  attachments: Attachment[];
  followup_attach: boolean;
};

// คอลัมน์ followup_attach มีหลังรัน SQL 006 — ก่อนหน้านั้นบันทึกโดยไม่ใส่คอลัมน์นี้
const NEEDS_006 = "ตัวเลือก “แนบไฟล์ในอีเมลส่งซ้ำ” ยังใช้ไม่ได้ — ต้องรัน SQL ไฟล์ 006 ใน Supabase ก่อน";
const missing006 = (err: { message: string } | null) => Boolean(err && /followup_attach/.test(err.message));
function without006(row: CampaignRow) {
  const { followup_attach: _drop, ...rest } = row;
  void _drop;
  return rest;
}

function validateDraft(d: CampaignDraft): CampaignRow | { error: string } {
  const subject = String(d.subject ?? "").trim();
  if (!subject) return { error: "กรุณาใส่หัวข้ออีเมล" };
  if (subject.length > 300) return { error: "หัวข้อยาวเกินไป (ไม่เกิน 300 ตัวอักษร)" };
  if (isBlankHtml(d.body_html)) return { error: "กรุณาใส่เนื้อหาอีเมล" };

  const sendAt = d.send_now ? new Date() : fromBangkokInput(String(d.send_at_local ?? ""));
  if (!sendAt) return { error: "กรุณาเลือกวันและเวลาส่ง" };

  const minutes = Number(d.followup_minutes);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_FOLLOWUP_MINUTES) {
    return { error: "ระยะเวลาส่งซ้ำไม่ถูกต้อง" };
  }

  const cc = splitEmails((d.cc_emails ?? []).join(" "));
  const badCc = cc.find((e) => !isValidEmail(e));
  if (badCc) return { error: `อีเมล CC ไม่ถูกต้อง: ${badCc}` };
  if (cc.length > 10) return { error: "CC ได้ไม่เกิน 10 อีเมล" };

  const attachments: Attachment[] = [];
  for (const a of Array.isArray(d.attachments) ? d.attachments : []) {
    const item = { name: String(a.name ?? ""), path: String(a.path ?? ""), size: Number(a.size) || 0, type: String(a.type ?? "") };
    const problem = checkAttachment(item.name, item.size, attachments);
    if (problem) return { error: problem };
    attachments.push(item);
  }

  return {
    cc_emails: cc,
    attachments,
    followup_attach: Boolean(d.followup_attach) && minutes > 0 && attachments.length > 0,
    subject,
    body_html: sanitizeEmailHtml(d.body_html),
    followup_body_html: minutes > 0 && !isBlankHtml(d.followup_body_html) ? sanitizeEmailHtml(d.followup_body_html) : null,
    send_at: sendAt.toISOString(),
    followup_after_minutes: minutes,
  };
}

/** ตรวจรายชื่อฝั่ง server ซ้ำอีกรอบ (ไม่เชื่อข้อมูลจาก browser) */
function cleanRecipients(list: ParsedRecipient[]): ParsedRecipient[] {
  const text = (list ?? [])
    .map((r) => {
      const cc = (r.cc ?? []).map(String).join(";");
      return `"${String(r.name).replace(/"/g, '""')}",${String(r.email)}${cc ? `,${cc}` : ""}`;
    })
    .join("\n");
  return parseRecipients(text).valid;
}

const recipientRow = (campaignId: string, r: ParsedRecipient) => ({
  campaign_id: campaignId,
  name: r.name,
  email: r.email,
  cc_emails: r.cc ?? [],
});

export async function createCampaignWithRecipients(
  draft: CampaignDraft,
  recipients: ParsedRecipient[],
): Promise<FormState> {
  await requireAuth();
  const row = validateDraft(draft);
  if ("error" in row) return { error: row.error };

  const people = cleanRecipients(recipients);
  if (people.length === 0) return { error: "กรุณาเพิ่มผู้รับอย่างน้อย 1 คน" };
  if (people.length > MAX_RECIPIENTS_PER_ADD) return { error: `ผู้รับได้ไม่เกิน ${MAX_RECIPIENTS_PER_ADD} คนต่อข้อความ` };
  const missing = await verifyAttachments(row.attachments);
  if (missing) return { error: missing };

  // สร้างแบบ "หยุดไว้ก่อน" แล้วค่อยเปิดหลังใส่ผู้รับครบ กันตัวส่งหยิบไปส่งตอนรายชื่อยังไม่ครบ
  const insert = (values: object) => db().from("campaigns").insert({ ...values, paused: true }).select("id").single();
  let { data: c, error } = await insert(row);
  if (missing006(error)) {
    if (row.followup_attach) return { error: NEEDS_006 };
    ({ data: c, error } = await insert(without006(row)));
  }
  if (error || !c) return { error: "บันทึกไม่สำเร็จ: " + (error?.message ?? "") };

  const { error: e2 } = await db()
    .from("recipients")
    .insert(people.map((p) => recipientRow(c.id, p)));
  if (e2) {
    await db().from("campaigns").delete().eq("id", c.id);
    return { error: "บันทึกรายชื่อผู้รับไม่สำเร็จ: " + e2.message };
  }
  await db().from("campaigns").update({ paused: false }).eq("id", c.id);

  await audit("campaign_created", { subject: row.subject, count: people.length, cc: row.cc_emails.length });
  redirect(`/campaigns/${c.id}?created=1`);
}

export async function updateCampaign(id: string, draft: CampaignDraft): Promise<FormState> {
  await requireAuth();
  if (!isUuid(id)) return { error: "ไม่พบข้อความนี้" };
  const row = validateDraft(draft);
  if ("error" in row) return { error: row.error };
  const missing = await verifyAttachments(row.attachments);
  if (missing) return { error: missing };

  const { data: old } = await db().from("campaigns").select("attachments,body_html,followup_body_html").eq("id", id).single();
  let { error } = await db().from("campaigns").update(row).eq("id", id);
  if (missing006(error)) {
    if (row.followup_attach) return { error: NEEDS_006 };
    ({ error } = await db().from("campaigns").update(without006(row)).eq("id", id));
  }
  if (error) return { error: "บันทึกไม่สำเร็จ: " + error.message };

  // ลบไฟล์แนบ/รูปที่ถูกเอาออกจากข้อความแล้ว
  if (old) {
    const keepAtt = new Set(row.attachments.map((a) => a.path));
    const keepImg = new Set(imagePathsInAll([row.body_html, row.followup_body_html]));
    await deleteFiles(
      (old.attachments as Attachment[]).map((a) => a.path).filter((p) => !keepAtt.has(p)),
      imagePathsInAll([old.body_html, old.followup_body_html]).filter((p) => !keepImg.has(p)),
    ).catch(() => {});
  }
  await audit("campaign_updated", { subject: row.subject });
  redirect(`/campaigns/${id}`);
}

export async function deleteCampaign(id: string): Promise<void> {
  await requireAuth();
  if (!isUuid(id)) return;
  const { data: c } = await db()
    .from("campaigns")
    .select("subject,attachments,body_html,followup_body_html")
    .eq("id", id)
    .single();
  const { error } = await db().from("campaigns").delete().eq("id", id);
  if (error) throw new Error("ลบไม่สำเร็จ: " + error.message);
  if (c) {
    await deleteFiles(
      (c.attachments as Attachment[]).map((a) => a.path),
      imagePathsInAll([c.body_html, c.followup_body_html]),
    ).catch(() => {});
  }
  await audit("campaign_deleted", { subject: c?.subject ?? id });
  redirect("/");
}

/** ขอลิงก์อัปโหลดไฟล์แนบ/รูป (browser อัปโหลดตรงไปที่ Supabase) */
export async function getUploadUrl(
  kind: "attachment" | "image",
  file: { name: string; size: number; type: string },
  existing: { size: number }[] = [],
): Promise<{ error: string } | { signedUrl: string; path: string; publicUrl: string | null }> {
  await requireAuth();
  const problem =
    kind === "image" ? checkImage(file.name, file.size, file.type) : checkAttachment(file.name, file.size, existing);
  if (problem) return { error: problem };
  try {
    return await createUploadLink(kind, file.name);
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function setCampaignPaused(id: string, paused: boolean): Promise<FormState> {
  await requireAuth();
  if (!isUuid(id)) return { error: "ไม่พบข้อความนี้" };
  const { error } = await db().from("campaigns").update({ paused }).eq("id", id);
  if (error) return { error: "บันทึกไม่สำเร็จ: " + error.message };
  await audit("campaign_paused", { campaign: id, paused });
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------
// ผู้รับ
// ---------------------------------------------------------------------

export async function addRecipients(campaignId: string, recipients: ParsedRecipient[]): Promise<FormState> {
  await requireAuth();
  if (!isUuid(campaignId)) return { error: "ไม่พบข้อความนี้" };

  const people = cleanRecipients(recipients);
  if (people.length === 0) return { error: "ไม่มีรายชื่อที่ถูกต้องให้เพิ่ม" };
  if (people.length > MAX_RECIPIENTS_PER_ADD) return { error: `เพิ่มได้ครั้งละไม่เกิน ${MAX_RECIPIENTS_PER_ADD} คน` };

  const { data: existing, error: e1 } = await db().from("recipients").select("email").eq("campaign_id", campaignId);
  if (e1) return { error: "อ่านรายชื่อเดิมไม่ได้: " + e1.message };
  const have = new Set((existing ?? []).map((r) => r.email.toLowerCase()));
  const fresh = people.filter((r) => !have.has(r.email));
  if (fresh.length === 0) return { error: "ทุกรายชื่อมีอยู่ในข้อความนี้แล้ว" };

  const { error } = await db()
    .from("recipients")
    .insert(fresh.map((r) => recipientRow(campaignId, r)));
  if (error) return { error: "บันทึกไม่สำเร็จ: " + error.message };

  refresh();
  const skipped = people.length - fresh.length;
  await audit("recipients_added", { campaign: campaignId, count: fresh.length });
  return { ok: true, message: `เพิ่มผู้รับ ${fresh.length} คนแล้ว${skipped ? ` (ข้าม ${skipped} คนที่มีอยู่แล้ว)` : ""}` };
}

/** รายชื่อเดิมที่เคยส่ง + ข้อความเก่า (สำหรับ "เลือกจากรายชื่อเดิม") */
export async function getAddressBook(): Promise<{
  contacts: (ParsedRecipient & { lastUsed: string })[];
  campaigns: { id: string; subject: string; sendAt: string; total: number }[];
}> {
  await requireAuth();
  const [{ data: contacts }, { data: camps }, { data: sums }] = await Promise.all([
    db().from("past_contacts").select("*").order("last_used", { ascending: false }).limit(5000),
    db().from("campaigns").select("id,subject,send_at").order("send_at", { ascending: false }).limit(50),
    db().from("campaign_summary").select("id,total"),
  ]);
  const totals = new Map((sums ?? []).map((s) => [s.id, s.total as number]));
  return {
    contacts: (contacts ?? []).map((c) => ({
      name: c.name,
      email: c.email,
      cc: c.cc_emails ?? [],
      lastUsed: c.last_used,
    })),
    campaigns: (camps ?? [])
      .map((c) => ({ id: c.id, subject: c.subject, sendAt: c.send_at, total: totals.get(c.id) ?? 0 }))
      .filter((c) => c.total > 0),
  };
}

/** รายชื่อผู้รับทั้งหมดของข้อความเก่า (ใช้ซ้ำทั้งชุด) */
export async function getRecipientsOf(campaignId: string): Promise<ParsedRecipient[]> {
  await requireAuth();
  if (!isUuid(campaignId)) return [];
  const { data } = await db()
    .from("recipients")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });
  return (data ?? []).map((r) => ({ name: r.name, email: r.email, cc: r.cc_emails ?? [] }));
}

export type RecipientAction = "stop" | "resume" | "retry" | "delete" | "mark_replied" | "unmark_replied";

/** หยุด / ยกเลิกหยุด / ส่งใหม่ / ลบ / ทำเครื่องหมายว่าส่งงานแล้ว ผู้รับ 1 คน */
export async function recipientAction(id: string, action: RecipientAction): Promise<FormState> {
  await requireAuth();
  if (!isUuid(id)) return { error: "ไม่พบผู้รับนี้" };
  await audit("recipient_changed", { recipient: id, action });

  if (action === "delete") {
    const { error } = await db().from("recipients").delete().eq("id", id);
    if (error) return { error: "ลบไม่สำเร็จ: " + error.message };
    refresh();
    return { ok: true };
  }

  if (action === "stop") {
    const { error } = await db()
      .from("recipients")
      .update({ status: "stopped", retry_at: null })
      .eq("id", id)
      .in("status", ["pending", "sent", "followed_up", "failed"]);
    if (error) return { error: "หยุดไม่สำเร็จ: " + error.message };
    refresh();
    return { ok: true };
  }

  // ส่งงานมาทางอื่น (LINE, ยื่นมือ ฯลฯ) → นับว่าส่งแล้ว และจะไม่ถูกทวงซ้ำ
  if (action === "mark_replied") {
    const { error } = await db()
      .from("recipients")
      .update({ status: "replied", replied_at: new Date().toISOString(), note: MANUAL_REPLY_NOTE, retry_at: null, error: null })
      .eq("id", id)
      .neq("status", "replied");
    if (error) return { error: "บันทึกไม่สำเร็จ: " + error.message };
    refresh();
    return { ok: true };
  }

  const { data: r, error: e1 } = await db()
    .from("recipients")
    .select("status,sent_at,followup_sent_at")
    .eq("id", id)
    .single();
  if (e1) return { error: "อ่านข้อมูลไม่ได้: " + e1.message };

  // ยกเลิก "ส่งงานแล้ว" (เช่น ระบบนับผิด หรือกดผิด): กลับไปรอส่งงาน และจะถูกทวงซ้ำตามปกติ
  if (action === "unmark_replied") {
    if (r.status !== "replied") return { ok: true };
    const { error } = await db()
      .from("recipients")
      .update({
        status: r.followup_sent_at ? "followed_up" : r.sent_at ? "sent" : "pending",
        replied_at: null,
        reply_files: null,
        reply_url: null,
        note: null,
      })
      .eq("id", id)
      .eq("status", "replied");
    if (error) return { error: "บันทึกไม่สำเร็จ: " + error.message };
    refresh();
    return { ok: true };
  }

  // ยกเลิกหยุด: กลับไปสถานะตามที่ส่งไปแล้วจริง
  // ส่งใหม่ (คนที่ผิดพลาด): ถ้ารอบแรกส่งไปแล้ว ให้กลับเป็น "ส่งแล้ว" เพื่อรอส่งซ้ำใหม่
  const from = action === "resume" ? "stopped" : "failed";
  if (r.status !== from) return { ok: true };
  const status =
    action === "resume" && r.followup_sent_at ? "followed_up" : r.sent_at ? "sent" : "pending";

  const { error } = await db()
    .from("recipients")
    .update({ status, error: null, attempts: 0, retry_at: null })
    .eq("id", id)
    .eq("status", from);
  if (error) return { error: "บันทึกไม่สำเร็จ: " + error.message };
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------
// ทดสอบส่งหาตัวเอง
// ---------------------------------------------------------------------

type TestContent = {
  subject: string;
  body_html: string;
  followup_body_html: string | null;
  followup_after_minutes: number;
  attachments: Attachment[];
  followup_attach?: boolean;
};

async function sendTestCore(c: TestContent, campaignId: string | null): Promise<FormState> {
  const [{ data: s, error: e1 }, { data: used, error: e2 }] = await Promise.all([
    db().from("settings").select("*").eq("id", 1).single(),
    db().rpc("sent_last_24h"),
  ]);
  if (e1 || e2) return { error: "อ่านข้อมูลไม่ได้: " + (e1 ?? e2)!.message };

  const withFollowup = c.followup_after_minutes > 0;
  if ((used as number) + (withFollowup ? 2 : 1) > s.daily_limit) {
    return { error: "โควตาการส่งวันนี้เต็มแล้ว ลองใหม่ภายหลัง" };
  }

  let me: string;
  let transport: ReturnType<typeof createTransport>;
  try {
    me = gmailUser();
    transport = createTransport();
  } catch (err) {
    return { error: (err as Error).message };
  }

  try {
    const signatureHtml: string = s.signature_html ?? "";
    const files = await loadMailFiles(c.attachments ?? [], [c.body_html, c.followup_body_html, signatureHtml]);
    const base = {
      files,
      signatureHtml,
      attachToFollowup: Boolean(c.followup_attach),
      toName: "ทดสอบ",
      toEmail: me,
      subject: `[ทดสอบ] ${c.subject}`,
      bodyHtml: c.body_html,
      followupBodyHtml: c.followup_body_html,
      senderName: s.sender_name,
    };
    const log = { campaign_id: campaignId, kind: "test", to_email: me, success: true };
    const firstId = await sendEmail(transport, { ...base, kind: "initial" });
    await db().from("send_log").insert(log);
    if (withFollowup) {
      await sendEmail(transport, { ...base, kind: "followup", originalMessageId: firstId });
      await db().from("send_log").insert(log);
    }
  } catch (err) {
    return { error: classifySendError(err).message };
  } finally {
    transport.close();
  }

  return {
    ok: true,
    message: withFollowup
      ? `ส่งแล้ว 2 ฉบับไปที่ ${me} (อีเมลแรก + ตัวอย่างอีเมลส่งซ้ำ) ลองเปิดดูใน Gmail ได้เลย`
      : `ส่งแล้วไปที่ ${me} ลองเปิดดูใน Gmail ได้เลย`,
  };
}

/** ทดสอบจากข้อความที่บันทึกแล้ว */
export async function sendTestEmail(campaignId: string): Promise<FormState> {
  await requireAuth();
  if (!isUuid(campaignId)) return { error: "ไม่พบข้อความนี้" };
  const { data: c, error } = await db()
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .single();
  if (error) return { error: "อ่านข้อความไม่ได้: " + error.message };
  const res = await sendTestCore(c, campaignId);
  if (res?.ok) await audit("test_sent", { subject: c.subject });
  return res;
}

/** ทดสอบจากฉบับร่างในขั้นตอนสร้างข้อความ (ยังไม่บันทึก) */
export async function sendTestDraft(draft: CampaignDraft): Promise<FormState> {
  await requireAuth();
  const row = validateDraft({ ...draft, send_now: true });
  if ("error" in row) return { error: row.error };
  const res = await sendTestCore(row, null);
  if (res?.ok) await audit("test_sent", { subject: row.subject });
  return res;
}
