/**
 * When a critter shows off: each act has one flourish (a banjo spin, a record-scratch hands-up, the rapper
 * pushing up the shades, …), drawn by the act's own `frame` from `RigFrame.flourish`. This decides when:
 *
 * - **A new song starts** while playing (not the first song after the scene opens, so switching to the scene
 *   doesn't trigger one).
 * - **A solo**: the song has synced lyrics, a line was sung, and now the gap since it has run for 2.5 s with
 *   the band going strong. One per gap.
 *
 * At most one every 12 s, so a run of short songs or a choppy instrumental doesn't loop it. Pure apart from its
 * own state, for tests (src/test/tempo.test.ts).
 */

export interface FlourishInput {
  t: number;
  /** the playing song's key ("source:id"), or '' */
  track: string;
  playing: boolean;
  /** synced-lyrics state now (singingReading.line) */
  line: 'sung' | 'gap' | 'none';
  /** 0..1, how loud the band is */
  energy: number;
}

/** How long a flourish lasts, s. */
export const FLOURISH_SECS = 1.4;
const COOLDOWN = 12;
const SOLO_AFTER = 2.5;

export function createFlourish() {
  let track: string | undefined;
  let start = -Infinity;
  let gapSince: number | undefined;
  let sang = false;
  let soloDone = false;

  /** 0 when not flourishing, else how far through it is, 0..1 (just above 0 on its first frame). */
  return (f: FlourishInput): number => {
    let fire = false;
    if (track === undefined) track = f.track;
    else if (f.track !== track) {
      track = f.track;
      sang = false;
      gapSince = undefined;
      if (f.playing && f.track) fire = true;
    }

    if (f.line === 'sung') {
      sang = true;
      gapSince = undefined;
      soloDone = false;
    } else if (f.line === 'gap' && sang) {
      gapSince ??= f.t;
      if (!soloDone && f.playing && f.t - gapSince >= SOLO_AFTER && f.energy > 0.3) {
        soloDone = true;
        fire = true;
      }
    } else gapSince = undefined;

    if (fire && f.t - start >= COOLDOWN) start = f.t;
    const p = (f.t - start) / FLOURISH_SECS;
    return p >= 0 && p <= 1 ? Math.max(1e-3, p) : 0;
  };
}

/**
 * The flourish's motion curve, 0 → 1 with a little wind-up first (anticipation): it dips back over the first
 * fifth, then eases through the move.
 */
export function windUp(p: number): number {
  if (p <= 0) return 0;
  if (p < 0.2) return -0.12 * Math.sin((p / 0.2) * Math.PI);
  const x = Math.min(1, (p - 0.2) / 0.8);
  return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
}

/** Out and back over the flourish: 0 → 1 → 0. */
export const swell = (p: number) => (p > 0 ? Math.sin(Math.min(1, p) * Math.PI) : 0);
