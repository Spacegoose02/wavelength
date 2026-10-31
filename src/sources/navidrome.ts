import SparkMD5 from 'spark-md5';
import { getJson, http, qs, trimSlash } from '../lib/http';
import type { SongFacts } from '../lib/smartPlaylists';
import type { Album, Artist, HistoryEntry, MusicSource, SearchResults, ServerPlaylist, SourceConfig, Station, Track } from './types';

/** Navidrome (or any Subsonic-compatible server) via the Subsonic REST API. */

/** OpenSubsonic `explicitStatus`: 'explicit', 'clean', or '' when the file doesn't say. */
const rating = (v: unknown) => (v === 'explicit' || v === 'clean' ? v : undefined);
export class NavidromeSource implements MusicSource {
  private ndToken?: string;
  constructor(public config: SourceConfig) {}

  /** Navidrome's own REST API (not Subsonic) — needed for per-track play history. */
  private async native(path: string, retry = true): Promise<any> {
    const base = trimSlash(this.config.url);
    if (!this.ndToken) {
      const login = await getJson(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: this.config.username, password: this.config.password }),
      });
      this.ndToken = login.token;
    }
    const res = await http(`${base}${path}`, { headers: { 'x-nd-authorization': `Bearer ${this.ndToken}` } });
    if (res.status === 401 && retry) {
      this.ndToken = undefined;
      return this.native(path, false);
    }
    if (!res.ok) throw new Error(`${res.status} from Navidrome`);
    return res.json();
  }

  private url(method: string, params: Record<string, string | number | undefined | string[] | number[]> = {}) {
    const salt = Math.random().toString(36).slice(2, 10);
    const auth = {
      u: this.config.username ?? '',
      t: SparkMD5.hash((this.config.password ?? '') + salt),
      s: salt,
      v: '1.16.1',
      c: 'Wavelength',
      f: 'json',
    };
    return `${trimSlash(this.config.url)}/rest/${method}?${qs({ ...auth, ...params })}`;
  }

  private async call(method: string, params?: Record<string, string | number | undefined | string[] | number[]>) {
    const json = await getJson(this.url(method, params));
    const res = json['subsonic-response'];
    if (res?.status !== 'ok') throw new Error(res?.error?.message ?? 'Subsonic request failed');
    return res;
  }

  private cover(id?: string) {
    return id ? this.url('getCoverArt', { id, size: 500 }) : undefined;
  }

  private album = (a: any): Album => ({
    id: a.id,
    sourceId: this.config.id,
    title: a.name ?? a.title ?? a.album,
    artist: a.artist ?? 'Unknown artist',
    artistId: a.artistId,
    year: a.year,
    coverUrl: this.cover(a.coverArt),
    trackCount: a.songCount,
    explicit: rating(a.explicitStatus),
    addedAt: a.created ? Date.parse(a.created) : undefined,
  });

  private artist = (a: any): Artist => ({
    id: a.id,
    sourceId: this.config.id,
    name: a.name,
    coverUrl: a.coverArt ? this.cover(a.coverArt) : a.artistImageUrl,
    albumCount: a.albumCount,
  });

  private track = (s: any): Track => ({
    id: s.id,
    sourceId: this.config.id,
    kind: 'track',
    title: s.title,
    artist: s.artist ?? 'Unknown artist',
    album: s.album,
    albumId: s.albumId,
    duration: s.duration,
    trackNumber: s.track,
    discNumber: s.discNumber,
    coverUrl: this.cover(s.coverArt),
    streamUrl: this.url('stream', { id: s.id }),
    starred: !!s.starred,
    explicit: rating(s.explicitStatus),
  });

  /** Build a playable track from just an id (e.g. a SubWave like — same Navidrome library). */
  trackFromId(id: string, meta: { title?: string; artist?: string; album?: string; duration?: number } = {}): Track {
    return this.track({ id, coverArt: id, title: meta.title ?? 'Unknown', artist: meta.artist, album: meta.album, duration: meta.duration });
  }

  /**
   * Songs with what smart playlists filter on (lib/smartPlaylists.ts): every song in a genre, or without one a
   * random sample of the library (Subsonic allows 500 at a time). At most `max`.
   */
  async songsWithFacts(q: { genre?: string; fromYear?: number; toYear?: number }, max = 3000): Promise<{ track: Track; facts: SongFacts }[]> {
    const raw: any[] = [];
    if (q.genre) {
      for (let offset = 0; offset < max; offset += 500) {
        const page = (await this.call('getSongsByGenre', { genre: q.genre, count: 500, offset })).songsByGenre?.song ?? [];
        raw.push(...page);
        if (page.length < 500) break;
      }
    } else {
      const seen = new Set<string>();
      // a few random draws, so a big library gets a fair sample
      for (let i = 0; i < Math.ceil(max / 500) && raw.length < max; i++) {
        const page = (await this.call('getRandomSongs', { size: 500, fromYear: q.fromYear, toYear: q.toYear })).randomSongs?.song ?? [];
        const fresh = page.filter((s: any) => !seen.has(s.id) && seen.add(s.id));
        raw.push(...fresh);
        if (fresh.length < 50) break;
      }
    }
    const time = (v: unknown) => (typeof v === 'string' && v ? Date.parse(v) || undefined : undefined);
    return raw.map((s) => ({
      track: this.track(s),
      facts: {
        rating: Number(s.userRating) || 0,
        starred: !!s.starred,
        plays: Number(s.playCount) || 0,
        playedAt: time(s.played),
        addedAt: time(s.created),
        year: Number(s.year) || undefined,
        genre: typeof s.genre === 'string' ? s.genre : Array.isArray(s.genres) ? s.genres.map((g: { name: string }) => g.name).join('; ') : undefined,
      },
    }));
  }

  async getFavorites() {
    const r = await this.call('getStarred2');
    const s = r.starred2 ?? {};
    return {
      tracks: (s.song ?? []).map(this.track),
      albums: (s.album ?? []).map(this.album),
      artists: (s.artist ?? []).map(this.artist),
    };
  }

  async setFavorite(track: Track, on: boolean) {
    await this.call(on ? 'star' : 'unstar', { id: track.id });
  }

  async test() {
    const r = await this.call('ping');
    return `Connected — ${r.type ?? 'subsonic'} ${r.serverVersion ?? r.version}`;
  }

  async getAlbums() {
    const out: Album[] = [];
    for (let offset = 0; offset < 50_000; offset += 500) {
      const r = await this.call('getAlbumList2', { type: 'alphabeticalByName', size: 500, offset });
      const page = r.albumList2?.album ?? [];
      out.push(...page.map(this.album));
      if (page.length < 500) break;
    }
    return out;
  }

  async getRecentAlbums(limit = 24) {
    const r = await this.call('getAlbumList2', { type: 'newest', size: Math.min(limit, 500) });
    return (r.albumList2?.album ?? []).map(this.album);
  }

  async getArtists() {
    const r = await this.call('getArtists');
    return (r.artists?.index ?? []).flatMap((i: any) => i.artist ?? []).map(this.artist);
  }

  async getArtistAlbums(artistId: string) {
    const r = await this.call('getArtist', { id: artistId });
    return (r.artist?.album ?? []).map(this.album);
  }

  async getAlbumTracks(albumId: string) {
    const r = await this.call('getAlbum', { id: albumId });
    return (r.album?.song ?? []).map(this.track);
  }

  async search(q: string): Promise<Partial<SearchResults>> {
    const r = await this.call('search3', { query: q, artistCount: 20, albumCount: 30, songCount: 60 });
    const s = r.searchResult3 ?? {};
    return {
      artists: (s.artist ?? []).map(this.artist),
      albums: (s.album ?? []).map(this.album),
      tracks: (s.song ?? []).map(this.track),
    };
  }

  async getStations(): Promise<Station[]> {
    const r = await this.call('getInternetRadioStations');
    return (r.internetRadioStations?.internetRadioStation ?? []).map((s: any) => ({
      id: s.id,
      sourceId: this.config.id,
      name: s.name,
      streamUrl: s.streamUrl,
      homepage: s.homePageUrl,
    }));
  }

  async deleteStation(id: string) {
    // Navidrome answers non-admins with a Subsonic error 50 ("not authorized"), which `call` throws
    await this.call('deleteInternetRadioStation', { id });
  }

  async getHistory(): Promise<HistoryEntry[]> {
    const songs: any[] = await this.native(`/api/song?${qs({ _start: 0, _end: 150, _sort: 'play_date', _order: 'DESC' })}`);
    return songs
      .filter((s) => s.playDate)
      .map((s) => ({
        track: this.track({ ...s, track: s.trackNumber, coverArt: s.albumId }),
        playedAt: Date.parse(s.playDate),
        playCount: s.playCount,
      }));
  }

  async getRecentlyPlayedAlbums() {
    const r = await this.call('getAlbumList2', { type: 'recent', size: 30 });
    return (r.albumList2?.album ?? []).map(this.album);
  }

  /** Stream URLs embed a salted token, so regenerate on every play (saved playlists stay valid). */
  async prepare(track: Track) {
    return { track: track.kind === 'track' ? { ...track, streamUrl: this.url('stream', { id: track.id }) } : track };
  }

  async scrobble(track: Track, submission: boolean) {
    await this.call('scrobble', { id: track.id, submission: String(submission) });
  }

  async rescan() {
    await this.call('startScan');
  }

  // ---- playlists (Subsonic) ----
  async getPlaylists(): Promise<ServerPlaylist[]> {
    const r = await this.call('getPlaylists');
    return (r.playlists?.playlist ?? []).map((p: any) => ({
      id: p.id,
      sourceId: this.config.id,
      name: p.name,
      trackCount: p.songCount,
      duration: p.duration,
      coverUrl: this.cover(p.coverArt),
      readOnly: p.readonly === true || (p.owner && this.config.username && p.owner !== this.config.username),
    }));
  }

  async getPlaylistTracks(id: string) {
    const r = await this.call('getPlaylist', { id });
    return (r.playlist?.entry ?? []).map(this.track);
  }

  async createPlaylist(name: string, trackIds: string[]) {
    const r = await this.call('createPlaylist', { name, songId: trackIds });
    return r.playlist?.id ?? '';
  }

  async addToPlaylist(id: string, trackIds: string[]) {
    await this.call('updatePlaylist', { playlistId: id, songIdToAdd: trackIds });
  }

  async removeFromPlaylist(id: string, index: number) {
    await this.call('updatePlaylist', { playlistId: id, songIndexToRemove: index });
  }

  async renamePlaylist(id: string, name: string) {
    await this.call('updatePlaylist', { playlistId: id, name });
  }

  async deletePlaylist(id: string) {
    await this.call('deletePlaylist', { id });
  }
}
