import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { json, seeded } from './helpers.ts';
import { makeZip, unzip } from './zipHelpers.ts';

const ARL = 'arl-only-the-hub-knows';
const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

/** A tiny HTTP server; returns its base URL and the requests it saw. */
async function fake(handler: (req: IncomingMessage, body: string) => { status?: number; body?: unknown; raw?: Buffer; headers?: Record<string, string> }, encoding: BufferEncoding = 'utf8') {
  const seen: { method: string; url: string; headers: IncomingMessage['headers']; body: string }[] = [];
  const srv = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (d: Buffer) => chunks.push(d));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString(encoding);
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      const r = handler(req, body);
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json', ...r.headers });
      res.end(r.raw ?? JSON.stringify(r.body ?? {}));
    });
  });
  servers.push(srv);
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, seen };
}

test('SUB/WAVE admin calls go through the Hub with the saved login', async () => {
  const sw = await fake((req) => (req.url === '/api/locked' ? { status: 401 } : { body: { ok: true, path: req.url } }));
  const { app, tokens } = await seeded();
  const { body } = await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'subwave', name: 'Radio', url: sw.url, secrets: { username: 'dj', password: 'sw-pass', token: 'station' } } });
  const id = body.service.id;

  const r = await json(app, 'POST', `/api/admin/subwave/${id}/dj/say`, { token: tokens.admin, body: { text: 'hello', mode: 'raw' } });
  assert.equal(r.status, 200);
  const hit = sw.seen.at(-1)!;
  assert.equal(hit.url, '/api/dj/say');
  assert.equal(hit.headers.authorization, `Basic ${Buffer.from('dj:sw-pass').toString('base64')}`);
  assert.equal(hit.headers['x-station-auth'], 'station');
  assert.deepEqual(JSON.parse(hit.body), { text: 'hello', mode: 'raw' });

  const q = await json(app, 'GET', `/api/admin/subwave/${id}/dj/search?q=abba`, { token: tokens.admin });
  assert.equal(q.body.path, '/api/dj/search?q=abba', 'query string is passed on');

  for (const who of ['member', 'kid'] as const) assert.equal((await json(app, 'POST', `/api/admin/subwave/${id}/dj/skip`, { token: tokens[who], body: {} })).status, 403);
  const before = sw.seen.length;
  assert.equal((await json(app, 'GET', `/api/admin/subwave/${id}/..%2f..%2fetc`, { token: tokens.admin })).status, 400, 'cannot climb out of the API');
  assert.equal(sw.seen.length, before);
  assert.equal((await json(app, 'GET', `/api/admin/subwave/${id}/locked`, { token: tokens.admin })).status, 502, 'a rejected login is the Hub’s problem, not a sign-out');

  const log = JSON.stringify((await json(app, 'GET', '/api/admin/audit', { token: tokens.admin })).body);
  assert.ok(log.includes('subwave.admin') && log.includes('dj/say'));
  assert.ok(!log.includes('sw-pass'));
});

test('SUB/WAVE station admin: PATCH is passed on and an archive hour comes back as audio', async () => {
  const mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4]);
  const sw = await fake((req) =>
    req.url === '/api/archives/file/2026-11-09/14.mp3'
      ? { raw: mp3, headers: { 'content-type': 'audio/mpeg', 'content-disposition': 'attachment; filename="2026-11-09_14.mp3"' } }
      : { body: { ok: true, method: req.method } },
  );
  const { app, tokens } = await seeded();
  const { body } = await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'subwave', name: 'Radio', url: sw.url, secrets: { username: 'dj', password: 'sw-pass' } } });
  const id = body.service.id;

  const r = await json(app, 'PATCH', `/api/admin/subwave/${id}/stations/side`, { token: tokens.admin, body: { name: 'Side B' } });
  assert.equal(r.status, 200);
  assert.equal(sw.seen.at(-1)!.method, 'PATCH');
  assert.deepEqual(JSON.parse(sw.seen.at(-1)!.body), { name: 'Side B' });

  const f = await app.inject({ method: 'GET', url: `/api/admin/subwave/${id}/archives/file/2026-11-09/14.mp3`, headers: { authorization: `Bearer ${tokens.admin}` } });
  assert.equal(f.statusCode, 200);
  assert.match(String(f.headers['content-type']), /^audio\/mpeg/);
  assert.match(String(f.headers['content-disposition']), /2026-11-09_14\.mp3/);
  assert.deepEqual(f.rawPayload, mp3, 'the bytes arrive untouched');
  assert.equal((await app.inject({ method: 'GET', url: `/api/admin/subwave/${id}/archives/file/2026-11-09/14.mp3`, headers: { authorization: `Bearer ${tokens.member}` } })).statusCode, 403);
});

