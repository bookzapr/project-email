// ทดสอบขั้นที่ 4 แบบอัตโนมัติ (ต้องเปิดเว็บ + npm run cron:local อยู่)
// สร้างข้อความทดสอบ -> รอระบบส่ง -> วางอีเมลตอบกลับจำลองลงกล่องจดหมาย -> ตรวจผล -> ลบอีเมลจำลองทิ้ง
import { createClient } from "@supabase/supabase-js";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const ME = process.env.GMAIL_USER;
const [local, domain] = ME.split("@");
const addr = (k) => `${local}+e2e${k.toLowerCase()}@${domain}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" });
const log = (s) => console.log(`${now()}  ${s}`);

const FOLLOWUP_MIN = 2;
const PEOPLE = [
  { k: "A", name: "เอ ส่งไฟล์PDF" },
  { k: "B", name: "บี ตอบแต่ไม่แนบ" },
  { k: "C", name: "ซี ไม่ตอบ" },
  { k: "D", name: "ดี ส่งลิงก์Drive" },
  { k: "E", name: "อี มีแค่รูปลายเซ็น" },
];

async function rows(campaignId) {
  const { data } = await db
    .from("recipients")
    .select("name,email,status,message_id,note,reply_files,followup_sent_at,error")
    .eq("campaign_id", campaignId);
  return Object.fromEntries(data.map((r) => [r.email, r]));
}

async function waitFor(label, campaignId, cond, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = await rows(campaignId);
    if (cond(r)) {
      log(`✓ ${label}`);
      return r;
    }
    await sleep(5000);
  }
  log(`✗ หมดเวลารอ: ${label}`);
  return rows(campaignId);
}

// ---------------------------------------------------------------- 1) สร้างข้อความทดสอบ
const { data: c, error } = await db
  .from("campaigns")
  .insert({
    subject: "[ทดสอบระบบอัตโนมัติ] ขอเอกสาร คุณ{ชื่อ}",
    body_html: "<p>เรียน คุณ{ชื่อ}</p><p>อีเมลนี้เป็นการทดสอบระบบอัตโนมัติ</p>",
    followup_body_html: "<p>เรียน คุณ{ชื่อ}</p><p>ขอติดตามเอกสาร (ทดสอบส่งซ้ำ)</p>",
    send_at: new Date(Date.now() - 60_000).toISOString(),
    followup_after_minutes: FOLLOWUP_MIN,
    paused: true,
  })
  .select("id")
  .single();
if (error) throw error;
await db.from("recipients").insert(PEOPLE.map((p) => ({ campaign_id: c.id, name: p.name, email: addr(p.k) })));
await db.from("campaigns").update({ paused: false }).eq("id", c.id);
log(`สร้างข้อความทดสอบแล้ว (id ${c.id}) ผู้รับ 5 คน ส่งซ้ำหลัง ${FOLLOWUP_MIN} นาที`);

// ---------------------------------------------------------------- 2) รอระบบส่งรอบแรก
let r = await waitFor(
  "ระบบส่งอีเมลรอบแรกครบ 5 คน",
  c.id,
  (r) => Object.values(r).every((x) => x.status === "sent" && x.message_id),
  150_000,
);

// ---------------------------------------------------------------- 3) วางอีเมลตอบกลับจำลอง
const composer = nodemailer.createTransport({ streamTransport: true, buffer: true });
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const replyTo = (k) => {
  const x = r[addr(k)];
  return { inReplyTo: x.message_id, references: [x.message_id] };
};
const replies = {
  A: {
    text: "ส่งเอกสารมาครับ",
    attachments: [{ filename: "เอกสาร-ทดสอบ.pdf", content: Buffer.from("%PDF-1.4\n% test file\n"), contentType: "application/pdf" }],
  },
  B: { text: "รับทราบครับ เดี๋ยวส่งให้" },
  D: {
    text: "ไฟล์ใหญ่ ส่งเป็นลิงก์นะครับ https://drive.google.com/file/d/1AbCdEfGhIjK/view?usp=sharing",
    html: '<p>ไฟล์ใหญ่ ส่งเป็นลิงก์นะครับ <a href="https://drive.google.com/file/d/1AbCdEfGhIjK/view?usp=sharing">เอกสาร.zip</a></p>',
  },
  E: {
    html: '<p>รับทราบครับ</p><p>--<br><img src="cid:sig1" width="1" height="1"> บริษัท ทดสอบ</p>',
    attachments: [{ filename: "logo.png", content: tinyPng, cid: "sig1", contentType: "image/png" }],
  },
};

const client = new ImapFlow({
  host: "imap.gmail.com",
  port: 993,
  secure: true,
  logger: false,
  auth: { user: ME, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, "") },
});
await client.connect();
const appendedIds = [];
for (const [k, body] of Object.entries(replies)) {
  const messageId = `<e2e-${k}-${Date.now()}@test.local>`;
  const info = await composer.sendMail({
    from: { name: PEOPLE.find((p) => p.k === k).name, address: addr(k) },
    to: ME,
    subject: `Re: [ทดสอบระบบอัตโนมัติ] ขอเอกสาร`,
    messageId,
    ...replyTo(k),
    ...body,
  });
  await client.append("INBOX", info.message, [], new Date());
  appendedIds.push(messageId);
}
log("วางอีเมลตอบกลับจำลองของ A, B, D, E ลงกล่องจดหมายแล้ว (C ไม่ตอบ)");

// ---------------------------------------------------------------- 4) รอระบบตรวจเจอ
r = await waitFor(
  "ระบบตรวจเจอการตอบกลับ",
  c.id,
  (r) => r[addr("A")].status === "replied" && r[addr("B")].note && r[addr("E")].note,
  150_000,
);

// ---------------------------------------------------------------- 5) รอส่งซ้ำ
r = await waitFor(
  "ระบบส่งซ้ำให้คนที่ยังไม่ส่งงาน",
  c.id,
  (r) => ["B", "C", "E"].every((k) => r[addr(k)].status === "followed_up"),
  (FOLLOWUP_MIN + 3) * 60_000,
);
log("รออีก 70 วินาที เพื่อให้แน่ใจว่าคนที่ส่งงานแล้วไม่ได้รับอีเมลส่งซ้ำ...");
await sleep(70_000);
r = await rows(c.id);

// ---------------------------------------------------------------- 6) ลบอีเมลจำลองทิ้ง
const trash = (await client.list()).find((f) => f.specialUse === "\\Trash");
const all = (await client.list()).find((f) => f.specialUse === "\\All");
let lock = await client.getMailboxLock(all.path);
try {
  for (const id of appendedIds) {
    const uids = await client.search({ header: { "message-id": id } }, { uid: true });
    if (uids?.length) await client.messageMove(uids, trash.path, { uid: true });
  }
} finally {
  lock.release();
}
lock = await client.getMailboxLock(trash.path);
try {
  for (const id of appendedIds) {
    const uids = await client.search({ header: { "message-id": id } }, { uid: true });
    if (uids?.length) await client.messageDelete(uids, { uid: true });
  }
} finally {
  lock.release();
}
await client.logout();
log("ลบอีเมลตอบกลับจำลองทิ้งแล้ว");

// ---------------------------------------------------------------- 7) สรุปผล
const expect = {
  A: { status: "replied", desc: "ตอบกลับแล้ว + มีไฟล์ PDF, ไม่ส่งซ้ำ" },
  B: { status: "followed_up", desc: "หมายเหตุ 'ยังไม่แนบไฟล์' + ได้ส่งซ้ำ" },
  C: { status: "followed_up", desc: "ได้ส่งซ้ำ" },
  D: { status: "replied", desc: "ตอบกลับแล้ว (ลิงก์ Drive), ไม่ส่งซ้ำ" },
  E: { status: "followed_up", desc: "รูปลายเซ็นไม่นับ -> ได้ส่งซ้ำ" },
};
console.log("\n================ ผลทดสอบ ================");
let pass = 0;
for (const p of PEOPLE) {
  const x = r[addr(p.k)];
  const e = expect[p.k];
  let ok = x.status === e.status;
  if (p.k === "A") ok &&= x.reply_files?.some((f) => f.name.endsWith(".pdf")) && !x.followup_sent_at;
  if (p.k === "B") ok &&= /ยังไม่แนบไฟล์/.test(x.note ?? "");
  if (p.k === "D") ok &&= !x.followup_sent_at;
  if (ok) pass++;
  const files = x.reply_files?.map((f) => f.name).join(", ") ?? "";
  console.log(`${ok ? "✅" : "❌"} ${p.k} (${p.name}) คาดว่า: ${e.desc}`);
  console.log(`     ได้: สถานะ=${x.status}${files ? ` ไฟล์=${files}` : ""}${x.note ? ` หมายเหตุ=${x.note}` : ""}${x.followup_sent_at ? " (ส่งซ้ำแล้ว)" : ""}`);
}
const { data: bz } = await db.from("recipients").select("status,error").eq("email", "book@gmail.com");
const bounceOk = bz?.length > 0 && bz.every((b) => b.status === "failed");
console.log(`${bounceOk ? "✅" : "❌"} อีเมลเด้งกลับ (book@gmail.com): ${bz?.map((b) => `${b.status} ${b.error ?? ""}`).join(" | ") || "ไม่พบผู้รับนี้"}`);
console.log(`\nผ่าน ${pass + (bounceOk ? 1 : 0)} / ${PEOPLE.length + 1} ข้อ`);
process.exit(0);
