import { songKey, type ChartEntry } from '../sources/charts';
import { hubClient } from '../store/hub';

/**
 * Chart movement in Discover: ▲3, ▼2, NEW and "5 wks" beside each rank.
 *
 * Signed in to a Hub, the Hub keeps one snapshot of each chart per day for the whole house
 * (hub/src/chartHistory.ts, `POST /api/discover/positions`). Without one, this device keeps its own snapshots in
 * localStorage, the same way: compared with the newest snapshot at least a week old (or the oldest one there is in
 * the first week), and weeks in a row counted over the weeks that have a snapshot.
 */

export interface ChartMove {
  /** rank about a week ago; null = wasn't on it */
  prev: number | null;
  /** weeks in a row on this chart, this one included */
  weeks: number;
}

export interface ChartMoves {
  /** the day compared with (YYYY-MM-DD), or null on a chart's first day: then nothing is marked */
  since: string | null;
  moves: ChartMove[];
}

const DAY = 86_400_000;
const KEEP_DAYS = 120;
const STORE_KEY = 'tonearm.chartHistory';

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const weekOf = (day: string) => Math.floor((Date.parse(`${day}T00:00:00Z`) / DAY + 3) / 7);

/** Movement for `keys` (today's chart in rank order) given earlier snapshots. The Hub's computeMoves, for this device. */
export function computeMoves(today: string, keys: string[], earlier: { day: string; keys: string[] }[]): ChartMoves {
  const before = earlier.filter((s) => s.day < today).sort((a, b) => (a.day < b.day ? 1 : -1));
  const weekAgo = dayOf(Date.parse(`${today}T00:00:00Z`) - 7 * DAY);
  const base = before.find((s) => s.day <= weekAgo) ?? before[before.length - 1];
  const baseRank = new Map((base?.keys ?? []).map((k, i) => [k, i + 1]));
  const weeks = new Map<number, Set<string>>();
  for (const s of [{ day: today, keys }, ...before]) {
    const w = weekOf(s.day);
    const set = weeks.get(w) ?? new Set<string>();
    for (const k of s.keys) set.add(k);
    weeks.set(w, set);
  }
  const order = [...weeks.keys()].sort((a, b) => b - a);
  return {
    since: base?.day ?? null,
    moves: keys.map((k) => {
      let n = 0;
      for (const w of order) {
        if (!weeks.get(w)!.has(k)) break;
        n++;
      }
      return { prev: base ? baseRank.get(k) ?? null : null, weeks: n };
    }),
  };
}

type Local = Record<string, { day: string; keys: string[] }[]>;

function readLocal(): Local {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Local;
  } catch {
    return {};
  }
}

/** This device's own history (no Hub). */
export function localMoves(chart: string, entries: { title: string; artist: string }[], now = Date.now()): ChartMoves {
  const today = dayOf(now);
  const cutoff = dayOf(now - KEEP_DAYS * DAY);
  const keys = entries.slice(0, 200).map(songKey);
  const all = readLocal();
  const earlier = (all[chart] ?? []).filter((s) => s.day >= cutoff && s.day < today);
  const out = computeMoves(today, keys, earlier);
  all[chart] = [...earlier, { day: today, keys }];
  for (const k of Object.keys(all)) {
    all[k] = all[k].filter((s) => s.day >= cutoff);
    if (!all[k].length) delete all[k];
  }
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    // full: start over rather than stop working
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ [chart]: [{ day: today, keys }] }));
    } catch {
      /* non-essential */
    }
  }
  return out;
}

/** How each song on this chart moved: from the Hub when signed in to one, else from this device's history. */
export async function chartMoves(chart: string, entries: ChartEntry[]): Promise<ChartMoves> {
  const hub = hubClient();
  const songs = entries.slice(0, 300).map((e) => ({ title: e.title, artist: e.artist }));
  if (hub) {
    try {
      return await hub.discoverPositions(chart, songs);
    } catch {
      // an older Hub without chart history: keep it on this device
    }
  }
  return localMoves(chart, songs);
}

/** "▲3", "▼2", "NEW", or "" when it didn't move or there's nothing to compare with. */
export function moveLabel(rank: number, m: ChartMove | undefined, since: string | null): { text: string; kind: 'up' | 'down' | 'new' | 'same' } | null {
  if (!m || !since) return null;
  if (m.prev === null) return { text: 'NEW', kind: 'new' };
  const d = m.prev - rank;
  if (d > 0) return { text: `▲${d}`, kind: 'up' };
  if (d < 0) return { text: `▼${-d}`, kind: 'down' };
  return { text: '=', kind: 'same' };
}
