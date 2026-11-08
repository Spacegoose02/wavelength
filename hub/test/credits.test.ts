import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { creditNames, tidyCredit } from '../src/credits.ts';
import { creditedArtists } from '../src/forYou.ts';
import { primaryArtist as kidPrimary } from '../src/kidSafe.ts';
import { primaryArtist } from '../src/radar.ts';
import { readTags } from '../src/tags.ts';
import { json, seeded } from './helpers.ts';

function audio(file: string, tags: Record<string, string>) {
  const meta = Object.entries(tags).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '1', '-c:a', 'libmp3lame', '-b:a', '64k', ...meta, '-y', file]);
}
const tick = () => new Promise((r) => setTimeout(r, 20));

test('joined credits get the "; " Navidrome splits on', () => {
  assert.equal(tidyCredit('Lil Wayne;Drake'), 'Lil Wayne; Drake');
  assert.equal(tidyCredit('Lil Wayne ; Drake;Future'), 'Lil Wayne; Drake; Future');
  assert.equal(tidyCredit('Lil Wayne；Drake'), 'Lil Wayne; Drake');
  assert.equal(tidyCredit('Drake;'), 'Drake');
  assert.equal(tidyCredit('Lil Wayne; Drake'), 'Lil Wayne; Drake');
  assert.equal(tidyCredit('AC/DC'), 'AC/DC');
  // the same artist twice is them once
  assert.equal(tidyCredit('Lil Durk;Lil Durk'), 'Lil Durk');
  assert.equal(tidyCredit('Lil Durk; lil durk;J. Cole'), 'Lil Durk; J. Cole');
  assert.equal(tidyCredit('Lil Durk Lil Durk'), 'Lil Durk');
  assert.equal(tidyCredit('Lil Durk Lil Durk;Lil Durk'), 'Lil Durk');
  assert.equal(tidyCredit('Duran Duran'), 'Duran Duran');
  assert.equal(tidyCredit('Talk Talk;Drake'), 'Talk Talk; Drake');
});

test('a credit splits the same with or without the space', () => {
  for (const s of ['Lil Wayne;Drake', 'Lil Wayne; Drake', 'Lil Wayne / Drake']) {
    assert.equal(primaryArtist(s), 'Lil Wayne', s);
    assert.equal(kidPrimary(s), 'Lil Wayne', s);
    assert.deepEqual(creditedArtists(s), ['Lil Wayne', 'Drake'], s);
  }
  assert.equal(primaryArtist('AC/DC'), 'AC/DC');
});

test('new downloads get their joined credits split before the scan; older music and hand edits stay', async () => {
  const music = mkdtempSync(join(tmpdir(), 'wl-credits-'));
  mkdirSync(join(music, 'Old'), { recursive: true });
  audio(join(music, 'Old/01.mp3'), { title: 'Old', artist: 'Lil Wayne;Drake' });
  await tick();
  const { app, tokens } = await seeded({}, { musicDir: music });
  await tick();

  assert.equal((await json(app, 'GET', '/api/admin/credits', { token: tokens.member })).status, 403);
  assert.deepEqual((await json(app, 'GET', '/api/admin/credits', { token: tokens.admin })).body, { auto: true });

  mkdirSync(join(music, 'New'), { recursive: true });
  audio(join(music, 'New/01.mp3'), { title: 'A', artist: 'Lil Wayne;Drake', album_artist: 'Lil Wayne;Drake' });
  audio(join(music, 'New/02.mp3'), { title: 'B', artist: 'Lil Wayne; Drake' });
  audio(join(music, 'New/03.mp3'), { title: 'C', artist: 'Nicki;Drake' });
  const hand = await json(app, 'PUT', '/api/admin/tags', { token: tokens.admin, body: { changes: [{ path: 'New/03.mp3', tags: { artist: 'Nicki;Drake;' } }] } });
  assert.equal(hand.status, 200);

  app.hubLibrary.downloaded();
  await app.hubLibrary.tidy();
  const a = await readTags(join(music, 'New/01.mp3'));
  assert.equal(a.artist, 'Lil Wayne; Drake');
  assert.equal(a.albumArtist, 'Lil Wayne; Drake');
  assert.equal((await readTags(join(music, 'New/02.mp3'))).artist, 'Lil Wayne; Drake');
  assert.equal((await readTags(join(music, 'New/03.mp3'))).artist, 'Nicki;Drake;', 'a hand edit stays');
  assert.equal((await readTags(join(music, 'Old/01.mp3'))).artist, 'Lil Wayne;Drake', 'music from before is for Library care');
  const hist = await json(app, 'GET', '/api/admin/tags/history', { token: tokens.admin });
  const edit = hist.body.edits.find((e: { label: string }) => e.label === 'Artist credits of new downloads');
  assert.equal(edit.files, 1);
  assert.equal((await json(app, 'POST', `/api/admin/tags/undo/${edit.batch}`, { token: tokens.admin })).body.undone, 1);
  assert.equal((await readTags(join(music, 'New/01.mp3'))).artist, 'Lil Wayne;Drake');

  // off: left as they come
  assert.equal((await json(app, 'PUT', '/api/admin/credits', { token: tokens.admin, body: { auto: 'no' } })).status, 400);
  assert.deepEqual((await json(app, 'PUT', '/api/admin/credits', { token: tokens.admin, body: { auto: false } })).body, { auto: false });
  await tick();
  audio(join(music, 'New/04.mp3'), { title: 'D', artist: 'Future;Drake' });
  app.hubLibrary.downloaded();
  await app.hubLibrary.tidy();
  assert.equal((await readTags(join(music, 'New/04.mp3'))).artist, 'Future;Drake');
});

test('creditNames lists each artist in a credit, keeping duos whose names nobody records alone', () => {
  const solo = new Set(['lil durk', 'lil baby', 'drake']);
  const known = (n: string) => solo.has(n.toLowerCase());
  assert.deepEqual(creditNames('Lil Durk • J. Cole', known), ['Lil Durk', 'J. Cole']);
  assert.deepEqual(creditNames('Calboy;Meek Mill;Lil Durk', known), ['Calboy', 'Meek Mill', 'Lil Durk']);
  assert.deepEqual(creditNames('DJ Khaled feat. Lil Baby & Lil Durk', known), ['DJ Khaled', 'Lil Baby', 'Lil Durk']);
  assert.deepEqual(creditNames('Lil Baby & Lil Durk', known), ['Lil Baby', 'Lil Durk']);
  assert.deepEqual(creditNames('Polo G (feat. Lil Durk)', known), ['Polo G', 'Lil Durk']);
  assert.deepEqual(creditNames('Drake ft. Drake', known), ['Drake']);
  assert.deepEqual(creditNames('Simon & Garfunkel', known), ['Simon & Garfunkel']);
  assert.deepEqual(creditNames('Tyler, The Creator', known), ['Tyler, The Creator']);
  assert.deepEqual(creditNames('AC/DC', known), ['AC/DC']);
  assert.deepEqual(creditNames('Lil Durk;Lil Durk', known), ['Lil Durk']);
  assert.deepEqual(creditNames('Lil Durk Lil Durk', known), ['Lil Durk']);
});
