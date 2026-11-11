import type { Catalog, Product } from './catalog.ts';
import { codeForId, diffProduct, productUrl, type ProductInput, type ProductRow } from './products.ts';

export interface ProductFilter {
  category: string; // '' = ทุกหมวด
  text: string; // ค้นชื่อไทย/อังกฤษ/รหัส
  /** '' = ทุกตัวที่ไม่ได้ลบ · '1' เปิดขาย · '0' ปิดขาย · 'deleted' ถังขยะ */
  state: '' | '0' | '1' | 'deleted';
  /** สินค้าที่ร่วมโปรนี้ · 0 = ไม่ร่วมโปรโมชั่น (promotion_id ว่าง) · null = ไม่กรอง */
  promotion?: number | null;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

export async function listProducts(db: D1Database, f: ProductFilter): Promise<ProductRow[]> {
  const like = f.text ? `%${escapeLike(f.text)}%` : '';
  const { results } = await db
    .prepare(
      `SELECT * FROM products
       WHERE (?1 = '' OR category = ?1)
         AND (?2 = '' OR name_th LIKE ?2 ESCAPE '\\' OR name_en LIKE ?2 ESCAPE '\\' OR CAST(id AS TEXT) = ?3)
         AND (CASE ?4 WHEN 'deleted' THEN deleted_at IS NOT NULL
                      WHEN '' THEN deleted_at IS NULL
                      ELSE deleted_at IS NULL AND enabled = CAST(?4 AS INTEGER) END)
         AND (?5 IS NULL OR (?5 = 0 AND promotion_id IS NULL) OR promotion_id = ?5)
       ORDER BY id
       LIMIT 1000`
    )
    .bind(f.category, like, f.text, f.state, f.promotion ?? null)
    .all<ProductRow>();
  return results;
}

export async function countProducts(db: D1Database): Promise<number> {
  return (await db.prepare('SELECT COUNT(*) AS n FROM products').first<number>('n')) ?? 0;
}

export async function getProduct(db: D1Database, id: number): Promise<ProductRow | null> {
  return db.prepare('SELECT * FROM products WHERE id = ?').bind(id).first<ProductRow>();
}

export async function getProductEvents(db: D1Database, id: number) {
  const { results } = await db
    .prepare('SELECT action, changes, actor, at FROM product_events WHERE product_id = ? ORDER BY at DESC, id DESC LIMIT 50')
    .bind(id)
    .all<{ action: 'import' | 'create' | 'update'; changes: string; actor: string; at: string }>();
  return results;
}

/** สินค้าอื่นที่ใช้ชื่อในลิงก์นี้ในหมวดเดียวกัน (รวมตัวที่อยู่ในถังขยะ — ฐานข้อมูลห้ามซ้ำ) · null = ว่าง */
export async function slugOwner(db: D1Database, category: string, slug: string, exceptId: number | null): Promise<{ id: number; deleted: boolean } | null> {
  const row = await db
    .prepare('SELECT id, deleted_at FROM products WHERE category = ? AND slug = ? AND id != ?')
    .bind(category, slug, exceptId ?? -1)
    .first<{ id: number; deleted_at: string | null }>();
  return row ? { id: row.id, deleted: row.deleted_at !== null } : null;
}

const COLUMNS = [
  'code_number',
  'slug',
  'name_th',
  'name_en',
  'short_desc_th',
  'short_desc_en',
  'long_desc_th',
  'long_desc_en',
  'price_satang',
  'sale_price_satang',
  'time_price_satang',
  'category',
  'thumbnail',
  'image',
  'promotion_id',
  'free_delivery',
  'show_on_homepage',
  'enabled',
  'seo_title',
  'seo_keywords',
  'seo_description',
  'sort_order',
] as const satisfies readonly (keyof ProductInput)[];
const values = (p: ProductInput) => COLUMNS.map((c) => p[c]);

/** CODE NUMBER ของสินค้าใหม่ = DEPS + product_id ถัดไป (id ใหม่ = MAX(id) + 1 แบบเดียวกับ createProduct) */
export async function nextProductCode(db: D1Database): Promise<string> {
  const row = await db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM products').first<{ next: number }>();
  return codeForId(row?.next ?? 1);
}

/** สร้างสินค้าใหม่ · รหัส = ต่อจากรหัสสูงสุด (ไม่ชนกับรหัสเดิมจากเว็บ PHP) */
export async function createProduct(db: D1Database, p: ProductInput, actor: string, nowIso: string): Promise<number> {
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO products (id, ${COLUMNS.join(', ')}, created_at, updated_at)
         VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM products), ${COLUMNS.map(() => '?').join(', ')}, ?, ?)
         RETURNING id`
      )
      .bind(...values(p), nowIso, nowIso),
    db
      .prepare(`INSERT INTO product_events (product_id, action, changes, actor, at) SELECT MAX(id), 'create', ?, ?, ? FROM products`)
      .bind(JSON.stringify(Object.fromEntries(COLUMNS.map((c) => [c, [null, p[c]]]))), actor, nowIso),
  ]);
  const id = (insert?.results?.[0] as { id?: number } | undefined)?.id;
  if (typeof id !== 'number') throw new Error('createProduct: ไม่ได้รหัสสินค้ากลับมา');
  return id;
}

/**
 * แก้สินค้าแบบกันชนกัน: เขียนได้เฉพาะเมื่อ updated_at ยังเท่ากับตอนเปิดฟอร์ม (version)
 * คืน 'updated' | 'unchanged' | 'conflict'
 */
export async function updateProduct(
  db: D1Database,
  current: ProductRow,
  next: ProductInput,
  version: string,
  actor: string,
  nowIso: string
): Promise<'updated' | 'unchanged' | 'conflict'> {
  if (current.updated_at !== version || current.deleted_at) return 'conflict';
  const changes = diffProduct(current, next);
  if (!Object.keys(changes).length) return 'unchanged';
  const [update] = await db.batch([
    db
      .prepare(`UPDATE products SET ${COLUMNS.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND updated_at = ? AND deleted_at IS NULL`)
      .bind(...values(next), nowIso, current.id, version),
    db
      .prepare(`INSERT INTO product_events (product_id, action, changes, actor, at) SELECT ?, 'update', ?, ?, ? WHERE changes() = 1`)
      .bind(current.id, JSON.stringify(changes), actor, nowIso),
  ]);
  return (update?.meta.changes ?? 0) === 1 ? 'updated' : 'conflict';
}

/**
 * ย้ายไปถังขยะ / กู้คืน — กันชนกันด้วย version เหมือนการแก้ (เปิดหน้ายืนยันค้างไว้แล้วมีคนแก้ก่อน = ไม่ลบ)
 * คืน true ถ้าเปลี่ยนจริง
 */
export async function setProductDeleted(db: D1Database, id: number, deleted: boolean, version: string, actor: string, nowIso: string): Promise<boolean> {
  const [update] = await db.batch([
    db
      .prepare(`UPDATE products SET deleted_at = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND deleted_at IS ${deleted ? 'NULL' : 'NOT NULL'}`)
      .bind(deleted ? nowIso : null, nowIso, id, version),
    db
      .prepare(`INSERT INTO product_events (product_id, action, changes, actor, at) SELECT ?, ?, '{}', ?, ? WHERE changes() = 1`)
      .bind(id, deleted ? 'delete' : 'restore', actor, nowIso),
  ]);
  return (update?.meta.changes ?? 0) === 1;
}

/** นำเข้าจากเมนูบนเว็บ — เพิ่มเฉพาะรหัสที่ยังไม่มี ไม่ทับของที่แก้ไว้แล้ว · ตัวที่อยู่ในถังขยะก็ไม่ดึงกลับ (แถวยังอยู่) */
export async function importProducts(db: D1Database, rows: (ProductInput & { id: number })[], actor: string, nowIso: string): Promise<number> {
  let added = 0;
  for (let i = 0; i < rows.length; i += 40) {
    const chunk = rows.slice(i, i + 40);
    const results = await db.batch(
      chunk.flatMap((p) => [
        db
          .prepare(`INSERT OR IGNORE INTO products (id, ${COLUMNS.join(', ')}, created_at, updated_at) VALUES (?, ${COLUMNS.map(() => '?').join(', ')}, ?, ?)`)
          .bind(p.id, ...values(p), nowIso, nowIso),
        db.prepare(`INSERT INTO product_events (product_id, action, changes, actor, at) SELECT ?, 'import', '{}', ?, ? WHERE changes() = 1`).bind(p.id, actor, nowIso),
      ])
    );
    added += results.filter((_, j) => j % 2 === 0).reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  }
  return added;
}

/** สินค้าที่เปิดขายในตาราง → รูปเดียวกับ catalog ของเว็บ (ใช้เมื่อ PRICE_SOURCE = d1) */
export async function catalogFromDb(db: D1Database): Promise<Catalog> {
  const { results } = await db.prepare('SELECT * FROM products WHERE enabled = 1 AND deleted_at IS NULL ORDER BY id').all<ProductRow>();
  const out = new Map<string, Product>();
  for (const p of results) {
    out.set(String(p.id), { id: String(p.id), name: p.name_th, price: p.price_satang / 100, category: p.category, image: p.image, url: productUrl(p) });
  }
  return out;
}
