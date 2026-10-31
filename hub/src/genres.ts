import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Db } from './db.ts';
import { AUDIO_EXT } from './tags.ts';

/**
 * Tidy genres (docs/USERS-AND-ADMIN.md, Genres): one genre per kind of music, so "Hip Hop", "Trap" and
 * "Rap/Hip Hop" all become "Rap; Hip-Hop" and "Dance Pop" becomes "Pop". Admins keep the list of rules
 * (variant → genre) under Settings → Server → Genres; the defaults below are used until they change it.
 * New downloads are tidied before Navidrome scans them, and the rest of the library from the review there.
 */

/** Genre → the names it replaces. The genre itself always counts as known. */
export const DEFAULT_GENRES: Record<string, string[]> = {
  'Rap; Hip-Hop': [
    'Rap', 'Hip Hop', 'Hip-Hop', 'HipHop', 'Rap/Hip Hop', 'Hip Hop/Rap', 'Hip-Hop/Rap', 'Trap', 'Pop Rap', 'Gangsta Rap', 'Conscious Rap',
    'Conscious Hip Hop', 'Southern Hip Hop', 'East Coast Hip Hop', 'West Coast Hip Hop', 'Alternative Hip Hop', 'Underground Hip Hop',
    'Hardcore Hip Hop', 'Drill', 'UK Drill', 'Grime', 'Boom Bap', 'Cloud Rap', 'Emo Rap', 'Melodic Rap', 'Dirty South', 'Crunk', 'Rap Rock',
    'Trap Latino', 'Horrorcore', 'Jazz Rap', 'Rap Français', 'Deutschrap', 'Urban',
  ],
  Pop: [
    'Dance Pop', 'Pop Rock', 'Pop/Rock', 'Synth-pop', 'Synthpop', 'Electropop', 'Indie Pop', 'Teen Pop', 'K-Pop', 'J-Pop', 'Art Pop',
    'Dream Pop', 'Bedroom Pop', 'Power Pop', 'Europop', 'Chamber Pop', 'Hyperpop', 'Adult Contemporary', 'Variété', 'Variété Française',
    'International Pop', 'Pop Internacional',
  ],
  Electronic: [
    'Electronica', 'Electro', 'EDM', 'Dance', 'Dance/Electronic', 'Electronic/Dance', 'Dance & EDM', 'House', 'Deep House', 'Tech House',
    'Progressive House', 'Electro House', 'Future House', 'Big Room', 'Techno', 'Trance', 'Dubstep', 'Drum and Bass', 'Drum & Bass', 'DnB',
    'D&B', 'Jungle', 'Future Bass', 'UK Garage', 'Breakbeat', 'Hardstyle', 'IDM', 'Downtempo', 'Chillout', 'Chill', 'Ambient', 'Synthwave',
    'Trip Hop', 'Electronic Dance Music',
  ],
  'R&B': ['RnB', 'R and B', 'Rhythm and Blues', 'Rhythm & Blues', 'Contemporary R&B', 'Alternative R&B', 'R&B/Soul', 'Neo Soul', 'Neo-Soul'],
  Soul: ['Soul & Funk', 'Funk', 'Motown', 'Northern Soul'],
  Rock: [
    'Alternative Rock', 'Alt Rock', 'Indie Rock', 'Hard Rock', 'Classic Rock', 'Soft Rock', 'Garage Rock', 'Psychedelic Rock', 'Progressive Rock',
    'Prog Rock', 'Rock & Roll', 'Rock and Roll', "Rock 'n' Roll", 'Grunge', 'Post-Grunge', 'Southern Rock', 'Blues Rock', 'Arena Rock',
  ],
  Alternative: ['Indie', 'Alt', 'Indie/Alternative', 'Alternative/Indie', 'Post-Punk', 'New Wave', 'Shoegaze', 'Emo'],
  Punk: ['Punk Rock', 'Pop Punk', 'Pop-Punk', 'Hardcore Punk', 'Skate Punk', 'Ska Punk'],
  Metal: ['Heavy Metal', 'Metalcore', 'Death Metal', 'Black Metal', 'Thrash Metal', 'Nu Metal', 'Nu-Metal', 'Power Metal', 'Doom Metal', 'Deathcore', 'Djent', 'Hard Rock & Metal'],
  Country: ['Country Pop', 'Contemporary Country', 'Country Rock', 'Americana', 'Bluegrass', 'Outlaw Country', 'Alt-Country', 'Red Dirt'],
  Folk: ['Indie Folk', 'Folk Rock', 'Singer-Songwriter', 'Acoustic', 'Contemporary Folk'],
  Latin: ['Reggaeton', 'Reggaetón', 'Latin Pop', 'Latin Urban', 'Urbano Latino', 'Música Mexicana', 'Regional Mexican', 'Bachata', 'Salsa', 'Cumbia', 'Corridos', 'Latin Trap'],
  Reggae: ['Dancehall', 'Roots Reggae', 'Dub', 'Ska'],
  Jazz: ['Smooth Jazz', 'Vocal Jazz', 'Bebop', 'Jazz Fusion', 'Swing', 'Big Band'],
  Blues: ['Delta Blues', 'Chicago Blues', 'Electric Blues'],
  Classical: ['Orchestral', 'Baroque', 'Opera', 'Romantic', 'Modern Classical', 'Contemporary Classical', 'Classical Crossover'],
  Soundtrack: ['Soundtracks', 'Film Score', 'Score', 'OST', 'Original Soundtrack', 'Films/Games', 'Film/Games', 'Movie Soundtrack', 'Video Game Music', 'Musicals', 'Show Tunes'],
  Christian: ['Gospel', 'Worship', 'CCM', 'Contemporary Christian', 'Christian & Gospel', 'Christian Rock', 'Praise & Worship'],
  "Children's": ['Kids', 'Children', "Children's Music", 'Kids & Family', 'Kinderlieder'],
};

