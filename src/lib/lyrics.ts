/**
 * Lyrics for Now Playing. Navidrome's own (OpenSubsonic `getLyricsBySongId`, from the files' tags or .lrc files
 * next to them) when the song is from Navidrome and has some, else LRCLIB (lrclib.net: free, no key, sends CORS
 * headers so it works in a browser too), else plain lyrics from lyrics.ovh. Synced lyrics come as timed lines for the karaoke highlight; plain ones
 * as lines without times.
 *
 * Kid profiles get lyrics with strong language masked (`maskForKids`): a clean version of a song plays the
 * edited audio, but LRCLIB only has the original words.
 */
import { getJson, qs } from './http';
import type { Track } from '../sources/types';
import { looseWithoutTrackNumber, withoutTrackNumber } from './trackTitles';

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
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  duration?: number;
}

const LRCLIB = 'https://lrclib.net/api';
const LYRICS_OVH = 'https://api.lyrics.ovh/v1';
/** Each request gives up after this long, so a slow service can't leave the lyrics spinning. */
const TIMEOUT_MS = 10_000;
/**
 * Words that mark a version or an upload of a song rather than a different song: "(2011 Remaster)",
 * "- Radio Edit", "(feat. X)", and YouTube's "(Official Music Video)", "[Lyrics]", "(HD)".
 */
const VERSIONY = /\b(feat|ft|featuring|with|clean|explicit|edit|edited|censored|remaster|remastered|radio|single|album version|version|mono|stereo|deluxe|bonus|anniversary|expanded|edition|live|acoustic|unplugged|demo|from|official|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|mv|m\/v)\b|\b(19|20)\d\d\b/i;
/** Recordings without the words (LRCLIB marks them `instrumental`, often filed under the plain song name). */
const NO_VOCALS = /\b(instrumental|karaoke|backing track|minus one)\b/i;

/** A song or album name without version notes, so it matches LRCLIB's: "Song (feat. X) - 2011 Remaster" → "Song". */
export function cleanTitle(s = ''): string {
  return s
    .replace(/\s*[([]([^)\]]*)[)\]]/g, (m, inner: string) => (VERSIONY.test(inner) ? '' : m))
    .replace(/\s+[-–—|]\s+(.*)$/, (m, tail: string) => (VERSIONY.test(tail) ? '' : m))
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s.*$/i, '')
    .trim();
}

/** An artist without what YouTube channels add: "Adele - Topic", "AdeleVEVO", "Adele Official". */
export function cleanArtist(s = ''): string {
  return s
    .replace(/\s*-\s*topic$/i, '')
    .replace(/\s*vevo$/i, '')
    .replace(/\s+official$/i, '')
    .trim();
}

/** For comparing names: lower case, no accents, letters and digits only. */
const norm = (s = '') =>
  cleanTitle(s)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^\p{L}\p{N}]+/gu, '');

/** The full artist ("Simon & Garfunkel") first, then the first-listed one ("Drake" of "Drake, Future"). */
export function artistVariants(artist = ''): string[] {
  const first = artist.split(/\s*(?:,|;|\/|&| x | feat\.? | ft\.? | featuring | with )\s*/i)[0].trim();
  return [...new Set([artist.trim(), first].filter(Boolean))];
}

export interface LyricsQuery {
  artist: string;
  title: string;
}

const UNKNOWN = /^(unknown( artist)?|various artists|n\/a|-)?$/i;

/**
 * The artist + title pairs to look a song up by, best first. Besides the tags as they are (cleaned), a title like
 * "Adele - Hello" from a YouTube download is also read as artist "Adele", title "Hello", first when the
 * artist tag is missing or names the same artist (or its channel). A track number written in front of the
 * title ("04 - Hello") is left out.
 */
export function lyricQueries(t: Pick<Track, 'title' | 'artist'> & { trackNumber?: number }): LyricsQuery[] {
  // "04 - Song" from a renaming tool: the number isn't part of the name (lib/trackTitles.ts)
  const title = cleanTitle(t.trackNumber ? withoutTrackNumber(t.title, t.trackNumber) : looseWithoutTrackNumber(t.title));
  const artist = cleanArtist(t.artist);
  const out: LyricsQuery[] = UNKNOWN.test(artist) ? [] : artistVariants(artist).map((a) => ({ artist: a, title }));
  const split = /^(.+?)\s+[-–—|]\s+(.+)$/.exec(title);
  if (split) {
    const q = { artist: cleanArtist(split[1]), title: cleanTitle(split[2]) };
    const [a, b] = [norm(artist), norm(q.artist)];
    const same = !a || (!!b && (a.includes(b) || b.includes(a)));
    if (same) out.unshift(q);
    else out.push(q);
  }
  const seen = new Set<string>();
  return out.filter((q) => q.title && !seen.has(`${q.artist}\n${q.title}`) && !!seen.add(`${q.artist}\n${q.title}`));
}

function fromLrcLib(hit: LrcLibHit, timed = true): Lyrics | undefined {
  if (hit.syncedLyrics && timed) return { lines: parseLrc(hit.syncedLyrics), synced: true, source: 'LRCLIB' };
  if (hit.plainLyrics) return { lines: plainLines(hit.plainLyrics), synced: false, source: 'LRCLIB' };
  // a different length (a live take, say): the words are right but the times aren't
  if (hit.syncedLyrics) return { lines: parseLrc(hit.syncedLyrics).map((l) => ({ text: l.text })), synced: false, source: 'LRCLIB' };
  return undefined;
}

const INSTRUMENTAL = (source: string): Lyrics => ({ lines: [], synced: false, instrumental: true, source });
const is404 = (e: unknown) => /^404\b/.test((e as Error)?.message ?? '');
const timed = (): RequestInit => (typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(TIMEOUT_MS) } : {});

