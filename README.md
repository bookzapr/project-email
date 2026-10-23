# ระบบส่งอีเมลอัตโนมัติ + ส่งติดตามซ้ำ

เว็บ: https://project-email.vercel.app · รายละเอียดความต้องการ: [SPEC.md](SPEC.md)

## ระบบทำงานอย่างไร

```
cron-job.org (ทุก 1 นาที) ──► Vercel /api/cron/tick
                                ├─ 1) อ่านกล่องจดหมาย (IMAP): ใครส่งงานกลับ / อีเมลไหนเด้งกลับ
                                └─ 2) ส่งอีเมลที่ถึงเวลา (SMTP) ทีละไม่เกิน 10 ฉบับ
                                      อีเมลส่งซ้ำ: ส่งเฉพาะเมื่อข้อ 1 สำเร็จ
Supabase (ฐานข้อมูล) ◄──── หน้าเว็บ (ล็อกอินด้วย ADMIN_PASSWORD)
```

## งานดูแลที่อาจต้องทำ

| เรื่อง | ทำที่ไหน |
|---|---|
| เปลี่ยนเป็นอีเมลบริษัท (Google Workspace) | Vercel > Settings > Environment Variables: แก้ `GMAIL_USER`, `GMAIL_APP_PASSWORD` แล้ว Redeploy · หน้าเว็บ > ตั้งค่า: ขีดจำกัดต่อวันเป็น 1500 |
| เปลี่ยนรหัสผ่านเข้าเว็บ | Vercel: แก้ `ADMIN_PASSWORD` แล้ว Redeploy (ทุกเครื่องจะถูกออกจากระบบ) |
| App Password ถูกลบ / เปลี่ยนรหัส Google | สร้าง App Password ใหม่ แล้วแก้ `GMAIL_APP_PASSWORD` ใน Vercel + `.env.local` |
| หน้าแรกขึ้นแถบแดง "ระบบส่งอัตโนมัติไม่ได้ทำงาน" | ดู cron-job.org ว่างานยังเปิดอยู่และผลเป็น 200 |
| หน้าแรกขึ้นแถบแดง "ส่งอีเมลไม่ได้" / "ตรวจการส่งงานกลับไม่ได้" | ส่วนใหญ่เป็นเรื่อง App Password หรือ IMAP ถูกปิด |

แก้โค้ดแล้ว `git push` — Vercel จะ deploy ใหม่ให้อัตโนมัติ

## คำสั่งบนเครื่อง (สำหรับพัฒนา/ทดสอบ)

```
npm run dev          เปิดเว็บทดสอบที่ http://localhost:3000
npm run cron:local   ตัวตั้งเวลาจำลองบนเครื่อง (ใช้คู่กับ dev)
npm run test:db      ทดสอบฐานข้อมูล
npm run test:gmail   ทดสอบล็อกอิน Gmail
node --env-file=.env.local scripts/e2e-ui.mjs        ทดสอบหน้าเว็บ + การส่ง (ต้องเปิด dev + cron:local)
node --env-file=.env.local scripts/e2e-replies.mjs   ทดสอบตรวจส่งงานกลับ + ส่งซ้ำ (ใช้กับเว็บจริงได้)
```

ฐานข้อมูล: รันไฟล์ใน `supabase/migrations/` ตามลำดับใน Supabase > SQL Editor (รันซ้ำได้)
