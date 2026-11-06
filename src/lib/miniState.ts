/** What the main window tells the mini player (lib/desktop.ts → components/MiniPlayer.tsx). */
export interface MiniState {
  title?: string;
  artist?: string;
  cover?: string;
  playing: boolean;
  position: number;
  duration: number;
}

/** What the mini player, the tray and the hotkeys can ask the main window to do. */
export type RemoteAction = 'toggle' | 'next' | 'prev';
