"use client";

import { useRef, useState } from "react";
import { type Attachment, checkAttachment, formatSize, MAX_ATTACH_TOTAL } from "@/lib/attachments";
import { uploadFile } from "@/lib/upload-client";

type Uploading = { id: string; name: string };

/** ปุ่มแนบไฟล์ + รายการไฟล์ที่แนบ (แบบ Gmail) */
export function AttachmentBar({ value, onChange }: { value: Attachment[]; onChange: (next: Attachment[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<Uploading[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  // อัปโหลดทีละไฟล์ (ระหว่างนี้ปิดปุ่มแนบไฟล์ไว้ รายการจึงไม่ชนกัน)
  const addFiles = async (files: File[]) => {
    setErrors([]);
    const problems: string[] = [];
    let current = value;
    for (const file of files) {
      const problem = checkAttachment(file.name, file.size, current);
      if (problem) {
        problems.push(problem);
        continue;
      }
      const id = crypto.randomUUID();
      setUploading((u) => [...u, { id, name: file.name }]);
      const res = await uploadFile("attachment", file, current);
      setUploading((u) => u.filter((x) => x.id !== id));
      if ("error" in res) {
        problems.push(res.error);
        continue;
      }
      current = [...current, { name: file.name, path: res.path, size: file.size, type: file.type || "application/octet-stream" }];
      onChange(current);
    }
    setErrors(problems);
  };

  const total = value.reduce((s, a) => s + a.size, 0);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" disabled={uploading.length > 0} onClick={() => input.current?.click()}>
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden>
            <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z" />
          </svg>
          แนบไฟล์
        </button>
        <span className="text-xs text-slate-500">
          {value.length > 0 ? `รวม ${formatSize(total)} / ${formatSize(MAX_ATTACH_TOTAL)}` : `รวมไม่เกิน ${formatSize(MAX_ATTACH_TOTAL)}`}
        </span>
        <input
          ref={input}
          type="file"
          multiple
          className="hidden"
          aria-label="เลือกไฟล์แนบ"
          onChange={(e) => {
            void addFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>

      {(value.length > 0 || uploading.length > 0) && (
        <ul className="flex flex-wrap gap-2">
          {value.map((a) => (
            <li
              key={a.path}
              className="flex max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-1 pl-3 text-sm"
            >
              <span className="truncate font-medium text-blue-800">{a.name}</span>
              <span className="shrink-0 text-xs text-slate-500">{formatSize(a.size)}</span>
              <button
                type="button"
                aria-label={`เอาไฟล์ ${a.name} ออก`}
                className="rounded px-1.5 text-lg leading-none text-slate-400 hover:bg-red-50 hover:text-red-600"
                onClick={() => onChange(value.filter((x) => x.path !== a.path))}
              >
                ×
              </button>
            </li>
          ))}
          {uploading.map((u) => (
            <li key={u.id} className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-500">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
              {u.name}
            </li>
          ))}
        </ul>
      )}
      {errors.map((e) => (
        <p key={e} className="alert-error">
          {e}
        </p>
      ))}
    </div>
  );
}

/** แสดงรายการไฟล์แนบแบบอ่านอย่างเดียว (ตัวอย่างอีเมล / หน้ารายละเอียด) */
export function AttachmentList({ items }: { items: Attachment[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="mb-1.5 text-xs text-slate-500">ไฟล์แนบ {items.length} ไฟล์</div>
      <ul className="flex flex-wrap gap-2">
        {items.map((a) => (
          <li key={a.path} className="flex max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <span className="rounded bg-red-500 px-1 text-[10px] font-bold text-white uppercase">{a.name.split(".").pop()}</span>
            <span className="truncate">{a.name}</span>
            <span className="shrink-0 text-xs text-slate-500">{formatSize(a.size)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
