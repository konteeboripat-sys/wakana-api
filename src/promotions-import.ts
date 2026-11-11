// แปลงโปรโมชันเว็บเดิม (ไฟล์ dump MySQL ของ wakana_db: ตาราง tb_promotion) → คำสั่ง SQL สำหรับ `wrangler d1 execute --file`
// ฟังก์ชันล้วน (เทสได้) · ใช้ผ่าน scripts/import-promotions.mjs
//
// เทียบช่อง:
//   promotion_id → id (เลขเดิม — หน้ารายการ/ลิงก์ตรงกับหลังบ้านเดิม) · promotion_name → name · promotion_enable → enabled
//   startDate / endDate → start_date / end_date · startDate 1969-12-31 (ค่าว่างของเว็บเดิม) → วันที่แก้ล่าสุด
//   promotion_type_id 11 = Settime (startTime/endTime) · 12 = Monday · อื่น ๆ = Promotion ปกติ
//   ช่องอื่น (รูป คำอธิบาย SEO กติกา) ยังไม่มีในตารางใหม่ — ไม่นำเข้า
// รันซ้ำได้: id ซ้ำ = ข้าม (INSERT OR IGNORE) ไม่ทับที่พนักงานแก้ไปแล้ว

import { bangkokToIso, parseInserts, type SqlValue } from './orders-import.ts';
import type { PromotionKind } from './promotions.ts';

export interface LegacyPromotion {
  id: number;
  name: string;
  enabled: 0 | 1;
  kind: PromotionKind;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  updated_at: string;
}

export interface PromotionsImportResult {
  promotions: LegacyPromotion[];
  skipped: { id: string; reason: string }[];
  adjusted: { id: number; reason: string }[];
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const validDate = (s: string) => DATE.test(s) && s > '2000-01-01';
const TIME = /^\d{2}:\d{2}:\d{2}$/;

export const KIND_BY_TYPE: Record<number, PromotionKind> = { 11: 'settime', 12: 'monday' };

const str = (v: SqlValue | undefined) => (v === null || v === undefined ? '' : String(v)).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s{2,}/g, ' ').trim();

export function promotionsFromDump(dump: string): PromotionsImportResult {
  const promotions: LegacyPromotion[] = [];
  const skipped: PromotionsImportResult['skipped'] = [];
  const adjusted: PromotionsImportResult['adjusted'] = [];
  for (const r of parseInserts(dump, 'tb_promotion')) {
    const id = Number(r.promotion_id);
    const name = str(r.promotion_name).slice(0, 200);
    if (!Number.isInteger(id) || id < 1) {
      skipped.push({ id: str(r.promotion_id), reason: 'รหัสไม่ถูกต้อง' });
      continue;
    }
    if (!name) {
      skipped.push({ id: String(id), reason: 'ไม่มีชื่อ' });
      continue;
    }
    const updated_at = bangkokToIso(str(r.last_update)) ?? new Date(0).toISOString();
    const lastUpdateDate = new Date(Date.parse(updated_at) + 7 * 3600 * 1000).toISOString().slice(0, 10);
    let end_date = str(r.endDate);
    let start_date = str(r.startDate);
    if (!validDate(end_date)) {
      adjusted.push({ id, reason: `Expire date "${end_date}" อ่านไม่ได้ → ใช้วันที่แก้ล่าสุด ${lastUpdateDate}` });
      end_date = lastUpdateDate;
    }
    if (!validDate(start_date)) {
      start_date = lastUpdateDate <= end_date ? lastUpdateDate : end_date;
      adjusted.push({ id, reason: `Start date "${str(r.startDate)}" (ค่าว่างของเว็บเดิม) → ${start_date}` });
    }
    if (end_date < start_date) {
      adjusted.push({ id, reason: `Expire date ${end_date} ก่อน Start date → ใช้ ${start_date} ทั้งคู่` });
      end_date = start_date;
    }
    const kind = KIND_BY_TYPE[Number(r.promotion_type_id)] ?? 'normal';
    const time = (v: SqlValue | undefined) => (TIME.test(str(v)) && kind === 'settime' ? str(v) : '00:00:00');
    promotions.push({ id, name, enabled: Number(r.promotion_enable) === 1 ? 1 : 0, kind, start_date, end_date, start_time: time(r.startTime), end_time: time(r.endTime), updated_at });
  }
  return { promotions, skipped, adjusted };
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export const IMPORT_ACTOR = 'เว็บเดิม (นำเข้า)';

export function toSql(promotions: LegacyPromotion[]): string {
  const out: string[] = [];
  for (const p of promotions) {
    out.push(
      `INSERT OR IGNORE INTO promotions (id, name, enabled, kind, start_date, end_date, start_time, end_time, created_at, updated_at) VALUES (${p.id}, ${q(p.name)}, ${p.enabled}, ${q(p.kind)}, ${q(p.start_date)}, ${q(p.end_date)}, ${q(p.start_time)}, ${q(p.end_time)}, ${q(p.updated_at)}, ${q(p.updated_at)});`
    );
    out.push(
      `INSERT INTO promotion_events (promotion_id, action, changes, actor, at) SELECT ${p.id}, 'create', '{}', ${q(IMPORT_ACTOR)}, ${q(p.updated_at)} WHERE NOT EXISTS (SELECT 1 FROM promotion_events WHERE promotion_id = ${p.id} AND actor = ${q(IMPORT_ACTOR)});`
    );
  }
  return out.join('\n') + '\n';
}
