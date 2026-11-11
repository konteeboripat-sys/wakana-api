// หลังบ้าน /back/products — แทน back/productList.php + editProduct.php ของเว็บเดิม

import { errorPage, page, readForm, readFormWithFiles, redirect, sameOrigin } from './admin-layout.ts';
import { loadCatalog, type Catalog } from './catalog.ts';
import type { Env } from './env.ts';
import { html, type SafeHtml } from './html.ts';
import { checkImageFile, deleteProductImage, mediaKeyFromPath, mediaStore, putProductImage, type ImageCheck } from './media.ts';
import { formatBaht } from './orders.ts';
import {
  CATEGORIES,
  LEGACY_CATEGORIES,
  categoryLabel,
  CODE_PREFIX,
  importRowsFromCatalog,
  inactivePromoFields,
  parseProductForm,
  PRODUCT_FIELD_LABELS,
  productUrl,
  webDifferences,
  type ProductInput,
  type ProductRow,
} from './products.ts';
import {
  countProducts,
  createProduct,
  getProduct,
  getProductEvents,
  importProducts,
  listProducts,
  nextProductCode,
  setProductDeleted,
  slugOwner,
  updateProduct,
} from './products-db.ts';
import { promotionExists, promotionOptionLabel, promotionOptions } from './promotions-db.ts';
import { formatIsoAsThai } from './wall-time.ts';
import { getPublishState, hasPending, hookUrl, publishNow, requestPublish, type PublishOutcome, type PublishState } from './publish.ts';

const FLASH: Record<string, string> = {
  created: 'เพิ่มสินค้าแล้ว',
  updated: 'บันทึกแล้ว',
  unchanged: 'ไม่มีอะไรเปลี่ยน',
  restored: 'กู้คืนสินค้าแล้ว',
  conflict: 'มีคนแก้สินค้านี้ไปก่อน จึงยังไม่ได้ทำรายการ — ด้านล่างคือข้อมูลล่าสุด',
};

const STATE_LABELS = { '': 'ทั้งหมด', '1': 'เปิดขาย', '0': 'ปิดขาย', deleted: 'ถังขยะ' } as const;
/** ตัวเลือก Enable ในหน้ารายการ (ข้อความตามหน้าเดิม) */
const ENABLE_FILTER: Record<keyof typeof STATE_LABELS, string> = { '': 'Enable', '1': 'Yes', '0': 'No', deleted: 'ถังขยะ' };

// ผลการสั่งอัปเดตหน้าเว็บ (หลังบันทึก: ?site= · ปุ่ม: ?published=)
const SITE_FLASH: Record<PublishOutcome, string> = {
  triggered: 'หน้าเว็บกำลังอัปเดตตามข้อมูลนี้ (ไม่กี่วินาทีในเครื่อง · ราว 1–2 นาทีบนเว็บจริง)',
  queued: 'หน้าเว็บจะอัปเดตอัตโนมัติภายในราว 1–3 นาที (แก้หลายตัวติดกัน ระบบรวมเป็นรอบเดียว)',
  failed: 'สั่งอัปเดตหน้าเว็บไม่สำเร็จ — กด "อัปเดตหน้าเว็บ" ในหน้ารายการเพื่อลองใหม่ หรือแจ้งผู้ดูแลระบบ',
  // ไม่ตั้ง DEPLOY_HOOK_URL = ไม่ต้องแจ้ง: ราคา/ชื่อ/รูป/การปิดขายบนเว็บดึงสดจาก /products อยู่แล้ว (wakana-site live-catalog.js)
  unset: '',
};
const isOutcome = (v: string | null): v is PublishOutcome => v !== null && v in SITE_FLASH && SITE_FLASH[v as PublishOutcome] !== '';

/** หลังแก้สินค้าสำเร็จ: ขออัปเดตหน้าเว็บ แล้วต่อผลไว้ในลิงก์ที่ redirect ไป */
async function afterChange(env: Env, actor: string, location: string): Promise<Response> {
  const outcome = await requestPublish(env, actor);
  return redirect(`${location}${location.includes('?') ? '&' : '?'}site=${outcome}`);
}

/** สถานะหน้าเว็บสำหรับหน้ารายการ */
function publishStatus(env: Env, s: PublishState): SafeHtml {
  if (!hookUrl(env)) return html``;
  const last = s.triggered_at ? `อัปเดตล่าสุด ${formatIsoAsThai(s.triggered_at)}${s.last_actor ? ` (${s.last_actor})` : ''}` : 'ยังไม่เคยอัปเดต';
  if (hasPending(s)) return html`<span class="s-warn-text">● มีการแก้ที่รอขึ้นหน้าเว็บ</span> <span class="notice">· ${last}</span>`;
  if (s.last_result === 'failed') return html`<span class="s-disable">● อัปเดตครั้งล่าสุดไม่สำเร็จ</span> <span class="notice">· ${last}</span>`;
  return html`<span class="s-ok">● หน้าเว็บตรงกับหลังบ้าน</span> <span class="notice">· ${last}</span>`;
}
type ListState = keyof typeof STATE_LABELS;

async function webCatalog(env: Env): Promise<Catalog | null> {
  try {
    return await loadCatalog(env.SITE_ORIGIN);
  } catch {
    return null;
  }
}

function imageUrl(env: Env, image: string): string {
  if (!image) return '';
  if (mediaKeyFromPath(image)) return image; // รูปที่อัปโหลดเข้าหลังบ้าน อยู่บน API นี้เอง
  try {
    return new URL(image, env.SITE_ORIGIN).href;
  } catch {
    return '';
  }
}

