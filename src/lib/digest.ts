import "server-only";
import { audit } from "./audit";
import { db } from "./db";
import { formatDateTime } from "./format";
import { createTransport, gmailUser } from "./mailer";

// อีเมลสรุปประจำวันถึงเจ้าของระบบ: แยกตามข้อความ ใครส่งงานวันนี้ / ใครยังไม่ส่ง / ใครมีปัญหา
// ส่งวันละครั้งตามเวลาที่ตั้ง (settings.digest_hour) — วันไหนไม่มีอะไรค้างจะไม่ส่ง

const TZ = "Asia/Bangkok";
const MAX_NAMES = 100; // ต่อกลุ่ม ต่อข้อความ (กันอีเมลยาวเกินไป)

type Person = { name: string; email: string; note?: string };
type CampaignDigest = {
  id: string;
  subject: string;
  paused: boolean;
  total: number;
  replied: number;
  repliedToday: Person[];
  waiting: Person[];
  failed: Person[];
};

/** "2026-10-24" ตามเวลาไทย */
function bangkokDate(d = new Date()): string {
  return d.toLocaleDateString("sv-SE", { timeZone: TZ });
}
function bangkokHour(d = new Date()): number {
  return Number(d.toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }));
}

function siteUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return prod ? `https://${prod}` : "";
}

