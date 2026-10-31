import { getJson, qs } from './http';
import { cleanTitle, pool, primaryArtist } from './match';
import { versionOf } from './versions';
import { norm } from '../sources/registry';
import type { Release } from '../sources/releaseRadar';
import type { Album } from '../sources/types';

/**
 * Library care (Library → Library care): albums you have more than once, and studio albums by your artists that
 * you don't have yet. Both work from the album list this device already has, plus Deezer for discographies.
 */

// "(Deluxe Edition)", "[Expanded]", "- 20th Anniversary Edition" and the like name the same album
const EDITION = /\s*(?:[([][^)\]]*\b(?:deluxe|expanded|anniversary|edition|bonus|special|collector'?s|platinum|complete|super)\b[^)\]]*[)\]]|\s-\s[^-]*\b(?:deluxe|edition|anniversary)\b.*)$/i;

/** Copies with this key are the same album: same artist and title, editions and remasters folded in. */
export const duplicateKey = (a: Pick<Album, 'artist' | 'title'>) => `${norm(primaryArtist(a.artist))}|${cleanTitle(a.title.replace(EDITION, ''))}`;

export interface DuplicateGroup {
  key: string;
  artist: string;
  title: string;
  /** Best first: most songs, then newest added. */
  copies: Album[];
}

/**
 * Albums the same server has more than once. Explicit and clean copies are versions, not duplicates
 * (lib/versions.ts), and the same album on two servers is just how the library merges, so neither counts.
 */
export function findDuplicates(albums: Album[]): DuplicateGroup[] {
  const groups = new Map<string, Album[]>();
  for (const a of albums) {
    for (const ref of a.refs ?? [a]) {
      const k = `${ref.sourceId}|${versionOf(ref) ?? ''}|${duplicateKey(ref)}`;
      const list = groups.get(k);
      if (list) {
        if (!list.some((x) => x.id === ref.id)) list.push(ref);
      } else groups.set(k, [ref]);
    }
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({
      key,
      artist: list[0].artist,
      title: list[0].title.replace(EDITION, ''),
      copies: [...list].sort((a, b) => (b.trackCount ?? 0) - (a.trackCount ?? 0) || (b.addedAt ?? 0) - (a.addedAt ?? 0)),
    }))
    .sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
}

// live albums and compilations aren't "missing" studio albums
const NOT_STUDIO = /\b(live|greatest hits|best of|anthology|collection|essentials|unplugged|remix(es)?|karaoke|instrumentals?)\b/i;

/** Your artists with the most albums, as Deezer should know them. */
export function topArtists(albums: Album[], limit: number): string[] {
  const count = new Map<string, { name: string; n: number }>();
  for (const a of albums) {
    const name = primaryArtist(a.artist);
    if (!name || /various artists|unknown artist/i.test(name)) continue;
    const c = count.get(norm(name)) ?? { name, n: 0 };
    c.n++;
    count.set(norm(name), c);
  }
  return [...count.values()].sort((a, b) => b.n - a.n).slice(0, limit).map((c) => c.name);
}

/** Whether you have an album with this title by this artist (any edition). */
export function haveAlbum(owned: Set<string>, artist: string, title: string) {
  return owned.has(duplicateKey({ artist, title }));
}

/**
 * Studio albums Deezer lists for your top artists that you don't have, newest first. Looks up `limit` artists,
 * four at a time.
 */
export async function missingAlbums(albums: Album[], limit = 40, onProgress?: (done: number, total: number) => void): Promise<Release[]> {
  const owned = new Set(albums.flatMap((a) => (a.refs ?? [a]).map(duplicateKey)));
  const artists = topArtists(albums, limit);
  let done = 0;
  const lists = await pool(artists, 4, async (name) => {
    const s = await getJson(`https://api.deezer.com/search/artist?${qs({ q: name, limit: 3 })}`).catch(() => null);
    const hit = ((s?.data ?? []) as { id: number; name: string }[]).find((a) => norm(a.name) === norm(name));
    const out: Release[] = [];
    if (hit) {
      const r = await getJson(`https://api.deezer.com/artist/${hit.id}/albums?${qs({ limit: 100 })}`).catch(() => null);
      const seen = new Set<string>();
      for (const a of (r?.data ?? []) as any[]) {
        if (a.record_type !== 'album' || NOT_STUDIO.test(a.title ?? '') || haveAlbum(owned, name, a.title ?? '')) continue;
        const k = duplicateKey({ artist: name, title: a.title });
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ id: a.id, title: a.title, artist: name, type: 'album', released: a.release_date ?? '', cover: a.cover_medium, deezerLink: a.link ?? `https://www.deezer.com/album/${a.id}`, explicit: a.explicit_lyrics });
      }
    }
    onProgress?.(++done, artists.length);
    return out;
  });
  return lists.flat().filter((r) => r.released && r.released <= new Date().toISOString().slice(0, 10)).sort((a, b) => b.released.localeCompare(a.released));
}
