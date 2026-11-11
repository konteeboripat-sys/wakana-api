// หลังบ้าน /back/contacts — ข้อความจากฟอร์มติดต่อบนเว็บ (แทนหน้า Contact Us ของเว็บเดิม)
// แท็บตามสถานะ: ใหม่ (ค่าเริ่ม) · ตอบแล้ว · สแปม · ทั้งหมด · หน้ารายละเอียดเปลี่ยนสถานะได้ (ไม่มีลบ: สแปมเก็บไว้ในแท็บของมัน)

import { errorPage, page, readForm, redirect, sameOrigin } from './admin-layout.ts';
import { countContactsByStatus, getContact, listContacts, setContactStatus, type ContactRow, type ContactStatus } from './contact-db.ts';
import type { Env } from './env.ts';
import { html } from './html.ts';
import { formatIsoAsThai } from './wall-time.ts';

const BASE = '/back/contacts';

const STATUS_LABELS: Record<ContactStatus, string> = { new: 'ใหม่', done: 'ตอบแล้ว', spam: 'สแปม' };
const STATUS_CLASS: Record<ContactStatus, string> = { new: 's-new', done: 's-done', spam: 's-off' };
const isStatus = (v: string | null | undefined): v is ContactStatus => v === 'new' || v === 'done' || v === 'spam';

const FLASH: Record<string, string> = { new: 'ย้ายกลับเป็น "ใหม่" แล้ว', done: 'ทำเครื่องหมาย "ตอบแล้ว"', spam: 'ย้ายไปสแปมแล้ว' };

const statusBadge = (s: ContactStatus) => html`<span class="${STATUS_CLASS[s]}">${STATUS_LABELS[s]}</span>`;
const contactWays = (c: ContactRow) => [c.tel, c.email].filter(Boolean).join(' · ');

async function contactList(env: Env, url: URL, email: string): Promise<Response> {
  const param = url.searchParams.get('status');
  // ไม่ระบุ = ใหม่ · all = ทุกสถานะ
  const status: ContactStatus | '' = param === 'all' ? '' : isStatus(param) ? param : 'new';
  const [rows, counts] = await Promise.all([listContacts(env.DB, status), countContactsByStatus(env.DB)]);
  const total = counts.new + counts.done + counts.spam;
  const tab = (key: ContactStatus | 'all', label: string, n: number) =>
    html`<a href="${BASE}?status=${key}"${(key === 'all' ? '' : key) === status ? html` aria-current="page"` : ''}>${label} (${n})</a>`;

  const body = html`
<nav class="tabs" aria-label="สถานะข้อความ">
  ${tab('new', 'ใหม่', counts.new)}${tab('done', 'ตอบแล้ว', counts.done)}${tab('spam', 'สแปม', counts.spam)}${tab('all', 'ทั้งหมด', total)}
</nav>
${status === 'spam' ? html`<p class="notice">ระบบคัดข้อความที่มีลิงก์ไว้ที่นี่อัตโนมัติ — ถ้าเป็นข้อความจริง เปิดแล้วกด "ย้ายกลับเป็นใหม่"</p>` : ''}
<div class="card table-wrap">
${
  rows.length
    ? html`<table>
<thead><tr><th>วันที่</th><th>หัวข้อ</th><th>ชื่อ</th><th>ติดต่อกลับ</th><th>สถานะ</th><th></th></tr></thead>
<tbody>${rows.map(
        (c) => html`<tr>
<td>${formatIsoAsThai(c.created_at)}</td>
<td class="wrap">${c.subject}</td>
<td class="wrap">${c.name}${c.company ? html`<br><span class="notice">${c.company}</span>` : ''}</td>
<td>${contactWays(c)}</td>
<td>${statusBadge(c.status)}</td>
<td><a href="${BASE}/${c.id}">เปิด</a></td>
</tr>`
      )}</tbody></table>
${rows.length >= 500 ? html`<p class="notice">แสดง 500 ข้อความล่าสุด</p>` : ''}`
    : html`<div class="empty">${total === 0 ? 'ยังไม่มีข้อความจากฟอร์มติดต่อ' : 'ไม่มีข้อความในแท็บนี้'}</div>`
}
</div>`;
  return page(env, { title: 'Contact Us', email, active: 'contacts', body });
}

