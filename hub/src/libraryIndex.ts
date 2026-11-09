import type { Db } from './db.ts';
import { getScanSettings, navidrome } from './library.ts';
import { normName, primaryArtist } from './radar.ts';
import type { IndexedSong } from './api/library.ts';
import { SearchIndex, type SearchOptions, type SearchResult, words } from './librarySearch.ts';

/**
 * "Is this chart song in the library?" for Discover, answered by the Hub in one go
 * (`POST /api/discover/match`, docs/HUB.md "Discover").
 *
 * Without it every app searched its Navidrome twice per chart song, four at a time, every time Discover opened.
 * The Hub instead keeps a list of every song in its Navidrome (the scan login from Settings → Server → Library
 * updates, like sound-alike analysis) in memory, listed again when it's over LIST_EVERY old or Navidrome finished a
 * scan since, and matches a whole chart against it at once. The match is the app's (src/lib/match.ts): same
 * cleaned-up title (or one that starts with it), then the same main artist, or one name containing the other.
 *
 * Songs come back as Navidrome's own fields, so an app with that server turns them into playable tracks itself.
 */

const LIST_EVERY = 60 * 60_000;
const PAGE = 500;

/** The Subsonic song fields an app needs to play and show it (the app–Hub contract, api/library.ts). */
export type { IndexedSong };

export interface IndexStatus {
  /** false: no scan login, or the first listing hasn't finished (the app checks songs itself) */
  ready: boolean;
  /** the Navidrome the songs are from, so an app can tell whether it's the one it plays from */
  server: string | null;
  songs: number;
  listedAt: number | null;
  error: string | null;
}

/** Like the app's cleanTitle(): no "01 - ", no "(feat. …)", "(Remastered)", "(Radio Edit)" … */
export const cleanTitle = (s: string) =>
  normName(s.replace(/^\d{1,3}\s*[-.]\s+/, '').replace(/\s*[([](feat|ft|with|remaster|remastered|live|explicit|clean|edited|censored|radio edit|\d{4} remaster)[^)\]]*[)\]]/gi, ''));

const PREFIX = 5;

export class LibraryIndex {
  private db: Db;
  private key: Buffer;
  private scannedAt: () => number | null;
  private now: () => number;
  private songs: IndexedSong[] = [];
  /** Navidrome's path for each song id (not sent to apps; the catalog and sound-alike analysis use it). */
  private paths = new Map<string, string>();
  private byTitle = new Map<string, IndexedSong[]>();
  private byPrefix = new Map<string, IndexedSong[]>();
  private searchIndex = new SearchIndex([]);
  private server: string | null = null;
  private listedAt: number | null = null;
  private error: string | null = null;
  private listing: Promise<void> | null = null;
  /** for tests: what Navidrome answers */
  call: typeof navidrome = navidrome;
  /**
   * With Navidrome off (catalog.ts standalone), the Hub's own answers to the same calls (subsonicCatalog.ts), so
   * the songs come from the catalog instead: no calls, same ids. Set by app.ts.
   */
  fromCatalog: () => ((method: string, params: Record<string, string>) => any) | null = () => null;

  constructor(db: Db, key: Buffer, scannedAt: () => number | null = () => null, now: () => number = Date.now) {
    this.db = db;
    this.key = key;
    this.scannedAt = scannedAt;
    this.now = now;
  }

  status(): IndexStatus {
    return { ready: this.listedAt !== null && !!this.server, server: this.server, songs: this.songs.length, listedAt: this.listedAt, error: this.error };
  }

  /**
   * Ready to answer: lists the library the first time (and waits for it), and lists it again behind the scenes
   * when the list is old or Navidrome scanned since. False when there's no scan login or the first listing failed.
   */
  async ensure(): Promise<boolean> {
    const s = this.settings();
    if (!s) {
      this.reset();
      return false;
    }
    const url = s.url.replace(/\/+$/, '');
    if (this.server && this.server !== url) this.reset();
    const scanned = this.scannedAt();
    const old = this.listedAt === null || this.now() - this.listedAt > LIST_EVERY || (scanned !== null && scanned > this.listedAt);
    if (old) {
      this.listing ??= this.list().finally(() => (this.listing = null));
      if (this.listedAt === null) await this.listing.catch(() => undefined);
      else this.listing.catch(() => undefined);
    }
    return this.status().ready;
  }

  private reset() {
    this.songs = [];
    this.paths = new Map();
    this.byTitle.clear();
    this.byPrefix.clear();
    this.searchIndex = new SearchIndex([]);
    this.server = null;
    this.listedAt = null;
  }

  /** Where the songs come from: Navidrome's scan login, or the catalog when Navidrome is off. */
  private settings(): { url: string; call: (method: string, params: Record<string, string>) => Promise<any> } | null {
    const hub = this.fromCatalog();
    const s = getScanSettings(this.db, this.key);
    // the server name stays the Navidrome address when there was one, so the app still finds its library
    if (hub) return { url: s?.url ?? 'hub', call: async (m, p) => hub(m, p) };
    return s ? { url: s.url, call: (m, p) => this.call(s, m, p) } : null;
  }

