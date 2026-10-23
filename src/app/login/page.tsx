import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "เข้าสู่ระบบ" };

export default function LoginPage() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">ระบบส่งอีเมลอัตโนมัติ</h1>
        <p className="mt-1 text-sm text-slate-500">กรุณาใส่รหัสผ่านเพื่อเข้าใช้งาน</p>
        <LoginForm />
      </div>
    </main>
  );
}
