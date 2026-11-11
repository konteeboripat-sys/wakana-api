// หลังบ้าน /back/promotions — แทนหน้ารายการ promotion ของเว็บเดิม
// ฟอร์ม/แก้/ลบ ใช้ร่วมกับ Promotion Settime (kind = settime มีช่วงเวลา) · รายการ Settime อยู่ที่ admin-promotion-settime.ts
// เก็บข้อมูลโปรโมชันและผูกกับสินค้า/กติกาได้ · ยังไม่มีผลกับราคา (ตะกร้าไม่คิดส่วนลด)

import { errorPage, page, readForm, redirect, sameOrigin, type AdminSection } from './admin-layout.ts';
import type { Env } from './env.ts';
import { html, type SafeHtml } from './html.ts';
import { listRulesOfPromotion } from './promotion-rules-db.ts';
import {
  isValidDate,
  parsePromotionForm,
  PROMOTION_FIELD_LABELS,
  PROMOTION_KINDS,
  timeRangeLabel,
  type PromotionInput,
  type PromotionKind,
  type PromotionRow,
} from './promotions.ts';
import {
  countProductsInPromotion,
  createPromotion,
  deletePromotion,
  getPromotion,
  getPromotionEvents,
  listPromotions,
  productsInPromotion,
  restorePromotion,
  updatePromotion,
} from './promotions-db.ts';
import { formatIsoAsThai } from './wall-time.ts';

const FLASH: Record<string, string> = {
  created: 'เพิ่มโปรโมชันแล้ว',
  updated: 'บันทึกแล้ว',
  unchanged: 'ไม่มีอะไรเปลี่ยน',
  restored: 'กู้คืนโปรโมชันแล้ว — สินค้าที่เคยผูกไว้ไม่ได้ผูกกลับให้ ต้องเลือกโปรนี้ในหน้าสินค้าใหม่',
  conflict: 'มีคนแก้โปรโมชันนี้ไปก่อน จึงยังไม่ได้ทำรายการ — ด้านล่างคือข้อมูลล่าสุด',
};

export const NOT_ACTIVE_NOTICE = html`<div class="flash">โปรโมชันตอนนี้<strong>เก็บข้อมูลเท่านั้น ยังไม่มีผลกับราคา</strong> — ตะกร้ายังไม่คิดส่วนลด ลูกค้าจ่ายราคาปกติเสมอ</div>`;

/** หน้ารายการ/เมนูของแต่ละประเภท */
const LIST_HREF: Record<PromotionKind, string> = { normal: '/back/promotions', settime: '/back/promotion-settime', monday: '/back/promotion-monday' };
const SECTION: Record<PromotionKind, AdminSection> = { normal: 'promotions', settime: 'settime', monday: 'monday' };
export const listHref = (kind: PromotionKind) => LIST_HREF[kind];
const section = (kind: PromotionKind): AdminSection => SECTION[kind];
const kindOf = (raw: string | null | undefined): PromotionKind => (raw === 'settime' || raw === 'monday' ? raw : 'normal');

// ---------- รายการ ----------

