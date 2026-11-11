import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { setPriority } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Db } from './db.ts';
import { tx } from './db.ts';
import { AUDIO_EXT, type Tags } from './tags.ts';

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
  /** REPLAYGAIN_* tags, in dB (gain) and 0–1 (peak); null when the file has none */
  trackGain: number | null;
  albumGain: number | null;
  trackPeak: number | null;
  albumPeak: number | null;
}

/** Navidrome's own record of a file (libraryAdmin.ts navidromeFiles): its real path and album artist. */
export interface NavidromeFile {
  path: string;
  albumArtistId?: string;
}

let version = 0;
/** what each recent version changed: some files (by path), or null for anything */
let changes: { version: number; paths: string[] | null }[] = [];
/** Goes up whenever catalog_songs changes, so copies of it in memory (subsonicCatalog.ts) know to update. */
export const catalogVersion = () => version;
/** catalog_songs changed: these files only (an empty list changes nothing), or anything when no list is given. */
export const catalogChanged = (paths?: string[]) => {
  if (paths && !paths.length) return;
  version++;
  changes.push({ version, paths: paths ?? null });
  if (changes.length > 50) changes = changes.slice(-50);
};
/**
 * The files changed since version `since`, so a copy in memory can update just those (a tag edit, a scan that read a
 * few files); null when it has to be built again (too many, a change of anything, or too long ago).
 */
export function catalogChangesSince(since: number, most = 500): string[] | null {
  if (since === version) return [];
  const after = changes.filter((c) => c.version > since);
  if (!after.length || after[0].version !== since + 1 || after.some((c) => !c.paths)) return null;
  const paths = new Set(after.flatMap((c) => c.paths!));
  return paths.size > most ? null : [...paths];
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
  /** Navidrome's songs with no file in the catalog (the first 100), from the last match */
  missing: MissingSong[];
  scanning: boolean;
  /** what the running scan is doing: walking the folders, or reading files (done of total) */
  progress: { step: 'walking' | 'reading'; done: number; total: number } | null;
  lastScanAt: number | null;
  /** how long the last scan took */
  lastScanMs: number | null;
  /** files added, changed and removed by the last scan */
  lastChanges: { added: number; changed: number; removed: number } | null;
  lastLinkAt: number | null;
  /** Library care, the editors and the genre review read the catalog (usable()), not Navidrome's API */
  inUse: boolean;
  lastError: string | null;
  /** an admin turned on answering browsing from the catalog (Settings → Server → Music catalog) */
  serve: boolean;
  /** serve is on and the catalog is usable(): the Hub answers browsing for devices that go through it */
  serving: boolean;
  /** an admin turned on playing songs from the music folder (phase 4) */
  stream: boolean;
  /** stream is on and the catalog is usable(): the Hub plays songs for devices that go through it */
  streaming: boolean;
  /** an admin turned on keeping hearts, plays and ratings on the Hub (phase 5) */
  userData: boolean;
  /** Navidrome is off: the Hub keeps the ids and answers everything (phase 6) */
  standalone: boolean;
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
    trackGain: decibels(get('replaygaintrackgain')),
    albumGain: decibels(get('replaygainalbumgain')),
    trackPeak: decibels(get('replaygaintrackpeak')),
    albumPeak: decibels(get('replaygainalbumpeak')),
  };
}

/** "-6.50 dB" → -6.5 */
function decibels(v: string): number | null {
  const n = Number.parseFloat(v);
  return v && Number.isFinite(n) ? n : null;
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

/**
 * The Hub just wrote these tags into a file (tag editor, genre review, Library care, undo): put them in the catalog
 * at once, so lists built from it (Library care, the genre review) show the change before the next scan. The file
 * is marked to be read again on the next scan, which picks up everything else the write changed.
 */
export function catalogWrote(db: Db, rel: string, tags: Tags) {
  const cols: Record<string, string> = { title: 'title', artist: 'artist', album: 'album', albumArtist: 'album_artist', genre: 'genre' };
  const sets: string[] = ['mtime = 0'];
  const args: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(tags)) {
    if (v === undefined) continue;
    if (cols[k]) {
      sets.push(`${cols[k]} = ?`);
      args.push(v);
    } else if (k === 'track' || k === 'disc' || k === 'year') {
      const n = Number.parseInt(k === 'year' ? v.slice(0, 4) : v, 10);
      sets.push(`${k} = ?`);
      args.push(Number.isFinite(n) && n > 0 ? n : null);
    }
  }
  db.prepare(`UPDATE catalog_songs SET ${sets.join(', ')} WHERE path = ?`).run(...args, rel);
  catalogChanged([rel]);
}

