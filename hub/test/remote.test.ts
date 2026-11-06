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

test('Home Assistant: its own token lists the players by name and sends them commands', async () => {
  const { app, tokens } = await seeded();
  assert.equal((await json(app, 'POST', '/api/me/homeassistant', { token: tokens.kid })).status, 403);
  const ha = (await json(app, 'POST', '/api/me/homeassistant', { token: tokens.member })).body;
  assert.match(ha.token, /^wlh_/);
  // it never shows up as a player, and can't use the devices' own routes
  assert.equal((await json(app, 'GET', '/api/me/remote/wait?timeout=10', { token: ha.token })).status, 403);

  const waiting = json(app, 'GET', '/api/me/remote/wait?timeout=2000', { token: tokens.member });
  await json(app, 'PUT', '/api/me/remote/state', {
    token: tokens.member,
    body: { queue: [{ ...song('a'), album: 'LP', streamUrl: 'https://nd/rest/stream?u=mia&t=secret' }, song('b')], index: 0, position: 10, duration: 200, playing: true, volume: 0.4 },
  });
  const r = (await json(app, 'GET', '/api/ha/players', { token: ha.token })).body;
  assert.equal(r.playing, 1);
  assert.equal(r.players.length, 1);
  const p = r.players[0];
  assert.deepEqual([p.name, p.state, p.title, p.artist, p.album, p.volume, p.queued], ['Phone', 'playing', 'Song a', 'Band', 'LP', 0.4, 1]);
  assert.equal(JSON.stringify(r).includes('secret'), false);
  assert.equal((await json(app, 'GET', '/api/ha/player?name=phone', { token: ha.token })).body.title, 'Song a');
  assert.deepEqual((await json(app, 'GET', '/api/ha/player?name=Kitchen', { token: ha.token })).body, { state: 'off', name: 'Kitchen' });
  // someone else's Home Assistant sees none of mia's players
  const other = (await json(app, 'POST', '/api/me/homeassistant', { token: tokens.admin })).body;
  assert.deepEqual((await json(app, 'GET', '/api/ha/players', { token: other.token })).body.players, []);
  assert.equal((await json(app, 'POST', `/api/ha/players/${p.id}`, { token: other.token, body: { action: 'pause' } })).status, 404);

  assert.equal((await json(app, 'POST', `/api/ha/players/${p.id}`, { token: ha.token, body: { action: 'load' } })).status, 400);
  assert.equal((await json(app, 'POST', `/api/ha/players/${p.id}`, { token: ha.token, body: { action: 'volume', value: 30 } })).status, 200);
  const got = (await waiting).body.commands;
  assert.deepEqual(got.map((c: { action: string; value: number; from: string }) => [c.action, c.value, c.from]), [['volume', 0.3, 'Home Assistant']]);
  // revoked from the devices list like any device
  const devs = (await json(app, 'GET', '/api/me/devices', { token: tokens.member })).body.devices;
  const haDev = devs.find((d: { platform: string }) => d.platform === 'homeassistant');
  await json(app, 'DELETE', `/api/me/devices/${haDev.id}`, { token: tokens.member });
  assert.equal((await json(app, 'GET', '/api/ha/players', { token: ha.token })).status, 401);
});
