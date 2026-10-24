"use server";

import { refresh } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
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

  refresh();
  return { ok: true, message: "บันทึกการตั้งค่าแล้ว" };
}
