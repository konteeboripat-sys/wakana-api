// API สาธารณะที่หน้าเว็บเรียก: เมนู · ค้นหา · ส่งออเดอร์

import { loadCatalog, searchProducts, type Catalog, type Product } from './catalog.ts';
import { validateContact } from './contact.ts';
import { insertContact } from './contact-db.ts';
import { insertOrder } from './db.ts';
import { mediaKeyFromPath } from './media.ts';
import { handleExport } from './export.ts';
import { serveSitemap } from './admin-sitemap.ts';
import type { Env } from './env.ts';
import { allowedOrigins, corsHeaders, json, preflight } from './http.ts';
import { newOrderRef, validateOrder, type OrderRules } from './orders.ts';
import { catalogFromDb } from './products-db.ts';
import { minutesOfDay } from './wall-time.ts';

const MAX_BODY_BYTES = 16 * 1024;
const SEARCH_MAX_LIMIT = 50;

export function rulesFromEnv(env: Env): OrderRules {
  const open = minutesOfDay(env.SERVICE_OPEN);
  const close = minutesOfDay(env.SERVICE_CLOSE);
  const lead = Number(env.PARTY_LEAD_MINUTES);
  if (open === null || close === null || !(close > open) || !Number.isInteger(lead) || lead < 0) {
    throw new Error('ตั้งค่า SERVICE_OPEN / SERVICE_CLOSE / PARTY_LEAD_MINUTES ไม่ถูกต้อง');
  }
  return { serviceOpen: open, serviceClose: close, partyCategory: env.PARTY_CATEGORY, partyLeadMinutes: lead, graceMinutes: 10 };
}

function productJson(p: Product, siteOrigin: string, apiOrigin: string) {
  const abs = (u: string) => (u ? new URL(u, siteOrigin).href : '');
  // รูปที่อัปโหลดเข้าหลังบ้าน (/media/...) เสิร์ฟจาก API นี้ ไม่ได้อยู่บนเว็บ
  const image = mediaKeyFromPath(p.image) ? new URL(p.image, apiOrigin).href : abs(p.image);
  return { id: p.id, name: p.name, price: p.price, category: p.category, image, url: abs(p.url) };
}

async function catalogOr503(env: Env, cors: Record<string, string>): Promise<Catalog | Response> {
  try {
    if (env.PRICE_SOURCE === 'd1') {
      const catalog = await catalogFromDb(env.DB);
      if (!catalog.size) throw new Error('ตาราง products ว่าง (PRICE_SOURCE = d1)');
      return catalog;
    }
    return await loadCatalog(env.SITE_ORIGIN);
  } catch (err) {
    console.error('catalog: โหลดไม่ได้', err instanceof Error ? err.message : err);
    return json({ error: 'catalog_unavailable' }, 503, cors);
  }
}

async function createOrder(request: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(request, env);
  const origin = request.headers.get('Origin');
  // ไม่มี Origin = ไม่ได้มาจากเบราว์เซอร์ (curl/server) ปล่อยผ่านให้ rate limit คุม · มี Origin ต้องเป็นเว็บของเรา
  if (origin && !allowedOrigins(env).has(origin)) return json({ error: 'origin_not_allowed' }, 403);

  if (env.ORDER_LIMITER) {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const { success } = await env.ORDER_LIMITER.limit({ key: ip });
    if (!success) return json({ error: 'rate_limited' }, 429, { ...cors, 'Retry-After': '60' });
  }

  // รับ text/plain ด้วย: เว็บยิงแบบ simple request (ไม่มี preflight) ⇒ ใช้ fetch keepalive/sendBeacon ตอนกำลังเปิด LINE ได้
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json' && type !== 'text/plain') return json({ error: 'unsupported_media_type' }, 415, cors);
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413, cors);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413, cors);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'invalid_json' }, 400, cors);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'invalid_json' }, 400, cors);
  const input = body as Record<string, unknown>;
  if (input.ref === undefined) input.ref = newOrderRef((n) => crypto.getRandomValues(new Uint8Array(n)));

  const catalog = await catalogOr503(env, cors);
  if (catalog instanceof Response) return catalog;

  const result = validateOrder(input, catalog, rulesFromEnv(env), Date.now());
  if (!result.ok) {
    // log แค่ช่องที่ผิด ไม่ log ข้อมูลลูกค้า
    console.warn('order: ไม่ผ่าน', typeof input.ref === 'string' ? input.ref.slice(0, 20) : '-', Object.keys(result.errors).join(','));
    return json({ error: 'invalid_order', errors: result.errors }, 422, cors);
  }

  const { created } = await insertOrder(env.DB, result.order, new Date().toISOString());
  const o = result.order;
  return json(
    { ref: o.ref, created, itemCount: o.itemCount, total: o.totalSatang / 100, lines: o.lines.map((l) => ({ id: l.productId, name: l.name, price: l.unitPriceSatang / 100, qty: l.qty })) },
    created ? 201 : 200,
    cors
  );
}

