"use client";

import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { RecipientPicker } from "@/components/recipient-picker";
import { StatusBadge } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { ParsedRecipient } from "@/lib/parse-recipients";
import { MANUAL_REPLY_NOTE, type FormState, type Recipient, type RecipientStatus } from "@/lib/types";
import type { RecipientAction } from "@/app/(app)/campaigns/actions";

type Filter = "all" | "waiting" | "replied" | "problem" | "pending" | "stopped";

const FILTERS: { key: Filter; label: string; match: (s: RecipientStatus) => boolean; tile: string; icon: string }[] = [
  { key: "all", label: "ทั้งหมด", match: () => true, tile: "from-teal-100 to-cyan-100 text-teal-900 ring-teal-200", icon: "👥" },
  { key: "waiting", label: "รอส่งงาน", match: (s) => s === "sent" || s === "followed_up", tile: "from-amber-100 to-orange-100 text-amber-900 ring-amber-200", icon: "⏳" },
  { key: "replied", label: "ส่งงานแล้ว", match: (s) => s === "replied", tile: "from-emerald-100 to-green-200 text-emerald-900 ring-emerald-200", icon: "✅" },
  { key: "problem", label: "มีปัญหา", match: (s) => s === "failed", tile: "from-rose-100 to-pink-100 text-rose-900 ring-rose-200", icon: "⚠️" },
  { key: "pending", label: "ยังไม่ได้ส่ง", match: (s) => s === "pending", tile: "", icon: "🕒" },
  { key: "stopped", label: "หยุดแล้ว", match: (s) => s === "stopped", tile: "", icon: "⏹" },
];

type Optimistic = { id: string; action: RecipientAction };

