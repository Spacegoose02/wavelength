import { HttpError } from './http.ts';

/**
 * Cover art lookups for the art picker (routes/artwork.ts): Deezer, Apple Music, MusicBrainz's Cover Art
 * Archive, and fanart.tv when the Hub has a key for it. Each one that fails or times out is left out, so one
 * service being down never empties the picker.
 */

/** Where each lookup goes. Tests point these at a fake server. */
export const ART_APIS = {
  deezer: 'https://api.deezer.com',
  itunes: 'https://itunes.apple.com',
  musicbrainz: 'https://musicbrainz.org',
  caa: 'https://coverartarchive.org',
  fanart: 'https://webservice.fanart.tv',
};

export interface ArtCandidate {
  source: string;
  /** What the service calls it, so the admin can tell a deluxe edition from the original. */
  title: string;
  subtitle?: string;
  thumb: string;
  url: string;
}

const TIMEOUT_MS = 12_000;
const MAX_IMAGE = 15 * 1024 * 1024;

async function getJson(url: string, ua: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json', 'user-agent': ua } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

const q = (s: string) => `"${s.replace(/["\\]/g, ' ')}"`;

async function deezerAlbums(artist: string, album: string, ua: string): Promise<ArtCandidate[]> {
  const search = (query: string) => getJson(`${ART_APIS.deezer}/search/album?limit=8&q=${encodeURIComponent(query)}`, ua);
  let r = await search(`artist:${q(artist)} album:${q(album)}`);
  if (!r?.data?.length) r = await search(`${artist} ${album}`);
  return (r?.data ?? [])
    .filter((a: any) => a.cover_xl)
    .map((a: any) => ({ source: 'Deezer', title: a.title, subtitle: a.artist?.name, thumb: a.cover_medium ?? a.cover_xl, url: a.cover_xl }));
}

async function deezerArtists(artist: string, ua: string): Promise<ArtCandidate[]> {
  const r = await getJson(`${ART_APIS.deezer}/search/artist?limit=8&q=${encodeURIComponent(artist)}`, ua);
  return (r?.data ?? [])
    // Deezer's grey placeholder has no image id: .../images/artist//500x500-...
    .filter((a: any) => a.picture_xl && !String(a.picture_xl).includes('/artist//'))
    .map((a: any) => ({ source: 'Deezer', title: a.name, subtitle: a.nb_fan ? `${Number(a.nb_fan).toLocaleString('en')} fans` : undefined, thumb: a.picture_medium ?? a.picture_xl, url: a.picture_xl }));
}

async function appleAlbums(artist: string, album: string, ua: string): Promise<ArtCandidate[]> {
  const r = await getJson(`${ART_APIS.itunes}/search?entity=album&limit=8&term=${encodeURIComponent(`${artist} ${album}`)}`, ua);
  // the 100x100 link takes any size; 1200 is plenty and every album has it
  return (r?.results ?? [])
    .filter((a: any) => typeof a.artworkUrl100 === 'string')
    .map((a: any) => ({
      source: 'Apple Music',
      title: a.collectionName,
      subtitle: [a.artistName, String(a.releaseDate ?? '').slice(0, 4)].filter(Boolean).join(' · '),
      thumb: a.artworkUrl100.replace(/\/\d+x\d+bb\./, '/300x300bb.'),
      url: a.artworkUrl100.replace(/\/\d+x\d+bb\./, '/1200x1200bb.'),
    }));
}

async function musicbrainzReleaseGroups(artist: string, album: string, ua: string) {
  const r = await getJson(`${ART_APIS.musicbrainz}/ws/2/release-group/?fmt=json&limit=5&query=${encodeURIComponent(`releasegroup:${q(album)} AND artist:${q(artist)}`)}`, ua);
  return (r?.['release-groups'] ?? []).map((g: any) => ({
    id: String(g.id),
    title: String(g.title ?? ''),
    subtitle: [g['artist-credit']?.[0]?.name, String(g['first-release-date'] ?? '').slice(0, 4)].filter(Boolean).join(' · '),
  })) as { id: string; title: string; subtitle: string }[];
}

async function coverArtArchive(groups: { id: string; title: string; subtitle: string }[], ua: string): Promise<ArtCandidate[]> {
  const found = await Promise.all(
    groups.map(async (g): Promise<ArtCandidate | null> => {
      // 404 = no art uploaded for this one
      const r = await getJson(`${ART_APIS.caa}/release-group/${g.id}`, ua).catch(() => null);
      const img = (r?.images ?? []).find((i: any) => i.front) ?? r?.images?.[0];
      if (!img?.image) return null;
      const t = img.thumbnails ?? {};
      return { source: 'Cover Art Archive', title: g.title, subtitle: g.subtitle, thumb: t['250'] ?? t.small ?? img.image, url: t['1200'] ?? img.image };
    }),
  );
  return found.filter((c): c is ArtCandidate => !!c);
}

const fanartPreview = (url: string) => url.replace('/fanart/', '/preview/');

async function fanartAlbums(groups: { id: string; title: string; subtitle: string }[], key: string, ua: string): Promise<ArtCandidate[]> {
  const found = await Promise.all(
    groups.map(async (g) => {
      const r = await getJson(`${ART_APIS.fanart}/v3/music/albums/${g.id}?api_key=${encodeURIComponent(key)}`, ua).catch(() => null);
      const covers = (r?.albums?.[g.id]?.albumcover ?? []) as { url?: string }[];
      return covers.filter((c) => c.url).map((c) => ({ source: 'fanart.tv', title: g.title, subtitle: g.subtitle, thumb: fanartPreview(c.url!), url: c.url! }));
    }),
  );
  return found.flat();
}

async function fanartArtists(artist: string, key: string, ua: string): Promise<ArtCandidate[]> {
  const r = await getJson(`${ART_APIS.musicbrainz}/ws/2/artist/?fmt=json&limit=3&query=${encodeURIComponent(`artist:${q(artist)}`)}`, ua);
  const people = ((r?.artists ?? []) as any[]).map((a) => ({ id: String(a.id), name: String(a.name ?? ''), note: a.disambiguation as string | undefined }));
  const found = await Promise.all(
    people.map(async (p) => {
      const f = await getJson(`${ART_APIS.fanart}/v3/music/${p.id}?api_key=${encodeURIComponent(key)}`, ua).catch(() => null);
      return ((f?.artistthumb ?? []) as { url?: string }[]).filter((t) => t.url).map((t) => ({ source: 'fanart.tv', title: p.name, subtitle: p.note || undefined, thumb: fanartPreview(t.url!), url: t.url! }));
    }),
  );
  return found.flat();
}

/** Candidates from every service, plus the names of the ones that didn't answer. */
export async function findArt(kind: 'album' | 'artist', artist: string, album: string, opts: { fanartKey: string; version: string }) {
  const ua = `Wavelength-Hub/${opts.version} ( https://github.com/Spacegoose02/wavelength )`;
  const lookups: [string, () => Promise<ArtCandidate[]>][] =
    kind === 'artist'
      ? [['Deezer', () => deezerArtists(artist, ua)], ...(opts.fanartKey ? [['fanart.tv', () => fanartArtists(artist, opts.fanartKey, ua)] as [string, () => Promise<ArtCandidate[]>]] : [])]
      : [
          ['Deezer', () => deezerAlbums(artist, album, ua)],
          ['Apple Music', () => appleAlbums(artist, album, ua)],
          [
            opts.fanartKey ? 'MusicBrainz / fanart.tv' : 'MusicBrainz',
            async () => {
              const groups = await musicbrainzReleaseGroups(artist, album, ua);
              const [caa, fan] = await Promise.all([coverArtArchive(groups, ua), opts.fanartKey ? fanartAlbums(groups, opts.fanartKey, ua) : []]);
              return [...caa, ...fan];
            },
          ],
        ];
  const failed: string[] = [];
  const lists = await Promise.all(
    lookups.map(([name, fn]) =>
      fn().catch(() => {
        failed.push(name);
        return [] as ArtCandidate[];
      }),
    ),
  );
  const seen = new Set<string>();
  const candidates = lists.flat().filter((c) => !seen.has(c.url) && seen.add(c.url));
  return { candidates, failed };
}

// ---- images ----

/** The file type from the first bytes: only JPEG, PNG and WebP are kept. */
export function imageType(b: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Download an image the admin picked. http(s) only, 15 MB at most, and it has to be a picture. */
export async function downloadImage(raw: string): Promise<{ bytes: Buffer; type: 'jpg' | 'png' | 'webp' }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'Send an image link');
  }
  let res: Response | undefined;
  for (let hop = 0; hop < 5; hop++) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new HttpError(400, 'Image links start with https://');
    res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'Mozilla/5.0 Wavelength-Hub', accept: 'image/*' } }).catch(() => {
      throw new HttpError(502, `Couldn't download the image from ${url.hostname}`);
    });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!next) break;
    url = new URL(next, url);
  }
  if (!res || !res.ok) throw new HttpError(502, `${url.hostname} didn't send the image (${res?.status ?? 'too many redirects'})`);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_IMAGE) throw new HttpError(413, 'That image is bigger than 15 MB');
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_IMAGE) throw new HttpError(413, 'That image is bigger than 15 MB');
  const type = imageType(bytes);
  if (!type) throw new HttpError(415, 'That link is not a JPEG, PNG or WebP image');
  return { bytes, type };
}

/** An uploaded image: base64, with or without a `data:` prefix. */
export function decodeImage(data: string): { bytes: Buffer; type: 'jpg' | 'png' | 'webp' } {
  const bytes = Buffer.from(data.replace(/^data:[^,]*,/, ''), 'base64');
  if (!bytes.length) throw new HttpError(400, 'Send an image');
  if (bytes.length > MAX_IMAGE) throw new HttpError(413, 'That image is bigger than 15 MB');
  const type = imageType(bytes);
  if (!type) throw new HttpError(415, 'Upload a JPEG, PNG or WebP image');
  return { bytes, type };
}