async function promotionList(env: Env, url: URL, email: string): Promise<Response> {
  const p = url.searchParams;
  const name = (p.get('name') ?? '').trim().slice(0, 100);
  const start = isValidDate(p.get('start') ?? '') ? (p.get('start') as string) : '';
  const end = isValidDate(p.get('end') ?? '') ? (p.get('end') as string) : '';
  const trash = p.get('trash') === '1';
  const rows = await listPromotions(env.DB, { kind: 'normal', name, start, end, trash });
  const deleted = /^\d{1,9}$/.test(p.get('deleted') ?? '') ? p.get('deleted') : null;
  const unlinked = Number(p.get('unlinked') ?? 0) || 0;

  const body = html`
<p class="actions" style="margin:0 0 20px">
  <a class="btn success" href="/back/promotions/new">Add new promotion</a>
  <!-- Promotion Rule ปิดไว้ (2026-10-16) — เปิดกลับ: เอา comment ออกที่นี่และที่เมนูใน admin-layout.ts
  <a class="btn success" href="/back/promotion-rules/new">Add promotion rule</a> -->
</p>
${deleted ? html`<div class="flash" role="status">ย้ายโปรโมชัน #${deleted} ไปถังขยะแล้ว${unlinked ? ` · ปลดสินค้า ${unlinked} รายการเป็น "ไม่ร่วมโปรโมชั่น"` : ''} · <a href="/back/promotions/${deleted}">ดู / กู้คืน</a></div>` : ''}
${trash ? html`<div class="flash">ถังขยะ: โปรโมชันที่ลบแล้ว — เลือกในหน้าสินค้าไม่ได้ · กด "กู้คืน" เพื่อนำกลับ</div>` : NOT_ACTIVE_NOTICE}
<form class="card filters" method="get" action="/back/promotions">
  ${trash ? html`<input type="hidden" name="trash" value="1">` : ''}
  <label>Promotion name<input type="search" name="name" value="${name}" maxlength="100"></label>
  <label>Start date<input type="date" name="start" value="${start}"></label>
  <label>End date<input type="date" name="end" value="${end}"></label>
  <button class="primary" type="submit">Search</button>
  ${trash ? html`<a href="/back/promotions">← กลับรายการ</a>` : html`<a href="/back/promotions?trash=1">ถังขยะ</a>`}
</form>
<div class="card table-wrap">
${
  rows.length
    ? html`<table>
<thead><tr><th>Promotion id</th><th>Promotion name</th><th>Enable</th><th>Start date</th><th>Expire date</th><th></th></tr></thead>
<tbody>${rows.map((r) => {
        // คอลัมน์ตามหน้า promotion ของเว็บเดิม (ไม่มีคอลัมน์ช่วงเวลา)
        return html`<tr>
<td><a href="/back/promotions/${r.id}">${r.id}</a></td>
<td class="wrap">${r.name}</td>
<td>${r.enabled ? 'Yes' : html`<span class="s-off">No</span>`}</td>
<td>${r.start_date}</td><td>${r.end_date}</td>
<td>${
          trash
            ? html`<form method="post" action="/back/promotions/${r.id}/restore"><input type="hidden" name="version" value="${r.updated_at}"><button type="submit">กู้คืน</button></form>`
            : html`<div class="actions"><a href="/back/promotions/${r.id}">Edit</a><a class="danger-link" href="/back/promotions/${r.id}/delete">ลบ</a></div>`
        }</td></tr>`;
      })}</tbody></table>`
    : html`<div class="empty">${trash ? 'ถังขยะว่าง' : name || start || end ? 'ไม่พบโปรโมชันตามเงื่อนไขนี้' : 'ยังไม่มีโปรโมชัน — กด "Add new promotion"'}</div>`
}
</div>`;
  return page(env, { title: 'Promotion', email, active: 'promotions', body });
}

// ---------- ฟอร์ม ----------

type FormValues = Record<string, string>;
type FieldErrors = Partial<Record<keyof PromotionInput, string>>;

const valuesFromRow = (r: PromotionRow): FormValues => ({
  name: r.name,
  enabled: r.enabled ? '1' : '',
  start_date: r.start_date,
  end_date: r.end_date,
  start_time: r.start_time,
  end_time: r.end_time,
});

function promotionForm(o: { action: string; kind: PromotionKind; values: FormValues; errors: FieldErrors; version?: string; submitLabel: string }): SafeHtml {
  const v = o.values;
  const err = (k: keyof PromotionInput) => (o.errors[k] ? html`<span class="err" id="err-${k}">${o.errors[k]}</span>` : '');
  const invalid = (k: keyof PromotionInput) => (o.errors[k] ? html`aria-invalid="true" aria-describedby="err-${k}"` : '');
  const row = (id: string, label: string, control: SafeHtml) => html`<div class="frow"><label class="flabel" for="f-${id}">${label}</label><div class="fcontrol">${control}</div></div>`;
  return html`<form method="post" action="${o.action}" class="card old-form">
${o.version ? html`<input type="hidden" name="version" value="${o.version}">` : ''}
<div class="ftable">
  ${row('name', 'Promotion name *', html`<input id="f-name" name="name" value="${v.name ?? ''}" required maxlength="200" ${invalid('name')}>${err('name')}`)}
  ${row('enabled', 'Enable', html`<select id="f-enabled" name="enabled" class="narrow"><option value="" ${v.enabled ? '' : html`selected`}>No</option><option value="1" ${v.enabled ? html`selected` : ''}>Yes</option></select>`)}
  ${row('start_date', 'Start date *', html`<input type="date" id="f-start_date" name="start_date" value="${v.start_date ?? ''}" required ${invalid('start_date')} style="max-width:220px">${err('start_date')}`)}
  ${row('end_date', 'Expire date *', html`<input type="date" id="f-end_date" name="end_date" value="${v.end_date ?? ''}" required ${invalid('end_date')} style="max-width:220px"><small class="notice">ใช้ได้ถึงสิ้นวันนี้ (เวลาไทย)</small>${err('end_date')}`)}
  ${
    o.kind === 'settime'
      ? html`${row('start_time', 'Start time', html`<input type="time" step="1" id="f-start_time" name="start_time" value="${v.start_time ?? '00:00:00'}" ${invalid('start_time')} style="max-width:180px">${err('start_time')}`)}
  ${row('end_time', 'End time', html`<input type="time" step="1" id="f-end_time" name="end_time" value="${v.end_time ?? '00:00:00'}" ${invalid('end_time')} style="max-width:180px"><small class="notice">ช่วงเวลาในแต่ละวัน (เวลาไทย) · 00:00:00–00:00:00 = ทั้งวัน</small>${err('end_time')}`)}`
      : o.kind === 'monday'
        ? row('weekday', 'วันที่ใช้ได้', html`<div style="padding:6px 0">เฉพาะ<strong>วันจันทร์</strong> ในช่วง Start date – Expire date</div>`)
        : ''
  }
</div>
<div class="actions" style="margin-top:20px"><button class="submit-btn" type="submit">${o.submitLabel}</button><a class="btn" href="${listHref(o.kind)}">ยกเลิก</a></div>
</form>`;
}

function changeSummary(raw: string): string {
  try {
    return Object.entries(JSON.parse(raw) as Record<string, [unknown, unknown]>)
      .map(([k, [a, b]]) => {
        const fmt = (x: unknown) => (k === 'enabled' ? (x ? 'Yes' : 'No') : String(x ?? ''));
        return `${PROMOTION_FIELD_LABELS[k as keyof PromotionInput] ?? k}: ${fmt(a)} → ${fmt(b)}`;
      })
      .join(' · ');
  } catch {
    return '';
  }
}

function newPage(env: Env, email: string, kind: PromotionKind, values: FormValues = {}, errors: FieldErrors = {}, status = 200): Response {
  const title = kind === 'normal' ? 'Add new promotion' : `Add new promotion (${kind === 'settime' ? 'Settime' : 'Monday'})`;
  const body = html`<p><a href="${listHref(kind)}">← กลับรายการ</a></p><h1>${title}</h1>${NOT_ACTIVE_NOTICE}
${promotionForm({ action: `/back/promotions/new?kind=${kind}`, kind, values, errors, submitLabel: 'submit' })}`;
  return page(env, { title, email, active: section(kind), body, status });
}

async function editPage(env: Env, url: URL, email: string, r: PromotionRow, values?: FormValues, errors: FieldErrors = {}, status = 200, flashText = ''): Promise<Response> {
  const [events, products, rules] = await Promise.all([getPromotionEvents(env.DB, r.id), countProductsInPromotion(env.DB, r.id), listRulesOfPromotion(env.DB, r.id)]);
  const flash = flashText || FLASH[url.searchParams.get('msg') ?? ''];
  const ACTIONS = { create: 'สร้าง', update: 'แก้ไข', delete: 'ย้ายไปถังขยะ', restore: 'กู้คืน' } as const;
  // อยู่ในถังขยะ: แสดงอย่างเดียว แก้ไม่ได้จนกว่าจะกู้คืน
  const main = r.deleted_at
    ? html`<div class="flash">โปรโมชันนี้อยู่ใน<strong>ถังขยะ</strong> (ลบเมื่อ ${formatIsoAsThai(r.deleted_at)}) — เลือกในหน้าสินค้าไม่ได้ กู้คืนก่อนจึงจะแก้ไขได้</div>
<div class="panel" style="margin-bottom:20px"><dl><dt>ชื่อ</dt><dd>${r.name}</dd><dt>Enable</dt><dd>${r.enabled ? 'Yes' : 'No'}</dd><dt>ช่วงวันที่</dt><dd>${r.start_date} ถึง ${r.end_date}</dd>
${r.kind === 'settime' ? html`<dt>ช่วงเวลา</dt><dd>${timeRangeLabel(r)}</dd>` : ''}${r.kind === 'monday' ? html`<dt>วันที่ใช้ได้</dt><dd>เฉพาะวันจันทร์</dd>` : ''}</dl>
<form method="post" action="/back/promotions/${r.id}/restore" style="margin-top:16px"><input type="hidden" name="version" value="${r.updated_at}"><button class="primary" type="submit">กู้คืนโปรโมชันนี้</button></form></div>`
    : html`${NOT_ACTIVE_NOTICE}
${promotionForm({ action: `/back/promotions/${r.id}`, kind: r.kind, values: values ?? valuesFromRow(r), errors, version: r.updated_at, submitLabel: 'submit' })}
<p style="margin:-4px 0 24px"><a class="btn danger" href="/back/promotions/${r.id}/delete">ลบโปรโมชันนี้</a></p>
<section class="card"><h2>กติกา (Promotion Rule) ของโปรนี้</h2>
${
  rules.length
    ? html`<ul style="margin:0;padding-left:20px;font-weight:400">${rules.map((x) => html`<li><a href="/back/promotion-rules/${x.id}">${x.name}</a> — ${x.enabled ? html`<span class="s-ok">Enable</span>` : html`<span class="s-disable">Disable</span>`}</li>`)}</ul>`
    : html`<p class="notice">ยังไม่มี</p>`
}
<p><a class="btn success" href="/back/promotion-rules/new?promotion=${r.id}">Add promotion rule</a></p></section>
<section class="card"><h2>สินค้าที่ร่วมโปรนี้</h2>
<p>${products} รายการ${products ? html` · <a href="/back/products?promotion=${r.id}">ดูรายการ</a>` : ''} <span class="notice">(ผูกสินค้าที่ช่อง Promotion ในหน้าแก้ไขสินค้า)</span></p></section>`;
  const body = html`<p><a href="${listHref(r.kind)}${r.deleted_at ? '?trash=1' : ''}">← กลับรายการ</a></p>
${flash ? html`<div class="flash" role="status">${flash}</div>` : ''}
<h1>${PROMOTION_KINDS[r.kind]} #${r.id} ${r.deleted_at ? html`<span class="s-off">(ถังขยะ)</span>` : ''}</h1>
${main}
<section class="card"><h2>ประวัติการแก้ไข</h2>
${
  events.length
    ? html`<div class="table-wrap"><table><thead><tr><th>เมื่อ</th><th>ทำอะไร</th><th>โดย</th><th>รายละเอียด</th></tr></thead><tbody>${events.map(
        (e) => html`<tr><td>${formatIsoAsThai(e.at)}</td><td>${ACTIONS[e.action]}</td><td>${e.actor}</td><td class="wrap">${e.action === 'update' ? changeSummary(e.changes) : ''}</td></tr>`
      )}</tbody></table></div>`
    : html`<p class="notice">ยังไม่มีประวัติ</p>`
}</section>`;
  return page(env, { title: `${PROMOTION_KINDS[r.kind]} #${r.id}`, email, active: section(r.kind), body, status });
}

