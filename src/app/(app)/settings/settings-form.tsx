"use client";

import { useActionState, useState } from "react";
import { RichTextEditor } from "@/components/rich-text-editor";
import { saveSettings } from "./actions";

export function SettingsForm(props: {
  senderEmail: string;
  senderName: string;
  dailyLimit: number;
  /** null = ยังไม่ได้รัน SQL 006 (ยังตั้งลายเซ็นไม่ได้) */
  signatureHtml: string | null;
}) {
  const [state, action, pending] = useActionState(saveSettings, null);
  const [senderName, setSenderName] = useState(props.senderName);
  const [dailyLimit, setDailyLimit] = useState(String(props.dailyLimit));
  const [signature, setSignature] = useState(props.signatureHtml ?? "");

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

      {state?.error && <p className="alert-error">{state.error}</p>}
      {state?.message && <p className="alert-ok">{state.message}</p>}

      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "กำลังบันทึก..." : "บันทึก"}
      </button>
    </form>
  );
}
