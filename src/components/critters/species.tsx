import type { ComponentType } from 'react';
import type { Species } from '../../store/settings';
import { FIGURES, type Figure } from './bodies';
import {
  AlienFace,
  AxolotlFace,
  BlackBearFace,
  BrownBearFace,
  BunnyFace,
  DragonFace,
  ElephantFace,
  FlamingoFace,
  FoxFace,
  FrogFace,
  GorillaFace,
  GreyFace,
  LionFace,
  MonkeyFace,
  MooseFace,
  OctopusFace,
  OpossumFace,
  OwlFace,
  PandaFace,
  PenguinFace,
  RaccoonFace,
  RedPandaFace,
  SharkFace,
  SlothFace,
  TigerFace,
  TrexFace,
  TurkeyFace,
  TurtleFace,
} from './faces';

/**
 * Who plays: each species is a face (faces.tsx, drawn on the shared skeleton, see parts.tsx) and a figure
 * (bodies.tsx: its body, legs and tail). Every act (DJ, Country, …) draws the scene, clothes and instrument
 * and puts them on the species' figure,
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
  /** the body: head size and place, top, shoulders, legs and tail (bodies.tsx) */
  figure: Figure;
  /** fits the shared headwear and glasses to this head (`Head` in parts.tsx); omit for the usual head */
  fit?: HeadFit;
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
  /** move the Nuclear respirator down (positive) to sit over the mouth, below the eyes */
  mask?: number;
  /** where the girl version's bow sits on the head: x, y and tilt */
  bow?: [number, number, number];
}

