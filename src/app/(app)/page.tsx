import Link from "next/link";
import { Suspense } from "react";
import { ListSkeleton, QuotaLine } from "@/components/ui";
import { getCampaigns, getQuota } from "@/lib/data";
import { describeFollowup, formatDateTime, minutesSince } from "@/lib/format";
import type { Campaign, CampaignSummary } from "@/lib/types";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">ข้อความทั้งหมด</h1>
          <p className="mt-1 text-sm text-indigo-900/60">ระบบส่งเอง ตรวจเองว่าใครส่งงานกลับ และทวงซ้ำให้อัตโนมัติ</p>
        </div>
        <Link href="/campaigns/new" className="btn-primary px-5 py-2.5 text-base">
          ✉️ ส่งอีเมลใหม่
        </Link>
      </div>
      <Suspense fallback={null}>
        <SystemStatus />
      </Suspense>
      <Suspense fallback={<ListSkeleton />}>
        <CampaignList />
      </Suspense>
    </div>
  );
}

/** แถบเตือนจะขึ้นเฉพาะตอนมีปัญหา + เส้นโควตา */
async function SystemStatus() {
  const { used, limit, settings } = await getQuota();
  // ปกติตัวตั้งเวลาเรียกทุก 1–2 นาที ถ้าเงียบเกิน 15 นาที = ระบบส่งอัตโนมัติหยุดทำงาน
  const idle = minutesSince(settings.last_run_at);
  const cronDown = idle === null || idle > 15;

  return (
    <div className="space-y-2">
      {settings.last_send_error && (
        <p className="alert-error">
          <b>⚠️ ส่งอีเมลไม่ได้:</b> {settings.last_send_error}
        </p>
      )}
      {settings.last_imap_error && (
        <p className="alert-error">
          <b>⚠️ ตรวจการส่งงานกลับไม่ได้:</b> {settings.last_imap_error} — ระหว่างนี้จะยังไม่ส่งอีเมลส่งซ้ำ
        </p>
      )}
      {cronDown && (
        <p className="alert-error">
          <b>⚠️ ระบบส่งอัตโนมัติไม่ได้ทำงาน</b>
          {idle === null ? "" : ` มา ${idle.toLocaleString("th-TH")} นาทีแล้ว`} — อีเมลจะยังไม่ถูกส่งจนกว่าตัวตั้งเวลาจะกลับมาทำงาน
        </p>
      )}
      {used >= limit && (
        <p className="alert-error">ส่งครบขีดจำกัดต่อวันแล้ว อีเมลที่เหลือจะส่งต่อเองเมื่อโควตาว่าง</p>
      )}
      <QuotaLine used={used} limit={limit} />
    </div>
  );
}

async function CampaignList() {
  const campaigns = await getCampaigns();

  if (campaigns.length === 0) {
    return (
      <div className="card fade-up py-14 text-center">
        <div className="text-6xl">📮</div>
        <p className="mt-3 text-xl font-semibold text-indigo-950">ยังไม่มีข้อความ</p>
        <p className="mt-1 text-slate-500">เริ่มส่งอีเมลฉบับแรกได้เลย ใช้เวลาไม่ถึง 2 นาที</p>
        <Link href="/campaigns/new" className="btn-primary mt-5 px-6 py-2.5 text-base">
          ✉️ ส่งอีเมลใหม่
        </Link>
      </div>
    );
  }

  const totals = campaigns.reduce(
    (t, c) => ({
      waiting: t.waiting + c.summary.sent + c.summary.followed_up,
      replied: t.replied + c.summary.replied,
      problem: t.problem + c.summary.failed,
    }),
    { waiting: 0, replied: 0, problem: 0 },
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile icon="📨" label="ข้อความ" value={campaigns.length} tone="from-indigo-500 to-violet-500" />
        <StatTile icon="⏳" label="รอส่งงาน" value={totals.waiting} tone="from-amber-400 to-orange-500" />
        <StatTile icon="✅" label="ส่งงานแล้ว" value={totals.replied} tone="from-emerald-400 to-teal-500" />
        <StatTile icon="⚠️" label="มีปัญหา" value={totals.problem} tone="from-rose-400 to-pink-500" />
      </div>

      <ul className="space-y-3">
        {campaigns.map((c, i) => (
          <li key={c.id} className="fade-up" style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}>
            <CampaignCard c={c} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatTile({ icon, label, value, tone }: { icon: string; label: string; value: number; tone: string }) {
  return (
    <div className={`fade-up relative overflow-hidden rounded-2xl bg-linear-to-br ${tone} p-4 text-white shadow-lg`}>
      <div className="absolute -top-3 -right-2 text-6xl opacity-20">{icon}</div>
      <div className="text-3xl font-bold">{value.toLocaleString("th-TH")}</div>
      <div className="text-sm font-medium text-white/90">{label}</div>
    </div>
  );
}

function CampaignCard({ c }: { c: Campaign & { summary: CampaignSummary } }) {
  const s = c.summary;
  const counted = s.total - s.stopped;
  const pct = counted > 0 ? Math.round((s.replied / counted) * 100) : 0;
  const state = overallState(c);

  return (
    <Link href={`/campaigns/${c.id}`} className={`card card-hover block border-l-4 ${state.accent}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="min-w-0 flex-1 text-lg font-semibold break-words text-indigo-950">{c.subject}</h2>
        <span className={`badge ${state.style}`}>{state.label}</span>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        🗓 {formatDateTime(c.send_at)} · 🔁 {describeFollowup(c.followup_after_minutes)}
        {(c.attachments?.length ?? 0) > 0 && ` · 📎 ${c.attachments.length} ไฟล์`}
        {(c.cc_emails?.length ?? 0) > 0 && ` · Cc ${c.cc_emails!.length}`}
      </p>

      <div className="mt-3">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-indigo-950">
            ส่งงานแล้ว <b className="text-emerald-600">{s.replied}</b> จาก {counted} คน
          </span>
          <span className="flex gap-3">
            {s.failed > 0 && <span className="text-rose-600">⚠️ {s.failed}</span>}
            <b className="text-violet-700">{pct}%</b>
          </span>
        </div>
        <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-indigo-100">
          <div className="progress-shine h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </Link>
  );
}

function overallState(c: Campaign & { summary: CampaignSummary }): { label: string; style: string; accent: string } {
  const s = c.summary;
  if (c.paused) return { label: "⏸ หยุดชั่วคราว", style: "bg-zinc-200 text-zinc-700", accent: "border-l-zinc-400" };
  if (s.total === 0) return { label: "ยังไม่มีผู้รับ", style: "bg-slate-100 text-slate-600", accent: "border-l-slate-300" };
  if (s.pending > 0) {
    return new Date(c.send_at) > new Date()
      ? { label: "🕒 รอถึงเวลาส่ง", style: "bg-sky-100 text-sky-800", accent: "border-l-sky-400" }
      : { label: "🚀 กำลังส่ง", style: "bg-indigo-100 text-indigo-800", accent: "border-l-indigo-500" };
  }
  if (s.sent + s.followed_up === 0) {
    return { label: "🎉 เสร็จสิ้น", style: "bg-emerald-100 text-emerald-800", accent: "border-l-emerald-500" };
  }
  return { label: "⏳ รอส่งงานกลับ", style: "bg-amber-100 text-amber-800", accent: "border-l-amber-400" };
}
