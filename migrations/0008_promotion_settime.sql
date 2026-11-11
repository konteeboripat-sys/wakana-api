-- Promotion Settime = โปรโมชันที่กำหนดช่วงเวลาในแต่ละวันได้ (เช่น Happy Hour)
-- เว็บเดิม: ใช้รหัสโปรชุดเดียวกับหน้า Promotion แต่แสดงแยกหน้า (#66 #67 ไม่อยู่ในหน้า Promotion)
ALTER TABLE promotions ADD COLUMN kind TEXT NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal', 'settime'));
ALTER TABLE promotions ADD COLUMN start_time TEXT NOT NULL DEFAULT '00:00:00';   -- 'HH:MM:SS' เวลาไทย
ALTER TABLE promotions ADD COLUMN end_time   TEXT NOT NULL DEFAULT '00:00:00';   -- 00:00:00–00:00:00 = ทั้งวัน

-- หน้า Settime แสดง "Promotion Rule Name" ของโปรที่เลือก ⇒ กติกาผูกกับโปรได้ (ไม่บังคับ)
ALTER TABLE promotion_rules ADD COLUMN promotion_id INTEGER REFERENCES promotions (id);
CREATE INDEX promotion_rules_promotion ON promotion_rules (promotion_id);
