"use server";

import { refresh } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
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

  refresh();
  return { ok: true, message: "บันทึกการตั้งค่าแล้ว" };
}
