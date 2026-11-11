import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { type Catalog, parseProbe } from '../src/catalog.ts';
import { json, seeded } from './helpers.ts';

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** A fake Navidrome: answers getStarred2 and records every call that reaches it. */
async function fakeNavidrome() {
  const calls: string[] = [];
  const srv = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    const q = Object.fromEntries(url.searchParams);
    const method = url.pathname.replace('/rest/', '');
    calls.push(method);
    res.writeHead(200, { 'content-type': 'application/json' });
    // Navidrome's own API, for copying plays and ratings (sorted most first, as asked)
    if (url.pathname === '/auth/login') return res.end(JSON.stringify({ token: 'nd-token' }));
    if (url.pathname === '/api/song') {
      const songs = [{ id: 'nd1', playCount: 7, playDate: '2026-03-01T00:00:00Z', rating: 0 }, { id: 'nd3', playCount: 2, playDate: '2026-05-01T00:00:00Z', rating: 5 }, { id: 'nd4', playCount: 0, rating: 0 }];
      const sort = url.searchParams.get('_sort');
      return res.end(JSON.stringify(sort === 'rating' ? [...songs].sort((a, b) => b.rating - a.rating) : songs));
    }
    if (url.pathname === '/api/playlist') {
      return res.end(JSON.stringify([
        { id: 'pl1', name: 'Road trip', ownerName: 'mia', public: false, rules: null, createdAt: '2026-02-01T00:00:00Z' },
        { id: 'pl2', name: 'Top rated', ownerName: 'mia', public: false, rules: { all: [{ gt: { rating: 3 } }] } },
        { id: 'pl3', name: 'Dad’s', ownerName: 'dad', public: true, rules: null },
      ]));
    }
    if (url.pathname === '/api/playlist/pl1/tracks') return res.end(JSON.stringify([{ id: '1', mediaFileId: 'nd1' }, { id: '2', mediaFileId: 'nd3' }]));
    if (q.u !== 'mia' || md5('mia-real-pw' + q.s) !== q.t) return res.end(JSON.stringify({ 'subsonic-response': { status: 'failed', error: { code: 40 } } }));
    if (method === 'getStarred2') return res.end(JSON.stringify({ 'subsonic-response': { status: 'ok', starred2: { song: [{ id: 'nd2', starred: '2026-01-01T00:00:00Z' }], album: [], artist: [] } } }));
    if (method === 'getPlaylists') {
      return res.end(JSON.stringify({ 'subsonic-response': { status: 'ok', playlists: { playlist: [
        { id: 'pl1', name: 'Road trip', owner: 'mia', songCount: 2 }, { id: 'pl2', name: 'Top rated', owner: 'mia', songCount: 1 }, { id: 'pl3', name: 'Dad’s', owner: 'dad', public: true, songCount: 4 },
      ] } } }));
    }
    if (method === 'createPlaylist' && !q.playlistId) return res.end(JSON.stringify({ 'subsonic-response': { status: 'ok', playlist: { id: 'pl-new', name: q.name } } }));
    res.end(JSON.stringify({ 'subsonic-response': { status: 'ok', from: 'navidrome', method } }));
  });
  servers.push(srv);
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, calls };
}

