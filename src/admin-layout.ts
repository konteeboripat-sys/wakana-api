// โครงหน้าหลังบ้านที่ใช้ร่วมกัน (ออเดอร์ · สินค้า)
// หน้าตาโทนเดียวกับหน้า login / เว็บหลัก: แถบบนขาวมีโลโก้ WAKANA + เส้นแดง · เมนูซ้าย · ฟอนต์ Kanit · เนื้อหาในการ์ดขาวบนพื้นเทาอ่อน

import { PASSWORD_SUFFIX, passwordLoginEnabled } from './auth.ts';
import { FAVICON_PNG_BASE64 } from './brand-favicon.ts';
import { LOGO_PNG_BASE64 } from './brand-logo.ts';
import type { Env } from './env.ts';
import { html, SafeHtml } from './html.ts';

const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500&display=swap';

function adminHeaders(env: Env): Record<string, string> {
  // รูปสินค้าอยู่บนเว็บ (SITE_ORIGIN) · ฟอนต์จาก Google Fonts · ไม่มีสคริปต์เลย
  let site = '';
  try {
    site = new URL(env.SITE_ORIGIN).origin;
  } catch {
    /* ตั้งค่าผิด = ไม่แสดงรูป */
  }
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' ${site}; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
  };
}

// โทนเดียวกับหน้า login / เว็บหลัก (wakana-site css/style12.css): Kanit · แดง #be2430 · hover เทาเข้ม #303030 · พื้นเทาอ่อน + การ์ดขาว
const STYLE = `
:root{color-scheme:light;--brand:#be2430;--primary:#be2430;--primary-dark:#303030;--primary-soft:rgba(190,36,48,.16);--primary-tint:#fdf1f2;
--success:#303030;--success-dark:#000;--link:#a81f29;
--fg:#292929;--muted:#8b8b8b;--bg:#f5f5f5;--side-bg:#fff;--side-fg:#303030;--row-alt:#fafafa;--line:#e6e6e6;--input:#dedede;--danger:#D9363E;--warn:#B7791F;--ok:#3C8D2F}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--fg);font:300 15px/1.6 Kanit,"Noto Sans Thai",system-ui,sans-serif}
a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline}strong,b,th,h1,h2{font-weight:500}
.topbar{display:flex;align-items:stretch;height:76px;background:#fff;color:var(--fg);border-top:4px solid var(--brand);box-shadow:0 1px 0 var(--line),0 2px 10px rgba(0,0,0,.04);position:sticky;top:0;z-index:2}
.topbar .brand{display:flex;align-items:center;gap:12px;width:260px;padding:0 20px;color:var(--muted);font-size:14px;text-decoration:none;white-space:nowrap}
.topbar .brand:hover{text-decoration:none}.topbar .brand img{height:52px;width:auto;display:block}
.topbar .who{margin-left:auto;display:flex;align-items:center;gap:6px;padding:0 24px;font-size:14px;color:var(--muted);white-space:nowrap;overflow:hidden}
.topbar .who a{color:var(--muted)}
.shell{display:flex;min-height:calc(100vh - 76px)}
.side{width:260px;flex:none;background:var(--side-bg);border-right:1px solid var(--line);padding:24px 0}
.side a{display:flex;align-items:center;gap:12px;padding:10px 20px;color:var(--side-fg);font-size:15px;font-weight:400;border-left:3px solid transparent}
.side a:hover{background:var(--bg);text-decoration:none}.side a[aria-current=page]{color:var(--brand);background:var(--primary-tint);border-left-color:var(--brand);font-weight:500}
.side svg{width:16px;height:16px;flex:none;fill:currentColor}
.side .off{display:flex;align-items:center;gap:12px;padding:10px 20px;color:#b8b8b8;font-size:15px;font-weight:400;border-left:3px solid transparent;cursor:not-allowed;user-select:none}
main{flex:1;min-width:0;margin:24px;padding:28px 28px 32px;background:#fff;border-radius:6px;box-shadow:0 2px 14px rgba(0,0,0,.05);align-self:flex-start}
@media (max-width:900px){.topbar .brand{width:auto}.shell{flex-direction:column}.side{width:auto;padding:0;display:flex;overflow-x:auto;border-right:0;border-bottom:1px solid var(--line)}
.side a,.side .off{padding:10px 14px;white-space:nowrap;border-left:0;border-bottom:3px solid transparent}.side a[aria-current=page]{border-bottom-color:var(--brand)}
main{margin:12px;padding:20px 16px;align-self:stretch}}
.card{background:#fff;margin-bottom:20px}
.filters{display:flex;flex-wrap:wrap;gap:10px 28px;align-items:end}.filters>a{padding:7px 4px}
.filters label{display:flex;flex-direction:column;font-size:15px;font-weight:500;color:var(--fg);gap:4px}
input,select,textarea{font:inherit;font-weight:300;color:#4C4F56;padding:6px 12px;border:1px solid var(--input);border-radius:4px;background:#fff;min-height:34px}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-soft)}
.filters input,.filters select{min-width:220px;max-width:320px}
button,.btn{cursor:pointer;display:inline-block;font:inherit;font-weight:400;font-size:14px;line-height:1.5;padding:5px 12px;border:1px solid var(--input);border-radius:4px;background:#fff;color:var(--fg);text-decoration:none}
button:hover,.btn:hover{text-decoration:none;filter:brightness(.97)}
.primary{background:var(--primary)!important;border-color:var(--primary)!important;color:#fff!important}.primary:hover{background:var(--primary-dark)!important;border-color:var(--primary-dark)!important}
.success{background:var(--success)!important;border-color:var(--success)!important;color:#fff!important}.success:hover{background:var(--success-dark)!important}
.danger{background:#fff!important;border-color:var(--danger)!important;color:var(--danger)!important}.danger:hover{background:var(--danger)!important;color:#fff!important}
button.danger{background:var(--danger)!important;color:#fff!important}.danger-link{color:var(--danger)}
.btn.disabled{opacity:.55;cursor:not-allowed;filter:none}.s-warn-text{color:var(--warn)}.s-disable{color:#D9246C}
.picker{max-height:380px;overflow:auto;border:1px solid var(--input);border-radius:4px;padding:8px 12px;background:#fff}
.settime-grid{display:grid;grid-template-columns:minmax(280px,1fr) minmax(0,2fr);gap:24px;align-items:start}.table-title{font-size:15px;font-weight:400;margin:0 0 8px}
@media (max-width:1100px){.settime-grid{grid-template-columns:1fr}}
.picker fieldset{border:none;margin:0 0 8px;padding:0}.picker legend{font-weight:500;font-size:14px;padding:4px 0}.picker .check{padding:2px 0}
.tabs{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 16px}.tabs a{padding:4px 12px;border:1px solid var(--input);border-radius:4px;color:var(--fg);font-size:14px;font-weight:400}
.tabs a:hover{text-decoration:none;background:var(--bg)}.tabs a[aria-current=page]{background:var(--primary);border-color:var(--primary);color:#fff}
.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:14px;font-weight:400}
th,td{text-align:left;padding:10px 6px;white-space:nowrap;vertical-align:top}
thead th{background:var(--bg);border-top:1px solid var(--line);border-bottom:2px solid var(--line);color:#303030}tbody tr:nth-child(odd){background:var(--row-alt)}tbody td{border-bottom:1px solid var(--line)}
tfoot th{border-top:2px solid var(--line)}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}td.wrap{white-space:normal;min-width:180px}
.badge{display:inline-block;font-weight:400}
.s-new{color:var(--danger);font-weight:500}.s-confirmed,.s-preparing,.s-warn{color:var(--warn)}.s-done,.s-ok{color:var(--ok)}.s-cancelled,.s-off{color:var(--muted)}
.s-warn{display:inline-block;padding:0 8px;border:1px solid currentColor;border-radius:4px;font-size:13px}
.flash{padding:10px 14px;border-radius:4px;border:1px solid var(--line);border-left:4px solid var(--brand);background:var(--primary-tint);margin-bottom:16px;font-weight:400}
.notice{color:var(--muted);font-size:13px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}
.grid>.card,.panel{border:1px solid var(--line);border-radius:4px;padding:16px}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0;font-weight:400}dt{color:var(--muted)}dd{margin:0;white-space:pre-wrap;word-break:break-word}
.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.actions form{margin:0}h1{font-size:22px;margin:0 0 16px}h2{font-size:17px;margin:0 0 12px}
.empty{padding:32px;text-align:center;color:var(--muted)}
.thumb{width:90px;height:90px;object-fit:cover;display:block;background:var(--side-bg)}
.form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px 24px}
.field{display:flex;flex-direction:column;gap:4px}.field>span{font-size:14px;font-weight:400}.field.full{grid-column:1/-1}
.field .err{color:var(--danger);font-size:13px}.field input[aria-invalid=true],.field select[aria-invalid=true],.field textarea[aria-invalid=true]{border-color:var(--danger)}
.check{display:flex;gap:8px;align-items:center;font-weight:400}.check input{width:18px;height:18px;min-height:0}
.preview{width:160px;height:160px;object-fit:cover;border:1px solid var(--line)}
.old-form{max-width:892px}.ftable{border-top:1px solid var(--line)}
.frow{display:grid;grid-template-columns:348px 1fr;border-bottom:1px solid var(--line)}.frow:nth-child(odd of .frow){background:var(--row-alt)}
.flabel{padding:12px 6px;font-size:14px;font-weight:400}.fcontrol{padding:6px 6px;display:flex;flex-direction:column;gap:4px;min-width:0}
.fcontrol input,.fcontrol select,.fcontrol textarea{width:100%}.fcontrol select.narrow{width:auto;min-width:90px;align-self:flex-start}
.fcontrol .err{color:var(--danger);font-size:13px}.fcontrol [aria-invalid=true]{border-color:var(--danger)}
.fcontrol input.readonly{background:var(--bg);color:var(--muted)}.back-btn{background:var(--primary-dark)!important;border-color:var(--primary-dark)!important;color:#fff!important;padding:8px 18px;font-size:15px}
.fhead .flabel{font-weight:500}.preview.small{width:100px;height:100px}
/* ไม่มีไฟล์รูป: ::after ของ <img> แสดงเฉพาะตอนโหลดรูปไม่ได้ (Chrome/Firefox) ⇒ บังไอคอนรูปเสีย · หลังบ้านไม่มี JavaScript (CSP) จึงใช้ onerror ไม่ได้ */
.thumb,.preview{position:relative}
img.thumb::after,img.preview::after,div.thumb::after{content:"ไม่มีรูป";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:var(--bg);border:1px dashed var(--input);color:var(--muted);font-size:13px;font-weight:300}
.fcontrol input.file{border:none;padding:4px 0;min-height:0;font-size:14px}.fcontrol .check{font-size:14px}
.submit-btn{background:var(--primary)!important;border-color:var(--primary)!important;color:#fff!important;padding:8px 18px;font-size:15px}.submit-btn:hover{background:var(--primary-dark)!important;border-color:var(--primary-dark)!important}
@media (max-width:700px){.frow{grid-template-columns:1fr}.flabel{padding-bottom:0}}
.topbar .who form{display:inline;margin:0}.topbar .who button{padding:0;border:none;background:none;color:var(--brand);font-size:14px;font-weight:400}
.topbar .who button:hover{text-decoration:underline;filter:none}
`;

