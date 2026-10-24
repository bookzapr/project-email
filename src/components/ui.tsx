import { STATUS_LABEL, STATUS_STYLE, type RecipientStatus } from "@/lib/types";

// ---------- โครงร่างระหว่างโหลด (แสดงทันที ไม่ต้องรอข้อมูล) ----------

function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-indigo-100 ${className}`} />;
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card space-y-3">
          <Bar className="h-5 w-2/3" />
          <Bar className="h-3 w-1/2" />
          <Bar className="h-2 w-full" />
        </div>
      ))}
    </div>
  );
}

export function FormSkeleton() {
  return (
    <div className="card space-y-4">
      <Bar className="h-10 w-full" />
      <Bar className="h-48 w-full" />
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <Bar className="h-6 w-2/3" />
        <Bar className="h-4 w-1/3" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card">
            <Bar className="h-8 w-12" />
          </div>
        ))}
      </div>
      <ListSkeleton rows={2} />
    </div>
  );
}

// ---------- ชิ้นส่วนแสดงผล ----------

export function StatusBadge({ status }: { status: RecipientStatus }) {
  return <span className={`badge ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function QuotaLine({ used, limit }: { used: number; limit: number }) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const color =
    pct >= 100
      ? "from-rose-500 to-red-500"
      : pct >= 80
        ? "from-amber-400 to-orange-500"
        : "from-sky-400 via-indigo-500 to-violet-500";
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/70 px-4 py-2.5 text-sm text-indigo-900/70 ring-1 ring-indigo-100 backdrop-blur">
      <span className="shrink-0">📤 โควตา 24 ชม.</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-indigo-100">
        <div className={`h-full rounded-full bg-linear-to-r ${color}`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
      <span className="shrink-0">
        <b className="text-indigo-950">{used.toLocaleString("th-TH")}</b> / {limit.toLocaleString("th-TH")}
      </span>
    </div>
  );
}
