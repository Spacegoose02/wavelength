import { http, qs, trimSlash } from '../lib/http';
import type { MusicSource, SourceConfig, Station } from './types';

/*
 * SUB/WAVE (github.com/perminder-klair/subwave) — self-hosted agentic radio.
 * Station URL is the web port (Caddy, :7700 by default); the controller API is mounted at /api
 * there (or reachable directly on :7701). Admin endpoints use HTTP Basic with ADMIN_USER/ADMIN_PASS.
 */

export interface SwTrack {
  id?: string;
  subsonic_id?: string;
  title?: string;
  artist?: string;
  album?: string;
  coverUrl?: string;
  duration?: number;
  elapsed?: number;
  startedAt?: number;
  genre?: string;
  genres?: string[];
  bpm?: number;
  musicalKey?: string;
  moods?: string[];
  energy?: number;
  year?: number;
  [k: string]: unknown;
}

export interface SwPersona {
  id: string;
  name: string;
  avatar?: string;
  tagline?: string;
  frequency?: string;
}

export interface SwShow {
  id: string;
  name: string;
  topic?: string;
  personaId?: string;
  guestPersonaIds?: string[];
  moods?: string[];
  [k: string]: unknown;
}

/** 7 days (0 = Sunday) × 24 hours of show ids (null = default programming). */
export type SwGrid = (string | null)[][];

export interface SwSchedule {
  personas: SwPersona[];
  shows: SwShow[];
  grid: SwGrid;
  gridIsArray: boolean;
  override: { showId: string | null; startedAt: number; expiresAt: number } | null;
  timezone?: string;
}

/** Anything → display text. SubWave fields are sometimes objects ({name}) or arrays. */
export function txt(v: unknown): string {
  if (v == null || v === false) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(txt).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return txt(o.name ?? o.title ?? o.label ?? o.text ?? o.value ?? '');
  }
  return String(v);
}

export function list<T = unknown>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === 'object') return Object.values(v) as T[];
  return [];
}

function ms(v: unknown): number | undefined {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v; // seconds or ms
  if (typeof v === 'string') {
    const n = Date.parse(v);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

/** Normalize a queue/history/now-playing entry, whatever shape the controller used. */
export function swTrack(raw: unknown): SwTrack {
  const r = ((raw as any)?.track ?? raw ?? {}) as Record<string, any>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : undefined);
  return {
    ...r,
    id: r.id != null ? String(r.id) : undefined,
    subsonic_id: r.subsonic_id != null ? String(r.subsonic_id) : r.subsonicId != null ? String(r.subsonicId) : undefined,
    // library files are often named "06 - Title" — drop the track-number prefix for display
    title: txt(r.title ?? r.name).replace(/^\d{1,3}\s*[-.]\s+/, '') || undefined,
    artist: txt(r.artist ?? r.artists) || undefined,
    album: txt(r.album) || undefined,
    coverUrl: typeof r.coverUrl === 'string' ? r.coverUrl : typeof r.cover === 'string' ? r.cover : undefined,
    duration: ((d) => (d && d > 36_000 ? d / 1000 : d))(num(r.duration)), // ms → s if needed
    elapsed: num(r.elapsed),
    // now-playing.json carries a unix-seconds `timestamp`; queue items an ISO `startedAt`
    startedAt: ms(r.startedAt ?? r.playedAt ?? r.timestamp),
    genre: txt(r.genre ?? r.genres) || undefined,
    genres: undefined,
    bpm: num(r.bpm),
    musicalKey: txt(r.musicalKey ?? r.key) || undefined,
    moods: list(r.moods).map(txt).filter(Boolean),
    year: num(r.year),
  };
}

function b64(s: string) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}

export class SubWaveSource implements MusicSource {
  constructor(public config: SourceConfig) {}

  get site() {
    return trimSlash(this.config.url);
  }

  get api() {
    return trimSlash(this.config.apiUrl || `${this.site}/api`);
  }

  get hasAdmin() {
    return !!(this.config.username && this.config.password);
  }

  /** Resolve avatar / cover paths the API hands back (may be relative to the site). */
  abs(path?: string) {
    if (!path) return undefined;
    try {
      return new URL(path, `${this.site}/`).href;
    } catch {
      return path;
    }
  }

  coverFor(t?: SwTrack) {
    if (!t) return undefined;
    if (t.coverUrl) return this.abs(t.coverUrl);
    const id = t.subsonic_id ?? t.id;
    return id ? `${this.api}/cover/${encodeURIComponent(id)}` : undefined;
  }

