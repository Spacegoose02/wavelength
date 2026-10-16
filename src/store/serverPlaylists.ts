import { create } from 'zustand';
import { sourceFor } from '../sources/registry';
import type { ServerPlaylist } from '../sources/types';
import { enabledSources } from './settings';

interface ServerPlaylistsState {
  bySource: Record<string, ServerPlaylist[]>;
  errors: Record<string, string>;
  loading: boolean;
  load(): Promise<void>;
}

/** Playlists stored on Navidrome / Plex. Edits go straight to the server. */
export const useServerPlaylists = create<ServerPlaylistsState>()((set) => ({
  bySource: {},
  errors: {},
  loading: false,
  async load() {
    set({ loading: true });
    const bySource: Record<string, ServerPlaylist[]> = {};
    const errors: Record<string, string> = {};
    await Promise.all(
      enabledSources().map(async (cfg) => {
        const src = sourceFor(cfg);
        if (!src.getPlaylists) return;
        try {
          bySource[cfg.id] = await src.getPlaylists();
        } catch (e) {
          errors[cfg.name] = String((e as Error).message ?? e);
        }
      }),
    );
    set({ bySource, errors, loading: false });
  },
}));
