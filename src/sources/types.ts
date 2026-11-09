import type { Lyrics } from '../lib/lyrics';
export type SourceKind = 'navidrome' | 'plex' | 'audiobookshelf' | 'subwave';

export interface SourceConfig {
  id: string;
  kind: SourceKind;
  name: string;
  url: string;
  username?: string;
  password?: string;
  token?: string;
  /** SubWave: optional overrides (defaults: <url>/api and the stream mount reported by the API). */
  streamUrl?: string;
  apiUrl?: string;
  nowPlayingUrl?: string;
  enabled: boolean;
  /** Set when the login is kept by the signed-in Wavelength Hub (lib/hubServices.ts), not on this device. */
  hubId?: number;
  /** SUB/WAVE kept on the Hub: admin controls go through the Hub, which holds the admin login. */
  hubAdmin?: boolean;
  /** Navidrome through the Hub's relay (`/nd/<id>`): the login is one the Hub made for this device, not the person's own. */
  hubRelay?: boolean;
}

export type TrackKind = 'track' | 'radio' | 'book' | 'episode';

export interface Track {
  /** Unique within its source. */
  id: string;
  sourceId: string;
  kind: TrackKind;
  title: string;
  artist: string;
  album?: string;
  albumId?: string;
  duration?: number;
  trackNumber?: number;
  discNumber?: number;
  coverUrl?: string;
  /** From the server's tags (OpenSubsonic `explicitStatus`) or Deezer. */
  explicit?: 'explicit' | 'clean';
  streamUrl?: string;
  /** Radio: JSON/Icecast endpoint polled for the current song. */
  nowPlayingUrl?: string;
  /** Audiobooks: where this file starts inside the book, and the listening session. */
  bookId?: string;
  bookOffset?: number;
  bookDuration?: number;
  sessionId?: string;
  /** Podcasts: bookId is the show, episodeId the episode. */
  episodeId?: string;
  publishedAt?: number;
  progress?: number;
  /** Podcast episodes: when you last listened to it (ms). */
  lastPlayedAt?: number;
  description?: string;
  /** Audiobooks and podcast episodes: chapters, in seconds from the start of the whole book or episode. */
  chapters?: Chapter[];
  /** Plex: the entry id inside a server playlist (needed to remove it). */
  playlistItemId?: string;
  /** Navidrome: starred / favorited on the server. */
  starred?: boolean;
  /** Loudness tags (OpenSubsonic `replayGain`), in dB; see player/replayGain.ts. */
  replayGain?: ReplayGain;
}

export interface Chapter {
  start: number;
  end: number;
  title: string;
}

export interface ReplayGain {
  trackGain?: number;
  albumGain?: number;
  /** linear sample peaks (1 = full scale) */
  trackPeak?: number;
  albumPeak?: number;
}

export interface Favorites {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
}

/** A playlist that lives on a server (Navidrome / Plex — what Plexamp shows). */
export interface ServerPlaylist {
  id: string;
  sourceId: string;
  name: string;
  trackCount?: number;
  duration?: number;
  coverUrl?: string;
  readOnly?: boolean;
}

export interface Podcast {
  id: string;
  sourceId: string;
  title: string;
  author: string;
  coverUrl?: string;
  episodeCount?: number;
  description?: string;
  /** When the show was added to the server (ms since epoch). */
  addedAt?: number;
  /** When the show last changed on the server, which is usually a new episode (ms). */
  updatedAt?: number;
  /** When you last listened to any of its episodes (ms). */
  lastPlayedAt?: number;
}

export interface HistoryEntry {
  track: Track;
  playedAt: number;
  playCount?: number;
}

export interface Album {
  id: string;
  sourceId: string;
  title: string;
  artist: string;
  artistId?: string;
  year?: number;
  coverUrl?: string;
  explicit?: 'explicit' | 'clean';
  trackCount?: number;
  /** When it was added to the library (ms epoch). */
  addedAt?: number;
  /** Its genres, as the server lists them (lib/browse.ts). */
  genres?: string[];
  /** What kind of release it is, from its tags (OpenSubsonic `releaseTypes`: "album", "single", "ep", "compilation"…). */
  releaseTypes?: string[];
  /** Navidrome: a compilation of several artists. */
  compilation?: boolean;
  /** Navidrome: your plays, last play (ms), star rating and ♥ for the album, and its record labels (smart playlist rules, lib/smartRules.ts). */
  plays?: number;
  playedAt?: number;
  rating?: number;
  starred?: boolean;
  labels?: string[];
  /** Same album found on several sources (first = preferred). */
  refs?: Album[];
}

export interface Artist {
  id: string;
  sourceId: string;
  name: string;
  coverUrl?: string;
  albumCount?: number;
  refs?: Artist[];
}

export interface Station {
  id: string;
  sourceId: string;
  name: string;
  streamUrl: string;
  homepage?: string;
  favicon?: string;
  tags?: string;
  country?: string;
  codec?: string;
  bitrate?: number;
  nowPlayingUrl?: string;
}

