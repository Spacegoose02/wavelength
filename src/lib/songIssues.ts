import type { HubTags, HubTagSong } from '../sources/hub';

/**
 * Library care → Unmatched songs (views/LibraryCare.tsx): songs whose tags stop Navidrome from filing them under
 * the right artist or album, found by reading every Navidrome album's tags through the Hub.
 *
 * The main one is a **joined credit**: "Lil Wayne;Drake", which means Lil Wayne featuring Drake. Navidrome splits
 * a tag into artists only on " / ", " feat. ", " ft. " and "; " (with the space), so it lists "Lil Wayne;Drake" as
 * one artist with no albums of its own. The fix (tidyCredit) writes the Artist tag as "Lil Wayne feat. Drake" and the
 * Album artist as just "Lil Wayne", so the song and its album belong to Lil Wayne with Drake featured. The Hub
 * does the same by itself for new downloads (hub/src/credits.ts, same rule).
 *
 * The rest are tags that are missing ("[Unknown Artist]", "[Unknown Album]", no genre, no year, no track number)
 * or that look like several artists joined some other way ("Lil Wayne,Drake", "Lil Wayne/Drake"). Those are
 * listed for an admin to look at, not changed by themselves: "AC/DC" and "Tyler, The Creator" are one artist.
 */

export type SongIssue = 'joined' | 'maybeJoined' | 'noArtist' | 'noAlbumArtist' | 'noAlbum' | 'noTitle' | 'noGenre' | 'noYear' | 'noTrack';

/** What each issue is called in the filter chips, in the order they're shown. */
export const ISSUE_LABELS: Record<SongIssue, string> = {
  joined: 'Joined artists',
  maybeJoined: 'Maybe joined',
  noArtist: 'No artist',
  noAlbumArtist: 'No album artist',
  noAlbum: 'No album',
  noTitle: 'No title',
  noGenre: 'No genre',
  noYear: 'No year',
  noTrack: 'No track number',
};
export const ISSUES = Object.keys(ISSUE_LABELS) as SongIssue[];

const SEMI = /\s*[;；]\s*/;

/** A name for comparing: lower case, no accents or punctuation. */
const sameKey = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * A name of two or more words written twice in a row, "Lil Durk Lil Durk", as the name once. A one-word name
 * twice ("Duran Duran", "Talk Talk") is a real band name and stays.
 */
export function undouble(value: string): string {
  const w = value.trim().split(/\s+/);
  if (w.length < 4 || w.length % 2) return value;
  const half = w.length / 2;
  const a = w.slice(0, half).join(' ');
  return sameKey(a) === sameKey(w.slice(half).join(' ')) ? a : value;
}

/** Where the artists in a credit are cut apart to find the main one: semicolons and Navidrome's feat./ft. */
const PARTS = /\s*[;；]\s*|\s+(?:feat\.?|ft\.?|featuring)\s+/i;

/**
 * A joined credit as the main artist and the artists featured: "Lil Durk;Drake" → ["Lil Durk", "Drake"]. Each
 * artist once ("Lil Durk;Lil Durk" is just Lil Durk). Empty parts ("Drake;") go.
 */
