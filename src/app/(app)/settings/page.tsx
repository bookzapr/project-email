import type { Metadata } from "next";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/ui";
import { getSettings } from "@/lib/data";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "ตั้งค่า" };

export default function SettingsPage() {
  return (
    <div className="space-y-5">
      <h1 className="page-title">ตั้งค่า</h1>
      <Suspense fallback={<FormSkeleton />}>
        <Settings />
      </Suspense>
    </div>
  );
}

async function Settings() {
  const s = await getSettings();
  const senderEmail = process.env.GMAIL_USER || "(ยังไม่ได้ตั้ง GMAIL_USER)";
  return (
    <SettingsForm
      senderEmail={senderEmail}
      senderName={s.sender_name}
      dailyLimit={s.daily_limit}
      signatureHtml={s.signature_html ?? null}
    />
  );
}
