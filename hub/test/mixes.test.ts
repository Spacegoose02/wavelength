import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clusterArtists, type MixLookups } from '../src/mixes.ts';
import { json, seeded } from './helpers.ts';

const DAY = 86_400_000;
const RELATED: Record<string, string[]> = {
  drake: ['Future', 'Lil Baby', 'Travis Scott'],
  future: ['Drake', 'Young Thug'],
  adele: ['Sam Smith', 'Lewis Capaldi', 'Ed Sheeran'],
  'sam smith': ['Adele'],
};
const look: MixLookups = {
  related: async (a) => RELATED[a.toLowerCase()] ?? [],
  top: async (a, kid) => [
    { title: `${a} hit`, artist: a },
    ...(kid ? [] : [{ title: `${a} explicit hit`, artist: a }]),
  ],
};

function play(db: any, userId: number, at: number, title: string, artist: string) {
  db.prepare('INSERT OR IGNORE INTO plays (user_id, played_at, title, artist, album, seconds, track) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(userId, at, title, artist, 'Album', 200, JSON.stringify({ kind: 'track', id: title, sourceId: 'nd', title, artist, coverUrl: 'https://x/c.jpg' }));
}

test('clusters related artists together', () => {
  const rel = new Map(Object.entries(RELATED));
  assert.deepEqual(clusterArtists(['Drake', 'Adele', 'Future', 'Sam Smith'], rel, 4), [['Drake', 'Future'], ['Adele', 'Sam Smith']]);
});

test('makes Made for you mixes from plays, once a day, and Blends between people who said yes', async () => {
  const { app, db, tokens, ids } = await seeded({}, {}, { mixLookups: look });
  const now = Date.now();
  let at = now - 10 * DAY;
  // recent favourites
  for (let i = 0; i < 4; i++) for (const [t, a] of [['One', 'Drake'], ['Two', 'Drake'], ['Three', 'Future'], ['Four', 'Adele'], ['Five', 'Sam Smith'], ['Six', 'Drake'], ['Seven', 'Future'], ['Eight', 'Adele'], ['Nine', 'Adele'], ['Ten', 'Sam Smith']]) play(db, ids.member, (at += 60_000), t, a);
  // loved two years ago, not since
  for (let i = 0; i < 5; i++) ['Old A', 'Old B', 'Old C', 'Old D', 'Old E'].forEach((t, j) => play(db, ids.member, now - 700 * DAY + i * DAY + j * 1000, t, 'Oldies'));

  const r = await json(app, 'GET', '/api/mixes', { token: tokens.member });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const byId = Object.fromEntries(r.body.mixes.map((m: any) => [m.id, m]));
  assert.ok(byId['on-repeat'], 'On Repeat');
  assert.equal(byId['on-repeat'].songs[0].track.sourceId, 'nd', 'played songs keep their track');
  assert.ok(byId['forgotten'] && byId['time-capsule'], 'old favourites');
  assert.ok(byId['discover-weekly'].songs.some((s: any) => s.artist === 'Lil Baby'), 'related artists not played yet');
  assert.ok(!byId['discover-weekly'].songs.some((s: any) => s.artist === 'Future'), 'not ones already played');
  const daily = r.body.mixes.filter((m: any) => m.kind === 'daily');
  assert.equal(daily.length, 2);
  assert.match(daily[0].description, /Drake and Future/);

  // kept for the day
  const again = await json(app, 'GET', '/api/mixes', { token: tokens.member });
  assert.equal(again.body.builtAt, r.body.builtAt);

  // kids get no explicit suggestions
  for (let i = 0; i < 3; i++) for (const [t, a] of [['One', 'Drake'], ['Two', 'Future']]) play(db, ids.kid, now - DAY + i * 1000 + (t === 'One' ? 0 : 500), t, a);
  const kid = await json(app, 'GET', '/api/mixes', { token: tokens.kid });
  assert.ok(!JSON.stringify(kid.body).includes('explicit hit'));

  // switched off → 403
  await json(app, 'PUT', '/api/admin/features', { token: tokens.admin, body: { features: { homeMixes: { on: false } } } });
  assert.equal((await json(app, 'GET', '/api/mixes', { token: tokens.member })).status, 403);

  // Blend: both have to say yes
  play(db, ids.admin, now - DAY, 'Admin song', 'Drake');
  assert.equal((await json(app, 'GET', `/api/blend?with=${ids.admin}`, { token: tokens.member })).status, 409);
  await json(app, 'PUT', '/api/blend/optin', { token: tokens.member, body: { on: true } });
  assert.equal((await json(app, 'GET', `/api/blend?with=${ids.admin}`, { token: tokens.member })).status, 409, 'the other person too');
  await json(app, 'PUT', '/api/blend/optin', { token: tokens.admin, body: { on: true } });
  const people = await json(app, 'GET', '/api/blend/people', { token: tokens.member });
  assert.ok(people.body.people.some((p: any) => p.id === ids.admin && p.optedIn));
  assert.ok(!people.body.people.some((p: any) => p.id === ids.kid), 'not someone else’s kid');
  const b = await json(app, 'GET', `/api/blend?with=${ids.admin}`, { token: tokens.member });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.ok(b.body.mix.songs.some((s: any) => s.because === 'You both play this artist'));
  assert.equal((await json(app, 'GET', `/api/blend?with=${ids.kid}`, { token: tokens.member })).status, 404);
});

test('"Don\'t play this" keeps artists and songs out of mixes, even ones made earlier today', async () => {
  const { app, db, tokens, ids } = await seeded({}, {}, { mixLookups: look });
  const now = Date.now();
  let at = now - 5 * DAY;
  for (let i = 0; i < 4; i++) for (const [t, a] of [['One', 'Drake'], ['Two', 'Drake'], ['Three', 'Future'], ['Four', 'Adele (Live)'], ['Five', 'Adele']]) play(db, ids.member, (at += 60_000), t, a);
  const before = await json(app, 'GET', '/api/mixes', { token: tokens.member });
  const all = (b: any) => b.mixes.flatMap((m: any) => m.songs) as { artist: string; title: string }[];
  assert.ok(all(before.body).some((s) => s.artist === 'Drake'));
  assert.ok(all(before.body).some((s) => s.title === 'Five'));
  const put = await json(app, 'PUT', '/api/me/prefs', { token: tokens.member, body: { changes: { 'settings.dontPlay': { value: { artists: ['drake'], songs: [{ artist: 'Adele', title: 'Five (Remastered)' }] }, updatedAt: Date.now() } } } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const after = await json(app, 'GET', '/api/mixes', { token: tokens.member });
  assert.equal(after.body.builtAt, before.body.builtAt, 'the same mixes, filtered');
  assert.ok(!all(after.body).some((s) => s.artist === 'Drake'));
  assert.ok(!all(after.body).some((s) => s.title === 'Five'));
  assert.ok(all(after.body).some((s) => s.artist === 'Future'));
});

test('daylist: the part of the day in the listener’s own time zone, with late night counting as the day before', async () => {
  const { dayPart, DAY_PARTS } = await import('../src/mixes.ts');
  // Saturday 2026-11-07 22:30 in New York (UTC-5, getTimezoneOffset 300) is Sunday 03:30 UTC
  const sat = Date.UTC(2026, 10, 8, 3, 30);
  assert.deepEqual(dayPart(sat, 300), { part: DAY_PARTS.length - 1, weekday: 6, date: '2026-11-07' });
  assert.equal(DAY_PARTS[dayPart(sat, 300).part].name, 'night');
  // 02:00 Sunday local is still Saturday late night
  const late = Date.UTC(2026, 10, 8, 7, 0);
  assert.deepEqual(dayPart(late, 300), { part: 0, weekday: 6, date: '2026-11-07' });
  // 08:00 Monday is early morning (5–8)
  assert.equal(DAY_PARTS[dayPart(Date.UTC(2026, 10, 9, 8, 0), 0).part].name, 'early morning');
});

test('daylist: songs played at this time of day, named after it, sent first when the app says its time zone', async () => {
  const { daylist } = await import('../src/mixes.ts');
  const now = Date.UTC(2026, 10, 7, 23, 0); // Saturday 23:00 UTC
  const rows: any[] = [];
  const add = (at: number, title: string, artist: string) => rows.push({ played_at: at, title, artist, album: '', seconds: 200, track: '{}' });
  for (let w = 1; w <= 6; w++) {
    for (let i = 0; i < 10; i++) add(now - w * 7 * DAY + i * 60_000, `Night ${i}`, i % 2 ? 'SZA' : 'Drake'); // Saturday nights
    for (let i = 0; i < 10; i++) add(now - w * 7 * DAY - 14 * 3_600_000 + i * 60_000, `Morning ${i}`, 'Adele'); // Saturday mornings
  }
  const d = daylist(rows, now, 0, (s) => (s.artist === 'SZA' || s.artist === 'Drake' ? 'chill' : undefined));
  assert.ok(d);
  assert.equal(d.kind, 'daylist');
  assert.equal(d.name, 'daylist: chill Saturday night');
  assert.ok(d.songs.every((s) => s.title.startsWith('Night')));
  assert.equal(daylist(rows.slice(0, 3), now), null);

  const { app, db, tokens, ids } = await seeded({}, {}, { mixLookups: look });
  const t = Date.now();
  for (let i = 0; i < 12; i++) for (let w = 0; w < 3; w++) play(db, ids.member, t - w * 7 * DAY - i * 60_000 - 3_600_000 * 0, `Song ${i}`, 'Drake');
  const r = await json(app, 'GET', `/api/mixes?tz=${new Date().getTimezoneOffset()}`, { token: tokens.member });
  assert.equal(r.status, 200);
  assert.equal(r.body.mixes[0].kind, 'daylist');
  const old = await json(app, 'GET', '/api/mixes', { token: tokens.member });
  assert.ok(!old.body.mixes.some((m: any) => m.kind === 'daylist'));
});
