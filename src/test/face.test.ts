import { describe, expect, it } from 'vitest';
import { shapeAt, syllableShapes, vowelFromFormants } from '../player/visemes';
import { syllables, sungLines } from '../lib/singAlong';
import { createFace, HOLD, type FaceInput } from '../components/critters/face';

describe('mouth shapes from lyrics', () => {
  it('gives each syllable its vowel', () => {
    expect(syllableShapes('see you now').map((s) => s.shape)).toEqual(['ee', 'oh', 'oh']);
    expect(syllableShapes('la la').map((s) => s.shape)).toEqual(['ah', 'ah']);
    expect(syllableShapes('night').map((s) => s.shape)).toEqual(['ee']);
  });
  it('closes the lips on m, b and p', () => {
    const [my, baby, a, b] = [syllableShapes('my'), syllableShapes('baby'), syllableShapes('away'), syllableShapes('happy')];
    expect(my[0].closed).toBe(true);
    expect(baby.map((s) => s.closed)).toEqual([true, true]);
    expect(a.every((s) => !s.closed)).toBe(true);
    expect(b[1].closed).toBe(true);
  });
  it('counts syllables the same way as the line timing', () => {
    for (const line of ['Never gonna give you up', 'Hello darkness my old friend', "the rhythm of the night", 'mm hmm', 'love'])
      expect(syllableShapes(line)).toHaveLength(syllables(line));
  });
  it('rides along on sung lines', () => {
    expect(sungLines([{ time: 1, text: 'oh no' }])[0].shapes.map((s) => s.shape)).toEqual(['oh', 'oh']);
  });
  it('shows mm for the start of a closed syllable, then the vowel, and holds the last one', () => {
    const shapes = syllableShapes('ma ma');
    expect(shapeAt(shapes, 0, 0.1)).toBe('mm');
    expect(shapeAt(shapes, 0, 0.5)).toBe('ah');
    expect(shapeAt(shapes, 5, 0.1)).toBe('ah');
    expect(shapeAt([], 0, 0)).toBeNull();
  });
});

describe('mouth shapes from the voice', () => {
  it('guesses ah, ee and oh from the formant bands', () => {
    expect(vowelFromFormants(1, 2, 0.1)).toBe('ah');
    expect(vowelFromFormants(2, 0.5, 1)).toBe('ee');
    expect(vowelFromFormants(2, 0.5, 0.1)).toBe('oh');
    expect(vowelFromFormants(0, 0, 0)).toBeNull();
  });
});

const frame = (t: number, over: Partial<FaceInput> = {}): FaceInput => ({ t, open: 0.8, hint: null, bright: 0.3, energy: 0.3, beat: false, transient: false, idle: false, ...over });

describe('singing face', () => {
  it('rests with the mouth shut and follows the hint when open', () => {
    const face = createFace();
    expect(face(frame(0, { open: 0 })).shape).toBe('rest');
    expect(face(frame(0.1, { hint: 'oh' })).shape).toBe('oh');
  });
  it("doesn't flicker between shapes faster than the hold", () => {
    const face = createFace();
    face(frame(0, { hint: 'oh' }));
    expect(face(frame(HOLD / 2, { hint: 'ee' })).shape).toBe('oh');
    expect(face(frame(HOLD + 0.01, { hint: 'ee' })).shape).toBe('ee');
  });
  it('picks a new vowel each time the mouth reopens when nothing suggests one', () => {
    const face = createFace();
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      face(frame(i, { open: 0 }));
      seen.add(face(frame(i + 0.5)).shape);
    }
    expect(seen.size).toBeGreaterThan(2);
  });
  it('raises the brows on a crescendo and on a long held note', () => {
    const face = createFace();
    let t = 0;
    for (; t < 3; t += 1 / 60) face(frame(t, { open: 0, energy: 0.2 }));
    let out = face(frame(t, { open: 0, energy: 0.2 }));
    expect(out.brow).toBeLessThan(0.1);
    for (const end = t + 0.5; t < end; t += 1 / 60) out = face(frame(t, { open: 0, energy: 0.6 }));
    expect(out.brow).toBeGreaterThan(0.5);

    const held = createFace();
    let h = held(frame(0, { energy: 0.2 }));
    for (let s = 0; s < 2; s += 1 / 60) h = held(frame(s, { energy: 0.2, open: 0.9 }));
    expect(h.brow).toBeGreaterThan(0.5);
  });
  it('squints on bright notes, not on dull ones or with the mouth shut', () => {
    const run = (over: Partial<FaceInput>) => {
      const face = createFace();
      let out = face(frame(0, over));
      for (let t = 0; t < 1; t += 1 / 60) out = face(frame(t, over));
      return out.squint;
    };
    expect(run({ bright: 0.9 })).toBeGreaterThan(0.5);
    expect(run({ bright: 0.2, open: 0.3 })).toBeLessThan(0.1);
    expect(run({ bright: 0.9, open: 0 })).toBeLessThan(0.1);
  });
  it('pulses on accents and blinks now and then on a beat', () => {
    const face = createFace();
    expect(face(frame(0, { transient: true })).accent).toBeGreaterThan(0.9);
    let blinks = 0;
    for (let i = 1; i <= 32; i++) if (face(frame(i * 0.5, { beat: true })).blink) blinks++;
    expect(blinks).toBeGreaterThanOrEqual(3);
    expect(blinks).toBeLessThanOrEqual(5);
  });
  it('stays still when paused, apart from the yawn', () => {
    const face = createFace();
    const out = face(frame(0, { idle: true, transient: true, yawning: true }));
    expect(out.shape).toBe('oh');
    expect(out.accent).toBe(0);
    expect(out.brow).toBe(0);
  });
});
