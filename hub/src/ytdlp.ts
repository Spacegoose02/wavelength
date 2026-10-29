import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { HttpError } from './http.ts';

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

const lastLine = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? 'yt-dlp failed';
const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s);

export class YtdlpRunner {
  private jobs: YtJob[] = [];
  private running = 0;
  private bin: string;
  private musicDir: string;
  constructor(bin: string, musicDir: string) {
    this.bin = bin;
    this.musicDir = musicDir;
  }

  /** Search YouTube, or expand any URL yt-dlp supports (playlist, Bandcamp album, SoundCloud set …). */
  async search(query: string): Promise<YtResult[]> {
    const q = query.trim().slice(0, 500);
    if (!q) return [];
    // `--` so a query can never be read as an option
    const r = await run(this.bin, ['-J', '--flat-playlist', '--no-warnings', '--', isUrl(q) ? q : `ytsearch25:${q}`]);
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

  start(user: { id: number; username: string }, r: { url: string; title?: string; channel?: string }, opts: { folder: string; format: string }): YtJob {
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
    const args = [
      '-x', '--audio-format', format, '--audio-quality', '0',
      '--embed-metadata', '--embed-thumbnail', '--convert-thumbnails', 'jpg',
      '--newline', '--no-warnings',
      '--progress-template', 'download:[wavelength] %(progress._percent_str)s',
      '-o', join(dir, '%(artist,creator,uploader)s', '%(album|Singles)s', '%(title)s.%(ext)s'),
      ...(job.url.includes('watch?v=') ? ['--no-playlist'] : []),
      '--', job.url,
    ];
    try {
      const r = await run(this.bin, args, (line) => {
        if (line.startsWith('[wavelength]')) {
          const pct = parseFloat(line.slice(12));
          if (Number.isFinite(pct)) job.percent = pct;
        } else if (/^\[(ExtractAudio|Metadata|EmbedThumbnail)\]/.test(line)) {
          job.status = 'processing';
          job.percent = 100;
        }
      });
      if (r.code === 0) Object.assign(job, { status: 'done', percent: 100 });
      else Object.assign(job, { status: 'error', message: lastLine(r.err) });
    } catch (e) {
      Object.assign(job, { status: 'error', message: (e as Error).message });
    }
  }

  /** A person's own jobs, or everyone's for admins. */
  list(userId: number | null): YtJob[] {
    return this.jobs.filter((j) => userId === null || j.userId === userId);
  }

  clearFinished(userId: number | null) {
    this.jobs = this.jobs.filter((j) => !((userId === null || j.userId === userId) && (j.status === 'done' || j.status === 'error')));
  }
}
