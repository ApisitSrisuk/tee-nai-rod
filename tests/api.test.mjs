// API tests against an in-memory fake of the Supabase REST endpoints.
// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.HASH_SALT = 'salt';
delete process.env.TURNSTILE_SECRET;

// ---- fake PostgREST ----
const db = { pins: [], pin_meta: [], votes: [] };
let seq = 0;
function filterRows(rows, params) {
  return rows.filter(r => [...params].every(([k, v]) => {
    if (['select', 'limit', 'on_conflict', 'order'].includes(k)) return true;
    const [op, val] = [v.slice(0, v.indexOf('.')), v.slice(v.indexOf('.') + 1)];
    if (op === 'eq') return String(r[k]) === val;
    if (op === 'gte') return String(r[k]) >= val;
    return true;
  }));
}
function recount(pinId) {
  const p = db.pins.find(p => p.id === pinId); if (!p) return;
  p.confirm_count = db.votes.filter(v => v.pin_id === pinId && v.kind === 'confirm').length;
  p.report_count = db.votes.filter(v => v.pin_id === pinId && v.kind === 'report').length;
  p.hidden = p.report_count >= 3 && p.report_count > p.confirm_count * 2;
}
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const table = u.pathname.split('/').pop();
  const rows = db[table];
  const method = init.method || 'GET';
  const json = (status, body, headers = {}) => new Response(body == null ? null : JSON.stringify(body), { status, headers });
  if (method === 'GET') {
    const out = filterRows(rows, u.searchParams);
    return json(200, out, { 'content-range': `0-${out.length - 1}/${out.length}` });
  }
  if (method === 'POST') {
    const body = JSON.parse(init.body);
    if (table === 'pins') {
      const row = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, confirm_count: 0, report_count: 0, hidden: false, created_at: new Date().toISOString(), ...body };
      rows.push(row); return json(201, [row]);
    }
    if (table === 'votes') {
      const i = rows.findIndex(v => v.pin_id === body.pin_id && v.voter_hash === body.voter_hash);
      if (i >= 0) rows[i] = body; else rows.push(body);
      recount(body.pin_id); return json(201, null);
    }
    rows.push({ created_at: new Date().toISOString(), ...body }); return json(201, null);
  }
  if (method === 'DELETE') {
    const del = filterRows(rows, u.searchParams);
    db[table] = rows.filter(r => !del.includes(r));
    if (table === 'pins') { db.pin_meta = db.pin_meta.filter(m => !del.some(p => p.id === m.pin_id)); db.votes = db.votes.filter(v => !del.some(p => p.id === v.pin_id)); }
    return json(204, null);
  }
};

const pins = (await import('../api/pins.js')).default;
const vote = (await import('../api/vote.js')).default;

async function call(handler, method, body, ip = '1.1.1.1') {
  const req = Readable.from([JSON.stringify(body)]);
  Object.assign(req, { method, headers: { 'x-forwarded-for': ip } });
  let status = 0, out = '';
  const res = { statusCode: 0, setHeader() {}, end(s) { status = this.statusCode; out = s; } };
  await handler(req, res);
  return { status, body: JSON.parse(out) };
}
const good = { name: 'หมู่บ้านทดสอบ', lat: 13.7465, lng: 100.653, y54: 'dry', y69: 'dry', note: 'น้ำไม่เข้า' };

test('adds a pin inside Bangkok and assigns its district', async () => {
  const r = await call(pins, 'POST', good);
  assert.equal(r.status, 201);
  assert.equal(r.body.pin.district, 1006); // บางกะปิ
  assert.ok(r.body.token.length > 20);
  assert.equal(db.pin_meta.length, 1);
  assert.notEqual(db.pin_meta[0].ip_hash, '1.1.1.1', 'IP must be hashed');
});

test('rejects a pin outside Bangkok', async () => {
  const r = await call(pins, 'POST', { ...good, lat: 13.95, lng: 100.2 });
  assert.equal(r.status, 400);
});

test('rejects missing name and all-unknown status', async () => {
  assert.equal((await call(pins, 'POST', { ...good, name: '   ' })).status, 400);
  assert.equal((await call(pins, 'POST', { ...good, y54: 'unk', y69: 'nope' })).status, 400);
});

test('strips control characters and caps lengths', async () => {
  const r = await call(pins, 'POST', { ...good, name: 'a\u0000b'.padEnd(200, 'x'), note: 'n'.repeat(999) }, '2.2.2.2');
  assert.equal(r.status, 201);
  assert.equal(r.body.pin.name.length, 80);
  assert.ok(!r.body.pin.name.includes('\u0000'));
  assert.equal(r.body.pin.note.length, 300);
});

test('rate-limits to 5 pins per hour per IP', async () => {
  const ip = '3.3.3.3';
  for (let i = 0; i < 5; i++) assert.equal((await call(pins, 'POST', good, ip)).status, 201);
  assert.equal((await call(pins, 'POST', good, ip)).status, 429);
});

test('only the creator token can delete a pin', async () => {
  const { body } = await call(pins, 'POST', good, '4.4.4.4');
  assert.equal((await call(pins, 'DELETE', { id: body.pin.id, token: 'wrong' })).status, 403);
  assert.equal((await call(pins, 'DELETE', { id: body.pin.id, token: body.token })).status, 200);
  assert.ok(!db.pins.some(p => p.id === body.pin.id));
});

test('votes are one per person and three reports hide a pin', async () => {
  const { body } = await call(pins, 'POST', good, '5.5.5.5');
  const id = body.pin.id;
  let r = await call(vote, 'POST', { pinId: id, kind: 'confirm' }, '9.0.0.1');
  assert.deepEqual([r.body.confirm_count, r.body.report_count], [1, 0]);
  r = await call(vote, 'POST', { pinId: id, kind: 'confirm' }, '9.0.0.1');
  assert.equal(r.body.confirm_count, 1, 'same person voting twice counts once');
  r = await call(vote, 'POST', { pinId: id, kind: 'report' }, '9.0.0.1');
  assert.deepEqual([r.body.confirm_count, r.body.report_count], [0, 1], 'switching vote');
  await call(vote, 'POST', { pinId: id, kind: 'report' }, '9.0.0.2');
  r = await call(vote, 'POST', { pinId: id, kind: 'report' }, '9.0.0.3');
  assert.equal(r.body.hidden, true);
});

test('vote rejects bad input', async () => {
  assert.equal((await call(vote, 'POST', { pinId: 'x', kind: 'confirm' })).status, 400);
  assert.equal((await call(vote, 'POST', { pinId: '00000000-0000-4000-8000-999999999999', kind: 'confirm' })).status, 404);
});
