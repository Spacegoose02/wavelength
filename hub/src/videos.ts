import { HttpError } from './http.ts';
import type { YtResult } from './ytdlp.ts';

/**
 * Music videos (the musicVideos feature): find a song's official video on YouTube with the Hub's yt-dlp, so
 * the app can show it in Now Playing (a youtube-nocookie embed). Only the video's id goes back; nothing is
 * downloaded. Answers are kept in memory for a month.
 */

export interface VideoMatch {
  id: string;
  title: string;
  channel: string;
  duration?: number;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const BAD = /\b(lyric|lyrics|audio|visuali[sz]er|cover|karaoke|instrumental|reaction|live|remix|sped up|slowed|8d|nightcore|tutorial|lesson|teaser|trailer|behind the scenes|fan made)\b/;
const GOOD = /\b(official (music )?video|official mv|music video)\b/;

/** Pure: the most likely official video among search results, or null. Exported for tests. */
export function pickVideo(results: YtResult[], artist: string, title: string, duration?: number): VideoMatch | null {
  const a = norm(artist), t = norm(title.replace(/\s*[([].*?[)\]]/g, ''));
  if (!t) return null;
  let best: { score: number; r: YtResult } | null = null;
  for (const r of results) {
    const rt = norm(r.title), ch = norm(r.channel);
    if (!rt.includes(t)) continue;
    let score = 0;
    if (GOOD.test(rt)) score += 4;
    if (ch.replace(/ ?vevo$/, '').replace(/ ?official$/, '') === a.replace(/ /g, '') || ch.replace(/ ?vevo$/, '') === a || ch === a) score += 4;
    else if (ch.endsWith('vevo')) score += 2;
    if (rt.includes(a)) score += 1;
    // the song's own words ("Live Forever") don't count against it
    if (BAD.test(rt.replace(t, ''))) score -= 6;
    if (duration && r.duration) {
      const extra = r.duration - duration;
      if (extra < -20 || extra > 240) score -= 3; // a different cut, or a short film
    }
    if (score >= 3 && (!best || score > best.score)) best = { score, r };
  }
  return best ? { id: best.r.id, title: best.r.title, channel: best.r.channel, duration: best.r.duration } : null;
}

export class Videos {
  private search: (q: string, n: number) => Promise<YtResult[]>;
  private cache = new Map<string, { at: number; v: VideoMatch | null }>();
  constructor(search: (q: string, n: number) => Promise<YtResult[]>) {
    this.search = search;
  }

  async find(artist: string, title: string, duration?: number): Promise<VideoMatch | null> {
    artist = artist.trim().slice(0, 200);
    title = title.trim().slice(0, 200);
    if (!artist || !title) throw new HttpError(400, 'Which song?');
    const key = `${norm(artist)}|${norm(title)}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 30 * 86_400_000) return hit.v;
    const v = pickVideo(await this.search(`${artist} ${title} official video`, 8), artist, title, duration);
    this.cache.set(key, { at: Date.now(), v });
    if (this.cache.size > 2000) this.cache.delete(this.cache.keys().next().value!);
    return v;
  }
}
