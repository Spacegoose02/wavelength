/**
 * Where a playing song's album and artist live in the library, so Now Playing can link to them
 * (components/NowPlaying.tsx). Pure: takes the catalog's merged albums and artists (store/catalog.ts).
 */
import { norm } from '../sources/registry';
import { primaryArtist } from './match';
import type { Album, Artist, Track } from '../sources/types';

/** Tracks that come from the library (not radio, audiobooks, podcasts or Deezer previews). */
function isLibraryTrack(t: Track) {
  return t.kind === 'track' && t.sourceId !== 'preview';
}

/**
 * The library album a song is on: the catalog album holding the song's album id on its server, else the one
 * with the same name and artist. A song whose album isn't in the catalog yet (still loading, or only on a
 * server the catalog couldn't list) still opens its album when its server gave an album id.
 */
export function albumOfTrack(t: Track, albums: Album[]): Album | undefined {
  if (!isLibraryTrack(t)) return undefined;
  if (t.albumId) {
    const byId = albums.find((a) => (a.refs ?? [a]).some((r) => r.id === t.albumId && r.sourceId === t.sourceId));
    if (byId) return byId;
  }
  if (t.album) {
    const title = norm(t.album);
    const same = albums.filter((a) => norm(a.title) === title);
    const artist = norm(t.artist);
    const hit = same.find((a) => norm(a.artist) === artist) ?? (same.length === 1 ? same[0] : undefined);
    if (hit) return hit;
  }
  if (t.albumId && t.album) return { id: t.albumId, sourceId: t.sourceId, title: t.album, artist: t.artist };
  return undefined;
}

/**
 * The library artist a song is by. Matches the song's artist name (as the catalog merges artists: case, accents
 * and a leading "The" don't matter); for "A feat. B", "A, B" or "A & B" that aren't an artist themselves, the
 * first name, if that is one. Falls back to the artist of the song's album.
 */
export function artistOfTrack(t: Track, artists: Artist[], album?: Album): Artist | undefined {
  if (!isLibraryTrack(t)) return undefined;
  const named = (name: string) => {
    const key = norm(name);
    return key ? artists.find((a) => norm(a.name) === key) : undefined;
  };
  const exact = named(t.artist);
  if (exact) return exact;
  const first = named(primaryArtist(t.artist));
  if (first) return first;
  if (album) {
    const refs = album.refs ?? [album];
    const byId = artists.find((a) => (a.refs ?? [a]).some((r) => refs.some((x) => x.artistId === r.id && x.sourceId === r.sourceId)));
    return byId ?? named(album.artist);
  }
  return undefined;
}

/** Which row of an album's songs `focus` is: the same song on the same server, else (another server's copy) the same title. */
export function focusIndex(tracks: Track[], focus?: { id: string; sourceId: string; title?: string }) {
  if (!focus) return -1;
  const i = tracks.findIndex((t) => t.id === focus.id && t.sourceId === focus.sourceId);
  if (i >= 0 || !focus.title) return i;
  const title = norm(focus.title);
  return tracks.findIndex((t) => norm(t.title) === title);
}
