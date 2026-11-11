import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCatalogScript } from '../src/catalog.ts';
import {
  diffProduct,
  EMPTY_PRODUCT,
  importRowsFromCatalog,
  inactivePromoFields,
  codeForId,
  parsePriceToSatang,
  parseProductForm,
  webDifferences,
  type ProductRow,
} from '../src/products.ts';

const form = (over: Record<string, string | undefined> = {}) => ({
  name_th: 'แซลมอนฟลาวเวอร์',
  name_en: 'Salmon Flower',
  category: 'party-set',
  slug: 'salmon-flower',
  price: '1,400',
  image: '/images/products/salmon-flower.jpg',
  description: '',
  sort_order: '',
  enabled: '1',
  ...over,
});

const row = (over: Partial<ProductRow> = {}): ProductRow => ({
  ...EMPTY_PRODUCT,
  id: 2,
  name_th: 'มินิคอมโบ ปาร์ตี้เซต',
  category: 'party-set',
  slug: 'mini-combo-party-set',
  price_satang: 80000,
  enabled: 1,
  created_at: '2026-10-06T00:00:00.000Z',
  updated_at: '2026-10-06T00:00:00.000Z',
  deleted_at: null,
  ...over,
});

test('parsePriceToSatang', () => {
  assert.equal(parsePriceToSatang('1,050'), 105000);
  assert.equal(parsePriceToSatang('35.5'), 3550);
  assert.equal(parsePriceToSatang('๑๒๐ บาท'), 12000);
  assert.equal(parsePriceToSatang('฿99.99'), 9999);
  for (const bad of ['', '0', '-5', '1.234', 'abc', '1e3', '100001']) assert.equal(parsePriceToSatang(bad), null, bad);
});

test('ฟอร์มถูก → ค่าพร้อมบันทึก · checkbox ไม่ติ๊ก = 0', () => {
  const r = parseProductForm(form());
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  assert.equal(r.value.price_satang, 140000);
  assert.equal(r.value.enabled, 1);
  assert.equal(r.value.show_on_homepage, 0);
  assert.equal(r.value.sort_order, 0);
});

test('ฟอร์มผิด → บอกทุกช่อง', () => {
  const r = parseProductForm({ name_th: '  ', category: 'pizza', slug: 'Salmon Flower!', price: 'ฟรี', image: 'javascript:alert(1)', sort_order: '1.5' });
  assert.ok(!r.ok);
  assert.deepEqual(Object.keys(r.errors).sort(), ['category', 'image', 'name_th', 'price_satang', 'slug', 'sort_order']);
});

test('slug: รับ - และ _ (ลิงก์เดิมของเว็บ) · ห้ามช่องว่าง/ตัวพิมพ์ใหญ่/ขีดซ้อน', () => {
  assert.ok(parseProductForm(form({ slug: 'salmon_curry_bento' })).ok);
  assert.ok(parseProductForm(form({ slug: 'SALMON-Flower' })).ok); // แปลงเป็นตัวเล็กให้
  for (const slug of ['salmon flower', '-salmon', 'salmon--flower', 'ซูชิ', '../back']) assert.ok(!parseProductForm(form({ slug })).ok, slug);
});

test('slug เว้นว่าง → ตั้งจากชื่ออังกฤษ · ไม่มีชื่ออังกฤษ → บอกให้กรอก', () => {
  const r = parseProductForm(form({ slug: '', name_en: 'Mini Sushi Party Set A!' }));
  assert.ok(r.ok);
  assert.equal(r.value.slug, 'mini-sushi-party-set-a');
  const none = parseProductForm(form({ slug: '', name_en: '' }));
  assert.ok(!none.ok && /ชื่ออังกฤษ/.test(none.errors.slug ?? ''));
  assert.ok(!parseProductForm(form({ slug: '', name_en: 'ซูชิ' })).ok);
});

test('รูป: path บนเว็บ หรือ https เท่านั้น', () => {
  assert.ok(parseProductForm(form({ image: '' })).ok);
  assert.ok(parseProductForm(form({ image: 'https://cdn.example.com/a.jpg' })).ok);
  // ชื่อไฟล์ของเว็บเดิมมีช่องว่าง/ภาษาไทย (บั๊กเดิม: แก้สินค้าเหล่านี้แล้วบันทึกไม่ได้)
  assert.ok(parseProductForm(form({ image: '/images/product/แซลมอนซาชิมิ M500x500.jpg' })).ok);
  assert.ok(parseProductForm(form({ image: '/images/product/ tanoshimi-sushi500x500.jpg' })).ok);
  for (const image of ['http://x.com/a.jpg', '//evil.com/a.jpg', 'data:image/png;base64,AAAA', '/a.jpg" onerror="x', "/a.jpg' onerror='x", '/a<script>.jpg', 'images/a.jpg', '/a\\b.jpg']) {
    assert.ok(!parseProductForm(form({ image })).ok, image);
  }
});

