/**
 * A steady beat for the critters (components/critters/rig.ts), from the jumpy bass "beats" the analyser
 * detects (player/analysis.ts).
 *
 * The raw beats are hits: they fire on kicks, miss quiet ones and add extras on busy bass lines, so a head
 * that nods on each one bobs unevenly. This tracker turns them into a metronome that keeps going between hits:
 *
 * - **Tempo.** The gaps between recent hits (any pair less than 2 s apart) are folded into one octave,
 *   0.4–0.8 s (75–150 BPM), and voted into 10 ms bins; the winning bin is the beat period. Folding makes
 *   a kick on every other beat, or a busy eighth-note bass, vote for the same tempo.
 * - **Phase.** Each hit near a predicted beat (within a fifth of a period) pulls the grid a third of the way
 *   toward it. Hits that land near the grid build up confidence; ones that don't, and silence, wear it down.
 * - **Locked** once confidence is high: the rig then bobs on the grid instead of on raw hits. Unlocked, or
 *   with no readable audio, the grid free-runs at its last tempo, so `phase` and `index` are always usable.
 */

export interface Tempo {
  /** beats per minute of the grid */
  bpm: number;
  /** 0..1 through the current beat (0 = on the beat) */
  phase: number;
  /** beats since the tracker started: index % 4 is the beat in the bar (assuming 4/4) */
  index: number;
  /** true on the frame a new beat starts */
  on: boolean;
  /** the grid is following the music (enough hits landed on it recently) */
  locked: boolean;
}

/** The fold range for beat periods, s: 75 to 150 BPM. */
const MIN_PERIOD = 0.4;
const MAX_PERIOD = 0.8;

/** A gap between hits folded into the fold range by doubling or halving. */
export function foldPeriod(gap: number): number {
  if (!(gap > 0)) return NaN;
  while (gap < MIN_PERIOD) gap *= 2;
  while (gap >= MAX_PERIOD) gap /= 2;
  return gap;
}

/** The beat period the gaps between `hits` (times, s, ascending) vote for, or null with too few. */
export function estimatePeriod(hits: number[]): number | null {
  if (hits.length < 4) return null;
  const bins = new Float32Array(Math.round((MAX_PERIOD - MIN_PERIOD) * 100) + 1);
  for (let i = 0; i < hits.length; i++)
    for (let j = i + 1; j < hits.length; j++) {
      const gap = hits[j] - hits[i];
      if (gap > 2) break;
      const p = foldPeriod(gap);
      const b = Math.round((p - MIN_PERIOD) * 100);
      // a little spread to the neighbours, so jittery hits still pile up in one place
      bins[b] += 1;
      if (b > 0) bins[b - 1] += 0.5;
      if (b < bins.length - 1) bins[b + 1] += 0.5;
    }
  let best = 0;
  for (let b = 1; b < bins.length; b++) if (bins[b] > bins[best]) best = b;
  return bins[best] > 0 ? MIN_PERIOD + best / 100 : null;
}

export function createTempo(startBpm = 100) {
  let period = 60 / startBpm;
  let last: number | undefined;
  let index = 0;
  let confidence = 0;
  let lastHit = -Infinity;
  const hits: number[] = [];

  /** Call every frame with the time (s), whether the analyser saw a beat, and whether the audio is real. */
  return (t: number, hit: boolean, live: boolean): Tempo => {
    if (last === undefined) last = t;
    let on = false;

    if (hit && live) {
      hits.push(t);
      while (hits.length && t - hits[0] > 8) hits.shift();
      const est = estimatePeriod(hits);
      if (est) period += (est - period) * 0.25;
      // how far the hit is from the nearest grid beat
      const k = Math.round((t - last) / period);
      const err = t - (last + k * period);
      if (Math.abs(err) < period * 0.2) {
        last += err * 0.35;
        confidence = Math.min(1, confidence + 0.12);
      } else {
        confidence = Math.max(0, confidence - 0.08);
      }
      lastHit = t;
    }
    // silence, or audio we can't read, wears confidence down over a few seconds
    if (!live || t - lastHit > 2.5) confidence = Math.max(0, confidence - 1 / 180);

    while (t - last >= period) {
      last += period;
      index++;
      on = true;
    }
    return { bpm: 60 / period, phase: Math.min(1, Math.max(0, (t - last) / period)), index, on, locked: live && confidence >= 0.5 };
  };
}
