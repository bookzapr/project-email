"use client";

import { AttachmentList } from "@/components/attachment-bar";
import type { Attachment } from "@/lib/attachments";
import { fillHtml, fillText, isBlankHtml, withSignature } from "@/lib/template";

/** ผู้ส่งที่ผู้รับจะเห็น + ลายเซ็นท้ายอีเมล */
export type SenderInfo = { name: string; email: string; signature?: string };

/** ตัวอย่างอีเมลหน้าตาแบบที่ผู้รับเปิดดูใน Gmail ({ชื่อ} ถูกแทนด้วย sampleName แล้ว) */
export function EmailPreview({
  subject,
  html,
  sampleName,
  sender,
  label,
  attachments,
  cc,
}: {
  cc?: string[];
  subject: string;
  html: string;
  sampleName: string;
  sender: SenderInfo;
  label?: string;
  attachments?: Attachment[];
}) {
  const shownSubject = fillText(subject, sampleName).trim();
  const fromName = sender.name || sender.email;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {label && <div className="border-b border-slate-100 bg-slate-50 px-4 py-1.5 text-xs text-slate-500">{label}</div>}
      <div className="px-4 pt-4">
        <h3 className="text-xl leading-snug break-words text-slate-900">
          {shownSubject || <span className="text-slate-400">(ยังไม่มีหัวข้อ)</span>}
        </h3>
        <div className="mt-3 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-700 text-lg font-medium text-white">
            {fromName.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 text-sm">
            <div className="truncate">
              <b className="text-slate-900">{fromName}</b>
              {sender.name && <span className="text-slate-500"> &lt;{sender.email}&gt;</span>}
            </div>
            <div className="text-slate-500">
              ถึง {sampleName || "ผู้รับ"}
              {cc && cc.length > 0 && <span className="break-all"> · Cc {cc.join(", ")}</span>}
            </div>
          </div>
        </div>
      </div>
      <div className="email-content px-4 pt-4 pb-6 sm:pl-[4.25rem]">
        {/* แสดงลายเซ็นเสมอ แม้ยังไม่ได้พิมพ์เนื้อหา จะได้รู้ว่ามีลายเซ็นต่อท้าย */}
        {isBlankHtml(html) && <p className="text-slate-400">(ยังไม่มีเนื้อหา)</p>}
        <div
          dangerouslySetInnerHTML={{
            __html: fillHtml(withSignature(isBlankHtml(html) ? "" : html, sender.signature), sampleName),
          }}
        />
      </div>
      {attachments && attachments.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-3 sm:pl-[4.25rem]">
          <AttachmentList items={attachments} />
        </div>
      )}
    </div>
  );
}
