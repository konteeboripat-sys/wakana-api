// หลังบ้าน /back/catalog — แทนหน้า Catalog (หมวดสินค้า) ของเว็บเดิม · ดูอย่างเดียว
// หมวดยังกำหนดในโค้ด (products.ts CATEGORIES / LEGACY_CATEGORIES) และหน้าหมวดบนเว็บ build ไว้ล่วงหน้า ⇒ หน้านี้ยังไม่มีฟอร์มแก้

import { errorPage, page } from './admin-layout.ts';
import type { Env } from './env.ts';
import { html } from './html.ts';
import { CATEGORIES, categoryLabel, LEGACY_CATEGORIES } from './products.ts';

/** ชื่ออังกฤษตามตาราง category ของเว็บเดิม (catalog_name_en) · salmon-sashimi ของเว็บเดิม = sashimi */
const NAME_EN: Record<string, string> = {
  'party-set': 'Party set',
  'sushi-set': 'Sushi set',
  sashimi: 'Sashimi',
  'bento-set': 'Bento set',
  'mini-bento': 'mini-bento',
  donburi: 'Donburi',
  onigiri: 'Onigiri',
  salad: 'Salad',
  'salmon-cakes': 'salmon cakes',
  beverage: 'beverage',
  sushi: 'Sushi',
  kaisendon: 'Kaisen don',
  appetizer: 'appetizer',
  'value-set': 'Value set',
  promotion: 'Promotion',
};

interface CountRow {
  category: string;
  total: number;
  enabled: number;
}

async function catalogList(env: Env, email: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT category, COUNT(*) AS total, SUM(enabled) AS enabled FROM products WHERE deleted_at IS NULL GROUP BY category'
  ).all<CountRow>();
  const counts = new Map(results.map((r) => [r.category, r]));
  // หมวดที่เว็บมีหน้า → หมวดเว็บเดิม → หมวดที่มีในตารางแต่ไม่รู้จัก (กันตกหล่น)
  const slugs = [...Object.keys(CATEGORIES), ...Object.keys(LEGACY_CATEGORIES)];
  for (const r of results) if (!slugs.includes(r.category)) slugs.push(r.category);
  const site = env.SITE_ORIGIN.replace(/\/+$/, '');

  const body = html`
<div class="flash">หมวดสินค้า<strong>ดูอย่างเดียว</strong> — หมวดกำหนดในระบบ และหน้าหมวดบนเว็บสร้างไว้ล่วงหน้า · หมวดที่มีป้าย "เว็บเดิม" ไม่มีหน้าบนเว็บใหม่ (สินค้าในหมวดนั้นปิดขายอยู่)</div>
<div class="card table-wrap">
<table>
<thead><tr><th>catalog name th</th><th>catalog name en</th><th>catalog url</th><th class="num">เปิดขาย</th><th class="num">ทั้งหมด</th><th></th></tr></thead>
<tbody>${slugs.map((slug) => {
    const c = counts.get(slug);
    const onSite = slug in CATEGORIES;
    return html`<tr>
<td class="wrap">${categoryLabel(slug)}</td>
<td>${NAME_EN[slug] ?? ''}</td>
<td>${onSite ? html`<a href="${site}/menu/${slug}" target="_blank" rel="noopener noreferrer">/menu/${slug}</a>` : html`<span class="notice">${slug} · ไม่มีหน้าบนเว็บ</span>`}</td>
<td class="num">${c?.enabled ?? 0}</td>
<td class="num">${c?.total ?? 0}</td>
<td>${c?.total ? html`<a href="/back/products?category=${encodeURIComponent(slug)}">ดูสินค้า</a>` : ''}</td>
</tr>`;
  })}</tbody>
<tfoot><tr><th colspan="3">รวม</th><th class="num">${results.reduce((n, r) => n + (r.enabled ?? 0), 0)}</th><th class="num">${results.reduce((n, r) => n + r.total, 0)}</th><th></th></tr></tfoot>
</table>
</div>`;
  return page(env, { title: 'Catalog', email, active: 'catalog', body });
}

export async function handleCatalogAdmin(request: Request, env: Env, path: string, email: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorPage(env, 405, 'ไม่รองรับคำขอนี้');
  if (path !== '/back/catalog') return errorPage(env, 404, 'ไม่พบหน้านี้');
  return catalogList(env, email);
}
