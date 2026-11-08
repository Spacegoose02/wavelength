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

const hasWords = (h: LrcLibHit) => !h.instrumental && !NO_VOCALS.test(`${h.trackName ?? ''} ${h.albumName ?? ''}`) && !!(h.syncedLyrics || h.plainLyrics);

/**
 * How an LRCLIB entry compares with the song. Names are compared without version notes (`norm`): the same name, or
 * one inside the other when the shorter is most of the longer ("Hello" in "Hello Again" isn't; "Zoo" in "Zoo York"
 * isn't). The artist must be one of the song's (either way round, so "Drake" matches "Drake, Future") when LRCLIB
 * names one.
 */
function matchers(t: Pick<Track, 'duration'>, queries: LyricsQuery[]) {
  const wants = [...new Set(queries.map((q) => norm(q.title)).filter(Boolean))];
  const artists = [...new Set(queries.flatMap((q) => artistVariants(q.artist).map((a) => norm(cleanArtist(a)))).filter(Boolean))];
  const sameName = (h: LrcLibHit) => {
    const got = norm(h.trackName);
    return !!got && wants.includes(got);
  };
  const nameOk = (h: LrcLibHit) => {
    const got = norm(h.trackName);
    return (
      !!got &&
      wants.some((want) => {
        if (got === want) return true;
        const [short, long] = got.length < want.length ? [got, want] : [want, got];
        return short.length >= 3 && short.length >= long.length * 0.6 && long.includes(short);
      })
    );
  };
  const artistOk = (h: LrcLibHit) => {
    if (!h.artistName || !artists.length) return true;
    const theirs = artistVariants(cleanArtist(h.artistName)).map(norm).filter(Boolean);
    return theirs.some((a) => artists.some((b) => a === b || (Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a)))));
  };
  const near = (h: LrcLibHit) => (t.duration && h.duration ? Math.abs(h.duration - t.duration) : 0);
  return { sameName, nameOk, artistOk, near };
}

/**
 * LRCLIB has several entries for most songs, some marked instrumental (an instrumental or karaoke upload filed
 * under the song's name, or a wrong flag), so one instrumental entry doesn't settle it: every lookup is pooled
 * and an entry with words wins. "Instrumental" is the answer only when the song's own name says so, or when
 * nothing matching has words but an entry for it is marked instrumental. Throws when LRCLIB couldn't be reached.
 */
