import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.ts';
import { json, seeded } from './helpers.ts';

const song = (title: string, artist: string, album = 'LP', duration = 180) => ({ id: title, sourceId: 'nd', kind: 'track', title, artist, album, duration });
const at = (iso: string) => Date.parse(iso);

test('Rewind adds up a year and a month of plays in the person’s own time zone', async () => {
  const { app, tokens } = await seeded();
  const plays = [
    // 2025, so "new artists" can tell who's new in 2026
    { playedAt: at('2025-12-30T12:00:00Z'), track: song('Old', 'Daft Punk') },
    { playedAt: at('2026-01-01T03:00:00Z'), track: song('One More Time', 'Daft Punk', 'Discovery') }, // still Dec 31 in New York
    { playedAt: at('2026-03-02T20:00:00Z'), track: song('One More Time', 'Daft Punk', 'Discovery') },
    { playedAt: at('2026-03-03T20:00:00Z'), track: song('One More Time', 'daft punk', 'Discovery') },
    { playedAt: at('2026-03-04T20:00:00Z'), track: song('Midnight City', 'M83', 'Hurry Up', 240) },
    { playedAt: at('2026-03-04T21:00:00Z'), track: song('Wait', 'M83', 'Hurry Up', 240) },
    { playedAt: at('2026-07-04T15:00:00Z'), track: { ...song('Radio', 'Station'), kind: 'radio' } },
    { playedAt: at('2026-07-04T16:00:00Z'), track: song('Robot Rock', 'Daft Punk', 'Human After All', 99_999) },
  ];
  assert.equal((await json(app, 'POST', '/api/me/history', { token: tokens.member, body: { plays } })).status, 200);

  const ny = 300; // getTimezoneOffset() in New York in winter
  const y = (await json(app, 'GET', `/api/me/rewind?year=2026&tz=${ny}`, { token: tokens.member })).body;
  assert.equal(y.plays, 5, 'the radio play and the Dec 31 (local) play are left out');
  assert.equal(y.minutes, Math.round((180 * 2 + 240 * 2 + 1800) / 60), 'lengths are capped at 30 minutes');
  assert.deepEqual(y.topArtists.map((a: { artist: string; plays: number }) => [a.artist, a.plays]), [['Daft Punk', 3], ['M83', 2]]);
  assert.equal(y.topSongs[0].title, 'One More Time');
  assert.equal(y.topSongs[0].plays, 2);
  assert.equal(y.favourite.firstPlayedAt, at('2026-01-01T03:00:00Z'), 'first play ever, even before this year');
  assert.deepEqual(y.newArtists, { count: 1, top: [{ artist: 'M83', plays: 2 }] });
  assert.equal(y.byMonth[2], 4);
  assert.equal(y.byHour[15], 3, '20:00 UTC is 15:00 in New York');
  assert.equal(y.busiestDay.day, '2026-03-04');
  assert.equal(y.streak, 3);
  assert.equal(y.daysListened, 4);
  assert.equal(y.playlist.length, 4);

  const mar = (await json(app, 'GET', `/api/me/rewind?year=2026&month=3&tz=${ny}`, { token: tokens.member })).body;
  assert.equal(mar.plays, 4);
  assert.equal(mar.byMonth, null);
  const periods = (await json(app, 'GET', `/api/me/rewind/periods?tz=${ny}`, { token: tokens.member })).body.periods;
  assert.deepEqual(periods.map((p: { year: number; month: number }) => `${p.year}-${p.month}`), ['2026-7', '2026-3', '2025-12']);

  // each person's own
  assert.equal((await json(app, 'GET', '/api/me/rewind?year=2026', { token: tokens.admin })).body.plays, 0);
  assert.equal((await json(app, 'GET', '/api/me/rewind?year=26', { token: tokens.admin })).status, 400);
  assert.equal((await json(app, 'GET', '/api/me/rewind?year=2026')).status, 401);
});

test('history already on the Hub is carried into Rewind when it upgrades', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'wl-rewind-')), 'hub.db');
  const db = openDb(file);
  // back to how a Hub before Rewind left it
  // (migration 13 added plays; later migrations are undone too, so they run again)
  db.exec("DROP TABLE plays; DROP TABLE trash; DROP TABLE notifications; DROP TABLE follows; DROP TABLE radar_artists; DROP TABLE radar_releases; DROP TABLE radar_hidden; DROP TABLE radar_autoget; DROP TABLE scrobble_accounts; DROP TABLE scrobble_queue; DROP TABLE user_totp; DROP TABLE guardians; DROP TABLE household_tracks; DROP TABLE household_playlists; DROP INDEX content_flags_key; ALTER TABLE content_flags DROP COLUMN version; CREATE UNIQUE INDEX content_flags_key ON content_flags(kind, artist COLLATE NOCASE, title COLLATE NOCASE); PRAGMA user_version = 12");
  db.prepare("INSERT INTO users (id, username, display_name, role, created_at, updated_at) VALUES (1, 'a', 'a', 'member', 0, 0)").run();
  db.prepare('INSERT INTO play_history VALUES (1, 5, ?)').run(JSON.stringify(song('Song', 'Band')));
  db.prepare('INSERT INTO play_history VALUES (1, 6, ?)').run(JSON.stringify({ ...song('Live', 'FM'), kind: 'radio' }));
  db.close();
  const up = openDb(file);
  assert.deepEqual(up.prepare('SELECT title, artist, seconds FROM plays').all().map((r) => ({ ...r })), [{ title: 'Song', artist: 'Band', seconds: 180 }]);
  up.close();
});
