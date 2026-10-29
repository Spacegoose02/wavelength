import { create } from 'zustand';
import { engine } from '../player/engine';
import type { HubParty, HubPartyRequest } from '../sources/hub';
import type { Track } from '../sources/types';
import { hubClient, useHub } from '../store/hub';
import { setPlayerIntercept, usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { isKid, trackNotForKids } from './kids';
import { fromHub } from './librarySync';
import { findInLibrary } from './match';

/**
 * Listen together (hub/src/routes/together.ts). The host's device plays as usual and reports its queue and
 * position; guests' devices play the same song at the same spot. A guest's own "Next" and "+ Queue" become
 * requests to the host (store/player.ts setPlayerIntercept), which its device applies.
 *
 * Songs travel with the Hub's id for their server (`hubSource`), so each guest plays them through their own
 * login for that server. A song from a server the guest doesn't have is looked up in their library by title.
 */

type PartyTrack = Track & { hubSource?: number };

interface TogetherState {
  party: HubParty | null;
  /** Something to tell the person: a refused request, a song a kid can't hear… */
  note: string;
}
export const useTogether = create<TogetherState>(() => ({ party: null, note: '' }));

let loop = 0;
let offset = 0; // Hub clock minus ours
let loadedKey = '';
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let lastPush = '';

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const note = (s: string) => useTogether.setState({ note: s });

/**
 * Ready to send: links to the song are dropped (Plex and Navidrome links carry the sender's login; guests
 * play it with their own), and the Hub's id for the server is added. Radio streams are public and stay.
 */
export function toParty(t: Track): PartyTrack {
  const cfg = useSettings.getState().sources.find((s) => s.id === t.sourceId);
  if (!cfg || t.kind === 'radio') return t;
  const { streamUrl: _s, coverUrl: _c, ...rest } = t;
  return { ...rest, ...(cfg.hubId !== undefined && { hubSource: cfg.hubId }) };
}

const resolved = new Map<string, Track | null>();
const keyOf = (t: PartyTrack) => `${t.hubSource ?? t.sourceId}:${t.id}`;

/** A song from the party, as this device can play it (null when it can't). */
async function fromParty(t: PartyTrack): Promise<Track | null> {
  if (t.kind === 'radio' || (t.streamUrl && t.hubSource === undefined)) return t;
  const sources = useSettings.getState().sources;
  const cfg = (t.hubSource !== undefined && sources.find((s) => s.hubId === t.hubSource)) || sources.find((s) => s.id === t.sourceId);
  if (cfg?.kind === 'navidrome') {
    const { hubSource: _h, ...rest } = t;
    return fromHub({ ...rest, sourceId: cfg.id });
  }
  // another kind of server, or one this device doesn't have: find the song in this device's library
  const k = keyOf(t);
  if (!resolved.has(k)) resolved.set(k, (await findInLibrary()(t).catch(() => undefined)) ?? null);
  return resolved.get(k) ?? null;
}

// ---- host ----

function pushState(now = false) {
  const p = useTogether.getState().party;
  if (!p?.isHost) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const { queue, index, position, duration, playing } = usePlayer.getState();
    const key = `${queue.length}:${queue[index]?.id}:${index}:${playing}:${Math.round(position / 10)}`;
    if (key === lastPush && !now) return;
    lastPush = key;
    void hubClient()?.partyState(p.id, { queue: queue.slice(0, 500).map(toParty), index, position: engine.el.currentTime || position, duration, playing }).catch(() => {
      lastPush = '';
    });
  }, now ? 0 : 400);
}

async function applyRequest(r: HubPartyRequest) {
  const p = usePlayer.getState();
  const tracks = r.tracks ? (await Promise.all(r.tracks.map(fromParty))).filter((t): t is Track => !!t) : [];
  switch (r.action) {
    case 'add':
      p.enqueue(tracks);
      note(`${r.from} added ${tracks.length === 1 ? tracks[0].title : `${tracks.length} songs`}`);
      break;
    case 'playNext':
      p.playNext(tracks);
      note(`${r.from} put ${tracks.length === 1 ? tracks[0].title : `${tracks.length} songs`} next`);
      break;
    case 'next': return p.next();
    case 'prev': return p.prev();
    case 'toggle': return p.toggle();
    case 'seek': return r.value !== undefined && p.seek(r.value);
    case 'jump': return r.index !== undefined && p.jump(r.index);
  }
}

// ---- guest ----

