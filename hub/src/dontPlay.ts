import type { DontPlay } from './api/dontPlay.ts';
import type { Db } from './db.ts';
import { getPrefs } from './prefs.ts';
import { normName, primaryArtist } from './radar.ts';

/**
 * "Don't play this" (docs/HUB.md "Made for you mixes"): artists and songs a person never wants in their mixes. The
 * app keeps the list as a synced setting; the Hub reads it from the person's prefs and leaves them out of every mix.
 * Matching is the same as the app's (src/lib/dontPlay.ts).
 */
export function dontPlayOf(db: Db, userId: number): DontPlay {
  const v = getPrefs(db, userId)['settings.dontPlay']?.value as Partial<DontPlay> | undefined;
  return {
    artists: Array.isArray(v?.artists) ? v.artists.filter((a): a is string => typeof a === 'string') : [],
    songs: Array.isArray(v?.songs) ? v.songs.filter((s) => s && typeof s.artist === 'string' && typeof s.title === 'string') : [],
  };
}

const titleKey = (t: string) => normName(t.replace(/\s*[([].*$/, ''));

export function allowedBy(rules: DontPlay): (song: { artist: string; title: string }) => boolean {
  const artists = new Set(rules.artists.map((a) => normName(primaryArtist(a))));
  const songs = new Set(rules.songs.map((s) => `${normName(primaryArtist(s.artist))}|${titleKey(s.title)}`));
  if (!artists.size && !songs.size) return () => true;
  return (s) => {
    const a = normName(primaryArtist(s.artist));
    return !artists.has(a) && !songs.has(`${a}|${titleKey(s.title)}`);
  };
}
