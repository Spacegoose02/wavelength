/**
 * Spotify's public embed page (open.spotify.com/embed/playlist/…) carries a playlist's name and first 100
 * or so songs in its __NEXT_DATA__ script, with no Spotify login or API key. Used by playlist import and
 * by Discover's New Music Friday chart.
 */
export interface SpotifyEmbed {
  name?: string;
  songs: { title: string; artist: string; preview?: string }[];
}

const clean = (s: unknown) => (typeof s === 'string' ? s.trim() : '');

export function readSpotifyEmbed(html: string): SpotifyEmbed {
  const json = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  const entity = json ? JSON.parse(json)?.props?.pageProps?.state?.data?.entity : undefined;
  const list: any[] = entity?.trackList ?? [];
  return {
    name: entity?.name ?? entity?.title,
    songs: list
      .map((t) => ({ title: clean(t.title), artist: clean(t.subtitle).split(/,\s*/)[0], preview: clean(t.audioPreview?.url) || undefined }))
      .filter((s) => s.title && s.artist),
  };
}
