import type { DontPlay } from '../../hub/src/api/dontPlay';
import type { Track } from '../sources/types';
import { useSettings } from '../store/settings';
import { primaryArtist } from './match';

/**
 * "Don't play this": artists and songs left out of everything Wavelength picks for you (song radio, Sounds like
 * this, Smart Shuffle, DJ mode, Made for you mixes). Playing them yourself still works. A synced setting, so the
 * Hub sees it too and keeps them out of mixes and DJ segments (hub/src/dontPlay.ts, same matching).
 */
export type { DontPlay };

/** Like the Hub's normName (hub/src/radar.ts): lower case, no accents, no leading "the", "&" as "and", letters and digits only. */
const normName = (s = '') =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
const titleKey = (t: string) => normName(t.replace(/\s*[([].*$/, ''));
const artistKey = (a: string) => normName(primaryArtist(a));

export function allowedBy(rules: DontPlay): (t: Pick<Track, 'artist' | 'title'>) => boolean {
  const artists = new Set(rules.artists.map(artistKey));
  const songs = new Set(rules.songs.map((s) => `${artistKey(s.artist)}|${titleKey(s.title)}`));
  if (!artists.size && !songs.size) return () => true;
  return (t) => {
    const a = artistKey(t.artist);
    return !artists.has(a) && !songs.has(`${a}|${titleKey(t.title)}`);
  };
}

/** The songs Wavelength may pick for you, in order. */
export function withoutDontPlay<T extends Pick<Track, 'artist' | 'title'>>(tracks: T[]): T[] {
  const ok = allowedBy(useSettings.getState().dontPlay);
  return tracks.filter(ok);
}

export const isArtistBlocked = (rules: DontPlay, artist: string) => rules.artists.some((a) => artistKey(a) === artistKey(artist));
export const isSongBlocked = (rules: DontPlay, t: Pick<Track, 'artist' | 'title'>) =>
  rules.songs.some((s) => artistKey(s.artist) === artistKey(t.artist) && titleKey(s.title) === titleKey(t.title));
