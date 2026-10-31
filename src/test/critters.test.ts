import { describe, expect, it } from 'vitest';
import { critterFromOldPick } from '../store/settings';

describe('critterFromOldPick', () => {
  it('turns the old single critter pick into a species and an act', () => {
    expect(critterFromOldPick('dj')).toEqual({ critter: 'raccoon', act: 'dj' });
    expect(critterFromOldPick('rocker')).toEqual({ critter: 'raccoon', act: 'rocker' });
    expect(critterFromOldPick('shark')).toEqual({ critter: 'shark', act: 'drums' });
    expect(critterFromOldPick('alien')).toEqual({ critter: 'alien', act: 'theremin' });
    expect(critterFromOldPick('grey')).toEqual({ critter: 'grey', act: 'synth' });
    expect(critterFromOldPick('bear-brown')).toEqual({ critter: 'bear-brown', act: 'accordion' });
  });
  it('falls back to the DJ raccoon for anything unknown', () => {
    expect(critterFromOldPick('dragon')).toEqual({ critter: 'raccoon', act: 'dj' });
    expect(critterFromOldPick(undefined)).toEqual({ critter: 'raccoon', act: 'dj' });
  });
});
