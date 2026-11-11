// หลังบ้าน /back — ออเดอร์ (แทน back/orderList.php ของเว็บเดิม) + router ของทุกหน้า admin
// หน้า HTML สร้างฝั่ง server ไม่มี JavaScript เลย (CSP ห้ามสคริปต์) · ทุกค่าที่มาจากลูกค้าผ่าน html`` ที่ escape ให้

import { errorPage, FAVICON_PATH, LOGO_PATH, page, readForm, redirect, sameOrigin, serveFavicon, serveLogo } from './admin-layout.ts';
import { handleProductsAdmin } from './admin-products.ts';
import { handleCatalogAdmin } from './admin-catalog.ts';
import { handleContactsAdmin } from './admin-contacts.ts';
import { handlePromotionRulesAdmin } from './admin-promotion-rules.ts';
import { handlePromotionSpecialAdmin } from './admin-promotion-special.ts';
import { handleCustomersAdmin } from './admin-customers.ts';
import { handleLogin, safeNext } from './admin-login.ts';
import { handleSitemapAdmin } from './admin-sitemap.ts';
import { handleStoresAdmin } from './admin-stores.ts';
import { handlePromotionsAdmin } from './admin-promotions.ts';
import { authenticateAdmin } from './auth.ts';
import { changeStatus, countOrders, getOrder, listOrders, type OrderEventRow, type OrderItemRow, type OrderRow } from './db.ts';
import type { Env } from './env.ts';
import { html, type SafeHtml } from './html.ts';
import { formatBaht, isOrderRef, isOrderStatus, ORDER_STATUSES, STATUS_LABELS, type OrderStatus } from './orders.ts';
import { legacyStatusLabel } from './orders-import.ts';
import { normalizePhone } from './phone.ts';
import { buildXlsx, XLSX_TYPE } from './xlsx.ts';
import { formatIsoAsThai, formatThaiDateTime, parseWallTime } from './wall-time.ts';

// ปุ่มเปลี่ยนสถานะที่แสดงตามสถานะปัจจุบัน (ทางหลัก) — เปลี่ยนข้ามขั้น/ย้อนกลับได้จากเมนู "เปลี่ยนเป็นสถานะอื่น"
const NEXT_STEPS: Record<OrderStatus, OrderStatus[]> = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['done', 'cancelled'],
  done: [],
  cancelled: ['new'],
};

const FLASH: Record<string, string> = {
  updated: 'เปลี่ยนสถานะแล้ว',
  conflict: 'ออเดอร์นี้ถูกเปลี่ยนสถานะไปก่อนแล้ว — ดูสถานะล่าสุดด้านล่าง',
  invalid: 'คำขอไม่ถูกต้อง',
};

const statusBadge = (s: OrderStatus) => html`<span class="badge s-${s}">${STATUS_LABELS[s]}</span>`;
// ออเดอร์เว็บเดิมแสดงสถานะแบบหน้า orderList.php เดิม ("Payment received ชำระเงินสำเร็จ") จนกว่าพนักงานจะเปลี่ยนสถานะ
const statusCell = (o: OrderRow) => {
  const legacy = legacyStatusLabel(o);
  return legacy ? html`<span class="badge s-${o.status}">${legacy}</span>` : statusBadge(o.status);
};
const methodLabel =(m: OrderRow['method']) => (m === 'delivery' ? 'จัดส่ง' : 'รับที่ร้าน');
const wantedLabel = (w: string) => {
  const ms = w ? parseWallTime(w) : null;
  return ms === null ? 'เร็วที่สุด' : formatThaiDateTime(ms);
};

// ---------- รายการออเดอร์ ----------

const PAGE_SIZE = 50;

/** ISO UTC → "2024-03-24 18:00:44" เวลาไทย (รูปเดียวกับคอลัมน์ OrderDate ของ orderList.php เดิม) */
const orderDateLabel = (iso: string) => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
};

