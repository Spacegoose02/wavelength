import type { Db } from './db.ts';
import type { MixLookups } from './mixes.ts';
import { normName, primaryArtist } from './radar.ts';

/**
 * Discover's **For you** tab (`POST /api/discover/foryou`, docs/HUB.md "Discover"): which of a chart's songs are
 * close to what this person listens to, best first, each with a reason.
 *
 * - **You play them**: the song's artist (any of its credited artists) is in this person's plays from the last
 *   180 days. More plays, higher score.
 * - **You follow them**: a Release Radar follow.
 * - **Like an artist you play**: Deezer's related artists of their 10 most played artists (cached a day, the same
 *   lookups as Made for you mixes).
 *
 * Songs with none of these score 0 and the app leaves them out.
 */

const DAY = 86_400_000;
const TOP = 10;

export interface ForYouScore {
  score: number;
  /** "You play Drake", "You follow SZA", "Like Drake" */
  because?: string;
}

/** Every artist credited on a chart line: "Drake Featuring Future & Lil Baby" → Drake, Future, Lil Baby. */
export function creditedArtists(s: string): string[] {
  return s.split(/\s+(?:featuring|feat\.?|ft\.?|with|x|&|and|•)\s+|\s*[,;；]\s*|\s+\/\s+/i).map((a) => a.trim()).filter(Boolean);
}
const key = (a: string) => normName(primaryArtist(a));

export async function forYou(db: Db, userId: number, songs: { title: string; artist: string }[], look: MixLookups, now = Date.now()): Promise<{ basis: number; scores: ForYouScore[] }> {
  const plays = db.prepare('SELECT artist FROM plays WHERE user_id = ? AND played_at >= ?').all(userId, now - 180 * DAY) as { artist: string }[];
  const played = new Map<string, { name: string; n: number }>();
  for (const p of plays) {
    const k = key(p.artist);
    if (!k) continue;
    const a = played.get(k);
    if (a) a.n++;
    else played.set(k, { name: primaryArtist(p.artist), n: 1 });
  }
  const follows = new Map((db.prepare('SELECT name FROM follows WHERE user_id = ?').all(userId) as { name: string }[]).map((f) => [key(f.name), f.name]));

  const top = [...played.values()].sort((a, b) => b.n - a.n).slice(0, TOP);
  const like = new Map<string, { name: string; weight: number }>();
  const related = await Promise.all(top.map((a) => look.related(a.name).catch(() => [] as string[])));
  top.forEach((a, i) => {
    // the more they play the source artist, the more a related one counts; the first related ones count most
    related[i].forEach((r, j) => {
      const k = key(r);
      const w = (1 + Math.log2(1 + a.n) / 4) * (1 - j / 24);
      if (k && (like.get(k)?.weight ?? 0) < w) like.set(k, { name: a.name, weight: w });
    });
  });

  const scores = songs.map((s): ForYouScore => {
    let best: ForYouScore = { score: 0 };
    for (const name of creditedArtists(s.artist)) {
      const k = key(name);
      if (!k) continue;
      const p = played.get(k);
      const options: ForYouScore[] = [
        p ? { score: 3 + Math.log2(1 + p.n), because: `You play ${p.name}` } : { score: 0 },
        follows.has(k) ? { score: 3.5, because: `You follow ${follows.get(k)}` } : { score: 0 },
        like.has(k) ? { score: 1.5 * like.get(k)!.weight, because: `Like ${like.get(k)!.name}` } : { score: 0 },
      ];
      for (const o of options) if (o.score > best.score) best = o;
    }
    return best.score > 0 ? { score: Math.round(best.score * 100) / 100, because: best.because } : { score: 0 };
  });
  return { basis: plays.length, scores };
}
