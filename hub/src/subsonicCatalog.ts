import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { catalogVersion } from './catalog.ts';
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
class View {
  songs = new Map<string, Row>();
  albums = new Map<string, Album>();
  artists = new Map<string, Artist>();
  genres = new Map<string, { name: string; songs: number; albums: Set<string> }>();
  /** every song, in album order */
  ordered: Row[] = [];
  words = new Map<string, string>();

  constructor(db: Db) {
    const rows = db.prepare(`SELECT path, size, title, artist, album, album_artist, track, disc, year, genre, explicit, duration, bit_rate, created,
        rg_track_gain, rg_album_gain, rg_track_peak, rg_album_peak, nd_id, nd_album_id, nd_artist_id, nd_album_artist_id
      FROM catalog_songs WHERE nd_id IS NOT NULL AND nd_album_id IS NOT NULL AND error IS NULL
      ORDER BY nd_album_id, disc, track, path`).all() as unknown as Row[];
    for (const r of rows) {
      this.songs.set(r.nd_id, r);
      let a = this.albums.get(r.nd_album_id);
      if (!a) {
        a = { id: r.nd_album_id, name: r.album, artist: r.album_artist || r.artist, artistId: r.nd_album_artist_id || r.nd_artist_id || '', songs: [], year: null, created: Infinity, duration: 0, genres: [], explicit: '' };
        this.albums.set(a.id, a);
      }
      a.songs.push(r);
      a.year = Math.max(a.year ?? 0, r.year ?? 0) || null;
      a.created = Math.min(a.created, r.created || Infinity);
      a.duration += r.duration;
      for (const g of genresOf(r.genre)) {
        if (!a.genres.includes(g)) a.genres.push(g);
        const k = g.toLowerCase();
        const e = this.genres.get(k) ?? { name: g, songs: 0, albums: new Set<string>() };
        e.songs++;
        e.albums.add(a.id);
        this.genres.set(k, e);
      }
      if (r.explicit === 'explicit') a.explicit = 'explicit';
      else if (r.explicit === 'clean' && a.explicit !== 'explicit') a.explicit = 'clean';
    }
    for (const a of this.albums.values()) {
      if (!Number.isFinite(a.created)) a.created = 0;
      if (!a.artistId) continue;
      let ar = this.artists.get(a.artistId);
      if (!ar) this.artists.set(a.artistId, (ar = { id: a.artistId, name: a.artist, albums: [] }));
      ar.albums.push(a);
    }
    for (const ar of this.artists.values()) ar.albums.sort((x, y) => (x.year ?? 0) - (y.year ?? 0) || x.name.localeCompare(y.name));
    this.ordered = [...this.albums.values()].sort((x, y) => sortName(x.artist).localeCompare(sortName(y.artist)) || (x.year ?? 0) - (y.year ?? 0) || x.name.localeCompare(y.name)).flatMap((a) => a.songs);
    for (const r of rows) this.words.set(r.nd_id, fold(`${r.title} ${r.artist} ${r.album} ${r.album_artist}`));
  }
}

let cached: { db: Db; version: number; view: View } | null = null;
function view(db: Db): View {
  if (!cached || cached.db !== db || cached.version !== catalogVersion()) cached = { db, version: catalogVersion(), view: new View(db) };
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
/** getAlbumList2 types that need a person's plays, ratings or stars: Navidrome answers those unless the Hub keeps them. */
const PERSONAL_LISTS = new Set(['recent', 'frequent', 'starred', 'highest']);

/**
 * Answer a Subsonic library call from the catalog, or null when Navidrome should (a call or list type not handled
 * here, an id the catalog doesn't know).
 */
export function answer(db: Db, method: string, q: Record<string, string>, starred: Starred, personal: Plays | null = null): Record<string, unknown> | null {
  plays = personal;
  try {
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
      const songs = [...starred.keys()].map((id) => v.songs.get(id)).filter((r): r is Row => !!r);
      const albums = [...starred.keys()].map((id) => v.albums.get(id)).filter((a): a is Album => !!a);
      const artists = [...starred.keys()].map((id) => v.artists.get(id)).filter((a): a is Artist => !!a);
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
 * The file a cover id points at: "al-<album id>" or "mf-<song id>" (with or without Navidrome's "_<time>"), or a bare
 * album or song id. null for artists ("ar-…", their pictures come from the internet) and ids the catalog doesn't know.
 */
export function coverSource(db: Db, id: string): { dir: string; file: string } | null {
  const v = view(db);
  const m = /^(al|mf)-(.+?)(_[0-9a-f]+)?$/.exec(id);
  const kind = m?.[1], key = m ? m[2] : id;
  const r = kind === 'mf' ? v.songs.get(key) : kind === 'al' ? v.albums.get(key)?.songs[0] : v.albums.get(key)?.songs[0] ?? v.songs.get(key);
  return r ? { dir: dirname(r.path), file: r.path } : null;
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

/**
 * A cover from the music folder: the album folder's cover/folder/front picture, else the picture in the file, made
 * `size` pixels across (JPEG) when asked. Kept in `<data>/covers` by file and size. null when there is none (the relay
 * then asks Navidrome, which has its own fallbacks).
 */
export async function cover(db: Db, musicDir: string, cacheDir: string, id: string, size: number): Promise<{ body: Buffer; type: string } | null> {
  const src = coverSource(db, id);
  if (!src) return null;
  let picture: string | null = null;
  try {
    picture = readdirSync(join(musicDir, src.dir)).find((f) => COVER_FILES.test(f)) ?? null;
  } catch {
    return null;
  }
  const input = join(musicDir, picture ? join(src.dir, picture) : src.file);
  let st;
  try {
    st = statSync(input);
  } catch {
    return null;
  }
  const px = size > 0 ? Math.min(Math.max(size, 32), 1500) : 0;
  // an untouched cover file needs no ffmpeg at all
  if (picture && !px) {
    const ext = extname(picture).slice(1).toLowerCase();
    return { body: readFileSync(input), type: ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}` };
  }
  const key = createHash('sha256').update(`${input}\n${st.size}\n${st.mtimeMs}\n${px}`).digest('hex');
  const file = join(cacheDir, key.slice(0, 2), `${key}.jpg`);
  if (existsSync(file)) return { body: readFileSync(file), type: 'image/jpeg' };
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
