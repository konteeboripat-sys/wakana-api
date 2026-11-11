-- สินค้า (แทน productList.php / editProduct.php ของเว็บเดิม)
-- id = รหัสสินค้าเดิมจากฐานข้อมูล PHP — ตรงกับ data-wakana-product ในหน้าเว็บและ id ในตะกร้า ห้ามเปลี่ยน
-- ช่วงที่หน้าเว็บยังไม่อ่านจากตารางนี้ (PRICE_SOURCE = catalog) แก้ที่นี่ยังไม่มีผลกับเว็บ/ราคาออเดอร์

CREATE TABLE products (
  id               INTEGER PRIMARY KEY,
  name_th          TEXT    NOT NULL,
  name_en          TEXT    NOT NULL DEFAULT '',
  category         TEXT    NOT NULL,                     -- slug หมวด เช่น party-set
  slug             TEXT    NOT NULL,                     -- หน้าเว็บ /menu/<category>/<slug>
  price_satang     INTEGER NOT NULL CHECK (price_satang > 0),
  image            TEXT    NOT NULL DEFAULT '',          -- path บนเว็บ เช่น /images/products/x.jpg
  description      TEXT    NOT NULL DEFAULT '',
  show_on_homepage INTEGER NOT NULL DEFAULT 0 CHECK (show_on_homepage IN (0, 1)),
  enabled          INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL,
  UNIQUE (category, slug)
);
CREATE INDEX products_category ON products (category, sort_order, id);

-- ใครแก้อะไรเมื่อไร · changes = JSON {"ช่อง": [ค่าเดิม, ค่าใหม่]}
CREATE TABLE product_events (
  id         INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  action     TEXT    NOT NULL CHECK (action IN ('import', 'create', 'update')),
  changes    TEXT    NOT NULL DEFAULT '{}',
  actor      TEXT    NOT NULL,
  at         TEXT    NOT NULL
);
CREATE INDEX product_events_product ON product_events (product_id, at);
