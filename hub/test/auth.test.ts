import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADMIN_PW, form, json, makeHub, seeded } from './helpers.ts';

test('first-run setup creates one admin and then locks', async () => {
  const { app } = makeHub();
  assert.equal((await json(app, 'GET', '/api/health')).body.setupNeeded, true);
  const r = await json(app, 'POST', '/auth/setup', { body: { username: 'Boss', password: ADMIN_PW } });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.username, 'boss');
  assert.equal(r.body.user.role, 'admin');
  assert.match(r.body.token, /^wlh_/);
  assert.equal((await json(app, 'POST', '/auth/setup', { body: { username: 'evil', password: ADMIN_PW } })).status, 409);
  assert.equal((await form(app, '/setup', { username: 'evil', password: ADMIN_PW })).status, 302);
});

test('password sign-in, wrong passwords and rate limiting', async () => {
  const { app } = await seeded();
  assert.equal((await json(app, 'POST', '/auth/login', { body: { username: 'boss', password: 'nope' } })).status, 401);
  assert.equal((await json(app, 'POST', '/auth/login', { body: { username: 'ghost', password: 'nope' } })).status, 401);
  const ok = await json(app, 'POST', '/auth/login', { body: { username: 'BOSS', password: ADMIN_PW, deviceName: 'Laptop', platform: 'windows' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.device.name, 'Laptop');
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await json(app, 'POST', '/auth/login', { body: { username: 'mia', password: 'wrong' } })).status;
  assert.equal(last, 429);
});

test('sign out revokes only the current device', async () => {
  const { app, tokens } = await seeded();
  const second = (await json(app, 'POST', '/auth/login', { body: { username: 'boss', password: ADMIN_PW, deviceName: 'TV' } })).body.token;
  assert.equal((await json(app, 'POST', '/auth/logout', { token: second })).status, 200);
  assert.equal((await json(app, 'GET', '/api/me', { token: second })).status, 401);
  assert.equal((await json(app, 'GET', '/api/me', { token: tokens.admin })).status, 200);
});

test('device pairing with a Hub password', async () => {
  const { app } = await seeded();
  const start = await json(app, 'POST', '/auth/device', { body: { deviceName: 'Living room TV', platform: 'android-tv' } });
  assert.equal(start.status, 200);
  assert.match(start.body.userCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(start.body.verificationUrl, 'https://hub.test/link');

  assert.equal((await json(app, 'POST', '/auth/device/token', { body: { deviceCode: start.body.deviceCode } })).status, 202);

  const page = await json(app, 'GET', `/link?code=${start.body.userCode.toLowerCase().replace('-', '')}`);
  assert.match(page.body, /Living room TV/);

  const bad = await form(app, '/link', { code: start.body.userCode, username: 'mia', password: 'wrong' });
  assert.equal(bad.status, 401);
  const ok = await form(app, '/link', { code: start.body.userCode, username: 'mia', password: 'mia-password-123' });
  assert.equal(ok.status, 200);

  const done = await json(app, 'POST', '/auth/device/token', { body: { deviceCode: start.body.deviceCode } });
  assert.equal(done.status, 200);
  assert.equal(done.body.user.username, 'mia');
  assert.equal(done.body.device.name, 'Living room TV');
  assert.equal((await json(app, 'GET', '/api/me', { token: done.body.token })).body.user.username, 'mia');
  // the device code works once
  assert.equal((await json(app, 'POST', '/auth/device/token', { body: { deviceCode: start.body.deviceCode } })).status, 410);
  // and the user code is spent
  assert.equal((await form(app, '/link', { code: start.body.userCode, username: 'mia', password: 'mia-password-123' })).status, 400);
});

test('pairing needs a set-up Hub', async () => {
  const { app } = makeHub();
  assert.equal((await json(app, 'POST', '/auth/device', { body: {} })).status, 409);
});
