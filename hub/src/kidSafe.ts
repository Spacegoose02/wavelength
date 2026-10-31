import type { Db } from './db.ts';

/**
 * Kid-safe checks on the Hub (docs/USERS-AND-ADMIN.md §6.5), the same rules as the app's src/lib/kids.ts: the
 * relay refuses kids a song, and Release Radar's auto-get skips a release, that a kid profile mustn't have.
 *
 * An album's clean version ("Loud (Clean)", saved so by cleanDownloads.ts) and its explicit one share a title
 * once the mark is dropped, and their songs share titles. So every song or album flag says which version it
 * is for (`version`), and a flag only applies to that version:
 *   'clean'     "(Clean)", "(Edited)" or "(Censored)" in the album or song title
 *   ''          anything else, whatever its explicit tag says: one album holds songs tagged explicit and clean
 *   'any'       every version: artist flags, and "Hide every version"
 * 'explicit' was saved by 0.17.2 for songs and albums tagged explicit; it counts as '' (and is turned into it).
 */

export type Version = '' | 'explicit' | 'clean' | 'any';
export const VERSIONS: Version[] = ['', 'explicit', 'clean', 'any'];

/** "(Clean)", "(Edited)" and the like in a title. */
export const CLEAN_MARK = /[([]\s*(clean|edited|censored)\b[^)\]]*[)\]]/i;

/** Lower case, letters and digits only (the app's `norm`). */
export function norm(s = '') {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}
/** A title without "(feat. …)", "(Clean)", "(Remastered)" and the like (the app's `cleanTitle`). */
export const cleanTitle = (s = '') =>
  norm(s.replace(/^\d{1,3}\s*[-.]\s+/, '').replace(/\s*[([](feat|ft|with|remaster|remastered|live|explicit|clean|edited|censored|radio edit|\d{4} remaster)[^)\]]*[)\]]/gi, ''));
/** "Drake Featuring Future" → "Drake". */
export const primaryArtist = (s = '') => s.split(/\s+(?:featuring|feat\.?|ft\.?|with|x|&|and|•)\s+|,\s*/i)[0].trim();

const tagOf = (s?: string) => (s ?? '').trim().toLowerCase();

/** Which version a song is: from its album's title and its own, never its tag. */
export const songVersion = (s: { title?: string; album?: string }): '' | 'clean' => (CLEAN_MARK.test(s.album ?? '') || CLEAN_MARK.test(s.title ?? '') ? 'clean' : '');
/** Which version an album is: from its title. */
export const albumVersion = (a: { title?: string }): '' | 'clean' => (CLEAN_MARK.test(a.title ?? '') ? 'clean' : '');

/** The version a flag sent without one is for (apps from before versions): its title says, or none. */
export const versionFromTitle = (kind: string, title: string): Version => (kind === 'artist' ? 'any' : CLEAN_MARK.test(title) ? 'clean' : '');

interface FlagRow { kind: string; artist: string; title: string; verdict: string; version: string }

/**
 * The admin's verdict on a song or album, most specific first: the song, then its album, then the artist.
 * A flag on another version of the same song or album doesn't count.
 */
export function flagVerdict(db: Db, s: { artist?: string; album?: string; title?: string; explicitStatus?: string }, kind: 'track' | 'album' = 'track'): 'block' | 'allow' | undefined {
  const artist = norm(primaryArtist(s.artist));
  if (!artist) return undefined;
  const rows = (db.prepare('SELECT kind, artist, title, verdict, version FROM content_flags').all() as unknown as FlagRow[])
    .filter((f) => norm(primaryArtist(f.artist)) === artist);
  const version = kind === 'track' ? songVersion(s) : albumVersion({ title: s.album });
  const versionOfRow = (f: FlagRow) => (f.version === 'explicit' ? '' : f.version);
  const find = (k: string, title: string) => {
    const same = rows.filter((f) => f.kind === k && (k === 'artist' || cleanTitle(f.title) === cleanTitle(title)));
    return same.find((f) => versionOfRow(f) === version) ?? same.find((f) => f.version === 'any');
  };
  const hit = (kind === 'track' && s.title ? find('track', s.title) : undefined) ?? (s.album ? find('album', s.album) : undefined) ?? find('artist', '');
  return hit?.verdict === 'block' ? 'block' : hit?.verdict === 'allow' ? 'allow' : undefined;
}

