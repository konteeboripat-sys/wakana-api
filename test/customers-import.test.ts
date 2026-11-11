import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsv, rowsFromCsv, rowsFromDump, toSql } from '../src/customers-import.ts';

// ข้อมูลสมมติทั้งหมด (ไม่ใช่ลูกค้าจริง)

test('rowsFromDump: อีเมล = รหัสเดิม · ชื่อเต็ม · มือถือก่อนเบอร์บ้าน · ไม่เอารหัสผ่าน · ซ้ำ = ข้าม', () => {
  const dump = `INSERT INTO \`customer\` (\`customer_id\`, \`customer_password\`, \`customer_fname\`, \`customer_lname\`, \`customer_company\`, \`customer_mobile\`, \`customer_phone\`, \`register_date\`) VALUES
('one@example.com', 'secret-hash', 'ทดสอบ', 'หนึ่ง', NULL, '0812345678', NULL, '2020-04-19 21:26:04'),
('two@example', 'x', 'Two', NULL, 'ACME', NULL, '021234567', '2021-01-02 03:04:05'),
('ONE@example.com', 'x', 'dup', NULL, NULL, NULL, NULL, '2022-01-01 00:00:00');`;
  const { rows, skipped } = rowsFromDump(dump);
  assert.deepEqual(rows, [
    { old_id: 'one@example.com', name: 'ทดสอบ หนึ่ง', email: 'one@example.com', tel: '081-234-5678', company: '', register_date: '2020-04-19 21:26:04' },
    { old_id: 'two@example', name: 'Two', email: 'two@example', tel: '02-123-4567', company: 'ACME', register_date: '2021-01-02 03:04:05' },
  ]);
  assert.equal(skipped.length, 1);
  assert.doesNotMatch(toSql(rows, '2026-10-16T00:00:00Z'), /secret-hash/);
});

test('parseCsv: เครื่องหมายคำพูด · "" · ขึ้นบรรทัดในช่อง · CRLF · BOM', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n"line1\nline2",z\n'), [
    ['a', 'b'],
    ['x, y', 'say "hi"'],
    ['line1\nline2', 'z'],
  ]);
});

test('rowsFromCsv: หัวคอลัมน์หลายชื่อ · วันที่หลายรูป · ข้ามแถวเสีย · รหัสซ้ำ', () => {
  const csv = [
    'ID,Name,E-mail,Phone,Company,created_at',
    '1,ทดสอบ หนึ่ง,one@example.com,0800000001,,2024-03-23 04:25:04',
    '2,Test Two,two@example.com,,ACME,2024-03-01',
    '3,,x@example.com,,,2024-03-01 00:00:00',
    '4,ไม่มีวันที่,,,,1969-12-31',
    '1,ซ้ำ,,,,2024-03-02 00:00:00',
  ].join('\n');
  const { rows, skipped } = rowsFromCsv(csv);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { old_id: '1', name: 'ทดสอบ หนึ่ง', email: 'one@example.com', tel: '0800000001', company: '', register_date: '2024-03-23 04:25:04' });
  assert.equal(rows[1]?.register_date, '2024-03-01 00:00:00');
  assert.deepEqual(skipped.map((s) => s.line), [4, 5, 6]);
  assert.throws(() => rowsFromCsv('foo,bar\n1,2'), /name และ register_date/);
});

test("toSql: escape ' · INSERT OR IGNORE · แบ่งทีละ 100", () => {
  const row = { old_id: null, name: "O'Brien'); DROP TABLE customers;--", email: '', tel: '', company: '', register_date: '2024-01-01 00:00:00' };
  const sql = toSql([row], '2026-10-06T00:00:00.000Z');
  assert.match(sql, /^INSERT OR IGNORE INTO customers/);
  assert.ok(sql.includes("'O''Brien''); DROP TABLE customers;--'"));
  assert.ok(sql.includes('(NULL, '));
  assert.equal(toSql(Array.from({ length: 250 }, () => row), 'x').match(/INSERT OR IGNORE/g)?.length, 3);
});
