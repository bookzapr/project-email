"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { EmailPreview } from "@/components/email-preview";
import { RecipientPicker } from "@/components/recipient-picker";
import { RichTextEditor } from "@/components/rich-text-editor";
import { UNIT_LABEL, UNIT_MINUTES, splitMinutes, type DelayUnit } from "@/lib/format";
import type { ParsedRecipient } from "@/lib/parse-recipients";
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
};

export function CampaignWizard({
  mode,
  initial,
  cancelHref,
  onCreate,
  onUpdate,
  onTest,
  sender,
}: {
  mode: "create" | "edit";
  initial: WizardInitial;
  /** ผู้ส่งที่ผู้รับจะเห็น (ใช้ในตัวอย่างอีเมล) */
  sender: { name: string; email: string };
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
  const [sampleName, setSampleName] = useState("สมชาย ใจดี");
  const [mobileTab, setMobileTab] = useState<"write" | "preview">("write");
  const [followupBody, setFollowupBody] = useState(initial.followup_body_html ?? "");
  const [recipients, setRecipients] = useState<ParsedRecipient[]>([]);
  const [sendNow, setSendNow] = useState(mode === "create");
  const [sendAt, setSendAt] = useState(initial.send_at_local);

  const presetMatch = PRESETS.find((p) => p.minutes === initial.followup_minutes);
  const [followupChoice, setFollowupChoice] = useState<number | "custom">(presetMatch ? presetMatch.minutes : "custom");
  const initialCustom = splitMinutes(initial.followup_minutes || 60 * 24 * 2);
  const [customValue, setCustomValue] = useState(String(initialCustom.value));
  const [customUnit, setCustomUnit] = useState<DelayUnit>(initialCustom.unit);
  const [newFollowupText, setNewFollowupText] = useState(Boolean(initial.followup_body_html));

  const followupMinutes =
    followupChoice === "custom" ? Math.max(0, Math.floor(Number(customValue) || 0)) * UNIT_MINUTES[customUnit] : followupChoice;

  const draft = (): CampaignDraft => ({
    subject,
    body_html: bodyRef.current,
    followup_body_html: newFollowupText ? followupBody : "",
    send_now: sendNow,
    send_at_local: sendAt,
    followup_minutes: followupMinutes,
  });

  // ---- ไปขั้นถัดไป (ตรวจข้อมูลก่อน) ----
  const check = (s: Step): string | null => {
    if (s === "content") {
      if (!subject.trim()) return "กรุณาใส่หัวข้ออีเมล";
      if (isBlankHtml(bodyRef.current)) return "กรุณาเขียนเนื้อหาอีเมล";
    }
    if (s === "recipients" && recipients.length === 0) return "กรุณาเพิ่มผู้รับอย่างน้อย 1 คน";
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
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left ${
                s === step ? "bg-blue-600 text-white" : i < current ? "bg-blue-50 text-blue-800" : "bg-slate-100 text-slate-500"
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  s === step ? "bg-white text-blue-700" : i < current ? "bg-blue-600 text-white" : "bg-white text-slate-500"
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
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm lg:hidden">
            {(["write", "preview"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setBody(bodyRef.current);
                  setMobileTab(t);
                }}
                className={`flex-1 rounded-md px-3 py-1.5 ${mobileTab === t ? "bg-white font-medium shadow-sm" : "text-slate-600"}`}
              >
                {t === "write" ? "เขียน" : "ดูตัวอย่าง"}
              </button>
            ))}
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <div className={`card space-y-4 ${mobileTab === "write" ? "" : "hidden lg:block"}`}>
              <div>
                <label htmlFor="subject" className="label">
                  หัวข้ออีเมล
                </label>
                <input
                  id="subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={300}
                  className="input"
                  placeholder="เช่น ขอเอกสารประกอบการพิจารณา"
                  autoFocus
                />
              </div>
              <div>
                <span className="label">เนื้อหา</span>
                <RichTextEditor defaultValue={body} placeholder="เรียน คุณ{ชื่อ} ..." onChange={onBodyChange} />
                <p className="hint">กดปุ่ม “+ ใส่ชื่อผู้รับ” ตรงไหน ระบบจะเปลี่ยนเป็นชื่อของแต่ละคนให้เองตอนส่ง</p>
              </div>
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
              <EmailPreview subject={subject} html={body} sampleName={sampleName} sender={sender} />
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
  sender: { name: string; email: string };
  fallbackName: string;
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