async function lrclib(t: Pick<Track, 'title' | 'artist' | 'album' | 'duration'>, queries: LyricsQuery[]): Promise<Lyrics | undefined> {
  if (!queries.length) return undefined;
  const { nameOk, artistOk, sameName, near } = matchers(t, queries);
  const lengthOk = (h: LrcLibHit) => near(h) <= 10;
  // a much longer or shorter recording under the same name is another song (an unreleased one, a skit), not a live take
  const tooFar = (h: LrcLibHit) => near(h) > Math.max(60, (t.duration ?? 0) * 0.35);
  // a near name ("Zoo" for "Zoo York") or a different length is only trusted together with the other being right
  const ok = (h: LrcLibHit) => nameOk(h) && artistOk(h) && !tooFar(h) && (sameName(h) || lengthOk(h));

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
      .filter((h) => hasWords(h) && ok(h))
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
  if (pool.some((h) => h.instrumental && nameOk(h) && artistOk(h) && lengthOk(h))) return INSTRUMENTAL('LRCLIB');
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

/**
 * The house's shared copy on the Hub (hub/src/lyricsCache.ts), set up by lib/sharedLyrics.ts once a Hub is signed in:
 * lyrics another device already found come from there in one call, and what this device finds goes back to it.
 * Kept out of this file so the lookup itself doesn't depend on the Hub.
 */
export interface SharedLyrics {
  get(key: string): Promise<Lyrics | null | undefined>;
  put(key: string, artist: string, title: string, lyrics: Lyrics): void;
}
let shared: SharedLyrics | undefined;
export function setSharedLyrics(s: SharedLyrics | undefined) {
  shared = s;
}

/** The Hub's key for a song's lyrics: its cleaned-up artist and title, and its length to 10 s (synced times differ by take). */
export function sharedKey(t: Pick<Track, 'title' | 'artist' | 'duration'> & { trackNumber?: number }): string | undefined {
  const [q] = lyricQueries(t);
  if (!q) return undefined;
  return `${norm(q.artist)}|${norm(q.title)}|${t.duration ? Math.round(t.duration / 10) : ''}`;
}

/** A source that can give lyrics itself (Navidrome). */
export interface LyricsSource {
  getLyrics?(track: Track): Promise<Lyrics | undefined>;
}

const cache = new Map<string, Promise<Lyrics | undefined>>();

/**
 * The lyrics picked for this song with "Wrong lyrics?", else the server's own, else LRCLIB, else lyrics.ovh. Throws when LRCLIB couldn't be reached and nothing else
 * had them, so the caller can say so and the miss isn't cached.
 */
async function lookup(t: Track, source?: LyricsSource): Promise<Lyrics | undefined> {
  const mine = lyricsPickFor(t);
  if (mine) return mine.lyrics ?? undefined;
  const key = shared ? sharedKey(t) : undefined;
  const share = (ly: Lyrics) => {
    if (key && (ly.lines.length || ly.instrumental)) shared?.put(key, t.artist, t.title, ly);
    return ly;
  };
  // words without times (a file's plain lyrics tag, or what the Hub kept from lyrics.ovh): LRCLIB may have the
  // same song synced, which follows the song line by line, so it's asked once before settling for them
  const timedIfPossible = async (ly: Lyrics) => {
    if (ly.synced || ly.instrumental || NO_VOCALS.test(t.title)) return undefined;
    const better = await lrclib(t, lyricQueries(t)).catch(() => undefined);
    return better?.synced ? better : undefined;
  };
  const own = await source?.getLyrics?.(t).catch(() => undefined);
  // the server's own go to the Hub too, so the house can search their words
  if (own?.lines.length || own?.instrumental) {
    const better = await timedIfPossible(own);
    return share(better ?? own);
  }
  const fromHub = key ? await shared?.get(key).catch(() => undefined) : undefined;
  if (fromHub) {
    const better = await timedIfPossible(fromHub);
    return better ? share(better) : fromHub;
  }
  const found = await search(t);
  return found && share(found);
}

/** LRCLIB, else lyrics.ovh. */
async function search(t: Track): Promise<Lyrics | undefined> {
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

// ---- "Wrong lyrics?": picking other lyrics for a song, remembered on this device and shared with the house ----

/** What was picked for a song: other lyrics, or `null` for "this song has no lyrics". */
export interface LyricsPick {
  lyrics: Lyrics | null;
  at: number;
}

const PICK = 'wl.lyricsPick.';
/** By the song itself, and by its name and length so the same song from another source gets the pick too. */
const pickKeys = (t: Track) => [`${t.sourceId}:${t.id}`, sharedKey(t)].filter((k): k is string => !!k).map((k) => PICK + k);
const picked = new Set<(songKey: string) => void>();

/** The pick for a song, if one was made on this device. */
export function lyricsPickFor(t: Track): LyricsPick | undefined {
  for (const k of pickKeys(t)) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) return JSON.parse(raw) as LyricsPick;
    } catch {
      /* no storage, or a broken entry: no pick */
    }
  }
  return undefined;
}

function changed(t: Track) {
  const k = `${t.sourceId}:${t.id}`;
  cache.delete(k);
  for (const fn of picked) fn(k);
}

/**
 * Remember other lyrics for a song (or `null`: it has none). Other lyrics also go to the Hub's shared copy, so they
 * replace the wrong ones for the whole house.
 */
export function setLyricsPick(t: Track, lyrics: Lyrics | null) {
  const value = JSON.stringify({ lyrics, at: Date.now() } satisfies LyricsPick);
  for (const k of pickKeys(t)) {
    try {
      localStorage.setItem(k, value);
    } catch {
      /* storage full: this session only, through the cache below */
    }
  }
  const key = sharedKey(t);
  if (lyrics && key && (lyrics.lines.length || lyrics.instrumental)) shared?.put(key, t.artist, t.title, lyrics);
  changed(t);
  // without storage the pick still holds for this session
  if (!lyricsPickFor(t)) cache.set(`${t.sourceId}:${t.id}`, Promise.resolve(lyrics ?? undefined));
}

