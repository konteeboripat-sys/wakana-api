// หลังบ้าน /back/stores — แทนหน้า Store Location ของเว็บเดิม
// ตอนนี้เก็บข้อมูลสาขาอย่างเดียว · ตะกร้ายังใช้ "รับที่ร้าน ฟู้ดโปรมาร์ท พระราม 3" ตายตัว (ยังไม่อ่านจากตารางนี้)

import { errorPage, page, readForm, redirect, sameOrigin } from './admin-layout.ts';
import type { Env } from './env.ts';
import { html, type SafeHtml } from './html.ts';
import { parseStoreForm, STORE_FIELD_LABELS, type StoreInput, type StoreRow } from './stores.ts';
import { createStore, getStore, getStoreEvents, listStores, setStoreDeleted, updateStore } from './stores-db.ts';
import { formatIsoAsThai } from './wall-time.ts';

const BASE = '/back/stores';

const FLASH: Record<string, string> = {
  created: 'เพิ่มสาขาแล้ว',
  updated: 'บันทึกแล้ว',
  unchanged: 'ไม่มีอะไรเปลี่ยน',
  restored: 'กู้คืนสาขาแล้ว',
  conflict: 'มีคนแก้สาขานี้ไปก่อน จึงยังไม่ได้ทำรายการ — ด้านล่างคือข้อมูลล่าสุด',
};

const NOTICE = html`<div class="flash">ตอนนี้<strong>เก็บข้อมูลสาขาอย่างเดียว</strong> — ตะกร้าบนเว็บยังใช้ "รับที่ร้าน ฟู้ดโปรมาร์ท พระราม 3" ตายตัว เปิด/ปิดสาขาที่นี่ยังไม่มีผลกับหน้าเว็บ</div>`;
const enableLabel = (enabled: 0 | 1) => (enabled ? html`<span class="s-ok">Enable</span>` : html`<span class="s-disable">Disable</span>`);

// ---------- รายการ ----------

