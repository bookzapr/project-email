import Link from "next/link";

/** URL ที่ไม่มีอยู่ในเว็บ */
export default function NotFound() {
  return (
    <main className="header-gradient flex min-h-full flex-1 items-center justify-center px-4 py-12">
      <div className="fade-up w-full max-w-sm rounded-3xl bg-white/90 p-7 text-center shadow-2xl shadow-teal-900/15 ring-1 ring-white">
        <div className="text-5xl">🔍</div>
        <h1 className="mt-3 text-xl font-bold text-emerald-950">ไม่พบหน้านี้</h1>
        <p className="mt-2 text-sm text-slate-600">ลิงก์อาจไม่ถูกต้อง</p>
        <Link href="/" className="btn-primary mt-5">
          กลับหน้าแรก
        </Link>
      </div>
    </main>
  );
}
