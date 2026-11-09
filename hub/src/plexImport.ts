import type { Db } from './db.ts';
import type { Fetch } from './dj/voice.ts';
import { genreLookup, getGenreSettings, normalizeGenre } from './genres.ts';
import { cleanValues, type Facet, type Facets, itemKey, type ItemKind, readItem, setItem, tagKey } from './itemTags.ts';
import { serviceForHub, serviceIdOfKind } from './services.ts';

/**
 * Import styles, moods, collections and genres from a Plex server (docs/HUB.md, "Importing from Plex"). Plex's music
 * agent fills these in from its online metadata, which is usually better filled than the files' tags. The Hub reads
 * every album and artist of the Plex server saved under Server logins (its shared token), matches them to the
 * library (the Hub's catalog of the music folder) by album artist and title, and shows what it found before
 * anything is written:
 *
 * - **Styles and moods** of albums and artists, and their **collections** (Plex's collections and labels, so a
 *   "Christmas" label becomes the Christmas collection), go to the Hub's own tags (itemTags.ts), marked as imported.
 *   Anything an admin set by hand is left alone, and importing again updates only what came from Plex.
 * - **Artist genres** go to the Hub too (the artist's own genres, apart from their albums').
 * - **Album genres** live in the files, so the import only suggests them, for albums that have none: the genre
 *   tidied by the genre rules (genres.ts). The app applies them with the genre review's undoable Save.
 *
 * Plex is read with `Accept: application/json`: the music sections, then every album (type 9) and artist (type 8)
 * of each, 500 at a time, then their full details (where styles, moods and collections are) 50 at a time.
 */

export interface PlexItem { ratingKey: string; kind: ItemKind; artist: string; title: string; genres: string[]; styles: string[]; moods: string[]; collections: string[] }

/** An album or artist of ours: the catalog's album artist and title, its Navidrome id and its genres. */
export interface OurAlbum { artist: string; title: string; id: string | null; genres: string[] }

export interface PlexMatch {
  kind: ItemKind;
  /** Ours, as the library spells it. */
  artist: string;
  title: string;
  facets: Facets;
  /** The facets that importing would change (an admin's own are never changed). */
  changes: Facet[];
}

export interface GenreSuggestion { id: string; artist: string; title: string; plex: string; genre: string }

export interface PlexPreview {
  at: number;
  server: string;
  albums: { plex: number; matched: number };
  artists: { plex: number; matched: number };
  /** Matched albums and artists that would get something new. */
  changes: { albums: number; artists: number };
  /** Up to 100 Plex albums with no match in the library, to see why. */
  unmatched: { artist: string; title: string }[];
  /** Albums with no genre, and the genre Plex gives them (tidied). */
  genres: GenreSuggestion[];
  /** A few matched albums and artists with what they'd get, for a look before importing. */
  sample: PlexMatch[];
}

export interface PlexStatus {
  state: 'idle' | 'reading' | 'ready' | 'importing' | 'done' | 'error';
  step?: string;
  error?: string;
  preview?: PlexPreview;
  imported?: { at: number; albums: number; artists: number };
}

const tags = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (x as { tag?: unknown })?.tag).filter((t): t is string => typeof t === 'string' && !!t.trim()) : []);

/** A Plex album or artist from its full details. */
export function plexItem(m: Record<string, unknown>): PlexItem | null {
  const kind = m.type === 'album' ? 'album' : m.type === 'artist' ? 'artist' : null;
  if (!kind || typeof m.ratingKey !== 'string' && typeof m.ratingKey !== 'number') return null;
  const title = String(m.title ?? '').trim();
  const artist = kind === 'album' ? String(m.parentTitle ?? '').trim() : title;
  if (!artist || !title) return null;
  return {
    ratingKey: String(m.ratingKey), kind, artist, title: kind === 'album' ? title : '',
    genres: tags(m.Genre), styles: tags(m.Style), moods: tags(m.Mood),
    // Plex's collections and its labels are both groups someone made: both become collections here
    collections: cleanValues([...tags(m.Collection), ...tags(m.Label)]) ?? [],
  };
}

