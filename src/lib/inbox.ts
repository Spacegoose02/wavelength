import { create } from 'zustand';
import type { HubRequest, HubRequestInput, HubShareInput, SharedTrack, ShareKind } from '../sources/hub';
import type { Station, Track } from '../sources/types';
import { hubClient, useHub } from '../store/hub';
import { checkNotifications } from './notify';

/**
 * Requests and sharing through the Hub (docs/USERS-AND-ADMIN.md §6.3, §6.9). People without Autodownload
 * request music instead of downloading it, and anyone can share what they're listening to with the
 * household. The Inbox shows both, and these counts drive its badge.
 */

interface InboxState {
  /** Your requests that were decided since you last looked. */
  decided: number;
  /** Requests waiting for an admin (admins only). */
  pending: number;
  /** Things shared with you that you haven't opened. */
  shared: number;
}

export const useInbox = create<InboxState>()(() => ({ decided: 0, pending: 0, shared: 0 }));

export const inboxBadge = (s: InboxState) => s.decided + s.pending + s.shared;

/** Ask the Hub for fresh counts. Quietly does nothing when signed out or offline. */
export async function refreshInbox() {
  const c = hubClient();
  if (!c) return useInbox.setState({ decided: 0, pending: 0, shared: 0 });
  try {
    const [r, s] = await Promise.all([c.requestCounts(), c.shareCounts()]);
    useInbox.setState({ decided: r.unseen, pending: r.pending, shared: s.unseen });
    void checkNotifications();
  } catch {
    /* offline: keep the last counts */
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
/** Keep the badge (and system notifications, lib/notify.ts) fresh: now, every two minutes, and when the window comes back into focus. */
export function startInboxChecks() {
  if (timer) return;
  refreshInbox();
  timer = setInterval(refreshInbox, 120_000);
  window.addEventListener('focus', () => refreshInbox());
  useHub.subscribe((s, prev) => s.token !== prev.token && refreshInbox());
}

/** Signed in to a Hub that won't let this person download: "Get" becomes "Request". */
export function mustRequest(): boolean {
  const { token, permissions } = useHub.getState();
  return !!token && !permissions.includes('downloads.run') && permissions.includes('requests.create');
}
export const useMustRequest = () => useHub((s) => !!s.token && !s.permissions.includes('downloads.run') && s.permissions.includes('requests.create'));

/** Ask for music. With Autodownload the Hub downloads it straight away (status 'approved'). */
export async function requestMusic(r: HubRequestInput): Promise<HubRequest> {
  const c = hubClient();
  if (!c) throw new Error('Sign in to your Hub to request music');
  const { request } = await c.request(r);
  refreshInbox();
  return request;
}

/** What to show for a request: an approved one goes Downloading → Adding to your library → Ready. */
export const requestStatus = (r: HubRequest) =>
  r.status !== 'approved' ? REQUEST_STATUS[r.status] : r.readyAt ? 'Ready' : r.downloadedAt ? 'Adding to your library' : r.progress?.label ?? REQUEST_STATUS.approved;

export const REQUEST_STATUS: Record<HubRequest['status'], string> = {
  pending: 'Waiting',
  approved: 'Downloading',
  rejected: 'Not this time',
  have: 'Already in the library',
  failed: 'Download failed',
};

// ---- sharing ----

/** Can share: signed in to a Hub. */
export const useCanShare = () => useHub((s) => !!s.token);

/**
 * A cover link that is safe to hand to someone else. Navidrome, Plex and Audiobookshelf cover links carry
 * this device's login in the query string, so those are left out (the other person's app finds its own).
 */
export function publicCover(url?: string): string | undefined {
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  try {
    const q = new URL(url).searchParams;
    for (const k of q.keys()) if (/^(u|t|s|p|token|x-plex-token|apikey|api_key|jwt|auth)$/i.test(k)) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

export const sharedTrack = (t: Track): SharedTrack => ({ title: t.title, artist: t.artist, album: t.album, duration: t.duration, coverUrl: publicCover(t.coverUrl) });

/** What to share, built when the person presses Share (so a long list isn't copied on every render). */
export type ShareWhat = Omit<HubShareInput, 'to' | 'note'>;

export const shareOfTracks = (kind: ShareKind, title: string, tracks: Track[], subtitle?: string, cover?: string): ShareWhat => {
  const songs = tracks.filter((t) => t.kind === 'track');
  return {
    kind,
    title,
    subtitle: subtitle ?? `${songs.length} song${songs.length === 1 ? '' : 's'}`,
    cover: publicCover(cover) ?? songs.map((t) => publicCover(t.coverUrl)).find(Boolean),
    payload: { tracks: songs.slice(0, 2000).map(sharedTrack) },
  };
};

export const shareOfStation = (s: Station): ShareWhat => ({
  kind: 'station',
  title: s.name,
  subtitle: [s.country, s.tags?.split(',').slice(0, 2).join(', ')].filter(Boolean).join(' · ') || 'Radio station',
  cover: publicCover(s.favicon),
  payload: { station: { name: s.name, streamUrl: s.streamUrl, favicon: publicCover(s.favicon), homepage: s.homepage, nowPlayingUrl: s.nowPlayingUrl } },
});

export const shareOfArtist = (name: string, cover?: string): ShareWhat => ({ kind: 'artist', title: name, subtitle: 'Artist', cover: publicCover(cover), payload: { artist: name } });
