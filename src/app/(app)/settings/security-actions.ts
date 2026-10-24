"use server";

import QRCode from "qrcode";
import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { alertRows, sendSecurityAlert } from "@/lib/alerts";
import { audit } from "@/lib/audit";
import { clientInfo, requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { gmailUser } from "@/lib/mailer";
import { SESSION_COOKIE } from "@/lib/session";
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateSecret,
  hashRecovery,
  otpauthUrl,
  verifyTotp,
} from "@/lib/totp";

const NEEDS_008 = "ยังใช้ไม่ได้ — ต้องรัน SQL ไฟล์ 008 ใน Supabase ก่อน";
const missing008 = (err: { message: string } | null) => Boolean(err && /totp_|session_version|column/.test(err.message));

/** ขั้นที่ 1: สร้าง secret ใหม่ + QR ให้สแกน (ยังไม่เปิดใช้จนกว่าจะยืนยันรหัส) */
export async function start2fa(): Promise<{ error: string } | { qr: string; secret: string }> {
  await requireAuth();
  const secret = generateSecret();
  const { error } = await db().from("settings").update({ totp_pending_enc: encryptSecret(secret) }).eq("id", 1);
  if (error) return { error: missing008(error) ? NEEDS_008 : "บันทึกไม่สำเร็จ: " + error.message };
  const qr = await QRCode.toDataURL(otpauthUrl(secret, gmailUser()), { margin: 1, width: 220 });
  return { qr, secret: secret.replace(/(.{4})/g, "$1 ").trim() };
}

/** ขั้นที่ 2: ใส่รหัสจากแอปเพื่อยืนยันว่าสแกนถูก -> เปิดใช้ + ได้รหัสสำรอง */
export async function confirm2fa(code: string): Promise<{ error: string } | { recoveryCodes: string[] }> {
  await requireAuth();
  const { data: s } = await db().from("settings").select("*").eq("id", 1).single();
  if (!s?.totp_pending_enc) return { error: "เริ่มตั้งค่าใหม่อีกครั้ง (กด “เปิดใช้งาน”)" };
  const step = verifyTotp(decryptSecret(s.totp_pending_enc), code, null);
  if (step === null) return { error: "รหัสไม่ถูกต้อง — ตรวจว่าเวลาในมือถือตรง แล้วใส่รหัสล่าสุดจากแอป" };

  const { codes, hashes } = generateRecoveryCodes();
  const { error } = await db()
    .from("settings")
    .update({
      totp_enabled: true,
      totp_secret_enc: s.totp_pending_enc,
      totp_pending_enc: null,
      totp_last_step: step,
      totp_recovery: hashes,
    })
    .eq("id", 1);
  if (error) return { error: "บันทึกไม่สำเร็จ: " + error.message };
  const who = await clientInfo();
  await audit("2fa_enabled", undefined, who);
  after(() => sendSecurityAlert("เปิดใช้ยืนยันตัวตน 2 ขั้นแล้ว", alertRows(who.ip, who.userAgent)));
  return { recoveryCodes: codes };
}

/** ปิด 2FA (ต้องใส่รหัสจากแอปหรือรหัสสำรอง เพื่อกันคนที่แอบใช้เครื่องที่ล็อกอินค้างไว้) */
export async function disable2fa(code: string): Promise<{ error?: string; ok?: boolean }> {
  await requireAuth();
  const { data: s } = await db().from("settings").select("*").eq("id", 1).single();
  if (!s?.totp_enabled) return { ok: true };
  const okTotp = verifyTotp(decryptSecret(s.totp_secret_enc), code, (s.totp_last_step as number | null) ?? null) !== null;
  const okRecovery = ((s.totp_recovery as string[]) ?? []).includes(hashRecovery(code));
  if (!okTotp && !okRecovery) return { error: "รหัสไม่ถูกต้อง" };

  const { error } = await db()
    .from("settings")
    .update({ totp_enabled: false, totp_secret_enc: null, totp_pending_enc: null, totp_last_step: null, totp_recovery: [] })
    .eq("id", 1);
  if (error) return { error: "บันทึกไม่สำเร็จ: " + error.message };
  const who = await clientInfo();
  await audit("2fa_disabled", undefined, who);
  after(() => sendSecurityAlert("⚠️ ปิดยืนยันตัวตน 2 ขั้นแล้ว", alertRows(who.ip, who.userAgent)));
  refresh();
  return { ok: true };
}

/** ออกจากระบบทุกเครื่อง (รวมเครื่องนี้) — ทุก cookie ล็อกอินเดิมใช้ไม่ได้ทันที */
export async function logoutAll(): Promise<{ error: string } | void> {
  await requireAuth();
  const { data: s } = await db().from("settings").select("*").eq("id", 1).single();
  if (s?.session_version === undefined) return { error: NEEDS_008 };
  const { error } = await db()
    .from("settings")
    .update({ session_version: (s.session_version as number) + 1 })
    .eq("id", 1);
  if (error) return { error: "บันทึกไม่สำเร็จ: " + error.message };
  await audit("logout_all");
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
