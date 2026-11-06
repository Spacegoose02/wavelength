import { useEffect, type RefObject } from 'react';
import { createAudioReader, type AudioSample } from '../../player/analysis';
import { createSingingReader, currentTune, singingReading } from '../../player/singing';
import type { Viseme } from '../../player/visemes';
import { createTempo, type Tempo } from '../../player/tempo';
import { usePlayer } from '../../store/player';
import { OPEN_AT, createFace } from './face';
import { createFlourish, swell } from './flourish';

/** What each critter's own animation gets every frame. */
export interface RigFrame {
  /** seconds since the scene mounted */
  t: number;
  a: AudioSample;
  idle: boolean;
  /** 1 on the beat, easing back to 0: on the steady tempo grid once it's locked, else on each detected hit */
  bob: number;
  /** the steady beat (player/tempo.ts): phase through the beat, beat count, BPM, whether it's locked on */
  tempo: Tempo;
  /**
   * 0, or 0..1 through the act's flourish (flourish.ts: a new song, or a solo between sung lines). Each act
   * draws its own; `windUp` and `swell` there are the usual curves.
   */
  flourish: number;
  /** a strong high-frequency hit happened in the last ~0.45 s */
  hit: boolean;
  /** -1..1 fast wobble while `hit` is true (scratching, strumming), else 0 */
  rock: number;
  /** look up a `data-part` element */
  $: (name: string) => SVGElement;
}

export interface RigOptions {
  /** how far the head nods on a beat (DJ 10, rocker headbangs harder) */
  nod?: number;
  /** open the mouth with the vocals (player/singing.ts) while playing; on for every act unless turned off */
  talk?: boolean;
  /** draw one frame and stop: Settings previews */
  still?: boolean;
}

/**
 * The animation every critter shares, written straight to SVG attributes from requestAnimationFrame
 * (no React re-render per frame):
 *
 * - `head` bobs on beats and sways; `body` follows a little. Once the tempo tracker (player/tempo.ts) locks
 *   on, the bob and an alternating side-to-side sway ride its steady grid instead of the raw bass hits, and
 *   the tail sways one way per beat. Ears (`ear-l`, `ear-r`) bounce on the beat.
 * - On a new song or a solo the act does its flourish (`flourish`, flourish.ts) and the head throws back a
 *   little with it.
 * - The face sings (face.ts): the mouth (`yawn`, hiding `smile`) opens with the vocals in one of six shapes
 *   (`[data-mouth]` children, player/visemes.ts), the brows (`brow-l`, `brow-r`) lift on a crescendo or a held
 *   note, the `eyes` squint on high notes and blink now and then on a beat. Species details: `whisker-l` /
 *   `whisker-r` twitch and `snarl` shows on accents, `ear-l` / `ear-r` flick, `[data-shine]` eye shines widen
 *   on loud notes and `[data-voice-glow]` antennae brighten with a high voice.
 * - Paused, the eyes blink, the critter yawns and now and then lifts `adjust` (headphones, hat, hair or
 *   beanie) as if setting it straight.
 * - `tail` wags, `spot` (the backlight) breathes with the bass, `[data-glow]` parts (neon and laser
 *   outfits) pulse with the bass.
 *
 * Each critter passes `frame` for its own hands and instrument. Parts a critter doesn't have are skipped.
 */
