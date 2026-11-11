// แปลงออเดอร์เว็บเดิม (ไฟล์ dump MySQL ของ wakana_db: ตาราง orders + orders_detail) → คำสั่ง SQL สำหรับ `wrangler d1 execute --file`
// ฟังก์ชันล้วน (เทสได้) · ใช้ผ่าน scripts/import-orders.mjs เท่านั้น — ข้อมูลส่วนบุคคล ต้องนำเข้าแบบมีผู้รับผิดชอบ (เหมือน customers-import.ts)
//
// เทียบช่อง:
//   order_no → ref (เลขเดิม เช่น 20200400001 — พนักงานค้นด้วยเลขที่คุ้นได้) · source = 'old_site' · รันซ้ำได้ (ref ซ้ำ = ข้าม)
//   order_status 1–6 → status (ดู STATUS_MAP) · deliveryType 'here' = รับที่ร้าน · อื่น ๆ = จัดส่ง
//   OrderDate (เวลาไทยของเครื่องเดิม) → created_at ISO UTC · deliveryDate "20 เมษายน 2563" + deliveryTime → wanted_at 'YYYY-MM-DDTHH:MM'
//   order_amt → total_satang (ค่าสินค้า ยังไม่รวมค่าส่ง ตรงกับตารางใหม่)
//   ช่องที่ตารางใหม่ไม่มี (อีเมล ส่วนลด ค่าส่ง ยอดสุทธิ วิธีชำระ สาขารับ ใบกำกับภาษี แพ้อาหาร หมายเหตุพนักงาน สถานะเดิม) → ต่อท้าย note

import { normalizePhone } from './phone.ts';

// ---------- อ่าน dump ----------

export type SqlValue = string | number | null;

/** อ่าน INSERT INTO `table` (...) VALUES (...),(...); ทุกคำสั่งของตารางนั้น → แถวเป็น object ตามชื่อคอลัมน์ */
export function parseInserts(dump: string, table: string): Record<string, SqlValue>[] {
  const out: Record<string, SqlValue>[] = [];
  const head = `INSERT INTO \`${table}\` (`;
  let at = dump.indexOf(head);
  while (at !== -1) {
    const colsEnd = dump.indexOf(') VALUES', at);
    if (colsEnd === -1) throw new Error(`${table}: หาคำว่า VALUES ไม่เจอ`);
    const cols = dump
      .slice(at + head.length, colsEnd)
      .split(',')
      .map((c) => c.trim().replace(/^`|`$/g, ''));
    let i = colsEnd + ') VALUES'.length;
    // ไล่ทีละ tuple จนเจอ ; ที่จบคำสั่ง (นอกเครื่องหมายคำพูด)
    for (;;) {
      while (i < dump.length && /[\s,]/.test(dump[i]!)) i++;
      if (dump[i] === ';') break;
      if (dump[i] !== '(') throw new Error(`${table}: รูปแบบ VALUES ไม่ถูกต้องที่ตำแหน่ง ${i}`);
      const [values, next] = parseTuple(dump, i);
      if (values.length !== cols.length) throw new Error(`${table}: จำนวนค่าไม่ตรงคอลัมน์ (${values.length} ≠ ${cols.length})`);
      out.push(Object.fromEntries(cols.map((c, k) => [c, values[k]!])));
      i = next;
    }
    at = dump.indexOf(head, i);
  }
  return out;
}

const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', '0': '\0', Z: '\x1a', b: '\b' };

