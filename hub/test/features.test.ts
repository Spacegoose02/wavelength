import assert from 'node:assert/strict';
import { test } from 'node:test';
import { json, seeded } from './helpers.ts';

test('admins switch features for the household and for kids; /api/me says what is on', async () => {
  const { app, tokens } = await seeded();
  const me = await json(app, 'GET', '/api/me', { token: tokens.member });
  assert.equal(me.body.features.homeMixes, true);
  assert.equal(me.body.features.djVoice, false, 'off until an admin turns it on');
  assert.equal((await json(app, 'GET', '/api/me', { token: tokens.kid })).body.features.musicVideos, false, 'videos start off for kids');

  // members and kids can't read or change the switches
  assert.equal((await json(app, 'GET', '/api/admin/features', { token: tokens.member })).status, 403);
  assert.equal((await json(app, 'PUT', '/api/admin/features', { token: tokens.kid, body: { features: { homeMixes: { on: false } } } })).status, 403);

  const put = await json(app, 'PUT', '/api/admin/features', { token: tokens.admin, body: { features: { homeMixes: { on: false }, musicVideos: { kids: true }, djVoice: { on: true } } } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.deepEqual(put.body.features.homeMixes, { on: false, kids: true });
  assert.equal((await json(app, 'GET', '/api/me', { token: tokens.member })).body.features.homeMixes, false);
  assert.equal((await json(app, 'GET', '/api/me', { token: tokens.kid })).body.features.musicVideos, true);
  assert.equal((await json(app, 'GET', '/api/me', { token: tokens.kid })).body.features.djVoice, false, 'kids stay off while kids is off');

  assert.equal((await json(app, 'PUT', '/api/admin/features', { token: tokens.admin, body: { features: { nope: { on: true } } } })).status, 400);
  assert.equal((await json(app, 'PUT', '/api/admin/features', { token: tokens.admin, body: { features: { blend: { on: 'yes' } } } })).status, 400);
  assert.equal((await json(app, 'GET', '/api/admin/features', { token: tokens.admin })).body.features.homeMixes.on, false);
});
