import type { Db } from './db.ts';

/**
 * Joined artist credits (docs/USERS-AND-ADMIN.md, "Joined artist credits"). Navidrome splits a single Artist or
 * Album artist tag into several artists only on its own separators: " / ", " feat. ", " feat ", " ft. ", " ft "
 * and "; " (resources/mappings.yaml in Navidrome). A semicolon with no space after it ("Lil Wayne;Drake"), which
 * many taggers and downloaders write, isn't one of them, so Navidrome lists "Lil Wayne;Drake" as one artist. Such a
 * credit means the first artist featuring the rest, so the Hub rewrites the Artist tag to "Lil Wayne feat. Drake"
 * and the Album artist to "Lil Wayne" (tidyCredit): for new downloads before Navidrome scans them
 * (routes/credits.ts), and for the rest of the library from Library care → Unmatched songs in the app.
 */

/** Any semicolon with any spacing around it, the full-width "；" too. */
const SEMI = /\s*[;；]\s*/;

/** A name for comparing: lower case, no accents or punctuation. */
const sameKey = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * A name of two or more words written twice in a row, "Lil Durk Lil Durk", as the name once. A one-word name
 * twice ("Duran Duran", "Talk Talk") is a real band name and stays.
 */
export function undouble(value: string): string {
  const w = value.trim().split(/\s+/);
  if (w.length < 4 || w.length % 2) return value;
  const half = w.length / 2;
  const a = w.slice(0, half).join(' ');
  return sameKey(a) === sameKey(w.slice(half).join(' ')) ? a : value;
}

/** Where the artists in a credit are cut apart to find the main one: semicolons and Navidrome's feat./ft. */
const PARTS = /\s*[;；]\s*|\s+(?:feat\.?|ft\.?|featuring)\s+/i;

/**
 * A joined credit as the main artist and the artists featured: "Lil Durk;Drake" → ["Lil Durk", "Drake"]. Each
 * artist once ("Lil Durk;Lil Durk" is just Lil Durk). Empty parts ("Drake;") go.
 */
function creditParts(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(PARTS)
    .map((p) => undouble(p.trim()))
    .filter((p) => {
      const k = sameKey(p);
      if (!p || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/**
 * A credit tidied so the song belongs to its main artist: the first artist named is the main one and the rest
 * are featured, as a semicolon-joined tag means ("Lil Durk;Drake" is Lil Durk featuring Drake).
 *
 * - **Artist** (`artist`, the default): "Lil Durk;Drake" → "Lil Durk feat. Drake", "A;B;C" → "A feat. B; C".
 *   Navidrome splits on " feat. " and "; ", so Lil Durk is the song's artist and Drake is listed as featured,
 *   and the song shows as "Bang Bang – Lil Durk feat. Drake".
 * - **Album artist** (`albumArtist`): just the main artist, "Lil Durk;Drake" → "Lil Durk", so the album is filed
 *   under Lil Durk and not under a joined "Lil Durk;Drake" artist.
 *
 * Either way the same artist named twice is once ("Lil Durk;Lil Durk", "Lil Durk Lil Durk" → "Lil Durk").
 * A value without a semicolon (or a doubled name) comes back as it is: commas, "&" and slashes are left, since
 * "Tyler, The Creator", "Simon & Garfunkel" and "AC/DC" are one artist.
 */
export function tidyCredit(value: string, tag: 'artist' | 'albumArtist' = 'artist'): string {
  if (!SEMI.test(value)) return undouble(value);
  const [main, ...rest] = creditParts(value);
  if (!main) return '';
  return tag === 'albumArtist' || !rest.length ? main : `${main} feat. ${rest.join('; ')}`;
}

/**
 * Separators that always join two artists in a credit: "feat.", "ft.", "featuring", "•", "·", ";" and " / ".
 * (" / " needs its spaces, so "AC/DC" stays one name.)
 */
const STRONG = /\s+(?:featuring|feat\.?|ft\.?)\s+|\s*\(\s*(?:featuring|feat\.?|ft\.?|with)\s+|\s*[•·;；]\s*|\s+\/\s+/i;
/** Separators that can join two artists but are also part of names ("Simon & Garfunkel", "Tyler, The Creator"). */
const WEAK = /\s*,\s*|\s+(?:&|and|x|×|with)\s+/i;
const bare = (s: string) => s.replace(/^[\s([]+|[\s)\]]+$/g, '').trim();
const keyOf = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The pieces of a credit split only on the separators that always mean two artists. */
export function strongParts(credit: string): string[] {
  return credit.split(STRONG).map(bare).filter(Boolean);
}

/**
 * The individual artists in a credit, for lists of artists (Search): "Lil Durk • J. Cole" → ["Lil Durk", "J. Cole"],
 * "DJ Khaled feat. Lil Baby & Lil Durk" → ["DJ Khaled", "Lil Baby", "Lil Durk"], "Calboy;Meek Mill;Lil Durk" → three.
 * A piece joined with "&", "and", "x", "with" or a comma is split only when one of its names is an artist on its own
 * somewhere in the library (`known`, from strongParts() of every credit), so "Simon & Garfunkel", "Earth, Wind &
 * Fire" and "Tyler, The Creator" stay one artist while "Lil Baby & Lil Durk" becomes two.
 */
export function creditNames(credit: string, known: (name: string) => boolean): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (n: string) => {
    const k = keyOf(n);
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(n);
    }
  };
  for (const piece of strongParts(credit).map(undouble)) {
    const parts = piece.split(WEAK).map(bare).filter(Boolean);
    if (parts.length > 1 && parts.some(known)) parts.forEach(add);
    else add(piece);
  }
  return out;
}

export interface CreditSettings {
  /** Tidy the credits of new downloads before Navidrome scans them. */
  auto: boolean;
}

const KEY = 'credits';
const SINCE_KEY = 'credits.since';

export function getCreditSettings(db: Db): CreditSettings {
  const row = db.prepare('SELECT value FROM hub_settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  try {
    const v = row ? JSON.parse(row.value) : {};
    return { auto: v.auto ?? true };
  } catch {
    return { auto: true };
  }
}

export function saveCreditSettings(db: Db, s: Partial<CreditSettings>): CreditSettings {
  const next = { ...getCreditSettings(db), ...s };
  db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(next));
  return next;
}

/** When new downloads' credits were last tidied (files changed after this are new). */
export function creditsSince(db: Db): number | null {
  const row = db.prepare('SELECT value FROM hub_settings WHERE key = ?').get(SINCE_KEY) as { value: string } | undefined;
  return row ? Number(row.value) : null;
}
export function setCreditsSince(db: Db, at: number) {
  db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(SINCE_KEY, String(at));
}