test('copying a SUB/WAVE station restores the first one\'s backup into the second and keeps its name', async () => {
  const zip = Buffer.from('PK\u0003\u0004 fake backup zip');
  const a = await fake((req) => (req.url === '/api/backup/export' ? { raw: zip, headers: { 'content-type': 'application/zip' } } : { body: {} }));
  const b = await fake((req) => {
    if (req.method === 'GET' && req.url === '/api/settings') return { body: { values: { station: 'Side B', stationDescription: 'the other one', personas: [] } } };
    if (req.url === '/api/backup/import') return { body: { ok: true, restored: ['settings.json', 'persona-avatars', 'library.db'], skipped: [], requiresRestart: true } };
    return { body: { ok: true } };
  });
  const { app, tokens } = await seeded();
  const add = async (name: string, url: string) => (await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'subwave', name, url, secrets: { username: 'dj', password: `${name}-pass` } } })).body.service.id;
  const from = await add('Main', a.url);
  const to = await add('Side', b.url);

  for (const who of ['member', 'kid'] as const) assert.equal((await json(app, 'POST', `/api/admin/subwave-copy/${from}/${to}`, { token: tokens[who], body: {} })).status, 403);
  assert.equal(b.seen.length, 0);

  const r = await json(app, 'POST', `/api/admin/subwave-copy/${from}/${to}`, { token: tokens.admin, body: {} });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.restored, ['settings.json', 'persona-avatars', 'library.db']);
  assert.equal(r.body.requiresRestart, true);
  assert.equal(a.seen[0].headers.authorization, `Basic ${Buffer.from('dj:Main-pass').toString('base64')}`);

  const imp = b.seen.find((x) => x.url === '/api/backup/import')!;
  assert.equal(imp.method, 'POST');
  assert.equal(imp.headers['content-type'], 'application/zip');
  assert.equal(imp.body, zip.toString(), 'the backup arrives as it left');
  assert.equal(imp.headers.authorization, `Basic ${Buffer.from('dj:Side-pass').toString('base64')}`);
  const last = b.seen.at(-1)!;
  assert.equal(`${last.method} ${last.url}`, 'POST /api/settings', 'the name goes back after the restore');
  assert.deepEqual(JSON.parse(last.body), { station: 'Side B', stationDescription: 'the other one' });

  assert.equal((await json(app, 'POST', `/api/admin/subwave-copy/${to}/${to}`, { token: tokens.admin, body: {} })).status, 400);
  const log = JSON.stringify((await json(app, 'GET', '/api/admin/audit', { token: tokens.admin })).body);
  assert.ok(log.includes('subwave.copy'));
});

