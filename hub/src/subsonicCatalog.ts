import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { catalogChangesSince, catalogVersion } from './catalog.ts';
import { creditNames } from './credits.ts';
import type { Db } from './db.ts';

/**
 * Phase 3 of the Hub's own music server (docs/HUB.md "Music catalog"): Subsonic's library calls answered from the
 * catalog instead of Navidrome, for devices that go through the Hub (routes/relay.ts). Everything keeps Navidrome's
 * ids, so playing, stars, playlists and play counts still go to Navidrome by the same id.
 *
 * Answered here: getArtists, getArtist, getAlbum, getSong, getGenres, getSongsByGenre, getRandomSongs, search3,
 * getAlbumList2 (all but the lists that need a person's plays or stars) and getCoverArt for albums and songs.
 * Anything else, any id the catalog doesn't know (a download it hasn't read yet), and XML callers go to Navidrome
 * as before: answer() returns null for those.
 */

const VERSION = '1.16.1';
const IGNORED_ARTICLES = ['The', 'El', 'La', 'Los', 'Las', 'Le', 'Les', 'Os', 'As', 'O', 'A'];
const FFMPEG = process.env.WAVELENGTH_FFMPEG || 'ffmpeg';
const CONTENT_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', alac: 'audio/mp4',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', aiff: 'audio/aiff', aif: 'audio/aiff',
  wma: 'audio/x-ms-wma', ape: 'audio/x-ape', wv: 'audio/x-wavpack', dsf: 'audio/dsf',
};
/** Cover files Navidrome looks for first (its CoverArtPriority: cover.*, folder.*, front.*, then embedded). */
const COVER_FILES = /^(cover|folder|front)\.(jpe?g|png|webp|gif)$/i;

interface Row {
  path: string;
  size: number;
  title: string;
  artist: string;
  album: string;
  album_artist: string;
  track: number | null;
  disc: number | null;
  year: number | null;
  genre: string;
  explicit: string;
  duration: number;
  bit_rate: number | null;
  created: number | null;
  rg_track_gain: number | null;
  rg_album_gain: number | null;
  rg_track_peak: number | null;
  rg_album_peak: number | null;
  nd_id: string;
  nd_album_id: string;
  nd_artist_id: string | null;
  nd_album_artist_id: string | null;
}

interface Album {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  songs: Row[];
  year: number | null;
  created: number;
  duration: number;
  genres: string[];
  explicit: string;
}

interface Artist {
  id: string;
  name: string;
  albums: Album[];
}

const iso = (ms: number | null | undefined) => new Date(ms || 0).toISOString();
/** Split a genre tag the way Navidrome does: on ";" only. */
const genresOf = (g: string) => [...new Set(g.split(';').map((x) => x.trim()).filter(Boolean))];
const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const sortName = (s: string) => {
  const f = fold(s).trim();
  for (const a of IGNORED_ARTICLES) if (f.startsWith(`${a.toLowerCase()} `)) return f.slice(a.length + 1);
  return f;
};
const int = (v: string | undefined, def: number, max: number) => {
  const n = Number.parseInt(v ?? '', 10);
  return Math.max(0, Math.min(max, Number.isFinite(n) ? n : def));
};
const shuffle = <T>(xs: T[]) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** The catalog's matched songs, grouped into albums and album artists, kept in memory until the catalog changes. */
const COLUMNS = `path, size, title, artist, album, album_artist, track, disc, year, genre, explicit, duration, bit_rate, created,
  rg_track_gain, rg_album_gain, rg_track_peak, rg_album_peak, nd_id, nd_album_id, nd_artist_id, nd_album_artist_id`;
const LISTED = 'nd_id IS NOT NULL AND nd_album_id IS NOT NULL AND error IS NULL';
const byPlace = (a: Row, b: Row) => (a.disc ?? 0) - (b.disc ?? 0) || (a.track ?? 0) - (b.track ?? 0) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

class View {
  songs = new Map<string, Row>();
  byPath = new Map<string, Row>();
  albums = new Map<string, Album>();
  artists = new Map<string, Artist>();
  genres = new Map<string, { name: string; songs: number; albums: Set<string> }>();
  /** every song, in album order */
  ordered: Row[] = [];
  /** albums by artist, year and name */
  private albumOrder: Album[] = [];
  words = new Map<string, string>();

