-- ออเดอร์จากเว็บ · เงินเก็บเป็นสตางค์ (INTEGER) กันทศนิยมเพี้ยน · เวลา created_at/updated_at/at = ISO UTC
-- wanted_at = เวลาไทยตามที่ลูกค้าเลือก 'YYYY-MM-DDTHH:MM' ('' = เร็วที่สุด)

CREATE TABLE orders (
  id            INTEGER PRIMARY KEY,
  ref           TEXT    NOT NULL UNIQUE,                 -- WK-XXXX-XXXX ตรงกับที่อยู่ในข้อความ LINE
  status        TEXT    NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'confirmed', 'preparing', 'done', 'cancelled')),
  method        TEXT    NOT NULL CHECK (method IN ('delivery', 'pickup')),
  customer_name TEXT    NOT NULL,
  phone         TEXT    NOT NULL,                        -- จัดรูปแล้ว เช่น 081-234-5678
  address       TEXT    NOT NULL DEFAULT '',
  location      TEXT    NOT NULL DEFAULT '',             -- 'lat,lng'
  wanted_at     TEXT    NOT NULL DEFAULT '',
  note          TEXT    NOT NULL DEFAULT '',
  item_count    INTEGER NOT NULL,
  total_satang  INTEGER NOT NULL,                        -- ยังไม่รวมค่าส่ง
  source        TEXT    NOT NULL DEFAULT 'web',
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);
CREATE INDEX orders_created        ON orders (created_at DESC);
CREATE INDEX orders_status_created ON orders (status, created_at DESC);
CREATE INDEX orders_phone          ON orders (phone);

-- ชื่อ/ราคาเก็บสำเนา ณ ตอนสั่ง — แก้เมนูทีหลังออเดอร์เก่าไม่เปลี่ยน
CREATE TABLE order_items (
  order_id          INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  line_no           INTEGER NOT NULL,
  product_id        TEXT    NOT NULL,
  name              TEXT    NOT NULL,
  category          TEXT    NOT NULL,
  unit_price_satang INTEGER NOT NULL,
  qty               INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 99),
  PRIMARY KEY (order_id, line_no)
);

-- ใครเปลี่ยนสถานะเมื่อไร (from_status NULL = ตอนสร้าง)
CREATE TABLE order_events (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT    NOT NULL,
  actor       TEXT    NOT NULL,                          -- 'web' หรืออีเมลพนักงานจาก Cloudflare Access
  at          TEXT    NOT NULL
);
CREATE INDEX order_events_order ON order_events (order_id, at);