export interface GenreRule { from: string; to: string }
export interface GenreSettings {
  /** Tidy new downloads before Navidrome scans them. */
  auto: boolean;
  rules: GenreRule[];
  /** Albums (Navidrome ids) an admin said to leave as they are. */
  keep: string[];
  /** Whether `rules` are the defaults (nothing saved yet). */
  defaults: boolean;
}

const KEY = 'genres';
const SINCE_KEY = 'genres.since';

export const defaultRules = (): GenreRule[] => Object.entries(DEFAULT_GENRES).flatMap(([to, from]) => from.map((f) => ({ from: f, to })));

/** How names are compared: "Hip-Hop", "hip hop" and "HipHop" are the same; "R&B" and "R and B" too. */
export const genreKey = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '');

export function getGenreSettings(db: Db): GenreSettings {
  const row = db.prepare('SELECT value FROM hub_settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  let v: Partial<GenreSettings> = {};
  try {
    v = row ? JSON.parse(row.value) : {};
  } catch {
    /* start over */
  }
  return { auto: v.auto ?? true, rules: v.rules ?? defaultRules(), keep: v.keep ?? [], defaults: !v.rules };
}

/** Save what's given; `rules: null` goes back to the defaults. */
export function saveGenreSettings(db: Db, s: { auto?: boolean; rules?: GenreRule[] | null; keep?: string[] }): GenreSettings {
  const cur = getGenreSettings(db);
  const next = {
    auto: s.auto ?? cur.auto,
    rules: s.rules === null ? undefined : s.rules ?? (cur.defaults ? undefined : cur.rules),
    keep: s.keep ?? cur.keep,
  };
  db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(next));
  return getGenreSettings(db);
}

const CHECK_KEY = 'genres.check';
/** How often the Hub looks over the library's genres on its own (routes/genres.ts). */
export const GENRE_CHECK_MS = 7 * 86_400_000;

/** The last weekly look: when, and the albums (ids) and unknown genres (`genre:` + key) admins were told about. */
export function getGenreCheck(db: Db): { at: number; told: string[] } {
  const row = db.prepare('SELECT value FROM hub_settings WHERE key = ?').get(CHECK_KEY) as { value: string } | undefined;
  try {
    const v = row ? JSON.parse(row.value) : {};
    return { at: Number(v.at) || 0, told: Array.isArray(v.told) ? v.told : [] };
  } catch {
    return { at: 0, told: [] };
  }
}

export function setGenreCheck(db: Db, v: { at: number; told: string[] }) {
  db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(CHECK_KEY, JSON.stringify(v));
}

/** The genres rules lead to, sorted. */
export const genreTargets = (rules: GenreRule[]) => [...new Set(rules.map((r) => r.to))].sort((a, b) => a.localeCompare(b));

export type GenreLookup = Map<string, string>;
export function genreLookup(rules: GenreRule[]): GenreLookup {
  const m: GenreLookup = new Map();
  for (const r of rules) m.set(genreKey(r.to), r.to);
  for (const r of rules) if (!m.has(genreKey(r.from))) m.set(genreKey(r.from), r.to);
  return m;
}

/**
 * The tidy genre for a genre tag. A tag with several genres ("Pop; Dance; Christmas") takes the genre the
 * first known one leads to; one with none known gives `genre: null` and lists them as `unknown`.
 */
export function normalizeGenre(raw: string, lookup: GenreLookup): { genre: string | null; unknown: string[] } {
  const text = raw.trim();
  if (!text) return { genre: null, unknown: [] };
  const whole = lookup.get(genreKey(text));
  if (whole) return { genre: whole, unknown: [] };
  const parts = [...new Set(text.split(/\s*[;,/|\\]\s*/).map((p) => p.trim()).filter((p) => genreKey(p)))];
  const unknown: string[] = [];
  for (const p of parts) {
    const to = lookup.get(genreKey(p));
    if (to) return { genre: to, unknown: [] };
    unknown.push(p);
  }
  return { genre: null, unknown };
}

/** Music files under the music folder changed after `since` (hidden folders, like the trash, skipped). */
export function filesSince(musicDir: string, since: number): string[] {
  const root = resolve(musicDir);
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && AUDIO_EXT.test(e.name)) {
        try {
          // ctime too: some downloaders set the file's time to the release date
          const st = statSync(p);
          if (Math.max(st.mtimeMs, st.ctimeMs) > since) out.push(p);
        } catch {
          /* gone again */
        }
      }
    }
  };
  walk(root);
  return out;
}

/** When new downloads were last tidied (files changed after this are new). */
export function genresSince(db: Db): number | null {
  const row = db.prepare('SELECT value FROM hub_settings WHERE key = ?').get(SINCE_KEY) as { value: string } | undefined;
  return row ? Number(row.value) : null;
}
export function setGenresSince(db: Db, at: number) {
  db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(SINCE_KEY, String(at));
}
