import { splitGenres } from '../lib/genreNames';
import { http, qs, trimSlash } from '../lib/http';
import { withoutTrackNumber } from '../lib/trackTitles';
import { parsePlexSmart, plexTagRefs, resolvePlexTags } from '../lib/plexSmart';
import type { Album, Artist, MusicSource, PlexSmartRules, SearchResults, ServerPlaylist, SourceConfig, Track } from './types';

function clientId() {
  try {
    let id = localStorage.getItem('tonearm.plexClientId');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('tonearm.plexClientId', id);
    }
    return id;
  } catch {
    return 'tonearm-desktop';
  }
}

/** Plex Media Server (the server behind Plexamp). Uses an X-Plex-Token. */
export class PlexSource implements MusicSource {
  private sections?: string[];
  constructor(public config: SourceConfig) {}

  private get base() {
    return trimSlash(this.config.url);
  }

  private async request(method: string, path: string, params: Record<string, string | number | undefined> = {}) {
    const q = qs(params);
    const res = await http(`${this.base}${path}${q ? (path.includes('?') ? '&' : '?') + q : ''}`, {
      method,
      headers: {
        Accept: 'application/json',
        'X-Plex-Token': this.config.token ?? '',
        'X-Plex-Product': 'Wavelength',
        'X-Plex-Client-Identifier': clientId(),
      },
    });
    if (!res.ok) throw new Error(`${res.status} from Plex — ${path}`);
    const text = await res.text();
    return text ? (JSON.parse(text).MediaContainer ?? {}) : {};
  }

  private get(path: string, params: Record<string, string | number | undefined> = {}) {
    return this.request('GET', path, params);
  }

  private machineId?: string;
  /** Plex playlists reference tracks by server://<machineIdentifier>/... URIs. */
  private async itemsUri(trackIds: string[]) {
    this.machineId ??= (await this.get('/identity')).machineIdentifier;
    return `server://${this.machineId}/com.plexapp.plugins.library/library/metadata/${trackIds.join(',')}`;
  }

  private img(thumb?: string) {
    if (!thumb) return undefined;
    return `${this.base}/photo/:/transcode?${qs({ width: 500, height: 500, minSize: 1, url: thumb, 'X-Plex-Token': this.config.token })}`;
  }

  private async musicSections() {
    if (!this.sections) {
      const mc = await this.get('/library/sections');
      this.sections = (mc.Directory ?? []).filter((d: any) => d.type === 'artist').map((d: any) => String(d.key));
    }
    return this.sections!;
  }

  private album = (m: any): Album => ({
    id: String(m.ratingKey),
    sourceId: this.config.id,
    title: m.title,
    artist: m.parentTitle ?? 'Unknown artist',
    artistId: m.parentRatingKey ? String(m.parentRatingKey) : undefined,
    year: m.year,
    coverUrl: this.img(m.thumb),
    trackCount: m.leafCount,
    addedAt: m.addedAt ? m.addedAt * 1000 : undefined,
    genres: splitGenres((m.Genre ?? []).map((g: { tag?: string }) => g.tag ?? '')),
  });

  private artist = (m: any): Artist => ({
    id: String(m.ratingKey),
    sourceId: this.config.id,
    name: m.title,
    coverUrl: this.img(m.thumb),
    albumCount: m.childCount,
  });

  private track = (m: any): Track => {
    const part = m.Media?.[0]?.Part?.[0];
    return {
      id: String(m.ratingKey),
      sourceId: this.config.id,
      kind: 'track',
      title: withoutTrackNumber(m.title ?? '', m.index),
      artist: m.originalTitle ?? m.grandparentTitle ?? 'Unknown artist',
      album: m.parentTitle,
      albumId: m.parentRatingKey ? String(m.parentRatingKey) : undefined,
      duration: m.duration ? m.duration / 1000 : undefined,
      trackNumber: m.index,
      discNumber: m.parentIndex,
      coverUrl: this.img(m.parentThumb ?? m.thumb),
      streamUrl: part?.key ? `${this.base}${part.key}?${qs({ 'X-Plex-Token': this.config.token })}` : undefined,
      playlistItemId: m.playlistItemID ? String(m.playlistItemID) : undefined,
    };
  };

  // ---- playlists (the same ones Plexamp shows) ----
  async getPlaylists(): Promise<ServerPlaylist[]> {
    const mc = await this.get('/playlists', { playlistType: 'audio' });
    return (mc.Metadata ?? []).map((p: any) => ({
      id: String(p.ratingKey),
      sourceId: this.config.id,
      name: p.title,
      trackCount: p.leafCount,
      duration: p.duration ? p.duration / 1000 : undefined,
      coverUrl: this.img(p.composite ?? p.thumb),
      readOnly: p.smart === true || p.smart === 1 || p.smart === '1',
      smart: p.smart === true || p.smart === 1 || p.smart === '1',
    }));
  }

