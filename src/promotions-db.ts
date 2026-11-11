import { diffPromotion, type PromotionInput, type PromotionKind, type PromotionRow } from './promotions.ts';

export interface PromotionFilter {
  kind: PromotionKind;
  name: string; // ค้นบางส่วน
  start: string; // 'YYYY-MM-DD' · '' = ไม่กรอง — เริ่มตั้งแต่วันนี้
  end: string; // หมดอายุไม่เกินวันนี้
  /** true = ดูถังขยะ */
  trash?: boolean;
  /** เลือกโปรตัวเดียว (หน้า Settime: Select Promotion Name) */
  id?: number | null;
  /** '' = ทั้งหมด */
  enabled?: '' | '0' | '1';
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

export async function listPromotions(db: D1Database, f: PromotionFilter): Promise<PromotionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM promotions
       WHERE kind = ?1
         AND (?2 = '' OR name LIKE ?2 ESCAPE '\\')
         AND (?3 = '' OR start_date >= ?3)
         AND (?4 = '' OR end_date <= ?4)
         AND (CASE WHEN ?5 = 1 THEN deleted_at IS NOT NULL ELSE deleted_at IS NULL END)
         AND (?6 IS NULL OR id = ?6)
         AND (?7 = '' OR enabled = CAST(?7 AS INTEGER))
       ORDER BY id
       LIMIT 1000`
    )
    .bind(f.kind, f.name ? `%${escapeLike(f.name)}%` : '', f.start, f.end, f.trash ? 1 : 0, f.id ?? null, f.enabled ?? '')
    .all<PromotionRow>();
  return results;
}

export type PromotionOption = Pick<PromotionRow, 'id' | 'name' | 'enabled' | 'kind'>;

/** ตัวเลือกโปร (หน้าสินค้า/กติกา): ทุกโปรที่ไม่ได้ลบ (ใหม่ก่อน) — โปรที่ปิดก็ต้องเห็น ไม่งั้นของที่ผูกไว้แล้วจะหลุด */
export async function promotionOptions(db: D1Database, kind?: PromotionKind): Promise<PromotionOption[]> {
  const { results } = await db
    .prepare('SELECT id, name, enabled, kind FROM promotions WHERE deleted_at IS NULL AND (?1 IS NULL OR kind = ?1) ORDER BY enabled DESC, id DESC')
    .bind(kind ?? null)
    .all<PromotionOption>();
  return results;
}

/** ชื่อที่แสดงในตัวเลือก: บอกประเภท/สถานะ */
const KIND_SUFFIX: Record<PromotionKind, string> = { normal: '', settime: ' (Settime)', monday: ' (Monday)' };
export const promotionOptionLabel = (p: PromotionOption) => `${p.name}${KIND_SUFFIX[p.kind]}${p.enabled ? '' : ' (ปิดอยู่)'}`;

export async function getPromotion(db: D1Database, id: number): Promise<PromotionRow | null> {
  return db.prepare('SELECT * FROM promotions WHERE id = ?').bind(id).first<PromotionRow>();
}

/** มีอยู่และไม่ได้อยู่ในถังขยะ (ผูกสินค้ากับโปรที่ลบแล้วไม่ได้) */
export async function promotionExists(db: D1Database, id: number): Promise<boolean> {
  return (await db.prepare('SELECT 1 FROM promotions WHERE id = ? AND deleted_at IS NULL').bind(id).first()) !== null;
}

export async function countProductsInPromotion(db: D1Database, id: number): Promise<number> {
  return (await db.prepare('SELECT COUNT(*) AS n FROM products WHERE promotion_id = ? AND deleted_at IS NULL').bind(id).first<number>('n')) ?? 0;
}

/** สินค้าทุกตัวที่ผูกกับโปรนี้ (รวมตัวในถังขยะ — ตอนลบโปรต้องปลดทุกตัว) */
export async function productsInPromotion(db: D1Database, id: number): Promise<{ id: number; name_th: string; deleted_at: string | null }[]> {
  const { results } = await db
    .prepare('SELECT id, name_th, deleted_at FROM products WHERE promotion_id = ? ORDER BY id')
    .bind(id)
    .all<{ id: number; name_th: string; deleted_at: string | null }>();
  return results;
}

/**
 * ย้ายโปรไปถังขยะ + ปลดสินค้าที่ผูกอยู่ ใน transaction เดียว
 * ทุกคำสั่งหลังแรกทำเฉพาะเมื่อโปรถูกลบสำเร็จจริง (deleted_at = เวลานี้) — version ไม่ตรง = ไม่แตะสินค้าเลย
 */
export async function deletePromotion(db: D1Database, id: number, version: string, actor: string, nowIso: string): Promise<boolean> {
  const deletedNow = 'EXISTS (SELECT 1 FROM promotions WHERE id = ? AND deleted_at = ?)';
  const [update] = await db.batch([
    db.prepare('UPDATE promotions SET deleted_at = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND deleted_at IS NULL').bind(nowIso, nowIso, id, version),
    db
      .prepare(
        `INSERT INTO product_events (product_id, action, changes, actor, at)
         SELECT p.id, 'update', json_object('promotion_id', json_array(p.promotion_id, NULL)), ?, ? FROM products p
         WHERE p.promotion_id = ? AND ${deletedNow}`
      )
      .bind(actor, nowIso, id, id, nowIso),
    db.prepare(`UPDATE products SET promotion_id = NULL, updated_at = ? WHERE promotion_id = ? AND ${deletedNow}`).bind(nowIso, id, id, nowIso),
    // กติกาที่ผูกกับโปรนี้: ปลดออก (กติกายังอยู่)
    db
      .prepare(
        `INSERT INTO promotion_rule_events (rule_id, action, changes, actor, at)
         SELECT r.id, 'update', json_object('promotion_id', json_array(r.promotion_id, NULL)), ?, ? FROM promotion_rules r
         WHERE r.promotion_id = ? AND ${deletedNow}`
      )
      .bind(actor, nowIso, id, id, nowIso),
    db.prepare(`UPDATE promotion_rules SET promotion_id = NULL, updated_at = ? WHERE promotion_id = ? AND ${deletedNow}`).bind(nowIso, id, id, nowIso),
    db
      .prepare(`INSERT INTO promotion_events (promotion_id, action, changes, actor, at) SELECT ?, 'delete', '{}', ?, ? WHERE ${deletedNow}`)
      .bind(id, actor, nowIso, id, nowIso),
  ]);
  return (update?.meta.changes ?? 0) === 1;
}

/** กู้คืนจากถังขยะ (ไม่ผูกสินค้ากลับให้ — ต้องผูกใหม่เอง) */
export async function restorePromotion(db: D1Database, id: number, version: string, actor: string, nowIso: string): Promise<boolean> {
  const [update] = await db.batch([
    db.prepare('UPDATE promotions SET deleted_at = NULL, updated_at = ? WHERE id = ? AND updated_at = ? AND deleted_at IS NOT NULL').bind(nowIso, id, version),
    db.prepare(`INSERT INTO promotion_events (promotion_id, action, changes, actor, at) SELECT ?, 'restore', '{}', ?, ? WHERE changes() = 1`).bind(id, actor, nowIso),
  ]);
  return (update?.meta.changes ?? 0) === 1;
}

export async function getPromotionEvents(db: D1Database, id: number) {
  const { results } = await db
    .prepare('SELECT action, changes, actor, at FROM promotion_events WHERE promotion_id = ? ORDER BY at DESC, id DESC LIMIT 50')
    .bind(id)
    .all<{ action: 'create' | 'update' | 'delete' | 'restore'; changes: string; actor: string; at: string }>();
  return results;
}

export async function createPromotion(db: D1Database, p: PromotionInput, kind: PromotionKind, actor: string, nowIso: string): Promise<number> {
  const [insert] = await db.batch([
    db
      .prepare('INSERT INTO promotions (kind, name, enabled, start_date, end_date, start_time, end_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
      .bind(kind, p.name, p.enabled, p.start_date, p.end_date, p.start_time, p.end_time, nowIso, nowIso),
    db
      .prepare(`INSERT INTO promotion_events (promotion_id, action, changes, actor, at) SELECT MAX(id), 'create', '{}', ?, ? FROM promotions`)
      .bind(actor, nowIso),
  ]);
  const id = (insert?.results?.[0] as { id?: number } | undefined)?.id;
  if (typeof id !== 'number') throw new Error('createPromotion: ไม่ได้รหัสกลับมา');
  return id;
}

/** แก้แบบกันชนกันด้วย updated_at เหมือนสินค้า */
export async function updatePromotion(db: D1Database, current: PromotionRow, next: PromotionInput, version: string, actor: string, nowIso: string): Promise<'updated' | 'unchanged' | 'conflict'> {
  if (current.updated_at !== version || current.deleted_at) return 'conflict';
  const changes = diffPromotion(current, next);
  if (!Object.keys(changes).length) return 'unchanged';
  const [update] = await db.batch([
    db
      .prepare('UPDATE promotions SET name = ?, enabled = ?, start_date = ?, end_date = ?, start_time = ?, end_time = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND deleted_at IS NULL')
      .bind(next.name, next.enabled, next.start_date, next.end_date, next.start_time, next.end_time, nowIso, current.id, version),
    db
      .prepare(`INSERT INTO promotion_events (promotion_id, action, changes, actor, at) SELECT ?, 'update', ?, ?, ? WHERE changes() = 1`)
      .bind(current.id, JSON.stringify(changes), actor, nowIso),
  ]);
  return (update?.meta.changes ?? 0) === 1 ? 'updated' : 'conflict';
}
