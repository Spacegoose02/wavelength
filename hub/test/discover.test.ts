import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChartCache } from '../src/discover.ts';
import { json, seeded } from './helpers.ts';

/** Swap global fetch for a fake for one test. */
function fakeFetch(t: { after(fn: () => void): void }, answer: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL) => {
    calls.push(String(u));
    return answer(String(u));
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
  return calls;
}

const page = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('apps get Discover charts from the Hub copy, fetched once', async (t) => {
  const { app, tokens } = await seeded();
  const calls = fakeFetch(t, () => page({ tracks: { data: [{ id: 1 }] } }));
  const go = (url: string, token = tokens.member) => app.inject({ method: 'GET', url: `/api/discover/fetch?url=${encodeURIComponent(url)}`, headers: token ? { authorization: `Bearer ${token}` } : {} });

  const a = await go('https://api.deezer.com/playlist/1282495565');
  const b = await go('https://api.deezer.com/playlist/1282495565', tokens.kid);
  assert.equal(a.statusCode, 200);
  assert.deepEqual(b.json(), { tracks: { data: [{ id: 1 }] } });
  assert.equal(b.headers['x-wavelength-stale'], '0');
  assert.ok(Date.parse(b.headers['x-wavelength-fetched-at'] as string));
  assert.equal(calls.length, 1, 'the second app was served from the copy');

  assert.equal((await go('https://api.deezer.com/playlist/1', '')).statusCode, 401);
  assert.equal((await go('https://example.com/')).statusCode, 403);
  assert.equal((await json(app, 'GET', '/api/discover/fetch?url=nope', { token: tokens.member })).status, 400);
});

test('a chart service that fails or rate limits gets the last copy that worked', async (t) => {
  let now = 1_000_000;
  const cache = new ChartCache(() => now);
  let mode: 'ok' | 'quota' | 'down' | 'html' = 'ok';
  const calls = fakeFetch(t, () => {
    if (mode === 'down') throw new Error('ECONNRESET');
    if (mode === 'quota') return page({ error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 } });
    if (mode === 'html') return new Response('<html>busy</html>', { status: 503 });
    return page({ data: ['good'] });
  });
  const url = 'https://api.deezer.com/chart/0/tracks?limit=100';
  const read = async () => {
    const r = await cache.get(url);
    return { stale: r.stale, body: JSON.parse(r.body.toString()) };
  };

  assert.deepEqual(await read(), { stale: false, body: { data: ['good'] } });

  // over 6 hours old: try the source first, fall back to the old copy
  for (mode of ['quota', 'down', 'html'] as const) {
    now += 7 * 60 * 60_000;
    assert.deepEqual(await read(), { stale: true, body: { data: ['good'] } }, mode);
  }

  // nothing kept yet: the error comes through, and a Deezer quota error isn't kept as a chart
  mode = 'quota';
  await assert.rejects(cache.get('https://api.deezer.com/playlist/2'), /Quota limit exceeded/);
  assert.equal(cache.size, 1);

  // a little old: served right away, fetched again behind the scenes
  mode = 'ok';
  now += 7 * 60 * 60_000;
  await read();
  const before = calls.length;
  now += 60 * 60_000;
  mode = 'ok';
  const r = await read();
  assert.equal(r.stale, true);
  await new Promise((res) => setImmediate(res));
  assert.equal(calls.length, before + 1);
  assert.equal((await read()).stale, false);
});

test('the Hub refreshes charts people opened, and forgets ones nobody opens', async (t) => {
  let now = 1_000_000;
  const cache = new ChartCache(() => now);
  let n = 0;
  fakeFetch(t, () => page({ n: ++n }));
  await cache.get('https://api.deezer.com/playlist/1');
  now += 31 * 60_000;
  await cache.refreshAll();
  assert.equal(JSON.parse((await cache.get('https://api.deezer.com/playlist/1')).body.toString()).n, 2);
  now += 4 * 24 * 60 * 60_000;
  await cache.refreshAll();
  assert.equal(cache.size, 0);
});

test("follows Apple's chart feed to its new host", async (t) => {
  const { app, tokens } = await seeded();
  const calls = fakeFetch(t, (u) =>
    u.startsWith('https://rss.applemarketingtools.com/')
      ? new Response(null, { status: 302, headers: { location: u.replace('rss.applemarketingtools.com', 'rss.marketingtools.apple.com') } })
      : page({ feed: { results: [{ name: 'Song' }] } }),
  );
  const res = await app.inject({
    method: 'GET',
    url: `/api/discover/fetch?url=${encodeURIComponent('https://rss.applemarketingtools.com/api/v2/us/music/most-played/100/songs.json')}`,
    headers: { authorization: `Bearer ${tokens.member}` },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { feed: { results: [{ name: 'Song' }] } });
  assert.equal(calls.length, 2);
});
