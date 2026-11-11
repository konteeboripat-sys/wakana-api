#!/usr/bin/env node
// แปลงโปรโมชันเว็บเดิม (ไฟล์ dump MySQL ของ wakana_db) → ไฟล์ SQL สำหรับนำเข้า D1
//
//   pnpm run promotions:to-sql -- <wakana_db.sql> <out.sql>
//   pnpm exec wrangler d1 execute wakana --remote --file <out.sql>   ← รันซ้ำได้ (id ที่มีแล้วข้าม)

import { readFile, writeFile } from 'node:fs/promises';
import { promotionsFromDump, toSql } from '../src/promotions-import.ts';

const [input, output] = process.argv.slice(2).filter((a) => a !== '--');
if (!input || !output) {
  console.error('ใช้: pnpm run promotions:to-sql -- <wakana_db.sql> <out.sql>');
  process.exit(1);
}

const { promotions, skipped, adjusted } = promotionsFromDump(await readFile(input, 'utf8'));
await writeFile(output, toSql(promotions));
const byKind = promotions.reduce((m, p) => ((m[p.kind] = (m[p.kind] ?? 0) + 1), m), {});
console.log(`พร้อมนำเข้า ${promotions.length} โปรโมชัน (เปิด ${promotions.filter((p) => p.enabled).length}) → ${output}`);
console.log(`ประเภท: ${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
for (const [label, list] of [
  ['ข้าม', skipped],
  ['ปรับ', adjusted],
]) {
  if (!list.length) continue;
  console.log(`${label} ${list.length} รายการ:`);
  for (const s of list) console.log(`  #${s.id}: ${s.reason}`);
}
