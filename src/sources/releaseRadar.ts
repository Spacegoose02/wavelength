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

const WINDOW_DAYS = 42;
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

async function releasesFor(artist: string): Promise<Release[]> {
  const s = await getJson(`https://api.deezer.com/search/artist?${qs({ q: artist, limit: 3 })}`).catch(() => null);
  const hit = (s?.data ?? []).find((a: any) => norm(a.name) === norm(artist));
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
