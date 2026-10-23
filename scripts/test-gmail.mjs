// ทดสอบว่าเข้าสู่ระบบ Gmail SMTP ได้ (ไม่ส่งอีเมล): npm run test:gmail
import nodemailer from "nodemailer";

const user = process.env.GMAIL_USER;
const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
if (!user || !pass) {
  console.error("❌ ไม่พบ GMAIL_USER หรือ GMAIL_APP_PASSWORD ใน .env.local");
  process.exit(1);
}

const transport = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: { user, pass },
  connectionTimeout: 10_000,
});

try {
  await transport.verify();
  console.log(`✅ เข้าสู่ระบบ Gmail ได้ (${user})`);
} catch (err) {
  if (err.code === "EAUTH") {
    console.error("❌ เข้าสู่ระบบไม่ได้: อีเมลหรือ App Password ไม่ถูกต้อง");
  } else {
    console.error("❌ เชื่อมต่อ Gmail ไม่ได้:", err.code ?? "", err.message);
  }
  process.exitCode = 1;
} finally {
  transport.close();
}
