import assert from 'node:assert/strict';
import { test } from 'node:test';
import { json, seeded } from './helpers.ts';

const song = (title: string) => ({ title, artist: 'Band', album: 'LP', duration: 200.4, coverUrl: 'https://x/c.jpg', id: 'ignored', streamUrl: 'dropped' });

test('household playlists: everyone grown-up adds, owners and admins manage', async () => {
  const { app, tokens, ids } = await seeded();
  assert.equal((await json(app, 'GET', '/api/household/playlists', { token: tokens.kid })).status, 403, 'not for kids');
  assert.equal((await json(app, 'GET', '/api/household/playlists')).status, 401);
  assert.equal((await json(app, 'POST', '/api/household/playlists', { token: tokens.member, body: {} })).status, 400);

  const made = await json(app, 'POST', '/api/household/playlists', { token: tokens.member, body: { name: 'Road trip', tracks: [song('One')] } });
  assert.equal(made.status, 200);
  const id = made.body.playlist.id;
  assert.equal(made.body.playlist.songs, 1);
  assert.equal(made.body.playlist.owner.id, ids.member);
  const notes = (await json(app, 'GET', '/api/notifications?after=0', { token: tokens.admin })).body.notifications;
  assert.ok(notes.some((n: { title: string }) => /household playlist/.test(n.title)), 'the house hears about it');
  assert.ok(!(await json(app, 'GET', '/api/notifications?after=0', { token: tokens.kid })).body.notifications.some((n: { title: string }) => /household/.test(n.title)));

  assert.equal((await json(app, 'POST', `/api/household/playlists/${id}/tracks`, { token: tokens.admin, body: { tracks: [song('Two'), { artist: 'no title' }, song('Three')] } })).body.added, 2);
  const got = (await json(app, 'GET', `/api/household/playlists/${id}`, { token: tokens.admin })).body;
  assert.deepEqual(got.tracks.map((t: { track: { title: string } }) => t.track.title), ['One', 'Two', 'Three']);
  assert.deepEqual(got.tracks[0].track, { title: 'One', artist: 'Band', album: 'LP', duration: 200, coverUrl: 'https://x/c.jpg' });
  assert.equal(got.tracks[1].addedBy.id, ids.admin);
  assert.equal(got.playlist.cover, 'https://x/c.jpg');

  // reorder: listed first, the rest after
  const [one, two, three] = got.tracks.map((t: { id: number }) => t.id);
  await json(app, 'PUT', `/api/household/playlists/${id}/order`, { token: tokens.member, body: { ids: [three, 9999] } });
  const order = (await json(app, 'GET', `/api/household/playlists/${id}`, { token: tokens.member })).body.tracks.map((t: { id: number }) => t.id);
  assert.deepEqual(order, [three, one, two]);

  // taking songs off: the adder, the owner, an admin
  const second = await json(app, 'POST', '/api/household/playlists', { token: tokens.admin, body: { name: 'Admin’s' } });
  await json(app, 'POST', `/api/household/playlists/${second.body.playlist.id}/tracks`, { token: tokens.admin, body: { tracks: [song('Mine')] } });
  const mine = (await json(app, 'GET', `/api/household/playlists/${second.body.playlist.id}`, { token: tokens.member })).body.tracks[0].id;
  assert.equal((await json(app, 'DELETE', `/api/household/playlists/${second.body.playlist.id}/tracks/${mine}`, { token: tokens.member })).status, 403);
  assert.equal((await json(app, 'DELETE', `/api/household/playlists/${id}/tracks/${two}`, { token: tokens.member })).status, 200, 'owner takes off what an admin added');
  assert.equal((await json(app, 'DELETE', `/api/household/playlists/${id}/tracks/${two}`, { token: tokens.member })).status, 404);

  assert.equal((await json(app, 'PATCH', `/api/household/playlists/${second.body.playlist.id}`, { token: tokens.member, body: { name: 'x' } })).status, 403);
  assert.equal((await json(app, 'PATCH', `/api/household/playlists/${id}`, { token: tokens.member, body: { name: 'Long drive' } })).body.playlist.name, 'Long drive');
  assert.equal((await json(app, 'DELETE', `/api/household/playlists/${second.body.playlist.id}`, { token: tokens.member })).status, 403);
  assert.equal((await json(app, 'DELETE', `/api/household/playlists/${id}`, { token: tokens.admin })).status, 200, 'admins can');
  assert.deepEqual((await json(app, 'GET', '/api/household/playlists', { token: tokens.member })).body.playlists.map((p: { name: string }) => p.name), ['Admin’s']);
});
