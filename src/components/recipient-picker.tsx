"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { getAddressBook, getRecipientsOf } from "@/app/(app)/campaigns/actions";
import { formatDateTime } from "@/lib/format";
import {
  parseRecipients,
  recipientProblem,
  splitEmails,
  type ParsedRecipient,
  type RejectedLine,
} from "@/lib/parse-recipients";

type Method = "paste" | "upload" | "type" | "book";

const METHODS: { key: Method; icon: string; title: string; desc: string }[] = [
  { key: "paste", icon: "📋", title: "วางจาก Excel", desc: "คัดลอกแล้ว Ctrl+V" },
  { key: "upload", icon: "📁", title: "อัปโหลดไฟล์", desc: "Excel หรือ CSV" },
  { key: "type", icon: "✍️", title: "พิมพ์เอง", desc: "ทีละคน" },
  { key: "book", icon: "👥", title: "รายชื่อเดิม", desc: "คนที่เคยส่งแล้ว" },
];

/**
 * ใส่รายชื่อผู้รับ: เลือก 1 ใน 4 วิธีด้านบน แล้วรายชื่อจะขึ้นในตารางด้านล่าง (แก้ไขในตารางได้เลย)
 * คอลัมน์: ชื่อ | อีเมล | CC (ไม่บังคับ)
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
  const [method, setMethod] = useState<Method>("paste");
  const [rejected, setRejected] = useState<RejectedLine[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  /** เพิ่มรายชื่อเข้าตาราง (ข้ามคนที่ซ้ำ) แล้วแจ้งผล */
  const merge = (incoming: ParsedRecipient[], bad: RejectedLine[] = []) => {
    const have = new Set([...value.map((r) => r.email.toLowerCase()), ...(existingEmails ?? [])]);
    const fresh = incoming.filter((r) => !have.has(r.email.toLowerCase()));
    if (fresh.length) onChange([...value, ...fresh]);
    setRejected(bad);
    const dup = incoming.length - fresh.length;
    setNotice(
      [
        fresh.length ? `✅ เพิ่ม ${fresh.length} คน` : "ไม่มีรายชื่อใหม่",
        dup ? `ซ้ำ ${dup} คน (ข้าม)` : "",
        bad.length ? `⚠️ มีปัญหา ${bad.length} บรรทัด (ดูด้านล่าง)` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    );
    return fresh.length;
  };
  const mergeText = (text: string) => {
    const { valid, rejected } = parseRecipients(text);
    return merge(valid, rejected);
  };

  return (
    <div className="space-y-4">
      {/* ---- เลือกวิธี ---- */}
      <div>
        <p className="mb-2 text-sm font-semibold text-indigo-950">เพิ่มผู้รับด้วยวิธีไหน?</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {METHODS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMethod(m.key)}
              className={`rounded-2xl border-2 p-3 text-left transition ${
                method === m.key
                  ? "border-violet-500 bg-linear-to-br from-indigo-50 to-violet-100 shadow-md shadow-violet-200"
                  : "border-indigo-100 bg-white hover:-translate-y-0.5 hover:border-violet-300 hover:shadow"
              }`}
            >
              <div className="text-2xl">{m.icon}</div>
              <div className="mt-1 font-semibold text-indigo-950">{m.title}</div>
              <div className="text-xs text-slate-500">{m.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4">
        {method === "paste" && <PastePanel onText={mergeText} />}
        {method === "upload" && <UploadPanel onText={mergeText} />}
        {method === "type" && <TypePanel onAdd={(r) => merge([r]) > 0} />}
        {method === "book" && <BookPanel onAdd={(list) => merge(list)} existing={value} />}
      </div>

      {notice && <p className="alert-ok fade-up">{notice}</p>}
      {rejected.length > 0 && (
        <div className="fade-up rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <p className="mb-1 font-semibold">บรรทัดเหล่านี้เพิ่มไม่ได้ — แก้ในไฟล์แล้วเพิ่มใหม่ หรือพิมพ์เพิ่มในตารางด้านล่างได้เลย</p>
          <ul className="space-y-0.5">
            {rejected.slice(0, 20).map((r) => (
              <li key={`${r.line}-${r.text}`}>
                <span className="font-medium">{r.reason}</span> — {r.text}
              </li>
            ))}
            {rejected.length > 20 && <li>... และอีก {rejected.length - 20} บรรทัด</li>}
          </ul>
        </div>
      )}

      <RecipientTable value={value} onChange={onChange} existingEmails={existingEmails} />
    </div>
  );
}

// =====================================================================
// วิธีที่ 1: วางจาก Excel
// =====================================================================

function PastePanel({ onText }: { onText: (text: string) => number }) {
  const [text, setText] = useState("");
  return (
    <div className="space-y-3">
      <ExampleTable />
      <textarea
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          // วางแล้วเพิ่มให้ทันที ไม่ต้องกดปุ่ม
          const pasted = e.clipboardData.getData("text");
          if (pasted.includes("@")) {
            e.preventDefault();
            onText(pasted);
            setText("");
          }
        }}
        className="input min-h-28 border-2 border-dashed border-violet-300 bg-white font-mono text-sm"
        placeholder={"👉 คลิกตรงนี้ แล้วกด Ctrl+V (มือถือ: กดค้างแล้วเลือก วาง)\n\nหรือพิมพ์บรรทัดละคน เช่น  สมชาย ใจดี, somchai@gmail.com"}
        aria-label="วางรายชื่อ"
      />
      {text.trim() && (
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            if (onText(text) > 0) setText("");
          }}
        >
          เพิ่มรายชื่อที่พิมพ์
        </button>
      )}
    </div>
  );
}