// หน้า login ตามแบรนด์เว็บหลัก (wakana-site css/style12.css): ฟอนต์ Kanit · โลโก้ WAKANA · แดง #be2430 (ปุ่มใส่ตะกร้า) · hover #303030
const LOGIN_STYLE = `
:root{color-scheme:light;--red:#be2430;--red-soft:rgba(190,36,48,.18);--dark:#303030;--fg:#292929;--muted:#8b8b8b;--line:#dedede;--bg:#f5f5f5}
*{box-sizing:border-box}html,body{margin:0}
body{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:32px 16px;
background:var(--bg);color:var(--fg);font:400 16px/1.6 Kanit,"Noto Sans Thai",system-ui,sans-serif}
.card{width:100%;max-width:400px;background:#fff;border-top:4px solid var(--red);border-radius:6px;box-shadow:0 6px 24px rgba(0,0,0,.08);padding:36px 32px 32px}
.logo{display:block;width:230px;max-width:80%;height:auto;margin:0 auto 18px}
h1{margin:0 0 24px;text-align:center;font-size:17px;font-weight:400;color:var(--muted);letter-spacing:.02em}
.field{margin-bottom:16px}label{display:block;margin-bottom:6px;font-size:15px}
input{display:block;width:100%;height:44px;padding:8px 12px;font:inherit;font-weight:300;color:var(--fg);background:#fff;border:1px solid var(--line);border-radius:4px;transition:border-color .15s,box-shadow .15s}
input:focus{outline:0;border-color:var(--red);box-shadow:0 0 0 3px var(--red-soft)}
button{display:block;width:100%;height:46px;margin-top:24px;font:inherit;font-size:17px;color:#fff;background:var(--red);border:0;border-radius:4px;cursor:pointer;transition:background .15s}
button:hover{background:var(--dark)}button:focus-visible{outline:0;box-shadow:0 0 0 3px var(--red-soft)}
.alert{margin-bottom:18px;padding:10px 14px;border-left:4px solid var(--red);border-radius:4px;background:#fdecee;color:#8f1b24;font-size:15px}
footer{font-size:13px;color:var(--muted)}
@media (max-width:420px){.card{padding:28px 20px 24px}}
`;

