// ทดสอบอีเมลสรุปประจำวัน (~2 นาที, ต้องรัน SQL 009 แล้ว) — ส่งสรุปเข้ากล่อง GMAIL_USER (หรืออีเมลรับแจ้งเตือน) 2 ฉบับ
// ใช้กับเว็บบนเครื่อง:  node --env-file=.env.local scripts/e2e-digest.mjs
// ใช้กับเว็บจริง:       (PowerShell) $env:E2E_URL="https://project-email.vercel.app"; node --env-file=.env.local scripts/e2e-digest.mjs
import { createClient } from "@supabase/supabase-js";
import { ImapFlow } from "imapflow";
import { chromium } from "playwright";

const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const [local, domain] = process.env.GMAIL_USER.split("@");
const addr = (k) => `${local}+${k}@${domain}`;
const clock = () => new Date().toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const { data: s0 } = await db.from("settings").select("*").eq("id", 1).single();
if (s0.digest_hour === undefined) {
  console.log("⚠️ ยังไม่ได้รัน SQL 009_digest.sql — ข้ามการทดสอบ");
  process.exit(1);
}

/** รอจนอีเมลสรุปที่มีคำว่า `marker` ในเนื้อหาเข้ากล่อง (หลังเวลา since) */
async function waitDigest(since, marker, timeoutMs = 90_000) {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    logger: false,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, "") },
  });
  await client.connect();
  const all = (await client.list()).find((f) => f.specialUse === "\\All");
  try {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const lock = await client.getMailboxLock(all.path, { readOnly: true });
      try {
        const uids = (await client.search({ since: new Date(since - 86400_000) }, { uid: true })) || [];
        const msgs = uids.length
          ? await client.fetchAll(uids.slice(-30).join(","), { envelope: true, internalDate: true, bodyStructure: true }, { uid: true })
          : [];
        for (const m of msgs.reverse()) {
          if (!m.envelope.subject?.includes("สรุปประจำวัน") || m.internalDate.getTime() < since - 5 * 60_000) continue;
          const parts = [];
          const walk = (n) => (n.childNodes ? n.childNodes.forEach(walk) : n.type === "text/plain" && parts.push(n.part || "1"));
          walk(m.bodyStructure);
          for (const p of parts) {
            const { content } = await client.download(String(m.uid), p, { uid: true });
            const chunks = [];
            for await (const c of content) chunks.push(c);
            const text = Buffer.concat(chunks).toString("utf8");
            if (text.includes(marker)) return { subject: m.envelope.subject, text };
          }
        }
      } finally {
        lock.release();
      }
      await sleep(5000);
    }
    throw new Error("ไม่ได้รับอีเมลสรุปภายในเวลาที่กำหนด");
  } finally {
    await client.logout();
  }
}

// ---- ข้อมูลทดสอบ: 1 ข้อความ 3 คน (ส่งงานวันนี้ / ยังไม่ส่ง / ส่งไม่ถึง) ----
const TAG = `ดจ${Date.now() % 100000}`;
const far = new Date(Date.now() + 30 * 86400_000).toISOString();
const { data: camp, error: ce } = await db
  .from("campaigns")
  .insert({ subject: `[ทดสอบสรุป] ${TAG}`, body_html: "<p>x</p>", send_at: far, followup_after_minutes: 60 * 24, paused: true })
  .select("id")
  .single();
if (ce) throw ce;
const now = new Date().toISOString();
const person = (name, email, more) => ({ campaign_id: camp.id, name, email, status: "sent", sent_at: now, replied_at: null, error: null, ...more });
const { error: re } = await db.from("recipients").insert([
  person(`${TAG}-ส่งแล้ว`, addr("dg1"), { status: "replied", replied_at: now }),
  person(`${TAG}-รออยู่`, addr("dg2"), {}),
  person(`${TAG}-เด้ง`, addr("dg3"), { status: "failed", error: "อีเมลเด้งกลับ" }),
]);
if (re) throw re;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(20_000);

