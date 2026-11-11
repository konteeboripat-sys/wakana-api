// อัปเดตหน้าเว็บ (wakana-site) อัตโนมัติหลังแก้สินค้า
//   - บันทึกสินค้า → requestPublish: จดว่ามีของต้องอัปเดต
//       · deploy hook ในเครื่อง (localhost) → สั่ง build ทันที (ตัวรับในเครื่องรวมคำขอที่ซ้อนให้เอง)
//       · deploy hook จริง (Cloudflare) → รอ cron ทุกนาที (runScheduledPublish)
//   - cron: มีของค้าง + ไม่ได้สั่งในช่วง BUILD_GAP → สั่ง build 1 รอบ
//     แก้หลายตัวติดกัน = build รอบเดียว · ไม่สั่งซ้อนระหว่าง build (รอบเก่าเสร็จทีหลังจะทับข้อมูลใหม่ด้วยของเก่า)
//   - ปุ่ม "อัปเดตหน้าเว็บ" → publishNow: สั่งทันที

import type { Env } from './env.ts';

/** เวลาที่ให้ build 1 รอบทำงานจนเสร็จก่อนสั่งรอบถัดไป (Workers Builds ราว 1–2 นาที) */
export const BUILD_GAP_MS = 2 * 60 * 1000;

export interface PublishState {
  requested_at: string | null;
  triggered_at: string | null;
  last_result: 'ok' | 'failed' | null;
  last_actor: string | null;
}

export type PublishOutcome = 'triggered' | 'queued' | 'unset' | 'failed';

export function hookUrl(env: Env): URL | null {
  const raw = (env.DEPLOY_HOOK_URL ?? '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    // https เท่านั้น — ยกเว้นตัวรับในเครื่องตอนพัฒนา (wakana-site: pnpm run dev:hook)
    if (u.protocol === 'https:' || (u.protocol === 'http:' && isLocal(u))) return u;
  } catch {
    /* ตั้งค่าผิด = ถือว่าไม่ได้ตั้ง */
  }
  console.warn('publish: DEPLOY_HOOK_URL ไม่ถูกต้อง (ต้องเป็น https)');
  return null;
}

const isLocal = (u: URL) => u.hostname === '127.0.0.1' || u.hostname === 'localhost';

export async function getPublishState(db: D1Database): Promise<PublishState> {
  return (await db.prepare('SELECT requested_at, triggered_at, last_result, last_actor FROM site_publish WHERE id = 1').first<PublishState>()) ?? {
    requested_at: null,
    triggered_at: null,
    last_result: null,
    last_actor: null,
  };
}

/** มีการแก้ที่ยังไม่ได้สั่ง build */
export const hasPending = (s: PublishState) => Boolean(s.requested_at && (!s.triggered_at || s.requested_at > s.triggered_at));

/** ตัดสินว่า cron ควรสั่ง build ตอนนี้ไหม (ฟังก์ชันล้วน — เทสได้) */
export function shouldTrigger(s: PublishState, nowMs: number): boolean {
  if (!hasPending(s)) return false;
  if (!s.triggered_at) return true;
  return nowMs - Date.parse(s.triggered_at) >= BUILD_GAP_MS;
}

async function callHook(db: D1Database, hook: URL, actor: string, nowIso: string): Promise<boolean> {
  let ok = false;
  try {
    const res = await fetch(hook, { method: 'POST', signal: AbortSignal.timeout(10_000) });
    ok = res.ok;
    if (!ok) console.warn('publish: deploy hook ตอบ', res.status);
  } catch (err) {
    console.warn('publish: เรียก deploy hook ไม่ได้', err instanceof Error ? err.message : err);
  }
  await db.prepare('UPDATE site_publish SET triggered_at = ?, last_result = ?, last_actor = ? WHERE id = 1').bind(nowIso, ok ? 'ok' : 'failed', actor).run();
  return ok;
}

/** หลังบันทึกสินค้า */
export async function requestPublish(env: Env, actor: string): Promise<PublishOutcome> {
  const nowIso = new Date().toISOString();
  await env.DB.prepare('UPDATE site_publish SET requested_at = ? WHERE id = 1').bind(nowIso).run();
  const hook = hookUrl(env);
  if (!hook) return 'unset';
  if (!isLocal(hook)) return 'queued';
  // ในเครื่อง: ให้ triggered_at > requested_at ⇒ cron ไม่สั่งซ้ำ
  return (await callHook(env.DB, hook, actor, new Date(Date.now() + 1).toISOString())) ? 'triggered' : 'failed';
}

/** ปุ่ม "อัปเดตหน้าเว็บ" — สั่งทันที */
export async function publishNow(env: Env, actor: string): Promise<PublishOutcome> {
  const hook = hookUrl(env);
  if (!hook) return 'unset';
  const nowIso = new Date().toISOString();
  await env.DB.prepare('UPDATE site_publish SET requested_at = ? WHERE id = 1').bind(nowIso).run();
  return (await callHook(env.DB, hook, actor, new Date(Date.now() + 1).toISOString())) ? 'triggered' : 'failed';
}

/** cron ทุกนาที */
export async function runScheduledPublish(env: Env): Promise<void> {
  const hook = hookUrl(env);
  if (!hook) return;
  const state = await getPublishState(env.DB);
  if (!shouldTrigger(state, Date.now())) return;
  await callHook(env.DB, hook, 'อัตโนมัติ', new Date().toISOString());
}
