import { creditParts } from './songIssues';

/**
 * The Edit song dialog's credit (views/SongEditor.tsx): a song's Artist tag as one main artist and a list of
 * featured artists, and back. It writes the same shape Library care's Split joined artists does (tidyCredit, #229):
 * "Lil Durk feat. Drake; Future". Navidrome splits that on " feat. " and "; ", so Lil Durk is the song's artist,
 * Drake and Future are featured, and the song shows as "Lil Durk feat. Drake; Future".
 */

export interface SongCredit {
  main: string;
  featured: string[];
}

/** A name for comparing: lower case, no accents or punctuation. */
const key = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** "(feat. X)", "[ft. X]", "(with X)" inside an Artist tag, as plain " feat. X" so creditParts can cut it. */
const BRACKET_FEAT = /\s*[([]\s*(?:featuring|feat\.?|ft\.?|with)\s+([^)\]]+)[)\]]/gi;

/**
 * An Artist tag as its main artist and the artists featured. Cut on what always joins two artists in a tag:
 * semicolons, " feat. " / " ft. " / " featuring ", " / " and a bracketed "(feat. X)". Commas, "&" and "x" are
 * left alone here, since "Tyler, The Creator" and "Simon & Garfunkel" are one artist; the dialog shows each
 * featured artist as a chip that can be fixed by hand.
 */
export function readCredit(artist: string): SongCredit {
  const flat = artist.replace(BRACKET_FEAT, ' feat. $1').replace(/\s+\/\s+/g, '; ');
  const [main = '', ...featured] = creditParts(flat);
  return { main, featured };
}

/**
 * The Artist tag for a main artist and the artists featured: "Lil Durk feat. Drake; Future". Each artist once,
 * the main artist never also featured, empty names dropped. No featured artists gives just the main artist.
 */
export function writeCredit(main: string, featured: string[]): string {
  const m = main.trim();
  const seen = new Set([key(m)]);
  const rest = featured.map((f) => f.trim()).filter((f) => {
    const k = key(f);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!m) return rest.join('; ');
  return rest.length ? `${m} feat. ${rest.join('; ')}` : m;
}

/** "(feat. X)" / "[ft. X]" / "(with X)" in a title, or a bare " feat. X" at its end. */
const TITLE_FEAT = /\s*[([]\s*(?:featuring|feat\.?|ft\.?|with)\s+([^)\]]+)[)\]]|\s+(?:featuring|feat\.|ft\.)\s+(.+)$/i;
/** What can join two names in a featured list: ";", ",", "&", "and", "x". */
const WEAK = /\s*[;；]\s*|\s*,\s*(?:(?:and|&)\s+)?|\s+(?:&|and|x|×)\s+/i;

/**
 * The names in a featured list like "GloRilla, Sexyy Red & Lil Wayne" → three artists. A name the library already
 * knows that has a comma or "&" in it ("Tyler, The Creator", `known`) is kept whole.
 */
export function splitNames(text: string, known: readonly string[] = []): string[] {
  let t = text.trim();
  const kept: string[] = [];
  // longest first, so "Earth, Wind & Fire" wins over "Earth"
  for (const name of [...known].filter((n) => WEAK.test(n)).sort((a, b) => b.length - a.length)) {
    const at = t.toLowerCase().indexOf(name.toLowerCase());
    if (at < 0) continue;
    kept.push(t.slice(at, at + name.length));
    t = `${t.slice(0, at)}\uE000${kept.length - 1}\uE000${t.slice(at + name.length)}`;
  }
  return t
    .split(WEAK)
    .map((p) => p.replace(/\uE000(\d+)\uE000/g, (_, i) => kept[Number(i)]).trim())
    .filter(Boolean);
}

/**
 * The featured artists written into a title ("Sticky (feat. GloRilla, Sexyy Red & Lil Wayne)"), and the title
 * without them ("Sticky"). null when the title names nobody featured.
 */
export function titleFeatures(title: string, known: readonly string[] = []): { title: string; featured: string[] } | null {
  const m = TITLE_FEAT.exec(title);
  if (!m) return null;
  const names = splitNames(m[1] ?? m[2] ?? '', known);
  if (!names.length) return null;
  const rest = (title.slice(0, m.index) + title.slice(m.index + m[0].length)).replace(/\s{2,}/g, ' ').trim();
  return rest ? { title: rest, featured: names } : null;
}

/** Featured artists not already in the list (or the main artist), in order. */
export function addFeatured(credit: SongCredit, names: string[]): SongCredit {
  const have = new Set([credit.main, ...credit.featured].map(key));
  const add = names.filter((n) => {
    const k = key(n);
    if (!k || have.has(k)) return false;
    have.add(k);
    return true;
  });
  return { ...credit, featured: [...credit.featured, ...add] };
}

/** Genres as written in one tag, "Hip-Hop; Trap" → two. Navidrome splits a genre tag on ";". */
export const splitGenres = (genre: string) => [...new Set(genre.split(/\s*[;；]\s*/).map((g) => g.trim()).filter(Boolean))];
export const joinGenres = (genres: string[]) => [...new Set(genres.map((g) => g.trim()).filter(Boolean))].join('; ');
