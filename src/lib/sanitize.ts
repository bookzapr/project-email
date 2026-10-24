import "server-only";
import sanitizeHtml from "sanitize-html";

const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\)$/i];

/** เก็บเฉพาะรูปแบบที่ตัวแก้ไขสร้างได้ ตัดสคริปต์/สไตล์แปลกปลอมออกก่อนบันทึก */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "span", "a", "ul", "ol", "li", "h2", "h3", "blockquote", "hr"],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      "*": ["style"],
    },
    allowedStyles: {
      "*": {
        color: COLOR,
        "background-color": COLOR,
        "font-family": [/^[\w\s,'"-]{1,120}$/],
        "font-size": [/^\d{1,2}(\.\d+)?px$/],
        "text-align": [/^(left|center|right|justify)$/],
        "margin-left": [/^\d{1,3}px$/],
      },
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
    },
  });
}
