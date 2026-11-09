import { describe, expect, it } from 'vitest';
import { addFeatured, writeCredit, joinGenres, readCredit, splitGenres, splitNames, titleFeatures } from '../lib/songCredit';

describe('song credits for the Edit song dialog', () => {
  it('reads an Artist tag as a main artist and featured artists', () => {
    expect(readCredit('Lil Durk')).toEqual({ main: 'Lil Durk', featured: [] });
    expect(readCredit('Lil Durk;Drake')).toEqual({ main: 'Lil Durk', featured: ['Drake'] });
    expect(readCredit('Lil Durk feat. Drake; Future')).toEqual({ main: 'Lil Durk', featured: ['Drake', 'Future'] });
    expect(readCredit('Mannie Fresh ft. Lil Wayne')).toEqual({ main: 'Mannie Fresh', featured: ['Lil Wayne'] });
    expect(readCredit('Mannie Fresh (feat. Lil Wayne)')).toEqual({ main: 'Mannie Fresh', featured: ['Lil Wayne'] });
    expect(readCredit('Lil Wayne / Drake')).toEqual({ main: 'Lil Wayne', featured: ['Drake'] });
    // one artist with a comma, "&" or a slash stays one
    expect(readCredit('Tyler, The Creator')).toEqual({ main: 'Tyler, The Creator', featured: [] });
    expect(readCredit('Simon & Garfunkel')).toEqual({ main: 'Simon & Garfunkel', featured: [] });
    expect(readCredit('AC/DC')).toEqual({ main: 'AC/DC', featured: [] });
    expect(readCredit('Lil Durk;Lil Durk')).toEqual({ main: 'Lil Durk', featured: [] });
  });

  it('writes the credit the way Library care does: "Main feat. A; B"', () => {
    expect(writeCredit('Lil Durk', ['Drake'])).toBe('Lil Durk feat. Drake');
    expect(writeCredit('Lil Durk', ['Drake', ' Future ', 'drake', 'Lil Durk', ''])).toBe('Lil Durk feat. Drake; Future');
    expect(writeCredit('Lil Durk', [])).toBe('Lil Durk');
    expect(writeCredit('', ['Drake'])).toBe('Drake');
    // round trip
    expect(writeCredit(...(Object.values(readCredit('Calboy;Meek Mill;Lil Durk')) as [string, string[]]))).toBe('Calboy feat. Meek Mill; Lil Durk');
  });

  it('finds the featured artists written in a title', () => {
    expect(titleFeatures('Sticky (feat. GloRilla, Sexyy Red & Lil Wayne)')).toEqual({ title: 'Sticky', featured: ['GloRilla', 'Sexyy Red', 'Lil Wayne'] });
    expect(titleFeatures('Real Big [ft. Lil Wayne]')).toEqual({ title: 'Real Big', featured: ['Lil Wayne'] });
    expect(titleFeatures('Laugh Now Cry Later (with Lil Durk)')).toEqual({ title: 'Laugh Now Cry Later', featured: ['Lil Durk'] });
    expect(titleFeatures('Song feat. Drake')).toEqual({ title: 'Song', featured: ['Drake'] });
    expect(titleFeatures('Wayne’s Takeover 2')).toBeNull();
    // a known name with a comma isn't cut in two
    expect(titleFeatures('Sticky (feat. Tyler, The Creator & Lil Wayne)', ['Tyler, The Creator'])).toEqual({ title: 'Sticky', featured: ['Tyler, The Creator', 'Lil Wayne'] });
  });

  it('splits pasted names, keeping known ones whole', () => {
    expect(splitNames('A, B and C')).toEqual(['A', 'B', 'C']);
    expect(splitNames('Earth, Wind & Fire x Drake', ['Earth, Wind & Fire'])).toEqual(['Earth, Wind & Fire', 'Drake']);
  });

  it('adds featured artists once', () => {
    expect(addFeatured({ main: 'Tyler, The Creator', featured: ['GloRilla'] }, ['glorilla', 'Lil Wayne', 'Tyler, The Creator'])).toEqual({ main: 'Tyler, The Creator', featured: ['GloRilla', 'Lil Wayne'] });
  });

  it('reads and writes genres as one tag', () => {
    expect(splitGenres('Hip-Hop;Trap ; Hip-Hop')).toEqual(['Hip-Hop', 'Trap']);
    expect(joinGenres(['Hip-Hop', ' Trap', ''])).toBe('Hip-Hop; Trap');
  });
});
