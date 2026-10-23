-- =====================================================================
-- 003_send.sql : ส่วนเสริมสำหรับการส่งอีเมล
-- วิธีใช้: คัดลอกทั้งไฟล์ไปวางใน Supabase > SQL Editor แล้วกด Run (รันซ้ำได้)
-- =====================================================================

-- ---------- สถานะของตัวส่งล่าสุด (แสดงเตือนบนหน้าเว็บ เช่น App Password ผิด) ----------
alter table settings add column if not exists last_run_at        timestamptz;
alter table settings add column if not exists last_send_error    text;
alter table settings add column if not exists last_send_error_at timestamptz;

-- ---------- จองงาน: เพิ่มตัวเลือกว่าจะรวมอีเมลส่งซ้ำหรือไม่ ----------
-- (ขั้นที่ 3 ส่งเฉพาะรอบแรก — อีเมลส่งซ้ำจะเปิดในขั้นที่ 4 หลังมีระบบตรวจการส่งงานกลับ)
drop function if exists claim_send_batch(integer, integer);

create or replace function claim_send_batch(
  p_limit integer,
  p_lease_seconds integer default 120,
  p_include_followup boolean default true
)
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
  perform pg_advisory_xact_lock(hashtext('claim_send_batch'));

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
        (r.status = 'pending' and c.send_at <= now())
        or
        (p_include_followup
         and r.status = 'sent' and c.followup_after_minutes > 0
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
-- บันทึกผลการส่ง 1 ฉบับ (ทำในคำสั่งเดียว ไม่มีจังหวะข้อมูลครึ่งๆ กลางๆ)
--  * อัปเดตได้เฉพาะแถวที่รอบนี้จองไว้ (lock_token ตรง)
--  * ถ้าระหว่างส่งมีคนกด "หยุด" สถานะยังคงเป็น "หยุด" แต่บันทึกเวลาที่ส่งไปแล้วไว้
--  * p_give_up = false -> ผิดพลาดชั่วคราว จะลองใหม่ที่ p_retry_at
-- =====================================================================
create or replace function complete_send(
  p_id          uuid,
  p_token       uuid,
  p_kind        text,
  p_success     boolean,
  p_message_id  text default null,
  p_error       text default null,
  p_retry_at    timestamptz default null,
  p_give_up     boolean default false
)
returns void
language plpgsql as $$
declare
  v_email     text;
  v_campaign  uuid;
begin
  if p_success then
    update recipients set
      status = case
                 when status = 'stopped' then status
                 when p_kind = 'initial' then 'sent'
                 else 'followed_up'
               end,
      sent_at             = case when p_kind = 'initial' then now() else sent_at end,
      message_id          = case when p_kind = 'initial' then p_message_id else message_id end,
      followup_sent_at    = case when p_kind = 'followup' then now() else followup_sent_at end,
      followup_message_id = case when p_kind = 'followup' then p_message_id else followup_message_id end,
      error = null, attempts = 0, retry_at = null,
      locked_until = null, lock_token = null
    where id = p_id and lock_token = p_token
    returning email, campaign_id into v_email, v_campaign;
  elsif p_give_up then
    update recipients set
      status = case when status = 'stopped' then status else 'failed' end,
      error = p_error, attempts = attempts + 1, retry_at = null,
      locked_until = null, lock_token = null
    where id = p_id and lock_token = p_token
    returning email, campaign_id into v_email, v_campaign;
  else
    update recipients set
      error = p_error, attempts = attempts + 1, retry_at = p_retry_at,
      locked_until = null, lock_token = null
    where id = p_id and lock_token = p_token
    returning email, campaign_id into v_email, v_campaign;
  end if;

  if v_email is not null then
    insert into send_log (recipient_id, campaign_id, kind, to_email, success, error)
    values (p_id, v_campaign, p_kind, v_email, p_success, p_error);
  end if;
end $$;

-- ---------- ปล่อยการจองที่ไม่ได้ส่ง (เช่น หมดเวลาในรอบนี้ หรือ Gmail มีปัญหาทั้งระบบ) ----------
create or replace function release_claim(p_token uuid, p_ids uuid[], p_retry_at timestamptz default null)
returns void
language sql as $$
  update recipients
  set locked_until = null, lock_token = null,
      retry_at = coalesce(p_retry_at, retry_at)
  where lock_token = p_token and id = any(p_ids);
$$;

revoke execute on function claim_send_batch(integer, integer, boolean)                                   from public, anon, authenticated;
revoke execute on function complete_send(uuid, uuid, text, boolean, text, text, timestamptz, boolean)   from public, anon, authenticated;
revoke execute on function release_claim(uuid, uuid[], timestamptz)                                     from public, anon, authenticated;