  /** Every song in Navidrome (or the catalog), 500 at a time. */
  async list(): Promise<void> {
    const s = this.settings();
    if (!s) return this.reset();
    const songs: IndexedSong[] = [];
    const paths = new Map<string, string>();
    /** Navidrome's id for each artist it split out of a credit (OpenSubsonic `artists`), for Search */
    const artistIds = new Map<string, string>();
    try {
      for (let offset = 0; offset < 1_000_000; offset += PAGE) {
        const r = await s.call('search3', { query: '', songCount: String(PAGE), songOffset: String(offset), artistCount: '0', albumCount: '0' });
        const page = (r?.searchResult3?.song ?? []) as Record<string, unknown>[];
        for (const x of page) {
          if (!x.id || typeof x.title !== 'string') continue;
          if (typeof x.path === 'string' && x.path) paths.set(String(x.id), x.path);
          for (const ar of Array.isArray(x.artists) ? (x.artists as { id?: unknown; name?: unknown }[]) : []) {
            const k = typeof ar?.name === 'string' ? words(ar.name).join(' ') : '';
            if (k && ar.id != null && !artistIds.has(k)) artistIds.set(k, String(ar.id));
          }
          songs.push({
            id: String(x.id),
            title: x.title,
            artist: typeof x.artist === 'string' ? x.artist : '',
            ...(x.artistId != null && { artistId: String(x.artistId) }),
            ...(typeof x.album === 'string' && { album: x.album }),
            ...(x.albumId != null && { albumId: String(x.albumId) }),
            ...(typeof x.year === 'number' && x.year > 0 && { year: x.year }),
            ...(typeof x.duration === 'number' && { duration: x.duration }),
            ...(typeof x.track === 'number' && { track: x.track }),
            ...(typeof x.discNumber === 'number' && { discNumber: x.discNumber }),
            ...(x.coverArt != null && { coverArt: String(x.coverArt) }),
            ...(typeof x.explicitStatus === 'string' && x.explicitStatus && { explicitStatus: x.explicitStatus }),
          });
        }
        if (page.length < PAGE) break;
      }
    } catch (e) {
      this.error = String((e as Error).message ?? e);
      throw e;
    }
    this.songs = songs;
    this.paths = paths;
    this.byTitle = new Map();
    this.byPrefix = new Map();
    for (const x of songs) {
      const t = cleanTitle(x.title);
      if (!t) continue;
      push(this.byTitle, t, x);
      push(this.byPrefix, t.slice(0, PREFIX), x);
    }
    this.searchIndex = new SearchIndex(songs, artistIds);
    this.byId = undefined;
    this.server = s.url.replace(/\/+$/, '');
    this.listedAt = this.now();
    this.error = null;
  }

  /**
   * Every Navidrome song with its path, listed first if needed. The one listing of Navidrome the Hub makes: the
   * music catalog (catalog.ts) links files to songs with it and sound-alike analysis (sonic/worker.ts) picks its
   * songs from it. null when there's no scan login or Navidrome couldn't be listed.
   */
  async navidromeSongs(): Promise<(IndexedSong & { path?: string })[] | null> {
    if (!(await this.ensure())) return null;
    return this.songs.map((x) => ({ ...x, path: this.paths.get(x.id) }));
  }

  /** Songs, albums and artists for the Search page (librarySearch.ts). Call ensure() first. */
  search(q: string, opts?: SearchOptions): SearchResult {
    return this.searchIndex.search(q, opts);
  }

  /** One song by its Navidrome id (a guest's Jam request, routes/together.ts). */
  get(id: string): IndexedSong | undefined {
    if (this.byId?.size !== this.songs.length) this.byId = new Map(this.songs.map((x) => [x.id, x]));
    return this.byId.get(id);
  }
  private byId?: Map<string, IndexedSong>;

  /** The library's copy of each song, or null. */
  match(songs: { title: string; artist: string }[]): (IndexedSong | null)[] {
    return songs.map((s) => this.find(s) ?? null);
  }

  private find(s: { title: string; artist: string }): IndexedSong | undefined {
    const title = cleanTitle(s.title);
    const artist = normName(primaryArtist(s.artist));
    if (!title || !artist) return undefined;
    const pick = (cands: IndexedSong[]) =>
      cands.find((c) => normName(primaryArtist(c.artist)) === artist) ??
      cands.find((c) => normName(c.artist).includes(artist) || artist.includes(normName(primaryArtist(c.artist))));
    const exact = pick(this.byTitle.get(title) ?? []);
    if (exact) return exact;
    // "Song" on the chart, "Song - From the Movie" in the library
    return pick((this.byPrefix.get(title.slice(0, PREFIX)) ?? []).filter((c) => cleanTitle(c.title).startsWith(title)));
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}
