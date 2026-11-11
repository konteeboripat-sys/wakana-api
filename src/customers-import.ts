// แปลง CSV สมาชิกเว็บเดิม → คำสั่ง SQL สำหรับ `wrangler d1 execute --file` — ฟังก์ชันล้วน (เทสได้)
// ใช้ผ่าน scripts/import-customers.mjs เท่านั้น · ไม่มีหน้าอัปโหลดในหลังบ้านโดยตั้งใจ (ข้อมูลส่วนบุคคล ต้องนำเข้าแบบมีผู้รับผิดชอบ)

import { parseInserts } from './orders-import.ts';
import { normalizePhone } from './phone.ts';

export interface CustomerImportRow {
  old_id: string | null;
  name: string;
  email: string;
  tel: string;
  company: string;
  register_date: string;
}

/** CSV ตาม RFC 4180 (ช่องในเครื่องหมายคำพูด · "" = " · ขึ้นบรรทัดในช่องได้) · ตัด BOM */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

// ชื่อหัวคอลัมน์ที่รับ (ไม่สนตัวพิมพ์) — ตามหน้าเดิม + ชื่อที่ฐานข้อมูลเดิมน่าจะใช้
const HEADER_ALIASES: Record<keyof CustomerImportRow, string[]> = {
  old_id: ['id', 'customer_id', 'member_id', 'old_id'],
  name: ['name', 'fullname', 'customer_name'],
  email: ['email', 'e-mail'],
  tel: ['tel', 'phone', 'mobile', 'telephone'],
  company: ['company', 'company_name'],
  register_date: ['register_date', 'created_at', 'regis_date', 'register'],
};

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

function normalizeDate(raw: string): string | null {
  const m = DATE_PATTERN.exec(raw.trim());
  if (!m) return null;
  const [y, mo, d, h = '00', mi = '00', s = '00'] = m.slice(1).map((x) => x ?? undefined) as string[];
  if (Number(y) < 2000 || Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31 || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

const clean = (s: string | undefined, max: number) => (s ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);

export interface ImportResult {
  rows: CustomerImportRow[];
  /** แถวที่ข้าม พร้อมเหตุผล (เลขแถวนับจาก 1 รวมหัวตาราง) */
  skipped: { line: number; reason: string }[];
}

export function rowsFromCsv(text: string): ImportResult {
  const table = parseCsv(text);
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = {} as Record<keyof CustomerImportRow, number>;
  for (const key of Object.keys(HEADER_ALIASES) as (keyof CustomerImportRow)[]) {
    col[key] = header.findIndex((h) => HEADER_ALIASES[key].includes(h));
  }
  if (col.name < 0 || col.register_date < 0) throw new Error(`CSV ต้องมีคอลัมน์ name และ register_date (เจอ: ${header.join(', ')})`);

  const rows: CustomerImportRow[] = [];
  const skipped: ImportResult['skipped'] = [];
  const seen = new Set<string>();
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (key: keyof CustomerImportRow) => (col[key] >= 0 ? cells[col[key]] : '');
    const name = clean(get('name'), 200);
    const register_date = normalizeDate(get('register_date') ?? '');
    const old_id = clean(get('old_id'), 50) || null;
    if (!name) return skipped.push({ line, reason: 'ไม่มีชื่อ' });
    if (!register_date) return skipped.push({ line, reason: `register_date อ่านไม่ได้: "${clean(get('register_date'), 30)}"` });
    if (old_id && seen.has(old_id)) return skipped.push({ line, reason: `รหัส ${old_id} ซ้ำในไฟล์` });
    if (old_id) seen.add(old_id);
    rows.push({ old_id, name, email: clean(get('email'), 200), tel: clean(get('tel'), 30), company: clean(get('company'), 200), register_date });
  });
  return { rows, skipped };
}

/**
 * dump MySQL ของ wakana_db (ตาราง customer) → แถวพร้อมนำเข้า — ใช้แทน CSV ได้
 * customer_id (= อีเมลที่ใช้ล็อกอิน) → old_id + email · ชื่อ = fname + lname · Tel = มือถือ ไม่มีใช้เบอร์บ้าน
 * ไม่นำเข้า: รหัสผ่าน · token · วันเกิด · ที่อยู่ · facebook_id (เว็บใหม่ไม่มีสมาชิก/ล็อกอิน ไม่ต้องใช้ — เก็บเท่าที่หน้าเดิมแสดง)
 */
export function rowsFromDump(dump: string): ImportResult {
  const rows: CustomerImportRow[] = [];
  const skipped: ImportResult['skipped'] = [];
  const seen = new Set<string>();
  parseInserts(dump, 'customer').forEach((r, i) => {
    const line = i + 1;
    const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
    const old_id = clean(str(r.customer_id), 200);
    const name = clean(`${str(r.customer_fname).trim()} ${str(r.customer_lname).trim()}`, 200) || old_id;
    const register_date = normalizeDate(str(r.register_date));
    if (!old_id) return skipped.push({ line, reason: 'ไม่มี customer_id' });
    if (!register_date) return skipped.push({ line, reason: `register_date อ่านไม่ได้: "${clean(str(r.register_date), 30)}"` });
    const key = old_id.toLowerCase();
    if (seen.has(key)) return skipped.push({ line, reason: `customer_id ${old_id} ซ้ำ` });
    seen.add(key);
    const telRaw = clean(str(r.customer_mobile), 30) || clean(str(r.customer_phone), 30);
    rows.push({ old_id, name, email: old_id.includes('@') ? old_id : '', tel: normalizePhone(telRaw) ?? telRaw, company: clean(str(r.customer_company), 200), register_date });
  });
  return { rows, skipped };
}

const sqlString = (s: string | null) => (s === null ? 'NULL' : `'${s.replace(/'/g, "''")}'`);

/** INSERT OR IGNORE (รหัสเดิมซ้ำ = ข้าม ⇒ รันซ้ำได้) · ทีละ 100 แถวต่อคำสั่ง */
export function toSql(rows: CustomerImportRow[], importedAt: string): string {
  const out: string[] = [];
  for (let i = 0; i < rows.length; i += 100) {
    const values = rows
      .slice(i, i + 100)
      .map((r) => `(${[r.old_id, r.name, r.email, r.tel, r.company, r.register_date].map(sqlString).join(', ')}, 'old_site', ${sqlString(importedAt)})`)
      .join(',\n  ');
    out.push(`INSERT OR IGNORE INTO customers (old_id, name, email, tel, company, register_date, source, imported_at) VALUES\n  ${values};`);
  }
  return out.join('\n') + '\n';
}
