import Link from "next/link";
import { Suspense } from "react";
import { ListSkeleton, QuotaLine } from "@/components/ui";
import { getCampaigns, getQuota } from "@/lib/data";
import { describeFollowup, formatDateTime, minutesSince } from "@/lib/format";
import type { Campaign, CampaignSummary } from "@/lib/types";

export default function HomePage() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">ข้อความทั้งหมด</h1>
        <Link href="/campaigns/new" className="btn-primary px-5 py-2.5 text-base">
          + ส่งอีเมลใหม่
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
      <div className="card py-12 text-center">
        <p className="text-lg font-medium">ยังไม่มีข้อความ</p>
        <p className="mt-1 text-slate-500">เริ่มส่งอีเมลฉบับแรกได้เลย</p>
        <Link href="/campaigns/new" className="btn-primary mt-4">
          + ส่งอีเมลใหม่
        </Link>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {campaigns.map((c) => (
        <li key={c.id}>
          <CampaignCard c={c} />
        </li>
      ))}
    </ul>
  );
}

function CampaignCard({ c }: { c: Campaign & { summary: CampaignSummary } }) {
  const s = c.summary;
  const counted = s.total - s.stopped;
  const pct = counted > 0 ? Math.round((s.replied / counted) * 100) : 0;
  const state = overallState(c);

  return (
    <Link href={`/campaigns/${c.id}`} className="card block transition hover:border-blue-300 hover:shadow">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="min-w-0 flex-1 text-lg font-medium break-words">{c.subject}</h2>
        <span className={`badge ${state.style}`}>{state.label}</span>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        {formatDateTime(c.send_at)} · {describeFollowup(c.followup_after_minutes)}
      </p>

      <div className="mt-3">
        <div className="flex items-baseline justify-between text-sm">
          <span>
            ส่งงานแล้ว <b>{s.replied}</b> จาก {counted} คน
          </span>
          {s.failed > 0 && <span className="text-red-700">มีปัญหา {s.failed} คน</span>}
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-green-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </Link>
  );
}

function overallState(c: Campaign & { summary: CampaignSummary }): { label: string; style: string } {
  const s = c.summary;
  if (c.paused) return { label: "หยุดชั่วคราว", style: "bg-zinc-200 text-zinc-700" };
  if (s.total === 0) return { label: "ยังไม่มีผู้รับ", style: "bg-slate-100 text-slate-600" };
  if (s.pending > 0) {
    return new Date(c.send_at) > new Date()
      ? { label: "รอถึงเวลาส่ง", style: "bg-slate-100 text-slate-700" }
      : { label: "กำลังส่ง", style: "bg-blue-100 text-blue-800" };
  }
  if (s.sent + s.followed_up === 0) return { label: "เสร็จสิ้น", style: "bg-green-100 text-green-800" };
  return { label: "รอส่งงานกลับ", style: "bg-amber-100 text-amber-800" };
}
