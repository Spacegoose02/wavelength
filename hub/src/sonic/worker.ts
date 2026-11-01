import { spawn } from 'node:child_process';
import { setPriority } from 'node:os';
import type { Db } from '../db.ts';
import { getFeatures } from '../features.ts';
import { getScanSettings, navidrome } from '../library.ts';
import { libraryFile } from '../tags.ts';
import { analyse, SR } from './analyse.ts';
import { SonicIndex } from './index.ts';

/**
 * Sound-alike analysis (Settings → Features → Sound-alike analysis, off by default). While it's on, the Hub lists
 * the Navidrome library (with the scan login, docs/HUB.md "Library updates") every hour, and analyses each song it
 * hasn't yet, one at a time at low priority: ffmpeg decodes 60 seconds from about a third of the way in, and
 * sonic/analyse.ts measures it. Roughly 1–2 seconds a song on a NAS, so a 20 000-song library takes most of a
 * night the first time. Needs the music folder mapped into the Hub (WAVELENGTH_MUSIC_DIR), like the tag editor.
 */

const FFMPEG = process.env.WAVELENGTH_FFMPEG || 'ffmpeg';
const LIST_EVERY = 3600_000;
const IDLE_MS = 10 * 60_000;
const SECONDS = 60;

export interface SonicStatus {
  on: boolean;
  /** why it can't run, when it can't */
  blocked: string | null;
  total: number;
  analysed: number;
  failed: number;
  running: boolean;
  current: string | null;
  lastListAt: number | null;
  lastError: string | null;
}

/** Decode a stretch of a file to mono floats at SR. */
export function decode(file: string, start: number, seconds: number): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-v', 'error', '-nostdin', '-ss', String(Math.max(0, start)), '-t', String(seconds), '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', 'pipe:1']);
    try {
      if (p.pid) setPriority(p.pid, 19);
    } catch {
      // not allowed here: it runs at normal priority
    }
    const chunks: Buffer[] = [];
    let err = '';
    p.stdout.on('data', (c: Buffer) => chunks.push(c));
    p.stderr.on('data', (c: Buffer) => (err += c.toString()).length > 2000 && (err = err.slice(-2000)));
    p.on('error', (e) => reject(new Error(`ffmpeg: ${e.message}`)));
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim().split('\n').pop() || `ffmpeg exited with ${code}`));
      const b = Buffer.concat(chunks);
      resolve(new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4)).slice());
    });
  });
}

export class SonicWorker {
  readonly index: SonicIndex;
  private db: Db;
  private key: Buffer;
  private musicDir: string;
  private navidromeDir: string;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private running = false;
  private current: string | null = null;
  private lastListAt: number | null = null;
  private lastError: string | null = null;
  /** for tests */
  decodeFn = decode;

  constructor(db: Db, key: Buffer, musicDir: string, navidromeDir: string) {
    this.db = db;
    this.key = key;
    this.musicDir = musicDir;
    this.navidromeDir = navidromeDir;
    this.index = new SonicIndex(db);
  }

  private blocked(): string | null {
    if (!getFeatures(this.db).sonic.on) return 'Sound-alike analysis is switched off in Settings → Features.';
    if (!this.musicDir) return 'The Hub has no music folder. Map your music share to /music (WAVELENGTH_MUSIC_DIR).';
    if (!getScanSettings(this.db, this.key)) return 'The Hub needs a Navidrome admin login (Settings → Server → Library updates) to list the songs.';
    return null;
  }

  status(): SonicStatus {
    const c = this.db.prepare('SELECT COUNT(*) AS total, COUNT(features) AS analysed, COUNT(error) AS failed FROM sonic_songs').get() as { total: number; analysed: number; failed: number };
    return { on: getFeatures(this.db).sonic.on, blocked: this.blocked(), ...c, running: this.running, current: this.current, lastListAt: this.lastListAt, lastError: this.lastError };
  }

