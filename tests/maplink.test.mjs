import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { parseCoord, allowedHost, placeQuery, districtFromText } from '../api/_maplink.js';

test('parseCoord reads common Google Maps link shapes', () => {
  const cases = [
    ['https://www.google.com/maps/place/Siam+Paragon/@13.7462,100.5347,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d13.7465963!4d100.5348363', [13.7465963, 100.5348363]],
    ['https://www.google.com/maps/@13.7563,100.5018,15z', [13.7563, 100.5018]],
    ['https://maps.google.com/?q=13.8,100.6', [13.8, 100.6]],
    ['https://www.google.com/maps/search/13.72,+100.43?entry=tts', [13.72, 100.43]],
    ['https://www.google.com/maps?q=13.7%2C100.5', [13.7, 100.5]],
    ['https://www.google.com/maps/dir/?api=1&destination=13.81,100.55', [13.81, 100.55]],
    ['13.7563, 100.5018', [13.7563, 100.5018]],
    ['13.7563 100.5018', [13.7563, 100.5018]],
  ];
  for (const [input, want] of cases) assert.deepEqual(parseCoord(input), want, input);
  assert.equal(parseCoord('https://maps.app.goo.gl/AbCdEf123'), null);
  assert.equal(parseCoord('หมู่บ้านพฤกษา'), null);
});

test('placeQuery reads the searched name/address from a place link', () => {
  const u = new URL('https://maps.google.com/?q=VOLARE+Italian,+3789+Rama+IV+Rd,+Khlong+Toei,+Bangkok+10110&ftid=0x1:0x2');
  assert.equal(placeQuery(u), 'VOLARE Italian, 3789 Rama IV Rd, Khlong Toei, Bangkok 10110');
  assert.equal(placeQuery(new URL('https://www.google.com/maps/place/Siam+Paragon/')), 'Siam Paragon');
  assert.equal(placeQuery(new URL('https://maps.google.com/?q=13.7,100.5')), null);
});

test('districtFromText finds the เขต and skips the แขวง', async () => {
  assert.equal((await districtFromText('X, 3789 Rama IV Rd, Khwaeng Phra Khanong, Khlong Toei, Bangkok 10110')).c, 1033);
  assert.equal((await districtFromText('ซอยสุขุมวิท 101, แขวงบางจาก, เขตพระโขนง, กรุงเทพมหานคร')).c, 1009);
  assert.equal((await districtFromText('Chatuchak, Bangkok')).c, 1030);
  assert.equal(await districtFromText('Mueang Nonthaburi, Nonthaburi'), null);
});

test('only Google map hosts are allowed', () => {
  for (const h of ['maps.app.goo.gl', 'goo.gl', 'www.google.com', 'google.co.th', 'maps.google.com', 'consent.google.com']) assert.ok(allowedHost(h), h);
  for (const h of ['evil.com', 'google.com.evil.com', 'localhost', '169.254.169.254', 'mygoogle.com']) assert.ok(!allowedHost(h), h);
});

// ---- /api/resolve-map with a fake network ----
const resolve = (await import('../api/resolve-map.js')).default;
async function call(body) {
  const req = Readable.from([JSON.stringify(body)]);
  Object.assign(req, { method: 'POST', headers: {} });
  let status = 0, out = '';
  const res = { statusCode: 0, setHeader() {}, end(s) { status = this.statusCode; out = s; } };
  await resolve(req, res);
  return { status, body: JSON.parse(out) };
}

test('follows a short link through redirects to the coordinates', async () => {
  const hops = [];
  globalThis.fetch = async (url) => {
    hops.push(url);
    if (url.startsWith('https://maps.app.goo.gl/')) return new Response(null, { status: 302, headers: { location: 'https://consent.google.com/ml?continue=' + encodeURIComponent('https://www.google.com/maps/place/X/data=!3d13.75!4d100.65') } });
    throw new Error('unexpected fetch ' + url);
  };
  const r = await call({ url: 'https://maps.app.goo.gl/AbCdEf123' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.lat, r.body.lng], [13.75, 100.65]);
  assert.equal(hops.length, 1, 'consent page is unwrapped without fetching it');
});

test('refuses non-Google links and redirects that leave Google', async () => {
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } });
  assert.equal((await call({ url: 'https://evil.com/x' })).status, 400);
  assert.equal((await call({ url: 'https://maps.app.goo.gl/redirect-out' })).status, 400);
  assert.equal((await call({ url: 'not a url' })).status, 400);
});

test('a place-by-name link falls back to street geocoding, then to the district', async () => {
  const short = 'https://maps.app.goo.gl/Name1';
  const dest = 'https://maps.google.com/?q=Some+Cafe,+12+Rama+IV+Rd,+Khwaeng+Phra+Khanong,+Khlong+Toei,+Bangkok+10110&ftid=0x1:0x2';
  let nominatimCalls = 0;
  globalThis.fetch = async (url) => {
    if (url === short) return new Response(null, { status: 302, headers: { location: dest } });
    if (url.startsWith('https://nominatim.openstreetmap.org/')) {
      nominatimCalls++;
      return Response.json(nominatimCalls === 2 ? [{ lat: '13.7139857', lon: '100.5922150', display_name: 'ถนนพระรามที่ 4' }] : []);
    }
    throw new Error('unexpected fetch ' + url);
  };
  let r = await call({ url: short });
  assert.equal(r.status, 200);
  assert.equal(r.body.precision, 'street');
  assert.deepEqual([r.body.lat, r.body.lng], [13.7139857, 100.592215]);

  globalThis.fetch = async (url) => url.startsWith('https://nominatim') ? Response.json([]) : new Response(null, { status: 302, headers: { location: dest.replace('Some+Cafe', 'Other+Cafe') } });
  r = await call({ url: 'https://maps.app.goo.gl/Name2' });
  assert.equal(r.status, 200);
  assert.equal(r.body.precision, 'district');
  assert.equal(r.body.label, 'เขตคลองเตย');
});

test('saved-list links and name-only links outside Bangkok are refused', async () => {
  globalThis.fetch = async (url) => url.startsWith('https://nominatim') ? Response.json([])
    : new Response(null, { status: 302, headers: { location: url.includes('List') ? 'https://www.google.com/maps/placelists/list/abc' : 'https://maps.google.com/?q=Cafe,+Chiang+Mai' } });
  assert.equal((await call({ url: 'https://maps.app.goo.gl/List1' })).status, 422);
  assert.equal((await call({ url: 'https://maps.app.goo.gl/Cm1' })).status, 422);
});
