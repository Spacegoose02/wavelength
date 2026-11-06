import type { ComponentType } from 'react';
import type { Species } from '../../store/settings';
import { FIGURES, type Figure } from './bodies';
import { AlienFace, BlackBearFace, BrownBearFace, GreyFace, RaccoonFace, SharkFace } from './faces';

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
  /** where the girl version's bow sits on the head: x, y and tilt */
  bow?: [number, number, number];
}

/** In picker order. To add a species: a face (faces.tsx) and a figure (bodies.tsx), an entry below, its id in `Species`, colours in styles.css. */
export const SPECIES: SpeciesInfo[] = [
  { id: 'raccoon', noun: 'raccoon', label: 'Raccoon', Face: RaccoonFace, figure: FIGURES.raccoon, fit: { eyeY: 186, eyes: [1.1, 1.15], bow: [161, 118, -24] } },
  { id: 'shark', noun: 'shark', label: 'Shark', Face: SharkFace, figure: FIGURES.shark, fit: { eyeY: 170, eyes: [1.1, 1.1], bow: [150, 131, -28] } },
  { id: 'alien', noun: 'alien', label: 'Alien', Face: AlienFace, figure: FIGURES.alien, fit: { w: 0.88, eyes: [1.04, 1.4], eyeY: 176, bow: [159, 121, -24] } },
  { id: 'grey', noun: 'gray alien', label: 'Gray alien', Face: GreyFace, figure: FIGURES.grey, fit: { w: 0.94, lift: -12, eyes: [1.2, 1.5], eyeY: 174, bow: [155, 112, -26] } },
  { id: 'bear-black', noun: 'black bear', label: 'Black bear', Face: BlackBearFace, figure: FIGURES.bear, fit: { eyeY: 178, eyes: [1.12, 1.15], bow: [170, 118, -20] } },
  { id: 'bear-brown', noun: 'brown bear', label: 'Brown bear', Face: BrownBearFace, figure: FIGURES.bear, fit: { eyeY: 178, eyes: [1.12, 1.15], bow: [170, 118, -20] } },
];
