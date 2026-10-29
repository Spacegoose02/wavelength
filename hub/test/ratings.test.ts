import assert from 'node:assert/strict';
import { test } from 'node:test';
import { json, seeded } from './helpers.ts';

test('admins store explicit ratings from Deezer; every device reads them', async () => {
  const { app, tokens } = await seeded();
  const send = (albums: unknown, token = tokens.admin) => json(app, 'POST', '/api/admin/ratings', { token, body: { albums } });

  const r = await send([
    { artist: 'Eminem', album: 'The Eminem Show', rating: 'explicit', cleanLink: 'https://www.deezer.com/album/119606', explicitTracks: ['Without Me', 'Cleanin Out My Closet'] },
    { artist: 'ABBA', album: 'Gold', rating: 'clean' },
    { artist: 'Nobody', album: 'Rare', rating: 'unknown', cleanLink: 'http://evil.example' },
  ]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const all = (await json(app, 'GET', '/api/ratings', { token: tokens.kid })).body.ratings;
  assert.equal(all.length, 5);
  assert.equal(all.find((x: { album: string; kind: string }) => x.album === 'The Eminem Show' && x.kind === 'album').cleanLink, 'https://www.deezer.com/album/119606');
  assert.equal(all.find((x: { album: string }) => x.album === 'Rare').cleanLink, null, 'only Deezer links');

  // checking an album again replaces its songs
  await send([{ artist: 'eminem', album: 'the eminem show', rating: 'explicit', explicitTracks: ['Without Me'] }]);
  const again = (await json(app, 'GET', '/api/ratings', { token: tokens.member })).body.ratings;
  assert.equal(again.filter((x: { kind: string }) => x.kind === 'track').length, 1);
  assert.equal(again.length, 4);

  assert.equal((await send([{ artist: 'X', album: 'Y', rating: 'clean' }], tokens.member)).status, 403);
  assert.equal((await send([{ artist: 'X', album: 'Y', rating: 'dirty' }])).status, 400);
  assert.equal((await send(Array(201).fill({ artist: 'X', album: 'Y', rating: 'clean' }))).status, 400);
  assert.equal((await json(app, 'GET', '/api/ratings')).status, 401);

  assert.equal((await json(app, 'DELETE', '/api/admin/ratings', { token: tokens.kid })).status, 403);
  assert.equal((await json(app, 'DELETE', '/api/admin/ratings', { token: tokens.admin })).status, 200);
  assert.equal((await json(app, 'GET', '/api/ratings', { token: tokens.admin })).body.ratings.length, 0);
});
