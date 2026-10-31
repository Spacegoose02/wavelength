import { mergeAlbums, norm, sourceFor } from '../sources/registry';
import type { HubClient, HubDjCall, HubDjTurn } from '../sources/hub';
import type { Album, SearchResults, Track } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { useLibrary } from '../store/library';
import { usePlayer } from '../store/player';
import { enabledSources } from '../store/settings';
import { albumNotForKids, isKid, trackNotForKids } from './kids';
import { findInLibrary, pool, primaryArtist } from './match';

/**
 * The AI DJ in the app (docs/AI-DJ.md). The chat itself runs on the Hub, which keeps the API key and pays the
 * provider; the Hub hands back the tool calls that need the music (search, play, save a playlist), and these
 * run here with this device's own sources, then go back to the Hub until the DJ answers.
 *
 * Songs and albums found are given short refs ("t4", "a2") for the DJ to use. They're kept per chat while
 * the app is open; after a restart the DJ just searches again.
 */

interface Refs {
  tracks: Map<string, Track>;
  albums: Map<string, Album>;
  n: number;
}
const refsByChat = new Map<number, Refs>();
const refsFor = (chatId: number): Refs => {
  let r = refsByChat.get(chatId);
  if (!r) refsByChat.set(chatId, (r = { tracks: new Map(), albums: new Map(), n: 0 }));
  return r;
};

const trackRef = (r: Refs, t: Track) => {
  for (const [k, v] of r.tracks) if (v.id === t.id && v.sourceId === t.sourceId) return k;
  const k = `t${++r.n}`;
  r.tracks.set(k, t);
  return k;
};
const albumRef = (r: Refs, a: Album) => {
  for (const [k, v] of r.albums) if (v.id === a.id && v.sourceId === a.sourceId) return k;
  const k = `a${++r.n}`;
  r.albums.set(k, a);
  return k;
};

const songOut = (r: Refs, t: Track) => ({ ref: trackRef(r, t), title: t.title, artist: t.artist, album: t.album, ...(t.duration && { seconds: Math.round(t.duration) }), ...(t.explicit === 'explicit' && { explicit: true }) });
const albumOut = (r: Refs, a: Album) => ({ ref: albumRef(r, a), title: a.title, artist: a.artist, ...(a.year && { year: a.year }), ...(a.trackCount && { songs: a.trackCount }) });

const kidTracks = (ts: Track[]) => (isKid() ? ts.filter((t) => !trackNotForKids(t)) : ts);
const kidAlbums = (as: Album[]) => (isKid() ? as.filter((a) => !albumNotForKids(a)) : as);

const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The songs behind a list of refs: albums opened into their songs. */
async function resolve(r: Refs, refs: unknown): Promise<{ tracks: Track[]; unknown: string[] }> {
  const tracks: Track[] = [];
  const unknown: string[] = [];
  for (const ref of (Array.isArray(refs) ? refs : []).slice(0, 500).map((x) => String(x))) {
    const t = r.tracks.get(ref);
    if (t) {
      tracks.push(t);
      continue;
    }
    const a = r.albums.get(ref);
    const cfg = a && enabledSources().find((s) => s.id === a.sourceId);
    const got = cfg ? await sourceFor(cfg).getAlbumTracks?.(a.id).catch(() => undefined) : undefined;
    if (got?.length) tracks.push(...got);
    else unknown.push(ref);
  }
  return { tracks: kidTracks(tracks), unknown };
}