/** Kids: is this song explicit (its own tag, the library check) or flagged as not for kids? */
export function songNotForKids(db: Db, song: { title?: string; album?: string; artist?: string; explicitStatus?: string }): boolean {
  const verdict = flagVerdict(db, song);
  if (verdict) return verdict === 'block';
  const tag = tagOf(song.explicitStatus);
  if (tag === 'explicit') return true;
  // the file says clean, or it's on the clean version: the explicit album's library check isn't about it
  if (tag === 'clean' || CLEAN_MARK.test(song.album ?? '')) return false;
  const artist = song.artist ?? '', album = song.album ?? '', title = song.title ?? '';
  const rated = db
    .prepare(`SELECT 1 FROM ratings WHERE rating = 'explicit' AND artist = ? COLLATE NOCASE AND album = ? COLLATE NOCASE AND
      ((kind = 'track' AND title = ? COLLATE NOCASE) OR (kind = 'album' AND NOT EXISTS
        (SELECT 1 FROM ratings t WHERE t.kind = 'track' AND t.artist = ratings.artist AND t.album = ratings.album)))`)
    .get(artist, album, title);
  return !!rated;
}

/** Kids: a release from Deezer (Release Radar) that a kid profile mustn't get. */
export function releaseNotForKids(db: Db, r: { artist: string; title: string; explicit: boolean }): boolean {
  const verdict = flagVerdict(db, { artist: r.artist, album: r.title, explicitStatus: r.explicit ? 'explicit' : '' }, 'album');
  return verdict ? verdict === 'block' : r.explicit;
}

/**
 * Flags saved before versions (Hub 0.17.1 and older), and library-check results saved for a clean version.
 * Run once by the migration that added `version` (db.ts).
 *  - Artist flags apply to every version.
 *  - A flag whose title has "(Clean)" in it is for the clean version.
 *  - "OK for kids" on a song or album: the app saved it under the explicit version's name even when it was set
 *    on the clean version, and song flags applied to both. So it moves to the clean version, and the explicit
 *    one is hidden again until an admin lets it through on purpose.
 *  - "Hide" on a song applied to every version before, and still does. "Hide" on an album stays on the
 *    album it names.
 *  - A library-check rating saved for an album marked clean was Deezer's explicit album's: it's dropped.
 */
export function repairOldFlags(db: Db): { moved: number; dropped: number } {
  const rows = db.prepare('SELECT id, kind, title, verdict FROM content_flags').all() as unknown as { id: number; kind: string; title: string; verdict: string }[];
  const set = db.prepare('UPDATE OR REPLACE content_flags SET version = ? WHERE id = ?');
  let moved = 0;
  for (const f of rows) {
    const v: Version = f.kind === 'artist' ? 'any' : CLEAN_MARK.test(f.title) || f.verdict === 'allow' ? 'clean' : f.kind === 'track' ? 'any' : '';
    if (v) set.run(v, f.id);
    if (f.verdict === 'allow' && f.kind !== 'artist' && !CLEAN_MARK.test(f.title)) moved++;
  }
  const ratings = db.prepare('SELECT id, album FROM ratings').all() as unknown as { id: number; album: string }[];
  const drop = db.prepare('DELETE FROM ratings WHERE id = ?');
  let dropped = 0;
  for (const r of ratings) if (CLEAN_MARK.test(r.album)) dropped += Number(drop.run(r.id).changes);
  return { moved, dropped };
}
