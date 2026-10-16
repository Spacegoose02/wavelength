import { getJson, http, qs, trimSlash } from '../lib/http';
import type { Book, BookPlayback, MusicSource, Podcast, SearchResults, SourceConfig, Track } from './types';

type Progress = Map<string, { progress: number; currentTime: number; finished: boolean }>;

/** Audiobookshelf: audiobooks + podcasts (kept separate), with progress synced back to the server. */
export class AudiobookshelfSource implements MusicSource {
  constructor(public config: SourceConfig) {}

  private get base() {
    return trimSlash(this.config.url);
  }

  private headers(json = false): Record<string, string> {
    const h: Record<string, string> = { Authorization: `Bearer ${this.config.token ?? ''}` };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  private get(path: string) {
    return getJson(`${this.base}${path}`, { headers: this.headers() });
  }

  private post(path: string, body: unknown) {
    return getJson(`${this.base}${path}`, { method: 'POST', headers: this.headers(true), body: JSON.stringify(body) });
  }

  private withToken(path: string) {
    return `${this.base}${path}${path.includes('?') ? '&' : '?'}${qs({ token: this.config.token })}`;
  }

  private cover(itemId: string) {
    return this.withToken(`/api/items/${itemId}/cover`);
  }

  private async libraries(type: 'book' | 'podcast') {
    const r = await this.get('/api/libraries');
    return (r.libraries ?? []).filter((l: any) => (l.mediaType ?? 'book') === type);
  }

  /** Keyed by itemId, or itemId:episodeId for podcast episodes. */
  private async progressMap(): Promise<Progress> {
    const me = await this.get('/api/me');
    return new Map(
      (me.mediaProgress ?? []).map((p: any) => [
        p.episodeId ? `${p.libraryItemId}:${p.episodeId}` : p.libraryItemId,
        { progress: p.isFinished ? 1 : p.progress ?? 0, currentTime: p.currentTime ?? 0, finished: !!p.isFinished },
      ]),
    );
  }

  private async items(libId: string) {
    const r = await this.get(`/api/libraries/${libId}/items?${qs({ limit: 2000, sort: 'media.metadata.title' })}`);
    return r.results ?? [];
  }

  private book = (item: any, progress?: Progress): Book => {
    const meta = item.media?.metadata ?? {};
    return {
      id: item.id,
      sourceId: this.config.id,
      title: meta.title ?? 'Untitled',
      author: meta.authorName ?? (meta.authors ?? []).map((a: any) => a.name).join(', '),
      narrator: meta.narratorName,
      coverUrl: this.cover(item.id),
      duration: item.media?.duration,
      progress: progress?.get(item.id)?.progress,
    };
  };

  private podcast = (item: any): Podcast => {
    const meta = item.media?.metadata ?? {};
    return {
      id: item.id,
      sourceId: this.config.id,
      title: meta.title ?? 'Untitled',
      author: meta.author ?? '',
      description: meta.description,
      coverUrl: this.cover(item.id),
      episodeCount: item.media?.numEpisodes ?? item.media?.episodes?.length,
    };
  };

  async test() {
    const r = await this.get('/api/libraries');
    const libs = r.libraries ?? [];
    const pods = libs.filter((l: any) => l.mediaType === 'podcast').length;
    return `Connected — ${libs.length - pods} book and ${pods} podcast librar${pods === 1 ? 'y' : 'ies'}`;
  }

  async getBooks() {
    const [libs, progress] = await Promise.all([this.libraries('book'), this.progressMap()]);
    const lists = await Promise.all(libs.map((l: any) => this.items(l.id)));
    return lists.flat().map((i: any) => this.book(i, progress));
  }

  async getPodcasts() {
    const libs = await this.libraries('podcast');
    const lists = await Promise.all(libs.map((l: any) => this.items(l.id)));
    return lists.flat().map(this.podcast);
  }

  async getEpisodes(podcastId: string): Promise<Track[]> {
    const [item, progress] = await Promise.all([this.get(`/api/items/${podcastId}?expanded=1`), this.progressMap()]);
    const show = item.media?.metadata?.title ?? '';
    return (item.media?.episodes ?? [])
      .map((e: any) => ({
        id: `${podcastId}:${e.id}`,
        sourceId: this.config.id,
        kind: 'episode' as const,
        title: e.title,
        artist: show,
        album: show,
        duration: e.audioFile?.duration ?? e.duration,
        coverUrl: this.cover(podcastId),
        bookId: podcastId,
        episodeId: e.id,
        publishedAt: e.publishedAt,
        description: e.subtitle || stripHtml(e.description ?? '').slice(0, 220),
        progress: progress.get(`${podcastId}:${e.id}`)?.progress,
      }))
      .sort((a: Track, b: Track) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
  }

  async search(q: string): Promise<Partial<SearchResults>> {
    const libs = (await this.get('/api/libraries')).libraries ?? [];
    const results = await Promise.all(libs.map((l: any) => this.get(`/api/libraries/${l.id}/search?${qs({ q, limit: 20 })}`)));
    return {
      books: results.flatMap((r: any) => (r.book ?? []).map((b: any) => this.book(b.libraryItem))),
      podcasts: results.flatMap((r: any) => (r.podcast ?? []).map((p: any) => this.podcast(p.libraryItem))),
    };
  }

  private session(path: string) {
    return this.post(path, {
      deviceInfo: { clientName: 'Wavelength', deviceId: 'tonearm-desktop' },
      mediaPlayer: 'html5',
      forceDirectPlay: true,
      supportedMimeTypes: ['audio/flac', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/aac', 'audio/webm'],
    });
  }

  async startBook(bookId: string): Promise<BookPlayback> {
    const s = await this.session(`/api/items/${bookId}/play`);
    const cover = this.cover(bookId);
    const tracks: Track[] = (s.audioTracks ?? []).map((t: any, i: number) => ({
      id: `${bookId}:${i}`,
      sourceId: this.config.id,
      kind: 'book',
      title: s.audioTracks.length > 1 ? `${s.displayTitle} — part ${i + 1}` : s.displayTitle,
      artist: s.displayAuthor ?? '',
      album: s.displayTitle,
      duration: t.duration,
      coverUrl: cover,
      streamUrl: this.withToken(t.contentUrl),
      bookId,
      bookOffset: t.startOffset ?? 0,
      bookDuration: s.duration,
      sessionId: s.id,
    }));
    return { tracks, resumeAt: s.currentTime ?? 0 };
  }

  /** Episodes are stored without a session; open one (and find the resume point) at play time. */
  async prepare(track: Track) {
    if (track.kind !== 'episode' || !track.bookId || !track.episodeId) return { track };
    const s = await this.session(`/api/items/${track.bookId}/play/${track.episodeId}`);
    const audio = s.audioTracks?.[0];
    if (!audio) throw new Error('Episode has no audio file');
    const resume = s.currentTime ?? 0;
    const finished = track.duration && resume > track.duration - 15;
    return {
      track: { ...track, streamUrl: this.withToken(audio.contentUrl), sessionId: s.id, bookOffset: 0, bookDuration: s.duration },
      startAt: finished ? 0 : resume,
    };
  }

  async syncBook(track: Track, absoluteTime: number, listened: number) {
    if (!track.sessionId) return;
    await http(`${this.base}/api/session/${track.sessionId}/sync`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ currentTime: absoluteTime, timeListened: listened, duration: track.bookDuration }),
    });
  }
}

function stripHtml(s: string) {
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
