// ดาวน์โหลดรายชื่อผู้รับเป็นไฟล์ที่เปิดใน Excel ได้ (CSV UTF-8 + BOM ภาษาไทยไม่เพี้ยน)
// /campaigns/<id>/export?filter=waiting  (all | waiting | replied | problem | pending | stopped)
import { audit } from "@/lib/audit";
import { isLoggedIn } from "@/lib/auth";
import { isUuid } from "@/lib/data";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { STATUS_LABEL, type Recipient, type RecipientStatus } from "@/lib/types";

const FILTERS: Record<string, { label: string; statuses: RecipientStatus[] | null }> = {
  all: { label: "ทั้งหมด", statuses: null },
  waiting: { label: "รอส่งงาน", statuses: ["sent", "followed_up"] },
  replied: { label: "ส่งงานแล้ว", statuses: ["replied"] },
  problem: { label: "มีปัญหา", statuses: ["failed"] },
  pending: { label: "ยังไม่ได้ส่ง", statuses: ["pending"] },
  stopped: { label: "หยุดแล้ว", statuses: ["stopped"] },
};

function csvCell(v: string | null | undefined): string {
  const s = String(v ?? "");
  // กัน Excel ตีความเป็นสูตร (= + - @) และใส่เครื่องหมายคำพูดเมื่อมี , " หรือขึ้นบรรทัด
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function GET(request: Request, ctx: RouteContext<"/campaigns/[id]/export">) {
  if (!(await isLoggedIn())) return new Response("unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return new Response("not found", { status: 404 });

  const filterKey = new URL(request.url).searchParams.get("filter") ?? "all";
  const filter = FILTERS[filterKey] ?? FILTERS.all;

  const [{ data: c }, { data: rows, error }] = await Promise.all([
    db().from("campaigns").select("subject").eq("id", id).maybeSingle(),
    db()
      .from("recipients")
      .select("*")
      .eq("campaign_id", id)
      .order("created_at", { ascending: true }),
  ]);
  if (!c) return new Response("not found", { status: 404 });
  if (error) return new Response("error: " + error.message, { status: 500 });

  const list = (rows as Recipient[]).filter((r) => !filter.statuses || filter.statuses.includes(r.status));
  const header = ["ชื่อ", "อีเมล", "CC", "สถานะ", "ส่งเมื่อ", "ส่งซ้ำเมื่อ", "ส่งงานกลับเมื่อ", "ไฟล์ที่ส่งกลับ", "หมายเหตุ / สาเหตุ"];
  const lines = list.map((r) =>
    [
      r.name,
      r.email,
      (r.cc_emails ?? []).join("; "),
      STATUS_LABEL[r.status],
      r.sent_at ? formatDateTime(r.sent_at) : "",
      r.followup_sent_at ? formatDateTime(r.followup_sent_at) : "",
      r.replied_at ? formatDateTime(r.replied_at) : "",
      (r.reply_files ?? []).map((f) => f.url ?? f.name).join(" | "),
      r.error ?? r.note ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  const csv = "﻿" + [header.join(","), ...lines].join("\r\n");
  await audit("export_downloaded", { subject: c.subject, filter: filterKey, count: list.length });

  const base = `${c.subject.replace(/\{\s*ชื่อ\s*\}/g, "").replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 60)} - ${filter.label}`;
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="recipients.csv"; filename*=UTF-8''${encodeURIComponent(base)}.csv`,
      "cache-control": "no-store",
    },
  });
}
