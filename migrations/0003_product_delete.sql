-- ลบสินค้า = ย้ายไปถังขยะ (deleted_at) ไม่ลบแถวจริง
-- เหตุผล: ลบจริงแล้ว "นำเข้าจากเว็บ" จะดึงกลับมาใหม่ (เว็บยังมีสินค้านั้น) และประวัติจะหายตาม ON DELETE CASCADE
ALTER TABLE products ADD COLUMN deleted_at TEXT;

-- เพิ่ม action 'delete' / 'restore' — SQLite แก้ CHECK เดิมไม่ได้ ต้องสร้างตารางใหม่แล้วย้ายข้อมูล
CREATE TABLE product_events_new (
  id         INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  action     TEXT    NOT NULL CHECK (action IN ('import', 'create', 'update', 'delete', 'restore')),
  changes    TEXT    NOT NULL DEFAULT '{}',
  actor      TEXT    NOT NULL,
  at         TEXT    NOT NULL
);
INSERT INTO product_events_new (id, product_id, action, changes, actor, at)
  SELECT id, product_id, action, changes, actor, at FROM product_events;
DROP TABLE product_events;
ALTER TABLE product_events_new RENAME TO product_events;
CREATE INDEX product_events_product ON product_events (product_id, at);