async function collect(): Promise<CampaignDigest[]> {
  // เที่ยงคืนเวลาไทย แปลงเป็น UTC ("+07:00" ใน URL อาจกลายเป็นช่องว่าง)
  const todayStart = new Date(`${bangkokDate()}T00:00:00+07:00`).toISOString();
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db()
      .from("recipients")
      .select("campaign_id,name,email,status,sent_at,replied_at,followup_sent_at,note,error")
      .or(`status.in.(sent,followed_up,failed),and(status.eq.replied,replied_at.gte.${todayStart})`)
      .order("created_at", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error("อ่านรายชื่อไม่ได้: " + error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const ids = [...new Set(rows.map((r) => r.campaign_id as string))];
  if (ids.length === 0) return [];

  const [{ data: camps, error: e1 }, { data: sums, error: e2 }] = await Promise.all([
    db().from("campaigns").select("id,subject,paused,send_at,followup_after_minutes").in("id", ids),
    db().from("campaign_summary").select("id,total,replied,stopped").in("id", ids),
  ]);
  if (e1 || e2) throw new Error("อ่านข้อความไม่ได้: " + (e1 ?? e2)!.message);
  const sumOf = new Map((sums ?? []).map((s) => [s.id as string, s]));

  return (camps ?? [])
    .sort((a, b) => String(b.send_at).localeCompare(String(a.send_at)))
    .map((c) => {
      const mine = rows.filter((r) => r.campaign_id === c.id);
      const s = sumOf.get(c.id);
      const followupMin = c.followup_after_minutes as number;
      return {
        id: c.id,
        subject: c.subject,
        paused: c.paused,
        total: ((s?.total as number) ?? 0) - ((s?.stopped as number) ?? 0),
        replied: (s?.replied as number) ?? 0,
        repliedToday: mine
          .filter((r) => r.status === "replied")
          .map((r) => ({ name: r.name as string, email: r.email as string, note: r.note ? "ทำเครื่องหมายเอง" : undefined })),
        waiting: mine
          .filter((r) => r.status === "sent" || r.status === "followed_up")
          .map((r) => ({
            name: r.name as string,
            email: r.email as string,
            note:
              r.status === "followed_up"
                ? `ทวงแล้ว ${formatDateTime(r.followup_sent_at as string)}`
                : followupMin > 0 && r.sent_at
                  ? `จะทวง ${formatDateTime(new Date(new Date(r.sent_at as string).getTime() + followupMin * 60_000).toISOString())}`
                  : undefined,
          })),
        failed: mine
          .filter((r) => r.status === "failed")
          .map((r) => ({ name: r.name as string, email: r.email as string, note: (r.error as string) ?? undefined })),
      };
    })
    .filter((c) => c.repliedToday.length + c.waiting.length + c.failed.length > 0);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function listHtml(title: string, color: string, people: Person[]): string {
  if (people.length === 0) return "";
  const shown = people.slice(0, MAX_NAMES);
  const more = people.length - shown.length;
  const items = shown
    .map(
      (p) =>
        `<li style="margin:2px 0">${esc(p.name)} <span style="color:#64748b">&lt;${esc(p.email)}&gt;</span>${
          p.note ? ` <span style="color:#94a3b8;font-size:12px">· ${esc(p.note)}</span>` : ""
        }</li>`,
    )
    .join("");
  return `<p style="margin:10px 0 2px;color:${color};font-weight:bold">${title} (${people.length})</p>
<ul style="margin:0;padding-left:20px">${items}${more > 0 ? `<li style="color:#64748b">และอีก ${more} คน — ดูทั้งหมดในเว็บ</li>` : ""}</ul>`;
}

function render(list: CampaignDigest[]) {
  const url = siteUrl();
  const today = new Date().toLocaleDateString("th-TH", { timeZone: TZ, dateStyle: "long" });
  const totals = list.reduce(
    (t, c) => ({ today: t.today + c.repliedToday.length, waiting: t.waiting + c.waiting.length, failed: t.failed + c.failed.length }),
    { today: 0, waiting: 0, failed: 0 },
  );

  const sections = list
    .map((c) => {
      const pct = c.total > 0 ? Math.round((c.replied / c.total) * 100) : 0;
      const link = url ? `<a href="${url}/campaigns/${c.id}" style="color:#0d9488">เปิดในเว็บ ↗</a>` : "";
      return `<div style="border:1px solid #d1fae5;border-radius:12px;padding:14px 16px;margin:14px 0;background:#fff">
<div style="font-size:16px;font-weight:bold;color:#134e4a">${esc(c.subject)}${c.paused ? ' <span style="color:#71717a;font-size:13px">(หยุดชั่วคราว)</span>' : ""}</div>
<div style="margin-top:4px;color:#475569">ส่งงานแล้ว <b style="color:#059669">${c.replied}</b> จาก ${c.total} คน (${pct}%) ${link}</div>
<div style="height:8px;background:#d1fae5;border-radius:4px;margin-top:6px;overflow:hidden"><div style="height:8px;width:${pct}%;background:#10b981"></div></div>
${listHtml("✅ ส่งงานวันนี้", "#059669", c.repliedToday)}
${listHtml("⏳ ยังไม่ส่ง", "#b45309", c.waiting)}
${listHtml("⚠️ มีปัญหา (ส่งไม่ถึง)", "#e11d48", c.failed)}
</div>`;
    })
    .join("");

  const subject = `📊 สรุปประจำวัน ${today} — ส่งงานวันนี้ ${totals.today} คน · ยังไม่ส่ง ${totals.waiting} คน`;
  const html = `<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px;color:#134e4a;background:#f0fdf4;padding:16px;max-width:680px">
<div style="font-size:18px;font-weight:bold">📊 สรุปประจำวัน ${esc(today)}</div>
<div style="margin-top:6px">วันนี้มีคนส่งงาน <b style="color:#059669">${totals.today}</b> คน · ยังไม่ส่ง <b style="color:#b45309">${totals.waiting}</b> คน${
    totals.failed ? ` · มีปัญหา <b style="color:#e11d48">${totals.failed}</b> คน` : ""
  }</div>
${sections}
<p style="color:#94a3b8;font-size:12px">ส่งจากระบบส่งอีเมลอัตโนมัติ · เปลี่ยนเวลาหรือปิดสรุปนี้ได้ที่หน้าตั้งค่า</p>
</div>`;
  const text = [
    `สรุปประจำวัน ${today}`,
    `ส่งงานวันนี้ ${totals.today} คน · ยังไม่ส่ง ${totals.waiting} คน · มีปัญหา ${totals.failed} คน`,
    ...list.map(
      (c) =>
        `\n■ ${c.subject} — ส่งงานแล้ว ${c.replied}/${c.total}\n` +
        [
          ["ส่งงานวันนี้", c.repliedToday],
          ["ยังไม่ส่ง", c.waiting],
          ["มีปัญหา", c.failed],
        ]
          .filter(([, p]) => (p as Person[]).length)
          .map(([t, p]) => `  ${t}: ${(p as Person[]).map((x) => x.name).join(", ")}`)
          .join("\n"),
    ),
  ].join("\n");
  return { subject, html, text };
}

/** สร้างและส่งสรุป — คืน null ถ้าไม่มีอะไรให้สรุป */
export async function sendDigest(): Promise<{ to: string; campaigns: number } | null> {
  const list = await collect();
  if (list.length === 0) return null;
  const { data: s } = await db().from("settings").select("*").eq("id", 1).single();
  const to = (s?.alert_email as string | undefined)?.trim() || gmailUser();
  const { subject, html, text } = render(list);
  const transport = createTransport();
  try {
    await transport.sendMail({ from: { name: "ระบบส่งอีเมลอัตโนมัติ (สรุปประจำวัน)", address: gmailUser() }, to, subject, html, text });
  } finally {
    transport.close();
  }
  return { to, campaigns: list.length };
}

/** เรียกจากตัวตั้งเวลาทุกนาที: ส่งเมื่อถึงเวลาที่ตั้ง วันละครั้ง */
export async function maybeSendDailyDigest(): Promise<string> {
  const { data: s } = await db().from("settings").select("*").eq("id", 1).single();
  const hour = s?.digest_hour as number | undefined;
  if (hour === undefined) return "ยังไม่ได้รัน SQL 009";
  if (hour < 0) return "ปิดอยู่";
  if (bangkokHour() < hour) return "ยังไม่ถึงเวลา";

  // จองว่า "วันนี้ส่งแล้ว" ก่อนส่งจริง (ทำทีละรอบ กันส่งซ้ำถ้ามีหลายรอบทำงานพร้อมกัน)
  const today = bangkokDate();
  const { data: claimed, error } = await db()
    .from("settings")
    .update({ digest_last_date: today })
    .eq("id", 1)
    .or(`digest_last_date.is.null,digest_last_date.lt.${today}`)
    .select("id");
  if (error) throw new Error("จองการส่งสรุปไม่ได้: " + error.message);
  if (!claimed?.length) return "วันนี้ส่งแล้ว";

  const sent = await sendDigest();
  if (!sent) return "ไม่มีอะไรค้าง ไม่ส่ง";
  await audit("digest_sent", { campaigns: sent.campaigns, auto: true }, { ip: "system", userAgent: "cron" });
  return `ส่งแล้ว (${sent.campaigns} ข้อความ)`;
}
