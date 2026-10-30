import { getJson, http, qs } from './http';
import { hubClient } from '../store/hub';
import { readSpotifyEmbed } from './spotifyEmbed';

/**
 * Read a playlist from somewhere else (docs/USER-GUIDE.md "Import a playlist"): a Deezer, Spotify or
 * YouTube (Music) link, or a CSV, M3U or text file. Only titles and artists come in; views/ImportPlaylist.tsx
 * matches them to the library and offers to get what's missing.
 */

export interface ImportedSong {
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  /** Deezer's own link, when it came from Deezer (requests and deemix use it as is). */
  deezerLink?: string;
}

export interface Imported {
  name: string;
  songs: ImportedSong[];
}

// ---- files ----

/** Split one CSV line, with quoted fields ("a, b" and "" for a quote). */
function csvFields(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) out.push(cur), (cur = '');
    else cur += ch;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

/** CSV with a header row: Exportify (Spotify), TuneMyMusic, Soundiiz, or any "title, artist" sheet. */
export function parseCsv(text: string): ImportedSong[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = [',', ';', '\t'].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const head = csvFields(lines[0], sep).map((h) => h.toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  let t = col('track name', 'title', 'song', 'name', 'track');
  let a = col('artist name', 'artist', 'artists', 'performer');
  const al = col('album name', 'album');
  let rows = lines.slice(1);
  // no header we know: first column title, second artist
  if (t < 0 || a < 0) [t, a, rows] = [0, 1, lines];
  return rows
    .map((l) => csvFields(l, sep))
    // Exportify lists several artists as "A,B" or "A;B": the first is the one to match
    .map((f) => ({ title: f[t] ?? '', artist: (f[a] ?? '').split(/\s*[;,]\s*/)[0], album: al >= 0 ? f[al] || undefined : undefined }))
    .filter((s) => s.title && s.artist);
}

/** M3U / M3U8: "#EXTINF:123,Artist - Title" lines, else the file path (…/Artist/Album/01 Title.flac). */
export function parseM3u(text: string): ImportedSong[] {
  const out: ImportedSong[] = [];
  let info: ImportedSong | undefined;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const m = /^#EXTINF:[^,]*,(.+?)\s+[-–]\s+(.+)$/.exec(line);
      info = m ? { artist: m[1].trim(), title: m[2].trim() } : undefined;
    } else if (!line.startsWith('#')) {
      if (info) out.push(info);
      else {
        const parts = line.replace(/\\/g, '/').split('/').filter(Boolean);
        const file = (parts.pop() ?? '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/^\d{1,3}[\s.-]+/, '');
        const album = parts.length >= 2 ? parts.pop() : undefined;
        const artist = parts.pop();
        const m = /^(.+?)\s+-\s+(.+)$/.exec(file);
        if (m && !artist) out.push({ artist: m[1], title: m[2] });
        else if (artist && file) out.push({ artist, title: m && m[1] === artist ? m[2] : file, album });
      }
      info = undefined;
    }
  }
  return out;
}

/** One "Artist - Title" per line. */
export const parseText = (text: string): ImportedSong[] =>
  text.split(/\r?\n/).map((l) => /^(.+?)\s+[-–—]\s+(.+)$/.exec(l.trim())).filter(Boolean).map((m) => ({ artist: m![1], title: m![2] }));

export function parseFile(name: string, text: string): Imported {
  const base = name.replace(/\.[^.]+$/, '');
  if (/\.m3u8?$/i.test(name) || text.startsWith('#EXTM3U')) return { name: base, songs: parseM3u(text) };
  if (/\.(csv|tsv)$/i.test(name)) return { name: base, songs: parseCsv(text) };
  return { name: base, songs: parseText(text) };
}

// ---- links ----

export const linkKind = (url: string): 'deezer' | 'spotify' | 'youtube' | undefined => {
  if (/^https?:\/\/(www\.)?deezer\.com\//i.test(url)) return 'deezer';
  if (/^https?:\/\/open\.spotify\.com\//i.test(url)) return 'spotify';
  if (/^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(url)) return 'youtube';
  return undefined;
};

async function fromDeezer(url: string): Promise<Imported> {
  const m = /deezer\.com\/(?:[a-z]{2}\/)?(playlist|album)\/(\d+)/i.exec(url);
  if (!m) throw new Error('Paste a Deezer playlist or album link');
  const [, kind, id] = m;
  const info = await getJson(`https://api.deezer.com/${kind}/${id}`);
  if (info?.error) throw new Error(`Deezer: ${info.error.message ?? 'not found'}`);
  const songs: ImportedSong[] = [];
  for (let index = 0; index < 10_000; index += 500) {
    const page = await getJson(`https://api.deezer.com/${kind}/${id}/tracks?${qs({ limit: 500, index })}`);
    const data: any[] = page?.data ?? [];
    for (const t of data) {
      songs.push({ title: t.title, artist: t.artist?.name ?? '', album: t.album?.title ?? info.title, cover: t.album?.cover_medium ?? info.cover_medium, deezerLink: t.link });
    }
    if (data.length < 500 || !page.next) break;
  }
  return { name: info.title ?? 'Deezer playlist', songs };
}

/** Spotify's embed page carries the list (no Spotify login needed; up to the first 100 songs or so): lib/spotifyEmbed.ts. */
async function fromSpotify(url: string): Promise<Imported> {
  const m = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(playlist|album)\/([A-Za-z0-9]+)/.exec(url);
  if (!m) throw new Error('Paste a Spotify playlist or album link');
  const res = await http(`https://open.spotify.com/embed/${m[1]}/${m[2]}`);
  if (!res.ok) throw new Error(`Spotify answered ${res.status}. Is the playlist public?`);
  const { name, songs } = readSpotifyEmbed(await res.text());
  if (!songs.length) throw new Error("Couldn't read that Spotify playlist. Export it as CSV (exportify.app) and import the file instead");
  return { name: name ?? 'Spotify playlist', songs: songs.map(({ title, artist }) => ({ title, artist })) };
}

async function fromYoutube(url: string): Promise<Imported> {
  const c = hubClient();
  if (!c) throw new Error('YouTube playlists are read by your Hub. Sign in to it first');
  const { tracks } = await c.importYoutube(url);
  return { name: 'YouTube playlist', songs: tracks.filter((t) => t.title && t.artist) };
}

export function fromLink(url: string): Promise<Imported> {
  const kind = linkKind(url.trim());
  if (kind === 'deezer') return fromDeezer(url.trim());
  if (kind === 'spotify') return fromSpotify(url.trim());
  if (kind === 'youtube') return fromYoutube(url.trim());
  return Promise.reject(new Error('Paste a Deezer, Spotify or YouTube Music playlist link, or choose a file'));
}
