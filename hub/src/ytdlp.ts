import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { downloadImage } from './artwork.ts';
import { HttpError } from './http.ts';
import { writeTags } from './tags.ts';

/**
 * yt-dlp on the Hub: search, and download into the music folder the Hub has mounted (/music), laid out
 * as Artist / Album / Title like the desktop app does. Nothing needs a network-share login because the
 * Hub writes to the folder directly. Jobs live in memory: a restart forgets finished ones.
 */

export interface YtResult {
  id: string;
  title: string;
  channel: string;
  url: string;
  duration?: number;
  thumbnail?: string;
}

/**
 * What a download is known to be, when the app knows better than YouTube (Discover's yt-dlp backup knows the chart's
 * artist, title and cover). Without it the file is named and tagged from the video, so the artist is the uploader's
 * channel ("OFFSETYRN") and the cover is a video frame.
 */
export interface YtTags {
  artist: string;
  title: string;
  /** Defaults to the title: a song on its own is a single. */
  album?: string;
  /** A picture link, saved as cover.jpg (or .png/.webp) next to the song. */
  cover?: string;
}

export interface YtJob {
  jobId: string;
  userId: number;
  username: string;
  title: string;
  channel: string;
  url: string;
  status: 'queued' | 'downloading' | 'processing' | 'done' | 'error';
  percent: number;
  message?: string;
  createdAt: number;
  /** Not sent to the app: what the file is tagged as once it's in (YtTags). */
  tags?: YtTags;
}

const FORMATS = ['opus', 'm4a', 'mp3', 'flac'];
const MAX_RUNNING = 2;
const KEEP_JOBS = 200;

export function run(bin: string, args: string[], onLine?: (l: string) => void): Promise<{ code: number; out: string; err: string }> {
  return new Promise((done, fail) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', buf = '';
    p.stdout.on('data', (d: Buffer) => {
      const s = d.toString();
      if (!onLine) return void (out += s);
      buf += s;
      const lines = buf.split('\n');
      buf = lines.pop()!;
      lines.forEach(onLine);
    });
    p.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-8000)));
    p.on('error', (e) => fail(new HttpError(501, `yt-dlp isn't available on the Hub (${e.message})`)));
    p.on('close', (code) => {
      if (buf && onLine) onLine(buf);
      done({ code: code ?? 1, out, err });
    });
  });
}

/** A tag value as a folder or file name: no path separators or characters Windows shares refuse. */
export const safeName = (s: string) =>
  [...s].map((c) => (c.charCodeAt(0) < 32 ? ' ' : c)).join('').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '').slice(0, 120).trim() || 'Unknown';
/** yt-dlp output templates treat % as the start of a field. */
const literal = (s: string) => s.replace(/%/g, '%%');
const FILE_LINE = '[wavelength-file] ';

const lastLine = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? 'yt-dlp failed';
const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s);

export class YtdlpRunner {
  private jobs: YtJob[] = [];
  private running = 0;
  /** Called when a download ends, done or not (library.ts follows requests and rescans). */
  onFinished?: (job: YtJob) => void;
  private bin: string;
  private musicDir: string;
  constructor(bin: string, musicDir: string) {
    this.bin = bin;
    this.musicDir = musicDir;
  }

  /** Search YouTube, or expand any URL yt-dlp supports (playlist, Bandcamp album, SoundCloud set …). */
  async search(query: string, count = 25): Promise<YtResult[]> {
    const q = query.trim().slice(0, 500);
    if (!q) return [];
    // `--` so a query can never be read as an option
    const r = await run(this.bin, ['-J', '--flat-playlist', '--no-warnings', '--', isUrl(q) ? q : `ytsearch${Math.max(1, Math.min(50, Math.round(count)))}:${q}`]);
    if (r.code !== 0) throw new HttpError(502, lastLine(r.err));
    const json = JSON.parse(r.out);
    const entries: any[] = json.entries ?? [json];
    return entries
      .filter((e) => e && (e.url || e.webpage_url || e.id))
      .map((e) => ({
        id: String(e.id),
        title: e.title ?? e.id,
        channel: e.channel ?? e.uploader ?? e.artist ?? '',
        url: e.webpage_url ?? (String(e.url ?? '').startsWith('http') ? e.url : `https://www.youtube.com/watch?v=${e.id}`),
        duration: e.duration ?? undefined,
        thumbnail: e.thumbnails?.at(-1)?.url ?? e.thumbnail,
      }));
  }

  /** Where downloads go: a folder inside the music folder, never outside it. */
  outDir(folder: string): string {
    if (!this.musicDir) throw new HttpError(501, 'The Hub has no music folder. Map your music share to /music (WAVELENGTH_MUSIC_DIR)');
    const root = resolve(this.musicDir);
    if (!existsSync(root)) throw new HttpError(501, `The Hub's music folder (${this.musicDir}) isn't there. Map your music share to it`);
    const dir = resolve(root, folder || 'yt-dlp');
    if (dir !== root && !dir.startsWith(root + sep)) throw new HttpError(400, 'The yt-dlp folder must be inside the music folder');
    return dir;
  }

