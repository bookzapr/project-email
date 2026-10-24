"use client";

import { useActionState, useState } from "react";
import { login } from "./actions";

export function LoginForm({ twoFactor }: { twoFactor: boolean }) {
  const [state, action, pending] = useActionState(login, null);
  // ช่องควบคุมเอง: ถ้ารหัส 2 ขั้นผิด รหัสผ่านที่พิมพ์ไว้จะไม่หาย
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const showCode = twoFactor || state?.needCode;

  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label htmlFor="password" className="label">
          รหัสผ่าน
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input"
        />
      </div>
      {showCode && (
        <div>
          <label htmlFor="code" className="label">
            🛡️ รหัส 6 หลักจากแอป Authenticator
          </label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="input text-center text-xl tracking-[0.4em]"
            placeholder="000000"
            maxLength={9}
          />
          <p className="hint">มือถือหาย? ใส่รหัสสำรอง (แบบ xxxx-xxxx) แทนได้</p>
        </div>
      )}
      {state?.error && <p className="alert-error">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "กำลังตรวจสอบ..." : "เข้าสู่ระบบ"}
      </button>
    </form>
  );
}
