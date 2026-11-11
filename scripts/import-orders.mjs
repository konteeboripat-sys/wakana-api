#!/usr/bin/env node
// แปลงออเดอร์เว็บเดิม (ไฟล์ dump MySQL ของ wakana_db) → ไฟล์ SQL สำหรับนำเข้า D1
// ⚠ ไฟล์ dump/SQL มีข้อมูลลูกค้า (ชื่อ ที่อยู่ เบอร์ อีเมล) ห้าม commit · นำเข้าแล้วลบไฟล์ SQL ทิ้ง
//
//   pnpm run orders:to-sql -- <wakana_db.sql> <out.sql>
//   pnpm exec wrangler d1 execute wakana --local  --file <out.sql>   ← ลองในเครื่องก่อน
//   pnpm exec wrangler d1 execute wakana --remote --file <out.sql>   ← ของจริง (รันซ้ำได้ ออเดอร์ที่มีแล้วข้าม)

import { readFile, writeFile } from 'node:fs/promises';
import { ordersFromDump, toSql } from '../src/orders-import.ts';

const [input, output] = process.argv.slice(2).filter((a) => a !== '--');
if (!input || !output) {
  console.error('ใช้: pnpm run orders:to-sql -- <wakana_db.sql> <out.sql>');
  process.exit(1);
}

const { orders, skipped, adjusted } = ordersFromDump(await readFile(input, 'utf8'));
await writeFile(output, toSql(orders));
const lines = orders.reduce((n, o) => n + o.items.length, 0);
const byStatus = orders.reduce((m, o) => ((m[o.status] = (m[o.status] ?? 0) + 1), m), {});
console.log(`พร้อมนำเข้า ${orders.length} ออเดอร์ · ${lines} รายการสินค้า → ${output}`);
console.log(`สถานะ: ${Object.entries(byStatus).map(([s, n]) => `${s} ${n}`).join(' · ')}`);
for (const [label, list] of [
  ['ข้าม', skipped],
  ['ปรับ', adjusted],
]) {
  if (!list.length) continue;
  console.log(`${label} ${list.length} รายการ:`);
  for (const s of list.slice(0, 15)) console.log(`  ${s.ref}: ${s.reason}`);
  if (list.length > 15) console.log(`  …และอีก ${list.length - 15} รายการ`);
}
