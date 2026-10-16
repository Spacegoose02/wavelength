import { getJson, http, qs } from '../lib/http';
import { primaryArtist } from '../lib/match';
import { norm } from './registry';

export type Genre = 'all' | 'new' | 'hiphop' | 'pop' | 'country' | 'rock' | 'edm' | 'rnb';
export type ChartSource =
  | 'billboard' | 'apple' | 'deezer'
  | 'dzElectronic' | 'dzNewDance' | 'dzDanceHits'
  | 'rwRhythmic' | 'rwPop' | 'rwCountry' | 'rwAltRock' | 'rwBigRock'
  | 'ihHitsNow' | 'ihPopPulse' | 'ihRapRising' | 'ihBreakingCountry' | 'ihNewlyReleased' | 'ihFreshPicks' | 'ihEverydayGroove'
  | 'ihPopTop40' | 'ihCountryTop40' | 'ihHotAcTop40' | 'ihHipHopRnbTop40' | 'ihRockTop40' | 'ihDanceTop40' | 'ihRnbHits';

export const GENRES: { id: Genre; label: string }[] = [
  { id: 'all', label: 'Top overall' },
  { id: 'new', label: 'New releases' },
  { id: 'hiphop', label: 'Rap / Hip-Hop' },
  { id: 'pop', label: 'Pop' },
  { id: 'country', label: 'Country' },
  { id: 'rock', label: 'Rock' },
  { id: 'edm', label: 'EDM / Dance' },
  { id: 'rnb', label: 'R&B' },
];

export const CHART_LABELS: Record<ChartSource, string> = {
  billboard: 'Billboard',
  apple: 'Apple Music',
  deezer: 'Deezer',
  dzElectronic: 'Electronic Hits',
  dzNewDance: 'New Dance',
  dzDanceHits: 'Global Dance Hits',
  rwRhythmic: 'Rhythmic 100',
  rwPop: 'Pop / Top 40',
  rwCountry: 'Hot Country 100',
  rwAltRock: 'Alternative Rock 100',
  rwBigRock: 'Big Rock 100',
  ihHitsNow: 'Hits Now',
  ihPopPulse: 'Pop Pulse',
  ihRapRising: 'Rap Rising',
  ihBreakingCountry: 'Breaking Country',
  ihNewlyReleased: 'Newly Released',
  ihFreshPicks: 'Fresh Picks',
  ihEverydayGroove: 'Everyday Groove',
  ihPopTop40: 'Pop Top 40',
  ihCountryTop40: 'Country Top 40',
  ihHotAcTop40: 'Hot AC Top 40',
  ihHipHopRnbTop40: 'Hip-Hop & R&B Top 40',
  ihRockTop40: 'Rock Top 40',
  ihDanceTop40: 'Dance Top 40',
  ihRnbHits: 'R&B Hits',
};
/** 1–2 letter badge for the Mix view. */
export const CHART_SHORT: Record<ChartSource, string> = {
  billboard: 'B', apple: 'A', deezer: 'D', dzElectronic: 'EH', dzNewDance: 'ND', dzDanceHits: 'DH',
  rwRhythmic: 'R', rwPop: 'R', rwCountry: 'R', rwAltRock: 'R', rwBigRock: 'R',
  ihHitsNow: 'iH', ihPopPulse: 'iH', ihRapRising: 'iH', ihBreakingCountry: 'iH', ihNewlyReleased: 'iH', ihFreshPicks: 'iH', ihEverydayGroove: 'iH', ihPopTop40: 'iH', ihCountryTop40: 'iH', ihHotAcTop40: 'iH', ihHipHopRnbTop40: 'iH', ihRockTop40: 'iH', ihDanceTop40: 'iH', ihRnbHits: 'iH',
};
export const CHART_COLORS: Record<ChartSource, string> = {
  billboard: '#ff3b3b', apple: '#fa2d48', deezer: '#a238ff',
  dzElectronic: '#7a3cff', dzNewDance: '#c13cff', dzDanceHits: '#ff3cc7',
  rwRhythmic: '#1f9d55', rwPop: '#1f9d55', rwCountry: '#1f9d55', rwAltRock: '#1f9d55', rwBigRock: '#1f9d55',
  ihHitsNow: '#c6002b', ihPopPulse: '#c6002b', ihRapRising: '#c6002b', ihBreakingCountry: '#c6002b', ihNewlyReleased: '#c6002b', ihFreshPicks: '#c6002b', ihEverydayGroove: '#c6002b', ihPopTop40: '#c6002b', ihCountryTop40: '#c6002b', ihHotAcTop40: '#c6002b', ihHipHopRnbTop40: '#c6002b', ihRockTop40: '#c6002b', ihDanceTop40: '#c6002b', ihRnbHits: '#c6002b',
};

