import assert from 'node:assert/strict';
import { test } from 'node:test';
import { json, seeded } from './helpers.ts';

test('house activity: grown-ups show unless they opt out, kids only if they opt in and only to their grown-ups', async () => {
  const { app, tokens, ids } = await seeded();
  const report = (token: string, title: string, extra: object = {}) => json(app, 'PUT', '/api/me/activity', { token, body: { title, artist: 'Band', playing: true, ...extra } });
  const seen = async (token: string) => (await json(app, 'GET', '/api/activity', { token })).body.listeners.map((l: { displayName: string; title: string }) => `${l.displayName}: ${l.title}`);
  const pref = (token: string, value: boolean) => json(app, 'PUT', '/api/me/prefs', { token, body: { changes: { 'settings.shareListening': { value, updatedAt: Date.now() } } } });
  await json(app, 'PUT', `/api/admin/users/${ids.kid}/guardians`, { token: tokens.admin, body: { ids: [ids.member] } });

  assert.equal((await report(tokens.member, 'Hey Jude')).body.shared, true);
  assert.equal((await report(tokens.kid, 'Baby Shark')).body.shared, false); // kids are hidden unless they say so
  assert.deepEqual(await seen(tokens.admin), ['mia: Hey Jude']);
  assert.deepEqual(await seen(tokens.member), []); // not yourself

  // the kid opts in: their grown-up sees them, nobody else does
  await pref(tokens.kid, true);
  await report(tokens.kid, 'Baby Shark');
  assert.deepEqual(await seen(tokens.member), ['kit: Baby Shark']);
  assert.deepEqual(await seen(tokens.admin), ['mia: Hey Jude']);

  // kids don't see songs that aren't for kids
  await report(tokens.admin, 'Rude Song', { album: 'Parental Advisory (Explicit)' });
  await json(app, 'POST', '/api/admin/flags', { token: tokens.admin, body: { kind: 'track', artist: 'Band', title: 'Rude Song', verdict: 'block' } });
  assert.deepEqual((await seen(tokens.kid)).sort(), ['mia: Hey Jude']);
  assert.deepEqual((await seen(tokens.member)).sort(), ['boss: Rude Song', 'kit: Baby Shark']);

  // a grown-up opts out, or stops
  await pref(tokens.member, false);
  assert.deepEqual(await seen(tokens.admin), []);
  await json(app, 'DELETE', '/api/me/activity', { token: tokens.admin });
  assert.deepEqual(await seen(tokens.member), ['kit: Baby Shark']);
  assert.equal((await json(app, 'PUT', '/api/me/activity', { token: tokens.member, body: {} })).status, 400);
  assert.equal((await json(app, 'GET', '/api/activity')).status, 401);
});
