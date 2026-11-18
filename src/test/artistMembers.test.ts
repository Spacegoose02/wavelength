import { describe, expect, it } from 'vitest';
import type { ArtistBio } from '../lib/artistInfo';
import { libraryArtist, memberKey, membersFrom } from '../lib/artistMembers';
import type { Artist } from '../sources/types';

const artist = (name: string): Artist => ({ id: name, sourceId: 'nd', name }) as Artist;
const library = [artist('Hot Boy$'), artist('Lil Wayne'), artist('Juvenile'), artist('B.G.'), artist('Young Money')];
const bio = (over: Partial<ArtistBio>): ArtistBio => ({ name: 'x', members: [], links: [], ...over });

describe('group members', () => {
  it('matches names loosely: case, punctuation, "$" for "s"', () => {
    expect(memberKey('Hot Boy$')).toBe(memberKey('Hot Boys'));
    expect(memberKey('B.G.')).toBe(memberKey('bg'));
    expect(libraryArtist(library, 'HOT BOYS')?.name).toBe('Hot Boy$');
    expect(libraryArtist(library, 'Turk')).toBeUndefined();
  });

  it('members set on the Hub replace MusicBrainz’s, and find the library’s artists', () => {
    const r = membersFrom('Hot Boy$', { members: ['Lil Wayne', 'Turk', 'Juvenile', 'B.G.'], memberOf: [] }, bio({ members: [{ name: 'Mannie Fresh', current: true }] }), library);
    expect(r.membersFrom).toBe('hub');
    expect(r.members.map((m) => [m.name, m.artist?.name])).toEqual([['Lil Wayne', 'Lil Wayne'], ['Turk', undefined], ['Juvenile', 'Juvenile'], ['B.G.', 'B.G.']]);
    // an empty list set on the Hub hides MusicBrainz's too
    expect(membersFrom('Hot Boy$', { members: [] }, bio({ members: [{ name: 'Turk', current: true }] }), library).members).toEqual([]);
  });

  it('without members on the Hub, MusicBrainz’s are shown', () => {
    const r = membersFrom('Hot Boy$', { members: null }, bio({ members: [{ name: 'Lil Wayne', current: false, years: '1997–2001' }] }), library);
    expect(r.membersFrom).toBe('musicbrainz');
    expect(r.members[0]).toMatchObject({ name: 'Lil Wayne', years: '1997–2001', current: false });
    expect(membersFrom('Hot Boy$', undefined, null, library).membersFrom).toBeUndefined();
  });

  it('member of puts the Hub’s groups with MusicBrainz’s, once each', () => {
    const r = membersFrom('Lil Wayne', { members: null, memberOf: ['Hot Boy$'] }, bio({ memberOf: [{ name: 'Hot Boys', current: false }, { name: 'Young Money', current: true }] }), library);
    expect(r.memberOf.map((m) => m.name)).toEqual(['Hot Boy$', 'Young Money']);
    expect(r.memberOf[1].artist?.name).toBe('Young Money');
  });
});
