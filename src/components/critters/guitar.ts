import { fretArmPath } from './parts';
import type { RigFrame } from './rig';

/** Hand state for a raccoon holding a guitar (country, rocker). */
export interface GuitarHands {
  chord: number;
  target: number;
}

export const newGuitarHands = (): GuitarHands => ({ chord: 0, target: 0 });

/**
 * Strumming hand on `arm-l` (shoulder 138,268), fretting hand (`FretArm` and `FretHand` in parts.tsx: the arm
 * behind the neck, the hand in front) sliding along a neck tilted `neckDeg` degrees, strings (`strings`) shaking with the bass and the guitar (`guitar`) rocking on beats.
 * Once the tempo is locked the hand strums in time: down on the beat and up between, `strokes` per beat
 * (2, eighth notes, for the rocker; 4, a sixteenth-note banjo roll, for country), deeper when the band is
 * loud. Otherwise it strums on each detected hit. A strong high hit always gets a hard strum. Changes chord
 * on some beats; rests when paused.
 */
export function playGuitar({ t, a, idle, bob, tempo, hit, rock, $ }: RigFrame, s: GuitarHands, neckDeg: number, strength = 1, strokes = 2) {
  const inTime = -Math.cos(2 * Math.PI * ((tempo.phase * strokes) % 1)) * (5 + Math.min(1, a.mid + a.treble) * 8) * (2 / strokes) ** 0.5;
  const strum = idle ? Math.sin(t * 1.1) * 1.5 : hit ? rock * 12 : tempo.locked ? inTime : a.live ? (bob - 0.4) * 12 : Math.sin(t * 6) * 6;
  $('arm-l').setAttribute('transform', `rotate(${(strum * strength).toFixed(2)} 138 268)`);

  // chord changes land on the beat: the grid's beat once locked on, else a detected hit
  if ((tempo.locked ? tempo.on : a.beat) && Math.random() < 0.35) s.target = [-22, -10, 0, 8][Math.floor(Math.random() * 4)];
  if (idle) s.target = 0;
  s.chord += (s.target - s.chord) * 0.25;
  // the hand slides along the neck and the arm is redrawn from the shoulder, which stays put (parts.tsx FretArm)
  const rad = (neckDeg * Math.PI) / 180;
  const arm = $('arm-r').querySelector<SVGElement>('[data-fret-arm]');
  if (arm) {
    const [sx, sy, hx, hy] = arm.dataset.fretArm!.split(' ').map(Number);
    const at: [number, number] = [hx + Math.cos(rad) * s.chord, hy - Math.sin(rad) * s.chord];
    const d = fretArmPath([sx, sy], at);
    for (const path of arm.querySelectorAll('path')) path.setAttribute('d', d);
    const hand = $('arm-r-hand')?.querySelector('circle');
    hand?.setAttribute('cx', at[0].toFixed(1));
    hand?.setAttribute('cy', at[1].toFixed(1));
  }

  const buzz = a.playing ? Math.sin(t * 70) * (0.4 + a.bass * 1.6) : 0;
  $('strings').setAttribute('transform', `translate(0 ${buzz.toFixed(2)})`);
  $('guitar').setAttribute('transform', `rotate(${(bob * -3 * strength).toFixed(2)} 200 320)`);
}
