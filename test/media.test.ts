import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkImageFile, MAX_IMAGE_BYTES, mediaKeyFromPath, mediaPath, sniffImage } from '../src/media.ts';

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));

const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13]);
const JPG = bytes([0xff, 0xd8, 0xff, 0xe0], [0, 16]);
const WEBP = bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 ');
const GIF = bytes('GIF89a', [1, 0]);

test('sniffImage: ดูจากเนื้อไฟล์', () => {
  assert.equal(sniffImage(PNG)?.ext, 'png');
  assert.equal(sniffImage(JPG)?.ext, 'jpg');
  assert.equal(sniffImage(WEBP)?.ext, 'webp');
  assert.equal(sniffImage(GIF)?.ext, 'gif');
  // SVG / HTML / PDF / RIFF ที่ไม่ใช่ WEBP → ไม่รับ
  for (const bad of [bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), bytes('<html>'), bytes('%PDF-1.7'), bytes('RIFF', [0, 0, 0, 0], 'WAVE'), bytes([])]) {
    assert.equal(sniffImage(bad), null);
  }
});

test('checkImageFile: นามสกุล .jpg แต่เนื้อเป็น SVG → ไม่รับ · ใหญ่เกิน → ไม่รับ', async () => {
  assert.ok((await checkImageFile(new File([PNG], 'a.png', { type: 'image/png' }))).ok);
  const fake = await checkImageFile(new File([bytes('<svg onload="alert(1)">')], 'cute.jpg', { type: 'image/jpeg' }));
  assert.ok(!fake.ok && /JPG, PNG/.test(fake.error));
  const big = await checkImageFile(new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'big.png'));
  assert.ok(!big.ok && /2 MB/.test(big.error));
  const empty = await checkImageFile(new File([], 'x.png'));
  assert.ok(!empty.ok);
});

test('mediaKeyFromPath: เฉพาะไฟล์ที่ระบบอัปโหลดเอง', () => {
  const key = 'products/0f8fad5b-d9cb-469f-a165-70867728950e.png';
  assert.equal(mediaKeyFromPath(mediaPath(key)), key);
  for (const bad of ['/images/product/a.jpg', '/media/../wrangler.jsonc', '/media/products/x.png', '/media/products/0f8fad5b-d9cb-469f-a165-70867728950e.svg', 'https://evil/media/products/0f8fad5b-d9cb-469f-a165-70867728950e.png']) {
    assert.equal(mediaKeyFromPath(bad), null, bad);
  }
});
