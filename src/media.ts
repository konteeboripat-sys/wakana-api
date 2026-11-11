// รูปที่อัปโหลดจากหลังบ้าน (เก็บใน R2 หรือ Workers KV) — ตรวจชนิดไฟล์จากเนื้อไฟล์ ไม่เชื่อนามสกุล/Content-Type ที่เบราว์เซอร์ส่งมา
// ไม่รับ SVG: เป็น XML ฝังสคริปต์ได้

import type { Env } from './env.ts';

/** ที่เก็บรูป: R2 ถ้าผูกไว้ · ไม่มีก็ใช้ Workers KV (2026-10-22: บัญชีเปิด R2 ไม่ได้ error 10042) · ทั้งคู่ใช้ key/ลิงก์ /media/... เดียวกัน */
export type MediaStore = { kind: 'r2'; bucket: R2Bucket } | { kind: 'kv'; kv: KVNamespace };

export function mediaStore(env: Env): MediaStore | null {
  if (env.IMAGES) return { kind: 'r2', bucket: env.IMAGES };
  if (env.IMAGES_KV) return { kind: 'kv', kv: env.IMAGES_KV };
  return null;
}

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MEDIA_PREFIX = '/media/';
const KEY_PATTERN = /^products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif)$/;

export interface ImageKind {
  ext: 'jpg' | 'png' | 'webp' | 'gif';
  type: string;
}

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** ดูจาก magic bytes · null = ไม่ใช่รูปที่รับ */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { ext: 'jpg', type: 'image/jpeg' };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', type: 'image/png' };
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return { ext: 'webp', type: 'image/webp' };
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return { ext: 'gif', type: 'image/gif' };
  return null;
}

export type ImageCheck = { ok: true; kind: ImageKind; bytes: Uint8Array } | { ok: false; error: string };

export async function checkImageFile(file: File): Promise<ImageCheck> {
  if (file.size === 0) return { ok: false, error: 'ไฟล์ว่าง' };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: `ไฟล์ใหญ่เกิน 2 MB (${(file.size / 1024 / 1024).toFixed(1)} MB)` };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) return { ok: false, error: 'รับเฉพาะรูป JPG, PNG, WebP หรือ GIF' };
  return { ok: true, kind, bytes };
}

/** key ใน R2 → path ที่เก็บในฐานข้อมูล/ใช้ใน <img> */
export const mediaPath = (key: string) => MEDIA_PREFIX + key;

/** path ในฐานข้อมูล → key ใน R2 (เฉพาะไฟล์ที่ระบบนี้อัปโหลดเอง) · null = ไม่ใช่ */
export function mediaKeyFromPath(path: string): string | null {
  if (!path.startsWith(MEDIA_PREFIX)) return null;
  const key = path.slice(MEDIA_PREFIX.length);
  return KEY_PATTERN.test(key) ? key : null;
}

export async function putProductImage(store: MediaStore, check: { kind: ImageKind; bytes: Uint8Array }): Promise<string> {
  const key = `products/${crypto.randomUUID()}.${check.kind.ext}`;
  if (store.kind === 'r2') {
    await store.bucket.put(key, check.bytes, { httpMetadata: { contentType: check.kind.type, cacheControl: 'public, max-age=31536000, immutable' } });
  } else {
    await store.kv.put(key, check.bytes, { metadata: { contentType: check.kind.type } });
  }
  return mediaPath(key);
}

/** ลบไฟล์ที่ระบบอัปโหลดเอง (path อื่นไม่แตะ) · ลบไม่ได้ไม่ถือว่าล้ม — แค่ไฟล์ค้าง */
export async function deleteProductImage(store: MediaStore | null, path: string): Promise<void> {
  const key = mediaKeyFromPath(path);
  if (!key || !store) return;
  try {
    await (store.kind === 'r2' ? store.bucket.delete(key) : store.kv.delete(key));
  } catch (err) {
    console.warn('media: ลบไฟล์ไม่ได้', key, err instanceof Error ? err.message : err);
  }
}

/** GET /media/<key> — เสิร์ฟรูปจาก R2/KV · ชื่อไฟล์เป็น UUID เปลี่ยนรูป = ไฟล์ใหม่ ⇒ แคชได้ตลอด */
export async function serveMedia(store: MediaStore | null, path: string): Promise<Response> {
  const key = mediaKeyFromPath(path);
  let found: { body: ReadableStream; contentType: string; etag: string } | null = null;
  if (key && store?.kind === 'r2') {
    const obj = await store.bucket.get(key);
    if (obj) found = { body: obj.body, contentType: obj.httpMetadata?.contentType ?? 'application/octet-stream', etag: obj.httpEtag };
  } else if (key && store?.kind === 'kv') {
    const { value, metadata } = await store.kv.getWithMetadata<{ contentType?: string }>(key, 'stream');
    // key เป็น UUID ไม่เคยถูกเขียนทับ ⇒ ใช้เป็น ETag ได้
    if (value) found = { body: value, contentType: metadata?.contentType ?? 'application/octet-stream', etag: `"${key}"` };
  }
  if (!found) return new Response('not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  return new Response(found.body, {
    headers: {
      'Content-Type': found.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      ETag: found.etag,
    },
  });
}