// ---------- ลบ (ย้ายไปถังขยะ) ----------

/** หน้ายืนยัน — บอกสินค้าที่จะถูกปลดออกจากโปร */
async function deleteConfirmPage(env: Env, email: string, r: PromotionRow): Promise<Response> {
  if (r.deleted_at) return redirect(`/back/promotions/${r.id}`);
  const [linked, rules] = await Promise.all([productsInPromotion(env.DB, r.id), listRulesOfPromotion(env.DB, r.id)]);
  const shown = linked.slice(0, 30);
  const body = html`<p><a href="/back/promotions/${r.id}">← กลับ</a></p>
<h1>ลบโปรโมชัน #${r.id}?</h1>
<div class="panel">
  <dl><dt>ชื่อ</dt><dd>${r.name}</dd><dt>Enable</dt><dd>${r.enabled ? 'Yes' : 'No'}</dd><dt>ช่วงวันที่</dt><dd>${r.start_date} ถึง ${r.end_date}</dd></dl>
  <ul style="margin:16px 0;padding-left:20px;font-weight:400">
    <li>โปรโมชันจะย้ายไป<strong>ถังขยะ</strong> — กู้คืนได้จาก "ถังขยะ" ในหน้ารายการ</li>
    ${
      linked.length
        ? html`<li><strong>สินค้า ${linked.length} รายการที่ร่วมโปรนี้จะเปลี่ยนเป็น "ไม่ร่วมโปรโมชั่น"</strong> (บันทึกในประวัติของสินค้าแต่ละตัว) · กู้คืนโปรภายหลัง สินค้าไม่ได้ผูกกลับให้
<ul style="margin-top:6px">${shown.map((p) => html`<li><a href="/back/products/${p.id}">#${p.id} ${p.name_th}</a>${p.deleted_at ? html` <span class="s-off">(ถังขยะ)</span>` : ''}</li>`)}${linked.length > shown.length ? html`<li class="notice">และอีก ${linked.length - shown.length} รายการ</li>` : ''}</ul></li>`
        : html`<li>ไม่มีสินค้าที่ร่วมโปรนี้</li>`
    }
    ${rules.length ? html`<li>กติกา ${rules.length} รายการที่ผูกกับโปรนี้จะไม่ผูกกับโปรไหน (กติกายังอยู่): ${rules.map((x) => x.name).join(', ')}</li>` : ''}
  </ul>
  <form method="post" action="/back/promotions/${r.id}/delete" class="actions">
    <input type="hidden" name="version" value="${r.updated_at}">
    <button class="danger" type="submit">ยืนยัน ลบโปรโมชันนี้</button><a href="/back/promotions/${r.id}">ยกเลิก</a>
  </form>
</div>`;
  return page(env, { title: `ลบโปรโมชัน #${r.id}`, email, active: section(r.kind), body });
}

