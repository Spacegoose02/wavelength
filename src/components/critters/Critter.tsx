import type { ComponentType } from 'react';
import type { CritterKind } from '../../store/settings';
import { Alien } from './Alien';
import { BlackBear, BrownBear } from './Bear';
import { Country } from './Country';
import { DJ } from './DJ';
import { Grey } from './Grey';
import { Rapper } from './Rapper';
import { Rocker } from './Rocker';
import { Shark } from './Shark';

export interface CritterInfo {
  id: CritterKind;
  /** shown on the Settings card and in the hint when you switch */
  label: string;
  /** one line under the label on the Settings card */
  blurb: string;
  /** the scene; `still` draws one paused frame (Settings cards) */
  Scene: ComponentType<{ still?: boolean }>;
}

/**
 * Every critter the critter scene can show, in picker order ("Switch critter" steps through this list).
 * To add one: draw it in this folder (see CONTRIBUTING.md, "Add a critter"), add its id to `CritterKind`
 * in store/settings.ts and an entry here. Nothing else needs to change.
 */
export const CRITTERS: CritterInfo[] = [
  { id: 'dj', label: 'DJ raccoon', blurb: 'Scratches records behind two decks', Scene: DJ },
  { id: 'country', label: 'Country raccoon', blurb: 'Cowboy hat, acoustic guitar, taps his boot', Scene: Country },
  { id: 'rapper', label: 'Rapper raccoon', blurb: 'Cap, shades and chain, raps into the mic', Scene: Rapper },
  { id: 'rocker', label: 'Rocker raccoon', blurb: 'Mohawk, flying-V, headbangs in front of the amps', Scene: Rocker },
  { id: 'shark', label: 'Drummer shark', blurb: 'Sailor tee, drum kit, bubbles on the bass, under the sea', Scene: Shark },
  { id: 'alien', label: 'Theremin alien', blurb: 'Antennae, space suit, plays a theremin under a UFO', Scene: Alien },
  { id: 'grey', label: 'Grey alien', blurb: 'Big head, huge black eyes, plays a synth in a crop circle', Scene: Grey },
  { id: 'bear-black', label: 'Black bear', blurb: 'Beanie and sweater, squeezes an accordion by the campfire', Scene: BlackBear },
  { id: 'bear-brown', label: 'Brown bear', blurb: 'The same bear in brown fur, accordion and campfire', Scene: BrownBear },
];

const find = (kind: CritterKind) => CRITTERS.find((c) => c.id === kind) ?? CRITTERS[0];

export const critterLabel = (kind: CritterKind) => find(kind).label;

/** The critter after `kind` in picker order, wrapping round. */
export const nextCritter = (kind: CritterKind) => CRITTERS[(CRITTERS.indexOf(find(kind)) + 1) % CRITTERS.length];

/**
 * Now Playing critter scene. Every critter shares one rig (`rig.ts`: bob to the beat, blink, yawn when
 * paused) and one head (`parts.tsx`: holiday hats and skin-group outfits over each critter's own face).
 * An unknown id (e.g. synced from a newer app) shows the first critter.
 */
export function Critter({ kind, still }: { kind: CritterKind; still?: boolean }) {
  const { Scene } = find(kind);
  return <Scene still={still} />;
}