async function storeList(env: Env, url: URL, email: string): Promise<Response> {
  const p = url.searchParams;
  const trash = p.get('trash') === '1';
  const rows = await listStores(env.DB, trash);
  const deleted = /^\d{1,9}$/.test(p.get('deleted') ?? '') ? p.get('deleted') : null;
  const body = html`
<p class="actions" style="justify-content:flex-end;margin:0 0 16px">
  ${trash ? html`<a href="${BASE}">← กลับรายการ</a>` : html`<a href="${BASE}?trash=1">ถังขยะ</a>`}
  <a class="btn success" href="${BASE}/new">Add new store</a>
</p>
${deleted ? html`<div class="flash" role="status">ย้ายสาขา #${deleted} ไปถังขยะแล้ว · <a href="${BASE}/${deleted}">ดู / กู้คืน</a></div>` : ''}
${trash ? html`<div class="flash">ถังขยะ: สาขาที่ลบแล้ว — กด "กู้คืน" เพื่อนำกลับ</div>` : NOTICE}
<div class="card table-wrap">
${
  rows.length
    ? html`<table>
<thead><tr><th>store id</th><th>store name th</th><th>store name en</th><th>store enable</th><th></th></tr></thead>
<tbody>${rows.map(
        (s) => html`<tr><td>${s.id}</td><td class="wrap">${s.name_th}</td><td class="wrap">${s.name_en}</td><td>${enableLabel(s.enabled)}</td>
<td>${
          trash
            ? html`<form method="post" action="${BASE}/${s.id}/restore"><input type="hidden" name="version" value="${s.updated_at}"><button type="submit">กู้คืน</button></form>`
            : html`<div class="actions"><a href="${BASE}/${s.id}">Edit</a><a class="danger-link" href="${BASE}/${s.id}/delete">ลบ</a></div>`
        }</td></tr>`
      )}</tbody></table>`
    : html`<div class="empty">${trash ? 'ถังขยะว่าง' : 'ยังไม่มีสาขา — กด "Add new store"'}</div>`
}
</div>`;
  return page(env, { title: 'Store Location', email, active: 'stores', body });
}

// ---------- ฟอร์ม ----------

type FormValues = Record<string, string>;
type FieldErrors = Partial<Record<keyof StoreInput, string>>;
const valuesFromRow = (s: StoreRow): FormValues => ({ name_th: s.name_th, name_en: s.name_en, enabled: s.enabled ? '1' : '' });

function storeForm(o: { action: string; values: FormValues; errors: FieldErrors; version?: string }): SafeHtml {
  const v = o.values;
  const err = (k: keyof StoreInput) => (o.errors[k] ? html`<span class="err" id="err-${k}">${o.errors[k]}</span>` : '');
  const invalid = (k: keyof StoreInput) => (o.errors[k] ? html`aria-invalid="true" aria-describedby="err-${k}"` : '');
  const row = (id: string, label: string, control: SafeHtml) => html`<div class="frow"><label class="flabel" for="f-${id}">${label}</label><div class="fcontrol">${control}</div></div>`;
  return html`<form method="post" action="${o.action}" class="card old-form">
${o.version ? html`<input type="hidden" name="version" value="${o.version}">` : ''}
<div class="ftable">
  ${row('name_th', 'store name th *', html`<input id="f-name_th" name="name_th" value="${v.name_th ?? ''}" required maxlength="200" ${invalid('name_th')}>${err('name_th')}`)}
  ${row('name_en', 'store name en *', html`<input id="f-name_en" name="name_en" value="${v.name_en ?? ''}" required maxlength="200" ${invalid('name_en')}>${err('name_en')}`)}
  ${row('enabled', 'store enable', html`<select id="f-enabled" name="enabled" class="narrow"><option value="" ${v.enabled ? '' : html`selected`}>Disable</option><option value="1" ${v.enabled ? html`selected` : ''}>Enable</option></select>`)}
</div>
<div class="actions" style="margin-top:20px"><button class="submit-btn" type="submit">submit</button><a class="btn" href="${BASE}">ยกเลิก</a></div>
</form>`;
}

function changeSummary(raw: string): string {
  try {
    return Object.entries(JSON.parse(raw) as Record<string, [unknown, unknown]>)
      .map(([k, [a, b]]) => {
        const fmt = (x: unknown) => (k === 'enabled' ? (x ? 'Enable' : 'Disable') : String(x ?? ''));
        return `${STORE_FIELD_LABELS[k as keyof StoreInput] ?? k}: ${fmt(a)} → ${fmt(b)}`;
      })
      .join(' · ');
  } catch {
    return '';
  }
}

function newPage(env: Env, email: string, values: FormValues = {}, errors: FieldErrors = {}, status = 200): Response {
  const body = html`<p><a href="${BASE}">← กลับรายการ</a></p><h1>Add new store</h1>${NOTICE}${storeForm({ action: `${BASE}/new`, values, errors })}`;
  return page(env, { title: 'Add new store', email, active: 'stores', body, status });
}

async function editPage(env: Env, url: URL, email: string, s: StoreRow, values?: FormValues, errors: FieldErrors = {}, status = 200, flashText = ''): Promise<Response> {
  const events = await getStoreEvents(env.DB, s.id);
  const flash = flashText || FLASH[url.searchParams.get('msg') ?? ''];
  const ACTIONS = { import: 'นำเข้าจากเว็บเดิม', create: 'สร้าง', update: 'แก้ไข', delete: 'ย้ายไปถังขยะ', restore: 'กู้คืน' } as const;
  const main = s.deleted_at
    ? html`<div class="flash">สาขานี้อยู่ใน<strong>ถังขยะ</strong> (ลบเมื่อ ${formatIsoAsThai(s.deleted_at)}) — กู้คืนก่อนจึงจะแก้ไขได้</div>
<div class="panel" style="margin-bottom:20px"><dl><dt>ชื่อไทย</dt><dd>${s.name_th}</dd><dt>ชื่ออังกฤษ</dt><dd>${s.name_en}</dd><dt>store enable</dt><dd>${enableLabel(s.enabled)}</dd></dl>
<form method="post" action="${BASE}/${s.id}/restore" style="margin-top:16px"><input type="hidden" name="version" value="${s.updated_at}"><button class="primary" type="submit">กู้คืนสาขานี้</button></form></div>`
    : html`${NOTICE}${storeForm({ action: `${BASE}/${s.id}`, values: values ?? valuesFromRow(s), errors, version: s.updated_at })}
<p style="margin:-4px 0 24px"><a class="btn danger" href="${BASE}/${s.id}/delete">ลบสาขานี้</a></p>`;
  const body = html`<p><a href="${BASE}${s.deleted_at ? '?trash=1' : ''}">← กลับรายการ</a></p>
${flash ? html`<div class="flash" role="status">${flash}</div>` : ''}
<h1>Store #${s.id} ${s.deleted_at ? html`<span class="s-off">(ถังขยะ)</span>` : ''}</h1>
${main}
<section class="card"><h2>ประวัติการแก้ไข</h2>
${
  events.length
    ? html`<div class="table-wrap"><table><thead><tr><th>เมื่อ</th><th>ทำอะไร</th><th>โดย</th><th>รายละเอียด</th></tr></thead><tbody>${events.map(
        (e) => html`<tr><td>${formatIsoAsThai(e.at)}</td><td>${ACTIONS[e.action]}</td><td>${e.actor}</td><td class="wrap">${e.action === 'update' ? changeSummary(e.changes) : ''}</td></tr>`
      )}</tbody></table></div>`
    : html`<p class="notice">ยังไม่มีประวัติ</p>`
}</section>`;
  return page(env, { title: `Store #${s.id}`, email, active: 'stores', body, status });
}

