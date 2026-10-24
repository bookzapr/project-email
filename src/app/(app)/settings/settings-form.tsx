"use client";

import { useActionState, useState, useTransition } from "react";
import type { FormState } from "@/lib/types";
import { RichTextEditor } from "@/components/rich-text-editor";
import { saveSettings, sendDigestNow } from "./actions";

export function SettingsForm(props: {
  senderEmail: string;
  senderName: string;
  dailyLimit: number;
  /** null = ยังไม่ได้รัน SQL 006 (ยังตั้งลายเซ็นไม่ได้) */
  signatureHtml: string | null;
  /** null = ยังไม่ได้รัน SQL 008 */
  security: { alertEmail: string; retentionDays: number } | null;
  /** null = ยังไม่ได้รัน SQL 009 */
  digestHour: number | null;
}) {
  const [state, action, pending] = useActionState(saveSettings, null);
  const [senderName, setSenderName] = useState(props.senderName);
  const [dailyLimit, setDailyLimit] = useState(String(props.dailyLimit));
  const [signature, setSignature] = useState(props.signatureHtml ?? "");
  const [alertEmail, setAlertEmail] = useState(props.security?.alertEmail ?? "");
  const [retention, setRetention] = useState(String(props.security?.retentionDays ?? 0));
  const [digestHour, setDigestHour] = useState(String(props.digestHour ?? 17));
  const [digestState, setDigestState] = useState<FormState>(null);
  const [digestPending, startDigest] = useTransition();

  return (
    <form action={action} className="card space-y-4">
      <div>
        <span className="label">อีเมลผู้ส่ง</span>
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-slate-700">{props.senderEmail}</p>
        <p className="hint">เปลี่ยนได้ที่ Environment Variable ชื่อ GMAIL_USER</p>
      </div>

      <div>
        <label htmlFor="sender_name" className="label">
          ชื่อผู้ส่งที่ผู้รับจะเห็น
        </label>
        <input
          id="sender_name"
          name="sender_name"
          maxLength={100}
          value={senderName}
          onChange={(e) => setSenderName(e.target.value)}
          className="input"
          placeholder="เช่น ธนกร พ. / ฝ่ายบุคคล บริษัท ..."
        />
        <p className="hint">เว้นว่าง = แสดงเป็นอีเมลอย่างเดียว</p>
      </div>

      <div>
        <label htmlFor="daily_limit" className="label">
          ขีดจำกัดการส่งต่อ 24 ชั่วโมง (ฉบับ)
        </label>
        <input
          id="daily_limit"
          name="daily_limit"
          type="number"
          min={1}
          max={10000}
          required
          value={dailyLimit}
          onChange={(e) => setDailyLimit(e.target.value)}
          className="input w-40"
        />
        <p className="hint">
          Gmail ธรรมดา ~500 (แนะนำ 400) · Google Workspace ~2,000 (แนะนำ 1,500) · นับรวมอีเมลส่งซ้ำและอีเมลทดสอบ
        </p>
      </div>

      <div>
        <span className="label">ลายเซ็นท้ายอีเมล</span>
        {props.signatureHtml === null ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            ยังใช้ไม่ได้ — ต้องรัน SQL ไฟล์ <code>supabase/migrations/006_signature.sql</code> ใน Supabase ก่อน
          </p>
        ) : (
          <>
            <RichTextEditor
              defaultValue={props.signatureHtml}
              placeholder="เช่น ชื่อ-นามสกุล · ตำแหน่ง · บริษัท · เบอร์โทร"
              onChange={setSignature}
              minHeight="7rem"
            />
            <input type="hidden" name="signature_html" value={signature} />
            <p className="hint">ต่อท้ายทุกอีเมลอัตโนมัติ (ทั้งอีเมลแรกและอีเมลส่งซ้ำ) · ใส่รูปโลโก้ได้ · เว้นว่าง = ไม่มีลายเซ็น</p>
          </>
        )}
      </div>

      {props.security && (
        <div className="grid gap-4 border-t border-emerald-100 pt-4 sm:grid-cols-2">
          <div>
            <label htmlFor="alert_email" className="label">
              🔔 อีเมลรับแจ้งเตือนความปลอดภัย
            </label>
            <input
              id="alert_email"
              name="alert_email"
              type="email"
              value={alertEmail}
              onChange={(e) => setAlertEmail(e.target.value)}
              className="input"
              placeholder={`ว่าง = ${props.senderEmail}`}
            />
            <p className="hint">แจ้งทุกครั้งที่มีการล็อกอิน และเมื่อมีคนพยายามเดารหัสผ่าน</p>
          </div>
          <div>
            <label htmlFor="retention_days" className="label">
              🧹 ลบข้อมูลเก่าอัตโนมัติ (PDPA)
            </label>
            <select
              id="retention_days"
              name="retention_days"
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
              className="input"
            >
              <option value="0">ไม่ลบ (เก็บไว้ตลอด)</option>
              <option value="30">ลบข้อความที่ส่งเกิน 30 วัน</option>
              <option value="90">ลบข้อความที่ส่งเกิน 90 วัน</option>
              <option value="180">ลบข้อความที่ส่งเกิน 180 วัน</option>
              <option value="365">ลบข้อความที่ส่งเกิน 1 ปี</option>
            </select>
            <p className="hint">ลบทั้งข้อความ รายชื่อผู้รับ และไฟล์แนบ วันละครั้ง — ลบแล้วกู้คืนไม่ได้</p>
          </div>
        </div>
      )}

      <div className="border-t border-emerald-100 pt-4">
        <label htmlFor="digest_hour" className="label">
          📊 อีเมลสรุปประจำวัน (ใครส่งงานแล้ว / ใครยังไม่ส่ง)
        </label>
        {props.digestHour === null ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            ยังใช้ไม่ได้ — ต้องรัน SQL ไฟล์ <code>supabase/migrations/009_digest.sql</code> ใน Supabase ก่อน
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <select
                id="digest_hour"
                name="digest_hour"
                value={digestHour}
                onChange={(e) => setDigestHour(e.target.value)}
                className="input w-auto"
              >
                <option value="-1">ปิด (ไม่ส่งสรุป)</option>
                {Array.from({ length: 15 }, (_, i) => i + 7).map((h) => (
                  <option key={h} value={h}>
                    ส่งทุกวัน {String(h).padStart(2, "0")}:00 น.
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn"
                disabled={digestPending}
                onClick={() =>
                  startDigest(async () => {
                    setDigestState(null);
                    setDigestState(await sendDigestNow());
                  })
                }
              >
                {digestPending ? "กำลังส่ง..." : "📨 ส่งสรุปตัวอย่างตอนนี้"}
              </button>
            </div>
            <p className="hint">
              ส่งไปที่อีเมลรับแจ้งเตือนด้านบน (ว่าง = {props.senderEmail}) · แยกตามข้อความ: ใครส่งงานวันนี้ ใครยังไม่ส่ง
              ใครมีปัญหา · วันไหนไม่มีอะไรค้างจะไม่ส่ง
            </p>
            {digestState?.error && <p className="alert-error mt-2">{digestState.error}</p>}
            {digestState?.message && <p className="alert-ok mt-2">{digestState.message}</p>}
          </>
        )}
      </div>

      {state?.error && <p className="alert-error">{state.error}</p>}
      {state?.message && <p className="alert-ok">{state.message}</p>}

      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "กำลังบันทึก..." : "บันทึก"}
      </button>
    </form>
  );
}
