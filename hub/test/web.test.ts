import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { json, makeHub, seeded } from './helpers.ts';

function webBuild() {
  const dir = mkdtempSync(join(tmpdir(), 'wl-web-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'icon.png'), 'png');
  writeFileSync(join(dir, '..', 'secret.txt'), 'nope');
  return dir;
}

test('the Hub serves the web app at / and leaves its own pages alone', async () => {
  const { app } = makeHub({}, { webDir: webBuild() });
  const get = (url: string) => app.inject({ method: 'GET', url });

  const index = await get('/');
  assert.equal(index.statusCode, 200);
  assert.match(index.headers['content-type'] as string, /text\/html/);
  assert.match(index.body, /id="root"/);
  assert.equal(index.headers['cache-control'], 'no-cache');
  assert.match(index.headers['content-security-policy'] as string, /script-src 'self'(;|$)/);

  const js = await get('/assets/index-abc123.js');
  assert.equal(js.statusCode, 200);
  assert.match(js.headers['content-type'] as string, /javascript/);
  assert.match(js.headers['cache-control'] as string, /immutable/);

  // the app routes on its own: unknown pages get index.html, missing files don't
  assert.match((await get('/albums/whatever')).body, /id="root"/);
  assert.equal((await get('/assets/missing.js')).statusCode, 404);
  assert.equal((await get('/%2e%2e/secret.txt')).statusCode, 404);
  assert.doesNotMatch((await get('/..%2fsecret.txt')).body, /nope/);

  // the Hub's own routes still answer
  assert.equal((await get('/api/health')).json().name, 'wavelength-hub');
  assert.equal((await get('/api/nothing-here')).statusCode, 404);
  assert.match((await get('/setup')).body, /<form/i);
});

test('without a web build, / goes to the sign-in page', async () => {
  const { app } = makeHub();
  const r = await app.inject({ method: 'GET', url: '/' });
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, '/link');
});

test('the browser can fetch a few public music sites through the Hub, nothing else', async (t) => {
  const { app, tokens } = await seeded();
  const seen: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL) => {
    seen.push(String(u));
    if (String(u).includes('/redirect')) return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } });
    return new Response(JSON.stringify({ data: [{ id: 1 }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
  const go = (url: string, token = tokens.kid) => json(app, 'GET', `/api/fetch?url=${encodeURIComponent(url)}`, { token });

  const ok = await go('https://api.deezer.com/search/album?q=abba');
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { data: [{ id: 1 }] });

  assert.equal((await go('https://api.deezer.com/search', '')).status, 401);
  for (const bad of ['http://api.deezer.com/x', 'https://example.com/', 'https://192.168.1.2/', 'https://api.deezer.com:8443/x', 'https://u:p@api.deezer.com/x', 'file:///etc/passwd']) {
    assert.equal((await go(bad)).status, 403, bad);
  }
  // a redirect off the list is refused, and never fetched
  assert.equal((await go('https://api.deezer.com/redirect')).status, 403);
  assert.ok(!seen.some((u) => u.includes('169.254')));
});

test('admins see how the Hub is doing and can download a backup', async () => {
  const { app, tokens } = await seeded({}, { dataDir: mkdtempSync(join(tmpdir(), 'wl-data-')), ytdlpBin: '/nonexistent/yt-dlp' });
  const s = await json(app, 'GET', '/api/admin/server', { token: tokens.admin });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.counts.users, 3);
  assert.equal(s.body.counts.kids, 1);
  assert.equal(s.body.ytdlp, null);
  assert.ok(s.body.data.disk.total > 0);

  const b = await app.inject({ method: 'GET', url: '/api/admin/backup', headers: { authorization: `Bearer ${tokens.admin}` } });
  assert.equal(b.statusCode, 200);
  assert.match(b.headers['content-disposition'] as string, /wavelength-hub-\d{4}-\d{2}-\d{2}\.db/);
  assert.equal(b.rawPayload.subarray(0, 15).toString(), 'SQLite format 3');
  const log = (await json(app, 'GET', '/api/admin/audit', { token: tokens.admin })).body;
  assert.ok(JSON.stringify(log).includes('hub.backup'));

  assert.equal((await json(app, 'GET', '/api/admin/backup', { token: tokens.member })).status, 403);
});