function ExampleTable() {
  return (
    <div className="text-sm">
      <p className="mb-1.5 text-indigo-950">
        ใน Excel ให้มีคอลัมน์แบบนี้ แล้วลากคลุมเฉพาะรายชื่อ กด <kbd className="rounded bg-white px-1.5 ring-1 ring-indigo-200">Ctrl+C</kbd>
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-max overflow-hidden rounded-lg bg-white text-left text-xs ring-1 ring-indigo-200">
          <thead className="bg-emerald-600 text-white">
            <tr>
              <th className="px-3 py-1.5">ชื่อ</th>
              <th className="px-3 py-1.5">อีเมล</th>
              <th className="px-3 py-1.5">CC (ไม่บังคับ)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-indigo-50">
            <tr>
              <td className="px-3 py-1">สมชาย ใจดี</td>
              <td className="px-3 py-1">somchai@gmail.com</td>
              <td className="px-3 py-1 text-slate-400">boss@company.com</td>
            </tr>
            <tr>
              <td className="px-3 py-1">สมหญิง รักงาน</td>
              <td className="px-3 py-1">somying@gmail.com</td>
              <td className="px-3 py-1" />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =====================================================================
// วิธีที่ 2: อัปโหลดไฟล์ Excel / CSV
// =====================================================================

function UploadPanel({ onText }: { onText: (text: string) => number }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const name = file.name.toLowerCase();
      if (name.endsWith(".xlsx")) {
        const { readSheet } = await import("read-excel-file/browser");
        const rows = await readSheet(file);
        onText(rows.map((r) => r.map((c) => (c == null ? "" : String(c).trim())).join("\t")).join("\n"));
      } else if (name.endsWith(".xls")) {
        setError("ไฟล์ .xls (Excel รุ่นเก่า) ยังอ่านไม่ได้ — เปิดใน Excel แล้วบันทึกเป็น .xlsx หรือคัดลอกมาวางแทน");
      } else {
        onText(await file.text());
      }
    } catch {
      setError("อ่านไฟล์ไม่ได้ — ลองบันทึกเป็น .xlsx หรือ CSV UTF-8 ใหม่ หรือคัดลอกมาวางแทน");
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const csv = "﻿ชื่อ,อีเมล,CC (ไม่บังคับ)\r\nสมชาย ใจดี,somchai@gmail.com,\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "แบบฟอร์มรายชื่อผู้รับ.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void readFile(e.dataTransfer.files[0]);
        }}
        className={`flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-8 text-center transition ${
          drag ? "border-violet-500 bg-violet-100" : "border-violet-300 bg-white hover:bg-violet-50"
        }`}
      >
        <span className="text-4xl">{busy ? "⏳" : "📁"}</span>
        <span className="mt-2 font-semibold text-indigo-950">
          {busy ? "กำลังอ่านไฟล์..." : "คลิกเพื่อเลือกไฟล์ หรือลากไฟล์มาวางตรงนี้"}
        </span>
        <span className="text-xs text-slate-500">รองรับ Excel (.xlsx) และ CSV · แถวแรกเป็นหัวตารางได้</span>
      </button>
      <input
        ref={input}
        type="file"
        accept=".xlsx,.xls,.csv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        aria-label="เลือกไฟล์รายชื่อ"
        onChange={(e) => {
          void readFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {error && <p className="alert-error">{error}</p>}
      <button type="button" className="text-sm text-violet-700 underline" onClick={downloadTemplate}>
        ⬇ ดาวน์โหลดไฟล์ตัวอย่าง (เปิดด้วย Excel แล้วกรอกรายชื่อ)
      </button>
    </div>
  );
}

// =====================================================================
// วิธีที่ 3: พิมพ์เอง
// =====================================================================

function TypePanel({ onAdd }: { onAdd: (r: ParsedRecipient) => boolean }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [cc, setCc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const add = () => {
    const r: ParsedRecipient = { name: name.trim(), email: email.trim().toLowerCase(), cc: splitEmails(cc) };
    const problem = recipientProblem(r);
    if (problem) return setError(problem);
    if (!onAdd(r)) return setError("อีเมลนี้มีอยู่ในรายชื่อแล้ว");
    setError(null);
    setName("");
    setEmail("");
    setCc("");
    nameRef.current?.focus();
  };
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  };

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onEnter}
          className="input"
          placeholder="ชื่อ"
          aria-label="ชื่อผู้รับ"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={onEnter}
          type="email"
          className="input"
          placeholder="อีเมล"
          aria-label="อีเมลผู้รับ"
        />
        <input
          value={cc}
          onChange={(e) => setCc(e.target.value)}
          onKeyDown={onEnter}
          className="input"
          placeholder="CC (ไม่บังคับ)"
          aria-label="CC ของผู้รับ"
        />
        <button type="button" className="btn-primary" onClick={add}>
          + เพิ่มทีละคน
        </button>
      </div>
      <p className="hint">กด Enter เพื่อเพิ่ม แล้วพิมพ์คนถัดไปได้เลย</p>
      {error && <p className="alert-error">{error}</p>}
    </div>
  );
}