function sourceNotice(env: Env): SafeHtml {
  return env.PRICE_SOURCE === 'd1'
    ? html`<p class="notice">หน้าเว็บและราคาออเดอร์ใช้ตารางนี้ (PRICE_SOURCE = d1) — แก้ราคา · ชื่อ · รูป · เปิด/ปิดขาย แล้วรีเฟรชหน้าเว็บเห็นทันที · สินค้าใหม่และคำอธิบายขึ้นเว็บเมื่อ build เว็บใหม่</p>`
    : html`<div class="flash">แก้สินค้าแล้วกด <strong>"อัปเดตหน้าเว็บ"</strong> หน้าเว็บจึงจะเปลี่ยน (ราว 1–2 นาที) · ราคาออเดอร์คิดจากหน้าเว็บ = ตรงกับที่ลูกค้าเห็นเสมอ · คอลัมน์ "เทียบเว็บ" = สิ่งที่แก้แล้วแต่ยังไม่ได้อัปเดตหน้าเว็บ</div>`;
}

const yesNo = (v: 0 | 1, yes = 'ใช่', no = 'ไม่') => html`<span class="${v ? '' : 's-off'}">${v ? yes : no}</span>`;

// ---------- รายการสินค้า ----------

async function productList(env: Env, url: URL, email: string): Promise<Response> {
  const p = url.searchParams;
  const category = CATEGORIES[p.get('category') ?? ''] || LEGACY_CATEGORIES[p.get('category') ?? ''] ? (p.get('category') as string) : '';
  const q = (p.get('q') ?? '').trim().slice(0, 60);
  const stateParam = p.get('state') ?? '';
  const state: ListState = stateParam in STATE_LABELS ? (stateParam as ListState) : '';
  const inTrash = state === 'deleted';
  // ?promotion=<id> = สินค้าที่ร่วมโปรนั้น (ลิงก์จากหน้าโปรโมชัน) · ?promotion=0 = ไม่ร่วมโปรโมชั่น
  const promotionParam = p.get('promotion') ?? '';
  const promotion = /^\d{1,9}$/.test(promotionParam) ? Number(promotionParam) : null;

  const [total, products, web, promotions, publish] = await Promise.all([
    countProducts(env.DB),
    listProducts(env.DB, { category, text: q, state, promotion }),
    webCatalog(env),
    promotionOptions(env.DB),
    getPublishState(env.DB),
  ]);
  const imported = p.get('imported');
  const deletedId = /^\d{1,9}$/.test(p.get('deleted') ?? '') ? p.get('deleted') : null;

  if (total === 0) {
    const body = html`<h1>สินค้า</h1>
<div class="panel"><p>ยังไม่มีสินค้าในหลังบ้าน — นำเข้าจากเมนูที่อยู่บนเว็บตอนนี้ได้เลย (ชื่อ ราคา หมวด รูป · รหัสสินค้าเดิม)</p>
${web ? html`<form method="post" action="/back/products/import"><button class="primary" type="submit">นำเข้า ${web.size} รายการจากเว็บ</button></form>` : html`<p class="notice">ตอนนี้โหลดเมนูจากเว็บไม่ได้ (${env.SITE_ORIGIN}) ลองใหม่อีกครั้ง</p>`}
</div>`;
    return page(env, { title: 'สินค้า', email, active: 'products', body });
  }

  const diffs = new Map(products.map((row) => [row.id, web ? webDifferences(row, web.get(String(row.id))) : []]));
  const mismatched = [...diffs.values()].filter((d) => d.length).length;

  const body = html`
<div class="actions" style="justify-content:space-between;margin:0 0 20px">
  <a class="btn success" href="/back/products/new">Add new product</a>
  <div class="actions">${publishStatus(env, publish)}
  ${
    // ไม่ตั้ง DEPLOY_HOOK_URL = ปุ่มกดแล้วไม่มีผล → ซ่อน (ราคาบนเว็บดึงสดอยู่แล้ว) · ตั้ง hook เมื่อไรปุ่มกลับมาเอง
    hookUrl(env)
      ? html`<form method="post" action="/back/products/publish"><button class="primary" type="submit" title="บันทึกสินค้าแล้วหน้าเว็บอัปเดตเองอยู่แล้ว — ปุ่มนี้สั่งทันที">อัปเดตหน้าเว็บ</button></form>`
      : ''
  }</div>
</div>
${isOutcome(p.get('published')) ? html`<div class="flash" role="status">${SITE_FLASH[p.get('published') as PublishOutcome]}</div>` : ''}
${isOutcome(p.get('site')) ? html`<div class="flash" role="status">${SITE_FLASH[p.get('site') as PublishOutcome]}</div>` : ''}
${imported !== null ? html`<div class="flash" role="status">นำเข้าแล้ว ${imported} รายการ</div>` : ''}
${deletedId ? html`<div class="flash" role="status">ย้ายสินค้า #${deletedId} ไปถังขยะแล้ว · <a href="/back/products/${deletedId}">ดู / กู้คืน</a></div>` : ''}
${inTrash ? html`<div class="flash">ถังขยะ: สินค้าที่ลบแล้ว ไม่แสดงในรายการปกติ ไม่ใช้คิดราคา และ "นำเข้าจากเว็บ" จะไม่ดึงกลับมา — กด "กู้คืน" เพื่อนำกลับ</div>` : sourceNotice(env)}
<form class="card filters" method="get" action="/back/products">
  <label>Category<select name="category"><option value="">Select Category</option>${Object.entries({ ...CATEGORIES, ...LEGACY_CATEGORIES }).map(
    ([slug, label]) => html`<option value="${slug}" ${category === slug ? html`selected` : ''}>${label}</option>`
  )}</select></label>
  <label>Product Name<input type="search" name="q" value="${q}" placeholder="Product Name" maxlength="60"></label>
  <label>Promotion<select name="promotion"><option value="">Select Promotion</option><option value="0" ${promotion === 0 ? html`selected` : ''}>ไม่ร่วมโปรโมชั่น</option>${promotions.map(
    (x) => html`<option value="${x.id}" ${promotion === x.id ? html`selected` : ''}>${x.name}</option>`
  )}</select></label>
  <label>Enable<select name="state">${(Object.keys(ENABLE_FILTER) as ListState[]).map(
    (s) => html`<option value="${s}" ${state === s ? html`selected` : ''}>${ENABLE_FILTER[s]}</option>`
  )}</select></label>
  <button class="primary" type="submit">Search</button>
</form>
<p class="notice">${products.length} รายการ${web && mismatched ? ` · ไม่ตรงกับเว็บ ${mismatched} รายการ` : ''}</p>
<div class="card table-wrap">
${
  products.length
    ? html`<table>
<thead><tr><th>id</th><th>Product Name</th><th class="num">Price</th><th class="num">Time Price</th><th>Picture</th><th>Homepage</th><th>Enable</th><th></th></tr></thead>
<tbody>${products.map((row) => {
        // คอลัมน์ตามหน้า product ของเว็บเดิม · สินค้าที่ยังไม่ตรงกับเว็บ (เทียบ catalog.js) ขึ้นป้ายใต้ชื่อแทนคอลัมน์ "เทียบเว็บ"
        const img = imageUrl(env, row.image);
        const d = diffs.get(row.id) ?? [];
        return html`<tr>
<td><a href="/back/products/${row.id}">${row.id}</a></td>
<td class="wrap">${row.name_th}${row.name_en ? html`<br>${row.name_en}` : ''}${d.length ? html`<br>${d.map((t) => html`<span class="badge s-warn">${t}</span> `)}` : ''}</td>
<td class="num">${formatBaht(row.price_satang)}/${formatBaht(row.sale_price_satang ?? row.price_satang)}</td>
<td class="num">${row.time_price_satang === null ? '-' : formatBaht(row.time_price_satang)}</td>
<td>${img ? html`<img class="thumb" src="${img}" alt="" loading="lazy">` : html`<div class="thumb"></div>`}</td>
<td>${yesNo(row.show_on_homepage, 'Yes', 'No')}</td>
<td>${yesNo(row.enabled, 'Yes', 'No')}</td>
<td>${
          inTrash
            ? html`<form method="post" action="/back/products/${row.id}/restore"><input type="hidden" name="version" value="${row.updated_at}"><button type="submit">กู้คืน</button></form>`
            : html`<div class="actions"><a href="/back/products/${row.id}">Edit</a><a class="danger-link" href="/back/products/${row.id}/delete">ลบ</a></div>`
        }</td></tr>`;
      })}</tbody></table>`
    : html`<div class="empty">${inTrash ? 'ถังขยะว่าง' : 'ไม่พบสินค้าตามเงื่อนไขนี้'}</div>`
}
</div>
${web && web.size > total ? html`<form method="post" action="/back/products/import" class="notice">เว็บมีสินค้าที่ยังไม่อยู่ในหลังบ้าน <button type="submit">นำเข้ารายการที่ยังไม่มี</button> (ไม่ทับของที่แก้ไว้)</form>` : ''}`;
  return page(env, { title: 'สินค้า', email, active: 'products', body });
}

// ---------- ฟอร์มเพิ่ม/แก้ไข ----------

type FormValues = Record<string, string>;

const satangText = (n: number | null) => (n === null ? '' : String(n / 100));

function valuesFromRow(row: ProductRow): FormValues {
  return {
    code_number: row.code_number,
    slug: row.slug,
    name_th: row.name_th,
    name_en: row.name_en,
    short_desc_th: row.short_desc_th,
    short_desc_en: row.short_desc_en,
    long_desc_th: row.long_desc_th,
    long_desc_en: row.long_desc_en,
    price: satangText(row.price_satang),
    // ไม่มีราคาโปร = ช่องว่าง (ห้ามเติมราคาปกติ: ขึ้นราคาปกติทีหลังแล้วกดบันทึก ราคาเก่าจะกลายเป็นราคาโปรโดยไม่ตั้งใจ)
    sale_price: satangText(row.sale_price_satang),
    time_price: satangText(row.time_price_satang),
    category: row.category,
    thumbnail: row.thumbnail,
    image: row.image,
    promotion_id: row.promotion_id === null ? '' : String(row.promotion_id),
    free_delivery: row.free_delivery ? '1' : '',
    show_on_homepage: row.show_on_homepage ? '1' : '',
    enabled: row.enabled ? '1' : '',
    seo_title: row.seo_title,
    seo_keywords: row.seo_keywords,
    seo_description: row.seo_description,
    sort_order: String(row.sort_order),
  };
}

type FieldErrors = Partial<Record<keyof ProductInput, string>>;

/** ช่องรูปที่แนบไฟล์ได้ (ตามหน้าเดิม: thumbnail 200x200 · picture 500x500) */
const IMAGE_FIELDS = ['thumbnail', 'image'] as const;
type ImageField = (typeof IMAGE_FIELDS)[number];

/**
 * ฟอร์มเพิ่ม/แก้สินค้า — ตามหน้า back/addProduct.php เดิม: ตาราง 2 คอลัมน์ (ป้ายซ้าย ช่องขวา) แถวสลับเทา
 * ลำดับและชื่อช่องตามหน้าเดิมทุกช่อง · ต่างจากเดิม: รายละเอียดเป็นข้อความธรรมดา (หน้าเดิมใช้ TinyMCE = ต้องมี JavaScript)
 * และรูปเป็น path (ยังไม่มีที่เก็บไฟล์อัปโหลด)
 */
type PromotionOption = Awaited<ReturnType<typeof promotionOptions>>[number];

function productForm(
  env: Env,
  o: { action: string; values: FormValues; errors: FieldErrors; version?: string; submitLabel: string; isNew: boolean; promotions: PromotionOption[]; productId?: number }
): SafeHtml {
  const v = o.values;
  const err = (key: keyof ProductInput) => (o.errors[key] ? html`<span class="err" id="err-${key}">${o.errors[key]}</span>` : '');
  const invalid = (key: keyof ProductInput) => (o.errors[key] ? html`aria-invalid="true" aria-describedby="err-${key}"` : '');
  const hint = (text: string) => html`<small class="notice">${text}</small>`;
  const row = (id: string, label: SafeHtml | string, control: SafeHtml) => html`<div class="frow"><label class="flabel" for="f-${id}">${label}</label><div class="fcontrol">${control}</div></div>`;
  const input = (key: keyof ProductInput, name: string, label: string, attrs: SafeHtml | string = '', help: SafeHtml | string = '') =>
    row(name, label, html`<input id="f-${name}" name="${name}" value="${v[name] ?? ''}" ${invalid(key)} ${attrs}>${help ? (typeof help === 'string' ? hint(help) : help) : ''}${err(key)}`);
  const area = (key: keyof ProductInput, label: string, rows: number, max: number) =>
    row(key, label, html`<textarea id="f-${key}" name="${key}" rows="${rows}" maxlength="${max}" ${invalid(key)}>${v[key] ?? ''}</textarea>${err(key)}`);
  const yesNo = (name: 'free_delivery' | 'show_on_homepage' | 'enabled', label: string, yesLabel = 'Yes', noLabel = 'No') =>
    row(name, label, html`<select id="f-${name}" name="${name}" class="narrow">
<option value="" ${v[name] ? '' : html`selected`}>${noLabel}</option><option value="1" ${v[name] ? html`selected` : ''}>${yesLabel}</option></select>${err(name)}`);
  // รูป = แนบไฟล์ · ค่าเดิมส่งกลับใน hidden ไว้แสดงผลเท่านั้น (server ใช้ค่าในฐานข้อมูล) · ไม่เลือกไฟล์ใหม่ = ใช้รูปเดิม
  const fileRow = (name: ImageField, label: string) => {
    const src = imageUrl(env, v[name] ?? '');
    return row(
      `${name}_file`,
      label,
      html`<input type="hidden" name="${name}" value="${v[name] ?? ''}">
${src ? html`<img class="preview ${name === 'thumbnail' ? 'small' : ''}" src="${src}" alt="รูปปัจจุบัน">` : ''}
<input type="file" id="f-${name}_file" name="${name}_file" accept="image/jpeg,image/png,image/webp,image/gif" class="file" ${invalid(name)}>
${v[name] ? html`<label class="check"><input type="checkbox" name="${name}_remove" value="1"> Delete (ลบรูปนี้)</label>` : ''}
${hint(`JPG, PNG, WebP หรือ GIF ไม่เกิน 2 MB${v[name] ? ' · เลือกไฟล์ใหม่ = เปลี่ยนรูป' : ''}`)}${err(name)}`
    );
  };

  return html`<form method="post" action="${o.action}" enctype="multipart/form-data" class="card old-form">
${o.version ? html`<input type="hidden" name="version" value="${o.version}">` : ''}
<input type="hidden" name="sort_order" value="${v.sort_order ?? '0'}">
<div class="ftable">
  ${row('product_id', 'product_id', html`<input id="f-product_id" value="${o.productId ?? ''}" placeholder="${o.productId ? '' : 'สร้างให้อัตโนมัติเมื่อบันทึก'}" readonly class="readonly">`)}
  ${input('code_number', 'code_number', 'รหัสสินค้า CODE NUMBER', html`maxlength="50"`, o.isNew ? `รันตาม product_id อัตโนมัติ (${CODE_PREFIX} + product_id เช่น ${CODE_PREFIX}005) · แก้เองได้ · เว้นว่าง = ใช้เลขนี้` : '')}
  ${input('slug', 'slug', 'Product url *', html`maxlength="80" pattern="[a-z0-9]+([\-_][a-z0-9]+)*"`, o.isNew ? 'เช่น salmon-flower · เว้นว่าง = ตั้งจากชื่อภาษาอังกฤษ' : `ลิงก์หน้าเว็บ: /menu/${v.category || '<หมวด>'}/${v.slug || ''}`)}
  ${input('name_th', 'name_th', 'ชื่อสินค้าภาษาไทย product name thai *', html`required maxlength="120"`)}
  ${input('name_en', 'name_en', `ชื่อสินค้าภาษาอังกฤษ product name eng${o.isNew ? ' *' : ''}`, html`maxlength="120" ${o.isNew ? html`required` : ''}`)}
  ${area('short_desc_th', 'รายละเอียดอย่างย่อภาษาไทย short description thai', 4, 1000)}
  ${area('short_desc_en', 'รายละเอียดอย่างย่อภาษาอังกฤษ short description eng', 4, 1000)}
  ${area('long_desc_th', 'รายละเอียดภาษาไทย long description thai', 7, 5000)}
  ${area('long_desc_en', 'รายละเอียดภาษาอังกฤษ long description eng', 7, 5000)}
  ${input('price_satang', 'price', 'ราคาสินค้า Normal price *', html`required inputmode="decimal" maxlength="12"`)}
  ${input('sale_price_satang', 'sale_price', 'ราคาโปรโมชั่น Sale price', html`inputmode="decimal" maxlength="12" placeholder="เท่าราคาปกติ"`, 'เว้นว่าง = เท่าราคาปกติ · ⚠ ยังไม่มีผล ลูกค้าจ่ายราคาปกติ')}
  ${input('time_price_satang', 'time_price', 'Time price', html`inputmode="decimal" maxlength="12"`, '⚠ เก็บไว้เท่านั้น ยังไม่มีผลกับราคา')}
  ${row('category', 'หมวดหมู่สินค้า Catalog *', html`<select id="f-category" name="category" required ${invalid('category')}>
    <option value="">Select Category</option>${Object.entries(CATEGORIES).map(([slug, label]) => html`<option value="${slug}" ${v.category === slug ? html`selected` : ''}>${label}</option>`)}
  </select>${err('category')}`)}
  ${fileRow('thumbnail', 'product thumbnail (recommend 200*200px)')}
  ${fileRow('image', 'product picture (recommend 500*500px)')}
  ${row('promotion_id', 'Promotion', html`<select id="f-promotion_id" name="promotion_id" class="narrow" ${invalid('promotion_id')}>
    <option value="" ${v.promotion_id ? '' : html`selected`}>ไม่ร่วมโปรโมชั่น</option>
    ${o.promotions.map((p) => html`<option value="${p.id}" ${v.promotion_id === String(p.id) ? html`selected` : ''}>${promotionOptionLabel(p)}</option>`)}
  </select>${err('promotion_id')}`)}
  ${yesNo('free_delivery', 'ร่วมโปรโมชั่นส่งฟรี')}
  ${yesNo('show_on_homepage', 'ให้แสดงสินค้าที่หน้าแรก Product Homepage')}
  ${yesNo('enabled', 'สถานะการเปิด-ปิดสินค้าบนหน้าเว็บ Product enable')}
  <div class="frow fhead"><div class="flabel">SEO Meta tag</div><div class="fcontrol"></div></div>
  ${input('seo_title', 'seo_title', 'Meta Title', html`maxlength="120"`)}
  ${input('seo_keywords', 'seo_keywords', 'Meta Keyword', html`maxlength="255"`)}
  ${input('seo_description', 'seo_description', 'Meta Description', html`maxlength="320"`)}
</div>
<div class="actions" style="margin-top:20px"><button class="submit-btn" type="submit">${o.submitLabel}</button><a class="btn back-btn" href="/back/products">Back</a></div>
</form>`;
}

const FIELD_NAMES: Record<string, string> = { ...PRODUCT_FIELD_LABELS };
const MONEY_FIELDS = new Set(['price_satang', 'sale_price_satang', 'time_price_satang']);
const FLAG_FIELDS = new Set(['enabled', 'show_on_homepage', 'free_delivery']);

function changeSummary(raw: string): string {
  try {
    const changes = JSON.parse(raw) as Record<string, [unknown, unknown]>;
    return Object.entries(changes)
      .map(([key, [before, after]]) => {
        const fmt = (x: unknown) =>
          MONEY_FIELDS.has(key) && typeof x === 'number'
            ? formatBaht(x)
            : FLAG_FIELDS.has(key)
              ? x ? 'ใช่' : 'ไม่'
              : key === 'promotion_id'
                ? x === null ? 'ไม่ร่วมโปรโมชั่น' : `โปร #${x}`
                : String(x ?? '').slice(0, 60);
        return `${FIELD_NAMES[key] ?? key}: ${fmt(before) || '—'} → ${fmt(after) || '—'}`;
      })
      .join(' · ');
  } catch {
    return '';
  }
}

