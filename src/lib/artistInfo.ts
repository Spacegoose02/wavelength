/**
 * Artist bios and song credits from open sources, no keys needed: MusicBrainz (who the artist is, members,
 * links, and a song's writers, producers and players) and Wikipedia (the story), found through Wikidata so the
 * right "Genesis" comes back. Results are kept for a week on this device. MusicBrainz asks for at most one
 * request a second, so calls to it queue.
 */
import { http, isTauri } from './http';
import type { Track } from '../sources/types';

const MB = 'https://musicbrainz.org/ws/2';
const DAY = 86_400_000;

export interface ArtistBio {
  name: string;
  /** Wikipedia's opening paragraphs, plain text. */
  summary?: string;
  wikipedia?: string;
  image?: string;
  /** "Group", "Person"… */
  type?: string;
  area?: string;
  began?: string;
  ended?: string;
  members: { name: string; years?: string; current: boolean }[];
  links: { label: string; url: string }[];
  mbid?: string;
}

export interface Credit {
  role: string;
  names: string[];
}

// ---- cache ----

const mem = new Map<string, { at: number; v: unknown }>();
function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = mem.get(key) ?? (() => {
    try {
      const raw = localStorage.getItem(`wl.info.${key}`);
      return raw ? (JSON.parse(raw) as { at: number; v: unknown }) : undefined;
    } catch {
      return undefined;
    }
  })();
  if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.v as T);
  return load().then((v) => {
    const e = { at: Date.now(), v };
    mem.set(key, e);
    try {
      localStorage.setItem(`wl.info.${key}`, JSON.stringify(e));
    } catch {
      /* storage full: memory only */
    }
    return v;
  });
}

// ---- MusicBrainz, one request a second ----

let mbQueue: Promise<unknown> = Promise.resolve();
function mb<T>(path: string): Promise<T> {
  const run = mbQueue.then(async () => {
    const res = await http(`${MB}${path}${path.includes('?') ? '&' : '?'}fmt=json`, { headers: { accept: 'application/json', ...(isTauri && { 'user-agent': 'Wavelength ( https://github.com/Spacegoose02/wavelength )' }) } });
    if (!res.ok) throw new Error(`MusicBrainz ${res.status}`);
    return (await res.json()) as T;
  });
  mbQueue = run.catch(() => undefined).then(() => new Promise((r) => setTimeout(r, 1100)));
  return run;
}

const q = (s: string) => `"${s.replace(/["\\]/g, ' ')}"`;
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

interface MbRelation {
  type: string;
  direction?: string;
  begin?: string | null;
  end?: string | null;
  ended?: boolean;
  attributes?: string[];
  artist?: { name: string };
  url?: { resource: string };
  work?: { title: string; relations?: MbRelation[] };
}
interface MbArtist {
  id: string;
  name: string;
  score?: number;
  type?: string;
  area?: { name: string };
  'begin-area'?: { name: string };
  'life-span'?: { begin?: string; end?: string; ended?: boolean };
  relations?: MbRelation[];
}

const LINKS: Record<string, string> = {
  'official homepage': 'Website',
  bandcamp: 'Bandcamp',
  soundcloud: 'SoundCloud',
  youtube: 'YouTube',
  'social network': '',
  'streaming music': '',
};

function linkLabel(r: MbRelation): string | null {
  const url = r.url?.resource;
  if (!url) return null;
  if (r.type in LINKS && LINKS[r.type]) return LINKS[r.type];
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();
  const known: Record<string, string> = {
    'instagram.com': 'Instagram', 'twitter.com': 'X', 'x.com': 'X', 'facebook.com': 'Facebook', 'tiktok.com': 'TikTok',
    'open.spotify.com': 'Spotify', 'music.apple.com': 'Apple Music', 'deezer.com': 'Deezer', 'tidal.com': 'TIDAL',
  };
  return known[host] ?? null;
}

