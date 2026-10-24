-- =====================================================================
-- 009_digest.sql : อีเมลสรุปประจำวัน (ใครส่งงานแล้ว / ใครยังไม่ส่ง)
-- วิธีใช้: คัดลอกทั้งไฟล์ไปวางใน Supabase > SQL Editor แล้วกด Run (รันซ้ำได้)
-- =====================================================================

-- ส่งสรุปกี่โมง (เวลาไทย 0–23) · -1 = ปิด · ค่าเริ่มต้น 17:00
alter table settings add column if not exists digest_hour      integer not null default 17
  check (digest_hour >= -1 and digest_hour <= 23);
-- วันที่ส่งสรุปไปแล้วล่าสุด (กันส่งซ้ำในวันเดียวกัน)
alter table settings add column if not exists digest_last_date date;
