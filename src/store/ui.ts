import { create } from 'zustand';
import type { Album, Artist, Podcast, ServerPlaylist } from '../sources/types';

export type Route =
  | { view: 'home' }
  | { view: 'albums' }
  | { view: 'artists' }
  | { view: 'artist'; artist: Artist }
  | { view: 'album'; album: Album }
  | { view: 'search'; q?: string }
  | { view: 'radio' }
  | { view: 'books' }
  | { view: 'podcasts' }
  | { view: 'podcast'; podcast: Podcast }
  | { view: 'history' }
  | { view: 'playlists' }
  | { view: 'playlist'; id: string }
  | { view: 'serverPlaylist'; playlist: ServerPlaylist }
  | { view: 'subwave'; sourceId?: string }
  | { view: 'discover' }
  | { view: 'favorites' }
  | { view: 'recent' }
  | { view: 'library' }
  | { view: 'offline' }
  | { view: 'offlineCollection'; id: string }
  | { view: 'downloads' }
  | { view: 'settings' };

interface UiState {
  route: Route;
  history: Route[];
  nowPlayingOpen: boolean;
  queueOpen: boolean;
  go(r: Route): void;
  back(): void;
  setNowPlaying(open: boolean): void;
  toggleQueue(): void;
}

export const useUi = create<UiState>()((set) => ({
  route: { view: 'home' },
  history: [],
  nowPlayingOpen: false,
  queueOpen: false,
  go: (route) => {
    // a history entry per page so the Android back button / mouse back walk back through pages
    window.history.pushState(null, '');
    set((s) => ({ route, history: [...s.history.slice(-30), s.route], nowPlayingOpen: false }));
  },
  back: () => set((s) => (s.history.length ? { route: s.history[s.history.length - 1], history: s.history.slice(0, -1) } : s)),
  setNowPlaying: (nowPlayingOpen) => {
    if (nowPlayingOpen) window.history.pushState(null, '');
    set({ nowPlayingOpen });
  },
  toggleQueue: () => set((s) => ({ queueOpen: !s.queueOpen })),
}));
