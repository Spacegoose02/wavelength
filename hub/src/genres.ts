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

/**
 * Genre → other spellings of it, which simply become the genre. The genre itself always counts as known.
 * Kinds of music within a genre are sub-genres (DEFAULT_SUBGENRES), kept next to it.
 */
export const DEFAULT_GENRES: Record<string, string[]> = {
  'Rap; Hip-Hop': ['Rap', 'Hip Hop', 'Hip-Hop', 'HipHop', 'Rap/Hip Hop', 'Hip Hop/Rap', 'Hip-Hop/Rap', 'Urban'],
  Pop: ['International Pop', 'Pop Internacional'],
  Electronic: ['Electronica', 'EDM', 'Dance', 'Dance/Electronic', 'Electronic/Dance', 'Dance & EDM', 'Electronic Dance Music'],
  'R&B': ['RnB', 'R and B', 'Rhythm and Blues', 'Rhythm & Blues', 'R&B/Soul'],
  Soul: ['Soul & Funk'],
  Rock: [],
  Alternative: ['Alt', 'Indie/Alternative', 'Alternative/Indie'],
  Punk: [],
  Metal: ['Hard Rock & Metal'],
  Country: [],
  Folk: [],
  Latin: ['Latin Urban', 'Urbano Latino'],
  Reggae: [],
  Jazz: [],
  Blues: [],
  Classical: [],
  Soundtrack: ['Soundtracks', 'OST', 'Original Soundtrack', 'Films/Games', 'Film/Games'],
  Christian: ['CCM', 'Christian & Gospel'],
  "Children's": ['Kids', 'Children', "Children's Music", 'Kids & Family', 'Kinderlieder'],
};

/**
 * Genre → its sub-genres → other spellings of each. A song tagged "Deep House" becomes "Electronic; Deep House":
 * Navidrome splits on ";", so it shows under both, and Browse in the app shows Deep House inside Electronic.
 */