/** Deezer editors' dance/EDM playlists (kept current weekly by "Deezer Dance & EDM Editor"). */
const DEEZER_PLAYLISTS: Partial<Record<ChartSource, number>> = { dzElectronic: 1902101402, dzNewDance: 2249258602, dzDanceHits: 706093725 };

/** RadioWave Monitor (airplay + streaming + sales) chart pages. */
const RADIOWAVE: Partial<Record<ChartSource, number>> = { rwAltRock: 1, rwPop: 4, rwCountry: 6, rwBigRock: 8, rwRhythmic: 9 };

/** iHeartRadio editorial playlists (all owned by iHeart's editors account). */
const IHEART_OWNER = 312064750;
const IHEART: Partial<Record<ChartSource, string>> = {
  ihHitsNow: 'HUuUPpCJBxuZ69sRhCYj3x',
  ihPopPulse: '2puGTQCJX6QgL9wY4aAEAv',
  ihRapRising: 'WPoxcYDJRgwQgYoWZdEi1B',
  ihBreakingCountry: 'XCyZrCKmAdaVFHAbAbNm35',
  ihNewlyReleased: 'JwZCfk5kxHoV7u2yFQ7hQC',
  ihFreshPicks: 'CAXLyAeaixZp4GLvM4SnKD',
  ihEverydayGroove: '6xw6FLJD2TdyW2nWvGC3rf',
  ihPopTop40: 'GyZXToRd3rRqdcpVy8A6JW',
  ihCountryTop40: 'XGn5crADtwCekAuLgzjEa7',
  ihHotAcTop40: '3Vn11x1Rhprvgs35c5F5nT',
  ihHipHopRnbTop40: 'ViFEMBbVN6YdFceSzi234o',
  ihRockTop40: 'NJCTNpPvjHrjdW92uGvRBG',
  ihDanceTop40: 'MxZQcqRw33bJymbATrhHX5',
  ihRnbHits: 'PZaaHuWgAjne4L39rrtQx3',
};

export interface ChartEntry {
  rank: number;
  title: string;
  artist: string;
  cover?: string;
  deezerLink?: string;
  /** 30-second preview clip (Deezer) — looked up on demand for other charts. */
  preview?: string;
  /** Which charts it appears on (Mix view), with its rank on each. */
  sources: { source: ChartSource; rank: number }[];
}

export interface Chart {
  entries: ChartEntry[];
  /** When the source last updated this chart (human readable). */
  asOf?: string;
}

/*
 * Only charts verified to update (checked Oct 2026). Deezer's genre charts and several Billboard
 * genre pages are frozen; Shazam was dropped (its genre CSVs weren't wanted in the mix); Beatport/Traxsource block apps.
 * Every fetch is also checked for staleness.
 */
const BILLBOARD: Partial<Record<Genre, string>> = {
  all: 'hot-100',
  pop: 'pop-songs',
  country: 'country-songs',
  rock: 'hot-rock-songs',
};
const APPLE: Partial<Record<Genre, RegExp | null>> = {
  all: null,
  hiphop: /hip-hop|rap/i,
  pop: /^pop/i,
  country: /country/i,
  rock: /rock|alternative|metal/i,
  rnb: /r&b|soul/i,
};

const BY_GENRE: Record<Genre, ChartSource[]> = {
  all: ['billboard', 'apple', 'deezer', 'ihHitsNow', 'ihHotAcTop40'],
  new: ['ihNewlyReleased', 'ihFreshPicks', 'ihEverydayGroove'],
  hiphop: ['apple', 'rwRhythmic', 'ihHipHopRnbTop40', 'ihRapRising'],
  pop: ['billboard', 'apple', 'rwPop', 'ihPopTop40', 'ihPopPulse'],
  country: ['billboard', 'apple', 'rwCountry', 'ihCountryTop40', 'ihBreakingCountry'],
  rock: ['billboard', 'apple', 'rwAltRock', 'rwBigRock', 'ihRockTop40'],
  edm: ['ihDanceTop40', 'dzElectronic', 'dzNewDance', 'dzDanceHits'],
  rnb: ['ihRnbHits', 'apple', 'ihHipHopRnbTop40', 'rwRhythmic'],
};

/** The charts each genre uses out of the box (Settings → Discover charts can override them). */
export function defaultSourcesFor(g: Genre): ChartSource[] {
  return BY_GENRE[g];
}

