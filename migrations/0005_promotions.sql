-- โปรโมชัน (แทน back/promotion*.php ของเว็บเดิม)
-- ตอนนี้เก็บข้อมูลเท่านั้น — ตะกร้ายังไม่คิดส่วนลด · กติกาส่วนลด (Promotion Rule) ยังไม่ได้ออกแบบ

CREATE TABLE promotions (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  start_date  TEXT    NOT NULL,          -- 'YYYY-MM-DD' วันไทย
  end_date    TEXT    NOT NULL,          -- 'YYYY-MM-DD' รวมวันนี้ด้วย (Expire date)
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  CHECK (end_date >= start_date)
);
CREATE INDEX promotions_dates ON promotions (start_date, end_date);

CREATE TABLE promotion_events (
  id           INTEGER PRIMARY KEY,
  promotion_id INTEGER NOT NULL REFERENCES promotions (id) ON DELETE CASCADE,
  action       TEXT    NOT NULL CHECK (action IN ('create', 'update')),
  changes      TEXT    NOT NULL DEFAULT '{}',
  actor        TEXT    NOT NULL,
  at           TEXT    NOT NULL
);
CREATE INDEX promotion_events_promotion ON promotion_events (promotion_id, at);

-- ช่อง Promotion ในหน้าสินค้าเดิมเป็นตัวเลือกโปรโมชัน ("ไม่ร่วมโปรโมชั่น" หรือชื่อโปร) ไม่ใช่ Yes/No
ALTER TABLE products ADD COLUMN promotion_id INTEGER REFERENCES promotions (id);
ALTER TABLE products DROP COLUMN promotion;
