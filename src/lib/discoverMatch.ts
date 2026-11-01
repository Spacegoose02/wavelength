import type { NavidromeSource } from '../sources/navidrome';
import { sourceFor } from '../sources/registry';
import type { SourceConfig, Track } from '../sources/types';
import { hubClient } from '../store/hub';
import { enabledSources } from '../store/settings';
import { findInLibrary, pool } from './match';

/**
 * "Already in your library?" for a whole chart (Discover).
 *
 * Signed in to a Hub that has a Navidrome scan login, the Hub matches the whole chart at once against its list of
 * the library (hub/src/libraryIndex.ts) and the songs come back as Navidrome's own fields, which this device turns
 * into playable tracks when it plays from that same Navidrome. Anything left over (no Hub, an older Hub, a song the
 * Hub didn't find while this device also has Plex or another Navidrome) is looked up here, one search per song,
 * four at a time, as before.
 */

const trim = (u: string) => u.replace(/\/+$/, '').toLowerCase();

/** This device's source for the Hub's Navidrome: the same URL, or the only Navidrome login the Hub gave it. */
export function sameNavidrome(server: string, sources: SourceConfig[]): SourceConfig | undefined {
  const nd = sources.filter((s) => s.kind === 'navidrome' && s.enabled);
  return nd.find((s) => trim(s.url) === trim(server)) ?? (nd.length === 1 && nd[0].hubId !== undefined ? nd[0] : undefined);
}

/**
 * Each song's library track (null = not in the library), reported as they're found. `done` counts songs checked.
 * Resolves when every song has been checked.
 */
export async function matchChart(
  songs: { title: string; artist: string }[],
  onFound: (i: number, t: Track | null) => void,
  alive: () => boolean = () => true,
): Promise<void> {
  const libs = enabledSources().filter((s) => s.kind === 'navidrome' || s.kind === 'plex');
  let todo = songs.map((_, i) => i);
  const hub = hubClient();
  if (hub && libs.length && songs.length) {
    try {
      const r = await hub.discoverMatch(songs.map((s) => ({ title: s.title, artist: s.artist })).slice(0, 300));
      const src = r.ready && r.server ? sameNavidrome(r.server, libs) : undefined;
      if (src && alive()) {
        const nd = sourceFor(src) as NavidromeSource;
        const left: number[] = [];
        r.songs.forEach((s, i) => {
          if (s) onFound(i, nd.fromSubsonic({ ...s }));
          else left.push(i);
        });
        // the Hub's Navidrome is the only library here: what it didn't find isn't here
        const others = libs.filter((l) => l.id !== src.id);
        if (!others.length) {
          for (const i of left) onFound(i, null);
          left.length = 0;
        }
        todo = [...left, ...songs.slice(300).map((_, j) => 300 + j)];
      }
    } catch {
      // an older Hub, or it's unreachable: check here
    }
  }
  if (!alive()) return;
  const find = findInLibrary();
  await pool(todo, 4, async (i) => {
    if (!alive()) return;
    const hit = await find(songs[i]).catch(() => undefined);
    if (alive()) onFound(i, hit ?? null);
  });
}
