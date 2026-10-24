"use client";

import { useState } from "react";

const COLORS = ["#6366f1", "#8b5cf6", "#a855f7", "#ec4899", "#10b981", "#f59e0b", "#38bdf8"];

/** ฉลองเล็กๆ ตอนตั้งส่งสำเร็จ (เล่นครั้งเดียว ~3 วินาที, ปิดเองถ้าผู้ใช้ตั้งค่าลดการเคลื่อนไหว) */
export function Confetti({ pieces = 70 }: { pieces?: number }) {
  // สุ่มครั้งเดียวตอนสร้าง component (ไม่สุ่มใหม่ทุกครั้งที่ render)
  const [items] = useState(() =>
    Array.from({ length: pieces }, (_, i) => ({
      left: Math.random() * 100,
      drift: (Math.random() - 0.5) * 240,
      delay: Math.random() * 0.6,
      dur: 2.2 + Math.random() * 1.6,
      color: COLORS[i % COLORS.length],
      round: Math.random() > 0.6,
    })),
  );
  return (
    <div aria-hidden>
      {items.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={
            {
              left: `${p.left}vw`,
              background: p.color,
              borderRadius: p.round ? "999px" : "2px",
              "--drift": `${p.drift}px`,
              "--delay": `${p.delay}s`,
              "--dur": `${p.dur}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
