import { AudiobookshelfSource } from './audiobookshelf';
import { NavidromeSource } from './navidrome';
import { PlexSource } from './plex';
import { SubWaveSource } from './subwave';
import type { Album, Artist, MusicSource, SourceConfig } from './types';

const cache = new Map<string, { key: string; src: MusicSource }>();

export function sourceFor(config: SourceConfig): MusicSource {
  const key = JSON.stringify(config);
  const hit = cache.get(config.id);
  if (hit && hit.key === key) return hit.src;
  const src = create(config);
  cache.set(config.id, { key, src });
  return src;
}

function create(config: SourceConfig): MusicSource {
  switch (config.kind) {
    case 'navidrome':
      return new NavidromeSource(config);
    case 'plex':
      return new PlexSource(config);
    case 'audiobookshelf':
      return new AudiobookshelfSource(config);
    case 'subwave':
      return new SubWaveSource(config);
  }
}

/** Matching key so the same album/artist on Navidrome and Plex collapses into one entry. */
export function norm(s = '') {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^the\s+/, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Lists must be passed in source priority order — earlier sources win. Copies with the same name are one album
 * whatever their explicit tags say: an album's tag only sums up its songs (Navidrome calls a part of an album
 * holding just its clean songs "clean"), so it doesn't make a clean version. Clean versions have "(Clean)" in
 * their name (lib/versions.ts).
 */
export function mergeAlbums(lists: Album[][]): Album[] {
  const map = new Map<string, Album>();
  for (const list of lists) {
    for (const a of list) {
      const key = `${norm(a.artist)}|${norm(a.title)}`;
      const existing = map.get(key);
      if (existing) existing.refs!.push(a);
      else map.set(key, { ...a, refs: [a] });
    }
  }
  return [...map.values()];
}

export function mergeArtists(lists: Artist[][]): Artist[] {
  const map = new Map<string, Artist>();
  for (const list of lists) {
    for (const a of list) {
      const key = norm(a.name);
      const existing = map.get(key);
      if (existing) {
        existing.refs!.push(a);
        existing.coverUrl ??= a.coverUrl;
      } else map.set(key, { ...a, refs: [a] });
    }
  }
  return [...map.values()];
}
