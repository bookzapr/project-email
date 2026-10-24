// ไฟล์แนบและรูปในอีเมล — กติกาที่ใช้ทั้งฝั่ง browser (ตรวจก่อนอัปโหลด) และ server (ตรวจซ้ำก่อนบันทึก/ส่ง)

export type Attachment = {
  /** ชื่อไฟล์ที่ผู้รับเห็น */
  name: string;
  /** ตำแหน่งใน Storage bucket "attachments" (ตั้งชื่อเป็น uuid เพราะ Storage ไม่รับชื่อไฟล์ภาษาไทย) */
  path: string;
  size: number;
  type: string;
};

export const ATTACH_BUCKET = "attachments";
export const IMAGE_BUCKET = "email-images";

/** รวมไฟล์แนบทั้งหมดต่ออีเมล (Gmail รับ 25 MB เผื่อไว้ให้) */
export const MAX_ATTACH_TOTAL = 20 * 1024 * 1024;
export const MAX_ATTACH_COUNT = 10;
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** นามสกุลที่ Gmail ไม่ยอมส่ง */
const BLOCKED_EXT = new Set([
  "ade", "adp", "apk", "appx", "appxbundle", "bat", "cab", "chm", "cmd", "com", "cpl", "diagcab", "diagcfg",
  "diagpack", "dll", "dmg", "ex", "ex_", "exe", "hta", "img", "ins", "iso", "isp", "jar", "jnlp", "js", "jse",
  "lib", "lnk", "mde", "mjs", "msc", "msi", "msix", "msixbundle", "msp", "mst", "nsh", "pif", "ps1", "scr",
  "sct", "shb", "sys", "vb", "vbe", "vbs", "vhd", "vxd", "wsc", "wsf", "wsh", "xll",
]);

export function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9_]{1,12})$/);
  return m ? m[1] : "";
}

/** ตรวจไฟล์แนบ 1 ไฟล์ — คืนข้อความผิดพลาด หรือ null ถ้าใช้ได้ */
export function checkAttachment(name: string, size: number, existing: { size: number }[]): string | null {
  if (!name.trim()) return "ไฟล์ไม่มีชื่อ";
  if (size <= 0) return `${name}: ไฟล์ว่างเปล่า`;
  if (BLOCKED_EXT.has(extOf(name))) return `${name}: Gmail ไม่อนุญาตให้ส่งไฟล์ชนิดนี้ (.${extOf(name)})`;
  if (existing.length >= MAX_ATTACH_COUNT) return `แนบได้ไม่เกิน ${MAX_ATTACH_COUNT} ไฟล์`;
  const total = existing.reduce((s, a) => s + a.size, 0) + size;
  if (total > MAX_ATTACH_TOTAL) {
    return `${name}: ไฟล์แนบรวมเกิน ${formatSize(MAX_ATTACH_TOTAL)} (Gmail ส่งไม่ได้) — ไฟล์ใหญ่ให้ใส่เป็นลิงก์ Google Drive แทน`;
  }
  return null;
}

export function checkImage(name: string, size: number, type: string): string | null {
  if (!IMAGE_TYPES.includes(type)) return `${name}: รองรับเฉพาะรูป PNG, JPG, GIF, WEBP`;
  if (size > MAX_IMAGE_SIZE) return `${name}: รูปใหญ่เกิน ${formatSize(MAX_IMAGE_SIZE)} — ลองย่อรูปก่อน`;
  return null;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
