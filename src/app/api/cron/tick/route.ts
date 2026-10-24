// ตัวตั้งเวลาเรียกทุก 1–2 นาที (cron-job.org บนเว็บจริง / scripts/local-cron.mjs ตอนทดสอบบนเครื่อง)
// ป้องกันด้วย header:  Authorization: Bearer <CRON_SECRET>
//
// ลำดับในแต่ละรอบ:
//   1) ตรวจกล่องจดหมาย ใครส่งงานกลับมาแล้ว / อีเมลไหนเด้งกลับ
//   2) ส่งอีเมล — อีเมลส่งซ้ำจะส่งก็ต่อเมื่อข้อ 1 สำเร็จ (ไม่งั้นอาจส่งซ้ำไปหาคนที่ส่งงานแล้ว)
import { createHash, timingSafeEqual } from "node:crypto";
import { checkReplies, type ReplyCheckResult } from "@/lib/replies";
import { db } from "@/lib/db";
import { applyRetention } from "@/lib/retention";
import { runSendRound } from "@/lib/sender";
import { cleanupOrphanFiles } from "@/lib/storage";

export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

async function handle(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let replies: ReplyCheckResult | null = null;
  let replyError: string | null = null;
  try {
    replies = await checkReplies();
  } catch (err) {
    replyError = (err as Error).message;
    console.error("[cron] ตรวจกล่องจดหมายไม่สำเร็จ:", err);
  }

  try {
    // cron-job.org (ฟรี) รอคำตอบได้ 30 วินาที จึงจำกัดเวลาส่งต่อรอบไว้ ~12 วินาที ที่เหลือส่งรอบถัดไป
    const sent = await runSendRound({
      batchSize: 10,
      timeBudgetMs: 12_000,
      // ถ้ารอบนี้ตรวจกล่องจดหมายไม่ได้ หรือมีรอบอื่นกำลังตรวจอยู่ ให้เลื่อนอีเมลส่งซ้ำไปรอบหน้า
      includeFollowup: replies !== null && replies.skipped !== "locked",
    });
    // วันละครั้ง: ลบไฟล์แนบ/รูปที่ค้าง (ล็อกไว้ 24 ชม. และไม่ปลดล็อก = ทำอีกครั้งพรุ่งนี้)
    let cleanup: { removed: number; retention?: { campaigns: number } } | null = null;
    const { data: cleanupToken } = await db().rpc("try_job_lock", { p_name: "cleanup", p_seconds: 24 * 60 * 60 });
    if (cleanupToken) {
      // ลบข้อมูลเก่าก่อน แล้วค่อยลบไฟล์ที่ไม่มีข้อความไหนใช้แล้ว
      const retention = await applyRetention().catch((err) => {
        console.error("[cron] ลบข้อมูลเก่าไม่สำเร็จ:", err);
        return undefined;
      });
      cleanup = await cleanupOrphanFiles()
        .then((r) => ({ ...r, retention }))
        .catch((err) => {
          console.error("[cron] ลบไฟล์ค้างไม่สำเร็จ:", err);
          return null;
        });
    }

    return Response.json({ ok: true, replies, replyError, ...sent, cleanup });
  } catch (err) {
    console.error("[cron] รอบนี้ผิดพลาด:", err);
    return Response.json({ ok: false, replies, replyError, error: (err as Error).message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