function shuffled<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Run one tool the Hub handed over. Returns what the DJ reads. */
export async function runAppTool(chatId: number, call: HubDjCall): Promise<{ content: string; isError?: boolean }> {
  const r = refsFor(chatId);
  const input = (call.input && typeof call.input === 'object' ? call.input : {}) as Record<string, unknown>;
  const out = (v: unknown) => ({ content: JSON.stringify(v) });
  switch (call.name) {
    case 'search_library': {
      const q = text(input.query);
      if (q.length < 2) return { content: 'Search for at least two letters', isError: true };
      const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);
      const parts = (await Promise.all(enabledSources().map((cfg) => sourceFor(cfg).search?.(q).catch(() => ({})) ?? Promise.resolve({})))) as Partial<SearchResults>[];
      const tracks = kidTracks(parts.flatMap((p) => p.tracks ?? []).filter((t) => t.kind === 'track')).slice(0, limit);
      const albums = kidAlbums(mergeAlbums(parts.map((p) => p.albums ?? []))).slice(0, 15);
      const artists = [...new Set(parts.flatMap((p) => p.artists ?? []).map((a) => a.name))].slice(0, 10);
      return out({ songs: tracks.map((t) => songOut(r, t)), albums: albums.map((a) => albumOut(r, a)), artists });
    }
    case 'find_songs': {
      const wanted = (Array.isArray(input.songs) ? input.songs : []).slice(0, 60).map((x) => ({ title: text((x as { title?: unknown })?.title), artist: text((x as { artist?: unknown })?.artist) })).filter((x) => x.title);
      const find = findInLibrary();
      const hits = await pool(wanted, 4, (w) => find(w).catch(() => undefined));
      const found: ReturnType<typeof songOut>[] = [];
      const missing: { title: string; artist: string }[] = [];
      hits.forEach((t, i) => (t && !(isKid() && trackNotForKids(t)) ? found.push(songOut(r, t)) : missing.push(wanted[i])));
      return out({ found, missing });
    }
    case 'library_albums': {
      const artist = norm(primaryArtist(text(input.artist)));
      if (!artist) return { content: 'Which artist?', isError: true };
      const catalog = useCatalog.getState();
      if (!catalog.loaded) await catalog.load();
      const albums = kidAlbums(useCatalog.getState().albums.filter((a) => norm(primaryArtist(a.artist)) === artist || norm(a.artist) === artist));
      return out({ artist: text(input.artist), albums: albums.map((a) => albumOut(r, a)) });
    }
    case 'now_playing': {
      const p = usePlayer.getState();
      const cur = p.queue[p.index];
      return out({
        playing: cur ? songOut(r, cur) : null,
        paused: !p.playing,
        upNext: p.queue.slice(p.index + 1, p.index + 21).map((t) => songOut(r, t)),
        queueLength: p.queue.length,
      });
    }
    case 'play': {
      const { tracks, unknown } = await resolve(r, input.refs);
      if (!tracks.length) return { content: unknown.length ? `Unknown refs: ${unknown.join(', ')}. Search again.` : 'Nothing to play', isError: true };
      const list = input.shuffle === true ? shuffled(tracks) : tracks;
      const p = usePlayer.getState();
      const mode = input.mode === 'next' || input.mode === 'end' ? input.mode : 'now';
      if (mode === 'now') p.playTracks(list);
      else if (mode === 'next') p.playNext(list);
      else p.enqueue(list);
      return out({ ok: true, songs: list.length, mode, ...(unknown.length && { unknownRefs: unknown }) });
    }
    case 'save_playlist': {
      const name = text(input.name, 100) || 'DJ mix';
      const { tracks, unknown } = await resolve(r, input.refs);
      if (!tracks.length) return { content: unknown.length ? `Unknown refs: ${unknown.join(', ')}. Search again.` : 'No songs to save', isError: true };
      const id = useLibrary.getState().createPlaylist(name, tracks);
      lastPlaylist.set(chatId, id);
      return out({ ok: true, name, songs: tracks.length, ...(unknown.length && { unknownRefs: unknown }) });
    }
  }
  return { content: `This app doesn’t know the tool ${call.name}. It may need updating.`, isError: true };
}

/** The playlist the DJ saved last in each chat, so the chat can link to it. */
export const lastPlaylist = new Map<number, string>();

/**
 * Send a message and keep going until the DJ answers: runs every tool call the Hub hands back.
 * `onStep` shows progress (the DJ's words so far and what it is doing).
 */
export async function djTurn(hub: HubClient, chatId: number | null, message: string, onStep?: (t: HubDjTurn, doing?: string) => void): Promise<HubDjTurn> {
  return finish(hub, await hub.djSend(chatId, message), onStep);
}

/** Answer tool calls a chat is waiting on (also after reopening a chat that was left waiting). */
export async function finish(hub: HubClient, turn: HubDjTurn, onStep?: (t: HubDjTurn, doing?: string) => void): Promise<HubDjTurn> {
  for (let i = 0; turn.status === 'tools' && turn.calls?.length && i < 30; i++) {
    onStep?.(turn, describe(turn.calls));
    const calls = turn.calls;
    const results = await Promise.all(calls.map(async (c) => {
      try {
        return { id: c.id, ...(await runAppTool(turn.chat.id, c)) };
      } catch (e) {
        return { id: c.id, content: `Failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`, isError: true };
      }
    }));
    turn = await hub.djToolResults(turn.chat.id, results);
  }
  onStep?.(turn);
  return turn;
}

const LABELS: Record<string, string> = {
  search_library: 'Searching your library',
  find_songs: 'Checking which songs you have',
  library_albums: 'Looking at your albums',
  now_playing: 'Checking what’s playing',
  play: 'Queueing it up',
  save_playlist: 'Saving the playlist',
  listening_stats: 'Looking at what you play',
  deezer_search: 'Searching Deezer',
  artist_discography: 'Checking the discography',
  similar_artists: 'Finding similar artists',
  artist_top_songs: 'Finding their best-known songs',
  request_download: 'Requesting a download',
};
export const toolLabel = (name: string) => LABELS[name] ?? name;
export const describe = (calls: HubDjCall[]) => [...new Set(calls.map((c) => LABELS[c.name] ?? c.name))].join(' · ');