  start(user: { id: number; username: string }, r: { url: string; title?: string; channel?: string; tags?: YtTags }, opts: { folder: string; format: string }): YtJob {
    if (!isUrl(r.url)) throw new HttpError(400, 'Send the http(s) link to download');
    const dir = this.outDir(opts.folder);
    const job: YtJob = {
      jobId: randomUUID(),
      userId: user.id,
      username: user.username,
      title: String(r.title ?? r.url).slice(0, 300),
      channel: String(r.channel ?? '').slice(0, 200),
      url: r.url,
      status: 'queued',
      percent: 0,
      createdAt: Date.now(),
      ...(r.tags?.artist && r.tags.title && { tags: r.tags }),
    };
    this.jobs.unshift(job);
    this.jobs.length = Math.min(this.jobs.length, KEEP_JOBS);
    const format = FORMATS.includes(opts.format) ? opts.format : 'opus';
    this.queue.push(() => this.download(job, dir, format));
    this.pump();
    return job;
  }

  private queue: (() => Promise<void>)[] = [];
  private pump() {
    while (this.running < MAX_RUNNING && this.queue.length) {
      const next = this.queue.shift()!;
      this.running++;
      next().finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  private async download(job: YtJob, dir: string, format: string) {
    job.status = 'downloading';
    const t = job.tags;
    const album = t ? t.album || t.title : '';
    // known song: Artist / Single / Title, and the final path printed so its tags can be set after
    const out = t
      ? join(dir, literal(safeName(t.artist)), literal(safeName(album)), `${literal(safeName(t.title))}.%(ext)s`)
      : join(dir, '%(artist,creator,uploader)s', '%(album|Singles)s', '%(title)s.%(ext)s');
    const args = [
      '-x', '--audio-format', format, '--audio-quality', '0',
      '--embed-metadata', '--embed-thumbnail', '--convert-thumbnails', 'jpg',
      '--newline', '--no-warnings',
      '--progress-template', 'download:[wavelength] %(progress._percent_str)s',
      // --print makes yt-dlp quiet; --progress keeps the percent lines coming
      ...(t ? ['--print', `after_move:${FILE_LINE}%(filepath)s`, '--progress'] : []),
      '-o', out,
      ...(job.url.includes('watch?v=') ? ['--no-playlist'] : []),
      '--', job.url,
    ];
    let file: string | undefined;
    try {
      const r = await run(this.bin, args, (line) => {
        if (line.startsWith('[wavelength]')) {
          const pct = parseFloat(line.slice(12));
          if (Number.isFinite(pct)) job.percent = pct;
        } else if (line.startsWith(FILE_LINE)) {
          file = line.slice(FILE_LINE.length).trim();
          job.status = 'processing';
          job.percent = 100;
        } else if (/^\[(ExtractAudio|Metadata|EmbedThumbnail)\]/.test(line)) {
          job.status = 'processing';
          job.percent = 100;
        }
      });
      if (r.code === 0) {
        if (t && file) await this.retag(job, file, t, album);
        Object.assign(job, { status: 'done', percent: 100 });
      } else Object.assign(job, { status: 'error', message: lastLine(r.err) });
    } catch (e) {
      Object.assign(job, { status: 'error', message: (e as Error).message });
    }
    this.onFinished?.(job);
  }

  /**
   * Tag a finished download as the song it is, not the video: artist, title, album (and album artist, so it groups
   * with the artist's other music), plus the cover next to it. A failure here keeps the file and says so on the job.
   */
  private async retag(job: YtJob, file: string, t: YtTags, album: string) {
    const root = resolve(this.musicDir);
    const path = resolve(file);
    if (!path.startsWith(root + sep) || !existsSync(path)) return;
    const problems: string[] = [];
    await writeTags(path, { artist: t.artist, title: t.title, album, albumArtist: t.artist }).catch((e) => problems.push((e as Error).message));
    const folder = dirname(path);
    const hasCover = readdirSync(folder).some((f) => /^(cover|folder|front)\.(jpe?g|png|webp)$/i.test(f));
    // https only: the link comes from the app, and the Hub shouldn't be pointed at addresses on the home network
    if (t.cover?.startsWith('https://') && !hasCover) {
      await downloadImage(t.cover)
        .then(({ bytes, type }) => writeFileSync(join(folder, `cover.${type}`), bytes))
        .catch((e) => problems.push(`No cover: ${(e as Error).message}`));
    }
    if (problems.length) job.message = problems.join(' · ').slice(0, 300);
  }

  /** A person's own jobs, or everyone's for admins. */
  list(userId: number | null): YtJob[] {
    return this.jobs.filter((j) => userId === null || j.userId === userId).map(({ tags: _, ...j }) => j);
  }

  clearFinished(userId: number | null) {
    this.jobs = this.jobs.filter((j) => !((userId === null || j.userId === userId) && (j.status === 'done' || j.status === 'error')));
  }
}
