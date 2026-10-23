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
  pending: "bg-slate-100 text-slate-700",
  sent: "bg-blue-100 text-blue-800",
  replied: "bg-green-100 text-green-800",
  followed_up: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-800",
  stopped: "bg-zinc-200 text-zinc-600",
};

export type Campaign = {
  id: string;
  subject: string;
  body_html: string;
  followup_body_html: string | null;
  send_at: string;
  followup_after_minutes: number;
  paused: boolean;
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
};

/** ผลลัพธ์ที่ Server Action ส่งกลับไปให้ฟอร์มแสดง */
export type FormState = { ok?: boolean; error?: string; message?: string } | null;
