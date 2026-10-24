import "server-only";
import type { Attachment } from "./attachments";
import { audit } from "./audit";
import { db } from "./db";
import { deleteFiles, imagePathsInAll } from "./storage";

const DAY = 24 * 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

/**
 * ลบข้อมูลเก่าวันละครั้ง (PDPA: ไม่เก็บข้อมูลส่วนบุคคลนานเกินจำเป็น)
 *  - ข้อความที่วันส่งเก่ากว่าที่ตั้งไว้ในหน้าตั้งค่า + รายชื่อผู้รับ + ไฟล์ (ถ้าเปิดใช้)
 *  - ประวัติการส่งเกิน 30 วัน (ใช้นับโควตาแค่ 24 ชม.)
 *  - บันทึกการล็อกอินผิดเกิน 2 วัน, บันทึกการใช้งานเกิน 1 ปี
 */
export async function applyRetention(): Promise<{ campaigns: number }> {
  const { data: s } = await db().from("settings").select("*").eq("id", 1).single();
  const days = (s?.retention_days as number | undefined) ?? 0;

  let removed = 0;
  if (days > 0) {
    const { data: old } = await db()
      .from("campaigns")
      .select("id,subject,attachments,body_html,followup_body_html")
      .lt("send_at", iso(days * DAY))
      .limit(500);
    for (const c of old ?? []) {
      const { error } = await db().from("campaigns").delete().eq("id", c.id);
      if (error) continue;
      removed++;
      await deleteFiles(
        ((c.attachments ?? []) as Attachment[]).map((a) => a.path),
        imagePathsInAll([c.body_html, c.followup_body_html]),
      ).catch(() => {});
    }
  }

  await db().from("send_log").delete().lt("sent_at", iso(30 * DAY));
  await db().from("login_failures").delete().lt("at", iso(2 * DAY));
  await db().from("audit_log").delete().lt("at", iso(365 * DAY));

  if (removed > 0) await audit("data_retention_cleanup", { campaigns: removed, days }, { ip: "system", userAgent: "cron" });
  return { campaigns: removed };
}
