import { norm } from '../sources/registry';
import type { Album } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { useSettings } from '../store/settings';
import { explicitOfAlbum, useIsKid, useRatings } from './kids';
import { cleanTitle, primaryArtist } from './match';

/**
 * Explicit and clean versions of the same album (docs/USERS-AND-ADMIN.md Phase 4). When the library has
 * both, the album page gets an Explicit / Clean switch, and someone who prefers one version (Settings →
 * Playback; kid profiles always get clean) sees only that one in album lists and opens albums on it.
 */

export type Version = 'explicit' | 'clean';
export type VersionPref = 'both' | Version;

const CLEAN_MARK = /[([]\s*(clean|edited|censored)\b[^)\]]*[)\]]/i;
const EXPLICIT_MARK = /[([]\s*explicit\b[^)\]]*[)\]]/i;

/** Albums with this key are versions of each other: same artist, same title without "(Clean)" and the like. */
export const versionKey = (a: Pick<Album, 'artist' | 'title'>) => `${norm(primaryArtist(a.artist))}|${cleanTitle(a.title)}`;

/** Which version one server's copy is: from its title, its tags, or the library check. */
export function versionOf(a: Album): Version | undefined {
  if (CLEAN_MARK.test(a.title)) return 'clean';
  if (EXPLICIT_MARK.test(a.title)) return 'explicit';
  // its own tag first: two versions with the same title share one library-check rating
  return a.explicit ?? explicitOfAlbum(a);
}

const copies = (a: Album) => a.refs ?? [a];

// versions per key across the whole library, rebuilt when the library or the ratings change
let builtFor: [Album[], unknown] | undefined;
let index = new Map<string, Album[]>();
function byKey(albums: Album[], ratings: unknown) {
  if (!builtFor || builtFor[0] !== albums || builtFor[1] !== ratings) {
    builtFor = [albums, ratings];
    index = new Map();
    for (const a of albums) {
      const k = versionKey(a);
      const list = index.get(k);
      if (list) list.push(...copies(a));
      else index.set(k, [...copies(a)]);
    }
  }
  return index;
}

/** Every copy of this album in the library, both versions and all servers, with which version each is. */
export function versionsOf(album: Album): { ref: Album; version?: Version }[] {
  const all = byKey(useCatalog.getState().albums, useRatings.getState().ratings).get(versionKey(album)) ?? [];
  const seen = new Set<string>();
  const out: { ref: Album; version?: Version }[] = [];
  for (const ref of [...copies(album), ...all]) {
    const id = `${ref.sourceId}:${ref.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ ref, version: versionOf(ref) });
  }
  return out;
}

/** Both versions are in the library. */
export const hasBoth = (v: { version?: Version }[]) => v.some((x) => x.version === 'clean') && v.some((x) => x.version === 'explicit');

export function useVersionPref(): VersionPref {
  const kid = useIsKid();
  const pref = useSettings((s) => s.versions);
  return kid ? 'clean' : pref ?? 'both';
}

/** The copy to open an album on: the preferred version when the library has it. */
export function preferredRef(album: Album, pref: VersionPref): Album | undefined {
  if (pref === 'both') return undefined;
  const v = versionsOf(album);
  if (!hasBoth(v)) return undefined;
  const mine = copies(album).find((r) => versionOf(r) === pref);
  return mine ?? v.find((x) => x.version === pref)?.ref;
}

/**
 * Hook: whether to leave an album out of lists, because it's only the other version and the preferred one is
 * in the library too (as a separate album). Albums that hold both versions stay, and open on the preferred one.
 */
export function useVersionHidden(): (a: Album) => boolean {
  const pref = useVersionPref();
  const albums = useCatalog((s) => s.albums);
  const ratings = useRatings((s) => s.ratings);
  if (pref === 'both') return NONE;
  return (a) => {
    const own = copies(a).map(versionOf);
    if (own.includes(pref)) return false;
    const group = byKey(albums, ratings).get(versionKey(a)) ?? [];
    return group.some((r) => versionOf(r) === pref);
  };
}
const NONE = () => false;

/** For kid filters: an album that holds a clean copy counts as clean (it opens on that copy). */
export const cleanSide = (a: Album): Album => (a.refs && a.refs.length > 1 && a.refs.some((r) => versionOf(r) === 'clean') ? { ...a, explicit: 'clean' } : a);
