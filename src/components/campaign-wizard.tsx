"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { AttachmentBar } from "@/components/attachment-bar";
import { EmailPreview, type SenderInfo } from "@/components/email-preview";
import type { Attachment } from "@/lib/attachments";
import { RecipientPicker } from "@/components/recipient-picker";
import { RichTextEditor } from "@/components/rich-text-editor";
import { UNIT_LABEL, UNIT_MINUTES, splitMinutes, type DelayUnit } from "@/lib/format";
import { isValidEmail, recipientProblem, splitEmails, type ParsedRecipient } from "@/lib/parse-recipients";
import { isBlankHtml } from "@/lib/template";
import type { FormState } from "@/lib/types";
import type { CampaignDraft } from "@/app/(app)/campaigns/actions";

type Step = "content" | "recipients" | "schedule";
const STEP_LABEL: Record<Step, string> = { content: "เขียนอีเมล", recipients: "ผู้รับ", schedule: "ตั้งเวลาส่ง" };

const PRESETS = [
  { label: "ไม่ส่งซ้ำ", minutes: 0 },
  { label: "1 วัน", minutes: 60 * 24 },
  { label: "3 วัน", minutes: 60 * 24 * 3 },
  { label: "7 วัน", minutes: 60 * 24 * 7 },
];

export type WizardInitial = {
  subject: string;
  body_html: string;
  followup_body_html: string | null;
  send_at_local: string;
  followup_minutes: number;
  attachments: Attachment[];
  followup_attach?: boolean;
  cc_emails?: string[];
  /** รายชื่อตั้งต้น (ตอน "ทำสำเนา" จากข้อความเดิม) */
  recipients?: ParsedRecipient[];
};

