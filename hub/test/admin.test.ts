import assert from 'node:assert/strict';
import { test } from 'node:test';
import { json, seeded } from './helpers.ts';

test('every admin route refuses members, kids and anonymous callers', async () => {
  const { app, tokens, ids } = await seeded();
  await app.ready();
  const adminRoutes = app.hubRoutes.filter((r) => r.url.startsWith('/api/admin/'));
  assert.ok(adminRoutes.length >= 7, 'admin routes were registered');
  for (const r of adminRoutes) {
    const url = r.url.replace(':userId', String(ids.member)).replace(':id', String(ids.admin));
    for (const who of ['member', 'kid'] as const) {
      const res = await json(app, r.method, url, { token: tokens[who], body: r.method === 'GET' || r.method === 'DELETE' ? undefined : { role: 'admin' } });
      assert.equal(res.status, 403, `${who} ${r.method} ${r.url}`);
    }
    const anon = await json(app, r.method, url, { body: r.method === 'GET' || r.method === 'DELETE' ? undefined : {} });
    assert.equal(anon.status, 401, `anonymous ${r.method} ${r.url}`);
    const forged = await json(app, r.method, url, { token: 'wlh_not-a-real-token' });
    assert.equal(forged.status, 401, `bad token ${r.method} ${r.url}`);
  }
  // and nothing changed: the admin is still the only admin
  const users = await json(app, 'GET', '/api/admin/users', { token: tokens.admin });
  assert.deepEqual(users.body.users.filter((u: { role: string }) => u.role === 'admin').map((u: { username: string }) => u.username), ['boss']);
});

test('permissions follow the role and the autodownload switch', async () => {
  const { app, tokens, ids } = await seeded();
  const me = async (t: string) => (await json(app, 'GET', '/api/me', { token: t })).body.permissions as string[];
  assert.ok((await me(tokens.admin)).includes('users.manage'));
  assert.deepEqual(await me(tokens.member), ['requests.create']);

  await json(app, 'PATCH', `/api/admin/users/${ids.member}`, { token: tokens.admin, body: { autodownload: true } });
  assert.ok((await me(tokens.member)).includes('downloads.run'), 'member with the switch may download');

  const kid = await json(app, 'PATCH', `/api/admin/users/${ids.kid}`, { token: tokens.admin, body: { autodownload: true } });
  assert.equal(kid.body.user.autodownload, false, 'kids can never hold the switch');
  assert.ok(!(await me(tokens.kid)).includes('downloads.run'));

  // demoting takes effect on the very next request, no re-login needed
  await json(app, 'PATCH', `/api/admin/users/${ids.member}`, { token: tokens.admin, body: { role: 'kid' } });
  assert.ok(!(await me(tokens.member)).includes('downloads.run'));
});

test('the last admin cannot be removed, demoted or disabled', async () => {
  const { app, tokens, ids } = await seeded();
  for (const body of [{ role: 'member' }, { disabled: true }]) {
    const r = await json(app, 'PATCH', `/api/admin/users/${ids.admin}`, { token: tokens.admin, body });
    assert.equal(r.status, 409);
  }
  assert.equal((await json(app, 'DELETE', `/api/admin/users/${ids.admin}`, { token: tokens.admin })).status, 409);
  // with a second admin it's allowed
  await json(app, 'PATCH', `/api/admin/users/${ids.member}`, { token: tokens.admin, body: { role: 'admin' } });
  assert.equal((await json(app, 'PATCH', `/api/admin/users/${ids.admin}`, { token: tokens.admin, body: { role: 'member' } })).status, 200);
});

test('disabling a user signs out all their devices', async () => {
  const { app, tokens, ids } = await seeded();
  assert.equal((await json(app, 'GET', '/api/me', { token: tokens.member })).status, 200);
  await json(app, 'PATCH', `/api/admin/users/${ids.member}`, { token: tokens.admin, body: { disabled: true } });
  assert.equal((await json(app, 'GET', '/api/me', { token: tokens.member })).status, 401);
  // re-enabling doesn't bring the old token back
  await json(app, 'PATCH', `/api/admin/users/${ids.member}`, { token: tokens.admin, body: { disabled: false } });
  assert.equal((await json(app, 'GET', '/api/me', { token: tokens.member })).status, 401);
});

test('admin actions are audited without passwords', async () => {
  const { app, tokens, ids } = await seeded();
  await json(app, 'PATCH', `/api/admin/users/${ids.member}`, { token: tokens.admin, body: { password: 'a-brand-new-password' } });
  const log = await json(app, 'GET', '/api/admin/audit', { token: tokens.admin });
  const text = JSON.stringify(log.body);
  assert.ok(text.includes('user.updated'));
  assert.ok(!text.includes('a-brand-new-password'));
  assert.ok(!text.includes('scrypt$'));
});
