/**
 * A group's members and the groups an artist is in, for the artist page's Members and Member of shelves
 * (components/ArtistMembers.tsx). What an admin set in Edit artist comes first (hub/src/routes/artistMeta.ts); a
 * group nobody set members for shows MusicBrainz's (lib/artistInfo.ts), when artist info is turned on. Each name is
 * matched to the library's artist of that name, so its card opens their page.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Artist } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { type ArtistBio, artistBio } from './artistInfo';
import { useArtistMeta } from './artistMeta';
import { useFeature } from './features';

/** Names compared loosely, as the Hub does: case, accents and punctuation don't count, "$" reads as "s", "&" as "and". */
export const memberKey = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\$/g, 's').replace(/['’.]/g, '').replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/^the /, '');

export interface MemberEntry {
  name: string;
  /** "1997–2001", from MusicBrainz */
  years?: string;
  /** false: a past member (MusicBrainz) */
  current: boolean;
  /** The library's artist of that name, if there is one. */
  artist?: Artist;
}

export interface ArtistMembers {
  members: MemberEntry[];
  /** Where the members come from: set on the Hub, or MusicBrainz's. */
  membersFrom?: 'hub' | 'musicbrainz';
  memberOf: MemberEntry[];
}

const indexes = new WeakMap<Artist[], Map<string, Artist>>();
/** The library artist of this name (loosely), the first in the list. */
export function libraryArtist(artists: Artist[], name: string): Artist | undefined {
  let ix = indexes.get(artists);
  if (!ix) {
    ix = new Map();
    for (const a of artists) {
      const k = memberKey(a.name);
      if (k && !ix.has(k)) ix.set(k, a);
    }
    indexes.set(artists, ix);
  }
  return ix.get(memberKey(name));
}

type Named = { name: string; years?: string; current: boolean };
const dedupe = (list: Named[]) => list.filter((m, i) => memberKey(m.name) && list.findIndex((x) => memberKey(x.name) === memberKey(m.name)) === i);

/**
 * Pure: the shelves from what the Hub has (`members` null = not set) and MusicBrainz's bio. Members set on the Hub
 * replace MusicBrainz's, even an empty list. Member of puts the Hub's groups together with MusicBrainz's.
 */
export function membersFrom(name: string, hub: { members?: string[] | null; memberOf?: string[] } | null | undefined, bio: ArtistBio | null | undefined, artists: Artist[]): ArtistMembers {
  const self = memberKey(name);
  const withArtist = (list: Named[]) => dedupe(list).filter((m) => memberKey(m.name) !== self).map((m) => ({ ...m, artist: libraryArtist(artists, m.name) }));
  const set = hub?.members;
  const members = set != null ? withArtist(set.map((n) => ({ name: n, current: true }))) : withArtist(bio?.members ?? []);
  const memberOf = withArtist([...(hub?.memberOf ?? []).map((n) => ({ name: n, current: true })), ...(bio?.memberOf ?? [])]);
  return { members, membersFrom: set != null ? 'hub' : members.length ? 'musicbrainz' : undefined, memberOf };
}

/** MusicBrainz's bio for this artist when artist info is on; undefined while loading, null when off or unknown. */
export function useMusicBrainzBio(name: string): ArtistBio | null | undefined {
  const info = useFeature('artistInfo');
  const [bio, setBio] = useState<{ name: string; bio: ArtistBio | null }>();
  useEffect(() => {
    if (!info || !name) return;
    let alive = true;
    artistBio(name).then((b) => alive && setBio({ name, bio: b }), () => alive && setBio({ name, bio: null }));
    return () => {
      alive = false;
    };
  }, [name, info]);
  if (!info) return null;
  return bio?.name === name ? bio.bio : undefined;
}

export function useArtistMembers(name: string): ArtistMembers {
  const meta = useArtistMeta(name);
  const bio = useMusicBrainzBio(name);
  const artists = useCatalog((s) => s.artists);
  return useMemo(() => membersFrom(name, meta, bio, artists), [name, meta, bio, artists]);
}
