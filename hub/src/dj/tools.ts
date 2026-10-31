import type { Db } from '../db.ts';
import { HttpError } from '../http.ts';
import { releaseNotForKids } from '../kidSafe.ts';
import { deezer } from '../radar.ts';
import type { User } from '../users.ts';
import type { DjTool } from './provider.ts';

/**
 * What the DJ can do. Two kinds of tool:
 *
 * - App tools run in the Wavelength app, because the music lives there: the app reaches each person's
 *   Navidrome / Plex with their own logins, plays the songs and keeps their playlists. The Hub hands these
 *   calls to the app and waits for the answers (routes/dj.ts, src/lib/dj.ts in the app).
 * - Hub tools run here: listening history (the plays table), Deezer lookups and download requests.
 *
 * Songs and albums the app found are named by short refs ("t3", "a1") that only mean something in that chat.
 * Keep the list in a fixed order: it is part of the cached prompt.
 */

export const APP_TOOLS: DjTool[] = [
  {
    name: 'search_library',
    description: 'Search the listener’s own music library (every server they use) for songs, albums and artists. Use short queries: an artist, an album or a song title. Returns refs to use with play and save_playlist.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for, e.g. "Fleetwood Mac" or "Dreams"' },
        limit: { type: 'integer', description: 'Most songs to return (default 20, at most 50)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'find_songs',
    description: 'Check which of these songs are in the library, by title and artist. Use it to turn recommendations into playable songs: pass many at once (up to 60). Returns refs for the ones found and lists the missing ones.',
    input_schema: {
      type: 'object',
      properties: {
        songs: {
          type: 'array',
          items: { type: 'object', properties: { title: { type: 'string' }, artist: { type: 'string' } }, required: ['title', 'artist'] },
        },
      },
      required: ['songs'],
    },
  },
  {
    name: 'library_albums',
    description: 'List the albums the library has by one artist. Compare with artist_discography to find albums that are missing.',
    input_schema: { type: 'object', properties: { artist: { type: 'string' } }, required: ['artist'] },
  },
  {
    name: 'now_playing',
    description: 'What is playing right now and what is coming up in the queue.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'play',
    description: 'Play songs or albums from refs. mode "now" replaces the queue and starts playing, "next" plays them after the current song, "end" adds them to the end of the queue.',
    input_schema: {
      type: 'object',
      properties: {
        refs: { type: 'array', items: { type: 'string' }, description: 'Song refs (t…) and album refs (a…), in order' },
        mode: { type: 'string', enum: ['now', 'next', 'end'] },
        shuffle: { type: 'boolean', description: 'Shuffle the songs first' },
      },
      required: ['refs', 'mode'],
    },
  },
  {
    name: 'save_playlist',
    description: 'Save songs as a new Wavelength playlist, which follows the listener to all their devices. Album refs add the whole album.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        refs: { type: 'array', items: { type: 'string' } },
      },
      required: ['name', 'refs'],
    },
  },
];

export const HUB_TOOLS: DjTool[] = [
  {
    name: 'listening_stats',
    description: 'The listener’s own listening: top artists and songs for a period, and the last songs they played.',
    input_schema: {
      type: 'object',
      properties: { period: { type: 'string', enum: ['week', 'month', 'year', 'all'] } },
      required: ['period'],
    },
  },
  {
    name: 'deezer_search',
    description: 'Search Deezer’s full catalog (not just the library), e.g. to find an album to download or check a song exists. Returns Deezer links.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' }, type: { type: 'string', enum: ['track', 'album', 'artist'] } },
      required: ['query', 'type'],
    },
  },
  {
    name: 'artist_discography',
    description: 'An artist’s albums, EPs and singles on Deezer, newest first, with Deezer links.',
    input_schema: { type: 'object', properties: { artist: { type: 'string' } }, required: ['artist'] },
  },
  {
    name: 'similar_artists',
    description: 'Artists related to this one (from Deezer). Good for recommendations.',
    input_schema: { type: 'object', properties: { artist: { type: 'string' } }, required: ['artist'] },
  },
  {
    name: 'artist_top_songs',
    description: 'An artist’s best-known songs (from Deezer). Pair with find_songs to play them from the library.',
    input_schema: { type: 'object', properties: { artist: { type: 'string' } }, required: ['artist'] },
  },
  {
    name: 'request_download',
    description: 'Ask the Hub to get an album or song that isn’t in the library, from its Deezer link. People with automatic downloads get it straight away; for everyone else it waits for an admin (or a parent) to approve. Only use this when the listener asked for it or agreed.',
    input_schema: {
      type: 'object',
      properties: {
        link: { type: 'string', description: 'Deezer link, e.g. https://www.deezer.com/album/302127' },
        kind: { type: 'string', enum: ['track', 'album'] },
        title: { type: 'string' },
        artist: { type: 'string' },
        note: { type: 'string', description: 'Why, shown to whoever approves it' },
      },
      required: ['link', 'kind', 'title', 'artist'],
    },
  },
];

export const ALL_TOOLS = [...APP_TOOLS, ...HUB_TOOLS];
export const isAppTool = (name: string) => APP_TOOLS.some((t) => t.name === name);
export const isHubTool = (name: string) => HUB_TOOLS.some((t) => t.name === name);

/** At most this many download requests per message the listener sends. */
export const MAX_REQUESTS_PER_TURN = 10;

const s = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

interface HubToolCtx {
  db: Db;
  user: User;
  /** Make a download request as this person (routes/requests.ts). */
  request(b: { link: string; kind: string; title: string; artist: string; note: string }): Promise<{ status: string }>;
  /** Download requests made so far this turn. */
  requestsThisTurn: number;
}

