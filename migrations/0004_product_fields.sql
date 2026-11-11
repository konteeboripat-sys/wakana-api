-- ช่องให้ครบตามหน้า back/addProduct.php ของเว็บเดิม
-- ราคาโปร / Time price / Promotion / ส่งฟรี: เก็บค่าไว้ แต่ตะกร้าและการคิดราคายังไม่ใช้ (ใช้ราคาปกติเสมอ) — ต้องออกแบบโปรโมชันก่อน

ALTER TABLE products RENAME COLUMN description TO long_desc_th;   -- คำอธิบายเดิม = รายละเอียดภาษาไทย
ALTER TABLE products ADD COLUMN code_number TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN short_desc_th TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN short_desc_en TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN long_desc_en TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN sale_price_satang INTEGER;            -- NULL = เท่าราคาปกติ
ALTER TABLE products ADD COLUMN time_price_satang INTEGER;            -- NULL = ไม่มี
ALTER TABLE products ADD COLUMN thumbnail TEXT NOT NULL DEFAULT '';   -- รูปเล็ก 200x200 (image = รูปใหญ่ 500x500)
ALTER TABLE products ADD COLUMN promotion INTEGER NOT NULL DEFAULT 0 CHECK (promotion IN (0, 1));
ALTER TABLE products ADD COLUMN free_delivery INTEGER NOT NULL DEFAULT 0 CHECK (free_delivery IN (0, 1));
ALTER TABLE products ADD COLUMN seo_title TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN seo_keywords TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN seo_description TEXT NOT NULL DEFAULT '';