const TAGS: Record<string, Record<string, string>> = {
  'Drake/Scorpion/01.mp3': { title: 'Nonstop', artist: 'Drake', album_artist: 'Drake', album: 'Scorpion', track: '1', date: '2018', genre: 'Rap; Hip-Hop', ITUNESADVISORY: '1', REPLAYGAIN_TRACK_GAIN: '-7.20 dB', REPLAYGAIN_ALBUM_GAIN: '-6.80 dB' },
  'Drake/Scorpion/02.mp3': { title: 'Elevate', artist: 'Drake', album_artist: 'Drake', album: 'Scorpion', track: '2', date: '2018', genre: 'Rap; Hip-Hop' },
  'The Beatles/Abbey Road/01.flac': { title: 'Come Together', artist: 'The Beatles', album_artist: 'The Beatles', album: 'Abbey Road', track: '1', date: '1969', genre: 'Rock' },
  'Mariah Carey/Merry Christmas/01.mp3': { title: 'All I Want for Christmas Is You', artist: 'Mariah Carey', album_artist: 'Mariah Carey', album: 'Merry Christmas', track: '1', date: '1994', genre: 'Pop; Christmas' },
};
const ND: Record<string, { id: string; albumId: string; artistId: string; albumArtistId: string }> = {
  'Drake/Scorpion/01.mp3': { id: 'nd1', albumId: 'al1', artistId: 'ar1', albumArtistId: 'ar1' },
  'Drake/Scorpion/02.mp3': { id: 'nd2', albumId: 'al1', artistId: 'ar1', albumArtistId: 'ar1' },
  'The Beatles/Abbey Road/01.flac': { id: 'nd3', albumId: 'al2', artistId: 'ar2', albumArtistId: 'ar2' },
  'Mariah Carey/Merry Christmas/01.mp3': { id: 'nd4', albumId: 'al3', artistId: 'ar3', albumArtistId: 'ar3' },
};

async function setup() {
  const musicDir = mkdtempSync(join(tmpdir(), 'wl-subsonic-'));
  for (const p of Object.keys(TAGS)) {
    mkdirSync(join(musicDir, p, '..'), { recursive: true });
    writeFileSync(join(musicDir, p), 'not really audio');
  }
  const nd = await fakeNavidrome();
  const hub = await seeded({}, { musicDir, dataDir: mkdtempSync(join(tmpdir(), 'wl-subsonic-data-')) });
  const { app, tokens, ids } = hub;
  const catalog = (app as unknown as { hubCatalog: Catalog }).hubCatalog;
  catalog.probeFn = async (f) => {
    const rel = f.slice(musicDir.length + 1);
    return parseProbe({ format: { duration: '200.4', bit_rate: '320000', tags: TAGS[rel] }, streams: [{ codec_type: 'audio', codec_name: rel.endsWith('flac') ? 'flac' : 'mp3' }] });
  };
  catalog.listNavidrome = async () => Object.entries(ND).map(([p, s]) => ({ ...s, path: `/music/${p}` }));
  catalog.listRealPaths = async () => new Map(Object.entries(ND).map(([p, s]) => [s.id, { path: `/music/${p}`, albumArtistId: s.albumArtistId }]));
  await catalog.scan();

  const s = await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'navidrome', url: nd.url, config: { relay: 'everyone' } } });
  await json(app, 'PUT', `/api/admin/services/${s.body.service.id}/users/${ids.member}`, { token: tokens.admin, body: { secrets: { username: 'mia', password: 'mia-real-pw' } } });
  const mia = (await json(app, 'GET', '/api/me/services', { token: tokens.member })).body.services[0];
  const rest = async (method: string, params: Record<string, string> = {}) => {
    const salt = 'abc123';
    const r = await app.inject({ method: 'GET', url: `/nd/${s.body.service.id}/rest/${method}?${new URLSearchParams({ u: mia.secrets.username, t: md5(mia.secrets.password + salt), s: salt, v: '1.16.1', c: 'test', f: 'json', ...params })}` });
    return { by: r.headers['x-wavelength-answered-by'], body: r.headers['content-type']?.toString().startsWith('application/json') ? r.json()['subsonic-response'] : r.rawPayload, type: r.headers['content-type'] };
  };
  return { ...hub, musicDir, nd, rest, catalog };
}

