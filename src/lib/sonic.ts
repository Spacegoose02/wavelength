import { withoutDontPlay } from './dontPlay';
import type { HubSonicFeatures, HubSonicHit } from '../sources/hub';
import type { NavidromeSource } from '../sources/navidrome';
import { sourceFor } from '../sources/registry';
import type { Track } from '../sources/types';
import { hubClient } from '../store/hub';
import { useSettings } from '../store/settings';
import { featureOn } from './features';
import { kidSafe } from './kids';
import { findInLibrary, pool } from './match';

/**
 * Sound-alike analysis from the Hub (hub/src/sonic/): "Sounds like this" radio, sonic journeys, and song
 * features (tempo, key, energy, mood) for smart playlists and AutoMix. The Hub analysed its Navidrome library,
 * so a hit's id is that Navidrome's song id: used straight away when this device has that server, else the song
 * is found by title and artist.
 */

export const sonicOn = () => !!hubClient() && featureOn('sonic');

/** Hits as tracks in this library. */
export async function hitsToTracks(hits: HubSonicHit[]): Promise<Track[]> {
  const find = findInLibrary();
  const nd = useSettings.getState().sources.filter((s) => s.kind === 'navidrome' && s.enabled);
  const tracks = await pool(hits, 4, (h) => find({ title: h.title, artist: h.artist }).catch(() => undefined));
  // Fall back on the Navidrome id when the name lookup missed and there's exactly one Navidrome server. Built the
  // way that server builds its own songs, so it gets a stream, a tidied credit ("A;B" → "A feat. B") and a cover
  // (Navidrome's getCoverArt takes a song id and answers with that song's picture).
  const server = nd.length === 1 ? (sourceFor(nd[0]) as NavidromeSource) : undefined;
  const out = tracks.map((t, i) => t ?? (server ? fromHit(server, hits[i]) : undefined));
  return kidSafe(out.filter((t): t is Track => !!t));
}

/** A Hub hit as a song on this device's (only) Navidrome server. */
export const fromHit = (server: Pick<NavidromeSource, 'trackFromId'>, h: HubSonicHit): Track =>
  server.trackFromId(h.id, { title: h.title, artist: h.artist, album: h.album, duration: h.duration });

export async function soundsLike(t: Pick<Track, 'artist' | 'title' | 'id'>): Promise<Track[]> {
  const c = hubClient();
  if (!c) throw new Error('Sounds like this needs a Wavelength Hub');
  const r = await c.sonicSimilar({ artist: t.artist, title: t.title }, 60);
  return withoutDontPlay(await hitsToTracks(r.songs));
}

export async function journey(from: Pick<Track, 'artist' | 'title'>, to: HubSonicHit, steps = 20): Promise<Track[]> {
  const c = hubClient();
  if (!c) throw new Error('Sonic journeys need a Wavelength Hub');
  const r = await c.sonicJourney(from, to, steps);
  return withoutDontPlay(await hitsToTracks(r.songs));
}

const cache = new Map<string, HubSonicFeatures | null>();
const ck = (t: Pick<Track, 'artist' | 'title'>) => `${t.artist.toLowerCase()}\u0000${t.title.toLowerCase()}`;

/** Features for these songs (cached for the session); null where the Hub hasn't analysed one. */
export async function featuresFor(tracks: Pick<Track, 'artist' | 'title'>[]): Promise<(HubSonicFeatures | null)[]> {
  const c = hubClient();
  if (!c || !featureOn('sonic')) return tracks.map(() => null);
  const todo = [...new Set(tracks.filter((t) => !cache.has(ck(t))).map(ck))].map((k) => tracks.find((t) => ck(t) === k)!);
  for (let i = 0; i < todo.length; i += 500) {
    const part = todo.slice(i, i + 500);
    const r = await c.sonicLookup(part.map((t) => ({ artist: t.artist, title: t.title }))).catch(() => ({ features: part.map(() => null) }));
    part.forEach((t, j) => cache.set(ck(t), r.features[j]));
  }
  return tracks.map((t) => cache.get(ck(t)) ?? null);
}
