import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, test } from 'node:test';
import type { IndexedSong } from '../src/api/library.ts';
import { editDistance, SearchIndex, words } from '../src/librarySearch.ts';
import { json, seeded } from './helpers.ts';

const SONGS: IndexedSong[] = [
  { id: 's1', title: "God's Plan", artist: 'Drake', artistId: 'ar1', album: 'Scorpion', albumId: 'al1', year: 2018 },
  { id: 's2', title: 'Nonstop', artist: 'Drake', artistId: 'ar1', album: 'Scorpion', albumId: 'al1', year: 2018 },
  { id: 's3', title: 'Halo', artist: 'Beyoncé', artistId: 'ar2', album: 'I Am... Sasha Fierce', albumId: 'al2' },
  { id: 's4', title: 'Back in Black', artist: 'AC/DC', artistId: 'ar3', album: 'Back in Black', albumId: 'al3' },
  { id: 's5', title: 'HUMBLE.', artist: 'Kendrick Lamar', artistId: 'ar4', album: 'DAMN.', albumId: 'al4' },
  { id: 's6', title: 'Not Like Us', artist: 'Kendrick Lamar', artistId: 'ar4', album: 'GNX', albumId: 'al5' },
  { id: 's7', title: 'Plans', artist: 'Someone & Friends', artistId: 'ar5', album: 'Plans', albumId: 'al6' },
];
const ids = (r: { id: string }[]) => r.map((x) => x.id);

test('words ignore case, accents, punctuation and apostrophes', () => {
  assert.deepEqual(words("God's Plan"), ['gods', 'plan']);
  assert.deepEqual(words('Beyoncé'), ['beyonce']);
  assert.deepEqual(words('Simon & Garfunkel'), ['simon', 'and', 'garfunkel']);
  assert.deepEqual(words('AC/DC'), ['ac', 'dc']);
});

test('edit distance counts swaps as one and gives up past the limit', () => {
  assert.equal(editDistance('kendrick', 'kendirck', 2), 1);
  assert.equal(editDistance('beyonce', 'beyonse', 1), 1);
  assert.equal(editDistance('drake', 'future', 1), 2);
});

test('search finds exact words, starts of words, typos and run-together names', () => {
  const idx = new SearchIndex(SONGS);
  assert.deepEqual(ids(idx.search('gods plan').songs).slice(0, 1), ['s1']);
  assert.deepEqual(ids(idx.search('kend lam').artists), ['ar4']);
  const typo = idx.search('kendirck');
  assert.deepEqual(ids(typo.artists), ['ar4']);
  assert.equal(typo.didYouMean, 'kendrick');
  assert.deepEqual(ids(idx.search('beyonse').songs), ['s3']);
  assert.deepEqual(ids(idx.search('acdc').artists), ['ar3']);
  // every word has to match somewhere
  assert.deepEqual(ids(idx.search('drake halo').songs), []);
  // an album found through its name or artist, with how many of its songs matched
  assert.deepEqual(idx.search('scorpion').albums, [{ id: 'al1', name: 'Scorpion', artist: 'Drake', artistId: 'ar1', year: 2018, songCount: 2 }]);
  assert.equal(idx.search('drake').artists[0].albumCount, 1);
  assert.equal(idx.search('gods plan').didYouMean, undefined);
});

test('the exact title comes first, then what the person plays', () => {
  const idx = new SearchIndex(SONGS);
  // "plan" is the start of both "Plans" and part of "God's Plan"; exact word beats prefix
  assert.equal(idx.search('plan').songs[0].id, 's1');
  const plays = new Map([['someone and friends', 400]]);
  assert.equal(idx.search('plan', { plays }).songs[0].id, 's7');
});

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

test('GET /api/library/search answers from the Hub’s copy of the library', async () => {
  const srv = createServer((req, res) => {
    const u = new URL(req.url!, 'http://x');
    const ok = (extra: object) => ({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...extra } });
    let body: unknown = ok({});
    if (u.pathname === '/rest/getUser') body = ok({ user: { username: 'admin', adminRole: true } });
    if (u.pathname === '/rest/search3') body = ok({ searchResult3: { song: u.searchParams.get('songOffset') === '0' ? SONGS : [] } });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  servers.push(srv);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  const { app, tokens } = await seeded();

  const before = await json(app, 'GET', '/api/library/search?q=drake', { token: tokens.member });
  assert.equal(before.status, 200);
  assert.equal(before.body.ready, false);

  assert.equal((await json(app, 'PUT', '/api/admin/library/navidrome', { token: tokens.admin, body: { url, username: 'admin', password: 'pw' } })).status, 200);
  const r = await json(app, 'GET', '/api/library/search?q=kendirck%20lamar', { token: tokens.member });
  assert.equal(r.body.ready, true);
  assert.equal(r.body.server, url);
  assert.deepEqual(ids(r.body.artists), ['ar4']);
  assert.deepEqual(new Set(ids(r.body.songs)), new Set(['s5', 's6']));
  assert.equal(r.body.songs[0].artistId, 'ar4');

  assert.deepEqual((await json(app, 'GET', '/api/library/search?q=x', { token: tokens.member })).body.songs, []);
  assert.equal((await json(app, 'GET', '/api/library/search?q=drake')).status, 401);
});

test('lyrics are shared through the Hub and searchable', async () => {
  const { app, tokens } = await seeded();
  const lyrics = { lines: [{ time: 1, text: 'Started from the bottom now we here' }, { time: 5, text: 'Now my whole team here' }], synced: true, source: 'LRCLIB' };
  assert.deepEqual((await json(app, 'GET', '/api/lyrics?key=drake|startedfromthebottom|17', { token: tokens.member })).body, { lyrics: null });
  const put = await json(app, 'PUT', '/api/lyrics', { token: tokens.kid, body: { key: 'drake|startedfromthebottom|17', artist: 'Drake', title: 'Started From the Bottom', lyrics } });
  assert.equal(put.status, 200);
  assert.deepEqual((await json(app, 'GET', '/api/lyrics?key=drake|startedfromthebottom|17', { token: tokens.admin })).body.lyrics, lyrics);
  // nonsense is refused
  assert.equal((await json(app, 'PUT', '/api/lyrics', { token: tokens.member, body: { key: 'x', artist: 'a', title: 't', lyrics: { lines: 'no' } } })).status, 400);
  assert.equal((await json(app, 'GET', '/api/lyrics?key=x')).status, 401);
});

test('lyrics search finds the phrase and the line it is in', async () => {
  const { openDb } = await import('../src/db.ts');
  const { LyricsCache } = await import('../src/lyricsCache.ts');
  const cache = new LyricsCache(openDb(':memory:'));
  cache.put('a', 'Drake', 'Started From the Bottom', { lines: [{ text: 'Started from the bottom now we’re here' }, { text: 'Now my whole team here' }], synced: false, source: 'LRCLIB' });
  cache.put('b', 'Adele', 'Hello', { lines: [{ text: "Hello, it's me" }], synced: false, source: 'LRCLIB' });
  assert.deepEqual(cache.search('from the bottom'), [{ artist: 'Drake', title: 'Started From the Bottom', line: 'Started from the bottom now we’re here' }]);
  assert.deepEqual(cache.search('hello its me').map((h) => h.title), ['Hello']);
  assert.deepEqual(cache.search('the bottom'), []);
  assert.equal(cache.count(), 2);
});