/** The charts a genre is using: the user's pick from Settings if they made one, else the defaults. */
export function sourcesFor(g: Genre, custom?: Partial<Record<Genre, ChartSource[]>>): ChartSource[] {
  const pick = custom?.[g]?.filter((s) => chartsFor(g).includes(s));
  return pick?.length ? pick : BY_GENRE[g];
}

/**
 * Every chart that can serve a genre. Billboard and Apple only have some genres; the playlist
 * charts (Deezer editors, RadioWave, iHeartRadio) are one fixed list, so they fit under any genre.
 */
export function chartsFor(g: Genre): ChartSource[] {
  return (Object.keys(CHART_LABELS) as ChartSource[]).filter((s) =>
    s === 'billboard' ? !!BILLBOARD[g] : s === 'apple' ? g in APPLE : true,
  );
}

/** Who publishes a chart, for grouping in Settings. */
export function chartProvider(s: ChartSource): string {
  if (s.startsWith('ih')) return 'iHeartRadio';
  if (s.startsWith('rw')) return 'RadioWave';
  if (s.startsWith('dz')) return 'Deezer editors';
  return CHART_LABELS[s];
}

/** RadioWave publishes with a ~2-week lag, so it gets a longer window. */
const MAX_AGE_DAYS: Partial<Record<ChartSource, number>> = { ihRnbHits: 45, rwRhythmic: 35, rwPop: 35, rwCountry: 35, rwAltRock: 35, rwBigRock: 35 };
function assertFresh(source: ChartSource, when: Date | undefined) {
  if (!when || Number.isNaN(when.getTime())) throw new Error(`${CHART_LABELS[source]} didn't say when this chart was updated`);
  // Billboard dates charts a few days ahead ("week of"), so allow future dates
  if ((Date.now() - when.getTime()) / 86_400_000 > (MAX_AGE_DAYS[source] ?? 21)) {
    throw new Error(`${CHART_LABELS[source]} hasn't updated since ${when.toLocaleDateString()}`);
  }
}

