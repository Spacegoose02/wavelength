import { create } from 'zustand';
import type { HubFollow, HubRadar } from '../sources/hub';
import { HubError } from '../sources/hub';
import { norm } from '../sources/registry';
import { hubClient, useHub } from '../store/hub';

/**
 * Following artists for Release Radar (docs/RELEASE-RADAR.md). The Hub keeps who each person follows and
 * looks their new releases up in the background (hub/src/radar.ts), so following needs a Hub; without one,
 * or with a Hub older than Release Radar, the Follow buttons don't show and Discover keeps the "artists
 * you play" radar the app works out on its own (sources/releaseRadar.ts).
 */

interface FollowsState {
  follows: HubFollow[];
  /** false = no Hub, or a Hub without Release Radar; undefined = not asked yet. */
  supported?: boolean;
  /** The Hub's last answer, for Discover. */
  radar?: HubRadar;
}

export const useFollows = create<FollowsState>()(() => ({ follows: [] }));

let loading: Promise<HubRadar | undefined> | undefined;

/** Ask the Hub for this person's follows and radar. Quietly does nothing when signed out or offline. */
export function loadRadar(): Promise<HubRadar | undefined> {
  const c = hubClient();
  if (!c) {
    useFollows.setState({ follows: [], supported: false, radar: undefined });
    return Promise.resolve(undefined);
  }
  loading ??= c
    .radar()
    .then((radar) => {
      useFollows.setState({ follows: radar.follows, supported: true, radar });
      return radar;
    })
    .catch((e) => {
      // an older Hub has no such route
      if (e instanceof HubError && e.status === 404) useFollows.setState({ follows: [], supported: false, radar: undefined });
      return undefined;
    })
    .finally(() => {
      loading = undefined;
    });
  return loading;
}

// a different account (or none) follows different artists
useHub.subscribe((s, prev) => {
  if (s.token === prev.token && s.url === prev.url) return;
  useFollows.setState({ follows: [], supported: undefined, radar: undefined });
  if (s.token) void loadRadar();
});

/** The artist you follow with this Deezer id, or else this name. */
export function followed(follows: HubFollow[], a: { id?: number; name: string }): HubFollow | undefined {
  return follows.find((f) => f.id === a.id) ?? follows.find((f) => norm(f.name) === norm(a.name));
}

export async function follow(a: { id?: number; name: string; picture?: string | null }): Promise<HubFollow> {
  const c = hubClient();
  if (!c) throw new Error('Sign in to your Hub to follow artists');
  const { follow: f } = await c.follow(a);
  useFollows.setState((s) => ({ follows: [...s.follows.filter((x) => x.id !== f.id), f].sort((x, y) => x.name.localeCompare(y.name)) }));
  // their releases show up once the Hub has looked them up, a moment later
  setTimeout(() => void loadRadar(), 3000);
  return f;
}

export async function unfollow(id: number) {
  const c = hubClient();
  if (!c) return;
  await c.unfollow(id).catch((e) => {
    if (!(e instanceof HubError && e.status === 404)) throw e;
  });
  useFollows.setState((s) => ({
    follows: s.follows.filter((x) => x.id !== id),
    radar: s.radar && { ...s.radar, follows: s.radar.follows.filter((x) => x.id !== id), releases: s.radar.releases.filter((r) => r.artistId !== id) },
  }));
}
