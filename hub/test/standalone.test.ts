import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { type Catalog, catalogWrote, parseProbe } from '../src/catalog.ts';
import { json, seeded } from './helpers.ts';

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));
const md5 = (s: string) => createHash('md5').update(s).digest('hex');

/** A fake Navidrome with Mia's hearts, plays and one playlist (with nd9, a song whose file is gone); records every call that reaches it. */
async function fakeNavidrome() {
  const calls: string[] = [];
  const srv = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    calls.push(url.pathname);
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.pathname === '/auth/login') return res.end(JSON.stringify({ token: 'nd-token' }));
    if (url.pathname === '/api/song') return res.end(JSON.stringify(url.searchParams.get('_sort') === 'play_count' ? [{ id: 'nd1', playCount: 4, playDate: '2026-03-01T00:00:00Z' }] : []));
    if (url.pathname === '/api/playlist') return res.end(JSON.stringify([{ id: 'pl1', name: 'Mine', ownerName: 'mia', rules: null }]));
    if (url.pathname === '/api/playlist/pl1/tracks') return res.end(JSON.stringify([{ mediaFileId: 'nd2' }, { mediaFileId: 'nd9' }, { mediaFileId: 'nd1' }]));
    const q = Object.fromEntries(url.searchParams);
    if (q.u !== 'mia' || md5('mia-real-pw' + q.s) !== q.t) return res.end(JSON.stringify({ 'subsonic-response': { status: 'failed', error: { code: 40 } } }));
    if (url.pathname === '/rest/getStarred2') return res.end(JSON.stringify({ 'subsonic-response': { status: 'ok', starred2: { song: [{ id: 'nd2', starred: '2026-01-01T00:00:00Z' }] } } }));
    res.end(JSON.stringify({ 'subsonic-response': { status: 'ok', from: 'navidrome' } }));
  });
  servers.push(srv);
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, calls };
}

/** the tags each file has (tests change some, like the tag editor would) */
const TAGS: Record<string, Record<string, string>> = {
  'Drake/Scorpion/01.mp3': { title: 'Nonstop', artist: 'Drake', album_artist: 'Drake', album: 'Scorpion', track: '1', date: '2018', genre: 'Rap' },
  'Drake/Scorpion/02.mp3': { title: 'Elevate', artist: 'Drake', album_artist: 'Drake', album: 'Scorpion', track: '2', date: '2018', genre: 'Rap' },
  'The Beatles/Abbey Road/01.mp3': { title: 'Come Together', artist: 'The Beatles', album_artist: 'The Beatles', album: 'Abbey Road', track: '1', date: '1969', genre: 'Rock' },
  'The Beatles/Help/01.mp3': { title: 'Help!', artist: 'The Beatles', album_artist: 'The Beatles', album: 'Help!', track: '1', date: '1965', genre: 'Rock' },
};
const ORIGINAL = structuredClone(TAGS);
const ND: Record<string, { id: string; albumId: string; artistId: string; albumArtistId: string }> = {
  'Drake/Scorpion/01.mp3': { id: 'nd1', albumId: 'al1', artistId: 'ar1', albumArtistId: 'ar1' },
  'Drake/Scorpion/02.mp3': { id: 'nd2', albumId: 'al1', artistId: 'ar1', albumArtistId: 'ar1' },
  'The Beatles/Abbey Road/01.mp3': { id: 'nd3', albumId: 'al2', artistId: 'ar2', albumArtistId: 'ar2' },
  'The Beatles/Help/01.mp3': { id: 'nd4', albumId: 'al3', artistId: 'ar2', albumArtistId: 'ar2' },
};