/** A song as Library care, the tag editor and the genre review list them (Navidrome ids, path in the music folder). */
export interface AdminSong {
  id: string;
  path: string;
  title: string;
  trackNumber: number;
  albumId: string;
  album: string;
  artist: string;
  albumArtist: string;
}

/** Split a genre tag the way Navidrome does ("Rap; Hip-Hop", "Pop/Rock" stays one). */
const splitGenres = (g: string) => [...new Set(g.split(';').map((x) => x.trim()).filter(Boolean))];

/** A song from the library index, with Navidrome's path for it. */
export interface NavidromeSong {
  id: string;
  albumId?: string;
  artistId?: string;
  path?: string;
  title?: string;
  artist?: string;
  album?: string;
}

/** A song Navidrome lists whose file the catalog didn't find (shown on Settings → Server → Music catalog). */
export interface MissingSong {
  title: string;
  artist: string;
  album: string;
  /** Navidrome's path for it */
  path: string;
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
  private missing: MissingSong[] = [];
  private lastError: string | null = null;
  private running: Promise<void> | null = null;
  /** Navidrome's songs, for linking (the library index's listing: libraryIndex.ts). Set by app.ts. */
  listNavidrome: () => Promise<NavidromeSong[] | null> = async () => null;
  /** Navidrome's real file path for each song id (its own API, libraryAdmin.ts), set by app.ts. */
  listRealPaths: () => Promise<Map<string, NavidromeFile> | null> = async () => null;
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

  /**
   * Whether lists can come from the catalog instead of Navidrome's API: a scan finished and matched (nearly) every
   * song Navidrome has to a file. Otherwise Library care and the editors ask Navidrome as before.
   */
  usable(): boolean {
    // without Navidrome there is nothing to match: songs that have an id are the library
    if (this.standalone()) return !!this.db.prepare('SELECT 1 FROM catalog_songs WHERE nd_id IS NOT NULL LIMIT 1').get();
    if (this.lastLinkAt === null || !this.navidromeSongs) return false;
    const { linked } = this.db.prepare('SELECT COUNT(nd_id) AS linked FROM catalog_songs').get() as { linked: number };
    return linked >= this.navidromeSongs * 0.95;
  }

  private flag(key: string): boolean {
    const row = this.db.prepare('SELECT value FROM hub_settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value === 'true';
  }
  private setFlag(key: string, on: boolean) {
    this.db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, String(on));
  }
  /** Whether an admin turned on answering browsing from the catalog. */
  serve(): boolean {
    return this.flag('catalog.serve');
  }
  setServe(on: boolean) {
    this.setFlag('catalog.serve', on);
  }
  /**
   * Navidrome is off for this household (phase 6, docs/HUB.md "Without Navidrome"): the Hub gives new songs ids of
   * its own, answers every call itself, and never asks Navidrome. Implies serve, stream and userData.
   */
  standalone(): boolean {
    return this.flag('catalog.standalone');
  }
  setStandalone(on: boolean) {
    this.setFlag('catalog.standalone', on);
  }
  /** The Hub answers browsing itself (routes/relay.ts): turned on, and the catalog matches Navidrome. */
  serving(): boolean {
    return (this.serve() || this.standalone()) && this.usable();
  }
  /** Whether an admin turned on playing songs from the music folder (phase 4, catalogStream.ts). */
  stream(): boolean {
    return this.flag('catalog.stream');
  }
  setStream(on: boolean) {
    this.setFlag('catalog.stream', on);
  }
  /** Whether an admin turned on keeping hearts, plays and ratings on the Hub (phase 5, userData.ts). */
  keepsUserData(): boolean {
    return this.flag('catalog.userData') || this.standalone();
  }
  setKeepsUserData(on: boolean) {
    this.setFlag('catalog.userData', on);
  }
  /** The Hub plays songs itself (routes/relay.ts): turned on, and the catalog matches Navidrome. */
  streaming(): boolean {
    return (this.stream() || this.standalone()) && this.usable();
  }

