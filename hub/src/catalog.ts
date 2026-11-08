import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { setPriority } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Db } from './db.ts';
import { tx } from './db.ts';
import { AUDIO_EXT } from './tags.ts';

/**
 * The Hub's own catalog of the music folder (phase 1 of replacing Navidrome, see
 * reviews/wavelength-own-music-server-2026-11-08.md and docs/HUB.md "Music catalog").
 *
 * The Hub walks the music folder (WAVELENGTH_MUSIC_DIR) itself and keeps one row per music file in
 * `catalog_songs`: its tags, length, format, and the Navidrome song it is (matched by path, from the listing the
 * library index already makes). Navidrome still scans, streams and owns ids; nothing here changes what the app
 * plays. Later phases build genre browsing, Library care and finally the Hub's own Subsonic API on this table.
 *
 * - A walk only stats files; a file is read (ffprobe, four at a time, low priority) when it is new or its size or
 *   change time moved, so after the first scan a walk of the whole library takes seconds.
 * - Hidden folders (".wavelength-trash", ".stfolder" …) and folders with a `.ndignore` are skipped, as Navidrome does.
 * - A walk that finds less than half the files the catalog has (the share isn't mounted, say) drops nothing.
 */

const FFPROBE = process.env.WAVELENGTH_FFPROBE || 'ffprobe';
const WALK_EVERY = 60 * 60_000;
const CHECK_EVERY = 5 * 60_000;
const PARALLEL = 4;
const BATCH = 200;

/** What a file says about itself. */
export interface FileTags {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  track: number | null;
  disc: number | null;
  year: number | null;
  genre: string;
  /** ITUNESADVISORY: 'explicit', 'clean', or '' */
  explicit: string;
  duration: number;
  bitRate: number | null;
  codec: string;
  mbTrackId: string;
  mbAlbumId: string;
}

export interface CatalogStatus {
  /** why it can't run, when it can't */
  blocked: string | null;
  files: number;
  failed: number;
  /** files matched to a Navidrome song */
  linked: number;
  /** songs Navidrome listed last time (the library index) */
  navidromeSongs: number;
  scanning: boolean;
  /** what the running scan is doing: walking the folders, or reading files (done of total) */
  progress: { step: 'walking' | 'reading'; done: number; total: number } | null;
  lastScanAt: number | null;
  /** how long the last scan took */
  lastScanMs: number | null;
  /** files added, changed and removed by the last scan */
  lastChanges: { added: number; changed: number; removed: number } | null;
  lastLinkAt: number | null;
  lastError: string | null;
}

/** Turn ffprobe's tag names (any case, ID3 / Vorbis / MP4) into FileTags. */
export function parseProbe(json: { format?: { duration?: string; bit_rate?: string; tags?: Record<string, string> }; streams?: { codec_type?: string; codec_name?: string; tags?: Record<string, string> }[] }): FileTags {
  const all: Record<string, string> = {};
  // stream tags first (Ogg/Opus keep them there), then the file's own win
  for (const t of [...(json.streams ?? []).map((s) => s.tags), json.format?.tags]) {
    for (const [k, v] of Object.entries(t ?? {})) if (v !== undefined && v !== '') all[k.toLowerCase().replace(/[\s_]+/g, '')] = String(v).trim();
  }
  const get = (...names: string[]) => names.map((n) => all[n]).find((v) => v !== undefined) ?? '';
  const num = (v: string) => {
    const n = Number.parseInt(v, 10); // "3/12" → 3
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const advisory = get('itunesadvisory', 'rtng');
  const audio = (json.streams ?? []).find((s) => s.codec_type === 'audio');
  const year = num(get('date', 'year', 'originaldate', 'originalyear').slice(0, 4));
  return {
    title: get('title'),
    artist: get('artist'),
    album: get('album'),
    albumArtist: get('albumartist'),
    track: num(get('track', 'tracknumber')),
    disc: num(get('disc', 'discnumber')),
    year,
    genre: get('genre'),
    explicit: advisory === '1' || advisory === '4' ? 'explicit' : advisory === '2' ? 'clean' : '',
    duration: Math.round(Number(json.format?.duration ?? 0) * 1000) / 1000 || 0,
    bitRate: num(String(Math.round(Number(json.format?.bit_rate ?? 0) / 1000))),
    codec: audio?.codec_name ?? '',
    mbTrackId: get('musicbrainztrackid', 'musicbrainzreleasetrackid'),
    mbAlbumId: get('musicbrainzalbumid'),
  };
}

/** Read one file's tags with ffprobe, at low priority. */
export function probe(file: string): Promise<FileTags> {
  return new Promise((done, fail) => {
    const p = spawn(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration,bit_rate:format_tags:stream=codec_type,codec_name:stream_tags', '-of', 'json', '--', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      if (p.pid) setPriority(p.pid, 19);
    } catch {
      // not allowed here: normal priority
    }
    let out = '';
    let err = '';
    p.stdout.on('data', (d: Buffer) => (out += d.toString()));
    p.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
    p.on('error', (e) => fail(new Error(`ffprobe isn't available (${e.message})`)));
    p.on('close', (code) => {
      if (code !== 0) return fail(new Error(err.trim().split('\n').pop() || `ffprobe exited with ${code}`));
      try {
        done(parseProbe(JSON.parse(out || '{}')));
      } catch (e) {
        fail(e as Error);
      }
    });
  });
}

interface Seen {
  size: number;
  mtime: number;
}

/** Every music file under `root` (relative paths), skipping hidden and .ndignore'd folders. */
export async function walk(root: string, onFile: (rel: string, s: Seen) => void): Promise<void> {
  const dirs = [root];
  while (dirs.length) {
    const dir = dirs.pop() as string;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (dir === root) throw e;
      continue; // a folder we can't read: leave its files out
    }
    if (dir !== root && entries.some((e) => e.name === '.ndignore')) continue;
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) dirs.push(full);
      else if (e.isFile() && AUDIO_EXT.test(e.name)) {
        try {
          const s = await stat(full);
          onFile(relative(root, full), { size: s.size, mtime: Math.floor(s.mtimeMs) });
        } catch {
          // gone between readdir and stat
        }
      }
    }
  }
}

