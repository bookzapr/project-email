import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { CampaignWizard } from "@/components/campaign-wizard";
import { FormSkeleton } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { nextHourIso, toBangkokInput } from "@/lib/format";
import { createCampaignWithRecipients, sendTestDraft } from "../actions";

export const metadata: Metadata = { title: "ส่งอีเมลใหม่" };

export default function NewCampaignPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">ส่งอีเมลใหม่</h1>
      <Suspense fallback={<FormSkeleton />}>
        <NewForm />
      </Suspense>
    </div>
  );
}

async function NewForm() {
  await requireAuth();
  await connection();
  return (
    <CampaignWizard
      mode="create"
      cancelHref="/"
      onCreate={createCampaignWithRecipients}
      onTest={sendTestDraft}
      initial={{
        subject: "",
        body_html: "",
        followup_body_html: null,
        send_at_local: toBangkokInput(nextHourIso()),
        followup_minutes: 60 * 24 * 3,
      }}
    />
  );
}
