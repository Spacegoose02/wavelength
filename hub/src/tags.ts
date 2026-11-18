import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

export const TAG_KEYS = [
  'title', 'artist', 'album', 'albumArtist', 'track', 'disc', 'year', 'genre',
  // the Edit album / Edit artist dialogs (src/views/AlbumEditor.tsx, ArtistEditor.tsx)
  'albumSort', 'artistSort', 'albumArtistSort', 'label', 'releaseType', 'mood',
] as const;
export type TagKey = (typeof TAG_KEYS)[number];
export type Tags = Partial<Record<TagKey, string>>;

/**
 * Tags only some formats can hold: ID3 (mp3) and Vorbis comments (FLAC, Ogg, Opus) take any name, but ffmpeg writes
 * only a fixed set of MP4 atoms and drops the rest, so an .m4a keeps no sort names, record label, release type or mood.
 * A Save leaves those tags out for such files instead of saying it wrote them.
 */
const EXTRA: readonly TagKey[] = ['albumSort', 'artistSort', 'albumArtistSort', 'label', 'releaseType', 'mood'];
const ANY_TAG = /\.(mp3|flac|ogg|opus|oga)$/i;
export const canWrite = (file: string, k: TagKey) => !EXTRA.includes(k) || ANY_TAG.test(file);

/**
 * What ffmpeg calls each tag when writing. The names Navidrome reads (its resources/mappings.yaml): in an mp3 the
 * sort names are the TSOA / TSOP frames (ffmpeg's "album-sort" / "artist-sort"), the label is TPUB ("publisher"),
 * and the rest go in TXXX frames under their own name; Vorbis comments use the plain names.
 */
function ffName(file: string, k: TagKey): string {
  const mp3 = /\.mp3$/i.test(file);
  switch (k) {
    case 'albumArtist': return 'album_artist';
    case 'year': return 'date';
    case 'albumSort': return mp3 ? 'album-sort' : 'albumsort';
    case 'artistSort': return mp3 ? 'artist-sort' : 'artistsort';
    case 'albumArtistSort': return 'albumartistsort';
    case 'label': return mp3 ? 'publisher' : 'label';
    case 'releaseType': return 'releasetype';
    default: return k;
  }
}
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
  albumSort: ['albumsort', 'album-sort', 'sort_album', 'tsoa'],
  artistSort: ['artistsort', 'artist-sort', 'sort_artist', 'tsop'],
  albumArtistSort: ['albumartistsort', 'album_artist-sort', 'sort_album_artist', 'tso2'],
  label: ['label', 'publisher', 'organization', 'tpub'],
  releaseType: ['releasetype', 'musicbrainz_albumtype', 'musicbrainz album type', 'release type'],
  mood: ['mood', 'tmoo'],
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
  // yt-dlp writes a video's upload day as the date, run together (20260921): the Year is its first four digits
  if (out.year && /^\d{8}$/.test(out.year)) out.year = out.year.slice(0, 4);
  return out;
}

interface Picture { index: number; codec: string; width: number; height: number; description: string; front: boolean }

