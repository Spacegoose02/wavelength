import { create } from 'zustand';
import type { Track } from '../sources/types';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { withoutDontPlay } from './dontPlay';
import { songRadio } from './songRadio';

/**
 * Smart Shuffle: shuffle, with a song you might like (from your library, like the ones in the queue) after every
 * few of your own. The shuffle button goes off → Shuffle → Smart Shuffle. Picks show a ✦ in the queue and can be
 * removed like any queued song; turning Smart Shuffle off takes the ones still to come back out.
 * (docs/USER-GUIDE.md "Smart Shuffle")
 */

/** One pick after this many of your own songs. */
export const EVERY = 3;
const SEEDS = 3;
const MAX_PICKS = 25;

const keyOf = (t: Pick<Track, 'sourceId' | 'id'>) => `${t.sourceId}:${t.id}`;

/** The songs Smart Shuffle added, so the queue can mark them and take them back out. */
export const useSmartPicks = create<{ keys: Set<string> }>()(() => ({ keys: new Set() }));
export const isSmartPick = (keys: Set<string>, t: Track) => keys.has(keyOf(t));

/** The queue with `picks` woven in after `index`: one after every `every` songs of the queue still to come. */
export function weave<T>(queue: T[], index: number, picks: T[], every = EVERY): T[] {
  const out = queue.slice(0, index + 1);
  const rest = queue.slice(index + 1);
  let p = 0;
  rest.forEach((t, i) => {
    out.push(t);
    if ((i + 1) % every === 0 && p < picks.length) out.push(picks[p++]);
  });
  return out;
}

/** Songs like a few from the queue, none of them in it already, shuffled. */
async function findPicks(queue: Track[], want: number): Promise<Track[]> {
  const songs = queue.filter((t) => t.kind === 'track' && t.artist);
  const seeds = [...songs].sort(() => Math.random() - 0.5).slice(0, SEEDS);
  const inQueue = new Set(queue.map(keyOf));
  const lists = await Promise.all(seeds.map((s) => songRadio({ artist: s.artist, title: s.title }).catch(() => [] as Track[])));
  const seen = new Set<string>();
  const picks = withoutDontPlay(lists.flat()).filter((t) => !inQueue.has(keyOf(t)) && !seen.has(keyOf(t)) && !!seen.add(keyOf(t)));
  return picks.sort(() => Math.random() - 0.5).slice(0, want);
}

let busyFor = -1;

async function addPicks() {
  const p = usePlayer.getState();
  if (!p.shuffle || !useSettings.getState().smartShuffle || p.queueBy !== 'you' || busyFor === p.queueId) return;
  const ahead = p.queue.length - p.index - 1;
  if (ahead < EVERY) return;
  const keys = useSmartPicks.getState().keys;
  if (p.queue.some((t) => keys.has(keyOf(t)))) return; // already woven into this queue
  busyFor = p.queueId;
  const picks = await findPicks(p.queue, Math.min(MAX_PICKS, Math.floor(ahead / EVERY)));
  const now = usePlayer.getState();
  if (!picks.length || now.queueId !== busyFor || !now.shuffle || !useSettings.getState().smartShuffle) return;
  useSmartPicks.setState({ keys: new Set(picks.map(keyOf)) });
  usePlayer.setState({ queue: weave(now.queue, now.index, picks) });
}

/** Takes the picks still to come back out of the queue. */
function removePicks() {
  const keys = useSmartPicks.getState().keys;
  if (!keys.size) return;
  const p = usePlayer.getState();
  const queue = p.queue.filter((t, i) => i <= p.index || !keys.has(keyOf(t)));
  useSmartPicks.setState({ keys: new Set() });
  if (queue.length !== p.queue.length) usePlayer.setState({ queue });
}

/** The shuffle button: off → Shuffle → Smart Shuffle → off. */
export function cycleShuffle() {
  const p = usePlayer.getState();
  const s = useSettings.getState();
  if (!p.shuffle) {
    s.setSmartShuffle(false);
    p.toggleShuffle();
  } else if (!s.smartShuffle) {
    s.setSmartShuffle(true);
    void addPicks();
  } else {
    s.setSmartShuffle(false);
    removePicks();
    p.toggleShuffle();
  }
}

export const shuffleLabel = (shuffle: boolean, smart: boolean) => (!shuffle ? 'Shuffle' : smart ? 'Smart Shuffle (on)' : 'Shuffle (on): press again for Smart Shuffle');

/** Weaves picks into each new queue you start while Smart Shuffle is on. Called once at start-up. */
export function enableSmartShuffle() {
  usePlayer.subscribe((s, prev) => {
    if (s.queueId !== prev.queueId) {
      useSmartPicks.setState({ keys: new Set() });
      void addPicks();
    } else if (prev.shuffle && !s.shuffle) removePicks();
  });
}
