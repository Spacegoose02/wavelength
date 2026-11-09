import { describe, expect, it } from 'vitest';
import { albumKey, tagKey } from '../lib/itemTags';

// must match hub/src/itemTags.ts tagKey, or the app won't find what the Hub keeps
describe('tagKey', () => {
  it('ignores case, accents, apostrophes and punctuation like the Hub', () => {
    expect(tagKey('Beyoncé')).toBe('beyonce');
    expect(tagKey('*NSYNC')).toBe('nsync');
    expect(tagKey('It’s Only Me')).toBe('its only me');
    expect(tagKey('Simon & Garfunkel')).toBe('simon and garfunkel');
    expect(tagKey('AC/DC')).toBe('ac dc');
  });
  it('keys an album by its album artist and title', () => {
    expect(albumKey('*NSYNC', 'Home for Christmas')).toBe(albumKey('nsync', 'home for christmas!'));
    expect(albumKey('A', 'B C')).not.toBe(albumKey('A B', 'C'));
  });
});
