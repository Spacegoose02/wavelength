import { create } from 'zustand';
import { mergeAlbums, mergeArtists, sourceFor } from '../sources/registry';
import type { Album, Artist, Book, MusicSource, Podcast } from '../sources/types';
import { enabledSources } from './settings';

interface CatalogState {
  albums: Album[];
  artists: Artist[];
  recent: Album[];
  books: Book[];
  podcasts: Podcast[];
  loading: boolean;
  loaded: boolean;
  errors: Record<string, string>;
  load(): Promise<void>;
}

async function gather<T>(fn: (s: MusicSource) => Promise<T[]> | undefined, errors: Record<string, string>) {
  return Promise.all(
    enabledSources().map(async (cfg) => {
      try {
        return (await fn(sourceFor(cfg))) ?? [];
      } catch (e) {
        errors[cfg.name] = String((e as Error).message ?? e);
        return [] as T[];
      }
    }),
  );
}

export const useCatalog = create<CatalogState>()((set) => ({
  albums: [],
  artists: [],
  recent: [],
  books: [],
  podcasts: [],
  loading: false,
  loaded: false,
  errors: {},
  async load() {
    set({ loading: true });
    const errors: Record<string, string> = {};
    const [albums, artists, recent, books, podcasts] = await Promise.all([
      gather((s) => s.getAlbums?.(), errors),
      gather((s) => s.getArtists?.(), errors),
      gather((s) => s.getRecentAlbums?.(), errors),
      gather((s) => s.getBooks?.(), errors),
      gather((s) => s.getPodcasts?.(), errors),
    ]);
    const byName = (a: { title?: string; name?: string }, b: { title?: string; name?: string }) =>
      (a.title ?? a.name ?? '').localeCompare(b.title ?? b.name ?? '', undefined, { sensitivity: 'base' });
    set({
      albums: mergeAlbums(albums).sort(byName),
      artists: mergeArtists(artists).sort(byName),
      recent: interleave(recent),
      books: books.flat().sort(byName),
      podcasts: podcasts.flat().sort(byName),
      errors,
      loading: false,
      loaded: true,
    });
  },
}));

/** Round-robin so "recently added" mixes all sources instead of listing one after another. */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}
