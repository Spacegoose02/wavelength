import assert from 'node:assert/strict';
import { test } from 'node:test';
import { form, json, makeHub, seeded } from './helpers.ts';

const SECRET = 'proxy-secret-value-long-enough';
const proxied = (user: string) => ({ 'remote-user': user, 'x-wavelength-proxy-secret': SECRET });

/** A family "Smiths" with mia (member, PIN 1234) and kit (kid); boss (admin) is in it too, without a PIN. */
async function family(sso: Parameters<typeof seeded>[0] = {}) {
  const hub = await seeded(sso);
  const { app, tokens, ids } = hub;
  const f = await json(app, 'POST', '/api/admin/families', { token: tokens.admin, body: { name: 'Smiths' } });
  const familyId = f.body.family.id as number;
  for (const id of [ids.admin, ids.member, ids.kid]) await json(app, 'PUT', `/api/admin/users/${id}/family`, { token: tokens.admin, body: { familyId } });
  await json(app, 'PUT', '/api/me/switch-pin', { token: tokens.member, body: { pin: '1234' } });
  return { ...hub, familyId };
}

test('admins change single sign-on in the app; environment variables lock their fields', async () => {
  const { app, tokens } = await seeded();
  assert.equal((await json(app, 'GET', '/api/health')).body.sso, false);
  // can't turn it on without a secret or trusted proxies
  assert.equal((await json(app, 'PUT', '/api/admin/sso', { token: tokens.admin, body: { sso: { enabled: true } } })).status, 400);
  const secret = (await json(app, 'POST', '/api/admin/sso/secret', { token: tokens.admin })).body.secret as string;
  assert.equal(secret.length, 64);
  const on = await json(app, 'PUT', '/api/admin/sso', { token: tokens.admin, body: { sso: { enabled: true, proxySecret: SECRET, admins: 'Alex, sam', name: 'Family login' } } });
  assert.equal(on.status, 200);
  assert.deepEqual(on.body.sso.admins, ['alex', 'sam']);
  const health = (await json(app, 'GET', '/api/health')).body;
  assert.equal(health.sso, true);
  assert.equal(health.ssoName, 'Family login');
  // members can't read or change it
  assert.equal((await json(app, 'GET', '/api/admin/sso', { token: tokens.member })).status, 403);
  assert.equal((await json(app, 'PUT', '/api/admin/sso', { token: tokens.member, body: { sso: { enabled: false } } })).status, 403);

  const env = makeHub({ enabled: true, proxySecret: SECRET }, { ssoEnv: ['enabled', 'proxySecret'] });
  const setup = await json(env.app, 'POST', '/auth/setup', { body: { username: 'boss', password: 'correct horse battery', deviceName: 'PC' } });
  const got = await json(env.app, 'GET', '/api/admin/sso', { token: setup.body.token });
  assert.deepEqual(got.body.sso.locked, ['enabled', 'proxySecret']);
  assert.equal((await json(env.app, 'PUT', '/api/admin/sso', { token: setup.body.token, body: { sso: { enabled: false } } })).status, 409);
  assert.equal((await json(env.app, 'PUT', '/api/admin/sso', { token: setup.body.token, body: { sso: { autoCreate: true } } })).status, 200);
});

test('settings saved in the app are what identity checks use', async () => {
  const { app, tokens } = await seeded();
  await json(app, 'POST', '/api/admin/users', { token: tokens.admin, body: { username: 'sam', role: 'member', ssoSubject: 'sam' } });
  const off = await app.inject({ method: 'GET', url: '/auth/sso/link?code=XXXX-XXXX', headers: proxied('sam') });
  assert.equal(off.statusCode, 401);
  await json(app, 'PUT', '/api/admin/sso', { token: tokens.admin, body: { sso: { enabled: true, proxySecret: SECRET } } });
  const on = await app.inject({ method: 'GET', url: '/auth/sso/link?code=XXXX-XXXX', headers: proxied('sam') });
  assert.equal(on.statusCode, 400); // identified; the code is just wrong
});

