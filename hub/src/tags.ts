import { randomBytes } from 'node:crypto';
import { existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { ART_APIS } from './artwork.ts';
import { HttpError } from './http.ts';
import { run } from './ytdlp.ts';

/**
 * The tag editor (docs/USERS-AND-ADMIN.md Phase 5): read and write the tags in the music files under the
 * Hub's music folder with ffprobe / ffmpeg (both in the image), and look albums up on Deezer and MusicBrainz
 * to fill them in. Writing copies the file with the new tags and swaps it in, so a failed write never
 * leaves a half-written file; the audio itself is copied as is.
 */

export const TAG_KEYS = ['title', 'artist', 'album', 'albumArtist', 'track', 'disc', 'year', 'genre'] as const;
export type TagKey = (typeof TAG_KEYS)[number];
export type Tags = Partial<Record<TagKey, string>>;

/** What ffmpeg calls each tag when writing. */
const FF: Record<TagKey, string> = { title: 'title', artist: 'artist', album: 'album', albumArtist: 'album_artist', track: 'track', disc: 'disc', year: 'date', genre: 'genre' };
/** The names files use for each tag when reading (ID3, Vorbis comments, MP4 all differ). */
const READ: Record<TagKey, string[]> = {
  title: ['title'],
  artist: ['artist'],
  album: ['album'],
  albumArtist: ['album_artist', 'albumartist', 'album artist'],
  track: ['track', 'tracknumber'],
  disc: ['disc', 'discnumber'],
  year: ['date', 'year', 'originaldate'],
  genre: ['genre'],
};
export const AUDIO_EXT = /\.(mp3|flac|m4a|mp4|aac|ogg|opus|oga|wma|wav|aiff?)$/i;
/** Ogg files keep their tags on the audio stream rather than the file. */
const STREAM_TAGS = /\.(ogg|opus|oga)$/i;

const FFPROBE = process.env.WAVELENGTH_FFPROBE || 'ffprobe';
const FFMPEG = process.env.WAVELENGTH_FFMPEG || 'ffmpeg';

/** A path from Navidrome (absolute in its container, or relative to its library) as a file in our music folder. */
export function libraryFile(musicDir: string, navidromeRoot: string, path: string): string {
  if (!musicDir) throw new HttpError(501, 'The Hub has no music folder. Map your music share to /music (WAVELENGTH_MUSIC_DIR)');
  const root = resolve(musicDir);
  const ndRoot = navidromeRoot.replace(/\/+$/, '');
  const rel = isAbsolute(path) ? (path.startsWith(`${ndRoot}/`) ? path.slice(ndRoot.length + 1) : '') : path;
  const file = resolve(root, rel);
  if (!rel || !file.startsWith(root + '/') || !AUDIO_EXT.test(file)) throw new HttpError(400, `${basename(path)} isn't a music file in the Hub's music folder`);
  if (!existsSync(file) || !statSync(file).isFile()) {
    throw new HttpError(404, `The Hub can't find ${rel} in its music folder. If Navidrome sees your music somewhere other than ${ndRoot}, set WAVELENGTH_NAVIDROME_MUSIC_DIR`);
  }
  return file;
}

/** Make a file's path safe to hand back to the app: relative to the music folder. */
export const relPath = (musicDir: string, file: string) => relative(resolve(musicDir), file);

export async function readTags(file: string): Promise<Tags> {
  const r = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'json', '--', file]).catch(() => ({ code: 1, out: '', err: 'ffprobe is missing' }));
  if (r.code !== 0) throw new HttpError(502, `Couldn't read the tags of ${basename(file)}: ${r.err.trim().split('\n').pop() ?? ''}`);
  const json = JSON.parse(r.out || '{}') as { format?: { tags?: Record<string, string> }; streams?: { tags?: Record<string, string> }[] };
  const all: Record<string, string> = {};
  for (const t of [...(json.streams ?? []).map((s) => s.tags), json.format?.tags]) {
    for (const [k, v] of Object.entries(t ?? {})) all[k.toLowerCase()] = String(v);
  }
  const out: Tags = {};
  for (const k of TAG_KEYS) {
    const v = READ[k].map((n) => all[n]).find((x) => x !== undefined && x !== '');
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Set these tags (an empty string removes one); the others stay as they are. */
export async function writeTags(file: string, tags: Tags): Promise<void> {
  const keys = TAG_KEYS.filter((k) => tags[k] !== undefined);
  if (!keys.length) return;
  const ext = extname(file);
  const tmp = join(dirname(file), `.wavelength-${randomBytes(6).toString('hex')}${ext}`);
  const flag = STREAM_TAGS.test(file) ? '-metadata:s:a:0' : '-metadata';
  const args = ['-v', 'error', '-nostdin', '-y', '-i', file, '-map', '0', '-c', 'copy', '-map_metadata', '0'];
  if (STREAM_TAGS.test(file)) args.push('-map_metadata:s:a', '0:s:a');
  for (const k of keys) args.push(flag, `${FF[k]}=${tags[k]!.replace(/[\r\n]+/g, ' ').slice(0, 1000)}`);
  if (/\.mp3$/i.test(file)) args.push('-id3v2_version', '3');
  args.push('--', tmp);
  const r = await run(FFMPEG, args).catch(() => ({ code: 1, out: '', err: 'ffmpeg is missing' }));
  if (r.code !== 0 || !existsSync(tmp) || statSync(tmp).size === 0) {
    rmSync(tmp, { force: true });
    throw new HttpError(502, `Couldn't write the tags of ${basename(file)}: ${r.err.trim().split('\n').pop() ?? ''}`);
  }
  renameSync(tmp, file);
}

// ---- looking albums up ----

export interface MatchTrack { title: string; artist: string; track: number; disc: number }
export interface MatchCandidate {
  source: 'Deezer' | 'MusicBrainz';
  id: string;
  title: string;
  artist: string;
  year?: string;
  genre?: string;
  cover?: string;
  tracks: MatchTrack[];
}

const UA = (version: string) => `Wavelength-Hub/${version} (https://github.com/Spacegoose02/wavelength)`;
async function getJson(url: string, version: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json', 'user-agent': UA(version) } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}
const quote = (s: string) => `"${s.replace(/["\\]/g, ' ')}"`;

async function deezerMatches(artist: string, album: string, version: string): Promise<MatchCandidate[]> {
  const found = await getJson(`${ART_APIS.deezer}/search/album?limit=3&q=${encodeURIComponent(`artist:${quote(artist)} album:${quote(album)}`)}`, version);
  const out: MatchCandidate[] = [];
  for (const a of (found?.data ?? []).slice(0, 3)) {
    const full = await getJson(`${ART_APIS.deezer}/album/${a.id}`, version).catch(() => null);
    if (!full?.tracks?.data?.length) continue;
    out.push({
      source: 'Deezer',
      id: String(a.id),
      title: full.title,
      artist: full.artist?.name ?? artist,
      year: String(full.release_date ?? '').slice(0, 4) || undefined,
      genre: full.genres?.data?.[0]?.name,
      cover: full.cover_medium,
      tracks: full.tracks.data.map((t: any, i: number) => ({ title: t.title, artist: t.artist?.name ?? full.artist?.name ?? '', track: t.track_position ?? i + 1, disc: t.disk_number ?? 1 })),
    });
  }
  return out;
}

async function musicBrainzMatches(artist: string, album: string, version: string): Promise<MatchCandidate[]> {
  const found = await getJson(`${ART_APIS.musicbrainz}/ws/2/release?fmt=json&limit=3&query=${encodeURIComponent(`release:${quote(album)} AND artist:${quote(artist)}`)}`, version);
  const out: MatchCandidate[] = [];
  for (const r of (found?.releases ?? []).slice(0, 3)) {
    const full = await getJson(`${ART_APIS.musicbrainz}/ws/2/release/${encodeURIComponent(r.id)}?fmt=json&inc=recordings+artist-credits+genres`, version).catch(() => null);
    if (!full?.media?.length) continue;
    const credit = (c: any[] | undefined) => (c ?? []).map((x) => `${x.name}${x.joinphrase ?? ''}`).join('') || artist;
    out.push({
      source: 'MusicBrainz',
      id: String(r.id),
      title: full.title,
      artist: credit(full['artist-credit']),
      year: String(full.date ?? '').slice(0, 4) || undefined,
      genre: [...(full.genres ?? [])].sort((a: any, b: any) => (b.count ?? 0) - (a.count ?? 0))[0]?.name,
      tracks: full.media.flatMap((m: any, d: number) => (m.tracks ?? []).map((t: any, i: number) => ({
        title: t.title, artist: credit(t['artist-credit'] ?? full['artist-credit']), track: Number(t.position ?? i + 1), disc: Number(m.position ?? d + 1),
      }))),
    });
  }
  return out;
}

/** Albums that look like this one, from Deezer then MusicBrainz. A service that fails is left out. */
export async function findMatches(artist: string, album: string, version: string): Promise<MatchCandidate[]> {
  const [dz, mb] = await Promise.all([deezerMatches(artist, album, version).catch(() => []), musicBrainzMatches(artist, album, version).catch(() => [])]);
  return [...dz, ...mb];
}
