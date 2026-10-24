// ทดสอบความปลอดภัยแบบอัตโนมัติ (~2 นาที) — เปิด 2FA ชั่วคราว แล้วปิดคืนตอนจบ
// ใช้กับเว็บบนเครื่อง:  node --env-file=.env.local scripts/e2e-security.mjs
// ใช้กับเว็บจริง:       (PowerShell) $env:E2E_URL="https://project-email.vercel.app"; node --env-file=.env.local scripts/e2e-security.mjs
import { createClient } from "@supabase/supabase-js";
import { ImapFlow } from "imapflow";
import { chromium } from "playwright";
import { createHmac } from "node:crypto";

const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const PASSWORD = process.env.ADMIN_PASSWORD;
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const clock = () => new Date().toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" });
const results = [];
async function check(name, fn) {
  try {
    const d = await fn();
    results.push(true);
    console.log(`${clock()}  ✅ ${name}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    results.push(false);
    console.log(`${clock()}  ❌ ${name} — ${e.message.split("\n")[0]}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

// ---- TOTP (สำเนาย่อของ src/lib/totp.ts ไว้คำนวณรหัสแทนแอปมือถือ) ----
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32(s) {
  let bits = 0, v = 0;
  const out = [];
  for (const ch of s.replace(/\s/g, "").toUpperCase()) {
    v = (v << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((v >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totp(secret, offset = 0) {
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = createHmac("sha1", b32(secret)).update(c).digest();
  const o = h[h.length - 1] & 0xf;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}

const { data: s0 } = await db.from("settings").select("*").eq("id", 1).single();
const has008 = s0.totp_enabled !== undefined;
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("dialog", (d) => d.accept());
const cspErrors = [];
page.on("console", (m) => /Content Security Policy|Refused to/.test(m.text()) && cspErrors.push(m.text()));
page.setDefaultTimeout(15_000);
let secret = null;
let recovery = [];

/** ล็อกอินแบบคนจริง: ใส่รหัสผ่าน → (ถ้าเปิด 2FA) ช่องรหัส 6 หลักเด้งขึ้น → ใส่รหัส */
async function login(code) {
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  if (code !== undefined) {
    await page.locator("#code").waitFor();
    await page.locator("#code").fill(code);
    await page.click("button[type=submit]");
  }
}

try {
  await check("Security headers ครบ (CSP, กันฝังเว็บ, nosniff, HSTS ...)", async () => {
    const r = await fetch(`${BASE}/login`);
    const need = ["content-security-policy", "x-frame-options", "x-content-type-options", "referrer-policy", "permissions-policy"];
    if (BASE.startsWith("https")) need.push("strict-transport-security");
    const missing = need.filter((h) => !r.headers.get(h));
    assert(!missing.length, "ขาด: " + missing.join(", "));
    assert(!r.headers.get("x-powered-by"), "ยังบอกว่าใช้ Next.js (x-powered-by)");
  });
  await check("เข้าทุกหน้า/API โดยไม่ล็อกอิน หรือ cookie ปลอม/แบบเก่า → ถูกปฏิเสธ", async () => {
    const bad = [];
    for (const [p, cookie] of [
      ["/", ""],
      ["/settings", ""],
      ["/campaigns/00000000-0000-0000-0000-000000000000/export", ""],
      ["/", "pe_session=v2.9999999999999.1.fakesig"],
      ["/", "pe_session=v1.9999999999999.fakesig"],
    ]) {
      const r = await fetch(BASE + p, { redirect: "manual", headers: cookie ? { cookie } : {} });
      if (![307, 401].includes(r.status)) bad.push(`${p} ${r.status}`);
    }
    const c = await fetch(`${BASE}/api/cron/tick`);
    if (c.status !== 401) bad.push(`cron ${c.status}`);
    assert(!bad.length, bad.join(", "));
  });
  await check("ล็อกอินปกติได้ + ไม่มีอะไรถูก CSP บล็อก", async () => {
    await login();
    await page.getByRole("heading", { name: "ข้อความทั้งหมด" }).waitFor();
    await page.goto(`${BASE}/campaigns/new`);
    await page.locator(".ProseMirror").first().waitFor();
    assert(!cspErrors.length, cspErrors[0]);
  });

  if (!has008) {
    await check("หน้าตั้งค่าแจ้งให้รัน SQL 008", async () => {
      await page.goto(`${BASE}/settings`);
      await page.getByText(/008_security\.sql/).first().waitFor();
      return "ยังไม่รัน SQL 008 — ข้ามการทดสอบ 2FA";
    });
  } else {
    await check("เปิด 2FA: แสดง QR + คีย์ → ใส่รหัส → ได้รหัสสำรอง 8 ชุด", async () => {
      await page.goto(`${BASE}/settings`);
      await page.getByRole("button", { name: /เปิดใช้งาน 2FA/ }).click();
      await page.getByAltText(/QR/).waitFor();
      secret = (await page.locator("li code").first().innerText()).replace(/\s/g, "");
      await page.getByLabel("รหัส 6 หลัก").fill(totp(secret));
      await page.getByRole("button", { name: "ยืนยันและเปิดใช้" }).click();
      await page.locator("ul.font-mono li").first().waitFor();
      recovery = await page.locator("ul.font-mono li").allInnerTexts();
      assert(recovery.length === 8, `ได้ ${recovery.length} ชุด`);
      const { data } = await db.from("settings").select("totp_enabled,totp_secret_enc").eq("id", 1).single();
      assert(data.totp_enabled && !data.totp_secret_enc.includes(secret), "ไม่ได้เปิด หรือ secret ไม่ได้เข้ารหัส");
      await page.getByRole("button", { name: "จดแล้ว" }).click();
      return "secret ในฐานข้อมูลถูกเข้ารหัส";
    });
    await check("ล็อกอินด้วยรหัสผ่านอย่างเดียว / รหัส 2FA ผิด → เข้าไม่ได้", async () => {
      await ctx.clearCookies();
      await login();
      await page.getByText("กรุณาใส่รหัส 6 หลัก").waitFor();
      assert(page.url().includes("/login"), "เข้าไปได้ทั้งที่ไม่มีรหัส 2FA!");
      await login("000000");
      await page.getByText("รหัสยืนยันไม่ถูกต้อง").waitFor();
      assert(page.url().includes("/login"), "เข้าไปได้!");
    });
    await check("ล็อกอินด้วยรหัสผ่าน + รหัส 6 หลักถูก → เข้าได้", async () => {
      await new Promise((r) => setTimeout(r, 1000));
      await login(totp(secret, 1)); // ช่วงถัดไป (รหัสช่วงปัจจุบันถูกใช้ไปตอนเปิด 2FA แล้ว)
      await page.getByRole("heading", { name: "ข้อความทั้งหมด" }).waitFor();
    });
    await check("ล็อกอินด้วยรหัสสำรอง → เข้าได้ และใช้ซ้ำไม่ได้", async () => {
      await ctx.clearCookies();
      await login(recovery[0]);
      await page.getByRole("heading", { name: "ข้อความทั้งหมด" }).waitFor();
      await ctx.clearCookies();
      await login(recovery[0]);
      await page.getByText("รหัสยืนยันไม่ถูกต้อง").waitFor();
    });
    await check("บันทึกการใช้งานแสดงการเปิด 2FA / ล็อกอิน / ใส่รหัสผิด", async () => {
      await login(recovery[2]); // รหัส TOTP ช่วงถัดๆ ไปอยู่นอกหน้าต่าง ±1 จึงใช้รหัสสำรองแทน
      await page.getByRole("heading", { name: "ข้อความทั้งหมด" }).waitFor();
      await page.goto(`${BASE}/settings`);
      for (const t of ["เปิดยืนยันตัวตน 2 ขั้น", "ล็อกอินสำเร็จ", "ใส่รหัสผิด", "ใช้รหัสสำรองล็อกอิน"]) {
        await page.getByText(t).first().waitFor();
      }
    });
    await check("ออกจากระบบทุกเครื่อง → cookie เดิมใช้ไม่ได้ทันที", async () => {
      const old = (await ctx.cookies()).find((c) => c.name === "pe_session").value;
      await page.getByRole("button", { name: "ออกจากระบบทุกเครื่อง" }).click();
      await page.waitForURL(/\/login/);
      const r = await fetch(`${BASE}/settings`, { headers: { cookie: `pe_session=${old}` }, redirect: "manual" });
      const body = await r.text();
      assert(r.status === 307 || body.includes('id="password"') || !body.includes("ความปลอดภัย"), `cookie เดิมยังใช้ได้ (${r.status})`);
    });
    await check("เดารหัสผิด 5 ครั้ง → ถูกล็อก 15 นาที (เฉพาะ IP นี้)", async () => {
      await db.from("login_failures").delete().gte("id", 0);
      for (let i = 0; i < 5; i++) {
        await page.goto(`${BASE}/login`);
        await page.waitForLoadState("networkidle");
        await page.fill("#password", "wrong-" + i);
        await page.click("button[type=submit]");
        await page.locator(".alert-error").waitFor();
      }
      await login();
      await page.getByText(/หลายครั้งเกินไป/).waitFor();
      await db.from("login_failures").delete().gte("id", 0); // ปลดล็อก
    });
    await check("ได้อีเมลแจ้งเตือน: ล็อกอินใหม่ + มีคนเดารหัส", async () => {
      const client = new ImapFlow({
        host: "imap.gmail.com",
        port: 993,
        secure: true,
        logger: false,
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, "") },
      });
      await client.connect();
      const all = (await client.list()).find((f) => f.specialUse === "\\All");
      const lock = await client.getMailboxLock(all.path, { readOnly: true });
      try {
        const want = ["มีการล็อกอินเข้าเว็บ", "มีคนพยายามเดารหัสผ่าน"];
        const end = Date.now() + 60_000;
        let got = [];
        while (Date.now() < end) {
          const u = await client.search({ since: new Date(Date.now() - 3600_000) }, { uid: true });
          const msgs = u?.length ? await client.fetchAll(u.slice(-40).join(","), { envelope: true }, { uid: true }) : [];
          got = want.filter((w) => msgs.some((m) => m.envelope.subject?.includes(w)));
          if (got.length === want.length) break;
          await new Promise((r) => setTimeout(r, 4000));
        }
        assert(got.length === want.length, "ไม่พบ: " + want.filter((w) => !got.includes(w)).join(", "));
      } finally {
        lock.release();
        await client.logout();
      }
    });
    await check("ปิด 2FA (ต้องใส่รหัส) → กลับเป็นปกติ", async () => {
      await login(recovery[3]);
      await page.getByRole("heading", { name: "ข้อความทั้งหมด" }).waitFor();
      await page.goto(`${BASE}/settings`);
      await page.getByLabel("รหัสยืนยันเพื่อปิด 2FA").fill(recovery[1]);
      await page.getByRole("button", { name: "ปิด 2FA" }).click();
      await page.getByText("⚠️ ปิดอยู่").waitFor();
    });
  }
} finally {
  // คืนค่าเดิมเสมอ (ถ้าเจ้าของเปิด 2FA ไว้ก่อนทดสอบ จะไม่ไปแตะ)
  if (has008 && !s0.totp_enabled) {
    await db
      .from("settings")
      .update({ totp_enabled: false, totp_secret_enc: null, totp_pending_enc: null, totp_last_step: null, totp_recovery: [] })
      .eq("id", 1);
  }
  await db.from("login_failures").delete().gte("id", 0);
  await browser.close();
}

const pass = results.filter(Boolean).length;
console.log(`\n==================== ผ่าน ${pass} / ${results.length} ข้อ ====================`);
process.exit(pass === results.length ? 0 : 1);
