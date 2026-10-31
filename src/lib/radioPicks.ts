import type { NavidromeSource } from '../sources/navidrome';
import { radioBrowser } from '../sources/radio';
import { sourceFor } from '../sources/registry';
import type { Station } from '../sources/types';
import { enabledSources } from '../store/settings';

/**
 * Radio → Stations for you: the genres you have the most music in (Navidrome's genre counts, tidy genres
 * help), each turned into a radio-browser tag, and the most played stations with it.
 */

// tidy genre (hub/src/genres.ts) → radio-browser tag, where the plain name isn't what stations use
const TAGS: Record<string, string> = {
  'rap; hip-hop': 'hip hop', 'hip-hop': 'hip hop', 'r&b': 'rnb', 'rnb': 'rnb', 'electronic': 'electronic', 'dance': 'dance',
  'country': 'country', 'rock': 'rock', 'pop': 'pop', 'jazz': 'jazz', 'classical': 'classical', 'latin': 'latin',
  'metal': 'metal', 'soul': 'soul', 'reggae': 'reggae', 'blues': 'blues', 'folk': 'folk', 'indie': 'indie',
  'christian': 'christian', 'gospel': 'gospel', 'k-pop': 'kpop', 'soundtrack': 'soundtrack', 'alternative': 'alternative',
};

export function tagFor(genre: string): string {
  const g = genre.trim().toLowerCase();
  return TAGS[g] ?? TAGS[g.split(/\s*[;,/]\s*/)[0]] ?? g.split(/\s*[;,/]\s*/)[0];
}

/** Up to `genres` of your genres, with stations for each. Empty without a Navidrome server. */
export async function stationsForYou(genres = 3, perGenre = 6): Promise<{ genre: string; stations: Station[] }[]> {
  const nd = enabledSources().filter((s) => s.kind === 'navidrome').map((s) => sourceFor(s) as NavidromeSource);
  const counts = new Map<string, { genre: string; songs: number }>();
  for (const list of await Promise.all(nd.map((s) => s.getGenres().catch(() => [])))) {
    for (const g of list) {
      const tag = tagFor(g.name);
      if (!tag || /^(unknown|other|misc)/i.test(tag)) continue;
      const c = counts.get(tag) ?? { genre: g.name, songs: 0 };
      c.songs += g.songs;
      counts.set(tag, c);
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1].songs - a[1].songs).slice(0, genres);
  const out = await Promise.all(top.map(async ([tag, c]) => ({ genre: c.genre, stations: await radioBrowser.byTag(tag, perGenre).catch(() => []) })));
  return out.filter((g) => g.stations.length);
}

/** "Artist - Title" from a station's now-playing text, or undefined when it isn't a song (ads, station names). */
export function songFromTitle(text: string | undefined): { artist: string; title: string } | undefined {
  if (!text) return undefined;
  const m = /^\s*(.+?)\s+[-–—]\s+(.+?)\s*$/.exec(text);
  if (!m) return undefined;
  const [artist, title] = [m[1].trim(), m[2].replace(/\s*\[[^\]]*\]\s*$/, '').trim()];
  if (!artist || !title || /^(advert|commercial|station id|jingle)/i.test(artist)) return undefined;
  return { artist, title };
}
