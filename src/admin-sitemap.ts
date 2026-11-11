// หลังบ้าน /back/sitemap — อัปโหลด sitemap.xml ให้หน้าเว็บใช้แทนไฟล์ static ของเว็บ (wakana-site public/sitemap.xml)
// เก็บใน D1 ตาราง site_sitemap (แถวเดียว) · เสิร์ฟที่ GET /sitemap.xml — เว็บ (wakana-site src/worker.js) ส่ง /sitemap.xml มาที่นี่
// ⇒ อัปโหลด/ลบมีผลบนเว็บทันที ไม่ต้อง build · ยังไม่อัปโหลด = 404 → เว็บใช้ไฟล์ static เดิม
// ตรวจไฟล์ก่อนเก็บ (sitemap.ts): XML ถูกรูป · <urlset> ของ sitemaps.org · ทุก <loc> อยู่บน SITE_ORIGIN

import { errorPage, page, readFormWithFiles, redirect, sameOrigin } from './admin-layout.ts';
import type { Env } from './env.ts';
import { html, type SafeHtml } from './html.ts';
import { checkSitemap, checkSitemapFile, MAX_SITEMAP_URLS } from './sitemap.ts';
import { formatIsoAsThai } from './wall-time.ts';

const BASE = '/back/sitemap';
export const SITEMAP_VIEW_PATH = `${BASE}/current.xml`;
/** แสดง URL ในหน้าไม่เกินเท่านี้ (ไฟล์เต็มดูได้จากลิงก์) */
const LIST_LIMIT = 500;

export interface SitemapRow {
  xml: string;
  url_count: number;
  file_name: string;
  uploaded_at: string;
  uploaded_by: string;
}

export const getSitemap = (db: D1Database) => db.prepare('SELECT xml, url_count, file_name, uploaded_at, uploaded_by FROM site_sitemap WHERE id = 1').first<SitemapRow>();

const FLASH: Record<string, string> = {
  uploaded: 'อัปโหลด sitemap แล้ว — /sitemap.xml บนเว็บใช้ไฟล์นี้ทันที (แคชไม่เกิน 5 นาที)',
  deleted: 'ลบ sitemap ที่อัปโหลดแล้ว — /sitemap.xml บนเว็บกลับไปใช้ไฟล์เดิม',
};

/** GET /sitemap.xml (สาธารณะ) — ไฟล์ที่อัปโหลด · 404 = ยังไม่อัปโหลด */
export async function serveSitemap(env: Env): Promise<Response> {
  const row = await getSitemap(env.DB);
  if (!row) return new Response('not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  return new Response(row.xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Last-Modified': new Date(row.uploaded_at).toUTCString(),
    },
  });
}

function uploadForm(error?: string): SafeHtml {
  return html`<form class="card panel" method="post" action="${BASE}" enctype="multipart/form-data">
<h2>อัปโหลด sitemap.xml</h2>
<div class="fcontrol">
  <input class="file" type="file" name="sitemap" accept=".xml,application/xml,text/xml" required ${error ? html`aria-invalid="true"` : ''}>
  ${error ? html`<span class="err" role="alert">${error}</span>` : ''}
</div>
<p class="notice">XML UTF-8 ไม่เกิน 1 MB · แท็กนอกสุด &lt;urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"&gt; · ไม่เกิน ${MAX_SITEMAP_URLS.toLocaleString('en-US')} URL · ทุก &lt;loc&gt; ต้องเป็น URL เต็มของเว็บ<br>
อัปโหลดใหม่ = ทับไฟล์เดิม · /sitemap.xml บนเว็บใช้ไฟล์นี้ตามที่อัปโหลดทันที (ระบบไม่ตัด/เพิ่มหน้าสินค้าให้ — สินค้าที่ปิดขายหรือเพิ่มใหม่ต้องแก้ในไฟล์เอง)</p>
<button class="submit-btn" type="submit">อัปโหลด</button>
</form>`;
}

