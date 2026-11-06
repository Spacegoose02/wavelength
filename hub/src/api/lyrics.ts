/**
 * The app–Hub contract for the shared lyrics cache (hub/src/lyricsCache.ts, routes/lyrics.ts). Types only, see
 * api/library.ts. The shapes match the app's own (src/lib/lyrics.ts).
 */

export interface LyricLine {
  /** seconds; undefined for plain (unsynced) lyrics */
  time?: number;
  text: string;
}

export interface Lyrics {
  lines: LyricLine[];
  synced: boolean;
  instrumental?: boolean;
  /** where they came from, shown under the lyrics */
  source: string;
}

/** `GET /api/lyrics?key=…`: null when no one in the house has found them yet. */
export interface LyricsCacheResponse {
  lyrics: Lyrics | null;
}

/** `PUT /api/lyrics` */
export interface LyricsCachePut {
  key: string;
  artist: string;
  title: string;
  lyrics: Lyrics;
}

/** A song whose words match a search, with the line that matched. */
export interface LyricsHit {
  artist: string;
  title: string;
  line: string;
}