  /** The file of each matched Navidrome song id (paths relative to the music folder). */
  pathsById(): Map<string, string> {
    const rows = this.db.prepare('SELECT nd_id, path FROM catalog_songs WHERE nd_id IS NOT NULL').all() as { nd_id: string; path: string }[];
    return new Map(rows.map((r) => [r.nd_id, r.path]));
  }

  /** One matched Navidrome song's file (relative to the music folder), or undefined. */
  songPath(id: string): string | undefined {
    return (this.db.prepare('SELECT path FROM catalog_songs WHERE nd_id = ?').get(id) as { path: string } | undefined)?.path;
  }

  /** An album's songs (Navidrome album id), from the catalog. */
  albumSongs(albumId: string): AdminSong[] {
    return (this.db.prepare(`SELECT nd_id, path, title, track, nd_album_id, album, artist, album_artist FROM catalog_songs
      WHERE nd_album_id = ? AND nd_id IS NOT NULL ORDER BY disc, track, path`).all(albumId) as Record<string, string | number | null>[]).map(adminSong);
  }

  /** One page of every matched song, in album order, and how many there are. */
  songs(start: number, end: number): { songs: AdminSong[]; total: number } {
    const rows = this.db.prepare(`SELECT nd_id, path, title, track, nd_album_id, album, artist, album_artist FROM catalog_songs
      WHERE nd_id IS NOT NULL ORDER BY lower(album), nd_album_id, disc, track, path LIMIT ? OFFSET ?`).all(Math.max(0, end - start), start) as Record<string, string | number | null>[];
    const { n } = this.db.prepare('SELECT COUNT(*) AS n FROM catalog_songs WHERE nd_id IS NOT NULL').get() as { n: number };
    return { songs: rows.map(adminSong), total: n };
  }

  /** Every album (Navidrome album id) with its genres and song count, for the genre review. */
  albums(): { id: string; name: string; artist: string; genres: string[]; songs: number }[] {
    const rows = this.db.prepare(`SELECT nd_album_id AS id, album, CASE WHEN album_artist <> '' THEN album_artist ELSE artist END AS who, genre
      FROM catalog_songs WHERE nd_album_id IS NOT NULL ORDER BY lower(album)`).all() as { id: string; album: string; who: string; genre: string }[];
    const out = new Map<string, { id: string; name: string; artist: string; genres: string[]; songs: number }>();
    for (const r of rows) {
      let a = out.get(r.id);
      if (!a) out.set(r.id, (a = { id: r.id, name: r.album, artist: r.who, genres: [], songs: 0 }));
      a.songs++;
      // split like Navidrome ("; " only), so "Rap;Hip-Hop" stays a spelling the genre review can tidy
      for (const g of r.genre.split(/;\s+/).map((x) => x.trim()).filter(Boolean)) if (!a.genres.includes(g)) a.genres.push(g);
    }
    return [...out.values()];
  }

  /** Artist and genre names in the library, for the editors' suggestions. */
  names(): { artists: string[]; genres: string[] } {
    const artists = new Map<string, string>();
    const genres = new Map<string, string>();
    for (const r of this.db.prepare('SELECT artist, album_artist, genre FROM catalog_songs').all() as { artist: string; album_artist: string; genre: string }[]) {
      for (const a of [r.artist, r.album_artist]) if (a && !artists.has(a.toLowerCase())) artists.set(a.toLowerCase(), a);
      for (const g of splitGenres(r.genre)) if (!genres.has(g.toLowerCase())) genres.set(g.toLowerCase(), g);
    }
    const sorted = (m: Map<string, string>) => [...m.values()].sort((a, b) => a.localeCompare(b));
    return { artists: sorted(artists), genres: sorted(genres) };
  }

