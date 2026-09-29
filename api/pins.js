import crypto from 'node:crypto';
import { assertEnv, sha, clientIp, sb, countSince, verifyTurnstile, districtAt, readJson, send, handle, bad, isUuid } from './_lib.js';

const STATUS = new Set(['dry', 'wet', 'unk']);
const PER_HOUR = 5;
const PER_DAY = 20;

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// POST /api/pins   {name, lat, lng, y54, y69, note, turnstileToken} → {pin, token}
// DELETE /api/pins {id, token}                                       → {ok}
export default handle(async (req, res) => {
  assertEnv();
  const ip = clientIp(req);

  if (req.method === 'POST') {
    const b = await readJson(req);
    const name = clean(b.name, 80);
    const note = clean(b.note, 300);
    const lat = Number(b.lat), lng = Number(b.lng);
    const y54 = STATUS.has(b.y54) ? b.y54 : 'unk';
    const y69 = STATUS.has(b.y69) ? b.y69 : 'unk';
    if (!name) throw bad('กรอกชื่อหมู่บ้านก่อน');
    if (y54 === 'unk' && y69 === 'unk') throw bad('เลือกสถานะอย่างน้อย 1 ปี');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw bad('พิกัดไม่ถูกต้อง');
    const district = districtAt(lat, lng);
    if (!district) throw bad('ตอนนี้รับเฉพาะพื้นที่ในกรุงเทพฯ');

    if (!(await verifyTurnstile(b.turnstileToken, ip))) throw bad('ยืนยันว่าไม่ใช่บอทก่อน แล้วกดปักหมุดอีกครั้ง', 403);

    const ipHash = sha('ip:' + ip);
    if (await countSince('pin_meta', 'ip_hash', ipHash, 60) >= PER_HOUR) throw bad(`เพิ่มได้ไม่เกิน ${PER_HOUR} หมุดต่อชั่วโมง`, 429);
    if (await countSince('pin_meta', 'ip_hash', ipHash, 1440) >= PER_DAY) throw bad(`เพิ่มได้ไม่เกิน ${PER_DAY} หมุดต่อวัน`, 429);

    const { data } = await sb('pins?select=id,name,lat,lng,district,y54,y69,note,confirm_count,report_count,created_at', {
      method: 'POST', prefer: 'return=representation',
      body: { name, lat: +lat.toFixed(6), lng: +lng.toFixed(6), district, y54, y69, note },
    });
    const pin = data[0];
    const token = crypto.randomBytes(24).toString('base64url');
    await sb('pin_meta', { method: 'POST', body: { pin_id: pin.id, ip_hash: ipHash, token_hash: sha('tok:' + token) } });
    return send(res, 201, { pin, token });
  }

  if (req.method === 'DELETE') {
    const b = await readJson(req);
    if (!isUuid(b.id) || typeof b.token !== 'string') throw bad('ข้อมูลไม่ครบ');
    const { data } = await sb(`pin_meta?select=pin_id&pin_id=eq.${b.id}&token_hash=eq.${sha('tok:' + b.token)}`);
    if (!data?.length) throw bad('ลบได้เฉพาะหมุดที่คุณปักจากเครื่องนี้', 403);
    await sb(`pins?id=eq.${b.id}`, { method: 'DELETE' });
    return send(res, 200, { ok: true });
  }

  res.setHeader('Allow', 'POST, DELETE');
  send(res, 405, { error: 'Method not allowed' });
});
