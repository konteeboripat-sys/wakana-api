// สินค้า: ตรวจฟอร์มแก้ไข · เทียบกับเมนูบนเว็บ — ฟังก์ชันล้วน (เทสด้วย node --test ได้)

import type { Catalog, Product } from './catalog.ts';
import { formatBaht } from './orders.ts';

// หมวดที่เว็บมีอยู่ (wakana-site/raw/site/menu/*) — เพิ่มหมวดใหม่ต้องมีหน้าหมวดบนเว็บด้วย
export const CATEGORIES: Record<string, string> = {
  'party-set': 'ปาร์ตี้เซต',
  'sushi-set': 'ซูชิเซต',
  sashimi: 'ซาชิมิ',
  'bento-set': 'เบนโตะเซต',
  'mini-bento': 'มินิเบนโตะ',
  donburi: 'ดงบุริ',
  onigiri: 'โอนิกิริ',
  salad: 'สลัด',
  'salmon-cakes': 'เค้กแซลมอน',
  beverage: 'เครื่องดื่ม',
};

/**
 * หมวดของเว็บเดิมที่เว็บใหม่ไม่มีหน้า — มีแต่สินค้าที่นำเข้ามาแบบปิดขาย (products-legacy-import.ts)
 * ไม่อยู่ในตัวเลือกของฟอร์ม: จะเปิดขายสินค้าพวกนี้ต้องเลือกหมวดที่เว็บมีก่อน · กรองในหน้ารายการได้
 */
export const LEGACY_CATEGORIES: Record<string, string> = {
  sushi: 'ซูชิแบบชิ้น (เว็บเดิม)',
  kaisendon: 'ข้าวหน้าปลาดิบ (เว็บเดิม)',
  appetizer: 'อาหารทานเล่น (เว็บเดิม)',
  'value-set': 'เซ็ตสุดคุ้ม (เว็บเดิม)',
  promotion: 'โปรโมชั่น (เว็บเดิม)',
};

export const categoryLabel = (slug: string) => CATEGORIES[slug] ?? LEGACY_CATEGORIES[slug] ?? slug;


/**
 * ค่าที่แก้ได้จากฟอร์ม — ช่องเดียวกับ back/addProduct.php ของเว็บเดิม
 * sale/time price · promotion · free_delivery: เก็บไว้เท่านั้น ราคาที่ใช้จริงคือ price_satang
 */
export interface ProductInput {
  code_number: string;
  slug: string;
  name_th: string;
  name_en: string;
  short_desc_th: string;
  short_desc_en: string;
  long_desc_th: string;
  long_desc_en: string;
  price_satang: number;
  sale_price_satang: number | null;
  time_price_satang: number | null;
  category: string;
  thumbnail: string;
  image: string;
  /** โปรโมชันที่ร่วม (ตาราง promotions) · null = ไม่ร่วมโปรโมชั่น */
  promotion_id: number | null;
  free_delivery: 0 | 1;
  show_on_homepage: 0 | 1;
  enabled: 0 | 1;
  seo_title: string;
  seo_keywords: string;
  seo_description: string;
  sort_order: number;
}

export interface ProductRow extends ProductInput {
  id: number;
  created_at: string;
  updated_at: string;
  /** อยู่ในถังขยะตั้งแต่เมื่อไร · null = ยังไม่ลบ */
  deleted_at: string | null;
}

/** รหัสสินค้า CODE NUMBER แบบรันตาม product_id: DEPS001, DEPS002, … (หลังบ้านเดิม: product_id 5 = DEPS005) */
export const CODE_PREFIX = 'DEPS';

/** product_id → รหัส · อย่างน้อย 3 หลัก (5 → DEPS005 · 344 → DEPS344 · 1200 → DEPS1200) */
export function codeForId(id: number): string {
  return CODE_PREFIX + String(id).padStart(3, '0');
}