/** Navidrome's path for a song (absolute in its container, or relative to its library) as a path in our folder. */
export function fromNavidromePath(navidromeRoot: string, path: string): string | null {
  const ndRoot = navidromeRoot.replace(/\/+$/, '');
  if (!path) return null;
  if (!isAbsolute(path)) return path.replace(/^\.\//, '');
  return path.startsWith(`${ndRoot}/`) ? path.slice(ndRoot.length + 1) : null;
}

/** A song from the library index, with Navidrome's path for it. */
export interface NavidromeSong {
  id: string;
  albumId?: string;
  artistId?: string;
  path?: string;
}

export class Catalog {
  private db: Db;
  private musicDir: string;
  private navidromeDir: string;
  private timer?: ReturnType<typeof setTimeout>;
  /** not scheduling scans (start() not called, or stopped) */
  private stopped = true;
  /** stop() was called: a running scan finishes early */
  private closed = false;
  private scanning = false;
  private progress: CatalogStatus['progress'] = null;
  private lastScanAt: number | null = null;
  private lastScanMs: number | null = null;
  private lastChanges: CatalogStatus['lastChanges'] = null;
  private lastLinkAt: number | null = null;
  private navidromeSongs = 0;
  private lastError: string | null = null;
  private running: Promise<void> | null = null;
  /** Navidrome's songs, for linking (the library index's listing: libraryIndex.ts). Set by app.ts. */
  listNavidrome: () => Promise<NavidromeSong[] | null> = async () => null;
  /** When Navidrome last finished a scan, to scan the folder again after it (library.ts). */
  scannedAt: () => number | null = () => null;
  /** for tests */
  probeFn = probe;
  now: () => number = Date.now;

  constructor(db: Db, musicDir: string, navidromeDir: string) {
    this.db = db;
    this.musicDir = musicDir;
    this.navidromeDir = navidromeDir;
  }

  private blocked(): string | null {
    if (!this.musicDir) return 'The Hub has no music folder. Map your music share to /music (WAVELENGTH_MUSIC_DIR).';
    return null;
  }

  status(): CatalogStatus {
    const c = this.db.prepare('SELECT COUNT(*) AS files, COUNT(error) AS failed, COUNT(nd_id) AS linked FROM catalog_songs').get() as { files: number; failed: number; linked: number };
    return {
      blocked: this.blocked(),
      ...c,
      navidromeSongs: this.navidromeSongs,
      scanning: this.scanning,
      progress: this.progress,
      lastScanAt: this.lastScanAt,
      lastScanMs: this.lastScanMs,
      lastChanges: this.lastChanges,
      lastLinkAt: this.lastLinkAt,
      lastError: this.lastError,
    };
  }

  start() {
    this.stopped = false;
    this.schedule(30_000);
  }

  stop() {
    this.stopped = true;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** Scan now (and wait for it). One at a time: a second call waits for the running scan. */
  scan(): Promise<void> {
    this.running ??= this.run().finally(() => (this.running = null));
    return this.running;
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
    this.timer.unref?.();
  }

  private async tick() {
    const scanned = this.scannedAt();
    const due = this.lastScanAt === null || this.now() - this.lastScanAt > WALK_EVERY || (scanned !== null && scanned > this.lastScanAt);
    if (due && !this.blocked()) await this.scan().catch(() => undefined);
    this.schedule(CHECK_EVERY);
  }

  private async run() {
    const blocked = this.blocked();
    if (blocked) {
      this.lastError = blocked;
      return;
    }
    const started = this.now();
    this.scanning = true;
    try {
      await this.readFolder();
      await this.link();
      this.lastError = null;
    } catch (e) {
      this.lastError = String((e as Error).message ?? e);
      throw e;
    } finally {
      this.scanning = false;
      this.progress = null;
      this.lastScanAt = this.now();
      this.lastScanMs = this.now() - started;
    }
  }

  /** Walk the folder, read new and changed files, drop gone ones. */
  private async readFolder() {
    const root = resolve(this.musicDir);
    const known = new Map<string, Seen>();
    for (const r of this.db.prepare('SELECT path, size, mtime FROM catalog_songs').all() as { path: string; size: number; mtime: number }[]) known.set(r.path, { size: r.size, mtime: r.mtime });

    this.progress = { step: 'walking', done: 0, total: 0 };
    const found = new Map<string, Seen>();
    await walk(root, (rel, s) => {
      found.set(rel, s);
      if (this.progress) this.progress.done = found.size;
    });

    const todo = [...found].filter(([p, s]) => {
      const k = known.get(p);
      return !k || k.size !== s.size || k.mtime !== s.mtime;
    });
    const gone = [...known.keys()].filter((p) => !found.has(p));
    // an unmounted share looks like an empty folder: keep what we know
    const dropGone = !(known.size >= 20 && found.size < known.size / 2);

    const added = todo.filter(([p]) => !known.has(p)).length;
    this.progress = { step: 'reading', done: 0, total: todo.length };
    const upsert = this.db.prepare(`INSERT INTO catalog_songs (path, size, mtime, title, artist, album, album_artist, track, disc, year, genre, explicit,
        duration, bit_rate, codec, mb_track_id, mb_album_id, error, read_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, title = excluded.title, artist = excluded.artist,
        album = excluded.album, album_artist = excluded.album_artist, track = excluded.track, disc = excluded.disc, year = excluded.year,
        genre = excluded.genre, explicit = excluded.explicit, duration = excluded.duration, bit_rate = excluded.bit_rate,
        codec = excluded.codec, mb_track_id = excluded.mb_track_id, mb_album_id = excluded.mb_album_id, error = excluded.error,
        read_at = excluded.read_at`);
    let pending: [string, Seen, FileTags | null, string | null][] = [];
    const flush = () => {
      const rows = pending;
      pending = [];
      tx(this.db, () => {
        for (const [p, s, t, err] of rows) {
          upsert.run(p, s.size, s.mtime, t?.title ?? '', t?.artist ?? '', t?.album ?? '', t?.albumArtist ?? '', t?.track ?? null, t?.disc ?? null, t?.year ?? null,
            t?.genre ?? '', t?.explicit ?? '', t?.duration ?? 0, t?.bitRate ?? null, t?.codec ?? '', t?.mbTrackId ?? '', t?.mbAlbumId ?? '', err, this.now());
        }
      });
    };
    let next = 0;
    const worker = async () => {
      while (next < todo.length && !this.closed) {
        const [p, s] = todo[next++];
        try {
          pending.push([p, s, await this.probeFn(join(root, p)), null]);
        } catch (e) {
          pending.push([p, s, null, String((e as Error).message ?? e).slice(0, 300)]);
        }
        if (this.progress) this.progress.done++;
        if (pending.length >= BATCH) flush();
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    if (pending.length) flush();
    if (dropGone && gone.length) {
      const del = this.db.prepare('DELETE FROM catalog_songs WHERE path = ?');
      tx(this.db, () => gone.forEach((p) => del.run(p)));
    }
    this.lastChanges = { added, changed: todo.length - added, removed: dropGone ? gone.length : 0 };
    if (!dropGone && gone.length) throw new Error(`The music folder has only ${found.size} of the ${known.size} files the catalog knows. Is the share mounted? Nothing was removed.`);
  }

  /** Match files to Navidrome's songs by path, from the library index's listing. */
  async link() {
    const songs = await this.listNavidrome().catch(() => null);
    if (!songs) return;
    const byPath = new Map<string, NavidromeSong>();
    for (const s of songs) {
      const rel = s.path ? fromNavidromePath(this.navidromeDir, s.path) : null;
      if (rel) byPath.set(rel, s);
    }
    const rows = this.db.prepare('SELECT path, nd_id, nd_album_id, nd_artist_id FROM catalog_songs').all() as { path: string; nd_id: string | null; nd_album_id: string | null; nd_artist_id: string | null }[];
    const set = this.db.prepare('UPDATE catalog_songs SET nd_id = ?, nd_album_id = ?, nd_artist_id = ? WHERE path = ?');
    tx(this.db, () => {
      for (const r of rows) {
        const s = byPath.get(r.path);
        const id = s?.id ?? null;
        const album = s?.albumId ?? null;
        const artist = s?.artistId ?? null;
        if (id !== r.nd_id || album !== r.nd_album_id || artist !== r.nd_artist_id) set.run(id, album, artist, r.path);
      }
    });
    this.navidromeSongs = songs.length;
    this.lastLinkAt = this.now();
  }
}