  constructor(db: Db) {
    const rows = db.prepare(`SELECT ${COLUMNS} FROM catalog_songs WHERE ${LISTED} ORDER BY nd_album_id, disc, track, path`).all() as unknown as Row[];
    for (const r of rows) {
      this.songs.set(r.nd_id, r);
      this.byPath.set(r.path, r);
      let a = this.albums.get(r.nd_album_id);
      if (!a) {
        a = { id: r.nd_album_id, name: r.album, artist: r.album_artist || r.artist, artistId: r.nd_album_artist_id || r.nd_artist_id || '', songs: [], year: null, created: Infinity, duration: 0, genres: [], explicit: '' };
        this.albums.set(a.id, a);
      }
      a.songs.push(r);
    }
    for (const a of this.albums.values()) {
      sumUp(a);
      if (!a.artistId) continue;
      let ar = this.artists.get(a.artistId);
      if (!ar) this.artists.set(a.artistId, (ar = { id: a.artistId, name: a.artist, albums: [] }));
      ar.albums.push(a);
    }
    for (const ar of this.artists.values()) ar.albums.sort(byYear);
    this.order();
    for (const r of rows) this.words.set(r.nd_id, fold(`${r.title} ${r.artist} ${r.album} ${r.album_artist}`));
  }

  /** Genres with their songs and albums, and every song in album order: both follow from the albums. */
  private order(resort = true) {
    this.genres = new Map();
    for (const a of this.albums.values()) {
      for (const r of a.songs) {
        for (const g of genresOf(r.genre)) {
          const k = g.toLowerCase();
          const e = this.genres.get(k) ?? { name: g, songs: 0, albums: new Set<string>() };
          e.songs++;
          e.albums.add(a.id);
          this.genres.set(k, e);
        }
      }
    }
    if (resort) this.albumOrder = [...this.albums.values()].sort((x, y) => sortName(x.artist).localeCompare(sortName(y.artist)) || (x.year ?? 0) - (y.year ?? 0) || x.name.localeCompare(y.name));
    this.ordered = this.albumOrder.flatMap((a) => a.songs);
  }

  /**
   * Bring these files up to date without building everything again (about a quarter of a second for 30,000 songs,
   * during which every other request waits): a tag edit, or a scan that read a few files. False when that isn't
   * enough, because a song came, went, or moved to another album or id; the caller then builds a new View.
   */
  patch(db: Db, paths: string[]): boolean {
    const now = new Map<string, Row>();
    for (let i = 0; i < paths.length; i += 400) {
      const part = paths.slice(i, i + 400);
      for (const r of db.prepare(`SELECT ${COLUMNS} FROM catalog_songs WHERE ${LISTED} AND path IN (${part.map(() => '?').join(', ')})`).all(...part) as unknown as Row[]) now.set(r.path, r);
    }
    for (const p of paths) {
      const was = this.byPath.get(p), is = now.get(p);
      if (!was && !is) continue; // not listed before or now (unmatched, unreadable)
      if (!was || !is || was.nd_id !== is.nd_id || was.nd_album_id !== is.nd_album_id || was.nd_artist_id !== is.nd_artist_id || was.nd_album_artist_id !== is.nd_album_artist_id) return false;
    }
    const albums = new Set<Album>();
    for (const [p, is] of now) {
      const was = this.byPath.get(p)!;
      Object.assign(was, is); // the same object sits in its album's songs and in ordered
      this.words.set(was.nd_id, fold(`${was.title} ${was.artist} ${was.album} ${was.album_artist}`));
      albums.add(this.albums.get(was.nd_album_id)!);
    }
    const artists = new Set<Artist>();
    let resort = false;
    for (const a of albums) {
      const key = `${a.artist}\0${a.year}\0${a.name}`;
      a.songs.sort(byPlace);
      a.name = a.songs[0].album;
      a.artist = a.songs[0].album_artist || a.songs[0].artist;
      sumUp(a);
      if (key !== `${a.artist}\0${a.year}\0${a.name}`) resort = true;
      const ar = this.artists.get(a.artistId);
      if (ar) artists.add(ar);
    }
    for (const ar of artists) {
      ar.name = ar.albums[0]?.artist ?? ar.name;
      ar.albums.sort(byYear);
    }
    // sorted again only when an album's artist, year or name changed
    if (albums.size) this.order(resort);
    return true;
  }
}

const byYear = (x: Album, y: Album) => (x.year ?? 0) - (y.year ?? 0) || x.name.localeCompare(y.name);

