// แปลงข้อความที่วาง (หรือไฟล์ CSV) เป็นรายชื่อผู้รับ
// รองรับต่อบรรทัด:  ชื่อ,อีเมล | ชื่อ<Tab>อีเมล (คัดลอกจาก Excel) | ชื่อ;อีเมล | ชื่อ <อีเมล> | อีเมล,ชื่อ
// ใช้ได้ทั้งฝั่ง browser (แสดงตัวอย่าง) และฝั่ง server (ตรวจซ้ำก่อนบันทึก)

export type ParsedRecipient = { name: string; email: string };
export type RejectedLine = { line: number; text: string; reason: string };

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

/** แยกคอลัมน์ CSV แบบรองรับเครื่องหมายคำพูด เช่น "สมชาย, ใจดี",a@b.com */
function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseLine(raw: string): { name: string; email: string } | { reason: string } {
  // รูปแบบ: ชื่อ <อีเมล>
  const angle = raw.match(/^(.*)<\s*([^<>\s]+)\s*>\s*$/);
  if (angle) {
    return { name: angle[1].replace(/^["'\s]+|["'\s,;]+$/g, ""), email: angle[2] };
  }

  const sep = raw.includes("\t") ? "\t" : raw.includes(",") ? "," : raw.includes(";") ? ";" : null;
  const cols = sep ? splitCsvLine(raw, sep) : [raw.trim()];
  const emailIdx = cols.findIndex((c) => c.includes("@"));
  if (emailIdx === -1) return { reason: "ไม่พบอีเมล" };

  const email = cols[emailIdx];
  const name = cols
    .filter((_, i) => i !== emailIdx)
    .filter(Boolean)
    .join(" ");
  return { name, email };
}

export function parseRecipients(text: string): { valid: ParsedRecipient[]; rejected: RejectedLine[] } {
  const valid: ParsedRecipient[] = [];
  const rejected: RejectedLine[] = [];
  const seen = new Set<string>();

  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  lines.forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line) return;

    const parsed = parseLine(line);
    if ("reason" in parsed) {
      // แถวหัวตาราง เช่น "ชื่อ,อีเมล" ให้ข้ามเงียบๆ
      if (i === 0 && /ชื่อ|อีเมล|name|e-?mail/i.test(line)) return;
      rejected.push({ line: i + 1, text: line, reason: parsed.reason });
      return;
    }

    const email = parsed.email.trim().toLowerCase();
    const name = parsed.name.trim().replace(/\s+/g, " ");
    if (!isValidEmail(email)) {
      rejected.push({ line: i + 1, text: line, reason: "รูปแบบอีเมลไม่ถูกต้อง" });
    } else if (!name) {
      rejected.push({ line: i + 1, text: line, reason: "ไม่มีชื่อ" });
    } else if (name.length > 200) {
      rejected.push({ line: i + 1, text: line, reason: "ชื่อยาวเกินไป" });
    } else if (seen.has(email)) {
      rejected.push({ line: i + 1, text: line, reason: "อีเมลซ้ำในรายการ" });
    } else {
      seen.add(email);
      valid.push({ name, email });
    }
  });

  return { valid, rejected };
}
