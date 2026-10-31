import { useEffect } from 'react';
import { create } from 'zustand';
import { Deemix } from '../sources/deemix';
import type { HubCleanJob } from '../sources/hub';
import { useSettings } from '../store/settings';
import { hubClient } from '../store/hub';
import { hubRuns } from './hubServices';

/**
 * deemix's queue, readable (docs/USER-GUIDE.md "Following downloads"): each download with its place in line,
 * songs done and failed, why each song failed, and whether it has stopped moving, plus Cancel and Retry. When
 * the Hub runs deemix it reads the queue (and notices stalls even with no device watching); otherwise this
 * device reads deemix itself with the same rules (hub/src/deemixQueue.ts).
 */

export const STALL_MS = 15 * 60_000;

export interface DeemixSongError {
  title: string;
  artist: string;
  message: string;
}

export interface DeemixItem {
  uuid: string;
  type: string;
  id: string;
  title: string;
  artist: string;
  cover: string | null;
  /** 'inQueue' | 'downloading' | 'completed' | 'withErrors' | 'failed' */
  status: string;
  size: number;
  downloaded: number;
  failed: number;
  progress: number;
  bitrate: number | null;
  /** Waiting: 1 = starts next. */
  position: number | null;
  errors: DeemixSongError[];
  movedAt: number;
  stalled: boolean;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const text = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : '');

export const isActive = (st: string) => st === 'inQueue' || st === 'downloading';

const ERRIDS: Record<string, string> = {
  notOnDeezer: 'Not on Deezer any more',
  notEncoded: 'Deezer has no file for it yet',
  notAvailable: 'Not available in your Deezer country or account',
  notAvailableNoAlternative: 'Not available, and there is no other version',
  wrongBitrate: 'Not available at the chosen quality',
  wrongBitrateNoAlternative: 'Not available at the chosen quality, and there is no other version',
  no360RA: 'No 360 Reality Audio version',
  notLoggedIn: 'deemix isn’t logged in to Deezer',
  wrongLicense: 'Your Deezer account can’t stream at this quality',
  isNotAlbum: 'Deezer doesn’t treat this as an album',
};

function songError(e: any): DeemixSongError {
  const errid = text(e?.errid, 100);
  return { title: text(e?.data?.title), artist: text(e?.data?.artist), message: text(e?.message) || ERRIDS[errid] || errid || 'deemix couldn’t get it' };
}

/** Reads deemix's raw `/api/getQueue`, remembering when each download last moved. */
export class DeemixWatch {
  private seen = new Map<string, { sig: string; at: number }>();
  constructor(private now: () => number = Date.now, public stallMs = STALL_MS) {}

  read(raw: any): DeemixItem[] {
    const now = this.now();
    const q: Record<string, any> = raw?.queue && typeof raw.queue === 'object' ? raw.queue : {};
    const order: string[] = Array.isArray(raw?.queueOrder) ? raw.queueOrder.filter((u: unknown) => typeof u === 'string' && q[u as string]) : [];
    const uuids = [...order, ...Object.keys(q).filter((u) => !order.includes(u))];
    const keep = new Set<string>();
    let waiting = 0;
    const items: DeemixItem[] = [];
    for (const uuid of uuids) {
      const i = q[uuid];
      if (!i || typeof i.uuid !== 'string') continue;
      const status = text(i.status, 30);
      const downloaded = num(i.downloaded), failed = num(i.failed), progress = Math.max(0, Math.min(100, num(i.progress)));
      const sig = `${status}|${downloaded}|${failed}|${Math.floor(progress)}`;
      const prev = this.seen.get(uuid);
      const movedAt = prev && prev.sig === sig ? prev.at : now;
      this.seen.set(uuid, { sig, at: movedAt });
      keep.add(uuid);
      items.push({
        uuid, type: text(i.type, 20), id: text(i.id, 30), title: text(i.title), artist: text(i.artist), cover: text(i.cover, 1000) || null,
        status, size: num(i.size), downloaded, failed, progress: status === 'completed' ? 100 : progress,
        bitrate: i.bitrate == null ? null : num(i.bitrate),
        position: status === 'inQueue' ? ++waiting : null,
        errors: (Array.isArray(i.errors) ? i.errors : []).slice(0, 100).map(songError),
        movedAt, stalled: false,
      });
    }
    for (const u of this.seen.keys()) if (!keep.has(u)) this.seen.delete(u);
    const active = items.filter((i) => isActive(i.status));
    const lastMove = Math.max(0, ...active.map((i) => i.movedAt));
    if (active.length && now - lastMove > this.stallMs) (active.find((i) => i.status === 'downloading') ?? active[0]).stalled = true;
    return items;
  }
}

