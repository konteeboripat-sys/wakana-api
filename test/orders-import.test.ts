import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bangkokToIso, legacyStatusLabel, ordersFromDump, parseInserts, thaiWantedAt, toSql } from '../src/orders-import.ts';

// ข้อมูลสมมติทั้งหมด (ไม่ใช่ลูกค้าจริง) · รูปแบบเดียวกับ dump ของ phpMyAdmin
const ORDER_COLS =
  '`OrderID`, `order_no`, `customer_name`, `customer_address`, `Tel`, `Email`, `order_amt`, `discount_amt`, `delivery_amt`, `total_amt`, `deliveryDate`, `deliveryTime`, `deliveryType`, `deliveryShop`, `paymentType`, `orderNote`, `OrderDate`, `order_status`, `orderComment`, `orderTax`, `foodallergy`, `sendMail`, `line_noti`';
const DUMP = `
INSERT INTO \`orders\` (${ORDER_COLS}) VALUES
(00001, '20200400001', 'ทดสอบ หนึ่ง', '1 ถนนทดสอบ     10100', '0812345678', 'one@example.com', 300, 0, 50, 350, '20 เมษายน 2563', '12:32', 'msg', NULL, 'qrcode', 'ไม่ใส่วาซาบิ', '2020-04-19 21:33:01', 3, NULL, NULL, NULL, 1, 0),
(00002, '20200600001', 'Test O\\'Two', 'addr', '02-123-4567', '', 100, 0, 0, 100, '06 มิถุนายน 2563', '15:13', 'here', NULL, 'banktransfer', '', '2020-06-05 22:25:07', 1, NULL, NULL, NULL, 1, 0),
(00003, '20200600001', 'ทดสอบ สาม', 'addr3', 'abc', '', 240, 0, 0, 240, 'ไม่ระบุ', NULL, 'msg', NULL, NULL, 'line1\\r\\nline2', '2020-06-09 02:46:56', 1, NULL, NULL, NULL, 1, 0);

INSERT INTO \`orders_detail\` (\`DetailID\`, \`order_no\`, \`product_id\`, \`Qty\`, \`product_name\`, \`sell_price\`) VALUES
(1, '20200400001', '343', 2, 'ซูชิ ทดสอบ', 150),
(2, '20200400001', '9', 0, '<p>ของแถม(x1)</p><p>อีกอย่าง</p>', 0),
(3, '20200600001', '118', 1, 'เซ็ต A', 100),
(4, '20200600001', '20', 2, 'มากิ', 120);
`;

test('parseInserts: escape \\\' \\r\\n · NULL · ตัวเลข', () => {
  const rows = parseInserts(DUMP, 'orders');
  assert.equal(rows.length, 3);
  assert.equal(rows[1]!.customer_name, "Test O'Two");
  assert.equal(rows[2]!.orderNote, 'line1\r\nline2');
  assert.equal(rows[0]!.deliveryShop, null);
  assert.equal(rows[0]!.order_amt, 300);
  assert.equal(parseInserts(DUMP, 'orders_detail').length, 4);
});

test('thaiWantedAt / bangkokToIso', () => {
  assert.equal(thaiWantedAt('20 เมษายน 2563', '12:32'), '2020-04-20T12:32');
  assert.equal(thaiWantedAt('6 มิถุนายน 2563', '9:05'), '2020-06-06T09:05');
  assert.equal(thaiWantedAt('ไม่ระบุ', null), '');
  assert.equal(bangkokToIso('2020-04-19 21:33:01'), '2020-04-19T14:33:01.000Z');
  assert.equal(bangkokToIso('0000-00-00 00:00:00'), null);
});

