import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const supabase = process.env.SUPABASE_URL ?? "";

// Content-Security-Policy: อนุญาตให้หน้าเว็บโหลดสคริปต์/รูป/การเชื่อมต่อจากแหล่งที่จำเป็นเท่านั้น
// - รูปในเนื้อหาอีเมล + อัปโหลดไฟล์ ไปที่ Supabase โดยตรง
// - Next.js ใช้สคริปต์แบบ inline จึงต้องอนุญาต 'unsafe-inline' (ผู้ใช้ทุกคนต้องล็อกอินก่อนอยู่แล้ว)
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabase}`,
  "font-src 'self' data:",
  `connect-src 'self' ${supabase}${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" }, //               ห้ามฝังเว็บนี้ในเว็บอื่น (กันหลอกให้กด)
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // ให้มือถือในวง Wi-Fi เดียวกันเปิดทดสอบตอนพัฒนาได้ (มีผลเฉพาะ npm run dev)
  allowedDevOrigins: ["192.168.*.*"],
  poweredByHeader: false,
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