export interface Book {
  id: string;
  sourceId: string;
  title: string;
  author: string;
  narrator?: string;
  coverUrl?: string;
  duration?: number;
  progress?: number;
  /** Listened to the end (or marked finished on the server). */
  finished?: boolean;
  /** When the book was added to the server (ms since epoch). */
  addedAt?: number;
  /** When you last listened to it (ms). */
  lastPlayedAt?: number;
  publishedYear?: number;
  series?: string;
}

export interface SearchResults {
  artists: Artist[];
  albums: Album[];
  tracks: Track[];
  stations: Station[];
  books: Book[];
  podcasts: Podcast[];
}

export interface BookDetails {
  description?: string;
  chapters?: Chapter[];
  publisher?: string;
  genres?: string[];
  /** Where you are in the book, seconds. */
  currentTime?: number;
}

export interface BookPlayback {
  tracks: Track[];
  /** Absolute resume point within the book, seconds. */
  resumeAt: number;
}

/** Every backend implements whatever subset it supports. */
export interface MusicSource {
  config: SourceConfig;
  test(): Promise<string>;
  search?(q: string): Promise<Partial<SearchResults>>;
  getAlbums?(): Promise<Album[]>;
  getRecentAlbums?(limit?: number): Promise<Album[]>;
  getFavorites?(): Promise<Favorites>;
  setFavorite?(track: Track, on: boolean): Promise<void>;
  getArtists?(): Promise<Artist[]>;
  getArtistAlbums?(artistId: string): Promise<Album[]>;
  /** Albums by other artists where this artist is featured on a song ("Appears On"), leaving out `ownAlbumIds`. */
  getAppearsOn?(artist: { id: string; name: string }, ownAlbumIds?: string[]): Promise<Album[]>;
  getAlbumTracks?(albumId: string): Promise<Track[]>;
  /** The artist's best-known songs that are on this server, most popular first (Navidrome asks Last.fm). */
  getTopSongs?(artistName: string, count?: number): Promise<Track[]>;
  getStations?(): Promise<Station[]>;
  /** Delete one of the server's own radio stations. Navidrome only allows this for admin accounts. */
  deleteStation?(id: string): Promise<void>;
  getBooks?(): Promise<Book[]>;
  startBook?(bookId: string): Promise<BookPlayback>;
  syncBook?(track: Track, absoluteTime: number, listened: number): Promise<void>;
  getPodcasts?(): Promise<Podcast[]>;
  getEpisodes?(podcastId: string): Promise<Track[]>;
  /** The newest episodes across every show, newest first (Podcasts → Latest episodes). */
  getLatestEpisodes?(limit?: number): Promise<Track[]>;
  /** Episodes you're part way through, most recently played first (Podcasts → Continue listening). */
  getEpisodesInProgress?(): Promise<Track[]>;
  /** Mark episodes played (finished) or unplayed (back to the start), on the server. */
  setPlayed?(tracks: Track[], played: boolean): Promise<void>;
  /** A book's page: its description and chapters. */
  getBookDetails?(bookId: string): Promise<BookDetails>;
  /** Mark a book finished, or not started (back to the start). */
  setBookFinished?(bookId: string, finished: boolean): Promise<void>;
  /** Server-side play history, newest first. */
  getHistory?(): Promise<HistoryEntry[]>;
  getRecentlyPlayedAlbums?(): Promise<Album[]>;
  /**
   * Called right before playback: refresh stream URLs/tokens or open a listening session.
   * Lets saved tracks (playlists, history) keep working long after they were stored.
   */
  prepare?(track: Track): Promise<{ track: Track; startAt?: number }>;
  scrobble?(track: Track, submission: boolean): Promise<void>;
  rescan?(): Promise<void>;
  /** The server's own lyrics for a song (lib/lyrics.ts falls back to LRCLIB). */
  getLyrics?(track: Track): Promise<Lyrics | undefined>;

  // ---- server playlists (two-way: edits show up in Navidrome clients / Plexamp) ----
  getPlaylists?(): Promise<ServerPlaylist[]>;
  getPlaylistTracks?(id: string): Promise<Track[]>;
  createPlaylist?(name: string, trackIds: string[]): Promise<string>;
  addToPlaylist?(id: string, trackIds: string[]): Promise<void>;
  /** `tracks` is the current listing, so adapters can find per-entry ids. */
  removeFromPlaylist?(id: string, index: number, tracks: Track[]): Promise<void>;
  renamePlaylist?(id: string, name: string): Promise<void>;
  deletePlaylist?(id: string): Promise<void>;
}

export const SOURCE_COLORS: Record<SourceKind | 'radio', string> = {
  navidrome: '#4f8cff',
  plex: '#e5a00d',
  audiobookshelf: '#a77bf3',
  subwave: '#18c7b4',
  radio: '#ff5a5f',
};

export const SOURCE_LABELS: Record<SourceKind, string> = {
  navidrome: 'Navidrome',
  plex: 'Plex',
  audiobookshelf: 'Audiobookshelf',
  subwave: 'SUB/WAVE',
};
