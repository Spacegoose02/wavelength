import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { deemixPrefix } from '../src/library.ts';
import { json, seeded } from './helpers.ts';

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

async function fake(handler: (req: IncomingMessage, body: string) => unknown) {
  const seen: string[] = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      seen.push(req.url!);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(handler(req, body) ?? {}));
    });
  });
  servers.push(srv);
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, seen };
}

const ok = (extra: object = {}) => ({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...extra } });

test('deemix queue ids from Deezer links', () => {
  assert.equal(deemixPrefix('https://www.deezer.com/en/album/302127'), 'album_302127_');
  assert.equal(deemixPrefix('https://deezer.com/track/9'), 'track_9_');
  assert.equal(deemixPrefix('https://youtu.be/x'), null);
});

test('an approved request is followed to the library: deemix finishes, Navidrome scans, it is ready', async () => {
  let queueStatus = 'downloading';
  let scans = 0;
  const dz = await fake((req) => {
    if (req.url === '/api/addToQueue') return { result: true, data: { obj: [{ uuid: 'album_302127_9', title: 'Discovery' }] } };
    if (req.url === '/api/getQueue') return { queue: { album_302127_9: { uuid: 'album_302127_9', status: queueStatus }, track_1_9: { uuid: 'track_1_9', status: 'completed' } } };
    return {};
  });
  const nd = await fake((req) => {
    const u = new URL(req.url!, 'http://x');
    if (u.pathname === '/rest/getUser') return ok({ user: { username: u.searchParams.get('username'), adminRole: u.searchParams.get('u') === 'admin' } });
    if (u.pathname === '/rest/startScan') return (scans++, ok({ scanStatus: { scanning: true } }));
    if (u.pathname === '/rest/getScanStatus') return ok({ scanStatus: { scanning: false, count: 10 } });
    return ok();
  });
  const { app, tokens } = await seeded();
  const lib = app.hubLibrary;
  lib.scanDelayMs = 10;
  lib.pollMs = 10;
  await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'deemix', url: dz.url, secrets: { arl: 'x' } } });

  // the scan login must be a Navidrome admin, and only admins with keys.manage can set it
  assert.equal((await json(app, 'PUT', '/api/admin/library/navidrome', { token: tokens.admin, body: { url: nd.url, username: 'mia', password: 'pw' } })).status, 400);
  assert.equal((await json(app, 'PUT', '/api/admin/library/navidrome', { token: tokens.member, body: { url: nd.url, username: 'admin', password: 'pw' } })).status, 403);
  const set = await json(app, 'PUT', '/api/admin/library/navidrome', { token: tokens.admin, body: { url: nd.url, username: 'admin', password: 'nd-secret' } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.deepEqual(set.body.navidrome, { url: nd.url, username: 'admin' });
  assert.ok(!JSON.stringify((await json(app, 'GET', '/api/admin/library', { token: tokens.admin })).body).includes('nd-secret'));

  const r = await json(app, 'POST', '/api/requests', { token: tokens.kid, body: { link: 'https://www.deezer.com/album/302127', kind: 'album', title: 'Discovery', artist: 'Daft Punk' } });
  const id = r.body.request.id;
  const a = await json(app, 'POST', `/api/admin/requests/${id}/approve`, { token: tokens.admin, body: {} });
  assert.equal(a.body.request.status, 'approved');
  assert.equal(a.body.request.readyAt, null);

  // still downloading: nothing changes (the finished track already in the queue doesn't count yet)
  await lib.tick();
  const mine = async () => (await json(app, 'GET', '/api/requests', { token: tokens.kid })).body.requests.find((x: { id: number }) => x.id === id);
  assert.equal((await mine()).downloadedAt, null);

  queueStatus = 'completed';
  await lib.tick();
  assert.ok((await mine()).downloadedAt, 'download finished');
  for (let i = 0; i < 100 && !(await mine()).readyAt; i++) await new Promise((res) => setTimeout(res, 10));
  const done = await mine();
  assert.ok(done.readyAt, 'ready after the scan');
  assert.equal(done.seen, false, 'the requester gets told');
  assert.equal(scans, 1);
  const hit = nd.seen.find((u) => u.startsWith('/rest/startScan'))!;
  assert.ok(!hit.includes('nd-secret'), 'the password never travels in the clear');
});

test('a yt-dlp request is ready as soon as it downloads when the Hub has no Navidrome login', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wl-lib-'));
  const music = join(dir, 'music');
  mkdirSync(music);
  const bin = join(dir, 'yt-dlp');
  writeFileSync(bin, '#!/bin/sh\necho "[wavelength]  100%"\nexit 0\n');
  chmodSync(bin, 0o755);
  const { app, tokens } = await seeded({}, { musicDir: music, ytdlpBin: bin });
  await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'ytdlp', config: { folder: 'From YouTube', format: 'opus' } } });
  const r = await json(app, 'POST', '/api/requests', { token: tokens.kid, body: { link: 'https://www.youtube.com/watch?v=abc', kind: 'video', title: 'Song', artist: 'Band' } });
  await json(app, 'POST', `/api/admin/requests/${r.body.request.id}/approve`, { token: tokens.admin, body: {} });
  let got: { readyAt: number | null; downloadedAt: number | null } | undefined;
  for (let i = 0; i < 100 && !got?.readyAt; i++) {
    await new Promise((res) => setTimeout(res, 20));
    got = (await json(app, 'GET', '/api/requests', { token: tokens.kid })).body.requests[0];
  }
  assert.ok(got?.downloadedAt && got.readyAt);
  assert.equal((await json(app, 'POST', '/api/admin/library/scan', { token: tokens.admin })).status, 409, 'no scan without a login');
});
