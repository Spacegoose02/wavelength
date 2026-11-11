import { describe, expect, it, vi } from 'vitest';

vi.mock('../store/player', () => ({ usePlayer: {} }));
const { weave } = await import('../lib/smartShuffle');

describe('Smart Shuffle', () => {
  it('puts one pick after every three songs still to come', () => {
    expect(weave<number | string>([1, 2, 3, 4, 5, 6, 7], 0, ['a', 'b', 'c'])).toEqual([1, 2, 3, 4, 'a', 5, 6, 7, 'b']);
  });
  it('leaves songs already played alone', () => {
    expect(weave<number | string>([1, 2, 3, 4, 5], 2, ['a'])).toEqual([1, 2, 3, 4, 5]);
    expect(weave<number | string>([1, 2, 3, 4, 5, 6], 2, ['a'], 2)).toEqual([1, 2, 3, 4, 5, 'a', 6]);
  });
  it('stops when the picks run out', () => {
    expect(weave<number | string>([0, 1, 2, 3, 4, 5, 6], 0, ['a'], 2)).toEqual([0, 1, 2, 'a', 3, 4, 5, 6]);
  });
});