/** The cover pictures ffmpeg found in a file: an Ogg file's METADATA_BLOCK_PICTURE comment shows up as one of these. */
async function pictures(file: string): Promise<Picture[]> {
  const r = await run(FFPROBE, ['-v', 'error', '-show_entries', 'stream=index,codec_type,codec_name,width,height:stream_disposition=attached_pic:stream_tags=title,comment', '-of', 'json', '--', file])
    .catch(() => ({ code: 1, out: '', err: '' }));
  if (r.code !== 0) return [];
  const json = JSON.parse(r.out || '{}') as { streams?: { index: number; codec_type?: string; codec_name?: string; width?: number; height?: number; disposition?: { attached_pic?: number }; tags?: Record<string, string> }[] };
  return (json.streams ?? [])
    .filter((s) => s.codec_type === 'video' && s.disposition?.attached_pic && PICTURE_MIME[s.codec_name ?? ''])
    .map((s) => ({ index: s.index, codec: s.codec_name!, width: s.width ?? 0, height: s.height ?? 0, description: s.tags?.title ?? '', front: /front/i.test(s.tags?.comment ?? '') }));
}
const PICTURE_MIME: Record<string, string> = { mjpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

/** A FLAC picture block (what Vorbis comments carry in METADATA_BLOCK_PICTURE), as a front cover. */
export function pictureBlock(image: Buffer, mime: string, width: number, height: number, description = ''): Buffer {
  const m = Buffer.from(mime), d = Buffer.from(description);
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
  return Buffer.concat([u32(3), u32(m.length), m, u32(d.length), d, u32(width), u32(height), u32(24), u32(0), u32(image.length), image]);
}

/** Text safe inside an ffmetadata file: these characters need a backslash. */
const ffmetaEscape = (s: string) => s.replace(/[\\=;#\n]/g, (c) => `\\${c}`);

/**
 * ffmpeg's Ogg muxer can't write a picture stream (it fails with "Could not write header (incorrect codec
 * parameters ?)"), so an Ogg / Opus file with cover art, which yt-dlp's --embed-thumbnail makes, is copied with
 * its audio only and the cover goes back in as a METADATA_BLOCK_PICTURE comment. That comment is far too big for
 * a command-line argument, so it travels in an ffmetadata file. Returns the extra input's ffmpeg arguments.
 */
async function oggCover(file: string, work: string): Promise<{ input: string[]; mapping: string[] }> {
  const pics = await pictures(file);
  const pic = pics.find((p) => p.front) ?? pics[0];
  if (!pic) return { input: [], mapping: [] };
  const img = `${work}.img`;
  try {
    const r = await run(FFMPEG, ['-v', 'error', '-nostdin', '-y', '-i', file, '-map', `0:${pic.index}`, '-c', 'copy', '-frames:v', '1', '-f', 'image2pipe', '--', img]);
    if (r.code !== 0 || !existsSync(img) || statSync(img).size === 0) throw new HttpError(502, `Couldn't copy the cover of ${basename(file)}: ${r.err.trim().split('\n').pop() ?? ''}`);
    const block = pictureBlock(readFileSync(img), PICTURE_MIME[pic.codec]!, pic.width, pic.height, pic.description).toString('base64');
    writeFileSync(`${work}.meta`, `;FFMETADATA1\n[STREAM]\nMETADATA_BLOCK_PICTURE=${ffmetaEscape(block)}\n`);
  } finally {
    rmSync(img, { force: true });
  }
  return { input: ['-f', 'ffmetadata', '-i', `${work}.meta`], mapping: ['-map_metadata:s:a:0', '1:s:0'] };
}

/** Set these tags (an empty string removes one); the others stay as they are. */
export async function writeTags(file: string, tags: Tags): Promise<void> {
  const keys = TAG_KEYS.filter((k) => tags[k] !== undefined && canWrite(file, k));
  if (!keys.length) return;
  const ext = extname(file);
  const tmp = join(dirname(file), `.wavelength-${randomBytes(6).toString('hex')}${ext}`);
  const ogg = STREAM_TAGS.test(file);
  const flag = ogg ? '-metadata:s:a:0' : '-metadata';
  const cover = ogg ? await oggCover(file, tmp) : { input: [], mapping: [] };
  try {
    // an Ogg file takes only its audio across: its cover is a comment (oggCover), and the Ogg muxer refuses a picture stream
    const args = ['-v', 'error', '-nostdin', '-y', '-i', file, ...cover.input, '-map', ogg ? '0:a' : '0', '-c', 'copy', '-map_metadata', '0'];
    if (ogg) args.push('-map_metadata:s:a', '0:s:a', ...cover.mapping);
    for (const k of keys) args.push(flag, `${ffName(file, k)}=${tags[k]!.replace(/[\r\n]+/g, ' ').slice(0, 1000)}`);
    if (/\.mp3$/i.test(file)) args.push('-id3v2_version', '3');
    args.push('--', tmp);
    const r = await run(FFMPEG, args).catch(() => ({ code: 1, out: '', err: 'ffmpeg is missing' }));
    if (r.code !== 0 || !existsSync(tmp) || statSync(tmp).size === 0) {
      rmSync(tmp, { force: true });
      throw new HttpError(502, `Couldn't write the tags of ${basename(file)}: ${r.err.trim().split('\n').pop() ?? ''}`);
    }
    renameSync(tmp, file);
  } finally {
    rmSync(`${tmp}.meta`, { force: true });
  }
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
    const [full, places] = await Promise.all([
      getJson(`${ART_APIS.deezer}/album/${a.id}`, version).catch(() => null),
      // the album's own tracklist has no track or disc numbers; /tracks has both
      getJson(`${ART_APIS.deezer}/album/${a.id}/tracks?limit=500`, version).then((r) => (r?.data ?? []) as any[]).catch(() => [] as any[]),
    ]);
    if (!full?.tracks?.data?.length) continue;
    const at = new Map(places.filter((t) => t?.id && t.track_position).map((t) => [t.id, t]));
    out.push({
      source: 'Deezer',
      id: String(a.id),
      title: full.title,
      artist: full.artist?.name ?? artist,
      year: String(full.release_date ?? '').slice(0, 4) || undefined,
      genre: full.genres?.data?.[0]?.name,
      cover: full.cover_medium,
      tracks: full.tracks.data.map((t: any, i: number) => {
        const p = at.get(t.id) ?? t;
        return { title: t.title, artist: t.artist?.name ?? full.artist?.name ?? '', track: p.track_position ?? i + 1, disc: p.disk_number ?? 1 };
      }),
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
