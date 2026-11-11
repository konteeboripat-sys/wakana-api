// เวลาไทย (UTC+7 ไม่มี DST) แทนด้วย "wall ms" = มิลลิวินาทีที่อ่านด้วย getUTC* แล้วได้วัน/เวลาไทย
// Worker รันเป็น UTC ⇒ ห้ามใช้ getHours()/new Date(y,m,d) ตรง ๆ — ใช้ฟังก์ชันในไฟล์นี้แทน

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const pad2 = (n: number) => String(n).padStart(2, '0');

export function toWallMs(utcMs: number): number {
  return utcMs + BANGKOK_OFFSET_MS;
}

/** 'YYYY-MM-DDTHH:MM' (ค่าของ <input type="datetime-local">) → wall ms · null ถ้าไม่ใช่วันเวลาจริง */
export function parseWallTime(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (h > 23 || mi > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(ms);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return ms;
}

export function formatWallTime(wallMs: number): string {
  const d = new Date(wallMs);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** wall ms → '26 ก.ย. 69 เวลา 12:30' (รูปเดียวกับข้อความ LINE ของตะกร้า) */
export function formatThaiDateTime(wallMs: number): string {
  const d = new Date(wallMs);
  const beYear = String(d.getUTCFullYear() + 543).slice(-2);
  return `${d.getUTCDate()} ${THAI_MONTHS[d.getUTCMonth()]} ${beYear} เวลา ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** 'YYYY-MM-DD' → '26 ก.ย. 69' */
export function formatThaiDate(date: string): string {
  const ms = parseWallTime(`${date}T00:00`);
  return ms === null ? date : formatThaiDateTime(ms).replace(/ เวลา .*$/, '');
}

/** ISO UTC (created_at) → ข้อความเวลาไทย */
export function formatIsoAsThai(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : formatThaiDateTime(toWallMs(ms));
}

export function minutesOfDay(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}

/**
 * เวลารับที่เร็วที่สุดที่เลือกได้ — ตรรกะเดียวกับ earliestWanted ใน wakana-site/src/cart/cart-core.js
 * now + lead ปัดขึ้นทีละ 5 นาที แล้วดันเข้าช่วงเวลาทำการ
 */
export function earliestWanted(nowWallMs: number, leadMinutes: number, open: number, close: number): number {
  let t = Math.floor((nowWallMs + leadMinutes * MINUTE_MS) / MINUTE_MS) * MINUTE_MS;
  const rem = new Date(t).getUTCMinutes() % 5;
  if (rem) t += (5 - rem) * MINUTE_MS;
  const dayStart = Math.floor(t / DAY_MS) * DAY_MS;
  const mod = (t - dayStart) / MINUTE_MS;
  if (mod < open) return dayStart + open * MINUTE_MS;
  if (mod > close) return dayStart + DAY_MS + open * MINUTE_MS;
  return t;
}

/** 'YYYY-MM-DD' (วันไทย) → ช่วง ISO UTC [start, end) สำหรับกรอง created_at */
export function thaiDayRangeIso(date: string): { start: string; end: string } | null {
  const wall = parseWallTime(`${date}T00:00`);
  if (wall === null) return null;
  const startUtc = wall - BANGKOK_OFFSET_MS;
  return { start: new Date(startUtc).toISOString(), end: new Date(startUtc + DAY_MS).toISOString() };
}

/** วันนี้ตามเวลาไทย 'YYYY-MM-DD' */
export function thaiToday(nowUtcMs: number): string {
  return formatWallTime(toWallMs(nowUtcMs)).slice(0, 10);
}
