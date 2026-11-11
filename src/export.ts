// GET /export/products — ข้อมูลสินค้าทั้งหมดสำหรับ build หน้าเว็บ (wakana-site/build.mjs)
// ต้องมี Authorization: Bearer <EXPORT_TOKEN> — มีสินค้าที่ยังไม่เปิดขาย (เมนูใหม่ที่ยังไม่ประกาศ) ไม่ควรเปิดให้ทุกคนเห็น

import type { Env } from './env.ts';
import { json } from './http.ts';
import { mediaKeyFromPath } from './media.ts';
import { categoryLabel, productUrl, type ProductRow } from './products.ts';

export interface ExportProduct {
  id: string;
  name_th: string;
  name_en: string;
  category: string;
  category_label: string;
  slug: string;
  url: string;
  price: number;
  /** path บนเว็บ (/images/...) หรือ URL เต็มของรูปที่อัปโหลดเข้า API (/media/...) */
  image: string;
  short_desc_th: string;
  long_desc_th: string;
  seo_title: string;
  seo_description: string;
  code_number: string;
  enabled: boolean;
  show_on_homepage: boolean;
  sort_order: number;
}

/** เทียบ token แบบใช้เวลาเท่ากัน (กันเดา token ทีละตัวอักษรจากเวลาตอบ) */
export async function tokenMatches(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(given)), crypto.subtle.digest('SHA-256', enc.encode(expected))]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export function toExportProduct(p: ProductRow, apiOrigin: string): ExportProduct {
  // รูปที่อัปโหลดเข้าหลังบ้านอยู่บน API นี้ — หน้าเว็บต้องใช้ URL เต็ม
  const image = mediaKeyFromPath(p.image) ? `${apiOrigin}${p.image}` : p.image;
  return {
    id: String(p.id),
    name_th: p.name_th,
    name_en: p.name_en,
    category: p.category,
    category_label: categoryLabel(p.category),
    slug: p.slug,
    url: productUrl(p),
    price: p.price_satang / 100,
    image,
    short_desc_th: p.short_desc_th,
    long_desc_th: p.long_desc_th,
    seo_title: p.seo_title,
    seo_description: p.seo_description,
    code_number: p.code_number,
    enabled: p.enabled === 1,
    show_on_homepage: p.show_on_homepage === 1,
    sort_order: p.sort_order,
  };
}

export async function handleExport(request: Request, env: Env, url: URL): Promise<Response> {
  const expected = (env.EXPORT_TOKEN ?? '').trim();
  if (!expected) return json({ error: 'export_not_configured', message: 'ยังไม่ได้ตั้ง EXPORT_TOKEN' }, 503);
  const auth = request.headers.get('Authorization') ?? '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!given || !(await tokenMatches(given, expected))) return json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' });

  const [live, deleted] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM products WHERE deleted_at IS NULL ORDER BY id'),
    env.DB.prepare('SELECT id FROM products WHERE deleted_at IS NOT NULL ORDER BY id'),
  ]);
  const products = ((live?.results ?? []) as ProductRow[]).map((p) => toExportProduct(p, url.origin));
  const deletedIds = ((deleted?.results ?? []) as { id: number }[]).map((r) => String(r.id));
  return json({ generated_at: new Date().toISOString(), count: products.length, products, deleted_ids: deletedIds });
}
