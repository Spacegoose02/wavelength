import { create } from 'zustand';
import type { Track } from '../sources/types';
import { useCan, useHub } from '../store/hub';
import { useSettings } from '../store/settings';
import { IconPencil } from './Icons';

/** Which song the Edit song dialog (views/SongEditor.tsx, drawn by SongEditorHost in App.tsx) is open on. */
interface EditorState {
  track?: Track;
  open(track: Track): void;
  close(): void;
}

export const useSongEditor = create<EditorState>()((set) => ({
  open: (track) => set({ track }),
  close: () => set({ track: undefined }),
}));

/** Whether this signed-in admin can edit this song's tags: a Navidrome song, a Hub with `library.edit`. */
export function useCanEditSong() {
  const signedIn = useHub((s) => !!s.token);
  const can = useCan('library.edit');
  const sources = useSettings((s) => s.sources);
  return (t: Track) => signedIn && can && t.kind === 'track' && sources.find((s) => s.id === t.sourceId)?.kind === 'navidrome';
}

/** The row's Edit button (admins only). */
export function EditSongButton({ track, className = 'chip' }: { track: Track; className?: string }) {
  const canEdit = useCanEditSong();
  if (!canEdit(track)) return null;
  return (
    <button className={className} title="Edit this song’s title, artists and tags" onClick={(e) => { e.stopPropagation(); useSongEditor.getState().open(track); }}>
      <IconPencil /> Edit
    </button>
  );
}
