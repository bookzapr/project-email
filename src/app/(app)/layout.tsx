import Link from "next/link";
import { Suspense } from "react";
import { AppNav, NavLinks } from "@/components/app-nav";
import { logout } from "../login/actions";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="header-gradient sticky top-0 z-20 shadow-lg shadow-indigo-900/20">
        <nav className="mx-auto flex max-w-6xl items-center gap-1 px-4 py-2.5 sm:gap-2">
          <Link href="/" className="mr-auto flex items-center gap-2 font-bold text-white">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 text-lg ring-1 ring-white/30 backdrop-blur">
              ✉️
            </span>
            <span className="hidden text-lg tracking-tight sm:inline">ส่งอีเมลอัตโนมัติ</span>
          </Link>
          <Suspense fallback={<NavLinks path="" />}>
            <AppNav />
          </Suspense>
          <form action={logout}>
            <button className="rounded-full px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/15 hover:text-white">
              ออกจากระบบ
            </button>
          </form>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
      <footer className="pb-6 text-center text-xs text-indigo-300">ส่งอีเมลอัตโนมัติ · ส่งเอง ตรวจเอง ทวงเอง ✨</footer>
    </>
  );
}