async function editPage(env: Env, url: URL, email: string, row: ProductRow, values?: FormValues, errors: FieldErrors = {}, status = 200, flashText = ''): Promise<Response> {
  const [events, web, promotions] = await Promise.all([getProductEvents(env.DB, row.id), webCatalog(env), promotionOptions(env.DB)]);
  const diffs = web ? webDifferences(row, web.get(String(row.id))) : [];
  const flash = flashText || FLASH[url.searchParams.get('msg') ?? ''];
  const ACTIONS = { import: 'นำเข้าจากเว็บ', create: 'สร้าง', update: 'แก้ไข', delete: 'ย้ายไปถังขยะ', restore: 'กู้คืน' } as const;

  // อยู่ในถังขยะ: แสดงอย่างเดียว แก้ไม่ได้จนกว่าจะกู้คืน
  const main = row.deleted_at
    ? html`<div class="flash">สินค้านี้อยู่ใน<strong>ถังขยะ</strong> (ลบเมื่อ ${formatIsoAsThai(row.deleted_at)}) — ไม่แสดงในรายการปกติและไม่ใช้คิดราคา กู้คืนก่อนจึงจะแก้ไขได้</div>
<div class="panel" style="margin-bottom:20px"><div class="actions" style="align-items:flex-start;gap:20px">
  ${imageUrl(env, row.image) ? html`<img class="preview" src="${imageUrl(env, row.image)}" alt="">` : ''}
  <dl><dt>ชื่อ</dt><dd>${row.name_th}${row.name_en ? ` / ${row.name_en}` : ''}</dd><dt>หมวด</dt><dd>${categoryLabel(row.category)}</dd>
  <dt>ราคา</dt><dd>${formatBaht(row.price_satang)} บาท</dd><dt>ลิงก์</dt><dd>${productUrl(row)}</dd></dl></div>
  <form method="post" action="/back/products/${row.id}/restore" style="margin-top:16px"><input type="hidden" name="version" value="${row.updated_at}"><button class="primary" type="submit">กู้คืนสินค้านี้</button></form>
</div>`
    : html`${productForm(env, { action: `/back/products/${row.id}`, values: values ?? valuesFromRow(row), errors, version: row.updated_at, submitLabel: 'submit', isNew: false, promotions, productId: row.id })}
<p style="margin:-4px 0 24px"><a class="btn danger" href="/back/products/${row.id}/delete">ลบสินค้านี้</a></p>`;

  const body = html`
<p><a href="/back/products">← กลับรายการ</a></p>
${flash ? html`<div class="flash" role="status">${flash}${isOutcome(url.searchParams.get('site')) ? html` · ${SITE_FLASH[url.searchParams.get('site') as PublishOutcome]}` : ''}</div>` : ''}
<h1>สินค้า #${row.id} ${row.deleted_at ? html`<span class="s-off">(ถังขยะ)</span>` : row.enabled ? '' : html`<span class="s-off">(ปิดขาย)</span>`}</h1>
${row.deleted_at ? '' : sourceNotice(env)}
${diffs.length ? html`<div class="flash">ยังไม่ตรงกับเว็บ: ${diffs.join(' · ')}</div>` : ''}
${inactivePromoFields(row).length ? html`<div class="flash">ตั้งไว้แต่<strong>ยังไม่มีผล</strong> (ตะกร้ายังไม่รองรับโปรโมชัน ลูกค้าจ่ายราคาปกติ ${formatBaht(row.price_satang)} บาท): ${inactivePromoFields(row).join(' · ')}</div>` : ''}
${main}
<section class="card"><h2>ประวัติการแก้ไข</h2>
${
  events.length
    ? html`<div class="table-wrap"><table><thead><tr><th>เมื่อ</th><th>ทำอะไร</th><th>โดย</th><th>รายละเอียด</th></tr></thead><tbody>${events.map(
        (e) => html`<tr><td>${formatIsoAsThai(e.at)}</td><td>${ACTIONS[e.action]}</td><td>${e.actor}</td><td class="wrap">${e.action === 'update' ? changeSummary(e.changes) : ''}</td></tr>`
      )}</tbody></table></div>`
    : html`<p class="notice">ยังไม่มีประวัติ</p>`
}
<p class="notice">หน้าเว็บ: <a href="${new URL(productUrl(row), env.SITE_ORIGIN).href}" target="_blank" rel="noopener">${productUrl(row)}</a> · แก้ล่าสุด ${formatIsoAsThai(row.updated_at)}</p>
</section>`;
  return page(env, { title: `สินค้า #${row.id}`, email, active: 'products', body, status });
}