  private async req<T = any>(method: string, path: string, opts: { body?: unknown; admin?: boolean; query?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.config.token) headers['x-station-auth'] = this.config.token;
    if (opts.admin) {
      if (!this.hasAdmin) throw new Error('Add your SubWave admin user/password in Settings to use admin controls');
      headers.Authorization = `Basic ${b64(`${this.config.username}:${this.config.password}`)}`;
    }
    const q = opts.query ? qs(opts.query) : '';
    const res = await http(`${this.api}${path}${q ? `?${q}` : ''}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let json: any = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      /* non-JSON */
    }
    if (res.status === 401 || res.status === 403) throw new Error(opts.admin ? 'SubWave rejected the admin login' : 'SubWave needs the station password');
    if (!res.ok || json?.error) throw new Error(json?.error ?? `${res.status} from SubWave ${path}`);
    return json as T;
  }

  // ---- public ----
  station(): Station {
    return {
      id: `subwave:${this.config.id}`,
      sourceId: this.config.id,
      name: this.config.name || 'SUB/WAVE',
      streamUrl: this.config.streamUrl ? (this.abs(this.config.streamUrl) as string) : `${this.site}/stream.mp3`,
      nowPlayingUrl: `${this.api}/now-playing`,
      tags: 'agentic radio',
    };
  }

  async test() {
    await this.req('GET', '/health');
    const np = await this.nowPlaying();
    let msg = `Connected — ${np.dj?.station ?? 'SUB/WAVE'}, ${np.listeners ?? 0} listening`;
    if (this.hasAdmin) {
      await this.req('GET', '/settings', { admin: true });
      msg += ' · admin OK';
    }
    return msg;
  }

  async getStations() {
    return [this.station()];
  }

  nowPlaying() {
    return this.req<any>('GET', '/now-playing');
  }

  state() {
    return this.req<any>('GET', '/state');
  }

  async schedule(): Promise<SwSchedule> {
    const r = await this.req<any>('GET', '/schedule');
    const raw = r.schedule ?? {};
    const gridIsArray = Array.isArray(raw);
    const grid: SwGrid = Array.from({ length: 7 }, (_, d) => {
      const day = raw[d] ?? raw[String(d)] ?? [];
      return Array.from({ length: 24 }, (_, h) => day[h] ?? null);
    });
    const personas = list<any>(r.personas).map((p) => ({ ...p, id: String(p.id), name: txt(p.name) || String(p.id), tagline: txt(p.tagline), avatar: typeof p.avatar === 'string' ? p.avatar : undefined }));
    const shows = list<any>(r.shows).map((s) => ({ ...s, id: String(s.id), name: txt(s.name) || String(s.id), topic: txt(s.topic), moods: list(s.moods).map(txt), guestPersonaIds: list<string>(s.guestPersonaIds) }));
    return { personas, shows, grid, gridIsArray, override: r.override ?? null, timezone: typeof r.timezone === 'string' ? r.timezone : undefined };
  }

  request(text: string, name?: string) {
    return this.req<{ requestId: string; status: string }>('POST', '/request', { body: { text, name } });
  }

  requestStatus(id: string) {
    return this.req<{ status: string; track?: SwTrack; queuePosition?: number; reason?: string }>('GET', `/request/${encodeURIComponent(id)}`);
  }

  // ---- admin: on-air control ----
  skip() {
    return this.req('POST', '/dj/skip', { admin: true, body: {} });
  }
  say(text: string, mode: 'raw' | 'styled') {
    return this.req('POST', '/dj/say', { admin: true, body: { text, mode } });
  }
  skills() {
    return this.req<{ skills: { kind: string; label: string; cooldownMin?: number }[] }>('GET', '/dj/skills', { admin: true });
  }
  runSkill(name: string) {
    return this.req('POST', '/dj/skill', { admin: true, body: { name } });
  }
  jingles() {
    return this.req<{ jingles: { filename: string; text?: string }[] }>('GET', '/jingles', { admin: true });
  }
  playJingle(filename: string) {
    return this.req('POST', `/jingles/${encodeURIComponent(filename)}/play`, { admin: true, body: {} });
  }
  sfx() {
    return this.req<{ sfx: { name: string; description?: string }[] }>('GET', '/sfx', { admin: true });
  }
  playSfx(name: string) {
    return this.req('POST', `/sfx/${encodeURIComponent(name)}/play`, { admin: true, body: {} });
  }
  refreshPlaylist() {
    return this.req('POST', '/dj/refresh-playlist', { admin: true, body: {} });
  }
  searchLibrary(q: string) {
    return this.req<{ results: SwTrack[] }>('GET', '/dj/search', { admin: true, query: { q } });
  }
  queueTrack(t: SwTrack) {
    return this.req<{ queuePosition?: number }>('POST', '/dj/queue-track', { admin: true, body: { id: t.id, title: t.title, artist: t.artist, album: t.album } });
  }
  /** Cancel one upcoming song (by its subsonic_id). 409 "already-playing" if it's too late. */
  async removeUpcoming(subsonicId: string) {
    try {
      return await this.req<{ removed?: boolean }>('DELETE', `/dj/queue/${encodeURIComponent(subsonicId)}`, { admin: true });
    } catch (e) {
      const m = String((e as Error).message ?? e);
      if (/already-playing|too late|left the queue/i.test(m)) throw new Error('Too late — that song is already on its way to air');
      if (/not-queued|not in/i.test(m)) throw new Error('That song is no longer in the queue');
      throw e;
    }
  }
  /** Cancel the rest of a queued album/artist block; songs already handed to the mixer play out. */
  cancelBlock(blockId: string) {
    return this.req<{ removed?: number; kept?: number; label?: string }>('DELETE', `/dj/queue/block/${encodeURIComponent(blockId)}`, { admin: true });
  }
  queueBlock(kind: 'album' | 'artist', trackId: string) {
    return this.req<{ queued?: unknown[]; blockId?: string }>('POST', '/dj/queue-block', { admin: true, body: { kind, trackId } });
  }

  // ---- admin: schedule & shows ----
  saveSchedule(s: SwSchedule) {
    const body = s.gridIsArray ? s.grid : Object.fromEntries(s.grid.map((day, d) => [String(d), day]));
    return this.req<{ dropped?: number }>('PUT', '/schedule', { admin: true, body });
  }
  /** Full show objects (the public /schedule only returns a summary). */
  async fullShows(): Promise<SwShow[]> {
    const r = await this.req<any>('GET', '/settings', { admin: true });
    return r.shows ?? r.settings?.shows ?? [];
  }
  /** Edits merge into the full stored show so fields we don't expose (genres, playlists…) survive. */
  async upsertShow(patch: Partial<SwShow> & { id?: string }) {
    let show: Partial<SwShow> = patch;
    if (patch.id) {
      const full = (await this.fullShows()).find((s) => s.id === patch.id);
      if (full) show = { ...full, ...patch };
    }
    return this.req<{ show: SwShow | null }>('POST', '/shows', { admin: true, body: { show } });
  }
  deleteShow(id: string) {
    return this.req('DELETE', `/shows/${encodeURIComponent(id)}`, { admin: true });
  }
  override(showId: string | null, until: 'fixed' | 'schedule-change', minutes?: number) {
    return this.req('POST', '/schedule/override', { admin: true, body: { showId, until, minutes } });
  }
  cancelOverride() {
    return this.req('DELETE', '/schedule/override', { admin: true });
  }

  // ---- likes (mirrored to Navidrome stars by SubWave) ----
  /** Heart the song on air right now (public, rate-limited per listener). */
  likeCurrent(songId?: string) {
    return this.req<{ liked?: boolean; count?: number; title?: string }>('POST', '/like', { body: songId ? { songId } : {} });
  }
  likeState() {
    return this.req<{ enabled?: boolean; songId?: string; liked?: boolean; count?: number }>('GET', '/like');
  }
  /** Every liked song, newest like first (like Navidrome's starred list). */
  async likes(): Promise<(SwTrack & { count?: number; likedAt?: number })[]> {
    const norm = (x: any) => ({
      ...swTrack(x),
      id: String(x.songId ?? x.id ?? x.track?.id ?? ''),
      count: typeof x.count === 'number' ? x.count : undefined,
      likedAt: ms(x.likedAt ?? x.lastLikedAt ?? x.updatedAt ?? x.createdAt ?? x.at ?? x.startedAt),
    });
    // /likes/index = the full catalogue of liked songs; /likes = recent + top (capped at 100)
    const [index, summary] = await Promise.all([
      this.req<any>('GET', '/likes/index', { admin: true }).catch(() => null),
      this.req<any>('GET', '/likes', { admin: true, query: { limit: 100 } }).catch(() => null),
    ]);
    if (!index && !summary) throw new Error("Couldn't load likes from SubWave");
    const all = new Map<string, ReturnType<typeof norm>>();
    for (const x of [...list(summary?.recent), ...list(index?.songs ?? index), ...list(summary?.top)]) {
      const t = norm(x);
      if (!t.id) continue;
      const prev = all.get(t.id);
      all.set(t.id, prev ? { ...t, ...prev, count: prev.count ?? t.count, likedAt: prev.likedAt ?? t.likedAt } : t);
    }
    return [...all.values()].sort((a, b) => (b.likedAt ?? 0) - (a.likedAt ?? 0));
  }
  unlike(songId: string) {
    return this.req('DELETE', `/likes/song/${encodeURIComponent(songId)}`, { admin: true });
  }

  // ---- admin: stats ----
  stats() {
    return this.req<any>('GET', '/stats', { admin: true });
  }
  connections() {
    return this.req<{ count: number; connections: { mount?: string; userAgent?: string; connectedFor?: number }[] }>('GET', '/listeners/connections', { admin: true });
  }
}
