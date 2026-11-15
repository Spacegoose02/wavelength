import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Fetch } from '../src/dj/voice.ts';
import { json, seeded } from './helpers.ts';

/** A pretend Spotify: one own playlist (two pages), one followed playlist, liked songs and followed artists. */
function fakeSpotify(opts: { forbidden?: boolean } = {}) {
  const calls: string[] = [];
  const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const t = (name: string, artist: string, album = 'LP') => ({ type: 'track', name, artists: [{ name: artist }, { name: 'Someone' }], album: { name: album } });
  const fetch: Fetch = async (url, init) => {
    calls.push(String(url));
    const u = new URL(String(url));
    if (u.pathname === '/api/token') {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get('redirect_uri'), 'https://hub.test/auth/spotify/callback');
      assert.equal(((init?.headers ?? {}) as Record<string, string>).authorization, `Basic ${Buffer.from('cid:csecret').toString('base64')}`);
      return body.get('code') === 'good' ? ok({ access_token: 'tok' }) : ok({ error: 'invalid_grant' }, 400);
    }
    if (opts.forbidden) return ok({ error: { status: 403 } }, 403);
    switch (u.pathname + u.search) {
      case '/v1/me': return ok({ id: 'me', display_name: 'Mia' });
      case '/v1/me/playlists?limit=50': return ok({ items: [
        { id: 'p1', name: 'Road trip', owner: { id: 'me' }, external_urls: { spotify: 'https://open.spotify.com/playlist/p1' } },
        { id: 'p2', name: 'Discover Weekly', owner: { id: 'spotify' }, external_urls: { spotify: 'https://open.spotify.com/playlist/p2' } },
      ], next: null });
      case '/v1/playlists/p1/items?limit=50': return ok({ items: [{ item: t('Midnight City', 'M83') }, { item: { type: 'episode', name: 'A podcast' } }], next: 'https://api.spotify.com/v1/playlists/p1/items?limit=50&offset=50' });
      case '/v1/playlists/p1/items?limit=50&offset=50': return ok({ items: [{ item: t('One More Time', 'Daft Punk') }], next: null });
      case '/v1/me/tracks?limit=50': return ok({ items: [{ track: t('Hello', 'Adele', '25') }], next: null });
      case '/v1/me/following?type=artist&limit=50': return ok({ artists: { items: [{ name: 'Adele' }, { name: 'M83' }], next: null } });
    }
    return ok({ error: 'nope' }, 404);
  };
  return { fetch, calls };
}

async function waitFor(app: Parameters<typeof json>[0], token: string) {
  for (let i = 0; i < 50; i++) {
    const r = await json(app, 'GET', '/api/spotify/import', { token });
    if (r.body.job?.state !== 'working') return r.body.job;
    await new Promise((res) => setTimeout(res, 10));
  }
  throw new Error('never finished');
}