// ค่าเริ่มต้นเหมือนหน้าเดิม: ทุกตัวเลือกเป็น No (สินค้าใหม่ยังไม่เปิดขายจนกว่าจะเลือก Yes)
async function newPage(env: Env, email: string, values: FormValues = {}, errors: FieldErrors = {}, status = 200): Promise<Response> {
  const [promotions, nextCode] = await Promise.all([promotionOptions(env.DB), nextProductCode(env.DB)]);
  // เปิดฟอร์มใหม่ = ใส่รหัสถัดไปให้ (แก้เองได้) · ส่งฟอร์มผิดกลับมา = คงค่าที่กรอกไว้
  if (!('code_number' in values)) values = { ...values, code_number: nextCode };
  const body = html`<p><a href="/back/products">← กลับรายการ</a></p><h1>เพิ่มสินค้าใหม่</h1>${sourceNotice(env)}
${productForm(env, { action: '/back/products/new', values, errors, submitLabel: 'submit', isNew: true, promotions })}`;
  return page(env, { title: 'เพิ่มสินค้าใหม่', email, active: 'products', body, status });
}

// ---------- ลบ (ย้ายไปถังขยะ) ----------

/** หน้ายืนยันก่อนลบ — ไม่มี JavaScript จึงใช้หน้าแยกแทน confirm() */
async function deleteConfirmPage(env: Env, email: string, row: ProductRow): Promise<Response> {
  if (row.deleted_at) return redirect(`/back/products/${row.id}`);
  const web = await webCatalog(env);
  const onWeb = Boolean(web?.get(String(row.id)));
  const img = imageUrl(env, row.image);
  const body = html`<p><a href="/back/products/${row.id}">← กลับ</a></p>
<h1>ลบสินค้า #${row.id}?</h1>
<div class="panel">
  <div class="actions" style="align-items:flex-start;gap:20px">
    ${img ? html`<img class="preview" src="${img}" alt="">` : ''}
    <dl><dt>ชื่อ</dt><dd>${row.name_th}${row.name_en ? ` / ${row.name_en}` : ''}</dd><dt>หมวด</dt><dd>${categoryLabel(row.category)}</dd><dt>ราคา</dt><dd>${formatBaht(row.price_satang)} บาท</dd></dl>
  </div>
  <ul style="margin:16px 0;padding-left:20px;font-weight:400">
    <li>สินค้าจะย้ายไป<strong>ถังขยะ</strong> หายจากรายการปกติ — กู้คืนได้จากตัวกรองสถานะ "ถังขยะ"</li>
    <li>ออเดอร์เก่าที่มีสินค้านี้ไม่เปลี่ยน (เก็บชื่อและราคา ณ ตอนสั่งไว้แล้ว)</li>
    ${
      onWeb
        ? html`<li><strong>ตอนนี้สินค้านี้ยังขายอยู่บนเว็บ</strong> — ลบที่นี่ยังไม่เอาออกจากเว็บ${env.PRICE_SOURCE === 'd1' ? ' (แต่ระบบจะไม่รับออเดอร์สินค้านี้แล้ว)' : ' จนกว่าจะต่อเว็บกับหลังบ้าน'}</li>`
        : ''
    }
  </ul>
  <form method="post" action="/back/products/${row.id}/delete" class="actions">
    <input type="hidden" name="version" value="${row.updated_at}">
    <button class="danger" type="submit">ยืนยัน ลบสินค้านี้</button><a href="/back/products/${row.id}">ยกเลิก</a>
  </form>
</div>`;
  return page(env, { title: `ลบสินค้า #${row.id}`, email, active: 'products', body });
}

