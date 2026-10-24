// สร้าง/ตรวจ token สำหรับ cookie ล็อกอิน (ใช้ได้ทั้งใน proxy.ts และ Server Components)
// รูปแบบ token: "v2.<วันหมดอายุ ms>.<เลขรุ่น session>.<ลายเซ็น HMAC>"
// - คีย์ลายเซ็นผูกกับ ADMIN_PASSWORD -> เปลี่ยนรหัสผ่านเมื่อไหร่ ทุกเครื่องถูกออกจากระบบทันที
// - เลขรุ่น session ตรวจกับฐานข้อมูลใน requireAuth() -> ปุ่ม "ออกจากระบบทุกเครื่อง"
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "pe_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 วัน (วินาที)

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

export function createSessionToken(version: number): string {
  const payload = `v2.${Date.now() + SESSION_MAX_AGE * 1000}.${version}`;
  return `${payload}.${sign(payload)}`;
}

/** ตรวจลายเซ็น + วันหมดอายุ — คืนเลขรุ่น session หรือ null ถ้าใช้ไม่ได้ */
export function readSessionToken(token: string | undefined): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v2") return null;
  const payload = parts.slice(0, 3).join(".");
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(parts[3]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (!(Number(parts[1]) > Date.now())) return null;
  const version = Number(parts[2]);
  return Number.isInteger(version) ? version : null;
}

export function verifySessionToken(token: string | undefined): boolean {
  return readSessionToken(token) !== null;
}
