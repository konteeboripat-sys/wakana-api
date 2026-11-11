// /back คุมด้วย Cloudflare Access: Access ล็อกอินพนักงาน (เช่นบัญชีบริษัท/Entra ID) แล้วแนบ JWT มาใน Cf-Access-Jwt-Assertion
// Worker ตรวจลายเซ็น JWT เองอีกชั้น — กันกรณีเรียก Worker ตรงโดยไม่ผ่าน Access (เช่นทาง workers.dev)

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from './env.ts';
import { readSessionCookie, verifySessionToken } from './admin-session.ts';
import { tokenMatches } from './export.ts';

export interface AdminIdentity {
  email: string;
}

/** ต่อท้ายชื่อที่เข้าด้วยรหัสผ่าน (บันทึกในประวัติ) — แยกจากอีเมลของ Access */
export const PASSWORD_SUFFIX = ' (รหัสผ่าน)';

/** หน้า /back/login ใช้ได้เมื่อ: ยังไม่ตั้ง Access + ตั้ง secret ADMIN_PASSWORD แล้ว */
export function passwordLoginEnabled(env: Env): boolean {
  return !(env.ACCESS_TEAM_DOMAIN.trim() && env.ACCESS_AUD.trim()) && Boolean(env.ADMIN_PASSWORD);
}

const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(teamDomain: string) {
  let jwks = jwksByTeam.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksByTeam.set(teamDomain, jwks);
  }
  return jwks;
}

/** login = ส่งไปหน้า /back/login (โหมดรหัสผ่าน) */
export type AuthResult = { ok: true; identity: AdminIdentity } | { ok: false; status: 401 | 503; reason: string; login?: boolean };

export async function authenticateAdmin(request: Request, env: Env): Promise<AuthResult> {
  const teamDomain = env.ACCESS_TEAM_DOMAIN.trim().replace(/\/+$/, '');
  const aud = env.ACCESS_AUD.trim();

  if (!teamDomain || !aud) {
    // ยังไม่ได้ตั้ง Access: ยอมเฉพาะรันในเครื่อง + มี ADMIN_DEV_EMAIL ใน .dev.vars · บน Cloudflare hostname ไม่มีทางเป็น localhost
    const host = new URL(request.url).hostname;
    if (env.ADMIN_DEV_EMAIL && (host === 'localhost' || host === '127.0.0.1')) {
      return { ok: true, identity: { email: env.ADMIN_DEV_EMAIL } };
    }
    // ชั่วคราวระหว่างยังไม่มี Access: ล็อกอินที่ /back/login ด้วยรหัสผ่านเดียว (secret ADMIN_PASSWORD) แล้วถือ cookie · ตั้ง Access แล้วทางนี้ปิดเอง
    if (env.ADMIN_PASSWORD) {
      const token = readSessionCookie(request, new URL(request.url));
      const user = token ? await verifySessionToken(token, env.ADMIN_PASSWORD, Date.now()) : null;
      if (user) return { ok: true, identity: { email: `${user}${PASSWORD_SUFFIX}` } };
      return { ok: false, status: 401, reason: 'กรุณาเข้าสู่ระบบก่อน', login: true };
    }
    return { ok: false, status: 503, reason: 'ยังไม่ได้ตั้งค่า Cloudflare Access (ACCESS_TEAM_DOMAIN / ACCESS_AUD)' };
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return { ok: false, status: 401, reason: 'ต้องเข้าผ่าน Cloudflare Access' };
  try {
    const { payload } = await jwtVerify(token, jwksFor(teamDomain), { issuer: teamDomain, audience: aud });
    const email = typeof payload.email === 'string' ? payload.email : '';
    if (!email) return { ok: false, status: 401, reason: 'โทเคนไม่มีอีเมล' };
    return { ok: true, identity: { email } };
  } catch (err) {
    console.warn('admin: JWT ไม่ผ่าน', err instanceof Error ? err.message : err);
    return { ok: false, status: 401, reason: 'โทเคนไม่ถูกต้องหรือหมดอายุ' };
  }
}

export type LoginResult = { ok: true; user: string } | { ok: false; status: 401 | 429; reason: string };

/** ชื่อในช่องล็อกอิน → ชื่อที่บันทึกในประวัติ (ตัดอักขระควบคุม · ยาวไม่เกิน 40) */
export function cleanLoginName(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
}

/**
 * ตรวจฟอร์ม /back/login: ชื่อ = ใครกด (บันทึกในประวัติ) · รหัส = ADMIN_PASSWORD ร่วมกัน
 * นับทุกครั้งที่กดเข้าสู่ระบบ (ผูก limiter แล้วเท่านั้น) — ใช้งานปกติไม่ถึง · เดารหัสรัวโดนตัด
 */
export async function checkPasswordLogin(request: Request, env: Env, rawUser: string, pass: string): Promise<LoginResult> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (env.ADMIN_LOGIN_LIMITER && !(await env.ADMIN_LOGIN_LIMITER.limit({ key: ip })).success) {
    return { ok: false, status: 429, reason: 'ลองบ่อยเกินไป รอสักครู่แล้วลองใหม่' };
  }
  const user = cleanLoginName(rawUser);
  // ตั้ง ADMIN_USERNAME = รับชื่อนั้นชื่อเดียว (เหมือน back/ เดิม) · ไม่ตั้ง = ชื่ออะไรก็ได้ (ใช้บันทึกว่าใครแก้)
  const expectedUser = env.ADMIN_USERNAME?.trim() ?? '';
  const [userOk, passOk] = await Promise.all([
    expectedUser ? tokenMatches(user, expectedUser) : Promise.resolve(true),
    env.ADMIN_PASSWORD ? tokenMatches(pass, env.ADMIN_PASSWORD) : Promise.resolve(false),
  ]);
  if (!user || !userOk || !passOk) {
    return { ok: false, status: 401, reason: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
  }
  return { ok: true, user };
}
