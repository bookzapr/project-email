import type { Attachment } from "./attachments";

export type RecipientStatus = "pending" | "sent" | "replied" | "followed_up" | "failed" | "stopped";

export const STATUS_LABEL: Record<RecipientStatus, string> = {
  pending: "รอส่ง",
  sent: "ส่งแล้ว",
  replied: "ตอบกลับแล้ว",
  followed_up: "ส่งซ้ำแล้ว",
  failed: "ผิดพลาด",
  stopped: "หยุด",
};

export const STATUS_STYLE: Record<RecipientStatus, string> = {
  pending: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
  sent: "bg-indigo-100 text-indigo-800 ring-1 ring-indigo-200",
  replied: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200",
  followed_up: "bg-amber-100 text-amber-800 ring-1 ring-amber-200",
  failed: "bg-rose-100 text-rose-800 ring-1 ring-rose-200",
  stopped: "bg-zinc-200 text-zinc-600 ring-1 ring-zinc-300",
};

export type Campaign = {
  id: string;
  subject: string;
  body_html: string;
  followup_body_html: string | null;
  send_at: string;
  followup_after_minutes: number;
  paused: boolean;
  attachments: Attachment[];
  /** แนบไฟล์ไปกับอีเมลส่งซ้ำด้วย (มีหลังรัน SQL 006) */
  followup_attach?: boolean;
  /** CC ทุกฉบับ (SQL 007) */
  cc_emails?: string[];
  created_at: string;
  updated_at: string;
};

export type CampaignSummary = {
  id: string;
  total: number;
  pending: number;
  sent: number;
  replied: number;
  followed_up: number;
  failed: number;
  stopped: number;
};

export type ReplyFile = { name: string; kind: "attachment" | "drive_link"; url?: string };

export type Recipient = {
  id: string;
  campaign_id: string;
  name: string;
  email: string;
  status: RecipientStatus;
  sent_at: string | null;
  followup_sent_at: string | null;
  replied_at: string | null;
  reply_files: ReplyFile[] | null;
  reply_url: string | null;
  /** CC เฉพาะคนนี้ (SQL 007) */
  cc_emails?: string[];
  note: string | null;
  error: string | null;
  created_at: string;
};

export type Settings = {
  id: 1;
  sender_name: string;
  daily_limit: number;
  last_run_at: string | null;
  last_send_error: string | null;
  last_send_error_at: string | null;
  last_imap_check_at: string | null;
  last_imap_error: string | null;
  /** ลายเซ็นท้ายอีเมล (มีหลังรัน SQL 006 — ก่อนหน้านั้นเป็น undefined) */
  signature_html?: string;
};

/** ผลลัพธ์ที่ Server Action ส่งกลับไปให้ฟอร์มแสดง */
export type FormState = { ok?: boolean; error?: string; message?: string } | null;
