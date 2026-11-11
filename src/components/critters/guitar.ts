import { bend } from './arm';
import type { RigFrame } from './rig';

/** Hand state for a raccoon holding a guitar (country, rocker). */
export interface GuitarHands {
  chord: number;
  target: number;
}

export const newGuitarHands = (): GuitarHands => ({ chord: 0, target: 0 });

/**
 * Strumming hand on `arm-l` (shoulder 138,268), fretting hand on `arm-r` sliding along a neck tilted
 * `neckDeg` degrees, strings (`strings`) shaking with the bass and the guitar (`guitar`) rocking on beats.
 * Both hands move from the elbow (`bend`, arm.ts): the upper arms stay where they are.
 *
 * Once the tempo is locked the hand strums in time: down on the beat and up between, `strokes` per beat
 * (2, eighth notes, for the rocker; 4, a sixteenth-note banjo roll, for country), deeper when the band is
 * loud. Otherwise it strums on each detected hit. A strong high hit always gets a hard strum. The fretting
 * hand changes chord (slides along the neck) on some beats, presses into the neck as each strum lands and
 * shakes a vibrato on strong highs; it rests when paused.
 */
export function playGuitar({ t, a, idle, bob, tempo, hit, rock, $ }: RigFrame, s: GuitarHands, neckDeg: number, strength = 1, strokes = 2) {
  const stroke = (tempo.phase * strokes) % 1;
  const inTime = -Math.cos(2 * Math.PI * stroke) * (5 + Math.min(1, a.mid + a.treble) * 8) * (2 / strokes) ** 0.5;
  const strum = idle ? Math.sin(t * 1.1) * 1.5 : hit ? rock * 12 : tempo.locked ? inTime : a.live ? (bob - 0.4) * 12 : Math.sin(t * 6) * 6;
  // the forearm is about half the arm, so it turns about twice as far for the same sweep across the strings;
  // the wrist flicks ahead of it
  bend($, 'arm-l', { turn: strum * strength * 1.9, wrist: strum * strength * 0.8 });

  // chord changes land on the beat: the grid's beat once locked on, else a detected hit
  if ((tempo.locked ? tempo.on : a.beat) && Math.random() < 0.5) s.target = [-14, -6, 2, 10][Math.floor(Math.random() * 4)];
  if (idle) s.target = 0;
  s.chord += (s.target - s.chord) * 0.3;
  const rad = (neckDeg * Math.PI) / 180;
  // along the neck (towards the headstock is +), and across it (+ presses down into the strings)
  const along = s.chord + (hit ? rock * 2.5 : 0);
  const press = idle ? 0 : tempo.locked ? Math.max(0, Math.cos(2 * Math.PI * stroke)) * 2.5 : bob * 2.5;
  bend($, 'arm-r', {
    to: [Math.cos(rad) * along + Math.sin(rad) * press, -Math.sin(rad) * along + Math.cos(rad) * press],
    wrist: idle ? 0 : -press * 2,
  });

  const buzz = a.playing ? Math.sin(t * 70) * (0.4 + a.bass * 1.6) : 0;
  $('strings').setAttribute('transform', `translate(0 ${buzz.toFixed(2)})`);
  $('guitar').setAttribute('transform', `rotate(${(bob * -3 * strength).toFixed(2)} 200 320)`);
}
