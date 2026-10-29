import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, test } from 'node:test';
import { rankFolders } from '../src/slskd.ts';
import { json, seeded } from './helpers.ts';

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

const F = (path: string, size = 30_000_000, bitRate?: number) => ({ filename: path, size, ...(bitRate && { bitRate }) });

/** A stand-in slskd: one search with two people answering, and downloads that finish when told to. */
async function fakeSlskd() {
  const calls: string[] = [];
  const downloads: { id: string; username: string; filename: string; size: number; state: string }[] = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      calls.push(`${req.method} ${req.url} ${req.headers['x-api-key']}`);
      const send = (v: unknown, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(v));
      if (req.headers['x-api-key'] !== 'KEY') return send({}, 401);
      const url = req.url!;
      if (url === '/api/v0/application') return send({ server: { isConnected: true, isLoggedIn: true, username: 'hubuser' } });
      if (url === '/api/v0/searches' && req.method === 'POST') return send({ id: 's1', state: 'InProgress' });
      if (url === '/api/v0/searches/s1') return send({ id: 's1', state: 'Completed, TimedOut', isComplete: true, responseCount: 2 });
      if (url === '/api/v0/searches/s1/responses') {
        return send([
          { username: 'slow', hasFreeUploadSlot: false, uploadSpeed: 10_000, queueLength: 40, files: [F('@@a\\Music\\Daft Punk\\Discovery\\01 One More Time.mp3', 9_000_000, 320)] },
          { username: 'fast', hasFreeUploadSlot: true, uploadSpeed: 5_000_000, queueLength: 0, files: [
            F('@@b\\Daft Punk - Discovery (2001) [FLAC]\\02 Aerodynamic.flac'),
            F('@@b\\Daft Punk - Discovery (2001) [FLAC]\\01 One More Time.flac'),
            F('@@b\\Daft Punk - Discovery (2001) [FLAC]\\cover.jpg', 100_000),
            F('@@b\\Justice\\Cross\\01 Genesis.flac'),
          ] },
        ]);
      }
      if (url === '/api/v0/searches/s1' && req.method === 'DELETE') return send({});
      const m = /^\/api\/v0\/transfers\/downloads\/(.+)$/.exec(url);
      if (m && req.method === 'POST') {
        for (const f of JSON.parse(body)) downloads.push({ id: `t${downloads.length}`, username: decodeURIComponent(m[1]), filename: f.filename, size: f.size, state: 'Queued, Remotely' });
        return send({}, 201);
      }
      if (url === '/api/v0/transfers/downloads') {
        const users = [...new Set(downloads.map((d) => d.username))];
        return send(users.map((u) => ({ username: u, directories: [{ directory: 'x', files: downloads.filter((d) => d.username === u) }] })));
      }
      send({}, 404);
    });
  });
  servers.push(srv);
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, calls, downloads };
}

test('people who may download search Soulseek and download a folder through the Hub', async () => {
  const sl = await fakeSlskd();
  const { app, db, tokens } = await seeded();
  // not set up yet
  assert.equal((await json(app, 'POST', '/api/slskd/searches', { token: tokens.admin, body: { query: 'daft punk discovery' } })).status, 404);
  const svc = await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'slskd', url: sl.url, secrets: { apiKey: 'KEY' } } });
  assert.equal(svc.status, 200, JSON.stringify(svc.body));
  // the key never goes to a device
  const mine = (await json(app, 'GET', '/api/me/services', { token: tokens.admin })).body.services.find((s: { kind: string }) => s.kind === 'slskd');
  assert.ok(mine && !JSON.stringify(mine).includes('KEY'));

  assert.equal((await json(app, 'POST', '/api/slskd/test', { token: tokens.admin })).body.message, 'Connected to Soulseek as hubuser');
  assert.equal((await json(app, 'POST', '/api/slskd/searches', { token: tokens.member, body: { query: 'daft punk discovery' } })).status, 403);

  const s = await json(app, 'POST', '/api/slskd/searches', { token: tokens.admin, body: { query: 'daft punk discovery' } });
  assert.deepEqual(s.body, { id: 's1' });
  const r = await json(app, 'GET', '/api/slskd/searches/s1', { token: tokens.admin });
  assert.equal(r.body.done, true);
  const [best, ...rest] = r.body.folders;
  assert.equal(best.username, 'fast');
  assert.equal(best.name, 'Daft Punk - Discovery (2001) [FLAC]');
  assert.deepEqual(best.files.map((f: { name: string }) => f.name), ['01 One More Time.flac', '02 Aerodynamic.flac'], 'music only, in order');
  assert.equal(best.lossless, true);
  assert.equal(best.format, 'FLAC');
  assert.ok(rest.some((f: { username: string }) => f.username === 'slow'));
  assert.equal(rest.at(-1).name, 'Justice / Cross', 'a folder without the words searched for comes last');

  const dl = await json(app, 'POST', '/api/slskd/downloads', { token: tokens.admin, body: { username: 'fast', files: best.files, label: best.name } });
  assert.deepEqual(dl.body, { ok: true, files: 2 });
  assert.equal(sl.downloads.length, 2);
  sl.downloads[0].state = 'Completed, Succeeded';
  const list = (await json(app, 'GET', '/api/slskd/downloads', { token: tokens.admin })).body.downloads;
  assert.equal(list[0].name, 'Daft Punk - Discovery (2001) [FLAC]');
  assert.equal(list[0].done, 1);
  assert.equal(list[0].state, 'Queued, Remotely');
  assert.ok(db.prepare("SELECT 1 FROM audit WHERE action = 'slskd.download'").get());
  assert.ok(sl.calls.every((c) => c.endsWith(' KEY')), 'every call carries the API key');
});

