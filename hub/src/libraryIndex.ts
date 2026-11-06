import type { Db } from './db.ts';
import { getScanSettings, navidrome } from './library.ts';
import { normName, primaryArtist } from './radar.ts';
import type { IndexedSong } from './api/library.ts';
import { SearchIndex, type SearchOptions, type SearchResult } from './librarySearch.ts';

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
  private byTitle = new Map<string, IndexedSong[]>();
  private byPrefix = new Map<string, IndexedSong[]>();
  private searchIndex = new SearchIndex([]);
  private server: string | null = null;
  private listedAt: number | null = null;
  private error: string | null = null;
  private listing: Promise<void> | null = null;
  /** for tests: what Navidrome answers */
  call: typeof navidrome = navidrome;

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
    const s = getScanSettings(this.db, this.key);
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
    this.byTitle.clear();
    this.byPrefix.clear();
    this.searchIndex = new SearchIndex([]);
    this.server = null;
    this.listedAt = null;
  }

  /** Every song in Navidrome, 500 at a time. */
  async list(): Promise<void> {
    const s = getScanSettings(this.db, this.key);
    if (!s) return this.reset();
    const songs: IndexedSong[] = [];
    try {
      for (let offset = 0; offset < 1_000_000; offset += PAGE) {
        const r = await this.call(s, 'search3', { query: '', songCount: String(PAGE), songOffset: String(offset), artistCount: '0', albumCount: '0' });
        const page = (r?.searchResult3?.song ?? []) as Record<string, unknown>[];
        for (const x of page) {
          if (!x.id || typeof x.title !== 'string') continue;
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
    this.byTitle = new Map();
    this.byPrefix = new Map();
    for (const x of songs) {
      const t = cleanTitle(x.title);
      if (!t) continue;
      push(this.byTitle, t, x);
      push(this.byPrefix, t.slice(0, PREFIX), x);
    }
    this.searchIndex = new SearchIndex(songs);
    this.server = s.url.replace(/\/+$/, '');
    this.listedAt = this.now();
    this.error = null;
  }

  /** Songs, albums and artists for the Search page (librarySearch.ts). Call ensure() first. */
  search(q: string, opts?: SearchOptions): SearchResult {
    return this.searchIndex.search(q, opts);
  }

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
