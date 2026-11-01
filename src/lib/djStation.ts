import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { HubStationKind, HubStationSegment } from '../sources/hub';
import type { Track } from '../sources/types';
import { hubClient } from '../store/hub';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { say, stationTalks } from './djVoice';
import { kidSafe } from './kids';
import { findInLibrary, pool } from './match';
import { findSong } from './mixes';
import { playlistTracks } from './myPlaylists';

/**
 * DJ mode (docs/AI-DJ.md "DJ mode"): a station DJ Trash Panda runs for you. The Hub picks each segment (your
 * favourites, new for you, throwbacks, top hits, or what you asked for) and writes a line to introduce it
 * (hub/src/dj/station.ts); this finds the songs in your library, plays them, reads the intro in the DJ's voice
 * (lib/djVoice.ts) and asks for the next segment as the last songs play. Playing something else stops it.
 */

export const SEGMENT_LABELS: Record<Exclude<HubStationKind, 'ask' | 'playlist'>, string> = {
  favourites: 'Your favourites',
  discover: 'New for you',
  throwbacks: 'Throwbacks',
  tophits: 'Top hits',
};

/** Songs per segment. */
const SIZE = 12;

interface StationState {
  on: boolean;
  kind: HubStationKind | null;
  title: string;
  /** What the DJ said last. */
  intro: string;
  busy: boolean;
  error: string;
  /** The panel is open (it folds into a small pill). */
  open: boolean;
  /** Read the intros aloud (kept). */
  talk: boolean;
  /** The panel is open to choose what to play; nothing plays until a choice. */
  picking: boolean;
}

export const useStation = create<StationState>()(
  persist(() => ({ on: false, kind: null, title: '', intro: '', busy: false, error: '', open: true, talk: true, picking: false }) as StationState, {
    name: 'tonearm.djStation',
    partialize: (s) => ({ talk: s.talk }),
  }),
);

const keyOf = (t: Track) => `${t.sourceId}:${t.id}`;
/** Tracks the station queued: playing anything else turns it off. */
const ours = new Set<string>();
/** Segment changes waiting for their first song: its key → the segment. */
const upcoming = new Map<string, HubStationSegment>();
/** Recently played (title + artist), so segments don't repeat songs. */
let recent: { title: string; artist: string }[] = [];
/** The playlist the station is built on, when started from one: every segment builds on it until you pick another. */
let anchor: { name: string; songs: { title: string; artist: string }[] } | null = null;
let topping = false;
let lastTry = 0;

