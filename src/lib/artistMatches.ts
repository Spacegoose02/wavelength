import { useEffect } from 'react';
import { create } from 'zustand';
import type { HubArtistMatch } from '../sources/hub';
import { hubClient, useHub } from '../store/hub';

/**
 * Artists matched by hand (docs/USER-GUIDE.md, "Match an artist by hand"): when looking a library artist up by name
 * finds nobody or the wrong one, a Hub admin picks the right MusicBrainz and Deezer artist in Edit artist → Match,
 * or says they aren't on one of them. The list is kept on the Hub (hub/src/routes/artistMeta.ts) and read once a
 * session; every lookup by name (lib/artistInfo.ts for the bio and members, sources/releaseRadar.ts for Deezer:
 * Browse releases, the newest release banner, Release Radar, Library care) asks here first.
 */

/** Names as the Hub keys them: case doesn't count. */
export const matchKey = (name: string) => name.trim().toLowerCase();

interface State {
  byName: Record<string, HubArtistMatch>;
  /** The list came from the Hub (or there's no Hub to ask). */
  ready: boolean;
}
export const useArtistMatches = create<State>()(() => ({ byName: {}, ready: false }));

let loading: Promise<void> | undefined;
let loadedFor: string | null | undefined;

/** The matches, read from the Hub once a session (again when the Hub sign-in changes). Never fails. */
export function matchesReady(): Promise<void> {
  const token = useHub.getState().token ?? null;
  if (loading && loadedFor === token) return loading;
  loadedFor = token;
  const c = token ? hubClient() : null;
  loading = (c ? c.artistMatches().then((r) => r.matches, () => []) : Promise.resolve([]))
    .then((list) => {
      const byName: State['byName'] = {};
      for (const m of list) byName[matchKey(m.name)] = { musicbrainz: m.musicbrainz, deezer: m.deezer };
      useArtistMatches.setState({ byName, ready: true });
    });
  return loading;
}

/** This artist's match, once the list is in; undefined while it loads or when they aren't matched by hand. */
export function matchOf(name: string): HubArtistMatch | undefined {
  return useArtistMatches.getState().byName[matchKey(name)];
}

/** After waiting for the list: the artist's match, or undefined. */
export async function matchFor(name: string): Promise<HubArtistMatch | undefined> {
  await matchesReady();
  return matchOf(name);
}

/** Edit artist saved a match (or moved it with a rename): every page uses it straight away. */
export function putMatch(name: string, m: HubArtistMatch | undefined) {
  useArtistMatches.setState((s) => {
    const byName = { ...s.byName };
    if (!m || (m.musicbrainz === null && m.deezer === null)) delete byName[matchKey(name)];
    else byName[matchKey(name)] = m;
    return { byName };
  });
}

/** The artist's match for a component: `ready` false while the list loads. */
export function useArtistMatch(name: string): { ready: boolean; match?: HubArtistMatch } {
  const ready = useArtistMatches((s) => s.ready);
  const match = useArtistMatches((s) => s.byName[matchKey(name)]);
  const token = useHub((s) => s.token);
  useEffect(() => {
    void matchesReady();
  }, [token]);
  return { ready, match };
}

/**
 * What a pasted link or id names (Edit artist → Match): a MusicBrainz artist (musicbrainz.org/artist/<id>, or a bare
 * id) or a Deezer artist (deezer.com/…/artist/<id>, link.deezer.com isn't followed, or a bare number). undefined
 * when it's neither, like a search for a name.
 */
export function parseArtistLink(text: string): { site: 'musicbrainz'; id: string } | { site: 'deezer'; id: number } | undefined {
  const t = text.trim();
  const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  if (/^[0-9a-f-]{36}$/i.test(t) && uuid.test(t)) return { site: 'musicbrainz', id: t.toLowerCase() };
  if (/^[1-9]\d{0,15}$/.test(t)) return { site: 'deezer', id: Number(t) };
  const mb = /musicbrainz\.org\/artist\/([0-9a-f-]{36})/i.exec(t);
  if (mb && uuid.test(mb[1])) return { site: 'musicbrainz', id: mb[1].toLowerCase() };
  const dz = /deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?artist\/(\d+)/i.exec(t);
  if (dz) return { site: 'deezer', id: Number(dz[1]) };
  return undefined;
}

/** A fact filled in by hand wins over MusicBrainz's; links filled in come first, then MusicBrainz's other ones. */
export function mergeFacts<B extends { type?: string; area?: string; began?: string; ended?: string; links: { label: string; url: string }[] }>(
  bio: B | null | undefined,
  own: { type: string; area: string; began: string; ended: string; links: { label: string; url: string }[] } | null | undefined,
): { type?: string; area?: string; began?: string; ended?: string; links: { label: string; url: string }[] } {
  const pick = (k: 'type' | 'area' | 'began' | 'ended') => own?.[k] || bio?.[k] || undefined;
  const mine = own?.links ?? [];
  const labels = new Set(mine.map((l) => l.label.toLowerCase()));
  const urls = new Set(mine.map((l) => l.url));
  return {
    type: pick('type'),
    area: pick('area'),
    began: pick('began'),
    ended: pick('ended'),
    links: [...mine, ...(bio?.links ?? []).filter((l) => !labels.has(l.label.toLowerCase()) && !urls.has(l.url))],
  };
}