async function setDeleted(request: Request, env: Env, r: PromotionRow, email: string, deleted: boolean): Promise<Response> {
  const { version = '' } = await readForm(request);
  const nowIso = new Date().toISOString();
  if (deleted) {
    const linked = (await productsInPromotion(env.DB, r.id)).length;
    const ok = await deletePromotion(env.DB, r.id, version, email, nowIso);
    return redirect(ok ? `${listHref(r.kind)}?deleted=${r.id}&unlinked=${linked}` : `/back/promotions/${r.id}?msg=conflict`);
  }
  const ok = await restorePromotion(env.DB, r.id, version, email, nowIso);
  return redirect(`/back/promotions/${r.id}?msg=${ok ? 'restored' : 'conflict'}`);
}

// ---------- บันทึก ----------

async function saveNew(request: Request, env: Env, url: URL, email: string): Promise<Response> {
  const kind = kindOf(url.searchParams.get('kind'));
  const form = await readForm(request);
  const parsed = parsePromotionForm(form, kind);
  if (!parsed.ok) return newPage(env, email, kind, form, parsed.errors, 422);
  const id = await createPromotion(env.DB, parsed.value, kind, email, new Date().toISOString());
  return redirect(`/back/promotions/${id}?msg=created`);
}

async function saveExisting(request: Request, env: Env, url: URL, email: string, r: PromotionRow): Promise<Response> {
  const form = await readForm(request);
  const parsed = parsePromotionForm(form, r.kind);
  if (!parsed.ok) return editPage(env, url, email, r, form, parsed.errors, 422);
  const result = await updatePromotion(env.DB, r, parsed.value, form.version ?? '', email, new Date().toISOString());
  if (result === 'conflict') {
    const latest = (await getPromotion(env.DB, r.id)) ?? r;
    return editPage(env, url, email, latest, undefined, {}, 409, 'มีคนแก้โปรโมชันนี้ไปก่อนคุณ — ด้านล่างคือข้อมูลล่าสุด สิ่งที่คุณแก้ยังไม่ได้บันทึก');
  }
  return redirect(`/back/promotions/${r.id}?msg=${result}`);
}

