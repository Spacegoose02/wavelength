import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import { ReleaseRadar } from '../src/radar.ts';
import { json, seeded } from './helpers.ts';

const DAY = 86_400_000;
const page = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** A pretend Deezer: `albums[id]`, `related[id]` and artists to search, changeable mid-test. */
function fakeDeezer(t: { after(fn: () => void): void }) {
  const d = {
    albums: {} as Record<number, unknown[]>,
    related: {} as Record<number, unknown[]>,
    artists: [] as { id: number; name: string }[],
    quota: false,
    calls: [] as string[],
  };
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL) => {
    const url = new URL(String(u));
    d.calls.push(url.pathname + url.search);
    if (d.quota) return page({ error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 } });
    let m = /^\/artist\/(\d+)\/albums$/.exec(url.pathname);
    if (m) return page({ data: d.albums[Number(m[1])] ?? [] });
    m = /^\/artist\/(\d+)\/related$/.exec(url.pathname);
    if (m) return page({ data: d.related[Number(m[1])] ?? [] });
    if (url.pathname === '/search/artist') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      return page({ data: d.artists.filter((a) => a.name.toLowerCase().includes(q)).map((a) => ({ ...a, picture_medium: `https://img.test/${a.id}.jpg`, nb_fan: 100 })) });
    }
    return page({ error: { message: 'no such thing' } });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
  return d;
}

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const album = (id: number, title: string, released: string, extra: Record<string, unknown> = {}) =>
  ({ id, title, release_date: released, record_type: 'album', cover_medium: `https://img.test/a${id}.jpg`, link: `https://www.deezer.com/album/${id}`, ...extra });
const settle = () => new Promise((r) => setTimeout(r, 20));

test('people follow artists and see their new releases', async (t) => {
  const dz = fakeDeezer(t);
  const today = ymd(Date.now());
  dz.albums[27] = [album(1, 'Brand New', today, { explicit_lyrics: true }), album(2, 'Ancient', '2001-01-01'), album(3, 'Single', today, { record_type: 'single' })];
  dz.artists = [{ id: 27, name: 'Daft Punk' }, { id: 99, name: 'Daft Punk Tribute Band' }];
  const { app, tokens } = await seeded();

  assert.equal((await json(app, 'GET', '/api/radar')).status, 401);
  assert.equal((await json(app, 'POST', '/api/radar/follows', { token: tokens.member, body: { id: 'x', name: 'A' } })).status, 400);
  assert.equal((await json(app, 'POST', '/api/radar/follows', { token: tokens.member, body: { id: 5 } })).status, 400);

  // by name, from the library: an exact match only
  const f = await json(app, 'POST', '/api/radar/follows', { token: tokens.member, body: { name: 'daft punk' } });
  assert.equal(f.status, 201);
  assert.deepEqual({ id: f.body.follow.id, name: f.body.follow.name, picture: f.body.follow.picture }, { id: 27, name: 'Daft Punk', picture: 'https://img.test/27.jpg' });
  assert.equal((await json(app, 'POST', '/api/radar/follows', { token: tokens.member, body: { name: 'Nobody Here' } })).status, 404);
  await settle();

  const r = await json(app, 'GET', '/api/radar', { token: tokens.member });
  assert.deepEqual(r.body.follows.map((x: { name: string }) => x.name), ['Daft Punk']);
  assert.deepEqual(r.body.releases.map((x: { title: string }) => x.title).sort(), ['Brand New', 'Single'], 'only recent ones');
  assert.equal(r.body.releases.find((x: { id: number }) => x.id === 1).explicit, true);
  assert.equal(r.body.pending, 0);
  assert.ok(r.body.checkedAt);

  // a kid can follow too; everyone's list is their own
  assert.equal((await json(app, 'POST', '/api/radar/follows', { token: tokens.kid, body: { id: 99, name: 'Daft Punk Tribute Band' } })).status, 201);
  assert.deepEqual((await json(app, 'GET', '/api/radar', { token: tokens.admin })).body.follows, []);
  await settle();

  // a second app following the same artist doesn't ask Deezer about them again
  const before = dz.calls.filter((c) => c.startsWith('/artist/27/albums')).length;
  assert.equal((await json(app, 'POST', '/api/radar/follows', { token: tokens.admin, body: { id: 27, name: 'Daft Punk' } })).status, 201);
  await settle();
  assert.equal(dz.calls.filter((c) => c.startsWith('/artist/27/albums')).length, before);

  assert.equal((await json(app, 'DELETE', '/api/radar/follows/27', { token: tokens.member })).status, 200);
  assert.equal((await json(app, 'DELETE', '/api/radar/follows/27', { token: tokens.member })).status, 404);
  assert.deepEqual((await json(app, 'GET', '/api/radar', { token: tokens.member })).body.releases, []);
});

