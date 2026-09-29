import { assertEnv, sha, clientIp, sb, countSince, readJson, send, handle, bad, isUuid } from './_lib.js';

const PER_HOUR = 60;

// POST /api/vote {pinId, kind: 'confirm'|'report'} → {confirm_count, report_count, hidden}
// One vote per person per pin; voting again switches the vote.
export default handle(async (req, res) => {
  assertEnv();
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'Method not allowed' }); }

  const b = await readJson(req);
  if (!isUuid(b.pinId) || !['confirm', 'report'].includes(b.kind)) throw bad('ข้อมูลไม่ครบ');

  const voter = sha('ip:' + clientIp(req));
  if (await countSince('votes', 'voter_hash', voter, 60) >= PER_HOUR) throw bad('โหวตถี่เกินไป ลองใหม่ภายหลัง', 429);

  const { data: exists } = await sb(`pins?select=id&id=eq.${b.pinId}`);
  if (!exists?.length) throw bad('ไม่พบหมุดนี้', 404);

  await sb('votes?on_conflict=pin_id,voter_hash', {
    method: 'POST', prefer: 'resolution=merge-duplicates',
    body: { pin_id: b.pinId, voter_hash: voter, kind: b.kind, created_at: new Date().toISOString() },
  });
  const { data } = await sb(`pins?select=confirm_count,report_count,hidden&id=eq.${b.pinId}`);
  send(res, 200, data[0]);
});
