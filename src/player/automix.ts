import type { Track } from '../sources/types';

/**
 * AutoMix (Settings → Playback): how to go from one song to the next, instead of one fixed crossfade.
 *
 * - The next song on the **same album, straight after** this one (including disc 1's last song into disc 2's
 *   first): no fade at all (gapless), so live albums, DJ mixes and segues stay as recorded.
 * - Both songs analysed by the Hub (lib/sonic.ts) with a **clear beat at close tempos** (within 8%, or at half
 *   or double): an 8-beat blend that starts on a beat of this song, with the next song nudged to this song's
 *   tempo for the blend (pitch kept) and eased back afterwards.
 * - Otherwise a fade whose length follows the music: short between energetic songs, longer between calm ones.
 */

export interface SoundInfo {
  bpm: number;
  beatStrength: number;
  /** seconds into the song of a beat (analysis offset + beat phase) */
  beatAt: number;
  energy: number;
}

export interface Transition {
  /** 0 = gapless, no fade */
  seconds: number;
  /** the next song's playback rate during the blend (1 = as is) */
  rate: number;
  /** start the blend on a beat of this song: beat period and a beat time in the song */
  beat?: { period: number; at: number };
  why: 'album' | 'beatmatch' | 'energy' | 'plain';
}

/** `b` comes straight after `a` on the same album: the next song on the disc, or the first song of the next disc. */
const sameAlbumNext = (a: Track, b: Track) => {
  if (!a.albumId || a.albumId !== b.albumId || a.sourceId !== b.sourceId || !a.trackNumber || !b.trackNumber) return false;
  const discA = a.discNumber ?? 1, discB = b.discNumber ?? 1;
  return discB === discA ? b.trackNumber === a.trackNumber + 1 : discB === discA + 1 && b.trackNumber === 1;
};

/** The tempo ratio that lines `b` up with `a` (b × ratio ≈ a), counting half and double time; null if too far. */
export function tempoRatio(a: number, b: number): number | null {
  for (const m of [1, 2, 0.5]) {
    const r = a / (b * m);
    if (Math.abs(r - 1) <= 0.08) return a / b / m;
  }
  return null;
}

export function planTransition(cur: Track, next: Track, a: SoundInfo | null, b: SoundInfo | null, fallback: number): Transition {
  if (sameAlbumNext(cur, next)) return { seconds: 0, rate: 1, why: 'album' };
  if (a && b && a.beatStrength >= 0.15 && b.beatStrength >= 0.15) {
    const r = tempoRatio(a.bpm, b.bpm);
    if (r !== null) {
      const period = 60 / a.bpm;
      // the next song plays at a.bpm / b.bpm (in half/double terms) during the blend, at most ±6%
      const rate = Math.min(1.06, Math.max(0.94, Math.abs(r - 1) < 0.08 ? r : 1));
      return { seconds: Math.min(12, Math.max(3, period * 8)), rate: Math.round(rate * 1000) / 1000, beat: { period, at: a.beatAt }, why: 'beatmatch' };
    }
  }
  if (a && b) {
    const energy = (a.energy + b.energy) / 2;
    return { seconds: Math.round((9 - energy * 6) * 10) / 10, rate: 1, why: 'energy' };
  }
  return { seconds: fallback || 6, rate: 1, why: 'plain' };
}

/** Seconds from `now` to the next beat (beats at `at + k × period`). */
export function toNextBeat(now: number, beat: { period: number; at: number }): number {
  const k = Math.ceil((now - beat.at) / beat.period);
  return Math.max(0, beat.at + k * beat.period - now);
}
