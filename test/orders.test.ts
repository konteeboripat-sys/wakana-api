import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCatalogScript, searchProducts } from '../src/catalog.ts';
import { html } from '../src/html.ts';
import { formatBaht, isOrderRef, newOrderRef, validateOrder, type OrderRules } from '../src/orders.ts';
import { normalizePhone } from '../src/phone.ts';
import { earliestWanted, formatWallTime, parseWallTime, thaiDayRangeIso, toWallMs } from '../src/wall-time.ts';

const catalog = parseCatalogScript(
  '// สร้างโดย build.mjs\nwindow.WAKANA_CATALOG = ' +
    JSON.stringify({
      products: {
        '101': { name: 'ซูชิมินิเซต A', price: 100, category: 'sushi-set', image: '/images/a.jpg', url: '/menu/sushi-set/a' },
        '102': { name: 'แซลมอนฟลาวเวอร์', price: 1400, category: 'party-set', image: '', url: '/menu/party-set/salmon-flower' },
        '103': { name: 'ชาเขียว', price: 35.5, category: 'beverage', image: '', url: '/menu/beverage/green-tea' },
      },
    }) +
    ';\n'
);

const rules: OrderRules = { serviceOpen: 9 * 60, serviceClose: 19 * 60, partyCategory: 'party-set', partyLeadMinutes: 120, graceMinutes: 10 };

/** เวลาไทย 'YYYY-MM-DDTHH:MM' → UTC ms (ไทย = UTC+7) */
const bkk = (s: string) => (parseWallTime(s) as number) - 7 * 3600 * 1000;
const NOW = bkk('2026-10-06T10:02');
const REF = 'WK-ABCD-2345';

const baseForm = { method: 'pickup', name: 'สมชาย', phone: '0812345678' };
const order = (over: Record<string, unknown> = {}, form: Record<string, unknown> = {}) => ({
  ref: REF,
  items: [{ id: '101', qty: 2 }],
  form: { ...baseForm, ...form },
  ...over,
});

test('เลขออเดอร์: รูปแบบ WK-XXXX-XXXX ไม่มีตัวที่อ่านสับสน', () => {
  for (let i = 0; i < 200; i++) {
    const ref = newOrderRef((n) => Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 256)));
    assert.ok(isOrderRef(ref), ref);
    assert.doesNotMatch(ref.slice(3), /[01ILOU]/);
  }
  assert.equal(isOrderRef('WK-ABCD-2345'), true);
  assert.equal(isOrderRef('WK-ABCD-1234'), false); // มี 1
  assert.equal(isOrderRef('wk-abcd-2345'), false);
  assert.equal(isOrderRef("WK-ABCD-2345' OR 1=1"), false);
});

test('ออเดอร์ปกติ: ราคาคิดจาก catalog เป็นสตางค์', () => {
  const r = validateOrder(order({ items: [{ id: '101', qty: 2 }, { id: '103', qty: 3 }] }), catalog, rules, NOW);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  assert.equal(r.order.phone, '081-234-5678');
  assert.equal(r.order.itemCount, 5);
  assert.equal(r.order.totalSatang, 2 * 10000 + 3 * 3550);
  assert.equal(r.order.lines[1]?.name, 'ชาเขียว');
});

test('ไม่เชื่อราคา/ชื่อที่เบราว์เซอร์ส่งมา', () => {
  const r = validateOrder(order({ items: [{ id: '101', qty: 1, price: 1, name: 'ของฟรี' }] }), catalog, rules, NOW);
  assert.ok(r.ok);
  assert.equal(r.order.totalSatang, 10000);
  assert.equal(r.order.lines[0]?.name, 'ซูชิมินิเซต A');
});

