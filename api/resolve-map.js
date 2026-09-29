import { send, handle, bad, readJson, districtAt } from './_lib.js';
import { parseCoord, allowedHost, placeQuery, districtFromText } from './_maplink.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const NOMINATIM_UA = 'TeeNaiRod/1.0 (Bangkok flood map; https://github.com/)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cache = new Map();

// POST /api/resolve-map {url}
//   → {lat, lng, precision: 'exact'|'street'|'district', label?}
// 1. coordinates in the link (or in any redirect hop)       → exact
// 2. a place link with only a name/address (?q=…):
//    geocode the address with OpenStreetMap Nominatim     → street
//    else match a Bangkok district named in the address   → district
// Google renders place coordinates client-side, so the page HTML is never trusted.
export default handle(async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'Method not allowed' }); }
  const { url } = await readJson(req);
  let u;
  try { u = new URL(String(url || '').trim()); } catch { throw bad('ลิงก์ไม่ถูกต้อง'); }

  let query = null;
  for (let hop = 0; hop < 6; hop++) {
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw bad('ลิงก์ไม่ถูกต้อง');
    if (!allowedHost(u.hostname)) throw bad('รองรับเฉพาะลิงก์ Google Maps');

    const found = parseCoord(u.href);
    if (found) return send(res, 200, { lat: found[0], lng: found[1], precision: 'exact' });
    if (/\/placelists?\//.test(u.pathname)) throw bad('ลิงก์นี้เป็นรายการหลายสถานที่ ใช้ลิงก์ของสถานที่เดียว', 422);
    query = placeQuery(u) || query;
    if (/^consent\./.test(u.hostname) && u.searchParams.get('continue')) { u = new URL(u.searchParams.get('continue')); continue; }
    if (query) break; // a place-by-name link: its page has no coordinates, so stop following

    const r = await fetch(u.href, { redirect: 'manual', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) });
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) { u = new URL(loc, u); continue; }
    break;
  }

  if (query) {
    const hit = await geocode(query);
    if (hit) return send(res, 200, hit);
  }
  throw bad('ลิงก์นี้ไม่มีพิกัด ลองเปิด Google Maps แล้วกดค้างตรงบ้านเพื่อปักหมุด แล้วแชร์ลิงก์ของหมุดนั้นแทน', 422);
});

async function geocode(query) {
  if (cache.has(query)) return cache.get(query);
  const parts = query.split(',').map(s => s.trim()).filter(Boolean);
  const tries = [];
  if (parts.length > 1) {
    const rest = parts.slice(1);                         // drop the place name
    tries.push(rest.join(', '));
    // simpler form: no house number, no แขวง, no postcode — Nominatim matches streets better this way
    const simple = [rest[0].replace(/^[\d/\-\s]+/, ''), ...rest.slice(1).filter(s => !/^(khwaeng|แขวง)/i.test(s))]
      .map(s => s.replace(/\s*\d{5}\s*$/, '')).filter(Boolean);
    if (simple.join() !== rest.join()) tries.push(simple.join(', '));
  } else tries.push(query);

  let result = null;
  for (let i = 0; i < Math.min(tries.length, 2) && !result; i++) {
    if (i) await sleep(1100); // Nominatim usage policy: max 1 request per second
    try {
      const qs = new URLSearchParams({ q: tries[i], format: 'jsonv2', limit: '1', countrycodes: 'th' });
      const r = await fetch(`https://nominatim.openstreetmap.org/search?${qs}`, { headers: { 'User-Agent': NOMINATIM_UA, 'Accept-Language': 'th,en' }, signal: AbortSignal.timeout(5000) });
      const [hit] = r.ok ? await r.json() : [];
      if (hit && districtAt(+hit.lat, +hit.lon)) result = { lat: +hit.lat, lng: +hit.lon, precision: 'street', label: hit.display_name };
    } catch { /* fall through to district match */ }
  }
  if (!result) {
    const d = await districtFromText(query);
    if (d) result = { lat: d.lat, lng: d.lng, precision: 'district', label: 'เขต' + d.n };
  }
  if (result) cache.set(query, result);
  return result;
}