export const DEFAULT_SUBGENRES: Record<string, Record<string, string[]>> = {
  'Rap; Hip-Hop': {
    Trap: ['Trap Rap'], 'Pop Rap': [], 'Gangsta Rap': [], 'Conscious Hip-Hop': ['Conscious Rap', 'Conscious Hip Hop'],
    'Southern Hip-Hop': ['Southern Hip Hop', 'Dirty South', 'Crunk'], 'East Coast Hip-Hop': ['East Coast Hip Hop'],
    'West Coast Hip-Hop': ['West Coast Hip Hop'], 'Alternative Hip-Hop': ['Alternative Hip Hop', 'Underground Hip Hop'],
    'Hardcore Hip-Hop': ['Hardcore Hip Hop', 'Horrorcore'], Drill: ['UK Drill'], Grime: [], 'Boom Bap': [], 'Cloud Rap': [],
    'Emo Rap': [], 'Melodic Rap': [], 'Rap Rock': [], 'Jazz Rap': [], 'Rap Français': [], Deutschrap: [],
  },
  Pop: {
    'Dance Pop': [], 'Pop Rock': ['Pop/Rock'], 'Synth-Pop': ['Synthpop', 'Synth Pop'], Electropop: [], 'Indie Pop': [], 'Teen Pop': [],
    'K-Pop': [], 'J-Pop': [], 'Art Pop': [], 'Dream Pop': [], 'Bedroom Pop': [], 'Power Pop': [], Europop: [], 'Chamber Pop': [],
    Hyperpop: [], 'Adult Contemporary': [], Variété: ['Variété Française'],
  },
  Electronic: {
    House: ['Electro House', 'Future House', 'Big Room'], 'Deep House': [], 'Tech House': [], 'Progressive House': [], Techno: [],
    Trance: [], Dubstep: [], 'Drum & Bass': ['Drum and Bass', 'DnB', 'D&B', 'Jungle'], 'Future Bass': [], 'UK Garage': [],
    Breakbeat: [], Hardstyle: [], Electro: [], IDM: [], Downtempo: ['Chillout', 'Chill'], Ambient: [], Synthwave: [], 'Trip Hop': [],
  },
  'R&B': { 'Contemporary R&B': [], 'Alternative R&B': [], 'Neo Soul': ['Neo-Soul'] },
  Soul: { Funk: [], Motown: [], 'Northern Soul': [] },
  Rock: {
    'Alternative Rock': ['Alt Rock'], 'Indie Rock': [], 'Hard Rock': [], 'Classic Rock': [], 'Soft Rock': [], 'Garage Rock': [],
    'Psychedelic Rock': [], 'Progressive Rock': ['Prog Rock'], 'Rock & Roll': ['Rock and Roll', "Rock 'n' Roll"], Grunge: ['Post-Grunge'],
    'Southern Rock': [], 'Blues Rock': [], 'Arena Rock': [],
  },
  Alternative: { Indie: [], 'Post-Punk': [], 'New Wave': [], Shoegaze: [], Emo: [] },
  Punk: { 'Punk Rock': [], 'Pop Punk': ['Pop-Punk'], 'Hardcore Punk': [], 'Skate Punk': [], 'Ska Punk': [] },
  Metal: {
    'Heavy Metal': [], Metalcore: [], 'Death Metal': [], 'Black Metal': [], 'Thrash Metal': [], 'Nu Metal': ['Nu-Metal'],
    'Power Metal': [], 'Doom Metal': [], Deathcore: [], Djent: [],
  },
  Country: {
    'Country Pop': [], 'Contemporary Country': [], 'Country Rock': [], Americana: [], Bluegrass: [], 'Outlaw Country': [],
    'Alt-Country': [], 'Red Dirt': [],
  },
  Folk: { 'Indie Folk': [], 'Folk Rock': [], 'Singer-Songwriter': [], Acoustic: [], 'Contemporary Folk': [] },
  Latin: {
    Reggaeton: ['Reggaetón'], 'Latin Pop': [], 'Música Mexicana': ['Regional Mexican'], Bachata: [], Salsa: [], Cumbia: [],
    Corridos: [], 'Latin Trap': ['Trap Latino'],
  },
  Reggae: { Dancehall: [], 'Roots Reggae': [], Dub: [], Ska: [] },
  Jazz: { 'Smooth Jazz': [], 'Vocal Jazz': [], Bebop: [], 'Jazz Fusion': [], Swing: ['Big Band'] },
  Blues: { 'Delta Blues': [], 'Chicago Blues': [], 'Electric Blues': [] },
  Classical: { Orchestral: [], Baroque: [], Opera: [], Romantic: [], 'Modern Classical': ['Contemporary Classical'], 'Classical Crossover': [] },
  Soundtrack: { 'Film Score': ['Score', 'Movie Soundtrack'], 'Video Game Music': [], Musicals: ['Show Tunes'] },
  Christian: { Gospel: [], Worship: ['Praise & Worship'], 'Contemporary Christian': [], 'Christian Rock': [] },
};

/**
 * `from` becomes the genre `to`; with `sub`, it is kept as that sub-genre of `to` too ("Deep House" →
 * "Electronic; Deep House"). A rule whose `from` is the sub-genre itself makes the sub-genre known.
 */
export interface GenreRule { from: string; to: string; sub?: string }
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
/** Saved rules from before sub-genres get them from the defaults once (getGenreSettings). */
const VERSION = 2;
const SINCE_KEY = 'genres.since';

export const defaultRules = (): GenreRule[] => [
  ...Object.entries(DEFAULT_GENRES).flatMap(([to, from]) => from.map((f) => ({ from: f, to }))),
  ...Object.entries(DEFAULT_SUBGENRES).flatMap(([to, subs]) =>
    Object.entries(subs).flatMap(([sub, from]) => [sub, ...from].map((f) => ({ from: f, to, sub })))),
];

/**
 * Rules saved before sub-genres existed sent every sub-genre to its genre ("Deep House" → "Electronic").
 * Where a saved rule matches a default one, it takes that rule's sub-genre, and the defaults' sub-genres it
 * doesn't have yet are added; rules an admin made themselves stay as they are.
 */
