#!/usr/bin/env node
// แปลง CSV สมาชิกเว็บเดิม → ไฟล์ SQL สำหรับนำเข้า D1
// ⚠ ใช้หลัง IT/ฝ่ายกฎหมายอนุมัติการย้ายข้อมูลส่วนบุคคลแล้วเท่านั้น · ไฟล์ CSV/SQL มีข้อมูลลูกค้า ห้าม commit (อยู่ใน .gitignore)
//
//   pnpm run customers:to-sql -- <members.csv> <out.sql>
//   pnpm exec wrangler d1 execute wakana --remote --file <out.sql>   ← คนที่ได้รับมอบหมายรันเอง แล้วลบทั้งสองไฟล์ทิ้ง

//   รับได้ทั้ง CSV และไฟล์ dump MySQL ของ wakana_db (.sql — อ่านตาราง customer)

import { readFile, writeFile } from 'node:fs/promises';
import { rowsFromCsv, rowsFromDump, toSql } from '../src/customers-import.ts';

const [input, output] = process.argv.slice(2).filter((a) => a !== '--');
if (!input || !output) {
  console.error('ใช้: pnpm run customers:to-sql -- <members.csv | wakana_db.sql> <out.sql>');
  process.exit(1);
}

const text = await readFile(input, 'utf8');
const { rows, skipped } = /\.sql$/i.test(input) ? rowsFromDump(text) : rowsFromCsv(text);
await writeFile(output, toSql(rows, new Date().toISOString()));
console.log(`พร้อมนำเข้า ${rows.length} แถว → ${output}`);
if (skipped.length) {
  console.log(`ข้าม ${skipped.length} แถว:`);
  for (const s of skipped.slice(0, 30)) console.log(`  แถว ${s.line}: ${s.reason}`);
  if (skipped.length > 30) console.log(`  …และอีก ${skipped.length - 30} แถว`);
}
