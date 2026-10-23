// สร้าง/ตรวจ token สำหรับ cookie ล็อกอิน (ใช้ได้ทั้งใน proxy.ts และ Server Components)
// รูปแบบ token: "v1.<วันหมดอายุ ms>.<ลายเซ็น HMAC>"
// คีย์ลายเซ็นผูกกับ ADMIN_PASSWORD ด้วย -> เปลี่ยนรหัสผ่านเมื่อไหร่ ทุกเครื่องถูกออกจากระบบทันที
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "pe_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 วัน (วินาที)

function signingKey(): string {
  const secret = process.env.SESSION_SECRET;
  const password = process.env.ADMIN_PASSWORD;
  if (!secret || !password) {
    throw new Error("ไม่พบ SESSION_SECRET หรือ ADMIN_PASSWORD ใน Environment Variables");
  }
  return `${secret}:${password}`;
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

export function createSessionToken(): string {
  const payload = `v1.${Date.now() + SESSION_MAX_AGE * 1000}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(parts[2]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  return Number(parts[1]) > Date.now();
}