  /**
   * A smart playlist's rules (Plex keeps them as a library link in `content`, lib/plexSmart.ts), with the tag ids
   * in them (genres, styles, moods, collections) swapped for names from the library section's tag lists.
   */
  async getSmartRules(id: string): Promise<PlexSmartRules> {
    const mc = await this.get(`/playlists/${id}`);
    const content: string | undefined = mc.Metadata?.[0]?.content;
    if (!content) throw new Error('Plex didn’t send this smart playlist’s rules');
    const parsed = parsePlexSmart(content);
    const refs = plexTagRefs(parsed.rules);
    const names: Record<string, string> = {};
    const sections = parsed.section ? [parsed.section] : await this.musicSections();
    const lists = new Map<string, Promise<void>>();
    const TYPE = { artist: 8, album: 9, track: 10 } as const;
    for (const r of refs) {
      const key = `${r.kind}.${r.tag}`;
      if (lists.has(key)) continue;
      lists.set(key, Promise.all(sections.map(async (sec) => {
        const dir = await this.get(`/library/sections/${sec}/${r.tag}`, { type: TYPE[r.kind] }).catch(() => ({}));
        for (const d of (dir as any).Directory ?? []) {
          const tagId = /^\d+$/.test(String(d.key)) ? String(d.key) : String(d.fastKey ?? d.key ?? '').match(/=(\d+)(?:&|$)/)?.[1];
          if (tagId && d.title) names[`${key}:${tagId}`] = d.title;
        }
      })).then(() => undefined));
    }
    await Promise.all(lists.values());
    const dropped = [...parsed.dropped];
    const rules = resolvePlexTags(parsed.rules, names, dropped);
    return { rules, sort: parsed.sort, limit: parsed.limit, dropped };
  }

  async getPlaylistTracks(id: string) {
    const mc = await this.get(`/playlists/${id}/items`);
    return (mc.Metadata ?? []).map(this.track);
  }

  async createPlaylist(name: string, trackIds: string[]) {
    const mc = await this.request('POST', '/playlists', { type: 'audio', title: name, smart: 0, uri: await this.itemsUri(trackIds) });
    return String(mc.Metadata?.[0]?.ratingKey ?? '');
  }

  async addToPlaylist(id: string, trackIds: string[]) {
    if (trackIds.length) await this.request('PUT', `/playlists/${id}/items`, { uri: await this.itemsUri(trackIds) });
  }

  async removeFromPlaylist(id: string, index: number, tracks: Track[]) {
    const itemId = tracks[index]?.playlistItemId;
    if (!itemId) throw new Error('Plex did not report an id for this playlist entry');
    await this.request('DELETE', `/playlists/${id}/items/${itemId}`);
  }

  async renamePlaylist(id: string, name: string) {
    await this.request('PUT', `/playlists/${id}`, { title: name });
  }

  async deletePlaylist(id: string) {
    await this.request('DELETE', `/playlists/${id}`);
  }

  async test() {
    const mc = await this.get('/identity');
    const sections = await this.musicSections();
    return `Connected — Plex ${mc.version ?? ''}, ${sections.length} music librar${sections.length === 1 ? 'y' : 'ies'}`;
  }

  async getAlbums() {
    const all = await Promise.all(
      (await this.musicSections()).map((s) => this.get(`/library/sections/${s}/all`, { type: 9, sort: 'titleSort' })),
    );
    return all.flatMap((mc) => (mc.Metadata ?? []).map(this.album));
  }

  async getRecentAlbums(limit = 24) {
    const all = await Promise.all(
      (await this.musicSections()).map((s) =>
        this.get(`/library/sections/${s}/all`, { type: 9, sort: 'addedAt:desc', 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': limit }),
      ),
    );
    return all.flatMap((mc) => (mc.Metadata ?? []).map(this.album));
  }

  async getArtists() {
    const all = await Promise.all(
      (await this.musicSections()).map((s) => this.get(`/library/sections/${s}/all`, { type: 8, sort: 'titleSort' })),
    );
    return all.flatMap((mc) => (mc.Metadata ?? []).map(this.artist));
  }

  async getArtistAlbums(artistId: string) {
    const mc = await this.get(`/library/metadata/${artistId}/children`);
    return (mc.Metadata ?? []).map(this.album);
  }

  async getAlbumTracks(albumId: string) {
    const mc = await this.get(`/library/metadata/${albumId}/children`);
    return (mc.Metadata ?? []).map(this.track);
  }

  async search(q: string): Promise<Partial<SearchResults>> {
    const mc = await this.get('/hubs/search', { query: q, limit: 30 });
    const hub = (type: string) => (mc.Hub ?? []).find((h: any) => h.type === type)?.Metadata ?? [];
    return {
      artists: hub('artist').map(this.artist),
      albums: hub('album').map(this.album),
      tracks: hub('track').map(this.track),
    };
  }
}
