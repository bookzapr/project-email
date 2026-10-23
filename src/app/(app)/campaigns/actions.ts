"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { isUuid } from "@/lib/data";
import { db } from "@/lib/db";
import { fromBangkokInput } from "@/lib/format";
import { classifySendError, createTransport, gmailUser, sendEmail } from "@/lib/mailer";
import { parseRecipients, type ParsedRecipient } from "@/lib/parse-recipients";
import { sanitizeEmailHtml } from "@/lib/sanitize";
import { isBlankHtml } from "@/lib/template";
import type { FormState } from "@/lib/types";

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
};

type CampaignRow = {
  subject: string;
  body_html: string;
  followup_body_html: string | null;
  send_at: string;
  followup_after_minutes: number;
};

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

  return {
    subject,
    body_html: sanitizeEmailHtml(d.body_html),
    followup_body_html: minutes > 0 && !isBlankHtml(d.followup_body_html) ? sanitizeEmailHtml(d.followup_body_html) : null,
    send_at: sendAt.toISOString(),
    followup_after_minutes: minutes,
  };
}

/** ตรวจรายชื่อฝั่ง server ซ้ำอีกรอบ (ไม่เชื่อข้อมูลจาก browser) */
function cleanRecipients(list: ParsedRecipient[]): ParsedRecipient[] {
  const text = (list ?? []).map((r) => `"${String(r.name).replace(/"/g, '""')}",${r.email}`).join("\n");
  return parseRecipients(text).valid;
}

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

  // สร้างแบบ "หยุดไว้ก่อน" แล้วค่อยเปิดหลังใส่ผู้รับครบ กันตัวส่งหยิบไปส่งตอนรายชื่อยังไม่ครบ
  const { data: c, error } = await db()
    .from("campaigns")
    .insert({ ...row, paused: true })
    .select("id")
    .single();
  if (error) return { error: "บันทึกไม่สำเร็จ: " + error.message };

  const { error: e2 } = await db()
    .from("recipients")
    .insert(people.map((p) => ({ campaign_id: c.id, name: p.name, email: p.email })));
  if (e2) {
    await db().from("campaigns").delete().eq("id", c.id);
    return { error: "บันทึกรายชื่อผู้รับไม่สำเร็จ: " + e2.message };
  }
  await db().from("campaigns").update({ paused: false }).eq("id", c.id);

  redirect(`/campaigns/${c.id}?created=1`);
}

export async function updateCampaign(id: string, draft: CampaignDraft): Promise<FormState> {
  await requireAuth();
  if (!isUuid(id)) return { error: "ไม่พบข้อความนี้" };
  const row = validateDraft(draft);
  if ("error" in row) return { error: row.error };

  const { error } = await db().from("campaigns").update(row).eq("id", id);
  if (error) return { error: "บันทึกไม่สำเร็จ: " + error.message };
  redirect(`/campaigns/${id}`);
}

export async function deleteCampaign(id: string): Promise<void> {
  await requireAuth();
  if (!isUuid(id)) return;
  const { error } = await db().from("campaigns").delete().eq("id", id);
  if (error) throw new Error("ลบไม่สำเร็จ: " + error.message);
  redirect("/");
}

export async function setCampaignPaused(id: string, paused: boolean): Promise<FormState> {
  await requireAuth();
  if (!isUuid(id)) return { error: "ไม่พบข้อความนี้" };
  const { error } = await db().from("campaigns").update({ paused }).eq("id", id);
  if (error) return { error: "บันทึกไม่สำเร็จ: " + error.message };
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
    .insert(fresh.map((r) => ({ campaign_id: campaignId, name: r.name, email: r.email })));
  if (error) return { error: "บันทึกไม่สำเร็จ: " + error.message };

  refresh();
  const skipped = people.length - fresh.length;
  return { ok: true, message: `เพิ่มผู้รับ ${fresh.length} คนแล้ว${skipped ? ` (ข้าม ${skipped} คนที่มีอยู่แล้ว)` : ""}` };
}

export type RecipientAction = "stop" | "resume" | "retry" | "delete";

/** หยุด / ยกเลิกหยุด / ส่งใหม่ / ลบ ผู้รับ 1 คน */
export async function recipientAction(id: string, action: RecipientAction): Promise<FormState> {
  await requireAuth();
  if (!isUuid(id)) return { error: "ไม่พบผู้รับนี้" };

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

  const { data: r, error: e1 } = await db()
    .from("recipients")
    .select("status,sent_at,followup_sent_at")
    .eq("id", id)
    .single();
  if (e1) return { error: "อ่านข้อมูลไม่ได้: " + e1.message };

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
};

async function sendTestCore(c: TestContent, campaignId: string | null): Promise<FormState> {
  const [{ data: s, error: e1 }, { data: used, error: e2 }] = await Promise.all([
    db().from("settings").select("sender_name,daily_limit").eq("id", 1).single(),
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
    const base = {
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
    .select("subject,body_html,followup_body_html,followup_after_minutes")
    .eq("id", campaignId)
    .single();
  if (error) return { error: "อ่านข้อความไม่ได้: " + error.message };
  return sendTestCore(c, campaignId);
}

/** ทดสอบจากฉบับร่างในขั้นตอนสร้างข้อความ (ยังไม่บันทึก) */
export async function sendTestDraft(draft: CampaignDraft): Promise<FormState> {
  await requireAuth();
  const row = validateDraft({ ...draft, send_now: true });
  if ("error" in row) return { error: row.error };
  return sendTestCore(row, null);
}
