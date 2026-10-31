import { create } from 'zustand';
import type { Album, Artist, Podcast, ServerPlaylist } from '../sources/types';
import type { Skin } from './settings';
import type { Browse } from '../views/DeezerBrowse';

export type Route =
  | { view: 'home' }
  | { view: 'albums' }
  | { view: 'artists' }
  | { view: 'artist'; artist: Artist }
  /** Browse releases: the artist's Deezer discography (views/ArtistReleases.tsx), optionally with one release open. */
  | { view: 'artistReleases'; artist: Artist; open?: Browse }
  /** `track`: the song to scroll to and flash (Now Playing's song title link). */
  | { view: 'album'; album: Album; track?: { id: string; sourceId: string; title?: string } }
  | { view: 'search'; q?: string }
  | { view: 'radio' }
  | { view: 'books' }
  | { view: 'podcasts' }
  | { view: 'podcast'; podcast: Podcast }
  | { view: 'history' }
  | { view: 'rewind' }
  | { view: 'playlists' }
  | { view: 'playlist'; id: string }
  | { view: 'household'; id: number }
  | { view: 'serverPlaylist'; playlist: ServerPlaylist }
  | { view: 'subwave'; sourceId?: string }
  | { view: 'discover'; genre?: 'new' }
  | { view: 'import' }
  | { view: 'tags'; album: Album }
  | { view: 'artistTags'; artist: Artist }
  | { view: 'favorites' }
  | { view: 'recent' }
  | { view: 'library' }
  | { view: 'libraryCare' }
  | { view: 'offline' }
  | { view: 'offlineCollection'; id: string }
  | { view: 'downloads'; soulseek?: { q: string; requestId?: number } }
  | { view: 'inbox'; tab?: 'clean' }
  | { view: 'settings'; tab?: SettingsTab };

/** The tabs of the Settings page (views/Settings.tsx). */
export type SettingsTab = 'account' | 'users' | 'server' | 'sources' | 'playback' | 'downloads' | 'themes' | 'discover' | 'updates';

interface UiState {
  route: Route;
  history: Route[];
  nowPlayingOpen: boolean;
  queueOpen: boolean;
  /** Settings → Themes: the skin under the pointer / D-pad focus, shown until it leaves. Not saved. */
  previewSkin?: Skin;
  setPreviewSkin(s?: Skin): void;
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
  previewSkin: undefined,
  setPreviewSkin: (previewSkin) => set({ previewSkin }),
  go: (route) => {
    // a history entry per page so the Android back button / mouse back walk back through pages. Leaving Now
    // Playing for a page (its album / artist links) reuses the entry opening it pushed, so Back goes to the
    // page under Now Playing in one step
    if (!useUi.getState().nowPlayingOpen) window.history.pushState(null, '');
    // kept long enough that it doesn't run out before the WebView's own history does (Back would do nothing)
    set((s) => ({ route, history: [...s.history.slice(-500), s.route], nowPlayingOpen: false }));
  },
  back: () => set((s) => (s.history.length ? { route: s.history[s.history.length - 1], history: s.history.slice(0, -1) } : s)),
  setNowPlaying: (nowPlayingOpen) => {
    if (nowPlayingOpen) window.history.pushState(null, '');
    set({ nowPlayingOpen });
  },
  // like Now Playing, the open queue has its own history entry, so Back closes it without using up a page's
  // entry (App.tsx onPop closes it); closing it with its button pops that entry
  toggleQueue: () => {
    if (useUi.getState().queueOpen) window.history.back();
    else {
      window.history.pushState(null, '');
      set({ queueOpen: true });
    }
  },
}));
