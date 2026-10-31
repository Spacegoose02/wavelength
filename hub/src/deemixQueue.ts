/**
 * deemix's queue, made readable (docs/HUB.md "Following deemix downloads"). deemix's `/api/getQueue` answers
 * `{ queue: { <uuid>: item }, queueOrder: [uuid…], current? }`, where each item is an album, playlist or song
 * with `status` ('inQueue' | 'downloading' | 'completed' | 'withErrors' | 'failed'), `size` (songs),
 * `downloaded`, `failed`, `progress` (0–100) and `errors` (one per song that failed, with deemix's reason).
 *
 * deemix never says a download is stuck: a crashed or hung download just sits at "downloading" for ever, and
 * everything behind it at "inQueue". So `DeemixWatch` remembers when each item last moved, and calls the queue
 * stalled once nothing has moved for STALL_MS while something should be.
 */

export const STALL_MS = 15 * 60_000;

export type DeemixStatus = 'inQueue' | 'downloading' | 'completed' | 'withErrors' | 'failed';

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
  status: DeemixStatus | string;
  /** Songs in it, songs done, songs that failed. */
  size: number;
  downloaded: number;
  failed: number;
  /** 0–100. */
  progress: number;
  bitrate: number | null;
  /** Waiting items: 1 = starts next. */
  position: number | null;
  /** The songs that failed, with deemix's reason. */
  errors: DeemixSongError[];
  /** When it last moved (Hub clock), and whether it has stopped moving. */
  movedAt: number;
  stalled: boolean;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const text = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : '');

export const isActive = (st: string) => st === 'inQueue' || st === 'downloading';
export const isDone = (st: string) => st === 'completed' || st === 'withErrors';

/** deemix's reason for a failed song, in words where deemix only gives an id. */
export function songError(e: any): DeemixSongError {
  const errid = text(e?.errid, 100);
  const message = text(e?.message) || ERRIDS[errid] || errid || 'deemix couldn’t get it';
  return { title: text(e?.data?.title), artist: text(e?.data?.artist), message };
}

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

export class DeemixWatch {
  private seen = new Map<string, { sig: string; at: number }>();
  private now: () => number;
  /** Shorter in tests. */
  stallMs: number;

  constructor(now: () => number = Date.now, stallMs = STALL_MS) {
    this.now = now;
    this.stallMs = stallMs;
  }

  /** deemix's raw queue as a list in deemix's order, each item with its position, errors and whether it's stalled. */
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
      // anything deemix reports changing counts as moving
      const sig = `${status}|${downloaded}|${failed}|${Math.floor(progress)}`;
      const prev = this.seen.get(uuid);
      const movedAt = prev && prev.sig === sig ? prev.at : now;
      this.seen.set(uuid, { sig, at: movedAt });
      keep.add(uuid);
      items.push({
        uuid,
        type: text(i.type, 20),
        id: text(i.id, 30),
        title: text(i.title),
        artist: text(i.artist),
        cover: text(i.cover, 1000) || null,
        status,
        size: num(i.size),
        downloaded,
        failed,
        progress: status === 'completed' ? 100 : progress,
        bitrate: i.bitrate == null ? null : num(i.bitrate),
        position: status === 'inQueue' ? ++waiting : null,
        errors: (Array.isArray(i.errors) ? i.errors : []).slice(0, 100).map(songError),
        movedAt,
        stalled: false,
      });
    }
    for (const u of this.seen.keys()) if (!keep.has(u)) this.seen.delete(u);
    // stalled: the whole queue has had work to do, and nothing has moved, for STALL_MS
    const active = items.filter((i) => isActive(i.status));
    const lastMove = Math.max(0, ...active.map((i) => i.movedAt));
    if (active.length && now - lastMove > this.stallMs) {
      // the one in front is the one holding everything up
      const front = active.find((i) => i.status === 'downloading') ?? active[0];
      front.stalled = true;
    }
    return items;
  }
}

/** One line for a download, e.g. "Downloading · 5 of 12 songs" or "Waiting · 3rd in line". */
export function describe(i: DeemixItem): string {
  const songs = i.size > 1 ? ` · ${i.downloaded} of ${i.size} songs` : '';
  const failed = i.failed ? ` · ${i.failed} failed` : '';
  if (i.stalled) return `Stuck · no progress for ${Math.round((Date.now() - i.movedAt) / 60_000)} min${songs}`;
  switch (i.status) {
    case 'downloading': return `Downloading${songs || ` · ${Math.round(i.progress)}%`}${failed}`;
    case 'inQueue': return i.position === 1 ? 'Waiting · next up' : `Waiting · ${i.position} in line`;
    case 'completed': return 'Done';
    case 'withErrors': return `Done, but ${i.failed} of ${i.size} songs failed`;
    case 'failed': return i.errors[0] ? `Failed · ${i.errors[0].message}` : 'Failed';
    default: return i.status || 'Unknown';
  }
}

/** The Deezer link a queue item came from, to queue it again. */
export const itemLink = (i: Pick<DeemixItem, 'type' | 'id'>) => (i.type && /^\d+$/.test(i.id) ? `https://www.deezer.com/${i.type}/${i.id}` : null);
