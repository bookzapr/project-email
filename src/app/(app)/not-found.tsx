import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card fade-up mx-auto max-w-lg py-10 text-center">
      <div className="text-5xl">🔍</div>
      <h1 className="mt-3 text-xl font-bold text-emerald-950">ไม่พบหน้านี้</h1>
      <p className="mt-2 text-sm text-slate-600">ข้อความนี้อาจถูกลบไปแล้ว หรือลิงก์ไม่ถูกต้อง</p>
      <Link href="/" className="btn-primary mt-5">
        กลับไปหน้าข้อความทั้งหมด
      </Link>
    </div>
  );
}