export const PRODUCT_FIELD_LABELS: Record<keyof ProductInput, string> = {
  code_number: 'รหัสสินค้า CODE NUMBER',
  slug: 'Product url',
  name_th: 'ชื่อสินค้าภาษาไทย',
  name_en: 'ชื่อสินค้าภาษาอังกฤษ',
  short_desc_th: 'รายละเอียดอย่างย่อภาษาไทย',
  short_desc_en: 'รายละเอียดอย่างย่อภาษาอังกฤษ',
  long_desc_th: 'รายละเอียดภาษาไทย',
  long_desc_en: 'รายละเอียดภาษาอังกฤษ',
  price_satang: 'ราคาสินค้า',
  sale_price_satang: 'ราคาโปรโมชั่น',
  time_price_satang: 'Time price',
  category: 'หมวดหมู่สินค้า',
  thumbnail: 'product thumbnail',
  image: 'product picture',
  promotion_id: 'Promotion',
  free_delivery: 'ร่วมโปรโมชั่นส่งฟรี',
  show_on_homepage: 'แสดงหน้าแรก',
  enabled: 'เปิดขาย',
  seo_title: 'SEO Title',
  seo_keywords: 'SEO Keyword',
  seo_description: 'SEO Description',
  sort_order: 'ลำดับ',
};

// เว็บเดิมมีลิงก์ที่ใช้ _ ด้วย (เช่น salmon_curry_bento) — ต้องรับไว้ ไม่งั้นลิงก์เดิมเสีย
const SLUG_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const CONTROL_CHARS = /[\u0000-\u0009\u000B-\u001F\u007F]/g;
const MAX_PRICE_SATANG = 100_000_00; // 100,000 บาท — กันพิมพ์ศูนย์เกิน

/** '1,050' · '35.5' · '๑๒๐' → สตางค์ · null ถ้าไม่ใช่ราคา */
export function parsePriceToSatang(raw: string): number | null {
  const s = raw.replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50)).replace(/[,\s฿]|บาท/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const satang = Math.round(Number(s) * 100);
  return satang > 0 && satang <= MAX_PRICE_SATANG ? satang : null;
}

/**
 * รูปต้องเป็น path บนเว็บ (/…) หรือ https:// — กัน javascript:/data:
 * ยอมช่องว่าง: ชื่อไฟล์รูปของเว็บเดิม 7 ไฟล์มีช่องว่าง (เช่น "แซลมอนซาชิมิ M500x500.jpg") — กันเฉพาะตัวที่หลุดออกจาก attribute ได้
 */
