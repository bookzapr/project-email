"use client";

import { useState, useTransition } from "react";
import { confirm2fa, disable2fa, logoutAll, start2fa } from "./security-actions";

/** ยืนยันตัวตน 2 ขั้น + ออกจากระบบทุกเครื่อง */
export function SecurityPanel({ enabled, available }: { enabled: boolean; available: boolean }) {
  const [isOn, setIsOn] = useState(enabled);
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  if (!available) {
    return (
      <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
        ยังใช้ไม่ได้ — ต้องรัน SQL ไฟล์ <code>supabase/migrations/008_security.sql</code> ใน Supabase ก่อน
      </p>
    );
  }

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setError(null);
      await fn();
    });

  return (
    <div className="space-y-4">
      {/* ---- 2FA ---- */}
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-semibold text-teal-950">🛡️ ยืนยันตัวตน 2 ขั้น (2FA)</p>
            <p className="text-sm text-slate-600">
              ล็อกอินต้องใช้ทั้งรหัสผ่าน และรหัส 6 หลักจากแอป Google Authenticator บนมือถือ — รหัสผ่านหลุดก็ยังเข้าไม่ได้
            </p>
          </div>
          <span className={`badge ${isOn ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
            {isOn ? "✅ เปิดอยู่" : "⚠️ ปิดอยู่"}
          </span>
        </div>

        {recovery ? (
          <div className="mt-4 space-y-3 rounded-xl bg-white p-4 ring-2 ring-amber-300">
            <p className="font-semibold text-amber-800">🔑 รหัสสำรอง — จดเก็บไว้ที่ปลอดภัยตอนนี้เลย (จะไม่แสดงอีก)</p>
            <p className="text-sm text-slate-600">ใช้แทนรหัส 6 หลักตอนมือถือหาย รหัสละ 1 ครั้ง</p>
            <ul className="grid grid-cols-2 gap-2 font-mono text-lg sm:grid-cols-4">
              {recovery.map((c) => (
                <li key={c} className="rounded-lg bg-slate-100 px-3 py-1.5 text-center">
                  {c}
                </li>
              ))}
            </ul>
            <button type="button" className="btn-primary" onClick={() => setRecovery(null)}>
              จดแล้ว
            </button>
          </div>
        ) : setup ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr]">
            {/* eslint-disable-next-line @next/next/no-img-element -- QR เป็น data URL ที่สร้างฝั่ง server */}
            <img src={setup.qr} alt="QR สำหรับสแกนด้วยแอป Authenticator" className="h-44 w-44 rounded-xl bg-white p-2 ring-1 ring-emerald-200" />
            <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
              <li>
                ติดตั้งแอป <b>Google Authenticator</b> (หรือ Microsoft Authenticator) บนมือถือ
              </li>
              <li>กด “+” แล้วเลือก <b>สแกนคิวอาร์โค้ด</b> สแกนรูปด้านซ้าย</li>
              <li className="break-all">
                สแกนไม่ได้? เลือก “ป้อนคีย์” แล้วพิมพ์: <code className="rounded bg-white px-1">{setup.secret}</code>
              </li>
              <li>
                ใส่รหัส 6 หลักที่แอปแสดง:
                <div className="mt-2 flex gap-2">
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    inputMode="numeric"
                    maxLength={6}
                    className="input w-36 text-center text-xl tracking-[0.3em]"
                    placeholder="000000"
                    aria-label="รหัส 6 หลัก"
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy || code.length < 6}
                    onClick={() =>
                      run(async () => {
                        const res = await confirm2fa(code);
                        if ("error" in res) return setError(res.error);
                        setIsOn(true);
                        setSetup(null);
                        setCode("");
                        setRecovery(res.recoveryCodes);
                      })
                    }
                  >
                    {busy ? "กำลังตรวจ..." : "ยืนยันและเปิดใช้"}
                  </button>
                </div>
              </li>
            </ol>
          </div>
        ) : isOn ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="input w-48"
              placeholder="รหัส 6 หลัก / รหัสสำรอง"
              aria-label="รหัสยืนยันเพื่อปิด 2FA"
            />
            <button
              type="button"
              className="btn-danger"
              disabled={busy || !code}
              onClick={() => {
                if (!window.confirm("ปิดยืนยันตัวตน 2 ขั้น? ความปลอดภัยจะลดลง")) return;
                run(async () => {
                  const res = await disable2fa(code);
                  if (res.error) return setError(res.error);
                  setIsOn(false);
                  setCode("");
                });
              }}
            >
              ปิด 2FA
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn-primary mt-4"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const res = await start2fa();
                if ("error" in res) return setError(res.error);
                setSetup(res);
              })
            }
          >
            {busy ? "กำลังสร้าง..." : "🛡️ เปิดใช้งาน 2FA"}
          </button>
        )}
        {error && <p className="alert-error mt-3">{error}</p>}
      </div>

      {/* ---- ออกจากระบบทุกเครื่อง ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-100 bg-rose-50/40 p-4">
        <div>
          <p className="font-semibold text-teal-950">🚪 ออกจากระบบทุกเครื่อง</p>
          <p className="text-sm text-slate-600">ใช้เมื่อลืมออกจากระบบบนเครื่องอื่น หรือสงสัยว่ามีคนอื่นเข้าใช้</p>
        </div>
        <button
          type="button"
          className="btn-danger"
          disabled={busy}
          onClick={() => {
            if (!window.confirm("ออกจากระบบทุกเครื่อง (รวมเครื่องนี้)?")) return;
            run(async () => {
              const res = await logoutAll();
              if (res && "error" in res) setError(res.error);
            });
          }}
        >
          ออกจากระบบทุกเครื่อง
        </button>
      </div>
    </div>
  );
}
