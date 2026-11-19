import { describe, expect, it } from 'vitest';
import { mergeFacts, parseArtistLink } from '../lib/artistMatches';

describe('parseArtistLink (Edit artist → Match)', () => {
  it('reads MusicBrainz links and ids', () => {
    expect(parseArtistLink('https://musicbrainz.org/artist/B10BBBFC-CF9E-42E0-BE17-E2C3E1D2600D/releases')).toEqual({ site: 'musicbrainz', id: 'b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d' });
    expect(parseArtistLink(' b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d ')).toEqual({ site: 'musicbrainz', id: 'b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d' });
  });
  it('reads Deezer links, with or without a language, and bare numbers', () => {
    expect(parseArtistLink('https://www.deezer.com/en/artist/246791')).toEqual({ site: 'deezer', id: 246791 });
    expect(parseArtistLink('deezer.com/artist/27?utm=x')).toEqual({ site: 'deezer', id: 27 });
    expect(parseArtistLink('https://www.deezer.com/pt-br/artist/13')).toEqual({ site: 'deezer', id: 13 });
    expect(parseArtistLink('246791')).toEqual({ site: 'deezer', id: 246791 });
  });
  it('leaves names alone, even ones with numbers', () => {
    expect(parseArtistLink('Lil Nobody')).toBeUndefined();
    expect(parseArtistLink('50 Cent')).toBeUndefined();
    expect(parseArtistLink('https://www.deezer.com/album/302127')).toBeUndefined();
    expect(parseArtistLink('0')).toBeUndefined();
  });
});

describe('mergeFacts', () => {
  const bio = { type: 'Group', area: 'Atlanta', began: '2010-02-01', ended: undefined, links: [{ label: 'Instagram', url: 'https://instagram.com/mb' }, { label: 'Website', url: 'https://band.example' }] };
  it('keeps MusicBrainz’s facts when nothing is filled in', () => {
    expect(mergeFacts(bio, null)).toEqual({ type: 'Group', area: 'Atlanta', began: '2010-02-01', ended: undefined, links: bio.links });
  });
  it('a fact filled in wins, field by field, and its links come first, replacing MusicBrainz’s of the same name', () => {
    const own = { type: '', area: 'Decatur, GA', began: '', ended: '2020', links: [{ label: 'instagram', url: 'https://instagram.com/mine' }, { label: 'Bandcamp', url: 'https://x.bandcamp.com' }] };
    expect(mergeFacts(bio, own)).toEqual({
      type: 'Group', area: 'Decatur, GA', began: '2010-02-01', ended: '2020',
      links: [own.links[0], own.links[1], { label: 'Website', url: 'https://band.example' }],
    });
  });
  it('works with no MusicBrainz artist at all', () => {
    expect(mergeFacts(null, { type: 'Person', area: 'Ohio', began: '1999', ended: '', links: [] })).toEqual({ type: 'Person', area: 'Ohio', began: '1999', ended: undefined, links: [] });
  });
});
