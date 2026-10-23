// ทดสอบฐานข้อมูล: npm run test:db
// สร้างข้อมูลทดสอบชั่วคราว ตรวจการจองงานไม่ซ้ำซ้อน แล้วลบทิ้ง
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("❌ ไม่พบ SUPABASE_URL หรือ SUPABASE_SECRET_KEY ใน .env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

let failed = false;
const ok = (msg) => console.log("✅ " + msg);
const bad = (msg) => {
  failed = true;
  console.log("❌ " + msg);
};

let campaignId;
try {
  // 1) เชื่อมต่อ + ตาราง settings
  const { data: settings, error: e1 } = await db.from("settings").select("*").eq("id", 1).single();
  if (e1) throw new Error("อ่านตาราง settings ไม่ได้ (รันสคริปต์ SQL แล้วหรือยัง?): " + e1.message);
  ok(`เชื่อมต่อฐานข้อมูลได้ ขีดจำกัดต่อวัน = ${settings.daily_limit}`);

  // 2) สร้างข้อความทดสอบ + ผู้รับ 5 คน
  const { data: c, error: e2 } = await db
    .from("campaigns")
    .insert({
      subject: "[ทดสอบ] สวัสดี {ชื่อ}",
      body_html: "<p>ทดสอบ</p>",
      send_at: new Date(Date.now() - 60_000).toISOString(),
    })
    .select()
    .single();
  if (e2) throw new Error("สร้างข้อความไม่ได้: " + e2.message);
  campaignId = c.id;

  const people = [1, 2, 3, 4, 5].map((i) => ({
    campaign_id: c.id,
    name: `คนที่ ${i}`,
    email: `test${i}@example.com`,
  }));
  const { error: e3 } = await db.from("recipients").insert(people);
  if (e3) throw new Error("เพิ่มผู้รับไม่ได้: " + e3.message);
  ok("สร้างข้อความทดสอบและผู้รับ 5 คนได้");

  // 3) อีเมลซ้ำในข้อความเดียวกันต้องถูกปฏิเสธ
  const { error: dup } = await db
    .from("recipients")
    .insert({ campaign_id: c.id, name: "ซ้ำ", email: "TEST1@example.com" });
  dup ? ok("กันอีเมลซ้ำในข้อความเดียวกันได้") : bad("อีเมลซ้ำถูกเพิ่มเข้าไปได้");

  // 4) จองพร้อมกัน 2 รอบ (จำลอง cron ทับกัน) ต้องไม่ได้คนเดียวกัน
  const [a, b] = await Promise.all([
    db.rpc("claim_send_batch", { p_limit: 3, p_lease_seconds: 60 }),
    db.rpc("claim_send_batch", { p_limit: 3, p_lease_seconds: 60 }),
  ]);
  if (a.error || b.error) throw new Error("เรียก claim_send_batch ไม่ได้: " + (a.error || b.error).message);
  const mine = (rows) => rows.filter((r) => r.campaign_id === c.id).map((r) => r.recipient_id);
  const ids = [...mine(a.data), ...mine(b.data)];
  const unique = new Set(ids);
  ids.length === 5 && unique.size === 5
    ? ok(`จองพร้อมกัน 2 รอบ ได้ ${mine(a.data).length} + ${mine(b.data).length} คน ไม่ซ้ำกันเลย`)
    : bad(`การจองผิด: ได้ ${ids.length} รายการ ไม่ซ้ำ ${unique.size} (ควรเป็น 5 และ 5)`);

  // 5) จองอีกรอบทันที ต้องไม่ได้ใคร (ทุกคนถูกจองอยู่)
  const again = await db.rpc("claim_send_batch", { p_limit: 10, p_lease_seconds: 60 });
  mine(again.data ?? []).length === 0
    ? ok("รอบที่ 3 ไม่หยิบคนที่ถูกจองอยู่ซ้ำ")
    : bad("รอบที่ 3 หยิบคนที่ถูกจองอยู่ซ้ำ");

  // 6) ล็อกงานเบื้องหลัง
  const l1 = await db.rpc("try_job_lock", { p_name: "test-lock", p_seconds: 30 });
  const l2 = await db.rpc("try_job_lock", { p_name: "test-lock", p_seconds: 30 });
  l1.data && !l2.data ? ok("ล็อกงานเบื้องหลังได้ (รอบที่ 2 ถูกกันไว้)") : bad("ล็อกงานเบื้องหลังผิดพลาด");
  await db.rpc("release_job_lock", { p_name: "test-lock", p_token: l1.data });
} catch (err) {
  bad(err.message);
} finally {
  if (campaignId) {
    await db.from("campaigns").delete().eq("id", campaignId);
    console.log("🧹 ลบข้อมูลทดสอบแล้ว");
  }
}

console.log(failed ? "\nผลรวม: ❌ มีข้อผิดพลาด" : "\nผลรวม: ✅ ฐานข้อมูลพร้อมใช้งาน");
process.exit(failed ? 1 : 0);