test('a family password sign-in picks a profile; PINs and admins are guarded', async () => {
  const { app, tokens, ids, familyId } = await family();
  const made = await json(app, 'POST', '/api/admin/family-logins', { token: tokens.admin, body: { familyId, username: 'smiths', password: 'smiths-password-1' } });
  assert.equal(made.status, 200);
  // the name is taken for profiles now, and a profile's name can't be used for a family sign-in
  assert.equal((await json(app, 'POST', '/api/admin/users', { token: tokens.admin, body: { username: 'smiths', role: 'member', password: 'whatever-123' } })).status, 409);
  assert.equal((await json(app, 'POST', '/api/admin/family-logins', { token: tokens.admin, body: { familyId, username: 'mia', password: 'whatever-123' } })).status, 409);

  assert.equal((await json(app, 'POST', '/auth/login', { body: { username: 'smiths', password: 'wrong-password', deviceName: 'TV' } })).status, 401);
  const login = await json(app, 'POST', '/auth/login', { body: { username: 'smiths', password: 'smiths-password-1', deviceName: 'TV' } });
  assert.equal(login.status, 200);
  const { familyToken, profiles, family: fam } = login.body.pick;
  assert.equal(fam.name, 'Smiths');
  // boss is an admin without a PIN, so not offered
  assert.deepEqual(profiles.map((p: { id: number }) => p.id).sort(), [ids.member, ids.kid].sort());
  assert.equal(profiles.find((p: { id: number }) => p.id === ids.member).needsPin, true);

  assert.equal((await json(app, 'POST', '/auth/pick', { body: { familyToken, userId: ids.admin, deviceName: 'TV' } })).status, 403);
  assert.equal((await json(app, 'POST', '/auth/pick', { body: { familyToken, userId: ids.member, deviceName: 'TV' } })).status, 401);
  assert.equal((await json(app, 'POST', '/auth/pick', { body: { familyToken, userId: ids.member, pin: '9999', deviceName: 'TV' } })).status, 401);
  const mia = await json(app, 'POST', '/auth/pick', { body: { familyToken, userId: ids.member, pin: '1234', deviceName: 'TV' } });
  assert.equal(mia.status, 200);
  assert.equal(mia.body.user.username, 'mia');
  assert.equal((await json(app, 'GET', '/api/me', { token: mia.body.token })).status, 200);
  const kit = await json(app, 'POST', '/auth/pick', { body: { familyToken, userId: ids.kid, deviceName: 'TV' } });
  assert.equal(kit.body.user.role, 'kid');

  // the picker comes back later with the family token; a new password ends it
  assert.equal((await json(app, 'POST', '/auth/family', { body: { familyToken } })).status, 200);
  assert.equal((await json(app, 'POST', '/auth/family', { body: { familyToken: familyToken.replace(/.$/, 'x') } })).status, 401);
  await json(app, 'PATCH', `/api/admin/family-logins/${made.body.login.id}`, { token: tokens.admin, body: { password: 'another-password-2' } });
  assert.equal((await json(app, 'POST', '/auth/family', { body: { familyToken } })).status, 401);

  // an admin with a PIN can be picked, with it
  await json(app, 'PUT', '/api/me/switch-pin', { token: tokens.admin, body: { pin: '4321' } });
  const again = await json(app, 'POST', '/auth/login', { body: { username: 'smiths', password: 'another-password-2', deviceName: 'TV' } });
  assert.ok(again.body.pick.profiles.some((p: { id: number }) => p.id === ids.admin));
  assert.equal((await json(app, 'POST', '/auth/pick', { body: { familyToken: again.body.pick.familyToken, userId: ids.admin, pin: '4321' } })).status, 200);
});

test('a family tinyauth sign-in pairs a device into the picker, and signs the web page in', async () => {
  const { app, tokens, ids, familyId } = await family({ enabled: true, proxySecret: SECRET });
  await json(app, 'POST', '/api/admin/family-logins', { token: tokens.admin, body: { familyId, ssoSubject: 'Smiths' } });
  // that tinyauth name can't also be one profile's
  assert.equal((await json(app, 'PATCH', `/api/admin/users/${ids.member}`, { token: tokens.admin, body: { ssoSubject: 'smiths' } })).status, 409);

  const start = await json(app, 'POST', '/auth/device', { body: { deviceName: 'TV' } });
  const confirm = await app.inject({ method: 'GET', url: `/auth/sso/link?code=${start.body.userCode}`, headers: proxied('smiths') });
  assert.match(confirm.body, /for <b>the Smiths family<\/b>/);
  const csrf = /name="csrf" value="([^"]+)"/.exec(confirm.body)?.[1] ?? '';
  const approve = await form(app, '/auth/sso/link', { code: start.body.userCode, csrf, decision: 'approve' }, proxied('smiths'));
  assert.equal(approve.status, 200);
  const polled = await json(app, 'POST', '/auth/device/token', { body: { deviceCode: start.body.deviceCode } });
  assert.equal(polled.status, 200);
  assert.ok(polled.body.pick.familyToken);

  // the web page: needs the header a cross-site form can't send
  assert.equal((await json(app, 'POST', '/auth/sso/session', { body: {}, headers: proxied('smiths') })).status, 400);
  const web = await json(app, 'POST', '/auth/sso/session', { body: { deviceName: 'Browser' }, headers: { ...proxied('smiths'), 'x-wavelength-web': '1' } });
  assert.equal(web.status, 200);
  assert.ok(web.body.pick);
});

