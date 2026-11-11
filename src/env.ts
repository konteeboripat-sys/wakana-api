/** Workers Rate Limiting binding (ประกาศเองให้สั้น — ใช้แค่ limit) */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB: D1Database;
  /** รูปที่อัปโหลดจากหลังบ้าน (product thumbnail) · ไม่มี = ยังไม่เปิด R2 (binding ปิดใน wrangler.jsonc) → ฟอร์มบอกว่าอัปโหลดไม่ได้ */
  IMAGES?: R2Bucket;
  /** ที่เก็บรูปแทน R2 (Workers KV) — media.ts ใช้ตัวนี้เมื่อไม่มี IMAGES */
  IMAGES_KV?: KVNamespace;
  ORDER_LIMITER?: RateLimiter;
  /** ฟอร์มติดต่อ (POST /contact) ต่อ IP */
  CONTACT_LIMITER?: RateLimiter;
  SITE_ORIGIN: string;
  /** ราคา/เมนูของ API และออเดอร์มาจากไหน: 'catalog' = catalog.js ของเว็บ (ค่าเริ่มต้น) · 'd1' = ตาราง products */
  PRICE_SOURCE: string;
  ALLOWED_ORIGINS: string;
  SERVICE_OPEN: string;
  SERVICE_CLOSE: string;
  PARTY_CATEGORY: string;
  PARTY_LEAD_MINUTES: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  /** .dev.vars เท่านั้น — ดู auth.ts */
  ADMIN_DEV_EMAIL?: string;
  /** secret: รหัสผ่านหลังบ้านชั่วคราวระหว่างยังไม่ตั้ง Access · ไม่ตั้ง = ปิด · ตั้ง Access แล้วไม่ใช้ */
  ADMIN_PASSWORD?: string;
  /** ชื่อผู้ใช้ที่หน้า /back/login รับ (ไม่ใช่ความลับ) · ว่าง/ไม่ตั้ง = ชื่ออะไรก็ได้ */
  ADMIN_USERNAME?: string;
  /** นับคำขอหลังบ้านที่แนบรหัสผ่าน ต่อ IP */
  ADMIN_LOGIN_LIMITER?: RateLimiter;
  /** secret: token ที่ build หน้าเว็บใช้เรียก /export/products · ไม่ตั้ง = ปิด export */
  EXPORT_TOKEN?: string;
  /** secret: deploy hook ของ wakana-site (Workers Builds) — ปุ่ม "อัปเดตหน้าเว็บ" ในหลังบ้านเรียก URL นี้ · ไม่ตั้ง = ปุ่มบอกวิธี build เอง */
  DEPLOY_HOOK_URL?: string;
}
