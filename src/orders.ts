// ตรวจออเดอร์ที่ส่งเข้า POST /orders — ฟังก์ชันล้วน ไม่แตะ D1/fetch (เทสด้วย node --test ได้)
// กติกาเดียวกับ validateOrder ใน wakana-site/src/cart/cart-core.js แต่ server ไม่เชื่อชื่อ/ราคาจากเบราว์เซอร์: คิดจาก catalog เอง

import type { Catalog } from './catalog.ts';
import { normalizePhone } from './phone.ts';
import { earliestWanted, formatThaiDateTime, parseWallTime, toWallMs } from './wall-time.ts';

export const ORDER_STATUSES = ['new', 'confirmed', 'preparing', 'done', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'ใหม่',
  confirmed: 'ยืนยันแล้ว',
  preparing: 'กำลังเตรียม',
  done: 'เสร็จสิ้น',
  cancelled: 'ยกเลิก',
};

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

export const MAX_QTY = 99;
export const MAX_LINES = 50;
const ID_PATTERN = /^[A-Za-z0-9._\/-]{1,120}$/;
const LOCATION_PATTERN = /^-?\d{1,2}\.\d+,-?\d{1,3}\.\d+$/;
const FIELD_LIMITS = { name: 80, phone: 20, address: 300, location: 40, wantedAt: 16, note: 200 } as const;
// ตัดอักขระควบคุม (เก็บขึ้นบรรทัดใหม่ไว้ในที่อยู่/หมายเหตุ)
const CONTROL_CHARS = /[\u0000-\u0009\u000B-\u001F\u007F]/g;

// ---------- เลขออเดอร์ ----------
// สร้างได้ทั้งฝั่งเว็บ (ใส่ในข้อความ LINE แล้วยิง API แบบไม่ต้องรอ) และฝั่ง server (ถ้าไม่ส่งมา)
// ตัดตัวที่อ่านสับสน (0/O 1/I/L U) · 30^8 ≈ 6.5 แสนล้านแบบ
const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const REF_PATTERN = /^WK-[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/;

export function newOrderRef(randomBytes: (n: number) => Uint8Array): string {
  const bytes = randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += REF_ALPHABET[(bytes[i] ?? 0) % REF_ALPHABET.length];
  return `WK-${s.slice(0, 4)}-${s.slice(4)}`;
}

export function isOrderRef(value: unknown): value is string {
  return typeof value === 'string' && REF_PATTERN.test(value);
}

// ---------- ตรวจออเดอร์ ----------

export interface OrderRules {
  serviceOpen: number; // นาทีของวัน
  serviceClose: number;
  partyCategory: string;
  partyLeadMinutes: number;
  /** เผื่อเวลาเดินทางของคำขอ: เว็บตรวจตอนกด server ตรวจทีหลัง (ปัดทีละ 5 นาทีอาจข้ามรอบพอดี) */
  graceMinutes: number;
}

export interface OrderLine {
  productId: string;
  name: string;
  category: string;
  unitPriceSatang: number;
  qty: number;
}

export interface ValidOrder {
  ref: string;
  method: 'delivery' | 'pickup';
  name: string;
  phone: string;
  address: string;
  location: string;
  wantedAt: string;
  note: string;
  lines: OrderLine[];
  itemCount: number;
  totalSatang: number;
}

export type OrderResult = { ok: true; order: ValidOrder } | { ok: false; errors: Record<string, string> };

export const toSatang = (baht: number) => Math.round(baht * 100);

function readText(form: Record<string, unknown>, key: keyof typeof FIELD_LIMITS, errors: Record<string, string>): string {
  const raw = form[key];
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') {
    errors[key] = 'ต้องเป็นข้อความ';
    return '';
  }
  const value = raw.replace(CONTROL_CHARS, '').trim();
  if (value.length > FIELD_LIMITS[key]) errors[key] = `ยาวเกิน ${FIELD_LIMITS[key]} ตัวอักษร`;
  return value;
}