// ---------- router ----------

export async function handlePromotionsAdmin(request: Request, env: Env, url: URL, path: string, email: string): Promise<Response> {
  const isRead = request.method === 'GET' || request.method === 'HEAD';
  const isPost = request.method === 'POST';
  if (isPost && !sameOrigin(request, url)) return errorPage(env, 403, 'คำขอไม่ได้มาจากหน้าหลังบ้าน');

  if (path === '/back/promotions') return isRead ? promotionList(env, url, email) : errorPage(env, 405, 'ไม่รองรับคำขอนี้');
  if (path === '/back/promotions/new') {
    if (isRead) return newPage(env, email, kindOf(url.searchParams.get('kind')));
    return isPost ? saveNew(request, env, url, email) : errorPage(env, 405, 'ไม่รองรับคำขอนี้');
  }
  const m = /^\/back\/promotions\/(\d{1,9})(?:\/(delete|restore))?$/.exec(path);
  if (m) {
    const r = await getPromotion(env.DB, Number(m[1]));
    if (!r) return page(env, { title: 'ไม่พบโปรโมชัน', email, active: 'promotions', status: 404, body: html`<div class="card empty">ไม่พบโปรโมชัน #${m[1]} · <a href="/back/promotions">กลับรายการ</a></div>` });
    if (m[2] === 'delete') {
      if (isRead) return deleteConfirmPage(env, email, r); // GET แค่แสดงหน้ายืนยัน ไม่ลบ
      return isPost ? setDeleted(request, env, r, email, true) : errorPage(env, 405, 'ไม่รองรับคำขอนี้');
    }
    if (m[2] === 'restore') return isPost ? setDeleted(request, env, r, email, false) : redirect(`/back/promotions/${r.id}`);
    if (isRead) return editPage(env, url, email, r);
    return isPost ? saveExisting(request, env, url, email, r) : errorPage(env, 405, 'ไม่รองรับคำขอนี้');
  }
  return errorPage(env, 404, 'ไม่พบหน้านี้');
}
