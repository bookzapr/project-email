import "server-only";
import sanitizeHtml from "sanitize-html";
import { imageUrlPrefix } from "./storage";

const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\)$/i];

/** เก็บเฉพาะรูปแบบที่ตัวแก้ไขสร้างได้ ตัดสคริปต์/สไตล์แปลกปลอมออกก่อนบันทึก */
export function sanitizeEmailHtml(html: string): string {
  const imagePrefix = imageUrlPrefix();
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "span", "a", "ul", "ol", "li", "h2", "h3", "blockquote", "hr", "img"],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      "*": ["style"],
    },
    // รูปต้องมาจากที่เก็บรูปของระบบเท่านั้น (ตอนส่งจะถูกฝังลงในอีเมล)
    exclusiveFilter: (frame) => frame.tag === "img" && !String(frame.attribs.src ?? "").startsWith(imagePrefix),
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
