import { getJson, http, qs, trimSlash } from '../lib/http';

export interface DeezerResult {
  type: 'track' | 'album' | 'artist' | 'playlist';
  id: number;
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  duration?: number;
  link: string;
  trackCount?: number;
  /** Deezer artist id, so albums and songs can link through to the artist's page. */
  artistId?: number;
  /** Songs: the album they're on, so they can link through to it. */
  albumId?: number;
  /** Songs: 30-second clip. */
  preview?: string;
  /** Songs on an album page: position on the album. */
  trackNumber?: number;
  /** Albums: "album" | "single" | "ep" | "compile". */
  recordType?: string;
  /** Albums: YYYY-MM-DD. */
  releaseDate?: string;
  /** Artists and playlists: Deezer follower count. */
  fans?: number;
}

const DZ = 'https://api.deezer.com';

function toTrack(t: any, album?: any): DeezerResult {
  const al = t.album ?? album;
  return {
    type: 'track',
    id: t.id,
    title: t.title,
    artist: t.artist?.name,
    artistId: t.artist?.id,
    album: al?.title,
    albumId: al?.id,
    cover: al?.cover_medium,
    duration: t.duration,
    link: t.link,
    preview: t.preview || undefined,
    trackNumber: t.track_position,
  };
}

function toAlbum(a: any, artist?: any): DeezerResult {
  const ar = a.artist ?? artist;
  return {
    type: 'album',
    id: a.id,
    title: a.title,
    artist: ar?.name,
    artistId: ar?.id,
    cover: a.cover_medium,
    link: a.link ?? `https://www.deezer.com/album/${a.id}`,
    trackCount: a.nb_tracks,
    recordType: a.record_type,
    releaseDate: a.release_date,
  };
}

function toArtist(a: any): DeezerResult {
  return {
    type: 'artist',
    id: a.id,
    title: a.name,
    artist: a.name,
    artistId: a.id,
    cover: a.picture_medium,
    link: a.link ?? `https://www.deezer.com/artist/${a.id}`,
    fans: a.nb_fan,
  };
}

/** A playlist: `artist` holds whoever made it (a user or Deezer's editors). */
function toPlaylist(p: any): DeezerResult {
  return {
    type: 'playlist',
    id: p.id,
    title: p.title,
    artist: (p.creator ?? p.user)?.name ?? 'Deezer',
    cover: p.picture_medium,
    link: p.link ?? `https://www.deezer.com/playlist/${p.id}`,
    trackCount: p.nb_tracks,
    fans: p.fans,
  };
}

/** Search the public Deezer catalog (no login needed): artists, albums, playlists, then songs. */
export async function searchDeezer(q: string): Promise<DeezerResult[]> {
  const [artists, albums, playlists, tracks] = await Promise.all([
    getJson(`${DZ}/search/artist?${qs({ q, limit: 4 })}`).catch(() => ({ data: [] })),
    getJson(`${DZ}/search/album?${qs({ q, limit: 24 })}`),
    getJson(`${DZ}/search/playlist?${qs({ q, limit: 8 })}`).catch(() => ({ data: [] })),
    getJson(`${DZ}/search?${qs({ q, limit: 40 })}`),
  ]);
  return [
    ...(artists.data ?? []).map(toArtist),
    ...(albums.data ?? []).map((a: any) => toAlbum(a)),
    ...(playlists.data ?? []).map(toPlaylist),
    ...(tracks.data ?? []).map((t: any) => toTrack(t)),
  ];
}

export interface DeezerArtistPage {
  artist: DeezerResult;
  /** Most played songs on Deezer right now. */
  top: DeezerResult[];
  /** Every release (albums, EPs, singles, compilations), newest first. */
  albums: DeezerResult[];
  /** Similar artists, to keep exploring. */
  related: DeezerResult[];
  /** Public playlists the artist is on. */
  playlists: DeezerResult[];
}

/** Everything for an artist page: top songs, discography, related artists and playlists they're on. */
export async function getDeezerArtist(id: number): Promise<DeezerArtistPage> {
  const [a, top, albums, related, playlists] = await Promise.all([
    getJson(`${DZ}/artist/${id}`),
    getJson(`${DZ}/artist/${id}/top?${qs({ limit: 10 })}`).catch(() => ({ data: [] })),
    getJson(`${DZ}/artist/${id}/albums?${qs({ limit: 200 })}`).catch(() => ({ data: [] })),
    getJson(`${DZ}/artist/${id}/related?${qs({ limit: 12 })}`).catch(() => ({ data: [] })),
    getJson(`${DZ}/artist/${id}/playlists?${qs({ limit: 12 })}`).catch(() => ({ data: [] })),
  ]);
  // Deezer answers 200 with { error } for unknown ids
  if (a?.error) throw new Error(a.error.message ?? 'Deezer has no such artist');
  return {
    artist: toArtist(a),
    top: (top.data ?? []).map((t: any) => toTrack(t)),
    albums: (albums.data ?? [])
      .map((x: any) => toAlbum(x, a))
      .sort((x: DeezerResult, y: DeezerResult) => (y.releaseDate ?? '').localeCompare(x.releaseDate ?? '')),
    related: (related.data ?? []).map(toArtist),
    playlists: (playlists.data ?? []).map(toPlaylist),
  };
}

