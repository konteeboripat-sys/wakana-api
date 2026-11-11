// ปุ่ม "นำเข้าจากเว็บ" ในรูปไฟล์ SQL สำหรับ `wrangler d1 execute --file` — ใช้ตอนตั้ง D1 ใหม่ที่ยังเข้าหลังบ้านไม่ได้
// แถวเดียวกับปุ่มทุกช่อง (importRowsFromCatalog) · ใช้ผ่าน scripts/import-products-web.mjs
// รันซ้ำได้: INSERT OR IGNORE ตามรหัส — ไม่ทับสินค้าที่มีอยู่/แก้ไว้ (แบบเดียวกับ importProducts)

import type { ProductInput } from './products.ts';

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

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const lit = (v: string | number | null) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : q(v));

export const IMPORT_ACTOR = 'นำเข้าจากเว็บ (สคริปต์)';

export function toSql(rows: (ProductInput & { id: number })[], nowIso: string): string {
  const out: string[] = [];
  for (const p of rows) {
    out.push(
      `INSERT OR IGNORE INTO products (id, ${COLUMNS.join(', ')}, created_at, updated_at) VALUES (${p.id}, ${COLUMNS.map((c) => lit(p[c])).join(', ')}, ${q(nowIso)}, ${q(nowIso)});`,
      `INSERT INTO product_events (product_id, action, changes, actor, at) SELECT ${p.id}, 'import', '{}', ${q(IMPORT_ACTOR)}, ${q(nowIso)} WHERE NOT EXISTS (SELECT 1 FROM product_events WHERE product_id = ${p.id});`
    );
  }
  return out.join('\n') + '\n';
}
