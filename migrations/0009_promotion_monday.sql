-- Promotion Monday = โปรที่ใช้ได้เฉพาะวันจันทร์ในช่วงวันที่ (เว็บเดิม: แสดงแยกหน้า เช่น #69 Monday Special)
-- ต้องเพิ่ม 'monday' ใน CHECK ของ kind — SQLite แก้ CHECK ไม่ได้ และสร้างตาราง promotions ใหม่ไม่ได้
-- (DROP TABLE จะลบ promotion_events ตาม ON DELETE CASCADE) ⇒ ย้ายค่าไปคอลัมน์ชั่วคราว แล้วสร้างคอลัมน์ kind ใหม่
ALTER TABLE promotions ADD COLUMN kind_old TEXT;
UPDATE promotions SET kind_old = kind;
ALTER TABLE promotions DROP COLUMN kind;
ALTER TABLE promotions ADD COLUMN kind TEXT NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal', 'settime', 'monday'));
UPDATE promotions SET kind = kind_old;
ALTER TABLE promotions DROP COLUMN kind_old;
