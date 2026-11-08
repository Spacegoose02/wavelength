import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { defaultRules, genreLookup, normalizeGenre, subgenresOf, withSubgenres, type GenreRule } from '../src/genres.ts';
import { readTags } from '../src/tags.ts';
import { openDb } from '../src/db.ts';
import { restoreOccasions, sameGenres } from '../src/routes/genres.ts';
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

test('genre variants become one tidy genre, and sub-genres are kept next to it', () => {
  const lookup = genreLookup(defaultRules());
  const n = (g: string) => normalizeGenre(g, lookup);
  for (const g of ['Rap', 'Hip Hop', 'hip-hop', 'HIPHOP', 'Rap/Hip Hop', 'Hip-Hop; Rap', 'Rap; Hip-Hop', 'Urban']) assert.equal(n(g).genre, 'Rap; Hip-Hop', g);
  for (const g of ['Trap', 'trap', 'Hip Hop; Trap', 'Rap; Hip-Hop; Trap']) assert.equal(n(g).genre, 'Rap; Hip-Hop; Trap', g);
  assert.equal(n('Pop Rap').genre, 'Rap; Hip-Hop; Pop Rap');
  assert.equal(n('UK Drill').genre, 'Rap; Hip-Hop; Drill', 'a spelling of a sub-genre becomes the sub-genre');
  for (const g of ['Pop', 'pop', 'International Pop']) assert.equal(n(g).genre, 'Pop', g);
  for (const g of ['Dance Pop', 'Pop; Dance Pop']) assert.equal(n(g).genre, 'Pop; Dance Pop', g);
  assert.equal(n('Synthpop').genre, 'Pop; Synth-Pop');
  assert.equal(n('Pop/Rock').genre, 'Pop; Pop Rock', 'a whole tag is looked up before its parts');
  for (const g of ['EDM', 'Dance', 'Electronica', 'Dance/Electronic']) assert.equal(n(g).genre, 'Electronic', g);
  for (const g of ['Drum & Bass', 'drum and bass', 'DnB', 'Electronic; Drum & Bass']) assert.equal(n(g).genre, 'Electronic; Drum & Bass', g);
  assert.equal(n('Deep House; Techno').genre, 'Electronic; Deep House; Techno', 'every sub-genre of the genre stays');
  assert.equal(n('Techno; Hip Hop').genre, 'Electronic; Techno', 'sub-genres of another genre are dropped');
  assert.equal(n('R & B').genre, 'R&B');
  assert.equal(n('Christmas; Dance Pop').genre, 'Pop; Dance Pop; Christmas', 'occasion genres are kept, last');
  assert.equal(n('Country; Christmas Country').genre, 'Country; Christmas Country', 'Christmas sub-genres are kept as spelled');
  assert.equal(n('Holiday Pop; Pop').genre, 'Pop; Holiday Pop');
  assert.deepEqual(n('Christmas Country'), { genre: null, unknown: [] }, 'an occasion alone is left alone, and is not unknown');
  assert.deepEqual(n('Christmas, Polka'), { genre: null, unknown: ['Polka'] });
  assert.deepEqual(n('Countryside'), { genre: null, unknown: ['Countryside'] }, 'occasion words match whole words only');
  assert.equal(n('Rap;Hip-Hop').genre, 'Rap; Hip-Hop');
  assert.deepEqual(n(''), { genre: null, unknown: [] });
  // tidying twice changes nothing
  for (const g of ['Trap', 'Deep House; Techno', 'Pop/Rock', 'EDM', 'Christmas; Dance Pop']) assert.equal(n(n(g).genre!).genre, n(g).genre, g);
});

