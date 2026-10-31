import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkTotp, fromBase32, base32, totpAt } from '../src/totp.ts';
import { ADMIN_PW, json, seeded } from './helpers.ts';

const code = (secret: string, at = Date.now()) => totpAt(fromBase32(secret), Math.floor(at / 30_000));

test('TOTP matches RFC 6238 and allows one step of clock drift', () => {
  // RFC 6238 appendix B, SHA-1, 8 digits there; the last 6 digits are what a 6-digit app shows
  const secret = Buffer.from('12345678901234567890');
  assert.equal(totpAt(secret, Math.floor(59 / 30)), '287082');
  assert.equal(totpAt(secret, Math.floor(1111111109 / 30)), '081804');
  assert.equal(base32(fromBase32('JBSWY3DPEHPK3PXP')), 'JBSWY3DPEHPK3PXP');
  const now = 1_700_000_000_000;
  assert.notEqual(checkTotp(secret, totpAt(secret, Math.floor(now / 30_000) - 1), now), null);
  assert.equal(checkTotp(secret, totpAt(secret, Math.floor(now / 30_000) - 3), now), null);
  assert.equal(checkTotp(secret, 'abcdef', now), null);
});

test('two-step sign-in: set up, then password sign-ins need a code or a recovery code', async () => {
  const { app, tokens, ids } = await seeded();
  const login = (body: Record<string, string>) => json(app, 'POST', '/auth/login', { body: { username: 'boss', password: ADMIN_PW, deviceName: 'PC', ...body } });

  assert.equal((await json(app, 'POST', '/api/me/2fa/setup', { token: tokens.admin, body: { password: 'wrong' } })).status, 401);
  const setup = await json(app, 'POST', '/api/me/2fa/setup', { token: tokens.admin, body: { password: ADMIN_PW } });
  assert.equal(setup.status, 200);
  assert.match(setup.body.uri, /^otpauth:\/\/totp\/Wavelength%3Aboss\?secret=[A-Z2-7]+&issuer=Wavelength/);
  assert.equal((await login({})).status, 200, 'not in force until a first code is entered');

  assert.equal((await json(app, 'POST', '/api/me/2fa/enable', { token: tokens.admin, body: { code: '000000' } })).status, 400);
  // a step back, so the sign-in below gets a newer code than this one
  const on = await json(app, 'POST', '/api/me/2fa/enable', { token: tokens.admin, body: { code: code(setup.body.secret, Date.now() - 30_000) } });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.equal(on.body.recoveryCodes.length, 10);
  assert.equal((await json(app, 'GET', '/api/me', { token: tokens.admin })).body.twoFactor, true);

  const without = await login({});
  assert.equal(without.status, 401);
  assert.equal(without.body.twoFactor, true);
  assert.equal((await login({ otp: '123456' })).status, 401);
  const now = code(setup.body.secret);
  assert.equal((await login({ otp: now })).status, 200);
  assert.equal((await login({ otp: now })).status, 401, 'a code works once');
  const rc = on.body.recoveryCodes[0];
  assert.equal((await login({ otp: rc.toLowerCase() })).status, 200, 'recovery codes, any case');
  assert.equal((await login({ otp: rc })).status, 401, 'and once each');
  assert.equal((await json(app, 'GET', '/api/me/2fa', { token: tokens.admin })).body.recoveryLeft, 9);

  // the browser sign-in page takes it as `otp` (its `code` is the pairing code)
  const pair = await json(app, 'POST', '/auth/device', { body: { deviceName: 'TV', platform: 'android-tv' } });
  const page = await app.inject({ method: 'POST', url: '/link', payload: `code=${pair.body.userCode}&username=boss&password=${encodeURIComponent(ADMIN_PW)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(page.statusCode, 401);
  assert.match(page.body, /6-digit code/);

  // an admin can turn it off for someone who lost their phone
  const users = (await json(app, 'GET', '/api/admin/users', { token: tokens.admin })).body.users;
  assert.equal(users.find((u: { id: number }) => u.id === ids.admin).twoFactor, true);
  assert.equal((await json(app, 'DELETE', `/api/admin/users/${ids.admin}/2fa`, { token: tokens.member })).status, 403);
  assert.equal((await json(app, 'DELETE', `/api/admin/users/${ids.admin}/2fa`, { token: tokens.admin })).status, 200);
  assert.equal((await login({})).status, 200);
});
