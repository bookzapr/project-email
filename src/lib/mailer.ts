import "server-only";
import { randomUUID } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { fillHtml, fillText, isBlankHtml } from "./template";

// ---------------------------------------------------------------------
// การเชื่อมต่อ Gmail SMTP
// ---------------------------------------------------------------------

export function gmailUser(): string {
  const user = process.env.GMAIL_USER;
  if (!user) throw new Error("ไม่พบ GMAIL_USER ใน Environment Variables");
  return user;
}

export function createTransport(): Transporter {
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  if (!pass) throw new Error("ไม่พบ GMAIL_APP_PASSWORD ใน Environment Variables");
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: gmailUser(), pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

// ---------------------------------------------------------------------
// ประกอบอีเมล
// ---------------------------------------------------------------------

export type OutgoingEmail = {
  kind: "initial" | "followup";
  toName: string;
  toEmail: string;
  subject: string;
  bodyHtml: string;
  followupBodyHtml: string | null;
  /** Message-ID ของอีเมลรอบแรก (ใช้ผูกอีเมลส่งซ้ำให้อยู่ในเธรดเดียวกัน) */
  originalMessageId?: string | null;
  senderName: string;
};

// ค่าเดียวกับ .email-content ใน globals.css — ตัวอย่างบนเว็บจึงตรงกับที่ผู้รับเห็น
const EMAIL_CSS = `p{margin:0 0 12px}li p{margin:0}ul,ol{margin:0 0 12px;padding-left:24px}h2{font-size:20px;margin:16px 0 8px}h3{font-size:17px;margin:16px 0 8px}hr{border:0;border-top:1px solid #e2e8f0;margin:16px 0}a{color:#1d4ed8}`;
const QUOTE_STYLE = "margin:0 0 12px;border-left:3px solid #cccccc;padding-left:12px;color:#555555;";

function wrapHtml(inner: string): string {
  // ใส่ style ของ blockquote แบบ inline ด้วย (โปรแกรมอีเมลบางตัวไม่อ่าน <style>)
  const body = inner.replace(/<blockquote(?: style="([^"]*)")?>/g, (_, s) => `<blockquote style="${QUOTE_STYLE}${s ?? ""}">`);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${EMAIL_CSS}</style></head><body style="margin:0;padding:0;">
<div style="font-family:Tahoma,'Leelawadee UI','Noto Sans Thai',Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;">
${body}
</div></body></html>`;
}

/** แปลง HTML เป็นข้อความธรรมดา (ใส่ไว้คู่กันในอีเมล ช่วยไม่ให้ตกถังสแปม) */
export function htmlToText(html: string): string {
  return html
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_, href, text) =>
      text.replace(/<[^>]*>/g, "") === href ? href : `${text} (${href})`,
    )
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/(p|h2|h3|li|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n----------\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function newMessageId(): string {
  const domain = gmailUser().split("@")[1] ?? "gmail.com";
  return `<${randomUUID()}@${domain}>`;
}

/** ส่งอีเมล 1 ฉบับ คืน Message-ID ที่ใช้ */
export async function sendEmail(transport: Transporter, email: OutgoingEmail): Promise<string> {
  const isFollowup = email.kind === "followup";
  const subject = fillText(email.subject, email.toName);
  const sourceHtml = isFollowup && !isBlankHtml(email.followupBodyHtml) ? email.followupBodyHtml! : email.bodyHtml;
  const html = fillHtml(sourceHtml, email.toName);
  const messageId = newMessageId();
  const threadId = isFollowup ? email.originalMessageId : null;

  await transport.sendMail({
    from: { name: email.senderName || "", address: gmailUser() },
    to: { name: email.toName, address: email.toEmail },
    subject: isFollowup ? `Re: ${subject}` : subject,
    html: wrapHtml(html),
    text: htmlToText(html),
    messageId,
    ...(threadId ? { inReplyTo: threadId, references: [threadId] } : {}),
  });
  return messageId;
}

// ---------------------------------------------------------------------
// แปลข้อผิดพลาดจาก Gmail เป็นภาษาไทย + จัดประเภท
// ---------------------------------------------------------------------

export type SendErrorKind =
  | "auth" //       รหัสผ่าน/บัญชีมีปัญหา -> หยุดทั้งรอบ ไม่โทษผู้รับ
  | "quota" //      Gmail บอกว่าเกินโควตาวันนี้ -> หยุดทั้งรอบ เลื่อนไปทีหลัง
  | "recipient" //  ผู้รับผิด (อีเมลไม่มีจริง/ถูกปฏิเสธ) -> ผิดพลาดถาวร
  | "temporary"; // เครือข่าย/เซิร์ฟเวอร์ชั่วคราว -> ลองใหม่

export function classifySendError(err: unknown): { kind: SendErrorKind; message: string } {
  const e = err as { code?: string; responseCode?: number; response?: string; message?: string };
  const text = `${e.response ?? ""} ${e.message ?? ""}`;

  if (e.code === "EAUTH" || e.code === "ENOAUTH" || e.responseCode === 535 || e.responseCode === 534) {
    return {
      kind: "auth",
      message: "เข้าสู่ระบบ Gmail ไม่ได้ — ตรวจ GMAIL_USER และ App Password (อาจถูกลบหรือเปลี่ยนรหัสผ่าน Google)",
    };
  }
  if (/5\.4\.5|daily (user )?sending (quota|limit)|limit exceeded/i.test(text)) {
    return { kind: "quota", message: "Gmail แจ้งว่าส่งเกินขีดจำกัดต่อวันแล้ว ระบบจะลองใหม่ภายหลัง" };
  }
  if (e.responseCode && e.responseCode >= 500 && e.responseCode < 600) {
    if (/5\.1\.1|does not exist|no such user|user unknown/i.test(text)) {
      return { kind: "recipient", message: "อีเมลผู้รับไม่มีอยู่จริง" };
    }
    if (/5\.7\.|spam|policy|blocked/i.test(text)) {
      return { kind: "recipient", message: `Gmail ปฏิเสธการส่ง (อาจถูกมองว่าเป็นสแปม): ${short(text)}` };
    }
    return { kind: "recipient", message: `ส่งไม่สำเร็จ: ${short(text)}` };
  }
  if (e.code === "EENVELOPE") {
    return { kind: "recipient", message: "อีเมลผู้รับไม่ถูกต้อง" };
  }
  if (e.code && /ETIMEDOUT|ECONNECTION|ECONNRESET|ESOCKET|EDNS|ECONNREFUSED/.test(e.code)) {
    return { kind: "temporary", message: "เชื่อมต่อ Gmail ไม่ได้ชั่วคราว ระบบจะลองใหม่" };
  }
  if (e.responseCode && e.responseCode >= 400 && e.responseCode < 500) {
    return { kind: "temporary", message: `Gmail ขอให้ลองใหม่ภายหลัง: ${short(text)}` };
  }
  return { kind: "temporary", message: `ข้อผิดพลาดที่ไม่คาดคิด: ${short(text)}` };
}

function short(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > 200 ? t.slice(0, 200) + "…" : t;
}