// =====================================================================
// วิธีที่ 4: เลือกจากรายชื่อเดิม
// =====================================================================

type Book = Awaited<ReturnType<typeof getAddressBook>>;

function BookPanel({ onAdd, existing }: { onAdd: (list: ParsedRecipient[]) => number; existing: ParsedRecipient[] }) {
  const [book, setBook] = useState<Book | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [campaignId, setCampaignId] = useState("");
  const [copying, startCopying] = useTransition();

  // โหลดรายชื่อเดิมครั้งแรกที่เปิดแท็บนี้
  useEffect(() => {
    let alive = true;
    getAddressBook().then((b) => alive && setBook(b));
    return () => {
      alive = false;
    };
  }, []);

  const inList = useMemo(() => new Set(existing.map((r) => r.email.toLowerCase())), [existing]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (book?.contacts ?? []).filter((c) => !q || c.name.toLowerCase().includes(q) || c.email.includes(q));
  }, [book, query]);

  if (!book) return <p className="py-6 text-center text-slate-500">⏳ กำลังโหลดรายชื่อเดิม...</p>;
  if (book.contacts.length === 0) {
    return <p className="py-6 text-center text-slate-500">ยังไม่มีรายชื่อเดิม — ส่งอีเมลครั้งแรกแล้ว รายชื่อจะมาอยู่ที่นี่</p>;
  }

  const toggle = (email: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(email)) n.delete(email);
      else n.add(email);
      return n;
    });
  const selectable = shown.filter((c) => !inList.has(c.email));

  return (
    <div className="space-y-4">
      {book.campaigns.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="shrink-0 text-sm font-semibold text-indigo-950">ใช้รายชื่อชุดเดิมทั้งหมด:</span>
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="input py-1.5 text-sm">
            <option value="">— เลือกข้อความเก่า —</option>
            {book.campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.subject.slice(0, 50)} ({c.total} คน · {formatDateTime(c.sendAt)})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-primary shrink-0"
            disabled={!campaignId || copying}
            onClick={() => startCopying(async () => void onAdd(await getRecipientsOf(campaignId)))}
          >
            {copying ? "กำลังเพิ่ม..." : "เพิ่มทั้งชุด"}
          </button>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input max-w-xs py-1.5 text-sm"
            placeholder="🔍 ค้นหาชื่อหรืออีเมล"
            aria-label="ค้นหารายชื่อเดิม"
          />
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setPicked(new Set(selectable.map((c) => c.email)))}
            disabled={selectable.length === 0}
          >
            เลือกทั้งหมด ({selectable.length})
          </button>
          {picked.size > 0 && (
            <button type="button" className="btn btn-sm" onClick={() => setPicked(new Set())}>
              ล้างที่เลือก
            </button>
          )}
        </div>
        <ul className="max-h-72 divide-y divide-indigo-50 overflow-auto rounded-xl bg-white ring-1 ring-indigo-100">
          {shown.slice(0, 300).map((c) => {
            const already = inList.has(c.email);
            return (
              <li key={c.email}>
                <label className={`flex items-center gap-3 px-3 py-2 text-sm ${already ? "opacity-50" : "cursor-pointer hover:bg-violet-50"}`}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-violet-600"
                    disabled={already}
                    checked={already || picked.has(c.email)}
                    onChange={() => toggle(c.email)}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-500">{c.email}</span>
                  {already && <span className="text-xs text-violet-700">อยู่ในรายชื่อแล้ว</span>}
                </label>
              </li>
            );
          })}
          {shown.length === 0 && <li className="p-4 text-center text-sm text-slate-500">ไม่พบรายชื่อ</li>}
        </ul>
        <button
          type="button"
          className="btn-primary w-full"
          disabled={picked.size === 0}
          onClick={() => {
            onAdd(book.contacts.filter((c) => picked.has(c.email)).map(({ name, email, cc }) => ({ name, email, cc })));
            setPicked(new Set());
          }}
        >
          + เพิ่ม {picked.size} คนที่เลือก
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// ตารางรายชื่อ (แก้ไขได้)
// =====================================================================

const PAGE = 100;

function RecipientTable({
  value,
  onChange,
  existingEmails,
}: {
  value: ParsedRecipient[];
  onChange: (next: ParsedRecipient[]) => void;
  existingEmails?: Set<string>;
}) {
  const [limit, setLimit] = useState(PAGE);
  const problems = useMemo(() => {
    const seen = new Map<string, number>();
    return value.map((r) => {
      const e = r.email.trim().toLowerCase();
      const p = recipientProblem(r);
      if (p) return p;
      if (existingEmails?.has(e)) return "มีอยู่ในข้อความนี้แล้ว";
      if (seen.has(e)) return "อีเมลซ้ำ";
      seen.set(e, 1);
      return null;
    });
  }, [value, existingEmails]);
  const problemCount = problems.filter(Boolean).length;

  const update = (i: number, patch: Partial<ParsedRecipient>) =>
    onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  if (value.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-indigo-200 bg-white/60 py-8 text-center text-slate-500">
        <div className="text-3xl">🧑‍🤝‍🧑</div>
        ยังไม่มีผู้รับ — เลือกวิธีด้านบนเพื่อเพิ่มรายชื่อ
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-indigo-100">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-linear-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-white">
        <span className="font-semibold">👥 รายชื่อผู้รับ {value.length.toLocaleString("th-TH")} คน</span>
        <div className="flex items-center gap-3 text-sm">
          {problemCount > 0 && <span className="rounded-full bg-rose-500 px-2 py-0.5">⚠️ ต้องแก้ {problemCount}</span>}
          <button
            type="button"
            className="underline decoration-white/50 hover:decoration-white"
            onClick={() => window.confirm("ล้างรายชื่อทั้งหมด?") && onChange([])}
          >
            ล้างทั้งหมด
          </button>
        </div>
      </div>
      <p className="border-b border-indigo-50 bg-indigo-50/50 px-4 py-1.5 text-xs text-indigo-900/70">
        ✏️ คลิกที่ชื่อ อีเมล หรือ CC เพื่อแก้ไขได้เลย · CC หลายคนคั่นด้วย , หรือ ;
      </p>
      <div className="max-h-[28rem] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-white text-left text-xs text-slate-500 shadow-sm">
            <tr>
              <th className="w-10 px-3 py-2">#</th>
              <th className="px-1 py-2">ชื่อ</th>
              <th className="px-1 py-2">อีเมล</th>
              <th className="hidden px-1 py-2 md:table-cell">CC</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {value.slice(0, limit).map((r, i) => (
              <tr key={i} className={problems[i] ? "bg-rose-50" : i % 2 ? "bg-indigo-50/30" : ""}>
                <td className="px-3 py-1 align-top text-xs text-slate-400">{i + 1}</td>
                <td className="px-1 py-1 align-top">
                  <CellInput value={r.name} onCommit={(v) => update(i, { name: v })} label={`ชื่อแถว ${i + 1}`} />
                </td>
                <td className="px-1 py-1 align-top">
                  <CellInput
                    value={r.email}
                    onCommit={(v) => update(i, { email: v.trim().toLowerCase() })}
                    label={`อีเมลแถว ${i + 1}`}
                    invalid={problems[i] === "อีเมลไม่ถูกต้อง" || problems[i] === "อีเมลซ้ำ"}
                  />
                  {problems[i] && <div className="px-2 text-xs text-rose-600">{problems[i]}</div>}
                  <div className="md:hidden">
                    <CellInput
                      value={(r.cc ?? []).join(", ")}
                      onCommit={(v) => update(i, { cc: splitEmails(v) })}
                      label={`CC แถว ${i + 1}`}
                      placeholder="+ CC"
                    />
                  </div>
                </td>
                <td className="hidden px-1 py-1 align-top md:table-cell">
                  <CellInput
                    value={(r.cc ?? []).join(", ")}
                    onCommit={(v) => update(i, { cc: splitEmails(v) })}
                    label={`CC แถว ${i + 1}`}
                    placeholder="—"
                  />
                </td>
                <td className="px-1 py-1 text-center align-top">
                  <button
                    type="button"
                    aria-label={`เอา ${r.name} ออก`}
                    className="rounded-lg px-2 py-1 text-lg leading-none text-slate-400 transition hover:bg-rose-100 hover:text-rose-600"
                    onClick={() => onChange(value.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-indigo-50 px-4 py-2">
        <button type="button" className="btn btn-sm" onClick={() => onChange([...value, { name: "", email: "", cc: [] }])}>
          + เพิ่มแถวว่าง
        </button>
        {value.length > limit && (
          <button type="button" className="btn btn-sm" onClick={() => setLimit((l) => l + PAGE * 5)}>
            แสดงเพิ่ม ({value.length - limit} คน)
          </button>
        )}
      </div>
    </div>
  );
}

/** ช่องแก้ไขในตาราง: พิมพ์ได้ลื่น บันทึกเมื่อออกจากช่อง หรือกด Enter */
function CellInput({
  value,
  onCommit,
  label,
  invalid,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  label: string;
  invalid?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setDraft(value)}
      onBlur={() => {
        if (draft !== null && draft !== value) onCommit(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      aria-label={label}
      placeholder={placeholder}
      className={`w-full min-w-0 rounded-lg border px-2 py-1 transition focus:border-violet-500 focus:bg-white focus:ring-2 focus:ring-violet-200 focus:outline-none ${
        invalid ? "border-rose-300 bg-white" : "border-transparent bg-transparent hover:border-indigo-200"
      }`}
    />
  );
}