/** A title without what an edition adds: "Celebrity (Deluxe Edition) [Remastered]" → "celebrity". */
const looseTitle = (t: string) => tagKey(t.replace(/\s*[([][^)\]]*[)\]]/g, ' ')) || tagKey(t);

/**
 * Pair Plex's albums and artists with ours: the same album artist and title (without case, accents or punctuation),
 * else the same title without edition words ("(Deluxe)") when that pairs exactly one of each.
 */
export function matchPlex(plex: PlexItem[], ours: { albums: OurAlbum[]; artists: string[] }): { pairs: { plex: PlexItem; artist: string; title: string; ours?: OurAlbum }[]; unmatched: PlexItem[] } {
  const albums = new Map<string, OurAlbum>();
  const loose = new Map<string, OurAlbum[]>();
  for (const a of ours.albums) {
    albums.set(itemKey('album', a.artist, a.title), a);
    const k = `${tagKey(a.artist)}\u001f${looseTitle(a.title)}`;
    loose.set(k, [...(loose.get(k) ?? []), a]);
  }
  const plexLoose = new Map<string, number>();
  for (const p of plex) if (p.kind === 'album') {
    const k = `${tagKey(p.artist)}\u001f${looseTitle(p.title)}`;
    plexLoose.set(k, (plexLoose.get(k) ?? 0) + 1);
  }
  const artists = new Map(ours.artists.map((a) => [tagKey(a), a]));
  const pairs: { plex: PlexItem; artist: string; title: string; ours?: OurAlbum }[] = [];
  const unmatched: PlexItem[] = [];
  const used = new Set<OurAlbum>();
  for (const p of plex) {
    if (p.kind === 'artist') {
      const a = artists.get(tagKey(p.artist));
      if (a) pairs.push({ plex: p, artist: a, title: '' });
      else unmatched.push(p);
      continue;
    }
    let a = albums.get(itemKey('album', p.artist, p.title));
    if (!a) {
      const k = `${tagKey(p.artist)}\u001f${looseTitle(p.title)}`;
      const c = loose.get(k);
      if (c?.length === 1 && plexLoose.get(k) === 1) a = c[0];
    }
    if (a && !used.has(a)) {
      used.add(a);
      pairs.push({ plex: p, artist: a.artist, title: a.title, ours: a });
    } else unmatched.push(p);
  }
  return { pairs, unmatched };
}

/** The albums of the Hub's catalog, by album artist and title, and the album artists. */
export function ourLibrary(db: Db): { albums: OurAlbum[]; artists: string[] } {
  const rows = db.prepare(`SELECT CASE WHEN album_artist <> '' THEN album_artist ELSE artist END AS who, album, genre, nd_album_id
    FROM catalog_songs WHERE album <> '' AND error IS NULL`).all() as { who: string; album: string; genre: string; nd_album_id: string | null }[];
  const by = new Map<string, OurAlbum>();
  const artists = new Map<string, string>();
  for (const r of rows) {
    if (!r.who) continue;
    const k = itemKey('album', r.who, r.album);
    let a = by.get(k);
    if (!a) by.set(k, (a = { artist: r.who, title: r.album, id: r.nd_album_id, genres: [] }));
    a.id ??= r.nd_album_id;
    for (const g of r.genre.split(/;\s*/).map((x) => x.trim()).filter(Boolean)) if (!a.genres.includes(g)) a.genres.push(g);
    if (!artists.has(tagKey(r.who))) artists.set(tagKey(r.who), r.who);
  }
  return { albums: [...by.values()], artists: [...artists.values()] };
}

const same = (a: string[] = [], b: string[] = []) => JSON.stringify(a) === JSON.stringify(b);

