-- =====================================================================
-- 004_replies.sql : ตรวจการส่งงานกลับ (IMAP) + ส่งซ้ำ
-- วิธีใช้: คัดลอกทั้งไฟล์ไปวางใน Supabase > SQL Editor แล้วกด Run (รันซ้ำได้)
-- =====================================================================

-- ตำแหน่งล่าสุดที่อ่านกล่องจดหมายไปแล้ว (แยกต่อโฟลเดอร์) + สถานะการตรวจล่าสุด
alter table settings add column if not exists imap_state          jsonb not null default '{}'::jsonb;
alter table settings add column if not exists last_imap_check_at  timestamptz;
alter table settings add column if not exists last_imap_error     text;

-- ลิงก์เปิดอีเมลที่ผู้รับส่งงานกลับมา ใน Gmail
alter table recipients add column if not exists reply_url text;

-- บันทึกผลการส่ง: ถ้าระหว่างส่งตรวจพบว่าผู้รับส่งงานมาแล้ว ให้คงสถานะ "ตอบกลับแล้ว" ไว้
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
    insert into send_log (recipient_id, campaign_id, kind, to_email, success, error)
    values (p_id, v_campaign, p_kind, v_email, p_success, p_error);
  end if;
end $$;

revoke execute on function complete_send(uuid, uuid, text, boolean, text, text, timestamptz, boolean) from public, anon, authenticated;
