import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// ยืนยันตัวตน 2 ขั้นแบบ TOTP (RFC 6238) — ใช้กับ Google Authenticator / Microsoft Authenticator ได้
// รหัส 6 หลัก เปลี่ยนทุก 30 วินาที, ยอมรับคลาดเคลื่อน ±1 ช่วง (นาฬิกามือถือไม่ตรง)

const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = h[h.length - 1] & 0xf;
  const bin = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** ตรวจรหัส 6 หลัก — คืนเลขช่วงเวลาที่ตรง (ไว้กันใช้ซ้ำ) หรือ null ถ้าไม่ถูก/เคยใช้แล้ว */
export function verifyTotp(secret: string, code: string, lastUsedStep: number | null): number | null {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const now = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  for (const step of [now, now - 1, now + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    const expected = Buffer.from(codeAt(secret, step));
    if (timingSafeEqual(expected, Buffer.from(clean))) return step;
  }
  return null;
}

/** ลิงก์สำหรับสร้าง QR ให้แอป Authenticator สแกน */
export function otpauthUrl(secret: string, account: string): string {
  const label = encodeURIComponent(`ส่งอีเมลอัตโนมัติ:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent("ส่งอีเมลอัตโนมัติ")}&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// ---------------------------------------------------------------------
// เข้ารหัส secret ก่อนเก็บในฐานข้อมูล (ถ้าฐานข้อมูลหลุด ก็เอา secret ไปใช้ไม่ได้)
// คีย์มาจาก SESSION_SECRET — ถ้าเปลี่ยน SESSION_SECRET ต้องตั้ง 2FA ใหม่
// ---------------------------------------------------------------------

function key(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("ไม่พบ SESSION_SECRET");
  return createHash("sha256").update(`${s}:totp-v1`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}

export function decryptSecret(payload: string): string {
  const [iv, tag, enc] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

// ---------------------------------------------------------------------
// รหัสสำรอง (ใช้ตอนมือถือหาย) — ใช้ได้รหัสละครั้ง, เก็บเฉพาะ hash
// ---------------------------------------------------------------------

export function generateRecoveryCodes(n = 8): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: n }, () => {
    const raw = base32Encode(randomBytes(6)).toLowerCase().slice(0, 8);
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
  return { codes, hashes: codes.map(hashRecovery) };
}

export function hashRecovery(code: string): string {
  return createHash("sha256").update(`recovery:${code.trim().toLowerCase()}`).digest("hex");
}
