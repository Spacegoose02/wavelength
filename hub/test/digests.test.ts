import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Digests } from '../src/digests.ts';
import { json, seeded } from './helpers.ts';

const song = (title: string, artist: string, duration = 180) => ({ id: title, sourceId: 'nd', kind: 'track', title, artist, album: 'LP', duration });

test('kid reports go to parents on Monday, and everyone gets their month on the 1st, once each', async () => {
  const { app, db, tokens, ids } = await seeded();
  await json(app, 'PUT', `/api/admin/users/${ids.kid}/guardians`, { token: tokens.admin, body: { ids: [ids.member] } });
  const at = (iso: string) => Date.parse(iso);
  // the kid's week: Mon 19 – Sun 25 October 2026
  const plays = [
    { playedAt: at('2026-10-19T15:00:00Z'), track: song('A', 'Bluey') },
    { playedAt: at('2026-10-19T15:05:00Z'), track: song('B', 'Bluey feat. Bingo') },
    { playedAt: at('2026-10-21T15:00:00Z'), track: song('C', 'Kidz Bop', 7200) },
  ];
  assert.equal((await json(app, 'POST', '/api/me/history', { token: tokens.kid, body: { plays } })).status, 200);

  let now = at('2026-10-20T09:00:00Z');
  const d = new Digests(db, { now: () => now });
  assert.deepEqual(d.run(), { kidReports: 0, monthly: 0 }, 'a new Hub starts counting from here');
  now = at('2026-10-26T07:00:00Z');
  assert.deepEqual(d.run(), { kidReports: 0, monthly: 0 }, 'not before 08:00');
  now = at('2026-10-26T08:30:00Z');
  assert.deepEqual(d.run(), { kidReports: 1, monthly: 0 });
  assert.deepEqual(d.run(), { kidReports: 0, monthly: 0 }, 'once a week');

  const parent = (await json(app, 'GET', '/api/notifications?after=0', { token: tokens.member })).body.notifications;
  const report = parent.find((n: { kind: string }) => n.kind === 'report');
  assert.match(report.title, /’s week$/);
  assert.equal(report.body, '3 songs, 36 minutes on 2 days. Most played: Bluey, Kidz Bop', 'a long song counts 30 minutes, features fold in');
  assert.equal((await json(app, 'GET', '/api/notifications?after=0', { token: tokens.admin })).body.notifications.filter((n: { kind: string }) => n.kind === 'report').length, 0, 'admins only when there’s no parent');

  now = at('2026-11-01T09:00:00Z');
  assert.deepEqual(d.run(), { kidReports: 0, monthly: 1 });
  const kid = (await json(app, 'GET', '/api/notifications?after=0', { token: tokens.kid })).body.notifications;
  assert.equal(kid[0].kind, 'rewind');
  assert.equal(kid[0].title, 'Your October in music');
  assert.match(kid[0].body, /^36 minutes, 3 songs\. Most played: Bluey/);
  assert.deepEqual(d.run(), { kidReports: 0, monthly: 0 });
});
