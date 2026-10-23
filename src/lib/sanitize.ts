import "server-only";
import sanitizeHtml from "sanitize-html";

/** เก็บเฉพาะรูปแบบที่ตัวแก้ไขสร้างได้ ตัดสคริปต์/สไตล์แปลกปลอมออกก่อนบันทึก */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "a", "ul", "ol", "li", "h2", "h3", "blockquote", "hr"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
    },
  });
}