function creditParts(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(PARTS)
    .map((p) => undouble(p.trim()))
    .filter((p) => {
      const k = sameKey(p);
      if (!p || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/**
 * A credit tidied so the song belongs to its main artist: the first artist named is the main one and the rest
 * are featured, as a semicolon-joined tag means ("Lil Durk;Drake" is Lil Durk featuring Drake).
 *
 * - **Artist** (`artist`, the default): "Lil Durk;Drake" → "Lil Durk feat. Drake", "A;B;C" → "A feat. B; C".
 *   Navidrome splits on " feat. " and "; ", so Lil Durk is the song's artist and Drake is listed as featured,
 *   and the song shows as "Bang Bang – Lil Durk feat. Drake".
 * - **Album artist** (`albumArtist`): just the main artist, "Lil Durk;Drake" → "Lil Durk", so the album is filed
 *   under Lil Durk and not under a joined "Lil Durk;Drake" artist.
 *
 * Either way the same artist named twice is once ("Lil Durk;Lil Durk", "Lil Durk Lil Durk" → "Lil Durk").
 * A value without a semicolon (or a doubled name) comes back as it is: commas, "&" and slashes are left, since
 * "Tyler, The Creator", "Simon & Garfunkel" and "AC/DC" are one artist.
 */
export function tidyCredit(value: string, tag: 'artist' | 'albumArtist' = 'artist'): string {
  if (!SEMI.test(value)) return undouble(value);
  const [main, ...rest] = creditParts(value);
  if (!main) return '';
  return tag === 'albumArtist' || !rest.length ? main : `${main} feat. ${rest.join('; ')}`;
}

/**
 * Several artists joined in a way Navidrome won't split and that can't be fixed blindly: a comma with no space
 * after it ("Lil Wayne,Drake") or a slash with no spaces between two names ("Lil Wayne/Drake", but also "AC/DC").
 */
export const maybeJoined = (value = '') => /\p{L}[,/]\p{L}/u.test(value);

const blank = (v?: string) => !v?.trim() || /^\[?unknown (artist|album)\]?$/i.test(v.trim());

/** What's wrong with a song's tags, in ISSUES order. */
export function songIssues(t: HubTags): SongIssue[] {
  const out: SongIssue[] = [];
  const credits = [t.artist, t.albumArtist].filter((v): v is string => !!v);
  if ((t.artist && tidyCredit(t.artist) !== t.artist) || (t.albumArtist && tidyCredit(t.albumArtist, 'albumArtist') !== t.albumArtist)) out.push('joined');
  if (credits.some(maybeJoined)) out.push('maybeJoined');
  if (blank(t.artist)) out.push('noArtist');
  if (blank(t.albumArtist)) out.push('noAlbumArtist');
  if (blank(t.album)) out.push('noAlbum');
  if (blank(t.title)) out.push('noTitle');
  if (!t.genre?.trim()) out.push('noGenre');
  if (!/\d{4}/.test(t.year ?? '')) out.push('noYear');
  if (!/^\s*\d+/.test(t.track ?? '')) out.push('noTrack');
  return out;
}

export type UnmatchedSong = HubTagSong & { albumId: string; issues: SongIssue[] };

/** The songs with at least one issue. */
export function unmatchedSongs(songs: (HubTagSong & { albumId: string })[]): UnmatchedSong[] {
  return songs.map((s) => ({ ...s, issues: songIssues(s.tags) })).filter((s) => s.issues.length);
}

/** The Artist and Album artist changes that split this song's joined credits, or null when there are none. */
export function creditFix(t: HubTags): HubTags | null {
  const out: HubTags = {};
  for (const k of ['artist', 'albumArtist'] as const) {
    const v = t[k];
    if (v && tidyCredit(v, k) !== v) out[k] = tidyCredit(v, k);
  }
  return Object.keys(out).length ? out : null;
}

/** Songs that have every one of `issues` (all songs when none are picked) and match the search text. */
export function filterUnmatched(songs: UnmatchedSong[], issues: Set<SongIssue>, text = ''): UnmatchedSong[] {
  const q = text.trim().toLowerCase();
  return songs.filter((s) => {
    for (const i of issues) if (!s.issues.includes(i)) return false;
    if (!q) return true;
    return [s.tags.title, s.tags.artist, s.tags.albumArtist, s.tags.album, s.tags.genre, s.path].some((v) => v?.toLowerCase().includes(q));
  });
}

/** How many songs have each issue. */
export function issueCounts(songs: UnmatchedSong[]): Record<SongIssue, number> {
  const out = Object.fromEntries(ISSUES.map((i) => [i, 0])) as Record<SongIssue, number>;
  for (const s of songs) for (const i of s.issues) out[i]++;
  return out;
}
