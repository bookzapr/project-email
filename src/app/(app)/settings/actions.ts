"use server";

import { refresh } from "next/cache";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { isValidEmail } from "@/lib/parse-recipients";
import { db } from "@/lib/db";
import { sendDigest } from "@/lib/digest";
import { classifySendError } from "@/lib/mailer";
import { sanitizeEmailHtml } from "@/lib/sanitize";
import { isBlankHtml } from "@/lib/template";
import type { FormState } from "@/lib/types";

export async function saveSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAuth();
  const senderName = String(formData.get("sender_name") ?? "").trim();
  const dailyLimit = Number(formData.get("daily_limit"));

  if (senderName.length > 100) return { error: "ชื่อผู้ส่งยาวเกินไป (ไม่เกิน 100 ตัวอักษร)" };
  if (/[<>"\r\n]/.test(senderName)) return { error: "ชื่อผู้ส่งห้ามมีเครื่องหมาย < > \" หรือขึ้นบรรทัดใหม่" };
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 10000) {
    return { error: "ขีดจำกัดต่อวันต้องเป็นตัวเลข 1–10,000" };
  }

  const { error } = await db()
    .from("settings")
    .update({ sender_name: senderName, daily_limit: dailyLimit })
    .eq("id", 1);
  if (error) return { error: "บันทึกไม่สำเร็จ: " + error.message };

  // ลายเซ็น (คอลัมน์มีหลังรัน SQL 006)
  if (formData.has("signature_html")) {
    const raw = String(formData.get("signature_html") ?? "");
    const signature = isBlankHtml(raw) && !/<img/i.test(raw) ? "" : sanitizeEmailHtml(raw);
    const { error: e2 } = await db().from("settings").update({ signature_html: signature }).eq("id", 1);
    if (e2) {
      refresh();
      return /signature_html/.test(e2.message)
        ? { error: "บันทึกชื่อผู้ส่งและขีดจำกัดแล้ว แต่ลายเซ็นยังใช้ไม่ได้ — ต้องรัน SQL ไฟล์ 006 ใน Supabase ก่อน" }
        : { error: "บันทึกลายเซ็นไม่สำเร็จ: " + e2.message };
    }
  }

  // ความปลอดภัย + ระยะเวลาเก็บข้อมูล (คอลัมน์มีหลังรัน SQL 008)
  if (formData.has("retention_days")) {
    const alertEmail = String(formData.get("alert_email") ?? "").trim().toLowerCase();
    const retention = Number(formData.get("retention_days"));
    if (alertEmail && !isValidEmail(alertEmail)) return { error: "อีเมลรับแจ้งเตือนไม่ถูกต้อง" };
    if (!Number.isInteger(retention) || retention < 0 || retention > 3650) return { error: "ระยะเวลาเก็บข้อมูลไม่ถูกต้อง" };
    const { error: e3 } = await db()
      .from("settings")
      .update({ alert_email: alertEmail, retention_days: retention })
      .eq("id", 1);
    if (e3) {
      refresh();
      return { error: "บันทึกส่วนอื่นแล้ว แต่ส่วนความปลอดภัยยังใช้ไม่ได้ — ต้องรัน SQL ไฟล์ 008 ใน Supabase ก่อน" };
    }
  }

  // สรุปประจำวัน (คอลัมน์มีหลังรัน SQL 009)
  if (formData.has("digest_hour")) {
    const hour = Number(formData.get("digest_hour"));
    if (!Number.isInteger(hour) || hour < -1 || hour > 23) return { error: "เวลาส่งสรุปไม่ถูกต้อง" };
    const { error: e4 } = await db().from("settings").update({ digest_hour: hour }).eq("id", 1);
    if (e4) {
      refresh();
      return { error: "บันทึกส่วนอื่นแล้ว แต่สรุปประจำวันยังใช้ไม่ได้ — ต้องรัน SQL ไฟล์ 009 ใน Supabase ก่อน" };
    }
  }

  await audit("settings_changed", { sender_name: senderName, daily_limit: dailyLimit });
  refresh();
  return { ok: true, message: "บันทึกการตั้งค่าแล้ว" };
}

/** ปุ่ม "ส่งสรุปตัวอย่างตอนนี้" — ส่งทันทีโดยไม่สนเวลาที่ตั้ง */
export async function sendDigestNow(): Promise<FormState> {
  await requireAuth();
  try {
    const res = await sendDigest();
    if (!res) return { ok: true, message: "ตอนนี้ไม่มีข้อความที่รอส่งงาน — ไม่มีอะไรให้สรุป (วันแบบนี้ระบบจะไม่ส่งสรุป)" };
    await audit("digest_sent", { campaigns: res.campaigns, auto: false });
    return { ok: true, message: `ส่งสรุปแล้วไปที่ ${res.to} (${res.campaigns} ข้อความ) ลองเปิดดูใน Gmail ได้เลย` };
  } catch (err) {
    return { error: classifySendError(err).message };
  }
}
