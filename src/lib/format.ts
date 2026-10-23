// เวลาในฐานข้อมูลเป็น UTC ทั้งหมด — แสดงผลและรับค่าเป็นเวลาไทย (Asia/Bangkok, UTC+7 ไม่มี daylight saving)
const TZ = "Asia/Bangkok";
const BANGKOK_OFFSET = "+07:00";

const dateTimeFmt = new Intl.DateTimeFormat("th-TH", {
  timeZone: TZ,
  day: "numeric",
  month: "short",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** "23 ต.ค. 69 14:30" */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  return dateTimeFmt.format(new Date(iso));
}

/** ISO (UTC) -> ค่าสำหรับ <input type="datetime-local"> เป็นเวลาไทย "2026-10-23T14:30" */
export function toBangkokInput(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 16);
}

/** ค่าจาก <input type="datetime-local"> (เวลาไทย) -> Date หรือ null ถ้าไม่ถูกต้อง */
export function fromBangkokInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(`${value}:00${BANGKOK_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** อีก 1 ชั่วโมงข้างหน้า ปัดเป็นต้นชั่วโมง (ค่าเริ่มต้นของเวลาส่ง) */
export function nextHourIso(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

/** ผ่านมากี่นาทีแล้วนับจากเวลานั้น (null = ไม่เคยมี) */
export function minutesSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
}

export type DelayUnit = "minutes" | "hours" | "days";
export const UNIT_MINUTES: Record<DelayUnit, number> = { minutes: 1, hours: 60, days: 60 * 24 };
export const UNIT_LABEL: Record<DelayUnit, string> = { minutes: "นาที", hours: "ชั่วโมง", days: "วัน" };

/** แปลงจำนวนนาทีกลับเป็นหน่วยที่อ่านง่ายที่สุด เช่น 2880 -> 2 วัน */
export function splitMinutes(total: number): { value: number; unit: DelayUnit } {
  if (total > 0 && total % UNIT_MINUTES.days === 0) return { value: total / UNIT_MINUTES.days, unit: "days" };
  if (total > 0 && total % UNIT_MINUTES.hours === 0) return { value: total / UNIT_MINUTES.hours, unit: "hours" };
  return { value: total, unit: "minutes" };
}

export function describeFollowup(total: number): string {
  if (total <= 0) return "ไม่ส่งซ้ำ";
  const { value, unit } = splitMinutes(total);
  return `ส่งซ้ำหลัง ${value} ${UNIT_LABEL[unit]}`;
}
