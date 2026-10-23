-- =====================================================================
-- 001_init.sql : สร้างตารางทั้งหมดของระบบส่งอีเมลอัตโนมัติ
-- วิธีใช้: คัดลอกทั้งไฟล์ไปวางใน Supabase > SQL Editor แล้วกด Run
-- รันซ้ำได้ (ใช้ if not exists / or replace)
-- เวลาทั้งหมดเก็บเป็น UTC (timestamptz) แสดงผลเป็น Asia/Bangkok ในหน้าเว็บ
-- =====================================================================

-- ---------- ข้อความ (แคมเปญ) ----------
create table if not exists campaigns (
  id                      uuid primary key default gen_random_uuid(),
  subject                 text not null,                 -- หัวข้อ (ใช้ {ชื่อ} ได้)
  body_html               text not null,                 -- เนื้อหา (HTML)
  followup_body_html      text,                          -- เนื้อหาตอนส่งซ้ำ (null = ใช้เนื้อหาเดิม)
  send_at                 timestamptz not null,          -- วันเวลาส่งรอบแรก
  followup_after_minutes  integer not null default 0     -- ส่งซ้ำหลังกี่นาที (0 = ไม่ส่งซ้ำ)
                          check (followup_after_minutes >= 0),
  paused                  boolean not null default false,-- หยุดทั้งข้อความ
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ---------- ผู้รับ (รายคนต่อข้อความ) ----------
create table if not exists recipients (
  id                   uuid primary key default gen_random_uuid(),
  campaign_id          uuid not null references campaigns(id) on delete cascade,
  name                 text not null,
  email                text not null,
  -- pending=รอส่ง, sent=ส่งแล้ว, replied=ตอบกลับแล้ว (ส่งงาน+ไฟล์แนบ),
  -- followed_up=ส่งซ้ำแล้ว, failed=ผิดพลาด, stopped=หยุด
  status               text not null default 'pending'
                       check (status in ('pending','sent','replied','followed_up','failed','stopped')),
  sent_at              timestamptz,          -- เวลาส่งรอบแรก
  followup_sent_at     timestamptz,          -- เวลาส่งซ้ำ
  replied_at           timestamptz,          -- เวลาที่ตรวจพบการส่งงานกลับ
  message_id           text,                 -- Message-ID ของอีเมลรอบแรก (ใช้ผูกเธรด/ตรวจตอบกลับ)
  followup_message_id  text,
  reply_files          jsonb,                -- รายชื่อไฟล์/ลิงก์ที่ผู้รับส่งกลับมา
  note                 text,                 -- หมายเหตุ เช่น "ตอบแล้ว แต่ยังไม่แนบไฟล์"
  error                text,                 -- สาเหตุเมื่อผิดพลาด
  attempts             integer not null default 0,   -- จำนวนครั้งที่ลองส่ง (รอบปัจจุบัน)
  retry_at             timestamptz,          -- ถ้าผิดพลาดชั่วคราว ให้ลองใหม่หลังเวลานี้
  locked_until         timestamptz,          -- กันการส่งซ้ำซ้อน: รอบ cron ที่จองไว้
  lock_token           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists recipients_campaign_email_uniq
  on recipients (campaign_id, lower(email));
create index if not exists recipients_status_idx on recipients (status);

-- ---------- ประวัติการส่งทุกฉบับ (ใช้นับโควตา) ----------
create table if not exists send_log (
  id            bigint generated always as identity primary key,
  recipient_id  uuid references recipients(id) on delete set null,
  campaign_id   uuid references campaigns(id) on delete set null,
  kind          text not null check (kind in ('initial','followup','test')),
  to_email      text not null,
  success       boolean not null,
  error         text,
  sent_at       timestamptz not null default now()
);
create index if not exists send_log_sent_at_idx on send_log (sent_at);

-- ---------- ตั้งค่า (มีแถวเดียว id = 1) ----------
create table if not exists settings (
  id                  integer primary key default 1 check (id = 1),
  sender_name         text not null default '',
  daily_limit         integer not null default 400 check (daily_limit > 0),
  imap_last_check_at  timestamptz,
  imap_last_uid       bigint,
  imap_uidvalidity    bigint,
  updated_at          timestamptz not null default now()
);
insert into settings (id) values (1) on conflict (id) do nothing;

-- ---------- ตัวล็อกงานเบื้องหลัง (เช่น ตรวจ IMAP ไม่ให้ทำพร้อมกัน 2 รอบ) ----------
create table if not exists job_locks (
  name          text primary key,
  locked_until  timestamptz not null,
  token         uuid not null
);

-- ---------- อัปเดต updated_at อัตโนมัติ ----------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists campaigns_updated_at on campaigns;
create trigger campaigns_updated_at before update on campaigns
  for each row execute function set_updated_at();
drop trigger if exists recipients_updated_at on recipients;
create trigger recipients_updated_at before update on recipients
  for each row execute function set_updated_at();
drop trigger if exists settings_updated_at on settings;
create trigger settings_updated_at before update on settings
  for each row execute function set_updated_at();

-- =====================================================================
-- โควตา: จำนวนที่ส่งสำเร็จใน 24 ชั่วโมงล่าสุด (Gmail นับแบบ 24 ชม. ย้อนหลัง)
-- =====================================================================
create or replace function sent_last_24h() returns integer
language sql stable as $$
  select count(*)::int from send_log
  where success and sent_at > now() - interval '24 hours';
$$;

-- =====================================================================
-- จองงานส่งชุดถัดไป (หัวใจของการกันส่งซ้ำซ้อน)
--  * ใช้ advisory lock ให้การจองทำทีละรอบ -> นับโควตาได้แม่นแม้ cron ทับกัน
--  * FOR UPDATE SKIP LOCKED + locked_until -> แถวที่รอบอื่นจองไว้จะไม่ถูกหยิบซ้ำ
--  * ถ้ารอบไหนค้าง/ล่ม การจองหมดอายุเองหลัง p_lease_seconds วินาที
--  * จำกัดไม่ให้เกินโควตาต่อวัน ส่วนที่เกินจะรอรอบถัดไปเอง
-- คืนค่า: แถวผู้รับที่จองได้ + ข้อมูลข้อความ + kind ('initial' หรือ 'followup')
-- =====================================================================
create or replace function claim_send_batch(p_limit integer, p_lease_seconds integer default 120)
returns table (
  recipient_id        uuid,
  lock_token          uuid,
  kind                text,
  campaign_id         uuid,
  name                text,
  email               text,
  message_id          text,
  attempts            integer,
  subject             text,
  body_html           text,
  followup_body_html  text
)
language plpgsql as $$
#variable_conflict use_column
declare
  v_token     uuid := gen_random_uuid();
  v_limit     integer;
  v_in_flight integer;
begin
  -- ให้การจองทำได้ทีละรอบ (ปลดล็อกเองเมื่อจบ transaction)
  perform pg_advisory_xact_lock(hashtext('claim_send_batch'));

  -- งานที่ถูกจองอยู่และยังไม่หมดอายุ นับเป็นโควตาที่กำลังใช้
  select count(*) into v_in_flight from recipients r
  where r.locked_until > now();

  select greatest(0, least(p_limit, s.daily_limit - sent_last_24h() - v_in_flight))
    into v_limit
  from settings s where s.id = 1;

  if v_limit = 0 then
    return;
  end if;

  return query
  with candidates as (
    select r.id,
           case when r.status = 'pending' then 'initial' else 'followup' end as k
    from recipients r
    join campaigns c on c.id = r.campaign_id
    where not c.paused
      and (r.locked_until is null or r.locked_until < now())
      and (r.retry_at is null or r.retry_at <= now())
      and (
        -- รอบแรก: ถึงเวลาส่งแล้ว
        (r.status = 'pending' and c.send_at <= now())
        or
        -- ส่งซ้ำ: เปิดใช้ส่งซ้ำ + ยังไม่ตอบ + ครบเวลาแล้ว
        (r.status = 'sent' and c.followup_after_minutes > 0
         and r.sent_at + make_interval(mins => c.followup_after_minutes) <= now())
      )
    order by coalesce(r.sent_at, c.send_at), r.created_at
    limit v_limit
    for update of r skip locked
  ),
  locked as (
    update recipients r
    set locked_until = now() + make_interval(secs => p_lease_seconds),
        lock_token   = v_token
    from candidates
    where r.id = candidates.id
    returning r.id, r.campaign_id, r.name, r.email, r.message_id, r.attempts, candidates.k
  )
  select l.id, v_token, l.k, l.campaign_id, l.name, l.email, l.message_id, l.attempts,
         c.subject, c.body_html, c.followup_body_html
  from locked l
  join campaigns c on c.id = l.campaign_id;
end $$;

-- =====================================================================
-- ล็อกงานเบื้องหลังแบบมีวันหมดอายุ (คืน token ถ้าได้ล็อก, null ถ้ามีรอบอื่นถืออยู่)
-- =====================================================================
create or replace function try_job_lock(p_name text, p_seconds integer)
returns uuid
language plpgsql as $$
declare
  v_token uuid := gen_random_uuid();
begin
  insert into job_locks (name, locked_until, token)
  values (p_name, now() + make_interval(secs => p_seconds), v_token)
  on conflict (name) do update
    set locked_until = excluded.locked_until, token = excluded.token
    where job_locks.locked_until < now();
  if found then
    return v_token;
  end if;
  return null;
end $$;

create or replace function release_job_lock(p_name text, p_token uuid)
returns void
language sql as $$
  delete from job_locks where name = p_name and token = p_token;
$$;

-- =====================================================================
-- ความปลอดภัย: เปิด RLS ทุกตาราง และไม่สร้าง policy ใดๆ
-- -> เข้าถึงได้เฉพาะฝั่ง server ที่ใช้ Secret key เท่านั้น
-- =====================================================================
alter table campaigns  enable row level security;
alter table recipients enable row level security;
alter table send_log   enable row level security;
alter table settings   enable row level security;
alter table job_locks  enable row level security;

revoke execute on function claim_send_batch(integer, integer) from public, anon, authenticated;
revoke execute on function try_job_lock(text, integer)       from public, anon, authenticated;
revoke execute on function release_job_lock(text, uuid)      from public, anon, authenticated;
revoke execute on function sent_last_24h()                   from public, anon, authenticated;