test('Connect Spotify reads your own playlists, liked songs and followed artists once', async () => {
  const sp = fakeSpotify();
  const { app, tokens } = await seeded({}, {}, { spotifyFetch: sp.fetch });

  let s = await json(app, 'GET', '/api/spotify', { token: tokens.member });
  assert.deepEqual(s.body, { configured: false, redirectUri: 'https://hub.test/auth/spotify/callback', redirectOk: true, setUp: null });
  assert.equal((await json(app, 'GET', '/api/spotify', { token: tokens.admin })).body.setUp, 'hub');
  assert.equal((await json(app, 'POST', '/api/spotify/connect', { token: tokens.member })).status, 400);

  assert.equal((await json(app, 'PUT', '/api/admin/keys', { token: tokens.admin, body: { values: { spotifyClientId: 'cid', spotifyClientSecret: 'csecret' } } })).status, 200);
  s = await json(app, 'GET', '/api/spotify', { token: tokens.member });
  assert.equal(s.body.configured, true);

  const c = await json(app, 'POST', '/api/spotify/connect', { token: tokens.member });
  assert.equal(c.status, 200);
  const url = new URL(c.body.url);
  assert.equal(url.origin + url.pathname, 'https://accounts.spotify.com/authorize');
  assert.equal(url.searchParams.get('client_id'), 'cid');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://hub.test/auth/spotify/callback');
  assert.match(url.searchParams.get('scope')!, /user-library-read/);
  const state = url.searchParams.get('state')!;

  const back = await app.inject({ method: 'GET', url: `/auth/spotify/callback?code=good&state=${state}` });
  assert.equal(back.statusCode, 200);
  assert.match(back.body, /Go back to Wavelength/);
  // a state is only good once
  assert.equal((await app.inject({ method: 'GET', url: `/auth/spotify/callback?code=good&state=${state}` })).statusCode, 400);

  const job = await waitFor(app, tokens.member);
  assert.equal(job.state, 'ready', JSON.stringify(job));
  assert.deepEqual(job.data, {
    account: 'Mia',
    playlists: [{ name: 'Road trip', songs: [{ title: 'Midnight City', artist: 'M83', album: 'LP' }, { title: 'One More Time', artist: 'Daft Punk', album: 'LP' }] }],
    liked: [{ title: 'Hello', artist: 'Adele', album: '25' }],
    artists: ['Adele', 'M83'],
    skipped: [{ name: 'Discover Weekly', url: 'https://open.spotify.com/playlist/p2' }],
  });
  // someone else's playlist isn't asked for
  assert.ok(!sp.calls.some((u) => u.includes('/playlists/p2/')));
  // it's yours only
  assert.equal((await json(app, 'GET', '/api/spotify/import', { token: tokens.admin })).body.job, null);
  await json(app, 'DELETE', '/api/spotify/import', { token: tokens.member });
  assert.equal((await json(app, 'GET', '/api/spotify/import', { token: tokens.member })).body.job, null);
  assert.equal((await json(app, 'GET', '/api/spotify', {})).status, 401);
});

test('Connect Spotify says what to do when the account isn’t on the app’s list, or you say no', async () => {
  const { app, tokens } = await seeded({}, {}, { spotifyFetch: fakeSpotify({ forbidden: true }).fetch });
  await json(app, 'PUT', '/api/admin/keys', { token: tokens.admin, body: { values: { spotifyClientId: 'cid', spotifyClientSecret: 'csecret' } } });
  const state = (u: string) => new URL(u).searchParams.get('state');

  let c = await json(app, 'POST', '/api/spotify/connect', { token: tokens.member });
  await app.inject({ method: 'GET', url: `/auth/spotify/callback?code=good&state=${state(c.body.url)}` });
  let job = await waitFor(app, tokens.member);
  assert.equal(job.state, 'error');
  assert.match(job.error, /Users Management/);

  c = await json(app, 'POST', '/api/spotify/connect', { token: tokens.member });
  const no = await app.inject({ method: 'GET', url: `/auth/spotify/callback?error=access_denied&state=${state(c.body.url)}` });
  assert.equal(no.statusCode, 200);
  job = await waitFor(app, tokens.member);
  assert.match(job.error, /said no/);

  c = await json(app, 'POST', '/api/spotify/connect', { token: tokens.member });
  const bad = await app.inject({ method: 'GET', url: `/auth/spotify/callback?code=bad&state=${state(c.body.url)}` });
  assert.equal(bad.statusCode, 502);
});

test('Connect Spotify needs an https Hub address', async () => {
  const { app, tokens } = await seeded({}, { publicUrl: 'http://192.168.1.5:7780' });
  await json(app, 'PUT', '/api/admin/keys', { token: tokens.admin, body: { values: { spotifyClientId: 'cid', spotifyClientSecret: 'csecret' } } });
  assert.equal((await json(app, 'GET', '/api/spotify', { token: tokens.member })).body.redirectOk, false);
  const c = await json(app, 'POST', '/api/spotify/connect', { token: tokens.member });
  assert.equal(c.status, 400);
  assert.match(c.body.error, /https/);
});
