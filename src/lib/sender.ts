import "server-only";
import { db } from "./db";
import type { Attachment } from "./attachments";
import { classifySendError, createTransport, sendEmail } from "./mailer";
import { loadMailFiles, type MailFiles } from "./storage";

// ตัวส่งอีเมล 1 รอบ — ถูกเรียกจากตัวตั้งเวลาผ่าน /api/cron/tick ทุก 1–2 นาที
// ส่งเป็นชุดเล็กๆ และหยุดเองเมื่อใกล้หมดเวลา ส่วนที่เหลือรอรอบถัดไป

const LEASE_SECONDS = 120; //       การจองหมดอายุเองถ้ารอบนี้ล่มกลางทาง
const MAX_TEMP_ATTEMPTS = 3; //     ผิดพลาดชั่วคราวเกินนี้ -> ถือว่าผิดพลาด
const RETRY_MINUTES = [5, 15, 60]; // ระยะรอก่อนลองใหม่ ครั้งที่ 1, 2, 3
const PAUSE_BETWEEN_MS = 300; //    เว้นจังหวะระหว่างฉบับ ไม่ให้ Gmail มองว่าเป็นสแปม

type ClaimedRow = {
  recipient_id: string;
  lock_token: string;
  kind: "initial" | "followup";
  campaign_id: string;
  name: string;
  email: string;
  message_id: string | null;
  attempts: number;
  subject: string;
  body_html: string;
  followup_body_html: string | null;
};

export type RoundResult = {
  claimed: number;
  sent: number;
  failed: number;
  willRetry: number;
  skipped: number;
  /** ปัญหาที่ทำให้ต้องหยุดทั้งรอบ เช่น App Password ผิด หรือเกินโควตา */
  stopReason?: string;
};