async function setup() {
  for (const k of Object.keys(TAGS)) delete TAGS[k];
  Object.assign(TAGS, structuredClone(ORIGINAL));
  const musicDir = mkdtempSync(join(tmpdir(), 'wl-alone-'));
  const put = (p: string) => {
    mkdirSync(join(musicDir, p, '..'), { recursive: true });
    writeFileSync(join(musicDir, p), `audio of ${p}`);
  };
  Object.keys(TAGS).forEach(put);
  const nd = await fakeNavidrome();
  const hub = await seeded({}, { musicDir, dataDir: mkdtempSync(join(tmpdir(), 'wl-alone-data-')) });
  const { app, tokens, ids } = hub;
  const catalog = (app as unknown as { hubCatalog: Catalog }).hubCatalog;
  catalog.probeFn = async (f) => parseProbe({ format: { duration: '100', tags: TAGS[f.slice(musicDir.length + 1)] }, streams: [{ codec_type: 'audio', codec_name: 'mp3' }] });
  catalog.listNavidrome = async () => Object.entries(ND).map(([p, s]) => ({ ...s, title: '', artist: '', path: `/music/${p}` }));
  catalog.listRealPaths = async () => new Map(Object.entries(ND).map(([p, s]) => [s.id, { path: `/music/${p}`, albumArtistId: s.albumArtistId }]));
  await catalog.scan();

  const s = await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'navidrome', url: nd.url, config: {} } });
  await json(app, 'PUT', `/api/admin/services/${s.body.service.id}/users/${ids.member}`, { token: tokens.admin, body: { secrets: { username: 'mia', password: 'mia-real-pw' } } });
  const login = async (token: string) => (await json(app, 'GET', '/api/me/services', { token })).body.services.find((x: { kind: string }) => x.kind === 'navidrome');
  const as = (svc: { secrets: { username: string; password: string } }) => async (method: string, params: Record<string, string> = {}) => {
    const r = await app.inject({ method: 'GET', url: `/nd/${s.body.service.id}/rest/${method}?${new URLSearchParams({ u: svc.secrets.username, t: md5(svc.secrets.password + 'salt'), s: 'salt', v: '1.16.1', c: 'test', f: 'json', ...params })}` });
    return { by: r.headers['x-wavelength-answered-by'], status: r.statusCode, body: r.headers['content-type']?.toString().startsWith('application/json') ? r.json()['subsonic-response'] : r.rawPayload };
  };
  return { ...hub, musicDir, put, nd, catalog, login, as, serviceId: s.body.service.id as number };
}

test('turning Navidrome off copies everyone first, then devices only ever talk to the Hub', async () => {
  const { app, tokens, nd, login, as, catalog } = await setup();
  // before: Mia's device goes straight to Navidrome; Kit (a kid) has no Navidrome login, so no music server at all
  assert.equal((await login(tokens.member)).relay, undefined);
  assert.equal(await login(tokens.kid), undefined);

  const off = await json(app, 'PUT', '/api/admin/catalog/navidrome', { token: tokens.admin, body: { off: true } });
  assert.equal(off.status, 200);
  assert.equal(off.body.standalone, true);
  assert.deepEqual(off.body.copied, ['mia']);
  assert.deepEqual(off.body.notCopied, []);
  assert.equal(catalog.standalone(), true);
  nd.calls.length = 0;

  // everyone gets the Hub's relay now, Navidrome login or not
  const mia = await login(tokens.member);
  const kit = await login(tokens.kid);
  assert.equal(mia.relay, true);
  assert.equal(kit.relay, true);
  const rest = as(mia);

  assert.equal((await rest('ping')).by, 'hub');
  const album = await rest('getAlbum', { id: 'al1' });
  assert.equal(album.by, 'hub');
  assert.equal(album.body.album.song[0].playCount, 4, 'plays copied');
  assert.equal(album.body.album.song[1].starred, '2026-01-01T00:00:00.000Z', 'hearts copied');
  const lists = await rest('getPlaylists');
  assert.deepEqual(lists.body.playlists.playlist.map((p: { name: string }) => p.name), ['Mine']);
  assert.equal((await rest('star', { id: 'nd3' })).by, 'hub');
  await rest('scrobble', { id: 'nd3', submission: 'true' });
  const made = await rest('createPlaylist', { name: 'New', songId: 'nd4' });
  assert.match(made.body.playlist.id, /^[0-9a-f-]{36}$/, 'the Hub makes the id');
  const song = await rest('stream', { id: 'nd3' });
  assert.equal(song.status, 200);
  assert.equal(String(song.body), 'audio of The Beatles/Abbey Road/01.mp3');
  assert.equal((await rest('getIndexes')).body.indexes.index.length, 2);
  assert.equal((await rest('search2', { query: 'help' })).body.searchResult2.song[0].id, 'nd4');
  assert.deepEqual((await rest('getTopSongs', { artist: 'the beatles' })).body.topSongs.song.map((x: { id: string }) => x.id), ['nd3', 'nd4'], 'the one she played first');
  const nope = await rest('getPodcasts');
  assert.equal(nope.body.status, 'failed');
  assert.equal(nope.body.error.code, 70);
  assert.equal((await as(kit)('getAlbum', { id: 'al2' })).by, 'hub', 'kids too');

  // play history, Navidrome's own API shape
  const t = await app.inject({ method: 'POST', url: `/nd/${(await login(tokens.member)).id}/auth/login`, payload: { username: mia.secrets.username, password: mia.secrets.password } });
  const history = await app.inject({ method: 'GET', url: `/nd/${mia.id}/api/song?_start=0&_end=10&_sort=play_date&_order=DESC`, headers: { 'x-nd-authorization': `Bearer ${t.json().token}` } });
  assert.deepEqual(history.json().map((x: { id: string }) => x.id), ['nd3', 'nd1']);

  assert.deepEqual(nd.calls, [], 'nothing reached Navidrome');

  // back on: Navidrome answers what the Hub doesn't again
  const on = await json(app, 'PUT', '/api/admin/catalog/navidrome', { token: tokens.admin, body: { off: false } });
  assert.equal(on.body.standalone, false);
});