async function setDeleted(request: Request, env: Env, row: ProductRow, email: string, deleted: boolean): Promise<Response> {
  const { version = '' } = await readForm(request);
  const ok = await setProductDeleted(env.DB, row.id, deleted, version, email, new Date().toISOString());
  if (!ok) return redirect(`/back/products/${row.id}?msg=conflict`);
  return afterChange(env, email, deleted ? `/back/products?deleted=${row.id}` : `/back/products/${row.id}?msg=restored`);
}

// ---------- บันทึก ----------

async function slugError(env: Env, value: ProductInput, exceptId: number | null): Promise<FieldErrors | null> {
  const owner = await slugOwner(env.DB, value.category, value.slug, exceptId);
  if (!owner) return null;
  return {
    slug: owner.deleted
      ? `ชื่อในลิงก์นี้เป็นของสินค้า #${owner.id} ที่อยู่ในถังขยะ — กู้คืนสินค้านั้นแทน หรือใช้ชื่ออื่น`
      : `ชื่อในลิงก์นี้มีในหมวดนี้แล้ว (สินค้า #${owner.id})`,
  };
}

/**
 * อ่านฟอร์ม + ตรวจทุกอย่าง (รวมไฟล์รูปทั้งสองช่อง) ก่อนอัปโหลด — อัปโหลดเฉพาะเมื่อทุกช่องผ่าน ไม่ทิ้งไฟล์ค้างใน R2
 * ค่ารูปไม่เชื่อ hidden ที่ส่งมา: ใช้ของในฐานข้อมูล (current) เว้นแต่แนบไฟล์ใหม่หรือติ๊กลบ
 */
