import { describe, expect, it } from 'vitest';
import { createPacer } from '../lib/framePace';

describe('createPacer', () => {
  it('draws every frame while playing', () => {
    const pace = createPacer();
    const drawn = [0, 16.7, 33.3, 50, 66.7].map((t) => pace(t, true) > 0);
    expect(drawn).toEqual([true, true, true, true, true]);
  });

  it('draws every third 60 Hz frame while paused', () => {
    const pace = createPacer(20);
    const drawn = Array.from({ length: 13 }, (_, i) => pace(i * (1000 / 60), false) > 0).filter(Boolean).length;
    expect(drawn).toBe(5); // frames 0, 3, 6, 9, 12
  });

  it('returns real seconds between drawn frames, capped after a long gap', () => {
    const pace = createPacer();
    pace(0, true);
    expect(pace(16, true)).toBeCloseTo(0.016);
    expect(pace(5000, true)).toBe(0.1);
  });

  it('goes back to full rate the moment music plays', () => {
    const pace = createPacer(20);
    pace(0, false);
    expect(pace(16.7, false)).toBe(0);
    expect(pace(33.3, true)).toBeGreaterThan(0);
  });
});

describe('reduce motion', () => {
  it('draws two calm frames a second, playing or not, with the clock barely moving', () => {
    const pace = createPacer(20, () => true);
    pace(0, true);
    expect(pace(16, true)).toBe(0);
    expect(pace(400, true)).toBe(0);
    expect(pace(500, true)).toBeCloseTo(1 / 60);
    expect(pace(700, false)).toBe(0);
  });
});
