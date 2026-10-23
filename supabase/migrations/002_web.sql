-- =====================================================================
-- 002_web.sql : ส่วนเสริมสำหรับหน้าเว็บ
-- วิธีใช้: คัดลอกทั้งไฟล์ไปวางใน Supabase > SQL Editor แล้วกด Run (รันซ้ำได้)
-- =====================================================================

-- ---------- บันทึกการล็อกอินผิด (กันการเดารหัสผ่าน) ----------
create table if not exists login_failures (
  id  bigint generated always as identity primary key,
  at  timestamptz not null default now()
);
create index if not exists login_failures_at_idx on login_failures (at);
alter table login_failures enable row level security;

-- ---------- สรุปจำนวนผู้รับแต่ละสถานะ ต่อข้อความ ----------
-- security_invoker = ใช้สิทธิ์ของผู้เรียก -> RLS ของตารางยังคุ้มครองอยู่
create or replace view campaign_summary with (security_invoker = true) as
select
  c.id,
  count(r.id)::int                                         as total,
  count(r.id) filter (where r.status = 'pending')::int     as pending,
  count(r.id) filter (where r.status = 'sent')::int        as sent,
  count(r.id) filter (where r.status = 'replied')::int     as replied,
  count(r.id) filter (where r.status = 'followed_up')::int as followed_up,
  count(r.id) filter (where r.status = 'failed')::int      as failed,
  count(r.id) filter (where r.status = 'stopped')::int     as stopped
from campaigns c
left join recipients r on r.campaign_id = c.id
group by c.id;

revoke all on campaign_summary from anon, authenticated;