test('rules saved before sub-genres get them, without losing rules an admin made', () => {
  const old: GenreRule[] = [
    { from: 'Trap', to: 'Rap; Hip-Hop' },
    { from: 'House', to: 'Electronic' },
    { from: 'Techno', to: 'Dance' },
    { from: 'Polka', to: 'Folk' },
  ];
  const r = withSubgenres(old);
  assert.deepEqual(r.slice(0, 4), [
    { from: 'Trap', to: 'Rap; Hip-Hop', sub: 'Trap' },
    { from: 'House', to: 'Electronic', sub: 'House' },
    { from: 'Techno', to: 'Dance' },
    { from: 'Polka', to: 'Folk' },
  ], 'a rule sending a genre somewhere else is the admin’s choice');
  assert.ok(r.some((x) => x.from === 'Deep House' && x.to === 'Electronic' && x.sub === 'Deep House'), 'missing sub-genres of their genres are added');
  assert.ok(!r.some((x) => x.to === 'Metal'), 'genres they don’t use aren’t');
  assert.ok(subgenresOf(r).Folk.includes('Indie Folk'));
  assert.ok(subgenresOf(r)['Rap; Hip-Hop'].includes('Drill'));
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
    ['views', 'Hip Hop; Trap', 'Rap; Hip-Hop; Trap'],
    ['fn', 'Dance Pop', 'Pop; Dance Pop'],
  ], 'an album already tidy (in any order) is left out');
  assert.deepEqual(review.body.unknown, [{ genre: 'Polka', albums: 1, examples: ['Odd – Thing'] }]);

  const apply = await json(app, 'POST', '/api/admin/genres/apply', { token: tokens.admin, body: { albums: [{ id: 'views', genre: 'Rap; Hip-Hop; Trap' }, { id: 'fn', genre: 'Pop; Dance Pop' }] } });
  assert.equal(apply.status, 200, JSON.stringify(apply.body));
  assert.equal(apply.body.changed.length, 3);
  assert.equal((await readTags(join(music, 'Drake/Views/02.mp3'))).genre, 'Rap; Hip-Hop; Trap');
  assert.equal((await readTags(join(music, 'Dua Lipa/Future Nostalgia/01.mp3'))).genre, 'Pop; Dance Pop');
  const hist = await json(app, 'GET', '/api/admin/tags/history', { token: tokens.admin });
  assert.equal(hist.body.edits[0].label, 'Genres of 2 albums');
  assert.equal((await json(app, 'POST', `/api/admin/tags/undo/${apply.body.batch}`, { token: tokens.admin })).body.undone, 3);
  assert.equal((await readTags(join(music, 'Drake/Views/02.mp3'))).genre, 'Trap');

  // map the unknown genre, and keep an album as it is
  const cur = await json(app, 'GET', '/api/admin/genres', { token: tokens.admin });
  assert.equal(cur.body.defaults, true);
  assert.ok(cur.body.genres.includes('Rap; Hip-Hop'));
  assert.ok(cur.body.subgenres.Electronic.includes('Deep House'));
  const saved = await json(app, 'PUT', '/api/admin/genres', { token: tokens.admin, body: { rules: [...cur.body.rules, { from: 'Polka', to: 'Folk' }] } });
  assert.equal(saved.body.defaults, false);
  assert.equal((await json(app, 'PUT', '/api/admin/genres', { token: tokens.admin, body: { rules: [{ from: '', to: 'x' }] } })).status, 400);
  await json(app, 'POST', '/api/admin/genres/keep', { token: tokens.admin, body: { ids: ['fn'] } });
  const again = await json(app, 'GET', '/api/admin/genres/review', { token: tokens.admin });
  assert.deepEqual(again.body.albums.map((a: { id: string; proposed: string }) => [a.id, a.proposed]), [['views', 'Rap; Hip-Hop; Trap'], ['odd', 'Folk']]);
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

test('an album is tidy only when its genres are spelled exactly so', () => {
  assert.ok(sameGenres(['Hip-Hop', 'Rap'], 'Rap; Hip-Hop'));
  assert.ok(!sameGenres(['Rap;Hip-Hop'], 'Rap; Hip-Hop'), 'Navidrome shows "Rap;Hip-Hop" as its own genre');
  assert.ok(!sameGenres(['Rap/Hip Hop'], 'Rap; Hip-Hop'));
  assert.ok(!sameGenres(['Rap'], 'Rap; Hip-Hop'));
});

test('Christmas genres an earlier tidy dropped are put back once, as an undoable edit', async () => {
  const music = mkdtempSync(join(tmpdir(), 'wl-genres-xmas-'));
  mkdirSync(join(music, 'A'), { recursive: true });
  audio(join(music, 'A/01.mp3'), { title: 'Jingle', genre: 'Pop; Dance Pop' });
  audio(join(music, 'A/02.mp3'), { title: 'Hand', genre: 'Country' });
  audio(join(music, 'A/03.mp3'), { title: 'Back', genre: 'Country; Christmas Country' });
  const db = openDb(':memory:');
  const edit = db.prepare('INSERT INTO tag_edits (batch, path, before, after, label, user_id, at) VALUES (?, ?, ?, ?, ?, NULL, 1)');
  edit.run('b1', 'A/01.mp3', JSON.stringify({ genre: 'Christmas; Dance Pop' }), JSON.stringify({ genre: 'Pop; Dance Pop' }), 'Genres of 2 albums');
  edit.run('b2', 'A/02.mp3', JSON.stringify({ genre: 'Christmas Country' }), JSON.stringify({ genre: 'Country' }), 'Someone – Hand edit');
  edit.run('b1', 'A/03.mp3', JSON.stringify({ genre: 'Christmas Country; Country' }), JSON.stringify({ genre: 'Country' }), 'Genres of 2 albums');
  assert.deepEqual(await restoreOccasions(db, music), { changed: 1, failed: 0 });
  assert.equal((await readTags(join(music, 'A/01.mp3'))).genre, 'Pop; Dance Pop; Christmas');
  assert.equal((await readTags(join(music, 'A/02.mp3'))).genre, 'Country', 'hand edits are left as chosen');
  assert.equal((await readTags(join(music, 'A/03.mp3'))).genre, 'Country; Christmas Country', 'already back');
  const row = db.prepare("SELECT before, after FROM tag_edits WHERE label = 'Put Christmas genres back'").get() as { before: string; after: string };
  assert.deepEqual(JSON.parse(row.before), { genre: 'Pop; Dance Pop' });
  assert.deepEqual(await restoreOccasions(db, music), { changed: 0, failed: 0 }, 'nothing left to put back');
  db.close();
});
