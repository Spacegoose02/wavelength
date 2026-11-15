import assert from 'node:assert/strict';
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import type { Fetch } from '../src/dj/voice.ts';
import { safeNext } from '../src/oidc.ts';
import { form, json, makeHub, seeded } from './helpers.ts';

// Placeholders only: never a real client's ID or secret.
const ISSUER = 'https://auth.example.test';
const CLIENT_ID = 'example-client-id';
const CLIENT_SECRET = 'example-client-secret-placeholder';
const OIDC = { oidc: true, oidcIssuer: ISSUER, oidcClientId: CLIENT_ID, oidcClientSecret: CLIENT_SECRET };

interface Person {
  preferred_username?: string;
  name?: string;
  email?: string;
  groups?: string[];
}

/** A tiny OIDC provider behind the Hub's fetch: discovery, JWKS, token and userinfo, RS256-signed ID tokens. */
function fakeProvider(o: { tamper?: 'signature' | 'nonce' | 'audience'; groupsInUserinfoOnly?: boolean } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };
  const codes = new Map<string, { person: Person; nonce: string; challenge: string; redirectUri: string }>();
  const tokens = new Map<string, Person>();
  const b64 = (x: unknown) => Buffer.from(JSON.stringify(x)).toString('base64url');
  const sign = (claims: Record<string, unknown>) => {
    const data = `${b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })}.${b64(claims)}`;
    const sig = createSign('sha256').update(data).sign(privateKey).toString('base64url');
    return `${data}.${o.tamper === 'signature' ? sig.slice(0, -4) + 'AAAA' : sig}`;
  };
  const tokenCalls: { auth: string | null; body: URLSearchParams }[] = [];
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fetchFn: Fetch = async (url, init) => {
    const u = new URL(url);
    if (u.origin !== ISSUER) throw new Error(`unexpected fetch ${url}`);
    if (u.pathname === '/.well-known/openid-configuration') {
      return reply({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/api/oidc/token`,
        userinfo_endpoint: `${ISSUER}/api/oidc/userinfo`,
        jwks_uri: `${ISSUER}/.well-known/jwks.json`,
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        scopes_supported: ['openid', 'profile', 'email', 'groups'],
      });
    }
    if (u.pathname === '/.well-known/jwks.json') return reply({ keys: [jwk] });
    if (u.pathname === '/api/oidc/token') {
      const body = new URLSearchParams(String(init?.body));
      const auth = ((init?.headers ?? {}) as Record<string, string>).authorization ?? null;
      tokenCalls.push({ auth, body });
      if (auth !== `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`) return reply({ error: 'invalid_client' }, 401);
      const c = codes.get(body.get('code') ?? '');
      if (!c || c.redirectUri !== body.get('redirect_uri')) return reply({ error: 'invalid_grant' }, 400);
      if (createHash('sha256').update(body.get('code_verifier') ?? '').digest('base64url') !== c.challenge) return reply({ error: 'invalid_grant' }, 400);
      codes.delete(body.get('code')!);
      const now = Math.floor(Date.now() / 1000);
      const { groups, ...rest } = c.person;
      const access = randomBytes(16).toString('hex');
      tokens.set(access, c.person);
      return reply({
        access_token: access,
        token_type: 'Bearer',
        id_token: sign({
          iss: ISSUER,
          aud: o.tamper === 'audience' ? 'someone-else' : CLIENT_ID,
          sub: `sub-${c.person.preferred_username}`,
          iat: now,
          exp: now + 300,
          nonce: o.tamper === 'nonce' ? 'not-the-nonce' : c.nonce,
          ...rest,
          ...(!o.groupsInUserinfoOnly && groups && { groups }),
        }),
      });
    }
    if (u.pathname === '/api/oidc/userinfo') {
      const p = tokens.get((((init?.headers ?? {}) as Record<string, string>).authorization ?? '').replace(/^Bearer /, ''));
      return p ? reply({ sub: `sub-${p.preferred_username}`, ...p }) : reply({ error: 'invalid_token' }, 401);
    }
    return reply({ error: 'not found' }, 404);
  };

  /** The person signs in at the provider: the redirect back to the Hub. */
  const authorize = (authUrl: string, person: Person) => {
    const u = new URL(authUrl);
    assert.equal(u.origin + u.pathname, `${ISSUER}/authorize`);
    assert.equal(u.searchParams.get('client_id'), CLIENT_ID);
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(u.searchParams.get('scope')?.split(' ').includes('openid'));
    const code = randomBytes(12).toString('hex');
    codes.set(code, { person, nonce: u.searchParams.get('nonce')!, challenge: u.searchParams.get('code_challenge')!, redirectUri: u.searchParams.get('redirect_uri')! });
    return `/auth/oidc/callback?code=${code}&state=${encodeURIComponent(u.searchParams.get('state')!)}`;
  };
  return { fetchFn, authorize, tokenCalls };
}

type App = ReturnType<typeof makeHub>['app'];

const cookiesFrom = (res: { headers: Record<string, unknown> }) => {
  const raw = res.headers['set-cookie'];
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String);
};
const jar = (list: string[]) => list.map((c) => c.split(';')[0]).filter((c) => !c.endsWith('=')).join('; ');

/** Open a single sign-on page in a "browser": through the provider's login and back. Returns the cookie it ends with. */
async function browse(app: App, provider: ReturnType<typeof fakeProvider>, path: string, person: Person) {
  const first = await app.inject({ method: 'GET', url: path });
  assert.equal(first.statusCode, 302, `${path} should go to the OIDC sign-in`);
  assert.match(String(first.headers.location), /^\/auth\/oidc\/start\?next=/);
  const start = await app.inject({ method: 'GET', url: String(first.headers.location) });
  assert.equal(start.statusCode, 302);
  const stateCookie = jar(cookiesFrom(start));
  assert.match(stateCookie, /^wl_oidc_state=/);
  const back = await app.inject({ method: 'GET', url: provider.authorize(String(start.headers.location), person), headers: { cookie: stateCookie } });
  const cookie = jar(cookiesFrom(back));
  return { back, cookie };
}

async function pairViaOidc(app: App, provider: ReturnType<typeof fakeProvider>, person: Person) {
  const start = await json(app, 'POST', '/auth/device', { body: { deviceName: 'TV', platform: 'android-tv' } });
  const { back, cookie } = await browse(app, provider, `/auth/sso/link?code=${start.body.userCode}`, person);
  assert.equal(back.statusCode, 302, back.body);
  assert.equal(back.headers.location, `/auth/sso/link?code=${start.body.userCode}`);
  const confirm = await app.inject({ method: 'GET', url: String(back.headers.location), headers: { cookie } });
  const csrf = /name="csrf" value="([^"]+)"/.exec(confirm.body)?.[1] ?? '';
  const approve = await form(app, '/auth/sso/link', { code: start.body.userCode, csrf, decision: 'approve' }, { cookie });
  const token = await json(app, 'POST', '/auth/device/token', { body: { deviceCode: start.body.deviceCode } });
  return { confirm, approve, token, cookie };
}

test('a device signs in through OIDC with the existing pairing link', async () => {
  const provider = fakeProvider();
  const { app, tokens } = await seeded(OIDC, {}, { oidcFetch: provider.fetchFn });
  const health = (await json(app, 'GET', '/api/health')).body;
  assert.equal(health.sso, true);
  assert.equal(health.ssoOidc, true);
  assert.equal(health.ssoName, 'tinyauth');

  await json(app, 'POST', '/api/admin/users', { token: tokens.admin, body: { username: 'sam', role: 'member', ssoSubject: 'Sam' } });
  const sam = await pairViaOidc(app, provider, { preferred_username: 'Sam', name: 'Sam S' });
  assert.equal(sam.approve.status, 200);
  assert.equal(sam.token.status, 200);
  assert.equal(sam.token.body.user.username, 'sam');
  // the secret went to the token endpoint only, with the PKCE verifier
  assert.equal(provider.tokenCalls.length, 1);
  assert.ok(provider.tokenCalls[0].body.get('code_verifier'));
  assert.equal(provider.tokenCalls[0].body.get('client_secret'), null);
});

test('OIDC groups (from userinfo) make admins, and strangers are refused', async () => {
  const provider = fakeProvider({ groupsInUserinfoOnly: true });
  const { app, tokens } = await seeded({ ...OIDC, adminGroup: 'wl-admins' }, {}, { oidcFetch: provider.fetchFn });
  await json(app, 'POST', '/api/admin/users', { token: tokens.admin, body: { username: 'jo', role: 'member', ssoSubject: 'jo' } });
  const jo = await pairViaOidc(app, provider, { preferred_username: 'jo', groups: ['family', 'wl-admins'] });
  assert.equal(jo.token.body.user.role, 'admin');

  const stranger = await pairViaOidc(app, provider, { preferred_username: 'stranger' });
  assert.match(stranger.confirm.body, /isn't linked to a Wavelength account/);
  assert.notEqual(stranger.token.status, 200);
});

test('a family sign-in through OIDC ends at the profile picker', async () => {
  const provider = fakeProvider();
  const { app, tokens, ids } = await seeded(OIDC, {}, { oidcFetch: provider.fetchFn });
  const fam = await json(app, 'POST', '/api/admin/families', { token: tokens.admin, body: { name: 'Smith' } });
  assert.equal(fam.status, 200, JSON.stringify(fam.body));
  const familyId = fam.body.family.id as number;
  await json(app, 'PUT', `/api/admin/users/${ids.member}/family`, { token: tokens.admin, body: { familyId } });
  const l = await json(app, 'POST', '/api/admin/family-logins', { token: tokens.admin, body: { familyId, ssoSubject: 'smiths' } });
  assert.equal(l.status, 200, JSON.stringify(l.body));
  const r = await pairViaOidc(app, provider, { preferred_username: 'smiths' });
  assert.equal(r.token.status, 200);
  assert.ok(r.token.body.pick.familyToken);
  assert.ok(r.token.body.pick.profiles.some((p: { id: number }) => p.id === ids.member));
});

test('the web page signs in from an OIDC sign-in, once', async () => {
  const provider = fakeProvider();
  const { app, tokens } = await seeded(OIDC, {}, { oidcFetch: provider.fetchFn });
  await json(app, 'POST', '/api/admin/users', { token: tokens.admin, body: { username: 'sam', role: 'member', ssoSubject: 'sam' } });
  const none = await json(app, 'POST', '/auth/sso/session', { headers: { 'x-wavelength-web': '1' }, body: {} });
  assert.equal(none.status, 401);
  assert.equal(none.body.oidc, true);

  const { back, cookie } = await browse(app, provider, '/auth/sso/web', { preferred_username: 'sam' });
  assert.equal(back.headers.location, '/auth/sso/web');
  const web = await app.inject({ method: 'GET', url: '/auth/sso/web', headers: { cookie } });
  assert.equal(web.headers.location, '/?sso=1');
  const s = await app.inject({ method: 'POST', url: '/auth/sso/session', headers: { cookie, 'x-wavelength-web': '1', 'content-type': 'application/json' }, payload: { deviceName: 'Browser', platform: 'web' } });
  assert.equal(s.statusCode, 200);
  assert.equal(s.json().user.username, 'sam');
  assert.match(cookiesFrom(s).join(), /wl_sso=;.*Max-Age=0/);
  // without the cookie nothing else can use it, and a forged one is ignored
  const forged = await json(app, 'POST', '/auth/sso/session', { headers: { 'x-wavelength-web': '1', cookie: `wl_sso=${cookie.split('=')[1].replace(/.$/, 'x')}` }, body: {} });
  assert.equal(forged.status, 401);
});

test('OIDC refuses a bad signature, nonce or audience, and a callback from another browser', async () => {
  for (const tamper of ['signature', 'nonce', 'audience'] as const) {
    const provider = fakeProvider({ tamper });
    const { app, tokens } = await seeded(OIDC, {}, { oidcFetch: provider.fetchFn });
    await json(app, 'POST', '/api/admin/users', { token: tokens.admin, body: { username: 'sam', role: 'member', ssoSubject: 'sam' } });
    const { back, cookie } = await browse(app, provider, '/auth/sso/web', { preferred_username: 'sam' });
    assert.equal(back.statusCode, 502, tamper);
    assert.doesNotMatch(cookie, /wl_sso=/, tamper);
  }

  const provider = fakeProvider();
  const { app } = await seeded(OIDC, {}, { oidcFetch: provider.fetchFn });
  const start = await app.inject({ method: 'GET', url: '/auth/oidc/start?next=/auth/sso/web' });
  const callback = provider.authorize(String(start.headers.location), { preferred_username: 'sam' });
  const noCookie = await app.inject({ method: 'GET', url: callback });
  assert.equal(noCookie.statusCode, 400);
  // with its own browser's cookie it goes through, once
  const ok = await app.inject({ method: 'GET', url: callback, headers: { cookie: jar(cookiesFrom(start)) } });
  assert.equal(ok.statusCode, 302);
  const again = await app.inject({ method: 'GET', url: callback, headers: { cookie: jar(cookiesFrom(start)) } });
  assert.equal(again.statusCode, 400);
});

test('OIDC only returns to the Hub’s own pages', () => {
  assert.equal(safeNext('/auth/sso/link?code=ABCD-EFGH'), '/auth/sso/link?code=ABCD-EFGH');
  assert.equal(safeNext('/?sso=1'), '/?sso=1');
  for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', '/api/admin/users', 'auth/sso/web']) assert.equal(safeNext(bad), '/auth/sso/web', bad);
});

test('admins set up OIDC in the app; the client secret is sealed and never sent back', async () => {
  const provider = fakeProvider();
  const { app, db, tokens } = await seeded({}, {}, { oidcFetch: provider.fetchFn });
  const off = await json(app, 'GET', '/api/admin/sso', { token: tokens.admin });
  assert.equal(off.body.sso.oidc, false);
  assert.equal(off.body.sso.oidcRedirectUri, 'https://hub.test/auth/oidc/callback');
  assert.equal(off.body.sso.oidcScopes, 'openid profile email groups');

  // can't turn it on half set up
  const half = await json(app, 'PUT', '/api/admin/sso', { token: tokens.admin, body: { sso: { oidc: true, oidcIssuer: ISSUER, oidcClientId: CLIENT_ID } } });
  assert.equal(half.status, 400);
  assert.match(half.body.error, /client secret/);
  assert.equal((await json(app, 'PUT', '/api/admin/sso', { token: tokens.admin, body: { sso: { oidcIssuer: 'javascript:alert(1)' } } })).status, 400);
  assert.equal((await json(app, 'PUT', '/api/admin/sso', { token: tokens.admin, body: { sso: { oidcScopes: 'profile email' } } })).status, 400);

  const check = await json(app, 'POST', '/api/admin/sso/oidc/check', { token: tokens.admin, body: { issuer: `${ISSUER}/` } });
  assert.equal(check.status, 200);
  assert.equal(check.body.tokenEndpoint, `${ISSUER}/api/oidc/token`);

  const on = await json(app, 'PUT', '/api/admin/sso', { token: tokens.admin, body: { sso: { oidc: true, oidcIssuer: `${ISSUER}/`, oidcClientId: CLIENT_ID, oidcClientSecret: CLIENT_SECRET } } });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.equal(on.body.sso.oidc, true);
  assert.equal(on.body.sso.oidcIssuer, ISSUER);
  assert.equal(on.body.sso.oidcClientSecretSet, true);
  assert.equal(on.body.sso.oidcClientSecret, undefined);
  assert.doesNotMatch(JSON.stringify(on.body), new RegExp(CLIENT_SECRET));
  assert.doesNotMatch(JSON.stringify((await json(app, 'GET', '/api/admin/sso', { token: tokens.admin })).body), new RegExp(CLIENT_SECRET));
  const stored = (db.prepare("SELECT value FROM hub_settings WHERE key = 'sso'").get() as { value: string }).value;
  assert.doesNotMatch(stored, new RegExp(CLIENT_SECRET));
  const audits = JSON.stringify(db.prepare('SELECT * FROM audit').all());
  assert.doesNotMatch(audits, new RegExp(CLIENT_SECRET));

  // saving other things keeps the secret; the sign-in works with it
  assert.equal((await json(app, 'PUT', '/api/admin/sso', { token: tokens.admin, body: { sso: { name: 'Tinyauth' } } })).status, 200);
  assert.equal((await json(app, 'GET', '/api/health')).body.ssoName, 'Tinyauth');
  await json(app, 'POST', '/api/admin/users', { token: tokens.admin, body: { username: 'sam', role: 'member', ssoSubject: 'sam' } });
  assert.equal((await pairViaOidc(app, provider, { preferred_username: 'sam' })).token.body.user.username, 'sam');

  // forward-auth still works next to it
  const both = await json(app, 'PUT', '/api/admin/sso', { token: tokens.admin, body: { sso: { enabled: true, proxySecret: 'proxy-secret-value' } } });
  assert.equal(both.body.sso.enabled, true);
  assert.equal(both.body.sso.oidc, true);
  const headers = { 'remote-user': 'sam', 'x-wavelength-proxy-secret': 'proxy-secret-value' };
  assert.equal((await app.inject({ method: 'GET', url: '/auth/sso/link?code=XXXX-XXXX', headers })).statusCode, 400); // identified; the code is just wrong

  // the environment can fix the settings, and its secret is never shown either
  const env = makeHub(OIDC, { ssoEnv: ['oidc', 'oidcIssuer', 'oidcClientId', 'oidcClientSecret'] }, { oidcFetch: provider.fetchFn });
  const setup = await json(env.app, 'POST', '/auth/setup', { body: { username: 'boss', password: 'correct horse battery', deviceName: 'PC' } });
  const got = await json(env.app, 'GET', '/api/admin/sso', { token: setup.body.token });
  assert.deepEqual(got.body.sso.locked, ['oidc', 'oidcIssuer', 'oidcClientId', 'oidcClientSecret']);
  assert.equal(got.body.sso.oidcClientSecretSet, true);
  assert.doesNotMatch(JSON.stringify(got.body), new RegExp(CLIENT_SECRET));
  assert.equal((await json(env.app, 'PUT', '/api/admin/sso', { token: setup.body.token, body: { sso: { oidcClientSecret: 'x' } } })).status, 409);
});
