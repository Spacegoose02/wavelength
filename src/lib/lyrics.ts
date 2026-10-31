/**
 * Lyrics for Now Playing. Navidrome's own (OpenSubsonic `getLyricsBySongId`, from the files' tags or .lrc files
 * next to them) when the song is from Navidrome and has some, else LRCLIB (lrclib.net: free, no key, sends CORS
 * headers so it works in a browser too). Synced lyrics come as timed lines for the karaoke highlight; plain ones
 * as lines without times.
 *
 * Kid profiles get lyrics with strong language masked (`maskForKids`): a clean version of a song plays the
 * edited audio, but LRCLIB only has the original words.
 */
import { getJson, qs } from './http';
import type { Track } from '../sources/types';

export interface LyricLine {
  /** seconds; undefined for plain (unsynced) lyrics */
  time?: number;
  text: string;
}

export interface Lyrics {
  lines: LyricLine[];
  synced: boolean;
  instrumental?: boolean;
  /** where they came from, shown under the lyrics */
  source: string;
}

/** `[01:23.45]Line` (several stamps per line allowed, `[mm:ss]`/`[mm:ss.x]`/`[mm:ss:xx]`); `[ar:…]` tags are skipped. */
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  // `[offset:+500]` (ms, positive = lyrics come earlier) applies to the whole file wherever it sits
  const off = /^\[offset:\s*([+-]?\d+)\]/im.exec(lrc);
  const offset = off ? Number(off[1]) / 1000 : 0;
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const text = raw.slice(stamps[stamps.length - 1].index! + stamps[stamps.length - 1][0].length).trim();
    for (const m of stamps) {
      const frac = m[3] ? Number(m[3]) / 10 ** m[3].length : 0;
      out.push({ time: Math.max(0, Number(m[1]) * 60 + Number(m[2]) + frac - offset), text });
    }
  }
  return out.sort((a, b) => a.time! - b.time!);
}

export const plainLines = (text: string): LyricLine[] => text.split(/\r?\n/).map((l) => ({ text: l.trim() }));

/** Index of the line being sung at `t` seconds (-1 before the first). */
export function currentLine(lines: LyricLine[], t: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((lines[mid].time ?? Infinity) <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

// Strong words only; mild ones ("hell", "damn") stay, as on radio edits. Matches word starts so "fucking" is caught.
const STRONG = /\b(f+u+c+k\w*|motherf\w*|sh[i1]t\w*|b[i1]tch\w*|c+u+n+t\w*|n[i1]gg\w*|a+s+s+h+o+l+e\w*|d[i1]ck(?:s|head\w*)?\b|pussy\w*|wh[o0]re\w*|fag(?:s|got\w*)?\b|slut\w*|cock(?:s|sucker\w*)?\b)/gi;

export function maskForKids(text: string): string {
  return text.replace(STRONG, (w) => w[0] + '•'.repeat(Math.max(2, w.length - 1)));
}

interface LrcLibHit {
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  duration?: number;
}

function fromLrcLib(hit: LrcLibHit): Lyrics | undefined {
  if (hit.instrumental) return { lines: [], synced: false, instrumental: true, source: 'LRCLIB' };
  if (hit.syncedLyrics) return { lines: parseLrc(hit.syncedLyrics), synced: true, source: 'LRCLIB' };
  if (hit.plainLyrics) return { lines: plainLines(hit.plainLyrics), synced: false, source: 'LRCLIB' };
  return undefined;
}

const LRCLIB = 'https://lrclib.net/api';
const clean = (s = '') => s.replace(/\s*[([](feat|ft|with|clean|explicit|remaster)[^)\]]*[)\]]/gi, '').trim();

async function lrclib(t: Pick<Track, 'title' | 'artist' | 'album' | 'duration'>): Promise<Lyrics | undefined> {
  const title = clean(t.title);
  const artist = t.artist.split(/\s*(?:,|&| feat\.? | ft\.? )\s*/i)[0];
  // exact lookup first (title + artist + album + duration within 2 s), then a search
  try {
    const params: Record<string, string> = { track_name: title, artist_name: artist };
    if (t.album) params.album_name = clean(t.album);
    if (t.duration) params.duration = String(Math.round(t.duration));
    const hit = await getJson<LrcLibHit>(`${LRCLIB}/get?${qs(params)}`);
    const got = fromLrcLib(hit);
    if (got) return got;
  } catch {
    /* 404 when there's no exact match */
  }
  const list = await getJson<LrcLibHit[]>(`${LRCLIB}/search?${qs({ track_name: title, artist_name: artist })}`).catch(() => []);
  // prefer synced, and a length close to ours
  const near = (h: LrcLibHit) => (t.duration && h.duration ? Math.abs(h.duration - t.duration) : 0);
  const best = list
    .filter((h) => !t.duration || !h.duration || near(h) < 10)
    .sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics) || near(a) - near(b))[0];
  return best ? fromLrcLib(best) : undefined;
}

/** A source that can give lyrics itself (Navidrome). */
export interface LyricsSource {
  getLyrics?(track: Track): Promise<Lyrics | undefined>;
}

const cache = new Map<string, Promise<Lyrics | undefined>>();

/** Lyrics for a song, or undefined when nobody has them. Cached per song for the session. */
export function lyricsFor(t: Track, source?: LyricsSource): Promise<Lyrics | undefined> {
  const key = `${t.sourceId}:${t.id}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => (await source?.getLyrics?.(t).catch(() => undefined)) ?? (await lrclib(t)))();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
