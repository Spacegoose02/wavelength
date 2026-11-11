/**
 * Mouth shapes ("visemes") for the critters' singing faces (components/critters/face.ts and the faces in
 * species.tsx / parts.tsx).
 *
 * Six shapes, enough to read as singing without true lip sync:
 *
 * | shape   | looks like                        | sung on                                   |
 * |---------|-----------------------------------|-------------------------------------------|
 * | `rest`  | the closed smile                  | silence, between syllables                |
 * | `ah`    | wide open, jaw dropped            | a (f*a*ther, c*a*n), loud open vowels     |
 * | `oh`    | small and round                   | o, u, w (n*o*, y*ou*, l*o*ve)             |
 * | `ee`    | wide and short, teeth showing     | e, i, y (s*ee*, n*i*ght, m*y*)            |
 * | `mm`    | lips pressed together             | a syllable starting with m, b or p        |
 * | `smile` | open grin                         | belting a big note (brows up, mouth open) |
 *
 * Two ways to pick one:
 *
 * - **From the lyrics** (`syllableShapes`): when the song has synced lyrics, each syllable of the line being
 *   sung gives its vowel, and a leading m/b/p closes the lips first. Spelling is not pronunciation, so this is
 *   a good guess, not phonetics; it's right often enough that the mouth follows the words.
 * - **From the voice** (`vowelFromFormants`): without lyrics, a rough guess from where the centre channel's
 *   energy sits. Open vowels (ah) have a high first formant (~600–1000 Hz); ee has a low first formant and a
 *   strong second one (~1.8–3 kHz); oh/oo have both low. In a full mix this is often wrong, but the mouth
 *   changes shape the way a singing mouth does, which is what reads on screen.
 */

export type Viseme = 'rest' | 'ah' | 'oh' | 'ee' | 'mm' | 'smile';

/** The shapes an open, singing mouth can take (everything but `rest`). */
export const OPEN_SHAPES: Viseme[] = ['ah', 'oh', 'ee', 'mm', 'smile'];

export interface SyllableShape {
  /** the vowel's shape */
  shape: Viseme;
  /** the syllable starts with m, b or p: close the lips for its first moment */
  closed: boolean;
}

/** The shape of a vowel group as spelled ("ou", "ee", "a", …). */
function vowelShape(group: string): Viseme {
  // a y leading a vowel is a consonant ("you", "yeah")
  if (group.length > 1 && group[0] === 'y') group = group.slice(1);
  // diphthongs that are spelled with one letter but sung as another
  if (/^(ou|ow|oo|oa|ew|ue|ui)/.test(group)) return 'oh';
  if (/^(ai|ay|ei|ey|ea|ee|ie)/.test(group)) return 'ee';
  const c = group[0];
  if (c === 'a' || c === 'à' || c === 'á' || c === 'â' || c === 'ä') return 'ah';
  if ('oóòôöuúùûü'.includes(c)) return 'oh';
  return 'ee';
}

/**
 * The mouth shape of each syllable in `text`, in order. Counts syllables the same way as `syllables` in
 * lib/singAlong.ts (vowel groups per word, a silent final e dropped, at least one per word), so the n-th shape
 * here is the n-th syllable the line's timing counts.
 */
export function syllableShapes(text: string): SyllableShape[] {
  const out: SyllableShape[] = [];
  for (const word of text.toLowerCase().split(/[^a-zà-ÿ']+/).filter(Boolean)) {
    const stem = word.replace(/e$/, '');
    const groups = [...stem.matchAll(/[aeiouyà-ÿ]+/g)];
    if (!groups.length) {
      // "the", "th'", "mm": one syllable; use the word's own vowel if it has one
      const v = word.match(/[aeiouyà-ÿ]+/)?.[0];
      out.push({ shape: v ? vowelShape(v) : 'mm', closed: /^[mbp]/.test(word) });
      continue;
    }
    groups.forEach((g, i) => {
      // the consonants just before this vowel group (for the first one, the start of the word)
      const before = stem.slice(i === 0 ? 0 : groups[i - 1].index! + groups[i - 1][0].length, g.index);
      // the lips close for any m, b or p in the consonants leading into it ("my", "bright", "hum-ble")
      out.push({ shape: vowelShape(g[0]), closed: /[mbp]/.test(before) });
    });
  }
  return out;
}

/**
 * The shape for the moment `phase` (0..1) through syllable `index` of `shapes`: the vowel, or `mm` for the
 * first fifth of a syllable that starts with m, b or p. Past the end it holds the last vowel (a held note).
 */
export function shapeAt(shapes: SyllableShape[], index: number, phase: number): Viseme | null {
  if (!shapes.length) return null;
  const s = shapes[Math.min(shapes.length - 1, Math.max(0, index))];
  if (s.closed && index < shapes.length && phase < 0.2) return 'mm';
  return s.shape;
}

/**
 * A rough vowel from three band powers of the centre (voice) spectrum: `f1Low` ~250–550 Hz, `f1High`
 * ~550–1000 Hz, `f2` ~1.8–3 kHz. Returns null when there's too little to judge.
 */
export function vowelFromFormants(f1Low: number, f1High: number, f2: number): Viseme | null {
  const total = f1Low + f1High + f2;
  if (!(total > 1e-9)) return null;
  // open vowels put the first formant high
  if (f1High > f1Low * 1.1) return 'ah';
  // ee: a strong second formant against the (low) first one
  if (f2 > f1Low * 0.18) return 'ee';
  return 'oh';
}