test('รายการสินค้าผิด → ไม่รับ', () => {
  const cases: unknown[] = [[], [{ id: '999', qty: 1 }], [{ id: '101', qty: 0 }], [{ id: '101', qty: 100 }], [{ id: '101', qty: 1.5 }], [{ id: '101', qty: '2' }], [{ id: '101', qty: 1 }, { id: '101', qty: 1 }], [{ id: '<script>', qty: 1 }], 'x'];
  for (const items of cases) {
    const r = validateOrder(order({ items }), catalog, rules, NOW);
    assert.ok(!r.ok && r.errors.items, JSON.stringify(items));
  }
  const many = Array.from({ length: 51 }, (_, i) => ({ id: String(i), qty: 1 }));
  assert.ok(!validateOrder(order({ items: many }), catalog, rules, NOW).ok);
});

test('ข้อมูลผู้สั่ง: ช่องที่ขาด/ผิด', () => {
  const r = validateOrder({ ref: 'bad', items: [{ id: '101', qty: 1 }], form: { method: 'drone', name: '  ', phone: '12345' } }, catalog, rules, NOW);
  assert.ok(!r.ok);
  assert.deepEqual(Object.keys(r.errors).sort(), ['method', 'name', 'phone', 'ref']);
});

test('จัดส่งต้องมีที่อยู่ · รับที่ร้านไม่เก็บที่อยู่/พิกัด', () => {
  const noAddr = validateOrder(order({}, { method: 'delivery' }), catalog, rules, NOW);
  assert.ok(!noAddr.ok && noAddr.errors.address);

  const badLoc = validateOrder(order({}, { method: 'delivery', address: 'บ้าน', location: 'javascript:alert(1)' }), catalog, rules, NOW);
  assert.ok(!badLoc.ok && badLoc.errors.location);

  const pickup = validateOrder(order({}, { address: '99/1 ถ.พระราม 3', location: '13.68,100.54' }), catalog, rules, NOW);
  assert.ok(pickup.ok);
  assert.equal(pickup.order.address, '');
  assert.equal(pickup.order.location, '');
});

test('ข้อความยาวเกิน/ไม่ใช่ข้อความ → ไม่รับ · อักขระควบคุมถูกตัด', () => {
  assert.ok(!validateOrder(order({}, { note: 'ก'.repeat(201) }), catalog, rules, NOW).ok);
  assert.ok(!validateOrder(order({}, { name: { $gt: '' } }), catalog, rules, NOW).ok);
  const r = validateOrder(order({}, { name: 'สม\u0000ชาย\u0007', note: 'บรรทัด1\nบรรทัด2' }), catalog, rules, NOW);
  assert.ok(r.ok);
  assert.equal(r.order.name, 'สมชาย');
  assert.equal(r.order.note, 'บรรทัด1\nบรรทัด2');
});

test('เวลารับ: ว่าง = เร็วที่สุด · นอกเวลาทำการ / ย้อนหลัง → ไม่รับ', () => {
  assert.ok(validateOrder(order(), catalog, rules, NOW).ok);
  assert.ok(validateOrder(order({}, { wantedAt: '2026-10-06T12:00' }), catalog, rules, NOW).ok);
  for (const wantedAt of ['2026-10-06T08:55', '2026-10-06T19:05', '2026-10-05T12:00', '2026-02-30T12:00', 'พรุ่งนี้']) {
    const r = validateOrder(order({}, { wantedAt }), catalog, rules, NOW);
    assert.ok(!r.ok && r.errors.wantedAt, wantedAt);
  }
});

test('ชุดปาร์ตี้: ต้องเลือกเวลา และล่วงหน้า 2 ชั่วโมง (เผื่อ 10 นาที)', () => {
  const party = { items: [{ id: '102', qty: 1 }] };
  const none = validateOrder(order(party), catalog, rules, NOW);
  assert.ok(!none.ok && /ล่วงหน้าอย่างน้อย 2 ชั่วโมง/.test(none.errors.wantedAt ?? ''));
  // 10:02 + 2 ชม. = 12:02 → เว็บให้เลือกได้ตั้งแต่ 12:05
  assert.ok(validateOrder(order(party, { wantedAt: '2026-10-06T12:05' }), catalog, rules, NOW).ok);
  // เว็บตรวจผ่านตอน 10:02 แต่คำขอมาถึงช้า 3 นาที (ข้ามรอบ 5 นาที) → ยังรับ
  assert.ok(validateOrder(order(party, { wantedAt: '2026-10-06T12:05' }), catalog, rules, NOW + 3 * 60000).ok);
  const early = validateOrder(order(party, { wantedAt: '2026-10-06T11:30' }), catalog, rules, NOW);
  assert.ok(!early.ok && /เลือกได้ตั้งแต่/.test(early.errors.wantedAt ?? ''));
});

