// ฟอร์มติดต่อบนเว็บ (/contactus → POST /contact) — ตรวจข้อมูล + คัดสแปม (ฟังก์ชันล้วน เทสได้)
// ช่องตามตาราง contactus ของเว็บเดิม: หัวข้อ · ชื่อ · บริษัท · เบอร์ · อีเมล · ข้อความ (รวมชื่อ-นามสกุลเป็นช่องเดียว)
//
// กันสแปม (เว็บเดิมได้แต่สแปม 100%):
//   1) honeypot: ช่อง website ซ่อนจากคน — มีค่า = บอท → ไม่เก็บ (ตอบเหมือนสำเร็จ ไม่บอกบอทว่าโดนจับ)
//   2) เวลากรอก: ส่งเร็วกว่า MIN_FILL_MS นับจากเปิดฟอร์ม = บอท → ไม่เก็บ
//   3) rate limit ต่อ IP (CONTACT_LIMITER ใน api.ts)
//   4) ลิงก์ในข้อความ/ชื่อ = สแปมขายของ → เก็บแต่ตั้ง status spam (พนักงานย้ายกลับได้ ไม่ทิ้งข้อความจริงที่บังเอิญมีลิงก์)

export const MIN_FILL_MS = 3000;

const LIMITS = { subject: 100, name: 100, company: 100, tel: 20, email: 100, detail: 2000 } as const;
type Field = keyof typeof LIMITS;

export const CONTACT_FIELD_LABELS: Record<Field, string> = {
  subject: 'หัวข้อ',
  name: 'ชื่อ',
  company: 'บริษัท',
  tel: 'เบอร์โทร',
  email: 'อีเมล',
  detail: 'ข้อความ',
};

export interface ContactMessage {
  subject: string;
  name: string;
  company: string;
  tel: string;
  email: string;
  detail: string;
  /** '' = ข้อความปกติ · อื่น = เหตุผลที่คัดเป็นสแปม */
  spamReason: string;
}

export type ContactResult =
  | { ok: true; message: ContactMessage }
  /** บอทชัด ๆ (honeypot / ส่งเร็วเกิน) — ไม่เก็บ แต่ตอบผู้ส่งเหมือนสำเร็จ */
  | { ok: true; message: null; dropped: 'honeypot' | 'too_fast' }
  | { ok: false; errors: Partial<Record<Field, string>> };

const URL_PATTERN = /(https?:\/\/|www\.)\S+/gi;
const EMAIL_PATTERN = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

/** บรรทัดเดียว: ตัดอักขระควบคุม/ช่องว่างซ้ำ · หลายบรรทัด: เก็บขึ้นบรรทัดใหม่ */
function clean(v: unknown, multiline: boolean): string | null {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return null;
  const s = multiline
    ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').replace(/\n{3,}/g, '\n\n')
    : v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s{2,}/g, ' ');
  return s.trim();
}

export function validateContact(input: Record<string, unknown>): ContactResult {
  // 1) honeypot
  if (typeof input.website === 'string' && input.website.trim() !== '') return { ok: true, message: null, dropped: 'honeypot' };
  // 2) เวลากรอก: เว็บส่ง elapsed (ms ตั้งแต่เปิดหน้า) · ไม่ส่ง/ไม่ใช่ตัวเลข = ไม่ได้มาจากฟอร์มของเรา
  const elapsed = typeof input.elapsed === 'number' && Number.isFinite(input.elapsed) ? input.elapsed : -1;
  if (elapsed < MIN_FILL_MS) return { ok: true, message: null, dropped: 'too_fast' };

  const errors: Partial<Record<Field, string>> = {};
  const values = {} as Record<Field, string>;
  for (const key of Object.keys(LIMITS) as Field[]) {
    const v = clean(input[key], key === 'detail');
    if (v === null) errors[key] = 'ข้อมูลไม่ถูกต้อง';
    else if (v.length > LIMITS[key]) errors[key] = `ยาวเกิน ${LIMITS[key]} ตัวอักษร`;
    values[key] = v ?? '';
  }
  if (!errors.subject && !values.subject) errors.subject = 'กรอกหัวข้อ';
  if (!errors.name && !values.name) errors.name = 'กรอกชื่อ';
  if (!errors.detail && !values.detail) errors.detail = 'กรอกข้อความ';
  if (!errors.email && values.email && !EMAIL_PATTERN.test(values.email)) errors.email = 'รูปแบบอีเมลไม่ถูกต้อง';
  if (!errors.tel && values.tel && !/^[0-9+\-\s()]{6,20}$/.test(values.tel)) errors.tel = 'รูปแบบเบอร์โทรไม่ถูกต้อง';
  // ต้องติดต่อกลับได้อย่างน้อยหนึ่งทาง
  if (!errors.tel && !errors.email && !values.tel && !values.email) errors.tel = 'กรอกเบอร์โทรหรืออีเมลอย่างน้อยหนึ่งช่อง';
  if (Object.keys(errors).length) return { ok: false, errors };

  // 4) ลิงก์ = สแปมขายของ (ข้อความจริงถึงร้านอาหารแทบไม่มีลิงก์ · ชื่อ/หัวข้อไม่ควรมีเลย)
  const linksInDetail = values.detail.match(URL_PATTERN)?.length ?? 0;
  const linkInHeader = URL_PATTERN.test(values.name + ' ' + values.subject + ' ' + values.company);
  URL_PATTERN.lastIndex = 0;
  const spamReason = linkInHeader ? 'ลิงก์ในชื่อ/หัวข้อ/บริษัท' : linksInDetail >= 1 ? `ลิงก์ในข้อความ ${linksInDetail} ลิงก์` : '';

  return { ok: true, message: { ...values, spamReason } };
}
