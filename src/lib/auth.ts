import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { db } from "./db";
import { readSessionToken, SESSION_COOKIE } from "./session";

/** เลขรุ่น session ปัจจุบัน (อ่านครั้งเดียวต่อคำขอ) — ก่อนรัน SQL 008 ถือเป็น 1 */
export const currentSessionVersion = cache(async (): Promise<number> => {
  const { data } = await db().from("settings").select("*").eq("id", 1).single();
  return (data?.session_version as number | undefined) ?? 1;
});

export async function isLoggedIn(): Promise<boolean> {
  // ตรวจ session ต้องทำตอนมีคนเปิดหน้าจริง (ใช้เวลาปัจจุบันเช็กวันหมดอายุ) ห้ามสร้างล่วงหน้า
  await connection();
  const version = readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (version === null) return false;
  return version === (await currentSessionVersion());
}

/** เรียกต้นทุกหน้าและทุก Server Action — ถ้ายังไม่ล็อกอินจะพาไปหน้าล็อกอิน */
export async function requireAuth(): Promise<void> {
  if (!(await isLoggedIn())) {
    redirect("/login");
  }
}

/** IP และเบราว์เซอร์ของคนที่ส่งคำขอ (Vercel ใส่ IP จริงไว้ใน x-forwarded-for) */
export async function clientInfo(): Promise<{ ip: string; userAgent: string }> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "").split(",")[0].trim() || "unknown";
  return { ip, userAgent: (h.get("user-agent") ?? "").slice(0, 300) };
}