async function prepareProduct(
  request: Request,
  env: Env,
  current: ProductRow | null
): Promise<{ ok: true; value: ProductInput; fields: FormValues; uploaded: string[] } | { ok: false; fields: FormValues; errors: FieldErrors }> {
  const { fields, files } = await readFormWithFiles(request);
  const checks: Partial<Record<ImageField, ImageCheck>> = {};
  for (const name of IMAGE_FIELDS) {
    fields[name] = current?.[name] ?? '';
    const file = files[`${name}_file`];
    if (file) checks[name] = await checkImageFile(file);
  }

  const parsed = parseProductForm(fields, { isNew: current === null });
  const errors: FieldErrors = parsed.ok ? {} : { ...parsed.errors };
  if (parsed.ok && parsed.value.promotion_id !== null && !(await promotionExists(env.DB, parsed.value.promotion_id))) errors.promotion_id = 'ไม่พบโปรโมชันนี้ เลือกใหม่';
  for (const name of IMAGE_FIELDS) {
    const check = checks[name];
    if (check && !check.ok) errors[name] = check.error;
    // ไม่มีที่เก็บรูป (ไม่ผูกทั้ง R2 และ KV) — เดิม put บน undefined แล้วล้มเป็น internal_error
    else if (check && !mediaStore(env)) errors[name] = 'ตอนนี้ยังอัปโหลดรูปไม่ได้ (ยังไม่ได้ตั้งที่เก็บรูป) — เอาไฟล์ออกแล้วบันทึกโดยไม่มีรูปไปก่อน';
  }
  if (parsed.ok && !Object.keys(errors).length) Object.assign(errors, (await slugError(env, parsed.value, current?.id ?? null)) ?? {});
  if (!parsed.ok || Object.keys(errors).length) {
    // เบราว์เซอร์ไม่คืนไฟล์ที่เลือกไว้หลังส่งฟอร์ม ต้องเลือกใหม่
    for (const name of IMAGE_FIELDS) if (checks[name]?.ok && !errors[name]) errors[name] = 'แก้ช่องที่ผิดแล้วเลือกไฟล์รูปอีกครั้ง';
    return { ok: false, fields, errors };
  }

  const value = parsed.value;
  const uploaded: string[] = [];
  const store = mediaStore(env);
  try {
    for (const name of IMAGE_FIELDS) {
      const check = checks[name];
      if (check?.ok && store) {
        value[name] = await putProductImage(store, check);
        uploaded.push(value[name]);
      } else if (fields[`${name}_remove`] === '1') {
        value[name] = '';
      }
    }
  } catch (err) {
    await discardUploads(env, uploaded);
    throw err;
  }
  return { ok: true, value, fields, uploaded };
}

