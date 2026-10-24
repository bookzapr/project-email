-- =====================================================================
-- 005_attachments.sql : ไฟล์แนบของแต่ละข้อความ
-- วิธีใช้: คัดลอกทั้งไฟล์ไปวางใน Supabase > SQL Editor แล้วกด Run (รันซ้ำได้)
--
-- ตัวไฟล์เก็บใน Supabase Storage:
--   attachments  (ส่วนตัว)  ไฟล์แนบ
--   email-images (สาธารณะ) รูปในเนื้อหาอีเมล
-- =====================================================================

-- รายการไฟล์แนบ: [{ "name": "ใบสมัคร.pdf", "path": "<uuid>.pdf", "size": 12345, "type": "application/pdf" }]
alter table campaigns add column if not exists attachments jsonb not null default '[]'::jsonb;

-- (สร้างที่เก็บไฟล์ไว้ให้ ถ้ายังไม่มี)
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('attachments', 'attachments', false, 20971520),
  ('email-images', 'email-images', true, 5242880)
on conflict (id) do nothing;