async function contactDetail(env: Env, url: URL, email: string, c: ContactRow): Promise<Response> {
  const msg = url.searchParams.get('msg');
  const action = (to: ContactStatus, label: string, cls = '') =>
    c.status === to ? '' : html`<form method="post" action="${BASE}/${c.id}/status"><input type="hidden" name="status" value="${to}"><button type="submit" class="${cls}">${label}</button></form>`;
  const body = html`
<p><a href="${BASE}?status=${c.status}">← กลับรายการ</a></p>
<h1>${c.subject}</h1>
${isStatus(msg) ? html`<div class="flash" role="status">${FLASH[msg]}</div>` : ''}
<div class="panel">
<dl>
  <dt>สถานะ</dt><dd>${statusBadge(c.status)}${c.spam_reason ? html` <span class="notice">(${c.spam_reason})</span>` : ''}${c.handled_by ? html` <span class="notice">· ${c.handled_by} · ${formatIsoAsThai(c.handled_at)}</span>` : ''}</dd>
  <dt>วันที่ส่ง</dt><dd>${formatIsoAsThai(c.created_at)}</dd>
  <dt>ชื่อ</dt><dd>${c.name}</dd>
  ${c.company ? html`<dt>บริษัท</dt><dd>${c.company}</dd>` : ''}
  ${c.tel ? html`<dt>โทร</dt><dd><a href="tel:${c.tel.replace(/[^0-9+]/g, '')}">${c.tel}</a></dd>` : ''}
  ${c.email ? html`<dt>อีเมล</dt><dd><a href="mailto:${c.email}">${c.email}</a></dd>` : ''}
  <dt>ข้อความ</dt><dd>${c.detail}</dd>
</dl>
</div>
<div class="actions" style="margin-top:16px">
  ${action('done', 'ทำเครื่องหมายตอบแล้ว', 'primary')}${action('new', 'ย้ายกลับเป็นใหม่')}${action('spam', 'เป็นสแปม', 'danger')}
</div>`;
  return page(env, { title: `ข้อความ #${c.id}`, email, active: 'contacts', body });
}

export async function handleContactsAdmin(request: Request, env: Env, url: URL, path: string, email: string): Promise<Response> {
  const isRead = request.method === 'GET' || request.method === 'HEAD';
  if (request.method === 'POST' && !sameOrigin(request, url)) return errorPage(env, 403, 'คำขอไม่ได้มาจากหน้าหลังบ้าน');

  if (path === BASE) return isRead ? contactList(env, url, email) : errorPage(env, 405, 'ไม่รองรับคำขอนี้');

  const m = /^\/back\/contacts\/(\d{1,9})(\/status)?$/.exec(path);
  if (!m) return errorPage(env, 404, 'ไม่พบหน้านี้');
  const row = await getContact(env.DB, Number(m[1]));
  if (!row) return page(env, { title: 'ไม่พบข้อความ', email, active: 'contacts', status: 404, body: html`<div class="card empty">ไม่พบข้อความ #${m[1]} · <a href="${BASE}">กลับรายการ</a></div>` });

  if (!m[2]) return isRead ? contactDetail(env, url, email, row) : errorPage(env, 405, 'ไม่รองรับคำขอนี้');
  if (request.method !== 'POST') return redirect(`${BASE}/${row.id}`);
  const to = (await readForm(request)).status;
  if (!isStatus(to)) return errorPage(env, 400, 'สถานะไม่ถูกต้อง');
  await setContactStatus(env.DB, row.id, to, email, new Date().toISOString());
  return redirect(`${BASE}/${row.id}?msg=${to}`);
}
