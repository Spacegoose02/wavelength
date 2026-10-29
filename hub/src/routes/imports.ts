import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { HttpError, signedIn, str } from '../http.ts';

/**
 * Playlist import (docs/USERS-AND-ADMIN.md Phase 5): YouTube and YouTube Music playlists are read with the
 * Hub's yt-dlp (titles only, nothing is downloaded); the app matches them to the library. Other sources
 * (Deezer, Spotify, CSV, M3U) are read by the app itself.
 */

const YOUTUBE = /^https:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i;

export function importRoutes(app: FastifyInstance, { ytdlp }: Ctx) {
  app.post('/api/import/youtube', async (req) => {
    signedIn(req);
    const url = str(req.body, 'url', 500);
    if (!YOUTUBE.test(url)) throw new HttpError(400, 'Paste a YouTube or YouTube Music playlist link');
    const entries = await ytdlp.search(url);
    if (entries.length > 5000) entries.length = 5000;
    return {
      tracks: entries.map((e) => {
        // YouTube Music's auto-made channels are "Artist - Topic"; music videos are often "Artist - Title"
        let artist = e.channel.replace(/\s+-\s+Topic$/i, '');
        let title = e.title;
        const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(title);
        if (m && (!/ - Topic$/i.test(e.channel) || !artist)) [artist, title] = [m[1], m[2]];
        return { title: title.replace(/\s*[([](official|lyric|audio|video|visualizer|hd|4k)[^)\]]*[)\]]/gi, '').trim(), artist, duration: e.duration };
      }),
    };
  });
}
