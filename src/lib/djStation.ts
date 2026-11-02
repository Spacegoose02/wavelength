import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { HubMixSong, HubStationKind, HubStationSegment } from '../sources/hub';
import type { Track } from '../sources/types';
import { hubClient } from '../store/hub';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { say, setStationTalking, stationTalks, unlockDjAudio } from './djVoice';
import { kidSafe } from './kids';
import { findInLibrary, pool, primaryArtist } from './match';
import { songRadio } from './songRadio';
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
  /** Songs this segment wanted that aren't in your library, to get or request. */
  missing: HubMixSong[];
}

export const useStation = create<StationState>()(
  persist(() => ({ on: false, kind: null, title: '', intro: '', busy: false, error: '', open: true, talk: true, picking: false, missing: [] }) as StationState, {
    name: 'tonearm.djStation',
    partialize: (s) => ({ talk: s.talk }),
  }),
);

const keyOf = (t: Track) => `${t.sourceId}:${t.id}`;
const nameOf = (t: { title: string; artist: string }) => `${t.title}\u0000${t.artist}`.toLowerCase();
/** Songs the station played this time, for the last-resort refill. */
let playedTracks: Track[] = [];
/** Whether `t` is one of the station's songs (by key, or by title and artist when a source handed back a copy). */
const isOurs = (t: Track) => ours.has(keyOf(t)) || oursNames.has(nameOf(t));
const oursNames = new Set<string>();
const claim = (tracks: Track[]) => tracks.forEach((t) => { ours.add(keyOf(t)); oursNames.add(nameOf(t)); });
/** Tracks the station queued: playing anything else turns it off. */
const ours = new Set<string>();
/** Segment changes waiting for their first song: its key → the segment. */
const upcoming = new Map<string, { seg: HubStationSegment; missing: HubMixSong[] }>();
/** Recently played (title + artist), so segments don't repeat songs. */
let recent: { title: string; artist: string }[] = [];
/** The playlist the station is built on, when started from one: every segment builds on it until you pick another. */
let anchor: { name: string; songs: { title: string; artist: string }[] } | null = null;
let topping = false;
let lastTry = 0;

