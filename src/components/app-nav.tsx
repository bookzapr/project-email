"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "ข้อความ", match: (p: string) => p === "/" || p.startsWith("/campaigns/") && !p.endsWith("/new") },
  { href: "/campaigns/new", label: "+ ส่งอีเมลใหม่", match: (p: string) => p === "/campaigns/new" },
  { href: "/settings", label: "ตั้งค่า", match: (p: string) => p.startsWith("/settings") },
];

/** เมนูด้านบน — ไฮไลต์หน้าที่เปิดอยู่ (ต้องอยู่ใน <Suspense> เพราะอ่าน URL) */
export function AppNav() {
  return <NavLinks path={usePathname()} />;
}

/** เมนูแบบไม่ไฮไลต์ ใช้แสดงระหว่างรอ */
export function NavLinks({ path }: { path: string }) {
  return (
    <>
      {LINKS.map((l) => {
        const active = l.match(path);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
              active ? "bg-white text-teal-700 shadow" : "text-teal-900/80 hover:bg-white/60 hover:text-teal-900"
            } ${l.href === "/campaigns/new" ? "hidden sm:inline-flex" : ""}`}
          >
            {l.label}
          </Link>
        );
      })}
    </>
  );
}
