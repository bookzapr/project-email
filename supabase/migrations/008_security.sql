-- =====================================================================
-- 008_security.sql : ยืนยันตัวตน 2 ขั้น (2FA), บันทึกการใช้งาน, ลบข้อมูลเก่าอัตโนมัติ
-- วิธีใช้: คัดลอกทั้งไฟล์ไปวางใน Supabase > SQL Editor แล้วกด Run (รันซ้ำได้)
-- =====================================================================

-- ---------- 2FA (Google Authenticator) ----------
-- secret เก็บแบบเข้ารหัส (AES-256-GCM ด้วยคีย์จาก SESSION_SECRET) ไม่เก็บเป็นข้อความธรรมดา
alter table settings add column if not exists totp_enabled        boolean not null default false;
alter table settings add column if not exists totp_secret_enc     text;     -- secret ที่ใช้อยู่
alter table settings add column if not exists totp_pending_enc    text;     -- secret ระหว่างตั้งค่า (ยังไม่ยืนยัน)
alter table settings add column if not exists totp_last_step      bigint;   -- กันใช้รหัสเดิมซ้ำ
alter table settings add column if not exists totp_recovery       jsonb not null default '[]'::jsonb; -- hash ของรหัสสำรอง

-- ---------- การล็อกอิน ----------
-- เพิ่มเลขนี้ = ทุกเครื่องถูกออกจากระบบทันที ("ออกจากระบบทุกเครื่อง")
alter table settings add column if not exists session_version     integer not null default 1;
-- ส่งอีเมลแจ้งเตือนการล็อกอินไปที่ไหน (ว่าง = อีเมลผู้ส่งของระบบ)
alter table settings add column if not exists alert_email         text not null default '';
-- กันเดารหัสแยกตาม IP (คนร้ายจะล็อกเจ้าของออกไม่ได้)
alter table login_failures add column if not exists ip text;
create index if not exists login_failures_ip_at_idx on login_failures (ip, at);

-- ---------- ลบข้อมูลเก่าอัตโนมัติ (PDPA) ----------
-- 0 = ไม่ลบ, เช่น 90 = ลบข้อความที่วันส่งเก่ากว่า 90 วัน พร้อมรายชื่อผู้รับและไฟล์
alter table settings add column if not exists retention_days      integer not null default 0
  check (retention_days >= 0 and retention_days <= 3650);

-- ---------- บันทึกการใช้งาน ----------
create table if not exists audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  action      text not null,
  detail      jsonb,
  ip          text,
  user_agent  text
);
create index if not exists audit_log_at_idx on audit_log (at desc);
alter table audit_log enable row level security;
