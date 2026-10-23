import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CampaignWizard } from "@/components/campaign-wizard";
import { FormSkeleton } from "@/components/ui";
import { getCampaign } from "@/lib/data";
import { toBangkokInput } from "@/lib/format";
import { sendTestDraft, updateCampaign } from "../../actions";

export const metadata: Metadata = { title: "แก้ไขข้อความ" };

export default function EditCampaignPage({ params }: PageProps<"/campaigns/[id]/edit">) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">แก้ไขข้อความ</h1>
      <Suspense fallback={<FormSkeleton />}>
        <EditForm params={params} />
      </Suspense>
    </div>
  );
}

async function EditForm({ params }: { params: PageProps<"/campaigns/[id]/edit">["params"] }) {
  const { id } = await params;
  const c = await getCampaign(id);
  if (!c) notFound();

  return (
    <>
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
        การแก้ไขมีผลกับอีเมลที่ยังไม่ได้ส่งเท่านั้น อีเมลที่ส่งไปแล้วจะไม่เปลี่ยน
      </p>
      <CampaignWizard
        mode="edit"
        cancelHref={`/campaigns/${c.id}`}
        onUpdate={updateCampaign.bind(null, c.id)}
        onTest={sendTestDraft}
        initial={{
          subject: c.subject,
          body_html: c.body_html,
          followup_body_html: c.followup_body_html,
          send_at_local: toBangkokInput(c.send_at),
          followup_minutes: c.followup_after_minutes,
        }}
      />
    </>
  );
}
