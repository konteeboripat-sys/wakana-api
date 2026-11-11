// wakana-api — API + หลังบ้านของ wakanafooddelivery.com (แยกจากเว็บ wakana-site)
//   GET  /health · /products[?category=] · /search?q=     สาธารณะ
//   POST /orders                                          หน้าเว็บส่งออเดอร์ (CORS เฉพาะ ALLOWED_ORIGINS)
//   /back/*                                               หลังบ้าน (Cloudflare Access / /back/login) · /admin/* เดิม → 301 ไป /back
//   GET  /media/products/<uuid>.<ext>                     รูปที่อัปโหลดจากหลังบ้าน (R2)

import { handleAdmin } from './admin.ts';
import { handleApi } from './api.ts';
import type { Env } from './env.ts';
import { json } from './http.ts';
import { MEDIA_PREFIX, mediaStore, serveMedia } from './media.ts';
import { runScheduledPublish } from './publish.ts';

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (path === '/back' || path.startsWith('/back/')) return await handleAdmin(request, env, url, path);
      // หลังบ้านเคยอยู่ที่ /admin — ลิงก์/bookmark เดิมพาไป /back (เปิดหน้าเท่านั้น · ฟอร์มค้างต้องส่งใหม่จากหน้า /back)
      if ((path === '/admin' || path.startsWith('/admin/')) && (request.method === 'GET' || request.method === 'HEAD')) {
        return new Response(null, { status: 301, headers: { Location: `/back${path.slice(6)}${url.search}`, 'Cache-Control': 'no-store' } });
      }
      if (path.startsWith(MEDIA_PREFIX) && (request.method === 'GET' || request.method === 'HEAD')) return await serveMedia(mediaStore(env), path);
      return await handleApi(request, env, url, path);
    } catch (err) {
      console.error('unhandled', err instanceof Error ? err.stack : err);
      return json({ error: 'internal_error' }, 500);
    }
  },

  // cron ทุกนาที: มีการแก้สินค้าที่ยังไม่ขึ้นเว็บ → สั่ง build หน้าเว็บ (ดู publish.ts)
  async scheduled(_event, env, ctx): Promise<void> {
    ctx.waitUntil(runScheduledPublish(env));
  },
} satisfies ExportedHandler<Env>;
