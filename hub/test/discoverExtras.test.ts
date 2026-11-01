import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, test } from 'node:test';
import { ChartHistory, chartSongKey, computeMoves } from '../src/chartHistory.ts';
import { openDb } from '../src/db.ts';
import { creditedArtists, forYou } from '../src/forYou.ts';
import { cleanTitle } from '../src/libraryIndex.ts';
import type { MixLookups } from '../src/mixes.ts';
import { json, seeded } from './helpers.ts';

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

/** A Navidrome that knows a few songs and answers getUser for the scan-login check. */
async function navidrome(songs: Record<string, unknown>[]) {
  let lists = 0;
  const srv = createServer((req, res) => {
    const u = new URL(req.url!, 'http://x');
    const ok = (extra: object) => ({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...extra } });
    let body: unknown = ok({});
    if (u.pathname === '/rest/getUser') body = ok({ user: { username: 'admin', adminRole: true } });
    if (u.pathname === '/rest/search3') {
      if (u.searchParams.get('songOffset') === '0') lists++;
      body = ok({ searchResult3: { song: u.searchParams.get('songOffset') === '0' ? songs : [] } });
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  servers.push(srv);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, lists: () => lists };
}

test('chart songs are matched against the Hub’s copy of the Navidrome library in one go', async () => {
  const nd = await navidrome([
    { id: 'a1', title: 'Espresso', artist: 'Sabrina Carpenter', album: 'Short n’ Sweet', albumId: 'al1', duration: 175, coverArt: 'al-al1', explicitStatus: 'clean' },
    { id: 'a2', title: 'Not Like Us', artist: 'Kendrick Lamar', album: 'GNX', duration: 274, explicitStatus: 'explicit' },
    { id: 'a3', title: 'A Bar Song (Tipsy) - Radio Edit', artist: 'Shaboozey', duration: 171 },
    { id: 'a4', title: 'Espresso', artist: 'Someone Else' },
  ]);
  const { app, tokens } = await seeded();
  const songs = [
    { title: 'Espresso', artist: 'Sabrina Carpenter' },
    { title: 'Not Like Us (Explicit)', artist: 'Kendrick Lamar Featuring Nobody' },
    { title: 'A Bar Song (Tipsy)', artist: 'Shaboozey' },
    { title: 'Birds of a Feather', artist: 'Billie Eilish' },
  ];

  // no scan login yet: not ready, the app checks the songs itself
  const before = await json(app, 'POST', '/api/discover/match', { token: tokens.member, body: { songs } });
  assert.equal(before.status, 200);
  assert.equal(before.body.ready, false);
  assert.deepEqual(before.body.songs, [null, null, null, null]);

  const set = await json(app, 'PUT', '/api/admin/library/navidrome', { token: tokens.admin, body: { url: nd.url, username: 'admin', password: 'pw' } });
  assert.equal(set.status, 200, JSON.stringify(set.body));

  const r = await json(app, 'POST', '/api/discover/match', { token: tokens.kid, body: { songs } });
  assert.equal(r.body.ready, true);
  assert.equal(r.body.server, nd.url);
  assert.equal(r.body.total, 4);
  assert.deepEqual(r.body.songs.map((s: { id: string } | null) => s?.id ?? null), ['a1', 'a2', 'a3', null]);
  assert.deepEqual(r.body.songs[0], { id: 'a1', title: 'Espresso', artist: 'Sabrina Carpenter', album: 'Short n’ Sweet', albumId: 'al1', duration: 175, coverArt: 'al-al1', explicitStatus: 'clean' });

  // listed once, then answered from memory
  await json(app, 'POST', '/api/discover/match', { token: tokens.member, body: { songs } });
  assert.equal(nd.lists(), 1);

  assert.equal((await json(app, 'POST', '/api/discover/match', { body: { songs } })).status, 401);
  assert.equal((await json(app, 'POST', '/api/discover/match', { token: tokens.member, body: { songs: 'nope' } })).status, 400);
  assert.equal((await json(app, 'POST', '/api/discover/match', { token: tokens.member, body: { songs: Array(301).fill(songs[0]) } })).status, 400);
});

test('cleanTitle drops the same extras as the app', () => {
  assert.equal(cleanTitle('01 - Song (feat. X) [Remastered 2011]'), cleanTitle('Song'));
  assert.equal(cleanTitle('Song (Radio Edit)'), 'song');
});

test('chart movement compares with the snapshot from about a week ago', () => {
  const k = (n: string) => `a|${n}`;
  // first day: nothing to compare with
  assert.deepEqual(computeMoves('2026-11-02', [k('x'), k('y')], []), { since: null, moves: [{ prev: null, weeks: 1 }, { prev: null, weeks: 1 }] });
  // second day: compared with the day before
  assert.deepEqual(computeMoves('2026-11-03', [k('y'), k('x'), k('z')], [{ day: '2026-11-02', keys: [k('x'), k('y')] }]).moves.map((m) => m.prev), [2, 1, null]);
  // with older snapshots, the newest one at least 7 days old is the baseline
  const earlier = [
    { day: '2026-10-20', keys: [k('x'), k('z')] },
    { day: '2026-10-26', keys: [k('z'), k('x')] },
    { day: '2026-11-01', keys: [k('y')] },
  ];
  const m = computeMoves('2026-11-03', [k('x'), k('y'), k('z')], earlier);
  assert.equal(m.since, '2026-10-26');
  assert.deepEqual(m.moves.map((x) => x.prev), [2, null, 1]);
  // weeks in a row (a week counts when any snapshot that week had the song): x and z were in this week (Nov 2–8),
  // Oct 26–Nov 1 and Oct 19–25; y only this week and last
  assert.deepEqual(m.moves.map((x) => x.weeks), [3, 2, 3]);
  // a week the song missed breaks the run
  assert.deepEqual(computeMoves('2026-11-03', [k('z')], [{ day: '2026-10-20', keys: [k('z')] }, { day: '2026-10-27', keys: [k('x')] }]).moves[0].weeks, 1);
});

test('chart snapshots are kept per day, shared by everyone, and pruned', async () => {
  const db = openDb(':memory:');
  let now = Date.parse('2026-10-26T12:00:00Z');
  const h = new ChartHistory(db, () => now);
  const s = (t: string) => ({ title: t, artist: 'Band' });
  assert.equal(h.record('billboard:all', [s('One'), s('Two')]).since, null);
  // later the same day replaces it
  h.record('billboard:all', [s('Two'), s('One')]);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM chart_history').get() as { n: number }).n, 1);
  now += 7 * 86_400_000;
  const r = h.record('billboard:all', [s('One (feat. Guest)'), s('Three'), s('Two')]);
  assert.equal(r.since, '2026-10-26');
  assert.deepEqual(r.moves, [{ prev: 2, weeks: 2 }, { prev: null, weeks: 1 }, { prev: 1, weeks: 2 }]);
  assert.equal(chartSongKey(s('One (feat. Guest)')), chartSongKey({ title: 'One', artist: 'Band Featuring Guest' }));
  // half a year on, the old ones are gone
  now += 200 * 86_400_000;
  h.record('billboard:all', [s('One')]);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM chart_history').get() as { n: number }).n, 1);
});

test('positions route records and answers; only for signed-in people', async () => {
  const { app, tokens } = await seeded();
  const body = { chart: 'apple:pop', songs: [{ title: 'A', artist: 'B' }] };
  const r = await json(app, 'POST', '/api/discover/positions', { token: tokens.kid, body });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { since: null, moves: [{ prev: null, weeks: 1 }] });
  assert.equal((await json(app, 'POST', '/api/discover/positions', { body })).status, 401);
  assert.equal((await json(app, 'POST', '/api/discover/positions', { token: tokens.member, body: { songs: [] } })).status, 400);
});

