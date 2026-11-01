import type { Db } from './db.ts';
import { normName, primaryArtist } from './radar.ts';

/**
 * Chart movement for Discover (docs/HUB.md "Discover"): ▲3, ▼2, NEW and "5 wks" next to each rank.
 *
 * The Hub's chart cache (discover.ts) keeps raw pages and doesn't read them, so the apps tell the Hub what a chart
 * says when someone opens it (`POST /api/discover/positions`). The Hub keeps one snapshot per chart per day, shared
 * by everyone in the house, and answers with each song's rank in the snapshot from about a week ago:
 *
 * - The baseline is the newest snapshot at least 7 days old. Until there is one (the first week), it's the oldest
 *   snapshot from before today, so movement shows from the second day on.
 * - **Weeks on chart** counts back from this week over the weeks that have a snapshot, and stops at the first one
 *   the song wasn't in. A week nobody opened the chart is skipped, not counted as a gap.
 *
 * Snapshots older than KEEP_DAYS are dropped as new ones come in.
 */

const DAY = 86_400_000;
export const KEEP_DAYS = 180;
const MAX_SONGS = 200;

export interface ChartSong {
  title: string;
  artist: string;
}

export interface ChartMove {
  /** rank in the baseline snapshot; null when the song wasn't on it (NEW, when there is a baseline) */
  prev: number | null;
  /** weeks in a row on this chart, counting this one */
  weeks: number;
}

export interface ChartMoves {
  /** the baseline's day (YYYY-MM-DD), or null on a chart's first day */
  since: string | null;
  moves: ChartMove[];
}

/** Same song, however each chart writes it: main artist plus title without "(feat. …)" or "[Remix]". */
export const chartSongKey = (s: ChartSong) => `${normName(primaryArtist(s.artist))}|${normName(s.title.replace(/\s*[([].*?[)\]]\s*/g, ' '))}`;

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
/** Weeks start on Monday (1970-01-01 was a Thursday). */
const weekOf = (day: string) => Math.floor((Date.parse(`${day}T00:00:00Z`) / DAY + 3) / 7);

/** Movement for `keys` (today's chart, in rank order) given earlier snapshots (any order). Pure, for tests. */
export function computeMoves(today: string, keys: string[], earlier: { day: string; keys: string[] }[]): ChartMoves {
  const before = earlier.filter((s) => s.day < today).sort((a, b) => (a.day < b.day ? 1 : -1));
  const weekAgo = dayOf(Date.parse(`${today}T00:00:00Z`) - 7 * DAY);
  const base = before.find((s) => s.day <= weekAgo) ?? before[before.length - 1];
  const baseRank = new Map((base?.keys ?? []).map((k, i) => [k, i + 1]));
  // per week, every key seen on any snapshot that week (this week includes today)
  const weeks = new Map<number, Set<string>>();
  for (const s of [{ day: today, keys }, ...before]) {
    const w = weekOf(s.day);
    const set = weeks.get(w) ?? new Set<string>();
    for (const k of s.keys) set.add(k);
    weeks.set(w, set);
  }
  const order = [...weeks.keys()].sort((a, b) => b - a);
  const moves = keys.map((k) => {
    let n = 0;
    for (const w of order) {
      if (!weeks.get(w)!.has(k)) break;
      n++;
    }
    return { prev: base ? baseRank.get(k) ?? null : null, weeks: n };
  });
  return { since: base?.day ?? null, moves };
}

export class ChartHistory {
  private db: Db;
  private now: () => number;
  constructor(db: Db, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }

  /** Keep today's snapshot of `chart` (replacing an earlier one from today) and say how each song moved. */
  record(chart: string, songs: ChartSong[]): ChartMoves {
    const today = dayOf(this.now());
    const keys = songs.slice(0, MAX_SONGS).map(chartSongKey);
    this.db.prepare('INSERT INTO chart_history (chart, day, keys) VALUES (?, ?, ?) ON CONFLICT (chart, day) DO UPDATE SET keys = excluded.keys')
      .run(chart, today, JSON.stringify(keys));
    this.db.prepare('DELETE FROM chart_history WHERE day < ?').run(dayOf(this.now() - KEEP_DAYS * DAY));
    const rows = this.db.prepare('SELECT day, keys FROM chart_history WHERE chart = ? AND day < ?').all(chart, today) as { day: string; keys: string }[];
    const earlier = rows.map((r) => {
      try {
        return { day: r.day, keys: JSON.parse(r.keys) as string[] };
      } catch {
        return { day: r.day, keys: [] };
      }
    });
    const out = computeMoves(today, keys, earlier);
    // a chart longer than MAX_SONGS: the rest get no movement
    for (let i = keys.length; i < songs.length; i++) out.moves.push({ prev: null, weeks: 0 });
    return out;
  }
}
