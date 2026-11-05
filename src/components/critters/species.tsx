import type { ComponentType } from 'react';
import type { Species } from '../../store/settings';
import { Tail as RaccoonTail } from './parts';
import { AlienFace, BlackBearFace, BrownBearFace, GreyFace, RaccoonFace, SharkFace } from './faces';

/**
 * Who plays: each species is a face (drawn on the shared skeleton, see parts.tsx) and an optional tail.
 * Every act (DJ, Country, …) draws the scene, clothes and instrument and puts the species' face on top,
 * so any species can play any act. Skin colours for hands and bare arms come from CSS variables set on
 * `.species-<id>` in styles.css (`--skin`, `--skin-dark`).
 */
/** What every act component takes. */
export interface ActProps {
  species: SpeciesInfo;
  /** draw one paused frame and stop (Settings cards) */
  still?: boolean;
}

export interface SpeciesInfo {
  id: Species;
  /** "raccoon", "grey alien": the act's label goes in front ("Rocker raccoon") */
  noun: string;
  /** Settings card label */
  label: string;
  Face: ComponentType;
  /** wagged by the rig about 268,292; omit for no tail */
  Tail?: ComponentType;
  /**
   * Drawn instead of the act's trousers and shoes (`Legs` in parts.tsx): the shark has a tail end and
   * fins, not legs. It must have a `boot` part, which the country act taps on the beat.
   */
  Lower?: ComponentType;
  /** body width against the usual torso (1); the aliens are slim */
  build?: number;
  /** fits the shared headwear and glasses to this head (`Head` in parts.tsx); omit for the usual head */
  fit?: HeadFit;
  /** the shadow the head casts on the top: an ellipse just under the chin, clipped to the torso */
  shadow?: { rx: number; ry: number; cy: number };
}

export interface HeadFit {
  /** width of hats, headphones and hoods against the usual 160-wide head */
  w?: number;
  /** raise (negative) or lower hats and headphones for a taller or shorter head */
  lift?: number;
  /** stretch glasses, shades and visors (x, y about the eyes at 200,166) to cover bigger eyes */
  eyes?: [number, number];
  /** where the eyes are, for glasses, shades and visors (drawn for eyes on y 166) */
  eyeY?: number;
}

/**
 * The shark's tail end, in place of legs: the body tapers to a white-bellied point between two pelvic fins
 * (the right one, `boot`, taps in the country act).
 */
function SharkLower() {
  return (
    <>
      <path className="shark-skin" d="M156 290 H244 C 250 326 232 352 200 358 C 168 352 150 326 156 290 Z" />
      <path className="shark-belly" d="M172 292 H228 C 232 324 220 344 200 350 C 180 344 168 324 172 292 Z" />
      <path className="shark-dark" d="M170 330 C 150 336 138 352 134 366 C 152 362 168 356 182 346 Z" />
      <path data-part="boot" className="shark-dark" d="M230 330 C 250 336 262 352 266 366 C 248 362 232 356 218 346 Z" />
    </>
  );
}

/** The tail fin, standing on the ground to the right and swishing about the hip (rig, 268,292). */
function SharkTail() {
  return (
    <g data-part="tail">
      <path className="shark-skin" d="M220 330 C 256 352 290 352 314 334 L 330 282 Q 344 316 334 340 Q 354 350 368 368 Q 340 364 318 360 C 288 372 248 366 214 350 Z" />
      <path className="shark-dark" d="M318 336 L 330 282 Q 344 316 334 340 Z" />
    </g>
  );
}

/** In picker order. To add a species: a face (and tail) here, an entry below, its id in `Species`, colours in styles.css. */
export const SPECIES: SpeciesInfo[] = [
  { id: 'raccoon', noun: 'raccoon', label: 'Raccoon', Face: RaccoonFace, fit: { eyeY: 186, eyes: [1.1, 1.15] }, Tail: RaccoonTail },
  { id: 'shark', noun: 'shark', label: 'Shark', Face: SharkFace, fit: { eyeY: 170, eyes: [1.1, 1.1] }, Tail: SharkTail, Lower: SharkLower },
  { id: 'alien', noun: 'alien', label: 'Alien', Face: AlienFace, build: 0.82, fit: { w: 0.88, eyes: [1.04, 1.4], eyeY: 176 }, shadow: { rx: 58, ry: 60, cy: 190 } },
  { id: 'grey', noun: 'gray alien', label: 'Gray alien', Face: GreyFace, build: 0.78, fit: { w: 0.94, lift: -12, eyes: [1.2, 1.5], eyeY: 174 }, shadow: { rx: 42, ry: 70, cy: 194 } },
  { id: 'bear-black', noun: 'black bear', label: 'Black bear', Face: BlackBearFace, fit: { eyeY: 178, eyes: [1.12, 1.15] } },
  { id: 'bear-brown', noun: 'brown bear', label: 'Brown bear', Face: BrownBearFace, fit: { eyeY: 178, eyes: [1.12, 1.15] } },
];