try {
  await check("หน้าตั้งค่า: เลือกเวลาส่งสรุป + บันทึกได้", async () => {
    await page.goto(`${BASE}/login`);
    await page.waitForLoadState("networkidle");
    await page.fill("#password", process.env.ADMIN_PASSWORD);
    await page.click("button[type=submit]");
    await page.getByRole("heading", { name: "ข้อความทั้งหมด" }).waitFor();
    await page.goto(`${BASE}/settings`);
    await page.locator("#digest_hour").selectOption("8");
    await page.getByRole("button", { name: "บันทึก", exact: true }).click();
    await page.getByText("บันทึกการตั้งค่าแล้ว").waitFor();
    const { data } = await db.from("settings").select("digest_hour").eq("id", 1).single();
    assert(data.digest_hour === 8, `ในฐานข้อมูลเป็น ${data.digest_hour}`);
  });

  await check("ปุ่ม 'ส่งสรุปตัวอย่างตอนนี้' → ได้อีเมลแยกคนส่งงานแล้ว / ยังไม่ส่ง / มีปัญหา", async () => {
    const t = Date.now();
    await page.getByRole("button", { name: /ส่งสรุปตัวอย่างตอนนี้/ }).click();
    await page.getByText(/ส่งสรุปแล้วไปที่/).waitFor({ timeout: 40_000 });
    const mail = await waitDigest(t, TAG);
    const sec = (title) => mail.text.split("\n").find((l) => l.trim().startsWith(title + ":")) ?? "";
    assert(sec("ส่งงานวันนี้").includes(`${TAG}-ส่งแล้ว`), "ไม่มีคนส่งงานวันนี้");
    assert(sec("ยังไม่ส่ง").includes(`${TAG}-รออยู่`), "ไม่มีคนที่ยังไม่ส่ง");
    assert(sec("มีปัญหา").includes(`${TAG}-เด้ง`), "ไม่มีคนที่มีปัญหา");
    return mail.subject;
  });

  await check("ส่งเองอัตโนมัติเมื่อถึงเวลา และวันละครั้งเท่านั้น", async () => {
    // ตั้งให้ "ถึงเวลาแล้ว" และยังไม่เคยส่งวันนี้ แล้วให้ตัวตั้งเวลาทำงาน
    await db.from("settings").update({ digest_hour: 0, digest_last_date: "2000-01-01" }).eq("id", 1);
    const t = Date.now();
    const tick = () =>
      fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }).then((r) =>
        r.ok ? r.json() : null,
      );
    let first = await tick();
    if (!first) {
      // CRON_SECRET บนเครื่องไม่ตรงกับเว็บจริง → รอ cron-job.org เรียกเอง (ทุก 1 นาที)
      for (let i = 0; i < 30; i++) {
        const { data } = await db.from("settings").select("digest_last_date").eq("id", 1).single();
        if (data.digest_last_date !== "2000-01-01") break;
        await sleep(5000);
      }
    } else {
      assert(String(first.digest).startsWith("ส่งแล้ว"), `ผลรอบแรก: ${first.digest}`);
    }
    await waitDigest(t, TAG);
    const second = await tick();
    if (second) assert(second.digest === "วันนี้ส่งแล้ว", `รอบสองส่งซ้ำ: ${second.digest}`);
    return first ? "รอบแรกส่ง · รอบสองไม่ส่งซ้ำ" : "ส่งโดย cron-job.org";
  });
} finally {
  // คืนค่าเวลาเดิม (วันที่ส่งล่าสุด = วันนี้ จะได้ไม่ส่งซ้ำวันนี้อีก)
  await db.from("settings").update({ digest_hour: s0.digest_hour }).eq("id", 1);
  await db.from("campaigns").delete().eq("id", camp.id);
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n==================== ผ่าน ${passed} / ${results.length} ข้อ ====================`);
process.exit(passed === results.length ? 0 : 1);