// ไอคอนเมนูซ้าย (เส้นเรียบ ๆ แทน Font Awesome ของหน้าเดิม — ไม่ต้องโหลดไฟล์ไอคอนเพิ่ม)
const ICONS = {
  orders: 'M4 3h16v2H4zm0 4h16v2H4zm0 4h10v2H4zm0 4h16v2H4zm0 4h10v2H4z',
  products: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm2 0v14h14V5zm2 9 3-4 2.5 3 1.5-2 3 3z',
  catalog: 'M3 3h8v8H3zm2 2v4h4V5zm8-2h8v8h-8zm2 2v4h4V5zM3 13h8v8H3zm2 2v4h4v-4zm8-2h8v8h-8zm2 2v4h4v-4z',
  promotions: 'M3 8h18v4H3zm1 4h16v9H4zm7-4h2v13h-2zM12 8S10 3 7.5 4 9 8 12 8zm0 0s2-5 4.5-4S15 8 12 8z',
  rules: 'M3 8h18v4H3zm1 4h16v9H4zm7-4h2v13h-2zM12 8S10 3 7.5 4 9 8 12 8zm0 0s2-5 4.5-4S15 8 12 8z',
  settime: 'M3 8h18v4H3zm1 4h16v9H4zm7-4h2v13h-2zM12 8S10 3 7.5 4 9 8 12 8zm0 0s2-5 4.5-4S15 8 12 8z',
  monday: 'M3 8h18v4H3zm1 4h16v9H4zm7-4h2v13h-2zM12 8S10 3 7.5 4 9 8 12 8zm0 0s2-5 4.5-4S15 8 12 8z',
  stores: 'M6 2h12v20H6zm2 2v16h8V4zm1 2h2v2H9zm4 0h2v2h-2zm-4 4h2v2H9zm4 0h2v2h-2zm-4 4h2v2H9zm4 0h2v2h-2z',
  customers: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0zm15-9a3 3 0 1 0 0-6v6zm1 2a6 6 0 0 1 4 7h-4a8 8 0 0 0-3-6z',
  contacts: 'M2 5h20v14H2zm2 2v.5l8 5 8-5V7zm0 2.9V17h16V9.9l-8 5z',
  sitemap: 'M9 2h6v6h-2v3h7v5h2v6h-6v-6h2v-3h-5v3h2v6H9v-6h2v-3H6v3h2v6H2v-6h2v-5h7V8H9zm2 2v2h2V4zM4 18v2h2v-2zm7 0v2h2v-2zm7 0v2h2v-2z',
};