/** One line for a download, e.g. "Downloading · 5 of 12 songs" or "Waiting · 3 in line". */
export function describe(i: DeemixItem, now = Date.now()): string {
  const songs = i.size > 1 ? ` · ${i.downloaded} of ${i.size} songs` : '';
  const failed = i.failed ? ` · ${i.failed} failed` : '';
  if (i.stalled) return `Stuck · no progress for ${Math.max(1, Math.round((now - i.movedAt) / 60_000))} min${songs}`;
  switch (i.status) {
    case 'downloading': return `Downloading${songs || ` · ${Math.round(i.progress)}%`}${failed}`;
    case 'inQueue': return i.position === 1 ? 'Waiting · next up' : `Waiting · ${i.position} in line`;
    case 'completed': return 'Done';
    case 'withErrors': return `Done, but ${i.failed} of ${i.size} songs failed`;
    case 'failed': return i.errors[0] ? `Failed · ${i.errors[0].message}` : 'Failed';
    default: return i.status || 'Unknown';
  }
}

/** Counts for a one-line summary: "1 downloading · 4 waiting · 2 failed". */
export function summary(items: DeemixItem[], clean: HubCleanJob[] = []) {
  const n = (f: (i: DeemixItem) => boolean) => items.filter(f).length;
  return {
    downloading: n((i) => i.status === 'downloading'),
    waiting: n((i) => i.status === 'inQueue') + clean.filter((j) => j.state === 'waiting').length,
    failed: n((i) => i.status === 'failed' || i.status === 'withErrors'),
    done: n((i) => i.status === 'completed'),
    stuck: items.some((i) => i.stalled) || clean.some((j) => j.stuck),
  };
}

const itemLink = (i: DeemixItem) => (i.type && /^\d+$/.test(i.id) ? `https://www.deezer.com/${i.type}/${i.id}` : null);

// ---- the shared queue, read while anything on screen follows it ----

interface QueueState {
  items: DeemixItem[];
  /** Clean versions the Hub holds until deemix is free. */
  clean: HubCleanJob[];
  /** The queue has been read at least once (so "not in the queue" means something). */
  read: boolean;
  error?: string;
}

export const useDeemixQueue = create<QueueState>(() => ({ items: [], clean: [], read: false }));

const local = new DeemixWatch();
const direct = () => {
  const { url, arl } = useSettings.getState().deemix;
  return url ? new Deemix(url, arl) : null;
};

export async function refreshDeemix() {
  try {
    const hub = hubRuns('deemix') ? hubClient() : null;
    if (hub) {
      const { items, clean } = await hub.deemixProgress();
      useDeemixQueue.setState({ items, clean, read: true, error: undefined });
    } else {
      const d = direct();
      if (!d) return useDeemixQueue.setState({ items: [], clean: [], read: false, error: undefined });
      useDeemixQueue.setState({ items: local.read(await d.getQueue()), clean: [], read: true, error: undefined });
    }
  } catch (e) {
    useDeemixQueue.setState({ error: String((e as Error).message ?? e) });
  }
}

let followers = 0;
let timer: number | undefined;

/** Keep the queue fresh while the calling component is on screen. */
export function useFollowDeemix(on = true) {
  useEffect(() => {
    if (!on) return;
    if (!followers++) {
      void refreshDeemix();
      timer = window.setInterval(() => void refreshDeemix(), 4000);
    }
    return () => {
      if (!--followers) window.clearInterval(timer);
    };
  }, [on]);
}

/** Cancel a download (or take a finished one off the list). */
export async function cancelDownload(i: DeemixItem) {
  const hub = hubRuns('deemix') ? hubClient() : null;
  if (hub) await hub.deemixCancel(i.uuid);
  else await direct()?.removeFromQueue(i.uuid);
  await refreshDeemix();
}

/** Download it again (deemix won't take a link it still lists, so the old one comes off first). */
export async function retryDownload(i: DeemixItem) {
  const hub = hubRuns('deemix') ? hubClient() : null;
  if (hub) await hub.deemixRetry(i.uuid);
  else {
    const d = direct(), link = itemLink(i);
    if (!d || !link) throw new Error('deemix doesn’t have that download any more');
    await d.removeFromQueue(i.uuid);
    await d.addToQueue(link, i.bitrate ?? useSettings.getState().deemix.bitrate);
  }
  await refreshDeemix();
}

/** Clear finished and failed downloads off deemix's list. */
export async function clearFinished() {
  const hub = hubRuns('deemix') ? hubClient() : null;
  if (hub) await hub.deemixClearFinished();
  else await direct()?.removeFinished();
  await refreshDeemix();
}

/** Take a clean version out of the Hub's line before deemix gets it. */
export async function cancelClean(link: string) {
  await hubClient()?.deemixCleanCancel(link);
  await refreshDeemix();
}
