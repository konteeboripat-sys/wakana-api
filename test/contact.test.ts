import assert from 'node:assert/strict';
import test from 'node:test';
import { MIN_FILL_MS, validateContact } from '../src/contact.ts';

const base = { subject: 'สั่งอาหารจัดเลี้ยง', name: 'สมชาย ใจดี', company: '', tel: '081-234-5678', email: '', detail: 'สอบถามปาร์ตี้เซต 30 คน\nวันเสาร์นี้', elapsed: 8000 };

test('contact: ข้อมูลครบ → เก็บเป็นข้อความปกติ · ข้อความหลายบรรทัดคงไว้', () => {
  const r = validateContact({ ...base });
  assert.equal(r.ok, true);
  assert.ok(r.ok && r.message);
  assert.equal(r.ok && r.message?.spamReason, '');
  assert.equal(r.ok && r.message?.detail, 'สอบถามปาร์ตี้เซต 30 คน\nวันเสาร์นี้');
});

test('contact: honeypot มีค่า / ส่งเร็วเกิน / ไม่ส่งเวลา → ทิ้ง (ตอบเหมือนสำเร็จ)', () => {
  assert.deepEqual(validateContact({ ...base, website: 'http://spam.example' }), { ok: true, message: null, dropped: 'honeypot' });
  assert.deepEqual(validateContact({ ...base, elapsed: MIN_FILL_MS - 1 }), { ok: true, message: null, dropped: 'too_fast' });
  assert.deepEqual(validateContact({ ...base, elapsed: undefined }), { ok: true, message: null, dropped: 'too_fast' });
});

test('contact: มีลิงก์ → เก็บแต่เป็นสแปม (ไม่ทิ้ง)', () => {
  const inDetail = validateContact({ ...base, detail: 'Get backlinks https://monkeydigital.co/x' });
  assert.ok(inDetail.ok && inDetail.message);
  assert.match(inDetail.ok && inDetail.message ? inDetail.message.spamReason : '', /ลิงก์ในข้อความ 1/);
  const inName = validateContact({ ...base, name: 'Buy www.cheap.example' });
  assert.match(inName.ok && inName.message ? inName.message.spamReason : '', /ลิงก์ในชื่อ/);
});

test('contact: ช่องที่ขาด/ผิด · ต้องมีเบอร์หรืออีเมลอย่างน้อยหนึ่งช่อง', () => {
  const r = validateContact({ ...base, subject: ' ', name: '', detail: '', tel: '', email: '' });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(!r.ok ? r.errors : {}).sort(), ['detail', 'name', 'subject', 'tel']);
  const bad = validateContact({ ...base, email: 'not-an-email', tel: 'abc' });
  assert.deepEqual(!bad.ok && Object.keys(bad.errors).sort(), ['email', 'tel']);
  const long = validateContact({ ...base, detail: 'ก'.repeat(2001) });
  assert.equal(!long.ok && long.errors.detail, 'ยาวเกิน 2000 ตัวอักษร');
  assert.equal(validateContact({ ...base, subject: 123 }).ok, false);
});

test('contact: ตัดอักขระควบคุม/ช่องว่างซ้ำในช่องบรรทัดเดียว', () => {
  const r = validateContact({ ...base, name: '  สมชาย\t\u0000  ใจดี  ' });
  assert.equal(r.ok && r.message?.name, 'สมชาย ใจดี');
});
