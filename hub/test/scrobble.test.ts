import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { lastfmSignature } from '../src/scrobble.ts';
import { json, seeded } from './helpers.ts';

const song = (title: string, artist: string) => ({ kind: 'track', id: title, sourceId: 's', title, artist, album: 'LP', duration: 200 });

test('ListenBrainz: connect with a token, plays are sent in a batch, a dead token stops sending', async (t) => {
  const sent: { url: string; auth: string | null; body: any }[] = [];
  let valid = true;
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL, init?: RequestInit) => {
    const url = String(u);
    const auth = new Headers(init?.headers).get('authorization');
    if (url.endsWith('/validate-token')) return Response.json(auth === 'Token good' ? { valid: true, user_name: 'lbuser' } : { valid: false });
    if (url.endsWith('/submit-listens')) {
      sent.push({ url, auth, body: JSON.parse(String(init?.body)) });
      return new Response('{}', { status: valid ? 200 : 401 });
    }
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
  const { app, db, tokens } = await seeded();

  assert.equal((await json(app, 'POST', '/api/me/scrobble/listenbrainz', { token: tokens.member, body: { token: 'bad' } })).status, 400);
  const c = await json(app, 'POST', '/api/me/scrobble/listenbrainz', { token: tokens.member, body: { token: 'good' } });
  assert.equal(c.status, 200);
  assert.equal(c.body.account.username, 'lbuser');
  const list = await json(app, 'GET', '/api/me/scrobble', { token: tokens.member });
  assert.deepEqual(list.body.accounts.map((a: { service: string }) => a.service), ['listenbrainz']);
  assert.equal(list.body.lastfmAvailable, false);
  assert.ok(!JSON.stringify(db.prepare('SELECT secret FROM scrobble_accounts').get()).includes('good'), 'the token is sealed');

  // two plays (and a radio one, which isn't music) arrive; the same plays again aren't queued twice
  const plays = { plays: [{ playedAt: 1_800_000_000_000, track: song('One', 'A') }, { playedAt: 1_800_000_100_000, track: song('Two', 'B') }, { playedAt: 1_800_000_200_000, track: { ...song('FM', 'R'), kind: 'radio' } }] };
  await json(app, 'POST', '/api/me/history', { token: tokens.member, body: plays });
  await json(app, 'POST', '/api/me/history', { token: tokens.member, body: plays });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM scrobble_queue').get() as { n: number }).n, 2);

  const ctxScrobbler = app.hubScrobbler;
  await ctxScrobbler.flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].auth, 'Token good');
  assert.equal(sent[0].body.listen_type, 'import');
  assert.deepEqual(sent[0].body.payload.map((p: any) => [p.track_metadata.track_name, p.listened_at]), [['One', 1_800_000_000], ['Two', 1_800_000_100]]);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM scrobble_queue').get() as { n: number }).n, 0);

  // the token is revoked: sending stops and Settings says why
  valid = false;
  await json(app, 'POST', '/api/me/history', { token: tokens.member, body: { plays: [{ playedAt: 1_800_000_300_000, track: song('Three', 'C') }] } });
  await ctxScrobbler.flush();
  const after = await json(app, 'GET', '/api/me/scrobble', { token: tokens.member });
  assert.match(after.body.accounts[0].error, /connect again/);
  assert.equal((await json(app, 'DELETE', '/api/me/scrobble/listenbrainz', { token: tokens.member })).status, 200);
  assert.deepEqual((await json(app, 'GET', '/api/me/scrobble', { token: tokens.member })).body.accounts, []);
});

test('Last.fm needs the Hub to have an API account, and signs calls the way Last.fm does', async () => {
  const { app, tokens } = await seeded();
  const r = await json(app, 'POST', '/api/me/scrobble/lastfm', { token: tokens.member, body: { username: 'u', password: 'p' } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /isn’t set up/);
  // sorted by name, `format` left out, the secret on the end
  const expected = createHash('md5').update('api_keyxxmethodauth.getMobileSessionpasswordpusernameusecret').digest('hex');
  assert.equal(lastfmSignature({ method: 'auth.getMobileSession', username: 'u', password: 'p', api_key: 'xx', format: 'json' }, 'secret'), expected);
});
