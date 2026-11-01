import { publicCover } from './inbox';

/** Pure: Discord's activity object for a song. Exported for tests. */
export function activityFor(t: { title: string; artist: string; album?: string; coverUrl?: string }, position: number, duration: number, now = Date.now()) {
  const cover = publicCover(t.coverUrl);
  const start = Math.round(now - position * 1000);
  return {
    type: 2, // Listening to
    details: t.title.slice(0, 128) || 'Unknown song',
    state: (t.artist ? `by ${t.artist}` : 'Wavelength').slice(0, 128),
    timestamps: duration > 0 ? { start, end: Math.round(start + duration * 1000) } : { start },
    assets: {
      ...(cover?.startsWith('https://') && { large_image: cover.slice(0, 300) }),
      large_text: (t.album || 'Wavelength').slice(0, 128),
    },
  };
}