/** ตัวกรองของหน้ารายการ (ใช้ร่วมกับ Export Excel ให้ได้ชุดเดียวกัน) */
function orderFilterOf(p: URLSearchParams) {
  const statusParam = p.get('status') ?? '';
  const status = isOrderStatus(statusParam) ? statusParam : '';
  const ref = (p.get('order_no') ?? '').trim().slice(0, 30);
  const name = (p.get('customer_name') ?? '').trim().slice(0, 100);
  // ?phone= มาจากลิงก์ "ดูออเดอร์" ในหน้า Customer (ลูกค้าจากออเดอร์) — ไม่มีช่องในฟอร์ม
  const phone = normalizePhone(p.get('phone') ?? '') ?? '';
  return { status, from: '', to: '', phone, text: '', ref, name } as const;
}

/** query string ของตัวกรอง (+ เลขหน้า) */
function orderQuery(f: ReturnType<typeof orderFilterOf>, page = 1): string {
  const next = new URLSearchParams();
  if (f.status) next.set('status', f.status);
  if (f.ref) next.set('order_no', f.ref);
  if (f.name) next.set('customer_name', f.name);
  if (f.phone) next.set('phone', f.phone);
  if (page > 1) next.set('page', String(page));
  const qs = next.toString();
  return qs ? `?${qs}` : '';
}

const ORDERS_EXPORT_PATH = '/back/orders/export.xlsx';

