import assert from 'node:assert/strict';
import { test } from 'node:test';
import { itemKey, readItem, setItem, tagKey } from '../src/itemTags.ts';
import { json, seeded } from './helpers.ts';

test('names are compared without case, accents or punctuation', () => {
  assert.equal(tagKey('Beyoncé'), 'beyonce');
  assert.equal(tagKey('*NSYNC'), 'nsync');
  assert.equal(tagKey('It’s Only Me'), tagKey("its only me"));
  assert.equal(tagKey('Simon & Garfunkel'), tagKey('simon and garfunkel'));
  assert.equal(itemKey('album', '*NSYNC', 'Home for Christmas'), itemKey('album', 'nsync', 'home for christmas!'));
  assert.notEqual(itemKey('album', 'A', 'B C'), itemKey('album', 'A B', 'C'));
});

test('styles, moods and collections: admins set them, everyone reads them', async () => {
  const { app, tokens } = await seeded();
  const album = { kind: 'album', artist: '*NSYNC', title: 'Home for Christmas' };
  assert.equal((await json(app, 'PUT', '/api/admin/item-tags', { token: tokens.member, body: { ...album, styles: ['Christmas Pop'] } })).status, 403);
  // an album's genres are in its files, not here
  assert.equal((await json(app, 'PUT', '/api/admin/item-tags', { token: tokens.admin, body: { ...album, genres: ['Christmas'] } })).status, 400);
  assert.equal((await json(app, 'PUT', '/api/admin/item-tags', { token: tokens.admin, body: { ...album, styles: 'Christmas Pop' } })).status, 400);
  const set = await json(app, 'PUT', '/api/admin/item-tags', { token: tokens.admin, body: { ...album, styles: [' Christmas Pop ', 'christmas pop', 'Christmas 90s'], moods: ['Warm'], collections: ['Christmas'] } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.deepEqual(set.body.facets, { style: ['Christmas Pop', 'Christmas 90s'], mood: ['Warm'], collection: ['Christmas'] });

  // any spelling finds it; only what's sent changes; an empty list clears it
  await json(app, 'PUT', '/api/admin/item-tags', { token: tokens.admin, body: { kind: 'album', artist: 'nsync', title: 'home for christmas', moods: [] } });
  const got = await json(app, 'GET', '/api/item-tags/one?kind=album&artist=NSYNC&title=Home%20For%20Christmas', { token: tokens.kid });
  assert.deepEqual(got.body.facets, { style: ['Christmas Pop', 'Christmas 90s'], collection: ['Christmas'] });
  assert.equal(got.body.sources.style, 'edit');

  // an artist has genres of their own, apart from their albums'
  await json(app, 'PUT', '/api/admin/item-tags', { token: tokens.admin, body: { kind: 'artist', artist: '*NSYNC', genres: ['Pop'], styles: ['Teen Pop'] } });
  const all = await json(app, 'GET', '/api/item-tags', { token: tokens.member });
  assert.equal(all.body.artists.length, 1);
  assert.deepEqual(all.body.artists[0].facets, { genre: ['Pop'], style: ['Teen Pop'] });
  assert.equal(all.body.albums[0].title, 'Home for Christmas');
  assert.deepEqual(all.body.values.style.map((v: { name: string }) => v.name).sort(), ['Christmas 90s', 'Christmas Pop', 'Teen Pop']);
  assert.deepEqual(all.body.values.collection, [{ name: 'Christmas', albums: 1, artists: 0, tracks: 0 }]);
});

test('tags follow a rename, an artist’s albums too, and merge into a name that has some', async () => {
  const { app, tokens } = await seeded();
  const put = (body: object) => json(app, 'PUT', '/api/admin/item-tags', { token: tokens.admin, body });
  await put({ kind: 'artist', artist: 'NSYNC', styles: ['Teen Pop'] });
  await put({ kind: 'album', artist: 'NSYNC', title: 'Celebrity', moods: ['Happy'] });
  await put({ kind: 'artist', artist: 'Backstreet Boys', styles: ['Boy Band'] });
  const r = await json(app, 'POST', '/api/admin/item-tags/rename', { token: tokens.admin, body: { kind: 'artist', from: { artist: 'NSYNC' }, to: { artist: 'N Sync' } } });
  assert.equal(r.status, 200);
  assert.equal(r.body.moved, 2);
  const artist = await json(app, 'GET', '/api/item-tags/one?kind=artist&artist=N%20Sync', { token: tokens.admin });
  assert.deepEqual(artist.body.facets.style, ['Teen Pop']);
  const album = await json(app, 'GET', '/api/item-tags/one?kind=album&artist=N%20Sync&title=Celebrity', { token: tokens.admin });
  assert.deepEqual(album.body.facets.mood, ['Happy']);
  assert.equal(album.body.artist, 'N Sync');
  // an album renamed onto one that has tags: the names are put together
  await put({ kind: 'album', artist: 'N Sync', title: 'Celebrity (Deluxe)', moods: ['Energetic', 'happy'] });
  await json(app, 'POST', '/api/admin/item-tags/rename', { token: tokens.admin, body: { kind: 'album', from: { artist: 'N Sync', title: 'Celebrity (Deluxe)' }, to: { artist: 'N Sync', title: 'Celebrity' } } });
  const merged = await json(app, 'GET', '/api/item-tags/one?kind=album&artist=N%20Sync&title=Celebrity', { token: tokens.admin });
  assert.deepEqual(merged.body.facets.mood, ['Happy', 'Energetic']);
  assert.equal((await json(app, 'GET', '/api/item-tags', { token: tokens.admin })).body.albums.length, 1);
});

test('an import never changes what an admin set', async () => {
  const { db } = await seeded();
  setItem(db, { kind: 'album', artist: 'Lil Baby', title: 'It’s Only Me', facets: { style: ['Trap (Rap)'] } });
  const changed = setItem(db, { kind: 'album', artist: 'Lil Baby', title: 'It’s Only Me', facets: { style: ['Southern Rap'], mood: ['Druggy', 'Reckless'] }, source: 'plex' });
  assert.deepEqual(changed, ['mood']);
  const t = readItem(db, 'album', 'lil baby', 'its only me');
  assert.deepEqual(t.facets, { style: ['Trap (Rap)'], mood: ['Druggy', 'Reckless'] });
  assert.deepEqual(t.sources, { style: 'edit', mood: 'plex' });
  // the same import again changes nothing
  assert.deepEqual(setItem(db, { kind: 'album', artist: 'Lil Baby', title: 'It’s Only Me', facets: { mood: ['Druggy', 'Reckless'] }, source: 'plex' }), []);
});
