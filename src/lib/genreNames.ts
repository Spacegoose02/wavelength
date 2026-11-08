/** Genre names, shared by the sources and lib/browse.ts (kept apart so the sources don't import the registry). */

/** How genres are compared: "Hip-Hop", "hip hop" and "HipHop" are one genre; "R&B" and "R and B" too. */
export const genreKey = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '');

/** A genre tag as a list: "Pop; Dance" is two genres. Servers that split tags already send a list. */
export function splitGenres(raw?: string | string[]): string[] {
  const list = Array.isArray(raw) ? raw : raw ? raw.split(/\s*;\s*/) : [];
  const seen = new Set<string>();
  return list.map((g) => g.trim()).filter((g) => {
    const k = genreKey(g);
    return k && !seen.has(k) && seen.add(k);
  });
}
