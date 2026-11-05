import type { Viseme } from '../../player/visemes';

/**
 * The singing face's acting, worked out each frame from the music (rig.ts writes it onto the SVG):
 * which mouth shape to show, how high the brows are, how much the eyes squint, and the short "accent" pulse
 * that drives species details (the raccoon's whiskers and snarl, the bears' ears).
 *
 * Pure apart from its own state, so it's unit-tested (src/test/face.test.ts) without a DOM.
 */

export interface FaceInput {
  /** seconds */
  t: number;
  /** how open the mouth is, 0..1 (the rig's smoothed singing, or a yawn) */
  open: number;
  /** the shape the singing suggests (singingReading.shape), or null to let the face pick */
  hint: Viseme | null;
  /** 0..1, how bright (high) the voice is */
  bright: number;
  /** 0..1, how loud the band is now (the analyser's mid and treble) */
  energy: number;
  beat: boolean;
  /** a strong drum or high hit */
  transient: boolean;
  /** paused: no acting, the rig yawns and blinks on its own */
  idle: boolean;
  /** the rig is yawning (paused): show the big open shape */
  yawning?: boolean;
}

export interface FaceOutput {
  shape: Viseme;
  /** 0..1, brows raised (crescendo, a held loud note) */
  brow: number;
  /** 0..1, eyes narrowed (a bright, high note) */
  squint: number;
  /** 0..1, a quick pulse on a strong accent, decaying over ~0.4 s */
  accent: number;
  /** blink now (on a beat now and then, on top of the rig's random blinks) */
  blink: boolean;
}

/** The mouth is shut below this: the closed smile shows (matches the rig's smile cut-off). */
export const OPEN_AT = 0.15;
/** A mouth shape holds at least this long, so fast syllables don't flicker, s */
export const HOLD = 0.08;

/** Shapes to cycle through when nothing suggests one (made-up chatter): mostly vowels, now and then a grin. */
const CHATTER: Viseme[] = ['ah', 'ee', 'oh', 'ah', 'smile', 'oh', 'ee', 'mm'];

export function createFace() {
  let shape: Viseme = 'rest';
  let since = -1;
  let wasOpen = false;
  let chatter = 0;
  let fast = 0;
  let slow = 0;
  let brow = 0;
  let squint = 0;
  let accent = 0;
  let openFor = 0;
  let lastT: number | undefined;
  let beats = 0;
  let lastBlink = -10;

  return (f: FaceInput): FaceOutput => {
    const dt = lastT === undefined ? 1 / 60 : Math.min(0.1, Math.max(0, f.t - lastT));
    lastT = f.t;

    // crescendo: the band's level rising against its slower average
    fast += (f.energy - fast) * 0.12;
    slow += (f.energy - slow) * 0.015;
    const open = f.open > OPEN_AT;
    openFor = open ? openFor + dt : 0;
    const swell = Math.min(1, Math.max(0, (fast - slow - 0.03) / 0.08));
    const held = Math.min(1, Math.max(0, (openFor - 0.6) / 0.4)) * Math.min(1, f.open / 0.6);
    const browTarget = f.idle ? 0 : Math.max(swell, held * 0.8);
    brow += (browTarget - brow) * (browTarget > brow ? 0.2 : 0.06);

    const squintTarget = f.idle || !open ? 0 : Math.min(1, Math.max(0, (f.bright - 0.5) / 0.3)) * 0.8 + held * 0.2;
    squint += (squintTarget - squint) * 0.12;

    accent *= Math.exp(-dt / 0.15);
    if (f.transient && !f.idle) accent = 1;

    // blink on every eighth beat or so, not more than once a second and a half
    let blink = false;
    if (f.beat && !f.idle && ++beats % 8 === 0 && f.t - lastBlink > 1.5) {
      blink = true;
      lastBlink = f.t;
    }

    // the mouth shape
    let want: Viseme;
    if (f.yawning) want = 'oh';
    else if (!open) want = 'rest';
    else if (f.hint) want = f.hint;
    else {
      // nothing to go on: a new vowel each time the mouth opens again
      if (!wasOpen) chatter = (chatter + 1) % CHATTER.length;
      want = CHATTER[chatter];
    }
    // belting: a wide-open vowel with the brows up turns into a grin
    if (want === 'ah' && brow > 0.6) want = 'smile';
    wasOpen = open;
    if (want !== shape && (f.t - since >= HOLD || want === 'rest' || shape === 'rest')) {
      shape = want;
      since = f.t;
    }

    return { shape, brow, squint, accent, blink };
  };
}
