// แปลงข้อความที่วาง (หรือไฟล์ CSV) เป็นรายชื่อผู้รับ
// รองรับต่อบรรทัด:  ชื่อ,อีเมล | ชื่อ<Tab>อีเมล (คัดลอกจาก Excel) | ชื่อ;อีเมล | ชื่อ <อีเมล> | อีเมล,ชื่อ
// ใช้ได้ทั้งฝั่ง browser (แสดงตัวอย่าง) และฝั่ง server (ตรวจซ้ำก่อนบันทึก)

export type ParsedRecipient = {
  name: string;
  email: string;
  /** CC เฉพาะคนนี้ (คอลัมน์ที่ 3 ขึ้นไป หลายคนคั่นด้วย ; ได้) */
  cc?: string[];
};

/** แยกรายการอีเมลที่คั่นด้วย , ; หรือเว้นวรรค */
export function splitEmails(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
}
export type RejectedLine = { line: number; text: string; reason: string };

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

/** ตรวจผู้รับ 1 คน (ใช้กับตารางที่แก้ไขได้) — คืนข้อความปัญหา หรือ null */
export function recipientProblem(r: ParsedRecipient): string | null {
  if (!r.name.trim()) return "ไม่มีชื่อ";
  if (!isValidEmail(r.email.trim().toLowerCase())) return "อีเมลไม่ถูกต้อง";
  const bad = (r.cc ?? []).find((c) => !isValidEmail(c));
  if (bad) return `CC ไม่ถูกต้อง (${bad})`;
  return null;
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

function parseLine(raw: string): { name: string; email: string; cc: string[] } | { reason: string } {
  // รูปแบบ: ชื่อ <อีเมล>
  const angle = raw.match(/^(.*)<\s*([^<>\s]+)\s*>\s*$/);
  if (angle) {
    return { name: angle[1].replace(/^["'\s]+|["'\s,;]+$/g, ""), email: angle[2], cc: [] };
  }

  const sep = raw.includes("\t") ? "\t" : raw.includes(",") ? "," : raw.includes(";") ? ";" : null;
  const cols = sep ? splitCsvLine(raw, sep) : [raw.trim()];
  const emailIdx = cols.findIndex((c) => c.includes("@"));
  if (emailIdx === -1) return { reason: "ไม่พบอีเมล" };

  // คอลัมน์แรกที่มี @ = อีเมลผู้รับ, คอลัมน์อื่นที่มี @ = CC, ที่เหลือ = ชื่อ
  const email = cols[emailIdx];
  const cc = cols.filter((c, i) => i !== emailIdx && c.includes("@")).flatMap(splitEmails);
  const name = cols
    .filter((c, i) => i !== emailIdx && !c.includes("@"))
    .filter(Boolean)
    .join(" ");
  return { name, email, cc };
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
    const cc = parsed.cc.filter((c) => c !== email);
    const badCc = cc.find((c) => !isValidEmail(c));
    if (!isValidEmail(email)) {
      rejected.push({ line: i + 1, text: line, reason: "รูปแบบอีเมลไม่ถูกต้อง" });
    } else if (badCc) {
      rejected.push({ line: i + 1, text: line, reason: `อีเมล CC ไม่ถูกต้อง (${badCc})` });
    } else if (cc.length > 10) {
      rejected.push({ line: i + 1, text: line, reason: "CC ได้ไม่เกิน 10 อีเมลต่อคน" });
    } else if (!name) {
      rejected.push({ line: i + 1, text: line, reason: "ไม่มีชื่อ" });
    } else if (name.length > 200) {
      rejected.push({ line: i + 1, text: line, reason: "ชื่อยาวเกินไป" });
    } else if (seen.has(email)) {
      rejected.push({ line: i + 1, text: line, reason: "อีเมลซ้ำในรายการ" });
    } else {
      seen.add(email);
      valid.push(cc.length ? { name, email, cc } : { name, email });
    }
  });

  return { valid, rejected };
}
