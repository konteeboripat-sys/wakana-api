import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILD_GAP_MS, hasPending, shouldTrigger, type PublishState } from '../src/publish.ts';

const at = (s: string) => new Date(s).toISOString();
const state = (over: Partial<PublishState>): PublishState => ({ requested_at: null, triggered_at: null, last_result: null, last_actor: null, ...over });
const NOW = Date.parse('2026-10-07T10:00:00Z');

test('ไม่มีการแก้ค้าง → ไม่สั่ง build', () => {
  assert.equal(shouldTrigger(state({}), NOW), false);
  assert.equal(shouldTrigger(state({ requested_at: at('2026-10-07T09:00:00Z'), triggered_at: at('2026-10-07T09:05:00Z') }), NOW), false);
});

test('มีการแก้ค้าง ไม่เคยสั่ง → สั่ง', () => {
  assert.equal(shouldTrigger(state({ requested_at: at('2026-10-07T09:59:30Z') }), NOW), true);
});

test('แก้หลังสั่งครั้งก่อน: ยังอยู่ในช่วง build → รอ (ไม่สั่งซ้อน) · พ้นช่วง → สั่ง', () => {
  const recent = state({ triggered_at: new Date(NOW - 30_000).toISOString(), requested_at: new Date(NOW - 10_000).toISOString() });
  assert.equal(hasPending(recent), true);
  assert.equal(shouldTrigger(recent, NOW), false);
  const old = state({ triggered_at: new Date(NOW - BUILD_GAP_MS).toISOString(), requested_at: new Date(NOW - 10_000).toISOString() });
  assert.equal(shouldTrigger(old, NOW), true);
});

test('แก้หลายครั้งติดกัน = ค้างอยู่รายการเดียว → build รอบเดียว', () => {
  const s = state({ triggered_at: at('2026-10-07T09:00:00Z'), requested_at: at('2026-10-07T09:59:50Z') });
  assert.equal(shouldTrigger(s, NOW), true);
  // หลัง cron สั่งแล้ว triggered_at = ตอนนี้ ⇒ นาทีถัดไปไม่สั่งซ้ำ
  assert.equal(shouldTrigger({ ...s, triggered_at: new Date(NOW).toISOString() }, NOW + 60_000), false);
});
