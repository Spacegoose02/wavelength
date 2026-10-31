import { useMemo } from 'react';
import type { DeezerResult } from '../sources/deemix';
import type { Album } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { dzVersionKey, withVersions } from './deezerVersions';
import { versionKey, versionOf, type Version, type VersionPref } from './versions';

/**
 * An artist's Deezer releases next to your library (docs/USER-GUIDE.md#browse-an-artists-releases): which ones
 * you already have, and which is their newest. Used by the artist page's newest release banner and by the
 * Deezer artist page (Browse releases, and Downloads → Deezer).
 */

/**
 * A lookup from a Deezer release to the library album that is it: same artist and same name, ignoring
 * "(Deluxe)"-style extras the way the Explicit / Clean versions do (lib/versions.ts). Versions count: having
 * the explicit album doesn't make its clean release "in library", and the other way round.
 */
export function ownedIndex(albums: Album[]): (r: DeezerResult) => Album | undefined {
  const byKey = new Map<string, { album: Album; version?: Version }[]>();
  for (const album of albums) {
    for (const ref of album.refs ?? [album]) {
      const k = versionKey(ref);
      const list = byKey.get(k) ?? [];
      list.push({ album, version: versionOf(ref) });
      byKey.set(k, list);
    }
  }
  return (r) => {
    if (r.type !== 'album' || !r.artist) return undefined;
    const list = byKey.get(versionKey({ artist: r.artist, title: r.title }));
    if (!list) return undefined;
    const hit = r.version === 'clean' ? list.find((x) => x.version === 'clean')
      : r.version === 'explicit' ? list.find((x) => x.version !== 'clean')
      : list[0];
    return hit?.album;
  };
}

/** Hook: `ownedIndex` over the whole library, rebuilt when the library changes. */
export function useOwnedRelease(): (r: DeezerResult) => Album | undefined {
  const albums = useCatalog((s) => s.albums);
  return useMemo(() => ownedIndex(albums), [albums]);
}

export interface NewestRelease {
  /** The newest release that's out (today or before). */
  latest?: DeezerResult;
  /** Out in the last `windowDays`: "New release" rather than "Latest release". */
  isNew: boolean;
  /** The next announced release, if Deezer lists one. */
  upcoming?: DeezerResult;
}

/**
 * The newest release in an artist's discography, and the next one announced. Releases `hide` says no to
 * (a kid profile's) are skipped, so a kid sees the newest one they may have. When the release has an explicit
 * and a clean version, the one matching `pref` is picked.
 */
export function newestRelease(
  releases: DeezerResult[],
  opts: { today: string; windowDays: number; pref: VersionPref; hide?: (r: DeezerResult) => boolean },
): NewestRelease {
  const list = withVersions(releases.filter((r) => r.type === 'album' && r.releaseDate)).filter((r) => !opts.hide?.(r));
  const preferred = (r: DeezerResult) => {
    if (opts.pref === 'both' || r.version === opts.pref) return r;
    const k = dzVersionKey(r);
    return list.find((x) => x.version === opts.pref && dzVersionKey(x) === k) ?? r;
  };
  const out = list.filter((r) => r.releaseDate! <= opts.today).sort((a, b) => b.releaseDate!.localeCompare(a.releaseDate!));
  const ahead = list.filter((r) => r.releaseDate! > opts.today).sort((a, b) => a.releaseDate!.localeCompare(b.releaseDate!));
  const latest = out[0] && preferred(out[0]);
  const cutoff = new Date(Date.parse(opts.today + 'T12:00:00Z') - opts.windowDays * 86_400_000).toISOString().slice(0, 10);
  return { latest, isNew: !!latest && latest.releaseDate! >= cutoff, upcoming: ahead[0] && preferred(ahead[0]) };
}

/** Today as YYYY-MM-DD on this device's clock (Deezer's release dates have no time zone). */
export function localToday(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