  start() {
    this.stopped = false;
    this.schedule(5_000);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** List the library again now (and carry on analysing). */
  kick() {
    this.lastListAt = null;
    this.schedule(0);
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
    this.timer.unref?.();
  }

  /** Songs from Navidrome into sonic_songs: new ones added, changed paths re-analysed, gone ones dropped. */
  async list(): Promise<number> {
    const s = getScanSettings(this.db, this.key);
    if (!s) return 0;
    const seen = new Set<string>();
    const upsert = this.db.prepare(`INSERT INTO sonic_songs (id, path, title, artist, album, duration) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET title = excluded.title, artist = excluded.artist, album = excluded.album, duration = excluded.duration,
        features = CASE WHEN sonic_songs.path = excluded.path THEN sonic_songs.features ELSE NULL END,
        error = CASE WHEN sonic_songs.path = excluded.path THEN sonic_songs.error ELSE NULL END,
        path = excluded.path`);
    for (let offset = 0; offset < 500_000; offset += 500) {
      const r = await navidrome(s, 'search3', { query: '', songCount: '500', songOffset: String(offset), artistCount: '0', albumCount: '0' });
      const songs = (r?.searchResult3?.song ?? []) as { id: string; path?: string; title?: string; artist?: string; album?: string; duration?: number }[];
      for (const x of songs) {
        if (!x.id || !x.path) continue;
        seen.add(String(x.id));
        upsert.run(String(x.id), x.path, x.title ?? '', x.artist ?? '', x.album ?? '', Math.round(x.duration ?? 0));
      }
      if (songs.length < 500) break;
    }
    if (seen.size) {
      const ids = (this.db.prepare('SELECT id FROM sonic_songs').all() as { id: string }[]).map((r) => r.id).filter((id) => !seen.has(id));
      const del = this.db.prepare('DELETE FROM sonic_songs WHERE id = ?');
      for (const id of ids) del.run(id);
    }
    this.lastListAt = Date.now();
    this.index.version++;
    return seen.size;
  }

  /** Analyse one song by id (the worker's step; also for tests). */
  async analyseOne(row: { id: string; path: string; duration: number }) {
    try {
      const file = libraryFile(this.musicDir, this.navidromeDir, row.path);
      const offset = row.duration > 90 ? Math.round(row.duration * 0.3) : 0;
      const samples = await this.decodeFn(file, offset, SECONDS);
      if (samples.length < SR * 5) throw new Error('too short to analyse');
      const f = analyse(samples);
      this.db.prepare('UPDATE sonic_songs SET features = ?, error = NULL, analysed_at = ? WHERE id = ?').run(JSON.stringify({ ...f, offset }), Date.now(), row.id);
    } catch (e) {
      this.db.prepare('UPDATE sonic_songs SET error = ?, analysed_at = ? WHERE id = ?').run(String((e as Error).message ?? e).slice(0, 300), Date.now(), row.id);
    }
    this.index.version++;
  }

  private async tick() {
    if (this.running) return;
    if (this.blocked()) return this.schedule(IDLE_MS);
    this.running = true;
    try {
      if (!this.lastListAt || Date.now() - this.lastListAt > LIST_EVERY) await this.list();
      // a batch, then a breather, so the Hub stays quick
      const rows = this.db.prepare('SELECT id, path, title, artist, duration FROM sonic_songs WHERE features IS NULL AND error IS NULL LIMIT 20').all() as { id: string; path: string; title: string; artist: string; duration: number }[];
      for (const r of rows) {
        if (this.stopped || this.blocked()) break;
        this.current = `${r.artist} – ${r.title}`;
        await this.analyseOne(r);
      }
      this.current = null;
      this.lastError = null;
      this.schedule(rows.length ? 500 : IDLE_MS);
    } catch (e) {
      this.lastError = String((e as Error).message ?? e);
      this.schedule(IDLE_MS);
    } finally {
      this.running = false;
    }
  }
}
