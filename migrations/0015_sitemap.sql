-- sitemap.xml ที่อัปโหลดจากหลังบ้าน /back/sitemap (มีแถวเดียว id = 1 · อัปโหลดใหม่ = ทับ · ลบ = กลับไปใช้ sitemap เดิมของเว็บ)
-- เสิร์ฟที่ GET /sitemap.xml · wakana-site (src/worker.js) ส่ง /sitemap.xml ของเว็บมาที่นี่ ไม่มีแถว = ใช้ไฟล์ static เดิม
CREATE TABLE site_sitemap (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  xml         TEXT NOT NULL,
  url_count   INTEGER NOT NULL,
  file_name   TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  uploaded_by TEXT NOT NULL
);
