import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ให้มือถือในวง Wi-Fi เดียวกันเปิดทดสอบตอนพัฒนาได้ (มีผลเฉพาะ npm run dev)
  allowedDevOrigins: ["192.168.*.*"],
  cacheComponents: true,
  partialPrefetching: true,
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