test('an admin fills a request from Soulseek, and it’s ready once the files arrive', async () => {
  const sl = await fakeSlskd();
  const { app, tokens } = await seeded();
  await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'slskd', url: sl.url, secrets: { apiKey: 'KEY' } } });
  const req = (await json(app, 'POST', '/api/requests', { token: tokens.kid, body: { link: 'https://www.deezer.com/album/302127', kind: 'album', title: 'Discovery', artist: 'Daft Punk' } })).body.request;
  const files = [{ filename: '@@b\\Daft Punk - Discovery\\01.flac', size: 1 }, { filename: '@@b\\Daft Punk - Discovery\\02.flac', size: 2 }];
  const ok = await json(app, 'POST', `/api/admin/requests/${req.id}/approve`, { token: tokens.admin, body: { slskd: { username: 'fast', files } } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.request.status, 'approved');
  assert.equal(ok.body.request.via, 'slskd');

  const lib = app.hubLibrary;
  const status = async () => (await json(app, 'GET', '/api/requests', { token: tokens.kid })).body.requests[0];
  await lib.slskdTick();
  assert.equal((await status()).downloadedAt, null, 'still downloading');
  sl.downloads.forEach((d) => (d.state = 'Completed, Succeeded'));
  await lib.slskdTick();
  const done = await status();
  assert.ok(done.downloadedAt, 'downloaded');
  // no Navidrome login on this Hub: ready straight away
  assert.ok(done.readyAt);

  // all files refused: the request fails with why
  const req2 = (await json(app, 'POST', '/api/requests', { token: tokens.kid, body: { link: 'https://www.deezer.com/album/1', kind: 'album', title: 'Homework', artist: 'Daft Punk' } })).body.request;
  await json(app, 'POST', `/api/admin/requests/${req2.id}/approve`, { token: tokens.admin, body: { slskd: { username: 'other', files: [{ filename: 'x\\a.flac', size: 1 }] } } });
  sl.downloads.at(-1)!.state = 'Completed, Rejected';
  await lib.slskdTick();
  const failed = (await json(app, 'GET', '/api/requests', { token: tokens.kid })).body.requests.find((x: { id: number }) => x.id === req2.id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.reason, /rejected/);
  assert.equal((await json(app, 'POST', `/api/admin/requests/${req2.id}/approve`, { token: tokens.admin, body: { slskd: { username: 'x', files: [] } } })).status, 400);
});

test('ranking prefers the folder that matches, with a free slot', () => {
  const folders = rankFolders([
    { username: 'a', hasFreeUploadSlot: false, files: [F('x\\Discovery\\1.mp3', 1, 128)] },
    { username: 'b', hasFreeUploadSlot: true, files: [F('y\\Daft Punk\\Discovery\\1.flac'), F('y\\Daft Punk\\Discovery\\locked.flac')].map((f, i) => ({ ...f, isLocked: i === 1 })) },
  ], 'Daft Punk – Discovery');
  assert.deepEqual(folders.map((f) => [f.username, f.files.length]), [['b', 1], ['a', 1]]);
});
