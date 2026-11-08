import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { type Catalog, fromNavidromePath, parseProbe } from '../src/catalog.ts';
import { json, seeded } from './helpers.ts';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** A one-second tone with these tags. */
function song(file: string, tags: Record<string, string>) {
  mkdirSync(join(file, '..'), { recursive: true });
  const meta = Object.entries(tags).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', ...meta, file]);
}

test('reads tags whatever the format calls them', () => {
  const t = parseProbe({
    format: { duration: '201.5', bit_rate: '320000', tags: { TITLE: 'Nonstop', ARTIST: 'Drake', album_artist: 'Drake', ALBUM: 'Scorpion', track: '3/25', disc: '1/2', date: '2018-06-29', GENRE: 'Rap; Hip-Hop', ITUNESADVISORY: '1', 'MusicBrainz Track Id': 'abc' } },
    streams: [{ codec_type: 'audio', codec_name: 'mp3' }],
  });
  assert.deepEqual(t, {
    title: 'Nonstop', artist: 'Drake', album: 'Scorpion', albumArtist: 'Drake', track: 3, disc: 1, year: 2018, genre: 'Rap; Hip-Hop',
    explicit: 'explicit', duration: 201.5, bitRate: 320, codec: 'mp3', mbTrackId: 'abc', mbAlbumId: '',
  });
  // Ogg keeps tags on the stream
  const ogg = parseProbe({ format: { duration: '3' }, streams: [{ codec_type: 'audio', codec_name: 'opus', tags: { title: 'Halo', ALBUMARTIST: 'Beyoncé', ITUNESADVISORY: '2' } }] });
  assert.equal(ogg.title, 'Halo');
  assert.equal(ogg.albumArtist, 'Beyoncé');
  assert.equal(ogg.explicit, 'clean');
  assert.equal(ogg.track, null);
});

test("maps Navidrome's paths onto the music folder", () => {
  assert.equal(fromNavidromePath('/music', '/music/A/B/01.flac'), 'A/B/01.flac');
  assert.equal(fromNavidromePath('/music/', 'A/B/01.flac'), 'A/B/01.flac');
  assert.equal(fromNavidromePath('/music', '/data/A/01.flac'), null);
  assert.equal(fromNavidromePath('/music', ''), null);
});

test('scans the music folder, reads only what changed, and links files to Navidrome songs', { skip: !hasFfmpeg && 'needs ffmpeg' }, async () => {
  const musicDir = mkdtempSync(join(tmpdir(), 'wl-catalog-'));
  song(join(musicDir, 'Drake/Scorpion/01 Nonstop.mp3'), { title: 'Nonstop', artist: 'Drake', album_artist: 'Drake', album: 'Scorpion', track: '1', date: '2018', genre: 'Rap; Hip-Hop' });
  song(join(musicDir, 'Drake/Scorpion/02 Elevate.flac'), { title: 'Elevate', artist: 'Drake', album: 'Scorpion', track: '2' });
  song(join(musicDir, 'Kendrick Lamar/GNX/01.mp3'), { title: '', artist: 'Kendrick Lamar' });
  // left out: hidden folders (the trash) and folders Navidrome is told to ignore
  song(join(musicDir, '.wavelength-trash/1/x.mp3'), { title: 'Deleted' });
  song(join(musicDir, 'Ignored/y.mp3'), { title: 'Ignored' });
  writeFileSync(join(musicDir, 'Ignored/.ndignore'), '');
  writeFileSync(join(musicDir, 'Drake/Scorpion/cover.jpg'), 'not music');

  const { app, db, tokens } = await seeded({}, { musicDir });
  const catalog = (app as unknown as { hubCatalog: Catalog }).hubCatalog;
  let reads = 0;
  const real = catalog.probeFn;
  catalog.probeFn = (f) => (reads++, real(f));
  catalog.listNavidrome = async () => [
    { id: 'nd1', albumId: 'al1', artistId: 'ar1', path: '/music/Drake/Scorpion/01 Nonstop.mp3' },
    { id: 'nd2', albumId: 'al1', artistId: 'ar1', path: 'Drake/Scorpion/02 Elevate.flac' },
    { id: 'nd9', path: '/music/Gone/away.mp3' },
  ];

  await catalog.scan();
  assert.equal(reads, 3);
  const st = await json(app, 'GET', '/api/admin/catalog', { token: tokens.admin });
  assert.equal(st.status, 200);
  assert.equal(st.body.files, 3);
  assert.equal(st.body.linked, 2);
  assert.equal(st.body.navidromeSongs, 3);
  assert.equal(st.body.failed, 0);
  assert.deepEqual(st.body.lastChanges, { added: 3, changed: 0, removed: 0 });
  assert.equal(st.body.summary.albums, 2);
  assert.equal(st.body.summary.artists, 2);
  assert.equal(st.body.summary.untagged, 1);
  assert.equal(st.body.summary.unlinked, 1);
  assert.deepEqual(st.body.summary.genres, [{ genre: 'Rap; Hip-Hop', files: 1 }]);
  assert.deepEqual(st.body.summary.formats.map((f: { codec: string }) => f.codec).sort(), ['flac', 'mp3']);
  const row = db.prepare("SELECT * FROM catalog_songs WHERE path = 'Drake/Scorpion/01 Nonstop.mp3'").get() as Record<string, unknown>;
  assert.equal(row.title, 'Nonstop');
  assert.equal(row.year, 2018);
  assert.equal(row.track, 1);
  assert.equal(row.nd_id, 'nd1');
  assert.equal(row.nd_album_id, 'al1');
  assert.ok(Number(row.duration) > 0.9);

  // nothing changed: nothing read again
  await catalog.scan();
  assert.equal(reads, 3);

  // one file retagged, one removed
  song(join(musicDir, 'Drake/Scorpion/02 Elevate.flac'), { title: 'Elevate', artist: 'Drake', album: 'Scorpion', genre: 'Pop' });
  utimesSync(join(musicDir, 'Drake/Scorpion/02 Elevate.flac'), new Date(), new Date(Date.now() + 5000));
  rmSync(join(musicDir, 'Kendrick Lamar'), { recursive: true });
  await catalog.scan();
  assert.equal(reads, 4);
  const after = (await json(app, 'GET', '/api/admin/catalog', { token: tokens.admin })).body;
  assert.equal(after.files, 2);
  assert.deepEqual(after.lastChanges, { added: 0, changed: 1, removed: 1 });
  assert.equal((db.prepare("SELECT genre FROM catalog_songs WHERE path LIKE '%Elevate%'").get() as { genre: string }).genre, 'Pop');

  // a file that isn't really audio is kept with its error
  writeFileSync(join(musicDir, 'broken.mp3'), 'not audio');
  await catalog.scan();
  const broken = (await json(app, 'GET', '/api/admin/catalog', { token: tokens.admin })).body;
  assert.equal(broken.failed, 1);
  assert.equal(broken.summary.failed[0].path, 'broken.mp3');

  // only admins
  assert.equal((await json(app, 'GET', '/api/admin/catalog', { token: tokens.member })).status, 403);
  assert.equal((await json(app, 'POST', '/api/admin/catalog/scan', { token: tokens.member })).status, 403);
  rmSync(musicDir, { recursive: true, force: true });
});