/** What a Plex item gives one of ours, and which of those facets importing would change. */
function planOf(db: Db, kind: ItemKind, artist: string, title: string, p: PlexItem): PlexMatch {
  const facets: Facets = { style: p.styles, mood: p.moods, collection: p.collections };
  if (kind === 'artist') facets.genre = p.genres;
  for (const f of Object.keys(facets) as Facet[]) if (!facets[f]?.length) delete facets[f];
  const now = readItem(db, kind, artist, title);
  const changes = (Object.keys(facets) as Facet[]).filter((f) => now.sources[f] !== 'edit' && !same(now.facets[f], facets[f]));
  return { kind, artist, title, facets, changes };
}

export class PlexImport {
  status: PlexStatus = { state: 'idle' };
  private plans: PlexMatch[] = [];

  private db: Db;
  private key: Buffer;
  private fetchFn: Fetch;
  constructor(db: Db, key: Buffer, fetchFn: Fetch = fetch) {
    this.db = db;
    this.key = key;
    this.fetchFn = fetchFn;
  }

  /** The Plex server to read: the one asked for, else the first one saved. */
  private server(id?: number) {
    const sid = id ?? serviceIdOfKind(this.db, 'plex');
    const s = sid === undefined ? undefined : serviceForHub(this.db, this.key, sid);
    if (!s || s.kind !== 'plex') throw new Error('Add your Plex server under Settings → Server → Server logins first');
    if (!s.secrets.token) throw new Error(`${s.name} has no shared Plex token saved under Server logins`);
    return s;
  }

