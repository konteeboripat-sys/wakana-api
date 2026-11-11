import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildXlsx, columnName, crc32, zipStore } from '../src/xlsx.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

test('crc32 / columnName', () => {
  assert.equal(crc32(enc.encode('123456789')), 0xcbf43926);
  assert.deepEqual([0, 25, 26, 27, 701, 702].map(columnName), ['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
});

test('zipStore: หัว PK · จำนวนไฟล์ใน end record · เนื้อไฟล์ไม่บีบอัด', () => {
  const zip = zipStore([
    { name: 'a.txt', data: enc.encode('hello') },
    { name: 'ไทย.txt', data: enc.encode('สวัสดี') },
  ]);
  assert.deepEqual([...zip.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const end = new DataView(zip.buffer, zip.length - 22);
  assert.equal(end.getUint32(0, true), 0x06054b50);
  assert.equal(end.getUint16(10, true), 2);
  assert.ok(dec.decode(zip).includes('สวัสดี'));
});

test('buildXlsx: หัวตัวหนา · ข้อความ escape · เบอร์เป็นข้อความ (ไม่เสีย 0) · ตัวเลขเป็น number', () => {
  const text = dec.decode(buildXlsx('Customer', [['Name', 'Tel', 'Total'], ['A & <B>', '081-234-5678', 1250], ['ไทย', '0812345678', null]], [20, 16, 10]));
  assert.match(text, /<c r="A1" t="inlineStr" s="1">/);
  assert.match(text, /A &amp; &lt;B&gt;/);
  assert.match(text, /<c r="B3" t="inlineStr"><is><t xml:space="preserve">0812345678<\/t>/);
  assert.match(text, /<c r="C2"><v>1250<\/v><\/c>/);
  assert.doesNotMatch(text, /r="C3"/); // ช่องว่างไม่สร้าง cell
  assert.match(text, /<sheet name="Customer"/);
  assert.match(text, /<col min="1" max="1" width="20" customWidth="1"\/>/);
});
