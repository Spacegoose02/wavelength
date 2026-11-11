import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readTrack, setTrack, trackKey } from '../src/trackTags.ts';
import { json, seeded } from './helpers.ts';

test('songs are keyed by album artist, album and title, like albums', () => {
  assert.equal(trackKey('*NSYNC', 'Home for Christmas', 'Merry Christmas, Happy Holidays'), trackKey('nsync', 'home for christmas', 'merry christmas happy holidays'));
  assert.notEqual(trackKey('A', 'B', 'C'), trackKey('A', 'C', 'B'));
});

test('a song’s moods and styles: admins set them, everyone reads them, an import never changes an admin’s', async () => {
  const { app, db, tokens } = await seeded();
  const song = { artist: 'Lil Baby', album: 'It’s Only Me', title: 'Heyy' };
  assert.equal((await json(app, 'PUT', '/api/admin/track-tags', { token: tokens.member, body: { ...song, moods: ['Reckless'] } })).status, 403);
  assert.equal((await json(app, 'PUT', '/api/admin/track-tags', { token: tokens.admin, body: { ...song, genres: ['Rap'] } })).status, 400);
  const set = await json(app, 'PUT', '/api/admin/track-tags', { token: tokens.admin, body: { ...song, moods: ['Reckless', 'reckless', 'Brash'], styles: ['Trap'] } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.deepEqual(set.body.facets, { mood: ['Reckless', 'Brash'], style: ['Trap'] });

  const one = await json(app, 'GET', '/api/item-tags/track?artist=lil%20baby&album=its%20only%20me&title=HEYY', { token: tokens.kid });
  assert.deepEqual(one.body.facets, { mood: ['Reckless', 'Brash'], style: ['Trap'] });
  const all = await json(app, 'GET', '/api/item-tags/tracks', { token: tokens.member });
  assert.equal(all.body.tracks.length, 1);
  assert.equal(all.body.tracks[0].title, 'Heyy');
  // the shared suggestions count songs too
  const values = (await json(app, 'GET', '/api/item-tags', { token: tokens.member })).body.values;
  assert.deepEqual(values.mood.find((v: { name: string }) => v.name === 'Reckless'), { name: 'Reckless', albums: 0, artists: 0, tracks: 1 });

  assert.deepEqual(setTrack(db, { ...song, facets: { mood: ['Calm'], style: [] }, source: 'plex' }), []);
  assert.deepEqual(readTrack(db, song.artist, song.album, song.title).facets.mood, ['Reckless', 'Brash']);
});

test('songs’ moods follow a rename of the artist, the album or the song', async () => {
  const { app, db, tokens } = await seeded();
  setTrack(db, { artist: 'Purple Disco Machine', album: 'Purple Disco Machine - Paradise', title: 'Paradise', facets: { mood: ['Sunny'] } });
  setTrack(db, { artist: 'Purple Disco Machine', album: 'Purple Disco Machine - Paradise', title: 'W.T.P', facets: { mood: ['Groovy'] } });
  const r = await json(app, 'POST', '/api/admin/item-tags/rename', { token: tokens.admin, body: { kind: 'album', from: { artist: 'Purple Disco Machine', title: 'Purple Disco Machine - Paradise' }, to: { artist: 'Purple Disco Machine', title: 'Paradise' } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.moved, 2);
  assert.deepEqual(readTrack(db, 'Purple Disco Machine', 'Paradise', 'W.T.P').facets, { mood: ['Groovy'] });
  await json(app, 'POST', '/api/admin/item-tags/rename', { token: tokens.admin, body: { kind: 'artist', from: { artist: 'Purple Disco Machine' }, to: { artist: 'PDM' } } });
  assert.deepEqual(readTrack(db, 'PDM', 'Paradise', 'Paradise').facets, { mood: ['Sunny'] });
  const t = await json(app, 'POST', '/api/admin/track-tags/rename', { token: tokens.admin, body: { from: { artist: 'PDM', album: 'Paradise', title: 'W.T.P' }, to: { artist: 'PDM', album: 'Paradise', title: 'W.T.P (feat. Metronomy)' } } });
  assert.equal(t.body.moved, 1);
  assert.deepEqual(readTrack(db, 'PDM', 'Paradise', 'W.T.P (feat. Metronomy)').facets, { mood: ['Groovy'] });
  assert.deepEqual(readTrack(db, 'PDM', 'Paradise', 'W.T.P').facets, {});
});
