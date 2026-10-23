import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** ตัวเชื่อมฐานข้อมูลฝั่ง server (ใช้ Secret key — ห้ามใช้ในฝั่ง browser) */
export function db(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) {
      throw new Error("ไม่พบ SUPABASE_URL หรือ SUPABASE_SECRET_KEY ใน Environment Variables");
    }
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}