test('a station too big for one upload is copied in pieces, settings after media and the library last', async () => {
  const big = (n: number) => randomBytes(n); // doesn't shrink when zipped
  const zip = makeZip({
    'manifest.json': '{"format":"subwave-backup","version":1}',
    'settings.json': '{"station":"Main","personas":[]}',
    'jingles/a.mp3': big(30_000),
    'voices/b.wav': big(30_000),
    'library.db': big(45_000),
    'voices/huge.wav': big(90_000),
  });
  const LIMIT = 60_000;
  const parts: string[][] = [];
  const a = await fake((req) => (req.url === '/api/backup/export' ? { raw: zip, headers: { 'content-type': 'application/zip' } } : { body: {} }));
  const b = await fake((req, body) => {
    if (req.method === 'GET' && req.url === '/api/settings') return { body: { values: { station: 'SGI Space' } } };
    if (req.url === '/api/backup/import') {
      if (Buffer.byteLength(body, 'latin1') > LIMIT) return { status: 413, body: { error: 'Request body too large' } };
      const names = Object.keys(unzip(Buffer.from(body, 'latin1')));
      parts.push(names);
      return { body: { ok: true, restored: names.filter((n) => n !== 'manifest.json').map((n) => n.split('/')[0]), skipped: [], requiresRestart: names.includes('settings.json') } };
    }
    return { body: { ok: true } };
  }, 'latin1');
  const { app, tokens } = await seeded();
  const add = async (name: string, url: string) => (await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'subwave', name, url, secrets: { username: 'dj', password: 'pw' } } })).body.service.id;
  const from = await add('Main', a.url);
  const to = await add('SGI Space', b.url);

  const r = await json(app, 'POST', `/api/admin/subwave-copy/${from}/${to}`, { token: tokens.admin, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  for (const p of parts) assert.equal(p[0], 'manifest.json', 'every piece is a backup of its own');
  const order = parts.flatMap((p) => p.slice(1));
  assert.deepEqual(new Set(order), new Set(['jingles/a.mp3', 'voices/b.wav', 'settings.json', 'library.db']));
  assert.ok(order.indexOf('settings.json') > order.indexOf('voices/b.wav'), 'settings after the media they can name');
  assert.equal(order.at(-1), 'library.db');
  assert.deepEqual(new Set(r.body.restored), new Set(['jingles', 'voices', 'settings.json', 'library.db']));
  assert.equal(r.body.requiresRestart, true);
  assert.equal(r.body.skipped.length, 1);
  assert.match(r.body.skipped[0], /^voices\/huge\.wav: too big/);
  const last = b.seen.at(-1)!;
  assert.deepEqual(JSON.parse(last.body), { station: 'SGI Space' }, 'the name still goes back');
});

test('deemix downloads go through the Hub, which logs in with its ARL', async () => {
  const dz = await fake((req, body) => {
    const loggedIn = req.headers.cookie === 'sid=ok';
    if (req.url === '/api/loginArl') return JSON.parse(body).arl === ARL ? { body: { status: 1 }, headers: { 'set-cookie': 'sid=ok; Path=/; HttpOnly' } } : { body: { status: 0 } };
    if (req.url === '/api/addToQueue') return { body: loggedIn ? { result: true } : { result: false, errid: 'NotLoggedIn' } };
    if (req.url === '/api/connect') return { body: { currentUser: loggedIn ? { name: 'Deezer person' } : null } };
    return { body: { queue: {}, queueOrder: [] } };
  });
  const { app, tokens, ids } = await seeded();
  await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'deemix', url: dz.url, secrets: { arl: ARL }, config: { bitrate: 3 } } });

  const link = 'https://www.deezer.com/album/302127';
  assert.equal((await json(app, 'POST', '/api/downloads/deemix/queue', { token: tokens.member, body: { link } })).status, 403, 'members need Autodownload');
  await json(app, 'PATCH', `/api/admin/users/${ids.member}`, { token: tokens.admin, body: { autodownload: true } });
  const r = await json(app, 'POST', '/api/downloads/deemix/queue', { token: tokens.member, body: { link } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const queued = dz.seen.filter((s) => s.url === '/api/addToQueue').at(-1)!;
  assert.deepEqual(JSON.parse(queued.body), { url: link, bitrate: 3 }, 'bitrate from the Hub when the app sends none');
  assert.ok(dz.seen.some((s) => s.url === '/api/loginArl'), 'logged in with the ARL after NotLoggedIn');

  assert.equal((await json(app, 'GET', '/api/downloads/deemix', { token: tokens.admin })).body.user, 'Deezer person');
  assert.equal((await json(app, 'POST', '/api/downloads/deemix/queue', { token: tokens.admin, body: { link: 'http://evil.example/x' } })).status, 400);
  assert.equal((await json(app, 'GET', '/api/downloads/deemix/queue', { token: tokens.kid })).status, 403);

  const log = JSON.stringify((await json(app, 'GET', '/api/admin/audit', { token: tokens.admin })).body);
  assert.ok(log.includes('download.queued') && log.includes(link), 'the admin sees who downloaded what');
  assert.ok(!log.includes(ARL));
});

