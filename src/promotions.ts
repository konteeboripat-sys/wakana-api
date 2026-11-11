// โปรโมชัน: ตรวจฟอร์ม — ฟังก์ชันล้วน (เทสด้วย node --test ได้)
// ช่องตามหน้า promotion ของเว็บเดิม: ชื่อ · Enable · Start date · Expire date
// + Promotion Settime: Start time · End time (ช่วงเวลาในแต่ละวัน) · Promotion Monday: ใช้ได้เฉพาะวันจันทร์

export const PROMOTION_KINDS = { normal: 'Promotion', settime: 'Promotion Settime', monday: 'Promotion Monday' } as const;
export type PromotionKind = keyof typeof PROMOTION_KINDS;

export interface PromotionInput {
  name: string;
  enabled: 0 | 1;
  start_date: string; // 'YYYY-MM-DD'
  end_date: string;
  start_time: string; // 'HH:MM:SS' · โปรปกติ = 00:00:00
  end_time: string;
}

export interface PromotionRow extends PromotionInput {
  id: number;
  /** ตั้งตอนสร้าง เปลี่ยนไม่ได้ (เว็บเดิมแยกหน้ากัน) */
  kind: PromotionKind;
  created_at: string;
  updated_at: string;
  /** อยู่ในถังขยะตั้งแต่เมื่อไร · null = ยังไม่ลบ */
  deleted_at: string | null;
}

export const PROMOTION_FIELD_LABELS: Record<keyof PromotionInput, string> = {
  name: 'Promotion name',
  enabled: 'Enable',
  start_date: 'Start date',
  end_date: 'Expire date',
  start_time: 'Start time',
  end_time: 'End time',
};

export const ALL_DAY = '00:00:00';
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/** 'YYYY-MM-DD' ที่เป็นวันจริง (เว็บเดิมมี 1969-12-31 จากวันที่ว่าง — ไม่รับ) */
export function isValidDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** 'HH:MM' หรือ 'HH:MM:SS' (ค่าของ <input type="time">) → 'HH:MM:SS' · null ถ้าไม่ใช่เวลา */
export function normalizeTime(raw: string): string | null {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!m) return null;
  const [h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  if (h > 23 || mi > 59 || s > 59) return null;
  return `${m[1]}:${m[2]}:${String(s).padStart(2, '0')}`;
}

/** '00:00:00'–'00:00:00' = ทั้งวัน */
export function timeRangeLabel(p: Pick<PromotionInput, 'start_time' | 'end_time'>): string {
  return p.start_time === ALL_DAY && p.end_time === ALL_DAY ? 'ทั้งวัน' : `${p.start_time.slice(0, 5)}–${p.end_time.slice(0, 5)} น.`;
}

export type PromotionFormResult = { ok: true; value: PromotionInput } | { ok: false; errors: Partial<Record<keyof PromotionInput, string>> };

export function parsePromotionForm(form: Record<string, string | undefined>, kind: PromotionKind = 'normal'): PromotionFormResult {
  const errors: Partial<Record<keyof PromotionInput, string>> = {};
  const name = (form.name ?? '').replace(CONTROL_CHARS, '').trim();
  if (!name) errors.name = 'กรอกชื่อโปรโมชัน';
  else if (name.length > 200) errors.name = 'ยาวเกิน 200 ตัวอักษร';

  const start_date = (form.start_date ?? '').trim();
  const end_date = (form.end_date ?? '').trim();
  if (!isValidDate(start_date)) errors.start_date = 'เลือกวันเริ่ม';
  if (!isValidDate(end_date)) errors.end_date = 'เลือกวันหมดอายุ';
  else if (!errors.start_date && end_date < start_date) errors.end_date = 'วันหมดอายุต้องไม่ก่อนวันเริ่ม';

  // โปรปกติไม่มีช่วงเวลา · Settime: ว่าง = 00:00:00 (ทั้งวัน เหมือนข้อมูลเว็บเดิม)
  let start_time = ALL_DAY;
  let end_time = ALL_DAY;
  if (kind === 'settime') {
    const st = normalizeTime(form.start_time || ALL_DAY);
    const et = normalizeTime(form.end_time || ALL_DAY);
    if (st === null) errors.start_time = 'เวลาไม่ถูกต้อง';
    if (et === null) errors.end_time = 'เวลาไม่ถูกต้อง';
    if (st !== null && et !== null) {
      const allDay = st === ALL_DAY && et === ALL_DAY;
      if (!allDay && et <= st) errors.end_time = 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม (ข้ามเที่ยงคืนไม่ได้ · 00:00–00:00 = ทั้งวัน)';
      start_time = st;
      end_time = et;
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, enabled: form.enabled === '1' ? 1 : 0, start_date, end_date, start_time, end_time } };
}

export function diffPromotion(before: PromotionInput, after: PromotionInput): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const key of Object.keys(PROMOTION_FIELD_LABELS) as (keyof PromotionInput)[]) {
    if (before[key] !== after[key]) out[key] = [before[key], after[key]];
  }
  return out;
}

/** สถานะตามวันที่ (วันไทย) — ใช้แสดงในรายการ */
export function promotionPeriod(p: Pick<PromotionInput, 'start_date' | 'end_date'>, today: string): 'upcoming' | 'running' | 'ended' {
  if (today < p.start_date) return 'upcoming';
  if (today > p.end_date) return 'ended';
  return 'running';
}
