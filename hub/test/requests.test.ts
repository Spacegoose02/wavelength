import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, test } from 'node:test';
import { json, seeded } from './helpers.ts';

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

/** A stand-in deemix that is always logged in; records what was queued. */
async function fakeDeemix() {
  const queued: { url: string; bitrate: number }[] = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      if (req.url === '/api/addToQueue') queued.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ result: true }));
    });
  });
  servers.push(srv);
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, queued };
}

const SONG = { link: 'https://www.deezer.com/track/3135556', kind: 'track', title: 'Harder, Better, Faster, Stronger', artist: 'Daft Punk' };

test('a request waits for an admin, who approves it and the Hub downloads it', async () => {
  const dz = await fakeDeemix();
  const { app, tokens } = await seeded();
  await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'deemix', url: dz.url, secrets: { arl: 'x' }, config: { bitrate: 3 } } });

  const r = await json(app, 'POST', '/api/requests', { token: tokens.kid, body: { ...SONG, note: 'for my party' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.request.status, 'pending');
  assert.equal(dz.queued.length, 0, 'nothing downloads before an admin says yes');
  const again = await json(app, 'POST', '/api/requests', { token: tokens.kid, body: SONG });
  assert.equal(again.body.request.id, r.body.request.id, 'asking twice keeps one request');

  assert.equal((await json(app, 'GET', '/api/requests/counts', { token: tokens.admin })).body.pending, 1);
  assert.equal((await json(app, 'GET', '/api/admin/requests', { token: tokens.member })).status, 403);
  assert.equal((await json(app, 'POST', `/api/admin/requests/${r.body.request.id}/approve`, { token: tokens.member })).status, 403);
  const queue = (await json(app, 'GET', '/api/admin/requests', { token: tokens.admin })).body.requests;
  assert.equal(queue.length, 1);
  assert.equal(queue[0].username, 'kit');
  assert.equal(queue[0].note, 'for my party');

  const a = await json(app, 'POST', `/api/admin/requests/${r.body.request.id}/approve`, { token: tokens.admin, body: {} });
  assert.equal(a.body.request.status, 'approved');
  assert.equal(a.body.request.via, 'deemix');
  assert.deepEqual(dz.queued.at(-1), { url: SONG.link, bitrate: 3 });

  // the kid sees the answer once
  assert.equal((await json(app, 'GET', '/api/requests/counts', { token: tokens.kid })).body.unseen, 1);
  const mine = (await json(app, 'GET', '/api/requests', { token: tokens.kid })).body.requests;
  assert.equal(mine[0].decidedBy, 'boss');
  await json(app, 'POST', '/api/requests/seen', { token: tokens.kid, body: {} });
  assert.equal((await json(app, 'GET', '/api/requests/counts', { token: tokens.kid })).body.unseen, 0);
  assert.equal((await json(app, 'GET', '/api/requests', { token: tokens.member })).body.requests.length, 0, 'you only see your own');

  const log = JSON.stringify((await json(app, 'GET', '/api/admin/audit', { token: tokens.admin })).body);
  assert.ok(log.includes('request.created') && log.includes('request.approved'));
});

test('reject, already have, cancel, and a failed download', async () => {
  const { app, tokens } = await seeded();
  const mk = async (n: number) => (await json(app, 'POST', '/api/requests', { token: tokens.member, body: { ...SONG, link: `${SONG.link}${n}` } })).body.request.id as number;
  const [a, b, c, d] = [await mk(1), await mk(2), await mk(3), await mk(4)];

  const rj = await json(app, 'POST', `/api/admin/requests/${a}/reject`, { token: tokens.admin, body: { reason: 'Not on Deezer' } });
  assert.equal(rj.body.request.status, 'rejected');
  assert.equal(rj.body.request.reason, 'Not on Deezer');
  assert.equal((await json(app, 'POST', `/api/admin/requests/${b}/have`, { token: tokens.admin })).body.request.status, 'have');

  assert.equal((await json(app, 'DELETE', `/api/requests/${c}`, { token: tokens.kid })).status, 404, 'not yours');
  assert.equal((await json(app, 'DELETE', `/api/requests/${c}`, { token: tokens.member })).status, 200);
  assert.equal((await json(app, 'DELETE', `/api/requests/${a}`, { token: tokens.member })).status, 409, 'decided ones stay');

  // no deemix on this Hub: approving records why it failed, and can be retried later
  const f = await json(app, 'POST', `/api/admin/requests/${d}/approve`, { token: tokens.admin });
  assert.equal(f.body.request.status, 'failed');
  assert.match(f.body.request.reason, /deemix/);

  const mine = (await json(app, 'GET', '/api/requests', { token: tokens.member })).body.requests;
  assert.deepEqual(mine.map((r: { status: string }) => r.status).sort(), ['failed', 'have', 'rejected']);
  assert.equal((await json(app, 'GET', '/api/admin/requests?status=failed', { token: tokens.admin })).body.requests.length, 1);
});

test('people with Autodownload skip the queue', async () => {
  const dz = await fakeDeemix();
  const { app, tokens, ids } = await seeded();
  await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'deemix', url: dz.url, secrets: { arl: 'x' } } });
  await json(app, 'PATCH', `/api/admin/users/${ids.member}`, { token: tokens.admin, body: { autodownload: true } });
  const r = await json(app, 'POST', '/api/requests', { token: tokens.member, body: SONG });
  assert.equal(r.body.request.status, 'approved');
  assert.equal(r.body.request.seen, true);
  assert.equal(dz.queued.length, 1);

  assert.equal((await json(app, 'POST', '/api/requests', { token: tokens.kid, body: { ...SONG, link: 'javascript:alert(1)' } })).status, 400);
  assert.equal((await json(app, 'POST', '/api/requests', { body: SONG })).status, 401);
});
