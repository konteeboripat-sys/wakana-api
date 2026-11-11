-- กติกาโปรโมชัน (แทน back/promotionRule*.php ของเว็บเดิม)
-- ช่องตามคอลัมน์ในหน้ารายการเดิม: Name · Status · Type · Applies To · Buy quantity · Get free quantity
-- ตอนนี้เก็บข้อมูลเท่านั้น ตะกร้ายังไม่คิดส่วนลด/ของแถม

CREATE TABLE promotion_rules (
  id                INTEGER PRIMARY KEY,
  name              TEXT    NOT NULL,
  enabled           INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  type              TEXT    CHECK (type IS NULL OR type IN ('discount')),        -- NULL = "-" (เว็บเดิมมีแถวที่ไม่ระบุ)
  applies_to        TEXT    NOT NULL DEFAULT 'specific_products' CHECK (applies_to IN ('specific_products')),
  buy_quantity      INTEGER NOT NULL CHECK (buy_quantity BETWEEN 1 AND 999),
  get_free_quantity INTEGER NOT NULL DEFAULT 0 CHECK (get_free_quantity BETWEEN 0 AND 999),
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,
  deleted_at        TEXT
);

-- สินค้าที่กติกานี้ใช้ (Applies To = Specific product(s))
CREATE TABLE promotion_rule_products (
  rule_id    INTEGER NOT NULL REFERENCES promotion_rules (id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products (id),
  PRIMARY KEY (rule_id, product_id)
);
CREATE INDEX promotion_rule_products_product ON promotion_rule_products (product_id);

CREATE TABLE promotion_rule_events (
  id      INTEGER PRIMARY KEY,
  rule_id INTEGER NOT NULL REFERENCES promotion_rules (id) ON DELETE CASCADE,
  action  TEXT    NOT NULL CHECK (action IN ('create', 'update', 'delete', 'restore')),
  changes TEXT    NOT NULL DEFAULT '{}',
  actor   TEXT    NOT NULL,
  at      TEXT    NOT NULL
);
CREATE INDEX promotion_rule_events_rule ON promotion_rule_events (rule_id, at);
