import type { Metadata } from "next";
import { Suspense } from "react";
import { FormSkeleton, ListSkeleton } from "@/components/ui";
import { AUDIT_LABEL, type AuditAction } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { getSettings } from "@/lib/data";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { SecurityPanel } from "./security-panel";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "ตั้งค่า" };

const MIN_PASSWORD = 14;

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="page-title">ตั้งค่า</h1>
      <Suspense fallback={<FormSkeleton />}>
        <Settings />
      </Suspense>
      <Suspense fallback={<ListSkeleton rows={1} />}>
        <AuditLog />
      </Suspense>
    </div>
  );
}

async function Settings() {
  const s = await getSettings();
  const senderEmail = process.env.GMAIL_USER || "(ยังไม่ได้ตั้ง GMAIL_USER)";
  const has008 = s.session_version !== undefined;
  const shortPassword = (process.env.ADMIN_PASSWORD ?? "").length < MIN_PASSWORD;

  return (
    <>
      <SettingsForm
        senderEmail={senderEmail}
        senderName={s.sender_name}
        dailyLimit={s.daily_limit}
        signatureHtml={s.signature_html ?? null}
        security={has008 ? { alertEmail: s.alert_email ?? "", retentionDays: s.retention_days ?? 0 } : null}
      />

      <section className="card space-y-4">
        <h2 className="text-lg font-bold text-teal-950">🔐 ความปลอดภัย</h2>
        {shortPassword && (
          <div className="alert-error">
            <b>⚠️ รหัสผ่านเข้าเว็บสั้นเกินไป</b> (น้อยกว่า {MIN_PASSWORD} ตัวอักษร) — เปลี่ยนที่ Vercel &gt; Settings &gt;
            Environment Variables &gt; <code>ADMIN_PASSWORD</code> แล้วกด Redeploy · แนะนำวลียาวๆ ที่จำง่าย เช่น
            “กาแฟเย็น-หวานน้อย-2569!”
          </div>
        )}
        <SecurityPanel enabled={Boolean(s.totp_enabled)} available={has008} />
      </section>
    </>
  );
}

/** บันทึกการใช้งาน 50 รายการล่าสุด */
async function AuditLog() {
  await requireAuth();
  const { data, error } = await db().from("audit_log").select("*").order("at", { ascending: false }).limit(50);
  if (error) return null; // ยังไม่ได้รัน SQL 008

  return (
    <section className="card">
      <h2 className="mb-3 text-lg font-bold text-teal-950">📜 บันทึกการใช้งานล่าสุด</h2>
      {data.length === 0 ? (
        <p className="text-sm text-slate-500">ยังไม่มีบันทึก</p>
      ) : (
        <ul className="divide-y divide-emerald-50 text-sm">
          {data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
              <span className="w-32 shrink-0 text-xs text-slate-500">{formatDateTime(r.at)}</span>
              <span className={`font-medium ${/failed|blocked|disabled/.test(r.action) ? "text-rose-700" : "text-teal-900"}`}>
                {AUDIT_LABEL[r.action as AuditAction] ?? r.action}
              </span>
              {r.detail?.subject && <span className="truncate text-slate-600">“{String(r.detail.subject)}”</span>}
              {r.detail?.count !== undefined && <span className="text-slate-600">{String(r.detail.count)} คน</span>}
              <span className="ml-auto text-xs text-slate-400" title={r.user_agent ?? ""}>
                IP {r.ip}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="hint mt-2">เก็บบันทึกไว้ 1 ปี</p>
    </section>
  );
}