function validImage(v: string): boolean {
  if (!v) return true;
  if (/["'<>\\\u0000-\u001F]/.test(v)) return false;
  if (v.startsWith('/') && !v.startsWith('//')) return true;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

/** 'Mini Sushi Party Set A' → 'mini-sushi-party-set-a' · ไม่มีตัวอังกฤษ/ตัวเลขเลย = '' */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

export type ProductFormResult = { ok: true; value: ProductInput } | { ok: false; errors: Partial<Record<keyof ProductInput, string>> };

/**
 * form = ค่าจาก <form> (ทุกช่องเป็นข้อความ · ช่อง Yes/No: '1' = ใช่)
 * isNew: ชื่ออังกฤษบังคับเฉพาะสินค้าใหม่ (แบบหน้าเดิม) — สินค้าที่นำเข้าจากเว็บไม่มีชื่ออังกฤษ แก้ราคาแล้วต้องไม่ติด
 */
export function parseProductForm(form: Record<string, string | undefined>, opts: { isNew?: boolean } = {}): ProductFormResult {
  const errors: Partial<Record<keyof ProductInput, string>> = {};
  const text = (key: keyof ProductInput, max: number, required = false, multiline = false) => {
    const raw = form[key] ?? '';
    const v = (multiline ? raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '') : raw.replace(CONTROL_CHARS, '')).trim();
    if (required && !v) errors[key] = `กรอก${PRODUCT_FIELD_LABELS[key]}`;
    else if (v.length > max) errors[key] = `ยาวเกิน ${max.toLocaleString('en-US')} ตัวอักษร`;
    return v;
  };
  const optionalPrice = (name: string, key: keyof ProductInput): number | null => {
    const raw = (form[name] ?? '').trim();
    if (!raw) return null;
    const satang = parsePriceToSatang(raw);
    if (satang === null) errors[key] = 'ราคาไม่ถูกต้อง';
    return satang;
  };
  const yes = (name: string): 0 | 1 => (form[name] === '1' ? 1 : 0);

  const code_number = text('code_number', 50);
  const name_th = text('name_th', 120, true);
  const name_en = text('name_en', 120, Boolean(opts.isNew));
  const short_desc_th = text('short_desc_th', 1000, false, true);
  const short_desc_en = text('short_desc_en', 1000, false, true);
  const long_desc_th = text('long_desc_th', 5000, false, true);
  const long_desc_en = text('long_desc_en', 5000, false, true);
  const seo_title = text('seo_title', 120);
  const seo_keywords = text('seo_keywords', 255);
  const seo_description = text('seo_description', 320);

  const category = (form.category ?? '').trim();
  if (!CATEGORIES[category]) errors.category = 'เลือกหมวดหมู่สินค้า';

  // เว้นว่าง = ตั้งจากชื่ออังกฤษ
  const slug = (form.slug ?? '').trim().toLowerCase() || slugify(name_en);
  if (!slug) errors.slug = 'กรอก Product url หรือกรอกชื่ออังกฤษ (ระบบจะตั้งให้)';
  else if (slug.length > 80 || !SLUG_PATTERN.test(slug)) errors.slug = 'ใช้ a-z 0-9 - และ _ เท่านั้น เช่น salmon-flower';

  const price = parsePriceToSatang(form.price ?? '');
  if (price === null) errors.price_satang = 'ราคาไม่ถูกต้อง (มากกว่า 0 · ทศนิยมไม่เกิน 2 ตำแหน่ง)';
  // ราคาโปรเว้นว่าง = เท่าราคาปกติ (หน้าเดิมบังคับกรอก และส่วนใหญ่กรอกเท่าราคาปกติ เช่น 500/500)
  let sale_price_satang = optionalPrice('sale_price', 'sale_price_satang');
  if (price !== null && sale_price_satang !== null) {
    if (sale_price_satang > price) errors.sale_price_satang = 'ราคาโปรโมชั่นต้องไม่เกินราคาปกติ';
    else if (sale_price_satang === price) sale_price_satang = null;
  }
  const time_price_satang = optionalPrice('time_price', 'time_price_satang');

  const thumbnail = (form.thumbnail ?? '').trim();
  if (thumbnail.length > 300 || !validImage(thumbnail)) errors.thumbnail = 'ใส่ path บนเว็บ (ขึ้นต้นด้วย /) หรือลิงก์ https://';
  const image = (form.image ?? '').trim();
  if (image.length > 300 || !validImage(image)) errors.image = 'ใส่ path บนเว็บ (ขึ้นต้นด้วย /) หรือลิงก์ https://';

  // ว่าง = ไม่ร่วมโปรโมชั่น · มีอยู่จริงไหม ตรวจกับฐานข้อมูลที่ฝั่ง admin
  const promotionRaw = (form.promotion_id ?? '').trim();
  const promotionId = promotionRaw ? Number(promotionRaw) : null;
  if (promotionRaw && !/^\d{1,9}$/.test(promotionRaw)) errors.promotion_id = 'เลือกโปรโมชันจากรายการ';

  const sortRaw = (form.sort_order ?? '').trim() || '0';
  const sort_order = Number(sortRaw);
  if (!/^-?\d{1,6}$/.test(sortRaw)) errors.sort_order = 'ใส่ตัวเลขจำนวนเต็ม';

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      code_number,
      slug,
      name_th,
      name_en,
      short_desc_th,
      short_desc_en,
      long_desc_th,
      long_desc_en,
      price_satang: price as number,
      sale_price_satang,
      time_price_satang,
      category,
      thumbnail,
      image,
      promotion_id: promotionId,
      free_delivery: yes('free_delivery'),
      show_on_homepage: yes('show_on_homepage'),
      enabled: yes('enabled'),
      seo_title,
      seo_keywords,
      seo_description,
      sort_order,
    },
  };
}

