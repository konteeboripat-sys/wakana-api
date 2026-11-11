import { diffRule, type RuleInput, type RuleRow } from './promotion-rules.ts';

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

export async function listRules(db: D1Database, f: { name: string; trash: boolean }): Promise<(RuleRow & { product_count: number; promotion_name: string | null })[]> {
  const { results } = await db
    .prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM promotion_rule_products rp WHERE rp.rule_id = r.id) AS product_count, p.name AS promotion_name
       FROM promotion_rules r LEFT JOIN promotions p ON p.id = r.promotion_id
       WHERE (?1 = '' OR r.name LIKE ?1 ESCAPE '\\')
         AND (CASE WHEN ?2 = 1 THEN r.deleted_at IS NOT NULL ELSE r.deleted_at IS NULL END)
       ORDER BY r.id
       LIMIT 1000`
    )
    .bind(f.name ? `%${escapeLike(f.name)}%` : '', f.trash ? 1 : 0)
    .all<RuleRow & { product_count: number; promotion_name: string | null }>();
  return results;
}

/** กติกาที่ผูกกับโปรนี้ (หน้า Settime ตาราง "Promotion Rule Name" · หน้าแก้โปร) */
export async function listRulesOfPromotion(db: D1Database, promotionId: number): Promise<Pick<RuleRow, 'id' | 'name' | 'enabled' | 'type'>[]> {
  const { results } = await db
    .prepare('SELECT id, name, enabled, type FROM promotion_rules WHERE promotion_id = ? AND deleted_at IS NULL ORDER BY id')
    .bind(promotionId)
    .all<Pick<RuleRow, 'id' | 'name' | 'enabled' | 'type'>>();
  return results;
}

export async function getRule(db: D1Database, id: number): Promise<(RuleRow & { product_ids: number[] }) | null> {
  const rule = await db.prepare('SELECT * FROM promotion_rules WHERE id = ?').bind(id).first<RuleRow>();
  if (!rule) return null;
  const { results } = await db.prepare('SELECT product_id FROM promotion_rule_products WHERE rule_id = ? ORDER BY product_id').bind(id).all<{ product_id: number }>();
  return { ...rule, product_ids: results.map((r) => r.product_id) };
}

/** สินค้าที่เลือกได้ในฟอร์ม (ไม่รวมตัวในถังขยะ — แต่ตัวที่ผูกไว้แล้วยังแสดงเพื่อเอาออกได้) */
export async function pickableProducts(db: D1Database, keepIds: number[]): Promise<{ id: number; name_th: string; category: string; deleted: boolean }[]> {
  const keep = JSON.stringify(keepIds);
  const { results } = await db
    .prepare(
      `SELECT id, name_th, category, deleted_at IS NOT NULL AS deleted FROM products
       WHERE deleted_at IS NULL OR id IN (SELECT value FROM json_each(?))
       ORDER BY category, id`
    )
    .bind(keep)
    .all<{ id: number; name_th: string; category: string; deleted: number }>();
  return results.map((r) => ({ ...r, deleted: Boolean(r.deleted) }));
}

/** รหัสที่ไม่มีอยู่จริงหรืออยู่ในถังขยะ (ยกเว้นตัวที่ผูกไว้อยู่แล้ว) */
export async function invalidProductIds(db: D1Database, ids: number[], alreadyLinked: number[]): Promise<number[]> {
  const { results } = await db
    .prepare('SELECT id FROM products WHERE id IN (SELECT value FROM json_each(?)) AND (deleted_at IS NULL OR id IN (SELECT value FROM json_each(?)))')
    .bind(JSON.stringify(ids), JSON.stringify(alreadyLinked))
    .all<{ id: number }>();
  const ok = new Set(results.map((r) => r.id));
  return ids.filter((id) => !ok.has(id));
}

const linkStatements = (db: D1Database, ruleIdSql: string, bindRule: unknown[], ids: number[]) =>
  db
    .prepare(`INSERT INTO promotion_rule_products (rule_id, product_id) SELECT ${ruleIdSql}, value FROM json_each(?)`)
    .bind(...bindRule, JSON.stringify(ids));

export async function createRule(db: D1Database, r: RuleInput, actor: string, nowIso: string): Promise<number> {
  const [insert] = await db.batch([
    db
      .prepare('INSERT INTO promotion_rules (name, enabled, promotion_id, type, buy_quantity, get_free_quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
      .bind(r.name, r.enabled, r.promotion_id, r.type, r.buy_quantity, r.get_free_quantity, nowIso, nowIso),
    linkStatements(db, '(SELECT MAX(id) FROM promotion_rules)', [], r.product_ids),
    db.prepare(`INSERT INTO promotion_rule_events (rule_id, action, changes, actor, at) SELECT MAX(id), 'create', '{}', ?, ? FROM promotion_rules`).bind(actor, nowIso),
  ]);
  const id = (insert?.results?.[0] as { id?: number } | undefined)?.id;
  if (typeof id !== 'number') throw new Error('createRule: ไม่ได้รหัสกลับมา');
  return id;
}

/** แก้แบบกันชนกัน · สินค้าเขียนใหม่ทั้งชุดเฉพาะเมื่อแถวหลักแก้สำเร็จ */
export async function updateRule(
  db: D1Database,
  current: RuleRow & { product_ids: number[] },
  next: RuleInput,
  version: string,
  actor: string,
  nowIso: string
): Promise<'updated' | 'unchanged' | 'conflict'> {
  if (current.updated_at !== version || current.deleted_at) return 'conflict';
  const changes = diffRule(current, next);
  if (!Object.keys(changes).length) return 'unchanged';
  const updatedNow = 'EXISTS (SELECT 1 FROM promotion_rules WHERE id = ? AND updated_at = ?)';
  const [update] = await db.batch([
    db
      .prepare('UPDATE promotion_rules SET name = ?, enabled = ?, promotion_id = ?, type = ?, buy_quantity = ?, get_free_quantity = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND deleted_at IS NULL')
      .bind(next.name, next.enabled, next.promotion_id, next.type, next.buy_quantity, next.get_free_quantity, nowIso, current.id, version),
    db.prepare(`DELETE FROM promotion_rule_products WHERE rule_id = ? AND ${updatedNow}`).bind(current.id, current.id, nowIso),
    db
      .prepare(`INSERT INTO promotion_rule_products (rule_id, product_id) SELECT ?, value FROM json_each(?) WHERE ${updatedNow}`)
      .bind(current.id, JSON.stringify(next.product_ids), current.id, nowIso),
    db
      .prepare(`INSERT INTO promotion_rule_events (rule_id, action, changes, actor, at) SELECT ?, 'update', ?, ?, ? WHERE ${updatedNow}`)
      .bind(current.id, JSON.stringify(changes), actor, nowIso, current.id, nowIso),
  ]);
  return (update?.meta.changes ?? 0) === 1 ? 'updated' : 'conflict';
}

export async function setRuleDeleted(db: D1Database, id: number, deleted: boolean, version: string, actor: string, nowIso: string): Promise<boolean> {
  const [update] = await db.batch([
    db
      .prepare(`UPDATE promotion_rules SET deleted_at = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND deleted_at IS ${deleted ? 'NULL' : 'NOT NULL'}`)
      .bind(deleted ? nowIso : null, nowIso, id, version),
    db.prepare(`INSERT INTO promotion_rule_events (rule_id, action, changes, actor, at) SELECT ?, ?, '{}', ?, ? WHERE changes() = 1`).bind(id, deleted ? 'delete' : 'restore', actor, nowIso),
  ]);
  return (update?.meta.changes ?? 0) === 1;
}

export async function getRuleEvents(db: D1Database, id: number) {
  const { results } = await db
    .prepare('SELECT action, changes, actor, at FROM promotion_rule_events WHERE rule_id = ? ORDER BY at DESC, id DESC LIMIT 50')
    .bind(id)
    .all<{ action: 'create' | 'update' | 'delete' | 'restore'; changes: string; actor: string; at: string }>();
  return results;
}

/** หน้า Settime: กติกาของโปร Settime ที่แสดงอยู่ทั้งหมด */
export async function listRulesOfPromotions(db: D1Database, promotionIds: number[]): Promise<(Pick<RuleRow, 'id' | 'name' | 'enabled' | 'type'> & { promotion_id: number })[]> {
  if (!promotionIds.length) return [];
  const { results } = await db
    .prepare('SELECT id, name, enabled, type, promotion_id FROM promotion_rules WHERE promotion_id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL ORDER BY promotion_id, id')
    .bind(JSON.stringify(promotionIds))
    .all<Pick<RuleRow, 'id' | 'name' | 'enabled' | 'type'> & { promotion_id: number }>();
  return results;
}