test('ช่องตามหน้าเดิม: ราคาโปร/Time price/Yes-No/SEO/รายละเอียดหลายบรรทัด', () => {
  const r = parseProductForm(form({ price: '500', sale_price: '450', time_price: '400', promotion_id: '3', free_delivery: '', show_on_homepage: '1', seo_title: 'ชุดปาร์ตี้', long_desc_th: 'บรรทัด 1\r\nบรรทัด 2', code_number: 'WK-001' }));
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  assert.equal(r.value.sale_price_satang, 45000);
  assert.equal(r.value.time_price_satang, 40000);
  assert.deepEqual([r.value.promotion_id, r.value.free_delivery, r.value.show_on_homepage], [3, 0, 1]);
  const none = parseProductForm(form({ promotion_id: '' }));
  assert.ok(none.ok && none.value.promotion_id === null);
  assert.ok(!parseProductForm(form({ promotion_id: '1 OR 1=1' })).ok);
  assert.equal(r.value.long_desc_th, 'บรรทัด 1\nบรรทัด 2');
  assert.equal(r.value.code_number, 'WK-001');
  assert.deepEqual(inactivePromoFields(r.value), ['ราคาโปรโมชั่น 450', 'Time price 400', 'ร่วมโปรโมชั่น']);
});

test('ราคาโปร: เว้นว่างหรือเท่าราคาปกติ = ไม่มีโปร · มากกว่าราคาปกติ = ผิด', () => {
  const same = parseProductForm(form({ price: '500', sale_price: '500' }));
  assert.ok(same.ok && same.value.sale_price_satang === null);
  const blank = parseProductForm(form({ price: '500', sale_price: '' }));
  assert.ok(blank.ok && blank.value.sale_price_satang === null && inactivePromoFields(blank.value).length === 0);
  const over = parseProductForm(form({ price: '500', sale_price: '600' }));
  assert.ok(!over.ok && over.errors.sale_price_satang);
  assert.ok(!parseProductForm(form({ time_price: 'ฟรี' })).ok);
});

test('ชื่ออังกฤษ: บังคับเฉพาะสินค้าใหม่ (ของที่นำเข้าไม่มีชื่ออังกฤษ แก้ราคาได้)', () => {
  assert.ok(!parseProductForm(form({ name_en: '' }), { isNew: true }).ok);
  assert.ok(parseProductForm(form({ name_en: '' })).ok);
});

test('diffProduct: เฉพาะช่องที่เปลี่ยน', () => {
  const before = row();
  const r = parseProductForm(form({ name_th: before.name_th, slug: before.slug, price: '850', image: '', name_en: '' }));
  assert.ok(r.ok);
  assert.deepEqual(diffProduct(before, r.value), { price_satang: [80000, 85000] });
});

test('webDifferences: เตือนเมื่อไม่ตรงกับเว็บ', () => {
  const web = { id: '2', name: 'มินิคอมโบ ปาร์ตี้เซต', price: 800, category: 'party-set', image: '', url: '/menu/party-set/mini-combo-party-set' };
  assert.deepEqual(webDifferences(row(), web), []);
  assert.deepEqual(webDifferences(row({ price_satang: 85000 }), web), ['ราคาบนเว็บ 800']);
  assert.deepEqual(webDifferences(row({ enabled: 0 }), web), ['ปิดขายแล้ว แต่เว็บยังขาย']);
  assert.deepEqual(webDifferences(row(), undefined), ['ยังไม่มีบนเว็บ']);
  assert.deepEqual(webDifferences(row({ enabled: 0 }), undefined), []);
  // ถังขยะ: เตือนเฉพาะถ้าเว็บยังขาย · ราคาไม่ตรงไม่ต้องเตือน (ไม่ได้ใช้แล้ว)
  assert.deepEqual(webDifferences(row({ deleted_at: '2026-10-06T01:00:00.000Z', price_satang: 1 }), web), ['ลบแล้ว แต่เว็บยังขาย']);
  assert.deepEqual(webDifferences(row({ deleted_at: '2026-10-06T01:00:00.000Z' }), undefined), []);
});

test('importRowsFromCatalog: รหัสเดิม + slug จากลิงก์', () => {
  const catalog = parseCatalogScript(
    'window.WAKANA_CATALOG = ' +
      JSON.stringify({
        products: {
          '2': { name: 'มินิคอมโบ', price: 800, category: 'party-set', image: '/images/a.jpg', url: '/menu/party-set/mini-combo-party-set' },
          'sushi-set/x': { name: 'ทดสอบ', price: 1, category: 'sushi-set', image: '', url: '/menu/sushi-set/x' },
        },
      }) +
      ';'
  );
  const { rows, skipped } = importRowsFromCatalog(catalog);
  assert.deepEqual(skipped, ['sushi-set/x']);
  assert.equal(rows.length, 1);
  assert.deepEqual({ id: rows[0]?.id, slug: rows[0]?.slug, price: rows[0]?.price_satang }, { id: 2, slug: 'mini-combo-party-set', price: 80000 });
});

test('codeForId: DEPS + product_id อย่างน้อย 3 หลัก (เหมือนหลังบ้านเดิม #5 = DEPS005)', () => {
  assert.equal(codeForId(1), 'DEPS001');
  assert.equal(codeForId(5), 'DEPS005');
  assert.equal(codeForId(344), 'DEPS344');
  assert.equal(codeForId(1200), 'DEPS1200');
});
