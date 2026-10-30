import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { HubRating } from '../sources/hub';
import { getDeezerAlbum } from '../sources/deemix';
import type { Track } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { useSettings } from '../store/settings';
import { hubClient } from '../store/hub';
import { deemixClient, hubRuns } from './hubServices';
import { mustRequest, requestMusic } from './inbox';
import { useRatings } from './kids';
import { versionKey, versionOf } from './versions';

/**
 * Inbox → Clean versions (docs/USERS-AND-ADMIN.md §6.5): every explicit album the library check found a clean
 * version of on Deezer, to preview and download one by one or all at once. Downloads go to deemix (or become a
 * request for people without Autodownload), like the album page's "Get clean version" button.
 */

export interface CleanOffer {
  artist: string;
  album: string;
  link: string;
  /** Deezer album id of the clean version. */
  deezerId?: number;
  /** The library already has a clean copy. */
  have: boolean;
}

const idOf = (link: string) => Number(link.match(/album\/(\d+)/)?.[1]) || undefined;

/** Cover art straight from Deezer: /album/{id}/image redirects to the picture. */
export const offerCover = (o: CleanOffer) => (o.deezerId ? `https://api.deezer.com/album/${o.deezerId}/image?size=medium` : undefined);

/** The explicit albums with a clean version on Deezer, by artist. */
export function cleanOffers(ratings: HubRating[], albums = useCatalog.getState().albums): CleanOffer[] {
  // version keys the library already holds a clean copy of
  const clean = new Set<string>();
  for (const a of albums) for (const r of a.refs ?? [a]) if (versionOf(r) === 'clean') clean.add(versionKey(r));
  const seen = new Set<string>();
  const out: CleanOffer[] = [];
  for (const r of ratings) {
    if (r.kind !== 'album' || r.rating !== 'explicit' || !r.cleanLink || seen.has(r.cleanLink)) continue;
    seen.add(r.cleanLink);
    out.push({ artist: r.artist, album: r.album, link: r.cleanLink, deezerId: idOf(r.cleanLink), have: clean.has(versionKey({ artist: r.artist, title: r.album })) });
  }
  return out.sort((a, b) => a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album));
}

export const useCleanOffers = () => {
  const ratings = useRatings((s) => s.ratings);
  const albums = useCatalog((s) => s.albums);
  return cleanOffers(ratings, albums);
};

type Sent = { at: number; via: 'deemix' | 'request' };

interface CleanState {
  /** Clean versions sent to deemix or requested, by link. Kept on the device so they aren't sent twice. */
  sent: Record<string, Sent>;
  /** Sending right now, or why sending failed, by link. Not saved. */
  sending: Record<string, string | undefined>;
  /** deemix's queue, by Deezer album id. */
  queue: Record<number, { status: string; progress: number }>;
  /** Clean versions the Hub holds until deemix is free, or couldn't queue, by link. */
  hub: Record<string, { state: string; error?: string }>;
}

export const useCleanVersions = create<CleanState>()(
  persist(() => ({ sent: {}, sending: {}, queue: {}, hub: {} } as CleanState), { name: 'tonearm.cleanVersions', partialize: (s) => ({ sent: s.sent }) }),
);

/** What to show for one album. */
export function offerStatus(o: CleanOffer, s: CleanState): { label: string; kind: 'have' | 'busy' | 'queued' | 'done' | 'error' | 'new' } {
  if (o.have) return { label: 'In your library', kind: 'have' };
  const sending = s.sending[o.link];
  if (sending === '…') return { label: 'Sending…', kind: 'busy' };
  if (sending) return { label: sending, kind: 'error' };
  const held = s.hub[o.link];
  if (held?.state === 'waiting') return { label: 'Waiting for deemix', kind: 'queued' };
  if (held?.state === 'failed') return { label: held.error ?? 'Couldn’t queue it', kind: 'error' };
  const q = o.deezerId ? s.queue[o.deezerId] : undefined;
  if (q) {
    if (q.status === 'completed') return { label: 'Downloaded', kind: 'done' };
    if (q.status === 'failed') return { label: 'Download failed', kind: 'error' };
    if (q.status === 'downloading') return { label: `Downloading ${Math.round(q.progress)}%`, kind: 'busy' };
    return { label: 'Queued', kind: 'queued' };
  }
  const sent = s.sent[o.link];
  if (sent) return { label: sent.via === 'request' ? 'Requested' : 'Sent to deemix', kind: 'queued' };
  return { label: '', kind: 'new' };
}

/** Not in the library, not sent yet (or it failed): what "Download all" picks up. */
export const wanted = (o: CleanOffer, s: CleanState) => {
  const k = offerStatus(o, s).kind;
  return k === 'new' || k === 'error';
};

/** Send one clean version to deemix, or request it. */
export async function getClean(o: CleanOffer) {
  const set = (v: string | undefined) => useCleanVersions.setState((s) => ({ sending: { ...s.sending, [o.link]: v } }));
  set('…');
  try {
    const request = mustRequest();
    if (request) await requestMusic({ link: o.link, kind: 'album', title: `${o.album} (clean)`, artist: o.artist, cover: offerCover(o) });
    else if (hubRuns('deemix')) {
      const { job } = await hubClient()!.deemixClean(o.link, useSettings.getState().deemix.bitrate);
      useCleanVersions.setState((s) => ({ hub: { ...s.hub, [o.link]: job } }));
    } else await deemixClient().addToQueue(o.link, useSettings.getState().deemix.bitrate);
    useCleanVersions.setState((s) => ({ sent: { ...s.sent, [o.link]: { at: Date.now(), via: request ? 'request' : 'deemix' } } }));
    set(undefined);
  } catch (e) {
    set(String((e as Error).message ?? e));
  }
}

/** Send several, one after the other, skipping any already in the library or sent. */
export async function getAllClean(offers: CleanOffer[]) {
  for (const o of offers) if (wanted(o, useCleanVersions.getState())) await getClean(o);
  refreshCleanQueue();
}

/** Read deemix's queue, so each album shows Queued / Downloading / Downloaded. */
export async function refreshCleanQueue() {
  if (mustRequest()) return;
  try {
    const r = await deemixClient().getQueue();
    const queue: CleanState['queue'] = {};
    for (const item of Object.values<any>(r?.queue ?? {})) {
      if (item?.type !== 'album' || !item.id) continue;
      queue[Number(item.id)] = { status: String(item.status ?? ''), progress: Number(item.progress ?? 0) };
    }
    const jobs = hubRuns('deemix') ? (await hubClient()!.deemixCleanJobs().catch(() => undefined))?.jobs : undefined;
    useCleanVersions.setState((s) => ({ queue, hub: jobs ? Object.fromEntries(jobs.map((j) => [j.link, j])) : s.hub }));
  } catch {
    /* deemix not reachable: keep showing what was sent */
  }
}

/** The clean album's 30-second clips, to play as a preview. */
export async function previewTracks(o: CleanOffer): Promise<Track[]> {
  if (!o.deezerId) return [];
  const page = await getDeezerAlbum(o.deezerId);
  return page.tracks.filter((t) => t.preview).map((t) => ({
    id: `preview:${t.preview}`, sourceId: 'preview', kind: 'track', title: t.title, artist: t.artist, album: `${o.album} (clean preview)`,
    coverUrl: t.cover ?? offerCover(o), streamUrl: t.preview!, duration: 30, explicit: t.explicit ? 'explicit' : 'clean',
  }));
}
