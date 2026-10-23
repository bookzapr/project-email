"use client";

import { useOptimistic, useState, useTransition } from "react";
import type { FormState } from "@/lib/types";

export function PauseButton({ paused, onToggle }: { paused: boolean; onToggle: (next: boolean) => Promise<FormState> }) {
  const [shown, setShown] = useOptimistic(paused);
  const [, start] = useTransition();
  return (
    <button
      type="button"
      className="btn"
      onClick={() =>
        start(async () => {
          setShown(!shown);
          await onToggle(!shown);
        })
      }
    >
      {shown ? "▶ ส่งต่อ" : "⏸ หยุดทั้งข้อความ"}
    </button>
  );
}

export function TestButton({ onTest }: { onTest: () => Promise<FormState> }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<FormState>(null);
  return (
    <>
      <button
        type="button"
        className="btn"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setResult(null);
            setResult(await onTest());
          })
        }
      >
        {pending ? "กำลังส่งทดสอบ..." : "ทดสอบส่งหาตัวเอง"}
      </button>
      {result?.error && <p className="alert-error basis-full">{result.error}</p>}
      {result?.message && <p className="alert-ok basis-full">{result.message}</p>}
    </>
  );
}

export function DeleteButton({ onDelete }: { onDelete: () => Promise<void> }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn-danger"
      disabled={pending}
      onClick={() => {
        if (window.confirm("ลบข้อความนี้และรายชื่อผู้รับทั้งหมด? ย้อนกลับไม่ได้")) start(() => onDelete());
      }}
    >
      {pending ? "กำลังลบ..." : "ลบข้อความ"}
    </button>
  );
}
