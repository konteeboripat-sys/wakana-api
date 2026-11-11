-- ลบโปรโมชัน = ย้ายไปถังขยะ (deleted_at) · สินค้าที่ผูกอยู่ถูกปลดเป็น "ไม่ร่วมโปรโมชั่น" ตอนลบ
ALTER TABLE promotions ADD COLUMN deleted_at TEXT;

-- เพิ่ม action 'delete' / 'restore' — SQLite แก้ CHECK เดิมไม่ได้ ต้องสร้างตารางใหม่แล้วย้ายข้อมูล
CREATE TABLE promotion_events_new (
  id           INTEGER PRIMARY KEY,
  promotion_id INTEGER NOT NULL REFERENCES promotions (id) ON DELETE CASCADE,
  action       TEXT    NOT NULL CHECK (action IN ('create', 'update', 'delete', 'restore')),
  changes      TEXT    NOT NULL DEFAULT '{}',
  actor        TEXT    NOT NULL,
  at           TEXT    NOT NULL
);
INSERT INTO promotion_events_new (id, promotion_id, action, changes, actor, at)
  SELECT id, promotion_id, action, changes, actor, at FROM promotion_events;
DROP TABLE promotion_events;
ALTER TABLE promotion_events_new RENAME TO promotion_events;
CREATE INDEX promotion_events_promotion ON promotion_events (promotion_id, at);
