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
 * Strums hard on strong highs, on the beat otherwise; changes chord on some beats; rests when paused.
 */
export function playGuitar({ t, a, idle, bob, hit, rock, $ }: RigFrame, s: GuitarHands, neckDeg: number, strength = 1) {
  const strum = idle ? Math.sin(t * 1.1) * 1.5 : hit ? rock * 12 : a.live ? (bob - 0.4) * 12 : Math.sin(t * 6) * 6;
  $('arm-l').setAttribute('transform', `rotate(${(strum * strength).toFixed(2)} 138 268)`);

  if (a.beat && Math.random() < 0.35) s.target = [-22, -10, 0, 8][Math.floor(Math.random() * 4)];
  if (idle) s.target = 0;
  s.chord += (s.target - s.chord) * 0.25;
  const rad = (neckDeg * Math.PI) / 180;
  $('arm-r').setAttribute('transform', `translate(${(Math.cos(rad) * s.chord).toFixed(2)} ${(-Math.sin(rad) * s.chord).toFixed(2)})`);

  const buzz = a.playing ? Math.sin(t * 70) * (0.4 + a.bass * 1.6) : 0;
  $('strings').setAttribute('transform', `translate(0 ${buzz.toFixed(2)})`);
  $('guitar').setAttribute('transform', `rotate(${(bob * -3 * strength).toFixed(2)} 200 320)`);
}
