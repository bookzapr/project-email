"use client";

import { useState } from "react";
import { parseRecipients, type ParsedRecipient, type RejectedLine } from "@/lib/parse-recipients";

/**
 * ใส่รายชื่อผู้รับ: วางทีเดียวหลายคน (จาก Excel/CSV) หรือพิมพ์ทีละคน
 * รายชื่อที่ใส่แล้วแสดงด้านล่างทันที กด × เพื่อเอาออก
 */
export function RecipientPicker({
  value,
  onChange,
  existingEmails,
}: {
  value: ParsedRecipient[];
  onChange: (next: ParsedRecipient[]) => void;
  /** อีเมลที่มีอยู่ในข้อความนี้แล้ว (ไม่ให้เพิ่มซ้ำ) */
  existingEmails?: Set<string>;
}) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [rejected, setRejected] = useState<RejectedLine[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const merge = (incoming: ParsedRecipient[]) => {
    const have = new Set([...value.map((r) => r.email), ...(existingEmails ?? [])]);
    const fresh = incoming.filter((r) => !have.has(r.email));
    onChange([...value, ...fresh]);
    return { added: fresh.length, dup: incoming.length - fresh.length };
  };

  const addFromText = (raw: string) => {
    const { valid, rejected } = parseRecipients(raw);
    const { added, dup } = merge(valid);
    setRejected(rejected);
    setNotice(
      [`เพิ่ม ${added} คน`, dup ? `ซ้ำ ${dup} คน (ข้าม)` : "", rejected.length ? `มีปัญหา ${rejected.length} บรรทัด` : ""]
        .filter(Boolean)
        .join(" · "),
    );
    if (added > 0 || dup > 0) setText(rejected.map((r) => r.text).join("\n"));
  };

  const addOne = () => {
    const { valid, rejected } = parseRecipients(`"${name.replace(/"/g, '""')}",${email}`);
    if (rejected.length) {
      setNotice(null);
      setRejected([{ ...rejected[0], text: `${name} ${email}` }]);
      return;
    }
    const { added } = merge(valid);
    setRejected([]);
    setNotice(added ? `เพิ่ม ${name} แล้ว` : "อีเมลนี้มีอยู่แล้ว");
    if (added) {
      setName("");
      setEmail("");
    }
  };

  const onFile = async (file: File | undefined) => {
    if (file) addFromText(await file.text());
  };

  return (
    <div className="space-y-4">
      {/* ---- วางหลายคน ---- */}
      <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/50 p-4">
        <label htmlFor="paste" className="mb-1 block font-medium">
          วางรายชื่อทีเดียวหลายคน
        </label>
        <p className="mb-2 text-sm text-slate-500">
          คัดลอก 2 คอลัมน์ <b>ชื่อ</b> และ <b>อีเมล</b> จาก Excel มาวางได้เลย หรือพิมพ์บรรทัดละคน เช่น{" "}
          <code className="rounded bg-white px-1">สมชาย ใจดี, somchai@gmail.com</code>
        </p>
        <textarea
          id="paste"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="input font-mono text-sm"
          placeholder={"สมชาย ใจดี, somchai@gmail.com\nสมหญิง รักงาน, somying@gmail.com"}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" disabled={!text.trim()} onClick={() => addFromText(text)}>
            เพิ่มรายชื่อเหล่านี้
          </button>
          <label className="btn cursor-pointer">
            หรือเลือกไฟล์ CSV
            <input
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {/* ---- ทีละคน ---- */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input"
          placeholder="ชื่อ"
          aria-label="ชื่อผู้รับ"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (name && email) addOne();
            }
          }}
          type="email"
          className="input"
          placeholder="อีเมล"
          aria-label="อีเมลผู้รับ"
        />
        <button type="button" className="btn shrink-0" disabled={!name.trim() || !email.trim()} onClick={addOne}>
          + เพิ่มทีละคน
        </button>
      </div>

      {notice && <p className="alert-ok">{notice}</p>}
      {rejected.length > 0 && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <p className="mb-1 font-medium">บรรทัดเหล่านี้เพิ่มไม่ได้ (แก้ในช่องด้านบนแล้วกดเพิ่มอีกครั้ง):</p>
          <ul className="space-y-0.5">
            {rejected.slice(0, 20).map((r) => (
              <li key={`${r.line}-${r.text}`}>
                <span className="text-red-600">{r.reason}</span> — {r.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- รายชื่อที่ใส่แล้ว ---- */}
      {value.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
            <span className="font-medium">รายชื่อที่จะเพิ่ม ({value.length} คน)</span>
            <button type="button" className="text-sm text-red-600 hover:underline" onClick={() => onChange([])}>
              ล้างทั้งหมด
            </button>
          </div>
          <ul className="max-h-72 divide-y divide-slate-100 overflow-auto">
            {value.map((r) => (
              <li key={r.email} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                <span className="min-w-0 flex-1 truncate text-slate-500">{r.email}</span>
                <button
                  type="button"
                  aria-label={`เอา ${r.name} ออก`}
                  className="rounded px-2 text-lg leading-none text-slate-400 hover:bg-red-50 hover:text-red-600"
                  onClick={() => onChange(value.filter((x) => x.email !== r.email))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
