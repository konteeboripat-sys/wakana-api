// session ของหน้า /back/login (โหมดรหัสผ่านชั่วคราว ADMIN_PASSWORD) — cookie ลงลายเซ็น HMAC ไม่ต้องเก็บอะไรใน D1
// กุญแจลายเซ็นมาจาก ADMIN_PASSWORD ⇒ เปลี่ยนรหัสผ่าน = ทุกคนหลุดออกจากระบบ

export const SESSION_SECONDS = 12 * 60 * 60;

/** https ใช้ __Host- (บังคับ Secure + Path=/ + ห้ามตั้ง Domain) · http://localhost ตอนพัฒนาตั้ง Secure ไม่ได้ */
export function sessionCookieName(url: URL): string {
  return url.protocol === 'https:' ? '__Host-wk_admin' : 'wk_admin';
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(`wakana-admin-session:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** โทเคน = base64url({u: ชื่อ, exp: วินาที}) "." base64url(HMAC) */
export async function createSessionToken(user: string, secret: string, nowMs: number): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ u: user, exp: Math.floor(nowMs / 1000) + SESSION_SECONDS })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

/** ชื่อผู้ใช้ถ้าโทเคนถูกต้องและยังไม่หมดอายุ · ไม่งั้น null */
export async function verifySessionToken(token: string, secret: string, nowMs: number): Promise<string | null> {
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  try {
    // verify ของ WebCrypto เทียบลายเซ็นแบบเวลาคงที่
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(token.slice(dot + 1)), enc.encode(body));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(body))) as { u?: unknown; exp?: unknown };
    if (typeof data.u !== 'string' || !data.u || typeof data.exp !== 'number') return null;
    return data.exp * 1000 > nowMs ? data.u : null;
  } catch {
    return null;
  }
}

export function readSessionCookie(request: Request, url: URL): string | null {
  const name = sessionCookieName(url);
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** ค่า Set-Cookie · token ว่าง = ลบ cookie (ออกจากระบบ) */
export function sessionSetCookie(url: URL, token: string): string {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  const age = token ? SESSION_SECONDS : 0;
  return `${sessionCookieName(url)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure}`;
}
