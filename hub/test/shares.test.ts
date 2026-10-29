import assert from 'node:assert/strict';
import { test } from 'node:test';
import { json, seeded } from './helpers.ts';

const MIX = { kind: 'playlist', title: 'Road trip', subtitle: '2 songs', payload: { tracks: [{ title: 'Song A', artist: 'Band' }, { title: 'Song B', artist: 'Band' }] } };

test('share a playlist with one person', async () => {
  const { app, tokens, ids } = await seeded();
  const people = (await json(app, 'GET', '/api/people', { token: tokens.member })).body.people;
  assert.deepEqual(people.map((p: { username: string }) => p.username).sort(), ['boss', 'kit'], 'everyone but you');

  const s = await json(app, 'POST', '/api/shares', { token: tokens.member, body: { ...MIX, to: ids.kid, note: 'for the car' } });
  assert.equal(s.status, 200, JSON.stringify(s.body));

  assert.equal((await json(app, 'GET', '/api/shares/counts', { token: tokens.kid })).body.unseen, 1);
  const got = (await json(app, 'GET', '/api/shares', { token: tokens.kid })).body.shares;
  assert.equal(got.length, 1);
  assert.equal(got[0].from.username, 'mia');
  assert.equal(got[0].note, 'for the car');
  assert.equal(got[0].payload.tracks[1].title, 'Song B');
  assert.equal((await json(app, 'GET', '/api/shares', { token: tokens.admin })).body.shares.length, 0, 'only the person it was sent to');
  assert.equal((await json(app, 'GET', '/api/shares', { token: tokens.member })).body.shares.length, 0, 'not in your own inbox');
  assert.equal((await json(app, 'GET', '/api/shares?sent=1', { token: tokens.member })).body.shares.length, 1);

  await json(app, 'POST', '/api/shares/seen', { token: tokens.kid, body: { ids: [got[0].id] } });
  assert.equal((await json(app, 'GET', '/api/shares/counts', { token: tokens.kid })).body.unseen, 0);
  await json(app, 'POST', `/api/shares/${got[0].id}/hide`, { token: tokens.kid });
  assert.equal((await json(app, 'GET', '/api/shares', { token: tokens.kid })).body.shares.length, 0);
});

test('share with everyone, and unshare', async () => {
  const { app, tokens } = await seeded();
  const s = (await json(app, 'POST', '/api/shares', { token: tokens.kid, body: { kind: 'station', title: 'SUB/WAVE', payload: { url: 'https://radio.example/stream' }, to: null } })).body.share;
  for (const who of ['admin', 'member'] as const) assert.equal((await json(app, 'GET', '/api/shares', { token: tokens[who] })).body.shares.length, 1);
  await json(app, 'POST', '/api/shares/seen', { token: tokens.member, body: {} });
  assert.equal((await json(app, 'GET', '/api/shares/counts', { token: tokens.member })).body.unseen, 0);
  assert.equal((await json(app, 'GET', '/api/shares/counts', { token: tokens.admin })).body.unseen, 1, 'seen is per person');

  assert.equal((await json(app, 'DELETE', `/api/shares/${s.id}`, { token: tokens.member })).status, 404, 'only the sender (or an admin)');
  assert.equal((await json(app, 'POST', `/api/shares/${s.id}/hide`, { token: tokens.kid })).status, 404, 'cannot hide your own');
  assert.equal((await json(app, 'DELETE', `/api/shares/${s.id}`, { token: tokens.kid })).status, 200);
  assert.equal((await json(app, 'GET', '/api/shares', { token: tokens.admin })).body.shares.length, 0);
});

test('bad shares are refused', async () => {
  const { app, tokens, ids } = await seeded();
  const send = (body: unknown, token = tokens.member) => json(app, 'POST', '/api/shares', { token, body });
  assert.equal((await send({ ...MIX, kind: 'virus' })).status, 400);
  assert.equal((await send({ ...MIX, title: '' })).status, 400);
  assert.equal((await send({ ...MIX, payload: 'nope' })).status, 400);
  assert.equal((await send({ ...MIX, to: ids.member })).status, 400, 'not to yourself');
  assert.equal((await send({ ...MIX, to: 9999 })).status, 404);
  assert.equal((await send({ ...MIX, payload: { tracks: Array(20000).fill({ title: 'x'.repeat(40) }) } })).status, 413);
  assert.equal((await json(app, 'POST', '/api/shares', { body: MIX })).status, 401);
});
