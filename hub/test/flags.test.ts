import assert from 'node:assert/strict';
import { test } from 'node:test';
import { json, seeded } from './helpers.ts';

test('admins flag music for kids; everyone signed in gets the list', async () => {
  const { app, tokens } = await seeded();
  const set = (body: unknown, token = tokens.admin) => json(app, 'POST', '/api/admin/flags', { token, body });

  const a = await set({ kind: 'album', artist: 'Eminem', title: 'The Marshall Mathers LP', verdict: 'block' });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  await set({ kind: 'artist', artist: 'Parental Advisory Band', verdict: 'block' });
  await set({ kind: 'track', artist: 'Kendrick Lamar', title: 'Humble', verdict: 'allow' });
  // same item again (any case) changes the verdict instead of adding another
  const again = await set({ kind: 'album', artist: 'eminem', title: 'the marshall mathers lp', verdict: 'allow' });
  assert.equal(again.body.flag.id, a.body.flag.id);
  assert.equal(again.body.flag.verdict, 'allow');

  for (const who of ['member', 'kid'] as const) {
    assert.equal((await set({ kind: 'artist', artist: 'X', verdict: 'allow' }, tokens[who])).status, 403);
    const list = (await json(app, 'GET', '/api/flags', { token: tokens[who] })).body.flags;
    assert.equal(list.length, 3);
  }
  assert.equal((await json(app, 'GET', '/api/flags')).status, 401);

  assert.equal((await set({ kind: 'song', artist: 'X', verdict: 'block' })).status, 400);
  assert.equal((await set({ kind: 'track', artist: 'X', verdict: 'block' })).status, 400, 'a song needs its title');
  assert.equal((await set({ kind: 'artist', artist: 'X', verdict: 'maybe' })).status, 400);

  assert.equal((await json(app, 'DELETE', `/api/admin/flags/${a.body.flag.id}`, { token: tokens.kid })).status, 403);
  assert.equal((await json(app, 'DELETE', `/api/admin/flags/${a.body.flag.id}`, { token: tokens.admin })).status, 200);
  assert.equal((await json(app, 'GET', '/api/flags', { token: tokens.kid })).body.flags.length, 2);

  const log = JSON.stringify((await json(app, 'GET', '/api/admin/audit', { token: tokens.admin })).body);
  assert.ok(log.includes('kids.blocked') && log.includes('kids.unflagged'));
});
