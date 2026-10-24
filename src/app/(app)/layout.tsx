import Link from "next/link";
import { Suspense } from "react";
import { AppNav, NavLinks } from "@/components/app-nav";
import { logout } from "../login/actions";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="header-gradient sticky top-0 z-20 border-b border-white/60 shadow-md shadow-teal-900/10">
        <nav className="mx-auto flex max-w-6xl items-center gap-1 px-4 py-2.5 sm:gap-2">
          <Link href="/" className="mr-auto flex items-center gap-2 font-bold text-teal-900">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/70 text-lg shadow-sm ring-1 ring-white">
              ✉️
            </span>
            <span className="hidden text-lg tracking-tight sm:inline">ส่งอีเมลอัตโนมัติ</span>
          </Link>
          <Suspense fallback={<NavLinks path="" />}>
            <AppNav />
          </Suspense>
          <form action={logout}>
            <button className="rounded-full px-3 py-1.5 text-sm text-teal-900/70 transition hover:bg-white/60 hover:text-teal-900">
              ออกจากระบบ
            </button>
          </form>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
      <footer className="pb-6 text-center text-xs text-teal-700/50">ส่งอีเมลอัตโนมัติ · ส่งเอง ตรวจเอง ทวงเอง 🌿</footer>
    </>
  );
}
