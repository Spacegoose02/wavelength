import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { readTags } from '../src/tags.ts';
import { numberedTitle } from '../src/trackTitles.ts';
import { json, seeded } from './helpers.ts';

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

function audio(file: string, tags: Record<string, string>) {
  const meta = Object.entries(tags).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '1', '-c:a', 'libmp3lame', '-b:a', '64k', ...meta, '-y', file]);
}

async function listen(handler: (url: string) => [number, unknown, Record<string, string>?]) {
  const srv = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const [status, v, headers] = handler(req.url!);
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(v));
    });
  });
  servers.push(srv);
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  return `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
}

test('the Hub takes the same leading numbers for track numbers as the app', () => {
  assert.deepEqual(numberedTitle('04 - God’s Plan', 4), { number: 4, title: 'God’s Plan' });
  assert.deepEqual(numberedTitle('01 - Back to Back (Twitch Tapes)', 7), { number: 1, title: 'Back to Back (Twitch Tapes)' }, 'a padded number with a separator, whatever the track');
  assert.deepEqual(numberedTitle('4. Song', 4), { number: 4, title: 'Song' });
  assert.equal(numberedTitle('4. Song', 5), undefined);
  assert.equal(numberedTitle('7 Rings', 7), undefined);
  assert.equal(numberedTitle('99 Problems'), undefined);
  assert.equal(numberedTitle('1-800-273-8255', 1), undefined);
});

test('numbered titles come from Navidrome’s song list, a page at a time, and a big fix is one Save in parts', async () => {
  const music = mkdtempSync(join(tmpdir(), 'wl-numbered-'));
  mkdirSync(join(music, 'A/B'), { recursive: true });
  audio(join(music, 'A/B/01.mp3'), { title: '01 - One', track: '1' });
  audio(join(music, 'A/B/02.mp3'), { title: '02 - Two', track: '2' });
  audio(join(music, 'A/B/03.mp3'), { title: '7 Rings', track: '3' });
  const all = [
    { id: 's1', albumId: 'ab', album: 'B', albumArtist: 'A', artist: 'A', path: '/music/A/B/01.mp3', title: '01 - One', trackNumber: 1 },
    { id: 's2', albumId: 'ab', album: 'B', albumArtist: 'A', artist: 'A', path: '/music/A/B/02.mp3', title: '02 - Two', trackNumber: 2 },
    { id: 's3', albumId: 'ab', album: 'B', albumArtist: 'A', artist: 'A', path: '/music/A/B/03.mp3', title: '7 Rings', trackNumber: 3 },
  ];
  const nd = await listen((url) => {
    if (url === '/auth/login') return [200, { token: 'jwt', isAdmin: true }];
    if (url.startsWith('/rest/')) return [200, { 'subsonic-response': { status: 'ok', user: { adminRole: true } } }];
    if (url.startsWith('/api/song?')) {
      const q = new URLSearchParams(url.split('?')[1]);
      return [200, all.slice(Number(q.get('_start')), Number(q.get('_end'))), { 'x-total-count': String(all.length) }];
    }
    return [404, {}];
  });
  const { app, tokens } = await seeded({}, { musicDir: music });
  assert.equal((await json(app, 'GET', '/api/admin/tags/numbered', { token: tokens.member })).status, 403);
  assert.equal((await json(app, 'PUT', '/api/admin/library/navidrome', { token: tokens.admin, body: { url: nd, username: 'admin', password: 'pw' } })).status, 200);

  const p1 = await json(app, 'GET', '/api/admin/tags/numbered?offset=0&limit=2', { token: tokens.admin });
  assert.equal(p1.status, 200, JSON.stringify(p1.body));
  assert.deepEqual(p1.body, {
    fixes: [
      { path: 'A/B/01.mp3', albumId: 'ab', artist: 'A', album: 'B', from: '01 - One', to: 'One' },
      { path: 'A/B/02.mp3', albumId: 'ab', artist: 'A', album: 'B', from: '02 - Two', to: 'Two' },
    ],
    scanned: 2,
    total: 3,
  });
  const p2 = await json(app, 'GET', '/api/admin/tags/numbered?offset=2&limit=2', { token: tokens.admin });
  assert.deepEqual(p2.body, { fixes: [], scanned: 1, total: 3 }, '"7 Rings" stays');

  // two requests, one Save
  assert.equal((await json(app, 'PUT', '/api/admin/tags', { token: tokens.admin, body: { batch: 'nope', changes: [{ path: 'A/B/01.mp3', tags: { title: 'One' } }] } })).status, 400);
  const batch = '0123456789abcdef';
  for (const f of p1.body.fixes) {
    const r = await json(app, 'PUT', '/api/admin/tags', { token: tokens.admin, body: { label: 'Track numbers taken out of titles', batch, changes: [{ path: f.path, tags: { title: f.to } }] } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.batch, batch);
  }
  assert.equal((await readTags(join(music, 'A/B/02.mp3'))).title, 'Two');
  const hist = (await json(app, 'GET', '/api/admin/tags/history', { token: tokens.admin })).body.edits;
  assert.deepEqual(hist.map((e: { batch: string; files: number }) => [e.batch, e.files]), [[batch, 2]]);
  assert.equal((await json(app, 'POST', `/api/admin/tags/undo/${batch}`, { token: tokens.admin })).body.undone, 2);
  assert.equal((await readTags(join(music, 'A/B/01.mp3'))).title, '01 - One');
});

test('a scan signs in to Navidrome once, not once a page (Navidrome limits sign-ins and answers 429)', async () => {
  const music = mkdtempSync(join(tmpdir(), 'wl-numbered-'));
  const all = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, albumId: 'ab', album: 'B', albumArtist: 'A', artist: 'A', path: `/music/A/B/${i}.mp3`, title: `Song ${i}`, trackNumber: i + 1 }));
  let logins = 0;
  const nd = await listen((url) => {
    // like Navidrome's AuthRequestLimit, but tighter
    if (url === '/auth/login') return ++logins > 3 ? [429, {}] : [200, { token: 'jwt', isAdmin: true }];
    if (url.startsWith('/rest/')) return [200, { 'subsonic-response': { status: 'ok', user: { adminRole: true } } }];
    if (url.startsWith('/api/song?')) {
      const q = new URLSearchParams(url.split('?')[1]);
      return [200, all.slice(Number(q.get('_start')), Number(q.get('_end'))), { 'x-total-count': String(all.length) }];
    }
    return [404, {}];
  });
  const { app, tokens } = await seeded({}, { musicDir: music });
  assert.equal((await json(app, 'PUT', '/api/admin/library/navidrome', { token: tokens.admin, body: { url: nd, username: 'admin', password: 'pw' } })).status, 200);
  for (let offset = 0; offset < all.length; offset += 2) {
    const r = await json(app, 'GET', `/api/admin/tags/numbered?offset=${offset}&limit=2`, { token: tokens.admin });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  assert.ok(logins <= 2, `signed in ${logins} times`);

  // a Navidrome that turns sign-ins away says so, rather than calling the login wrong
  const busy = await listen((url) => (url === '/auth/login' ? [429, {}] : [200, { 'subsonic-response': { status: 'ok', user: { adminRole: true } } }]));
  assert.equal((await json(app, 'PUT', '/api/admin/library/navidrome', { token: tokens.admin, body: { url: busy, username: 'admin', password: 'pw' } })).status, 200);
  const r = await json(app, 'GET', '/api/admin/tags/numbered', { token: tokens.admin });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /too many in a row/);
});
