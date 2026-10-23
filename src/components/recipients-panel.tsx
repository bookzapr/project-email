"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { RecipientPicker } from "@/components/recipient-picker";
import { StatusBadge } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { ParsedRecipient } from "@/lib/parse-recipients";
import type { FormState, Recipient, RecipientStatus } from "@/lib/types";
import type { RecipientAction } from "@/app/(app)/campaigns/actions";

type Filter = "all" | "waiting" | "replied" | "problem" | "pending" | "stopped";

const FILTERS: { key: Filter; label: string; match: (s: RecipientStatus) => boolean; tile: string }[] = [
  { key: "all", label: "ทั้งหมด", match: () => true, tile: "text-slate-900" },
  { key: "waiting", label: "รอส่งงาน", match: (s) => s === "sent" || s === "followed_up", tile: "text-amber-700" },
  { key: "replied", label: "ส่งงานแล้ว", match: (s) => s === "replied", tile: "text-green-700" },
  { key: "problem", label: "มีปัญหา", match: (s) => s === "failed", tile: "text-red-700" },
  { key: "pending", label: "ยังไม่ได้ส่ง", match: (s) => s === "pending", tile: "text-slate-700" },
  { key: "stopped", label: "หยุดแล้ว", match: (s) => s === "stopped", tile: "text-zinc-500" },
];

type Optimistic = { id: string; action: RecipientAction };

export function RecipientsPanel({
  recipients,
  onAction,
  onAdd,
}: {
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
            className={`card p-3 text-left transition sm:p-4 ${filter === f.key ? "border-blue-500 ring-2 ring-blue-200" : "hover:border-slate-300"}`}
          >
            <div className={`text-2xl font-semibold ${f.tile}`}>{counts[f.key]}</div>
            <div className="text-sm text-slate-600">{f.label}</div>
          </button>
        ))}
      </div>

      {/* ---- เพิ่มผู้รับ ---- */}
      {adding ? (
        <AddPanel onAdd={onAdd} existing={list} onClose={recipients.length ? () => setAdding(false) : undefined} />
      ) : (
        <button type="button" className="btn w-full border-dashed py-3" onClick={() => setAdding(true)}>
          + เพิ่มผู้รับ
        </button>
      )}

      {/* ---- รายชื่อ ---- */}
      {list.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-col gap-2 border-b border-slate-200 p-3 sm:flex-row sm:items-center">
            <div className="flex flex-wrap gap-1.5 text-sm">
              {FILTERS.filter((f) => f.key === "all" || counts[f.key] > 0).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`rounded-full px-3 py-1 ${
                    filter === f.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {f.label} {counts[f.key]}
                </button>
              ))}
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหาชื่อหรืออีเมล"
              className="input py-1.5 text-sm sm:ml-auto sm:w-56"
              aria-label="ค้นหาผู้รับ"
            />
          </div>

          {actionError && <p className="alert-error m-3">{actionError}</p>}

          {shown.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">ไม่มีผู้รับในกลุ่มนี้</p>
          ) : (
            <ul className="divide-y divide-slate-100">
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

function Row({ r, run }: { r: Recipient; run: (id: string, a: RecipientAction) => void }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{r.name}</span>
          <StatusBadge status={r.status} />
        </div>
        <div className="truncate text-sm text-slate-500">{r.email}</div>
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
        <div>ส่งงานกลับเมื่อ {formatDateTime(r.replied_at)}</div>
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
  if (["pending", "sent", "followed_up", "failed"].includes(r.status)) items.push({ label: "หยุดส่งคนนี้", action: "stop" });
  if (r.status === "stopped") items.push({ label: "ยกเลิกการหยุด", action: "resume" });
  items.push({ label: "ลบออก", action: "delete", danger: true, confirm: `ลบ ${r.name} ออกจากข้อความนี้?` });

  return (
    <details className="relative shrink-0">
      <summary
        className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg text-xl leading-none text-slate-500 hover:bg-slate-100 [&::-webkit-details-marker]:hidden"
        aria-label="ตัวเลือก"
      >
        ⋯
      </summary>
      <div className="absolute right-0 z-10 mt-1 w-40 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
        {items.map((it) => (
          <button
            key={it.action}
            type="button"
            className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${it.danger ? "text-red-600" : "text-slate-700"}`}
            onClick={(e) => {
              (e.currentTarget.closest("details") as HTMLDetailsElement).open = false;
              if (it.confirm && !window.confirm(it.confirm)) return;
              run(r.id, it.action);
            }}
          >
            {it.label}
          </button>
        ))}
      </div>
    </details>
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
