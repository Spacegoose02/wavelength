/**
 * What Android Auto (and other media browsers: Wear OS, the system media picker) can browse and play
 * (MediaPlaybackService.kt). The car asks for a folder by id; the page answers with its items. Ids say what
 * an item is, so playing one needs nothing but the id:
 *
 * - `root`, `playlists`, `recent`, `radio`, `favorites`: folders
 * - `pl:<id>` a Wavelength playlist, `sp:<sourceId>:<id>` a Navidrome / Plex one
 * - `al:<sourceId>:<albumId>` an album, `st:<sourceId>:<id>` a radio station, `fav` liked songs
 * - `search:<query>` (a folder: the car's search box), `q:<query>` the songs that match it
 */
import { sourceFor } from '../sources/registry';
import { stationToTrack } from '../sources/radio';
import type { Album, SearchResults, Track } from '../sources/types';
import { useLibrary } from '../store/library';
import { usePlayer } from '../store/player';
import { enabledSources, useSettings } from '../store/settings';
import { trackArt } from './artwork';
import { parseId } from './carIds';
import { albumNotForKids, isKid, kidSafe } from './kids';

export interface CarItem {
  id: string;
  title: string;
  subtitle?: string;
  art?: string;
  /** A folder to open, or something to play. */
  browsable: boolean;
}

/** The car's screens only take so many rows; long lists are cut here. */
const MAX = 100;
const art = (url?: string) => (url?.startsWith('http') ? url : undefined);

const sources = () => enabledSources().map(sourceFor);
const source = (id?: string) => {
  const cfg = enabledSources().find((s) => s.id === id);
  return cfg && sourceFor(cfg);
};

const ROOT: CarItem[] = [
  { id: 'playlists', title: 'Playlists', browsable: true },
  { id: 'recent', title: 'Recently added', browsable: true },
  { id: 'favorites', title: 'Favorites', browsable: true },
  { id: 'radio', title: 'Radio', browsable: true },
];

const albumItem = (a: Album): CarItem => ({ id: `al:${a.sourceId}:${a.id}`, title: a.title, subtitle: a.artist, art: art(a.coverUrl), browsable: false });

/** A folder's items. Unknown folders are empty. */
export async function carChildren(parent: string): Promise<CarItem[]> {
  if (parent === 'root') return ROOT;
  if (parent === 'playlists') {
    const local: CarItem[] = useLibrary.getState().playlists.filter((p) => p.tracks.length).map((p) => ({
      id: `pl:${p.id}`, title: p.name, subtitle: `${p.tracks.length} songs`, art: art(trackArt(p.tracks.find((t) => trackArt(t)))), browsable: false,
    }));
    const server = (await Promise.all(sources().map((s) => s.getPlaylists?.().catch(() => []) ?? []))).flat()
      .map((p): CarItem => ({ id: `sp:${p.sourceId}:${p.id}`, title: p.name, subtitle: p.trackCount ? `${p.trackCount} songs` : undefined, art: art(p.coverUrl), browsable: false }));
    return [...local, ...server].slice(0, MAX);
  }
  if (parent === 'recent') {
    const lists = await Promise.all(sources().map((s) => s.getRecentAlbums?.(40).catch(() => []) ?? []));
    const albums = lists.flat().sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
    return (isKid() ? albums.filter((a) => !albumNotForKids(a)) : albums).slice(0, MAX).map(albumItem);
  }
  if (parent === 'favorites') {
    const favs = await Promise.all(sources().map((s) => s.getFavorites?.().catch(() => undefined)));
    const albums = favs.flatMap((f) => f?.albums ?? []);
    const songs = favs.reduce((n, f) => n + (f?.tracks.length ?? 0), 0);
    return [
      ...(songs ? [{ id: 'fav', title: 'Liked songs', subtitle: `${songs} songs`, browsable: false }] : []),
      ...(isKid() ? albums.filter((a) => !albumNotForKids(a)) : albums).slice(0, MAX).map(albumItem),
    ];
  }
  if (parent === 'radio') {
    const mine = useSettings.getState().stations;
    const server = (await Promise.all(sources().map((s) => s.getStations?.().catch(() => []) ?? []))).flat();
    const seen = new Set<string>();
    return [...mine, ...server]
      .filter((s) => !seen.has(s.streamUrl) && !!seen.add(s.streamUrl))
      .slice(0, MAX)
      .map((s) => ({ id: `st:${s.sourceId}:${s.id}`, title: s.name, subtitle: 'Live radio', art: art(s.favicon), browsable: false }));
  }
  if (parent.startsWith('search:')) {
    const q = parent.slice(7).trim();
    if (!q) return [];
    const albums = (await search(q)).flatMap((r) => r.albums ?? []);
    return [
      { id: `q:${q}`, title: `Songs matching “${q}”`, browsable: false },
      ...(isKid() ? albums.filter((a) => !albumNotForKids(a)) : albums).slice(0, 30).map(albumItem),
    ];
  }
  return [];
}

const none: Partial<SearchResults> = {};
const search = (q: string) => Promise.all(sources().map((s) => s.search?.(q).catch(() => none) ?? none));

/** The songs to play for an item's id (empty when it's gone or can't be reached). */
export async function carTracks(id: string): Promise<Track[]> {
  const { kind, source: sid, rest } = parseId(id);
  if (kind === 'pl') return useLibrary.getState().playlists.find((p) => p.id === rest)?.tracks ?? [];
  if (kind === 'sp') return (await source(sid)?.getPlaylistTracks?.(rest)) ?? [];
  if (kind === 'al') return (await source(sid)?.getAlbumTracks?.(rest)) ?? [];
  if (kind === 'q') return (await search(id.slice(2))).flatMap((r) => r.tracks ?? []).slice(0, 50);
  if (kind === 'fav') return (await Promise.all(sources().map((s) => s.getFavorites?.().catch(() => undefined)))).flatMap((f) => f?.tracks ?? []);
  if (kind === 'st') {
    const mine = useSettings.getState().stations.find((s) => s.sourceId === sid && s.id === rest);
    const st = mine ?? (await source(sid)?.getStations?.().catch(() => []))?.find((s) => s.id === rest);
    return st ? [stationToTrack(st)] : [];
  }
  return [];
}

/** Play what the car picked. */
export async function carPlay(id: string) {
  const tracks = kidSafe(await carTracks(id));
  if (tracks.length) usePlayer.getState().playTracks(tracks);
}

/** "Hey Google, play … on Wavelength": songs that match first, else the first matching album. */
export async function carSearch(q: string) {
  const p = usePlayer.getState();
  if (!q.trim()) {
    // "play music on Wavelength": carry on, or play liked songs
    if (p.queue.length) return p.playing ? undefined : p.toggle();
    return carPlay('fav');
  }
  const results = await search(q);
  const songs = kidSafe(results.flatMap((r) => r.tracks ?? []));
  if (songs.length) return p.playTracks(songs.slice(0, 50));
  const album = results.flatMap((r) => r.albums ?? []).find((a) => !isKid() || !albumNotForKids(a));
  if (album) return carPlay(`al:${album.sourceId}:${album.id}`);
}