/** In picker order. To add a species: a face (faces.tsx) and a figure (bodies.tsx), an entry below, its id in `Species`, colours in styles.css. */
export const SPECIES: SpeciesInfo[] = [
  { id: 'raccoon', noun: 'raccoon', label: 'Raccoon', Face: RaccoonFace, figure: FIGURES.raccoon, fit: { eyeY: 186, eyes: [1.1, 1.15], mask: 8, bow: [161, 118, -24] } },
  { id: 'shark', noun: 'shark', label: 'Shark', Face: SharkFace, figure: FIGURES.shark, fit: { eyeY: 170, eyes: [1.1, 1.1], bow: [150, 131, -28] } },
  { id: 'alien', noun: 'alien', label: 'Alien', Face: AlienFace, figure: FIGURES.alien, fit: { w: 1.08, eyes: [1.3, 1.5], eyeY: 176, mask: 12, bow: [159, 121, -24] } },
  { id: 'grey', noun: 'gray alien', label: 'Gray alien', Face: GreyFace, figure: FIGURES.grey, fit: { w: 1.08, lift: -12, eyes: [1.42, 1.6], eyeY: 174, mask: 14, bow: [155, 112, -26] } },
  { id: 'bear-black', noun: 'black bear', label: 'Black bear', Face: BlackBearFace, figure: FIGURES.bear, fit: { eyeY: 178, eyes: [1.24, 1.22], bow: [170, 118, -20] } },
  { id: 'bear-brown', noun: 'brown bear', label: 'Brown bear', Face: BrownBearFace, figure: FIGURES.bear, fit: { eyeY: 178, eyes: [1.24, 1.22], bow: [170, 118, -20] } },
  { id: 'moose', noun: 'moose', label: 'Moose', Face: MooseFace, figure: FIGURES.moose, fit: { eyeY: 172, eyes: [1.28, 1.2], mask: 16, bow: [168, 116, -20] } },
  { id: 'turtle', noun: 'turtle', label: 'Turtle', Face: TurtleFace, figure: FIGURES.turtle, fit: { eyeY: 172, eyes: [1.3, 1.24], mask: 10, bow: [168, 118, -20] } },
  { id: 'elephant', noun: 'elephant', label: 'Elephant', Face: ElephantFace, figure: FIGURES.elephant, fit: { eyeY: 172, eyes: [1.3, 1.2], mask: 12, bow: [168, 116, -20] } },
  { id: 'tiger', noun: 'tiger', label: 'Tiger', Face: TigerFace, figure: FIGURES.tiger, fit: { eyeY: 176, eyes: [1.28, 1.2], mask: 10, bow: [170, 116, -20] } },
  { id: 'lion', noun: 'lion', label: 'Lion', Face: LionFace, figure: FIGURES.lion, fit: { eyeY: 174, eyes: [1.28, 1.2], mask: 10, bow: [170, 116, -20] } },
  { id: 'panda', noun: 'panda', label: 'Panda', Face: PandaFace, figure: FIGURES.panda, fit: { eyeY: 176, eyes: [1.36, 1.2], mask: 10, bow: [166, 114, -20] } },
  { id: 'owl', noun: 'owl', label: 'Owl', Face: OwlFace, figure: FIGURES.owl, fit: { eyeY: 180, eyes: [1.52, 1.4], mask: 18, bow: [166, 118, -20] } },
  { id: 'trex', noun: 'T. rex', label: 'T. rex', Face: TrexFace, figure: FIGURES.trex, fit: { eyeY: 166, eyes: [1.3, 1.22], mask: 16, bow: [168, 114, -20] } },
  { id: 'monkey', noun: 'monkey', label: 'Monkey', Face: MonkeyFace, figure: FIGURES.monkey, fit: { eyeY: 168, eyes: [1.3, 1.2], mask: 12, bow: [168, 112, -20] } },
  { id: 'flamingo', noun: 'flamingo', label: 'Flamingo', Face: FlamingoFace, figure: FIGURES.flamingo, fit: { eyeY: 166, eyes: [1.32, 1.22], mask: 14, bow: [168, 114, -20] } },
  { id: 'gorilla', noun: 'gorilla', label: 'Gorilla', Face: GorillaFace, figure: FIGURES.gorilla, fit: { w: 1.04, lift: -6, eyeY: 168, eyes: [1.26, 1.16], mask: 14, bow: [166, 106, -20] } },
  { id: 'penguin', noun: 'penguin', label: 'Penguin', Face: PenguinFace, figure: FIGURES.penguin, fit: { eyeY: 172, eyes: [1.3, 1.2], mask: 12, bow: [168, 114, -20] } },
  { id: 'fox', noun: 'fox', label: 'Fox', Face: FoxFace, figure: FIGURES.fox, fit: { eyeY: 170, eyes: [1.28, 1.2], mask: 10, bow: [168, 114, -20] } },
  { id: 'axolotl', noun: 'axolotl', label: 'Axolotl', Face: AxolotlFace, figure: FIGURES.axolotl, fit: { w: 1.06, lift: 6, eyeY: 172, eyes: [1.5, 1.2], mask: 12, bow: [166, 120, -20] } },
  { id: 'sloth', noun: 'sloth', label: 'Sloth', Face: SlothFace, figure: FIGURES.sloth, fit: { eyeY: 170, eyes: [1.26, 1.16], mask: 12, bow: [168, 114, -20] } },
  { id: 'octopus', noun: 'octopus', label: 'Octopus', Face: OctopusFace, figure: FIGURES.octopus, fit: { lift: -10, eyeY: 176, eyes: [1.32, 1.24], mask: 14, bow: [168, 104, -20] } },
  { id: 'dragon', noun: 'dragon', label: 'Dragon', Face: DragonFace, figure: FIGURES.dragon, fit: { eyeY: 166, eyes: [1.3, 1.22], mask: 16, bow: [168, 114, -20] } },
  { id: 'frog', noun: 'frog', label: 'Frog', Face: FrogFace, figure: FIGURES.frog, fit: { w: 1.1, lift: -26, eyeY: 140, eyes: [1.5, 1.3], mask: 18, bow: [162, 92, -20] } },
  { id: 'bunny', noun: 'bunny', label: 'Bunny', Face: BunnyFace, figure: FIGURES.bunny, fit: { eyeY: 170, eyes: [1.28, 1.2], mask: 10, bow: [178, 112, -10] } },
  { id: 'red-panda', noun: 'red panda', label: 'Red panda', Face: RedPandaFace, figure: FIGURES.redPanda, fit: { eyeY: 170, eyes: [1.3, 1.2], mask: 10, bow: [168, 114, -20] } },
  { id: 'turkey', noun: 'turkey', label: 'Turkey', Face: TurkeyFace, figure: FIGURES.turkey, fit: { eyeY: 168, eyes: [1.36, 1.3], mask: 12, bow: [166, 112, -20] } },
  { id: 'opossum', noun: 'opossum', label: 'Opossum', Face: OpossumFace, figure: FIGURES.opossum, fit: { eyeY: 170, eyes: [1.28, 1.2], mask: 14, bow: [166, 112, -20] } },
];
