import type { HubTags, HubTagSong } from '../sources/hub';

/**
 * Library care → Unmatched songs (views/LibraryCare.tsx): songs whose tags stop Navidrome from filing them under
 * the right artist or album, found by reading every Navidrome album's tags through the Hub.
 *
 * The main one is a **joined credit**. Navidrome splits a single Artist or Album artist tag into several artists
 * only on " / ", " feat. ", " ft. " and "; " (a semicolon and a space). A semicolon with no space ("Lil Wayne;Drake")
 * isn't one of those, so Navidrome lists "Lil Wayne;Drake" as one artist with no albums of its own. The fix is to
 * write "Lil Wayne; Drake", which the Hub also does by itself for new downloads (hub/src/credits.ts, same rule).
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

/** "Lil Wayne;Drake" → "Lil Wayne; Drake" (what Navidrome splits). Without a semicolon it comes back as it is. */
export function tidyCredit(value: string): string {
  if (!SEMI.test(value)) return value;
  return value.split(SEMI).map((p) => p.trim()).filter(Boolean).join('; ');
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
  if (credits.some((v) => tidyCredit(v) !== v)) out.push('joined');
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
    if (v && tidyCredit(v) !== v) out[k] = tidyCredit(v);
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
