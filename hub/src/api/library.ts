/**
 * The app–Hub contract for the library index (hub/src/libraryIndex.ts): the shapes the Hub sends and the app
 * reads. Types only, no imports and no code, so the app can `import type` this file directly
 * (src/sources/hub.ts) and the two sides can't drift apart. See docs/ARCHITECTURE.md "The app–Hub contract".
 */

/** A Navidrome song in Subsonic's own fields, which the app turns into a playable track (`fromSubsonic`). */
export interface IndexedSong {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  year?: number;
  duration?: number;
  track?: number;
  discNumber?: number;
  coverArt?: string;
  explicitStatus?: string;
}

/** An album in Subsonic's fields, put together from its songs. */
export interface IndexedAlbum {
  id: string;
  name: string;
  artist: string;
  artistId?: string;
  year?: number;
  coverArt?: string;
  songCount: number;
}

/** An artist in Subsonic's fields, put together from their songs. */
export interface IndexedArtist {
  id: string;
  name: string;
  coverArt?: string;
  albumCount: number;
}

/** `GET /api/library/search?q=…` */
export interface LibrarySearchResponse {
  /** false: no scan login yet, or the first listing hasn't worked; the app searches its servers itself */
  ready: boolean;
  /** the Navidrome these are from, so the app can tell whether it's one of its own */
  server: string | null;
  songs: IndexedSong[];
  albums: IndexedAlbum[];
  artists: IndexedArtist[];
  /** a closer spelling when the words matched nothing exactly ("Did you mean Beyoncé?") */
  didYouMean?: string;
}
