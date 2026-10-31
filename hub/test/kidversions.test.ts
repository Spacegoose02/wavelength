import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDb, type Db } from '../src/db.ts';
import { releaseNotForKids, songNotForKids } from '../src/kidSafe.ts';
import { json, seeded } from './helpers.ts';

// An explicit album and its clean version, as Inbox → Clean versions saves it ("… (Clean)", cleanDownloads.ts)
const explicitSM = { artist: 'Rihanna', album: 'Loud', title: 'S&M' };
const cleanSM = { artist: 'Rihanna', album: 'Loud (Clean)', title: 'S&M' };

function rate(db: Db, album: string, explicitTracks: string[] = []) {
  db.prepare("INSERT INTO ratings (kind, artist, album, title, rating, clean_link, checked_at) VALUES ('album', 'Rihanna', ?, '', 'explicit', 'https://www.deezer.com/album/2', 0)").run(album);
  for (const t of explicitTracks) db.prepare("INSERT INTO ratings (kind, artist, album, title, rating, checked_at) VALUES ('track', 'Rihanna', ?, ?, 'explicit', 0)").run(album, t);
}

test('the clean version of a checked explicit album is fine for kids; the explicit one is not', async () => {
  const { db } = await seeded();
  rate(db, 'Loud', ['S&M']);
  assert.equal(songNotForKids(db, explicitSM), true);
  assert.equal(songNotForKids(db, { ...explicitSM, title: 'Only Girl' }), false, 'not in the explicit list');
  assert.equal(songNotForKids(db, cleanSM), false);
  // but a file in the clean folder that is tagged explicit is still explicit
  assert.equal(songNotForKids(db, { ...cleanSM, explicitStatus: 'explicit' }), true);
  // and a file tagged clean isn't held to the album's check
  assert.equal(songNotForKids(db, { ...explicitSM, explicitStatus: 'clean' }), false);
});

test('"OK for kids" on the clean version doesn’t let the explicit one through', async () => {
  const { app, db, tokens } = await seeded();
  rate(db, 'Loud', ['S&M']);
  const set = (body: object) => json(app, 'POST', '/api/admin/flags', { token: tokens.admin, body });

  const song = await set({ kind: 'track', artist: 'Rihanna', title: 'S&M', version: 'clean', verdict: 'allow' });
  assert.equal(song.status, 200, JSON.stringify(song.body));
  assert.equal(song.body.flag.version, 'clean');
  assert.equal(songNotForKids(db, explicitSM), true);
  assert.equal(songNotForKids(db, { ...explicitSM, explicitStatus: 'explicit' }), true);

  // album flags: the clean album's flag, sent with its real title, doesn't touch "Loud"
  await set({ kind: 'album', artist: 'Rihanna', title: 'Loud (Clean)', version: 'clean', verdict: 'allow' });
  assert.equal(songNotForKids(db, explicitSM), true);

  // hiding the clean version hides only it
  await set({ kind: 'album', artist: 'Rihanna', title: 'Loud (Clean)', version: 'clean', verdict: 'block' });
  assert.equal(songNotForKids(db, { ...cleanSM, title: 'Only Girl' }), true);
  assert.equal(songNotForKids(db, { ...explicitSM, title: 'Only Girl' }), false);

  // the explicit one can be let through on purpose, separately
  await set({ kind: 'track', artist: 'Rihanna', title: 'S&M', version: '', verdict: 'allow' });
  assert.equal(songNotForKids(db, explicitSM), false);
  assert.equal(songNotForKids(db, { ...explicitSM, explicitStatus: 'explicit' }), true, 'a file tagged explicit needs its own');

  // "every version", and artists, cover both
  await set({ kind: 'track', artist: 'Rihanna', title: 'Only Girl', version: 'any', verdict: 'block' });
  assert.equal(songNotForKids(db, { ...cleanSM, title: 'Only Girl', album: 'Loud (Clean)' }), true);
  assert.equal(songNotForKids(db, { ...explicitSM, title: 'Only Girl', album: 'Loud' }), true);
  const flags = (await json(app, 'GET', '/api/flags', { token: tokens.kid })).body.flags;
  assert.equal(flags.length, 4, 'one flag per item and version');

  assert.equal((await set({ kind: 'track', artist: 'X', title: 'Y', version: 'sorta', verdict: 'block' })).status, 400);
});