test('without Navidrome, a playlist with a song the Hub can’t find still opens, and removing goes by what was shown', async () => {
  const { app, tokens, login, as } = await setup();
  await json(app, 'PUT', '/api/admin/catalog/navidrome', { token: tokens.admin, body: { off: true } });
  const rest = as(await login(tokens.member));
  const one = await rest('getPlaylist', { id: 'pl1' });
  assert.equal(one.by, 'hub');
  assert.deepEqual(one.body.playlist.entry.map((x: { id: string }) => x.id), ['nd2', 'nd1'], 'nd9 left out, not the whole playlist');
  assert.equal(one.body.playlist.songCount, 2);
  // the device removes its second song (nd1): position 2 on the Hub, where nd9 still sits at 1
  assert.equal((await rest('updatePlaylist', { playlistId: 'pl1', songIndexToRemove: '1' })).body.status, 'ok');
  const kept = (app as any).hubCatalog.db.prepare('SELECT song_id FROM server_playlist_songs WHERE playlist_id = ? ORDER BY pos').all('pl1').map((r: { song_id: string }) => r.song_id);
  assert.deepEqual(kept, ['nd2', 'nd9']);
});

test('without Navidrome, new songs get the Hub’s ids, join their album, and albums follow their tags', async () => {
  const { app, tokens, put, catalog } = await setup();
  await json(app, 'PUT', '/api/admin/catalog/navidrome', { token: tokens.admin, body: { off: true, force: true } });
  // a new song on Scorpion, and a new album
  TAGS['Drake/Scorpion/03.mp3'] = { title: 'Gods Plan', artist: 'Drake', album_artist: 'Drake', album: 'Scorpion', track: '3', date: '2018', genre: 'Rap' };
  TAGS['Adele/25/01.mp3'] = { title: 'Hello', artist: 'Adele', album_artist: 'Adele', album: '25', track: '1', date: '2015', genre: 'Pop' };
  put('Drake/Scorpion/03.mp3');
  put('Adele/25/01.mp3');
  await catalog.scan();
  const row = (p: string) => (app as any).hubCatalog.db.prepare('SELECT nd_id, nd_album_id, nd_artist_id FROM catalog_songs WHERE path = ?').get(p);
  const gods = row('Drake/Scorpion/03.mp3');
  assert.match(gods.nd_id, /^h[0-9a-f]{20}$/);
  assert.equal(gods.nd_album_id, 'al1', 'joins Scorpion');
  assert.equal(gods.nd_artist_id, 'ar1', 'and Drake');
  const hello = row('Adele/25/01.mp3');
  assert.match(hello.nd_album_id, /^h[0-9a-f]{20}$/);
  assert.equal(row('Drake/Scorpion/01.mp3').nd_id, 'nd1', 'Navidrome’s ids stay');

  // merging Help! into Abbey Road (title, album artist and year, as the app's Merge does) makes one album
  catalogWrote((app as any).hubCatalog.db, 'The Beatles/Help/01.mp3', { album: 'Abbey Road', albumArtist: 'The Beatles', year: '1969' } as never);
  TAGS['The Beatles/Help/01.mp3'] = { ...TAGS['The Beatles/Help/01.mp3'], album: 'Abbey Road', date: '1969' };
  await catalog.scan();
  assert.equal(row('The Beatles/Help/01.mp3').nd_album_id, 'al2');
  // and renaming an album keeps its id
  for (const p of ['Drake/Scorpion/01.mp3', 'Drake/Scorpion/02.mp3', 'Drake/Scorpion/03.mp3']) {
    TAGS[p] = { ...TAGS[p], album: 'Scorpion (Deluxe)' };
    catalogWrote((app as any).hubCatalog.db, p, { album: 'Scorpion (Deluxe)' } as never);
  }
  await catalog.scan();
  assert.equal(row('Drake/Scorpion/02.mp3').nd_album_id, 'al1');
});