  private async get(base: string, token: string, path: string, params: Record<string, string | number> = {}): Promise<Record<string, unknown>> {
    const q = new URLSearchParams(Object.entries(params).map(([k, v]): [string, string] => [k, String(v)]));
    const res = await this.fetchFn(`${base.replace(/\/+$/, '')}${path}${q.size ? `?${q}` : ''}`, {
      headers: { Accept: 'application/json', 'X-Plex-Token': token, 'X-Plex-Product': 'Wavelength Hub', 'X-Plex-Client-Identifier': 'wavelength-hub' },
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 401) throw new Error('Plex turned the token down (401); save a fresh one under Server logins');
    if (!res.ok) throw new Error(`Plex answered ${res.status} for ${path}`);
    return ((await res.json()) as { MediaContainer?: Record<string, unknown> }).MediaContainer ?? {};
  }

  /** Read Plex and match it to the library; nothing is written. Runs in the background; `status` follows it. */
  read(serviceId?: number): void {
    if (this.status.state === 'reading' || this.status.state === 'importing') throw new Error('Already busy with Plex');
    const s = this.server(serviceId);
    this.status = { state: 'reading', step: `Asking ${s.name} for its music…` };
    void this.readNow(s.name, s.url, s.secrets.token).catch((e) => {
      this.status = { state: 'error', error: (e as Error).message };
    });
  }

  private async readNow(name: string, url: string, token: string) {
    const get = (path: string, params?: Record<string, string | number>) => this.get(url, token, path, params);
    const sections = ((await get('/library/sections')).Directory as Record<string, unknown>[] | undefined ?? []).filter((d) => d.type === 'artist');
    if (!sections.length) throw new Error(`${name} has no music library`);
    const keys: string[] = [];
    for (const sec of sections) {
      for (const type of [8, 9]) {
        for (let start = 0; ; start += 500) {
          this.status = { state: 'reading', step: `Listing ${type === 9 ? 'albums' : 'artists'} in ${String(sec.title ?? 'Music')}… ${keys.length}` };
          const page = await get(`/library/sections/${encodeURIComponent(String(sec.key))}/all`, { type, 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': 500 });
          const items = (page.Metadata as Record<string, unknown>[] | undefined) ?? [];
          for (const m of items) if (m.ratingKey !== undefined) keys.push(String(m.ratingKey));
          const total = Number(page.totalSize ?? page.size ?? 0);
          if (items.length < 500 || (total && start + 500 >= total)) break;
        }
      }
    }
    const items: PlexItem[] = [];
    for (let i = 0; i < keys.length; i += 50) {
      this.status = { state: 'reading', step: `Reading styles and moods… ${i} of ${keys.length}` };
      const page = await get(`/library/metadata/${keys.slice(i, i + 50).join(',')}`);
      for (const m of (page.Metadata as Record<string, unknown>[] | undefined) ?? []) {
        const p = plexItem(m);
        if (p) items.push(p);
      }
    }
    this.status = { state: 'reading', step: 'Matching to your library…' };
    this.status = { state: 'ready', preview: this.preview(name, items) };
  }

  /** Match what Plex has to the library and work out what importing would change. */
  preview(server: string, items: PlexItem[]): PlexPreview {
    const ours = ourLibrary(this.db);
    const { pairs, unmatched } = matchPlex(items, ours);
    const lookup = genreLookup(getGenreSettings(this.db).rules);
    this.plans = [];
    const genres: GenreSuggestion[] = [];
    for (const m of pairs) {
      const plan = planOf(this.db, m.plex.kind, m.artist, m.title, m.plex);
      if (Object.keys(plan.facets).length) this.plans.push(plan);
      // an album with no genre in its files: Plex's, tidied by the genre rules (unknown ones kept as Plex spells them)
      if (m.ours && !m.ours.genres.length && m.ours.id && m.plex.genres.length) {
        const plex = m.plex.genres.join('; ');
        genres.push({ id: m.ours.id, artist: m.artist, title: m.title, plex, genre: normalizeGenre(plex, lookup).genre ?? plex });
      }
    }
    const changing = this.plans.filter((p) => p.changes.length);
    const count = (k: ItemKind) => items.filter((p) => p.kind === k).length;
    const matched = (k: ItemKind) => pairs.filter((p) => p.plex.kind === k).length;
    return {
      at: Date.now(),
      server,
      albums: { plex: count('album'), matched: matched('album') },
      artists: { plex: count('artist'), matched: matched('artist') },
      changes: { albums: changing.filter((p) => p.kind === 'album').length, artists: changing.filter((p) => p.kind === 'artist').length },
      unmatched: unmatched.filter((p) => p.kind === 'album').slice(0, 100).map((p) => ({ artist: p.artist, title: p.title })),
      genres: genres.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title)),
      sample: [...changing.filter((p) => p.kind === 'album').slice(0, 6), ...changing.filter((p) => p.kind === 'artist').slice(0, 4)],
    };
  }

  /** Write what the last read found: `facets` picks which kinds of tag (all by default). */
  apply(o: { facets?: Facet[]; userId?: number | null } = {}): { albums: number; artists: number } {
    if (this.status.state !== 'ready' && this.status.state !== 'done') throw new Error('Read Plex first');
    const want = new Set(o.facets ?? ['genre', 'style', 'mood', 'collection']);
    const preview = this.status.preview;
    this.status = { ...this.status, state: 'importing', step: 'Importing…' };
    const out = { albums: 0, artists: 0 };
    try {
      for (const p of this.plans) {
        const facets = Object.fromEntries(Object.entries(p.facets).filter(([f]) => want.has(f as Facet))) as Facets;
        if (!Object.keys(facets).length) continue;
        const changed = setItem(this.db, { kind: p.kind, artist: p.artist, title: p.title, facets, source: 'plex', userId: o.userId });
        if (changed.length) out[p.kind === 'album' ? 'albums' : 'artists']++;
      }
    } finally {
      this.status = { state: 'done', preview, imported: { at: Date.now(), ...out } };
    }
    // what was imported isn't a change any more
    this.plans = this.plans.map((p) => ({ ...p, changes: [] }));
    if (this.status.preview) this.status.preview = { ...this.status.preview, changes: { albums: 0, artists: 0 }, sample: [] };
    return out;
  }
}
