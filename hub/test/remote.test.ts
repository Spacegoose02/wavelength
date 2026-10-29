import assert from 'node:assert/strict';
import { test } from 'node:test';
import { json, seeded } from './helpers.ts';

const song = (id: string) => ({ id, sourceId: 'nd', kind: 'track', title: `Song ${id}`, artist: 'Band', duration: 200 });

test('a person’s devices see each other and pass playback between them', async () => {
  const { app, tokens } = await seeded();
  const tv = (await json(app, 'POST', '/auth/login', { body: { username: 'mia', password: 'mia-password-123', deviceName: 'Living room TV' } })).body.token as string;
  const phone = tokens.member;

  // the TV starts waiting; the phone reports what it plays
  const waiting = json(app, 'GET', '/api/me/remote/wait?timeout=2000', { token: tv });
  await json(app, 'PUT', '/api/me/remote/state', { token: phone, body: { queue: [song('a'), song('b')], index: 1, position: 30, duration: 200, playing: true, volume: 0.5 } });
  const list = (await json(app, 'GET', '/api/me/remote/devices', { token: phone })).body.devices;
  assert.deepEqual(list.map((d: { name: string; current: boolean }) => [d.name, d.current]), [['Phone', true], ['Living room TV', false]]);
  const tvId = list[1].id;
  assert.equal(list[0].state.index, 1);
  assert.ok(list[0].state.position >= 30);

  // "Continue on Living room TV"
  const sent = await json(app, 'POST', '/api/me/remote/command', { token: phone, body: { deviceId: tvId, action: 'load', queue: [song('a'), song('b')], index: 1, position: 31 } });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const got = (await waiting).body.commands;
  assert.equal(got.length, 1);
  assert.equal(got[0].action, 'load');
  assert.equal(got[0].from, 'Phone');
  assert.equal(got[0].index, 1);
  assert.equal(got[0].position, 31);
  assert.equal(got[0].play, true);

  // commands sent while the TV isn't waiting are kept for its next wait
  await json(app, 'POST', '/api/me/remote/command', { token: phone, body: { deviceId: tvId, action: 'volume', value: 3 } });
  await json(app, 'POST', '/api/me/remote/command', { token: phone, body: { deviceId: tvId, action: 'pause' } });
  const next = (await json(app, 'GET', '/api/me/remote/wait?timeout=10', { token: tv })).body.commands;
  assert.deepEqual(next.map((c: { action: string; value?: number }) => [c.action, c.value]), [['volume', 1], ['pause', undefined]]);
  assert.deepEqual((await json(app, 'GET', '/api/me/remote/wait?timeout=10', { token: tv })).body.commands, []);

  // bad commands
  assert.equal((await json(app, 'POST', '/api/me/remote/command', { token: phone, body: { deviceId: tvId, action: 'format-disk' } })).status, 400);
  assert.equal((await json(app, 'POST', '/api/me/remote/command', { token: phone, body: { deviceId: tvId, action: 'load', queue: [] } })).status, 400);
  const phoneId = list[0].id;
  assert.equal((await json(app, 'POST', '/api/me/remote/command', { token: tv, body: { deviceId: phoneId, action: 'next' } })).status, 200);

  // the TV turns remote control off: gone at once
  await json(app, 'DELETE', '/api/me/remote', { token: tv });
  const after = (await json(app, 'GET', '/api/me/remote/devices', { token: phone })).body.devices;
  assert.deepEqual(after.map((d: { name: string }) => d.name), ['Phone']);
  assert.equal((await json(app, 'POST', '/api/me/remote/command', { token: phone, body: { deviceId: tvId, action: 'next' } })).status, 404);
});

test('nobody can see or control someone else’s devices', async () => {
  const { app, tokens } = await seeded();
  await json(app, 'GET', '/api/me/remote/wait?timeout=10', { token: tokens.member });
  const mine = (await json(app, 'GET', '/api/me/remote/devices', { token: tokens.member })).body.devices;
  assert.equal(mine.length, 1);
  assert.deepEqual((await json(app, 'GET', '/api/me/remote/devices', { token: tokens.kid })).body.devices.map((d: { current: boolean }) => d.current), [true]);
  for (const who of ['kid', 'admin'] as const) {
    const r = await json(app, 'POST', '/api/me/remote/command', { token: tokens[who], body: { deviceId: mine[0].id, action: 'pause' } });
    assert.equal(r.status, 404, who);
  }
  assert.equal((await json(app, 'GET', '/api/me/remote/devices')).status, 401);
});

test('closing the Hub lets waiting devices go', async () => {
  const { app, tokens } = await seeded();
  const waiting = json(app, 'GET', '/api/me/remote/wait', { token: tokens.member });
  await new Promise((done) => setTimeout(done, 20));
  const started = Date.now();
  await app.close();
  await waiting.catch(() => undefined);
  assert.ok(Date.now() - started < 5000);
});