export interface DeezerAlbumPage {
  album: DeezerResult;
  tracks: DeezerResult[];
  label?: string;
}

/** Everything for an album page: its tracklist (with previews) in album order. */
export async function getDeezerAlbum(id: number): Promise<DeezerAlbumPage> {
  const a = await getJson(`${DZ}/album/${id}`);
  if (a?.error) throw new Error(a.error.message ?? 'Deezer has no such album');
  return {
    album: toAlbum(a),
    label: a.label,
    // the embedded tracklist has no album object or position — fill both in from the album
    tracks: (a.tracks?.data ?? []).map((t: any, i: number) => ({ ...toTrack(t, a), trackNumber: t.track_position ?? i + 1 })),
  };
}

export interface DeezerPlaylistPage {
  playlist: DeezerResult;
  tracks: DeezerResult[];
  description?: string;
}

/** Everything for a playlist page. Long playlists are paged in, up to 2,000 songs. */
export async function getDeezerPlaylist(id: number): Promise<DeezerPlaylistPage> {
  const p = await getJson(`${DZ}/playlist/${id}`);
  if (p?.error) throw new Error(p.error.message ?? 'Deezer has no such playlist (it may be private)');
  const raw: any[] = [...(p.tracks?.data ?? [])];
  // the embedded tracklist stops at a few hundred songs — fetch the rest from /tracks
  while (raw.length < Math.min(p.nb_tracks ?? 0, 2000)) {
    const page = await getJson(`${DZ}/playlist/${id}/tracks?${qs({ index: raw.length, limit: 100 })}`).catch(() => null);
    if (!page?.data?.length) break;
    raw.push(...page.data);
  }
  return {
    playlist: toPlaylist(p),
    description: p.description || undefined,
    tracks: raw.map((t, i) => ({ ...toTrack(t), trackNumber: i + 1 })),
  };
}

/** Talks to a deemix web server (deemix-gui / deemix-docker). */
export class Deemix {
  constructor(private url: string, private arl?: string) {}

  private get base() {
    return trimSlash(this.url);
  }

  private async post(path: string, body: unknown) {
    const res = await http(`${this.base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    if (!res.ok) throw new Error(json?.errid ?? json?.error ?? `${res.status} from deemix`);
    return json;
  }

  async login() {
    if (!this.arl) throw new Error('deemix is not logged in and no ARL is set in Settings');
    const r = await this.post('/api/loginArl', { arl: this.arl, force: true, child: 0 });
    if (r?.status === 0 || r?.status === false) throw new Error('deemix rejected the ARL');
  }

  /** bitrate: 9 = FLAC, 3 = MP3 320, 1 = MP3 128 */
  async addToQueue(link: string, bitrate?: number) {
    const send = async () => {
      const r = await this.post('/api/addToQueue', { url: link, bitrate: bitrate ?? null });
      // deemix answers 200 with { result: false, errid } on failure — treat that as an error
      if (r?.result === false) throw new Error(r?.errid ?? r?.data?.error ?? 'deemix refused the download');
      return r;
    };
    try {
      return await send();
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      if (!/NotLoggedIn|login/i.test(msg)) throw new Error(friendly(msg));
      // each Wavelength session starts logged out on deemix's side — log in with the ARL and retry
      if (!this.arl) throw new Error('deemix isn\'t logged in — add your Deezer ARL in Settings → deemix');
      await this.login();
      return send();
    }
  }

  async getQueue(): Promise<any> {
    return getJson(`${this.base}/api/getQueue`);
  }

  async test() {
    const r = await getJson(`${this.base}/api/connect`);
    let user = r?.currentUser?.name;
    if (!user && this.arl) {
      await this.login();
      user = (await getJson(`${this.base}/api/connect`).catch(() => null))?.currentUser?.name ?? 'your ARL';
    }
    return user ? `Connected to deemix, logged in as ${user}` : 'Reached deemix, but it is NOT logged in — add your Deezer ARL below';
  }
}

function friendly(msg: string) {
  if (/fetch|connect|ECONNREFUSED|error sending request/i.test(msg)) return "Can't reach deemix — check its URL in Settings";
  return `deemix: ${msg}`;
}