const MAX_CONTACT_BYTES = 8 * 1024;

/** POST /contact — ฟอร์มติดต่อบนหน้า /contactus ของเว็บ · กันสแปมดู contact.ts */
async function createContact(request: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(request, env);
  const origin = request.headers.get('Origin');
  if (origin && !allowedOrigins(env).has(origin)) return json({ error: 'origin_not_allowed' }, 403);

  if (env.CONTACT_LIMITER) {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const { success } = await env.CONTACT_LIMITER.limit({ key: ip });
    if (!success) return json({ error: 'rate_limited' }, 429, { ...cors, 'Retry-After': '60' });
  }

  const type = (request.headers.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json' && type !== 'text/plain') return json({ error: 'unsupported_media_type' }, 415, cors);
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_CONTACT_BYTES) return json({ error: 'payload_too_large' }, 413, cors);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_CONTACT_BYTES) return json({ error: 'payload_too_large' }, 413, cors);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'invalid_json' }, 400, cors);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'invalid_json' }, 400, cors);

  const result = validateContact(body as Record<string, unknown>);
  if (!result.ok) return json({ error: 'invalid_contact', errors: result.errors }, 422, cors);
  // บอทชัด ๆ: ไม่เก็บ แต่ตอบเหมือนสำเร็จ · log แค่เหตุผล ไม่ log ข้อมูลผู้ส่ง
  if (!result.message) {
    console.warn('contact: ทิ้ง', result.dropped);
    return json({ ok: true }, 201, cors);
  }
  const id = await insertContact(env.DB, result.message, new Date().toISOString());
  if (result.message.spamReason) console.warn('contact: เก็บเป็นสแปม', id, result.message.spamReason);
  return json({ ok: true }, 201, cors);
}

export async function handleApi(request: Request, env: Env, url: URL, path: string): Promise<Response> {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') return preflight(request, env);

  if (path === '/orders') {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { ...cors, Allow: 'POST, OPTIONS' });
    return createOrder(request, env);
  }
  if (path === '/contact') {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { ...cors, Allow: 'POST, OPTIONS' });
    return createContact(request, env);
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'method_not_allowed' }, 405, { ...cors, Allow: 'GET' });

  if (path === '/' || path === '/health') return json({ ok: true, service: 'wakana-api' }, 200, cors);

  // สำหรับ build หน้าเว็บ (server-to-server) — ไม่ส่ง CORS
  if (path === '/export/products') return handleExport(request, env, url);
  // เว็บ (wakana-site src/worker.js) ส่ง /sitemap.xml มาที่นี่ · 404 = ยังไม่อัปโหลด → เว็บใช้ไฟล์ static เดิม
  if (path === '/sitemap.xml') return serveSitemap(env);

  if (path === '/products') {
    const catalog = await catalogOr503(env, cors);
    if (catalog instanceof Response) return catalog;
    const category = url.searchParams.get('category') ?? '';
    const products = [...catalog.values()].filter((p) => !category || p.category === category).map((p) => productJson(p, env.SITE_ORIGIN, url.origin));
    // หน้าเว็บดึงข้อมูลสินค้าสดจากตรงนี้ (wakana-site live-catalog.js: ราคา ชื่อ รูป · ไม่อยู่ในรายการ = ปิดขาย) — ไม่แคช: บันทึกแล้วรีเฟรชเห็นทันที
    return json({ count: products.length, products }, 200, { ...cors, 'Cache-Control': 'no-store' });
  }

  if (path === '/search') {
    const q = (url.searchParams.get('q') ?? '').trim();
    if (!q || q.length > 50) return json({ error: 'invalid_query', message: 'ใส่คำค้น q ยาว 1–50 ตัวอักษร' }, 400, cors);
    const limitParam = Number(url.searchParams.get('limit') ?? 20);
    const limit = Number.isInteger(limitParam) ? Math.min(Math.max(limitParam, 1), SEARCH_MAX_LIMIT) : 20;
    const catalog = await catalogOr503(env, cors);
    if (catalog instanceof Response) return catalog;
    const results = searchProducts(catalog, q, limit).map((p) => productJson(p, env.SITE_ORIGIN, url.origin));
    return json({ q, count: results.length, results }, 200, { ...cors, 'Cache-Control': 'public, max-age=60' });
  }

  return json({ error: 'not_found' }, 404, cors);
}
