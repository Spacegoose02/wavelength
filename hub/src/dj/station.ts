import type { Db } from '../db.ts';
import { HttpError } from '../http.ts';
import type { Mix, Mixes, MixSong } from '../mixes.ts';
import { deezer, normName, primaryArtist } from '../radar.ts';
import type { User } from '../users.ts';
import { spoken, type DjAgent } from './agent.ts';
import { checkBudget } from './settings.ts';

/**
 * DJ mode (docs/AI-DJ.md "DJ mode"): a station that keeps going on its own, in segments the DJ introduces.
 * The app asks for one segment at a time, plays it, and asks for the next as it ends.
 *
 * Picking the songs costs nothing: they come from the person's Made for you mixes (mixes.ts) and Deezer's
 * chart. The AI only writes the spoken intro for each segment (one short call), and for "your ask" segments
 * ("something chill for cooking") it picks the songs too, from the songs the person plays most plus a few it
 * knows that fit. The app finds the songs in its own library and skips the ones it doesn't have.
 */

export const SEGMENTS = ['favourites', 'discover', 'throwbacks', 'tophits'] as const;
export type Segment = (typeof SEGMENTS)[number] | 'ask';

const TITLES: Record<Segment, string> = {
  favourites: 'Your favourites',
  discover: 'New for you',
  throwbacks: 'Throwbacks',
  tophits: 'Top hits',
  ask: 'Your request',
};

const ABOUT: Record<Segment, string> = {
  favourites: 'songs the listener has been playing a lot lately',
  discover: 'songs by artists related to the listener’s favourites that they haven’t played yet',
  throwbacks: 'songs the listener loved a while ago and hasn’t played for months',
  tophits: 'songs from the current worldwide charts',
  ask: '',
};

/** Songs per segment the app should end up with (it asks for more, as some won't be in the library). */
const SIZE = 12;

export interface StationSegment {
  kind: Segment;
  title: string;
  /** Songs to look for, in play order; more than SIZE, as some won't be found. */
  songs: MixSong[];
  /** What the DJ says before the first song; null when the app said not to talk. */
  intro: string | null;
}

type Song = { title: string; artist: string };
const key = (s: Song) => `${normName(primaryArtist(s.artist))}\u0000${normName(s.title)}`;

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Deezer's worldwide chart, cached an hour. */
export async function deezerChart(kid: boolean): Promise<MixSong[]> {
  const r = await deezer('/chart/0/tracks?limit=100');
  return ((r?.data ?? []) as any[])
    .filter((t) => !kid || !t.explicit_lyrics)
    .map((t) => ({
      title: String(t.title ?? ''),
      artist: String(t.artist?.name ?? ''),
      ...(t.album?.title && { album: String(t.album.title) }),
      ...(t.duration && { duration: Number(t.duration) }),
      ...(t.album?.cover_medium && { coverUrl: String(t.album.cover_medium) }),
    }))
    .filter((s) => s.title && s.artist);
}

export class Station {
  private db: Db;
  private dj: DjAgent;
  private mixes: Mixes;
  private chart: (kid: boolean) => Promise<MixSong[]>;
  private charts = new Map<string, { at: number; songs: MixSong[] }>();

  constructor(db: Db, dj: DjAgent, mixes: Mixes, chart: (kid: boolean) => Promise<MixSong[]> = deezerChart) {
    this.db = db;
    this.dj = dj;
    this.mixes = mixes;
    this.chart = chart;
  }

  /**
   * `{ kind?, ask?, recent?, previous?, name?, style?, talk? }` → the next segment. `kind` defaults to the one
   * after `previous` in the rotation; `ask` makes a request segment; `recent` (title + artist) are left out.
   */
  async next(user: User, b: unknown): Promise<StationSegment> {
    const o = (b ?? {}) as Record<string, unknown>;
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
    const ask = str(o.ask, 300);
    const after = SEGMENTS.indexOf(str(o.previous, 20) as (typeof SEGMENTS)[number]);
    let kind: Segment = ask ? 'ask' : (SEGMENTS as readonly string[]).includes(str(o.kind, 20)) ? (str(o.kind, 20) as Segment) : SEGMENTS[(after + 1) % SEGMENTS.length];
    const recent = new Set((Array.isArray(o.recent) ? o.recent : []).slice(0, 300).flatMap((s) => {
      const x = (s ?? {}) as Record<string, unknown>;
      return typeof x.title === 'string' ? [key({ title: x.title, artist: typeof x.artist === 'string' ? x.artist : '' })] : [];
    }));
    const talk = o.talk !== false;
    const name = str(o.name, 40);
    const style = ['chill', 'hype', 'trivia'].includes(str(o.style, 10)) ? str(o.style, 10) : 'chill';
    const kid = user.role === 'kid';
    if (talk || kind === 'ask') checkBudget(this.db, user.id);

    if (kind === 'ask') return this.request(user, ask, recent, { name, style, talk });

    // a segment with nothing new (no plays yet, everything heard) moves on to the next kind
    for (let tries = 0; tries < SEGMENTS.length; tries++) {
      const songs = (await this.pool(user, kind as (typeof SEGMENTS)[number], kid)).filter((s) => !recent.has(key(s)));
      if (songs.length >= 3) {
        const picked = kind === 'tophits' ? songs.slice(0, SIZE * 3) : shuffle(dedupe(songs)).slice(0, SIZE * 2);
        const intro = talk ? await this.intro(user, kind, picked.slice(0, 3), { name, style }) : null;
        return { kind, title: TITLES[kind], songs: picked, intro };
      }
      kind = SEGMENTS[(SEGMENTS.indexOf(kind as (typeof SEGMENTS)[number]) + 1) % SEGMENTS.length];
    }
    throw new HttpError(404, 'The DJ has nothing to play yet. Play some music first, so it learns what you like');
  }

