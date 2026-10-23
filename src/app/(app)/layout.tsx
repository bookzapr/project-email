import Link from "next/link";
import { logout } from "../login/actions";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <nav className="mx-auto flex max-w-5xl items-center gap-1 px-4 py-2 sm:gap-4">
          <Link href="/" className="mr-auto font-semibold text-slate-900">
            📧 ส่งอีเมลอัตโนมัติ
          </Link>
          <Link href="/" className="rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            ข้อความ
          </Link>
          <Link href="/settings" className="rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            ตั้งค่า
          </Link>
          <form action={logout}>
            <button className="rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100">ออกจากระบบ</button>
          </form>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </>
  );
}