const discardUploads = (env: Env, paths: string[]) => Promise.all(paths.map((p) => deleteProductImage(mediaStore(env), p)));

async function saveNew(request: Request, env: Env, email: string): Promise<Response> {
  const prepared = await prepareProduct(request, env, null);
  if (!prepared.ok) return newPage(env, email, prepared.fields, prepared.errors, 422);
  try {
    // เว้นช่องรหัสว่าง = DEPS + product_id ใหม่
    const value = prepared.value.code_number ? prepared.value : { ...prepared.value, code_number: await nextProductCode(env.DB) };
    const id = await createProduct(env.DB, value, email, new Date().toISOString());
    return await afterChange(env, email, `/back/products/${id}?msg=created`);
  } catch (err) {
    await discardUploads(env, prepared.uploaded);
    throw err;
  }
}

async function saveExisting(request: Request, env: Env, url: URL, email: string, row: ProductRow): Promise<Response> {
  const prepared = await prepareProduct(request, env, row);
  if (!prepared.ok) return editPage(env, url, email, row, prepared.fields, prepared.errors, 422);
  let result: Awaited<ReturnType<typeof updateProduct>>;
  try {
    result = await updateProduct(env.DB, row, prepared.value, prepared.fields.version ?? '', email, new Date().toISOString());
  } catch (err) {
    await discardUploads(env, prepared.uploaded);
    throw err;
  }
  if (result === 'conflict') {
    await discardUploads(env, prepared.uploaded);
    // มีคนบันทึกก่อน: แสดงค่าล่าสุดในฐานข้อมูล ไม่ทับงานของอีกคน
    const latest = (await getProduct(env.DB, row.id)) ?? row;
    return editPage(env, url, email, latest, undefined, {}, 409, 'มีคนแก้สินค้านี้ไปก่อนคุณ — ด้านล่างคือข้อมูลล่าสุด สิ่งที่คุณแก้ยังไม่ได้บันทึก กรุณาแก้ใหม่');
  }
  // รูปเดิมถูกแทน/ลบแล้ว → ลบไฟล์เก่าใน R2/KV (deleteProductImage แตะเฉพาะไฟล์ที่ระบบอัปโหลดเอง ไม่แตะรูปบนเว็บเดิม /images/...)
  if (result === 'updated') {
    for (const name of IMAGE_FIELDS) if (row[name] && row[name] !== prepared.value[name]) await deleteProductImage(mediaStore(env), row[name]);
  }
  // ไม่มีอะไรเปลี่ยน = ไม่ต้อง build
  return result === 'updated' ? afterChange(env, email, `/back/products/${row.id}?msg=updated`) : redirect(`/back/products/${row.id}?msg=${result}`);
}