export function RecipientsPanel({
  campaignId,
  recipients,
  onAction,
  onAdd,
}: {
  campaignId: string;
  recipients: Recipient[];
  onAction: (id: string, action: RecipientAction) => Promise<FormState>;
  onAdd: (list: ParsedRecipient[]) => Promise<FormState>;
}) {
  // เปลี่ยนสถานะบนจอทันทีที่กด แล้วค่อยซิงก์กับ server ตามหลัง
  const [list, applyOptimistic] = useOptimistic(recipients, (state: Recipient[], op: Optimistic) => {
    if (op.action === "delete") return state.filter((r) => r.id !== op.id);
    return state.map((r) => {
      if (r.id !== op.id) return r;
      if (op.action === "stop") return { ...r, status: "stopped" as const };
      if (op.action === "mark_replied") {
        return { ...r, status: "replied" as const, replied_at: new Date().toISOString(), note: MANUAL_REPLY_NOTE, error: null };
      }
      if (op.action === "unmark_replied") {
        const status: RecipientStatus = r.followup_sent_at ? "followed_up" : r.sent_at ? "sent" : "pending";
        return { ...r, status, replied_at: null, reply_files: null, reply_url: null, note: null };
      }
      const status: RecipientStatus = r.followup_sent_at ? "followed_up" : r.sent_at ? "sent" : "pending";
      return { ...r, status, error: null };
    });
  });
  const [, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(recipients.length === 0);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, list.filter((r) => f.match(r.status)).length])) as Record<Filter, number>,
    [list],
  );
  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    const q = query.trim().toLowerCase();
    return list.filter(
      (r) => f.match(r.status) && (!q || r.name.toLowerCase().includes(q) || r.email.includes(q)),
    );
  }, [list, filter, query]);

  const run = (id: string, action: RecipientAction) =>
    startTransition(async () => {
      setActionError(null);
      applyOptimistic({ id, action });
      const res = await onAction(id, action);
      if (res?.error) setActionError(res.error);
    });

  return (
    <section className="space-y-4">
      {/* ---- ตัวเลขสรุป (กดเพื่อกรอง) ---- */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {FILTERS.slice(0, 4).map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`relative overflow-hidden rounded-2xl bg-linear-to-br ${f.tile} p-3 text-left shadow-md ring-1 transition hover:-translate-y-0.5 sm:p-4 ${
              filter === f.key ? "ring-4! ring-teal-400! ring-offset-2" : "hover:shadow-lg"
            }`}
          >
            <span className="absolute -top-2 -right-1 text-5xl opacity-25">{f.icon}</span>
            <div className="text-3xl font-bold">{counts[f.key]}</div>
            <div className="text-sm font-medium opacity-80">{f.label}</div>
          </button>
        ))}
      </div>

      {/* ---- เพิ่มผู้รับ ---- */}
      {adding ? (
        <AddPanel onAdd={onAdd} existing={list} onClose={recipients.length ? () => setAdding(false) : undefined} />
      ) : (
        <button
          type="button"
          className="w-full rounded-2xl border-2 border-dashed border-teal-300 bg-white/60 py-3 font-semibold text-teal-700 transition hover:border-teal-500 hover:bg-teal-50"
          onClick={() => setAdding(true)}
        >
          + เพิ่มผู้รับ
        </button>
      )}

      {/* ---- รายชื่อ ---- */}
      {list.length > 0 && (
        // ไม่ใช้ overflow-hidden เพื่อให้เมนู ⋯ แสดงเต็ม ไม่ถูกตัดขอบ
        <div className="rounded-2xl bg-white shadow-[0_4px_24px_-8px_rgb(13_148_136/0.18)] ring-1 ring-emerald-100">
          <div className="flex flex-col gap-2 rounded-t-2xl border-b border-emerald-100 bg-emerald-50/50 p-3 sm:flex-row sm:items-center">
            <div className="flex flex-wrap gap-1.5 text-sm">
              {FILTERS.filter((f) => f.key === "all" || counts[f.key] > 0).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`rounded-full px-3 py-1 font-medium transition ${
                    filter === f.key
                      ? "bg-linear-to-r from-teal-500 to-emerald-500 text-white shadow"
                      : "bg-white text-emerald-900 ring-1 ring-emerald-200 hover:bg-teal-50"
                  }`}
                >
                  {f.label} {counts[f.key]}
                </button>
              ))}
            </div>
            <div className="flex gap-2 sm:ml-auto">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ค้นหาชื่อหรืออีเมล"
                className="input min-w-0 py-1.5 text-sm sm:w-56"
                aria-label="ค้นหาผู้รับ"
              />
              <a
                href={`/campaigns/${campaignId}/export?filter=${filter}`}
                download
                className="btn shrink-0 py-1.5"
                title="ดาวน์โหลดรายชื่อกลุ่มที่เลือกอยู่ เปิดด้วย Excel ได้"
              >
                ⬇ Excel
              </a>
            </div>
          </div>

          {actionError && <p className="alert-error m-3">{actionError}</p>}

          {shown.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">ไม่มีผู้รับในกลุ่มนี้</p>
          ) : (
            <ul className="divide-y divide-emerald-50">
              {shown.map((r) => (
                <Row key={r.id} r={r} run={run} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

const AVATAR: Record<RecipientStatus, string> = {
  pending: "from-slate-300 to-slate-400",
  sent: "from-sky-300 to-cyan-400",
  followed_up: "from-amber-400 to-orange-500",
  replied: "from-emerald-400 to-teal-500",
  failed: "from-rose-400 to-pink-500",
  stopped: "from-zinc-300 to-zinc-400",
};

function Row({ r, run }: { r: Recipient; run: (id: string, a: RecipientAction) => void }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3 transition last:rounded-b-2xl hover:bg-teal-50/40">
      <span
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-linear-to-br ${AVATAR[r.status]} text-sm font-bold text-white shadow`}
        aria-hidden
      >
        {r.name.trim().slice(0, 1) || "?"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{r.name}</span>
          <StatusBadge status={r.status} />
        </div>
        <div className="truncate text-sm text-slate-500">{r.email}</div>
        {(r.cc_emails?.length ?? 0) > 0 && (
          <div className="truncate text-xs text-sky-700">Cc {r.cc_emails!.join(", ")}</div>
        )}
        <Detail r={r} />
      </div>
      <RowMenu r={r} run={run} />
    </li>
  );
}

/** บรรทัดเล็กใต้ชื่อ: บอกสิ่งที่สำคัญที่สุดของคนนี้ตอนนี้ */
function Detail({ r }: { r: Recipient }) {
  if (r.status === "replied") {
    return (
      <div className="mt-1 space-y-0.5 text-sm text-green-800">
        <div>
          ส่งงานกลับเมื่อ {formatDateTime(r.replied_at)}
          {r.note && <span className="text-xs text-slate-500"> · {r.note}</span>}
        </div>
        {r.reply_files?.map((f, i) => (
          <div key={i} className="truncate">
            {f.kind === "drive_link" ? "🔗 " : "📎 "}
            {f.url ? (
              <a href={f.url} target="_blank" rel="noopener noreferrer" className="underline">
                {f.name}
              </a>
            ) : (
              f.name
            )}
          </div>
        ))}
        {r.reply_url && (
          <a href={r.reply_url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
            เปิดอีเมลใน Gmail ↗
          </a>
        )}
      </div>
    );
  }
  if (r.status === "failed") return <p className="mt-1 text-sm text-red-700">{r.error ?? "ส่งไม่สำเร็จ"}</p>;

  const parts: string[] = [];
  if (r.sent_at) parts.push(`ส่งเมื่อ ${formatDateTime(r.sent_at)}`);
  if (r.followup_sent_at) parts.push(`ส่งซ้ำเมื่อ ${formatDateTime(r.followup_sent_at)}`);
  return (
    <>
      {parts.length > 0 && <p className="mt-1 text-xs text-slate-500">{parts.join(" · ")}</p>}
      {r.note && <p className="mt-0.5 text-xs text-amber-700">{r.note}</p>}
    </>
  );
}

function RowMenu({ r, run }: { r: Recipient; run: (id: string, a: RecipientAction) => void }) {
  const items: { label: string; action: RecipientAction; danger?: boolean; confirm?: string }[] = [];
  if (r.status === "failed") items.push({ label: "ส่งใหม่", action: "retry" });
  if (r.status !== "replied") items.push({ label: "✅ ทำเครื่องหมายว่าส่งงานแล้ว", action: "mark_replied" });
  if (r.status === "replied") {
    items.push({
      label: "↩ ยกเลิก “ส่งงานแล้ว”",
      action: "unmark_replied",
      confirm: `ยกเลิกสถานะ "ส่งงานแล้ว" ของ ${r.name}? (ระบบจะกลับไปทวงซ้ำตามปกติ)`,
    });
  }
  if (["pending", "sent", "followed_up", "failed"].includes(r.status)) items.push({ label: "หยุดส่งคนนี้", action: "stop" });
  if (r.status === "stopped") items.push({ label: "ยกเลิกการหยุด", action: "resume" });
  items.push({ label: "ลบออก", action: "delete", danger: true, confirm: `ลบ ${r.name} ออกจากข้อความนี้?` });

  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // คลิกที่อื่น (รวมถึงเปิดเมนูของคนอื่น) หรือกด Esc → ปิดเมนูนี้ จะได้ไม่ซ้อนกัน
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-8 w-8 items-center justify-center rounded-lg text-xl leading-none text-slate-500 hover:bg-slate-100 ${open ? "bg-slate-100" : ""}`}
        aria-label="ตัวเลือก"
        aria-expanded={open}
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {items.map((it) => (
            <button
              key={it.action}
              type="button"
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${it.danger ? "text-red-600" : "text-slate-700"}`}
              onClick={() => {
                setOpen(false);
                if (it.confirm && !window.confirm(it.confirm)) return;
                run(r.id, it.action);
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddPanel({
  onAdd,
  existing,
  onClose,
}: {
  onAdd: (list: ParsedRecipient[]) => Promise<FormState>;
  existing: Recipient[];
  onClose?: () => void;
}) {
  const [draft, setDraft] = useState<ParsedRecipient[]>([]);
  const [saving, startSaving] = useTransition();
  const [result, setResult] = useState<FormState>(null);
  const existingEmails = useMemo(() => new Set(existing.map((r) => r.email.toLowerCase())), [existing]);

  const save = () =>
    startSaving(async () => {
      const res = await onAdd(draft);
      setResult(res);
      if (res?.ok) setDraft([]);
    });

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">เพิ่มผู้รับ</h2>
        {onClose && (
          <button type="button" className="text-sm text-slate-500 hover:underline" onClick={onClose}>
            ปิด
          </button>
        )}
      </div>
      <RecipientPicker value={draft} onChange={setDraft} existingEmails={existingEmails} />
      {result?.error && <p className="alert-error">{result.error}</p>}
      {result?.message && draft.length === 0 && <p className="alert-ok">{result.message}</p>}
      {draft.length > 0 && (
        <button type="button" className="btn-primary w-full py-2.5" disabled={saving} onClick={save}>
          {saving ? "กำลังบันทึก..." : `บันทึกผู้รับ ${draft.length} คน`}
        </button>
      )}
    </div>
  );
}