test('yt-dlp runs on the Hub and saves inside the music folder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wl-yt-'));
  const music = join(dir, 'music');
  mkdirSync(music);
  const argsFile = join(dir, 'args');
  const bin = join(dir, 'yt-dlp');
  // a stand-in yt-dlp: records its arguments, answers searches, reports progress for downloads
  writeFileSync(bin, `#!/bin/sh
printf '%s\\n' "$@" >> '${argsFile}'
if [ "$1" = "-J" ]; then echo '{"entries":[{"id":"abc","title":"Song","channel":"Band","duration":200}]}'; exit 0; fi
echo "[wavelength]  42.0%"
echo "[ExtractAudio] Destination: x.opus"
exit 0
`);
  chmodSync(bin, 0o755);
  const { app, tokens } = await seeded({}, { musicDir: music, ytdlpBin: bin });

  const s = await json(app, 'POST', '/api/downloads/ytdlp/search', { token: tokens.admin, body: { query: '--exec rm' } });
  assert.equal(s.status, 200);
  assert.equal(s.body.results[0].url, 'https://www.youtube.com/watch?v=abc');
  const searchArgs = readFileSync(argsFile, 'utf8').split('\n');
  assert.equal(searchArgs[searchArgs.indexOf('--') + 1], 'ytsearch25:--exec rm', 'a query is never read as an option');

  await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'ytdlp', config: { folder: 'From YouTube', format: 'mp3' } } });
  const j = await json(app, 'POST', '/api/downloads/ytdlp/jobs', { token: tokens.admin, body: { url: 'https://www.youtube.com/watch?v=abc', title: 'Song' } });
  assert.equal(j.status, 200, JSON.stringify(j.body));
  let jobs: { status: string; percent: number }[] = [];
  for (let i = 0; i < 50 && jobs[0]?.status !== 'done'; i++) {
    await new Promise((r) => setTimeout(r, 20));
    jobs = (await json(app, 'GET', '/api/downloads/ytdlp/jobs', { token: tokens.admin })).body.jobs;
  }
  assert.equal(jobs[0].status, 'done');
  const args = readFileSync(argsFile, 'utf8');
  assert.ok(args.includes(join(music, 'From YouTube', '%(artist,creator,uploader)s')), 'saved under the music folder');
  assert.ok(args.includes('mp3'));

  assert.equal((await json(app, 'POST', '/api/downloads/ytdlp/jobs', { token: tokens.member, body: { url: 'https://youtu.be/x' } })).status, 403);
  await json(app, 'PATCH', `/api/admin/services/${(await json(app, 'GET', '/api/admin/services', { token: tokens.admin })).body.services[0].id}`, { token: tokens.admin, body: { config: { folder: '../../etc' } } });
  assert.equal((await json(app, 'POST', '/api/downloads/ytdlp/jobs', { token: tokens.admin, body: { url: 'https://youtu.be/x' } })).status, 400, 'the folder cannot point outside the music folder');
  assert.equal((await json(app, 'POST', '/api/downloads/ytdlp/jobs', { token: tokens.admin, body: { url: '-o/etc/passwd' } })).status, 400);
});

test('yt-dlp says so when the Hub has no music folder', async () => {
  const { app, tokens } = await seeded();
  const r = await json(app, 'POST', '/api/downloads/ytdlp/jobs', { token: tokens.admin, body: { url: 'https://youtu.be/x' } });
  assert.equal(r.status, 501);
  assert.match(r.body.error, /music folder/);
});
