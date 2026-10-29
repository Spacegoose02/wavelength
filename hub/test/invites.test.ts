import assert from 'node:assert/strict';
import { test } from 'node:test';
import { form, json, seeded } from './helpers.ts';

test('an invite link makes one account with the role the admin picked', async () => {
  const { app, db, tokens } = await seeded();
  const made = await json(app, 'POST', '/api/admin/invites', { token: tokens.admin, body: { role: 'member', displayName: 'Nan', autodownload: true, days: 3 } });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.match(made.body.url, /^https:\/\/hub\.test\/invite\/[\w-]{20,}$/);
  const code = made.body.code as string;
  // only a hash is kept
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM invites').all()).includes(code));

  const page = await app.inject({ method: 'GET', url: `/invite/${code}` });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /invited to this Wavelength Hub as a member/);
  assert.match(page.body, /value="Nan"/);

  const taken = await form(app, `/invite/${code}`, { username: 'mia', password: 'nan-password-123' });
  assert.equal(taken.status, 409);
  assert.match(taken.body, /username is taken/);

  const ok = await form(app, `/invite/${code}`, { username: 'Nan', displayName: 'Nana', password: 'nan-password-123' });
  assert.equal(ok.status, 200, ok.body);
  assert.match(ok.body, /Your account nan is ready/);
  const login = await json(app, 'POST', '/auth/login', { body: { username: 'nan', password: 'nan-password-123' } });
  assert.equal(login.body.user.role, 'member');
  assert.equal(login.body.user.displayName, 'Nana');
  assert.ok(login.body.permissions.includes('downloads.run'));

  // used up
  assert.equal((await app.inject({ method: 'GET', url: `/invite/${code}` })).statusCode, 410);
  assert.equal((await form(app, `/invite/${code}`, { username: 'nan2', password: 'nan-password-123' })).status, 410);

  const list = await json(app, 'GET', '/api/admin/invites', { token: tokens.admin });
  assert.equal(list.body.invites[0].usedBy, 'nan');
  assert.equal(list.body.invites[0].createdBy, 'boss');
});

test('the app can accept an invite and get signed in; expired and cancelled links stop working', async () => {
  const { app, db, tokens } = await seeded();
  const kid = await json(app, 'POST', '/api/admin/invites', { token: tokens.admin, body: { role: 'kid', autodownload: true } });
  const r = await json(app, 'POST', '/auth/invite', { body: { code: kid.body.url, username: 'kip', password: 'kip-password-123', deviceName: 'Tablet' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.user.role, 'kid');
  assert.equal(r.body.user.autodownload, false, 'kids never get Autodownload');
  assert.equal((await json(app, 'GET', '/api/me', { token: r.body.token })).status, 200);

  const old = await json(app, 'POST', '/api/admin/invites', { token: tokens.admin, body: { role: 'admin' } });
  db.prepare('UPDATE invites SET expires_at = ? WHERE id = ?').run(Date.now() - 1, old.body.id);
  assert.equal((await json(app, 'POST', '/auth/invite', { body: { code: old.body.code, username: 'eve', password: 'eve-password-123' } })).status, 410);

  const gone = await json(app, 'POST', '/api/admin/invites', { token: tokens.admin, body: { role: 'member' } });
  assert.equal((await json(app, 'DELETE', `/api/admin/invites/${gone.body.id}`, { token: tokens.admin })).status, 200);
  assert.equal((await json(app, 'POST', '/auth/invite', { body: { code: gone.body.code, username: 'eve', password: 'eve-password-123' } })).status, 410);

  assert.equal((await json(app, 'POST', '/api/admin/invites', { token: tokens.admin, body: { role: 'boss' } })).status, 400);
  assert.equal((await json(app, 'POST', '/api/admin/invites', { token: tokens.member, body: { role: 'member' } })).status, 403);
});