async function runImport(env: Env, email: string): Promise<Response> {
  const web = await webCatalog(env);
  if (!web) return errorPage(env, 503, `โหลดเมนูจากเว็บไม่ได้ (${env.SITE_ORIGIN})`);
  const { rows } = importRowsFromCatalog(web);
  const added = await importProducts(env.DB, rows, email, new Date().toISOString());
  return added > 0 ? afterChange(env, email, `/back/products?imported=${added}`) : redirect(`/back/products?imported=0`);
}

// ---------- router ----------

export async function handleProductsAdmin(request: Request, env: Env, url: URL, path: string, email: string): Promise<Response> {
  const isRead = request.method === 'GET' || request.method === 'HEAD';
  const isPost = request.method === 'POST';
  if (isPost && !sameOrigin(request, url)) return errorPage(env, 403, 'คำขอไม่ได้มาจากหน้าหลังบ้าน');

  if (path === '/back/products') return isRead ? productList(env, url, email) : errorPage(env, 405, 'ไม่รองรับคำขอนี้');
  if (path === '/back/products/import') return isPost ? runImport(env, email) : redirect('/back/products');
  if (path === '/back/products/publish') return isPost ? redirect(`/back/products?published=${await publishNow(env, email)}`) : redirect('/back/products');
  if (path === '/back/products/new') {
    if (isRead) return newPage(env, email);
    return isPost ? saveNew(request, env, email) : errorPage(env, 405, 'ไม่รองรับคำขอนี้');
  }

  const m = /^\/back\/products\/(\d{1,9})(?:\/(delete|restore))?$/.exec(path);
  if (m) {
    const row = await getProduct(env.DB, Number(m[1]));
    if (!row) return page(env, { title: 'ไม่พบสินค้า', email, active: 'products', status: 404, body: html`<div class="card empty">ไม่พบสินค้า #${m[1]} · <a href="/back/products">กลับรายการ</a></div>` });
    const action = m[2];
    if (action === 'delete') {
      if (isRead) return deleteConfirmPage(env, email, row); // GET แค่แสดงหน้ายืนยัน ไม่ลบ
      return isPost ? setDeleted(request, env, row, email, true) : errorPage(env, 405, 'ไม่รองรับคำขอนี้');
    }
    if (action === 'restore') return isPost ? setDeleted(request, env, row, email, false) : redirect(`/back/products/${row.id}`);
    if (isRead) return editPage(env, url, email, row);
    return isPost ? saveExisting(request, env, url, email, row) : errorPage(env, 405, 'ไม่รองรับคำขอนี้');
  }
  return errorPage(env, 404, 'ไม่พบหน้านี้');
}
