import "server-only";
import { randomUUID } from "node:crypto";
import { ATTACH_BUCKET, IMAGE_BUCKET, type Attachment, extOf } from "./attachments";
import { db } from "./db";

/** URL ขึ้นต้นของรูปในเนื้อหาอีเมล (bucket สาธารณะ) */
export function imageUrlPrefix(): string {
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${IMAGE_BUCKET}/`;
}

/** ลิงก์อัปโหลดครั้งเดียว ให้ browser ส่งไฟล์ตรงไปที่ Supabase (ไม่ผ่าน Vercel ที่จำกัด 4.5 MB) */
export async function createUploadLink(kind: "attachment" | "image", filename: string) {
  const bucket = kind === "image" ? IMAGE_BUCKET : ATTACH_BUCKET;
  const ext = extOf(filename);
  const path = `${randomUUID()}${ext ? `.${ext}` : ""}`;
  const { data, error } = await db().storage.from(bucket).createSignedUploadUrl(path);
  if (error) throw new Error("สร้างลิงก์อัปโหลดไม่ได้: " + error.message);
  return {
    signedUrl: data.signedUrl,
    path,
    publicUrl: kind === "image" ? `${imageUrlPrefix()}${path}` : null,
  };
}

/** ไฟล์แนบต้องมีอยู่จริงใน Storage และขนาดตรงกับที่แจ้ง (กันข้อมูลปลอมจาก browser) */
export async function verifyAttachments(list: Attachment[]): Promise<string | null> {
  for (const a of list) {
    if (!/^[0-9a-f-]{36}(\.[a-z0-9_]{1,12})?$/.test(a.path)) return `ไฟล์แนบไม่ถูกต้อง: ${a.name}`;
    const { data, error } = await db().storage.from(ATTACH_BUCKET).info(a.path);
    if (error || !data) return `ไม่พบไฟล์แนบ ${a.name} — ลองแนบใหม่อีกครั้ง`;
    if (data.size != null && Number(data.size) !== a.size) a.size = Number(data.size);
  }
  return null;
}

/** รูปในเนื้อหาที่มาจาก bucket ของเรา */
export function imagePathsIn(html: string): string[] {
  const prefix = imageUrlPrefix();
  const out = new Set<string>();
  for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/g)) {
    if (m[1].startsWith(prefix)) out.add(m[1].slice(prefix.length));
  }
  return [...out];
}

// ---------------------------------------------------------------------
// เตรียมไฟล์สำหรับส่ง (ดาวน์โหลดครั้งเดียวต่อข้อความ แล้วใช้ซ้ำทุกผู้รับในรอบเดียวกัน)
// ---------------------------------------------------------------------

export type MailFiles = {
  attachments: { filename: string; content: Buffer; contentType: string }[];
  /** รูปในเนื้อหา: URL เดิม -> แนบแบบฝังในอีเมล (cid) ผู้รับเห็นรูปทันทีโดยไม่ต้องกด "แสดงรูปภาพ" */
  images: Map<string, { cid: string; filename: string; content: Buffer; contentType: string }>;
};

export async function loadMailFiles(attachments: Attachment[], htmls: (string | null)[]): Promise<MailFiles> {
  const files: MailFiles = { attachments: [], images: new Map() };

  for (const a of attachments ?? []) {
    const { data, error } = await db().storage.from(ATTACH_BUCKET).download(a.path);
    if (error || !data) throw new Error(`โหลดไฟล์แนบ ${a.name} ไม่ได้: ${error?.message ?? "ไม่พบไฟล์"}`);
    files.attachments.push({ filename: a.name, content: Buffer.from(await data.arrayBuffer()), contentType: a.type || data.type });
  }

  const prefix = imageUrlPrefix();
  for (const path of new Set(htmls.flatMap((h) => (h ? imagePathsIn(h) : [])))) {
    const { data, error } = await db().storage.from(IMAGE_BUCKET).download(path);
    if (error || !data) throw new Error(`โหลดรูปในเนื้อหาไม่ได้: ${error?.message ?? "ไม่พบไฟล์"}`);
    files.images.set(prefix + path, {
      cid: `img-${path.replace(/\W/g, "")}@email`,
      filename: path,
      content: Buffer.from(await data.arrayBuffer()),
      contentType: data.type || "image/png",
    });
  }
  return files;
}

/** path ของรูปทั้งหมดในเนื้อหาหลายส่วน */
export function imagePathsInAll(htmls: (string | null)[]): string[] {
  return [...new Set(htmls.flatMap((h) => (h ? imagePathsIn(h) : [])))];
}

/** ลบไฟล์แนบ/รูปที่ไม่ใช้แล้ว */
export async function deleteFiles(attachmentPaths: string[], imagePaths: string[]) {
  if (attachmentPaths.length) await db().storage.from(ATTACH_BUCKET).remove(attachmentPaths);
  if (imagePaths.length) await db().storage.from(IMAGE_BUCKET).remove(imagePaths);
}
