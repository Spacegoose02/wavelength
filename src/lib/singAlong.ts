/**
 * When is someone singing? From the song's synced lyrics (lib/lyrics.ts: Navidrome's own or LRCLIB), for the
 * critters' mouths: shut through intros, solos and gaps, open only while a line is being sung. On streams the
 * app can't read, the mouths also keep time with the words in each line (syllables per second).
 *
 * Lyrics come from the same per-song cache as the Lyrics panel, so this costs no extra lookups.
 */
import { lyricsFor, type LyricLine } from './lyrics';
import type { Track } from '../sources/types';

export interface SungLine {
  start: number;
  end: number;
  syllables: number;
}

/** Rough syllable count: vowel groups per word, at least one per word. */
export function syllables(text: string): number {
  return text
    .toLowerCase()
    .split(/[^a-zà-ÿ']+/)
    .filter(Boolean)
    .reduce((n, w) => n + Math.max(1, (w.replace(/e$/, '').match(/[aeiouyà-ÿ]+/g) ?? []).length), 0);
}

/**
 * Sung spans from synced lines. A line runs from its time until the next line, but not longer than its words
 * take to sing (≈ 0.32 s a syllable plus a breath), so a long instrumental gap after a line counts as quiet.
 * Empty lines (often used to mark a break) aren't sung.
 */
export function sungLines(lines: LyricLine[]): SungLine[] {
  const out: SungLine[] = [];
  lines.forEach((l, i) => {
    if (l.time === undefined || !l.text.trim()) return;
    const next = lines[i + 1]?.time ?? l.time + 8;
    const syl = syllables(l.text);
    out.push({ start: l.time, end: Math.min(next, l.time + syl * 0.32 + 0.8), syllables: syl });
  });
  return out;
}

/**
 * The sung line at `t` (with a little slack for lyrics timed a beat early or late), null in a gap, or undefined
 * when the song has no synced lyrics (unknown: let the audio decide).
 */
export function lineAt(sung: SungLine[] | undefined, t: number): SungLine | null | undefined {
  if (!sung) return undefined;
  for (const l of sung) if (t >= l.start - 0.25 && t <= l.end + 0.3) return l;
  return null;
}

let key = '';
let sung: SungLine[] | undefined;

/**
 * The current song's sung spans: `undefined` until (and unless) synced lyrics arrive, `[]` for an instrumental.
 * Starts the lookup the first time it's asked about a song (`source` is only called then).
 */
export function sungLinesFor(track: Track | undefined, source?: () => Parameters<typeof lyricsFor>[1]): SungLine[] | undefined {
  const k = track ? `${track.sourceId}:${track.id}` : '';
  if (k !== key) {
    key = k;
    sung = undefined;
    if (track && track.kind === 'track') {
      lyricsFor(track, source?.())
        .then((ly) => {
          if (key !== k || !ly) return;
          if (ly.instrumental) sung = [];
          else if (ly.synced) sung = sungLines(ly.lines);
        })
        .catch(() => undefined);
    }
  }
  return sung;
}
