import { create } from 'zustand';
import type { HouseListener } from '../../hub/src/api/activity';
import { hubClient, useHub } from '../store/hub';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';

/**
 * House activity (hub/src/routes/activity.ts): this device tells the Hub what's playing (title, artist, album:
 * names only), and the sidebar shows what everyone else in the house is playing, with Join when they host a
 * party. "Show the house what I'm playing" (setting `shareListening`, synced) is on for grown-ups and off for
 * kids unless they turn it on.
 */

export const useHouseActivity = create<{ listeners: HouseListener[]; parties: Map<number, string> }>(() => ({ listeners: [], parties: new Map() }));

/** The setting as it applies to this person: unset means yes for grown-ups, no for kids. */
export const sharesListening = () => useSettings.getState().shareListening ?? useHub.getState().user?.role !== 'kid';

const POLL_MS = 30_000;
let started = false;
let last = '';
let shared = false;

function report() {
  const c = hubClient();
  if (!c) return;
  const p = usePlayer.getState();
  const t = p.queue[p.index];
  const share = sharesListening() && !!t && t.kind !== 'radio' && t.kind !== 'book' && t.kind !== 'episode';
  if (!share) {
    if (shared) void c.activityClear().catch(() => undefined);
    shared = false;
    last = '';
    return;
  }
  const key = `${t.title}|${t.artist}|${p.playing}`;
  if (key === last) return;
  last = key;
  shared = true;
  void c.activityReport({ title: t.title, artist: t.artist, ...(t.album && { album: t.album }), playing: p.playing }).catch(() => (last = ''));
}

async function poll() {
  const c = hubClient();
  if (!c || document.hidden) return;
  try {
    const [{ listeners }, { parties }] = await Promise.all([c.houseActivity(), c.parties()]);
    useHouseActivity.setState({ listeners, parties: new Map(parties.filter((x) => x.hostId !== undefined && !x.joined).map((x) => [x.hostId!, x.id])) });
  } catch {
    /* an older Hub, or offline: keep what's shown */
  }
}

export function startHouseActivity() {
  if (started) return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  usePlayer.subscribe((s, prev) => {
    if (s.queue[s.index] === prev.queue[prev.index] && s.playing === prev.playing) return;
    clearTimeout(timer);
    timer = setTimeout(report, 1500); // skipping through songs sends only the one that stuck
  });
  useSettings.subscribe((s, prev) => s.shareListening !== prev.shareListening && report());
  // a report goes stale on the Hub after 5 minutes: say again now and then that it's still playing
  setInterval(() => {
    last = '';
    report();
  }, 4 * 60_000);
  setInterval(() => void poll(), POLL_MS);
  document.addEventListener('visibilitychange', () => !document.hidden && void poll());
  useHub.subscribe((s, prev) => s.token !== prev.token && (s.token ? void poll() : useHouseActivity.setState({ listeners: [] })));
  void poll();
}