/** ( 'a\'b', 12, NULL ) เริ่มที่ '(' → [ค่า, ตำแหน่งหลัง ')'] */
function parseTuple(s: string, start: number): [SqlValue[], number] {
  const values: SqlValue[] = [];
  let i = start + 1;
  for (;;) {
    while (s[i] === ' ' || s[i] === '\n' || s[i] === '\r' || s[i] === '\t') i++;
    if (s[i] === "'") {
      let v = '';
      i++;
      for (;;) {
        const c = s[i];
        if (c === undefined) throw new Error('ข้อความไม่ปิดเครื่องหมายคำพูด');
        if (c === '\\') {
          const n = s[i + 1]!;
          v += ESCAPES[n] ?? n;
          i += 2;
        } else if (c === "'" && s[i + 1] === "'") {
          v += "'";
          i += 2;
        } else if (c === "'") {
          i++;
          break;
        } else {
          v += c;
          i++;
        }
      }
      values.push(v);
    } else {
      let j = i;
      while (s[j] !== ',' && s[j] !== ')') j++;
      const raw = s.slice(i, j).trim();
      values.push(raw.toUpperCase() === 'NULL' ? null : Number(raw));
      i = j;
    }
    while (s[i] === ' ') i++;
    if (s[i] === ',') {
      i++;
      continue;
    }
    if (s[i] === ')') return [values, i + 1];
    throw new Error(`ค่าใน tuple ไม่ถูกต้องที่ตำแหน่ง ${i}`);
  }
}

// ---------- แปลงค่า ----------

/**
 * สถานะเว็บเดิม (ตาราง order_status) → สถานะใหม่
 * ออเดอร์เดิมเป็นของเก่าปี 2563–2567 ทั้งหมด (ผู้ใช้เลือก 2026-10-16): ชำระแล้ว = เสร็จสิ้น · ไม่ได้ชำระ = ยกเลิก
 * ⇒ แท็บ "ใหม่" ไม่ปนของเก่า · สถานะเดิมเก็บไว้ใน note
 */
export const STATUS_MAP: Record<number, 'new' | 'confirmed' | 'preparing' | 'done' | 'cancelled'> = {
  1: 'cancelled', // New order ยังไม่ชำระเงิน — ค้างมาหลายปี ไม่ได้ชำระ
  2: 'done', // Processing order กำลังดำเนินการ
  3: 'done', // Payment received ชำระเงินสำเร็จ
  4: 'done', // Order complete จัดส่งเรียบร้อย
  5: 'cancelled', // Cancle order-ชำระเงินไม่สำเร็จ
  6: 'cancelled', // Cancle order-อื่นๆ
};
export const OLD_STATUS_NAMES: Record<number, string> = {
  1: 'ยังไม่ชำระเงิน',
  2: 'กำลังดำเนินการ',
  3: 'ชำระเงินสำเร็จ',
  4: 'จัดส่งเรียบร้อย',
  5: 'ยกเลิก-ชำระเงินไม่สำเร็จ',
  6: 'ยกเลิก-อื่นๆ',
};

/** ป้ายสถานะเต็มตามหน้า orderList.php เดิม (ตาราง order_status · สะกดตามต้นฉบับ) */
export const OLD_STATUS_LABELS: Record<number, string> = {
  1: 'New order ยังไม่ชำระเงิน',
  2: 'Processing order กำลังดำเนินการ',
  3: 'Payment received ชำระเงินสำเร็จ',
  4: 'Order complete จัดส่งเรียบร้อย',
  5: 'Cancle order-ชำระเงินไม่สำเร็จ',
  6: 'Cancle order-อื่นๆ',
};

/**
 * ป้ายสถานะเว็บเดิมของออเดอร์ที่นำเข้า — อ่านจากบรรทัด "[เว็บเดิม] สถานะ: …" ใน note
 * คืน null ถ้าไม่ใช่ออเดอร์เว็บเดิม หรือพนักงานเปลี่ยนสถานะไปแล้ว (สถานะปัจจุบันไม่ตรงกับที่นำเข้า) ⇒ ใช้ป้ายสถานะใหม่
 */
export function legacyStatusLabel(o: { source: string; status: string; note: string }): string | null {
  if (o.source !== 'old_site') return null;
  const m = /\[เว็บเดิม\] สถานะ: ([^·\n]+?)(?: ·|\n|$)/.exec(o.note);
  if (!m) return null;
  const code = Number(Object.keys(OLD_STATUS_NAMES).find((k) => OLD_STATUS_NAMES[Number(k)] === m[1]!.trim()));
  if (!code || STATUS_MAP[code] !== o.status) return null;
  return OLD_STATUS_LABELS[code] ?? null;
}

