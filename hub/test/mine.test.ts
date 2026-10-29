import assert from 'node:assert/strict';
import { test } from 'node:test';
import { json, seeded } from './helpers.ts';

const song = (id: string) => ({ id, sourceId: 'hub-1', kind: 'track', title: `Song ${id}`, artist: 'Band' });

test('playlists are each person’s own, newest change wins, and deletions reach other devices', async () => {
  const { app, tokens } = await seeded();
  const put = (token: string, playlists: unknown[]) => json(app, 'PUT', '/api/me/playlists', { token, body: { playlists } });

  const r = await put(tokens.member, [{ id: 'p1', name: 'Road trip', tracks: [song('1'), song('2')], createdAt: 100, updatedAt: 100 }]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.playlists[0].tracks.length, 2);

  // other people never see it
  assert.deepEqual((await json(app, 'GET', '/api/me/playlists', { token: tokens.kid })).body.playlists, []);
  assert.deepEqual((await json(app, 'GET', '/api/me/playlists', { token: tokens.admin })).body.playlists, []);

  // an older copy from another device doesn't win; a newer one does
  await put(tokens.member, [{ id: 'p1', name: 'Old name', tracks: [], updatedAt: 50 }]);
  assert.equal((await json(app, 'GET', '/api/me/playlists', { token: tokens.member })).body.playlists[0].name, 'Road trip');
  await put(tokens.member, [{ id: 'p1', name: 'Road trip 2', tracks: [song('3')], updatedAt: 200 }]);
  const now = (await json(app, 'GET', '/api/me/playlists', { token: tokens.member })).body.playlists[0];
  assert.equal(now.name, 'Road trip 2');
  assert.equal(now.createdAt, 100);

  // the same id from someone else is theirs, not an overwrite
  await put(tokens.kid, [{ id: 'p1', name: 'Kit’s', tracks: [], updatedAt: 300 }]);
  assert.equal((await json(app, 'GET', '/api/me/playlists', { token: tokens.member })).body.playlists[0].name, 'Road trip 2');

  const del = await put(tokens.member, [{ id: 'p1', deleted: true, updatedAt: 400 }]);
  assert.equal(del.body.playlists[0].deleted, true);
  assert.deepEqual(del.body.playlists[0].tracks, []);

  assert.equal((await put(tokens.member, [{ name: 'no id', updatedAt: 1 }])).status, 400);
  assert.equal((await json(app, 'GET', '/api/me/playlists')).status, 401);
});

test('play history is per person, skips repeats and keeps the latest 1000', async () => {
  const { app, tokens } = await seeded();
  const add = (plays: unknown[], token = tokens.member) => json(app, 'POST', '/api/me/history', { token, body: { plays } });
  assert.equal((await add([{ playedAt: 10, track: song('a') }, { playedAt: 20, track: song('b') }])).status, 200);
  await add([{ playedAt: 20, track: song('b') }]); // sent again after a timeout
  const h = (await json(app, 'GET', '/api/me/history', { token: tokens.member })).body.history;
  assert.deepEqual(h.map((x: { playedAt: number }) => x.playedAt), [20, 10]);
  assert.equal(h[0].track.title, 'Song b');
  assert.deepEqual((await json(app, 'GET', '/api/me/history', { token: tokens.kid })).body.history, []);

  for (let i = 0; i < 4; i++) await add(Array.from({ length: 300 }, (_, j) => ({ playedAt: 1000 + i * 300 + j, track: song(String(j)) })));
  const all = (await json(app, 'GET', '/api/me/history?limit=5000', { token: tokens.member })).body.history;
  assert.equal(all.length, 1000);
  assert.equal(all[0].playedAt, 1000 + 1199);
});
