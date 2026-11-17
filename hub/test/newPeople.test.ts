import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, test } from 'node:test';
import { form, json, seeded } from './helpers.ts';

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

/** A fake Navidrome: its own sign-in and user API. */
async function fakeNavidrome(existing: string[] = []) {
  const users = new Map<string, string>([['admin', 'nd-admin-pw'], ...existing.map((u) => [u, 'x'] as [string, string])]);
  const created: { userName: string; name: string; password: string }[] = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const send = (status: number, v: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(v));
      };
      if (req.url === '/auth/login') {
        const b = JSON.parse(body);
        return users.get(b.username) === b.password ? send(200, { token: 'jwt-1', isAdmin: b.username === 'admin' }) : send(401, {});
      }
      if (req.url === '/api/user' && req.method === 'POST') {
        const b = JSON.parse(body);
        if (users.has(b.userName)) return send(500, { error: 'UNIQUE constraint failed: user.user_name' });
        users.set(b.userName, b.password);
        created.push(b);
        return send(200, { id: 'x' });
      }
      send(404, {});
    });
  });
  servers.push(srv);
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, created };
}

const kinds = async (app: Parameters<typeof json>[0], token: string) =>
  ((await json(app, 'GET', '/api/me/services', { token })).body.services as { kind: string; secrets: Record<string, string> }[]);

test('each person has a switch for each server; off keeps their own login, admins are always on', async () => {
  const { app, tokens, ids } = await seeded();
  const abs = (await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'audiobookshelf', name: 'Books', url: 'http://abs.local', secrets: { token: 'shared' } } })).body.service;
  const plex = (await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'plex', name: 'Plex', url: 'http://plex.local', access: 'admins', secrets: { token: 'p' } } })).body.service;
  const sw = (id: number, userId: number, on: boolean, token = tokens.admin) => json(app, 'PUT', `/api/admin/services/${id}/users/${userId}/access`, { token, body: { on } });

  assert.deepEqual((await kinds(app, tokens.member)).map((s) => s.kind), ['audiobookshelf'], 'for everyone by default');

  // their own key survives being switched off and on
  await json(app, 'PUT', `/api/admin/services/${abs.id}/users/${ids.member}`, { token: tokens.admin, body: { secrets: { token: 'mias-own' } } });
  assert.equal((await sw(abs.id, ids.member, false, tokens.member)).status, 403, 'only admins');
  const off = await sw(abs.id, ids.member, false);
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(off.body.services.find((s: { id: number }) => s.id === abs.id).on, false);
  assert.equal(off.body.service.access, 'everyone', 'the server stays for everyone else');
  assert.deepEqual(await kinds(app, tokens.member), []);
  assert.deepEqual((await kinds(app, tokens.kid)).map((s) => s.kind), ['audiobookshelf']);
  await sw(abs.id, ids.member, true);
  assert.equal((await kinds(app, tokens.member))[0].secrets.token, 'mias-own');

  // on for an admins-only server makes it People I choose with just them
  const on = await sw(plex.id, ids.member, true);
  assert.equal(on.body.service.access, 'chosen');
  assert.deepEqual((await kinds(app, tokens.member)).map((s) => s.kind).sort(), ['audiobookshelf', 'plex']);
  assert.deepEqual((await kinds(app, tokens.kid)).map((s) => s.kind), ['audiobookshelf']);

  const admin = await sw(abs.id, ids.admin, false);
  assert.equal(admin.status, 400);
  assert.match(admin.body.error, /Admins can always use every server/);

  const list = await json(app, 'GET', `/api/admin/users/${ids.kid}/services`, { token: tokens.admin });
  assert.deepEqual(list.body.services.map((s: { name: string; on: boolean }) => [s.name, s.on]), [['Books', true], ['Plex', false]]);

  const log = JSON.stringify((await json(app, 'GET', '/api/admin/audit', { token: tokens.admin })).body);
  assert.ok(log.includes('service.user_off') && log.includes('service.user_on'));
});