async function wikipediaFor(a: MbArtist): Promise<{ summary?: string; url?: string; image?: string }> {
  const wd = a.relations?.find((r) => r.type === 'wikidata')?.url?.resource.split('/').pop();
  let title: string | undefined;
  if (wd) {
    const res = await http(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(wd)}&props=sitelinks&sitefilter=enwiki&format=json&origin=*`);
    if (res.ok) {
      const j = (await res.json()) as { entities?: Record<string, { sitelinks?: { enwiki?: { title: string } } }> };
      title = j.entities?.[wd]?.sitelinks?.enwiki?.title;
    }
  }
  if (!title) return {};
  const res = await http(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
  if (!res.ok) return {};
  const j = (await res.json()) as { type?: string; extract?: string; content_urls?: { desktop?: { page?: string } }; thumbnail?: { source: string } };
  if (j.type === 'disambiguation') return {};
  return { summary: j.extract, url: j.content_urls?.desktop?.page, image: j.thumbnail?.source };
}

/** Who this artist is. null when MusicBrainz doesn't know them well enough to be sure. */
export function artistBio(name: string): Promise<ArtistBio | null> {
  return cached(`bio.${norm(name)}`, 7 * DAY, async () => {
    const found = await mb<{ artists: MbArtist[] }>(`/artist/?limit=5&query=${encodeURIComponent(`artist:${q(name)}`)}`);
    const best = found.artists.find((a) => (a.score ?? 0) >= 90 && norm(a.name) === norm(name)) ?? found.artists.find((a) => (a.score ?? 0) >= 98);
    if (!best) return null;
    const a = await mb<MbArtist>(`/artist/${best.id}?inc=url-rels+artist-rels`);
    const wiki = await wikipediaFor(a).catch(() => ({}) as Awaited<ReturnType<typeof wikipediaFor>>);
    const year = (d?: string | null) => d?.slice(0, 4);
    const members = (a.relations ?? [])
      .filter((r) => r.type === 'member of band' && r.direction === 'backward' && r.artist)
      .map((r) => ({ name: r.artist!.name, years: [year(r.begin), year(r.end)].some(Boolean) ? `${year(r.begin) ?? '?'}–${r.ended ? (year(r.end) ?? '?') : ''}` : undefined, current: !r.ended }))
      .filter((m, i, all) => all.findIndex((x) => x.name === m.name) === i)
      .sort((x, y) => Number(y.current) - Number(x.current));
    const links: ArtistBio['links'] = [];
    for (const r of a.relations ?? []) {
      const label = linkLabel(r);
      if (label && !links.some((l) => l.label === label)) links.push({ label, url: r.url!.resource });
    }
    return {
      name: a.name,
      summary: wiki.summary,
      wikipedia: wiki.url,
      image: wiki.image,
      type: a.type,
      area: a['begin-area']?.name ?? a.area?.name,
      began: a['life-span']?.begin,
      ended: a['life-span']?.ended ? a['life-span']?.end : undefined,
      members,
      links,
      mbid: a.id,
    };
  });
}

const ROLE: Record<string, string> = {
  composer: 'Written by', writer: 'Written by', lyricist: 'Lyrics', producer: 'Produced by', mix: 'Mixed by', engineer: 'Engineered by',
  recording: 'Recorded by', mastering: 'Mastered by', arranger: 'Arranged by', vocal: 'Vocals', instrument: 'Played', conductor: 'Conductor',
  performer: 'Performed by', remixer: 'Remixed by', 'audio': 'Engineered by', 'programming': 'Programming',
};
const ORDER = ['Written by', 'Lyrics', 'Produced by', 'Vocals', 'Played', 'Arranged by', 'Programming', 'Mixed by', 'Engineered by', 'Recorded by', 'Mastered by', 'Remixed by', 'Conductor', 'Performed by'];

/** Pure: MusicBrainz relations → credit lines, grouped by role, writers first. Exported for tests. */
export function creditsFrom(relations: MbRelation[]): Credit[] {
  const by = new Map<string, string[]>();
  const add = (role: string, name: string, attrs?: string[]) => {
    const label = role === 'Played' && attrs?.length ? `${attrs[0][0].toUpperCase()}${attrs[0].slice(1)}` : role;
    const list = by.get(label) ?? [];
    if (!list.includes(name)) list.push(name);
    by.set(label, list);
  };
  for (const r of relations) {
    if (r.artist && ROLE[r.type]) add(ROLE[r.type], r.artist.name, r.attributes);
    if (r.work) for (const w of r.work.relations ?? []) if (w.artist && ROLE[w.type]) add(ROLE[w.type], w.artist.name, w.attributes);
  }
  const rank = (role: string) => {
    const i = ORDER.indexOf(role);
    return i < 0 ? ORDER.indexOf('Played') + 0.5 : i;
  };
  return [...by.entries()].map(([role, names]) => ({ role, names })).sort((a, b) => rank(a.role) - rank(b.role));
}

/** Who wrote, produced and played on a song. Empty when MusicBrainz has nothing on it. */
export function songCredits(t: Pick<Track, 'title' | 'artist' | 'album'>): Promise<Credit[]> {
  const title = t.title.replace(/\s*[([](feat|ft|with|remaster|live|mono|stereo)[^)\]]*[)\]]/gi, '').trim();
  return cached(`credits.${norm(t.artist)}.${norm(title)}`, 7 * DAY, async () => {
    const query = `recording:${q(title)} AND artist:${q(t.artist)}${t.album ? ` AND release:${q(t.album)}` : ''}`;
    let found = await mb<{ recordings: { id: string; score?: number; title: string }[] }>(`/recording/?limit=5&query=${encodeURIComponent(query)}`);
    if (!found.recordings.length && t.album) {
      found = await mb(`/recording/?limit=5&query=${encodeURIComponent(`recording:${q(title)} AND artist:${q(t.artist)}`)}`);
    }
    const hits = found.recordings.filter((r) => (r.score ?? 0) >= 85 && norm(r.title) === norm(title)).slice(0, 2);
    for (const hit of hits) {
      const r = await mb<{ relations?: MbRelation[] }>(`/recording/${hit.id}?inc=artist-rels+work-rels+work-level-rels+artist-credits`);
      const credits = creditsFrom(r.relations ?? []);
      if (credits.length) return credits;
    }
    return [];
  });
}
