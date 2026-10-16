import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Track } from '../sources/types';

export interface Playlist {
  id: string;
  name: string;
  tracks: Track[];
  createdAt: number;
  updatedAt: number;
}

export interface LocalPlay {
  track: Track;
  playedAt: number;
}

interface LibraryState {
  playlists: Playlist[];
  history: LocalPlay[];
  createPlaylist(name: string, tracks?: Track[]): string;
  addToPlaylist(id: string, tracks: Track[]): void;
  removeFromPlaylist(id: string, index: number): void;
  moveInPlaylist(id: string, from: number, to: number): void;
  renamePlaylist(id: string, name: string): void;
  deletePlaylist(id: string): void;
  recordPlay(track: Track): void;
}

/** Audiobook parts carry a one-off session, so they can't be saved — everything else can. */
export const canSave = (t: Track) => t.kind !== 'book' && t.sourceId !== 'preview';

/** Drop per-session state so a saved track is re-prepared when played later. */
function storable(t: Track): Track {
  const { sessionId: _s, progress: _p, ...rest } = t;
  return t.kind === 'episode' ? { ...rest, streamUrl: undefined } : rest;
}

export const useLibrary = create<LibraryState>()(
  persist(
    (set) => ({
      playlists: [],
      history: [],
      createPlaylist(name, tracks = []) {
        const id = crypto.randomUUID();
        const now = Date.now();
        set((s) => ({
          playlists: [...s.playlists, { id, name: name.trim() || 'New playlist', tracks: tracks.filter(canSave).map(storable), createdAt: now, updatedAt: now }],
        }));
        return id;
      },
      addToPlaylist: (id, tracks) =>
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === id ? { ...p, tracks: [...p.tracks, ...tracks.filter(canSave).map(storable)], updatedAt: Date.now() } : p,
          ),
        })),
      removeFromPlaylist: (id, index) =>
        set((s) => ({
          playlists: s.playlists.map((p) => (p.id === id ? { ...p, tracks: p.tracks.filter((_, i) => i !== index), updatedAt: Date.now() } : p)),
        })),
      moveInPlaylist: (id, from, to) =>
        set((s) => ({
          playlists: s.playlists.map((p) => {
            if (p.id !== id || to < 0 || to >= p.tracks.length) return p;
            const tracks = [...p.tracks];
            const [t] = tracks.splice(from, 1);
            tracks.splice(to, 0, t);
            return { ...p, tracks, updatedAt: Date.now() };
          }),
        })),
      renamePlaylist: (id, name) =>
        set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...p, name, updatedAt: Date.now() } : p)) })),
      deletePlaylist: (id) => set((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) })),
      recordPlay: (track) =>
        set((s) => ({ history: [{ track: storable(track), playedAt: Date.now() }, ...s.history].slice(0, 300) })),
    }),
    { name: 'tonearm.library' },
  ),
);