test('Navidrome stays on while someone’s copy fails, unless the admin says otherwise', async () => {
  const { app, tokens, ids, serviceId } = await setup();
  await json(app, 'PUT', `/api/admin/services/${serviceId}/users/${ids.kid}`, { token: tokens.admin, body: { secrets: { username: 'kit', password: 'wrong' } } });
  const r = await json(app, 'PUT', '/api/admin/catalog/navidrome', { token: tokens.admin, body: { off: true } });
  assert.equal(r.body.standalone, false);
  assert.deepEqual(r.body.copied, ['mia']);
  assert.equal(r.body.notCopied[0].user, 'kit');
  const forced = await json(app, 'PUT', '/api/admin/catalog/navidrome', { token: tokens.admin, body: { off: true, force: true } });
  assert.equal(forced.body.standalone, true);
  assert.equal((await json(app, 'PUT', '/api/admin/catalog/navidrome', { token: tokens.member, body: { off: false } })).status, 403);
});

test('other apps (SUB/WAVE and the like) get a Hub login of their own, which stops when removed', async () => {
  const { app, tokens, as } = await setup();
  assert.equal((await json(app, 'GET', '/api/me/app-logins', { token: tokens.member })).body.available, false, 'not while devices go straight to Navidrome');
  assert.equal((await json(app, 'POST', '/api/me/app-logins', { token: tokens.member, body: { name: 'SUB/WAVE' } })).status, 409);
  await json(app, 'PUT', '/api/admin/catalog/navidrome', { token: tokens.admin, body: { off: true } });

  const made = await json(app, 'POST', '/api/me/app-logins', { token: tokens.member, body: { name: 'SUB/WAVE' } });
  assert.equal(made.status, 200);
  const login = made.body.login;
  assert.match(login.path, /^\/nd\/\d+$/);
  const listed = await json(app, 'GET', '/api/me/app-logins', { token: tokens.member });
  assert.deepEqual(listed.body.logins, [login], 'shown again, same password');
  assert.equal((await json(app, 'GET', '/api/me/app-logins', { token: tokens.admin })).body.logins.length, 0, 'only your own');

  const subwave = as({ secrets: { username: login.username, password: login.password } });
  assert.equal((await subwave('ping')).body.status, 'ok');
  assert.equal((await subwave('getAlbum', { id: 'al1' })).body.album.song.length, 2);
  const plain = await app.inject({ method: 'GET', url: `/rest/ping.view?${new URLSearchParams({ u: login.username, t: md5(login.password + 'salt'), s: 'salt', v: '1.16.1', c: 'test', f: 'json' })}` });
  assert.equal(plain.json()['subsonic-response'].status, 'ok', 'the Hub’s plain address works too');

  assert.equal((await json(app, 'DELETE', `/api/me/devices/${login.id}`, { token: tokens.member })).status, 200);
  assert.equal((await subwave('ping')).body.error.code, 40, 'removed: signed out');
});
