// หลังบ้าน /back/promotion-settime และ /back/promotion-monday — แทนหน้า Promotion Settime / Promotion Monday ของเว็บเดิม
// สองหน้านี้โครงเหมือนกัน: ตัวกรอง (เลือกโปร · Start date · End date · Status) · ซ้าย = Promotion Rule Name · ขวา = Promotion Name
// ต่างกันแค่ Settime มีคอลัมน์ Start time / End time · เพิ่ม/แก้/ลบ ใช้หน้าเดียวกับ Promotion (/back/promotions/...)

import { errorPage, page, type AdminSection } from './admin-layout.ts';
import { NOT_ACTIVE_NOTICE } from './admin-promotions.ts';
import type { Env } from './env.ts';
import { html } from './html.ts';
import { RULE_TYPES } from './promotion-rules.ts';
import { listRulesOfPromotions } from './promotion-rules-db.ts';
import { isValidDate, PROMOTION_KINDS } from './promotions.ts';
import { listPromotions, promotionOptions } from './promotions-db.ts';

type SpecialKind = 'settime' | 'monday';

const SPECIAL: Record<SpecialKind, { path: string; section: AdminSection; times: boolean; note: string }> = {
  settime: { path: '/back/promotion-settime', section: 'settime', times: true, note: 'โปรที่กำหนดช่วงเวลาในแต่ละวัน (เช่น Happy Hour)' },
  monday: { path: '/back/promotion-monday', section: 'monday', times: false, note: 'โปรที่ใช้ได้เฉพาะวันจันทร์ในช่วงวันที่' },
};

const statusLabel = (enabled: 0 | 1) => (enabled ? html`<span class="s-ok">Enable</span>` : html`<span class="s-disable">Disable</span>`);

