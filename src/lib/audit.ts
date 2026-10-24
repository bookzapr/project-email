import "server-only";
import { clientInfo } from "./auth";
import { db } from "./db";

export type AuditAction =
  | "login"
  | "login_failed"
  | "login_blocked"
  | "logout"
  | "logout_all"
  | "2fa_enabled"
  | "2fa_disabled"
  | "2fa_recovery_used"
  | "campaign_created"
  | "campaign_updated"
  | "campaign_deleted"
  | "campaign_paused"
  | "recipients_added"
  | "recipient_changed"
  | "export_downloaded"
  | "test_sent"
  | "settings_changed"
  | "data_retention_cleanup";

export const AUDIT_LABEL: Record<AuditAction, string> = {
  login: "🔓 ล็อกอินสำเร็จ",
  login_failed: "❌ ใส่รหัสผิด",
  login_blocked: "⛔ ถูกล็อกเพราะเดารหัสหลายครั้ง",
  logout: "🚪 ออกจากระบบ",
  logout_all: "🚪 ออกจากระบบทุกเครื่อง",
  "2fa_enabled": "🛡️ เปิดยืนยันตัวตน 2 ขั้น",
  "2fa_disabled": "⚠️ ปิดยืนยันตัวตน 2 ขั้น",
  "2fa_recovery_used": "🔑 ใช้รหัสสำรองล็อกอิน",
  campaign_created: "✉️ สร้างข้อความ",
  campaign_updated: "✏️ แก้ไขข้อความ",
  campaign_deleted: "🗑 ลบข้อความ",
  campaign_paused: "⏸ หยุด/ส่งต่อข้อความ",
  recipients_added: "👥 เพิ่มผู้รับ",
  recipient_changed: "👤 เปลี่ยนสถานะ/ลบผู้รับ",
  export_downloaded: "⬇ ดาวน์โหลดรายชื่อ",
  test_sent: "🧪 ทดสอบส่งหาตัวเอง",
  settings_changed: "⚙️ เปลี่ยนการตั้งค่า",
  data_retention_cleanup: "🧹 ลบข้อมูลเก่าอัตโนมัติ",
};

/** บันทึกการใช้งาน — ไม่ทำให้งานหลักล้มถ้าบันทึกไม่ได้ (เช่น ยังไม่ได้รัน SQL 008) */
export async function audit(action: AuditAction, detail?: Record<string, unknown>, who?: { ip: string; userAgent: string }) {
  try {
    const info = who ?? (await clientInfo().catch(() => ({ ip: "system", userAgent: "" })));
    await db().from("audit_log").insert({ action, detail: detail ?? null, ip: info.ip, user_agent: info.userAgent });
  } catch {
    // เงียบไว้ — บันทึกการใช้งานเป็นส่วนเสริม
  }
}