/** ราคาโปร/Time price/โปรโมชัน/ส่งฟรีที่ตั้งไว้แต่ยังไม่มีผล — แสดงเตือนพนักงาน */
export function inactivePromoFields(p: ProductInput): string[] {
  const out: string[] = [];
  if (p.sale_price_satang !== null) out.push(`ราคาโปรโมชั่น ${formatBaht(p.sale_price_satang)}`);
  if (p.time_price_satang !== null) out.push(`Time price ${formatBaht(p.time_price_satang)}`);
  if (p.promotion_id !== null) out.push('ร่วมโปรโมชั่น');
  if (p.free_delivery) out.push('ส่งฟรี');
  return out;
}

/** ช่องที่เปลี่ยน {ช่อง: [เดิม, ใหม่]} — ใช้ทั้งบันทึกประวัติและตัดสินว่าต้องเขียนไหม */
export function diffProduct(before: ProductInput, after: ProductInput): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const key of Object.keys(PRODUCT_FIELD_LABELS) as (keyof ProductInput)[]) {
    if (before[key] !== after[key]) out[key] = [before[key], after[key]];
  }
  return out;
}

export const productUrl = (p: Pick<ProductInput, 'category' | 'slug'>) => `/menu/${p.category}/${p.slug}`;

/** สิ่งที่ในตารางไม่ตรงกับเมนูบนเว็บ (catalog.js) — แสดงเตือนพนักงานว่าแก้แล้วยังไม่ขึ้นเว็บ */
export function webDifferences(p: ProductRow, web: Product | undefined): string[] {
  if (p.deleted_at) return web ? ['ลบแล้ว แต่เว็บยังขาย'] : [];
  if (!web) return p.enabled ? ['ยังไม่มีบนเว็บ'] : [];
  if (!p.enabled) return ['ปิดขายแล้ว แต่เว็บยังขาย'];
  const out: string[] = [];
  const webPrice = Math.round(web.price * 100);
  if (webPrice !== p.price_satang) out.push(`ราคาบนเว็บ ${formatBaht(webPrice)}`);
  if (web.name !== p.name_th) out.push(`ชื่อบนเว็บ "${web.name}"`);
  if (web.category !== p.category || (web.url && web.url !== productUrl(p))) out.push(`ลิงก์บนเว็บ ${web.url}`);
  return out;
}

/** ค่าตั้งต้นของทุกช่อง (ใช้ตอนนำเข้า — catalog ของเว็บมีแค่ชื่อไทย ราคา หมวด รูป ลิงก์) */
export const EMPTY_PRODUCT: ProductInput = {
  code_number: '',
  slug: '',
  name_th: '',
  name_en: '',
  short_desc_th: '',
  short_desc_en: '',
  long_desc_th: '',
  long_desc_en: '',
  price_satang: 0,
  sale_price_satang: null,
  time_price_satang: null,
  category: '',
  thumbnail: '',
  image: '',
  promotion_id: null,
  free_delivery: 0,
  show_on_homepage: 0,
  enabled: 0,
  seo_title: '',
  seo_keywords: '',
  seo_description: '',
  sort_order: 0,
};

/** แปลง catalog ของเว็บ → แถวสำหรับนำเข้า (เฉพาะรหัสที่เป็นตัวเลข = รหัสจากฐานข้อมูลเดิม) */
export function importRowsFromCatalog(catalog: Catalog): { rows: (ProductInput & { id: number })[]; skipped: string[] } {
  const rows: (ProductInput & { id: number })[] = [];
  const skipped: string[] = [];
  for (const p of catalog.values()) {
    const slug = p.url.split('/').filter(Boolean).pop() ?? '';
    if (!/^\d+$/.test(p.id) || !SLUG_PATTERN.test(slug)) {
      skipped.push(p.id);
      continue;
    }
    rows.push({
      ...EMPTY_PRODUCT,
      id: Number(p.id),
      name_th: p.name,
      category: p.category,
      slug,
      price_satang: Math.round(p.price * 100),
      image: p.image,
      enabled: 1,
    });
  }
  return { rows, skipped };
}