async function fetchSegment(o: { kind?: HubStationKind; ask?: string; previous?: HubStationKind | null }): Promise<{ seg: HubStationSegment; tracks: Track[] }> {
  const hub = hubClient();
  if (!hub) throw new Error('DJ mode needs your Wavelength Hub');
  const v = useSettings.getState().djVoice;
  const seg = await hub.djStation({
    ...(o.kind && { kind: o.kind }),
    ...(o.ask && { ask: o.ask }),
    ...(!o.ask && !o.kind && anchor && { playlist: anchor }),
    ...(o.previous && o.previous !== 'ask' && { previous: o.previous }),
    recent: recent.slice(-150),
    name: v.name || undefined,
    style: v.style,
    talk: useStation.getState().talk,
  });
  const find = findInLibrary();
  const found = await pool(seg.songs, 4, (s) => findSong(s, find).catch(() => undefined));
  const seen = new Set<string>();
  const tracks = kidSafe(found.filter((t): t is Track => !!t && t.kind === 'track')).filter((t) => {
    const k = keyOf(t);
    if (seen.has(k) || ours.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, SIZE);
  return { seg, tracks };
}

const errText = (e: unknown) => String((e as Error)?.message ?? e);

/** Open the panel to pick what DJ mode plays first (the raccoon button). Nothing plays yet. */
export function pickStation() {
  useStation.setState({ picking: true, open: true, error: '' });
}

/** Start DJ mode, or jump to a segment / your request / one of your playlists (`playlist`: lib/myPlaylists.ts key). */
export async function startStation(o: { kind?: HubStationKind; ask?: string; playlist?: { key: string; name: string } } = {}) {
  const st = useStation.getState();
  if (st.busy) return;
  useStation.setState({ busy: true, error: '', open: true });
  try {
    if (o.playlist) {
      const songs = (await playlistTracks(o.playlist.key)).filter((t) => t.kind === 'track' && t.title).map((t) => ({ title: t.title, artist: t.artist }));
      if (!songs.length) throw new Error('That playlist is empty');
      anchor = { name: o.playlist.name, songs: songs.slice(0, 300) };
    } else if (o.kind || o.ask || !st.on) anchor = null;
    let { seg, tracks } = await fetchSegment({ ...o, previous: st.on ? st.kind : null });
    // a segment none of whose songs are here: try the next one (not for requests, which say so)
    for (let i = 0; !tracks.length && !o.ask && !o.kind && !o.playlist && i < 3; i++) ({ seg, tracks } = await fetchSegment({ previous: seg.kind }));
    if (!tracks.length) throw new Error(o.kind ? `None of the ${SEGMENT_LABELS[o.kind as keyof typeof SEGMENT_LABELS] ?? ''} songs the DJ picked are in your library. Try another segment` : 'None of those songs are in your library. Try asking for something else');
    ours.clear();
    upcoming.clear();
    lastTry = 0;
    tracks.forEach((t) => ours.add(keyOf(t)));
    stationTalks.add(keyOf(tracks[0]));
    useStation.setState({ on: true, picking: false, kind: seg.kind, title: seg.title, intro: seg.intro ?? '', busy: false });
    usePlayer.getState().playTracks(tracks);
    if (seg.intro && useStation.getState().talk) void say(seg.intro);
  } catch (e) {
    useStation.setState({ busy: false, error: errText(e) });
  }
}

export function stopStation() {
  anchor = null;
  ours.clear();
  upcoming.clear();
  useStation.setState({ on: false, picking: false, busy: false, kind: null, title: '', intro: '', error: '' });
}

/** Queue the next segment when the last songs of this one are playing. */
async function topUp() {
  if (topping || Date.now() - lastTry < 30_000) return;
  topping = true;
  lastTry = Date.now();
  useStation.setState({ busy: true });
  try {
    const queued = [...upcoming.values()];
    const last = queued.length ? queued[queued.length - 1].kind : useStation.getState().kind;
    const { seg, tracks } = await fetchSegment({ previous: last });
    if (!useStation.getState().on || !tracks.length) return;
    useStation.setState({ error: '' });
    tracks.forEach((t) => ours.add(keyOf(t)));
    upcoming.set(keyOf(tracks[0]), seg);
    stationTalks.add(keyOf(tracks[0]));
    usePlayer.getState().enqueue(tracks);
  } catch (e) {
    useStation.setState({ error: errText(e) });
  } finally {
    topping = false;
    useStation.setState({ busy: false });
  }
}

export function startDjStation() {
  let current: string | undefined;
  usePlayer.subscribe((p) => {
    const st = useStation.getState();
    if (!st.on) return;
    const t = p.queue[p.index];
    if (!t) return;
    const k = keyOf(t);
    if (k !== current) {
      current = k;
      // you played something else: the DJ steps aside
      if (!ours.has(k)) return stopStation();
      recent = [...recent.filter((r) => !(r.title === t.title && r.artist === t.artist)), { title: t.title, artist: t.artist }].slice(-300);
      const seg = upcoming.get(k);
      if (seg) {
        upcoming.delete(k);
        useStation.setState({ kind: seg.kind, title: seg.title, intro: seg.intro ?? '' });
        if (seg.intro && st.talk) void say(seg.intro);
      }
    }
    if (!st.busy && p.queue.length - p.index <= 2) void topUp();
  });
}