test("a folder that suddenly looks empty (share not mounted) doesn't empty the catalog", async () => {
  const musicDir = mkdtempSync(join(tmpdir(), 'wl-catalog-'));
  for (let i = 0; i < 30; i++) {
    mkdirSync(join(musicDir, `A${i}`), { recursive: true });
    writeFileSync(join(musicDir, `A${i}/song.mp3`), String(i));
  }
  const { app, tokens } = await seeded({}, { musicDir });
  const catalog = (app as unknown as { hubCatalog: Catalog }).hubCatalog;
  catalog.probeFn = async () => parseProbe({ format: { duration: '100', tags: { title: 'T', artist: 'A', album: 'B' } } });
  await catalog.scan();
  assert.equal(catalog.status().files, 30);
  for (let i = 0; i < 25; i++) rmSync(join(musicDir, `A${i}`), { recursive: true });
  await assert.rejects(catalog.scan(), /Is the share mounted/);
  const st = (await json(app, 'GET', '/api/admin/catalog', { token: tokens.admin })).body;
  assert.equal(st.files, 30);
  assert.match(st.lastError, /Nothing was removed/);
  rmSync(musicDir, { recursive: true, force: true });
});

test('without a music folder the catalog says why', async () => {
  const { app, tokens } = await seeded();
  const st = (await json(app, 'GET', '/api/admin/catalog', { token: tokens.admin })).body;
  assert.match(st.blocked, /no music folder/);
  assert.equal(st.files, 0);
});

test("sound-alike analysis takes its songs from the library index's listing", async () => {
  const { saveScanSettings } = await import('../src/library.ts');
  const { app, db, config } = await seeded();
  saveScanSettings(db, config.secretKey, { url: 'http://nd.test', username: 'admin', password: 'pw' });
  const sonic = (app as unknown as { hubSonic: import('../src/sonic/worker.ts').SonicWorker }).hubSonic;
  sonic.listSongs = async () => [
    { id: 'a', path: 'X/a.flac', title: 'A', artist: 'Band', album: 'X', duration: 200 },
    { id: 'b', title: 'No path' },
  ];
  assert.equal(await sonic.list(), 1);
  assert.deepEqual(db.prepare('SELECT id, path, title FROM sonic_songs').all().map((r) => ({ ...r })), [{ id: 'a', path: 'X/a.flac', title: 'A' }]);
});
