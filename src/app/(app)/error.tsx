"use client";

import Link from "next/link";
import { useEffect } from "react";

/** หน้าที่ขึ้นแทนจอขาวเมื่อเกิดข้อผิดพลาดที่ไม่คาดคิด (เช่น ฐานข้อมูลไม่ตอบชั่วคราว) */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest = (error as { digest?: string } | null)?.digest;
  return (
    <div className="card fade-up mx-auto max-w-lg py-10 text-center">
      <div className="text-5xl">😵‍💫</div>
      <h1 className="mt-3 text-xl font-bold text-emerald-950">เกิดข้อผิดพลาดชั่วคราว</h1>
      <p className="mt-2 text-sm text-slate-600">
        อาจเป็นเพราะอินเทอร์เน็ตหรือฐานข้อมูลไม่ตอบชั่วครู่ ข้อมูลของคุณไม่หาย — ลองใหม่อีกครั้ง
        <br />
        การส่งอีเมลอัตโนมัติยังทำงานตามปกติ
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <button type="button" onClick={() => retry()} className="btn-primary">
          🔄 ลองใหม่
        </button>
        <Link href="/" className="btn">
          กลับหน้าแรก
        </Link>
      </div>
      {digest && <p className="mt-4 text-xs text-slate-400">รหัสอ้างอิง: {digest}</p>}
    </div>
  );
}
