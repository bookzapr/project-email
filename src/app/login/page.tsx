import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "เข้าสู่ระบบ" };

export default function LoginPage() {
  return (
    <main className="header-gradient relative flex min-h-full flex-1 items-center justify-center overflow-hidden px-4 py-12">
      {/* วงกลมตกแต่งพื้นหลัง */}
      <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
      <div className="pointer-events-none absolute -right-20 -bottom-24 h-80 w-80 rounded-full bg-fuchsia-300/20 blur-3xl" />
      <div className="fade-up relative w-full max-w-sm rounded-3xl bg-white/95 p-7 shadow-2xl shadow-indigo-950/30 backdrop-blur">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-500 to-violet-600 text-3xl shadow-lg shadow-violet-500/40">
          ✉️
        </div>
        <h1 className="mt-4 text-center text-2xl font-bold text-indigo-950">ระบบส่งอีเมลอัตโนมัติ</h1>
        <p className="mt-1 text-center text-sm text-slate-500">ส่งเอง · ตรวจเอง · ทวงเอง</p>
        <LoginForm />
      </div>
    </main>
  );
}
