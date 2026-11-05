import { describe, expect, it } from 'vitest';
import { createTempo, estimatePeriod, foldPeriod } from '../player/tempo';

/** Runs the tracker at 60 fps over `secs`, with hits at `hitAt(t)` (rounded to the frame). */
function run(secs: number, hits: number[], live = true, startBpm = 100) {
  const tempo = createTempo(startBpm);
  const queue = [...hits].sort((a, b) => a - b);
  const beats: number[] = [];
  let out = tempo(0, false, live);
  for (let f = 1; f <= secs * 60; f++) {
    const t = f / 60;
    let hit = false;
    while (queue.length && queue[0] <= t) {
      queue.shift();
      hit = true;
    }
    out = tempo(t, hit, live);
    if (out.on) beats.push(t);
  }
  return { out, beats };
}

/** A pseudo-random but repeatable jitter, ±`ms`. */
const jitter = (i: number, ms: number) => (Math.sin(i * 12.9898) * 43758.5453 % 1) * (ms / 1000);

describe('tempo tracker', () => {
  it('folds gaps into one octave', () => {
    expect(foldPeriod(0.25)).toBeCloseTo(0.5);
    expect(foldPeriod(1)).toBeCloseTo(0.5);
    expect(foldPeriod(0.6)).toBeCloseTo(0.6);
  });
  it('estimates the period from hits, ignoring missing and doubled ones', () => {
    expect(estimatePeriod([0, 0.5, 1, 1.5])).toBeCloseTo(0.5, 2);
    // a kick on every other beat at 120 BPM, plus a stray hit
    expect(estimatePeriod([0, 1, 2, 2.3, 3, 4])).toBeCloseTo(0.5, 2);
    expect(estimatePeriod([0, 1])).toBeNull();
  });
  it('locks onto 120 BPM from jittery hits with gaps and extras', () => {
    const hits: number[] = [];
    for (let i = 0; i < 40; i++) {
      if (i % 7 === 3) continue; // a missed kick now and then
      hits.push(1 + i * 0.5 + jitter(i, 20));
      if (i % 9 === 5) hits.push(1 + i * 0.5 + 0.27); // an extra off-beat hit
    }
    const { out, beats } = run(22, hits);
    expect(out.locked).toBe(true);
    expect(out.bpm).toBeGreaterThan(116);
    expect(out.bpm).toBeLessThan(124);
    // the last few grid beats land within 50 ms of the music's beats (1 + i * 0.5)
    for (const b of beats.slice(-6)) {
      const off = Math.abs(((b - 1) / 0.5 - Math.round((b - 1) / 0.5)) * 0.5);
      expect(off).toBeLessThan(0.05);
    }
  });
  it('keeps the beat going between hits and through a short break', () => {
    const hits = Array.from({ length: 24 }, (_, i) => i * 0.6);
    const { beats } = run(20, hits);
    // after the hits stop (at 13.8 s) the grid carries on at 100 BPM
    const late = beats.filter((b) => b > 15);
    expect(late.length).toBeGreaterThanOrEqual(7);
    for (let i = 1; i < late.length; i++) expect(late[i] - late[i - 1]).toBeCloseTo(0.6, 1);
  });
  it('unlocks in silence and free-runs at its start tempo without audio', () => {
    const hits = Array.from({ length: 20 }, (_, i) => i * 0.5);
    expect(run(10, hits).out.locked).toBe(true);
    expect(run(20, hits).out.locked).toBe(false);
    const { out, beats } = run(6, [], false, 90);
    expect(out.locked).toBe(false);
    expect(beats.length).toBeGreaterThanOrEqual(8);
    expect(out.bpm).toBeCloseTo(90);
  });
});

describe('flourishes', async () => {
  const { createFlourish, windUp, FLOURISH_SECS } = await import('../components/critters/flourish');
  const base = { track: 'a', playing: true, line: 'none' as const, energy: 0.5 };
  it('fire on a new song, not on the first one, and not again within the cooldown', () => {
    const f = createFlourish();
    expect(f({ ...base, t: 0 })).toBe(0);
    expect(f({ ...base, t: 1 })).toBe(0);
    expect(f({ ...base, t: 2, track: 'b' })).toBeGreaterThan(0);
    expect(f({ ...base, t: 2 + FLOURISH_SECS / 2, track: 'b' })).toBeCloseTo(0.5);
    expect(f({ ...base, t: 2 + FLOURISH_SECS + 0.1, track: 'b' })).toBe(0);
    expect(f({ ...base, t: 5, track: 'c' })).toBe(0); // too soon after the last one
    expect(f({ ...base, t: 20, track: 'd' })).toBeGreaterThan(0);
  });
  it('fire once in a loud gap after a sung line (a solo)', () => {
    const f = createFlourish();
    f({ ...base, t: 0, line: 'sung' });
    expect(f({ ...base, t: 1, line: 'gap' })).toBe(0);
    expect(f({ ...base, t: 3.6, line: 'gap' })).toBeGreaterThan(0);
    expect(f({ ...base, t: 20, line: 'gap' })).toBe(0); // same gap: no second one
    // a quiet gap (a breath, a soft bridge) doesn't count
    const q = createFlourish();
    q({ ...base, t: 0, line: 'sung' });
    q({ ...base, t: 1, line: 'gap', energy: 0.1 });
    expect(q({ ...base, t: 5, line: 'gap', energy: 0.1 })).toBe(0);
  });
  it('wind up a little before the move', () => {
    expect(windUp(0.1)).toBeLessThan(0);
    expect(windUp(0.6)).toBeGreaterThan(0.3);
    expect(windUp(1)).toBeCloseTo(1);
  });
});
