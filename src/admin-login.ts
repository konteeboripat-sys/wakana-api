// หน้าเข้าสู่ระบบหลังบ้าน /back/login (แทน back/check_login.php ของเว็บเดิม และแทน popup HTTP Basic)
// ใช้ได้เฉพาะโหมดรหัสผ่านชั่วคราว (ADMIN_PASSWORD ยังไม่ตั้ง Access) — ตั้ง Access แล้วหน้านี้ส่งต่อไป /back เฉย ๆ

import { errorPage, LOGO_PATH, loginPage, readForm, redirect, sameOrigin } from './admin-layout.ts';
import { createSessionToken, readSessionCookie, sessionSetCookie, verifySessionToken } from './admin-session.ts';
import { checkPasswordLogin, passwordLoginEnabled } from './auth.ts';
import type { Env } from './env.ts';
import { html } from './html.ts';

/** ล็อกอินผ่านแล้วไปหน้าสินค้า (เหมือนหลังบ้านเดิม) ถ้าไม่ได้ตั้งใจเปิดหน้าอื่นไว้ */
export const AFTER_LOGIN = '/back/products';

/** กลับไปหน้าเดิมหลังล็อกอินได้เฉพาะ path ใน /back ของเว็บนี้ (กัน open redirect) */
export function safeNext(raw: string | null | undefined): string {
  const v = (raw ?? '').trim();
  if (!/^\/back\/[A-Za-z0-9\-._~%/?=&+]*$/.test(v) || v.includes('//') || /^\/back\/log(?:in|out)\b/.test(v)) return AFTER_LOGIN;
  return v;
}

// ช่องเดิมของ back/ เว็บเดิม (Username / Password) ในหน้าตาแบรนด์เว็บหลัก: โลโก้ WAKANA · Kanit · ปุ่มแดง (ชื่อที่กรอกบันทึกในประวัติว่าใครแก้)
function loginForm(env: Env, o: { next: string; user?: string; error?: string; status?: number }): Response {
  const body = html`<main class="card">
<img class="logo" src="${LOGO_PATH}" width="476" height="210" alt="WAKANA Delivery &amp; Catering">
<h1>เข้าสู่ระบบหลังบ้าน</h1>
${o.error ? html`<div class="alert" role="alert">${o.error}</div>` : ''}
<form method="post" action="/back/login">
  <input type="hidden" name="next" value="${o.next}">
  <div class="field"><label for="username">Username</label>
    <input id="username" name="username" autocomplete="username" required maxlength="40" value="${o.user ?? ''}" ${o.user ? '' : html`autofocus`}></div>
  <div class="field"><label for="password">Password</label>
    <input type="password" id="password" name="password" autocomplete="current-password" required ${o.user ? html`autofocus` : ''}></div>
  <button type="submit">เข้าสู่ระบบ</button>
</form></main>
<footer>Wakana Delivery &amp; Catering · หลังบ้าน</footer>`;
  return loginPage(env, { body, status: o.status });
}

export async function handleLogin(request: Request, env: Env, url: URL, path: string): Promise<Response> {
  // ไม่ใช่โหมดรหัสผ่าน (ตั้ง Access แล้ว / ยังไม่ตั้งอะไร) → ให้ /back ตัดสินเองตามเดิม
  if (!passwordLoginEnabled(env)) return redirect(AFTER_LOGIN);
  const secret = env.ADMIN_PASSWORD as string;

  if (path === '/back/logout') {
    if (request.method !== 'POST') return errorPage(env, 405, 'ไม่รองรับคำขอนี้');
    if (!sameOrigin(request, url)) return errorPage(env, 403, 'คำขอไม่ได้มาจากหน้าหลังบ้าน');
    const res = redirect('/back/login');
    res.headers.set('Set-Cookie', sessionSetCookie(url, ''));
    return res;
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    const next = safeNext(url.searchParams.get('next'));
    const token = readSessionCookie(request, url);
    if (token && (await verifySessionToken(token, secret, Date.now()))) return redirect(next);
    return loginForm(env, { next });
  }
  if (request.method !== 'POST') return errorPage(env, 405, 'ไม่รองรับคำขอนี้');
  if (!sameOrigin(request, url)) return errorPage(env, 403, 'คำขอไม่ได้มาจากหน้าหลังบ้าน');

  const form = await readForm(request);
  const next = safeNext(form.next);
  const result = await checkPasswordLogin(request, env, form.username ?? '', form.password ?? '');
  if (!result.ok) return loginForm(env, { next, user: (form.username ?? '').slice(0, 40), error: result.reason, status: result.status });

  const res = redirect(next);
  res.headers.set('Set-Cookie', sessionSetCookie(url, await createSessionToken(result.user, secret, Date.now())));
  return res;
}
