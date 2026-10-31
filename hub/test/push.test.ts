import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { json, seeded } from './helpers.ts';

/** Stands in for an ntfy server: records what's posted, refuses the wrong token. */
async function fakeNtfy() {
  const got: { auth?: string; msg: Record<string, unknown> }[] = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.headers.authorization && req.headers.authorization !== 'Bearer tk_good') {
        res.writeHead(403).end();
        return;
      }
      got.push({ auth: req.headers.authorization, msg: JSON.parse(body) });
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  const { port } = srv.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, got, close: () => srv.close() };
}

const until = async (f: () => boolean) => {
  for (let i = 0; i < 50 && !f(); i++) await new Promise((r) => setTimeout(r, 20));
};

test('push notifications go to the topics of the people they are for', async (t) => {
  const ntfy = await fakeNtfy();
  t.after(ntfy.close);
  const { app, tokens } = await seeded();

  // nothing until an admin sets a server
  assert.equal((await json(app, 'GET', '/api/me/push', { token: tokens.member })).body.available, false);
  assert.equal((await json(app, 'POST', '/api/me/push', { token: tokens.member })).status, 409);
  assert.equal((await json(app, 'PUT', '/api/admin/push', { token: tokens.member, body: { server: ntfy.url } })).status, 403);
  assert.equal((await json(app, 'PUT', '/api/admin/push', { token: tokens.admin, body: { server: 'ftp://x' } })).status, 400);
  assert.equal((await json(app, 'PUT', '/api/admin/push', { token: tokens.admin, body: { server: `${ntfy.url}/topic?x=1` } })).status, 400);
  const set = await json(app, 'PUT', '/api/admin/push', { token: tokens.admin, body: { server: `${ntfy.url}/` } });
  assert.deepEqual(set.body, { server: ntfy.url, hasToken: false });

  const on = (await json(app, 'POST', '/api/me/push', { token: tokens.member })).body;
  assert.equal(on.available, true);
  assert.match(on.topic, /^wl-[A-Za-z0-9]{20}$/);
  assert.equal(on.subscribeUrl, `ntfy://${new URL(ntfy.url).host}/${on.topic}`);

  // a share to everyone reaches the member's topic, and nobody else has one
  await json(app, 'POST', '/api/shares', { token: tokens.admin, body: { to: null, kind: 'track', title: 'Café del Mar', payload: { tracks: [{ title: 'x', artist: 'y' }] } } });
  await until(() => ntfy.got.length > 0);
  assert.equal(ntfy.got.length, 1);
  assert.equal(ntfy.got[0].msg.topic, on.topic);
  assert.equal(ntfy.got[0].msg.message, 'Café del Mar');
  assert.deepEqual(ntfy.got[0].msg.tags, ['gift']);

  assert.equal((await json(app, 'POST', '/api/me/push/test', { token: tokens.member })).status, 200);
  await until(() => ntfy.got.length > 1);
  assert.equal(ntfy.got[1].msg.topic, on.topic);
  assert.equal((await json(app, 'POST', '/api/me/push/test', { token: tokens.kid })).status, 409, 'not turned on');

  // an access token is sent, and a wrong one is reported on the test
  await json(app, 'PUT', '/api/admin/push', { token: tokens.admin, body: { server: ntfy.url, token: 'tk_bad' } });
  const bad = await json(app, 'POST', '/api/me/push/test', { token: tokens.member });
  assert.equal(bad.status, 502);
  assert.match(bad.body.error, /403/);
  assert.equal((await json(app, 'PUT', '/api/admin/push', { token: tokens.admin, body: { server: ntfy.url, token: 'tk_good' } })).body.hasToken, true);
  assert.equal((await json(app, 'PUT', '/api/admin/push', { token: tokens.admin, body: { server: ntfy.url } })).body.hasToken, true, 'left out: kept');
  assert.equal((await json(app, 'POST', '/api/me/push/test', { token: tokens.member })).status, 200);
  await until(() => ntfy.got.length > 2);
  assert.equal(ntfy.got[2].auth, 'Bearer tk_good');

  // turning it off, and on again with a new topic
  assert.equal((await json(app, 'DELETE', '/api/me/push', { token: tokens.member })).body.topic, null);
  const again = (await json(app, 'POST', '/api/me/push', { token: tokens.member })).body;
  assert.notEqual(again.topic, on.topic);
  assert.equal((await json(app, 'PUT', '/api/admin/push', { token: tokens.admin, body: { server: '' } })).body.server, '');
  assert.equal((await json(app, 'GET', '/api/me/push', { token: tokens.member })).body.available, false);
});
