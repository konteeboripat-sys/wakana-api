-- สถานะการอัปเดตหน้าเว็บ (มีแถวเดียว id = 1)
-- requested_at = มีการแก้สินค้าที่ยังไม่ขึ้นเว็บ · triggered_at = สั่ง build ล่าสุด
-- cron ทุกนาทีสั่ง build ถ้า requested_at > triggered_at (แก้หลายตัวติดกัน = build รอบเดียว · ไม่สั่งซ้อนระหว่าง build)
CREATE TABLE site_publish (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  requested_at TEXT,
  triggered_at TEXT,
  last_result  TEXT,          -- 'ok' | 'failed' | NULL
  last_actor   TEXT
);
INSERT INTO site_publish (id) VALUES (1);
