// หลังบ้าน /back/promotion-rules — แทนหน้ารายการ Promotion Rule ของเว็บเดิม
// เก็บกติกา (ซื้อ X แถม Y · สินค้าที่ใช้) ได้ · ยังไม่มีผลกับราคา/ตะกร้า

import { errorPage, page, redirect, sameOrigin } from './admin-layout.ts';
import type { Env } from './env.ts';
import { html, type SafeHtml } from './html.ts';
import { categoryLabel } from './products.ts';
import { APPLIES_TO_LABELS, parseRuleForm, RULE_FIELD_LABELS, RULE_TYPES, type RuleInput, type RuleRow, type RuleType } from './promotion-rules.ts';
import { createRule, getRule, getRuleEvents, invalidProductIds, listRules, pickableProducts, setRuleDeleted, updateRule } from './promotion-rules-db.ts';
import { promotionExists, promotionOptionLabel, promotionOptions } from './promotions-db.ts';
import { formatIsoAsThai } from './wall-time.ts';

const BASE = '/back/promotion-rules';

const FLASH: Record<string, string> = {
  created: 'เพิ่มกติกาแล้ว',
  updated: 'บันทึกแล้ว',
  unchanged: 'ไม่มีอะไรเปลี่ยน',
  restored: 'กู้คืนกติกาแล้ว',
  conflict: 'มีคนแก้กติกานี้ไปก่อน จึงยังไม่ได้ทำรายการ — ด้านล่างคือข้อมูลล่าสุด',
};

const NOT_ACTIVE_NOTICE = html`<div class="flash">กติกาโปรโมชันตอนนี้<strong>เก็บข้อมูลเท่านั้น ยังไม่มีผล</strong> — ตะกร้ายังไม่คิดส่วนลดหรือของแถม ลูกค้าจ่ายราคาปกติเสมอ</div>`;

const status = (enabled: 0 | 1) => (enabled ? html`<span class="s-ok">Enable</span>` : html`<span class="s-disable">Disable</span>`);
const typeLabel = (t: RuleType | null) => (t ? RULE_TYPES[t] : '-');

type RuleWithProducts = RuleRow & { product_ids: number[] };
type FormValues = { fields: Record<string, string>; productIds: number[] };
type FieldErrors = Partial<Record<keyof RuleInput, string>>;

async function readRuleForm(request: Request): Promise<{ fields: Record<string, string>; productIds: string[] }> {
  const fields: Record<string, string> = {};
  const productIds: string[] = [];
  for (const [key, entry] of await request.formData()) {
    const value = entry as unknown as string | File;
    if (typeof value !== 'string') continue;
    if (key === 'product_ids') productIds.push(value);
    else if (!(key in fields)) fields[key] = value;
  }
  return { fields, productIds };
}

// ---------- รายการ ----------

