import "server-only";
import { requireAuth } from "./auth";
import { db } from "./db";
import type { Campaign, CampaignSummary, Recipient, Settings } from "./types";

// ทุกฟังก์ชันอ่านข้อมูลเรียก requireAuth() ก่อนเสมอ (Data Access Layer)

export async function getCampaigns(): Promise<(Campaign & { summary: CampaignSummary })[]> {
  await requireAuth();
  const [{ data: campaigns, error }, { data: summaries, error: e2 }] = await Promise.all([
    db().from("campaigns").select("*").order("send_at", { ascending: false }),
    db().from("campaign_summary").select("*"),
  ]);
  if (error || e2) throw new Error("อ่านรายการข้อความไม่ได้: " + (error ?? e2)!.message);
  const byId = new Map((summaries as CampaignSummary[]).map((s) => [s.id, s]));
  return (campaigns as Campaign[]).map((c) => ({
    ...c,
    summary: byId.get(c.id) ?? {
      id: c.id, total: 0, pending: 0, sent: 0, replied: 0, followed_up: 0, failed: 0, stopped: 0,
    },
  }));
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  await requireAuth();
  if (!isUuid(id)) return null;
  const { data, error } = await db().from("campaigns").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("อ่านข้อความไม่ได้: " + error.message);
  return data as Campaign | null;
}

/** ข้อความ + ผู้รับทั้งหมด ดึงพร้อมกันในรอบเดียว */
export async function getCampaignDetail(id: string): Promise<{ campaign: Campaign; recipients: Recipient[] } | null> {
  await requireAuth();
  if (!isUuid(id)) return null;
  const [{ data: campaign, error }, { data: recipients, error: e2 }] = await Promise.all([
    db().from("campaigns").select("*").eq("id", id).maybeSingle(),
    db()
      .from("recipients")
      .select("id,campaign_id,name,email,status,sent_at,followup_sent_at,replied_at,reply_files,reply_url,note,error,created_at")
      .eq("campaign_id", id)
      .order("created_at", { ascending: true }),
  ]);
  if (error || e2) throw new Error("อ่านข้อความไม่ได้: " + (error ?? e2)!.message);
  if (!campaign) return null;
  return { campaign: campaign as Campaign, recipients: recipients as Recipient[] };
}

export async function getSettings(): Promise<Settings> {
  await requireAuth();
  // select("*") เพื่อให้ทำงานได้ทั้งก่อน/หลังรัน SQL 006 (คอลัมน์ signature_html)
  const { data, error } = await db().from("settings").select("*").eq("id", 1).single();
  if (error) throw new Error("อ่านการตั้งค่าไม่ได้: " + error.message);
  return data as Settings;
}

/** จำนวนอีเมลที่ส่งสำเร็จใน 24 ชั่วโมงล่าสุด เทียบกับขีดจำกัด + สถานะตัวส่งล่าสุด */
export async function getQuota(): Promise<{ used: number; limit: number; settings: Settings }> {
  await requireAuth();
  const [{ data: used, error }, settings] = await Promise.all([db().rpc("sent_last_24h"), getSettings()]);
  if (error) throw new Error("อ่านโควตาไม่ได้: " + error.message);
  return { used: used as number, limit: settings.daily_limit, settings };
}

export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
