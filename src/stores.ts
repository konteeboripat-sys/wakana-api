// สาขา: ตรวจฟอร์ม — ฟังก์ชันล้วน (เทสด้วย node --test ได้)

export interface StoreInput {
  name_th: string;
  name_en: string;
  enabled: 0 | 1;
}

export interface StoreRow extends StoreInput {
  id: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const STORE_FIELD_LABELS: Record<keyof StoreInput, string> = {
  name_th: 'store name th',
  name_en: 'store name en',
  enabled: 'store enable',
};

export type StoreFormResult = { ok: true; value: StoreInput } | { ok: false; errors: Partial<Record<keyof StoreInput, string>> };

export function parseStoreForm(form: Record<string, string | undefined>): StoreFormResult {
  const errors: Partial<Record<keyof StoreInput, string>> = {};
  const text = (key: 'name_th' | 'name_en', label: string) => {
    const v = (form[key] ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
    if (!v) errors[key] = `กรอก${label}`;
    else if (v.length > 200) errors[key] = 'ยาวเกิน 200 ตัวอักษร';
    return v;
  };
  const name_th = text('name_th', 'ชื่อสาขาภาษาไทย');
  const name_en = text('name_en', 'ชื่อสาขาภาษาอังกฤษ');
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name_th, name_en, enabled: form.enabled === '1' ? 1 : 0 } };
}

export function diffStore(before: StoreInput, after: StoreInput): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const key of Object.keys(STORE_FIELD_LABELS) as (keyof StoreInput)[]) {
    if (before[key] !== after[key]) out[key] = [before[key], after[key]];
  }
  return out;
}
