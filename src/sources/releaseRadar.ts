import { sameNameArtists, type ArtistCandidate } from '../lib/artistMatch';
import { matchFor } from '../lib/artistMatches';
import { getJson, qs } from '../lib/http';
import { pool, primaryArtist } from '../lib/match';
import { norm, sourceFor } from './registry';
import { enabledSources } from '../store/settings';
import { useLibrary } from '../store/library';

/** A new album/EP/single from an artist you listen to (found via Deezer). */
export interface Release {
  id: number;
  title: string;
  artist: string;
  type: string;
  released: string;
  cover?: string;
  deezerLink: string;
  /** Explicit lyrics, as Deezer marks them (kid profiles don't see these). */
  explicit?: boolean;
}

/** How far back a release counts as new: Release Radar's list, and "New release" on an artist page. */
export const WINDOW_DAYS = 42;
const CACHE_KEY = 'tonearm.releaseRadar';

/** Your artists, most-played first: Navidrome play counts + starred + local history. */
async function yourArtists(limit = 60): Promise<string[]> {
  const score = new Map<string, { name: string; pts: number }>();
  const add = (name: string | undefined, pts: number) => {
    const n = name && primaryArtist(name);
    if (!n || /various artists|unknown artist/i.test(n)) return;
    const k = norm(n);
    const cur = score.get(k);
    if (cur) cur.pts += pts;
    else score.set(k, { name: n, pts });
  };
  for (const h of useLibrary.getState().history) add(h.track.artist, 1);
  await Promise.all(
    enabledSources().map(async (cfg) => {
      const src = sourceFor(cfg);
      const [hist, favs] = await Promise.all([src.getHistory?.().catch(() => []), src.getFavorites?.().catch(() => undefined)]);
      for (const e of hist ?? []) add(e.track.artist, Math.min(5, e.playCount ?? 1));
      for (const t of favs?.tracks ?? []) add(t.artist, 3);
      for (const a of favs?.artists ?? []) add(a.name, 6);
      for (const a of favs?.albums ?? []) add(a.artist, 3);
    }),
  );
  return [...score.values()].sort((a, b) => b.pts - a.pts).slice(0, limit).map((x) => x.name);
}

/** A Deezer artist found by name. */
export interface DeezerArtistHit {
  id: number;
  name: string;
  picture?: string;
}

// name lookups, kept for the session (a miss too, so a library artist Deezer doesn't have isn't asked about again)
const found = new Map<string, Promise<ArtistCandidate[]>>();

// artists looked up by id (a match made by hand), kept for the session
const byId = new Map<number, Promise<ArtistCandidate>>();

/** The Deezer artist with this id, with their fan count. Throws when Deezer has no such artist. */
export function deezerArtistById(id: number): Promise<ArtistCandidate> {
  let hit = byId.get(id);
  if (!hit) {
    hit = getJson(`https://api.deezer.com/artist/${id}`).then((a) => {
      // Deezer answers 200 with { error } for unknown ids
      if (!a || a.error || typeof a.id !== 'number') throw new Error(a?.error?.message ?? 'Deezer has no such artist');
      return { id: a.id as number, name: String(a.name), picture: (a.picture_medium as string) || undefined, fans: Number(a.nb_fan) || 0 };
    });
    hit.catch(() => byId.delete(id));
    byId.set(id, hit);
  }
  return hit;
}

/**
 * The Deezer artists with exactly this name (case and accents don't matter), most fans first; empty when Deezer
 * has none. Deezer often has several artists with the same name, so this asks for 25 results, not the first few.
 * A failed lookup isn't kept, so it's tried again next time. An artist matched by hand (Edit artist → Match,
 * lib/artistMatches.ts) is just that Deezer artist, or nobody when matched to none.
 */
