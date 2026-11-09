import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Db } from '../src/db.ts';
import { readItem, setItem } from '../src/itemTags.ts';
import { readTrack } from '../src/trackTags.ts';
import { matchPlex, type PlexItem, plexItem } from '../src/plexImport.ts';
import { json, seeded } from './helpers.ts';

const item = (kind: 'album' | 'artist', artist: string, title = '', extra: Partial<PlexItem> = {}): PlexItem =>
  ({ ratingKey: `${artist}/${title}`, kind, artist, title, genres: [], styles: [], moods: [], collections: [], ...extra });

test('a Plex album or artist from its details: Plex collections and labels both become collections', () => {
  const p = plexItem({
    type: 'album', ratingKey: 12, title: 'Home for Christmas', parentTitle: '*NSYNC',
    Genre: [{ tag: 'Christmas' }], Style: [{ tag: 'Christmas Pop' }], Mood: [{ tag: 'Warm' }, { tag: 'Sentimental' }],
    Collection: [{ tag: 'Christmas' }], Label: [{ tag: 'christmas' }, { tag: 'Boy Bands' }],
  });
  assert.deepEqual(p, { ratingKey: '12', kind: 'album', artist: '*NSYNC', title: 'Home for Christmas', genres: ['Christmas'], styles: ['Christmas Pop'], moods: ['Warm', 'Sentimental'], collections: ['Christmas', 'Boy Bands'] });
  assert.equal(plexItem({ type: 'track', ratingKey: 1, title: 'x' }), null);
});

test('matching: same album artist and title in any spelling, else the title without edition words when only one fits', () => {
  const ours = {
    albums: [
      { artist: 'NSYNC', title: 'Home For Christmas', id: 'a1', genres: [] },
      { artist: 'Lil Baby', title: 'It’s Only Me', id: 'a2', genres: ['Rap'] },
      { artist: 'Taylor Swift', title: '1989 (Taylor’s Version)', id: 'a3', genres: [] },
      { artist: 'Drake', title: 'Views', id: 'a4', genres: [] },
      { artist: 'Drake', title: 'Views (Clean)', id: 'a5', genres: [] },
    ],
    artists: ['NSYNC', 'Lil Baby'],
  };
  const { pairs, unmatched } = matchPlex([
    item('album', '*NSYNC', 'Home for Christmas'),
    item('album', 'Lil Baby', 'Its Only Me'),
    item('album', 'Taylor Swift', '1989 [Deluxe]'),
    item('album', 'Drake', 'Views (Deluxe)'), // two of ours would fit: left alone
    item('album', 'Nobody', 'Nothing'),
    item('artist', '*NSYNC'),
    item('artist', 'Nobody'),
  ], ours);
  assert.deepEqual(pairs.map((p) => `${p.artist} – ${p.title}`), ['NSYNC – Home For Christmas', 'Lil Baby – It’s Only Me', 'Taylor Swift – 1989 (Taylor’s Version)', 'NSYNC – ']);
  assert.deepEqual(unmatched.map((p) => p.title || p.artist), ['Views (Deluxe)', 'Nothing', 'Nobody']);
});

function addSongs(db: Db, rows: ([string, string, string] | [string, string, string, string])[]) {
  const ins = db.prepare(`INSERT INTO catalog_songs (path, size, mtime, title, artist, album, album_artist, genre, read_at, nd_album_id) VALUES (?, 1, 1, ?, ?, ?, ?, ?, 1, ?)`);
  rows.forEach(([artist, album, genre, title = 't'], i) => ins.run(`/${i}.flac`, title, artist, album, artist, genre, `nd-${album}`));
}

/** A tiny Plex: one music section, two albums and an artist. */
function fakePlex(seen: string[]) {
  const meta: Record<string, Record<string, unknown>> = {
    1: { type: 'album', ratingKey: '1', title: 'Home for Christmas', parentTitle: '*NSYNC', Genre: [{ tag: 'Christmas' }, { tag: 'Pop' }], Style: [{ tag: 'Christmas Pop' }], Mood: [{ tag: 'Warm' }], Label: [{ tag: 'Christmas' }] },
    2: { type: 'album', ratingKey: '2', title: 'It’s Only Me', parentTitle: 'Lil Baby', Genre: [{ tag: 'Hip-Hop' }], Style: [{ tag: 'Southern Rap' }, { tag: 'Trap (Rap)' }], Mood: [{ tag: 'Druggy' }] },
    3: { type: 'artist', ratingKey: '3', title: '*NSYNC', Genre: [{ tag: 'Pop' }], Style: [{ tag: 'Teen Pop' }], Mood: [{ tag: 'Cheerful' }] },
    4: { type: 'track', ratingKey: '4', title: 'Merry Christmas, Happy Holidays', parentTitle: 'Home for Christmas (Deluxe)', grandparentTitle: '*NSYNC', Mood: [{ tag: 'Festive' }, { tag: 'Cheerful' }] },
    5: { type: 'track', ratingKey: '5', title: 'Heyy', parentTitle: 'It’s Only Me', grandparentTitle: 'Lil Baby' },
  };
  return async (url: string, init?: RequestInit) => {
    seen.push(url);
    assert.equal((init?.headers as Record<string, string> | undefined)?.['X-Plex-Token'], 'plex-token');
    const u = new URL(url);
    const body = (MediaContainer: object) => new Response(JSON.stringify({ MediaContainer }), { headers: { 'content-type': 'application/json' } });
    if (u.pathname === '/library/sections') return body({ Directory: [{ key: '5', type: 'artist', title: 'Music' }, { key: '6', type: 'movie' }] });
    if (u.pathname === '/library/sections/5/all') {
      const type = u.searchParams.get('type');
      const ids = type === '9' ? ['1', '2'] : type === '10' ? ['4', '5'] : ['3'];
      // song listings carry no moods; Plex's do sometimes, then they're used as they are
      return body({ Metadata: ids.map((ratingKey) => ({ ratingKey, type: type === '10' ? 'track' : undefined })), totalSize: ids.length });
    }
    if (u.pathname.startsWith('/library/metadata/')) return body({ Metadata: u.pathname.slice(18).split(',').map((k) => meta[k]) });
    return new Response('nope', { status: 404 });
  };
}

