// เติมข้อมูลสินค้าจากเว็บเดิม (ไฟล์ dump MySQL ของ wakana_db: ตาราง product + category) → คำสั่ง SQL สำหรับ `wrangler d1 execute --file`
// ฟังก์ชันล้วน (เทสได้) · ใช้ผ่าน scripts/import-products-legacy.mjs
//
// สินค้าที่มีในหลังบ้านแล้ว (นำเข้าจากหน้าเว็บ — มีแค่ชื่อไทย/ราคา/รูป/หมวด): เติมเฉพาะช่องที่ยังว่างหรือยังไม่มีใครแก้
//   - ชื่ออังกฤษ · คำอธิบาย · SEO · รหัส · รูปเล็ก: เฉพาะที่ยังว่าง
//   - Homepage (feature_product) · Time Price · Promotion (promotion_status = รหัสโปร): เฉพาะสินค้าที่ไม่เคยมีคนแก้ช่องนั้น (ดู product_events)
//   - ไม่แตะ ราคา · ชื่อไทย · หมวด · ลิงก์ · เปิด/ปิดขาย
// สินค้าที่ไม่มีในหลังบ้าน (ส่วนใหญ่ปิดขายในเว็บเดิม): เพิ่มใหม่แบบ "ปิดขาย" เสมอ — ไม่มีหน้าในเว็บใหม่ เปิดไว้จะสั่งได้ทั้งที่ลูกค้ามองไม่เห็น
// รันซ้ำได้: เพิ่มใหม่ = INSERT OR IGNORE · เติม = เงื่อนไขช่องว่าง

import { parseInserts, type SqlValue } from './orders-import.ts';

/** catalog_url เว็บเดิม → หมวดหลังบ้าน (ที่เหลือใช้ชื่อเดิม: party-set, sushi-set, … และหมวดเว็บเดิม sushi/kaisendon/…) */
const CATEGORY_RENAME: Record<string, string> = { 'salmon-sashimi': 'sashimi' };

export interface LegacyProduct {
  id: number;
  category: string;
  slug: string;
  name_th: string;
  name_en: string;
  code_number: string;
  price_satang: number;
  sale_price_satang: number | null;
  time_price_satang: number | null;
  image: string;
  thumbnail: string;
  short_desc_th: string;
  short_desc_en: string;
  long_desc_th: string;
  long_desc_en: string;
  seo_title: string;
  seo_keywords: string;
  seo_description: string;
  show_on_homepage: 0 | 1;
  /** promotion_status ของเว็บเดิม = รหัสโปร (tb_promotion) · 0 = ไม่ร่วม */
  promotion_id: number | null;
  sort_order: number;
  old_enabled: 0 | 1;
  updated_at: string;
}

const str = (v: SqlValue | undefined) => (v === null || v === undefined ? '' : String(v));
/** ข้อความบรรทัดเดียว (ชื่อ/SEO): ตัด tab/ขึ้นบรรทัด/ช่องว่างซ้ำ */
const line = (v: SqlValue | undefined, max: number) => str(v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
/** คำอธิบาย: เว็บเดิมเก็บเป็น HTML ("<p>…</p>") → ข้อความล้วน ขึ้นบรรทัดตามย่อหน้า (ฟอร์มใหม่เก็บข้อความหลายบรรทัด) */
export function htmlToText(v: SqlValue | undefined, max = 5000): string {
  return str(v)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, max);
}
const satang = (v: SqlValue | undefined) => Math.round(Number(v ?? 0) * 100) || 0;
const picture = (file: SqlValue | undefined) => {
  const f = line(file, 200);
  return f ? `/images/product/${f}` : '';
};
/** slug ตามกติกาหลังบ้าน (a-z 0-9 - _) · ว่าง/ผิดรูป = product-<id> */
const slugOf = (raw: SqlValue | undefined, id: number) => {
  const s = line(raw, 100).toLowerCase();
  return /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(s) ? s : `product-${id}`;
};