test('ordersFromDump: สถานะ · รับที่ร้าน · เบอร์ · note · รายการจำนวน 0 · HTML', () => {
  const { orders, skipped } = ordersFromDump(DUMP);
  assert.deepEqual(skipped, []);
  const [a, b, c] = orders;
  assert.equal(a!.status, 'done');
  assert.equal(a!.method, 'delivery');
  assert.equal(a!.phone, '081-234-5678');
  assert.equal(a!.total_satang, 30000);
  assert.equal(a!.item_count, 2);
  assert.deepEqual(a!.items, [{ product_id: '343', name: 'ซูชิ ทดสอบ', unit_price_satang: 15000, qty: 2 }]);
  assert.match(a!.note, /^ไม่ใส่วาซาบิ\n\[เว็บเดิม\] สถานะ: ชำระเงินสำเร็จ/);
  assert.match(a!.note, /ยอดสุทธิ 350 บาท \(สินค้า 300 · ส่วนลด 0 · ค่าส่ง 50\)/);
  assert.match(a!.note, /รายการจำนวน 0: ของแถม\(x1\) \/ อีกอย่าง/);
  assert.equal(b!.status, 'cancelled');
  assert.equal(b!.method, 'pickup');
  assert.equal(b!.phone, '02-123-4567');
  assert.equal(c!.phone, 'abc'); // เบอร์อ่านไม่ได้ = เก็บตามเดิม
  assert.equal(c!.wanted_at, '');
});

test('ordersFromDump: เลขออเดอร์ซ้ำ → -2 และแบ่งรายการตามยอด', () => {
  const { orders } = ordersFromDump(DUMP);
  assert.deepEqual(
    orders.map((o) => o.ref),
    ['20200400001', '20200600001', '20200600001-2']
  );
  assert.deepEqual(orders[1]!.items.map((i) => i.name), ['เซ็ต A']);
  assert.deepEqual(orders[2]!.items.map((i) => i.name), ['มากิ']);
});

test('toSql: INSERT OR IGNORE · escape \' · order_id จาก ref · หมวดจาก products · event ไม่ซ้ำ', () => {
  const sql = toSql(ordersFromDump(DUMP).orders);
  assert.match(sql, /INSERT OR IGNORE INTO orders \(ref, .*'Test O''Two'/);
  assert.match(sql, /INSERT OR IGNORE INTO order_items .* SELECT \(SELECT id FROM orders WHERE ref = '20200400001'\), 1, '343', .*\(SELECT category FROM products WHERE id = 343\)/);
  assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM order_events WHERE order_id = \(SELECT id FROM orders WHERE ref = '20200600001-2'\)/);
  assert.equal(sql.match(/INSERT OR IGNORE INTO orders /g)!.length, 3);
});

test('legacyStatusLabel: ป้ายแบบเว็บเดิม · เปลี่ยนสถานะแล้ว/ออเดอร์ใหม่ = null', () => {
  const [a, b] = ordersFromDump(DUMP).orders;
  const row = (o: typeof a, status = o!.status) => ({ source: 'old_site', status, note: o!.note });
  assert.equal(legacyStatusLabel(row(a)), 'Payment received ชำระเงินสำเร็จ');
  assert.equal(legacyStatusLabel(row(b)), 'New order ยังไม่ชำระเงิน');
  assert.equal(legacyStatusLabel(row(a, 'cancelled')), null); // พนักงานเปลี่ยนแล้ว
  assert.equal(legacyStatusLabel({ source: 'web', status: 'new', note: '' }), null);
});

test('toSql: เติมอีเมล · วิธีชำระ · ยอดสุทธิ (UPDATE เฉพาะออเดอร์เว็บเดิม)', () => {
  const [a] = ordersFromDump(DUMP).orders;
  assert.equal(a!.email, 'one@example.com');
  assert.equal(a!.payment_type, 'qrcode');
  assert.equal(a!.grand_total_satang, 35000);
  assert.match(toSql([a!]), /UPDATE orders SET email = 'one@example.com', payment_type = 'qrcode', grand_total_satang = 35000 WHERE ref = '20200400001' AND source = 'old_site';/);
});
