// หลังบ้าน /back/customers — แทนหน้า Customer ของเว็บเดิม · อ่านอย่างเดียว
//   คอลัมน์ตามหน้าเดิม (Name · Email · Tel · Company · register_date) จากตาราง customers (นำเข้าจากเว็บเดิม · scripts/import-customers.mjs)
//   แท็บ "สมาชิก (เว็บเดิม)" (ค่าเริ่มต้น) / "ลูกค้าจากออเดอร์" (?tab=orders) — เอาออก 2026-10-16 · เปิดแท็บออเดอร์กลับ 2026-10-22 (หลังนำเข้าออเดอร์เว็บเดิม)

import { errorPage, page } from './admin-layout.ts';
import type { Env } from './env.ts';
import { html } from './html.ts';
import { formatBaht } from './orders.ts';
import { formatIsoAsThai } from './wall-time.ts';
import { buildXlsx, XLSX_TYPE } from './xlsx.ts';

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

interface MemberRow {
  name: string;
  email: string;
  tel: string;
  company: string;
  register_date: string;
}

/** สมาชิก (นำเข้าจากเว็บเดิม) · ค้นชื่อ/อีเมล/เบอร์ (เบอร์เทียบแบบตัดขีดทิ้ง) · หน้าเว็บแสดง 500 · Export ใช้ทั้งหมด */
async function listMembers(db: D1Database, q: string, limit = 500): Promise<{ rows: MemberRow[]; total: number }> {
  const like = q ? `%${escapeLike(q)}%` : '';
  const digits = q.replace(/\D/g, '');
  const [list, count] = await db.batch([
    db
      .prepare(
        `SELECT name, email, tel, company, register_date FROM customers
         WHERE (?1 = '' OR name LIKE ?1 ESCAPE '\\' OR email LIKE ?1 ESCAPE '\\' OR (?2 != '' AND replace(replace(tel, '-', ''), ' ', '') LIKE '%' || ?2 || '%'))
         ORDER BY register_date DESC
         LIMIT ?3`
      )
      .bind(like, digits.length >= 3 ? digits : '', limit),
    db.prepare('SELECT COUNT(*) AS n FROM customers'),
  ]);
  return { rows: (list?.results ?? []) as MemberRow[], total: ((count?.results?.[0] as { n?: number } | undefined)?.n ?? 0) };
}

interface OrderCustomerRow {
  phone: string;
  name: string;
  orders: number;
  total_satang: number;
  first_at: string;
  last_at: string;
}

/** ลูกค้าจากออเดอร์ รวมตามเบอร์โทร · ชื่อ = ชื่อในออเดอร์ล่าสุด · ยอดรวมไม่นับที่ยกเลิก · ค้นชื่อ/เบอร์ · แสดง 500 ที่สั่งล่าสุด */
async function listOrderCustomers(db: D1Database, q: string, limit = 500): Promise<{ rows: OrderCustomerRow[]; total: number }> {
  const like = q ? `%${escapeLike(q)}%` : '';
  const digits = q.replace(/\D/g, '');
  const [list, count] = await db.batch([
    db
      .prepare(
        `SELECT o.phone,
                (SELECT customer_name FROM orders x WHERE x.phone = o.phone ORDER BY x.created_at DESC LIMIT 1) AS name,
                COUNT(*) AS orders,
                SUM(CASE WHEN o.status = 'cancelled' THEN 0 ELSE o.total_satang END) AS total_satang,
                MIN(o.created_at) AS first_at,
                MAX(o.created_at) AS last_at
         FROM orders o
         GROUP BY o.phone
         HAVING ?1 = '' OR name LIKE ?1 ESCAPE '\\' OR (?2 != '' AND replace(o.phone, '-', '') LIKE '%' || ?2 || '%')
         ORDER BY last_at DESC
         LIMIT ?3`
      )
      .bind(like, digits.length >= 3 ? digits : '', limit),
    db.prepare('SELECT COUNT(DISTINCT phone) AS n FROM orders'),
  ]);
  return { rows: (list?.results ?? []) as OrderCustomerRow[], total: ((count?.results?.[0] as { n?: number } | undefined)?.n ?? 0) };
}

const tabs = (current: 'members' | 'orders', q: string) => {
  const qs = q ? `q=${encodeURIComponent(q)}` : '';
  return html`<nav class="tabs" aria-label="ประเภทลูกค้า">
  <a href="/back/customers${qs ? `?${qs}` : ''}"${current === 'members' ? html` aria-current="page"` : ''}>สมาชิก (เว็บเดิม)</a>
  <a href="/back/customers?tab=orders${qs ? `&${qs}` : ''}"${current === 'orders' ? html` aria-current="page"` : ''}>ลูกค้าจากออเดอร์</a>
</nav>`;
};

