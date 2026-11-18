import type { HubAlbumSort } from '../sources/hub';
import type { Album } from '../sources/types';

/**
 * An artist page's shelves, as Plex and Spotify have them: **Albums**, **Singles & EPs**, **Compilations**,
 * **Soundtracks**, plus **Leaks & Mixtapes** for DatPiff-era tapes and leaked sets (views/Library.tsx ArtistView). An album's own release
 * type tag decides (Navidrome's OpenSubsonic `releaseTypes`, from RELEASETYPE / MusicBrainz Album Type, which Edit
 * album writes). Without one, the track count does, the way the stores count: up to 3 songs is a single, 4 to 6 an
 * EP, more an album.
 *
 * Mixtapes, leaks and soundtracks often carry no tag, so their titles and genres count too: "FOMO (Leaks)", "Dark
 * Lane Demo Tapes", "… (Hosted by DJ Drama)", "… (Original Motion Picture Soundtrack)", a "Mixtape" genre. That guess only beats a missing or plain "album" tag (what
 * Picard writes for nearly everything); a release tagged Single, EP or Compilation stays where its tag puts it.
 */

export type ReleaseKind = 'album' | 'single' | 'ep' | 'compilation' | 'soundtrack' | 'mixtape' | 'leak';

/** The kinds Edit album offers, in order, with how a RELEASETYPE tag writes them. */
export const RELEASE_KINDS: { kind: ReleaseKind; label: string }[] = [
  { kind: 'album', label: 'Album' },
  { kind: 'ep', label: 'EP' },
  { kind: 'single', label: 'Single' },
  { kind: 'compilation', label: 'Compilation' },
  { kind: 'soundtrack', label: 'Soundtrack' },
  { kind: 'mixtape', label: 'Mixtape' },
  { kind: 'leak', label: 'Leak' },
];

/** Release type tag words that mean a mixtape (MusicBrainz's secondary type is "mixtape/street") or a leak. */
const MIXTAPE_TAGS = ['mixtape', 'mixtapes', 'mixtape/street', 'street', 'demo'];
const LEAK_TAGS = ['leak', 'leaks', 'leaked', 'bootleg', 'unreleased'];

/** Title words that give away a leak or a mixtape. */
const LEAK_TITLE = /\b(leak(s|ed)?|unreleased|bootleg|snippets?)\b/i;
const MIXTAPE_TITLE = /\b(mix ?tapes?|demo ?tapes?|datpiff|hosted by|gangsta grillz|no dj|street album)\b/i;
const SOUNDTRACK_TITLE = /\b(soundtrack|original score|motion picture|ost)\b/i;

/** A release type tag ("Single", "album; compilation", "EP") as one kind, or undefined when it names none. */
export function kindOfTag(tag?: string | string[]): ReleaseKind | undefined {
  const all = (Array.isArray(tag) ? tag : (tag ?? '').split(/[;,/]/)).map((t) => t.trim().toLowerCase()).filter(Boolean);
  // "album; mixtape/street" is a mixtape, "compilation; soundtrack" a soundtrack, "album; compilation" a compilation,
  // "album; live" an album
  if (all.some((t) => LEAK_TAGS.includes(t))) return 'leak';
  if (all.some((t) => MIXTAPE_TAGS.includes(t))) return 'mixtape';
  if (all.includes('soundtrack')) return 'soundtrack';
  if (all.includes('compilation')) return 'compilation';
  return (['single', 'ep', 'album'] as const).find((k) => all.includes(k));
}

/** A leak, mixtape or soundtrack by its title or genre, for the many that carry no release type tag. */
export function guessKind(a: Pick<Album, 'title' | 'genres'>): 'mixtape' | 'leak' | 'soundtrack' | undefined {
  if (LEAK_TITLE.test(a.title)) return 'leak';
  if (MIXTAPE_TITLE.test(a.title)) return 'mixtape';
  if (SOUNDTRACK_TITLE.test(a.title)) return 'soundtrack';
  const genres = (a.genres ?? []).map((g) => g.trim().toLowerCase());
  if (genres.some((g) => LEAK_TAGS.includes(g))) return 'leak';
  if (genres.some((g) => g === 'mixtape' || g === 'mixtapes')) return 'mixtape';
  if (genres.some((g) => g === 'soundtrack' || g === 'soundtracks')) return 'soundtrack';
  return undefined;
}

export function releaseKind(a: Album): ReleaseKind {
  const tagged = kindOfTag(a.releaseTypes);
  if (tagged && tagged !== 'album') return tagged;
  const guessed = guessKind(a);
  if (guessed) return guessed;
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

export const SHELVES: { kind: ReleaseKind | 'singles' | 'tapes'; title: string }[] = [
  { kind: 'album', title: 'Albums' },
  { kind: 'singles', title: 'Singles & EPs' },
  { kind: 'compilation', title: 'Compilations' },
  { kind: 'soundtrack', title: 'Soundtracks' },
  { kind: 'tapes', title: 'Leaks & Mixtapes' },
];

/** The artist's albums cut into shelves, empty shelves left out. */
export function shelves(albums: Album[], sort: HubAlbumSort): { title: string; albums: Album[] }[] {
  const sorted = sortAlbums(albums, sort);
  return SHELVES.map((s) => ({
    title: s.title,
    albums: sorted.filter((a) => {
      const k = releaseKind(a);
      if (s.kind === 'singles') return k === 'single' || k === 'ep';
      if (s.kind === 'tapes') return k === 'mixtape' || k === 'leak';
      return k === s.kind;
    }),
  })).filter((s) => s.albums.length);
}
