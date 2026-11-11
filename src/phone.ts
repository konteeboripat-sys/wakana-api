// เหมือน normalizePhone ใน wakana-site/src/cart/cart-core.js — แก้ที่หนึ่งต้องแก้อีกที่

function toArabicDigits(s: string): string {
  return s.replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50));
}

/** รับได้ทั้ง 081 234 5678 · 081-234-5678 · +66812345678 · เลขไทย · คืน null ถ้าไม่ใช่เบอร์ไทย */
export function normalizePhone(raw: string): string | null {
  let digits = toArabicDigits(raw).replace(/[\s\-().]/g, '');
  if (/^\+66/.test(digits)) digits = '0' + digits.slice(3);
  else if (/^66\d{8,9}$/.test(digits)) digits = '0' + digits.slice(2);
  if (!/^0\d{8,9}$/.test(digits)) return null;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.startsWith('02')) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}
