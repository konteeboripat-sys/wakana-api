#!/usr/bin/env node
// สินค้าจาก catalog.js ของเว็บ (เปิดขาย) → ไฟล์ SQL สำหรับ D1 — ทำแบบเดียวกับปุ่ม "นำเข้าจากเว็บ" ในหลังบ้าน
// ทำก่อน products:legacy-to-sql เสมอ (legacy เพิ่มสินค้าที่ยังไม่มีแบบปิดขาย ⇒ ถ้ารันก่อน ปุ่ม/สคริปต์นี้จะข้ามทุกตัว)
//
//   pnpm run products:web-to-sql -- <site origin> <out.sql>
//   pnpm exec wrangler d1 execute wakana --remote --file <out.sql>   ← รันซ้ำได้

import { writeFile } from 'node:fs/promises';
import { parseCatalogScript } from '../src/catalog.ts';
import { importRowsFromCatalog } from '../src/products.ts';
import { toSql } from '../src/products-web-import.ts';

const [origin, output] = process.argv.slice(2).filter((a) => a !== '--');
if (!origin || !output) {
  console.error('ใช้: pnpm run products:web-to-sql -- <site origin> <out.sql>');
  process.exit(1);
}

const res = await fetch(origin.replace(/\/+$/, '') + '/assets/wakana/catalog.js');
if (!res.ok) throw new Error(`catalog.js: HTTP ${res.status}`);
const { rows, skipped } = importRowsFromCatalog(parseCatalogScript(await res.text()));
await writeFile(output, toSql(rows, new Date().toISOString()));
console.log(`สินค้าจากเว็บ ${rows.length} รายการ → ${output}`);
if (skipped.length) console.log(`ข้าม ${skipped.length} รายการ (รหัสไม่ใช่ตัวเลข/ลิงก์ไม่ถูกแบบ): ${skipped.join(', ')}`);