test('a release that turns up later is news for the people who followed before it', async (t) => {
  const dz = fakeDeezer(t);
  let now = Date.parse('2026-10-01T12:00:00Z');
  const db = openDb(':memory:');
  for (const id of [1, 2, 3]) db.prepare("INSERT INTO users (id, username, display_name, role, created_at, updated_at) VALUES (?, ?, 'x', 'member', 0, 0)").run(id, `u${id}`);
  const radar = new ReleaseRadar(db, { now: () => now, gapMs: 0 });

  dz.albums[7] = [album(10, 'Last Month', ymd(now - 20 * DAY))];
  radar.follow(1, { id: 7, name: 'Band' });
  await settle();
  const notices = () => db.prepare('SELECT user_id, title, body FROM notifications ORDER BY id').all().map((r) => ({ ...r }));
  assert.deepEqual(notices(), [], 'the first look only fills the list');

  now += 13 * 60 * 60_000;
  radar.follow(2, { id: 7, name: 'Band' }); // after the last look: everything is new to them anyway
  dz.albums[7] = [
    album(10, 'Last Month', ymd(now - 20 * DAY)),
    album(11, 'Out Today', ymd(now), { record_type: 'single' }),
    album(12, 'Found Late', ymd(now - 30 * DAY)),
  ];
  await radar.checkDue();
  assert.deepEqual(notices(), [{ user_id: 1, title: 'New from Band', body: 'Out Today (single)' }]);
  assert.deepEqual(radar.releases(2).map((r) => r.title), ['Out Today', 'Last Month', 'Found Late']);

  // nothing due yet: Deezer isn't asked again
  const calls = dz.calls.length;
  await radar.checkDue();
  assert.equal(dz.calls.length, calls);

  // Deezer's quota error doesn't wipe the list; the artist counts as failed until a look works
  now += 13 * 60 * 60_000;
  dz.quota = true;
  await radar.checkDue();
  assert.equal(radar.releases(1).length, 3);
  assert.equal(radar.status(1).failed, 1);
  dz.quota = false;
  now += 13 * 60 * 60_000;
  await radar.checkDue();
  assert.equal(radar.status(1).failed, 0);

  // past the window: off the radar; nobody follows them: dropped
  now += 50 * DAY;
  await radar.checkDue();
  assert.deepEqual(radar.releases(1).map((r) => r.title), []);
  radar.unfollow(1, 7);
  radar.unfollow(2, 7);
  radar.prune();
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM radar_releases').get() as { n: number }).n, 0);
});

test('suggestions come from related artists and from what you play', async (t) => {
  const dz = fakeDeezer(t);
  const now = Date.parse('2026-10-01T12:00:00Z');
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (id, username, display_name, role, created_at, updated_at) VALUES (1, 'u', 'u', 'member', 0, 0)").run();
  const radar = new ReleaseRadar(db, { now: () => now, gapMs: 0 });
  const a = (id: number, name: string) => ({ id, name, picture_medium: `https://img.test/${id}.jpg`, nb_fan: id });
  dz.related[1] = [a(3, 'Both Like'), a(4, 'Only A'), a(2, 'B')];
  dz.related[2] = [a(3, 'Both Like'), a(5, 'Only B')];
  dz.related[8] = [a(6, 'Like Zed')];
  dz.artists = [{ id: 8, name: 'Zed' }];
  radar.follow(1, { id: 1, name: 'A' });
  radar.follow(1, { id: 2, name: 'B' });
  const play = db.prepare("INSERT INTO plays (user_id, played_at, title, artist, album, seconds, track) VALUES (1, ?, 's', ?, 'al', 180, '{}')");
  for (let i = 0; i < 4; i++) play.run(now - i * 1000, i % 2 ? 'Zed' : 'Zed feat. Someone');
  play.run(now - 9000, 'Once Only');

  const s = await radar.suggestions(1);
  assert.deepEqual(s.map((x) => x.name), ['Zed', 'Both Like', 'Only A', 'Only B', 'Like Zed']);
  assert.equal(s[0].plays, 4, 'played four times, features and all');
  assert.deepEqual(s[1].because.sort(), ['A', 'B']);
  assert.ok(!s.some((x) => x.id === 2), 'not someone you already follow');

  radar.hide(1, 4);
  assert.ok(!(await radar.suggestions(1)).some((x) => x.id === 4));
  assert.ok(!(await radar.suggestions(1, true)).some((x) => x.id === 4), 'still hidden when worked out again');
  radar.follow(1, { id: 8, name: 'Zed' });
  const after = await radar.suggestions(1);
  assert.ok(!after.some((x) => x.id === 8), 'followed now');
  assert.ok(after.some((x) => x.id === 6), 'still a seed');
});

test('suggestion routes', async (t) => {
  const dz = fakeDeezer(t);
  dz.related[1] = [{ id: 3, name: 'Other' }];
  const { app, tokens } = await seeded();
  await json(app, 'POST', '/api/radar/follows', { token: tokens.member, body: { id: 1, name: 'A' } });
  const s = await json(app, 'GET', '/api/radar/suggestions', { token: tokens.member });
  assert.deepEqual(s.body.suggestions.map((x: { name: string }) => x.name), ['Other']);
  assert.equal((await json(app, 'POST', '/api/radar/suggestions/3/hide', { token: tokens.member, body: {} })).status, 200);
  assert.deepEqual((await json(app, 'GET', '/api/radar/suggestions', { token: tokens.member })).body.suggestions, []);
  assert.equal((await json(app, 'GET', '/api/radar/suggestions')).status, 401);
  assert.equal((await json(app, 'POST', '/api/radar/suggestions/nope/hide', { token: tokens.member, body: {} })).status, 400);
  const c = await json(app, 'POST', '/api/radar/check', { token: tokens.member, body: {} });
  assert.equal(c.status, 200);
  assert.deepEqual(c.body.releases, []);
});
