// ทดสอบหน้าเว็บ + การส่งอีเมลแบบอัตโนมัติด้วยเบราว์เซอร์จริง (ใช้เวลา ~6 นาที)
// ต้องมีตัวตั้งเวลาทำงานอยู่: cron-job.org (เว็บจริง) หรือ npm run cron:local (บนเครื่อง)
// ใช้กับเว็บบนเครื่อง:  node --env-file=.env.local scripts/e2e-ui.mjs
// ใช้กับเว็บจริง:       (PowerShell) $env:E2E_URL="https://project-email.vercel.app"; node --env-file=.env.local scripts/e2e-ui.mjs
import { createClient } from "@supabase/supabase-js";
import { ImapFlow } from "imapflow";
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

const { data: settingsRow } = await db.from("settings").select("*").eq("id", 1).single();
const has006 = settingsRow.signature_html !== undefined;
const origSettings = {
  sender_name: settingsRow.sender_name,
  daily_limit: settingsRow.daily_limit,
  ...(has006 ? { signature_html: settingsRow.signature_html } : {}),
};
const createdCampaigns = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("dialog", (d) => d.accept());
page.setDefaultTimeout(15_000);

// ไฟล์ทดสอบ: PDF ชื่อไทย + รูป PNG (สร้างจากการแคปหน้าจอ)
const tmp = join(tmpdir(), "pe-e2e-ui");
mkdirSync(tmp, { recursive: true });
const pdfFile = join(tmp, "เอกสารแนบ.pdf");
writeFileSync(pdfFile, "%PDF-1.4\n%%EOF\n" + "z".repeat(20_000));
await page.setContent('<div id="l" style="width:200px;height:60px;background:#0b5394;color:#fff;font:bold 24px Arial;display:flex;align-items:center;justify-content:center">E2E</div>');
const pngFile = join(tmp, "logo.png");
writeFileSync(pngFile, await page.locator("#l").screenshot());

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
  await check("สร้างข้อความ ขั้น ①: เขียนหัวข้อ + Cc + เนื้อหา + ใส่ชื่อผู้รับ + ตัวหนา", async () => {
    await page.fill("#cc", addr("cc-all"));
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
    await page.getByRole("button", { name: "ตัวหนา" }).click();
  });
  await check("สร้างข้อความ ขั้น ①: สีตัวอักษร + ลิงก์ (หน้าต่าง) + แทรกรูป + แนบไฟล์", async () => {
    const editor = page.locator(".ProseMirror").first();
    await page.keyboard.press("Enter");
    await page.keyboard.type("ข้อความสีแดง");
    await page.keyboard.press("Shift+Home");
    await page.getByRole("button", { name: "สีข้อความ", exact: true }).click();
    await page.getByLabel("สีตัวอักษร #cc0000").click();
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(150);
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "ใส่ลิงก์", exact: true }).click();
    await page.fill("#link-text", "แบบฟอร์มออนไลน์");
    await page.fill("#link-url", "example.com/form");
    await page.getByRole("button", { name: "ตกลง" }).click();
    let chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "แทรกรูปภาพ", exact: true }).click();
    await (await chooser).setFiles(pngFile);
    await editor.locator("img").waitFor({ timeout: 20_000 });
    chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "แนบไฟล์" }).click();
    await (await chooser).setFiles(pdfFile);
    await page.getByLabel("เอาไฟล์ เอกสารแนบ.pdf ออก").waitFor({ timeout: 20_000 });
    const html = await editor.innerHTML();
    assert(/color:\s*(#cc0000|rgb\(204, 0, 0\))/.test(html), "ไม่มีสีแดง");
    assert(/href="https:\/\/example.com\/form"/.test(html), "ไม่มีลิงก์");
    await page.waitForTimeout(400);
    const preview = page.locator("div.email-content").nth(1);
    assert(await preview.locator("img").count(), "ตัวอย่างไม่มีรูป");
    await page.getByText("ไฟล์แนบ 1 ไฟล์").waitFor();
    await page.getByText(`Cc ${addr("cc-all")}`).first().waitFor();
    await page.getByRole("button", { name: "ถัดไป →" }).click();
    await page.getByText("เพิ่มผู้รับด้วยวิธีไหน?").waitFor();
  });
  await check("สร้างข้อความ ขั้น ②: ต้องเตือนถ้ายังไม่มีผู้รับ", async () => {
    await page.getByRole("button", { name: "ถัดไป →" }).click();
    await page.getByText("กรุณาเพิ่มผู้รับอย่างน้อย 1 คน").waitFor();
  });
  await check("สร้างข้อความ ขั้น ②: วางจาก Excel (Ctrl+V เพิ่มทันที) + CC เฉพาะคน + บรรทัดผิดถูกแจ้ง", async () => {
    const box = page.getByLabel("วางรายชื่อ");
    await box.click();
    // จำลองการกด Ctrl+V จาก Excel (คั่นด้วย Tab)
    await box.evaluate((el, text) => {
      const dt = new DataTransfer();
      dt.setData("text", text);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, `ยูไอหนึ่ง\t${addr("ui1")}\t${addr("cc-one")}\nยูไอสอง\t${addr("ui2")}\nผิดรูปแบบ\tabc@def`);
    await page.getByText("รายชื่อผู้รับ 2 คน").waitFor();
    await page.getByText("รูปแบบอีเมลไม่ถูกต้อง").waitFor();
    assert(await page.getByLabel("CC แถว 1").first().inputValue() === addr("cc-one"), "CC เฉพาะคนไม่ขึ้นในตาราง");
  });
  await check("สร้างข้อความ ขั้น ②: พิมพ์เอง + แก้ในตาราง + เอาออก + กันอีเมลซ้ำ", async () => {
    await page.getByRole("button", { name: /พิมพ์เอง/ }).click();
    await page.getByLabel("ชื่อผู้รับ").fill("ยูไอสาม");
    await page.getByLabel("อีเมลผู้รับ").fill(addr("ui3"));
    await page.getByRole("button", { name: "+ เพิ่มทีละคน" }).click();
    await page.getByText("รายชื่อผู้รับ 3 คน").waitFor();
    await page.getByLabel("ชื่อผู้รับ").fill("ซ้ำ");
    await page.getByLabel("อีเมลผู้รับ").fill(addr("ui1").toUpperCase());
    await page.getByRole("button", { name: "+ เพิ่มทีละคน" }).click();
    await page.getByText("อีเมลนี้มีอยู่ในรายชื่อแล้ว").waitFor();
    // แก้ชื่อในตาราง
    const nameCell = page.getByLabel("ชื่อแถว 3");
    await nameCell.fill("ยูไอสาม แก้แล้ว");
    await nameCell.press("Enter");
    assert(await nameCell.inputValue() === "ยูไอสาม แก้แล้ว", "แก้ชื่อในตารางไม่ได้");
    await page.getByRole("button", { name: "เอา ยูไอสาม แก้แล้ว ออก" }).click();
    await page.getByText("รายชื่อผู้รับ 2 คน").waitFor();
  });
  await check("สร้างข้อความ ขั้น ②: แท็บรายชื่อเดิม (โหลดได้ + กันซ้ำ)", async () => {
    await page.getByRole("button", { name: /รายชื่อเดิม/ }).click();
    await page
      .getByText(/ใช้รายชื่อชุดเดิมทั้งหมด|ยังไม่มีรายชื่อเดิม|ค้นหาชื่อหรืออีเมล/)
      .first()
      .waitFor({ timeout: 15_000 })
      .catch(async () => page.getByPlaceholder("🔍 ค้นหาชื่อหรืออีเมล").waitFor());
    await page.getByRole("button", { name: "ถัดไป →" }).click();
    await page.getByText("จะส่งเมื่อไหร่?").waitFor();
  });
  await check("สร้างข้อความ ขั้น ③: ตัวเลือก 'แนบไฟล์ไปกับอีเมลส่งซ้ำด้วย'", async () => {
    await page.getByRole("button", { name: "หลัง 1 วัน" }).click();
    const box = page.getByRole("checkbox", { name: /แนบไฟล์ \(1 ไฟล์\) ไปกับอีเมลส่งซ้ำด้วย/ });
    await box.waitFor();
    const enabled = await box.isEnabled();
    assert(enabled === has006, `ช่องติ๊ก ${enabled ? "เปิด" : "ปิด"} แต่ SQL 006 ${has006 ? "รันแล้ว" : "ยังไม่รัน"}`);
    return has006 ? "ใช้ได้ (รัน SQL 006 แล้ว)" : "ปิดไว้พร้อมข้อความแนะนำให้รัน SQL 006";
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
  await check("อีเมลที่ได้รับ: 'ถึง' คนเดียว + Cc ถูกต้อง + ชื่อถูกแทนค่า + ไฟล์แนบ + รูปฝังในอีเมล", async () => {
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
        const [m] = await client.fetchAll(uids.slice(-1).join(","), { envelope: true, bodyStructure: true }, { uid: true });
        const to = (m.envelope.to ?? []).map((a) => a.address);
        assert(to.length === 1 && to[0] === addr(k), `ช่องถึง: ${to.join(", ")}`);
        const cc = (m.envelope.cc ?? []).map((a) => a.address).sort();
        const expectCc = (k === "ui1" ? [addr("cc-all"), addr("cc-one")] : [addr("cc-all")]).sort();
        assert(JSON.stringify(cc) === JSON.stringify(expectCc), `Cc: ${cc.join(", ")} (ควรเป็น ${expectCc.join(", ")})`);
        assert(m.envelope.subject === `[ทดสอบ UI] เรียน คุณ${name}`, `หัวข้อ: ${m.envelope.subject}`);
        const parts = [];
        const walk = (n) => (n.childNodes ? n.childNodes.forEach(walk) : parts.push(n));
        walk(m.bodyStructure);
        assert(
          parts.some((p) => p.disposition === "attachment" && p.dispositionParameters?.filename === "เอกสารแนบ.pdf"),
          "ไม่มีไฟล์แนบ เอกสารแนบ.pdf",
        );
        assert(parts.some((p) => p.type.startsWith("image/") && p.id), "ไม่มีรูปฝังในอีเมล");
        found.push(`${k}: "${m.envelope.subject}"`);
      }
    } finally {
      lock.release();
      await client.logout();
    }
    return found.join(" | ");
  });

  await check("โควตานับรวม Cc (Gmail นับทุกที่อยู่อีเมล)", async () => {
    const { data } = await db
      .from("send_log")
      .select("to_email,address_count,kind")
      .eq("campaign_id", campaignId)
      .eq("kind", "initial");
    const byEmail = Object.fromEntries(data.map((r) => [r.to_email, r.address_count]));
    assert(byEmail[addr("ui1")] === 3, `ui1 นับ ${byEmail[addr("ui1")]} (ควรเป็น 3 = ถึง 1 + Cc 2)`);
    assert(byEmail[addr("ui2")] === 2, `ui2 นับ ${byEmail[addr("ui2")]} (ควรเป็น 2 = ถึง 1 + Cc 1)`);
    return "ui1 = 3 ที่อยู่, ui2 = 2 ที่อยู่";
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
    await page.getByRole("button", { name: /พิมพ์เอง/ }).click();
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
  await check("ดาวน์โหลดรายชื่อเป็น Excel (CSV ภาษาไทย) ตามกลุ่มที่กรอง", async () => {
    const all = await page.request.get(`${BASE}/campaigns/${campaignId}/export?filter=all`);
    assert(all.ok(), `สถานะ ${all.status()}`);
    const buf = await all.body();
    assert(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf, "ไม่มี BOM (Excel จะแสดงภาษาไทยเพี้ยน)");
    const text = buf.toString("utf8");
    assert(text.includes("ชื่อ,อีเมล,สถานะ"), "หัวตารางไม่ถูกต้อง");
    assert(text.includes("ยูไอหนึ่ง") && text.includes("ยูไอสอง"), "ไม่มีรายชื่อ");
    const replied = (await (await page.request.get(`${BASE}/campaigns/${campaignId}/export?filter=replied`)).text()).trim();
    assert(replied.split(/\r?\n/).length === 1, "กลุ่ม 'ส่งงานแล้ว' ควรมีแต่หัวตาราง");
    const anon = await fetch(`${BASE}/campaigns/${campaignId}/export`, { redirect: "manual" });
    assert(anon.status !== 200, "คนที่ไม่ได้ล็อกอินดาวน์โหลดได้!");
    await page.getByRole("link", { name: "⬇ Excel" }).waitFor();
    return `${text.trim().split(/\r?\n/).length - 1} แถว · ไม่ล็อกอินโหลดไม่ได้ (${anon.status})`;
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
  await check("หน้าตั้งค่า: ลายเซ็นท้ายอีเมล", async () => {
    await page.goto(`${BASE}/settings`);
    if (!has006) {
      await page.getByText(/ต้องรัน SQL ไฟล์/).waitFor();
      return "ยังไม่รัน SQL 006 — แสดงข้อความแนะนำถูกต้อง";
    }
    const editor = page.locator(".ProseMirror").first();
    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("ลายเซ็นทดสอบ E2E");
    await page.getByRole("button", { name: "บันทึก", exact: true }).click();
    await page.getByText("บันทึกการตั้งค่าแล้ว").waitFor();
    const { data } = await db.from("settings").select("signature_html").eq("id", 1).single();
    assert(data.signature_html.includes("ลายเซ็นทดสอบ E2E"), "ไม่ได้บันทึกลายเซ็น");
    await page.goto(`${BASE}/campaigns/new`);
    await page.getByText("ลายเซ็นทดสอบ E2E").waitFor();
    return "บันทึกได้ และแสดงในตัวอย่างอีเมล";
  });
  if (has006) await db.from("settings").update({ signature_html: origSettings.signature_html }).eq("id", 1);

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
    await m.close();
    assert(bad.length === 0, `ล้นจอ: ${bad.join(", ")}`);
  });

  // =============================================================== ลบข้อความ (ปุ่มในหน้าเว็บ)
  await check("ปุ่มลบข้อความ + ไฟล์แนบ/รูปใน Storage ถูกลบด้วย", async () => {
    const { data: c } = await db.from("campaigns").select("attachments,body_html").eq("id", campaignId).single();
    const attPath = c.attachments[0]?.path;
    const imgPath = c.body_html.match(/email-images\/([^"]+)"/)?.[1];
    await page.goto(`${BASE}/campaigns/${campaignId}`);
    await page.getByRole("button", { name: "ลบข้อความ" }).click();
    await page.getByRole("heading", { name: "ข้อความทั้งหมด" }).waitFor();
    const { data } = await db.from("campaigns").select("id").eq("id", campaignId);
    assert(data.length === 0, "ยังไม่ถูกลบ");
    if (attPath) assert(!(await db.storage.from("attachments").exists(attPath)).data, "ไฟล์แนบยังค้างใน Storage");
    if (imgPath) assert(!(await db.storage.from("email-images").exists(imgPath)).data, "รูปยังค้างใน Storage");
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
