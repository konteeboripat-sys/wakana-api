import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffStore, parseStoreForm } from '../src/stores.ts';

test('parseStoreForm: ถูก · ค่าเริ่ม Disable · ช่องที่ขาด', () => {
  const r = parseStoreForm({ name_th: ' สาขา ฟู้ดโปรมาร์ท พระราม 3 ', name_en: 'WAKANA Rama3' });
  assert.ok(r.ok);
  assert.deepEqual(r.value, { name_th: 'สาขา ฟู้ดโปรมาร์ท พระราม 3', name_en: 'WAKANA Rama3', enabled: 0 });
  const on = parseStoreForm({ name_th: 'a', name_en: 'b', enabled: '1' });
  assert.ok(on.ok && on.value.enabled === 1);
  const bad = parseStoreForm({ name_th: '', name_en: ' ' });
  assert.ok(!bad.ok);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['name_en', 'name_th']);
  assert.ok(!parseStoreForm({ name_th: 'ก'.repeat(201), name_en: 'x' }).ok);
});

test('diffStore', () => {
  const s = { name_th: 'a', name_en: 'b', enabled: 0 as const };
  assert.deepEqual(diffStore(s, { ...s, enabled: 1 }), { enabled: [0, 1] });
  assert.deepEqual(diffStore(s, { ...s }), {});
});