async function orderCustomerList(env: Env, q: string, email: string): Promise<Response> {
  const { rows, total } = await listOrderCustomers(env.DB, q);
  const body = html`
<h1>Customer</h1>
${tabs('orders', q)}
<p class="notice">${total.toLocaleString('en-US')} เบอร์ · รวมจากออเดอร์ตามเบอร์โทร · ยอดรวมไม่นับออเดอร์ที่ยกเลิก</p>
<form class="card filters" method="get" action="/back/customers">
  <input type="hidden" name="tab" value="orders">
  <label>ค้นหา<input type="search" name="q" value="${q}" placeholder="ชื่อ / เบอร์โทร" maxlength="50"></label>
  <button class="primary" type="submit">Search</button>
</form>
<div class="card table-wrap">
<table>
<thead><tr><th>ชื่อ (ล่าสุด)</th><th>Tel</th><th class="num">ออเดอร์</th><th class="num">ยอดรวม (บาท)</th><th>สั่งครั้งแรก</th><th>สั่งล่าสุด</th><th></th></tr></thead>
<tbody>${
    rows.length
      ? rows.map(
          (c) =>
            html`<tr><td class="wrap">${c.name}</td><td>${c.phone}</td><td class="num">${c.orders}</td><td class="num">${formatBaht(c.total_satang)}</td><td>${formatIsoAsThai(c.first_at)}</td><td>${formatIsoAsThai(c.last_at)}</td><td><a href="/back/orders?phone=${encodeURIComponent(c.phone)}">ดูออเดอร์</a></td></tr>`
        )
      : html`<tr><td colspan="7" class="empty">${total === 0 ? 'ยังไม่มีออเดอร์' : 'ไม่พบลูกค้าตามเงื่อนไขนี้'}</td></tr>`
  }</tbody></table>
${rows.length >= 500 ? html`<p class="notice">แสดง 500 เบอร์ที่สั่งล่าสุด — ค้นหาให้แคบลง</p>` : ''}
</div>`;
  return page(env, { title: 'Customer', email, active: 'customers', body });
}

async function memberList(env: Env, q: string, email: string): Promise<Response> {
  const { rows, total } = await listMembers(env.DB, q);
  const body = html`
<h1>Customer</h1>
${tabs('members', q)}
${
  total === 0
    ? html`<div class="flash"><strong>ยังไม่มีข้อมูลลูกค้า</strong> — นำเข้าด้วย scripts/import-customers.mjs (ข้อมูลส่วนบุคคล นำเข้าหลัง IT/ฝ่ายกฎหมายอนุมัติ)</div>`
    : html`<p class="notice">${total.toLocaleString('en-US')} คน</p>`
}
<form class="card filters" method="get" action="/back/customers">
  <label>ค้นหา<input type="search" name="q" value="${q}" placeholder="ชื่อ / อีเมล / เบอร์โทร" maxlength="50"></label>
  <button class="primary" type="submit">Search</button>
  ${total > 0 ? html`<a class="btn success" href="${EXPORT_PATH}${q ? `?q=${encodeURIComponent(q)}` : ''}">Export Excel</a>` : ''}
</form>
<div class="card table-wrap">
<table>
<thead><tr><th>Name</th><th>Email</th><th>Tel</th><th>Company</th><th>register_date</th></tr></thead>
<tbody>${
    rows.length
      ? rows.map((m) => html`<tr><td class="wrap">${m.name}</td><td>${m.email}</td><td>${m.tel}</td><td class="wrap">${m.company}</td><td>${m.register_date}</td></tr>`)
      : html`<tr><td colspan="5" class="empty">${total === 0 ? 'ยังไม่มีข้อมูล — รอนำเข้า' : 'ไม่พบลูกค้าตามเงื่อนไขนี้'}</td></tr>`
  }</tbody></table>
${rows.length >= 500 ? html`<p class="notice">แสดง 500 คนล่าสุด — ค้นหาให้แคบลง</p>` : ''}
</div>`;
  return page(env, { title: 'Customer', email, active: 'customers', body });
}

async function customerList(env: Env, url: URL, email: string): Promise<Response> {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 50);
  return url.searchParams.get('tab') === 'orders' ? orderCustomerList(env, q, email) : memberList(env, q, email);
}

const EXPORT_PATH = '/back/customers/export.xlsx';

/** Export Excel: สมาชิกทุกคนตามคำค้นเดียวกับหน้ารายการ (ไม่จำกัด 500) · คอลัมน์เดียวกับหน้า */
async function exportMembers(env: Env, url: URL): Promise<Response> {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 50);
  const { rows } = await listMembers(env.DB, q, 100_000);
  const xlsx = buildXlsx(
    'Customer',
    [['Name', 'Email', 'Tel', 'Company', 'register_date'], ...rows.map((m) => [m.name, m.email, m.tel, m.company, m.register_date])],
    [30, 34, 16, 24, 20]
  );
  const stamp = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  return new Response(xlsx, {
    headers: {
      'Content-Type': XLSX_TYPE,
      'Content-Disposition': `attachment; filename="customers-${stamp}.xlsx"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function handleCustomersAdmin(request: Request, env: Env, url: URL, path: string, email: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorPage(env, 405, 'ไม่รองรับคำขอนี้');
  if (path === EXPORT_PATH) return exportMembers(env, url);
  if (path !== '/back/customers') return errorPage(env, 404, 'ไม่พบหน้านี้');
  return customerList(env, url, email);
}
