import { describe, expect, it } from 'vitest';
import { allowedBy, isArtistBlocked, isSongBlocked } from '../lib/dontPlay';

describe("Don't play this", () => {
  const rules = { artists: ['The Weeknd'], songs: [{ artist: 'Beyoncé', title: 'Halo' }] };
  const ok = allowedBy(rules);
  it('leaves out an artist, however it is written, and their features', () => {
    expect(ok({ artist: 'weeknd', title: 'Blinding Lights' })).toBe(false);
    expect(ok({ artist: 'The Weeknd feat. Daft Punk', title: 'Starboy' })).toBe(false);
    expect(ok({ artist: 'Daft Punk', title: 'One More Time' })).toBe(true);
  });
  it('leaves out one song, any version of it', () => {
    expect(ok({ artist: 'Beyonce', title: 'Halo (Live)' })).toBe(false);
    expect(ok({ artist: 'Beyoncé', title: 'Crazy in Love' })).toBe(true);
  });
  it('knows what is set', () => {
    expect(isArtistBlocked(rules, 'the weeknd')).toBe(true);
    expect(isSongBlocked(rules, { artist: 'BEYONCÉ', title: 'Halo [Remastered]' })).toBe(true);
  });
  it('allows everything with no rules', () => {
    expect(allowedBy({ artists: [], songs: [] })({ artist: 'x', title: 'y' })).toBe(true);
  });
});
