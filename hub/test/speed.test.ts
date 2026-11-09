import assert from 'node:assert/strict';
import { test } from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import Fastify from 'fastify';
import { catalogChanged, catalogWrote } from '../src/catalog.ts';
import { compressReplies } from '../src/compress.ts';
import { openDb } from '../src/db.ts';
import { answer } from '../src/subsonicCatalog.ts';
import { played, playsOf, star, starredOf } from '../src/userData.ts';

test('JSON answers are zipped for clients that ask, and left alone otherwise', async () => {
  const app = Fastify();
  compressReplies(app);
  const big = { albums: Array.from({ length: 500 }, (_, i) => ({ id: `al${i}`, name: `Album ${i}`, artist: 'Someone' })) };
  app.get('/big', async () => big);
  app.get('/small', async () => ({ ok: true }));
  app.get('/file', async (_req, reply) => reply.type('audio/mpeg').send(Buffer.alloc(5000)));

  const brr = await app.inject({ url: '/big', headers: { 'accept-encoding': 'gzip, deflate, br' } });
  assert.equal(brr.headers['content-encoding'], 'br');
  assert.ok(brr.rawPayload.length < JSON.stringify(big).length / 5, 'much smaller');
  assert.deepEqual(JSON.parse(brotliDecompressSync(brr.rawPayload).toString()), big);

  const gz = await app.inject({ url: '/big', headers: { 'accept-encoding': 'gzip' } });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.deepEqual(JSON.parse(gunzipSync(gz.rawPayload).toString()), big);

  const plain = await app.inject({ url: '/big' });
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.deepEqual(plain.json(), big);
  assert.equal((await app.inject({ url: '/small', headers: { 'accept-encoding': 'gzip' } })).headers['content-encoding'], undefined, 'too small to bother');
  assert.equal((await app.inject({ url: '/file', headers: { 'accept-encoding': 'gzip' } })).headers['content-encoding'], undefined, 'music isn’t zipped');
  await app.close();
});

function library() {
  const db = openDb(':memory:');
  const ins = db.prepare(`INSERT INTO catalog_songs (path, size, mtime, title, artist, album, album_artist, track, disc, year, genre, duration,
    nd_id, nd_album_id, nd_artist_id, nd_album_artist_id, read_at) VALUES (?, 1, 1, ?, ?, ?, ?, ?, 1, ?, ?, 200, ?, ?, ?, ?, 0)`);
  for (let i = 0; i < 60; i++) {
    const al = Math.floor(i / 6), ar = Math.floor(al / 3);
    ins.run(`a${ar}/b${al}/${i}.mp3`, `Song ${i}`, `Artist ${ar}`, `Album ${al}`, `Artist ${ar}`, (i % 6) + 1, 2000 + al, al % 2 ? 'Rock' : 'Pop', `s${i}`, `al${al}`, `ar${ar}`, `ar${ar}`);
  }
  catalogChanged();
  return db;
}
const CALLS: [string, Record<string, string>][] = [
  ['getAlbumList2', { type: 'alphabeticalByName', size: '500' }],
  ['getAlbumList2', { type: 'alphabeticalByArtist', size: '500' }],
  ['getArtists', {}],
  ['getArtist', { id: 'ar0' }],
  ['getAlbum', { id: 'al1' }],
  ['getGenres', {}],
  ['search3', { query: 'zydeco', songCount: '50' }],
];
const all = (db: ReturnType<typeof openDb>) => CALLS.map(([m, q]) => answer(db, m, q, new Map()));

test('after a tag edit the Hub updates just that song, and answers as if it had read everything again', () => {
  const db = library();
  all(db); // built once
  catalogWrote(db, 'a0/b1/7.mp3', { title: 'Zydeco Nights', genre: 'Zydeco; Rock', track: '1' } as never);
  catalogWrote(db, 'a0/b2/12.mp3', { album: 'Aardvark Album', albumArtist: 'Artist 0' } as never);
  const patched = all(db);
  catalogChanged(); // built again from scratch
  assert.deepEqual(patched, all(db));

  const album = (patched[4] as any)['subsonic-response'].album;
  assert.deepEqual(album.song.slice(0, 2).map((x: { title: string }) => x.title), ['Song 6', 'Zydeco Nights'], 'now track 1, beside the other track 1');
  const genres = (patched[5] as any)['subsonic-response'].genres.genre.map((g: { value: string }) => g.value);
  assert.ok(genres.includes('Zydeco'));
  assert.equal((patched[6] as any)['subsonic-response'].searchResult3.song[0].id, 's7');
});

test('a song that comes or goes makes the Hub read the catalog again', () => {
  const db = library();
  all(db);
  db.prepare('DELETE FROM catalog_songs WHERE path = ?').run('a0/b0/0.mp3');
  catalogChanged(['a0/b0/0.mp3']);
  assert.equal((answer(db, 'getSong', { id: 's0' }, new Map()) as any), null, 'gone');
  db.prepare(`INSERT INTO catalog_songs (path, size, mtime, title, artist, album, album_artist, duration, nd_id, nd_album_id, nd_artist_id, nd_album_artist_id, read_at)
    VALUES ('a0/b0/new.mp3', 1, 1, 'Brand New', 'Artist 0', 'Album 0', 'Artist 0', 100, 'snew', 'al0', 'ar0', 'ar0', 0)`).run();
  catalogChanged(['a0/b0/new.mp3']);
  assert.equal((answer(db, 'getSong', { id: 'snew' }, new Map()) as any)['subsonic-response'].song.title, 'Brand New');
});

test('hearts and plays are read once, and again after they change', () => {
  const db = openDb(':memory:');
  db.exec('PRAGMA foreign_keys = OFF');
  const first = playsOf(db, 1);
  assert.equal(playsOf(db, 1), first, 'the same map, not read again');
  played(db, 1, 's1');
  assert.equal(playsOf(db, 1).get('s1')?.count, 1);
  const stars = starredOf(db, 1);
  star(db, 1, ['s1'], true);
  assert.notEqual(starredOf(db, 1), stars);
  assert.ok(starredOf(db, 1).has('s1'));
});