export function useCritterRig(root: RefObject<SVGSVGElement | null>, frame: (f: RigFrame) => void, opts: RigOptions = {}) {
  const { nod: nodScale = 10, talk = true, still = false } = opts;
  useEffect(() => {
    const svg = root.current!;
    const cache = new Map<string, SVGElement | null>();
    const find = (name: string) => {
      if (!cache.has(name)) cache.set(name, svg.querySelector<SVGElement>(`[data-part="${name}"]`));
      return cache.get(name) ?? null;
    };
    const $ = (name: string) => find(name)!;
    const set = (name: string, transform: string) => find(name)?.setAttribute('transform', transform);
    const glows = [...svg.querySelectorAll<SVGElement>('[data-glow]')];
    const voiceGlows = [...svg.querySelectorAll<SVGElement>('[data-voice-glow]')];
    const shines = [...svg.querySelectorAll<SVGElement>('[data-shine]')];
    // parts drawn in two layers (an arm behind a guitar, its hand in front): the copy takes the part's transform
    const followers = [...svg.querySelectorAll<SVGElement>('[data-follow]')].map((el) => [el, find(el.dataset.follow!)] as const);
    const mouths = new Map<string, SVGElement>();
    for (const m of svg.querySelectorAll<SVGElement>('[data-mouth]')) mouths.set(m.dataset.mouth!, m);
    const face = createFace();
    let shown: Viseme | '' = '';
    /** CSS transform on a part (they rotate and scale about their own box, styles.css) */
    const css = (name: string, transform: string) => {
      const el = find(name);
      if (el) el.style.transform = transform;
    };

    const read = createAudioReader();
    const singAlong = createSingingReader();
    const tempoAt = createTempo();
    const flourishAt = createFlourish();
    const trackKey = () => {
      const tr = usePlayer.getState().current();
      return tr ? `${tr.sourceId}:${tr.id}` : '';
    };
    let t = 0;
    let raf = 0;
    let bob = 0;
    let hitUntil = -1;
    let nextBlink = 2;
    let nextYawn = 6;
    let nextAdjust = 11;
    let singing = 0;

    const loop = () => {
      if (!still) raf = requestAnimationFrame(loop);
      t += 1 / 60;
      const a = read(t);
      const idle = !a.playing;

      const tempo = tempoAt(t, a.beat, a.live);
      const grid = tempo.locked && !idle;
      if (grid) {
        // on the grid: a sharp drop on each beat easing back over ~0.1 s, like the hit-driven bob
        bob = Math.exp((-tempo.phase * 60) / tempo.bpm / 0.11);
      } else {
        if (a.beat && a.live) bob = 1;
        bob *= 0.86;
      }
      // a side-to-side sway that swings one way each beat once locked on
      const beatSwing = Math.sin(Math.PI * (tempo.index + tempo.phase));
      const sway = idle ? Math.sin(t * 0.8) * 2.5 : grid ? beatSwing * 2.2 : a.live ? Math.sin(t * 2.2) * 1.5 : Math.sin(t * 2) * 4;
      const nod = a.live ? bob * nodScale : idle ? 0 : (Math.sin(t * 4) + 1) * 1.5;
      const flourish = still ? 0 : flourishAt({ t, track: trackKey(), playing: a.playing, line: singingReading.line, energy: (a.mid + a.treble) / 2 });
      const throwBack = -swell(flourish) * 6;
      set('head', `translate(0 ${nod.toFixed(2)}) rotate(${(sway + throwBack).toFixed(2)} 200 240)`);
      set('body', `translate(0 ${(nod * 0.3).toFixed(2)})`);

      if (a.transient) hitUntil = t + 0.45;
      const hit = t < hitUntil;
      const rock = hit ? Math.sin(t * 38) : 0;

      if (t > nextBlink) nextBlink = t + 2.5 + Math.random() * 3.5;
      let lids = nextBlink - t < 0.12 ? 0.1 : 1;
      let yawn = 0;
      if (idle) {
        if (t > nextYawn + 1.8) nextYawn = t + 8 + Math.random() * 6;
        const y = t - nextYawn;
        if (y > 0) {
          yawn = Math.sin((Math.min(y, 1.8) / 1.8) * Math.PI);
          lids = Math.min(lids, 1 - yawn * 0.85);
        }
        if (t > nextAdjust + 1.2) nextAdjust = t + 10 + Math.random() * 8;
      }
      const adj = idle && t > nextAdjust ? Math.sin(((t - nextAdjust) / 1.2) * Math.PI) : 0;
      // sing along: open quickly on a syllable, close a little slower
      const tune = currentTune();
      const sing = talk ? singAlong(t, a) * tune.gain : 0;
      singing += (sing - singing) * (sing > singing ? tune.attack : tune.release);
      const mouth = Math.max(yawn, singing);
      const acting = face({
        t,
        open: mouth,
        hint: talk ? singingReading.shape : null,
        bright: singingReading.bright,
        energy: (a.mid + a.treble) / 2,
        beat: a.beat && a.live,
        transient: a.transient,
        idle,
        yawning: yawn > singing,
      });
      if (acting.blink) nextBlink = t + 0.1;
      lids = Math.min(lids, 1 - acting.squint * 0.45);
      css('eyes', `scaleY(${lids.toFixed(2)})`);

      // the mouth: one shape at a time, scaled open from its top edge; lips pressed (mm) show at full size
      const shape = mouth > OPEN_AT ? acting.shape : 'rest';
      if (shape !== shown) {
        for (const [k, el] of mouths) el.style.display = k === shape ? '' : 'none';
        shown = shape;
      }
      const yawnEl = find('yawn');
      if (yawnEl) yawnEl.style.transform = `scaleY(${shape === 'rest' ? 0 : shape === 'mm' ? 1 : (0.35 + 0.65 * Math.min(1, mouth)).toFixed(2)})`;
      const smile = find('smile');
      if (smile) smile.style.opacity = shape === 'rest' ? '1' : '0';

      // brows: up on a crescendo, inner ends down on a squint or an accent
      const lift = -acting.brow * 7;
      const tilt = acting.brow * 8 - acting.squint * 7 - acting.accent * 4;
      css('brow-l', `translate(0px, ${lift.toFixed(2)}px) rotate(${(-tilt).toFixed(2)}deg)`);
      // the right brow is drawn mirrored (parts.tsx, Brows), so the same rotation tilts it the other way
      css('brow-r', `translate(0px, ${lift.toFixed(2)}px) rotate(${(-tilt).toFixed(2)}deg)`);
      // species details
      const twitch = acting.accent * Math.sin(t * 46);
      css('whisker-l', `rotate(${(twitch * 7).toFixed(2)}deg)`);
      css('whisker-r', `rotate(${(-twitch * 7).toFixed(2)}deg)`);
      const snarl = find('snarl');
      if (snarl) snarl.setAttribute('opacity', Math.max(0, (acting.accent - 0.35) / 0.65).toFixed(2));
      const flick = Math.max(acting.accent, acting.brow * 0.5) * Math.sin(t * 30);
      // ears flick on accents and bounce outward on the beat
      const ears = flick * 8 + (a.playing ? bob * 6 : 0);
      css('ear-l', `rotate(${(-ears).toFixed(2)}deg)`);
      css('ear-r', `rotate(${ears.toFixed(2)}deg)`);
      const wide = 1 + Math.min(1, mouth) * Math.min(1, a.mid * 1.5) * 0.6;
      for (const el of shines) el.style.transform = `scale(${wide.toFixed(2)})`;
      const voice = singingReading.bright * Math.min(1, mouth / 0.5);
      set('adjust', `translate(0 ${(-6 * adj).toFixed(2)})`);
      const tail = grid ? beatSwing * 8 + bob * 3 : Math.sin(t * (idle ? 0.9 : 1.8)) * 7 + bob * 4;
      set('tail', `rotate(${tail.toFixed(2)} 268 292)`);
      const spot = find('spot');
      if (spot) spot.style.opacity = (0.18 + a.bass * 0.55).toFixed(2);
      for (const g of glows) g.style.opacity = (0.55 + a.bass * 0.45 + bob * 0.2).toFixed(2);
      for (const g of voiceGlows) {
        g.style.opacity = Math.min(1, 0.5 + a.bass * 0.4 + bob * 0.15 + voice * 0.5).toFixed(2);
        g.style.transform = `scale(${(1 + voice * 0.5).toFixed(2)})`;
      }

      frame({ t, a, idle, bob, tempo, flourish, hit, rock, $ });
      for (const [el, of] of followers) {
        const tr = of?.getAttribute('transform');
        if (tr) el.setAttribute('transform', tr);
      }
    };
    loop();
    return () => cancelAnimationFrame(raf);
    // `frame` is a new function each render; re-running on it would restart the scene
  }, [still]);
}