/** An album's year, date added, length, genres and explicit status, from its songs. */
function sumUp(a: Album) {
  a.year = null;
  a.created = Infinity;
  a.duration = 0;
  a.genres = [];
  a.explicit = '';
  for (const r of a.songs) {
    a.year = Math.max(a.year ?? 0, r.year ?? 0) || null;
    a.created = Math.min(a.created, r.created || Infinity);
    a.duration += r.duration;
    for (const g of genresOf(r.genre)) if (!a.genres.includes(g)) a.genres.push(g);
    if (r.explicit === 'explicit') a.explicit = 'explicit';
    else if (r.explicit === 'clean' && a.explicit !== 'explicit') a.explicit = 'clean';
  }
  if (!Number.isFinite(a.created)) a.created = 0;
}

let cached: { db: Db; version: number; view: View } | null = null;
function view(db: Db): View {
  const version = catalogVersion();
  if (cached?.db === db && cached.version !== version) {
    // a few files changed (a tag edit, a small scan): update those, else build it again below
    const paths = catalogChangesSince(cached.version);
    if (paths && cached.view.patch(db, paths)) cached.version = version;
  }
  if (!cached || cached.db !== db || cached.version !== version) cached = { db, version, view: new View(db) };
  return cached.view;
}

/** Ids a person starred on Navidrome, with when, so the Hub's answers show the hearts Navidrome's would. */
export type Starred = Map<string, string>;
/** A person's plays and ratings by song id, when the Hub keeps them (userData.ts); null while Navidrome does. */
export type Plays = Map<string, { count: number; last: number | null; rating: number }>;
/** the plays of the person answer() is answering for (answer() is synchronous, so this is set only during it) */
let plays: Plays | null = null;
const playFields = (id: string) => {
  const p = plays?.get(id);
  return p ? { ...(p.count && { playCount: p.count }), ...(p.last && { played: iso(p.last) }), ...(p.rating && { userRating: p.rating }) } : {};
};
const albumPlays = (a: Album) => {
  if (!plays) return {};
  let count = 0, last = 0;
  for (const r of a.songs) {
    const p = plays.get(r.nd_id);
    if (p) {
      count += p.count;
      last = Math.max(last, p.last ?? 0);
    }
  }
  return { ...(count && { playCount: count }), ...(last && { played: iso(last) }) };
};

function song(r: Row, starred: Starred) {
  const suffix = extname(r.path).slice(1).toLowerCase();
  const genres = genresOf(r.genre);
  const replayGain = r.rg_track_gain === null && r.rg_album_gain === null ? undefined : {
    ...(r.rg_track_gain !== null && { trackGain: r.rg_track_gain }),
    ...(r.rg_album_gain !== null && { albumGain: r.rg_album_gain }),
    ...(r.rg_track_peak !== null && { trackPeak: r.rg_track_peak }),
    ...(r.rg_album_peak !== null && { albumPeak: r.rg_album_peak }),
  };
  return {
    id: r.nd_id,
    parent: r.nd_album_id,
    isDir: false,
    title: r.title || r.path.split('/').pop()!.replace(/\.[^.]+$/, ''),
    album: r.album,
    artist: r.artist,
    ...(r.track && { track: r.track }),
    ...(r.year && { year: r.year }),
    ...(genres.length && { genre: genres[0] }),
    genres: genres.map((name) => ({ name })),
    coverArt: `al-${r.nd_album_id}`,
    size: r.size,
    contentType: CONTENT_TYPES[suffix] ?? 'application/octet-stream',
    suffix,
    duration: Math.round(r.duration),
    ...(r.bit_rate && { bitRate: r.bit_rate }),
    path: r.path,
    ...(r.disc && { discNumber: r.disc }),
    created: iso(r.created),
    albumId: r.nd_album_id,
    ...(r.nd_artist_id && { artistId: r.nd_artist_id }),
    type: 'music',
    isVideo: false,
    explicitStatus: r.explicit,
    ...(replayGain && { replayGain }),
    displayAlbumArtist: r.album_artist || r.artist,
    ...(starred.has(r.nd_id) && { starred: starred.get(r.nd_id) }),
    ...playFields(r.nd_id),
  };
}

function album(a: Album, starred: Starred) {
  return {
    id: a.id,
    name: a.name,
    title: a.name,
    album: a.name,
    artist: a.artist,
    ...(a.artistId && { artistId: a.artistId }),
    coverArt: `al-${a.id}`,
    songCount: a.songs.length,
    duration: Math.round(a.duration),
    created: iso(a.created),
    ...(a.year && { year: a.year }),
    ...(a.genres.length && { genre: a.genres[0] }),
    genres: a.genres.map((name) => ({ name })),
    explicitStatus: a.explicit,
    isDir: true,
    ...(starred.has(a.id) && { starred: starred.get(a.id) }),
    ...albumPlays(a),
  };
}

