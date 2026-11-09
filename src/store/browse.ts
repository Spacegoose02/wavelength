import { create } from 'zustand';
import type { AlbumSort, ArtistSort, BrowseQuery } from '../lib/browse';

/**
 * The genre, decade, year, style, mood and collection filters and sort on Albums and Artists (components/BrowseFilters.tsx). Kept here,
 * not in the pages, so opening an album and coming back keeps them. Not saved between launches.
 */
interface BrowseFilters {
  albums: BrowseQuery & { sort: AlbumSort };
  artists: BrowseQuery & { sort: ArtistSort };
  setAlbums(q: Partial<BrowseQuery & { sort: AlbumSort }>): void;
  setArtists(q: Partial<BrowseQuery & { sort: ArtistSort }>): void;
}

export const useBrowseFilters = create<BrowseFilters>()((set) => ({
  albums: { sort: 'name' },
  artists: { sort: 'name' },
  setAlbums: (q) => set((s) => ({ albums: { ...s.albums, ...q } })),
  setArtists: (q) => set((s) => ({ artists: { ...s.artists, ...q } })),
}));