test('with the switch on, the Hub answers browsing and search from the catalog, with Navidrome’s ids and stars', async () => {
  const { app, tokens, nd, rest } = await setup();

  // off by default: Navidrome answers
  assert.equal((await rest('getAlbum', { id: 'al1' })).body.from, 'navidrome');
  assert.equal((await json(app, 'PUT', '/api/admin/catalog', { token: tokens.member, body: { serve: true } })).status, 403);
  assert.equal((await json(app, 'PUT', '/api/admin/catalog', { token: tokens.admin, body: { serve: 'yes' } })).status, 400);
  const on = await json(app, 'PUT', '/api/admin/catalog', { token: tokens.admin, body: { serve: true } });
  assert.equal(on.body.serve, true);
  assert.equal(on.body.serving, true);
  nd.calls.length = 0;

  const album = await rest('getAlbum', { id: 'al1' });
  assert.equal(album.by, 'hub');
  assert.equal(album.body.status, 'ok');
  assert.equal(album.body.album.name, 'Scorpion');
  assert.equal(album.body.album.artistId, 'ar1');
  assert.equal(album.body.album.songCount, 2);
  assert.equal(album.body.album.explicitStatus, 'explicit');
  assert.deepEqual(album.body.album.genres, [{ name: 'Rap' }, { name: 'Hip-Hop' }]);
  assert.deepEqual(album.body.album.song.map((x: { id: string }) => x.id), ['nd1', 'nd2']);
  const [first, second] = album.body.album.song;
  assert.equal(first.title, 'Nonstop');
  assert.equal(first.duration, 200);
  assert.equal(first.contentType, 'audio/mpeg');
  assert.equal(first.coverArt, 'al-al1');
  assert.deepEqual(first.replayGain, { trackGain: -7.2, albumGain: -6.8 });
  assert.ok(!first.starred);
  assert.equal(second.starred, '2026-01-01T00:00:00Z', 'hearts come from Navidrome');
  assert.deepEqual(nd.calls, ['getStarred2'], 'only the stars were asked of Navidrome');

  const artists = await rest('getArtists');
  assert.deepEqual(artists.body.artists.index.map((i: { name: string; artist: { name: string }[] }) => [i.name, i.artist.map((a) => a.name)]), [
    ['B', ['The Beatles']], ['D', ['Drake']], ['M', ['Mariah Carey']],
  ], '"The" is left out when sorting');
  const artist = await rest('getArtist', { id: 'ar2' });
  assert.deepEqual(artist.body.artist.album.map((a: { name: string }) => a.name), ['Abbey Road']);

  const genres = await rest('getGenres');
  assert.deepEqual(genres.body.genres.genre.map((g: { value: string; songCount: number }) => [g.value, g.songCount]), [['Christmas', 1], ['Hip-Hop', 2], ['Pop', 1], ['Rap', 2], ['Rock', 1]]);
  assert.deepEqual((await rest('getSongsByGenre', { genre: 'christmas', count: '50' })).body.songsByGenre.song.map((x: { id: string }) => x.id), ['nd4']);
  assert.equal((await rest('getRandomSongs', { size: '10', fromYear: '2000', toYear: '2030' })).body.randomSongs.song.length, 2);

  const byName = await rest('getAlbumList2', { type: 'alphabeticalByName', size: '10' });
  assert.deepEqual(byName.body.albumList2.album.map((a: { name: string }) => a.name), ['Abbey Road', 'Merry Christmas', 'Scorpion']);
  const byYear = await rest('getAlbumList2', { type: 'byYear', fromYear: '2020', toYear: '1960' });
  assert.deepEqual(byYear.body.albumList2.album.map((a: { year: number }) => a.year), [2018, 1994, 1969], 'from > to counts down');
  assert.equal((await rest('getAlbumList2', { type: 'newest', size: '2' })).body.albumList2.album.length, 2);

  const found = await rest('search3', { query: 'drak elev' });
  assert.deepEqual(found.body.searchResult3.song.map((x: { id: string }) => x.id), ['nd2']);
  assert.deepEqual(found.body.searchResult3.artist, []);
  const beatles = await rest('search3', { query: 'beatles', songCount: '0' });
  assert.deepEqual(beatles.body.searchResult3.artist.map((a: { id: string }) => a.id), ['ar2']);
  assert.deepEqual(beatles.body.searchResult3.album.map((a: { id: string }) => a.id), ['al2']);
  assert.deepEqual(beatles.body.searchResult3.song, []);

  // Navidrome still answers what needs a person's plays, ids the catalog doesn't know, playing, and XML callers
  nd.calls.length = 0;
  assert.equal((await rest('getAlbumList2', { type: 'recent' })).body.from, 'navidrome');
  assert.equal((await rest('getAlbum', { id: 'brand-new' })).body.from, 'navidrome');
  assert.equal((await rest('getPlaylists')).by, undefined);
  assert.equal((await rest('getAlbum', { id: 'al1', f: 'xml' })).by, undefined);
  assert.deepEqual(nd.calls, ['getAlbumList2', 'getAlbum', 'getPlaylists', 'getAlbum']);

  // starring through the Hub shows at once
  await rest('star', { id: 'nd1' });
  nd.calls.length = 0;
  await rest('getSong', { id: 'nd1' });
  assert.deepEqual(nd.calls, ['getStarred2'], 'stars were asked again after starring');
});

