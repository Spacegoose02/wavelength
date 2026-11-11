import { useEffect } from 'react';
import { create } from 'zustand';
import type { HubFacet, HubItemTags, HubTagValue, HubTrackFacet, HubTrackTags } from '../sources/hub';
import { hubClient, useHub } from '../store/hub';

/**
 * Styles, moods, collections and artist genres from the Hub (hub/src/itemTags.ts): Plex-style metadata that isn't
 * in the music files. The whole list is read once per session (it's small: one row per album or artist that has
 * any) and again ten minutes later when something asks; the editors put what they saved straight in, so pages
 * change at once. Albums match by album artist and title, artists by name, without case, accents or punctuation,
 * the same way the Hub keys them (`tagKey`).
 */

/** The Hub's `tagKey`: "Beyoncé" = "beyonce", "*NSYNC" = "nsync", "It’s" = "its", "&" = "and". */
export function tagKey(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’`]/g, '').replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
export const albumKey = (artist: string, title: string) => `${tagKey(artist)}\u001f${tagKey(title)}`;
/** A song: its album artist, album and title (the Hub's `trackKey`). */
export const songKey = (artist: string, album: string, title: string) => `${albumKey(artist, album)}\u001f${tagKey(title)}`;
export type TrackFacets = Partial<Record<HubTrackFacet, string[]>>;

export type Facets = Partial<Record<HubFacet, string[]>>;
const EMPTY: Facets = {};

interface State {
  /** undefined: not asked yet; false: no Hub, or one too old to keep them. */
  ready?: boolean;
  at: number;
  albums: Record<string, HubItemTags>;
  artists: Record<string, HubItemTags>;
  values: Partial<Record<HubFacet, HubTagValue[]>>;
  load(force?: boolean): Promise<void>;
  /** What an editor just saved. */
  put(t: HubItemTags): void;
  /**
   * Songs' own styles and moods (hub/src/trackTags.ts), loaded apart and only when something needs them (a smart
   * playlist rule on them, Browse on a mood or style): `songs` by songKey, `songAlbums` the names each album's songs
   * have, so rules can skip albums whose songs have none.
   */
  songsAt: number;
  songs: Record<string, TrackFacets>;
  songAlbums: Record<string, Partial<Record<HubTrackFacet, string[]>>>;
  loadSongs(force?: boolean): Promise<void>;
  putSong(t: HubTrackTags): void;
}

let loadingSongs: Promise<void> | undefined;

function songAlbumsOf(songs: HubTrackTags[]): State['songAlbums'] {
  const out: State['songAlbums'] = {};
  for (const t of songs) {
    const a = (out[albumKey(t.artist, t.album)] ??= {});
    for (const [f, names] of Object.entries(t.facets) as [HubTrackFacet, string[]][]) {
      const have = (a[f] ??= []);
      for (const n of names) if (!have.some((h) => h.toLowerCase() === n.toLowerCase())) have.push(n);
    }
  }
  return out;
}

let loading: Promise<void> | undefined;

export const useItemTagStore = create<State>()((set, get) => ({
  at: 0,
  albums: {},
  artists: {},
  values: {},
  songsAt: 0,
  songs: {},
  songAlbums: {},
  loadSongs: (force) => {
    if (!force && get().songsAt && Date.now() - get().songsAt < 10 * 60_000) return Promise.resolve();
    const c = hubClient();
    if (!c) return Promise.resolve();
    loadingSongs ??= c.trackTags().then(
      (r) => set({ songsAt: Date.now(), songs: Object.fromEntries(r.tracks.map((t) => [songKey(t.artist, t.album, t.title), t.facets])), songAlbums: songAlbumsOf(r.tracks) }),
      () => set({ songsAt: Date.now() }),
    ).finally(() => {
      loadingSongs = undefined;
    });
    return loadingSongs;
  },
  putSong: (t) => set((s) => {
    const songs = { ...s.songs, [songKey(t.artist, t.album, t.title)]: t.facets };
    const values = { ...s.values };
    for (const [f, names] of Object.entries(t.facets) as [HubTrackFacet, string[]][]) {
      const have = values[f] ?? [];
      const add = names.filter((n) => !have.some((v) => v.name.toLowerCase() === n.toLowerCase()));
      if (add.length) values[f] = [...have, ...add.map((name) => ({ name, albums: 0, artists: 0, tracks: 1 }))];
    }
    // rebuilt from what's loaded (the album's union can only be worked out again from its songs)
    const list = Object.entries(songs).map(([k, facets]) => {
      const [artist, album, title] = k.split('\u001f');
      return { artist, album, title, facets, sources: {} };
    });
    return { songs, values, songAlbums: songAlbumsOf(list) };
  }),
  load: (force) => {
    if (!force && get().at && Date.now() - get().at < 10 * 60_000) return Promise.resolve();
    const c = hubClient();
    if (!c) {
      set({ ready: false });
      return Promise.resolve();
    }
    loading ??= c.itemTags().then(
      (r) => set({
        ready: true,
        at: Date.now(),
        albums: Object.fromEntries(r.albums.map((t) => [albumKey(t.artist, t.title), t])),
        artists: Object.fromEntries(r.artists.map((t) => [tagKey(t.artist), t])),
        values: r.values,
      }),
      () => set({ ready: false, at: Date.now() }),
    ).finally(() => {
      loading = undefined;
    });
    return loading;
  },
  put: (t) => set((s) => {
    const albums = { ...s.albums };
    const artists = { ...s.artists };
    if (t.kind === 'album') albums[albumKey(t.artist, t.title)] = t;
    else artists[tagKey(t.artist)] = t;
    // new names show up in the suggestions straight away
    const values = { ...s.values };
    for (const [f, names] of Object.entries(t.facets) as [HubFacet, string[]][]) {
      const have = values[f] ?? [];
      const add = names.filter((n) => !have.some((v) => v.name.toLowerCase() === n.toLowerCase()));
      if (add.length) values[f] = [...have, ...add.map((name) => ({ name, albums: t.kind === 'album' ? 1 : 0, artists: t.kind === 'artist' ? 1 : 0 }))];
    }
    return { albums, artists, values };
  }),
}));

/** Loads the list when signed in to a Hub, and gives the store. */
export function useItemTags() {
  const signedIn = useHub((s) => !!s.token);
  const s = useItemTagStore();
  useEffect(() => {
    if (signedIn) void useItemTagStore.getState().load();
  }, [signedIn]);
  return s;
}

/** An album's styles, moods and collections (by its album artist and title). */
export function useAlbumTags(artist: string, title: string): Facets {
  const t = useItemTags().albums[albumKey(artist, title)];
  return t?.facets ?? EMPTY;
}

/** An artist's own genres, styles, moods and collections. */
export function useArtistTags(name: string): Facets {
  const t = useItemTags().artists[tagKey(name)];
  return t?.facets ?? EMPTY;
}

/** A song's own styles and moods, outside React (lib/smartRules.ts): by its album's artist and title and its own title. */
export const songFacets = (albumArtist: string, album: string, title: string): TrackFacets => useItemTagStore.getState().songs[songKey(albumArtist, album, title)] ?? EMPTY;
/** The styles or moods any song of an album has (nothing when the songs aren't loaded). */
export const albumSongNames = (artist: string, title: string, f: HubTrackFacet): string[] => useItemTagStore.getState().songAlbums[albumKey(artist, title)]?.[f] ?? [];

/** Outside React (lib/browse.ts): what the store has now. Components re-render on `useItemTags()`. */
export const albumFacets = (artist: string, title: string): Facets => useItemTagStore.getState().albums[albumKey(artist, title)]?.facets ?? EMPTY;
export const artistFacets = (name: string): Facets => useItemTagStore.getState().artists[tagKey(name)]?.facets ?? EMPTY;

export const FACET_LABELS: Record<HubFacet, string> = { genre: 'Genres', style: 'Styles', mood: 'Moods', collection: 'Collections' };
