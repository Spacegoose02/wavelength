import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyse, SR, keyOf } from '../src/sonic/analyse.ts';

/** clicks at `bpm` plus a C-major triad drone */
function song(bpm: number, seconds: number, notes: number[]) {
  const s = new Float32Array(SR * seconds);
  const period = Math.round((60 / bpm) * SR);
  for (let i = 0; i < s.length; i++) {
    let v = 0;
    for (const f of notes) v += 0.15 * Math.sin((2 * Math.PI * f * i) / SR);
    const into = i % period;
    if (into < 400) v += (Math.random() * 2 - 1) * (1 - into / 400) * 0.8;
    s[i] = v;
  }
  return s;
}

test('finds the tempo and key of a simple song', () => {
  const a = analyse(song(128, 20, [261.63, 329.63, 392.0]));
  assert.ok(Math.abs(a.bpm - 128) < 2, `bpm ${a.bpm}`);
  assert.equal(a.key, 'C major');
  const b = analyse(song(92, 20, [220, 261.63, 329.63]));
  assert.ok(Math.abs(b.bpm - 92) < 2, `bpm ${b.bpm}`);
  assert.equal(b.key, 'A minor');
  assert.ok(a.beatStrength > 0.1);
});

test('key profiles', () => {
  const g = [1, 0, 0.3, 0, 0.5, 0.2, 0.1, 0.9, 0, 0.4, 0, 0.6]; // heavy on G, D, B, C
  assert.match(keyOf(g.map((_, i) => g[(i + 5) % 12])), /major|minor/);
});

test('analyses library songs and finds ones that sound alike, journeys and features', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { json, seeded } = await import('./helpers.ts');
  const musicDir = mkdtempSync(join(tmpdir(), 'wl-sonic-'));
  const { app, db, tokens } = await seeded({}, { musicDir });
  const worker = (app as any).hubSonic as import('../src/sonic/worker.ts').SonicWorker;
  // fast songs in C major, slow ones in A minor
  const lib = [
    ['1', 'Fast One', 'Band A', 128, [261.63, 329.63, 392]],
    ['2', 'Fast Two', 'Band B', 130, [261.63, 329.63, 392]],
    ['3', 'Fast Three', 'Band C', 126, [261.63, 329.63, 392]],
    ['4', 'Slow One', 'Band D', 80, [220, 261.63, 329.63]],
    ['5', 'Slow Two', 'Band E', 82, [220, 261.63, 329.63]],
  ] as const;
  const audio = new Map(lib.map(([id, , , bpm, notes]) => [`/music/${id}.flac`, song(bpm, 12, [...notes])]));
  worker.decodeFn = async (file) => audio.get(`/music/${file.split('/').pop()}`)!;
  for (const [id, title, artist] of lib) {
    writeFileSync(join(musicDir, `${id}.flac`), '');
    db.prepare('INSERT INTO sonic_songs (id, path, title, artist, album, duration) VALUES (?, ?, ?, ?, ?, ?)').run(id, `/music/${id}.flac`, title, artist, 'X', 200);
  }
  // off until an admin turns it on
  assert.equal((await json(app, 'GET', '/api/sonic/similar?id=1', { token: tokens.member })).status, 403);
  await json(app, 'PUT', '/api/admin/features', { token: tokens.admin, body: { features: { sonic: { on: true } } } });
  for (const [id] of lib) await worker.analyseOne({ id, path: `/music/${id}.flac`, duration: 200 });

  const sim = await json(app, 'GET', '/api/sonic/similar?artist=Band A&title=Fast One', { token: tokens.member });
  assert.equal(sim.status, 200, JSON.stringify(sim.body));
  assert.deepEqual(sim.body.songs.slice(0, 2).map((s: any) => s.title).sort(), ['Fast Three', 'Fast Two']);
  assert.ok(Math.abs(sim.body.song.bpm - 128) < 2);

  const j = await json(app, 'GET', '/api/sonic/journey?from=1&to=5&steps=4', { token: tokens.member });
  assert.equal(j.body.songs[0].title, 'Fast One');
  assert.equal(j.body.songs.at(-1).title, 'Slow Two');
  assert.equal(j.body.songs.length, 4);

  const look = await json(app, 'POST', '/api/sonic/lookup', { token: tokens.member, body: { songs: [{ id: '4' }, { artist: 'Nobody', title: 'Nothing' }] } });
  assert.equal(look.body.features[0].key, 'A minor');
  assert.equal(look.body.features[1], null);

  assert.equal((await json(app, 'GET', '/api/admin/sonic', { token: tokens.member })).status, 403);
  const st = await json(app, 'GET', '/api/admin/sonic', { token: tokens.admin });
  assert.equal(st.body.analysed, 5);
  assert.match(st.body.blocked, /Navidrome admin login/);
});