test('covers come from the album folder, sized, and from the file when there is no picture', { skip: !hasFfmpeg && 'needs ffmpeg' }, async () => {
  const { app, tokens, musicDir, nd, rest } = await setup();
  await json(app, 'PUT', '/api/admin/catalog', { token: tokens.admin, body: { serve: true } });
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=600x600', '-frames:v', '1', '-y', join(musicDir, 'Drake/Scorpion/cover.jpg')]);
  nd.calls.length = 0;
  const big = await rest('getCoverArt', { id: 'al-al1_6543210' });
  assert.equal(big.by, 'hub');
  assert.equal(big.type, 'image/jpeg');
  const small = await rest('getCoverArt', { id: 'mf-nd2', size: '100' });
  assert.equal(small.by, 'hub');
  assert.ok((small.body as Buffer).length < (big.body as Buffer).length, 'made smaller');
  assert.deepEqual(nd.calls, []);
  // no picture in the folder or the file, and artist pictures: Navidrome's
  await rest('getCoverArt', { id: 'al-al2' });
  await rest('getCoverArt', { id: 'ar-ar1' });
  assert.deepEqual(nd.calls, ['getCoverArt', 'getCoverArt']);
});

test('with the play switch on, the Hub sends the files itself, with seeking, and converts when asked', { skip: !hasFfmpeg && 'needs ffmpeg' }, async () => {
  const { app, tokens, musicDir, nd, rest } = await setup();
  // a real song for the converting part
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'flac', '-y', join(musicDir, 'The Beatles/Abbey Road/01.flac')]);

  // off: Navidrome plays
  nd.calls.length = 0;
  await rest('stream', { id: 'nd1' });
  assert.deepEqual(nd.calls, ['stream']);

  const on = await json(app, 'PUT', '/api/admin/catalog', { token: tokens.admin, body: { stream: true } });
  assert.equal(on.body.stream, true);
  assert.equal(on.body.streaming, true);
  assert.equal(on.body.serve, false, 'the two switches are separate');
  assert.equal((await json(app, 'PUT', '/api/admin/catalog', { token: tokens.admin, body: {} })).status, 400);
  nd.calls.length = 0;

  const whole = await rest('stream', { id: 'nd1' });
  assert.equal(whole.by, 'hub');
  assert.equal(whole.type, 'audio/mpeg');
  assert.equal((whole.body as Buffer).toString(), 'not really audio');

  // seeking: a Range request gets that part
  const url = (await (async () => {
    const services = (await json(app, 'GET', '/api/me/services', { token: tokens.member })).body.services[0];
    const salt = 'zz';
    return `/nd/${services.id}/rest/stream?${new URLSearchParams({ u: services.secrets.username, t: md5(services.secrets.password + salt), s: salt, v: '1.16.1', c: 't', id: 'nd1' })}`;
  })());
  const part = await app.inject({ method: 'GET', url, headers: { range: 'bytes=4-7' } });
  assert.equal(part.statusCode, 206);
  assert.equal(part.headers['content-range'], 'bytes 4-7/16');
  assert.equal(part.body, 'real');
  assert.equal((await app.inject({ method: 'GET', url, headers: { range: 'bytes=99-' } })).statusCode, 416);
  const etag = part.headers.etag as string;
  assert.equal((await app.inject({ method: 'GET', url, headers: { 'if-none-match': etag } })).statusCode, 304);

  const dl = await app.inject({ method: 'GET', url: url.replace('/rest/stream?', '/rest/download?') });
  assert.match(String(dl.headers['content-disposition']), /attachment; filename\*=UTF-8''01\.mp3/);

  // a lower bitrate: converted to mp3 as it plays
  const low = await rest('stream', { id: 'nd3', maxBitRate: '128' });
  assert.equal(low.by, 'hub');
  assert.equal(low.type, 'audio/mpeg');
  assert.ok((low.body as Buffer).length > 1000, 'some mp3 came out');
  assert.deepEqual(nd.calls, [], 'Navidrome wasn’t asked for any of it');

  // Listening now says who sent the song
  await json(app, 'POST', '/api/me/playing', { token: tokens.member, body: { title: 'Come Together', artist: 'The Beatles', source: 'navidrome' } });
  const listening = async () => (await json(app, 'GET', '/api/admin/listening', { token: tokens.admin })).body.listening.find((p: { title: string }) => p.title === 'Come Together');
  assert.equal((await listening()).playedBy, 'hub');

  // a song the catalog doesn't know, and a format the Hub doesn't make: Navidrome's
  await rest('stream', { id: 'brand-new' });
  await rest('stream', { id: 'nd3', format: 'wma' });
  assert.deepEqual(nd.calls, ['stream', 'stream']);
  assert.equal((await listening()).playedBy, 'navidrome');
  // a device that never streams through the Hub talks to Navidrome directly
  await json(app, 'POST', '/api/me/playing', { token: tokens.admin, body: { title: 'Direct', source: 'navidrome' } });
  const all = (await json(app, 'GET', '/api/admin/listening', { token: tokens.admin })).body.listening;
  assert.equal(all.find((p: { title: string }) => p.title === 'Direct').playedBy, 'direct');
});

