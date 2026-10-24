import "server-only";
import { db } from "./db";
import { formatDateTime } from "./format";
import { createTransport, gmailUser } from "./mailer";

/** ส่งอีเมลแจ้งเตือนความปลอดภัย (ล็อกอินใหม่ / มีคนเดารหัส) — ไม่ทำให้งานหลักล้มถ้าส่งไม่ได้ */
export async function sendSecurityAlert(subject: string, rows: [string, string][]) {
  try {
    const { data: s } = await db().from("settings").select("*").eq("id", 1).single();
    const to = (s?.alert_email as string | undefined)?.trim() || gmailUser();
    const table = rows
      .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#64748b">${k}</td><td style="padding:4px 0"><b>${escape(v)}</b></td></tr>`)
      .join("");
    const transport = createTransport();
    try {
      await transport.sendMail({
        from: { name: "ระบบส่งอีเมลอัตโนมัติ (แจ้งเตือนความปลอดภัย)", address: gmailUser() },
        to,
        subject: `🔐 ${subject}`,
        html: `<div style="font-family:Tahoma,Arial,sans-serif;font-size:15px;color:#134e4a">
<p><b>${escape(subject)}</b></p><table>${table}</table>
<p style="color:#64748b;font-size:13px">ถ้าไม่ใช่คุณ: เข้าเว็บ > ตั้งค่า > กด "ออกจากระบบทุกเครื่อง" แล้วเปลี่ยน ADMIN_PASSWORD ใน Vercel ทันที</p></div>`,
        text: `${subject}\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}`,
      });
    } finally {
      transport.close();
    }
  } catch (err) {
    console.error("[alert] ส่งอีเมลแจ้งเตือนไม่สำเร็จ:", err);
  }
}

export function alertRows(ip: string, userAgent: string): [string, string][] {
  return [
    ["เวลา", formatDateTime(new Date().toISOString())],
    ["IP", ip],
    ["อุปกรณ์", userAgent || "-"],
  ];
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