  private blocked(): string | null {
    if (!this.musicDir) return 'The Hub has no music folder. Map your music share to /music (WAVELENGTH_MUSIC_DIR).';
    return null;
  }

  /** When the last scan of the folder finished. */
  lastScan(): number | null {
    return this.lastScanAt;
  }

  status(): CatalogStatus {
    const c = this.db.prepare('SELECT COUNT(*) AS files, COUNT(error) AS failed, COUNT(nd_id) AS linked FROM catalog_songs').get() as { files: number; failed: number; linked: number };
    return {
      blocked: this.blocked(),
      ...c,
      navidromeSongs: this.navidromeSongs,
      missing: this.missing,
      scanning: this.scanning,
      progress: this.progress,
      lastScanAt: this.lastScanAt,
      lastScanMs: this.lastScanMs,
      lastChanges: this.lastChanges,
      lastLinkAt: this.lastLinkAt,
      inUse: this.usable(),
      lastError: this.lastError,
      serve: this.serve(),
      serving: this.serving(),
      stream: this.stream(),
      streaming: this.streaming(),
      userData: this.keepsUserData(),
      standalone: this.standalone(),
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
      if (this.standalone()) this.giveIds();
      else await this.link();
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
        duration, bit_rate, codec, mb_track_id, mb_album_id, error, read_at, rg_track_gain, rg_album_gain, rg_track_peak, rg_album_peak, created)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, title = excluded.title, artist = excluded.artist,
        album = excluded.album, album_artist = excluded.album_artist, track = excluded.track, disc = excluded.disc, year = excluded.year,
        genre = excluded.genre, explicit = excluded.explicit, duration = excluded.duration, bit_rate = excluded.bit_rate,
        codec = excluded.codec, mb_track_id = excluded.mb_track_id, mb_album_id = excluded.mb_album_id, error = excluded.error,
        read_at = excluded.read_at, rg_track_gain = excluded.rg_track_gain, rg_album_gain = excluded.rg_album_gain,
        rg_track_peak = excluded.rg_track_peak, rg_album_peak = excluded.rg_album_peak,
        created = COALESCE(catalog_songs.created, excluded.created)`);
    let pending: [string, Seen, FileTags | null, string | null][] = [];
    const flush = () => {
      const rows = pending;
      pending = [];
      tx(this.db, () => {
        for (const [p, s, t, err] of rows) {
          upsert.run(p, s.size, s.mtime, t?.title ?? '', t?.artist ?? '', t?.album ?? '', t?.albumArtist ?? '', t?.track ?? null, t?.disc ?? null, t?.year ?? null,
            t?.genre ?? '', t?.explicit ?? '', t?.duration ?? 0, t?.bitRate ?? null, t?.codec ?? '', t?.mbTrackId ?? '', t?.mbAlbumId ?? '', err, this.now(),
            t?.trackGain ?? null, t?.albumGain ?? null, t?.trackPeak ?? null, t?.albumPeak ?? null, s.mtime || this.now());
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
    // only what this walk read or dropped: a walk that found nothing new leaves the Hub's answers as they are
    catalogChanged([...todo.map(([p]) => p), ...(dropGone ? gone : [])]);
    this.lastChanges = { added, changed: todo.length - added, removed: dropGone ? gone.length : 0 };
    if (!dropGone && gone.length) throw new Error(`The music folder has only ${found.size} of the ${known.size} files the catalog knows. Is the share mounted? Nothing was removed.`);
  }

  /**
   * Without Navidrome, the Hub keeps the ids. A file Navidrome never saw gets a song id made from its path ("h" and 20
   * hex digits, which no Navidrome id looks like); song ids never change. Songs are grouped into albums by album
   * artist, title and year, and into artists by name, as Navidrome's scan did, and each group keeps the id most of its
   * songs already have: renaming an album keeps its id, merging two (same title, album artist and year, as Merge in
   * the app writes them) keeps the bigger one's, two releases with the same title but different years stay apart,
   * and a new song on a known album lands on it.
   */
  giveIds(): number {
    type R = { path: string; artist: string; album: string; album_artist: string; year: number | null; nd_id: string | null; nd_album_id: string | null; nd_artist_id: string | null; nd_album_artist_id: string | null };
    const rows = this.db.prepare('SELECT path, artist, album, album_artist, year, nd_id, nd_album_id, nd_artist_id, nd_album_artist_id FROM catalog_songs WHERE error IS NULL').all() as R[];
    const fold = (x: string) => x.trim().toLowerCase();
    const made = (kind: string, x: string) => `h${createHash('sha1').update(`${kind}\0${x}`).digest('hex').slice(0, 20)}`;
    type Votes = Map<string, { size: number; ids: Map<string, number> }>;
    const vote = (v: Votes, k: string, id: string | null) => {
      let g = v.get(k);
      if (!g) v.set(k, (g = { size: 0, ids: new Map() }));
      g.size++;
      if (id) g.ids.set(id, (g.ids.get(id) ?? 0) + 1);
    };
    /** each group's id: the one most of its songs have that a bigger group hasn't taken, else a new one */
    const pick = (kind: string, v: Votes) => {
      const out = new Map<string, string>();
      const taken = new Set<string>();
      for (const [k, g] of [...v].sort((x, y) => y[1].size - x[1].size || (x[0] < y[0] ? -1 : 1))) {
        const best = [...g.ids].filter(([id]) => !taken.has(id)).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]?.[0];
        const id = best ?? made(kind, k);
        taken.add(id);
        out.set(k, id);
      }
      return out;
    };

    // an album's year is the latest of its songs' (per album id); a song without an album id yet takes a year its
    // title already has, or the biggest one's, so a track with its own original year doesn't split an album
    const titleOf = (r: R) => `${fold(r.album_artist || r.artist)}\0${fold(r.album)}`;
    const yearOfId = new Map<string, number>();
    for (const r of rows) if (r.nd_album_id) yearOfId.set(`${titleOf(r)}\0${r.nd_album_id}`, Math.max(yearOfId.get(`${titleOf(r)}\0${r.nd_album_id}`) ?? 0, r.year ?? 0));
    const yearsOfTitle = new Map<string, Map<number, number>>();
    for (const r of rows) {
      if (!r.nd_album_id) continue;
      const y = yearOfId.get(`${titleOf(r)}\0${r.nd_album_id}`)!;
      let m = yearsOfTitle.get(titleOf(r));
      if (!m) yearsOfTitle.set(titleOf(r), (m = new Map()));
      m.set(y, (m.get(y) ?? 0) + 1);
    }
    const albumKey = (r: R) => {
      const t = titleOf(r);
      if (r.nd_album_id) return `${t}\0${yearOfId.get(`${t}\0${r.nd_album_id}`)}`;
      const years = yearsOfTitle.get(t);
      if (!years) return `${t}\0${r.year ?? 0}`;
      const y = years.has(r.year ?? 0) ? r.year ?? 0 : [...years].sort((a, b) => b[1] - a[1])[0][0];
      return `${t}\0${y}`;
    };
    const albumVotes: Votes = new Map(), artistVotes: Votes = new Map();
    for (const r of rows) {
      vote(albumVotes, albumKey(r), r.nd_album_id);
      vote(artistVotes, fold(r.artist), r.nd_artist_id);
      if (fold(r.album_artist) && fold(r.album_artist) !== fold(r.artist)) vote(artistVotes, fold(r.album_artist), r.nd_album_artist_id);
    }
    const albums = pick('album', albumVotes);
    const artists = pick('artist', artistVotes);

    const set = this.db.prepare('UPDATE catalog_songs SET nd_id = ?, nd_album_id = ?, nd_artist_id = ?, nd_album_artist_id = ? WHERE path = ?');
    const changed: string[] = [];
    tx(this.db, () => {
      for (const r of rows) {
        const id = r.nd_id ?? made('song', r.path);
        const album = albums.get(albumKey(r))!;
        const artist = artists.get(fold(r.artist))!;
        const albumArtist = artists.get(fold(r.album_artist || r.artist))!;
        if (id === r.nd_id && album === r.nd_album_id && artist === r.nd_artist_id && albumArtist === r.nd_album_artist_id) continue;
        set.run(id, album, artist, albumArtist, r.path);
        changed.push(r.path);
      }
    });
    catalogChanged(changed);
    return changed.length;
  }

  /** Match files to Navidrome's songs by path, from the library index's listing. */
  async link() {
    const songs = await this.listNavidrome().catch(() => null);
    if (!songs) return;
    // Subsonic's `path` is made up ("Artist/Album/01 - Title.flac") unless a player has Report Real Path on, so
    // the files' real paths come from Navidrome's own API; Subsonic's is only a fallback.
    const real = await this.listRealPaths().catch(() => null);
    const pathOf = (s: NavidromeSong) => real?.get(s.id)?.path ?? s.path;
    const byPath = new Map<string, NavidromeSong>();
    for (const s of songs) {
      const path = pathOf(s);
      const rel = path ? fromNavidromePath(this.navidromeDir, path) : null;
      if (rel) byPath.set(rel, s);
    }
    const rows = this.db.prepare('SELECT path, nd_id, nd_album_id, nd_artist_id, nd_album_artist_id FROM catalog_songs').all() as { path: string; nd_id: string | null; nd_album_id: string | null; nd_artist_id: string | null; nd_album_artist_id: string | null }[];
    // When Navidrome's music folder sits above or below the Hub's (/music/Music vs /music), whole paths never
    // match: fall back to the last three parts (artist folder, album folder, file) when only one file has them.
    const tail = (p: string) => p.split('/').slice(-3).join('/');
    const byTail = new Map<string, NavidromeSong | null>();
    for (const s of songs) {
      const path = pathOf(s);
      if (!path) continue;
      const k = tail(path.replace(/^\/+/, ''));
      byTail.set(k, byTail.has(k) ? null : s);
    }
    const files = new Set(rows.map((r) => r.path));
    const fileTails = new Map<string, number>();
    for (const p of files) fileTails.set(tail(p), (fileTails.get(tail(p)) ?? 0) + 1);
    const set = this.db.prepare('UPDATE catalog_songs SET nd_id = ?, nd_album_id = ?, nd_artist_id = ?, nd_album_artist_id = ? WHERE path = ?');
    const relinked: string[] = [];
    tx(this.db, () => {
      for (const r of rows) {
        const s = byPath.get(r.path) ?? (fileTails.get(tail(r.path)) === 1 ? byTail.get(tail(r.path)) ?? undefined : undefined);
        const id = s?.id ?? null;
        const album = s?.albumId ?? null;
        const artist = s?.artistId ?? null;
        const albumArtist = (s && real?.get(s.id)?.albumArtistId) || null;
        if (id !== r.nd_id || album !== r.nd_album_id || artist !== r.nd_artist_id || albumArtist !== r.nd_album_artist_id) {
          set.run(id, album, artist, albumArtist, r.path);
          relinked.push(r.path);
        }
      }
    });
    catalogChanged(relinked);
    const linked = new Set((this.db.prepare('SELECT nd_id FROM catalog_songs WHERE nd_id IS NOT NULL').all() as { nd_id: string }[]).map((r) => r.nd_id));
    this.missing = songs.filter((x) => !linked.has(x.id)).slice(0, 100).map((x) => ({
      title: x.title ?? '',
      artist: x.artist ?? '',
      album: x.album ?? '',
      path: pathOf(x) ?? '',
    }));
    this.navidromeSongs = songs.length;
    this.lastLinkAt = this.now();
  }
}

function adminSong(r: Record<string, string | number | null>): AdminSong {
  return {
    id: String(r.nd_id),
    path: String(r.path),
    title: String(r.title ?? ''),
    trackNumber: Number(r.track ?? 0) || 0,
    albumId: String(r.nd_album_id ?? ''),
    album: String(r.album ?? ''),
    artist: String(r.artist ?? ''),
    albumArtist: String(r.album_artist ?? ''),
  };
}
