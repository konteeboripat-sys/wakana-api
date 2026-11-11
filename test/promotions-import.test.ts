import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promotionsFromDump, toSql } from '../src/promotions-import.ts';

// ข้อมูลสมมติ · รูปแบบเดียวกับ dump ของ phpMyAdmin (เฉพาะคอลัมน์ที่ใช้ + คอลัมน์อื่นบางส่วน)
const DUMP = `
INSERT INTO \`tb_promotion\` (\`promotion_id\`, \`promotion_type_id\`, \`promotion_name\`, \`promotion_enable\`, \`startDate\`, \`endDate\`, \`last_update\`, \`startTime\`, \`endTime\`) VALUES
(1, 1, 'Best Seller', 1, '2020-11-20', '2020-11-20', '2020-11-19 10:29:57', NULL, NULL),
(5, 1, 'Flash Sale ซื้อ 2 แถม 1', 0, '2023-07-10', '2023-07-14', '2023-07-01 08:00:00', NULL, NULL),
(49, 1, 'ใหม่ ซูชิมินิเซต 100 บาท', 0, '1969-12-31', '2024-03-31', '2024-02-15 09:00:00', NULL, NULL),
(66, 11, 'Lunch Set', 0, '2024-01-04', '2024-01-31', '2024-01-03 12:00:00', '11:00:00', '14:00:00'),
(69, 12, 'Monday Special', 0, '2024-01-15', '2024-01-29', '2024-01-10 12:00:00', NULL, NULL),
(70, 1, 'O\\'Brien', 0, '2024-02-17', '2024-02-07', '2024-02-01 12:00:00', NULL, NULL);
`;

test('promotionsFromDump: เลขเดิม · Enable · ประเภท Settime/Monday · เวลา', () => {
  const { promotions, skipped } = promotionsFromDump(DUMP);
  assert.deepEqual(skipped, []);
  assert.deepEqual(
    promotions.map((p) => [p.id, p.enabled, p.kind]),
    [
      [1, 1, 'normal'],
      [5, 0, 'normal'],
      [49, 0, 'normal'],
      [66, 0, 'settime'],
      [69, 0, 'monday'],
      [70, 0, 'normal'],
    ]
  );
  const settime = promotions.find((p) => p.id === 66)!;
  assert.equal(settime.start_time, '11:00:00');
  assert.equal(settime.end_time, '14:00:00');
  assert.equal(promotions[0]!.updated_at, '2020-11-19T03:29:57.000Z');
});

test('promotionsFromDump: วันเริ่ม 1969-12-31 → วันที่แก้ล่าสุด · หมดก่อนเริ่ม → ใช้วันเริ่ม', () => {
  const { promotions, adjusted } = promotionsFromDump(DUMP);
  const p49 = promotions.find((p) => p.id === 49)!;
  assert.equal(p49.start_date, '2024-02-15');
  assert.equal(p49.end_date, '2024-03-31');
  const p70 = promotions.find((p) => p.id === 70)!;
  assert.equal(p70.end_date, p70.start_date);
  assert.deepEqual(adjusted.map((a) => a.id), [49, 70]);
});

test('toSql: INSERT OR IGNORE ตามเลขเดิม · escape · event ไม่ซ้ำ', () => {
  const sql = toSql(promotionsFromDump(DUMP).promotions);
  assert.match(sql, /INSERT OR IGNORE INTO promotions \(id, .*\) VALUES \(70, 'O''Brien', 0, 'normal'/);
  assert.match(sql, /VALUES \(66, 'Lunch Set', 0, 'settime', '2024-01-04', '2024-01-31', '11:00:00', '14:00:00'/);
  assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM promotion_events WHERE promotion_id = 1 AND actor = /);
});