test('apps from before versions: a "(Clean)" title is the clean version, an artist is every version', async () => {
  const { app, tokens } = await seeded();
  const set = (body: object) => json(app, 'POST', '/api/admin/flags', { token: tokens.admin, body });
  assert.equal((await set({ kind: 'album', artist: 'Rihanna', title: 'Loud (Clean)', verdict: 'allow' })).body.flag.version, 'clean');
  assert.equal((await set({ kind: 'album', artist: 'Rihanna', title: 'Loud', verdict: 'block' })).body.flag.version, '');
  assert.equal((await set({ kind: 'artist', artist: 'Rihanna', version: 'clean', verdict: 'block' })).body.flag.version, 'any');
});

test('Release Radar: a kid’s auto-get skips explicit releases and ones hidden from kids', async () => {
  const { app, db, tokens } = await seeded();
  assert.equal(releaseNotForKids(db, { artist: 'Band', title: 'Hits', explicit: true }), true);
  assert.equal(releaseNotForKids(db, { artist: 'Band', title: 'Hits', explicit: false }), false);
  await json(app, 'POST', '/api/admin/flags', { token: tokens.admin, body: { kind: 'artist', artist: 'Band', verdict: 'block' } });
  assert.equal(releaseNotForKids(db, { artist: 'Band', title: 'Hits', explicit: false }), true);
  await json(app, 'POST', '/api/admin/flags', { token: tokens.admin, body: { kind: 'album', artist: 'Band', title: 'Hits (Clean)', version: 'clean', verdict: 'allow' } });
  assert.equal(releaseNotForKids(db, { artist: 'Band', title: 'Hits (Clean)', explicit: false }), false);
  assert.equal(releaseNotForKids(db, { artist: 'Band', title: 'Hits', explicit: true }), true);
});

test('upgrading repairs flags saved before versions', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'wl-flags-')), 'hub.db');
  const db = openDb(file);
  // back to how 0.17.1 left it
  const { user_version: now } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  db.exec(`DROP INDEX content_flags_key; ALTER TABLE content_flags DROP COLUMN version;
    CREATE UNIQUE INDEX content_flags_key ON content_flags(kind, artist COLLATE NOCASE, title COLLATE NOCASE); PRAGMA user_version = ${now - 1}`);
  const flag = db.prepare("INSERT INTO content_flags (kind, artist, title, verdict, created_at) VALUES (?, ?, ?, ?, 0)");
  flag.run('album', 'Rihanna', 'Loud', 'allow'); // set on the clean version, saved under the explicit name
  flag.run('track', 'Rihanna', 'S&M', 'allow');
  flag.run('album', 'Rihanna', 'Loud (Clean)', 'block');
  flag.run('album', 'Band', 'Bad', 'block');
  flag.run('track', 'Band', 'Worse', 'block');
  flag.run('artist', 'Someone', '', 'block');
  rate(db, 'Loud', ['S&M']);
  rate(db, 'Loud (Clean)', ['S&M']); // the library check run on the clean copy found Deezer's explicit album
  db.close();

  const up = openDb(file);
  const versions = Object.fromEntries((up.prepare('SELECT kind, title, version FROM content_flags').all() as { kind: string; title: string; version: string }[]).map((f) => [`${f.kind}:${f.title}`, f.version]));
  assert.deepEqual(versions, {
    'album:Loud': 'clean', 'track:S&M': 'clean', 'album:Loud (Clean)': 'clean', 'album:Bad': '', 'track:Worse': 'any', 'artist:': 'any',
  });
  assert.equal(songNotForKids(up, explicitSM), true, 'the explicit S&M is hidden again');
  assert.equal(songNotForKids(up, { artist: 'Band', album: 'Other', title: 'Worse' }), true);
  assert.equal((up.prepare("SELECT COUNT(*) AS n FROM ratings WHERE album = 'Loud (Clean)'").get() as { n: number }).n, 0);
  assert.ok((up.prepare("SELECT 1 FROM audit WHERE action = 'kids.flagsRepaired'").get()));
  up.close();
});