export type AdminSection = 'orders' | 'products' | 'catalog' | 'promotions' | 'rules' | 'settime' | 'monday' | 'stores' | 'customers' | 'contacts' | 'sitemap';

export function page(env: Env, o: { title: string; email: string; active: AdminSection; body: SafeHtml; status?: number }): Response {
  const nav = (key: AdminSection, href: string, label: string) =>
    html`<a href="${href}" ${o.active === key ? html`aria-current="page"` : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[key]}"/></svg>${label}</a>`;
  // เมนูที่ปิดใช้งาน: เห็นชื่อแต่กดไม่ได้ (ไม่มีลิงก์) — เปิดกลับ: เปลี่ยน navOff(...) เป็น nav(key, href, label)
  const navOff = (key: AdminSection, label: string) =>
    html`<span class="off" aria-disabled="true" title="ปิดใช้งานชั่วคราว"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[key]}"/></svg>${label}</span>`;
  // ออกจากระบบ = endpoint ของ Cloudflare Access (เปิด Access แล้ว) · หรือ POST /back/logout (เข้าด้วยหน้า /back/login)
  const accessOn = Boolean(env.ACCESS_TEAM_DOMAIN.trim() && env.ACCESS_AUD.trim());
  const logout = accessOn
    ? html` | <a href="/cdn-cgi/access/logout">ออกจากระบบ</a>`
    : passwordLoginEnabled(env) && o.email.endsWith(PASSWORD_SUFFIX)
      ? html` | <form method="post" action="/back/logout"><button type="submit">ออกจากระบบ</button></form>`
      : '';
  // เมนูซ้าย: 2026-10-29 ผู้ใช้ขอ "ปิดเมนู Promotion ทั้งหมด Store Location Customer Contact Us Catalog" ⇒ ซ่อนจากเมนู (comment)
  // หน้า/ข้อมูลยังอยู่ เปิดตรงจาก URL ได้ · เปิดกลับ: เอา // ออก
  // โปร/กติกาทุกหน้ายังเก็บข้อมูลอย่างเดียว ไม่มีผลกับราคา/ตะกร้า · Store Location ยังไม่มีผลกับหน้าเว็บ (ดู README)
  const menu = [
    nav('products', '/back/products', 'สินค้า'),
    // nav('catalog', '/back/catalog', 'Catalog'),
    nav('orders', '/back/orders', 'ออเดอร์'),
    // nav('promotions', '/back/promotions', 'Promotion'),
    // nav('rules', '/back/promotion-rules', 'Promotion Rule'),
    // nav('settime', '/back/promotion-settime', 'Promotion Settime'),
    // nav('monday', '/back/promotion-monday', 'Promotion Monday'),
    // nav('stores', '/back/stores', 'Store Location'),
    // nav('customers', '/back/customers', 'Customer'),
    // nav('contacts', '/back/contacts', 'Contact Us'),
    nav('sitemap', '/back/sitemap', 'Sitemap'),
  ];
  const doc = html`${head(o.title)}
<body><header class="topbar"><a class="brand" href="/back/products"><img src="${LOGO_PATH}" width="118" height="52" alt="WAKANA"></a>
<div class="who">สวัสดี ${o.email}${logout}</div></header>
<div class="shell"><nav class="side" aria-label="เมนูหลังบ้าน">${menu}</nav>
<main>${o.body}</main></div></body></html>`;
  return new Response(doc.value, { status: o.status ?? 200, headers: adminHeaders(env) });
}

