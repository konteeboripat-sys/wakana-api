-- สาขา (แทน back/storeLocation*.php ของเว็บเดิม) · ช่องตามหน้ารายการเดิม: store id · ชื่อไทย · ชื่ออังกฤษ · store enable
CREATE TABLE stores (
  id         INTEGER PRIMARY KEY,
  name_th    TEXT    NOT NULL,
  name_en    TEXT    NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  deleted_at TEXT
);

CREATE TABLE store_events (
  id       INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  action   TEXT    NOT NULL CHECK (action IN ('import', 'create', 'update', 'delete', 'restore')),
  changes  TEXT    NOT NULL DEFAULT '{}',
  actor    TEXT    NOT NULL,
  at       TEXT    NOT NULL
);
CREATE INDEX store_events_store ON store_events (store_id, at);

-- ข้อมูลตั้งต้น = หน้า Store Location ของเว็บเดิม (ภาพหน้าจอ 6 ต.ค. 69) · รหัสเดิม (#6 ไม่มีในเว็บเดิม)
INSERT INTO stores (id, name_th, name_en, enabled, created_at, updated_at) VALUES
  (1,  'สาขา ฟู้ดโปรมาร์ท @เอกมัย ไลฟ์สไตล์มอลล์',   'WAKANA Ekkamai',                     0, '2026-10-06T00:00:00.000Z', '2026-10-06T00:00:00.000Z'),
  (2,  'สาขา ฟู้ดโปรมาร์ท ฟู้ดวิลล่า ราชพฤกษ์',       'WAKANA Ratchaphruek',                0, '2026-10-06T00:00:00.000Z', '2026-10-06T00:00:00.000Z'),
  (3,  'สาขา ฟู้ดโปรมาร์ท พระราม 3',                 'WAKANA Rama3',                       1, '2026-10-06T00:00:00.000Z', '2026-10-06T00:00:00.000Z'),
  (4,  'สาขา ฟู้ดโปรมาร์ท สายไหม อเวนิว',             'WAKANA Saimai',                      0, '2026-10-06T00:00:00.000Z', '2026-10-06T00:00:00.000Z'),
  (5,  'สาขา ฟู้ดโปรมาร์ท เดอะ พาซิโอ พาร์ค กาญจนาภิเษก', 'WAKANA Paseo',                   0, '2026-10-06T00:00:00.000Z', '2026-10-06T00:00:00.000Z'),
  (7,  'สาขา ฟู้ดโปรมาร์ท คู้บอน',                   'WAKANA Kubon',                       0, '2026-10-06T00:00:00.000Z', '2026-10-06T00:00:00.000Z'),
  (8,  'สาขา ฟู้ดโปรมาร์ท สัมมากร เพลส รามคำแหง',     'WAKANA Sammakorn Place Ramkhamhaeng', 0, '2026-10-06T00:00:00.000Z', '2026-10-06T00:00:00.000Z'),
  (9,  'สาขา ฟู้ดโปรมาร์ท Foody Farm บางใหญ่',        'WAKANA Foody Farm',                  0, '2026-10-06T00:00:00.000Z', '2026-10-06T00:00:00.000Z'),
  (10, 'สาขา ฟู้ดโปรมาร์ท ยิ่งเจริญสแควร์',           'WAKANA Yingcharoen Square',          0, '2026-10-06T00:00:00.000Z', '2026-10-06T00:00:00.000Z');
INSERT INTO store_events (store_id, action, changes, actor, at)
  SELECT id, 'import', '{}', 'เว็บเดิม (ภาพหน้าจอ)', '2026-10-06T00:00:00.000Z' FROM stores;
