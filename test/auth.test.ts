import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';
import { test } from 'node:test';
import { createSessionToken, sessionSetCookie, SESSION_SECONDS, verifySessionToken } from '../src/admin-session.ts';
import { safeNext } from '../src/admin-login.ts';
import { authenticateAdmin, checkPasswordLogin } from '../src/auth.ts';
import type { Env } from '../src/env.ts';

// timingSafeEqual ของ crypto.subtle มีเฉพาะบน Workers — จำลองให้ Node
const subtle = crypto.subtle as unknown as { timingSafeEqual?: (a: ArrayBuffer, b: ArrayBuffer) => boolean };
subtle.timingSafeEqual ??= (a, b) => timingSafeEqual(new Uint8Array(a), new Uint8Array(b));

const base = { ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' } as Env;
const ORIGIN = 'https://wakana-api.example.workers.dev';
const req = (headers: Record<string, string> = {}) => new Request(`${ORIGIN}/back/orders`, { headers });
const withSession = async (user: string, secret: string, nowMs = Date.now()) => ({ Cookie: `other=1; __Host-wk_admin=${await createSessionToken(user, secret, nowMs)}` });

test('ไม่มี Access ไม่มี ADMIN_PASSWORD → 503 (ปิดไว้เหมือนเดิม)', async () => {
  const r = await authenticateAdmin(req(), base);
  assert.ok(!r.ok && r.status === 503 && !r.login);
});

test('ADMIN_PASSWORD: ไม่มี cookie / cookie ปลอม / รหัสเปลี่ยน / หมดอายุ → 401 ส่งไปหน้า login', async () => {
  const env = { ...base, ADMIN_PASSWORD: 'correct horse' };
  const none = await authenticateAdmin(req(), env);
  assert.ok(!none.ok && none.status === 401 && none.login);
  const forged = await authenticateAdmin(req({ Cookie: '__Host-wk_admin=eyJ1IjoiYSIsImV4cCI6OTk5OTk5OTk5OX0.AAAA' }), env);
  assert.ok(!forged.ok && forged.login);
  const oldSecret = await authenticateAdmin(req(await withSession('สมชาย', 'old password')), env);
  assert.ok(!oldSecret.ok && oldSecret.login);
  const expired = await authenticateAdmin(req(await withSession('สมชาย', 'correct horse', Date.now() - (SESSION_SECONDS + 5) * 1000)), env);
  assert.ok(!expired.ok && expired.login);
});

test('ADMIN_PASSWORD: cookie ถูก → ชื่อภาษาไทยได้ · บันทึกว่าเข้าด้วยรหัสผ่าน', async () => {
  const env = { ...base, ADMIN_PASSWORD: 'a:b:c' };
  const r = await authenticateAdmin(req(await withSession('สมชาย', 'a:b:c')), env);
  assert.ok(r.ok);
  assert.equal(r.identity.email, 'สมชาย (รหัสผ่าน)');
});

test('ฟอร์ม login: ถูก → ชื่อตัดช่องว่าง · รหัสผิด/ไม่มีชื่อ → 401', async () => {
  const env = { ...base, ADMIN_PASSWORD: 'a:b:c' };
  const ok = await checkPasswordLogin(req(), env, ' สมชาย\u0007 ', 'a:b:c');
  assert.deepEqual(ok, { ok: true, user: 'สมชาย' });
  const wrong = await checkPasswordLogin(req(), env, 'สมชาย', 'nope');
  assert.ok(!wrong.ok && wrong.status === 401);
  const noUser = await checkPasswordLogin(req(), env, '   ', 'a:b:c');
  assert.ok(!noUser.ok && noUser.status === 401);
});

test('ฟอร์ม login: ตั้ง ADMIN_USERNAME → รับชื่อนั้นชื่อเดียว', async () => {
  const env = { ...base, ADMIN_PASSWORD: 'pw', ADMIN_USERNAME: 'misadmin' };
  assert.deepEqual(await checkPasswordLogin(req(), env, ' misadmin ', 'pw'), { ok: true, user: 'misadmin' });
  const other = await checkPasswordLogin(req(), env, 'someone', 'pw');
  assert.ok(!other.ok && other.status === 401);
  const wrongPass = await checkPasswordLogin(req(), env, 'misadmin', 'nope');
  assert.ok(!wrongPass.ok && wrongPass.status === 401);
});

test('ฟอร์ม login: เกินโควตา → 429 ไม่ตรวจรหัส', async () => {
  const env = { ...base, ADMIN_PASSWORD: 'pw', ADMIN_LOGIN_LIMITER: { limit: async () => ({ success: false }) } };
  const r = await checkPasswordLogin(req(), env, 'a', 'pw');
  assert.ok(!r.ok && r.status === 429);
});

test('ตั้ง Access แล้ว → ไม่รับ cookie รหัสผ่าน (ต้องมี JWT ของ Access)', async () => {
  const env = { ...base, ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com', ACCESS_AUD: 'aud', ADMIN_PASSWORD: 'pw' };
  const r = await authenticateAdmin(req(await withSession('a', 'pw')), env);
  assert.ok(!r.ok && r.status === 401 && !r.login);
});

test('session token: แก้ชื่อในโทเคน → ลายเซ็นไม่ผ่าน', async () => {
  const token = await createSessionToken('a', 'pw', Date.now());
  const [, sig] = token.split('.');
  const tampered = `${Buffer.from(JSON.stringify({ u: 'admin', exp: 9999999999 })).toString('base64url')}.${sig}`;
  assert.equal(await verifySessionToken(token, 'pw', Date.now()), 'a');
  assert.equal(await verifySessionToken(tampered, 'pw', Date.now()), null);
});

test('cookie: https = __Host- + Secure · http (เครื่อง) ไม่มี Secure · ออกจากระบบ = Max-Age=0', () => {
  const https = sessionSetCookie(new URL(`${ORIGIN}/back/login`), 'x');
  assert.match(https, /^__Host-wk_admin=x; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200; Secure$/);
  assert.match(sessionSetCookie(new URL('http://localhost:8787/back/login'), 'x'), /^wk_admin=x;.*Max-Age=43200$/);
  assert.match(sessionSetCookie(new URL(`${ORIGIN}/back/logout`), ''), /Max-Age=0/);
});

test('safeNext: รับเฉพาะ path ใน /back/ · ไม่ระบุ/ผิด → หน้าสินค้า', () => {
  assert.equal(safeNext('/back/products?q=%E0%B8%8B'), '/back/products?q=%E0%B8%8B');
  assert.equal(safeNext('/back/orders/WK-ABCD-2345'), '/back/orders/WK-ABCD-2345');
  for (const other of ['/back', '/back/products?q=ซูชิ', 'https://evil.example/back', '//evil.example', '/back//evil', '/backx', '/back/login', '/back\\evil', '', null]) {
    assert.equal(safeNext(other), '/back/products', String(other));
  }
});