export async function runSendRound(opts: {
  batchSize?: number;
  timeBudgetMs?: number;
  includeFollowup?: boolean;
} = {}): Promise<RoundResult> {
  const { batchSize = 10, timeBudgetMs = 20_000, includeFollowup = false } = opts;
  const startedAt = Date.now();
  const result: RoundResult = { claimed: 0, sent: 0, failed: 0, willRetry: 0, skipped: 0 };

  // select("*") เพื่อให้ทำงานได้ทั้งก่อน/หลังรัน SQL 006 (signature_html)
  const { data: settings, error: se } = await db().from("settings").select("*").eq("id", 1).single();
  if (se) throw new Error("อ่านการตั้งค่าไม่ได้: " + se.message);
  await db().from("settings").update({ last_run_at: new Date().toISOString() }).eq("id", 1);

  const { data, error } = await db().rpc("claim_send_batch", {
    p_limit: batchSize,
    p_lease_seconds: LEASE_SECONDS,
    p_include_followup: includeFollowup,
  });
  if (error) throw new Error("จองงานส่งไม่ได้: " + error.message);
  const rows = (data ?? []) as ClaimedRow[];
  result.claimed = rows.length;
  if (rows.length === 0) return result;

  const token = rows[0].lock_token;
  const transport = createTransport();

  // ไฟล์แนบ/รูป: โหลดครั้งเดียวต่อข้อความ ใช้ซ้ำกับทุกผู้รับในรอบนี้
  const signatureHtml: string = settings.signature_html ?? "";
  const filesCache = new Map<string, Promise<{ files: MailFiles; attachToFollowup: boolean }>>();
  const filesFor = (row: ClaimedRow) => {
    if (!filesCache.has(row.campaign_id)) {
      filesCache.set(
        row.campaign_id,
        (async () => {
          const { data } = await db().from("campaigns").select("*").eq("id", row.campaign_id).single();
          const files = await loadMailFiles((data?.attachments ?? []) as Attachment[], [
            row.body_html,
            row.followup_body_html,
            signatureHtml,
          ]);
          return { files, attachToFollowup: Boolean(data?.followup_attach) };
        })(),
      );
    }
    return filesCache.get(row.campaign_id)!;
  };

  try {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // ใกล้หมดเวลาแล้ว -> คืนที่เหลือให้รอบถัดไป
      if (Date.now() - startedAt > timeBudgetMs) {
        await release(token, rows.slice(i));
        result.skipped += rows.length - i;
        break;
      }

      // ระหว่างรอคิว สถานะเปลี่ยนไปหรือยัง (กด "หยุด" / ส่งงานกลับมาแล้ว / ถูกลบ)
      const { data: current } = await db()
        .from("recipients")
        .select("status")
        .eq("id", row.recipient_id)
        .eq("lock_token", token)
        .maybeSingle();
      const expected = row.kind === "initial" ? "pending" : "sent";
      if (!current || current.status !== expected) {
        if (current) await release(token, [row]);
        result.skipped++;
        continue;
      }

      try {
        const { files, attachToFollowup } = await filesFor(row);
        const messageId = await sendEmail(transport, {
          kind: row.kind,
          toName: row.name,
          toEmail: row.email,
          subject: row.subject,
          bodyHtml: row.body_html,
          followupBodyHtml: row.followup_body_html,
          originalMessageId: row.message_id,
          senderName: settings.sender_name,
          files,
          attachToFollowup,
          signatureHtml,
        });
        await complete(row, token, { p_success: true, p_message_id: messageId });
        result.sent++;
      } catch (err) {
        const { kind, message } = classifySendError(err);

        if (kind === "auth" || kind === "quota") {
          // ปัญหาทั้งระบบ: ไม่โทษผู้รับ คืนคิวทั้งหมด (โควตาเต็ม -> เลื่อนไปอีก 1 ชั่วโมง)
          const retryAt = kind === "quota" ? minutesFromNow(60) : null;
          await release(token, rows.slice(i), retryAt);
          result.skipped += rows.length - i;
          result.stopReason = message;
          await db()
            .from("settings")
            .update({ last_send_error: message, last_send_error_at: new Date().toISOString() })
            .eq("id", 1);
          break;
        }

        const prefix = row.kind === "followup" ? "ส่งซ้ำไม่สำเร็จ: " : "";
        if (kind === "recipient" || row.attempts + 1 >= MAX_TEMP_ATTEMPTS) {
          const finalMsg = kind === "temporary" ? `${message} (ลองแล้ว ${MAX_TEMP_ATTEMPTS} ครั้ง)` : message;
          await complete(row, token, { p_success: false, p_error: prefix + finalMsg, p_give_up: true });
          result.failed++;
        } else {
          await complete(row, token, {
            p_success: false,
            p_error: prefix + message,
            p_retry_at: minutesFromNow(RETRY_MINUTES[row.attempts] ?? 60),
          });
          result.willRetry++;
        }
      }

      if (i < rows.length - 1) await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_MS));
    }
  } finally {
    transport.close();
  }

  // ส่งได้แล้ว แปลว่าปัญหาเดิม (ถ้ามี) หายแล้ว
  if (result.sent > 0 && !result.stopReason) {
    await db().from("settings").update({ last_send_error: null, last_send_error_at: null }).eq("id", 1);
  }
  return result;
}

async function complete(
  row: ClaimedRow,
  token: string,
  fields: { p_success: boolean; p_message_id?: string; p_error?: string; p_retry_at?: string; p_give_up?: boolean },
) {
  // ส่งไปแล้วแต่บันทึกไม่ได้ = เสี่ยงส่งซ้ำเมื่อการจองหมดอายุ จึงลองบันทึกซ้ำก่อนยอมแพ้
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await db().rpc("complete_send", {
      p_id: row.recipient_id,
      p_token: token,
      p_kind: row.kind,
      ...fields,
    });
    if (!error) return;
    lastError = error.message;
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  throw new Error(`บันทึกผลการส่งถึง ${row.email} ไม่สำเร็จ: ${lastError}`);
}

async function release(token: string, rows: ClaimedRow[], retryAt: string | null = null) {
  if (rows.length === 0) return;
  await db().rpc("release_claim", {
    p_token: token,
    p_ids: rows.map((r) => r.recipient_id),
    p_retry_at: retryAt,
  });
}

function minutesFromNow(min: number): string {
  return new Date(Date.now() + min * 60_000).toISOString();
}