/** Play what the host is playing, where they are in it. */
export async function follow() {
  const party = useTogether.getState().party;
  if (!party || party.isHost) return;
  const s = party.state;
  const t = s.index >= 0 ? (s.queue[s.index] as PartyTrack | undefined) : undefined;
  if (!t) {
    if (!engine.el.paused) engine.pause();
    return;
  }
  const at = s.position + (s.playing ? (Date.now() + offset - s.at) / 1000 : 0);
  const key = `${s.index}:${keyOf(t)}`;
  if (key !== loadedKey) {
    loadedKey = key;
    if (isKid() && trackNotForKids(t)) {
      engine.pause();
      return note(`Skipping ${t.title}: it isn't for kids`);
    }
    const mine = await fromParty(t);
    if (useTogether.getState().party?.id !== party.id || loadedKey !== key) return;
    if (!mine) {
      engine.pause();
      return note(`Can't play ${t.title} here: it's on a server this device doesn't have`);
    }
    usePlayer.getState().playTracks([mine], 0, at);
    if (!s.playing) setTimeout(() => engine.pause(), 300);
    return;
  }
  if (s.playing && engine.el.paused && !usePlayer.getState().buffering) void engine.play();
  if (!s.playing && !engine.el.paused) engine.pause();
  if (s.playing && Math.abs(engine.el.currentTime - at) > 2.5 && !usePlayer.getState().buffering) engine.seek(at);
}

function guestIntercept(): Parameters<typeof setPlayerIntercept>[0] {
  return (op, arg) => {
    const p = useTogether.getState().party;
    if (!p || p.isHost) return false;
    const c = hubClient()!;
    const ask = (r: Parameters<typeof c.partyRequest>[1], done: string) =>
      c.partyRequest(p.id, r).then(() => note(done), (e) => note(String((e as Error).message ?? e)));
    switch (op) {
      case 'ended': return true; // the host moves on, and this device follows
      case 'enqueue':
      case 'playNext':
        if (!p.guestsAdd) return note('The host is choosing the songs'), true;
        void ask({ action: op === 'enqueue' ? 'add' : 'playNext', tracks: (arg as Track[]).map(toParty) }, `Sent to ${p.host}'s queue`);
        return true;
      default:
        if (!p.guestsControl) return note(`Only ${p.host} can skip or pause`), true;
        void ask(op === 'seek' ? { action: 'seek', value: arg as number } : { action: op }, '');
        return true;
    }
  };
}

// ---- both ----

async function waitLoop(id: string) {
  const me = ++loop;
  let version = 0;
  while (me === loop) {
    try {
      const { party, requests } = await hubClient()!.partyWait(id, version);
      if (me !== loop) return;
      if (!party) {
        const was = useTogether.getState().party;
        useTogether.setState({ party: null, note: was && !was.isHost ? `${was.host} ended the party` : '' });
        setPlayerIntercept(undefined);
        return;
      }
      offset = party.now - Date.now();
      version = party.version;
      useTogether.setState({ party });
      for (const r of requests) await applyRequest(r);
      if (requests.length) pushState(true);
      void follow();
    } catch {
      await sleep(5000);
    }
  }
}

function begin(p: HubParty) {
  loadedKey = '';
  lastPush = '';
  useTogether.setState({ party: p, note: '' });
  setPlayerIntercept(p.isHost ? undefined : guestIntercept());
  if (p.isHost) pushState(true);
  void waitLoop(p.id);
}

export async function startParty(opts: { name?: string; guestsAdd: boolean; guestsControl: boolean }) {
  begin(await hubClient()!.startParty(opts));
}

export async function joinParty(id: string) {
  begin(await hubClient()!.joinParty(id));
}

/** Host: what guests may do. */
export async function setRules(rules: { guestsAdd?: boolean; guestsControl?: boolean }) {
  const p = useTogether.getState().party;
  if (!p?.isHost) return;
  const next = await hubClient()!.setParty(p.id, rules);
  if (useTogether.getState().party?.id === p.id) useTogether.setState({ party: next });
}

export async function leaveParty() {
  const p = useTogether.getState().party;
  loop++;
  setPlayerIntercept(undefined);
  useTogether.setState({ party: null, note: '' });
  if (p) await hubClient()?.leaveParty(p.id).catch(() => {});
  if (p && !p.isHost) engine.pause();
}

let started = false;
export function startTogether() {
  if (started) return;
  started = true;
  usePlayer.subscribe((s, prev) => {
    if (s.playing !== prev.playing || s.index !== prev.index || s.queue !== prev.queue) pushState();
  });
  engine.on('seeked', () => pushState());
  // guests: keep in step; host: keep the position fresh
  setInterval(() => {
    const p = useTogether.getState().party;
    if (!p) return;
    if (p.isHost) {
      if (usePlayer.getState().playing) pushState();
    } else void follow();
  }, 5000);
  useHub.subscribe((s, prev) => {
    if (s.token !== prev.token && useTogether.getState().party) {
      loop++;
      setPlayerIntercept(undefined);
      useTogether.setState({ party: null, note: '' });
    }
  });
}