export function legacyProductsFromDump(dump: string): { products: LegacyProduct[]; skipped: { id: string; reason: string }[] } {
  const catUrl = new Map(parseInserts(dump, 'category').map((c) => [Number(c.catalog_id), line(c.catalog_url, 50)]));
  const products: LegacyProduct[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const p of parseInserts(dump, 'product')) {
    const id = Number(p.product_id);
    const name_th = line(p.product_name_th, 200);
    const url = catUrl.get(Number(p.catalog_id));
    if (!Number.isInteger(id) || id < 1) {
      skipped.push({ id: str(p.product_id), reason: 'รหัสไม่ถูกต้อง' });
      continue;
    }
    if (!name_th) {
      skipped.push({ id: String(id), reason: 'ไม่มีชื่อ' });
      continue;
    }
    if (!url) {
      skipped.push({ id: String(id), reason: `ไม่รู้หมวด catalog_id ${p.catalog_id}` });
      continue;
    }
    const list = satang(p.list_price);
    const sell = satang(p.sell_price);
    if (!(list > 0)) {
      skipped.push({ id: String(id), reason: `ราคาไม่ถูกต้อง (${p.list_price})` });
      continue;
    }
    const promo = Number(p.promotion_status);
    products.push({
      id,
      category: CATEGORY_RENAME[url] ?? url,
      slug: slugOf(p.product_url, id),
      name_th,
      name_en: line(p.product_name_en, 200),
      code_number: line(p.code_number, 20),
      price_satang: list,
      sale_price_satang: sell > 0 && sell !== list ? sell : null,
      time_price_satang: p.time_price === null || p.time_price === undefined ? null : satang(p.time_price),
      image: picture(p.product_picture),
      thumbnail: picture(p.product_thumbnail),
      short_desc_th: htmlToText(p.shortdesc_th),
      short_desc_en: htmlToText(p.shortdesc_en),
      long_desc_th: htmlToText(p.longdesc_th),
      long_desc_en: htmlToText(p.longdesc_en),
      seo_title: line(p.meta_title, 200),
      seo_keywords: line(p.meta_keyword, 200),
      seo_description: line(p.meta_desc, 300),
      show_on_homepage: Number(p.feature_product) === 1 ? 1 : 0,
      promotion_id: Number.isInteger(promo) && promo > 0 ? promo : null,
      sort_order: Number(p.seq) || 0,
      old_enabled: Number(p.product_enable) === 1 ? 1 : 0,
      updated_at: line(p.last_update, 30),
    });
  }
  return { products, skipped };
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const n = (v: number | null) => (v === null ? 'NULL' : String(v));

export const IMPORT_ACTOR = 'เว็บเดิม (นำเข้า)';

/** ช่องนี้ไม่เคยมีคนแก้ (ไม่มี event ที่ changes มีชื่อช่องนี้) */
const untouched = (id: number, field: string) => `NOT EXISTS (SELECT 1 FROM product_events WHERE product_id = ${id} AND changes LIKE '%"${field}"%')`;

export function toSql(products: LegacyProduct[], nowIso: string): string {
  const out: string[] = [];
  for (const p of products) {
    // ---- สินค้าที่ยังไม่มี: เพิ่มแบบปิดขาย · ลิงก์ซ้ำกับสินค้าอื่นในหมวดเดียวกัน → ต่อท้าย -<id>
    const slugExpr = `CASE WHEN EXISTS (SELECT 1 FROM products WHERE category = ${q(p.category)} AND slug = ${q(p.slug)}) THEN ${q(`${p.slug}-${p.id}`)} ELSE ${q(p.slug)} END`;
    const promo = p.promotion_id === null ? 'NULL' : `(SELECT id FROM promotions WHERE id = ${p.promotion_id})`;
    out.push(
      `INSERT OR IGNORE INTO products (id, name_th, name_en, category, slug, price_satang, sale_price_satang, time_price_satang, image, thumbnail, code_number, short_desc_th, short_desc_en, long_desc_th, long_desc_en, seo_title, seo_keywords, seo_description, show_on_homepage, enabled, sort_order, promotion_id, created_at, updated_at) SELECT ${p.id}, ${q(p.name_th)}, ${q(p.name_en)}, ${q(p.category)}, ${slugExpr}, ${p.price_satang}, ${n(p.sale_price_satang)}, ${n(p.time_price_satang)}, ${q(p.image)}, ${q(p.thumbnail)}, ${q(p.code_number)}, ${q(p.short_desc_th)}, ${q(p.short_desc_en)}, ${q(p.long_desc_th)}, ${q(p.long_desc_en)}, ${q(p.seo_title)}, ${q(p.seo_keywords)}, ${q(p.seo_description)}, ${p.show_on_homepage}, 0, ${p.sort_order}, ${promo}, ${q(nowIso)}, ${q(nowIso)} WHERE NOT EXISTS (SELECT 1 FROM products WHERE id = ${p.id});`
    );
    out.push(
      `INSERT INTO product_events (product_id, action, changes, actor, at) SELECT ${p.id}, 'import', '{}', ${q(IMPORT_ACTOR)}, ${q(nowIso)} WHERE NOT EXISTS (SELECT 1 FROM product_events WHERE product_id = ${p.id});`
    );

    // ---- สินค้าที่มีอยู่แล้ว: เติมเฉพาะช่องว่าง / ช่องที่ยังไม่มีใครแก้ (สินค้าที่เพิ่งเพิ่มข้างบนมีครบแล้ว — คำสั่งพวกนี้ไม่เปลี่ยนอะไร)
    const fillText = (col: keyof LegacyProduct) => {
      const v = String(p[col] ?? '');
      return v ? `${col} = CASE WHEN ${col} = '' THEN ${q(v)} ELSE ${col} END` : '';
    };
    const sets = (['name_en', 'code_number', 'thumbnail', 'short_desc_th', 'short_desc_en', 'long_desc_th', 'long_desc_en', 'seo_title', 'seo_keywords', 'seo_description'] as const).map(fillText).filter(Boolean);
    if (sets.length) out.push(`UPDATE products SET ${sets.join(', ')} WHERE id = ${p.id};`);
    out.push(`UPDATE products SET show_on_homepage = ${p.show_on_homepage} WHERE id = ${p.id} AND ${untouched(p.id, 'show_on_homepage')};`);
    out.push(`UPDATE products SET time_price_satang = ${n(p.time_price_satang)} WHERE id = ${p.id} AND time_price_satang IS NULL AND ${untouched(p.id, 'time_price_satang')};`);
    if (p.promotion_id !== null) {
      out.push(`UPDATE products SET promotion_id = ${promo} WHERE id = ${p.id} AND promotion_id IS NULL AND ${untouched(p.id, 'promotion_id')};`);
    }
  }
  return out.join('\n') + '\n';
}
