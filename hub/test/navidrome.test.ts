import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, test } from 'node:test';
import { json, seeded } from './helpers.ts';

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

/** A fake Navidrome: its own sign-in and user API. */
async function fakeNavidrome() {
  const users = new Map<string, string>([['admin', 'nd-admin-pw']]);
  const created: { userName: string; name: string; password: string; isAdmin: boolean }[] = [];
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
        return users.get(b.username) === b.password ? send(200, { token: 'jwt-1', isAdmin: b.username === 'admin', username: b.username }) : send(401, { error: 'bad' });
      }
      if (req.url === '/api/user' && req.method === 'POST') {
        if (req.headers['x-nd-authorization'] !== 'Bearer jwt-1') return send(401, {});
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

test('the Hub makes each person their own Navidrome account and hands only that to their devices', async () => {
  const nd = await fakeNavidrome();
  const { app, tokens, ids } = await seeded();
  const s = await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'navidrome', name: 'Navidrome', url: nd.url, secrets: { adminUsername: 'admin', adminPassword: 'nd-admin-pw' } } });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const id = s.body.service.id;

  // nobody gets Navidrome until they have their own login; the admin login never leaves
  assert.deepEqual((await json(app, 'GET', '/api/me/services', { token: tokens.member })).body.services, []);

  const make = (userId: number, token = tokens.admin) => json(app, 'POST', `/api/admin/services/${id}/users/${userId}/navidrome-account`, { token });
  assert.equal((await make(ids.member, tokens.member)).status, 403);
  const r = await make(ids.member);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(nd.created[0].userName, 'mia');
  assert.equal(nd.created[0].isAdmin, false);
  assert.ok(nd.created[0].password.length >= 20);

  const mine = (await json(app, 'GET', '/api/me/services', { token: tokens.member })).body.services;
  assert.equal(mine.length, 1);
  assert.deepEqual(mine[0].secrets, { username: 'mia', password: nd.created[0].password });
  assert.equal(mine[0].ownLogin, true);
  assert.deepEqual((await json(app, 'GET', '/api/me/services', { token: tokens.kid })).body.services, [], 'the kid has no account yet');

  assert.equal((await make(ids.member)).status, 409, 'an existing Navidrome user is not overwritten');

  // the same admin login starts library scans
  const lib = await json(app, 'GET', '/api/admin/library', { token: tokens.admin });
  assert.deepEqual(lib.body.navidrome, { url: nd.url, username: 'admin' });

  const log = JSON.stringify((await json(app, 'GET', '/api/admin/audit', { token: tokens.admin })).body);
  assert.ok(log.includes('navidrome.account_created'));
  assert.ok(!log.includes(nd.created[0].password) && !log.includes('nd-admin-pw'));
});

test('admins see who is listening now', async () => {
  const { app, tokens } = await seeded();
  await json(app, 'POST', '/api/me/playing', { token: tokens.member, body: { title: 'One More Time', artist: 'Daft Punk', album: 'Discovery', source: 'navidrome' } });
  await json(app, 'POST', '/api/me/playing', { token: tokens.kid, body: { title: 'Baby Shark', artist: 'Pinkfong' } });
  const l = await json(app, 'GET', '/api/admin/listening', { token: tokens.admin });
  assert.deepEqual(l.body.listening.map((x: { title: string; deviceName: string }) => [x.title, x.deviceName]), [['Baby Shark', 'Phone'], ['One More Time', 'Phone']], 'sorted by name: kit, then mia');
  assert.equal((await json(app, 'GET', '/api/admin/listening', { token: tokens.member })).status, 403);

  await json(app, 'POST', '/api/me/playing', { token: tokens.kid, body: { stopped: true } });
  assert.equal((await json(app, 'GET', '/api/admin/listening', { token: tokens.admin })).body.listening.length, 1);
});
