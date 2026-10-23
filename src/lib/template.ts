// แทนค่า {ชื่อ} ในหัวข้อและเนื้อหา (ใช้ทั้งหน้าดูตัวอย่างและตอนส่งจริง)
const NAME_TOKEN = /\{\s*ชื่อ\s*\}/g;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function fillText(text: string, name: string): string {
  return text.replace(NAME_TOKEN, name);
}

export function fillHtml(html: string, name: string): string {
  return html.replace(NAME_TOKEN, escapeHtml(name));
}

/** เนื้อหา HTML ว่างจริงๆ หรือไม่ (ตัวแก้ไขจะให้ "<p></p>" มาเมื่อไม่มีข้อความ) */
export function isBlankHtml(html: string | null | undefined): boolean {
  if (!html) return true;
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() === "";
}