/** input = body ของ POST /orders: { ref, items: [{ id, qty }], form: { method, name, phone, address, location, wantedAt, note } } */
export function validateOrder(input: unknown, catalog: Catalog, rules: OrderRules, nowUtcMs: number): OrderResult {
  const errors: Record<string, string> = {};
  const body = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  const ref = body.ref;
  if (!isOrderRef(ref)) errors.ref = 'เลขออเดอร์ไม่ถูกต้อง';

  // รายการสินค้า
  const lines: OrderLine[] = [];
  if (!Array.isArray(body.items) || body.items.length === 0) errors.items = 'ยังไม่มีสินค้าในตะกร้า';
  else if (body.items.length > MAX_LINES) errors.items = `สั่งได้ไม่เกิน ${MAX_LINES} รายการต่อออเดอร์`;
  else {
    const seen = new Set<string>();
    for (const item of body.items as unknown[]) {
      const { id, qty } = (item && typeof item === 'object' ? item : {}) as { id?: unknown; qty?: unknown };
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
        errors.items = 'รหัสสินค้าไม่ถูกต้อง';
        break;
      }
      if (seen.has(id)) {
        errors.items = `สินค้า ${id} ซ้ำ`;
        break;
      }
      seen.add(id);
      if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
        errors.items = `จำนวนของ ${id} ต้องเป็น 1–${MAX_QTY}`;
        break;
      }
      const product = catalog.get(id);
      if (!product) {
        errors.items = `ไม่พบสินค้า ${id} (อาจเลิกขายแล้ว)`;
        break;
      }
      lines.push({ productId: id, name: product.name, category: product.category, unitPriceSatang: toSatang(product.price), qty });
    }
  }

  // ข้อมูลผู้สั่ง
  const form = body.form && typeof body.form === 'object' ? (body.form as Record<string, unknown>) : {};
  const method = form.method;
  if (method !== 'delivery' && method !== 'pickup') errors.method = 'เลือกวิธีรับอาหาร';

  const name = readText(form, 'name', errors);
  if (!name && !errors.name) errors.name = 'กรอกชื่อผู้สั่ง';

  const phoneRaw = readText(form, 'phone', errors);
  const phone = normalizePhone(phoneRaw);
  if (!errors.phone) {
    if (!phoneRaw) errors.phone = 'กรอกเบอร์โทร';
    else if (!phone) errors.phone = 'เบอร์โทรไม่ถูกต้อง เช่น 081-234-5678';
  }

  let address = readText(form, 'address', errors);
  let location = readText(form, 'location', errors);
  if (method === 'delivery') {
    if (!address && !errors.address) errors.address = 'กรอกที่อยู่จัดส่ง';
    if (location && !LOCATION_PATTERN.test(location)) errors.location = 'พิกัดไม่ถูกต้อง';
  } else {
    // รับที่ร้าน: ข้อความ LINE ก็ไม่แสดงที่อยู่ — ไม่เก็บข้อมูลที่ไม่ได้ใช้ (PDPA)
    address = '';
    location = '';
  }

  const note = readText(form, 'note', errors);

  // เวลารับ
  const wantedAt = readText(form, 'wantedAt', errors);
  const party = lines.some((l) => l.category === rules.partyCategory);
  const leadLabel = rules.partyLeadMinutes % 60 === 0 ? `${rules.partyLeadMinutes / 60} ชั่วโมง` : `${rules.partyLeadMinutes} นาที`;
  if (!errors.wantedAt) {
    if (!wantedAt) {
      if (party) errors.wantedAt = `ชุดปาร์ตี้ต้องสั่งล่วงหน้าอย่างน้อย ${leadLabel} — เลือกวัน-เวลาที่ต้องการรับ`;
    } else {
      const wanted = parseWallTime(wantedAt);
      const mod = wanted === null ? null : new Date(wanted).getUTCHours() * 60 + new Date(wanted).getUTCMinutes();
      const nowWall = toWallMs(nowUtcMs) - rules.graceMinutes * 60 * 1000;
      const earliest = earliestWanted(nowWall, party ? rules.partyLeadMinutes : 0, rules.serviceOpen, rules.serviceClose);
      if (wanted === null || mod === null) errors.wantedAt = 'วัน-เวลาไม่ถูกต้อง';
      else if (mod < rules.serviceOpen || mod > rules.serviceClose) errors.wantedAt = 'อยู่นอกเวลารับ-ส่งอาหาร';
      else if (wanted < earliest)
        errors.wantedAt = party
          ? `ชุดปาร์ตี้ต้องสั่งล่วงหน้าอย่างน้อย ${leadLabel} — เลือกได้ตั้งแต่ ${formatThaiDateTime(earliest)}`
          : `เลือกเวลาตั้งแต่ ${formatThaiDateTime(earliest)} เป็นต้นไป`;
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    order: {
      ref: ref as string,
      method: method as 'delivery' | 'pickup',
      name,
      phone: phone as string,
      address,
      location,
      wantedAt,
      note,
      lines,
      itemCount: lines.reduce((n, l) => n + l.qty, 0),
      totalSatang: lines.reduce((n, l) => n + l.unitPriceSatang * l.qty, 0),
    },
  };
}

/** 123456 สตางค์ → '1,234.56' · จำนวนเต็มไม่แสดงทศนิยม (รูปเดียวกับ formatBaht ของตะกร้า) */
export function formatBaht(satang: number): string {
  const baht = satang / 100;
  const [whole = '0', frac] = String(Math.round(baht * 100) / 100).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${(frac + '0').slice(0, 2)}` : grouped;
}