/** Forget the pick: the song's lyrics are looked up again. */
export function clearLyricsPick(t: Track) {
  for (const k of pickKeys(t)) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* nothing kept */
    }
  }
  changed(t);
}

/** Called with the song's `sourceId:id` whenever its lyrics are picked or the pick is forgotten. */
export function onLyricsPicked(fn: (songKey: string) => void): () => void {
  picked.add(fn);
  return () => picked.delete(fn);
}

/** Lyrics typed or pasted in: LRC (`[01:23.45]Line`) when it has times, else plain lines. */
export function pastedLyrics(text: string): Lyrics | undefined {
  const timedLines = parseLrc(text);
  if (timedLines.some((l) => l.text)) return { lines: timedLines, synced: true, source: 'pasted in' };
  const lines = text.trim() ? plainLines(text.trim().replace(/\n{3,}/g, '\n\n')) : [];
  return lines.length ? { lines, synced: false, source: 'pasted in' } : undefined;
}

/** One LRCLIB entry to choose from. */
export interface LyricsCandidate {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  /** what the song would get: synced when the entry has times and is about the song's length */
  lyrics: Lyrics;
  /** the entry has times, even if they don't fit this recording */
  hasTimes: boolean;
  /** with its times kept, for an entry of another length (the times may be off; "Lyrics timing" can shift them) */
  timedAnyway?: Lyrics;
  /** the automatic lookup would accept it (name, artist and length agree) */
  likely: boolean;
}

/**
 * LRCLIB entries with words for a song, the likeliest first: searches by its name and artist, or by `query` (any
 * words, like LRCLIB's own search box) when given. Throws when LRCLIB couldn't be reached.
 */
export async function lyricsCandidates(t: Track, query?: string): Promise<LyricsCandidate[]> {
  const queries = lyricQueries(t);
  const searches: Record<string, string>[] = query?.trim()
    ? [{ q: query.trim() }]
    : [...queries.slice(0, 2).map((q) => ({ track_name: q.title, artist_name: q.artist })), ...(queries[0] ? [{ q: `${queries[0].artist} ${queries[0].title}` }] : [])];
  const pool: LrcLibHit[] = [];
  let answered = 0;
  let failed: unknown;
  await Promise.all(
    searches.map(async (params) => {
      try {
        const res = await getJson<LrcLibHit[]>(`${LRCLIB}/search?${qs(params)}`, timed());
        answered++;
        if (Array.isArray(res)) pool.push(...res);
      } catch (e) {
        if (is404(e)) answered++;
        else failed = e;
      }
    }),
  );
  if (!answered && failed) throw failed;
  const { nameOk, artistOk, sameName, near } = matchers(t, queries);
  const seen = new Set<string>();
  const out: LyricsCandidate[] = [];
  for (const h of pool) {
    if (!hasWords(h)) continue;
    const text = h.syncedLyrics || h.plainLyrics || '';
    const id = h.id !== undefined ? String(h.id) : `${h.artistName}|${h.trackName}|${text.length}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const fits = near(h) <= 10;
    const lyrics = fromLrcLib(h, fits);
    if (!lyrics?.lines.some((l) => l.text)) continue;
    out.push({
      id,
      title: h.trackName ?? '',
      artist: h.artistName ?? '',
      album: h.albumName || undefined,
      duration: h.duration,
      lyrics,
      hasTimes: !!h.syncedLyrics,
      timedAnyway: h.syncedLyrics && !lyrics.synced ? fromLrcLib(h, true) : undefined,
      likely: nameOk(h) && artistOk(h) && (sameName(h) || fits) && near(h) <= 60,
    });
  }
  const score = (c: LyricsCandidate) => near({ duration: c.duration });
  return out.sort((a, b) => Number(b.likely) - Number(a.likely) || score(a) - score(b) || Number(b.lyrics.synced) - Number(a.lyrics.synced));
}
