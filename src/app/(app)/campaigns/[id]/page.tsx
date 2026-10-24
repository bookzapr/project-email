import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AttachmentList } from "@/components/attachment-bar";
import { DeleteButton, PauseButton, TestButton } from "@/components/campaign-buttons";
import { RecipientsPanel } from "@/components/recipients-panel";
import { DetailSkeleton } from "@/components/ui";
import { getCampaignDetail } from "@/lib/data";
import { describeFollowup, formatDateTime } from "@/lib/format";
import type { Campaign } from "@/lib/types";
import { addRecipients, deleteCampaign, recipientAction, sendTestEmail, setCampaignPaused } from "../actions";

export const metadata: Metadata = { title: "รายละเอียดข้อความ" };

type Props = PageProps<"/campaigns/[id]">;

export default function CampaignPage({ params, searchParams }: Props) {
  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-slate-500 hover:text-slate-800">
        ← ข้อความทั้งหมด
      </Link>
      <Suspense fallback={<DetailSkeleton />}>
        <Detail params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Detail({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const detail = await getCampaignDetail(id);
  if (!detail) notFound();
  const { campaign: c, recipients } = detail;

  return (
    <>
      {sp.created === "1" && (
        <p className="alert-ok">
          ✓ ตั้งส่งเรียบร้อยแล้ว ระบบจะส่งให้เองอัตโนมัติ และคอยตรวจว่าใครส่งงานกลับมา — ปิดหน้านี้ได้เลย
        </p>
      )}
      <Header c={c} />
      <RecipientsPanel
        recipients={recipients}
        onAction={recipientAction}
        onAdd={addRecipients.bind(null, c.id)}
      />
    </>
  );
}

function Header({ c }: { c: Campaign }) {
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h1 className="min-w-0 flex-1 text-xl font-semibold break-words">{c.subject}</h1>
        {c.paused && <span className="badge bg-zinc-200 text-zinc-700">หยุดชั่วคราว</span>}
      </div>
      <p className="text-sm text-slate-600">
        ส่ง {formatDateTime(c.send_at)} · {describeFollowup(c.followup_after_minutes)}
        {c.followup_after_minutes > 0 && (c.followup_body_html ? " (ข้อความใหม่)" : " (ข้อความเดิม)")}
      </p>
      <details className="rounded-lg border border-slate-200">
        <summary className="cursor-pointer px-3 py-2 text-sm text-slate-600">ดูเนื้อหาอีเมล</summary>
        <div className="email-content border-t border-slate-100 px-3 py-3" dangerouslySetInnerHTML={{ __html: c.body_html }} />
        {c.followup_body_html && (
          <>
            <div className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-500">ข้อความตอนส่งซ้ำ</div>
            <div className="email-content px-3 py-3" dangerouslySetInnerHTML={{ __html: c.followup_body_html }} />
          </>
        )}
      </details>
      <AttachmentList items={c.attachments} />
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/campaigns/${c.id}/edit`} className="btn">
          แก้ไข
        </Link>
        <PauseButton paused={c.paused} onToggle={setCampaignPaused.bind(null, c.id)} />
        <TestButton onTest={sendTestEmail.bind(null, c.id)} />
        <div className="ml-auto">
          <DeleteButton onDelete={deleteCampaign.bind(null, c.id)} />
        </div>
      </div>
    </div>
  );
}