function head(title: string): SafeHtml {
  return html`<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Wakana Delivery &amp; Catering</title>${ICON_LINKS}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONT_CSS}"><style>${new SafeHtml(STYLE)}</style></head>`;
}

/** หน้า login: การ์ดกลางจอ ไม่มีแถบบน/เมนูซ้าย · Kanit จาก Google Fonts (ฟอนต์บนเว็บหลักเรียกข้ามโดเมนไม่ได้ — ไม่มี CORS) */
export function loginPage(env: Env, o: { body: SafeHtml; status?: number }): Response {
  const doc = html`<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>เข้าสู่ระบบ · Wakana Delivery &amp; Catering</title>${ICON_LINKS}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONT_CSS}"><style>${new SafeHtml(LOGIN_STYLE)}</style></head>
<body>${o.body}</body></html>`;
  return new Response(doc.value, { status: o.status ?? 200, headers: adminHeaders(env) });
}

/** โลโก้ที่หลังบ้านเสิร์ฟเอง (เปิดได้โดยไม่ต้องล็อกอิน — หน้า login ใช้) */
export const LOGO_PATH = '/back/logo.png';
/** ไอคอนแท็บ — ตัวเดียวกับเว็บหลัก (/images/favicon-96x96.png) */
export const FAVICON_PATH = '/back/favicon.png';
const ICON_LINKS = new SafeHtml(`<link rel="icon" type="image/png" href="${FAVICON_PATH}" sizes="96x96"><link rel="apple-touch-icon" href="${FAVICON_PATH}">`);

