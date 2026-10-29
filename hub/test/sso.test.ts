import assert from 'node:assert/strict';
import { test } from 'node:test';
import { form, json, makeHub, seeded } from './helpers.ts';

const SECRET = 'proxy-secret-value';
// light-my-request connects from 127.0.0.1
const proxied = (user: string, extra: Record<string, string> = {}) => ({ 'remote-user': user, 'x-wavelength-proxy-secret': SECRET, ...extra });

async function pairViaSso(app: Awaited<ReturnType<typeof seeded>>['app'], headers: Record<string, string>) {
  const start = await json(app, 'POST', '/auth/device', { body: { deviceName: 'Phone' } });
  const confirm = await app.inject({ method: 'GET', url: `/auth/sso/link?code=${start.body.userCode}`, headers });
  const csrf = /name="csrf" value="([^"]+)"/.exec(confirm.body)?.[1] ?? '';
  const approve = await form(app, '/auth/sso/link', { code: start.body.userCode, csrf, decision: 'approve' }, headers);
  const token = await json(app, 'POST', '/auth/device/token', { body: { deviceCode: start.body.deviceCode } });
  return { confirm, approve, token };
}

test('a named SSO admin can set up an empty Hub', async () => {
  const { app } = makeHub({ enabled: true, trustedProxies: ['127.0.0.1'], proxySecret: SECRET, admins: ['alex'] });
  // pairing needs at least one account, so the first SSO admin is created on their first visit
  await app.inject({ method: 'GET', url: '/auth/sso/link?code=XXXX-XXXX', headers: proxied('Alex') });
  const { approve, token } = await pairViaSso(app, proxied('alex'));
  assert.equal(approve.status, 200);
  assert.equal(token.body.user.role, 'admin');
  assert.equal(token.body.user.ssoSubject, 'alex');
});

test('SSO maps tinyauth users, groups and refuses strangers', async () => {
  const { app, tokens } = await seeded({ enabled: true, trustedProxies: ['127.0.0.1'], proxySecret: SECRET, adminGroup: 'wl-admins' });
  // unknown, no auto-create
  const stranger = await pairViaSso(app, proxied('stranger'));
  assert.equal(stranger.confirm.statusCode, 403);
  assert.match(stranger.confirm.body, /Ask your admin/);

  // admin links an existing user to an SSO name
  await json(app, 'POST', '/api/admin/users', { token: tokens.admin, body: { username: 'sam', role: 'member', ssoSubject: 'Sam' } });
  const sam = await pairViaSso(app, proxied('sam'));
  assert.equal(sam.token.body.user.username, 'sam');
  assert.equal(sam.token.body.user.role, 'member');

  // admin group membership promotes on sign-in
  await json(app, 'POST', '/api/admin/users', { token: tokens.admin, body: { username: 'jo', role: 'member', ssoSubject: 'jo' } });
  const jo = await pairViaSso(app, proxied('jo', { 'remote-groups': 'family,wl-admins' }));
  assert.equal(jo.token.body.user.role, 'admin');
});

test('identity headers are ignored without the proxy secret or from untrusted addresses', async () => {
  const { app, tokens } = await seeded({ enabled: true, trustedProxies: ['127.0.0.1'], proxySecret: SECRET });
  await json(app, 'POST', '/api/admin/users', { token: tokens.admin, body: { username: 'sam', role: 'member', ssoSubject: 'sam' } });
  const noSecret = await app.inject({ method: 'GET', url: '/auth/sso/link?code=XXXX-XXXX', headers: { 'remote-user': 'sam' } });
  assert.equal(noSecret.statusCode, 401);
  const wrongSecret = await app.inject({ method: 'GET', url: '/auth/sso/link?code=XXXX-XXXX', headers: proxied('sam', { 'x-wavelength-proxy-secret': 'guess' }) });
  assert.equal(wrongSecret.statusCode, 401);

  const other = makeHub({ enabled: true, trustedProxies: ['10.0.0.2'] });
  const fromElsewhere = await other.app.inject({ method: 'GET', url: '/auth/sso/link?code=XXXX-XXXX', headers: { 'remote-user': 'boss' } });
  assert.equal(fromElsewhere.statusCode, 401);
});

test('the SSO approve form needs its CSRF value', async () => {
  const { app, tokens } = await seeded({ enabled: true, trustedProxies: ['127.0.0.1'], proxySecret: SECRET });
  await json(app, 'POST', '/api/admin/users', { token: tokens.admin, body: { username: 'sam', role: 'member', ssoSubject: 'sam' } });
  const start = await json(app, 'POST', '/auth/device', { body: { deviceName: 'Phone' } });
  const r = await form(app, '/auth/sso/link', { code: start.body.userCode, csrf: 'forged', decision: 'approve' }, proxied('sam'));
  assert.equal(r.status, 403);
  assert.equal((await json(app, 'POST', '/auth/device/token', { body: { deviceCode: start.body.deviceCode } })).status, 202);
});

test('SSO stays off unless turned on', async () => {
  const { app } = await seeded();
  const r = await app.inject({ method: 'GET', url: '/auth/sso/link?code=XXXX-XXXX', headers: { 'remote-user': 'boss' } });
  assert.equal(r.statusCode, 401);
});
