/**
 * The app–Hub contract for "Don't play this" (src/lib/dontPlay.ts, hub/src/dontPlay.ts). Types only. The list is a
 * synced setting (`settings.dontPlay` in the person's prefs), so the Hub reads it to keep mixes free of them.
 */
export interface DontPlay {
  /** artists as shown ("Drake"); matched on the main artist, ignoring case, accents and punctuation */
  artists: string[];
  songs: { artist: string; title: string }[];
}