const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

/** "20 เมษายน 2563" + "12:32" → "2020-04-20T12:32" · อ่านไม่ได้ = '' (= เร็วที่สุด) */
export function thaiWantedAt(date: string | null, time: string | null): string {
  const m = /^\s*(\d{1,2})\s+(\S+)\s+(\d{4})\s*$/.exec(date ?? '');
  if (!m) return '';
  const month = THAI_MONTHS.indexOf(m[2]!) + 1;
  let year = Number(m[3]);
  if (year > 2400) year -= 543;
  const day = Number(m[1]);
  if (!month || day < 1 || day > 31 || year < 2000) return '';
  const t = /^\s*(\d{1,2}):(\d{2})/.exec(time ?? '');
  const hh = t && Number(t[1]) < 24 && Number(t[2]) < 60 ? `${t[1]!.padStart(2, '0')}:${t[2]}` : '00:00';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${hh}`;
}

/** "2020-04-19 21:33:01" เวลาไทย (UTC+7 ของเครื่องเดิม) → ISO UTC */
export function bangkokToIso(raw: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m || m[1] === '0000') return null;
  const ms = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]! - 7, +m[5]!, +m[6]!);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** ชื่อสินค้าบางรายการเป็น HTML ("<p>เบนโตะ…</p>") → ข้อความล้วน */
const stripTags = (s: string) => s.replace(/<\/p>\s*<p>|<br\s*\/?>/gi, ' / ').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const text = (v: SqlValue | undefined, max: number) => (v === null || v === undefined ? '' : String(v)).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').replace(/[ \t]{2,}/g, ' ').trim().slice(0, max);
const satang = (v: SqlValue | undefined) => Math.round(Number(v ?? 0) * 100) || 0;
const baht = (s: number) => (s / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

export interface LegacyItem {
  product_id: string;
  name: string;
  unit_price_satang: number;
  qty: number;
}

export interface LegacyOrder {
  ref: string;
  status: (typeof STATUS_MAP)[number];
  method: 'delivery' | 'pickup';
  customer_name: string;
  phone: string;
  address: string;
  wanted_at: string;
  note: string;
  item_count: number;
  total_satang: number;
  /** ช่องตาม migration 0013 (หน้ารายการแสดงเหมือน orderList.php เดิม) */
  email: string;
  payment_type: string;
  grand_total_satang: number;
  created_at: string;
  items: LegacyItem[];
}

export interface OrdersImportResult {
  orders: LegacyOrder[];
  skipped: { ref: string; reason: string }[];
  /** รายการสินค้าที่ปรับ (จำนวนเกิน 99 / 0) */
  adjusted: { ref: string; reason: string }[];
}

/** dump ทั้งไฟล์ → ออเดอร์พร้อมนำเข้า */
export function ordersFromDump(dump: string): OrdersImportResult {
  const details = new Map<string, Record<string, SqlValue>[]>();
  for (const d of parseInserts(dump, 'orders_detail')) {
    const key = String(d.order_no ?? '');
    if (!details.has(key)) details.set(key, []);
    details.get(key)!.push(d);
  }

  const allOrders = parseInserts(dump, 'orders');
  // เว็บเดิมออกเลขซ้ำได้ (เช่น 20200600001 = 2 ลูกค้า) — รายการสินค้าผูกด้วยเลขอย่างเดียว ⇒ แบ่งรายการตามลำดับ DetailID ให้ยอดตรง order_amt ของแต่ละออเดอร์
  const byRef = new Map<string, Record<string, SqlValue>[]>();
  for (const o of allOrders) {
    const ref = text(o.order_no, 30);
    if (!byRef.has(ref)) byRef.set(ref, []);
    byRef.get(ref)!.push(o);
  }
  const detailsOf = new Map<Record<string, SqlValue>, Record<string, SqlValue>[]>();
  for (const [ref, group] of byRef) {
    const lines = (details.get(ref) ?? []).sort((a, b) => Number(a.DetailID) - Number(b.DetailID));
    if (group.length === 1) {
      detailsOf.set(group[0]!, lines);
      continue;
    }
    let k = 0;
    group
      .sort((a, b) => Number(a.OrderID) - Number(b.OrderID))
      .forEach((o, gi) => {
        const take: Record<string, SqlValue>[] = [];
        let sum = 0;
        const target = satang(o.order_amt);
        // ออเดอร์สุดท้ายของกลุ่มรับรายการที่เหลือทั้งหมด
        while (k < lines.length && (gi === group.length - 1 || sum < target)) {
          const d = lines[k++]!;
          take.push(d);
          sum += satang(d.sell_price) * Math.max(0, Number(d.Qty ?? 0));
        }
        detailsOf.set(o, take);
      });
  }

  const orders: LegacyOrder[] = [];
  const skipped: OrdersImportResult['skipped'] = [];
  const adjusted: OrdersImportResult['adjusted'] = [];
  const used = new Map<string, number>();
  for (const o of allOrders) {
    const baseRef = text(o.order_no, 30);
    if (!baseRef) {
      skipped.push({ ref: `OrderID ${o.OrderID}`, reason: 'ไม่มีเลขออเดอร์' });
      continue;
    }
    const created_at = bangkokToIso(String(o.OrderDate ?? ''));
    if (!created_at) {
      skipped.push({ ref: baseRef, reason: `วันที่สั่งอ่านไม่ได้: ${o.OrderDate}` });
      continue;
    }
    const n = (used.get(baseRef) ?? 0) + 1;
    used.set(baseRef, n);
    const ref = n === 1 ? baseRef : `${baseRef}-${n}`;
    if (n > 1) adjusted.push({ ref, reason: `เลข ${baseRef} ซ้ำในเว็บเดิม (OrderID ${o.OrderID}) → ใช้เลข ${ref}` });

    const items: LegacyItem[] = [];
    const zeroQty: string[] = [];
    for (const d of detailsOf.get(o) ?? []) {
      const name = text(stripTags(String(d.product_name ?? '')), 200) || `สินค้า #${text(d.product_id, 20)}`;
      let qty = Math.trunc(Number(d.Qty ?? 0));
      if (qty < 1) {
        // ตารางใหม่รับจำนวน 1–99 ⇒ เก็บไว้ใน note แทน
        zeroQty.push(name);
        adjusted.push({ ref, reason: `รายการจำนวน ${d.Qty} "${name.slice(0, 60)}" → ย้ายไปไว้ใน note` });
        continue;
      }
      if (qty > 99) {
        adjusted.push({ ref, reason: `"${name.slice(0, 60)}" จำนวน ${qty} → 99 (ตารางใหม่รับได้สูงสุด 99)` });
        qty = 99;
      }
      items.push({ product_id: text(d.product_id, 20), name, unit_price_satang: satang(d.sell_price), qty });
    }

    const oldStatus = Number(o.order_status);
    const status = STATUS_MAP[oldStatus] ?? 'new';
    const extras = [
      `[เว็บเดิม] สถานะ: ${OLD_STATUS_NAMES[oldStatus] ?? oldStatus}`,
      `ยอดสุทธิ ${baht(satang(o.total_amt))} บาท (สินค้า ${baht(satang(o.order_amt))} · ส่วนลด ${baht(satang(o.discount_amt))} · ค่าส่ง ${baht(satang(o.delivery_amt))})`,
      text(o.paymentType, 40) && `ชำระ: ${text(o.paymentType, 40)}`,
      text(o.deliveryType, 40) && `รับ/ส่ง: ${text(o.deliveryType, 40)}`,
      text(o.deliveryShop, 190) && `สาขา: ${text(o.deliveryShop, 190)}`,
      text(o.Email, 100) && `อีเมล: ${text(o.Email, 100)}`,
      text(o.foodallergy, 500) && `แพ้อาหาร: ${text(o.foodallergy, 500)}`,
      text(o.orderTax, 1000) && `ใบกำกับภาษี: ${text(o.orderTax, 1000)}`,
      text(o.orderComment, 500) && `หมายเหตุพนักงาน: ${text(o.orderComment, 500)}`,
      zeroQty.length > 0 && `รายการจำนวน 0: ${zeroQty.join(' / ')}`,
    ].filter(Boolean);
    const customerNote = text(o.orderNote, 500);

    orders.push({
      ref,
      status,
      method: text(o.deliveryType, 20) === 'here' ? 'pickup' : 'delivery',
      customer_name: text(o.customer_name, 100) || '-',
      phone: normalizePhone(text(o.Tel, 100)) ?? text(o.Tel, 30),
      address: text(o.customer_address, 500),
      wanted_at: thaiWantedAt(text(o.deliveryDate, 50) || null, text(o.deliveryTime, 20) || null),
      note: [customerNote, extras.join(' · ')].filter(Boolean).join('\n'),
      item_count: items.reduce((n, it) => n + it.qty, 0),
      total_satang: satang(o.order_amt),
      email: text(o.Email, 100),
      payment_type: text(o.paymentType, 40),
      grand_total_satang: satang(o.total_amt),
      created_at,
      items,
    });
  }
  return { orders, skipped, adjusted };
}