/** "ALL MY EXES (W/ CHASE MATTHEW)" → "All My Exes (w/ Chase Matthew)" */
function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|[\s(\-/"'])([a-z])/g, (_, p, c) => p + c.toUpperCase()).replace(/\bW\//g, 'w/');
}

function decodeEntities(s: string) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function radiowave(source: ChartSource) {
  return async (): Promise<Chart> => {
    const res = await http(`https://www.radiowavemonitor.com/pub_charts/r100_${RADIOWAVE[source]}.aspx`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Wavelength' } });
    if (!res.ok) throw new Error(`RadioWave ${res.status}`);
    const html = await res.text();
    // strip tags: the page flattens to "...| #1 | TITLE | ARTIST | LABEL | #2 | ..."
    const cells = html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '|')
      .split('|')
      .map((s) => decodeEntities(s).trim())
      .filter(Boolean);
    const week = html.match(/WEEK OF (\d\d)\/(\d\d)\/(\d{4})/);
    const when = week ? new Date(Number(week[3]), Number(week[1]) - 1, Number(week[2])) : undefined;
    assertFresh(source, when);
    // the #1 "hero" block repeats above the list — start after the chart's explanation text
    const start = Math.max(0, cells.findIndex((c) => /calculated using/i.test(c)));
    const entries: ChartEntry[] = [];
    for (let i = start; i < cells.length - 2; i++) {
      const m = cells[i].match(/^#(\d{1,3})$/);
      if (!m || Number(m[1]) !== entries.length + 1) continue;
      const rank = Number(m[1]);
      entries.push({ rank, title: titleCase(cells[i + 1]), artist: titleCase(cells[i + 2]), sources: [{ source, rank }] });
    }
    if (!entries.length) throw new Error('RadioWave page layout changed — no rows found');
    return { entries, asOf: when ? `Week of ${when.toLocaleDateString()}` : undefined };
  };
}

function iheart(source: ChartSource) {
  return async (): Promise<Chart> => {
    const c = await getJson(`https://us.api.iheart.com/api/v3/collection/user/${IHEART_OWNER}/collection/${IHEART[source]}`);
    const updated = c.lastUpdated ? new Date(c.lastUpdated) : undefined;
    assertFresh(source, updated);
    const ids: number[] = (c.tracks ?? []).map((t: any) => t.trackId).filter(Boolean);
    const details: any[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const r = await getJson(`https://us.api.iheart.com/api/v3/catalog/tracks/${ids.slice(i, i + 50).join(',')}`);
      details.push(...(r.tracks ?? []));
    }
    const byId = new Map(details.map((t) => [t.id, t]));
    const entries = ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((t: any, i: number) => ({
        rank: i + 1,
        title: t.title,
        artist: t.artistName,
        cover: t.imageUrl?.replace(/^http:/, 'https:'),
        sources: [{ source, rank: i + 1 }],
      }));
    return { entries, asOf: `iHeartRadio editors · updated ${updated?.toLocaleDateString()}` };
  };
}

async function billboard(g: Genre): Promise<Chart> {
  const res = await http(`https://www.billboard.com/charts/${BILLBOARD[g]}/`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Wavelength' } });
  if (!res.ok) throw new Error(`Billboard ${res.status}`);
  const html = await res.text();
  const week = html.match(/Week of ([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1];
  assertFresh('billboard', week ? new Date(week) : undefined);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const entries: ChartEntry[] = [];
  doc.querySelectorAll('ul.o-chart-results-list-row').forEach((row) => {
    const h3 = row.querySelector('.a-chart-result-item-container h3#title-of-a-story') ?? row.querySelector('h3#title-of-a-story');
    const title = h3?.textContent?.trim();
    const artist = h3?.nextElementSibling?.textContent?.trim();
    const rank = Number(row.querySelector('.c-label')?.textContent?.trim()) || entries.length + 1;
    const img = row.querySelector('img.c-lazy-image__img');
    const cover = img?.getAttribute('data-lazy-src') ?? img?.getAttribute('src') ?? undefined;
    if (title && artist) entries.push({ rank, title, artist, cover: cover?.startsWith('http') && !cover.includes('lazyload') ? cover : undefined, sources: [{ source: 'billboard', rank }] });
  });
  if (!entries.length) throw new Error('Billboard page layout changed — no rows found');
  return { entries, asOf: `Week of ${week}` };
}

/** One Apple feed serves every genre (filtered below) — fetch it once, not once per genre. */
let appleFeed: { at: number; data: Promise<any> } | undefined;
function appleMostPlayed() {
  if (!appleFeed || Date.now() - appleFeed.at > 30 * 60_000) {
    const data = getJson('https://rss.applemarketingtools.com/api/v2/us/music/most-played/100/songs.json');
    appleFeed = { at: Date.now(), data };
    data.catch(() => (appleFeed = undefined));
  }
  return appleFeed.data;
}

async function apple(g: Genre): Promise<Chart> {
  const r = await appleMostPlayed();
  const updated = r.feed?.updated ? new Date(r.feed.updated) : undefined;
  assertFresh('apple', updated);
  const filter = APPLE[g] ?? null;
  const entries = (r.feed?.results ?? [])
    .filter((s: any) => !filter || (s.genres ?? []).some((x: any) => filter.test(x.name)))
    .map((s: any, i: number) => ({
      rank: i + 1,
      title: s.name,
      artist: s.artistName,
      cover: s.artworkUrl100?.replace('100x100', '300x300'),
      sources: [{ source: 'apple' as const, rank: i + 1 }],
    }));
  return { entries, asOf: updated?.toLocaleDateString() };
}

async function deezer(): Promise<Chart> {
  // Global chart (the genre charts are frozen on Deezer's side). No date in the API, but it's live.
  const r = await getJson(`https://api.deezer.com/chart/0/tracks?${qs({ limit: 100 })}`);
  const entries = (r.data ?? []).map((t: any, i: number) => ({
    rank: i + 1,
    title: t.title,
    artist: t.artist?.name ?? '',
    cover: t.album?.cover_medium,
    deezerLink: t.link,
    preview: t.preview || undefined,
    sources: [{ source: 'deezer' as const, rank: i + 1 }],
  }));
  return { entries, asOf: 'Global, live' };
}

/** A Deezer editors' playlist as a chart; fresh = an editor added tracks in the last 3 weeks. */
function deezerPlaylist(source: ChartSource) {
  return async (): Promise<Chart> => {
    const p = await getJson(`https://api.deezer.com/playlist/${DEEZER_PLAYLISTS[source]}`);
    const tracks: any[] = p.tracks?.data ?? [];
    const newest = Math.max(0, ...tracks.map((t) => t.time_add ?? 0));
    assertFresh(source, newest ? new Date(newest * 1000) : undefined);
    const entries = tracks.map((t, i) => ({
      rank: i + 1,
      title: t.title,
      artist: t.artist?.name ?? '',
      cover: t.album?.cover_medium,
      deezerLink: t.link,
      preview: t.preview || undefined,
      sources: [{ source, rank: i + 1 }],
    }));
    return { entries, asOf: `Deezer editors · updated ${new Date(newest * 1000).toLocaleDateString()}` };
  };
}

const FETCHERS: Record<ChartSource, (g: Genre) => Promise<Chart>> = {
  billboard,
  apple,
  deezer,
  dzElectronic: deezerPlaylist('dzElectronic'),
  dzNewDance: deezerPlaylist('dzNewDance'),
  dzDanceHits: deezerPlaylist('dzDanceHits'),
  rwRhythmic: radiowave('rwRhythmic'),
  rwPop: radiowave('rwPop'),
  rwCountry: radiowave('rwCountry'),
  rwAltRock: radiowave('rwAltRock'),
  rwBigRock: radiowave('rwBigRock'),
  ihHitsNow: iheart('ihHitsNow'),
  ihPopPulse: iheart('ihPopPulse'),
  ihRapRising: iheart('ihRapRising'),
  ihBreakingCountry: iheart('ihBreakingCountry'),
  ihNewlyReleased: iheart('ihNewlyReleased'),
  ihFreshPicks: iheart('ihFreshPicks'),
  ihEverydayGroove: iheart('ihEverydayGroove'),
  ihPopTop40: iheart('ihPopTop40'),
  ihCountryTop40: iheart('ihCountryTop40'),
  ihHotAcTop40: iheart('ihHotAcTop40'),
  ihHipHopRnbTop40: iheart('ihHipHopRnbTop40'),
  ihRockTop40: iheart('ihRockTop40'),
  ihDanceTop40: iheart('ihDanceTop40'),
  ihRnbHits: iheart('ihRnbHits'),
};

/** Look a song up on Deezer: link for deemix + 30s preview clip (strict match, then loose). */
export async function deezerLookup(e: { title: string; artist: string }): Promise<{ link?: string; preview?: string }> {
  const artist = primaryArtist(e.artist);
  const title = e.title.replace(/\(.*?\)|\[.*?\]/g, '').trim();
  for (const q of [`artist:"${artist}" track:"${title}"`, `${artist} ${title}`]) {
    const r = await getJson(`https://api.deezer.com/search?${qs({ q, limit: 5 })}`).catch(() => null);
    const hit = (r?.data ?? []).find((t: any) => norm(t.artist?.name ?? '').includes(norm(artist)) || norm(artist).includes(norm(t.artist?.name ?? '')));
    if (hit) return { link: hit.link, preview: hit.preview || undefined };
  }
  return {};
}
const cache = new Map<string, { at: number; data: Promise<Chart> }>();

export function getChart(source: ChartSource, g: Genre): Promise<Chart> {
  const key = `${source}:${g}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.data;
  // a slow chart service shouldn't stall the whole Mix — give each 20s
  const data = Promise.race([
    FETCHERS[source](g),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${CHART_LABELS[source]} timed out`)), 20_000)),
  ]);
  cache.set(key, { at: Date.now(), data });
  data.catch(() => cache.delete(key));
  return data;
}

