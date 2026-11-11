import type { Catalog, NavidromeFile } from './catalog.ts';
import type { Db } from './db.ts';
import { HttpError } from './http.ts';
import { getScanSettings } from './library.ts';
import { navidromeAdmin } from './routes/navidrome.ts';

/**
 * Where Library care, the tag editor, the genre review and Delete album get their lists of albums and songs
 * (phase 2 of the Hub's own music server, docs/HUB.md "Music catalog").
 *
 * From the Hub's catalog once it has matched (nearly) every Navidrome song to a file: no sign-in to Navidrome's
 * API, no paging over HTTP, no 429s. Before that (a Hub that just started, a library Navidrome sees at other
 * paths), from Navidrome's own API as before. An album the catalog doesn't know yet (Navidrome scanned it a
 * moment ago) is asked of Navidrome too. Ids are still Navidrome's, since the app plays by them.
 */
export interface AdminLibrary {
  /** where the lists came from, for tests and the server page */
  from: 'catalog' | 'navidrome';
  albumSongs(albumId: string): Promise<{ id: string; path: string; title: string; artist: string; album: string; albumArtist?: string }[]>;
  songs(start: number, end: number): Promise<{ songs: { id: string; path: string; title: string; trackNumber: number; albumId: string; album: string; artist: string; albumArtist: string }[]; total: number }>;
  albums(): Promise<{ id: string; name: string; artist: string; genres: string[]; songs: number }[]>;
  names(): Promise<{ artists: string[]; genres: string[] }>;
}

export async function libraryAdmin(db: Db, key: Buffer, catalog: Catalog): Promise<AdminLibrary> {
  // without Navidrome the catalog is the library (ids and all), so there's nothing else to ask
  if (catalog.standalone()) {
    if (!catalog.usable()) throw new HttpError(409, 'The Hub hasn’t scanned the music folder yet. Scan it under Settings → Server → Music catalog');
    return {
      from: 'catalog',
      albumSongs: async (albumId) => catalog.albumSongs(albumId),
      songs: async (start, end) => catalog.songs(start, end),
      albums: async () => catalog.albums(),
      names: async () => catalog.names(),
    };
  }
  const s = getScanSettings(db, key);
  if (!s) throw new HttpError(409, 'Add the Navidrome admin login under Settings → Server first');
  let nd: ReturnType<typeof navidromeAdmin> | undefined;
  const navidrome = () => (nd ??= navidromeAdmin(s.url, s.username, s.password));
  if (!catalog.usable()) {
    const n = await navidrome();
    return { from: 'navidrome', albumSongs: n.albumSongs, songs: n.songs, albums: n.albums, names: n.names };
  }
  return {
    from: 'catalog',
    async albumSongs(albumId) {
      const songs = catalog.albumSongs(albumId);
      return songs.length ? songs : (await navidrome()).albumSongs(albumId);
    },
    songs: async (start, end) => catalog.songs(start, end),
    albums: async () => catalog.albums(),
    names: async () => catalog.names(),
  };
}

/**
 * Every Navidrome song's real file path and album artist id, from Navidrome's own API (5000 songs a page, one sign-in kept 10 minutes).
 * Subsonic answers with made-up paths unless a player has Report Real Path on. null without the admin login.
 */
export async function navidromeRealPaths(db: Db, key: Buffer): Promise<Map<string, NavidromeFile> | null> {
  const s = getScanSettings(db, key);
  if (!s) return null;
  const nd = await navidromeAdmin(s.url, s.username, s.password);
  const out = new Map<string, NavidromeFile>();
  const PAGE = 5000;
  for (let start = 0; start < 2_000_000; start += PAGE) {
    const { songs, total } = await nd.songs(start, start + PAGE);
    for (const x of songs) if (x.id && x.path) out.set(x.id, { path: x.path, albumArtistId: x.albumArtistId || undefined });
    if (songs.length < PAGE || start + PAGE >= total) break;
  }
  return out;
}