function artist(ar: Artist, starred: Starred) {
  return {
    id: ar.id,
    name: ar.name,
    coverArt: `ar-${ar.id}`,
    albumCount: ar.albums.length,
    ...(starred.has(ar.id) && { starred: starred.get(ar.id) }),
  };
}

function answerAlone(db: Db, method: string, q: Record<string, string>, starred: Starred): Record<string, unknown> | null {
  const v = view(db);
  const inner = (m: string, query: Record<string, string>) => answerFor(db, m, query, starred)?.['subsonic-response'] as Record<string, any> | undefined;
  switch (method) {
    case 'getIndexes': {
      const r = inner('getArtists', {});
      return r ? ok({ indexes: { ...r.artists, lastModified: 0 } }) : null;
    }
    case 'getMusicDirectory': {
      const ar = v.artists.get(q.id ?? '');
      if (ar) return ok({ directory: { id: ar.id, name: ar.name, child: ar.albums.map((a) => ({ ...album(a, starred), parent: ar.id })) } });
      const a = v.albums.get(q.id ?? '');
      if (a) return ok({ directory: { id: a.id, name: a.name, ...(a.artistId && { parent: a.artistId }), child: a.songs.map((r) => song(r, starred)) } });
      return null;
    }
    case 'getAlbumList': {
      const r = inner('getAlbumList2', q);
      return r ? ok({ albumList: { album: (r.albumList2?.album ?? []).map((a: Record<string, unknown>) => ({ ...a, ...(a.artistId ? { parent: a.artistId } : {}) })) } }) : null;
    }
    case 'search2': {
      const r = inner('search3', q);
      return r ? ok({ searchResult2: r.searchResult3 }) : null;
    }
    case 'getTopSongs': {
      // the artist's songs this person played most, then the rest in album order
      const name = fold(q.artist ?? '').trim();
      const count = int(q.count, 50, 500);
      const theirs = v.ordered.filter((r) => fold(r.artist).trim() === name || fold(r.album_artist).trim() === name);
      const played = (r: Row) => plays?.get(r.nd_id)?.count ?? 0;
      const top = theirs.map((r, i) => [r, i] as const).sort((a, b) => played(b[0]) - played(a[0]) || a[1] - b[1]).map(([r]) => r);
      return ok({ topSongs: { song: top.slice(0, count).map((r) => song(r, starred)) } });
    }
    case 'getArtistInfo':
    case 'getArtistInfo2': {
      const ar = v.artists.get(q.id ?? '');
      if (!ar) return null;
      // other artists who share the most genres with this one
      const mine = new Set(ar.albums.flatMap((a) => a.genres.map((g) => g.toLowerCase())));
      const count = int(q.count, 20, 100);
      const similar = mine.size ? [...v.artists.values()].filter((x) => x !== ar)
        .map((x) => [x, new Set(x.albums.flatMap((a) => a.genres.map((g) => g.toLowerCase())).filter((g) => mine.has(g))).size] as const)
        .filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || b[0].albums.length - a[0].albums.length).slice(0, count).map(([x]) => artist(x, starred)) : [];
      const info = { biography: '', similarArtist: similar };
      return ok(method === 'getArtistInfo2' ? { artistInfo2: info } : { artistInfo: info });
    }
    case 'getAlbumInfo':
    case 'getAlbumInfo2': {
      const a = v.albums.get(q.id ?? '') ?? v.albums.get(v.songs.get(q.id ?? '')?.nd_album_id ?? '');
      return a ? ok({ albumInfo: { notes: '' } }) : null;
    }
  }
  return null;
}

/** Songs by id in the Subsonic song shape, leaving out any the catalog doesn't know (similar songs, history). */
export function songsById(db: Db, ids: string[], starred: Starred, personal: Plays | null = null, extra?: (id: string) => Record<string, unknown>): Record<string, unknown>[] {
  const v = view(db);
  plays = personal;
  try {
    return ids.filter((id) => v.songs.has(id)).map((id) => ({ ...song(v.songs.get(id)!, starred), ...extra?.(id) }));
  } finally {
    plays = null;
  }
}

