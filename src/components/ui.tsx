import { STATUS_LABEL, STATUS_STYLE, type RecipientStatus } from "@/lib/types";

// ---------- โครงร่างระหว่างโหลด (แสดงทันที ไม่ต้องรอข้อมูล) ----------

function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} />;
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
  const color = pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-blue-500";
  return (
    <div className="flex items-center gap-3 text-sm text-slate-600">
      <span className="shrink-0">ส่งแล้ว 24 ชม.ล่าสุด</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0">
        <b className="text-slate-900">{used.toLocaleString("th-TH")}</b> / {limit.toLocaleString("th-TH")}
      </span>
    </div>
  );
}
