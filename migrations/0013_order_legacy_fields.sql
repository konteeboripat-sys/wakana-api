-- ช่องจากเว็บเดิมที่หน้ารายการออเดอร์แสดง (เหมือน back/orderList.php: Customer Name + อีเมล · Payment type · Total amt)
-- ออเดอร์จากเว็บใหม่ไม่เก็บอีเมล/วิธีชำระ (ตกลงทางแชท LINE) ⇒ ค่าว่าง · ยอดสุทธิไม่รู้ (ค่าส่งยืนยันทีหลัง) ⇒ NULL = ใช้ total_satang
ALTER TABLE orders ADD COLUMN email TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN payment_type TEXT NOT NULL DEFAULT '';
-- ยอดสุทธิ (ค่าสินค้า − ส่วนลด + ค่าส่ง) เป็นสตางค์
ALTER TABLE orders ADD COLUMN grand_total_satang INTEGER;
