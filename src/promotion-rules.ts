// กติกาโปรโมชัน: ตรวจฟอร์ม — ฟังก์ชันล้วน (เทสด้วย node --test ได้)

export const RULE_TYPES = { discount: 'โปรโมชั่นส่วนลดราคาสินค้า' } as const;
export type RuleType = keyof typeof RULE_TYPES;
export const APPLIES_TO_LABELS = { specific_products: 'Specific product(s).' } as const;

export interface RuleInput {
  name: string;
  enabled: 0 | 1;
  /** โปรโมชันที่กติกานี้เป็นของ (หน้า Settime แสดงกติกาของโปรที่เลือก) · null = ไม่ผูก */
  promotion_id: number | null;
  type: RuleType | null;
  buy_quantity: number;
  get_free_quantity: number;
  /** สินค้าที่ใช้กติกานี้ (ไม่ซ้ำ เรียงจากน้อยไปมาก) */
  product_ids: number[];
}

export interface RuleRow extends Omit<RuleInput, 'product_ids'> {
  id: number;
  applies_to: keyof typeof APPLIES_TO_LABELS;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const RULE_FIELD_LABELS: Record<keyof RuleInput, string> = {
  name: 'Name',
  enabled: 'Status',
  promotion_id: 'Promotion',
  type: 'Type',
  buy_quantity: 'Buy quantity',
  get_free_quantity: 'Get free quantity',
  product_ids: 'สินค้า',
};

const MAX_PRODUCTS = 500;

function quantity(raw: string | undefined, min: number): number | null {
  const s = (raw ?? '').trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n >= min ? n : null;
}

export type RuleFormResult = { ok: true; value: RuleInput } | { ok: false; errors: Partial<Record<keyof RuleInput, string>> };

/** fields = ช่องเดี่ยว · productIds = ค่าทุกตัวของ checkbox product_ids (formData.getAll) */
export function parseRuleForm(fields: Record<string, string | undefined>, productIds: string[]): RuleFormResult {
  const errors: Partial<Record<keyof RuleInput, string>> = {};
  const name = (fields.name ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!name) errors.name = 'กรอกชื่อกติกา';
  else if (name.length > 200) errors.name = 'ยาวเกิน 200 ตัวอักษร';

  const typeRaw = (fields.type ?? '').trim();
  let type: RuleType | null = null;
  if (typeRaw) {
    if (typeRaw in RULE_TYPES) type = typeRaw as RuleType;
    else errors.type = 'เลือก Type จากรายการ';
  }

  const promotionRaw = (fields.promotion_id ?? '').trim();
  const promotion_id = promotionRaw ? Number(promotionRaw) : null;
  if (promotionRaw && !/^\d{1,9}$/.test(promotionRaw)) errors.promotion_id = 'เลือกโปรโมชันจากรายการ';

  const buy = quantity(fields.buy_quantity, 1);
  if (buy === null) errors.buy_quantity = 'ใส่จำนวน 1–999';
  const free = quantity(fields.get_free_quantity || '0', 0);
  if (free === null) errors.get_free_quantity = 'ใส่จำนวน 0–999';

  const ids = new Set<number>();
  for (const raw of productIds) {
    if (!/^\d{1,9}$/.test(raw)) {
      errors.product_ids = 'รายการสินค้าไม่ถูกต้อง';
      break;
    }
    ids.add(Number(raw));
  }
  if (!errors.product_ids && ids.size === 0) errors.product_ids = 'เลือกสินค้าอย่างน้อย 1 รายการ';
  if (ids.size > MAX_PRODUCTS) errors.product_ids = `เลือกได้ไม่เกิน ${MAX_PRODUCTS} รายการ`;

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      enabled: fields.enabled === '1' ? 1 : 0,
      promotion_id,
      type,
      buy_quantity: buy as number,
      get_free_quantity: free as number,
      product_ids: [...ids].sort((a, b) => a - b),
    },
  };
}

/** ช่องที่เปลี่ยน — สินค้าเก็บเป็นรายการที่เพิ่ม/เอาออก (อ่านง่ายกว่าเทียบทั้งชุด) */
export function diffRule(before: RuleInput, after: RuleInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ['name', 'enabled', 'promotion_id', 'type', 'buy_quantity', 'get_free_quantity'] as const) {
    if (before[key] !== after[key]) out[key] = [before[key], after[key]];
  }
  const was = new Set(before.product_ids);
  const now = new Set(after.product_ids);
  const added = after.product_ids.filter((id) => !was.has(id));
  const removed = before.product_ids.filter((id) => !now.has(id));
  if (added.length || removed.length) out.product_ids = { added, removed };
  return out;
}