async function ruleList(env: Env, url: URL, email: string): Promise<Response> {
  const p = url.searchParams;
  const name = (p.get('name') ?? '').trim().slice(0, 100);
  const trash = p.get('trash') === '1';
  const rows = await listRules(env.DB, { name, trash });
  const deleted = /^\d{1,9}$/.test(p.get('deleted') ?? '') ? p.get('deleted') : null;

  const body = html`
<p class="actions" style="margin:0 0 20px">
  <a class="btn success" href="/back/promotions/new">Add new promotion</a>
  <a class="btn success" href="${BASE}/new">Add promotion rule</a>
</p>
${deleted ? html`<div class="flash" role="status">ย้ายกติกา #${deleted} ไปถังขยะแล้ว · <a href="${BASE}/${deleted}">ดู / กู้คืน</a></div>` : ''}
${trash ? html`<div class="flash">ถังขยะ: กติกาที่ลบแล้ว — กด "กู้คืน" เพื่อนำกลับ</div>` : NOT_ACTIVE_NOTICE}
<form class="card filters" method="get" action="${BASE}">
  ${trash ? html`<input type="hidden" name="trash" value="1">` : ''}
  <label>Rule name<input type="search" name="name" value="${name}" maxlength="100"></label>
  <button class="primary" type="submit">Search</button>
  ${trash ? html`<a href="${BASE}">← กลับรายการ</a>` : html`<a href="${BASE}?trash=1">ถังขยะ</a>`}
</form>
<div class="card table-wrap">
${
  rows.length
    ? html`<table>
<thead><tr><th>Name</th><th>Status</th><th>Type</th><th>Applies To</th><th class="num">Buy quantity</th><th class="num">Get free quantity</th><th class="num">สินค้า</th><th>Promotion</th><th></th></tr></thead>
<tbody>${rows.map(
        (r) => html`<tr>
<td class="wrap"><a href="${BASE}/${r.id}">${r.name}</a></td><td>${status(r.enabled)}</td><td>${typeLabel(r.type)}</td>
<td>${APPLIES_TO_LABELS[r.applies_to]}</td><td class="num">${r.buy_quantity}</td><td class="num">${r.get_free_quantity}</td><td class="num">${r.product_count}</td>
<td class="wrap">${r.promotion_id === null ? html`<span class="s-off">-</span>` : html`<a href="/back/promotions/${r.promotion_id}">${r.promotion_name ?? `#${r.promotion_id}`}</a>`}</td>
<td>${
          trash
            ? html`<form method="post" action="${BASE}/${r.id}/restore"><input type="hidden" name="version" value="${r.updated_at}"><button type="submit">กู้คืน</button></form>`
            : html`<div class="actions"><a href="${BASE}/${r.id}">Edit</a><a class="danger-link" href="${BASE}/${r.id}/delete">ลบ</a></div>`
        }</td></tr>`
      )}</tbody></table>`
    : html`<div class="empty">${trash ? 'ถังขยะว่าง' : name ? 'ไม่พบกติกาตามเงื่อนไขนี้' : 'ยังไม่มีกติกา — กด "Add promotion rule"'}</div>`
}
</div>`;
  return page(env, { title: 'Promotion Rule', email, active: 'rules', body });
}

// ---------- ฟอร์ม ----------

const valuesFromRule = (r: RuleWithProducts): FormValues => ({
  fields: {
    name: r.name,
    enabled: r.enabled ? '1' : '',
    promotion_id: r.promotion_id === null ? '' : String(r.promotion_id),
    type: r.type ?? '',
    buy_quantity: String(r.buy_quantity),
    get_free_quantity: String(r.get_free_quantity),
  },
  productIds: r.product_ids,
});

async function ruleForm(env: Env, o: { action: string; values: FormValues; errors: FieldErrors; version?: string }): Promise<SafeHtml> {
  const v = o.values.fields;
  const selected = new Set(o.values.productIds);
  const [products, promotions] = await Promise.all([pickableProducts(env.DB, o.values.productIds), promotionOptions(env.DB)]);
  const byCategory = new Map<string, typeof products>();
  for (const p of products) byCategory.set(p.category, [...(byCategory.get(p.category) ?? []), p]);

  const err = (k: keyof RuleInput) => (o.errors[k] ? html`<span class="err" id="err-${k}">${o.errors[k]}</span>` : '');
  const invalid = (k: keyof RuleInput) => (o.errors[k] ? html`aria-invalid="true" aria-describedby="err-${k}"` : '');
  const row = (id: string, label: string, control: SafeHtml) => html`<div class="frow"><label class="flabel" for="f-${id}">${label}</label><div class="fcontrol">${control}</div></div>`;

  return html`<form method="post" action="${o.action}" class="card old-form">
${o.version ? html`<input type="hidden" name="version" value="${o.version}">` : ''}
<div class="ftable">
  ${row('name', 'Name *', html`<input id="f-name" name="name" value="${v.name ?? ''}" required maxlength="200" ${invalid('name')}>${err('name')}`)}
  ${row('enabled', 'Status', html`<select id="f-enabled" name="enabled" class="narrow"><option value="" ${v.enabled ? '' : html`selected`}>Disable</option><option value="1" ${v.enabled ? html`selected` : ''}>Enable</option></select>`)}
  ${row('promotion_id', 'Promotion', html`<select id="f-promotion_id" name="promotion_id" class="narrow" ${invalid('promotion_id')}>
    <option value="" ${v.promotion_id ? '' : html`selected`}>— ไม่ผูกกับโปร —</option>
    ${promotions.map((p) => html`<option value="${p.id}" ${v.promotion_id === String(p.id) ? html`selected` : ''}>${promotionOptionLabel(p)}</option>`)}
  </select>${err('promotion_id')}`)}
  ${row('type', 'Type', html`<select id="f-type" name="type" class="narrow" ${invalid('type')}><option value="" ${v.type ? '' : html`selected`}>-</option>${Object.entries(RULE_TYPES).map(
    ([key, label]) => html`<option value="${key}" ${v.type === key ? html`selected` : ''}>${label}</option>`
  )}</select>${err('type')}`)}
  ${row('applies_to', 'Applies To', html`<div style="padding:6px 0">${APPLIES_TO_LABELS.specific_products}</div>`)}
  ${row('buy_quantity', 'Buy quantity *', html`<input id="f-buy_quantity" name="buy_quantity" value="${v.buy_quantity ?? '1'}" required inputmode="numeric" maxlength="3" style="max-width:120px" ${invalid('buy_quantity')}>${err('buy_quantity')}`)}
  ${row('get_free_quantity', 'Get free quantity', html`<input id="f-get_free_quantity" name="get_free_quantity" value="${v.get_free_quantity ?? '0'}" inputmode="numeric" maxlength="3" style="max-width:120px" ${invalid('get_free_quantity')}><small class="notice">ซื้อ ${v.buy_quantity || 'X'} แถม ${v.get_free_quantity || '0'} · 0 = ไม่มีของแถม</small>${err('get_free_quantity')}`)}
  <div class="frow"><div class="flabel">สินค้า * <small class="notice">(Specific product(s))</small></div><div class="fcontrol">
    <div class="picker" ${o.errors.product_ids ? html`style="border-color:var(--danger)"` : ''}>${[...byCategory].map(
      ([cat, list]) => html`<fieldset><legend>${categoryLabel(cat)}</legend>${list.map(
        (p) => html`<label class="check"><input type="checkbox" name="product_ids" value="${p.id}" ${selected.has(p.id) ? html`checked` : ''}> #${p.id} ${p.name_th}${p.deleted ? html` <span class="s-off">(ถังขยะ)</span>` : ''}</label>`
      )}</fieldset>`
    )}</div>
    <small class="notice">เลือกแล้ว ${selected.size} รายการ</small>${err('product_ids')}
  </div></div>
</div>
<div class="actions" style="margin-top:20px"><button class="submit-btn" type="submit">submit</button><a class="btn" href="${BASE}">ยกเลิก</a></div>
</form>`;
}

function changeSummary(raw: string): string {
  try {
    return Object.entries(JSON.parse(raw) as Record<string, unknown>)
      .map(([k, val]) => {
        if (k === 'product_ids') {
          const { added = [], removed = [] } = val as { added?: number[]; removed?: number[] };
          return `สินค้า: ${added.length ? `+${added.map((id) => '#' + id).join(' ')}` : ''}${added.length && removed.length ? ' ' : ''}${removed.length ? `−${removed.map((id) => '#' + id).join(' ')}` : ''}`;
        }
        const [a, b] = val as [unknown, unknown];
        const fmt = (x: unknown) =>
          k === 'enabled' ? (x ? 'Enable' : 'Disable') : k === 'type' ? typeLabel(x as RuleType | null) : k === 'promotion_id' ? (x === null ? 'ไม่ผูก' : `โปร #${x}`) : String(x ?? '');
        return `${RULE_FIELD_LABELS[k as keyof RuleInput] ?? k}: ${fmt(a)} → ${fmt(b)}`;
      })
      .join(' · ');
  } catch {
    return '';
  }
}

async function newPage(env: Env, email: string, values: FormValues, errors: FieldErrors = {}, status = 200): Promise<Response> {
  const body = html`<p><a href="${BASE}">← กลับรายการ</a></p><h1>Add promotion rule</h1>${NOT_ACTIVE_NOTICE}
${await ruleForm(env, { action: `${BASE}/new`, values, errors })}`;
  return page(env, { title: 'Add promotion rule', email, active: 'rules', body, status });
}

async function editPage(env: Env, url: URL, email: string, r: RuleWithProducts, values?: FormValues, errors: FieldErrors = {}, statusCode = 200, flashText = ''): Promise<Response> {
  const events = await getRuleEvents(env.DB, r.id);
  const flash = flashText || FLASH[url.searchParams.get('msg') ?? ''];
  const ACTIONS = { create: 'สร้าง', update: 'แก้ไข', delete: 'ย้ายไปถังขยะ', restore: 'กู้คืน' } as const;
  const main = r.deleted_at
    ? html`<div class="flash">กติกานี้อยู่ใน<strong>ถังขยะ</strong> (ลบเมื่อ ${formatIsoAsThai(r.deleted_at)}) — กู้คืนก่อนจึงจะแก้ไขได้</div>
<div class="panel" style="margin-bottom:20px"><dl><dt>Name</dt><dd>${r.name}</dd><dt>Status</dt><dd>${status(r.enabled)}</dd><dt>Type</dt><dd>${typeLabel(r.type)}</dd>
<dt>ซื้อ / แถม</dt><dd>${r.buy_quantity} / ${r.get_free_quantity}</dd><dt>สินค้า</dt><dd>${r.product_ids.length} รายการ</dd></dl>
<form method="post" action="${BASE}/${r.id}/restore" style="margin-top:16px"><input type="hidden" name="version" value="${r.updated_at}"><button class="primary" type="submit">กู้คืนกติกานี้</button></form></div>`
    : html`${NOT_ACTIVE_NOTICE}
${await ruleForm(env, { action: `${BASE}/${r.id}`, values: values ?? valuesFromRule(r), errors, version: r.updated_at })}
<p style="margin:-4px 0 24px"><a class="btn danger" href="${BASE}/${r.id}/delete">ลบกติกานี้</a></p>`;
  const body = html`<p><a href="${BASE}${r.deleted_at ? '?trash=1' : ''}">← กลับรายการ</a></p>
${flash ? html`<div class="flash" role="status">${flash}</div>` : ''}
<h1>Promotion Rule #${r.id} ${r.deleted_at ? html`<span class="s-off">(ถังขยะ)</span>` : ''}</h1>
${main}
<section class="card"><h2>ประวัติการแก้ไข</h2>
${
  events.length
    ? html`<div class="table-wrap"><table><thead><tr><th>เมื่อ</th><th>ทำอะไร</th><th>โดย</th><th>รายละเอียด</th></tr></thead><tbody>${events.map(
        (e) => html`<tr><td>${formatIsoAsThai(e.at)}</td><td>${ACTIONS[e.action]}</td><td>${e.actor}</td><td class="wrap">${e.action === 'update' ? changeSummary(e.changes) : ''}</td></tr>`
      )}</tbody></table></div>`
    : html`<p class="notice">ยังไม่มีประวัติ</p>`
}</section>`;
  return page(env, { title: `Promotion Rule #${r.id}`, email, active: 'rules', body, status: statusCode });
}

async function deleteConfirmPage(env: Env, email: string, r: RuleWithProducts): Promise<Response> {
  if (r.deleted_at) return redirect(`${BASE}/${r.id}`);
  const body = html`<p><a href="${BASE}/${r.id}">← กลับ</a></p>
<h1>ลบกติกา #${r.id}?</h1>
<div class="panel">
  <dl><dt>Name</dt><dd>${r.name}</dd><dt>Status</dt><dd>${status(r.enabled)}</dd><dt>ซื้อ / แถม</dt><dd>${r.buy_quantity} / ${r.get_free_quantity}</dd><dt>สินค้า</dt><dd>${r.product_ids.length} รายการ</dd></dl>
  <ul style="margin:16px 0;padding-left:20px;font-weight:400"><li>กติกาจะย้ายไป<strong>ถังขยะ</strong> — กู้คืนได้จาก "ถังขยะ" ในหน้ารายการ (รายการสินค้าที่เลือกไว้ยังอยู่ครบ)</li></ul>
  <form method="post" action="${BASE}/${r.id}/delete" class="actions">
    <input type="hidden" name="version" value="${r.updated_at}">
    <button class="danger" type="submit">ยืนยัน ลบกติกานี้</button><a href="${BASE}/${r.id}">ยกเลิก</a>
  </form>
</div>`;
  return page(env, { title: `ลบกติกา #${r.id}`, email, active: 'rules', body });
}

// ---------- บันทึก ----------

async function prepare(request: Request, env: Env, current: RuleWithProducts | null): Promise<{ ok: true; value: RuleInput; version: string } | { ok: false; values: FormValues; errors: FieldErrors }> {
  const { fields, productIds } = await readRuleForm(request);
  const values: FormValues = { fields, productIds: productIds.filter((s) => /^\d{1,9}$/.test(s)).map(Number) };
  const parsed = parseRuleForm(fields, productIds);
  if (!parsed.ok) return { ok: false, values, errors: parsed.errors };
  if (parsed.value.promotion_id !== null && !(await promotionExists(env.DB, parsed.value.promotion_id))) {
    return { ok: false, values, errors: { promotion_id: 'ไม่พบโปรโมชันนี้ เลือกใหม่' } };
  }
  const bad = await invalidProductIds(env.DB, parsed.value.product_ids, current?.product_ids ?? []);
  if (bad.length) return { ok: false, values, errors: { product_ids: `ไม่พบสินค้า ${bad.map((id) => '#' + id).join(' ')} (อาจถูกลบแล้ว)` } };
  return { ok: true, value: parsed.value, version: fields.version ?? '' };
}

async function saveNew(request: Request, env: Env, email: string): Promise<Response> {
  const prepared = await prepare(request, env, null);
  if (!prepared.ok) return newPage(env, email, prepared.values, prepared.errors, 422);
  const id = await createRule(env.DB, prepared.value, email, new Date().toISOString());
  return redirect(`${BASE}/${id}?msg=created`);
}

async function saveExisting(request: Request, env: Env, url: URL, email: string, r: RuleWithProducts): Promise<Response> {
  const prepared = await prepare(request, env, r);
  if (!prepared.ok) return editPage(env, url, email, r, prepared.values, prepared.errors, 422);
  const result = await updateRule(env.DB, r, prepared.value, prepared.version, email, new Date().toISOString());
  if (result === 'conflict') {
    const latest = (await getRule(env.DB, r.id)) ?? r;
    return editPage(env, url, email, latest, undefined, {}, 409, 'มีคนแก้กติกานี้ไปก่อนคุณ — ด้านล่างคือข้อมูลล่าสุด สิ่งที่คุณแก้ยังไม่ได้บันทึก');
  }
  return redirect(`${BASE}/${r.id}?msg=${result}`);
}

async function setDeleted(request: Request, env: Env, r: RuleWithProducts, email: string, deleted: boolean): Promise<Response> {
  const { fields } = await readRuleForm(request);
  const ok = await setRuleDeleted(env.DB, r.id, deleted, fields.version ?? '', email, new Date().toISOString());
  if (!ok) return redirect(`${BASE}/${r.id}?msg=conflict`);
  return redirect(deleted ? `${BASE}?deleted=${r.id}` : `${BASE}/${r.id}?msg=restored`);
}

// ---------- router ----------

export async function handlePromotionRulesAdmin(request: Request, env: Env, url: URL, path: string, email: string): Promise<Response> {
  const isRead = request.method === 'GET' || request.method === 'HEAD';
  const isPost = request.method === 'POST';
  if (isPost && !sameOrigin(request, url)) return errorPage(env, 403, 'คำขอไม่ได้มาจากหน้าหลังบ้าน');

  if (path === BASE) return isRead ? ruleList(env, url, email) : errorPage(env, 405, 'ไม่รองรับคำขอนี้');
  if (path === `${BASE}/new`) {
    // ?promotion=<id> = มาจากหน้าโปร → เลือกโปรนั้นไว้ให้
    const pre = url.searchParams.get('promotion') ?? '';
    if (isRead) return newPage(env, email, { fields: { promotion_id: /^\d{1,9}$/.test(pre) ? pre : '' }, productIds: [] });
    return isPost ? saveNew(request, env, email) : errorPage(env, 405, 'ไม่รองรับคำขอนี้');
  }
  const m = /^\/back\/promotion-rules\/(\d{1,9})(?:\/(delete|restore))?$/.exec(path);
  if (m) {
    const r = await getRule(env.DB, Number(m[1]));
    if (!r) return page(env, { title: 'ไม่พบกติกา', email, active: 'rules', status: 404, body: html`<div class="card empty">ไม่พบกติกา #${m[1]} · <a href="${BASE}">กลับรายการ</a></div>` });
    if (m[2] === 'delete') {
      if (isRead) return deleteConfirmPage(env, email, r);
      return isPost ? setDeleted(request, env, r, email, true) : errorPage(env, 405, 'ไม่รองรับคำขอนี้');
    }
    if (m[2] === 'restore') return isPost ? setDeleted(request, env, r, email, false) : redirect(`${BASE}/${r.id}`);
    if (isRead) return editPage(env, url, email, r);
    return isPost ? saveExisting(request, env, url, email, r) : errorPage(env, 405, 'ไม่รองรับคำขอนี้');
  }
  return errorPage(env, 404, 'ไม่พบหน้านี้');
}
