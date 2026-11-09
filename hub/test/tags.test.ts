import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { ART_APIS } from '../src/artwork.ts';
import { readTags } from '../src/tags.ts';
import { json, seeded } from './helpers.ts';

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

/** A second of silence with some tags, in a real audio format. */
function audio(file: string, tags: Record<string, string>, codec: string[]) {
  const meta = Object.entries(tags).flatMap(([k, v]) => [file.endsWith('.opus') ? '-metadata:s:a:0' : '-metadata', `${k}=${v}`]);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '1', ...codec, ...meta, '-y', file]);
}

async function listen(handler: (url: string, body: string) => [number, unknown]) {
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const [status, v] = handler(req.url!, body);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(v));
    });
  });
  servers.push(srv);
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  return `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
}

test('admins fix an album’s tags from a Deezer or MusicBrainz match, and undo it', async () => {
  const music = mkdtempSync(join(tmpdir(), 'wl-tags-'));
  const dir = join(music, 'Daft Punk', 'Discovery');
  mkdirSync(dir, { recursive: true });
  audio(join(dir, '01.mp3'), { title: 'one more time', artist: 'daft punk', album: 'Discovery', track: '1' }, ['-c:a', 'libmp3lame', '-b:a', '64k']);
  audio(join(dir, '02.flac'), { title: 'Aerodynamic', artist: 'Daft Punk', album: 'Discovery' }, ['-c:a', 'flac']);
  audio(join(dir, '03.opus'), { title: 'Digital Luv', artist: 'Daft Punk' }, ['-c:a', 'libopus']);

  const nd = await listen((url) => {
    if (url === '/auth/login') return [200, { token: 'jwt', isAdmin: true }];
    if (url.startsWith('/rest/')) return [200, { 'subsonic-response': { status: 'ok', user: { adminRole: true } } }];
    if (url.startsWith('/api/song?')) {
      return [200, [
        { id: 'a', albumId: 'al1', path: '/music/Daft Punk/Discovery/01.mp3' },
        { id: 'b', albumId: 'al1', path: 'Daft Punk/Discovery/02.flac' },
        { id: 'c', albumId: 'al1', path: '/music/Daft Punk/Discovery/03.opus' },
      ]];
    }
    return [404, {}];
  });
  const apis = await listen((url) => {
    if (url.startsWith('/deezer/search/album')) return [200, { data: [{ id: 302127 }] }];
    if (url === '/deezer/album/302127') {
      return [200, { title: 'Discovery', artist: { name: 'Daft Punk' }, release_date: '2001-03-07', genres: { data: [{ name: 'Electro' }] }, tracks: { data: [
        { title: 'One More Time', artist: { name: 'Daft Punk' }, track_position: 1, disk_number: 1 },
        { title: 'Aerodynamic', artist: { name: 'Daft Punk' }, track_position: 2, disk_number: 1 },
        { title: 'Digital Love', artist: { name: 'Daft Punk' }, track_position: 3, disk_number: 1 },
      ] } }];
    }
    if (url.startsWith('/mb/ws/2/release?')) return [200, { releases: [{ id: 'mb-1' }] }];
    if (url.startsWith('/mb/ws/2/release/mb-1')) {
      return [200, { title: 'Discovery', date: '2001-03-12', 'artist-credit': [{ name: 'Daft Punk' }], genres: [{ name: 'house', count: 3 }, { name: 'french house', count: 9 }], media: [{ position: 1, tracks: [{ title: 'One More Time', position: 1 }] }] }];
    }
    return [404, {}];
  });
  Object.assign(ART_APIS, { deezer: `${apis}/deezer`, musicbrainz: `${apis}/mb` });

  const { app, tokens } = await seeded({}, { musicDir: music });
  const login = await json(app, 'PUT', '/api/admin/library/navidrome', { token: tokens.admin, body: { url: nd, username: 'admin', password: 'pw' } });
  assert.equal(login.status, 200, JSON.stringify(login.body));

  const album = await json(app, 'GET', '/api/admin/tags/album/al1', { token: tokens.admin });
  assert.equal(album.status, 200, JSON.stringify(album.body));
  assert.deepEqual(album.body.songs.map((s: { path: string }) => s.path), ['Daft Punk/Discovery/01.mp3', 'Daft Punk/Discovery/02.flac', 'Daft Punk/Discovery/03.opus']);
  assert.equal(album.body.songs[0].tags.title, 'one more time');
  assert.equal(album.body.songs[2].tags.title, 'Digital Luv');
  assert.equal((await json(app, 'GET', '/api/admin/tags/album/al1', { token: tokens.member })).status, 403);

  const m = await json(app, 'GET', '/api/admin/tags/match?artist=Daft%20Punk&album=Discovery', { token: tokens.admin });
  assert.deepEqual(m.body.candidates.map((c: { source: string; year: string; genre: string }) => [c.source, c.year, c.genre]), [['Deezer', '2001', 'Electro'], ['MusicBrainz', '2001', 'french house']]);

  const sizeBefore = statSync(join(dir, '02.flac')).size;
  const save = await json(app, 'PUT', '/api/admin/tags', { token: tokens.admin, body: { label: 'Daft Punk – Discovery', changes: [
    { path: 'Daft Punk/Discovery/01.mp3', tags: { title: 'One More Time', artist: 'Daft Punk', year: '2001', genre: 'Electro', track: '1' } },
    { path: 'Daft Punk/Discovery/02.flac', tags: { title: 'Aerodynamic', track: '2', albumArtist: 'Daft Punk' } },
    { path: 'Daft Punk/Discovery/03.opus', tags: { title: 'Digital Love', track: '3' } },
  ] } });
  assert.equal(save.status, 200, JSON.stringify(save.body));
  assert.deepEqual(save.body.failed, []);
  assert.equal(save.body.changed.length, 3);
  assert.equal((await readTags(join(dir, '01.mp3'))).title, 'One More Time');
  assert.equal((await readTags(join(dir, '01.mp3'))).genre, 'Electro');
  assert.equal((await readTags(join(dir, '02.flac'))).albumArtist, 'Daft Punk');
  assert.equal((await readTags(join(dir, '02.flac'))).album, 'Discovery', 'tags not sent stay');
  assert.equal((await readTags(join(dir, '03.opus'))).title, 'Digital Love');
  assert.ok(Math.abs(statSync(join(dir, '02.flac')).size - sizeBefore) < 512, 'the audio is copied, not re-encoded');
  assert.deepEqual(readdirSync(dir).sort(), ['01.mp3', '02.flac', '03.opus'], 'no temporary files left');

  // files outside the music folder are refused
  const escape = await json(app, 'PUT', '/api/admin/tags', { token: tokens.admin, body: { changes: [{ path: '../../etc/passwd.mp3', tags: { title: 'x' } }] } });
  assert.equal(escape.status, 400);

  const hist = await json(app, 'GET', '/api/admin/tags/history', { token: tokens.admin });
  assert.equal(hist.body.edits[0].files, 3);
  assert.equal(hist.body.edits[0].by, 'boss');
  const undo = await json(app, 'POST', `/api/admin/tags/undo/${save.body.batch}`, { token: tokens.admin });
  assert.equal(undo.body.undone, 3);
  const back = await readTags(join(dir, '01.mp3'));
  assert.equal(back.title, 'one more time');
  assert.equal(back.genre, undefined, 'a tag that was added is removed again');
  assert.equal((await readTags(join(dir, '03.opus'))).title, 'Digital Luv');
  assert.equal((await json(app, 'POST', `/api/admin/tags/undo/${save.body.batch}`, { token: tokens.admin })).status, 404);
  const log = JSON.stringify((await json(app, 'GET', '/api/admin/audit', { token: tokens.admin })).body);
  assert.ok(log.includes('tags.edited') && log.includes('tags.undone'));
});

test('Edit song: one song’s tags by its Navidrome id, a featured artist written and undone', async () => {
  const music = mkdtempSync(join(tmpdir(), 'wl-song-'));
  const dir = join(music, 'Mannie Fresh', 'The Mind Of Mannie Fresh');
  mkdirSync(dir, { recursive: true });
  audio(join(dir, '15.mp3'), { title: 'Real Big (feat. Lil Wayne)', artist: 'Mannie Fresh', album: 'The Mind Of Mannie Fresh', track: '15' }, ['-c:a', 'libmp3lame', '-b:a', '64k']);
  audio(join(dir, '07.mp3'), { title: 'Wayne’s Takeover 1', artist: 'Mannie Fresh', track: '7' }, ['-c:a', 'libmp3lame', '-b:a', '64k']);
  const nd = await listen((url) => {
    if (url === '/auth/login') return [200, { token: 'jwt', isAdmin: true }];
    if (url.startsWith('/rest/')) return [200, { 'subsonic-response': { status: 'ok', user: { adminRole: true } } }];
    if (url.startsWith('/api/song?')) {
      return [200, [
        { id: 's7', albumId: 'mf', path: '/music/Mannie Fresh/The Mind Of Mannie Fresh/07.mp3' },
        { id: 's15', albumId: 'mf', path: '/music/Mannie Fresh/The Mind Of Mannie Fresh/15.mp3' },
      ]];
    }
    return [404, {}];
  });
  const { app, tokens } = await seeded({}, { musicDir: music });
  assert.equal((await json(app, 'PUT', '/api/admin/library/navidrome', { token: tokens.admin, body: { url: nd, username: 'admin', password: 'pw' } })).status, 200);

  const song = await json(app, 'GET', '/api/admin/tags/song/s15?album=mf', { token: tokens.admin });
  assert.equal(song.status, 200, JSON.stringify(song.body));
  assert.equal(song.body.path, 'Mannie Fresh/The Mind Of Mannie Fresh/15.mp3');
  assert.equal(song.body.tags.title, 'Real Big (feat. Lil Wayne)');
  assert.equal(song.body.tags.track, '15');
  assert.equal((await json(app, 'GET', '/api/admin/tags/song/nope?album=mf', { token: tokens.admin })).status, 404);
  assert.equal((await json(app, 'GET', '/api/admin/tags/song/s15?album=mf', { token: tokens.member })).status, 403);

  // the dialog sends only what changed: the title without "(feat. …)" and the credit with Lil Wayne featured
  const save = await json(app, 'PUT', '/api/admin/tags', { token: tokens.admin, body: { label: 'Mannie Fresh feat. Lil Wayne – Real Big', changes: [
    { path: song.body.path, tags: { title: 'Real Big', artist: 'Mannie Fresh feat. Lil Wayne', genre: 'Hip-Hop; Southern Hip-Hop' } },
  ] } });
  assert.equal(save.status, 200, JSON.stringify(save.body));
  const after = await readTags(join(dir, '15.mp3'));
  assert.deepEqual([after.title, after.artist, after.genre, after.album], ['Real Big', 'Mannie Fresh feat. Lil Wayne', 'Hip-Hop; Southern Hip-Hop', 'The Mind Of Mannie Fresh']);
  assert.equal((await readTags(join(dir, '07.mp3'))).title, 'Wayne’s Takeover 1', 'the other songs aren’t touched');

  assert.equal((await json(app, 'POST', `/api/admin/tags/undo/${save.body.batch}`, { token: tokens.admin })).body.undone, 1);
  const back = await readTags(join(dir, '15.mp3'));
  assert.deepEqual([back.title, back.artist, back.genre], ['Real Big (feat. Lil Wayne)', 'Mannie Fresh', undefined]);
});