  private async pool(user: User, kind: (typeof SEGMENTS)[number], kid: boolean): Promise<MixSong[]> {
    if (kind === 'tophits') {
      const k = kid ? 'kid' : 'all';
      const hit = this.charts.get(k);
      if (hit && Date.now() - hit.at < 3600_000) return hit.songs;
      const songs = await this.chart(kid).catch(() => []);
      if (songs.length) this.charts.set(k, { at: Date.now(), songs });
      return songs;
    }
    let { mixes, builtAt } = await this.mixes.get(user.id, kid).catch(() => ({ mixes: [] as Mix[], builtAt: Date.now() }));
    // someone new gets mixes once they've played a bit, not only tomorrow
    if (!mixes.length && Date.now() - builtAt > 3600_000) ({ mixes } = await this.mixes.get(user.id, kid, true).catch(() => ({ mixes: [] as Mix[] })));
    const of = (...kinds: Mix['kind'][]) => mixes.filter((m) => kinds.includes(m.kind)).flatMap((m) => m.songs);
    if (kind === 'favourites') return [...of('onRepeat'), ...of('daily').filter((s) => !s.because)];
    if (kind === 'discover') return [...of('discover'), ...of('daily').filter((s) => !!s.because)];
    return of('forgotten', 'capsule');
  }

  private system(user: User, style: string, name: string): string {
    return [
      'You are DJ Trash Panda, the host of a personal music station. What you write is read aloud by a text-to-speech voice.',
      style === 'hype' ? 'Be upbeat and energetic.' : style === 'trivia' ? 'You like a quick true fact, but only when you are sure of it.' : 'Be warm and relaxed.',
      'Never invent facts. No lists, emoji, stage directions or markdown in anything spoken.',
      name ? `The listener's name is ${name}.` : '',
      user.role === 'kid' ? 'The listener is a child: keep it friendly and simple, and only pick songs suitable for kids.' : '',
    ].filter(Boolean).join(' ');
  }

  private async intro(user: User, kind: Segment, first: Song[], o: { name: string; style: string }): Promise<string | null> {
    const hour = new Date().getHours();
    const ask = [
      `Introduce the next part of the show: "${TITLES[kind]}", ${ABOUT[kind]}.`,
      first.length ? `It starts with "${first[0].title}" by ${first[0].artist}.` : '',
      `It is ${hour < 5 ? 'late at night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}.`,
      'Write one or two short spoken sentences, under 35 words.',
    ].filter(Boolean).join(' ');
    try {
      return spoken(await this.dj.oneShot(user, this.system(user, o.style, o.name), ask, 1500)) || null;
    } catch (e) {
      // a limit used up stops the station; anything else just means no intro this time
      if (e instanceof HttpError && e.statusCode === 402) throw e;
      return null;
    }
  }

  /** "Something chill for cooking": the AI picks from what the person plays, plus a few it knows. */
  private async request(user: User, ask: string, recent: Set<string>, o: { name: string; style: string; talk: boolean }): Promise<StationSegment> {
    const rows = this.db.prepare(`SELECT title, artist, COUNT(*) AS plays FROM plays WHERE user_id = ? AND title != ''
      GROUP BY title COLLATE NOCASE, artist COLLATE NOCASE ORDER BY plays DESC LIMIT 250`).all(user.id) as { title: string; artist: string }[];
    const library = rows.filter((r) => !recent.has(key(r)));
    const prompt = [
      `The listener asked: "${ask}"`,
      library.length ? `Songs they play (title — artist), most played first:\n${library.map((r) => `${r.title} — ${r.artist}`).join('\n')}` : 'They have no listening history yet.',
      `Pick up to ${SIZE + 4} songs from that list that fit the request, in a good play order, then up to 10 other well-known songs that fit it too (they may not have those).`,
      'Answer with JSON only, no other text: {"title": "a short name for this part of the show", "intro": "one or two short spoken sentences introducing it, under 35 words", "songs": [{"title": "", "artist": ""}]}',
    ].join('\n\n');
    const raw = await this.dj.oneShot(user, this.system(user, o.style, o.name), prompt, 4000);
    const parsed = parseJson(raw);
    const songs = dedupe((Array.isArray(parsed?.songs) ? parsed.songs : []).flatMap((s: unknown) => {
      const x = (s ?? {}) as Record<string, unknown>;
      const title = typeof x.title === 'string' ? x.title.trim().slice(0, 200) : '';
      const artist = typeof x.artist === 'string' ? x.artist.trim().slice(0, 200) : '';
      return title && artist && !recent.has(key({ title, artist })) ? [{ title, artist }] : [];
    })).slice(0, 40);
    if (!songs.length) throw new HttpError(502, 'The DJ couldn’t find songs for that. Try asking another way');
    const title = typeof parsed?.title === 'string' && parsed.title.trim() ? parsed.title.trim().slice(0, 60) : TITLES.ask;
    const intro = o.talk && typeof parsed?.intro === 'string' ? spoken(parsed.intro) || null : null;
    return { kind: 'ask', title, songs, intro };
  }
}

function dedupe<T extends Song>(songs: T[]): T[] {
  const seen = new Set<string>();
  return songs.filter((s) => {
    const k = key(s);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The first JSON object in a model's answer (it may wrap it in a code fence or a sentence). */
export function parseJson(raw: string): Record<string, any> | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(raw.slice(start, end + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
