// ทดสอบฟีเจอร์เสริม (~1 นาที, ไม่ส่งอีเมลจริง): ทำเครื่องหมายส่งงานเอง · ทำสำเนาข้อความ · สำรองข้อมูล · หน้าแจ้งข้อผิดพลาด
// ใช้กับเว็บบนเครื่อง:  node --env-file=.env.local scripts/e2e-features.mjs
// ใช้กับเว็บจริง:       (PowerShell) $env:E2E_URL="https://project-email.vercel.app"; node --env-file=.env.local scripts/e2e-features.mjs
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const [local, domain] = process.env.GMAIL_USER.split("@");
const addr = (k) => `${local}+${k}@${domain}`;
const clock = () => new Date().toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" });

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push(true);
    console.log(`${clock()}  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    results.push(false);
    console.log(`${clock()}  ❌ ${name} — ${err.message.split("\n")[0]}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const fileExists = async (path) => {
  const { data, error } = await db.storage.from("attachments").info(path);
  return Boolean(data && !error);
};

// ---- ข้อมูลทดสอบ: ข้อความตั้งส่งอีก 30 วัน (ระบบจะไม่ส่งจริง) + ไฟล์แนบ 1 ไฟล์ ----
const SUBJECT = `[ทดสอบฟีเจอร์] ${Date.now()}`;
const filePath = `${randomUUID()}.pdf`;
const fileBody = "%PDF-1.4\n%%EOF\n";
await db.storage.from("attachments").upload(filePath, new Blob([fileBody]), { contentType: "application/pdf" });
const far = new Date(Date.now() + 30 * 86400_000).toISOString();
const { data: camp, error: ce } = await db
  .from("campaigns")
  .insert({
    subject: SUBJECT,
    body_html: "<p>เรียน {ชื่อ}</p>",
    send_at: far,
    followup_after_minutes: 60 * 24,
    attachments: [{ name: "งาน.pdf", path: filePath, size: fileBody.length, type: "application/pdf" }],
    cc_emails: [addr("feat-cc")],
  })
  .select("id")
  .single();
if (ce) throw ce;
const created = [camp.id];
// ทุกแถวต้องมีคอลัมน์ครบเท่ากัน (insert หลายแถว คอลัมน์ที่ขาดจะเป็น null ไม่ใช่ค่าเริ่มต้น)
const person = (name, email, more = {}) => ({ campaign_id: camp.id, name, email, status: "pending", sent_at: null, cc_emails: [], ...more });
const { error: re } = await db.from("recipients").insert([
  person("ฟีเจอร์หนึ่ง", addr("feat1"), { status: "sent", sent_at: new Date().toISOString() }),
  person("ฟีเจอร์สอง", addr("feat2")),
  person("ฟีเจอร์สาม", addr("feat3"), { cc_emails: [addr("feat3-cc")] }),
]);
if (re) throw re;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on("dialog", (d) => d.accept());
page.setDefaultTimeout(15_000);
const row = (name) => page.locator("li").filter({ hasText: name });
const statusOf = async (email) =>
  (await db.from("recipients").select("status,note").eq("campaign_id", camp.id).eq("email", email).single()).data;

try {
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  await page.fill("#password", process.env.ADMIN_PASSWORD);
  await page.click("button[type=submit]");
  await page.getByRole("heading", { name: "ข้อความทั้งหมด" }).waitFor();

  await check("เมนู ⋯ > ทำเครื่องหมายว่าส่งงานแล้ว (ส่งงานทางอื่น)", async () => {
    await page.goto(`${BASE}/campaigns/${camp.id}`);
    await row("ฟีเจอร์หนึ่ง").getByLabel("ตัวเลือก").click();
    await page.getByRole("button", { name: /ทำเครื่องหมายว่าส่งงานแล้ว/ }).click();
    await row("ฟีเจอร์หนึ่ง").getByText("ทำเครื่องหมายเอง").waitFor();
    for (let i = 0; i < 20 && (await statusOf(addr("feat1"))).status !== "replied"; i++) await page.waitForTimeout(500);
    const s = await statusOf(addr("feat1"));
    assert(s.status === "replied" && s.note, `สถานะในฐานข้อมูล: ${s.status}`);
  });

  await check("เมนู ⋯ > ยกเลิก “ส่งงานแล้ว” → กลับไปรอส่งงาน", async () => {
    await row("ฟีเจอร์หนึ่ง").getByLabel("ตัวเลือก").click();
    await page.getByRole("button", { name: /ยกเลิก “ส่งงานแล้ว”/ }).click();
    for (let i = 0; i < 20 && (await statusOf(addr("feat1"))).status !== "sent"; i++) await page.waitForTimeout(500);
    const s = await statusOf(addr("feat1"));
    assert(s.status === "sent" && !s.note, `สถานะในฐานข้อมูล: ${s.status}`);
  });

  await check("เมนู ⋯ ไม่ถูกตัดขอบ และเปิดได้ทีละอัน", async () => {
    await page.reload();
    const btns = page.getByLabel("ตัวเลือก");
    await btns.first().click();
    await btns.last().click();
    assert((await page.getByRole("button", { name: "ลบออก" }).count()) === 1, "มีเมนูเปิดซ้อนกัน");
    const menu = page.getByRole("button", { name: "ลบออก" });
    assert(await menu.isVisible(), "เมนูถูกซ่อน");
    // ปุ่มสุดท้ายในเมนูต้องกดได้จริง (ไม่ถูกกล่องรายชื่อตัด)
    const box = await menu.boundingBox();
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.textContent, [box.x + 10, box.y + box.height / 2]);
    assert(hit?.includes("ลบออก"), "เมนูถูกบัง");
    await page.keyboard.press("Escape");
  });

  let copyId;
  await check("ทำสำเนาข้อความ: เนื้อหา/ไฟล์แนบ/Cc/รายชื่อ ถูกเติมให้ → บันทึกเป็นข้อความใหม่", async () => {
    await page.getByRole("link", { name: /ทำสำเนา/ }).click();
    await page.getByText(/ทำสำเนาจาก/).waitFor();
    assert((await page.locator("#subject").inputValue()) === SUBJECT, "หัวข้อไม่ถูกเติม");
    await page.getByText("งาน.pdf").first().waitFor();
    await page.getByRole("button", { name: "ถัดไป →" }).click();
    await page.getByText("รายชื่อผู้รับ 3 คน").waitFor();
    const ccCells = await page.locator('input[aria-label^="CC แถว"]').evaluateAll((els) => els.map((e) => e.value));
    assert(ccCells.includes(addr("feat3-cc")), "Cc รายคนไม่ขึ้นในตาราง");
    await page.getByRole("button", { name: "ถัดไป →" }).click();
    await page.getByRole("button", { name: /เลือกวันและเวลา/ }).click();
    await page.getByLabel("วันเวลาส่ง (เวลาประเทศไทย)").fill(far.slice(0, 16));
    await page.getByRole("button", { name: "ยืนยัน ตั้งส่งอีเมล" }).click();
    await page.waitForURL((u) => /\/campaigns\/[0-9a-f-]{36}/.test(u.pathname) && !u.pathname.includes(camp.id));
    copyId = page.url().match(/campaigns\/([0-9a-f-]{36})/)[1];
    created.push(copyId);
    const { data: c } = await db.from("campaigns").select("*").eq("id", copyId).single();
    const { data: rs } = await db.from("recipients").select("email,status,cc_emails").eq("campaign_id", copyId);
    assert(c.attachments[0]?.path === filePath, "ไฟล์แนบไม่ถูกคัดลอก");
    assert(c.cc_emails?.[0] === addr("feat-cc"), "Cc ไม่ถูกคัดลอก");
    assert(rs.length === 3 && rs.every((r) => r.status === "pending"), `ผู้รับ ${rs.length} คน`);
    assert(rs.find((r) => r.email === addr("feat3"))?.cc_emails?.[0] === addr("feat3-cc"), "Cc รายคนไม่ถูกคัดลอก");
    return "ข้อความใหม่มีผู้รับ 3 คน สถานะเริ่มต้นใหม่";
  });

  await check("ลบข้อความต้นฉบับ → ไฟล์แนบที่สำเนายังใช้อยู่ต้องไม่หาย", async () => {
    await page.goto(`${BASE}/campaigns/${camp.id}`);
    await page.getByRole("button", { name: "ลบข้อความ" }).click();
    await page.waitForURL(`${BASE}/`);
    assert(await fileExists(filePath), "ไฟล์แนบถูกลบทั้งที่สำเนายังใช้อยู่!");
    await page.goto(`${BASE}/campaigns/${copyId}`);
    await page.getByRole("button", { name: "ลบข้อความ" }).click();
    await page.waitForURL(`${BASE}/`);
    assert(!(await fileExists(filePath)), "ลบสำเนาแล้วไฟล์ไม่ถูกลบ");
    return "ลบสำเนาแล้วไฟล์ถูกลบตามปกติ";
  });

  await check("ดาวน์โหลดข้อมูลสำรอง (JSON) — ไม่มีรหัสลับ · ไม่ล็อกอินโหลดไม่ได้", async () => {
    await page.goto(`${BASE}/settings`);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /ดาวน์โหลดข้อมูลสำรอง/ }).click()]);
    const text = await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
    const j = JSON.parse(text);
    assert(Array.isArray(j.campaigns) && Array.isArray(j.recipients) && j.settings, "รูปแบบไฟล์ไม่ถูกต้อง");
    assert(!Object.keys(j.settings).some((k) => k.startsWith("totp_")), "มีรหัสลับ 2FA หลุดในไฟล์!");
    const r = await fetch(`${BASE}/settings/backup`, { redirect: "manual" });
    assert([307, 401].includes(r.status), `ไม่ล็อกอินได้ ${r.status}`);
    await page.getByText("ดาวน์โหลดข้อมูลสำรอง").last().waitFor(); // บันทึกการใช้งาน
    return `${dl.suggestedFilename()} · ${j.campaigns.length} ข้อความ ${j.recipients.length} ผู้รับ`;
  });

  await check("หน้า 'ไม่พบหน้านี้' ภาษาไทย (ข้อความที่ถูกลบ / ลิงก์ผิด)", async () => {
    await page.goto(`${BASE}/campaigns/${camp.id}`);
    await page.getByText("ไม่พบหน้านี้").waitFor();
    await page.goto(`${BASE}/no-such-page`);
    await page.getByText("ไม่พบหน้านี้").waitFor();
  });
} finally {
  await db.from("campaigns").delete().in("id", created);
  await db.storage.from("attachments").remove([filePath]);
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n==================== ผ่าน ${passed} / ${results.length} ข้อ ====================`);
process.exit(passed === results.length ? 0 : 1);
