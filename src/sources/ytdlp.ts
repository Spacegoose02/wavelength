import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '../lib/http';

export interface YtResult {
  id: string;
  title: string;
  channel: string;
  url: string;
  duration?: number;
  thumbnail?: string;
}

export interface YtProgress {
  id: string;
  status: 'downloading' | 'processing' | 'done' | 'error';
  percent?: number;
  message?: string;
}

const need = () => {
  if (!isTauri) throw new Error('yt-dlp only works in the desktop app');
};

export const ytdlp = {
  async version(bin?: string) {
    need();
    return invoke<string>('ytdlp_version', { bin: bin || null });
  },
  /** Search YouTube, or expand any URL yt-dlp supports (playlist, Bandcamp album, SoundCloud set…). */
  async search(query: string, bin?: string): Promise<YtResult[]> {
    need();
    const json = JSON.parse(await invoke<string>('ytdlp_search', { query, bin: bin || null }));
    const entries: any[] = json.entries ?? [json];
    return entries
      .filter((e) => e && (e.url || e.webpage_url || e.id))
      .map((e) => ({
        id: e.id,
        title: e.title ?? e.id,
        channel: e.channel ?? e.uploader ?? e.artist ?? '',
        url: e.webpage_url ?? (e.url?.startsWith('http') ? e.url : `https://www.youtube.com/watch?v=${e.id}`),
        duration: e.duration ?? undefined,
        thumbnail: e.thumbnails?.at(-1)?.url ?? e.thumbnail,
      }));
  },
  download(args: { id: string; url: string; outDir: string; format: string; bin?: string }) {
    need();
    return invoke<void>('ytdlp_download', { ...args, bin: args.bin || null });
  },
  /** Log in to a \\server\share download folder (if creds given) and check it's writable. */
  async connectShare(path: string, user?: string, pass?: string) {
    need();
    return invoke<string>('connect_share', { path, user: user || null, pass: pass || null });
  },
  onProgress(fn: (p: YtProgress) => void) {
    if (!isTauri) return Promise.resolve(() => {});
    return listen<YtProgress>('ytdlp-progress', (e) => fn(e.payload));
  },
};