/**
 * LRCLIB has several entries for most songs, some marked instrumental (an instrumental or karaoke upload filed
 * under the song's name, or a wrong flag), so one instrumental entry doesn't settle it: every lookup is pooled
 * and an entry with words wins. "Instrumental" is the answer only when the song's own name says so, or when
 * nothing matching has words but an entry for it is marked instrumental. Throws when LRCLIB couldn't be reached.
 */
async function lrclib(t: Pick<Track, 'title' | 'artist' | 'album' | 'duration'>, queries: LyricsQuery[]): Promise<Lyrics | undefined> {
  if (!queries.length) return undefined;
  const wants = queries.map((q) => norm(q.title)).filter(Boolean);
  const near = (h: LrcLibHit) => (t.duration && h.duration ? Math.abs(h.duration - t.duration) : 0);
  const nameOk = (h: LrcLibHit) => {
    const got = norm(h.trackName);
    return !!got && wants.some((want) => got === want || (Math.min(got.length, want.length) >= 3 && (got.includes(want) || want.includes(got))));
  };
  const lengthOk = (h: LrcLibHit) => near(h) <= 10;
  const words = (h: LrcLibHit) => !h.instrumental && !NO_VOCALS.test(`${h.trackName ?? ''} ${h.albumName ?? ''}`) && !!(h.syncedLyrics || h.plainLyrics);

  const pool: LrcLibHit[] = [];
  let answered = 0;
  let failed: unknown;
  const ask = async (path: string, params: Record<string, string>) => {
    try {
      const res = await getJson<LrcLibHit | LrcLibHit[]>(`${LRCLIB}/${path}?${qs(params)}`, timed());
      answered++;
      pool.push(...(Array.isArray(res) ? res : [res]));
    } catch (e) {
      if (is404(e)) answered++; // no exact match
      else failed = e;
    }
  };
  const best = () =>
    pool
      .filter((h) => words(h) && nameOk(h))
      .sort((a, b) => Number(lengthOk(b)) - Number(lengthOk(a)) || Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics) || near(a) - near(b))[0];
  const settled = () => {
    const b = best();
    return !!b && lengthOk(b) && !!b.syncedLyrics;
  };

  // exact lookup (title + artist + album + length within 2 s), then searches by fields, then a free-text search
  const [first] = queries;
  if (t.duration) {
    const params: Record<string, string> = { track_name: first.title, artist_name: first.artist, duration: String(Math.round(t.duration)) };
    if (t.album) params.album_name = cleanTitle(t.album);
    await ask('get', params);
  }
  for (const q of queries) if (!settled()) await ask('search', { track_name: q.title, artist_name: q.artist });
  if (!settled()) await ask('search', { q: `${first.artist} ${first.title}` });

  const hit = best();
  if (hit) return fromLrcLib(hit, lengthOk(hit));
  if (pool.some((h) => h.instrumental && nameOk(h) && lengthOk(h))) return INSTRUMENTAL('LRCLIB');
  if (!answered && failed) throw failed;
  return undefined;
}

/**
 * lyrics.ovh (free, no key, CORS open): plain lyrics only, from other lyric sites, for songs LRCLIB doesn't have.
 * Its replies can start with a French "Paroles de la chanson … par …" heading; section labels like "[Chorus]"
 * are dropped too.
 */
async function lyricsOvh(queries: LyricsQuery[]): Promise<Lyrics | undefined> {
  let failed: unknown;
  for (const q of queries.slice(0, 2)) {
    try {
      const res = await getJson<{ lyrics?: string }>(`${LYRICS_OVH}/${encodeURIComponent(q.artist)}/${encodeURIComponent(q.title)}`, timed());
      const text = (res.lyrics ?? '')
        .replace(/^Paroles de la chanson .* par .*\r?\n/i, '')
        .split(/\r?\n/)
        .filter((l) => !/^\s*\[[^\]]*\]\s*$/.test(l))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (text) return { lines: plainLines(text), synced: false, source: 'lyrics.ovh' };
    } catch (e) {
      if (!is404(e)) failed = e;
    }
  }
  if (failed) throw failed;
  return undefined;
}

/** A source that can give lyrics itself (Navidrome). */
export interface LyricsSource {
  getLyrics?(track: Track): Promise<Lyrics | undefined>;
}

const cache = new Map<string, Promise<Lyrics | undefined>>();

/**
 * The server's own lyrics, else LRCLIB, else lyrics.ovh. Throws when LRCLIB couldn't be reached and nothing else
 * had them, so the caller can say so and the miss isn't cached.
 */
async function lookup(t: Track, source?: LyricsSource): Promise<Lyrics | undefined> {
  const own = await source?.getLyrics?.(t).catch(() => undefined);
  if (own?.lines.length || own?.instrumental) return own;
  if (NO_VOCALS.test(t.title)) return INSTRUMENTAL('LRCLIB');
  const queries = lyricQueries(t);
  let failed: unknown;
  const found = await lrclib(t, queries).catch((e) => {
    failed = e;
    return undefined;
  });
  if (found) return found;
  const plain = await lyricsOvh(queries).catch(() => undefined);
  if (plain) return plain;
  if (failed) throw failed;
  return undefined;
}

/** Lyrics for a song, or undefined when nobody has them. Cached per song for the session. */
export function lyricsFor(t: Track, source?: LyricsSource): Promise<Lyrics | undefined> {
  const key = `${t.sourceId}:${t.id}`;
  let p = cache.get(key);
  if (!p) {
    p = lookup(t, source);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