function deleteConfirmPage(env: Env, email: string, s: StoreRow): Response {
  if (s.deleted_at) return redirect(`${BASE}/${s.id}`);
  const body = html`<p><a href="${BASE}/${s.id}">← กลับ</a></p>
<h1>ลบสาขา #${s.id}?</h1>
<div class="panel">
  <dl><dt>ชื่อไทย</dt><dd>${s.name_th}</dd><dt>ชื่ออังกฤษ</dt><dd>${s.name_en}</dd><dt>store enable</dt><dd>${enableLabel(s.enabled)}</dd></dl>
  <ul style="margin:16px 0;padding-left:20px;font-weight:400"><li>สาขาจะย้ายไป<strong>ถังขยะ</strong> — กู้คืนได้จาก "ถังขยะ" ในหน้ารายการ</li>
  ${s.enabled ? html`<li><strong>สาขานี้เปิดอยู่</strong> — ถ้าแค่หยุดรับออเดอร์ชั่วคราว ใช้ "store enable = Disable" แทนการลบ</li>` : ''}</ul>
  <form method="post" action="${BASE}/${s.id}/delete" class="actions">
    <input type="hidden" name="version" value="${s.updated_at}">
    <button class="danger" type="submit">ยืนยัน ลบสาขานี้</button><a href="${BASE}/${s.id}">ยกเลิก</a>
  </form>
</div>`;
  return page(env, { title: `ลบสาขา #${s.id}`, email, active: 'stores', body });
}

// ---------- บันทึก ----------

async function saveNew(request: Request, env: Env, email: string): Promise<Response> {
  const form = await readForm(request);
  const parsed = parseStoreForm(form);
  if (!parsed.ok) return newPage(env, email, form, parsed.errors, 422);
  const id = await createStore(env.DB, parsed.value, email, new Date().toISOString());
  return redirect(`${BASE}/${id}?msg=created`);
}

async function saveExisting(request: Request, env: Env, url: URL, email: string, s: StoreRow): Promise<Response> {
  const form = await readForm(request);
  const parsed = parseStoreForm(form);
  if (!parsed.ok) return editPage(env, url, email, s, form, parsed.errors, 422);
  const result = await updateStore(env.DB, s, parsed.value, form.version ?? '', email, new Date().toISOString());
  if (result === 'conflict') {
    const latest = (await getStore(env.DB, s.id)) ?? s;
    return editPage(env, url, email, latest, undefined, {}, 409, 'มีคนแก้สาขานี้ไปก่อนคุณ — ด้านล่างคือข้อมูลล่าสุด สิ่งที่คุณแก้ยังไม่ได้บันทึก');
  }
  return redirect(`${BASE}/${s.id}?msg=${result}`);
}

async function setDeleted(request: Request, env: Env, s: StoreRow, email: string, deleted: boolean): Promise<Response> {
  const { version = '' } = await readForm(request);
  const ok = await setStoreDeleted(env.DB, s.id, deleted, version, email, new Date().toISOString());
  if (!ok) return redirect(`${BASE}/${s.id}?msg=conflict`);
  return redirect(deleted ? `${BASE}?deleted=${s.id}` : `${BASE}/${s.id}?msg=restored`);
}

// ---------- router ----------

export async function handleStoresAdmin(request: Request, env: Env, url: URL, path: string, email: string): Promise<Response> {
  const isRead = request.method === 'GET' || request.method === 'HEAD';
  const isPost = request.method === 'POST';
  if (isPost && !sameOrigin(request, url)) return errorPage(env, 403, 'คำขอไม่ได้มาจากหน้าหลังบ้าน');

  if (path === BASE) return isRead ? storeList(env, url, email) : errorPage(env, 405, 'ไม่รองรับคำขอนี้');
  if (path === `${BASE}/new`) {
    if (isRead) return newPage(env, email);
    return isPost ? saveNew(request, env, email) : errorPage(env, 405, 'ไม่รองรับคำขอนี้');
  }
  const m = /^\/back\/stores\/(\d{1,9})(?:\/(delete|restore))?$/.exec(path);
  if (m) {
    const s = await getStore(env.DB, Number(m[1]));
    if (!s) return page(env, { title: 'ไม่พบสาขา', email, active: 'stores', status: 404, body: html`<div class="card empty">ไม่พบสาขา #${m[1]} · <a href="${BASE}">กลับรายการ</a></div>` });
    if (m[2] === 'delete') {
      if (isRead) return deleteConfirmPage(env, email, s);
      return isPost ? setDeleted(request, env, s, email, true) : errorPage(env, 405, 'ไม่รองรับคำขอนี้');
    }
    if (m[2] === 'restore') return isPost ? setDeleted(request, env, s, email, false) : redirect(`${BASE}/${s.id}`);
    if (isRead) return editPage(env, url, email, s);
    return isPost ? saveExisting(request, env, url, email, s) : errorPage(env, 405, 'ไม่รองรับคำขอนี้');
  }
  return errorPage(env, 404, 'ไม่พบหน้านี้');
}
