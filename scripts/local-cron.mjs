// ตัวตั้งเวลาสำหรับทดสอบบนเครื่อง: เรียก /api/cron/tick ทุก 1 นาที (แทน cron-job.org)
// ใช้คู่กับ npm run dev:  npm run cron:local
const url = process.env.CRON_URL ?? "http://localhost:3000/api/cron/tick";
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("❌ ไม่พบ CRON_SECRET ใน .env.local");
  process.exit(1);
}

async function tick() {
  const time = new Date().toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" });
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${secret}` } });
    const body = await res.json().catch(() => ({}));
    const rp = body.replies;
    if (body.replyError) {
      console.log(`${time}  ❌ ตรวจกล่องจดหมายไม่ได้: ${body.replyError}`);
    } else if (rp && (rp.replied || rp.noFile || rp.bounced)) {
      console.log(`${time}  📥 ส่งงานกลับ ${rp.replied} · ตอบแต่ไม่มีไฟล์ ${rp.noFile} · เด้งกลับ ${rp.bounced}`);
    }
    if (!res.ok || !body.ok) {
      console.log(`${time}  ❌ ${res.status} ${body.error ?? ""}`);
    } else if (body.claimed > 0 || body.stopReason) {
      console.log(
        `${time}  ✉️ ส่ง ${body.sent} · ผิดพลาด ${body.failed} · ลองใหม่ ${body.willRetry} · ค้าง ${body.skipped}` +
          (body.stopReason ? ` · ⚠️ ${body.stopReason}` : ""),
      );
    } else {
      console.log(`${time}  ✓ ไม่มีอีเมลถึงเวลาส่ง`);
    }
  } catch (err) {
    console.log(`${time}  ❌ เรียกไม่ได้ (เปิด npm run dev อยู่หรือเปล่า?) ${err.message}`);
  }
}

console.log(`⏱  ตัวตั้งเวลาทดสอบ: เรียก ${url} ทุก 1 นาที (กด Ctrl+C เพื่อหยุด)`);
await tick();
setInterval(tick, 60_000);