async function settle(app: Parameters<typeof json>[0], token: string) {
  for (let i = 0; i < 50; i++) {
    const s = await json(app, 'GET', '/api/admin/plex-import', { token });
    if (s.body.state !== 'reading') return s.body;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('Plex read never finished');
}

test('reading Plex shows what would change; importing writes it and leaves an admin’s own tags alone', async () => {
  const seen: string[] = [];
  const { app, db, tokens } = await seeded({}, {}, { plexFetch: fakePlex(seen) });
  // nothing to read from yet
  assert.equal((await json(app, 'POST', '/api/admin/plex-import/read', { token: tokens.admin, body: {} })).status, 409);
  assert.equal((await json(app, 'POST', '/api/admin/plex-import/read', { token: tokens.member, body: {} })).status, 403);
  await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'plex', name: 'Plex', url: 'http://plex:32400/', access: 'everyone', secrets: { token: 'plex-token' } } });
  addSongs(db, [['NSYNC', 'Home for Christmas', '', 'Merry Christmas Happy Holidays'], ['NSYNC', 'Home for Christmas', ''], ['Lil Baby', 'It’s Only Me', 'Rap; Hip-Hop', 'Heyy']]);
  setItem(db, { kind: 'album', artist: 'Lil Baby', title: 'It’s Only Me', facets: { style: ['Trap (Rap)'] } });

  const started = await json(app, 'POST', '/api/admin/plex-import/read', { token: tokens.admin, body: {} });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  const s = await settle(app, tokens.admin);
  assert.equal(s.state, 'ready', JSON.stringify(s));
  assert.deepEqual(s.servers, [{ id: s.servers[0].id, name: 'Plex', token: true }]);
  assert.deepEqual(s.preview.albums, { plex: 2, matched: 2 });
  assert.deepEqual(s.preview.artists, { plex: 1, matched: 1 });
  assert.deepEqual(s.preview.changes, { albums: 2, artists: 1, tracks: 1 });
  // both songs match (the Deluxe album name too); only one has moods
  assert.deepEqual(s.preview.tracks, { plex: 2, matched: 2, tagged: 1 });
  assert.ok(seen.some((u) => u.endsWith('/library/metadata/4,5')), seen.join('\n'));
  // the album with no genre gets Plex's, tidied by the genre rules; the one with genres gets none
  assert.deepEqual(s.preview.genres, [{ id: 'nd-Home for Christmas', artist: 'NSYNC', title: 'Home for Christmas', plex: 'Christmas; Pop', genre: 'Pop; Christmas' }]);
  assert.ok(seen.some((u) => u.endsWith('/library/metadata/3,1,2')), seen.join('\n'));
  assert.equal(readItem(db, 'album', 'NSYNC', 'Home for Christmas').updatedAt, null, 'reading writes nothing');

  const done = await json(app, 'POST', '/api/admin/plex-import/apply', { token: tokens.admin, body: {} });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.deepEqual(done.body.imported.albums, 2);
  assert.deepEqual(done.body.imported.artists, 1);
  assert.deepEqual(done.body.imported.tracks, 1);
  const song = readTrack(db, 'nsync', 'home for christmas', 'merry christmas happy holidays');
  assert.deepEqual(song.facets, { mood: ['Festive', 'Cheerful'] });
  assert.equal(song.sources.mood, 'plex');
  const xmas = readItem(db, 'album', 'NSYNC', 'Home for Christmas');
  assert.deepEqual(xmas.facets, { style: ['Christmas Pop'], mood: ['Warm'], collection: ['Christmas'] });
  assert.equal(xmas.sources.style, 'plex');
  assert.deepEqual(readItem(db, 'artist', 'NSYNC').facets, { genre: ['Pop'], style: ['Teen Pop'], mood: ['Cheerful'] });
  const baby = readItem(db, 'album', 'Lil Baby', 'Its Only Me');
  assert.deepEqual(baby.facets, { style: ['Trap (Rap)'], mood: ['Druggy'] }, 'the admin’s style stays');
  assert.equal(baby.sources.style, 'edit');
});

test('importing only some kinds of tag', async () => {
  const { app, db, tokens } = await seeded({}, {}, { plexFetch: fakePlex([]) });
  await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'plex', name: 'Plex', url: 'http://plex', access: 'admins', secrets: { token: 'plex-token' } } });
  addSongs(db, [['NSYNC', 'Home for Christmas', 'Christmas']]);
  assert.equal((await json(app, 'POST', '/api/admin/plex-import/apply', { token: tokens.admin, body: {} })).status, 409, 'read first');
  await json(app, 'POST', '/api/admin/plex-import/read', { token: tokens.admin, body: {} });
  await settle(app, tokens.admin);
  assert.equal((await json(app, 'POST', '/api/admin/plex-import/apply', { token: tokens.admin, body: { facets: ['colour'] } })).status, 400);
  await json(app, 'POST', '/api/admin/plex-import/apply', { token: tokens.admin, body: { facets: ['collection'] } });
  assert.deepEqual(readItem(db, 'album', 'NSYNC', 'Home for Christmas').facets, { collection: ['Christmas'] });
});
