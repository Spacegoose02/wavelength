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
  assert.equal(stranger.confirm.statusCode, 200);
  assert.match(stranger.confirm.body, /isn't linked to a Wavelength account/);
  assert.match(stranger.confirm.body, /Ask your admin/);
  assert.notEqual(stranger.token.status, 200);

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

test('someone tinyauth knows can link their existing password account, then finish pairing', async () => {
  const { app } = await seeded({ enabled: true, trustedProxies: ['127.0.0.1'], proxySecret: SECRET });
  const start = await json(app, 'POST', '/auth/device', { body: { deviceName: 'Phone' } });
  const page = await app.inject({ method: 'GET', url: `/auth/sso/link?code=${start.body.userCode}`, headers: proxied('mia.sso') });
  assert.match(page.body, /action="\/auth\/sso\/connect"/);

  const wrong = await form(app, '/auth/sso/connect', { code: start.body.userCode, username: 'mia', password: 'nope' }, proxied('mia.sso'));
  assert.equal(wrong.status, 401);
  // without tinyauth's headers nothing can be linked
  assert.equal((await form(app, '/auth/sso/connect', { username: 'mia', password: 'mia-password-123' })).status, 401);

  const linked = await form(app, '/auth/sso/connect', { code: start.body.userCode, username: 'mia', password: 'mia-password-123' }, proxied('mia.sso'));
  assert.equal(linked.status, 200);
  const csrf = /name="csrf" value="([^"]+)"/.exec(linked.body)?.[1] ?? '';
  assert.ok(csrf, 'goes straight on to approving the device');
  await form(app, '/auth/sso/link', { code: start.body.userCode, csrf, decision: 'approve' }, proxied('mia.sso'));
  const done = await json(app, 'POST', '/auth/device/token', { body: { deviceCode: start.body.deviceCode } });
  assert.equal(done.body.user.username, 'mia');
  assert.equal(done.body.user.ssoSubject, 'mia.sso');

  // next time single sign-on alone is enough
  const again = await pairViaSso(app, proxied('mia.sso'));
  assert.equal(again.token.body.user.username, 'mia');
  // and the same identity can't be linked to a second account
  const kit = await form(app, '/auth/sso/connect', { username: 'kit', password: 'kit-password-123' }, proxied('mia.sso'));
  assert.equal(kit.status, 409);
});

test('linking from the app with a one-time link, and unlinking', async () => {
  const { app, tokens } = await seeded({ enabled: true, trustedProxies: ['127.0.0.1'], proxySecret: SECRET });
  const r = await json(app, 'POST', '/api/me/sso-link', { token: tokens.member });
  assert.equal(r.status, 200);
  const url = new URL(r.body.url);
  assert.equal(url.pathname, '/auth/sso/connect');
  const link = url.searchParams.get('link')!;

  const page = await app.inject({ method: 'GET', url: `/auth/sso/connect?link=${encodeURIComponent(link)}`, headers: proxied('mia-sso') });
  assert.equal(page.statusCode, 200);
  const csrf = /name="csrf" value="([^"]+)"/.exec(page.body)?.[1] ?? '';
  // a forged form (no csrf) does nothing
  assert.equal((await form(app, '/auth/sso/connect', { link, csrf: 'x', decision: 'link' }, proxied('mia-sso'))).status, 403);
  // the csrf is tied to the identity that opened the page
  assert.equal((await form(app, '/auth/sso/connect', { link, csrf, decision: 'link' }, proxied('someone-else'))).status, 403);

  const ok = await form(app, '/auth/sso/connect', { link, csrf, decision: 'link' }, proxied('mia-sso'));
  assert.equal(ok.status, 200);
  assert.equal((await json(app, 'GET', '/api/me', { token: tokens.member })).body.user.ssoSubject, 'mia-sso');
  // links work once
  assert.equal((await form(app, '/auth/sso/connect', { link, csrf, decision: 'link' }, proxied('mia-sso'))).status, 400);

  const un = await json(app, 'DELETE', '/api/me/sso', { token: tokens.member });
  assert.equal(un.body.user.ssoSubject, null);
});

test('an SSO-only account cannot unlink itself into a lockout', async () => {
  const { app, tokens } = await seeded({ enabled: true, trustedProxies: ['127.0.0.1'], proxySecret: SECRET });
  await json(app, 'POST', '/api/admin/users', { token: tokens.admin, body: { username: 'sam', role: 'member', ssoSubject: 'sam' } });
  const sam = await pairViaSso(app, proxied('sam'));
  assert.equal((await json(app, 'DELETE', '/api/me/sso', { token: sam.token.body.token })).status, 400);
});