function servePng(base64: string): Response {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
}
export const serveLogo = (): Response => servePng(LOGO_PNG_BASE64);
export const serveFavicon = (): Response => servePng(FAVICON_PNG_BASE64);

export function errorPage(env: Env, status: number, message: string): Response {
  const doc = html`<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>เข้าไม่ได้</title>${ICON_LINKS}
<link rel="stylesheet" href="${FONT_CSS}"></head>
<body style="font-family:Kanit,system-ui,sans-serif;font-weight:300;margin:0"><div style="background:#fff;border-top:4px solid #be2430;border-bottom:1px solid #e6e6e6;padding:12px 16px"><img src="${LOGO_PATH}" width="118" height="52" alt="WAKANA" style="display:block"></div>
<div style="padding:24px"><h1 style="font-weight:500;font-size:22px">เข้าหลังบ้านไม่ได้</h1><p>${message}</p></div></body></html>`;
  return new Response(doc.value, { status, headers: adminHeaders(env) });
}

export function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

/** กัน CSRF: ฟอร์มต้องส่งจากหน้า admin เอง */
export function sameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get('Origin');
  if (origin) return origin === url.origin;
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}

/** อ่านฟอร์มเป็น {ชื่อ: ค่า} (ช่องที่ส่งมาหลายค่าใช้ค่าแรก · ไฟล์ข้าม) */
export async function readForm(request: Request): Promise<Record<string, string>> {
  return (await readFormWithFiles(request)).fields;
}

/** เหมือน readForm แต่เก็บไฟล์ที่แนบมาด้วย (ช่องไฟล์ที่ไม่ได้เลือก = ไม่มีใน files) */
export async function readFormWithFiles(request: Request): Promise<{ fields: Record<string, string>; files: Record<string, File> }> {
  const fields: Record<string, string> = {};
  const files: Record<string, File> = {};
  for (const [key, entry] of await request.formData()) {
    // types ของ workers กับ node ซ้อนกันทำให้ entry เป็น string อย่างเดียว — ตอนรันจริงเป็น File ได้
    const value = entry as unknown as string | File;
    if (typeof value === 'string') {
      if (!(key in fields)) fields[key] = value;
    } else if (value.size > 0 && !(key in files)) {
      files[key] = value;
    }
  }
  return { fields, files };
}