test('someone new gets their own Navidrome account and the servers picked for new people', async () => {
  const nd = await fakeNavidrome();
  const { app, tokens } = await seeded();
  const navi = (await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'navidrome', name: 'Navidrome', url: nd.url, secrets: { adminUsername: 'admin', adminPassword: 'nd-admin-pw' } } })).body.service;
  const abs = (await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'audiobookshelf', name: 'Books', url: 'http://abs.local', secrets: { token: 't' } } })).body.service;
  const sub = (await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'subwave', name: 'SUB/WAVE', url: 'http://sw.local', access: 'chosen' } })).body.service;

  assert.deepEqual((await json(app, 'GET', '/api/admin/new-people', { token: tokens.admin })).body.newPeople, { navidromeAccount: true, services: {} });
  assert.equal((await json(app, 'PUT', '/api/admin/new-people', { token: tokens.member, body: {} })).status, 403);
  const put = await json(app, 'PUT', '/api/admin/new-people', { token: tokens.admin, body: { services: { [abs.id]: false, [sub.id]: true } } });
  assert.deepEqual(put.body.newPeople.services, { [abs.id]: false, [sub.id]: true });
  assert.equal((await json(app, 'PUT', '/api/admin/new-people', { token: tokens.admin, body: { services: { 999: true } } })).status, 400);

  // an admin adds someone
  const zoe = await json(app, 'POST', '/api/admin/users', { token: tokens.admin, body: { username: 'zoe', role: 'member', password: 'zoe-password-123' } });
  assert.equal(zoe.status, 200, JSON.stringify(zoe.body));
  assert.equal(nd.created[0].userName, 'zoe');
  const login = await json(app, 'POST', '/auth/login', { body: { username: 'zoe', password: 'zoe-password-123' } });
  const mine = await kinds(app, login.body.token);
  assert.deepEqual(mine.map((s) => s.kind).sort(), ['navidrome', 'subwave']);
  assert.deepEqual(mine.find((s) => s.kind === 'navidrome')!.secrets, { username: 'zoe', password: nd.created[0].password });

  // an invite does the same
  const inv = await json(app, 'POST', '/api/admin/invites', { token: tokens.admin, body: { role: 'member' } });
  assert.equal((await form(app, `/invite/${inv.body.code}`, { username: 'nan', password: 'nan-password-123' })).status, 200);
  assert.deepEqual(nd.created.map((c) => c.userName), ['zoe', 'nan']);

  // Music off for new people: no Navidrome account either
  await json(app, 'PUT', '/api/admin/new-people', { token: tokens.admin, body: { services: { [navi.id]: false } } });
  await json(app, 'POST', '/api/admin/users', { token: tokens.admin, body: { username: 'pip', role: 'member', password: 'pip-password-123' } });
  assert.equal(nd.created.length, 2);
  await json(app, 'PUT', '/api/admin/new-people', { token: tokens.admin, body: { services: { [navi.id]: null } } });
  assert.equal((await json(app, 'GET', '/api/admin/new-people', { token: tokens.admin })).body.navidromeOff, false);

  // turned off: nobody new gets an account
  await json(app, 'PUT', '/api/admin/new-people', { token: tokens.admin, body: { navidromeAccount: false } });
  await json(app, 'POST', '/api/admin/users', { token: tokens.admin, body: { username: 'ola', role: 'member', password: 'ola-password-123' } });
  assert.equal(nd.created.length, 2);
  const ola = (await json(app, 'GET', '/api/admin/users', { token: tokens.admin })).body.users.find((u: { username: string }) => u.username === 'ola');
  const olas = (await json(app, 'GET', `/api/admin/users/${ola.id}/services`, { token: tokens.admin })).body.services;
  assert.equal(olas.find((s: { id: number }) => s.id === navi.id).needsAccount, true);
});

test('a Navidrome that already has that name is logged, and the profile is still made', async () => {
  const nd = await fakeNavidrome(['zoe']);
  const { app, tokens } = await seeded();
  await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'navidrome', name: 'Navidrome', url: nd.url, secrets: { adminUsername: 'admin', adminPassword: 'nd-admin-pw' } } });
  const zoe = await json(app, 'POST', '/api/admin/users', { token: tokens.admin, body: { username: 'zoe', role: 'member', password: 'zoe-password-123' } });
  assert.equal(zoe.status, 200);
  assert.equal(nd.created.length, 0);
  const log = JSON.stringify((await json(app, 'GET', '/api/admin/audit', { token: tokens.admin })).body);
  assert.match(log, /navidrome\.account_failed/);
  assert.match(log, /already has a user called zoe/);
});
