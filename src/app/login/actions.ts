"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { alertRows, sendSecurityAlert } from "@/lib/alerts";
import { audit } from "@/lib/audit";
import { clientInfo, isLoggedIn } from "@/lib/auth";
import { db } from "@/lib/db";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";
import { decryptSecret, hashRecovery, verifyTotp } from "@/lib/totp";
import type { FormState } from "@/lib/types";

const MAX_FAILURES = 5; //  ผิดได้กี่ครั้ง ต่อ IP ...
const LOCK_MINUTES = 15; // ... ภายในกี่นาที แล้วล็อก IP นั้น

function samePassword(input: string, expected: string): boolean {
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** นับครั้งที่ใส่ผิดของ IP นี้ (ก่อนรัน SQL 008 ไม่มีคอลัมน์ ip -> นับรวมทั้งระบบแบบเดิม) */
async function recentFailures(ip: string, since: string): Promise<number> {
  const byIp = await db().from("login_failures").select("id", { count: "exact", head: true }).eq("ip", ip).gte("at", since);
  if (!byIp.error) return byIp.count ?? 0;
  const all = await db().from("login_failures").select("id", { count: "exact", head: true }).gte("at", since);
  return all.count ?? 0;
}

async function recordFailure(ip: string) {
  const { error } = await db().from("login_failures").insert({ ip });
  if (error) await db().from("login_failures").insert({});
}

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const password = String(formData.get("password") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return { error: "ระบบยังไม่ได้ตั้ง ADMIN_PASSWORD" };

  const who = await clientInfo();
  const since = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();

  // กันเดารหัส: IP เดียวกันผิดเกิน 5 ครั้งใน 15 นาที ล็อก IP นั้นไว้ (ไม่กระทบเครื่องอื่น)
  if ((await recentFailures(who.ip, since)) >= MAX_FAILURES) {
    await audit("login_blocked", undefined, who);
    return { error: `ใส่รหัสผิดหลายครั้งเกินไป กรุณารอ ${LOCK_MINUTES} นาทีแล้วลองใหม่` };
  }

  const { data: s } = await db().from("settings").select("*").eq("id", 1).single();
  const twoFactor = Boolean(s?.totp_enabled && s?.totp_secret_enc);

  const fail = async (message: string, reason: string) => {
    await recordFailure(who.ip);
    await audit("login_failed", { reason }, who);
    const count = await recentFailures(who.ip, since);
    if (count === MAX_FAILURES) {
      // แจ้งเตือนครั้งเดียวตอนถูกล็อก
      after(() => sendSecurityAlert("มีคนพยายามเดารหัสผ่านเข้าเว็บ (ถูกล็อกแล้ว)", alertRows(who.ip, who.userAgent)));
    }
    await new Promise((r) => setTimeout(r, 800));
    return { error: message };
  };

  if (!password || !samePassword(password, expected)) return fail("รหัสผ่านไม่ถูกต้อง", "password");

  // ---- ยืนยันตัวตนขั้นที่ 2 ----
  let usedRecovery = false;
  if (twoFactor) {
    if (!code) return { error: "กรุณาใส่รหัส 6 หลักจากแอป Authenticator", needCode: true };
    const step = verifyTotp(decryptSecret(s!.totp_secret_enc), code, (s!.totp_last_step as number | null) ?? null);
    if (step !== null) {
      await db().from("settings").update({ totp_last_step: step }).eq("id", 1);
    } else {
      // รหัสสำรอง (ใช้ได้ครั้งเดียว)
      const hashes = (s!.totp_recovery as string[]) ?? [];
      const h = hashRecovery(code);
      if (!hashes.includes(h)) return fail("รหัสยืนยันไม่ถูกต้อง", "2fa");
      await db().from("settings").update({ totp_recovery: hashes.filter((x) => x !== h) }).eq("id", 1);
      usedRecovery = true;
    }
  }

  // ---- สำเร็จ ----
  await db().from("login_failures").delete().eq("ip", who.ip);
  (await cookies()).set(SESSION_COOKIE, createSessionToken((s?.session_version as number | undefined) ?? 1), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  await audit(usedRecovery ? "2fa_recovery_used" : "login", { twoFactor }, who);
  after(() =>
    sendSecurityAlert(
      usedRecovery ? "มีการล็อกอินด้วยรหัสสำรอง (2FA)" : "มีการล็อกอินเข้าเว็บส่งอีเมล",
      alertRows(who.ip, who.userAgent),
    ),
  );
  redirect("/");
}

export async function logout(): Promise<void> {
  if (await isLoggedIn()) await audit("logout");
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
