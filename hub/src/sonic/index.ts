import type { Db } from '../db.ts';
import { normName, primaryArtist } from '../radar.ts';
import { moodOf, vector, type SonicFeatures } from './analyse.ts';

/**
 * The analysed library in memory, for "sounds like" searches. Each dimension of the feature vectors is z-scored
 * across the library, so a song is compared on everything at once instead of mostly on its loudest numbers.
 * Rebuilt when songs have been analysed since (cheap: a few MB for 50 000 songs).
 */

export interface SonicSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  features: SonicFeatures & { offset?: number };
}

export interface SonicHit {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  bpm: number;
  key: string;
  energy: number;
  mood: string;
  /** 0..1, how close */
  match?: number;
}

const nameKey = (artist: string, title: string) => `${normName(primaryArtist(artist))}\u0000${normName(title.replace(/\s*[([].*?[)\]]\s*/g, ' '))}`;

export class SonicIndex {
  private db: Db;
  private songs: SonicSong[] = [];
  private vecs: Float64Array[] = [];
  private byId = new Map<number | string, number>();
  private byName = new Map<string, number>();
  private loadedAt = -1;
  /** bumped by the worker after each analysed song */
  version = 0;

  constructor(db: Db) {
    this.db = db;
  }

  private load() {
    if (this.loadedAt === this.version) return;
    this.loadedAt = this.version;
    const rows = this.db.prepare('SELECT id, title, artist, album, duration, features FROM sonic_songs WHERE features IS NOT NULL').all() as { id: string; title: string; artist: string; album: string; duration: number; features: string }[];
    this.songs = rows.map((r) => ({ id: r.id, title: r.title, artist: r.artist, album: r.album, duration: r.duration, features: JSON.parse(r.features) }));
    const raw = this.songs.map((s) => vector(s.features));
    const d = raw[0]?.length ?? 0;
    const mean = new Float64Array(d), sd = new Float64Array(d);
    for (const v of raw) for (let i = 0; i < d; i++) mean[i] += v[i] / raw.length;
    for (const v of raw) for (let i = 0; i < d; i++) sd[i] += (v[i] - mean[i]) ** 2 / raw.length;
    for (let i = 0; i < d; i++) sd[i] = Math.sqrt(sd[i]) || 1;
    this.vecs = raw.map((v) => Float64Array.from(v, (x, i) => (x - mean[i]) / sd[i]));
    this.byId = new Map(this.songs.map((s, i) => [s.id, i]));
    this.byName = new Map(this.songs.map((s, i) => [nameKey(s.artist, s.title), i]));
  }

  get size() {
    this.load();
    return this.songs.length;
  }

  /** A song by Navidrome id, else by artist and title. */
  find(q: { id?: string; artist?: string; title?: string }): number | undefined {
    this.load();
    if (q.id && this.byId.has(q.id)) return this.byId.get(q.id);
    if (q.title) return this.byName.get(nameKey(q.artist ?? '', q.title));
    return undefined;
  }

  hit(i: number, dist?: number): SonicHit {
    const s = this.songs[i];
    const f = s.features;
    return {
      id: s.id, title: s.title, artist: s.artist, album: s.album, duration: s.duration, bpm: f.bpm, key: f.key, energy: f.energy, mood: moodOf(f),
      ...(dist !== undefined && { match: Math.round(Math.max(0, 1 - dist / 14) * 100) / 100 }),
    };
  }

  features(i: number) {
    this.load();
    return this.songs[i].features;
  }

  private dist(a: Float64Array, b: Float64Array) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
    return Math.sqrt(s);
  }

  /** The songs closest to point `v`, skipping `skip` and (at most `perArtist` each) one artist dominating. */
  private nearest(v: Float64Array, limit: number, skip: Set<number>, perArtist = 3): { i: number; d: number }[] {
    const all: { i: number; d: number }[] = [];
    for (let i = 0; i < this.vecs.length; i++) if (!skip.has(i)) all.push({ i, d: this.dist(v, this.vecs[i]) });
    all.sort((a, b) => a.d - b.d);
    const count = new Map<string, number>();
    const out: { i: number; d: number }[] = [];
    for (const h of all) {
      const a = normName(primaryArtist(this.songs[h.i].artist));
      if ((count.get(a) ?? 0) >= perArtist) continue;
      count.set(a, (count.get(a) ?? 0) + 1);
      out.push(h);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Songs that sound like song `i`, closest first. */
  similar(i: number, limit = 50): SonicHit[] {
    this.load();
    return this.nearest(this.vecs[i], limit, new Set([i])).map((h) => this.hit(h.i, h.d));
  }

  /** A path from song `a` to song `b` in `steps` songs, each a little closer to `b`. */
  journey(a: number, b: number, steps = 20): SonicHit[] {
    this.load();
    const used = new Set([a, b]);
    const out = [this.hit(a)];
    for (let k = 1; k < steps - 1; k++) {
      const t = k / (steps - 1);
      const p = Float64Array.from(this.vecs[a], (x, i) => x + (this.vecs[b][i] - x) * t);
      const [n] = this.nearest(p, 1, used, 99);
      if (!n) break;
      used.add(n.i);
      out.push(this.hit(n.i, n.d));
    }
    out.push(this.hit(b));
    return out;
  }

  /** Songs whose title or artist contain the words, for picking a journey's end. */
  search(q: string, limit = 20): SonicHit[] {
    this.load();
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const out: SonicHit[] = [];
    for (let i = 0; i < this.songs.length && out.length < limit; i++) {
      const s = `${this.songs[i].title} ${this.songs[i].artist}`.toLowerCase();
      if (words.every((w) => s.includes(w))) out.push(this.hit(i));
    }
    return out;
  }
}
