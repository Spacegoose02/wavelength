import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { after, test } from 'node:test';
import { json, seeded } from './helpers.ts';

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

/** A stand-in Audiobookshelf: JSON for the API, bytes (with Range) for a cover or audio file. */
async function fakeAbs() {
  const seen: { method: string; url: string; headers: IncomingMessage['headers']; body: string }[] = [];
  const audio = Buffer.from('0123456789');
  const srv = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (d: Buffer) => chunks.push(d));
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks).toString() });
      if (req.headers.authorization === 'Bearer stale-key') {
        res.writeHead(401).end('Unauthorized');
        return;
      }
      if (req.url!.startsWith('/api/items/b1/file/1')) {
        const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? '');
        if (m) {
          res.writeHead(206, { 'content-type': 'audio/mpeg', 'content-range': `bytes ${m[1]}-${m[2]}/${audio.length}`, 'accept-ranges': 'bytes' });
          res.end(audio.subarray(Number(m[1]), Number(m[2]) + 1));
        } else res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': String(audio.length) }).end(audio);
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ path: req.url, method: req.method }));
    });
  });
  servers.push(srv);
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, seen };
}

const absOf = async (app: Parameters<typeof json>[0], token: string) =>
  ((await json(app, 'GET', '/api/me/services', { token })).body.services as { id: number; kind: string; relayKey?: string }[]).find((s) => s.kind === 'audiobookshelf');

test('Audiobookshelf through the Hub: API calls with the Hub token, using the saved API key', async () => {
  const abs = await fakeAbs();
  const { app, tokens, ids } = await seeded();
  const { body } = await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'audiobookshelf', name: 'Books', url: `${abs.url}/`, access: 'chosen', secrets: { token: 'abs-shared' } } });
  const id = body.service.id;

  const r = await json(app, 'GET', `/api/abs/${id}/api/libraries?limit=5&token=leaked`, { token: tokens.admin });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { path: '/api/libraries?limit=5', method: 'GET' }, 'query passed on without a token');
  assert.equal(abs.seen.at(-1)!.headers.authorization, 'Bearer abs-shared');

  const p = await json(app, 'PATCH', `/api/abs/${id}/api/me/progress/b1`, { token: tokens.admin, body: { isFinished: true } });
  assert.equal(p.status, 200);
  assert.equal(abs.seen.at(-1)!.method, 'PATCH');
  assert.deepEqual(JSON.parse(abs.seen.at(-1)!.body), { isFinished: true });

  // a member who isn't chosen gets nothing; once given their own key, the relay uses it
  assert.equal((await json(app, 'GET', `/api/abs/${id}/api/libraries`, { token: tokens.member })).status, 404);
  await json(app, 'PUT', `/api/admin/services/${id}/users/${ids.member}`, { token: tokens.admin, body: { secrets: { token: 'mia-own' } } });
  assert.equal((await json(app, 'GET', `/api/abs/${id}/api/me`, { token: tokens.member })).status, 200);
  assert.equal(abs.seen.at(-1)!.headers.authorization, 'Bearer mia-own');

  // signed out, the web UI, and climbing out of the API are all refused before Audiobookshelf hears of it
  const before = abs.seen.length;
  assert.equal((await json(app, 'GET', `/api/abs/${id}/api/libraries`)).status, 401);
  assert.equal((await json(app, 'GET', `/api/abs/${id}/login`, { token: tokens.admin })).status, 400);
  assert.equal((await json(app, 'GET', `/api/abs/${id}/api/..%2f..%2fetc`, { token: tokens.admin })).status, 400);
  assert.equal(abs.seen.length, before);
});

test('Audiobookshelf through the Hub: covers and audio with the device relay key, seeking included', async () => {
  const abs = await fakeAbs();
  const { app, tokens } = await seeded();
  const { body } = await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'audiobookshelf', name: 'Books', url: abs.url, secrets: { token: 'abs-shared' } } });
  const id = body.service.id;
  const s = (await absOf(app, tokens.member))!;
  assert.match(s.relayKey ?? '', /^\d+\.[\w-]+$/);
  assert.notEqual(s.relayKey, (await absOf(app, tokens.admin))!.relayKey, 'one key per device');

  const full = await app.inject({ method: 'GET', url: `/api/abs/${id}/api/items/b1/file/1?k=${s.relayKey}` });
  assert.equal(full.statusCode, 200);
  assert.equal(full.body, '0123456789');
  assert.equal(full.headers['content-type'], 'audio/mpeg');

  const part = await app.inject({ method: 'GET', url: `/api/abs/${id}/api/items/b1/file/1?k=${s.relayKey}`, headers: { range: 'bytes=2-4' } });
  assert.equal(part.statusCode, 206);
  assert.equal(part.body, '234');
  assert.equal(part.headers['content-range'], 'bytes 2-4/10');
  assert.ok(!abs.seen.at(-1)!.url.includes('k='), 'the relay key stays on the Hub');

  const forged = s.relayKey!.replace(/^\d+/, '1');
  assert.equal((await app.inject({ method: 'GET', url: `/api/abs/${id}/api/items/b1/cover?k=${forged}` })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: `/api/abs/${id}/api/items/b1/cover?k=nonsense` })).statusCode, 401);
});

test('Audiobookshelf through the Hub: a down server or a stale key says what to fix', async () => {
  const abs = await fakeAbs();
  const { app, tokens } = await seeded();
  const down = (await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'audiobookshelf', name: 'Gone', url: 'http://127.0.0.1:9', secrets: { token: 'x' } } })).body.service.id;
  const r = await json(app, 'GET', `/api/abs/${down}/api/libraries`, { token: tokens.admin });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /couldn’t reach Audiobookshelf at http:\/\/127\.0\.0\.1:9/);

  const stale = (await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'audiobookshelf', name: 'Old', url: abs.url, secrets: { token: 'stale-key' } } })).body.service.id;
  const s = await json(app, 'GET', `/api/abs/${stale}/api/libraries`, { token: tokens.admin });
  assert.equal(s.status, 502, 'not a 401, which would read as signed out of the Hub');
  assert.match(s.body.error, /turned down the API key/);
});
