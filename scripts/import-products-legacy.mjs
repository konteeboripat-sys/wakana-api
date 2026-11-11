#!/usr/bin/env node
// เติมข้อมูลสินค้าจากเว็บเดิม (ไฟล์ dump MySQL ของ wakana_db) → ไฟล์ SQL สำหรับ D1
// สินค้าที่มีแล้ว: เติมช่องที่ว่าง/ยังไม่มีใครแก้ · สินค้าที่ยังไม่มี: เพิ่มแบบปิดขาย (ดู src/products-legacy-import.ts)
//
//   pnpm run products:legacy-to-sql -- <wakana_db.sql> <out.sql>
//   pnpm exec wrangler d1 execute wakana --remote --file <out.sql>   ← รันซ้ำได้

import { readFile, writeFile } from 'node:fs/promises';
import { legacyProductsFromDump, toSql } from '../src/products-legacy-import.ts';

const [input, output] = process.argv.slice(2).filter((a) => a !== '--');
if (!input || !output) {
  console.error('ใช้: pnpm run products:legacy-to-sql -- <wakana_db.sql> <out.sql>');
  process.exit(1);
}

const { products, skipped } = legacyProductsFromDump(await readFile(input, 'utf8'));
await writeFile(output, toSql(products, new Date().toISOString()));
const byCat = products.reduce((m, p) => ((m[p.category] = (m[p.category] ?? 0) + 1), m), {});
console.log(`สินค้าเว็บเดิม ${products.length} รายการ → ${output}`);
console.log(`หมวด: ${Object.entries(byCat).map(([c, k]) => `${c} ${k}`).join(' · ')}`);
if (skipped.length) {
  console.log(`ข้าม ${skipped.length} รายการ:`);
  for (const s of skipped) console.log(`  #${s.id}: ${s.reason}`);
}
