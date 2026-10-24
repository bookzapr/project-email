"use client";

import { getUploadUrl } from "@/app/(app)/campaigns/actions";

/** อัปโหลดไฟล์จาก browser ตรงไปที่ Supabase Storage (ขอลิงก์จาก server ก่อน) */
export async function uploadFile(
  kind: "attachment" | "image",
  file: File,
  existing: { size: number }[] = [],
): Promise<{ error: string } | { path: string; publicUrl: string | null }> {
  const type = file.type || "application/octet-stream";
  const link = await getUploadUrl(kind, { name: file.name, size: file.size, type }, existing);
  if ("error" in link) return link;
  try {
    const res = await fetch(link.signedUrl, {
      method: "PUT",
      headers: { "content-type": type, "x-upsert": "false" },
      body: file,
    });
    if (!res.ok) return { error: `${file.name}: อัปโหลดไม่สำเร็จ (${res.status})` };
  } catch {
    return { error: `${file.name}: อัปโหลดไม่สำเร็จ — ตรวจการเชื่อมต่ออินเทอร์เน็ต` };
  }
  return { path: link.path, publicUrl: link.publicUrl };
}
