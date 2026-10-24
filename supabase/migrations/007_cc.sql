-- =====================================================================
-- 007_cc.sql : สำเนาถึง (CC)
-- วิธีใช้: คัดลอกทั้งไฟล์ไปวางใน Supabase > SQL Editor แล้วกด Run (รันซ้ำได้)
-- =====================================================================

-- CC ทุกฉบับของข้อความนี้ (เช่น หัวหน้า)
alter table campaigns  add column if not exists cc_emails text[] not null default '{}';
-- CC เฉพาะผู้รับคนนี้ (เช่น หัวหน้าของพนักงานคนนั้น)
alter table recipients add column if not exists cc_emails text[] not null default '{}';

-- Gmail นับโควตาตามจำนวนที่อยู่อีเมล (ถึง + CC) ไม่ใช่จำนวนฉบับ
alter table send_log add column if not exists address_count integer not null default 1;

create or replace function sent_last_24h() returns integer
language sql stable as $$
  select coalesce(sum(address_count), 0)::int from send_log
  where success and sent_at > now() - interval '24 hours';
$$;

-- บันทึกผลการส่ง (เพิ่ม p_address_count) — เหมือนเดิมทุกอย่าง
drop function if exists complete_send(uuid, uuid, text, boolean, text, text, timestamptz, boolean);
create or replace function complete_send(
  p_id            uuid,
  p_token         uuid,
  p_kind          text,
  p_success       boolean,
  p_message_id    text default null,
  p_error         text default null,
  p_retry_at      timestamptz default null,
  p_give_up       boolean default false,
  p_address_count integer default 1
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
                 when status in ('stopped', 'replied') then status
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
      status = case when status in ('stopped', 'replied') then status else 'failed' end,
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
    insert into send_log (recipient_id, campaign_id, kind, to_email, success, error, address_count)
    values (p_id, v_campaign, p_kind, v_email, p_success, p_error, greatest(1, p_address_count));
  end if;
end $$;

revoke execute on function complete_send(uuid, uuid, text, boolean, text, text, timestamptz, boolean, integer) from public, anon, authenticated;
revoke execute on function sent_last_24h() from public, anon, authenticated;

-- รายชื่อเดิมที่เคยส่ง (สำหรับ "เลือกจากรายชื่อเดิม") — คนเดียวกันเอาชื่อ/CC ล่าสุด
create or replace view past_contacts with (security_invoker = true) as
select distinct on (lower(r.email))
  lower(r.email) as email,
  r.name,
  r.cc_emails,
  r.created_at as last_used
from recipients r
order by lower(r.email), r.created_at desc;

revoke all on past_contacts from anon, authenticated;
