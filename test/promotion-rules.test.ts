import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffRule, parseRuleForm } from '../src/promotion-rules.ts';

test('parseRuleForm: ถูก · สินค้าไม่ซ้ำและเรียง · ค่าเริ่ม Disable / แถม 0', () => {
  const r = parseRuleForm({ name: ' Salmon M 20% ', type: 'discount', buy_quantity: '1', get_free_quantity: '' }, ['12', '5', '12']);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  assert.deepEqual(r.value, { name: 'Salmon M 20%', enabled: 0, promotion_id: null, type: 'discount', buy_quantity: 1, get_free_quantity: 0, product_ids: [5, 12] });
  const linked = parseRuleForm({ name: 'x', buy_quantity: '1', promotion_id: '67' }, ['1']);
  assert.ok(linked.ok && linked.value.promotion_id === 67);
  assert.ok(!parseRuleForm({ name: 'x', buy_quantity: '1', promotion_id: '6 7' }, ['1']).ok);
  const noType = parseRuleForm({ name: 'x', type: '', buy_quantity: '2', get_free_quantity: '1', enabled: '1' }, ['1']);
  assert.ok(noType.ok && noType.value.type === null && noType.value.enabled === 1);
});

test('parseRuleForm: ช่องที่ผิด', () => {
  const r = parseRuleForm({ name: '', type: 'bogus', buy_quantity: '0', get_free_quantity: '-1' }, []);
  assert.ok(!r.ok);
  assert.deepEqual(Object.keys(r.errors).sort(), ['buy_quantity', 'get_free_quantity', 'name', 'product_ids', 'type']);
  assert.ok(!parseRuleForm({ name: 'x', buy_quantity: '1' }, ['1 OR 1=1']).ok);
  assert.ok(!parseRuleForm({ name: 'x', buy_quantity: '1000' }, ['1']).ok);
});

test('diffRule: สินค้าเก็บเป็นเพิ่ม/เอาออก', () => {
  const before = { name: 'a', enabled: 0 as const, promotion_id: null, type: null, buy_quantity: 1, get_free_quantity: 0, product_ids: [1, 2, 3] };
  assert.deepEqual(diffRule(before, { ...before, enabled: 1, product_ids: [2, 3, 4] }), { enabled: [0, 1], product_ids: { added: [4], removed: [1] } });
  assert.deepEqual(diffRule(before, { ...before }), {});
});
