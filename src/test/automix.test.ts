import { describe, expect, it } from 'vitest';
import { planTransition, tempoRatio, toNextBeat } from '../player/automix';

const t = (o: object) => ({ id: 'x', sourceId: 's', kind: 'track' as const, title: 't', artist: 'a', ...o });
const s = (bpm: number, energy = 0.5) => ({ bpm, beatStrength: 0.5, beatAt: 30.2, energy });

describe('AutoMix', () => {
  it('plays the next song on the same album without a fade', () => {
    expect(planTransition(t({ albumId: 'a', trackNumber: 3 }), t({ albumId: 'a', trackNumber: 4 }), null, null, 6).seconds).toBe(0);
    expect(planTransition(t({ albumId: 'a', trackNumber: 3 }), t({ albumId: 'a', trackNumber: 7 }), null, null, 6).seconds).toBe(6);
  });
  it('goes on gapless from the end of one disc into the next disc', () => {
    const plan = (a: object, b: object) => planTransition(t({ albumId: 'a', ...a }), t({ albumId: 'a', ...b }), null, null, 6).seconds;
    expect(plan({ discNumber: 1, trackNumber: 12 }, { discNumber: 2, trackNumber: 1 })).toBe(0);
    expect(plan({ trackNumber: 12 }, { discNumber: 2, trackNumber: 1 })).toBe(0);
    expect(plan({ discNumber: 1, trackNumber: 12 }, { discNumber: 2, trackNumber: 2 })).toBe(6);
    expect(plan({ discNumber: 1, trackNumber: 12 }, { discNumber: 3, trackNumber: 1 })).toBe(6);
    expect(plan({ discNumber: 2, trackNumber: 3 }, { discNumber: 1, trackNumber: 4 })).toBe(6);
  });
  it('beat-matches close tempos, including half time', () => {
    const p = planTransition(t({}), t({ id: 'y' }), s(120), s(124), 6);
    expect(p.why).toBe('beatmatch');
    expect(p.seconds).toBeCloseTo(4, 1);
    expect(p.rate).toBeCloseTo(120 / 124, 2);
    expect(tempoRatio(140, 70)).toBeCloseTo(1, 5);
    expect(tempoRatio(120, 100)).toBeNull();
  });
  it('fades by energy when the tempos do not match', () => {
    expect(planTransition(t({}), t({ id: 'y' }), s(120, 0.9), s(90, 0.9), 6).seconds).toBeLessThan(5);
    expect(planTransition(t({}), t({ id: 'y' }), s(120, 0.1), s(90, 0.1), 6).seconds).toBeGreaterThan(7);
  });
  it('finds the next beat', () => {
    expect(toNextBeat(30.7, { period: 0.5, at: 30.2 })).toBeCloseTo(0, 5);
    expect(toNextBeat(30.8, { period: 0.5, at: 30.2 })).toBeCloseTo(0.4, 5);
  });
});