export function CampaignWizard({
  mode,
  initial,
  cancelHref,
  onCreate,
  onUpdate,
  onTest,
  sender,
  followupAttachAvailable,
}: {
  mode: "create" | "edit";
  initial: WizardInitial;
  /** ตัวเลือกแนบไฟล์ในอีเมลส่งซ้ำ ใช้ได้หลังรัน SQL 006 */
  followupAttachAvailable: boolean;
  /** ผู้ส่งที่ผู้รับจะเห็น (ใช้ในตัวอย่างอีเมล) */
  sender: SenderInfo;
  cancelHref: string;
  onCreate?: (draft: CampaignDraft, recipients: ParsedRecipient[]) => Promise<FormState>;
  onUpdate?: (draft: CampaignDraft) => Promise<FormState>;
  onTest: (draft: CampaignDraft) => Promise<FormState>;
}) {
  const steps: Step[] = mode === "create" ? ["content", "recipients", "schedule"] : ["content", "schedule"];
  const [step, setStep] = useState<Step>("content");
  const [error, setError] = useState<string | null>(null);

  // ---- ข้อมูลในฟอร์ม ----
  // เนื้อหาอีเมลระหว่างพิมพ์เก็บใน ref ทันที ส่วนตัวอย่างอีเมลอัปเดตตามหลัง 0.2 วินาที (พิมพ์ลื่น ไม่หน่วง)
  const [subject, setSubject] = useState(initial.subject);
  const bodyRef = useRef(initial.body_html);
  const [body, setBody] = useState(initial.body_html);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onBodyChange = (html: string) => {
    bodyRef.current = html;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => setBody(html), 200);
  };
  const [attachments, setAttachments] = useState<Attachment[]>(initial.attachments);
  const [ccText, setCcText] = useState((initial.cc_emails ?? []).join(", "));
  const [sampleName, setSampleName] = useState("สมชาย ใจดี");
  const [mobileTab, setMobileTab] = useState<"write" | "preview">("write");
  const [followupBody, setFollowupBody] = useState(initial.followup_body_html ?? "");
  const [recipients, setRecipients] = useState<ParsedRecipient[]>(initial.recipients ?? []);
  const [sendNow, setSendNow] = useState(mode === "create");
  const [sendAt, setSendAt] = useState(initial.send_at_local);

  const presetMatch = PRESETS.find((p) => p.minutes === initial.followup_minutes);
  const [followupChoice, setFollowupChoice] = useState<number | "custom">(presetMatch ? presetMatch.minutes : "custom");
  const initialCustom = splitMinutes(initial.followup_minutes || 60 * 24 * 2);
  const [customValue, setCustomValue] = useState(String(initialCustom.value));
  const [customUnit, setCustomUnit] = useState<DelayUnit>(initialCustom.unit);
  const [newFollowupText, setNewFollowupText] = useState(Boolean(initial.followup_body_html));
  const [followupAttach, setFollowupAttach] = useState(Boolean(initial.followup_attach));

  const followupMinutes =
    followupChoice === "custom" ? Math.max(0, Math.floor(Number(customValue) || 0)) * UNIT_MINUTES[customUnit] : followupChoice;

  const draft = (): CampaignDraft => ({
    subject,
    body_html: bodyRef.current,
    followup_body_html: newFollowupText ? followupBody : "",
    send_now: sendNow,
    send_at_local: sendAt,
    followup_minutes: followupMinutes,
    attachments,
    followup_attach: followupAttach,
    cc_emails: splitEmails(ccText),
  });

  // ---- ไปขั้นถัดไป (ตรวจข้อมูลก่อน) ----
  const check = (s: Step): string | null => {
    if (s === "content") {
      if (!subject.trim()) return "กรุณาใส่หัวข้ออีเมล";
      if (isBlankHtml(bodyRef.current)) return "กรุณาเขียนเนื้อหาอีเมล";
    }
    if (s === "content") {
      const badCc = splitEmails(ccText).find((e) => !isValidEmail(e));
      if (badCc) return `อีเมล CC ไม่ถูกต้อง: ${badCc}`;
    }
    if (s === "recipients") {
      if (recipients.length === 0) return "กรุณาเพิ่มผู้รับอย่างน้อย 1 คน";
      const seen = new Set<string>();
      for (const [i, r] of recipients.entries()) {
        const problem = recipientProblem(r) ?? (seen.has(r.email.toLowerCase()) ? "อีเมลซ้ำ" : null);
        if (problem) return `แก้รายชื่อแถวที่ ${i + 1} ก่อน (${problem})`;
        seen.add(r.email.toLowerCase());
      }
    }
    return null;
  };
  const go = (target: Step) => {
    setBody(bodyRef.current);
    const idx = steps.indexOf(target);
    for (const s of steps.slice(0, idx)) {
      const problem = check(s);
      if (problem) {
        setStep(s);
        setError(problem);
        return;
      }
    }
    setError(null);
    setStep(target);
    window.scrollTo({ top: 0 });
  };
  const current = steps.indexOf(step);

  // ---- ยืนยัน / ทดสอบ ----
  const [saving, startSaving] = useTransition();
  const [testing, startTesting] = useTransition();
  const [testResult, setTestResult] = useState<FormState>(null);

  const submit = () =>
    startSaving(async () => {
      setError(null);
      const res = mode === "create" ? await onCreate!(draft(), recipients) : await onUpdate!(draft());
      if (res?.error) setError(res.error);
    });
  const test = () =>
    startTesting(async () => {
      setTestResult(null);
      setTestResult(await onTest(draft()));
    });

  return (
    <div className="space-y-5">
      {/* ---- แถบขั้นตอน ---- */}
      <ol className="flex items-center gap-2 text-sm">
        {steps.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => go(s)}
              className={`flex w-full items-center gap-2 rounded-2xl px-2.5 py-2.5 text-left transition ${
                s === step
                  ? "bg-linear-to-r from-teal-500 to-emerald-500 text-white shadow-lg shadow-teal-500/30"
                  : i < current
                    ? "bg-white text-teal-800 ring-1 ring-teal-200 hover:bg-teal-50"
                    : "bg-white/60 text-slate-500 ring-1 ring-emerald-100"
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  s === step
                    ? "bg-white text-teal-700"
                    : i < current
                      ? "bg-linear-to-br from-emerald-400 to-teal-500 text-white"
                      : "bg-emerald-100 text-emerald-400"
                }`}
              >
                {i < current ? "✓" : i + 1}
              </span>
              <span className="truncate font-medium">{STEP_LABEL[s]}</span>
            </button>
          </li>
        ))}
      </ol>

      {/* ---- ขั้นที่ 1: เขียนอีเมล ---- */}
      {step === "content" && (
        <>
          {/* มือถือ: สลับระหว่างเขียน / ดูตัวอย่าง */}
          <div className="flex gap-1 rounded-2xl bg-white/70 p-1 text-sm ring-1 ring-emerald-100 lg:hidden">
            {(["write", "preview"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setBody(bodyRef.current);
                  setMobileTab(t);
                }}
                className={`flex-1 rounded-xl px-3 py-1.5 transition ${
                  mobileTab === t ? "bg-linear-to-r from-teal-500 to-emerald-500 font-semibold text-white shadow" : "text-emerald-900/70"
                }`}
              >
                {t === "write" ? "✍️ เขียน" : "👀 ดูตัวอย่าง"}
              </button>
            ))}
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <div className={`card space-y-4 ${mobileTab === "write" ? "" : "hidden lg:block"}`}>
              {/* หัวอีเมลแบบ Gmail: ถึง / Cc / หัวข้อ */}
              <div className="divide-y divide-emerald-100 overflow-hidden rounded-xl ring-1 ring-emerald-200">
                <div className="flex items-center gap-3 bg-emerald-50/60 px-3 py-2 text-sm">
                  <span className="w-12 shrink-0 text-emerald-900/60">ถึง</span>
                  <span className="text-emerald-900/80">
                    {mode === "create"
                      ? recipients.length
                        ? `ผู้รับ ${recipients.length} คน (ส่งแยกทีละคน)`
                        : "ผู้รับแต่ละคน — เลือกในขั้นถัดไป"
                      : "ผู้รับของข้อความนี้ (แยกทีละคน)"}
                  </span>
                </div>
                <div className="flex items-center gap-3 bg-white px-3">
                  <label htmlFor="cc" className="w-12 shrink-0 text-sm text-emerald-900/60">
                    Cc
                  </label>
                  <input
                    id="cc"
                    value={ccText}
                    onChange={(e) => setCcText(e.target.value)}
                    className="w-full min-w-0 bg-transparent py-2 text-sm focus:outline-none"
                    placeholder="สำเนาถึงทุกฉบับ (ไม่บังคับ) เช่น boss@company.com"
                  />
                </div>
                <div className="flex items-center gap-3 bg-white px-3">
                  <label htmlFor="subject" className="w-12 shrink-0 text-sm font-semibold text-emerald-950">
                    หัวข้อ
                  </label>
                  <input
                    id="subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    maxLength={300}
                    className="w-full min-w-0 bg-transparent py-2.5 text-base focus:outline-none"
                    placeholder="เช่น ขอเอกสารประกอบการพิจารณา"
                    autoFocus
                  />
                </div>
              </div>
              {splitEmails(ccText).length > 0 && (
                <p className="hint -mt-2">
                  📌 ทุกคนใน Cc จะได้สำเนาทุกฉบับ (ส่ง {Math.max(recipients.length, 1)} คน = ได้ {Math.max(recipients.length, 1)}{" "}
                  ฉบับ) · Gmail นับโควตารวม Cc ด้วย
                </p>
              )}
              <div>
                <span className="label">เนื้อหา</span>
                <RichTextEditor defaultValue={body} placeholder="เรียน คุณ{ชื่อ} ..." onChange={onBodyChange} />
                <p className="hint">
                  กด “+ ใส่ชื่อผู้รับ” ตรงไหน ระบบจะเปลี่ยนเป็นชื่อของแต่ละคนให้เอง · รูปภาพ: กดปุ่มรูป หรือวาง/ลากรูปมาใส่ได้เลย
                </p>
              </div>
              <AttachmentBar value={attachments} onChange={setAttachments} />
            </div>

            <div className={`space-y-2 lg:sticky lg:top-16 ${mobileTab === "preview" ? "" : "hidden lg:block"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-700">ตัวอย่างที่ผู้รับจะเห็น</span>
                <label className="flex items-center gap-2 text-sm text-slate-500">
                  ชื่อผู้รับตัวอย่าง
                  <input
                    value={sampleName}
                    onChange={(e) => setSampleName(e.target.value)}
                    className="input w-36 py-1 text-sm"
                  />
                </label>
              </div>
              <EmailPreview
                subject={subject}
                html={body}
                sampleName={sampleName}
                sender={sender}
                attachments={attachments}
                cc={splitEmails(ccText)}
              />
            </div>
          </div>
        </>
      )}

      {/* ---- ขั้นที่ 2: ผู้รับ ---- */}
      {step === "recipients" && (
        <div className="card">
          <RecipientPicker value={recipients} onChange={setRecipients} />
        </div>
      )}

      {/* ---- ขั้นที่ 3: ตั้งเวลา ---- */}
      {step === "schedule" && (
        <>
          <div className="card space-y-3">
            <h2 className="font-semibold">จะส่งเมื่อไหร่?</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              <Choice active={sendNow} onClick={() => setSendNow(true)} title="ส่งทันที" desc="เริ่มส่งภายใน 1 นาที" />
              <Choice active={!sendNow} onClick={() => setSendNow(false)} title="ตั้งเวลาส่ง" desc="เลือกวันและเวลา" />
            </div>
            {!sendNow && (
              <input
                type="datetime-local"
                value={sendAt}
                onChange={(e) => setSendAt(e.target.value)}
                className="input sm:max-w-xs"
                aria-label="วันเวลาส่ง (เวลาประเทศไทย)"
              />
            )}
          </div>

          <div className="card space-y-3">
            <div>
              <h2 className="font-semibold">ส่งซ้ำถ้ายังไม่ส่งงานกลับมา</h2>
              <p className="text-sm text-slate-500">ระบบส่งซ้ำ 1 ครั้ง เฉพาะคนที่ยังไม่ส่งไฟล์งานกลับมา</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <Chip key={p.minutes} active={followupChoice === p.minutes} onClick={() => setFollowupChoice(p.minutes)}>
                  {p.minutes === 0 ? p.label : `หลัง ${p.label}`}
                </Chip>
              ))}
              <Chip active={followupChoice === "custom"} onClick={() => setFollowupChoice("custom")}>
                กำหนดเอง
              </Chip>
            </div>
            {followupChoice === "custom" && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600">หลัง</span>
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={customValue}
                  onChange={(e) => setCustomValue(e.target.value)}
                  className="input w-24"
                  aria-label="ระยะเวลา"
                />
                <select
                  value={customUnit}
                  onChange={(e) => setCustomUnit(e.target.value as DelayUnit)}
                  className="input w-auto"
                  aria-label="หน่วย"
                >
                  {(Object.keys(UNIT_LABEL) as DelayUnit[]).map((u) => (
                    <option key={u} value={u}>
                      {UNIT_LABEL[u]}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {followupMinutes > 0 && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <span className="label">ข้อความตอนส่งซ้ำ</span>
                <div className="flex flex-wrap gap-2">
                  <Chip active={!newFollowupText} onClick={() => setNewFollowupText(false)}>
                    ใช้ข้อความเดิม
                  </Chip>
                  <Chip active={newFollowupText} onClick={() => setNewFollowupText(true)}>
                    เขียนข้อความใหม่
                  </Chip>
                </div>
                {newFollowupText && (
                  <RichTextEditor
                    defaultValue={followupBody}
                    placeholder="เรียน คุณ{ชื่อ} ขอติดตามเอกสาร..."
                    onChange={setFollowupBody}
                    minHeight="8rem"
                  />
                )}
                {attachments.length > 0 && (
                  <label className="flex items-start gap-2 pt-1 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4"
                      checked={followupAttach}
                      disabled={!followupAttachAvailable}
                      onChange={(e) => setFollowupAttach(e.target.checked)}
                    />
                    <span>
                      แนบไฟล์ ({attachments.length} ไฟล์) ไปกับอีเมลส่งซ้ำด้วย
                      <span className="block text-xs text-slate-500">
                        {followupAttachAvailable
                          ? "ถ้าไม่เลือก ผู้รับยังเปิดไฟล์จากอีเมลแรกในเธรดเดียวกันได้"
                          : "ยังใช้ไม่ได้ — ต้องรัน SQL ไฟล์ 006 ใน Supabase ก่อน"}
                      </span>
                    </span>
                  </label>
                )}
              </div>
            )}
          </div>

          <Summary
            subject={subject}
            bodyHtml={body}
            followupHtml={newFollowupText && !isBlankHtml(followupBody) ? followupBody : null}
            recipients={recipients}
            mode={mode}
            sendNow={sendNow}
            sendAt={sendAt}
            followupMinutes={followupMinutes}
            sender={sender}
            fallbackName={sampleName}
            attachments={attachments}
          />

          <div className="card flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn" disabled={testing} onClick={test}>
                {testing ? "กำลังส่งทดสอบ..." : "ทดสอบส่งหาตัวเองก่อน"}
              </button>
              <span className="text-sm text-slate-500">ส่งตัวอย่างไปที่อีเมลของคุณ ดูหน้าตาก่อนส่งจริง</span>
            </div>
            {testResult?.error && <p className="alert-error">{testResult.error}</p>}
            {testResult?.message && <p className="alert-ok">{testResult.message}</p>}
          </div>
        </>
      )}

      {error && <p className="alert-error">{error}</p>}

      {/* ---- ปุ่มล่าง ---- */}
      <div className="flex items-center gap-2">
        {current > 0 ? (
          <button type="button" className="btn" onClick={() => go(steps[current - 1])}>
            ← ย้อนกลับ
          </button>
        ) : (
          <Link href={cancelHref} className="btn">
            ยกเลิก
          </Link>
        )}
        <div className="ml-auto">
          {current < steps.length - 1 ? (
            <button type="button" className="btn-primary px-6" onClick={() => go(steps[current + 1])}>
              ถัดไป →
            </button>
          ) : (
            <button type="button" className="btn-primary px-6" disabled={saving} onClick={submit}>
              {saving ? "กำลังบันทึก..." : mode === "create" ? "ยืนยัน ตั้งส่งอีเมล" : "บันทึกการแก้ไข"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Choice({ active, onClick, title, desc }: { active: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border-2 p-3 text-left ${
        active ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <div className="flex items-center gap-2 font-medium">
        <span className={`h-4 w-4 rounded-full border-2 ${active ? "border-blue-600 bg-blue-600" : "border-slate-300"}`} />
        {title}
      </div>
      <div className="mt-0.5 pl-6 text-sm text-slate-500">{desc}</div>
    </button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-1.5 text-sm ${
        active ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function Summary(props: {
  subject: string;
  bodyHtml: string;
  followupHtml: string | null;
  recipients: ParsedRecipient[];
  mode: "create" | "edit";
  sendNow: boolean;
  sendAt: string;
  followupMinutes: number;
  sender: SenderInfo;
  fallbackName: string;
  attachments: Attachment[];
}) {
  const [open, setOpen] = useState(false);
  const sample = props.recipients[0]?.name ?? props.fallbackName;
  const when = props.sendNow
    ? "ทันที (ภายใน 1 นาที)"
    : props.sendAt
      ? new Date(`${props.sendAt}:00+07:00`).toLocaleString("th-TH", {
          timeZone: "Asia/Bangkok",
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "-";
  const { value, unit } = splitMinutes(props.followupMinutes);

  return (
    <div className="card space-y-3 border-blue-200 bg-blue-50/40">
      <h2 className="font-semibold">สรุปก่อนยืนยัน</h2>
      <dl className="grid gap-1 text-sm sm:grid-cols-[8rem_1fr]">
        <dt className="text-slate-500">หัวข้อ</dt>
        <dd className="font-medium break-words">{props.subject}</dd>
        {props.mode === "create" && (
          <>
            <dt className="text-slate-500">ผู้รับ</dt>
            <dd>{props.recipients.length} คน (ส่งแยกทีละคน ผู้รับไม่เห็นกัน)</dd>
          </>
        )}
        <dt className="text-slate-500">ไฟล์แนบ</dt>
        <dd>{props.attachments.length ? props.attachments.map((a) => a.name).join(", ") : "ไม่มี"}</dd>
        <dt className="text-slate-500">ส่ง</dt>
        <dd>{when}</dd>
        <dt className="text-slate-500">ส่งซ้ำ</dt>
        <dd>{props.followupMinutes > 0 ? `หลัง ${value} ${UNIT_LABEL[unit]} ถ้ายังไม่ส่งงานกลับมา` : "ไม่ส่งซ้ำ"}</dd>
      </dl>
      <button type="button" className="text-sm text-blue-700 underline" onClick={() => setOpen((v) => !v)}>
        {open ? "ซ่อนตัวอย่างอีเมล" : `ดูตัวอย่างอีเมลที่ “${sample}” จะได้รับ`}
      </button>
      {open && (
        <div className="space-y-3">
          <EmailPreview
            label="อีเมลแรก"
            subject={props.subject}
            html={props.bodyHtml}
            sampleName={sample}
            sender={props.sender}
            attachments={props.attachments}
          />
          {props.followupMinutes > 0 && (
            <EmailPreview
              label="อีเมลส่งซ้ำ (ต่อในเธรดเดิม)"
              subject={`Re: ${props.subject}`}
              html={props.followupHtml ?? props.bodyHtml}
              sampleName={sample}
              sender={props.sender}
            />
          )}
        </div>
      )}
    </div>
  );
}