async function sitemapPage(env: Env, url: URL, email: string, error?: string): Promise<Response> {
  const row = await getSitemap(env.DB);
  const msg = url.searchParams.get('msg') ?? '';
  const flash = FLASH[msg];
  const parsed = row ? checkSitemap(row.xml, env.SITE_ORIGIN) : null;
  const urls = parsed?.ok ? parsed.urls : [];

  const body = html`
<h1>Sitemap</h1>
${flash ? html`<div class="flash" role="status">${flash}</div>` : ''}
${
  row
    ? html`<section class="card panel"><h2>ไฟล์ที่ใช้อยู่</h2><dl>
  <dt>ไฟล์</dt><dd>${row.file_name} · <a href="${SITEMAP_VIEW_PATH}" target="_blank" rel="noopener">ดูไฟล์</a></dd>
  <dt>จำนวน URL</dt><dd>${row.url_count.toLocaleString('en-US')}</dd>
  <dt>อัปโหลดเมื่อ</dt><dd>${formatIsoAsThai(row.uploaded_at)} โดย ${row.uploaded_by}</dd>
</dl>
<form method="post" action="${BASE}/delete" class="actions" style="margin-top:12px"><button class="danger" type="submit">ลบ (กลับไปใช้ sitemap เดิมของเว็บ)</button></form>
</section>`
    : html`<div class="flash">ยังไม่ได้อัปโหลด — /sitemap.xml บนเว็บใช้ไฟล์เดิมของเว็บ</div>`
}
${uploadForm(error)}
${
  urls.length
    ? html`<section class="card"><h2>URL ในไฟล์</h2><div class="table-wrap"><table><thead><tr><th class="num">#</th><th>loc</th></tr></thead><tbody>${urls
        .slice(0, LIST_LIMIT)
        .map((u, n) => html`<tr><td class="num">${n + 1}</td><td class="wrap"><a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a></td></tr>`)}</tbody></table></div>
${urls.length > LIST_LIMIT ? html`<p class="notice">แสดง ${LIST_LIMIT} จาก ${urls.length.toLocaleString('en-US')} URL — ดูทั้งหมดจาก "ดูไฟล์"</p>` : ''}</section>`
    : ''
}`;
  return page(env, { title: 'Sitemap', email, active: 'sitemap', body, status: error ? 422 : 200 });
}

async function upload(request: Request, env: Env, url: URL, email: string): Promise<Response> {
  const { files } = await readFormWithFiles(request);
  const file = files.sitemap;
  if (!file) return sitemapPage(env, url, email, 'เลือกไฟล์ sitemap.xml ก่อน');
  const check = await checkSitemapFile(file, env.SITE_ORIGIN);
  if (!check.ok) return sitemapPage(env, url, email, check.error);
  const name = (file.name || 'sitemap.xml').slice(0, 200);
  await env.DB.prepare(
    `INSERT INTO site_sitemap (id, xml, url_count, file_name, uploaded_at, uploaded_by) VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET xml = excluded.xml, url_count = excluded.url_count, file_name = excluded.file_name, uploaded_at = excluded.uploaded_at, uploaded_by = excluded.uploaded_by`
  )
    .bind(check.xml, check.urls.length, name, new Date().toISOString(), email)
    .run();
  return redirect(`${BASE}?msg=uploaded`);
}

async function remove(env: Env): Promise<Response> {
  const { meta } = await env.DB.prepare('DELETE FROM site_sitemap WHERE id = 1').run();
  return redirect(meta.changes ? `${BASE}?msg=deleted` : BASE);
}

/** ไฟล์ที่ใช้อยู่ (ดูในหลังบ้าน) — CSP sandbox: เปิดใน origin ของหลังบ้านแต่รันอะไรไม่ได้ */
function viewFile(env: Env, row: SitemapRow | null): Response {
  if (!row) return errorPage(env, 404, 'ยังไม่ได้อัปโหลด sitemap');
  return new Response(row.xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}

export async function handleSitemapAdmin(request: Request, env: Env, url: URL, path: string, email: string): Promise<Response> {
  const isRead = request.method === 'GET' || request.method === 'HEAD';
  if (path === SITEMAP_VIEW_PATH) return isRead ? viewFile(env, await getSitemap(env.DB)) : errorPage(env, 405, 'ไม่รองรับคำขอนี้');
  if (path === BASE && isRead) return sitemapPage(env, url, email);
  if (request.method !== 'POST') return errorPage(env, path === BASE || path === `${BASE}/delete` ? 405 : 404, 'ไม่รองรับคำขอนี้');
  if (!sameOrigin(request, url)) return errorPage(env, 403, 'คำขอไม่ได้มาจากหน้าหลังบ้าน');
  if (path === BASE) return upload(request, env, url, email);
  if (path === `${BASE}/delete`) return remove(env);
  return errorPage(env, 404, 'ไม่พบหน้านี้');
}
