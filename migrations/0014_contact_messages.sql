-- ข้อความจากฟอร์มติดต่อบนเว็บ (/contactus) — แทนตาราง contactus ของเว็บเดิม (ไม่นำเข้าของเดิม: 9 ข้อความ ปี 2019 เป็นสแปมทั้งหมด)
-- status: new = ยังไม่ได้ดู · done = ตอบ/จัดการแล้ว · spam = ระบบหรือพนักงานคัดเป็นสแปม (เก็บไว้ ไม่ลบ กันพลาดข้อความจริง)
CREATE TABLE contact_messages (
  id          INTEGER PRIMARY KEY,
  subject     TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  company     TEXT    NOT NULL DEFAULT '',
  tel         TEXT    NOT NULL DEFAULT '',
  email       TEXT    NOT NULL DEFAULT '',
  detail      TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done', 'spam')),
  spam_reason TEXT    NOT NULL DEFAULT '',
  handled_by  TEXT    NOT NULL DEFAULT '',
  handled_at  TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL
);
CREATE INDEX contact_status_created ON contact_messages (status, created_at DESC);
