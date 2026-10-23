"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";
import type { FormState } from "@/lib/types";

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

function samePassword(input: string, expected: string): boolean {
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const password = String(formData.get("password") ?? "");
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return { error: "ระบบยังไม่ได้ตั้ง ADMIN_PASSWORD" };

  // กันการเดารหัสผ่าน: ผิดเกิน 5 ครั้งใน 15 นาที ล็อกไว้ก่อน
  const since = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();
  const { count } = await db()
    .from("login_failures")
    .select("id", { count: "exact", head: true })
    .gte("at", since);
  if ((count ?? 0) >= MAX_FAILURES) {
    return { error: `ใส่รหัสผ่านผิดหลายครั้งเกินไป กรุณารอ ${LOCK_MINUTES} นาทีแล้วลองใหม่` };
  }

  if (!password || !samePassword(password, expected)) {
    await db().from("login_failures").insert({});
    await new Promise((r) => setTimeout(r, 800));
    return { error: "รหัสผ่านไม่ถูกต้อง" };
  }

  // ล็อกอินสำเร็จ: ล้างประวัติการล็อกอินผิด
  await db().from("login_failures").delete().gte("id", 0);

  (await cookies()).set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect("/");
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