export function withSubgenres(rules: GenreRule[]): GenreRule[] {
  const defaults = new Map(defaultRules().filter((r) => r.sub).map((r) => [genreKey(r.from), r]));
  const out = rules.map((r) => {
    const d = defaults.get(genreKey(r.from));
    return !r.sub && d && genreKey(d.to) === genreKey(r.to) ? { ...r, sub: d.sub } : r;
  });
  const known = new Set(out.map((r) => genreKey(r.from)));
  const targets = new Set(out.map((r) => genreKey(r.to)));
  for (const d of defaults.values()) if (!known.has(genreKey(d.from)) && targets.has(genreKey(d.to))) out.push(d);
  return out;
}

/** How names are compared: "Hip-Hop", "hip hop" and "HipHop" are the same; "R&B" and "R and B" too. */
export const genreKey = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '');

export function getGenreSettings(db: Db): GenreSettings {
  const row = db.prepare('SELECT value FROM hub_settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  let v: Partial<GenreSettings> & { v?: number } = {};
  try {
    v = row ? JSON.parse(row.value) : {};
  } catch {
    /* start over */
  }
  const rules = v.rules && (v.v ?? 1) < VERSION ? withSubgenres(v.rules) : v.rules;
  return { auto: v.auto ?? true, rules: rules ?? defaultRules(), keep: v.keep ?? [], defaults: !v.rules };
}

/** Save what's given; `rules: null` goes back to the defaults. */
export function saveGenreSettings(db: Db, s: { auto?: boolean; rules?: GenreRule[] | null; keep?: string[] }): GenreSettings {
  const cur = getGenreSettings(db);
  const next = {
    auto: s.auto ?? cur.auto,
    rules: s.rules === null ? undefined : s.rules ?? (cur.defaults ? undefined : cur.rules),
    keep: s.keep ?? cur.keep,
    v: VERSION,
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

/** Each genre's sub-genres, sorted (for the settings and the review). */
export function subgenresOf(rules: GenreRule[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const to of genreTargets(rules)) out[to] = [];
  for (const r of rules) if (r.sub && !out[r.to].includes(r.sub)) out[r.to].push(r.sub);
  for (const subs of Object.values(out)) subs.sort((a, b) => a.localeCompare(b));
  return out;
}

export type GenreLookup = Map<string, { to: string; sub?: string }>;
export function genreLookup(rules: GenreRule[]): GenreLookup {
  const m: GenreLookup = new Map();
  for (const r of rules) m.set(genreKey(r.to), { to: r.to });
  // a sub-genre's own name is known even without a rule for it
  for (const r of rules) if (r.sub && !m.has(genreKey(r.sub))) m.set(genreKey(r.sub), { to: r.to, sub: r.sub });
  for (const r of rules) if (!m.has(genreKey(r.from))) m.set(genreKey(r.from), { to: r.to, sub: r.sub || undefined });
  return m;
}

/**
 * The tidy genre for a genre tag: the genre the first known name leads to, followed by every sub-genre of it
 * the tag names ("Deep House; Techno" → "Electronic; Deep House; Techno"). A tag with no known genre gives
 * `genre: null` and lists them as `unknown`. Tidying a tidy tag gives the same tag.
 */
export function normalizeGenre(raw: string, lookup: GenreLookup): { genre: string | null; unknown: string[] } {
  const text = raw.trim();
  if (!text) return { genre: null, unknown: [] };
  const whole = lookup.get(genreKey(text));
  if (whole) return { genre: whole.sub ? `${whole.to}; ${whole.sub}` : whole.to, unknown: [] };
  const parts = [...new Set(text.split(/\s*[;,/|\\]\s*/).map((p) => p.trim()).filter((p) => genreKey(p)))];
  const found = parts.map((p) => ({ p, hit: lookup.get(genreKey(p)) }));
  const first = found.find((f) => f.hit)?.hit;
  if (!first) return { genre: null, unknown: parts };
  const subs: string[] = [];
  for (const f of found) {
    const sub = f.hit?.sub;
    if (sub && genreKey(f.hit!.to) === genreKey(first.to) && !subs.some((x) => genreKey(x) === genreKey(sub))) subs.push(sub);
  }
  return { genre: [first.to, ...subs].join('; '), unknown: [] };
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