async function specialList(env: Env, url: URL, email: string, kind: SpecialKind): Promise<Response> {
  const cfg = SPECIAL[kind];
  const p = url.searchParams;
  const idParam = p.get('promotion') ?? '';
  const id = /^\d{1,9}$/.test(idParam) ? Number(idParam) : null;
  const start = isValidDate(p.get('start') ?? '') ? (p.get('start') as string) : '';
  const end = isValidDate(p.get('end') ?? '') ? (p.get('end') as string) : '';
  const enabledParam = p.get('status') ?? '';
  const enabled = enabledParam === '0' || enabledParam === '1' ? enabledParam : '';
  const trash = p.get('trash') === '1';
  const deleted = /^\d{1,9}$/.test(p.get('deleted') ?? '') ? p.get('deleted') : null;

  const [options, rows] = await Promise.all([promotionOptions(env.DB, kind), listPromotions(env.DB, { kind, name: '', start, end, trash, id, enabled })]);
  const rules = trash ? [] : await listRulesOfPromotions(env.DB, rows.map((r) => r.id));
  const promoName = new Map(rows.map((r) => [r.id, r.name]));

  const body = html`
<p class="actions" style="margin:0 0 20px">
  <a class="btn success" href="/back/promotion-rules/new${id ? `?promotion=${id}` : ''}">Add promotion rule</a>
  <a class="btn success" href="/back/promotions/new?kind=${kind}">Add new promotion</a>
</p>
${deleted ? html`<div class="flash" role="status">ย้ายโปรโมชัน #${deleted} ไปถังขยะแล้ว · <a href="/back/promotions/${deleted}">ดู / กู้คืน</a></div>` : ''}
${trash ? html`<div class="flash">ถังขยะ: ${PROMOTION_KINDS[kind]} ที่ลบแล้ว — กด "กู้คืน" เพื่อนำกลับ</div>` : NOT_ACTIVE_NOTICE}
<form class="card filters" method="get" action="${cfg.path}">
  ${trash ? html`<input type="hidden" name="trash" value="1">` : ''}
  <label>Promotion Name<select name="promotion"><option value="">Select Promotion Name</option>${options.map(
    (o) => html`<option value="${o.id}" ${id === o.id ? html`selected` : ''}>${o.name}</option>`
  )}</select></label>
  <label>Start date (ตั้งแต่)<input type="date" name="start" value="${start}"></label>
  <label>End date (ไม่เกิน)<input type="date" name="end" value="${end}"></label>
  <label>Status<select name="status"><option value="" ${enabled === '' ? html`selected` : ''}>Status</option><option value="1" ${enabled === '1' ? html`selected` : ''}>Enable</option><option value="0" ${enabled === '0' ? html`selected` : ''}>Disable</option></select></label>
  <button class="primary" type="submit">Search</button>
  ${trash ? html`<a href="${cfg.path}">← กลับรายการ</a>` : html`<a href="${cfg.path}?trash=1">ถังขยะ</a>`}
</form>
<p class="notice" style="margin-top:-8px">${cfg.note}</p>
<div class="settime-grid">
  <section>
    <h2 class="table-title">Promotion Rule Name</h2>
    <div class="card table-wrap"><table>
      <thead><tr><th>Name</th><th>Status</th><th>Type</th>${id ? '' : html`<th>Promotion</th>`}</tr></thead>
      <tbody>${
        rules.length
          ? rules.map(
              (r) => html`<tr><td class="wrap"><a href="/back/promotion-rules/${r.id}">${r.name}</a></td><td>${statusLabel(r.enabled)}</td><td>${r.type ? RULE_TYPES[r.type] : '-'}</td>${
                id ? '' : html`<td class="wrap">${promoName.get(r.promotion_id) ?? ''}</td>`
              }</tr>`
            )
          : html`<tr><td colspan="4" class="notice">${trash ? '' : 'ยังไม่มีกติกาที่ผูกกับโปรในรายการ'}</td></tr>`
      }</tbody>
    </table></div>
  </section>
  <section>
    <h2 class="table-title">Promotion Name</h2>
    <div class="card table-wrap">
    ${
      rows.length
        ? html`<table>
<thead><tr><th>Pro id</th><th>Promotion name</th><th>Status</th><th>Start date</th><th>Expire date</th>${cfg.times ? html`<th>Start time</th><th>End time</th>` : ''}<th></th></tr></thead>
<tbody>${rows.map(
            (r) => html`<tr>
<td><a href="/back/promotions/${r.id}">${r.id}</a></td><td class="wrap">${r.name}</td><td>${statusLabel(r.enabled)}</td>
<td>${r.start_date}</td><td>${r.end_date}</td>${cfg.times ? html`<td>${r.start_time}</td><td>${r.end_time}</td>` : ''}
<td>${
              trash
                ? html`<form method="post" action="/back/promotions/${r.id}/restore"><input type="hidden" name="version" value="${r.updated_at}"><button type="submit">กู้คืน</button></form>`
                : html`<div class="actions"><a href="/back/promotions/${r.id}">Edit</a><a class="danger-link" href="/back/promotions/${r.id}/delete">ลบ</a></div>`
            }</td></tr>`
          )}</tbody></table>`
        : html`<div class="empty">${trash ? 'ถังขยะว่าง' : id || start || end || enabled ? 'ไม่พบโปรตามเงื่อนไขนี้' : `ยังไม่มี ${PROMOTION_KINDS[kind]} — กด "Add new promotion"`}</div>`
    }
    </div>
  </section>
</div>`;
  return page(env, { title: PROMOTION_KINDS[kind], email, active: cfg.section, body });
}

/** path ของหน้านี้ไหม → ประเภท */
export function specialKindOf(path: string): SpecialKind | null {
  if (path === SPECIAL.settime.path) return 'settime';
  if (path === SPECIAL.monday.path) return 'monday';
  return null;
}

export async function handlePromotionSpecialAdmin(request: Request, env: Env, url: URL, path: string, email: string): Promise<Response> {
  const kind = specialKindOf(path);
  if (!kind) return errorPage(env, 404, 'ไม่พบหน้านี้');
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorPage(env, 405, 'ไม่รองรับคำขอนี้');
  return specialList(env, url, email, kind);
}
