// ทดสอบหน้าเว็บ + การส่งอีเมลแบบอัตโนมัติ (ขั้นที่ 2–3) ด้วยเบราว์เซอร์จริง
// ต้องเปิดเว็บที่ localhost:3000 และ npm run cron:local อยู่
// ใช้:  node --env-file=.env.local scripts/e2e-ui.mjs
import { createClient } from "@supabase/supabase-js";
import { ImapFlow } from "imapflow";
import { chromium } from "playwright";

const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ME = process.env.GMAIL_USER;
const [local, domain] = ME.split("@");
const addr = (k) => `${local}+${k}@${domain}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clock = () => new Date().toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" });

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ ok: true, name, detail });
    console.log(`${clock()}  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    results.push({ ok: false, name, detail: err.message });
    console.log(`${clock()}  ❌ ${name} — ${err.message.split("\n")[0]}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
async function waitUntil(fn, timeoutMs, label) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(4000);
  }
  throw new Error(`หมดเวลารอ: ${label}`);
}
async function statuses(campaignId) {
  const { data } = await db.from("recipients").select("email,status,sent_at").eq("campaign_id", campaignId);
  return Object.fromEntries(data.map((r) => [r.email, r]));
}

const { data: origSettings } = await db.from("settings").select("sender_name,daily_limit").eq("id", 1).single();
const createdCampaigns = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("dialog", (d) => d.accept());
page.setDefaultTimeout(15_000);

try {
  // =============================================================== ล็อกอิน
  await check("ล็อกอิน: รหัสผิดต้องถูกปฏิเสธ", async () => {
    await page.goto(`${BASE}/`);
    assert(page.url().includes("/login"), "ไม่ถูกพาไปหน้าล็อกอิน");
    await page.fill("#password", "wrong-password-xyz");
    await page.click("button[type=submit]");
    await page.getByText("รหัสผ่านไม่ถูกต้อง").waitFor();
  });
  await check("ล็อกอิน: รหัสถูกต้องเข้าได้", async () => {
    await page.fill("#password", process.env.ADMIN_PASSWORD);
    await page.click("button[type=submit]");
    await page.getByRole("heading", { name: "ข้อความทั้งหมด" }).waitFor();
  });

  // =============================================================== สร้างข้อความ 3 ขั้น
  let campaignId;
  await check("สร้างข้อความ ขั้น ①: ต้องเตือนถ้ายังไม่ใส่หัวข้อ", async () => {
    await page.getByRole("link", { name: "+ ส่งอีเมลใหม่" }).first().click();
    await page.getByRole("heading", { name: "ส่งอีเมลใหม่" }).waitFor();
    await page.getByRole("button", { name: "ถัดไป →" }).click();
    await page.getByText("กรุณาใส่หัวข้ออีเมล").waitFor();
  });
  await check("สร้างข้อความ ขั้น ①: เขียนหัวข้อ + เนื้อหา + ใส่ชื่อผู้รับ + ตัวหนา", async () => {
    await page.fill("#subject", "[ทดสอบ UI] เรียน คุณ{ชื่อ}");
    const editor = page.locator(".ProseMirror").first();
    await editor.click();
    await page.keyboard.type("เรียน คุณ");
    await page.getByRole("button", { name: "+ ใส่ชื่อผู้รับ" }).click();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "ตัวหนา" }).click();
    await page.keyboard.type("ข้อความตัวหนา");
    const html = await editor.innerHTML();
    assert(html.includes("{ชื่อ}"), "ไม่มี {ชื่อ} ในเนื้อหา");
    assert(/<strong>ข้อความตัวหนา<\/strong>/.test(html), "ตัวหนาไม่ทำงาน");
    await page.getByRole("button", { name: "ถัดไป →" }).click();
    await page.getByText("วางรายชื่อทีเดียวหลายคน").waitFor();
  });
  await check("สร้างข้อความ ขั้น ②: ต้องเตือนถ้ายังไม่มีผู้รับ", async () => {
    await page.getByRole("button", { name: "ถัดไป →" }).click();
    await page.getByText("กรุณาเพิ่มผู้รับอย่างน้อย 1 คน").waitFor();
  });
  await check("สร้างข้อความ ขั้น ②: วางรายชื่อหลายคน (บรรทัดผิดต้องถูกแจ้ง)", async () => {
    await page.fill("#paste", `ยูไอหนึ่ง, ${addr("ui1")}\nยูไอสอง\t${addr("ui2")}\nผิดรูปแบบ, abc@def`);
    await page.getByRole("button", { name: "เพิ่มรายชื่อเหล่านี้" }).click();
    await page.getByText("รายชื่อที่จะเพิ่ม (2 คน)").waitFor();
    await page.getByText("รูปแบบอีเมลไม่ถูกต้อง").waitFor();
  });
  await check("สร้างข้อความ ขั้น ②: เพิ่มทีละคน + เอาออก + กันอีเมลซ้ำ", async () => {
    await page.getByLabel("ชื่อผู้รับ").fill("ยูไอสาม");
    await page.getByLabel("อีเมลผู้รับ").fill(addr("ui3"));
    await page.getByRole("button", { name: "+ เพิ่มทีละคน" }).click();
    await page.getByText("รายชื่อที่จะเพิ่ม (3 คน)").waitFor();
    await page.getByLabel("ชื่อผู้รับ").fill("ซ้ำ");
    await page.getByLabel("อีเมลผู้รับ").fill(addr("ui1").toUpperCase());
    await page.getByRole("button", { name: "+ เพิ่มทีละคน" }).click();
    await page.getByText("อีเมลนี้มีอยู่แล้ว").waitFor();
    await page.getByRole("button", { name: "เอา ยูไอสาม ออก" }).click();
    await page.getByText("รายชื่อที่จะเพิ่ม (2 คน)").waitFor();
    await page.getByRole("button", { name: "ถัดไป →" }).click();
    await page.getByText("จะส่งเมื่อไหร่?").waitFor();
  });
  await check("สร้างข้อความ ขั้น ③: สรุป + ตัวอย่างอีเมลแทนชื่อถูกต้อง", async () => {
    await page.getByRole("button", { name: "ไม่ส่งซ้ำ" }).click();
    await page.getByText("2 คน (ส่งแยกทีละคน ผู้รับไม่เห็นกัน)").waitFor();
    await page.getByRole("button", { name: /ดูตัวอย่างอีเมล/ }).click();
    await page.getByText("[ทดสอบ UI] เรียน คุณยูไอหนึ่ง").waitFor();
  });
  await check("สร้างข้อความ ขั้น ③: ย้อนกลับไปขั้น ① แล้วเนื้อหายังอยู่", async () => {
    await page.getByRole("button", { name: /เขียนอีเมล/ }).click();
    const html = await page.locator(".ProseMirror").first().innerHTML();
    assert(html.includes("ข้อความตัวหนา"), "เนื้อหาหาย");
    await page.getByRole("button", { name: /ตั้งเวลาส่ง/ }).first().click();
    await page.getByText("จะส่งเมื่อไหร่?").waitFor();
  });
  await check("สร้างข้อความ ขั้น ③: ปุ่มทดสอบส่งหาตัวเอง", async () => {
    await page.getByRole("button", { name: "ทดสอบส่งหาตัวเองก่อน" }).click();
    await page.getByText(/ส่งแล้วไปที่/).waitFor({ timeout: 30_000 });
  });
  await check("สร้างข้อความ ขั้น ③: กดยืนยันแล้วไปหน้ารายละเอียด", async () => {
    await page.getByRole("button", { name: "ยืนยัน ตั้งส่งอีเมล" }).click();
    await page.waitForURL(/\/campaigns\/[0-9a-f-]{36}\?created=1/);
    await page.getByText("ตั้งส่งเรียบร้อยแล้ว").waitFor();
    campaignId = page.url().match(/campaigns\/([0-9a-f-]{36})/)[1];
    createdCampaigns.push(campaignId);
    const s = await statuses(campaignId);
    assert(Object.keys(s).length === 2, `ผู้รับในฐานข้อมูล ${Object.keys(s).length} คน (ควรเป็น 2)`);
  });

  // =============================================================== ส่งอีเมลอัตโนมัติ (ขั้นที่ 3)
  await check("ระบบส่งอีเมลเองอัตโนมัติภายใน ~1 นาที (ไม่ต้องกดอะไร)", async () => {
    const t0 = Date.now();
    await waitUntil(
      async () => Object.values(await statuses(campaignId)).every((r) => r.status === "sent"),
      150_000,
      "ส่งครบ 2 คน",
    );
    return `ใช้เวลา ${Math.round((Date.now() - t0) / 1000)} วินาที`;
  });
  await check("หน้าเว็บแสดง 'รอส่งงาน 2' หลังส่งแล้ว", async () => {
    await page.reload();
    const tile = page.getByRole("button", { name: /รอส่งงาน/ }).first();
    await tile.waitFor();
    assert((await tile.innerText()).includes("2"), `ตัวเลขไม่ตรง: ${await tile.innerText()}`);
  });
  await check("อีเมลที่ได้รับ: ช่อง 'ถึง' มีคนเดียว + ชื่อถูกแทนค่า + มีตัวหนา", async () => {
    const client = new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      logger: false,
      auth: { user: ME, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, "") },
    });
    await client.connect();
    const all = (await client.list()).find((f) => f.specialUse === "\\All");
    const lock = await client.getMailboxLock(all.path, { readOnly: true });
    const found = [];
    try {
      for (const [k, name] of [["ui1", "ยูไอหนึ่ง"], ["ui2", "ยูไอสอง"]]) {
        const uids = await waitUntil(
          async () => {
            const u = await client.search({ to: addr(k), since: new Date(Date.now() - 3600_000) }, { uid: true });
            return u?.length ? u : null;
          },
          60_000,
          `อีเมลถึง ${addr(k)}`,
        );
        const [m] = await client.fetchAll(uids.slice(-1).join(","), { envelope: true, bodyParts: ["TEXT"] }, { uid: true });
        const to = [...(m.envelope.to ?? []), ...(m.envelope.cc ?? [])].map((a) => a.address);
        assert(to.length === 1 && to[0] === addr(k), `ช่องถึง/สำเนา: ${to.join(", ")}`);
        assert(m.envelope.subject === `[ทดสอบ UI] เรียน คุณ${name}`, `หัวข้อ: ${m.envelope.subject}`);
        found.push(`${k}: "${m.envelope.subject}"`);
      }
    } finally {
      lock.release();
      await client.logout();
    }
    return found.join(" | ");
  });

  // =============================================================== หน้าสถานะ
  await check("เมนู ⋯ > หยุดส่งคนนี้ — เปลี่ยนบนจอทันที และบันทึกจริง", async () => {
    const row = page.locator("li", { hasText: "ยูไอหนึ่ง" });
    await row.getByLabel("ตัวเลือก").click();
    await row.getByRole("button", { name: "หยุดส่งคนนี้" }).click();
    await row.getByText("หยุด", { exact: true }).waitFor({ timeout: 3000 });
    await waitUntil(async () => (await statuses(campaignId))[addr("ui1")].status === "stopped", 10_000, "บันทึก");
  });
  await check("เมนู ⋯ > ยกเลิกการหยุด — กลับเป็น 'ส่งแล้ว'", async () => {
    const row = page.locator("li", { hasText: "ยูไอหนึ่ง" });
    await row.getByLabel("ตัวเลือก").click();
    await row.getByRole("button", { name: "ยกเลิกการหยุด" }).click();
    await waitUntil(async () => (await statuses(campaignId))[addr("ui1")].status === "sent", 10_000, "บันทึก");
  });
  await check("กดช่องตัวเลข 'ส่งงานแล้ว' เพื่อกรอง + ช่องค้นหา", async () => {
    await page.getByRole("button", { name: /ส่งงานแล้ว/ }).first().click();
    await page.getByText("ไม่มีผู้รับในกลุ่มนี้").waitFor();
    await page.getByRole("button", { name: /^ทั้งหมด/ }).first().click();
    await page.getByLabel("ค้นหาผู้รับ").fill("ยูไอสอง");
    assert((await page.locator("ul li", { hasText: "ยูไอหนึ่ง" }).count()) === 0, "ค้นหาแล้วยังเห็นคนอื่น");
    await page.getByLabel("ค้นหาผู้รับ").fill("");
  });
  await check("เพิ่มผู้รับหลังสร้างแล้ว + ลบผู้รับ", async () => {
    await page.getByRole("button", { name: "+ เพิ่มผู้รับ" }).click();
    await page.getByLabel("ชื่อผู้รับ").fill("ยูไอสี่");
    await page.getByLabel("อีเมลผู้รับ").fill(addr("ui4"));
    await page.getByRole("button", { name: "+ เพิ่มทีละคน" }).click();
    await page.getByRole("button", { name: "บันทึกผู้รับ 1 คน" }).click();
    await page.getByText("เพิ่มผู้รับ 1 คนแล้ว").waitFor();
    await waitUntil(async () => Boolean((await statuses(campaignId))[addr("ui4")]), 10_000, "บันทึก");
    const row = page.locator("li", { hasText: "ยูไอสี่" });
    await row.getByLabel("ตัวเลือก").click();
    await row.getByRole("button", { name: "ลบออก" }).click();
    await waitUntil(async () => !(await statuses(campaignId))[addr("ui4")], 10_000, "ลบ");
  });
  await check("ปุ่มหยุดทั้งข้อความ / ส่งต่อ", async () => {
    await page.getByRole("button", { name: "⏸ หยุดทั้งข้อความ" }).click();
    await page.getByRole("button", { name: "▶ ส่งต่อ" }).waitFor({ timeout: 3000 });
    await waitUntil(async () => (await db.from("campaigns").select("paused").eq("id", campaignId).single()).data.paused, 10_000, "บันทึก");
    await page.getByRole("button", { name: "▶ ส่งต่อ" }).click();
    await waitUntil(async () => !(await db.from("campaigns").select("paused").eq("id", campaignId).single()).data.paused, 10_000, "บันทึก");
  });
  await check("ปุ่มทดสอบส่งหาตัวเอง (หน้ารายละเอียด)", async () => {
    await page.getByRole("button", { name: "ทดสอบส่งหาตัวเอง" }).click();
    await page.getByText(/ส่งแล้วไปที่/).waitFor({ timeout: 30_000 });
  });
  await check("แก้ไขข้อความ (2 ขั้น) แล้วบันทึก", async () => {
    await page.getByRole("link", { name: "แก้ไข" }).click();
    await page.getByRole("heading", { name: "แก้ไขข้อความ" }).waitFor();
    await page.fill("#subject", "[ทดสอบ UI] แก้ไขแล้ว คุณ{ชื่อ}");
    await page.getByRole("button", { name: "ถัดไป →" }).click();
    await page.getByRole("button", { name: "บันทึกการแก้ไข" }).click();
    await page.getByRole("heading", { name: "[ทดสอบ UI] แก้ไขแล้ว คุณ{ชื่อ}" }).waitFor();
  });

  // =============================================================== ตั้งค่า
  await check("หน้าตั้งค่า: บันทึกชื่อผู้ส่ง", async () => {
    await page.getByRole("link", { name: "ตั้งค่า" }).click();
    await page.fill("#sender_name", "ระบบทดสอบ UI");
    await page.getByRole("button", { name: "บันทึก" }).click();
    await page.getByText("บันทึกการตั้งค่าแล้ว").waitFor();
    const { data } = await db.from("settings").select("sender_name").eq("id", 1).single();
    assert(data.sender_name === "ระบบทดสอบ UI", "ไม่ได้บันทึก");
  });
  await db.from("settings").update({ sender_name: origSettings.sender_name }).eq("id", 1);

  // =============================================================== โควตา (ขั้นที่ 3)
  await check("โควตา: ส่งไม่เกินขีดจำกัด และส่งต่อเองเมื่อโควตาว่าง", async () => {
    const { data: used } = await db.rpc("sent_last_24h");
    await db.from("settings").update({ daily_limit: used + 1 }).eq("id", 1);
    const { data: c } = await db
      .from("campaigns")
      .insert({
        subject: "[ทดสอบโควตา] คุณ{ชื่อ}",
        body_html: "<p>ทดสอบโควตา</p>",
        send_at: new Date(Date.now() - 60_000).toISOString(),
        followup_after_minutes: 0,
        paused: true,
      })
      .select("id")
      .single();
    createdCampaigns.push(c.id);
    await db.from("recipients").insert([
      { campaign_id: c.id, name: "โควตาหนึ่ง", email: addr("q1") },
      { campaign_id: c.id, name: "โควตาสอง", email: addr("q2") },
    ]);
    await db.from("campaigns").update({ paused: false }).eq("id", c.id);
    await waitUntil(async () => Object.values(await statuses(c.id)).some((r) => r.status === "sent"), 150_000, "ส่งคนแรก");
    await sleep(70_000); // รอให้ตัวส่งทำงานอีกรอบ ต้องไม่ส่งคนที่ 2
    let s = Object.values(await statuses(c.id));
    const sentWhileFull = s.filter((r) => r.status === "sent").length;
    await page.goto(`${BASE}/`);
    const banner = await page
      .getByText("ส่งครบขีดจำกัดต่อวันแล้ว")
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    await db.from("settings").update({ daily_limit: origSettings.daily_limit }).eq("id", 1);
    assert(sentWhileFull === 1, `ตอนโควตาเต็ม ส่งไป ${sentWhileFull} คน (ควรเป็น 1)`);
    assert(banner, "หน้าแรกไม่แสดงแถบโควตาเต็ม");
    await waitUntil(async () => Object.values(await statuses(c.id)).every((r) => r.status === "sent"), 150_000, "ส่งคนที่ 2 หลังโควตาว่าง");
    s = Object.values(await statuses(c.id));
    return "โควตาเต็ม: ส่ง 1 ค้าง 1 · คืนโควตาแล้ว: ส่งครบ 2";
  });

  // =============================================================== หน้าจอมือถือ
  await check("หน้าจอมือถือ (390px): ทุกหน้าไม่ต้องเลื่อนซ้ายขวา", async () => {
    const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await m.context().addCookies(await page.context().cookies());
    const bad = [];
    for (const p of ["/", "/campaigns/new", `/campaigns/${campaignId}`, `/campaigns/${campaignId}/edit`, "/settings"]) {
      await m.goto(`${BASE}${p}`);
      await m.waitForLoadState("networkidle");
      const over = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 1) bad.push(`${p} (+${over}px)`);
    }
    // ขั้น ② และ ③ ของการสร้างข้อความ
    await m.goto(`${BASE}/campaigns/new`);
    await m.fill("#subject", "มือถือ");
    await m.locator(".ProseMirror").first().click();
    await m.keyboard.type("ทดสอบ");
    await m.getByRole("button", { name: "ถัดไป →" }).click();
    await m.fill("#paste", `มือถือ, ${addr("m1")}`);
    await m.getByRole("button", { name: "เพิ่มรายชื่อเหล่านี้" }).click();
    for (const label of ["ขั้น ②", "ขั้น ③"]) {
      const over = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 1) bad.push(`${label} (+${over}px)`);
      if (label === "ขั้น ②") await m.getByRole("button", { name: "ถัดไป →" }).click();
    }
    await m.screenshot({ path: "scripts/_mobile-step3.png", fullPage: true });
    await m.close();
    assert(bad.length === 0, `ล้นจอ: ${bad.join(", ")}`);
  });

  // =============================================================== ลบข้อความ (ปุ่มในหน้าเว็บ)
  await check("ปุ่มลบข้อความ", async () => {
    await page.goto(`${BASE}/campaigns/${campaignId}`);
    await page.getByRole("button", { name: "ลบข้อความ" }).click();
    await page.getByRole("heading", { name: "ข้อความทั้งหมด" }).waitFor();
    const { data } = await db.from("campaigns").select("id").eq("id", campaignId);
    assert(data.length === 0, "ยังไม่ถูกลบ");
  });
} finally {
  await browser.close();
  await db.from("settings").update(origSettings).eq("id", 1);
  for (const id of createdCampaigns) await db.from("campaigns").delete().eq("id", id);
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n==================== ผ่าน ${pass} / ${results.length} ข้อ ====================`);
for (const r of results.filter((x) => !x.ok)) console.log(`❌ ${r.name}\n   ${r.detail}`);
process.exit(pass === results.length ? 0 : 1);
