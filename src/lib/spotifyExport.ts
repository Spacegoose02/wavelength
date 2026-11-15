import { parseCsv } from './playlistImport';
import { isZip, readZip } from './zip';

/**
 * What Move from Spotify brings over (docs/USER-GUIDE.md "Move from Spotify"), read from either:
 *
 * - Spotify's own data export (Account → Privacy → Request data → "Account data"): a zip with
 *   `Playlist1.json` (every playlist you made, all its songs) and `YourLibrary.json` (liked songs as `tracks`,
 *   followed artists as `artists`). Unzipped .json files work too.
 * - Exportify (exportify.app): one CSV per playlist, or its "Export all" zip; `liked_songs.csv` is Liked Songs.
 *
 * Signing in instead (hub/src/spotify.ts) gives the same shape. views/SpotifyImport.tsx matches it to the library.
 */

export interface SpotifySong {
  title: string;
  artist: string;
  album?: string;
}

export interface SpotifyBundle {
  account?: string;
  playlists: { name: string; songs: SpotifySong[] }[];
  liked: SpotifySong[];
  artists: string[];
  /** Playlists Spotify sign-in wouldn't hand over (someone else's), with their link. */
  skipped: { name: string; url?: string }[];
}

export const emptyBundle = (): SpotifyBundle => ({ playlists: [], liked: [], artists: [], skipped: [] });

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const song = (title: unknown, artist: unknown, album?: unknown): SpotifySong | undefined => {
  const t = str(title), a = str(artist), al = str(album);
  return t && a ? { title: t, artist: a, ...(al && { album: al }) } : undefined;
};
const some = <T,>(xs: (T | undefined)[]) => xs.filter((x): x is T => !!x);

const base = (path: string) => path.replace(/\\/g, '/').split('/').pop() ?? path;
/** Exportify names files after the playlist with _ for spaces. */
const csvName = (path: string) => base(path).replace(/\.(csv|tsv)$/i, '').replace(/_/g, ' ').trim() || 'Spotify playlist';
const isLiked = (path: string) => /^liked[ _]?songs\.(csv|tsv)$/i.test(base(path));

/** Add one file's worth to the bundle. Files that aren't Spotify's are left out. */
export function addFile(into: SpotifyBundle, path: string, text: string) {
  const name = base(path);
  if (/\.(csv|tsv)$/i.test(name)) {
    const songs = parseCsv(text).map(({ title, artist, album }) => ({ title, artist, ...(album && { album }) }));
    if (!songs.length) return;
    if (isLiked(name)) into.liked.push(...songs);
    else into.playlists.push({ name: csvName(name), songs });
    return;
  }
  if (!/\.json$/i.test(name)) return;
  let data: any;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return;
  }
  if (/^Playlist\d*\.json$/i.test(name) && Array.isArray(data?.playlists)) {
    for (const p of data.playlists) {
      const songs = some<SpotifySong>((p?.items ?? []).map((i: any) => i?.track && song(i.track.trackName, i.track.artistName, i.track.albumName)));
      into.playlists.push({ name: str(p?.name) || 'Spotify playlist', songs });
    }
  } else if (/^YourLibrary\.json$/i.test(name)) {
    into.liked.push(...some<SpotifySong>((data?.tracks ?? []).map((t: any) => song(t?.track, t?.artist, t?.album))));
    into.artists.push(...some<string>((data?.artists ?? []).map((a: any) => str(a?.name) || undefined)));
  } else if (/^Userdata\.json$/i.test(name)) {
    into.account ??= str(data?.username) || undefined;
  }
}

/** Only these are opened: the export also holds listening history, search queries and more that aren't needed. */
const wanted = (path: string) => /(^|\/)(Playlist\d*|YourLibrary|Userdata)\.json$/i.test(path) || /\.(csv|tsv)$/i.test(path);

const key = (s: SpotifySong) => `${s.title.toLowerCase()}\u0000${s.artist.toLowerCase()}`;

/** Read the files someone chose: zips, .json and .csv, any mix. */
export async function readSpotifyFiles(files: { name: string; blob: Blob }[]): Promise<SpotifyBundle> {
  const b = emptyBundle();
  for (const f of files) {
    if (/\.zip$/i.test(f.name) || (await isZip(f.blob))) {
      for (const e of await readZip(f.blob)) if (wanted(e.name) && !/(^|\/)__MACOSX\//.test(e.name)) addFile(b, e.name, await e.text());
    } else addFile(b, f.name, await f.blob.text());
  }
  // the same file chosen twice, or the same songs in two exports
  const seenLists = new Set<string>();
  b.playlists = b.playlists.filter((p) => {
    const k = `${p.name}\u0000${p.songs.map(key).join('|')}`;
    return !seenLists.has(k) && !!seenLists.add(k);
  });
  const seen = new Set<string>();
  b.liked = b.liked.filter((s) => !seen.has(key(s)) && !!seen.add(key(s)));
  const names = new Set<string>();
  b.artists = b.artists.filter((a) => !names.has(a.toLowerCase()) && !!names.add(a.toLowerCase()));
  return b;
}