/**
 * Aggregate every live chart for a genre: songs score higher the more charts they're on and
 * the higher they rank there (Borda-style), so cross-platform hits float to the top.
 */
export async function getMix(g: Genre, sources: ChartSource[] = sourcesFor(g)): Promise<{ entries: ChartEntry[]; failed: { source: ChartSource; reason: string }[]; used: ChartSource[] }> {
  const results = await Promise.allSettled(sources.map((s) => getChart(s, g)));
  const map = new Map<string, ChartEntry & { score: number }>();
  const failed: { source: ChartSource; reason: string }[] = [];
  const used: ChartSource[] = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') return failed.push({ source: sources[i], reason: String(r.reason?.message ?? r.reason) });
    if (!r.value.entries.length) return;
    used.push(sources[i]);
    const n = Math.min(r.value.entries.length, 100);
    for (const e of r.value.entries.slice(0, 100)) {
      const key = `${norm(primaryArtist(e.artist))}|${norm(e.title.replace(/\(.*?\)|\[.*?\]/g, ''))}`;
      const pts = 1 + (n - e.rank + 1) / n;
      const cur = map.get(key);
      if (cur) {
        cur.score += pts;
        cur.sources.push(...e.sources);
        cur.cover ??= e.cover;
        cur.deezerLink ??= e.deezerLink;
        cur.preview ??= e.preview;
      } else map.set(key, { ...e, sources: [...e.sources], score: pts });
    }
  });
  const entries = [...map.values()].sort((a, b) => b.score - a.score).slice(0, 100).map((e, i) => ({ ...e, rank: i + 1 }));
  return { entries, failed, used };
}
