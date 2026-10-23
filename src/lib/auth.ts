import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./session";

export async function isLoggedIn(): Promise<boolean> {
  // ตรวจ session ต้องทำตอนมีคนเปิดหน้าจริง (ใช้เวลาปัจจุบันเช็กวันหมดอายุ) ห้ามสร้างล่วงหน้า
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}

/** เรียกต้นทุกหน้าและทุก Server Action — ถ้ายังไม่ล็อกอินจะพาไปหน้าล็อกอิน */
export async function requireAuth(): Promise<void> {
  if (!(await isLoggedIn())) {
    redirect("/login");
  }
}
