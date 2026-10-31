import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { defaultRules, genreLookup, normalizeGenre } from '../src/genres.ts';
import { readTags } from '../src/tags.ts';
import { json, seeded } from './helpers.ts';

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

function audio(file: string, tags: Record<string, string>) {
  const meta = Object.entries(tags).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '1', '-c:a', 'libmp3lame', '-b:a', '64k', ...meta, '-y', file]);
}

async function listen(handler: (url: string) => [number, unknown]) {
  const srv = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const [status, v] = handler(req.url!);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(v));
    });
  });
  servers.push(srv);
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  return `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
}

const tick = () => new Promise((r) => setTimeout(r, 20));

test('genre variants become one tidy genre', () => {
  const lookup = genreLookup(defaultRules());
  const n = (g: string) => normalizeGenre(g, lookup);
  for (const g of ['Rap', 'Hip Hop', 'hip-hop', 'HIPHOP', 'Trap', 'Rap/Hip Hop', 'Pop Rap', 'Hip-Hop; Rap', 'Rap; Hip-Hop']) assert.equal(n(g).genre, 'Rap; Hip-Hop', g);
  for (const g of ['Pop', 'pop', 'Dance Pop', 'Synth-pop', 'K-Pop', 'Pop/Rock']) assert.equal(n(g).genre, 'Pop', g);
  for (const g of ['EDM', 'House', 'Techno', 'Dance', 'Electronica', 'Drum & Bass', 'drum and bass', 'Dance/Electronic']) assert.equal(n(g).genre, 'Electronic', g);
  assert.equal(n('R & B').genre, 'R&B');
  assert.equal(n('Christmas; Dance Pop').genre, 'Pop', 'the first known genre wins');
  assert.deepEqual(n('Christmas, Polka'), { genre: null, unknown: ['Christmas', 'Polka'] });
  assert.deepEqual(n(''), { genre: null, unknown: [] });
});

test('admins review the library’s genres, apply the tidy ones, undo, and map unknown genres', async () => {
  const music = mkdtempSync(join(tmpdir(), 'wl-genres-'));
  for (const d of ['Drake/Views', 'Dua Lipa/Future Nostalgia', 'Odd/Thing']) mkdirSync(join(music, d), { recursive: true });
  audio(join(music, 'Drake/Views/01.mp3'), { title: 'One', genre: 'Hip Hop' });
  audio(join(music, 'Drake/Views/02.mp3'), { title: 'Two', genre: 'Trap' });
  audio(join(music, 'Dua Lipa/Future Nostalgia/01.mp3'), { title: 'Levitating', genre: 'Dance Pop' });
  audio(join(music, 'Odd/Thing/01.mp3'), { title: 'Odd', genre: 'Polka' });

  const songs: Record<string, { id: string; albumId: string; path: string; artist: string; album: string }[]> = {
    views: [
      { id: 's1', albumId: 'views', path: '/music/Drake/Views/01.mp3', artist: 'Drake', album: 'Views' },
      { id: 's2', albumId: 'views', path: '/music/Drake/Views/02.mp3', artist: 'Drake', album: 'Views' },
    ],
    fn: [{ id: 's3', albumId: 'fn', path: '/music/Dua Lipa/Future Nostalgia/01.mp3', artist: 'Dua Lipa', album: 'Future Nostalgia' }],
    odd: [{ id: 's4', albumId: 'odd', path: '/music/Odd/Thing/01.mp3', artist: 'Odd', album: 'Thing' }],
  };
  const nd = await listen((url) => {
    if (url === '/auth/login') return [200, { token: 'jwt', isAdmin: true }];
    if (url.startsWith('/rest/')) return [200, { 'subsonic-response': { status: 'ok', user: { adminRole: true } } }];
    if (url.startsWith('/api/album?')) {
      return [200, [
        { id: 'views', name: 'Views', albumArtist: 'Drake', genres: [{ name: 'Hip Hop' }, { name: 'Trap' }], songCount: 2 },
        { id: 'fn', name: 'Future Nostalgia', albumArtist: 'Dua Lipa', genre: 'Dance Pop', songCount: 1 },
        { id: 'odd', name: 'Thing', albumArtist: 'Odd', genres: [{ name: 'Polka' }], songCount: 1 },
        { id: 'tidy', name: 'Tidy', albumArtist: 'Someone', genres: [{ name: 'Hip-Hop' }, { name: 'Rap' }], songCount: 1 },
      ]];
    }
    if (url.startsWith('/api/song?')) return [200, songs[new URLSearchParams(url.split('?')[1]).get('album_id')!] ?? []];
    return [404, {}];
  });

  const { app, tokens } = await seeded({}, { musicDir: music });
  assert.equal((await json(app, 'GET', '/api/admin/genres/review', { token: tokens.member })).status, 403);
  assert.equal((await json(app, 'PUT', '/api/admin/library/navidrome', { token: tokens.admin, body: { url: nd, username: 'admin', password: 'pw' } })).status, 200);

  const review = await json(app, 'GET', '/api/admin/genres/review', { token: tokens.admin });
  assert.equal(review.status, 200, JSON.stringify(review.body));
  assert.deepEqual(review.body.albums.map((a: { id: string; current: string; proposed: string }) => [a.id, a.current, a.proposed]), [
    ['views', 'Hip Hop; Trap', 'Rap; Hip-Hop'],
    ['fn', 'Dance Pop', 'Pop'],
  ], 'an album already tidy (in any order) is left out');
  assert.deepEqual(review.body.unknown, [{ genre: 'Polka', albums: 1, examples: ['Odd – Thing'] }]);

  const apply = await json(app, 'POST', '/api/admin/genres/apply', { token: tokens.admin, body: { albums: [{ id: 'views', genre: 'Rap; Hip-Hop' }, { id: 'fn', genre: 'Pop' }] } });
  assert.equal(apply.status, 200, JSON.stringify(apply.body));
  assert.equal(apply.body.changed.length, 3);
  assert.equal((await readTags(join(music, 'Drake/Views/02.mp3'))).genre, 'Rap; Hip-Hop');
  assert.equal((await readTags(join(music, 'Dua Lipa/Future Nostalgia/01.mp3'))).genre, 'Pop');
  const hist = await json(app, 'GET', '/api/admin/tags/history', { token: tokens.admin });
  assert.equal(hist.body.edits[0].label, 'Genres of 2 albums');
  assert.equal((await json(app, 'POST', `/api/admin/tags/undo/${apply.body.batch}`, { token: tokens.admin })).body.undone, 3);
  assert.equal((await readTags(join(music, 'Drake/Views/02.mp3'))).genre, 'Trap');

  // map the unknown genre, and keep an album as it is
  const cur = await json(app, 'GET', '/api/admin/genres', { token: tokens.admin });
  assert.equal(cur.body.defaults, true);
  assert.ok(cur.body.genres.includes('Rap; Hip-Hop'));
  const saved = await json(app, 'PUT', '/api/admin/genres', { token: tokens.admin, body: { rules: [...cur.body.rules, { from: 'Polka', to: 'Folk' }] } });
  assert.equal(saved.body.defaults, false);
  assert.equal((await json(app, 'PUT', '/api/admin/genres', { token: tokens.admin, body: { rules: [{ from: '', to: 'x' }] } })).status, 400);
  await json(app, 'POST', '/api/admin/genres/keep', { token: tokens.admin, body: { ids: ['fn'] } });
  const again = await json(app, 'GET', '/api/admin/genres/review', { token: tokens.admin });
  assert.deepEqual(again.body.albums.map((a: { id: string; proposed: string }) => [a.id, a.proposed]), [['views', 'Rap; Hip-Hop'], ['odd', 'Folk']]);
  assert.deepEqual(again.body.unknown, []);
  assert.equal(again.body.kept, 1);

  // back to the defaults
  assert.equal((await json(app, 'PUT', '/api/admin/genres', { token: tokens.admin, body: { rules: null } })).body.defaults, true);

  // the weekly look tells admins once about what needs tidying, not again for the same albums
  assert.equal((await json(app, 'POST', '/api/admin/genres/check', { token: tokens.member })).status, 403);
  const first = await json(app, 'POST', '/api/admin/genres/check', { token: tokens.admin });
  assert.deepEqual(first.body, { albums: 1, unknown: 1, notified: true });
  const notes = (await json(app, 'GET', '/api/notifications?after=0', { token: tokens.admin })).body.notifications;
  assert.equal(notes[0].kind, 'library');
  assert.match(notes[0].body, /1 album with an untidy genre and 1 genre without a rule/);
  assert.equal((await json(app, 'GET', '/api/notifications?after=0', { token: tokens.member })).body.notifications.length, 0, 'members can’t fix genres');
  assert.equal((await json(app, 'POST', '/api/admin/genres/check', { token: tokens.admin })).body.notified, false);
});

test('new downloads get the tidy genre before the library scan; older music and hand edits are left alone', async () => {
  const music = mkdtempSync(join(tmpdir(), 'wl-genres-new-'));
  mkdirSync(join(music, 'Old'), { recursive: true });
  audio(join(music, 'Old/01.mp3'), { title: 'Old', genre: 'Hip Hop' });
  await tick();
  const { app, tokens } = await seeded({}, { musicDir: music });
  await tick();

  mkdirSync(join(music, 'New'), { recursive: true });
  audio(join(music, 'New/01.mp3'), { title: 'A', genre: 'Rap/Hip Hop' });
  audio(join(music, 'New/02.mp3'), { title: 'B', genre: 'EDM' });
  audio(join(music, 'New/03.mp3'), { title: 'C', genre: 'Polka' });
  audio(join(music, 'New/04.mp3'), { title: 'D', genre: 'Hip Hop' });
  // an admin set this one by hand
  const hand = await json(app, 'PUT', '/api/admin/tags', { token: tokens.admin, body: { changes: [{ path: 'New/04.mp3', tags: { genre: 'Trap' } }] } });
  assert.equal(hand.status, 200);

  app.hubLibrary.downloaded();
  await app.hubLibrary.tidy();
  assert.equal((await readTags(join(music, 'New/01.mp3'))).genre, 'Rap; Hip-Hop');
  assert.equal((await readTags(join(music, 'New/02.mp3'))).genre, 'Electronic');
  assert.equal((await readTags(join(music, 'New/03.mp3'))).genre, 'Polka', 'unknown genres wait for the review');
  assert.equal((await readTags(join(music, 'New/04.mp3'))).genre, 'Trap', 'a hand edit stays');
  assert.equal((await readTags(join(music, 'Old/01.mp3'))).genre, 'Hip Hop', 'music from before is for the review');
  const hist = await json(app, 'GET', '/api/admin/tags/history', { token: tokens.admin });
  assert.equal(hist.body.edits.find((e: { label: string }) => e.label === 'Genres of new downloads').files, 2);

  // off: left as they come
  await json(app, 'PUT', '/api/admin/genres', { token: tokens.admin, body: { auto: false } });
  await tick();
  audio(join(music, 'New/05.mp3'), { title: 'E', genre: 'House' });
  app.hubLibrary.downloaded();
  await app.hubLibrary.tidy();
  assert.equal((await readTags(join(music, 'New/05.mp3'))).genre, 'House');
});
