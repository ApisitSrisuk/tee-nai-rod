import crypto from 'node:crypto';
import { DISTRICTS } from './_districts.js';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SALT = process.env.HASH_SALT || '';

export function assertEnv() {
  if (!SB_URL || !SB_KEY || !SALT) throw Object.assign(new Error('Server is missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or HASH_SALT'), { status: 500 });
}

export const sha = s => crypto.createHash('sha256').update(SALT + ':' + s).digest('hex');

export function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  return (Array.isArray(xf) ? xf[0] : (xf || '')).split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

// Minimal PostgREST client using the service_role key (server only).
export async function sb(path, { method = 'GET', body, prefer } = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      // legacy service_role keys are JWTs and go in Authorization too; new sb_secret_ keys go in apikey only
      ...(SB_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${SB_KEY}` } : {}),
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw Object.assign(new Error(data?.message || `Supabase ${r.status}`), { status: 502 });
  return { data, headers: r.headers };
}

export async function countSince(table, column, value, minutes) {
  const since = new Date(Date.now() - minutes * 60000).toISOString();
  const { headers } = await sb(`${table}?select=${column}&${column}=eq.${value}&created_at=gte.${since}&limit=1`, { prefer: 'count=exact' });
  return Number((headers.get('content-range') || '*/0').split('/')[1]) || 0;
}

export async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return true; // Turnstile is optional
  if (!token) return false;
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret, response: token, remoteip: ip }),
  });
  const j = await r.json().catch(() => ({}));
  return !!j.success;
}

function inRing(x, y, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export function districtAt(lat, lng) {
  for (const f of DISTRICTS.features) {
    const rs = f.geometry.coordinates;
    if (inRing(lng, lat, rs[0]) && !rs.slice(1).some(h => inRing(lng, lat, h))) return f.properties.c;
  }
  return null;
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

export function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

export function handle(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      const status = e.status || (e instanceof SyntaxError ? 400 : 500);
      if (status >= 500) console.error(e);
      send(res, status, { error: status >= 500 ? 'ระบบขัดข้อง ลองใหม่อีกครั้ง' : e.message });
    }
  };
}

export const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
export const isUuid = s => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);
