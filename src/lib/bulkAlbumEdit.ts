import type { HubTags } from '../sources/hub';
import { joinGenres, splitGenres } from './songCredit';

/**
 * Edit several albums at once (the album select bar's **Edit**, views/BulkAlbumEditor.tsx): one value for a tag goes
 * into every song of every ticked album, and a field left alone keeps each album's own value. The plan is worked out
 * here, apart from the dialog, so it can be tested: which songs change, with what, and which albums get a new title.
 */

/** What the bulk dialog can set. An undefined field is left as each album has it. */
export interface BulkAlbumEdit {
  albumArtist?: string;
  year?: string;
  releaseType?: string;
  label?: string;
  /** `replace` puts exactly these genres on every album; `add` adds them to what each album already has */
  genres?: { mode: 'replace' | 'add'; values: string[] };
  /** take a leading "Album Artist - " off each album title ("Lil Wayne - Tha Carter III" → "Tha Carter III") */
  stripArtistPrefix?: boolean;
}

export interface BulkSong {
  path: string;
  albumId: string;
  tags: HubTags;
}

/** Tags an .m4a can't hold (hub/src/tags.ts canWrite): left out for those songs, as Edit album does. */
const NOT_IN_M4A = ['albumSort', 'releaseType', 'label'] as const;
export const isM4a = (path: string) => /\.(m4a|mp4|aac)$/i.test(path);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The title without a leading "<artist> - " (any dash, any case, "Lil Wayne – ", "lil wayne-"), or undefined when it
 * doesn't start with one of the artists, or nothing would be left.
 */
export function stripArtistPrefix(title: string, artists: (string | undefined)[]): string | undefined {
  for (const a of artists) {
    const name = (a ?? '').trim();
    if (!name) continue;
    const m = title.match(new RegExp(`^\\s*${esc(name)}\\s*[-–—]\\s*(.+)$`, 'i'));
    if (m?.[1].trim()) return m[1].trim();
  }
  return undefined;
}

export interface BulkPlan {
  changes: { path: string; tags: HubTags }[];
  /** albums whose title changes, with the album artist they'll have after the save */
  renames: { albumId: string; from: string; to: string; artist: string }[];
  /** songs touched, by album */
  albums: number;
}

/**
 * Every song that needs a change, with only the tags that differ from what the file has. `fallbackArtist` names
 * the album's artist as the library shows it, for songs with no album artist tag.
 */
export function planBulkAlbumEdit(songs: BulkSong[], edit: BulkAlbumEdit, fallbackArtist: (albumId: string) => string | undefined = () => undefined): BulkPlan {
  const set: HubTags = {};
  if (edit.albumArtist !== undefined && edit.albumArtist.trim()) set.albumArtist = edit.albumArtist.trim();
  if (edit.year !== undefined && edit.year.trim()) set.year = edit.year.trim();
  if (edit.releaseType) set.releaseType = edit.releaseType;
  if (edit.label !== undefined && edit.label.trim()) set.label = edit.label.trim();

  const renames = new Map<string, BulkPlan['renames'][number]>();
  const changes: BulkPlan['changes'] = [];
  for (const s of songs) {
    const tags: HubTags = {};
    for (const [k, v] of Object.entries(set) as [keyof HubTags, string][]) {
      if (isM4a(s.path) && (NOT_IN_M4A as readonly string[]).includes(k)) continue;
      if (v !== (s.tags[k] ?? '').trim()) tags[k] = v;
    }
    if (edit.genres && (edit.genres.values.length || edit.genres.mode === 'replace')) {
      const had = splitGenres(s.tags.genre ?? '');
      const next = edit.genres.mode === 'replace'
        ? edit.genres.values
        : [...had, ...edit.genres.values.filter((g) => !had.some((h) => h.toLowerCase() === g.toLowerCase()))];
      if (joinGenres(next) !== joinGenres(had)) tags.genre = joinGenres(next);
    }
    if (edit.stripArtistPrefix) {
      const title = (s.tags.album ?? '').trim();
      // the artist it had (the prefix is the old name), the one it's getting, and the library's name for it
      const to = stripArtistPrefix(title, [s.tags.albumArtist, s.tags.artist, fallbackArtist(s.albumId), set.albumArtist]);
      if (to) {
        tags.album = to;
        if (!renames.has(s.albumId)) renames.set(s.albumId, { albumId: s.albumId, from: title, to, artist: set.albumArtist ?? (s.tags.albumArtist || fallbackArtist(s.albumId) || '') });
      }
    }
    if (Object.keys(tags).length) changes.push({ path: s.path, tags });
  }
  const touched = new Set(changes.map((c) => c.path));
  const albums = new Set(songs.filter((s) => touched.has(s.path)).map((s) => s.albumId)).size;
  return { changes, renames: [...renames.values()], albums };
}