test('with the hearts switch on, the Hub copies a person’s hearts and plays once, keeps them, and tells Navidrome', async () => {
  const { app, tokens, nd, rest } = await setup();
  await json(app, 'PUT', '/api/admin/catalog', { token: tokens.admin, body: { serve: true } });
  const on = await json(app, 'PUT', '/api/admin/catalog', { token: tokens.admin, body: { userData: true } });
  assert.equal(on.body.userData, true);

  // the first call copies Mia's hearts and plays
  const album = await rest('getAlbum', { id: 'al1' });
  assert.equal(album.by, 'hub');
  const [first, second] = album.body.album.song;
  assert.equal(first.playCount, 7);
  assert.equal(first.played, '2026-03-01T00:00:00.000Z');
  assert.equal(second.starred, '2026-01-01T00:00:00.000Z');
  assert.equal(album.body.album.playCount, 7);
  const st = await json(app, 'GET', '/api/admin/catalog', { token: tokens.admin });
  assert.deepEqual(st.body.people, { people: 1, stars: 1, plays: 9 });

  // hearts, plays and ratings recorded here, and passed on to Navidrome
  nd.calls.length = 0;
  assert.equal((await rest('star', { albumId: 'al2' })).by, 'hub');
  assert.equal((await rest('unstar', { id: 'nd2' })).by, 'hub');
  await rest('scrobble', { id: 'nd3', submission: 'true', time: String(Date.parse('2026-06-01T00:00:00Z')) });
  await rest('scrobble', { id: 'nd3', submission: 'false' });
  await rest('setRating', { id: 'nd1', rating: '4' });
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(nd.calls.sort(), ['scrobble', 'scrobble', 'setRating', 'star', 'unstar']);
  nd.calls.length = 0;

  const starred = await rest('getStarred2');
  assert.deepEqual(starred.body.starred2.album.map((a: { id: string }) => a.id), ['al2']);
  assert.deepEqual(starred.body.starred2.song, []);
  const frequent = await rest('getAlbumList2', { type: 'frequent', size: '10' });
  assert.deepEqual(frequent.body.albumList2.album.map((a: { id: string; playCount: number }) => [a.id, a.playCount]), [['al1', 7], ['al2', 3]]);
  const recent = await rest('getAlbumList2', { type: 'recent', size: '10' });
  assert.deepEqual(recent.body.albumList2.album.map((a: { id: string }) => a.id), ['al2', 'al1']);
  assert.deepEqual((await rest('getAlbumList2', { type: 'starred' })).body.albumList2.album.map((a: { id: string }) => a.id), ['al2']);
  assert.deepEqual((await rest('getAlbumList2', { type: 'highest' })).body.albumList2.album.map((a: { id: string }) => a.id), ['al2', 'al1'], 'rated 5 then 4');
  assert.equal((await rest('getSong', { id: 'nd1' })).body.song.userRating, 4);
  assert.deepEqual(nd.calls, [], 'Navidrome wasn’t asked for any of it');
});

