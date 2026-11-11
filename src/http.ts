import type { Env } from './env.ts';

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set('Content-Type', 'application/json; charset=utf-8');
  if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers: h });
}

export function allowedOrigins(env: Env): Set<string> {
  return new Set(
    env.ALLOWED_ORIGINS.split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  );
}

/** CORS สำหรับหน้าเว็บที่อนุญาตเท่านั้น · origin อื่นไม่ได้ header ⇒ เบราว์เซอร์อ่านผลไม่ได้ */
export function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin');
  if (!origin || !allowedOrigins(env).has(origin)) return {};
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
}

export function preflight(request: Request, env: Env): Response {
  const cors = corsHeaders(request, env);
  if (!cors['Access-Control-Allow-Origin']) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      ...cors,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