export async function deezerArtistsNamed(name: string): Promise<ArtistCandidate[]> {
  const m = (await matchFor(name))?.deezer;
  if (m === 'none') return [];
  if (typeof m === 'number') return [await deezerArtistById(m)];
  return deezerArtistsByName(name);
}

/** Search Deezer's artists by any name (Edit artist → Match), Deezer's order. Not kept. */
export async function searchDeezerArtists(text: string, limit = 10): Promise<ArtistCandidate[]> {
  if (!text.trim()) return [];
  const s = await getJson(`https://api.deezer.com/search/artist?${qs({ q: text.trim(), limit })}`);
  return ((s?.data ?? []) as any[])
    .filter((a) => a && typeof a.id === 'number')
    .map((a) => ({ id: a.id as number, name: String(a.name), picture: (a.picture_medium as string) || undefined, fans: Number(a.nb_fan) || 0 }));
}

/** deezerArtistsNamed without the match: what a lookup by name alone finds. */
export function deezerArtistsByName(name: string): Promise<ArtistCandidate[]> {
  const key = norm(name);
  let hit = found.get(key);
  if (!hit) {
    hit = getJson(`https://api.deezer.com/search/artist?${qs({ q: name, limit: 25 })}`).then((s) => sameNameArtists(name, s?.data ?? []));
    hit.catch(() => found.delete(key));
    found.set(key, hit);
  }
  return hit;
}

/**
 * The Deezer artist with exactly this name and the most fans, or undefined when Deezer has none. Release Radar's
 * "artists you play" looks artists up this way; the library artist page (Browse releases, the newest release
 * banner) also checks the candidates against your library (lib/artistMatch.ts).
 */
export async function findDeezerArtist(name: string): Promise<DeezerArtistHit | undefined> {
  const [a] = await deezerArtistsNamed(name);
  return a && { id: a.id, name: a.name, picture: a.picture };
}

async function releasesFor(artist: string): Promise<Release[]> {
  const hit = await findDeezerArtist(artist).catch(() => undefined);
  if (!hit) return [];
  const albums = await getJson(`https://api.deezer.com/artist/${hit.id}/albums?${qs({ limit: 20 })}`).catch(() => null);
  const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
  return (albums?.data ?? [])
    .filter((a: any) => a.release_date && Date.parse(a.release_date) >= cutoff && Date.parse(a.release_date) <= Date.now() + 86_400_000)
    .map((a: any) => ({
      id: a.id,
      title: a.title,
      artist: hit.name,
      type: a.record_type ?? 'album',
      released: a.release_date,
      cover: a.cover_medium,
      deezerLink: a.link,
      explicit: !!a.explicit_lyrics,
    }));
}

/** New releases from your artists, newest first. Cached for the day unless forced. */
export async function releaseRadar(force = false, onProgress?: (done: number, total: number) => void): Promise<{ releases: Release[]; artists: number }> {
  const today = new Date().toISOString().slice(0, 10);
  if (!force) {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
      if (c?.day === today) return c.data;
    } catch {
      /* no cache */
    }
  }
  const artists = await yourArtists();
  let done = 0;
  const lists = await pool(artists, 4, async (a) => {
    const r = await releasesFor(a).catch(() => []);
    onProgress?.(++done, artists.length);
    return r;
  });
  const seen = new Set<number>();
  const releases = lists.flat().filter((r) => !seen.has(r.id) && seen.add(r.id)).sort((a, b) => b.released.localeCompare(a.released));
  const data = { releases, artists: artists.length };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ day: today, data }));
  } catch {
    /* non-essential */
  }
  return data;
}

/** First track's 30s preview for an album (for the ▶ button). */
export async function albumPreview(albumId: number): Promise<{ url?: string; title?: string }> {
  const r = await getJson(`https://api.deezer.com/album/${albumId}/tracks?${qs({ limit: 3 })}`).catch(() => null);
  const t = (r?.data ?? []).find((x: any) => x.preview);
  return { url: t?.preview, title: t?.title };
}