test('with the hearts switch on, the Hub keeps a person’s own playlists, leaves smart ones on Navidrome, and tells Navidrome of changes', async () => {
  const { app, tokens, nd, rest } = await setup();
  await json(app, 'PUT', '/api/admin/catalog', { token: tokens.admin, body: { serve: true, userData: true } });

  // copied on first use: Road trip is Mia's own; Top rated is smart and Dad's isn't hers, so both stay on Navidrome
  const lists = await rest('getPlaylists');
  assert.equal(lists.by, 'hub');
  const byId = new Map(lists.body.playlists.playlist.map((p: { id: string }) => [p.id, p]));
  assert.deepEqual([...byId.keys()].sort(), ['pl1', 'pl2', 'pl3']);
  const road = byId.get('pl1') as { owner: string; songCount: number; duration: number };
  assert.match(road.owner, /~\d+$/, 'her own shows under her relay login, so the app lets her change it');
  assert.equal(road.songCount, 2);
  assert.equal(road.duration, 400);

  const one = await rest('getPlaylist', { id: 'pl1' });
  assert.equal(one.by, 'hub');
  assert.deepEqual(one.body.playlist.entry.map((s: { id: string }) => s.id), ['nd1', 'nd3']);
  assert.equal(one.body.playlist.entry[0].playCount, 7, 'with her plays');
  nd.calls.length = 0;
  assert.equal((await rest('getPlaylist', { id: 'pl2' })).by, undefined, 'smart playlists come from Navidrome');
  assert.deepEqual(nd.calls, ['getPlaylist']);

  // changes are made here and passed on
  nd.calls.length = 0;
  await rest('updatePlaylist', { playlistId: 'pl1', name: 'Long drive', songIdToAdd: 'nd4', songIndexToRemove: '0' });
  const changed = await rest('getPlaylist', { id: 'pl1' });
  assert.equal(changed.body.playlist.name, 'Long drive');
  assert.deepEqual(changed.body.playlist.entry.map((s: { id: string }) => s.id), ['nd3', 'nd4']);
  const made = await rest('createPlaylist', { name: 'Fresh', songId: 'nd2' });
  assert.equal(made.body.playlist.id, 'pl-new', 'same id as Navidrome');
  assert.deepEqual(made.body.playlist.entry.map((s: { id: string }) => s.id), ['nd2']);
  await rest('deletePlaylist', { id: 'pl1' });
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(nd.calls.sort(), ['createPlaylist', 'deletePlaylist', 'updatePlaylist']);
  const after = await rest('getPlaylists');
  assert.deepEqual(after.body.playlists.playlist.map((p: { id: string }) => p.id).sort(), ['pl-new', 'pl2', 'pl3'], 'the deleted one stays gone even while Navidrome still lists it');
});
