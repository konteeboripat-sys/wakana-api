import assert from 'node:assert/strict';
import { test } from 'node:test';
import { htmlToText, legacyProductsFromDump, toSql } from '../src/products-legacy-import.ts';

// ข้อมูลสมมติ · รูปแบบเดียวกับ dump ของ phpMyAdmin (เฉพาะคอลัมน์ที่ใช้)
const DUMP = `
INSERT INTO \`category\` (\`catalog_id\`, \`catalog_url\`) VALUES
(1, 'party-set'),
(5, 'salmon-sashimi'),
(12, 'kaisendon');

INSERT INTO \`product\` (\`product_id\`, \`seq\`, \`code_number\`, \`product_name_th\`, \`product_name_en\`, \`shortdesc_th\`, \`shortdesc_en\`, \`longdesc_th\`, \`longdesc_en\`, \`product_thumbnail\`, \`product_picture\`, \`list_price\`, \`sell_price\`, \`catalog_id\`, \`product_url\`, \`feature_product\`, \`promotion_status\`, \`meta_title\`, \`meta_keyword\`, \`meta_desc\`, \`product_enable\`, \`last_update\`, \`time_price\`) VALUES
(2, 2, 'DEPS002', 'มินิคอมโบ ปาร์ตี้เซต', 'Mini Combo Party Set\t', '<p>สั้น&nbsp;A</p>', '', '<p>ยาว 1</p><p>ยาว 2</p>', '', 'a200.jpg', 'a500.jpg', 800, 800, 1, 'mini-combo-party-set', 1, 3, 'SEO', 'k', 'd', 1, '2023-09-29 20:40:10', 0),
(4, 5, 'DEPS004', 'มากิ แฟนซี', 'Maki Fancy', '', '', '', '', 'm 200.jpg', 'm 500.jpg', 1050, 950, 1, 'maki-fancy-party-set', 0, 0, '', '', '', 0, '2020-04-21 12:54:10', NULL),
(134, 1, '', 'ไม่มีลิงก์', NULL, '', '', '', '', '', '', 120, 120, 12, '', 0, 0, '', '', '', 1, '2021-01-01 00:00:00', NULL),
(200, 1, '', 'แซลมอน', NULL, '', '', '', '', '', '', 300, 300, 5, 'Salmon XS!', 0, 0, '', '', '', 0, '2021-01-01 00:00:00', 25),
(300, 1, '', 'ไม่รู้หมวด', NULL, '', '', '', '', '', '', 100, 100, 99, 'x', 0, 0, '', '', '', 0, '2021-01-01 00:00:00', NULL);
`;

test('htmlToText: ย่อหน้าเป็นบรรทัด · entity · ตัดแท็ก', () => {
  assert.equal(htmlToText('<p>ยาว 1</p><p>ยาว&nbsp;2 &amp; <b>3</b></p>'), 'ยาว 1\nยาว 2 & 3');
  assert.equal(htmlToText(null), '');
});

test('legacyProductsFromDump: หมวด · ลิงก์ · ราคาโปร · Homepage · Promotion · Time Price', () => {
  const { products, skipped } = legacyProductsFromDump(DUMP);
  assert.deepEqual(skipped, [{ id: '300', reason: 'ไม่รู้หมวด catalog_id 99' }]);
  const [p2, p4, p134, p200] = products;
  assert.equal(p2!.name_en, 'Mini Combo Party Set');
  assert.equal(p2!.show_on_homepage, 1);
  assert.equal(p2!.promotion_id, 3);
  assert.equal(p2!.time_price_satang, 0);
  assert.equal(p2!.short_desc_th, 'สั้น A');
  assert.equal(p2!.long_desc_th, 'ยาว 1\nยาว 2');
  assert.equal(p2!.image, '/images/product/a500.jpg');
  assert.equal(p4!.sale_price_satang, 95000);
  assert.equal(p4!.time_price_satang, null);
  assert.equal(p4!.old_enabled, 0);
  assert.equal(p134!.slug, 'product-134');
  assert.equal(p134!.category, 'kaisendon');
  assert.equal(p200!.category, 'sashimi');
  assert.equal(p200!.slug, 'product-200'); // ลิงก์ผิดรูป
  assert.equal(p200!.time_price_satang, 2500);
});

test('toSql: เพิ่มใหม่แบบปิดขาย · เติมเฉพาะช่องว่าง · ช่องที่มีคนแก้แล้วไม่ทับ · ไม่แตะราคา', () => {
  const sql = toSql(legacyProductsFromDump(DUMP).products, '2026-10-16T00:00:00.000Z');
  // เพิ่มใหม่: enabled = 0 เสมอ (แม้เว็บเดิมเปิดขาย) และลิงก์ซ้ำต่อท้าย -id
  assert.match(sql, /INSERT OR IGNORE INTO products .* SELECT 134, 'ไม่มีลิงก์', .* 0, 0, 1, NULL, .* WHERE NOT EXISTS \(SELECT 1 FROM products WHERE id = 134\);/);
  assert.match(sql, /THEN 'mini-combo-party-set-2' ELSE 'mini-combo-party-set' END/);
  // เติม: เฉพาะเมื่อว่าง
  assert.match(sql, /UPDATE products SET name_en = CASE WHEN name_en = '' THEN 'Mini Combo Party Set' ELSE name_en END/);
  // Homepage / Promotion: เฉพาะที่ไม่มี event แก้ช่องนั้น
  assert.match(sql, /UPDATE products SET show_on_homepage = 1 WHERE id = 2 AND NOT EXISTS \(SELECT 1 FROM product_events WHERE product_id = 2 AND changes LIKE '%"show_on_homepage"%'\);/);
  assert.match(sql, /UPDATE products SET promotion_id = \(SELECT id FROM promotions WHERE id = 3\) WHERE id = 2 AND promotion_id IS NULL/);
  // ไม่มีคำสั่ง UPDATE ที่แตะราคา/ชื่อไทย/เปิดขาย
  assert.doesNotMatch(sql, /UPDATE products SET[^;]*(?<![a-z_])(price_satang =|sale_price_satang =|name_th =|enabled =)/);
});