test('earliestWanted: ปัด 5 นาที · ก่อนเปิดร้าน = เวลาเปิด · หลังปิด = พรุ่งนี้', () => {
  const at = (s: string, lead = 0) => formatWallTime(earliestWanted(parseWallTime(s) as number, lead, 540, 1140));
  assert.equal(at('2026-10-06T10:02'), '2026-10-06T10:05');
  assert.equal(at('2026-10-06T10:00'), '2026-10-06T10:00');
  assert.equal(at('2026-10-06T06:00'), '2026-10-06T09:00');
  assert.equal(at('2026-10-06T18:00', 120), '2026-10-07T09:00');
  assert.equal(at('2026-12-31T20:00'), '2027-01-01T09:00');
});

test('เวลาไทย: ช่วงวันสำหรับกรอง created_at', () => {
  assert.deepEqual(thaiDayRangeIso('2026-10-06'), { start: '2026-10-05T17:00:00.000Z', end: '2026-10-06T17:00:00.000Z' });
  assert.equal(thaiDayRangeIso('2026-13-01'), null);
  assert.equal(formatWallTime(toWallMs(Date.parse('2026-10-05T17:30:00Z'))), '2026-10-06T00:30');
});

test('normalizePhone ตรงกับตะกร้า', () => {
  assert.equal(normalizePhone('081 234 5678'), '081-234-5678');
  assert.equal(normalizePhone('+66812345678'), '081-234-5678');
  assert.equal(normalizePhone('๐๘๑๒๓๔๕๖๗๘'), '081-234-5678');
  assert.equal(normalizePhone('021234567'), '02-123-4567');
  assert.equal(normalizePhone('12345'), null);
});

test('formatBaht', () => {
  assert.equal(formatBaht(160000), '1,600');
  assert.equal(formatBaht(3550), '35.50');
  assert.equal(formatBaht(123456789), '1,234,567.89');
});

test('catalog: อ่าน catalog.js · ไฟล์เพี้ยน → throw', () => {
  assert.equal(catalog.size, 3);
  assert.equal(catalog.get('103')?.price, 35.5);
  const withConfig = parseCatalogScript(
    'window.WAKANA_CATALOG = {"products":{"1":{"name":"a;b","price":5,"category":"c"}}};\nwindow.WAKANA_CART_CONFIG = {"orderApiUrl":"https://x/orders"};\n'
  );
  assert.equal(withConfig.get('1')?.name, 'a;b');
  assert.throws(() => parseCatalogScript('<html>404</html>'));
  assert.throws(() => parseCatalogScript('window.WAKANA_CATALOG = {"products":{"1":{"name":"x","price":-5,"category":"a"}}};'));
});

test('search: ทุกคำต้องเจอ · ชื่อขึ้นต้นมาก่อน', () => {
  assert.deepEqual(searchProducts(catalog, 'ซูชิ', 10).map((p) => p.id), ['101']);
  assert.deepEqual(searchProducts(catalog, 'party', 10).map((p) => p.id), ['102']);
  assert.deepEqual(searchProducts(catalog, 'แซลมอน party', 10).map((p) => p.id), ['102']);
  assert.deepEqual(searchProducts(catalog, 'ไม่มีจริง', 10), []);
  assert.equal(searchProducts(catalog, '   ', 10).length, 0);
});

test('html: escape ค่าที่มาจากลูกค้าทุกตัว', () => {
  const name = '<img src=x onerror=alert(1)>"\'&';
  assert.equal(html`<td title="${name}">${name}</td>`.value, '<td title="&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;">&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;</td>');
  assert.equal(html`<ul>${['<a>', html`<li>ok</li>`]}</ul>`.value, '<ul>&lt;a&gt;<li>ok</li></ul>');
});
