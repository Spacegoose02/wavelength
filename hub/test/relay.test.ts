import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { after, test } from 'node:test';
import { json, seeded } from './helpers.ts';

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));
const md5 = (s: string) => createHash('md5').update(s).digest('hex');

const SONGS: Record<string, { id: string; title: string; album: string; artist: string; explicitStatus?: string }> = {
  s1: { id: 's1', title: 'Baby Shark', album: 'Pinkfong Hits', artist: 'Pinkfong' },
  s2: { id: 's2', title: 'Rough Song', album: 'Loud', artist: 'Band', explicitStatus: 'explicit' },
  s3: { id: 's3', title: 'Flagged', album: 'Fine Album', artist: 'Someone' },
};

/** A fake Navidrome speaking Subsonic, with real logins checked by token. */
async function fakeSubsonic(logins: Record<string, string>) {
  const calls: { method: string; u: string; range?: string }[] = [];
  const srv = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://x');
    if (url.pathname === '/auth/login') {
      let body = '';
      for await (const d of req) body += d;
      const b = JSON.parse(body);
      res.writeHead(logins[b.username] === b.password ? 200 : 401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(logins[b.username] === b.password ? { token: `nd-${b.username}` } : {}));
    }
    if (url.pathname === '/api/song') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify([{ title: 'played by', who: req.headers['x-nd-authorization'], sort: url.searchParams.get('_sort') }]));
    }
    const q = Object.fromEntries(url.searchParams);
    const method = url.pathname.replace('/rest/', '');
    calls.push({ method, u: q.u, range: req.headers.range });
    const send = (v: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ 'subsonic-response': v }));
    };
    const pw = logins[q.u];
    if (!pw || md5(pw + q.s) !== q.t) return send({ status: 'failed', error: { code: 40, message: 'Wrong username or password' } });
    if (method === 'ping') return send({ status: 'ok' });
    if (method === 'getSong') return send({ status: 'ok', song: SONGS[q.id] });
    if (method === 'stream') {
      res.writeHead(206, { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-3/10', 'content-length': '4' });
      return res.end('ABCD');
    }
    send({ status: 'failed', error: { code: 0, message: 'unknown' } });
  });
  servers.push(srv);
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, calls };
}

test('kids reach Navidrome through the Hub, with their real login kept there', async () => {
  const nd = await fakeSubsonic({ kit: 'kit-real-pw', mia: 'mia-real-pw' });
  const { app, tokens, ids } = await seeded();
  const s = await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'navidrome', url: nd.url } });
  const id = s.body.service.id;
  for (const [userId, username, password] of [[ids.kid, 'kit', 'kit-real-pw'], [ids.member, 'mia', 'mia-real-pw']] as const) {
    await json(app, 'PUT', `/api/admin/services/${id}/users/${userId}`, { token: tokens.admin, body: { secrets: { username, password } } });
  }

  // the member gets their own login as before; the kid gets a relay login instead
  const mia = (await json(app, 'GET', '/api/me/services', { token: tokens.member })).body.services[0];
  assert.equal(mia.secrets.password, 'mia-real-pw');
  assert.ok(!mia.relay);
  const kit = (await json(app, 'GET', '/api/me/services', { token: tokens.kid })).body.services[0];
  assert.equal(kit.relay, true);
  assert.equal(kit.url, '');
  assert.match(kit.secrets.username, /^kit~\d+$/);
  assert.notEqual(kit.secrets.password, 'kit-real-pw');
  assert.ok(!JSON.stringify(kit).includes('kit-real-pw'));

  const salt = 'abc123';
  const rest = (method: string, params: Record<string, string> = {}, login = kit.secrets, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url: `/nd/${id}/rest/${method}?${new URLSearchParams({ u: login.username, t: md5(login.password + salt), s: salt, v: '1.16.1', c: 'test', f: 'json', ...params })}`, headers });

  const ping = await rest('ping');
  assert.equal(ping.json()['subsonic-response'].status, 'ok');
  assert.equal(nd.calls.at(-1)!.u, 'kit', 'Navidrome sees the kid’s real account');

  const bad = await rest('ping', {}, { username: kit.secrets.username, password: 'guess' });
  assert.equal(bad.json()['subsonic-response'].error.code, 40);

  // audio streams through, Range and all
  const ok = await rest('stream', { id: 's1' }, kit.secrets, { range: 'bytes=0-3' });
  assert.equal(ok.statusCode, 206);
  assert.equal(ok.body, 'ABCD');
  assert.equal(ok.headers['content-range'], 'bytes 0-3/10');
  assert.equal(nd.calls.at(-1)!.range, 'bytes=0-3');

  // explicit by Navidrome's tag, or flagged by an admin: refused for the kid
  assert.equal((await rest('stream', { id: 's2' })).statusCode, 403);
  await json(app, 'POST', '/api/admin/flags', { token: tokens.admin, body: { kind: 'track', artist: 'Someone', title: 'Flagged', verdict: 'block' } });
  assert.equal((await rest('stream', { id: 's3' })).statusCode, 403);

  // account changes are off limits through the relay
  assert.equal((await rest('changePassword', { username: 'kit', password: 'x' })).json()['subsonic-response'].status, 'failed');
  assert.ok(!nd.calls.some((c) => c.method === 'changePassword'));

  // play history through Navidrome's own API, signed in as the kid
  const login = await json(app, 'POST', `/nd/${id}/auth/login`, { body: { username: kit.secrets.username, password: kit.secrets.password } });
  assert.equal(login.status, 200);
  assert.equal((await json(app, 'POST', `/nd/${id}/auth/login`, { body: { username: kit.secrets.username, password: 'kit-real-pw' } })).status, 401);
  const hist = await json(app, 'GET', `/nd/${id}/api/song?_sort=play_date`, { headers: { 'x-nd-authorization': `Bearer ${login.body.token}` } });
  assert.deepEqual(hist.body, [{ title: 'played by', who: 'Bearer nd-kit', sort: 'play_date' }]);

  // revoking the device ends its relay login
  const me = (await json(app, 'GET', '/api/me', { token: tokens.kid })).body;
  await json(app, 'DELETE', `/api/admin/devices/${me.device.id}`, { token: tokens.admin });
  assert.equal((await rest('ping')).json()['subsonic-response'].error.code, 40);
});

test('an admin can send everyone through the relay', async () => {
  const nd = await fakeSubsonic({ mia: 'mia-real-pw' });
  const { app, tokens, ids } = await seeded();
  const s = await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'navidrome', url: nd.url, config: { relay: 'everyone' } } });
  await json(app, 'PUT', `/api/admin/services/${s.body.service.id}/users/${ids.member}`, { token: tokens.admin, body: { secrets: { username: 'mia', password: 'mia-real-pw' } } });
  const mia = (await json(app, 'GET', '/api/me/services', { token: tokens.member })).body.services[0];
  assert.equal(mia.relay, true);
  assert.ok(!JSON.stringify(mia).includes('mia-real-pw'));
  // plain p= works too, and the member isn't held to the kid filter
  const r = await app.inject({ method: 'GET', url: `/nd/${s.body.service.id}/rest/stream?u=${encodeURIComponent(mia.secrets.username)}&p=enc:${Buffer.from(mia.secrets.password).toString('hex')}&id=s2` });
  assert.equal(r.statusCode, 206);
});
