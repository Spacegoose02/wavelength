import { norm } from '../sources/registry';

/**
 * "Appears On" on an artist page, like Spotify: albums by other artists where this artist is credited on a song,
 * as a track artist ("Drake feat. Future", OpenSubsonic `artists`) or in the title ("Song (feat. Future)").
 * The server finds the candidate songs (NavidromeSource.getAppearsOn); this decides which of them count.
 */

/** A song as far as Appears On cares. */
export interface CreditedSong {
  albumId?: string;
  title: string;
  /** the song's artist line, e.g. "Drake feat. Future & Lil Baby" */
  artist?: string;
  /** OpenSubsonic `artists`: every track artist the server knows about */
  artists?: { id?: string; name?: string }[];
  /** the album's artist (OpenSubsonic `displayAlbumArtist` / `albumArtists`) */
  albumArtist?: string;
  albumArtistIds?: string[];
}

const SPLIT = /\s+(?:featuring|feat\.?|ft\.?|with|x|vs\.?|&|and|•)\s+|\s*[,;/]\s*/i;

/** Every artist named in an artist line or a "(feat. …)" / "[with …]" tag in a title. */
export function creditsOf(artist = '', title = ''): string[] {
  const out = artist.split(SPLIT);
  for (const m of title.matchAll(/[([](?:featuring|feat\.?|ft\.?|with)\s+([^)\]]+)[)\]]/gi)) out.push(...m[1].split(SPLIT));
  // "Song feat. Someone" without brackets
  const bare = title.match(/\s(?:featuring|feat\.|ft\.)\s+([^([]+)$/i);
  if (bare) out.push(...bare[1].split(SPLIT));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Whether this artist (by server id or name) is credited on the song. */
export function isCredited(song: CreditedSong, artist: { ids: Set<string>; name: string }): boolean {
  const name = norm(artist.name);
  if (!name) return false;
  if (song.artists?.some((a) => (a.id && artist.ids.has(a.id)) || norm(a.name) === name)) return true;
  return creditsOf(song.artist, song.title).some((c) => norm(c) === name);
}

/** Whether the album is the artist's own (they're its album artist), so it belongs in their albums, not here. */
export function isOwnAlbum(song: CreditedSong, artist: { ids: Set<string>; name: string }): boolean {
  if (song.albumArtistIds?.some((id) => artist.ids.has(id))) return true;
  return !!song.albumArtist && norm(song.albumArtist) === norm(artist.name);
}

/**
 * The albums (by id, first song kept) where the artist is credited on a song but isn't the album artist, leaving
 * out `ownAlbumIds` (what the artist page already lists).
 */
export function appearsOnSongs<S extends CreditedSong>(songs: S[], artist: { ids: Set<string>; name: string }, ownAlbumIds = new Set<string>()): S[] {
  const seen = new Map<string, S>();
  for (const s of songs) {
    if (!s.albumId || seen.has(s.albumId) || ownAlbumIds.has(s.albumId)) continue;
    if (isOwnAlbum(s, artist) || !isCredited(s, artist)) continue;
    seen.set(s.albumId, s);
  }
  return [...seen.values()];
}
