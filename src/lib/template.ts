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

/** ต่อท้ายลายเซ็น (แบบ Gmail: ขึ้นบรรทัด "--" แล้วตามด้วยลายเซ็น) — ใช้ทั้งตัวอย่างบนเว็บและตอนส่งจริง */
export function withSignature(html: string, signatureHtml: string | null | undefined): string {
  if (isBlankHtml(signatureHtml) && !/<img/i.test(signatureHtml ?? "")) return html;
  return `${html}<p style="color:#888888;margin-top:20px">--</p>${signatureHtml}`;
}

/** เนื้อหา HTML ว่างจริงๆ หรือไม่ (ตัวแก้ไขจะให้ "<p></p>" มาเมื่อไม่มีข้อความ) */
export function isBlankHtml(html: string | null | undefined): boolean {
  if (!html) return true;
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() === "";
}
