import assert from 'node:assert/strict';
import { test } from 'node:test';
import { json, seeded } from './helpers.ts';

const song = (id: string) => ({ id, sourceId: 'hub-1', kind: 'track', title: `Song ${id}`, artist: 'Band', duration: 200 });

test('a party: guests follow the host, add songs, and control only when allowed', async () => {
  const { app, tokens } = await seeded();
  const host = tokens.admin, guest = tokens.member, kid = tokens.kid;
  const p = (await json(app, 'POST', '/api/together', { token: host, body: { name: 'Road trip' } })).body;
  assert.equal(p.isHost, true);
  assert.equal(p.guestsAdd, true);
  assert.equal(p.guestsControl, false);

  assert.deepEqual((await json(app, 'GET', '/api/together', { token: guest })).body.parties.map((x: { name: string; joined: boolean }) => [x.name, x.joined]), [['Road trip', false]]);
  const joined = (await json(app, 'POST', `/api/together/${p.id}/join`, { token: guest })).body;
  assert.equal(joined.isHost, false);
  assert.equal(joined.members.length, 2);

  // the guest waits; the host starts playing
  const waiting = json(app, 'GET', `/api/together/${p.id}/wait?version=${joined.version}&timeout=2000`, { token: guest });
  await json(app, 'PUT', `/api/together/${p.id}/state`, { token: host, body: { queue: [song('a'), song('b')], index: 0, position: 12, duration: 200, playing: true } });
  const seen = (await waiting).body.party;
  assert.equal(seen.state.index, 0);
  assert.equal(seen.state.position, 12);
  assert.equal(seen.state.playing, true);
  assert.ok(seen.now >= seen.state.at);

  // guests may only send what the guestsControl / guestsAdd switches allow
  assert.equal((await json(app, 'PUT', `/api/together/${p.id}/state`, { token: guest, body: { queue: [] } })).status, 403);
  assert.equal((await json(app, 'POST', `/api/together/${p.id}/request`, { token: guest, body: { action: 'next' } })).status, 403);
  assert.equal((await json(app, 'POST', `/api/together/${p.id}/request`, { token: guest, body: { action: 'add', tracks: [song('c')] } })).status, 200);
  const host1 = (await json(app, 'GET', `/api/together/${p.id}/wait?version=999&timeout=10`, { token: host })).body;
  assert.deepEqual(host1.requests.map((r: { action: string; from: string }) => [r.action, r.from]), [['add', 'mia']]);
  assert.equal(host1.requests[0].tracks[0].id, 'c');

  await json(app, 'PATCH', `/api/together/${p.id}`, { token: host, body: { guestsControl: true, guestsAdd: false } });
  assert.equal((await json(app, 'POST', `/api/together/${p.id}/request`, { token: guest, body: { action: 'next' } })).status, 200);
  assert.equal((await json(app, 'POST', `/api/together/${p.id}/request`, { token: guest, body: { action: 'add', tracks: [song('d')] } })).status, 403);
  assert.equal((await json(app, 'PATCH', `/api/together/${p.id}`, { token: guest, body: { guestsAdd: true } })).status, 403);

  // someone who hasn't joined can't do anything in it
  assert.equal((await json(app, 'POST', `/api/together/${p.id}/request`, { token: kid, body: { action: 'add', tracks: [song('e')] } })).status, 404);
  assert.equal((await json(app, 'GET', `/api/together/${p.id}/wait?timeout=10`, { token: kid })).body.party, null);

  // the guest leaves; then the host ends it for everyone
  await json(app, 'POST', `/api/together/${p.id}/join`, { token: kid });
  await json(app, 'POST', `/api/together/${p.id}/leave`, { token: guest });
  const kidWait = json(app, 'GET', `/api/together/${p.id}/wait?version=999&timeout=2000`, { token: kid });
  await json(app, 'POST', `/api/together/${p.id}/leave`, { token: host });
  assert.equal((await kidWait).body.party, null);
  assert.deepEqual((await json(app, 'GET', '/api/together', { token: guest })).body.parties, []);
});

test('one party per device', async () => {
  const { app, tokens } = await seeded();
  const a = (await json(app, 'POST', '/api/together', { token: tokens.admin, body: {} })).body;
  assert.equal(a.name, "boss's party");
  assert.equal((await json(app, 'POST', '/api/together', { token: tokens.admin, body: {} })).status, 409);
  const b = (await json(app, 'POST', '/api/together', { token: tokens.member, body: {} })).body;
  assert.equal((await json(app, 'POST', `/api/together/${b.id}/join`, { token: tokens.admin })).status, 409);
  assert.equal((await json(app, 'GET', '/api/together')).status, 401);
});
