import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { purgeTrash, TRASH_DIR } from '../src/routes/trash.ts';
import { json, seeded } from './helpers.ts';

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

/** A fake Navidrome: albums by id, plus artist and genre lists. */
async function navidrome(albums: Record<string, { path: string; album: string; artist: string }[]>) {
  const srv = createServer((req, res) => {
    const url = new URL(req.url!, 'http://nd');
    let out: unknown = [];
    if (url.pathname === '/auth/login') out = { token: 'jwt', isAdmin: true };
    else if (url.pathname.startsWith('/rest/')) out = { 'subsonic-response': { status: 'ok', user: { adminRole: true } } };
    else if (url.pathname === '/api/song') out = (albums[url.searchParams.get('album_id') ?? ''] ?? []).map((s, i) => ({ id: `${url.searchParams.get('album_id')}-${i}`, albumId: url.searchParams.get('album_id'), title: `t${i}`, ...s }));
    else if (url.pathname === '/api/artist') out = [{ name: 'Daft Punk' }, { name: 'Air' }];
    else if (url.pathname === '/api/genre') out = [{ name: 'Electronic' }, { name: 'House' }];
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
  });
  servers.push(srv);
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  return `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
}

const touch = (f: string) => {
  mkdirSync(join(f, '..'), { recursive: true });
  writeFileSync(f, 'x');
};

test('deleting an album moves it to the trash, and it can be put back or removed for good', async () => {
  const music = mkdtempSync(join(tmpdir(), 'wl-trash-'));
  // a two-disc album in its own folder, with a cover; and an album sharing a folder with another
  touch(join(music, 'Daft Punk', 'Discovery', 'CD1', '01.mp3'));
  touch(join(music, 'Daft Punk', 'Discovery', 'CD2', '01.mp3'));
  touch(join(music, 'Daft Punk', 'Discovery', 'cover.jpg'));
  touch(join(music, 'Loose', 'a.flac'));
  touch(join(music, 'Loose', 'b.flac'));
  const nd = await navidrome({
    disc: [
      { path: '/music/Daft Punk/Discovery/CD1/01.mp3', album: 'Discovery', artist: 'Daft Punk' },
      { path: '/music/Daft Punk/Discovery/CD2/01.mp3', album: 'Discovery', artist: 'Daft Punk' },
    ],
    loose: [{ path: 'Loose/a.flac', album: 'Singles', artist: 'Air' }],
  });
  const { app, db, tokens } = await seeded({}, { musicDir: music });
  await json(app, 'PUT', '/api/admin/library/navidrome', { token: tokens.admin, body: { url: nd, username: 'admin', password: 'pw' } });

  assert.equal((await json(app, 'DELETE', '/api/admin/library/album/disc', { token: tokens.member })).status, 403);
  const del = await json(app, 'DELETE', '/api/admin/library/album/disc', { token: tokens.admin });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(del.body.label, 'Daft Punk – Discovery');
  assert.equal(del.body.files, 2);
  // the whole album folder moved (cover too), and the empty artist folder went away
  assert.ok(!existsSync(join(music, 'Daft Punk')));
  assert.ok(existsSync(join(music, TRASH_DIR, del.body.batch, 'Daft Punk', 'Discovery', 'cover.jpg')));
  assert.ok(existsSync(join(music, TRASH_DIR, '.ndignore')));

  // only the album's own song leaves a shared folder
  const loose = await json(app, 'DELETE', '/api/admin/library/album/loose', { token: tokens.admin });
  assert.equal(loose.body.files, 1);
  assert.ok(!existsSync(join(music, 'Loose', 'a.flac')) && existsSync(join(music, 'Loose', 'b.flac')));

  const list = (await json(app, 'GET', '/api/admin/trash', { token: tokens.admin })).body.albums;
  assert.deepEqual(list.map((a: { label: string; files: number }) => [a.label, a.files]), [['Air – Singles', 1], ['Daft Punk – Discovery', 2]]);

  const back = await json(app, 'POST', `/api/admin/trash/${del.body.batch}/restore`, { token: tokens.admin });
  assert.deepEqual(back.body, { files: 2, failed: [] });
  assert.ok(existsSync(join(music, 'Daft Punk', 'Discovery', 'CD2', '01.mp3')));
  assert.ok(!existsSync(join(music, TRASH_DIR, del.body.batch)));
  assert.equal((await json(app, 'POST', `/api/admin/trash/${del.body.batch}/restore`, { token: tokens.admin })).status, 404);

  // remove for good
  assert.equal((await json(app, 'DELETE', `/api/admin/trash/${loose.body.batch}`, { token: tokens.admin })).status, 200);
  assert.ok(!existsSync(join(music, TRASH_DIR, loose.body.batch)));
  assert.equal((await json(app, 'POST', `/api/admin/trash/${loose.body.batch}/restore`, { token: tokens.admin })).status, 404);

  // and after 30 days on its own
  const again = await json(app, 'DELETE', '/api/admin/library/album/disc', { token: tokens.admin });
  assert.equal(purgeTrash(db, music, Date.now() + 29 * 86400_000), 0);
  assert.equal(purgeTrash(db, music, Date.now() + 31 * 86400_000), 1);
  assert.ok(!existsSync(join(music, TRASH_DIR, again.body.batch)));

  const log = (db.prepare(`SELECT action FROM audit WHERE action LIKE 'album.%' ORDER BY id`).all() as { action: string }[]).map((r) => r.action);
  assert.deepEqual(log, ['album.deleted', 'album.deleted', 'album.restored', 'album.purged', 'album.deleted']);
});

test('an artist’s songs across albums, and names to pick from', async () => {
  const music = mkdtempSync(join(tmpdir(), 'wl-artist-'));
  const make = (f: string, artist: string) => {
    mkdirSync(join(f, '..'), { recursive: true });
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '1', '-c:a', 'flac', '-metadata', `artist=${artist}`, '-metadata', 'genre=Electro', '-y', f]);
  };
  make(join(music, 'DP', 'A', '1.flac'), 'Daft Punk');
  make(join(music, 'DP', 'B', '1.flac'), 'Daft Punk feat. Pharrell');
  const nd = await navidrome({ a: [{ path: 'DP/A/1.flac', album: 'A', artist: 'Daft Punk' }], b: [{ path: 'DP/B/1.flac', album: 'B', artist: 'Daft Punk' }] });
  const { app, tokens } = await seeded({}, { musicDir: music });
  await json(app, 'PUT', '/api/admin/library/navidrome', { token: tokens.admin, body: { url: nd, username: 'admin', password: 'pw' } });

  const songs = await json(app, 'GET', '/api/admin/tags/albums?ids=a,b', { token: tokens.admin });
  assert.equal(songs.status, 200, JSON.stringify(songs.body));
  assert.deepEqual(songs.body.songs.map((s: { albumId: string; tags: { artist: string } }) => [s.albumId, s.tags.artist]), [['a', 'Daft Punk'], ['b', 'Daft Punk feat. Pharrell']]);
  assert.equal((await json(app, 'GET', '/api/admin/tags/albums', { token: tokens.admin })).status, 400);
  assert.equal((await json(app, 'GET', '/api/admin/tags/albums?ids=a', { token: tokens.kid })).status, 403);

  // a new name saved shows up straight away, before Navidrome rescans
  await json(app, 'PUT', '/api/admin/tags', { token: tokens.admin, body: { label: 'x', changes: [{ path: 'DP/A/1.flac', tags: { artist: 'Daft Punk & Friends', genre: 'French House' } }] } });
  const values = await json(app, 'GET', '/api/admin/tags/values', { token: tokens.admin });
  assert.deepEqual(values.body, { artists: ['Air', 'Daft Punk', 'Daft Punk & Friends'], genres: ['Electronic', 'French House', 'House'] });
});
