import type { HubAlbumSort } from '../sources/hub';
import type { Album } from '../sources/types';

/**
 * An artist page's shelves, as Plex and Spotify have them: **Albums**, **Singles & EPs** and **Compilations**
 * (views/Library.tsx ArtistView). An album's own release type tag decides (Navidrome's OpenSubsonic `releaseTypes`,
 * from RELEASETYPE / MusicBrainz Album Type, which Edit album writes). Without one, the track count does, the way
 * the stores count: up to 3 songs is a single, 4 to 6 an EP, more an album.
 */

export type ReleaseKind = 'album' | 'single' | 'ep' | 'compilation';

/** The kinds Edit album offers, in order, with how a RELEASETYPE tag writes them. */
export const RELEASE_KINDS: { kind: ReleaseKind; label: string }[] = [
  { kind: 'album', label: 'Album' },
  { kind: 'ep', label: 'EP' },
  { kind: 'single', label: 'Single' },
  { kind: 'compilation', label: 'Compilation' },
];

/** A release type tag ("Single", "album; compilation", "EP") as one kind, or undefined when it names none. */
export function kindOfTag(tag?: string | string[]): ReleaseKind | undefined {
  const all = (Array.isArray(tag) ? tag : (tag ?? '').split(/[;,/]/)).map((t) => t.trim().toLowerCase()).filter(Boolean);
  // "album; compilation" is a compilation, "album; live" an album
  if (all.includes('compilation')) return 'compilation';
  return (['single', 'ep', 'album'] as const).find((k) => all.includes(k));
}

export function releaseKind(a: Album): ReleaseKind {
  const tagged = kindOfTag(a.releaseTypes);
  if (tagged) return tagged;
  if (a.compilation) return 'compilation';
  const n = a.trackCount ?? 0;
  if (n > 0 && n <= 3) return 'single';
  if (n >= 4 && n <= 6) return 'ep';
  return 'album';
}

/** An artist's albums in the order their Edit artist → Advanced → Album sorting asks for (newest first by default). */
export function sortAlbums(albums: Album[], sort: HubAlbumSort): Album[] {
  const byTitle = (a: Album, b: Album) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
  const year = (a: Album) => a.year ?? 0;
  const out = [...albums];
  if (sort === 'title') return out.sort(byTitle);
  if (sort === 'oldest') return out.sort((a, b) => (year(a) || 9999) - (year(b) || 9999) || byTitle(a, b));
  return out.sort((a, b) => year(b) - year(a) || byTitle(a, b));
}

export const SHELVES: { kind: ReleaseKind | 'singles'; title: string }[] = [
  { kind: 'album', title: 'Albums' },
  { kind: 'singles', title: 'Singles & EPs' },
  { kind: 'compilation', title: 'Compilations' },
];

/** The artist's albums cut into shelves, empty shelves left out. */
export function shelves(albums: Album[], sort: HubAlbumSort): { title: string; albums: Album[] }[] {
  const sorted = sortAlbums(albums, sort);
  return SHELVES.map((s) => ({
    title: s.title,
    albums: sorted.filter((a) => {
      const k = releaseKind(a);
      return s.kind === 'singles' ? k === 'single' || k === 'ep' : k === s.kind;
    }),
  })).filter((s) => s.albums.length);
}
