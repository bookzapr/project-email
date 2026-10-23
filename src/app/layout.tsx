import type { Metadata, Viewport } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

const notoThai = Noto_Sans_Thai({
  variable: "--font-thai",
  subsets: ["thai", "latin"],
});

export const metadata: Metadata = {
  title: { default: "ระบบส่งอีเมลอัตโนมัติ", template: "%s · ส่งอีเมลอัตโนมัติ" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: ส่วนเสริมเบราว์เซอร์บางตัว (เช่น Tricentis Tosca) แอบเติม attribute ที่ <html>
    <html lang="th" className={`${notoThai.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