/** Does every word of the query start a word of the text? ("drak scorp" finds Drake – Scorpion) */
function matcher(query: string) {
  const words = fold(query.replace(/["*]/g, ' ')).split(/\s+/).filter(Boolean);
  if (!words.length) return () => true;
  return (text: string) => words.every((w) => text.startsWith(w) || text.includes(` ${w}`) || text.includes(`(${w}`) || text.includes(`-${w}`));
}

/** The body of a Subsonic answer, as Navidrome sends it. */
export const ok = (body: Record<string, unknown>) => ({
  'subsonic-response': { status: 'ok', version: VERSION, type: 'wavelength-hub', serverVersion: 'catalog', openSubsonic: true, ...body },
});

/** Calls answer() can take; the relay only fetches stars for these. */
export const SERVED = new Set(['getArtists', 'getArtist', 'getAlbum', 'getSong', 'getGenres', 'getSongsByGenre', 'getRandomSongs', 'getAlbumList2', 'search3', 'getStarred', 'getStarred2']);
/**
 * Calls answer() takes only with Navidrome off (`alone`), when nothing else could: older Subsonic browsing (folders,
 * search2, getAlbumList), and the ones Navidrome fills from Last.fm (top songs, artist and album info), which come
 * from the library and the person's plays here.
 */
export const ALONE = new Set(['getIndexes', 'getMusicDirectory', 'getAlbumList', 'search2', 'getTopSongs', 'getArtistInfo', 'getArtistInfo2', 'getAlbumInfo', 'getAlbumInfo2']);
/** getAlbumList2 types that need a person's plays, ratings or stars: Navidrome answers those unless the Hub keeps them. */
const PERSONAL_LISTS = new Set(['recent', 'frequent', 'starred', 'highest']);

/**
 * Answer a Subsonic library call from the catalog, or null when Navidrome should (a call or list type not handled
 * here, an id the catalog doesn't know).
 */
export function answer(db: Db, method: string, q: Record<string, string>, starred: Starred, personal: Plays | null = null, alone = false): Record<string, unknown> | null {
  plays = personal;
  try {
    if (alone && ALONE.has(method)) return answerAlone(db, method, q, starred);
    return answerFor(db, method, q, starred);
  } finally {
    plays = null;
  }
}

function answerFor(db: Db, method: string, q: Record<string, string>, starred: Starred): Record<string, unknown> | null {
  if (!SERVED.has(method)) return null;
  // without the person's plays and stars kept on the Hub, Navidrome answers what needs them
  if (!plays && ((method === 'getAlbumList2' && PERSONAL_LISTS.has(q.type ?? '')) || method === 'getStarred' || method === 'getStarred2')) return null;
  const v = view(db);
  switch (method) {
    case 'getArtists': {
      const index = new Map<string, ReturnType<typeof artist>[]>();
      const list = [...v.artists.values()].sort((a, b) => sortName(a.name).localeCompare(sortName(b.name)));
      for (const ar of list) {
        const first = sortName(ar.name).charAt(0).toUpperCase();
        const k = /^[A-Z]$/.test(first) ? first : '#';
        index.set(k, [...(index.get(k) ?? []), artist(ar, starred)]);
      }
      return ok({ artists: { ignoredArticles: IGNORED_ARTICLES.join(' '), index: [...index].map(([name, artist]) => ({ name, artist })) } });
    }
    case 'getArtist': {
      const ar = v.artists.get(q.id ?? '');
      if (!ar) return null;
      return ok({ artist: { ...artist(ar, starred), album: ar.albums.map((a) => album(a, starred)) } });
    }
    case 'getAlbum': {
      const a = v.albums.get(q.id ?? '');
      if (!a) return null;
      return ok({ album: { ...album(a, starred), song: a.songs.map((r) => song(r, starred)) } });
    }
    case 'getSong': {
      const r = v.songs.get(q.id ?? '');
      return r ? ok({ song: song(r, starred) }) : null;
    }
    case 'getStarred':
    case 'getStarred2': {
      // newest heart first, as Navidrome answers (Favorites shows them in this order)
      const ids = [...starred].sort((a, b) => b[1].localeCompare(a[1])).map(([id]) => id);
      const songs = ids.map((id) => v.songs.get(id)).filter((r): r is Row => !!r);
      const albums = ids.map((id) => v.albums.get(id)).filter((a): a is Album => !!a);
      const artists = ids.map((id) => v.artists.get(id)).filter((a): a is Artist => !!a);
      const body = { artist: artists.map((a) => artist(a, starred)), album: albums.map((a) => album(a, starred)), song: songs.map((r) => song(r, starred)) };
      return ok(method === 'getStarred2' ? { starred2: body } : { starred: body });
    }
    case 'getGenres': {
      const genre = [...v.genres.values()].sort((a, b) => a.name.localeCompare(b.name)).map((g) => ({ value: g.name, songCount: g.songs, albumCount: g.albums.size }));
      return ok({ genres: { genre } });
    }
    case 'getSongsByGenre': {
      const want = (q.genre ?? '').toLowerCase();
      const count = int(q.count, 10, 500), offset = int(q.offset, 0, 1_000_000);
      const list = v.ordered.filter((r) => genresOf(r.genre).some((g) => g.toLowerCase() === want));
      return ok({ songsByGenre: { song: list.slice(offset, offset + count).map((r) => song(r, starred)) } });
    }
    case 'getRandomSongs': {
      const size = int(q.size, 10, 500);
      const want = (q.genre ?? '').toLowerCase();
      const from = q.fromYear ? Number(q.fromYear) : null, to = q.toYear ? Number(q.toYear) : null;
      const list = v.ordered.filter((r) => (!want || genresOf(r.genre).some((g) => g.toLowerCase() === want))
        && (from === null || (r.year ?? 0) >= from) && (to === null || (r.year ?? 0) <= to));
      return ok({ randomSongs: { song: shuffle(list).slice(0, size).map((r) => song(r, starred)) } });
    }
    case 'getAlbumList2': {
      const size = int(q.size, 10, 500), offset = int(q.offset, 0, 1_000_000);
      let list = [...v.albums.values()];
      switch (q.type) {
        case 'alphabeticalByName':
          list.sort((a, b) => sortName(a.name).localeCompare(sortName(b.name)) || sortName(a.artist).localeCompare(sortName(b.artist)));
          break;
        case 'alphabeticalByArtist':
          list.sort((a, b) => sortName(a.artist).localeCompare(sortName(b.artist)) || (a.year ?? 0) - (b.year ?? 0) || a.name.localeCompare(b.name));
          break;
        case 'newest':
          list.sort((a, b) => b.created - a.created || a.name.localeCompare(b.name));
          break;
        case 'random':
          list = shuffle(list);
          break;
        case 'starred':
          list = list.filter((a) => starred.has(a.id)).sort((a, b) => (starred.get(b.id) ?? '').localeCompare(starred.get(a.id) ?? ''));
          break;
        case 'frequent':
        case 'recent': {
          const stat = new Map(list.map((a) => [a.id, albumPlays(a) as { playCount?: number; played?: string }]));
          list = list.filter((a) => stat.get(a.id)?.playCount);
          list.sort(q.type === 'frequent'
            ? (a, b) => (stat.get(b.id)!.playCount ?? 0) - (stat.get(a.id)!.playCount ?? 0)
            : (a, b) => (stat.get(b.id)!.played ?? '').localeCompare(stat.get(a.id)!.played ?? ''));
          break;
        }
        case 'highest': {
          const avg = (a: Album) => {
            const r = a.songs.map((x) => plays?.get(x.nd_id)?.rating ?? 0).filter(Boolean);
            return r.length ? r.reduce((x, y) => x + y, 0) / r.length : 0;
          };
          list = list.filter((a) => avg(a) > 0).sort((a, b) => avg(b) - avg(a));
          break;
        }
        case 'byYear': {
          const from = Number(q.fromYear) || 0, to = Number(q.toYear) || 9999;
          const lo = Math.min(from, to), hi = Math.max(from, to);
          list = list.filter((a) => (a.year ?? 0) >= lo && (a.year ?? 0) <= hi);
          list.sort((a, b) => (from <= to ? 1 : -1) * ((a.year ?? 0) - (b.year ?? 0)) || a.name.localeCompare(b.name));
          break;
        }
        case 'byGenre': {
          const want = (q.genre ?? '').toLowerCase();
          list = list.filter((a) => a.genres.some((g) => g.toLowerCase() === want)).sort((a, b) => sortName(a.name).localeCompare(sortName(b.name)));
          break;
        }
        default:
          return null;
      }
      return ok({ albumList2: { album: list.slice(offset, offset + size).map((a) => album(a, starred)) } });
    }
    case 'search3': {
      const match = matcher(q.query ?? '');
      const page = <T>(xs: T[], count: string | undefined, offset: string | undefined) => {
        const o = int(offset, 0, 1_000_000);
        return xs.slice(o, o + int(count, 20, 500));
      };
      const artists = q.artistCount === '0' ? [] : page(searchArtists(v, q.query ?? '', match), q.artistCount, q.artistOffset);
      const albums = q.albumCount === '0' ? [] : page([...v.albums.values()].filter((a) => match(fold(`${a.name} ${a.artist}`))).sort((a, b) => sortName(a.name).localeCompare(sortName(b.name))), q.albumCount, q.albumOffset);
      const songs = q.songCount === '0' ? [] : page(v.ordered.filter((r) => match(v.words.get(r.nd_id)!)), q.songCount, q.songOffset);
      return ok({ searchResult3: { artist: artists.map((a) => artist(a, starred)), album: albums.map((a) => album(a, starred)), song: songs.map((r) => song(r, starred)) } });
    }
  }
  return null;
}

/**
 * Artists for search3: an album artist that is several joined ("Lil Baby & Lil Durk", "Calboy;Meek Mill;Lil Durk")
 * is replaced by the ones in it that are artists of their own here, so searching "lil durk" lists Lil Durk once
 * and not every credit he's in (credits.ts creditNames()). The exact name first, then names starting with the
 * search, then the rest by name.
 */
function searchArtists(v: View, query: string, match: (text: string) => boolean): Artist[] {
  const byName = new Map<string, Artist>();
  for (const a of v.artists.values()) if (!byName.has(fold(a.name).trim())) byName.set(fold(a.name).trim(), a);
  const known = (n: string) => byName.has(fold(n).trim());
  const out = new Map<string, Artist>();
  for (const a of v.artists.values()) {
    if (!match(fold(a.name))) continue;
    const own = creditNames(a.name, known).map((n) => byName.get(fold(n).trim())).filter((x): x is Artist => !!x && x !== a && match(fold(x.name)));
    for (const x of own.length ? own : [a]) out.set(x.id, x);
  }
  const want = fold(query).trim();
  const rank = (a: Artist) => (fold(a.name) === want ? 0 : fold(a.name).startsWith(want) ? 1 : 2);
  return [...out.values()].sort((a, b) => rank(a) - rank(b) || sortName(a.name).localeCompare(sortName(b.name)));
}

/**
 * The files a cover id points at, best first: "al-<album id>" or "mf-<song id>" (with or without Navidrome's
 * "_<time>"), or a bare album or song id. A song comes first and then the rest of its album, so a song whose file has
 * no picture still gets its album's cover, as with Navidrome. An artist ("ar-…") gets their latest album's cover;
 * an id the catalog doesn't know, nothing.
 */
export function coverSources(db: Db, id: string): { dir: string; file: string }[] {
  const v = view(db);
  const m = /^(al|mf|ar)-(.+?)(_[0-9a-f]+)?$/.exec(id);
  const kind = m?.[1], key = m ? m[2] : id;
  const song = kind === 'mf' || !kind ? v.songs.get(key) : undefined;
  const album = kind === 'al' ? v.albums.get(key) : kind === 'ar' ? v.artists.get(key)?.albums.at(-1) : song ? v.albums.get(song.nd_album_id) : v.albums.get(key);
  const rows = [...(song ? [song] : []), ...(album?.songs ?? []).filter((r) => r !== song)];
  return rows.map((r) => ({ dir: dirname(r.path), file: r.path }));
}

function run(args: string[]): Promise<Buffer | null> {
  return new Promise((done) => {
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const out: Buffer[] = [];
    p.stdout.on('data', (d: Buffer) => out.push(d));
    p.on('error', () => done(null));
    p.on('close', (code) => done(code === 0 && out.length ? Buffer.concat(out) : null));
  });
}

/** Songs of an album looked inside for a picture before giving up (each one is an ffmpeg run). */
const COVER_TRIES = 3;
/** How long "this has no cover" is remembered, so a list of songs without art doesn't run ffmpeg on every look. */
const NO_COVER_MS = 10 * 60_000;
const noCover = new Map<string, number>();
/** Covers being made right now, so the same cover asked for by several rows at once is made once. */
const making = new Map<string, Promise<{ body: Buffer; type: string } | null>>();

/**
 * A cover from the music folder: the album folder's cover/folder/front picture, else the picture in the file (the
 * song's own, then the album's other songs'), made `size` pixels across (JPEG) when asked. Kept in `<data>/covers`
 * by file and size, and "none" is remembered for a while. null when there is none (the relay then asks Navidrome,
 * which has its own fallbacks).
 *
 * Covers come in bursts (a playlist of 30 songs asks for 30 at once), and a browser only opens 6 connections to the
 * Hub: a slow cover holds up the song that's starting to play behind it. So the disk is read without blocking, a
 * miss is answered at once the next time, and the same cover asked for twice at once is made once.
 */
export async function cover(db: Db, musicDir: string, cacheDir: string, id: string, size: number): Promise<{ body: Buffer; type: string } | null> {
  const px = size > 0 ? Math.min(Math.max(size, 32), 1500) : 0;
  const ask = `${musicDir}\n${catalogVersion()}\n${id}\n${px}`;
  const missed = noCover.get(ask);
  if (missed !== undefined) {
    if (Date.now() - missed < NO_COVER_MS) return null;
    noCover.delete(ask);
  }
  let p = making.get(ask);
  if (!p) {
    p = findCover(db, musicDir, cacheDir, id, px).finally(() => making.delete(ask));
    making.set(ask, p);
  }
  const art = await p;
  if (!art) {
    if (noCover.size > 5000) noCover.clear();
    noCover.set(ask, Date.now());
  }
  return art;
}

async function findCover(db: Db, musicDir: string, cacheDir: string, id: string, px: number): Promise<{ body: Buffer; type: string } | null> {
  const sources = coverSources(db, id);
  const pictures = new Map<string, string | null>();
  const pictureIn = async (dir: string) => {
    if (!pictures.has(dir)) pictures.set(dir, await readdir(join(musicDir, dir)).then((fs) => fs.find((f) => COVER_FILES.test(f)) ?? null, () => null));
    return pictures.get(dir)!;
  };
  // a picture next to any of the files first (no ffmpeg needed to find it), then the pictures inside the files
  const inputs: { input: string; picture: string | null }[] = [];
  for (const src of sources.slice(0, 50)) {
    const picture = await pictureIn(src.dir);
    if (picture) {
      inputs.push({ input: join(musicDir, src.dir, picture), picture });
      break;
    }
  }
  for (const src of sources.slice(0, COVER_TRIES)) inputs.push({ input: join(musicDir, src.file), picture: null });
  for (const { input, picture } of inputs) {
    const art = await coverFrom(input, picture, cacheDir, px);
    if (art) return art;
  }
  return null;
}

async function coverFrom(input: string, picture: string | null, cacheDir: string, px: number): Promise<{ body: Buffer; type: string } | null> {
  let st;
  try {
    st = await stat(input);
  } catch {
    return null;
  }
  // an untouched cover file needs no ffmpeg at all
  if (picture && !px) {
    const ext = extname(picture).slice(1).toLowerCase();
    return { body: await readFile(input), type: ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}` };
  }
  const key = createHash('sha256').update(`${input}\n${st.size}\n${st.mtimeMs}\n${px}`).digest('hex');
  const file = join(cacheDir, key.slice(0, 2), `${key}.jpg`);
  const cached = await readFile(file).catch(() => null);
  if (cached) return { body: cached, type: 'image/jpeg' };
  const scale = px ? ['-vf', `scale=${px}:${px}:force_original_aspect_ratio=decrease`] : [];
  const body = await run(['-v', 'error', '-nostdin', '-i', input, '-map', '0:v:0', '-frames:v', '1', ...scale, '-q:v', '3', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1']);
  if (!body) return null;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, body);
    renameSync(`${file}.tmp`, file);
  } catch {
    // a full disk only costs the cache
  }
  return { body, type: 'image/jpeg' };
}

/**
 * A playlist's songs in the Subsonic song shape (playlists.ts), or null when the catalog doesn't know one of them, so
 * that Navidrome answers instead and nothing goes missing from the list.
 */
export function playlistEntries(db: Db, ids: string[], starred: Starred, personal: Plays | null = null, partial = false): Record<string, unknown>[] | null {
  const v = view(db);
  // a song the catalog doesn't know: Navidrome answers the playlist instead, or, without Navidrome (`partial`), the
  // songs the Hub does know are the playlist (knownPositions() maps their positions back for removing)
  if (!partial && !ids.every((id) => v.songs.has(id))) return null;
  plays = personal;
  try {
    return ids.filter((id) => v.songs.has(id)).map((id) => song(v.songs.get(id)!, starred));
  } finally {
    plays = null;
  }
}

/**
 * The positions in a playlist of the songs the catalog knows, in order: what a device saw as song N of a playlist
 * answered with `partial` playlistEntries() is position knownPositions()[N] of the playlist kept on the Hub.
 */
export function knownPositions(db: Db, ids: string[]): number[] {
  const v = view(db);
  return ids.flatMap((id, i) => (v.songs.has(id) ? [i] : []));
}

/** A playlist's length in seconds, from the catalog, without building its songs (for the list of playlists). */
export function playlistDuration(db: Db, ids: string[]): number {
  const v = view(db);
  let n = 0;
  for (const id of ids) n += Math.round(v.songs.get(id)?.duration ?? 0);
  return n;
}
