import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { CampaignWizard, type WizardInitial } from "@/components/campaign-wizard";
import { FormSkeleton } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { getCampaignDetail, getSettings } from "@/lib/data";
import { nextHourIso, toBangkokInput } from "@/lib/format";
import type { Settings } from "@/lib/types";
import { createCampaignWithRecipients, sendTestDraft } from "../actions";

export const metadata: Metadata = { title: "ส่งอีเมลใหม่" };

export default function NewCampaignPage({ searchParams }: PageProps<"/campaigns/new">) {
  return (
    <div className="space-y-4">
      <h1 className="page-title">ส่งอีเมลใหม่</h1>
      <Suspense fallback={<FormSkeleton />}>
        <NewForm searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function NewForm({ searchParams }: { searchParams: PageProps<"/campaigns/new">["searchParams"] }) {
  await requireAuth();
  await connection();
  const { from } = await searchParams;
  // ?from=<id> = ทำสำเนาจากข้อความเดิม (เนื้อหา ไฟล์แนบ Cc การส่งซ้ำ และรายชื่อผู้รับ)
  const [settings, source] = await Promise.all([
    getSettings(),
    typeof from === "string" ? getCampaignDetail(from) : Promise.resolve(null),
  ]);
  const c = source?.campaign;
  return (
    <>
      {c && (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800 ring-1 ring-sky-100">
          📋 ทำสำเนาจาก “{c.subject}” — แก้ไขได้ทุกอย่างก่อนส่ง ข้อความเดิมไม่เปลี่ยน
        </p>
      )}
      {renderWizard(settings, c ? {
        subject: c.subject,
        body_html: c.body_html,
        followup_body_html: c.followup_body_html,
        send_at_local: toBangkokInput(nextHourIso()),
        followup_minutes: c.followup_after_minutes,
        attachments: c.attachments ?? [],
        followup_attach: Boolean(c.followup_attach),
        cc_emails: c.cc_emails ?? [],
        recipients: source.recipients.map((r) => ({ name: r.name, email: r.email, cc: r.cc_emails ?? [] })),
      } : undefined)}
    </>
  );
}

function renderWizard(settings: Settings, initial?: WizardInitial) {
  return (
    <CampaignWizard
      mode="create"
      sender={{ name: settings.sender_name, email: process.env.GMAIL_USER ?? "", signature: settings.signature_html }}
      followupAttachAvailable={settings.signature_html !== undefined}
      cancelHref="/"
      onCreate={createCampaignWithRecipients}
      onTest={sendTestDraft}
      initial={
        initial ?? {
          subject: "",
          body_html: "",
          followup_body_html: null,
          send_at_local: toBangkokInput(nextHourIso()),
          followup_minutes: 60 * 24 * 3,
          attachments: [],
        }
      }
    />
  );
}
