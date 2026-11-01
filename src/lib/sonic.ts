import type { HubSonicFeatures, HubSonicHit } from '../sources/hub';
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
  // fall back on the Navidrome id when the name lookup missed and there's exactly one Navidrome server
  const out = tracks.map((t, i) => t ?? (nd.length === 1 ? ({ id: hits[i].id, sourceId: nd[0].id, kind: 'track', title: hits[i].title, artist: hits[i].artist, album: hits[i].album, duration: hits[i].duration } as Track) : undefined));
  return kidSafe(out.filter((t): t is Track => !!t));
}

export async function soundsLike(t: Pick<Track, 'artist' | 'title' | 'id'>): Promise<Track[]> {
  const c = hubClient();
  if (!c) throw new Error('Sounds like this needs a Wavelength Hub');
  const r = await c.sonicSimilar({ artist: t.artist, title: t.title }, 60);
  return hitsToTracks(r.songs);
}

export async function journey(from: Pick<Track, 'artist' | 'title'>, to: HubSonicHit, steps = 20): Promise<Track[]> {
  const c = hubClient();
  if (!c) throw new Error('Sonic journeys need a Wavelength Hub');
  const r = await c.sonicJourney(from, to, steps);
  return hitsToTracks(r.songs);
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
