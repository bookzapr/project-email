// ดาวน์โหลดข้อมูลสำรองทั้งหมดเป็นไฟล์ JSON (ข้อความ + ผู้รับ + การตั้งค่า)
// Supabase แบบฟรีไม่มีสำรองข้อมูลอัตโนมัติ — กดเก็บไว้เป็นระยะได้ที่หน้าตั้งค่า
// ไม่รวมความลับ (2FA, รหัสสำรอง) และไม่รวมตัวไฟล์แนบ (เก็บแค่ชื่อไฟล์)
import { audit } from "@/lib/audit";
import { isLoggedIn } from "@/lib/auth";
import { db } from "@/lib/db";

const PAGE = 1000;

async function allRows(table: "campaigns" | "recipients") {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from(table)
      .select("*")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`อ่าน ${table} ไม่ได้: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

export async function GET() {
  if (!(await isLoggedIn())) return new Response("unauthorized", { status: 401 });

  const [campaigns, recipients, { data: s }] = await Promise.all([
    allRows("campaigns"),
    allRows("recipients"),
    db().from("settings").select("*").eq("id", 1).single(),
  ]);
  const settings = Object.fromEntries(
    Object.entries(s ?? {}).filter(([k]) => !k.startsWith("totp_") && k !== "session_version"),
  );

  const at = new Date();
  const body = JSON.stringify({ exported_at: at.toISOString(), settings, campaigns, recipients }, null, 2);
  await audit("backup_downloaded", { campaigns: campaigns.length, recipients: recipients.length });

  const stamp = at.toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="email-backup-${stamp}.json"`,
      "cache-control": "no-store",
    },
  });
}
