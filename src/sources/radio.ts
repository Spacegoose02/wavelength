import { getJson, http, hubEndpoint, isTauri, qs } from '../lib/http';
import { readIcyTitle } from '../lib/icy';
import type { Station, Track } from './types';

const RB = 'https://de1.api.radio-browser.info/json';

const fromRB = (s: any): Station => ({
  id: s.stationuuid,
  sourceId: 'radio',
  name: s.name.trim(),
  streamUrl: s.url_resolved || s.url,
  homepage: s.homepage,
  favicon: s.favicon || undefined,
  tags: s.tags,
  country: s.countrycode,
  codec: s.codec,
  bitrate: s.bitrate,
});

/** radio-browser.info — free, open directory of ~50k internet radio stations. */
export const radioBrowser = {
  async search(name: string, tag?: string) {
    const r = await getJson<any[]>(`${RB}/stations/search?${qs({ name, tag, limit: 60, hidebroken: true, order: 'clickcount', reverse: true })}`);
    return r.map(fromRB);
  },
  /** Popular stations with this tag ("hip hop", "jazz"…). */
  async byTag(tag: string, limit = 8) {
    const r = await getJson<any[]>(`${RB}/stations/bytag/${encodeURIComponent(tag)}?${qs({ limit, hidebroken: true, order: 'clickcount', reverse: true })}`);
    return r.map(fromRB);
  },
  async top() {
    const r = await getJson<any[]>(`${RB}/stations/topclick/60?hidebroken=true`);
    return r.map(fromRB);
  },
};

export function stationToTrack(s: Station): Track {
  return {
    id: `radio:${s.id}`,
    sourceId: s.sourceId,
    kind: 'radio',
    title: s.name,
    artist: 'Live radio',
    coverUrl: s.favicon,
    streamUrl: s.streamUrl,
    nowPlayingUrl: s.nowPlayingUrl ?? guessIcecastStatus(s.streamUrl),
  };
}

function guessIcecastStatus(streamUrl: string) {
  try {
    return `${new URL(streamUrl).origin}/status-json.xsl`;
  } catch {
    return undefined;
  }
}

/** Understands Icecast, AzuraCast, and simple {title, artist} style now-playing JSON. */
export function parseNowPlaying(json: any, streamUrl?: string): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  if (json.icestats) {
    const src = ([] as any[]).concat(json.icestats.source ?? []);
    const path = streamUrl ? safePath(streamUrl) : undefined;
    const match = src.find((s) => path && s.listenurl && safePath(s.listenurl) === path) ?? src[0];
    return match?.title || (match?.artist ? `${match.artist} — ${match.title ?? ''}` : undefined);
  }
  const song = json.now_playing?.song ?? json.nowPlaying ?? json.now_playing ?? json.current ?? json.track ?? json.song ?? json;
  if (typeof song === 'string') return song;
  const title = song?.title ?? song?.name;
  const artist = song?.artist ?? song?.artists;
  if (title && artist) return `${Array.isArray(artist) ? artist.join(', ') : artist} — ${title}`;
  return title ?? song?.text ?? undefined;
}

/** SubWave-style `{ nowPlaying: { coverUrl | subsonic_id } }` → absolute artwork URL. */
export function parseNowPlayingCover(json: any, endpoint: string): string | undefined {
  const np = json?.nowPlaying;
  if (!np || typeof np !== 'object') return undefined;
  try {
    if (np.coverUrl) return new URL(np.coverUrl, new URL(endpoint).origin + '/').href;
    const id = np.subsonic_id ?? np.id;
    // endpoint is <api>/now-playing → sibling <api>/cover/<id>
    return id ? new URL(`cover/${encodeURIComponent(id)}`, endpoint).href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The song title a station sends inside its stream (ICY metadata, lib/icy.ts) — what most Shoutcast and
 * Icecast stations offer even when they have no now-playing page. `null` when this station doesn't send
 * titles in its stream (or there's no way to ask), else the title ('' while it sends none).
 *
 * The apps read the stream directly; a browser can't (no CORS, and the `icy-metaint` header is hidden), so it
 * asks the signed-in Hub (`/api/radio/now-playing`), which is also the fallback for the old Shoutcast servers
 * that answer `ICY 200 OK`, which the apps' HTTP client refuses.
 */
export async function streamTitle(streamUrl: string): Promise<string | null> {
  if (!/^https?:/i.test(streamUrl) || /\.m3u8(\?|$)/i.test(streamUrl)) return null; // HLS has no ICY
  if (isTauri) {
    try {
      const res = await http(streamUrl, { headers: { 'Icy-MetaData': '1' }, signal: AbortSignal.timeout(8_000) });
      if (!res.ok) throw new Error(String(res.status));
      return (await readIcyTitle(res.headers.get('icy-metaint'), res.body)) ?? null;
    } catch {
      /* fall through to the Hub */
    }
  }
  const hub = hubEndpoint();
  if (!hub) return null;
  const r = await getJson<{ icy: boolean; title: string | null }>(`${hub.url}/api/radio/now-playing?${qs({ url: streamUrl })}`, {
    headers: { authorization: `Bearer ${hub.token}` },
  });
  return r.icy ? (r.title ?? '') : null;
}

function safePath(u: string) {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
}