/** Export Excel: ออเดอร์ทั้งหมดตามตัวกรองเดียวกับหน้ารายการ (ไม่แบ่งหน้า) */
async function exportOrders(env: Env, url: URL): Promise<Response> {
  const orders = await listOrders(env.DB, orderFilterOf(url.searchParams), 100_000, 0);
  const xlsx = buildXlsx(
    'Orders',
    [
      ['OrderID', 'OrderDate', 'Customer Name', 'Email', 'Tel', 'Payment type', 'Total amt', 'Order Status'],
      ...orders.map((o) => [
        o.ref,
        orderDateLabel(o.created_at),
        o.customer_name,
        o.email ?? '',
        o.phone,
        o.payment_type ?? '',
        (o.grand_total_satang ?? o.total_satang) / 100,
        legacyStatusLabel(o) ?? STATUS_LABELS[o.status],
      ]),
    ],
    [16, 20, 30, 32, 16, 14, 12, 32]
  );
  const stamp = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  return new Response(xlsx, {
    headers: {
      'Content-Type': XLSX_TYPE,
      'Content-Disposition': `attachment; filename="orders-${stamp}.xlsx"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// หน้ารายการแบบเดียวกับ back/orderList.php เดิม: ตัวกรอง สถานะ · order_no · customer_name · คอลัมน์ OrderID … Order Status · ทุกวัน ใหม่สุดก่อน
async function orderList(env: Env, url: URL, email: string): Promise<Response> {
  const p = url.searchParams;
  const filter = orderFilterOf(p);
  const { status, ref, name, phone } = filter;
  const total = await countOrders(env.DB, filter);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageNo = Math.min(Math.max(1, Math.trunc(Number(p.get('page')) || 1)), pages);
  const orders = await listOrders(env.DB, filter, PAGE_SIZE, (pageNo - 1) * PAGE_SIZE);

  const pageLink = (n: number) => `/back/orders${orderQuery(filter, n)}`;

  const body = html`
<h1>ออเดอร์</h1>
<form class="card filters" method="get" action="/back/orders">
  <label>Order status<select name="status"><option value="">Select Order status</option>${ORDER_STATUSES.map(
    (s) => html`<option value="${s}" ${status === s ? html`selected` : ''}>${STATUS_LABELS[s]}</option>`
  )}</select></label>
  <label>order_no<input type="search" name="order_no" value="${ref}" placeholder="order_no" maxlength="30"></label>
  <label>customer_name<input type="search" name="customer_name" value="${name}" placeholder="customer_name" maxlength="100"></label>
  ${phone ? html`<input type="hidden" name="phone" value="${phone}">` : ''}
  <button class="primary" type="submit">Search</button>
  ${total > 0 ? html`<a class="btn success" href="${ORDERS_EXPORT_PATH}${orderQuery(filter)}">Export Excel</a>` : ''}
  ${phone ? html`<a href="/back/orders">ล้างเบอร์ ${phone}</a>` : ''}
</form>
<p class="notice">${total.toLocaleString('en-US')} รายการ${pages > 1 ? ` · หน้า ${pageNo}/${pages}` : ''}</p>
<div class="card table-wrap">
${
  orders.length
    ? html`<table>
  <thead><tr><th>OrderID</th><th>OrderDate</th><th>Customer Name</th><th>Payment type</th><th class="num">Total amt</th><th>Order Status</th></tr></thead>
  <tbody>${orders.map(
    (o) => html`<tr>
    <td><a href="/back/orders/${o.ref}">${o.ref}</a></td><td>${orderDateLabel(o.created_at)}</td>
    <td class="wrap">${o.customer_name}${o.email ? html`<br>${o.email}` : ''}</td>
    <td>${o.payment_type || '-'}</td><td class="num">${formatBaht(o.grand_total_satang ?? o.total_satang)}</td><td>${statusCell(o)}</td></tr>`
  )}</tbody></table>`
    : html`<div class="empty">ไม่มีออเดอร์ตามเงื่อนไขนี้</div>`
}
</div>
${
  pages > 1
    ? html`<nav class="actions" aria-label="เลขหน้า">${pageNo > 1 ? html`<a href="${pageLink(pageNo - 1)}">← ก่อนหน้า</a>` : ''}<span class="notice">หน้า ${pageNo} จาก ${pages}</span>${
        pageNo < pages ? html`<a href="${pageLink(pageNo + 1)}">ถัดไป →</a>` : ''
      }</nav>`
    : ''
}
<p class="notice">ออเดอร์ที่นี่บันทึกตอนลูกค้ากด "สั่งผ่าน LINE" — ลูกค้าต้องกดส่งในแชทเองอีกขั้น จึงอาจมีออเดอร์ที่ไม่ได้ส่งเข้า LINE จริง ตรวจกับแชทก่อนยืนยันทุกครั้ง</p>`;
  return page(env, { title: 'รายการออเดอร์', email, active: 'orders', body });
}

// ---------- รายละเอียดออเดอร์ ----------

function statusForm(ref: string, from: OrderStatus, to: OrderStatus, primary: boolean): SafeHtml {
  return html`<form method="post" action="/back/orders/${ref}/status">
<input type="hidden" name="from" value="${from}"><input type="hidden" name="to" value="${to}">
<button type="submit" ${primary ? html`class="primary"` : ''}>${to === 'cancelled' ? 'ยกเลิกออเดอร์' : `เปลี่ยนเป็น "${STATUS_LABELS[to]}"`}</button></form>`;
}

function itemsTable(items: OrderItemRow[], order: OrderRow): SafeHtml {
  return html`<div class="table-wrap"><table>
<thead><tr><th>#</th><th>รายการ</th><th class="num">ราคา</th><th class="num">จำนวน</th><th class="num">รวม</th></tr></thead>
<tbody>${items.map(
    (i) => html`<tr><td>${i.line_no}</td><td class="wrap">${i.name}<br><small class="notice">${i.product_id}</small></td>
<td class="num">${formatBaht(i.unit_price_satang)}</td><td class="num">${i.qty}</td><td class="num">${formatBaht(i.unit_price_satang * i.qty)}</td></tr>`
  )}</tbody>
<tfoot><tr><th colspan="3">รวม ${order.item_count} ชิ้น${order.method === 'delivery' ? ' (ยังไม่รวมค่าส่ง)' : ''}</th><th></th><th class="num">${formatBaht(order.total_satang)}</th></tr></tfoot>
</table></div>`;
}

function eventsList(events: OrderEventRow[]): SafeHtml {
  return html`<div class="table-wrap"><table><thead><tr><th>เมื่อ</th><th>สถานะ</th><th>โดย</th></tr></thead><tbody>${events.map(
    (e) => html`<tr><td>${formatIsoAsThai(e.at)}</td><td>${e.from_status ? html`${STATUS_LABELS[e.from_status]} → ` : 'สร้าง → '}${STATUS_LABELS[e.to_status]}</td><td>${e.actor === 'web' ? 'ลูกค้า (เว็บ)' : e.actor}</td></tr>`
  )}</tbody></table></div>`;
}

async function orderDetail(env: Env, url: URL, ref: string, email: string): Promise<Response> {
  const data = await getOrder(env.DB, ref);
  if (!data) {
    return page(env, { title: 'ไม่พบออเดอร์', email, active: 'orders', status: 404, body: html`<div class="card empty">ไม่พบออเดอร์ ${ref} · <a href="/back/orders">กลับรายการ</a></div>` });
  }
  const { order, items, events } = data;
  const flash = FLASH[url.searchParams.get('msg') ?? ''];
  const others = ORDER_STATUSES.filter((s) => s !== order.status && !NEXT_STEPS[order.status].includes(s));

  const body = html`
<p><a href="/back/orders">← กลับรายการ</a></p>
${flash ? html`<div class="flash" role="status">${flash}</div>` : ''}
<h1>${order.ref} ${statusCell(order)}</h1>
<div class="card actions">
  ${NEXT_STEPS[order.status].map((to, i) => statusForm(order.ref, order.status, to, i === 0 && to !== 'cancelled'))}
  ${
    others.length
      ? html`<form method="post" action="/back/orders/${order.ref}/status" class="actions">
  <input type="hidden" name="from" value="${order.status}">
  <select name="to" aria-label="สถานะอื่น">${others.map((s) => html`<option value="${s}">${STATUS_LABELS[s]}</option>`)}</select>
  <button type="submit">เปลี่ยนเป็นสถานะอื่น</button></form>`
      : ''
  }
</div>
<div class="grid">
  <section class="card"><h2>ผู้สั่ง</h2><dl>
    <dt>ชื่อ</dt><dd>${order.customer_name}</dd>
    <dt>โทร</dt><dd><a href="tel:${order.phone.replace(/-/g, '')}">${order.phone}</a></dd>
    <dt>วิธีรับ</dt><dd>${methodLabel(order.method)}</dd>
    ${order.method === 'delivery' ? html`<dt>ที่อยู่</dt><dd>${order.address}</dd>` : ''}
    ${order.location ? html`<dt>พิกัด</dt><dd><a href="https://maps.google.com/?q=${order.location}" target="_blank" rel="noopener noreferrer">เปิดแผนที่</a></dd>` : ''}
    <dt>ต้องการรับ</dt><dd>${wantedLabel(order.wanted_at)}</dd>
    ${order.note ? html`<dt>หมายเหตุ</dt><dd>${order.note}</dd>` : ''}
    ${order.email ? html`<dt>อีเมล</dt><dd>${order.email}</dd>` : ''}
    ${order.payment_type ? html`<dt>ชำระ</dt><dd>${order.payment_type}</dd>` : ''}
    ${order.grand_total_satang !== null && order.grand_total_satang !== undefined ? html`<dt>ยอดสุทธิ</dt><dd>${formatBaht(order.grand_total_satang)} บาท</dd>` : ''}
    <dt>สั่งเมื่อ</dt><dd>${formatIsoAsThai(order.created_at)}</dd>
  </dl></section>
  <section class="card"><h2>ประวัติสถานะ</h2>${eventsList(events)}</section>
</div>
<section class="card"><h2>รายการอาหาร</h2>${itemsTable(items, order)}
<p class="notice">ราคา ณ ตอนสั่ง คิดโดย server จากเมนูบนเว็บ — ถ้าข้อความใน LINE ไม่ตรงกับตรงนี้ แปลว่าลูกค้าแก้ข้อความก่อนส่ง</p></section>`;
  return page(env, { title: order.ref, email, active: 'orders', body });
}

// ---------- เปลี่ยนสถานะ ----------

async function updateStatus(request: Request, env: Env, url: URL, ref: string, email: string): Promise<Response> {
  if (!sameOrigin(request, url)) return errorPage(env, 403, 'คำขอไม่ได้มาจากหน้าหลังบ้าน');
  const form = await readForm(request);
  const { from, to } = form;
  if (!isOrderStatus(from) || !isOrderStatus(to) || from === to) return redirect(`/back/orders/${ref}?msg=invalid`);
  const ok = await changeStatus(env.DB, ref, from, to, email, new Date().toISOString());
  return redirect(`/back/orders/${ref}?msg=${ok ? 'updated' : 'conflict'}`);
}

// ---------- router ----------

export async function handleAdmin(request: Request, env: Env, url: URL, path: string): Promise<Response> {
  if (path === '/back/login' || path === '/back/logout') return handleLogin(request, env, url, path);
  if (path === LOGO_PATH && (request.method === 'GET' || request.method === 'HEAD')) return serveLogo();
  if (path === FAVICON_PATH && (request.method === 'GET' || request.method === 'HEAD')) return serveFavicon();

  const auth = await authenticateAdmin(request, env);
  if (!auth.ok) {
    // ยังไม่ล็อกอิน (โหมดรหัสผ่าน): เปิดหน้า → ไปหน้า login แล้วกลับมาหน้าเดิม · ส่งฟอร์มค้าง = บอกให้ล็อกอินใหม่
    if (auth.login) {
      if (request.method === 'GET' || request.method === 'HEAD') return redirect(`/back/login?next=${encodeURIComponent(safeNext(path + url.search))}`);
      return errorPage(env, 401, 'หมดเวลาเข้าสู่ระบบ — เข้าสู่ระบบใหม่ที่ /back/login แล้วทำรายการอีกครั้ง');
    }
    return errorPage(env, auth.status, auth.reason);
  }
  const { email } = auth.identity;
  const isRead = request.method === 'GET' || request.method === 'HEAD';

  if (path === '/back') return redirect('/back/products');
  if (path === '/back/products' || path.startsWith('/back/products/')) return handleProductsAdmin(request, env, url, path, email);
  if (path === '/back/catalog' || path.startsWith('/back/catalog/')) return handleCatalogAdmin(request, env, path, email);
  if (path === '/back/promotions' || path.startsWith('/back/promotions/')) return handlePromotionsAdmin(request, env, url, path, email);
  if (path === '/back/promotion-rules' || path.startsWith('/back/promotion-rules/')) return handlePromotionRulesAdmin(request, env, url, path, email);
  if (path === '/back/promotion-settime' || path === '/back/promotion-monday') return handlePromotionSpecialAdmin(request, env, url, path, email);
  if (path === '/back/stores' || path.startsWith('/back/stores/')) return handleStoresAdmin(request, env, url, path, email);
  if (path === '/back/customers' || path.startsWith('/back/customers/')) return handleCustomersAdmin(request, env, url, path, email);
  if (path === '/back/contacts' || path.startsWith('/back/contacts/')) return handleContactsAdmin(request, env, url, path, email);
  if (path === '/back/sitemap' || path.startsWith('/back/sitemap/')) return handleSitemapAdmin(request, env, url, path, email);

  if (path === '/back/orders') return isRead ? orderList(env, url, email) : errorPage(env, 405, 'ไม่รองรับคำขอนี้');
  if (path === ORDERS_EXPORT_PATH) return isRead ? exportOrders(env, url) : errorPage(env, 405, 'ไม่รองรับคำขอนี้');

  const m = /^\/back\/orders\/([^/]+)(\/status)?$/.exec(path);
  if (m && isOrderRef(m[1])) {
    const ref = m[1];
    if (m[2]) return request.method === 'POST' ? updateStatus(request, env, url, ref, email) : errorPage(env, 405, 'ไม่รองรับคำขอนี้');
    return isRead ? orderDetail(env, url, ref, email) : errorPage(env, 405, 'ไม่รองรับคำขอนี้');
  }
  return errorPage(env, 404, 'ไม่พบหน้านี้');
}
