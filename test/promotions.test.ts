import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffPromotion, isValidDate, normalizeTime, parsePromotionForm, promotionPeriod, timeRangeLabel } from '../src/promotions.ts';

test('Settime: ช่วงเวลา · ว่าง/00:00–00:00 = ทั้งวัน · สิ้นสุดต้องหลังเริ่ม · โปรปกติไม่เก็บเวลา', () => {
  const base = { name: 'Happy Hour', start_date: '2024-02-02', end_date: '2024-03-31' };
  const r = parsePromotionForm({ ...base, start_time: '14:00', end_time: '16:30' }, 'settime');
  assert.ok(r.ok && r.value.start_time === '14:00:00' && r.value.end_time === '16:30:00');
  assert.equal(timeRangeLabel(r.ok ? r.value : { start_time: '', end_time: '' }), '14:00–16:30 น.');
  const allDay = parsePromotionForm({ ...base, start_time: '', end_time: '' }, 'settime');
  assert.ok(allDay.ok && allDay.value.start_time === '00:00:00' && timeRangeLabel(allDay.value) === 'ทั้งวัน');
  const back = parsePromotionForm({ ...base, start_time: '16:00', end_time: '14:00' }, 'settime');
  assert.ok(!back.ok && back.errors.end_time);
  assert.ok(!parsePromotionForm({ ...base, start_time: '25:00' }, 'settime').ok);
  const normal = parsePromotionForm({ ...base, start_time: '14:00', end_time: '16:00' });
  assert.ok(normal.ok && normal.value.start_time === '00:00:00' && normal.value.end_time === '00:00:00');
  assert.equal(normalizeTime('09:05:07'), '09:05:07');
  assert.equal(normalizeTime('9:05'), null);
});

test('isValidDate: วันจริง · ไม่รับ 1969-12-31 (ค่าว่างของเว็บเดิม)', () => {
  assert.ok(isValidDate('2024-02-29'));
  for (const bad of ['2023-02-29', '1969-12-31', '2024-13-01', '24-01-01', '', '2024-01-01; DROP TABLE x']) assert.ok(!isValidDate(bad), bad);
});

test('parsePromotionForm: ถูก · Enable ค่าเริ่ม No', () => {
  const r = parsePromotionForm({ name: '  Flash Sale ซูชิเซต ซื้อ 2 แถม 1 ', start_date: '2023-07-10', end_date: '2023-07-14' });
  assert.ok(r.ok);
  assert.deepEqual(r.value, { name: 'Flash Sale ซูชิเซต ซื้อ 2 แถม 1', enabled: 0, start_date: '2023-07-10', end_date: '2023-07-14', start_time: '00:00:00', end_time: '00:00:00' });
  const on = parsePromotionForm({ name: 'x', enabled: '1', start_date: '2024-01-01', end_date: '2024-01-01' });
  assert.ok(on.ok && on.value.enabled === 1);
});

test('parsePromotionForm: ช่องที่ขาด · หมดอายุก่อนเริ่ม', () => {
  const r = parsePromotionForm({ name: '', start_date: '', end_date: 'x' });
  assert.ok(!r.ok);
  assert.deepEqual(Object.keys(r.errors).sort(), ['end_date', 'name', 'start_date']);
  const back = parsePromotionForm({ name: 'x', start_date: '2024-02-10', end_date: '2024-02-01' });
  assert.ok(!back.ok && /ไม่ก่อนวันเริ่ม/.test(back.errors.end_date ?? ''));
});

test('promotionPeriod / diffPromotion', () => {
  const p = { name: 'x', enabled: 1 as const, start_date: '2024-02-01', end_date: '2024-02-29', start_time: '00:00:00', end_time: '00:00:00' };
  assert.equal(promotionPeriod(p, '2024-01-31'), 'upcoming');
  assert.equal(promotionPeriod(p, '2024-02-29'), 'running');
  assert.equal(promotionPeriod(p, '2024-03-01'), 'ended');
  assert.deepEqual(diffPromotion(p, { ...p, enabled: 0 }), { enabled: [1, 0] });
});
