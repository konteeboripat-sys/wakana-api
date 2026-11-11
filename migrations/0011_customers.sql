-- สมาชิก (แทนหน้า Customer ของเว็บเดิม) · คอลัมน์ตามหน้าเดิม: Name · Email · Tel · Company · register_date
-- ⚠ ข้อมูลส่วนบุคคล — ตารางนี้ว่างจนกว่าจะนำเข้าข้อมูลสมาชิกเว็บเดิม หลัง IT/ฝ่ายกฎหมายอนุมัติ (ดู README "นำเข้าสมาชิกเว็บเดิม")
-- เว็บใหม่ไม่มีสมัครสมาชิก ⇒ ไม่มีช่องทางเพิ่มแถวจากหน้าเว็บ
CREATE TABLE customers (
  id            INTEGER PRIMARY KEY,
  old_id        TEXT,                              -- รหัสในฐานข้อมูลเว็บเดิม (ถ้ามี) กันนำเข้าซ้ำ
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL DEFAULT '',
  tel           TEXT    NOT NULL DEFAULT '',
  company       TEXT    NOT NULL DEFAULT '',
  register_date TEXT    NOT NULL,                  -- 'YYYY-MM-DD HH:MM:SS' ตามเว็บเดิม (เวลาไทย)
  source        TEXT    NOT NULL DEFAULT 'old_site' CHECK (source IN ('old_site')),
  imported_at   TEXT    NOT NULL,
  UNIQUE (old_id)
);
CREATE INDEX customers_register ON customers (register_date DESC);
CREATE INDEX customers_email ON customers (email);
CREATE INDEX customers_tel ON customers (tel);
