import { describe, expect, it } from 'vitest';
import { beatClock, bend, lift } from '../components/critters/arm';

/** A stand-in for the SVG parts `bend` writes to. */
function part(data: Record<string, string> = {}) {
  const attrs: Record<string, string> = {};
  return { dataset: data, attrs, setAttribute: (k: string, v: string) => (attrs[k] = v) } as unknown as SVGElement & { attrs: Record<string, string> };
}

function arm() {
  const fore = part({ elbow: '100 100', hand: '130 100' });
  const paw = part();
  const parts: Record<string, SVGElement> = { 'arm-l-fore': fore, 'arm-l-paw': paw };
  return { fore, paw, $: (name: string) => parts[name] ?? (null as unknown as SVGElement) };
}

describe('bend', () => {
  it('turns the forearm about the elbow, carrying the hand round', () => {
    const { $, paw } = arm();
    const [dx, dy] = bend($, 'arm-l', { turn: 90 });
    // a 30-long forearm pointing right, turned a quarter clockwise on screen: the hand ends up below the elbow
    expect(dx).toBeCloseTo(-30);
    expect(dy).toBeCloseTo(30);
    expect((paw as unknown as { attrs: Record<string, string> }).attrs.transform).toContain('rotate(90.00)');
  });

  it('reaches the hand to a nearby spot, stretching the forearm a little', () => {
    const { $ } = arm();
    const [dx, dy] = bend($, 'arm-l', { to: [4, -6] });
    expect(dx).toBeCloseTo(4);
    expect(dy).toBeCloseTo(-6);
  });

  it('holds the stretch to the forearm it has, so a far target is only reached as far as it goes', () => {
    const { $ } = arm();
    const [dx] = bend($, 'arm-l', { to: [60, 0] });
    expect(dx).toBeCloseTo(30 * 0.25);
  });

  it('skips an act that has no such arm', () => {
    expect(bend(() => null as unknown as SVGElement, 'arm-r', { turn: 10 })).toEqual([0, 0]);
  });
});

describe('beatClock and lift', () => {
  it('follows the tempo grid once it is locked on, else a steady 120 BPM', () => {
    expect(beatClock({ t: 9, tempo: { bpm: 100, phase: 0.25, index: 7, on: false, locked: true } })).toEqual({ phase: 0.25, index: 7 });
    expect(beatClock({ t: 1.25, tempo: { bpm: 0, phase: 0, index: 0, on: false, locked: false } })).toEqual({ phase: 0.5, index: 2 });
  });

  it('is down on the beat and up halfway through it', () => {
    expect(lift(0)).toBeCloseTo(0);
    expect(lift(0.5)).toBeCloseTo(1);
  });
});
