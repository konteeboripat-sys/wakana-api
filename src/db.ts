import type { OrderStatus, ValidOrder } from './orders.ts';

export interface OrderRow {
  id: number;
  ref: string;
  status: OrderStatus;
  method: 'delivery' | 'pickup';
  customer_name: string;
  phone: string;
  address: string;
  location: string;
  wanted_at: string;
  note: string;
  item_count: number;
  total_satang: number;
  source: string;
  created_at: string;
  updated_at: string;
  /** migration 0013 — มีค่าเฉพาะออเดอร์เว็บเดิม · grand_total_satang NULL = ยังไม่รู้ยอดสุทธิ */
  email: string;
  payment_type: string;
  grand_total_satang: number | null;
}

export interface OrderItemRow {
  line_no: number;
  product_id: string;
  name: string;
  category: string;
  unit_price_satang: number;
  qty: number;
}

export interface OrderEventRow {
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  actor: string;
  at: string;
}

/**
 * บันทึกออเดอร์ทั้งก้อนใน transaction เดียว (D1 batch)
 * ref ซ้ำ = เว็บส่งซ้ำ (เช่นลูกค้ากด "ลองเปิด LINE อีกครั้ง") → ไม่สร้างใหม่ คืน created: false
 */
export async function insertOrder(db: D1Database, order: ValidOrder, nowIso: string): Promise<{ created: boolean }> {
  const existing = await db.prepare('SELECT 1 FROM orders WHERE ref = ?').bind(order.ref).first();
  if (existing) return { created: false };

  const orderId = '(SELECT id FROM orders WHERE ref = ?)';
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO orders (ref, method, customer_name, phone, address, location, wanted_at, note, item_count, total_satang, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (ref) DO NOTHING`
      )
      .bind(order.ref, order.method, order.name, order.phone, order.address, order.location, order.wantedAt, order.note, order.itemCount, order.totalSatang, nowIso, nowIso),
    ...order.lines.map((line, i) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO order_items (order_id, line_no, product_id, name, category, unit_price_satang, qty)
           VALUES (${orderId}, ?, ?, ?, ?, ?, ?)`
        )
        .bind(order.ref, i + 1, line.productId, line.name, line.category, line.unitPriceSatang, line.qty)
    ),
    db
      .prepare(
        `INSERT INTO order_events (order_id, from_status, to_status, actor, at)
         SELECT o.id, NULL, 'new', 'web', ? FROM orders o
         WHERE o.ref = ? AND NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id)`
      )
      .bind(nowIso, order.ref),
  ]);
  return { created: (results[0]?.meta.changes ?? 0) > 0 };
}

export interface OrderFilter {
  status: OrderStatus | '';
  /** ISO UTC [from, to) — '' = ไม่กรอง */
  from: string;
  to: string;
  /** เบอร์ที่จัดรูปแล้ว (ตรงตัว) */
  phone: string;
  /** ค้นเลขออเดอร์/ชื่อแบบบางส่วน */
  text: string;
  /** ช่อง order_no / customer_name แยกกัน (หน้ารายการแบบเว็บเดิม) — บางส่วน · '' = ไม่กรอง */
  ref?: string;
  name?: string;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);
const likeOf = (s: string | undefined) => (s ? `%${escapeLike(s)}%` : '');

const ORDER_WHERE = `WHERE (?1 = '' OR status = ?1)
         AND (?2 = '' OR created_at >= ?2)
         AND (?3 = '' OR created_at < ?3)
         AND (?4 = '' OR phone = ?4)
         AND (?5 = '' OR ref LIKE ?5 ESCAPE '\\' OR customer_name LIKE ?5 ESCAPE '\\')
         AND (?6 = '' OR ref LIKE ?6 ESCAPE '\\')
         AND (?7 = '' OR customer_name LIKE ?7 ESCAPE '\\')`;
const filterBinds = (f: OrderFilter) => [f.status, f.from, f.to, f.phone, likeOf(f.text), likeOf(f.ref), likeOf(f.name)];

export async function listOrders(db: D1Database, f: OrderFilter, limit = 200, offset = 0): Promise<OrderRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM orders ${ORDER_WHERE} ORDER BY created_at DESC LIMIT ?8 OFFSET ?9`)
    .bind(...filterBinds(f), limit, offset)
    .all<OrderRow>();
  return results;
}

/** จำนวนทั้งหมดตามตัวกรอง (ทำเลขหน้า) */
export async function countOrders(db: D1Database, f: OrderFilter): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM orders ${ORDER_WHERE}`).bind(...filterBinds(f)).first<{ n: number }>();
  return row?.n ?? 0;
}

/** จำนวนออเดอร์แต่ละสถานะ ในช่วงวันที่เดียวกับที่กรอง */
export async function countByStatus(db: D1Database, from: string, to: string): Promise<Partial<Record<OrderStatus, number>>> {
  const { results } = await db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM orders
       WHERE (?1 = '' OR created_at >= ?1) AND (?2 = '' OR created_at < ?2)
       GROUP BY status`
    )
    .bind(from, to)
    .all<{ status: OrderStatus; n: number }>();
  return Object.fromEntries(results.map((r) => [r.status, r.n]));
}

export async function getOrder(db: D1Database, ref: string): Promise<{ order: OrderRow; items: OrderItemRow[]; events: OrderEventRow[] } | null> {
  const order = await db.prepare('SELECT * FROM orders WHERE ref = ?').bind(ref).first<OrderRow>();
  if (!order) return null;
  const [items, events] = await db.batch([
    db.prepare('SELECT line_no, product_id, name, category, unit_price_satang, qty FROM order_items WHERE order_id = ? ORDER BY line_no').bind(order.id),
    db.prepare('SELECT from_status, to_status, actor, at FROM order_events WHERE order_id = ? ORDER BY at, id').bind(order.id),
  ]);
  return { order, items: (items?.results ?? []) as OrderItemRow[], events: (events?.results ?? []) as OrderEventRow[] };
}

/**
 * เปลี่ยนสถานะแบบกันชนกัน: เปลี่ยนได้เฉพาะเมื่อสถานะปัจจุบันยังเป็น from (พนักงานสองคนกดพร้อมกัน → คนหลังได้ false)
 * บันทึกประวัติใน transaction เดียวกัน
 */
export async function changeStatus(db: D1Database, ref: string, from: OrderStatus, to: OrderStatus, actor: string, nowIso: string): Promise<boolean> {
  const [update] = await db.batch([
    db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE ref = ? AND status = ?').bind(to, nowIso, ref, from),
    db
      .prepare(
        `INSERT INTO order_events (order_id, from_status, to_status, actor, at)
         SELECT id, ?, ?, ?, ? FROM orders WHERE ref = ? AND changes() = 1`
      )
      .bind(from, to, actor, nowIso, ref),
  ]);
  return (update?.meta.changes ?? 0) === 1;
}
