import { diffStore, type StoreInput, type StoreRow } from './stores.ts';

export async function listStores(db: D1Database, trash: boolean): Promise<StoreRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM stores WHERE CASE WHEN ? = 1 THEN deleted_at IS NOT NULL ELSE deleted_at IS NULL END ORDER BY id LIMIT 1000`)
    .bind(trash ? 1 : 0)
    .all<StoreRow>();
  return results;
}

export async function getStore(db: D1Database, id: number): Promise<StoreRow | null> {
  return db.prepare('SELECT * FROM stores WHERE id = ?').bind(id).first<StoreRow>();
}

export async function getStoreEvents(db: D1Database, id: number) {
  const { results } = await db
    .prepare('SELECT action, changes, actor, at FROM store_events WHERE store_id = ? ORDER BY at DESC, id DESC LIMIT 50')
    .bind(id)
    .all<{ action: 'import' | 'create' | 'update' | 'delete' | 'restore'; changes: string; actor: string; at: string }>();
  return results;
}

/** รหัสใหม่ต่อจากรหัสสูงสุด (รวมตัวในถังขยะ — ไม่ใช้รหัสซ้ำ) */
export async function createStore(db: D1Database, s: StoreInput, actor: string, nowIso: string): Promise<number> {
  const [insert] = await db.batch([
    db
      .prepare('INSERT INTO stores (id, name_th, name_en, enabled, created_at, updated_at) VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM stores), ?, ?, ?, ?, ?) RETURNING id')
      .bind(s.name_th, s.name_en, s.enabled, nowIso, nowIso),
    db.prepare(`INSERT INTO store_events (store_id, action, changes, actor, at) SELECT MAX(id), 'create', '{}', ?, ? FROM stores`).bind(actor, nowIso),
  ]);
  const id = (insert?.results?.[0] as { id?: number } | undefined)?.id;
  if (typeof id !== 'number') throw new Error('createStore: ไม่ได้รหัสกลับมา');
  return id;
}

export async function updateStore(db: D1Database, current: StoreRow, next: StoreInput, version: string, actor: string, nowIso: string): Promise<'updated' | 'unchanged' | 'conflict'> {
  if (current.updated_at !== version || current.deleted_at) return 'conflict';
  const changes = diffStore(current, next);
  if (!Object.keys(changes).length) return 'unchanged';
  const [update] = await db.batch([
    db
      .prepare('UPDATE stores SET name_th = ?, name_en = ?, enabled = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND deleted_at IS NULL')
      .bind(next.name_th, next.name_en, next.enabled, nowIso, current.id, version),
    db.prepare(`INSERT INTO store_events (store_id, action, changes, actor, at) SELECT ?, 'update', ?, ?, ? WHERE changes() = 1`).bind(current.id, JSON.stringify(changes), actor, nowIso),
  ]);
  return (update?.meta.changes ?? 0) === 1 ? 'updated' : 'conflict';
}

export async function setStoreDeleted(db: D1Database, id: number, deleted: boolean, version: string, actor: string, nowIso: string): Promise<boolean> {
  const [update] = await db.batch([
    db
      .prepare(`UPDATE stores SET deleted_at = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND deleted_at IS ${deleted ? 'NULL' : 'NOT NULL'}`)
      .bind(deleted ? nowIso : null, nowIso, id, version),
    db.prepare(`INSERT INTO store_events (store_id, action, changes, actor, at) SELECT ?, ?, '{}', ?, ? WHERE changes() = 1`).bind(id, deleted ? 'delete' : 'restore', actor, nowIso),
  ]);
  return (update?.meta.changes ?? 0) === 1;
}