// ---------- SQL ----------

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export const IMPORT_ACTOR = 'เว็บเดิม (นำเข้า)';

/**
 * INSERT OR IGNORE ทุกตาราง (ref ซ้ำ = ข้ามทั้งออเดอร์ ⇒ รันซ้ำได้)
 * order_id หาจาก ref · หมวดสินค้าหาจากตาราง products ตามรหัสเดิม (รหัสสินค้าใหม่ = รหัสเว็บเดิม) · ไม่เจอ = ''
 */
export function toSql(orders: LegacyOrder[]): string {
  const out: string[] = [];
  for (const o of orders) {
    const id = `(SELECT id FROM orders WHERE ref = ${q(o.ref)})`;
    out.push(
      `INSERT OR IGNORE INTO orders (ref, status, method, customer_name, phone, address, location, wanted_at, note, item_count, total_satang, source, created_at, updated_at) VALUES (${[
        q(o.ref),
        q(o.status),
        q(o.method),
        q(o.customer_name),
        q(o.phone),
        q(o.address),
        "''",
        q(o.wanted_at),
        q(o.note),
        o.item_count,
        o.total_satang,
        "'old_site'",
        q(o.created_at),
        q(o.created_at),
      ].join(', ')});`
    );
    // ช่องของ migration 0013 — UPDATE แยกเพื่อให้รันซ้ำแล้วเติมให้ออเดอร์ที่นำเข้าไปก่อนมีช่องนี้ได้
    out.push(
      `UPDATE orders SET email = ${q(o.email)}, payment_type = ${q(o.payment_type)}, grand_total_satang = ${o.grand_total_satang} WHERE ref = ${q(o.ref)} AND source = 'old_site';`
    );
    o.items.forEach((it, k) => {
      out.push(
        `INSERT OR IGNORE INTO order_items (order_id, line_no, product_id, name, category, unit_price_satang, qty) SELECT ${id}, ${k + 1}, ${q(it.product_id)}, ${q(it.name)}, COALESCE((SELECT category FROM products WHERE id = ${Number(it.product_id) || -1}), ''), ${it.unit_price_satang}, ${it.qty};`
      );
    });
    // เหตุการณ์ "สร้าง" 1 รายการ — กันซ้ำเมื่อรันซ้ำ
    out.push(
      `INSERT INTO order_events (order_id, from_status, to_status, actor, at) SELECT ${id}, NULL, ${q(o.status)}, ${q(IMPORT_ACTOR)}, ${q(o.created_at)} WHERE NOT EXISTS (SELECT 1 FROM order_events WHERE order_id = ${id} AND actor = ${q(IMPORT_ACTOR)});`
    );
  }
  return out.join('\n') + '\n';
}
