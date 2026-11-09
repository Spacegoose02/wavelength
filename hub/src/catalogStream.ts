import { spawn } from 'node:child_process';
import { createReadStream, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db.ts';

/**
 * Phase 4 of the Hub's own music server (docs/HUB.md "Music catalog"): Subsonic's `stream` and `download` answered
 * from the music folder instead of Navidrome, for devices that go through the Hub (routes/relay.ts).
 *
 * - The file as it is (`format=raw`, no format, or a `maxBitRate` the file is already under): sent straight from the
 *   disk, with Range requests (seeking) and a length, like Navidrome's own.
 * - A lower bitrate or another format asked for (`maxBitRate=128`, `format=mp3|opus|aac`): converted with ffmpeg
 *   as it plays. No seeking inside a converted stream, as with Navidrome's; players restart it from the offset
 *   they want (`timeOffset`).
 * - A song the catalog doesn't know, or a file that has gone: null, and Navidrome plays it as before.
 */

const FFMPEG = process.env.WAVELENGTH_FFMPEG || 'ffmpeg';
const TYPES: Record<string, string> = {
  mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', alac: 'audio/mp4',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', aiff: 'audio/aiff', aif: 'audio/aiff',
  wma: 'audio/x-ms-wma', ape: 'audio/x-ape', wv: 'audio/x-wavpack', dsf: 'audio/dsf',
};
/** What a conversion makes: ffmpeg's codec and container, and the content type. */
const OUTPUTS: Record<string, { args: string[]; type: string }> = {
  mp3: { args: ['-c:a', 'libmp3lame', '-f', 'mp3'], type: 'audio/mpeg' },
  opus: { args: ['-c:a', 'libopus', '-f', 'ogg'], type: 'audio/ogg' },
  aac: { args: ['-c:a', 'aac', '-f', 'adts'], type: 'audio/aac' },
};

interface SongFile {
  path: string;
  bitRate: number | null;
}

function songFile(db: Db, id: string): SongFile | null {
  const r = db.prepare('SELECT path, bit_rate FROM catalog_songs WHERE nd_id = ? AND error IS NULL').get(id) as { path: string; bit_rate: number | null } | undefined;
  return r ? { path: r.path, bitRate: r.bit_rate } : null;
}

/** What to send: the file as it is, or converted to `format` at `kbps`. */
export function plan(file: SongFile, q: Record<string, string>, download: boolean): { raw: true } | { raw: false; format: string; kbps: number } | null {
  if (download) return { raw: true };
  const want = (q.format ?? '').toLowerCase();
  const max = Number.parseInt(q.maxBitRate ?? '', 10) || 0;
  if (want === 'raw' || (!want && (!max || (file.bitRate !== null && file.bitRate <= max)))) return { raw: true };
  const suffix = extname(file.path).slice(1).toLowerCase();
  // "the same format, no faster than this" and the file is already that: as it is
  if (want && want === suffix && (!max || (file.bitRate !== null && file.bitRate <= max))) return { raw: true };
  const format = want || 'mp3';
  if (!OUTPUTS[format]) return null; // a format we don't make: Navidrome's
  return { raw: false, format, kbps: Math.min(Math.max(max || 192, 32), 320) };
}

/** `bytes=500-` → [500, size - 1]; null for anything we can't answer as one range. */
function range(header: string | undefined, size: number): [number, number] | 'bad' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return 'bad';
  let start: number, end: number;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start > end || start >= size ? 'bad' : [start, end];
}

/**
 * Play or download a song from the music folder. Returns false when the Hub can't (an id it doesn't know, a file that
 * has gone, a format it doesn't make), and the caller asks Navidrome.
 */
export function sendSong(db: Db, musicDir: string, id: string, q: Record<string, string>, req: FastifyRequest, reply: FastifyReply, download: boolean): boolean {
  const file = songFile(db, id);
  if (!file) return false;
  const how = plan(file, q, download);
  if (!how) return false;
  const full = join(musicDir, file.path);
  let st;
  try {
    st = statSync(full);
  } catch {
    return false;
  }
  if (!st.isFile()) return false;
  reply.header('x-wavelength-answered-by', 'hub');
  const name = file.path.split('/').pop() ?? 'song';

  if (how.raw) {
    const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    reply.header('accept-ranges', 'bytes').header('etag', etag).header('last-modified', st.mtime.toUTCString()).header('cache-control', 'private, max-age=3600');
    reply.header('content-type', TYPES[extname(full).slice(1).toLowerCase()] ?? 'application/octet-stream');
    if (download) reply.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    if (req.headers['if-none-match'] === etag) {
      reply.code(304).send();
      return true;
    }
    const r = range(typeof req.headers.range === 'string' ? req.headers.range : undefined, st.size);
    if (r === 'bad') {
      reply.code(416).header('content-range', `bytes */${st.size}`).send();
      return true;
    }
    if (r) {
      reply.code(206).header('content-range', `bytes ${r[0]}-${r[1]}/${st.size}`).header('content-length', String(r[1] - r[0] + 1));
      reply.send(createReadStream(full, { start: r[0], end: r[1] }));
    } else {
      reply.code(200).header('content-length', String(st.size));
      reply.send(createReadStream(full));
    }
    return true;
  }

  const out = OUTPUTS[how.format];
  const offset = Math.max(0, Number(q.timeOffset) || 0);
  const ff = spawn(FFMPEG, ['-v', 'error', '-nostdin', ...(offset ? ['-ss', String(offset)] : []), '-i', full, '-map', '0:a:0', '-vn', '-b:a', `${how.kbps}k`, ...out.args, 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
  // the reply is done or the player went away (skip, seek): stop converting
  reply.raw.on('close', () => ff.kill('SIGKILL'));
  ff.on('error', () => undefined);
  reply.code(200).header('content-type', out.type).header('cache-control', 'no-store').header('accept-ranges', 'none');
  reply.send(ff.stdout);
  return true;
}