test('the web page signs a profile in from tinyauth by itself, and says when nobody is linked', async () => {
  const { app, tokens } = await seeded({ enabled: true, proxySecret: SECRET });
  await json(app, 'POST', '/api/admin/users', { token: tokens.admin, body: { username: 'sam', role: 'member', ssoSubject: 'sam' } });
  const web = { 'x-wavelength-web': '1' };
  const sam = await json(app, 'POST', '/auth/sso/session', { body: { deviceName: 'Browser' }, headers: { ...proxied('sam'), ...web } });
  assert.equal(sam.status, 200);
  assert.equal(sam.body.user.username, 'sam');
  const stranger = await json(app, 'POST', '/auth/sso/session', { body: {}, headers: { ...proxied('nobody'), ...web } });
  assert.equal(stranger.status, 403);
  assert.equal(stranger.body.notLinked, 'nobody');
  // no identity (proxy not set up): 401, so the page shows the sign-in choices
  assert.equal((await json(app, 'POST', '/auth/sso/session', { body: {}, headers: web })).status, 401);
  // a plain visit through tinyauth goes on to the app
  const visit = await app.inject({ method: 'GET', url: '/auth/sso/web', headers: proxied('sam') });
  assert.equal(visit.statusCode, 302);
  assert.equal(visit.headers.location, '/?sso=1');
});

test('admins merge a duplicate profile: sign-ins, devices and data move to the kept one', async () => {
  const { app, tokens, ids } = await seeded({ enabled: true, proxySecret: SECRET, autoCreate: true });
  // tinyauth made a second profile for mia
  const dup = await json(app, 'POST', '/auth/sso/session', { body: { deviceName: 'Browser' }, headers: { ...proxied('mia.sso'), 'x-wavelength-web': '1' } });
  assert.equal(dup.status, 200);
  const dupId = dup.body.user.id as number;
  assert.equal((await json(app, 'PUT', '/api/me/prefs', { token: dup.body.token, body: { changes: { theme: { value: 'neon', updatedAt: 1 } } } })).status, 200);

  assert.equal((await json(app, 'POST', `/api/admin/users/${dupId}/merge`, { token: tokens.member, body: { into: ids.member } })).status, 403);
  assert.equal((await json(app, 'POST', `/api/admin/users/${ids.admin}/merge`, { token: tokens.admin, body: { into: ids.member } })).status, 400);
  const merged = await json(app, 'POST', `/api/admin/users/${dupId}/merge`, { token: tokens.admin, body: { into: ids.member } });
  assert.equal(merged.status, 200);
  assert.equal(merged.body.user.username, 'mia');
  assert.equal(merged.body.user.ssoSubject, 'mia.sso');
  // the duplicate's device is mia's now
  const me = await json(app, 'GET', '/api/me', { token: dup.body.token });
  assert.equal(me.body.user.username, 'mia');
  // and so is what it saved
  assert.equal((await json(app, 'GET', '/api/me/prefs', { token: tokens.member })).body.prefs.theme.value, 'neon');
  // tinyauth signs in as mia from now on, and the password still works
  const again = await json(app, 'POST', '/auth/sso/session', { body: {}, headers: { ...proxied('mia.sso'), 'x-wavelength-web': '1' } });
  assert.equal(again.body.user.id, ids.member);
  assert.equal((await json(app, 'POST', '/auth/login', { body: { username: 'mia', password: 'mia-password-123' } })).status, 200);
  const users = (await json(app, 'GET', '/api/admin/users', { token: tokens.admin })).body.users as { id: number }[];
  assert.ok(!users.some((u) => u.id === dupId));
});

test('a named SSO admin with an admin profile of the same name signs into it, not a new one', async () => {
  const { app, ids } = await seeded({ enabled: true, proxySecret: SECRET, admins: ['boss'] });
  const r = await json(app, 'POST', '/auth/sso/session', { body: {}, headers: { ...proxied('boss'), 'x-wavelength-web': '1' } });
  assert.equal(r.body.user.id, ids.admin);
  assert.equal(r.body.user.ssoSubject, 'boss');
  // but never a member's profile, even when named as an admin
  const { app: app2, ids: ids2 } = await seeded({ enabled: true, proxySecret: SECRET, admins: ['mia'] });
  const m = await json(app2, 'POST', '/auth/sso/session', { body: {}, headers: { ...proxied('mia'), 'x-wavelength-web': '1' } });
  assert.notEqual(m.body.user.id, ids2.member);
});
