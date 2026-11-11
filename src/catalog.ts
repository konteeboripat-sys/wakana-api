// เมนู/ราคา = catalog.js ที่ wakana-site build ออกมา (window.WAKANA_CATALOG = {"products":{...}};)
// ใช้ที่มาเดียวกับตะกร้า ⇒ ราคาที่ server คิดตรงกับหน้าเว็บเสมอ ไม่ต้องดูแลรายการสินค้าสองที่

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  image: string;
  url: string;
}

export type Catalog = ReadonlyMap<string, Product>;

const CATALOG_PATH = '/assets/wakana/catalog.js';
// สั้นพอที่กด "อัปเดตหน้าเว็บ" แล้ว ราคาออเดอร์/คอลัมน์เทียบเว็บตามหน้าเว็บใหม่ภายในราว 1 นาที
const FRESH_MS = 60 * 1000;

export function parseCatalogScript(text: string): Catalog {
  const marker = text.indexOf('window.WAKANA_CATALOG');
  const eq = marker === -1 ? -1 : text.indexOf('=', marker);
  // จบที่ ; ตัวแรกที่ตามด้วยขึ้นบรรทัด (JSON ไม่มีขึ้นบรรทัดดิบในสตริง) — build ต่อ window.WAKANA_CART_CONFIG = …; ไว้บรรทัดถัดไป
  const nl = eq === -1 ? -1 : text.indexOf(';\n', eq);
  const end = nl === -1 ? text.lastIndexOf(';') : nl;
  if (eq === -1 || end <= eq) throw new Error('catalog.js: ไม่เจอ window.WAKANA_CATALOG = …;');
  const data: unknown = JSON.parse(text.slice(eq + 1, end));
  const products = (data as { products?: unknown } | null)?.products;
  if (!products || typeof products !== 'object') throw new Error('catalog.js: ไม่มี products');

  const out = new Map<string, Product>();
  for (const [id, raw] of Object.entries(products as Record<string, unknown>)) {
    const p = raw as Partial<Product> | null;
    if (
      !p ||
      typeof p.name !== 'string' ||
      typeof p.price !== 'number' ||
      !Number.isFinite(p.price) ||
      p.price <= 0 ||
      typeof p.category !== 'string'
    ) {
      throw new Error(`catalog.js: สินค้า ${id} ข้อมูลไม่ครบ`);
    }
    out.set(id, {
      id,
      name: p.name,
      price: p.price,
      category: p.category,
      image: typeof p.image === 'string' ? p.image : '',
      url: typeof p.url === 'string' ? p.url : '',
    });
  }
  if (!out.size) throw new Error('catalog.js: ไม่มีสินค้า');
  return out;
}

let cached: { catalog: Catalog; origin: string; fetchedAt: number } | null = null;

/** โหลด catalog จากเว็บ แคชในหน่วยความจำ 1 นาที · โหลดใหม่ไม่ได้แต่มีของเก่า = ใช้ของเก่าไปก่อน */
export async function loadCatalog(siteOrigin: string, now = Date.now()): Promise<Catalog> {
  if (cached && cached.origin === siteOrigin && now - cached.fetchedAt < FRESH_MS) return cached.catalog;
  try {
    const res = await fetch(siteOrigin.replace(/\/+$/, '') + CATALOG_PATH, { cf: { cacheTtl: 60, cacheEverything: true } });
    if (!res.ok) throw new Error(`catalog.js: HTTP ${res.status}`);
    const catalog = parseCatalogScript(await res.text());
    cached = { catalog, origin: siteOrigin, fetchedAt: now };
    return catalog;
  } catch (err) {
    if (cached && cached.origin === siteOrigin) {
      console.warn('catalog: โหลดใหม่ไม่ได้ ใช้ของเดิม', err instanceof Error ? err.message : err);
      return cached.catalog;
    }
    throw err;
  }
}

function normalize(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** ค้นจากชื่อ/หมวด/รหัส — ทุกคำต้องเจอ · ชื่อขึ้นต้นด้วยคำค้นมาก่อน */
export function searchProducts(catalog: Catalog, query: string, limit: number): Product[] {
  const q = normalize(query);
  if (!q) return [];
  const tokens = q.split(' ');
  const scored: { product: Product; score: number }[] = [];
  for (const product of catalog.values()) {
    const name = normalize(product.name);
    const haystack = `${name} ${normalize(product.category)} ${product.id.toLowerCase()}`;
    if (!tokens.every((t) => haystack.includes(t))) continue;
    const score = name.startsWith(q) ? 0 : name.includes(q) ? 1 : 2;
    scored.push({ product, score });
  }
  scored.sort((a, b) => a.score - b.score || a.product.name.localeCompare(b.product.name, 'th'));
  return scored.slice(0, limit).map((s) => s.product);
}
