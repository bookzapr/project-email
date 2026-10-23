// ด่านแรก: ทุกหน้าต้องล็อกอินก่อน (ยกเว้นหน้าล็อกอินและ API ของ cron ซึ่งใช้ secret token แยก)
// หมายเหตุ: ทุกหน้า/Server Action ยังเรียก requireAuth() ซ้ำอีกชั้นเสมอ
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export function proxy(request: NextRequest) {
  if (!verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/((?!login|api/cron|_next/static|_next/image|favicon.ico).*)"],
};