async function artistId(name: string): Promise<{ id: number; name: string } | null> {
  const r = await deezer(`/search/artist?${new URLSearchParams({ q: name, limit: '5' })}`);
  const list = (r?.data ?? []) as { id: number; name: string }[];
  const n = name.toLowerCase();
  return list.find((a) => a.name.toLowerCase() === n) ?? list[0] ?? null;
}

function since(period: string): number {
  const day = 24 * 3600_000;
  return period === 'week' ? Date.now() - 7 * day : period === 'month' ? Date.now() - 30 * day : period === 'year' ? Date.now() - 365 * day : 0;
}

/** Run one Hub tool. Returns what the model reads (JSON text). Throws HttpError for a tool error it should see. */
export async function runHubTool(name: string, input: Record<string, unknown>, c: HubToolCtx): Promise<unknown> {
  const kid = c.user.role === 'kid';
  switch (name) {
    case 'listening_stats': {
      const from = since(s(input.period, 10));
      const top = (col: string) =>
        c.db.prepare(`SELECT ${col} AS name, COUNT(*) AS plays FROM plays WHERE user_id = ? AND played_at >= ? AND ${col} != '' GROUP BY ${col} COLLATE NOCASE ORDER BY plays DESC LIMIT 15`)
          .all(c.user.id, from) as { name: string; plays: number }[];
      const songs = c.db.prepare(`SELECT title, artist, COUNT(*) AS plays FROM plays WHERE user_id = ? AND played_at >= ?
        GROUP BY title COLLATE NOCASE, artist COLLATE NOCASE ORDER BY plays DESC LIMIT 20`).all(c.user.id, from);
      const recent = c.db.prepare('SELECT title, artist, album, played_at FROM plays WHERE user_id = ? ORDER BY played_at DESC LIMIT 15').all(c.user.id) as { played_at: number }[];
      return { topArtists: top('artist'), topSongs: songs, recent: recent.map(({ played_at, ...r }) => ({ ...r, playedAt: new Date(played_at).toISOString().slice(0, 16) })) };
    }
    case 'deezer_search': {
      const type = ['track', 'album', 'artist'].includes(s(input.type, 10)) ? s(input.type, 10) : 'track';
      const q = s(input.query, 200);
      if (!q) throw new HttpError(400, 'Empty search');
      const r = await deezer(`/search/${type}?${new URLSearchParams({ q, limit: '10' })}`);
      const list = ((r?.data ?? []) as any[]).filter((x) => !kid || !x.explicit_lyrics);
      if (type === 'artist') return list.map((a) => ({ name: a.name, fans: a.nb_fan, link: a.link }));
      if (type === 'album') return list.map((a) => ({ title: a.title, artist: a.artist?.name, type: a.record_type, explicit: !!a.explicit_lyrics, link: a.link }));
      return list.map((t) => ({ title: t.title, artist: t.artist?.name, album: t.album?.title, explicit: !!t.explicit_lyrics, link: t.link }));
    }
    case 'artist_discography': {
      const a = await artistId(s(input.artist, 200));
      if (!a) return { error: 'Deezer doesn’t know that artist' };
      const r = await deezer(`/artist/${a.id}/albums?limit=100`);
      const albums = ((r?.data ?? []) as any[])
        .map((x) => ({ title: String(x.title ?? ''), type: x.record_type, released: x.release_date, explicit: !!x.explicit_lyrics, link: x.link ?? `https://www.deezer.com/album/${x.id}` }))
        .filter((x) => !kid || !releaseNotForKids(c.db, { artist: a.name, title: x.title, explicit: x.explicit }))
        .sort((x, y) => String(y.released ?? '').localeCompare(String(x.released ?? '')));
      return { artist: a.name, albums };
    }
    case 'similar_artists': {
      const a = await artistId(s(input.artist, 200));
      if (!a) return { error: 'Deezer doesn’t know that artist' };
      const r = await deezer(`/artist/${a.id}/related?limit=20`);
      return { artist: a.name, similar: ((r?.data ?? []) as any[]).map((x) => x.name) };
    }
    case 'artist_top_songs': {
      const a = await artistId(s(input.artist, 200));
      if (!a) return { error: 'Deezer doesn’t know that artist' };
      const r = await deezer(`/artist/${a.id}/top?limit=20`);
      return { artist: a.name, songs: ((r?.data ?? []) as any[]).filter((t) => !kid || !t.explicit_lyrics).map((t) => ({ title: t.title, album: t.album?.title })) };
    }
    case 'request_download': {
      if (c.requestsThisTurn >= MAX_REQUESTS_PER_TURN) throw new HttpError(429, `At most ${MAX_REQUESTS_PER_TURN} download requests per message`);
      const link = s(input.link, 500);
      if (!/^https:\/\/(www\.)?deezer\.com\/(?:[a-z]{2}\/)?(track|album)\/\d+/i.test(link)) throw new HttpError(400, 'Use a Deezer track or album link (from deezer_search or artist_discography)');
      c.requestsThisTurn++;
      const r = await c.request({ link, kind: s(input.kind, 10) === 'track' ? 'track' : 'album', title: s(input.title), artist: s(input.artist), note: s(input.note, 400) || 'Asked for through the AI DJ' });
      return { status: r.status, meaning: r.status === 'pending' ? 'Waiting for an admin or parent to approve it' : r.status === 'approved' ? 'Downloading now; it shows up in the library when done' : r.status };
    }
  }
  throw new HttpError(400, `Unknown tool ${name}`);
}