const look: MixLookups = {
  related: async (a) => (a === 'Drake' ? ['Future', 'Lil Baby', 'Travis Scott'] : []),
  top: async () => [],
};

test('For you ranks chart songs by the artists you play, follow, and ones like them', async () => {
  const { app, db, tokens, ids } = await seeded({}, {}, { mixLookups: look });
  const now = Date.now();
  const play = db.prepare("INSERT INTO plays (user_id, played_at, title, artist, album, seconds, track) VALUES (?, ?, 's', ?, 'al', 180, '{}')");
  for (let i = 0; i < 8; i++) play.run(ids.member, now - i * 60_000, 'Drake');
  play.run(ids.member, now - 9 * 60_000, 'SZA');
  db.prepare("INSERT INTO follows (user_id, artist_id, name, followed_at) VALUES (?, 1, 'Doechii', 0)").run(ids.member);

  const songs = [
    { title: 'x', artist: 'Taylor Swift' },
    { title: 'x', artist: 'Metro Boomin, Future & Travis Scott' },
    { title: 'x', artist: 'SZA' },
    { title: 'x', artist: 'Drake Featuring 21 Savage' },
    { title: 'x', artist: 'Doechii' },
  ];
  const r = await json(app, 'POST', '/api/discover/foryou', { token: tokens.member, body: { songs } });
  assert.equal(r.status, 200);
  assert.equal(r.body.basis, 9);
  const s = r.body.scores as { score: number; because?: string }[];
  assert.equal(s[0].score, 0);
  assert.equal(s[1].because, 'Like Drake');
  assert.equal(s[2].because, 'You play SZA');
  assert.equal(s[3].because, 'You play Drake');
  assert.equal(s[4].because, 'You follow Doechii');
  assert.ok(s[3].score > s[2].score && s[2].score > s[1].score && s[1].score > 0);

  // someone who plays nothing gets nothing
  const kid = await json(app, 'POST', '/api/discover/foryou', { token: tokens.kid, body: { songs } });
  assert.equal(kid.body.basis, 0);
  assert.ok(kid.body.scores.every((x: { score: number }) => x.score === 0));
});

test('creditedArtists splits features', async () => {
  assert.deepEqual(creditedArtists('Metro Boomin, Future & Travis Scott'), ['Metro Boomin', 'Future', 'Travis Scott']);
  const db = openDb(':memory:');
  assert.deepEqual(await forYou(db, 1, [], look), { basis: 0, scores: [] });
});
