"use client";

import { useActionState, useState } from "react";
import { saveSettings } from "./actions";

export function SettingsForm(props: { senderEmail: string; senderName: string; dailyLimit: number }) {
  const [state, action, pending] = useActionState(saveSettings, null);
  const [senderName, setSenderName] = useState(props.senderName);
  const [dailyLimit, setDailyLimit] = useState(String(props.dailyLimit));

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

      {state?.error && <p className="alert-error">{state.error}</p>}
      {state?.message && <p className="alert-ok">{state.message}</p>}

      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "กำลังบันทึก..." : "บันทึก"}
      </button>
    </form>
  );
}