async function fetchSegment(o: { kind?: HubStationKind; ask?: string; previous?: HubStationKind | null }): Promise<{ seg: HubStationSegment; tracks: Track[]; missing: HubMixSong[] }> {
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
  // what the list has that you don't: shown in the panel to get or request
  const missing = seg.songs.filter((_, i) => !found[i]).slice(0, 60);
  const seen = new Set<string>();
  const tracks = kidSafe(found.filter((t): t is Track => !!t && t.kind === 'track')).filter((t) => {
    const k = keyOf(t);
    if (seen.has(k) || ours.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, SIZE);
  return { seg, tracks, missing };
}

const errText = (e: unknown) => String((e as Error)?.message ?? e);

/** Open the panel to pick what DJ mode plays first (the raccoon button). Nothing plays yet. */
export function pickStation() {
  unlockDjAudio();
  useStation.setState({ picking: true, open: true, error: '' });
}

/** Start DJ mode, or jump to a segment / your request / one of your playlists (`playlist`: lib/myPlaylists.ts key). */
export async function startStation(o: { kind?: HubStationKind; ask?: string; playlist?: { key: string; name: string }; mix?: boolean } = {}) {
  const st = useStation.getState();
  if (st.busy) return;
  // still inside the tap: let the intro that arrives in a few seconds play (phones), and look up the Hub's voice
  unlockDjAudio();
  useStation.setState({ busy: true, error: '', open: true });
  try {
    if (o.playlist) {
      const songs = (await playlistTracks(o.playlist.key)).filter((t) => t.kind === 'track' && t.title).map((t) => ({ title: t.title, artist: t.artist }));
      if (!songs.length) throw new Error('That playlist is empty');
      anchor = { name: o.playlist.name, songs: songs.slice(0, 300) };
    } else if (o.kind || o.ask || !st.on) anchor = null;
    // Mix it up: the rotation starts at a random segment (the Hub plays the one after `previous`), not always
    // at Your favourites, so it doesn't look the same as pressing that
    const rotation = Object.keys(SEGMENT_LABELS) as HubStationKind[];
    const previous = st.on ? st.kind : o.mix ? rotation[Math.floor(Math.random() * rotation.length)] : null;
    let { seg, tracks, missing } = await fetchSegment({ kind: o.kind, ask: o.ask, previous });
    // a segment none of whose songs are here: try the next one (not for requests, which say so)
    for (let i = 0; !tracks.length && !o.ask && !o.kind && !o.playlist && i < 3; i++) ({ seg, tracks, missing } = await fetchSegment({ previous: seg.kind }));
    if (!tracks.length) throw new Error(o.kind ? `None of the ${SEGMENT_LABELS[o.kind as keyof typeof SEGMENT_LABELS] ?? ''} songs the DJ picked are in your library. Try another segment` : 'None of those songs are in your library. Try asking for something else');
    ours.clear();
    oursNames.clear();
    playedTracks = [];
    upcoming.clear();
    lastTry = 0;
    claim(tracks);
    stationTalks.add(keyOf(tracks[0]));
    useStation.setState({ on: true, picking: false, kind: seg.kind, title: seg.title, intro: seg.intro ?? '', missing, busy: false });
    usePlayer.getState().playTracks(tracks);
    if (seg.intro && useStation.getState().talk) void say(seg.intro);
  } catch (e) {
    useStation.setState({ busy: false, error: errText(e) });
  }
}

export function stopStation() {
  anchor = null;
  ours.clear();
  oursNames.clear();
  upcoming.clear();
  useStation.setState({ on: false, picking: false, busy: false, kind: null, title: '', intro: '', error: '', missing: [] });
}

/**
 * Songs like the one playing, from your library (lib/songRadio.ts): what the station falls back on when no segment
 * has anything you have (Top hits you don't own, Throwbacks without the history, the AI DJ's allowance used up),
 * so it keeps going with similar music instead of stopping when the queue runs out.
 */
async function moreLikeThis(): Promise<{ seg: HubStationSegment; tracks: Track[] } | null> {
  const p = usePlayer.getState();
  const now = p.queue[p.index];
  if (!now || now.kind !== 'track' || !now.artist) return null;
  const played = new Set(recent.map((r) => `${r.title}\u0000${r.artist}`.toLowerCase()));
  const tracks = kidSafe(await songRadio({ artist: now.artist, title: now.title, track: now }).catch(() => [] as Track[]))
    .filter((t) => t.kind === 'track' && !ours.has(keyOf(t)) && !played.has(`${t.title}\u0000${t.artist}`.toLowerCase()))
    .slice(0, SIZE);
  if (!tracks.length) return null;
  return { seg: { kind: 'ask', title: `More like ${primaryArtist(now.artist)}`.slice(0, 60), songs: [], intro: null, spent: 0, limit: null }, tracks };
}

/**
 * Queue the next segment when the last songs of this one are playing. A segment with none of its songs in your
 * library moves on to the next one in the rotation (it used to ask for the same one again, so the station went
 * quiet when the queue ran out, often after Top hits); when none has anything, songs like the one playing.
 */
async function topUp() {
  if (topping || Date.now() - lastTry < 30_000) return;
  topping = true;
  lastTry = Date.now();
  useStation.setState({ busy: true });
  try {
    const queued = [...upcoming.values()];
    let last = queued.length ? queued[queued.length - 1].seg.kind : useStation.getState().kind;
    let next: { seg: HubStationSegment; tracks: Track[]; missing: HubMixSong[] } | null = null;
    let problem = '';
    for (let i = 0; i < 4 && !next; i++) {
      try {
        const r = await fetchSegment({ previous: last });
        if (r.tracks.length) next = r;
        else last = r.seg.kind;
      } catch (e) {
        // nothing to play, or a limit used up: no point asking for more segments
        problem = errText(e);
        break;
      }
      if (!useStation.getState().on) return;
    }
    if (!next) {
      const like = await moreLikeThis();
      if (like) next = { ...like, missing: [] };
    }
    // last resort, so the music never just stops: the station's own songs again, shuffled, not the last few
    if (!next && playedTracks.length > 8) {
      const again = [...playedTracks.slice(0, -6)].sort(() => Math.random() - 0.5).slice(0, SIZE);
      next = { seg: { kind: 'ask', title: 'Encore', songs: [], intro: null, spent: 0, limit: null }, tracks: again, missing: [] };
    }
    if (!useStation.getState().on) return;
    if (!next) {
      if (problem) useStation.setState({ error: problem });
      return;
    }
    useStation.setState({ error: '' });
    const { seg, tracks, missing } = next;
    claim(tracks);
    upcoming.set(keyOf(tracks[0]), { seg, missing });
    // a fallback without an intro: the talking DJ may introduce its first song like any other
    if (seg.intro) stationTalks.add(keyOf(tracks[0]));
    usePlayer.getState().enqueue(tracks);
  } finally {
    topping = false;
    useStation.setState({ busy: false });
  }
}

export function startDjStation() {
  // DJ mode talks between its songs too (lib/djVoice.ts), when "The DJ talks" is on
  setStationTalking(() => {
    const s = useStation.getState();
    return s.on && s.talk;
  });
  let current: string | undefined;
  usePlayer.subscribe((p) => {
    const st = useStation.getState();
    if (!st.on) return;
    const t = p.queue[p.index];
    if (!t) return;
    const k = keyOf(t);
    if (k !== current) {
      current = k;
      if (!isOurs(t)) {
        // you played something else (an album, a playlist): the DJ steps aside. A song you put in front of the
        // station's (Play next) just plays, and the station carries on after it.
        if (!p.queue.slice(p.index).some(isOurs)) return stopStation();
        return;
      }
      playedTracks = [...playedTracks.filter((x) => keyOf(x) !== k), t].slice(-200);
      recent = [...recent.filter((r) => !(r.title === t.title && r.artist === t.artist)), { title: t.title, artist: t.artist }].slice(-300);
      const next = upcoming.get(k);
      if (next) {
        const { seg } = next;
        upcoming.delete(k);
        useStation.setState({ kind: seg.kind, title: seg.title, intro: seg.intro ?? '', missing: next.missing });
        if (seg.intro && st.talk) void say(seg.intro);
      }
    }
    // ask for the next segment with three songs to go: picking songs and writing an intro can take a minute
    if (!st.busy && p.queue.length - p.index <= 3) void topUp();
  });
}
