import assert from 'node:assert/strict';
import { test } from 'node:test';
import { json, seeded } from './helpers.ts';

test('preferences sync per key, newest write wins', async () => {
  const { app, tokens } = await seeded();
  const put = (changes: unknown, token = tokens.member) => json(app, 'PUT', '/api/me/prefs', { token, body: { changes } });

  const a = await put({ skin: { value: 'outrun', updatedAt: 1000 }, eq: { value: { on: true }, updatedAt: 1000 } });
  assert.deepEqual(a.body.applied.sort(), ['eq', 'skin']);

  // an older write from another device loses on that key only
  const b = await put({ skin: { value: 'winamp', updatedAt: 500 }, volume: { value: 0.4, updatedAt: 500 } });
  assert.deepEqual(b.body.stale, ['skin']);
  assert.equal(b.body.prefs.skin.value, 'outrun');
  assert.equal(b.body.prefs.volume.value, 0.4);

  // a clock far in the future is clamped to now
  const c = await put({ skin: { value: 'neon', updatedAt: Date.now() + 10 * 365 * 864e5 } });
  assert.ok(c.body.prefs.skin.updatedAt <= Date.now());

  // other users don't see them
  assert.deepEqual((await json(app, 'GET', '/api/me/prefs', { token: tokens.kid })).body.prefs, {});
  assert.equal((await put({ 'bad key!': { value: 1, updatedAt: 1 } })).status, 400);
  assert.equal((await put({ skin: { value: 1 } })).status, 400);
});
