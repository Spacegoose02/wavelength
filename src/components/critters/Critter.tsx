import type { ComponentType } from 'react';
import type { Act, Species } from '../../store/settings';
import { Accordion } from './Accordion';
import { Country } from './Country';
import { DJ } from './DJ';
import { Drums } from './Drums';
import { Rapper } from './Rapper';
import { Rocker } from './Rocker';
import { SPECIES, type ActProps, type SpeciesInfo } from './species';
import { Synth } from './Synth';
import { Theremin } from './Theremin';

export { SPECIES, type SpeciesInfo };

export interface ActInfo {
  id: Act;
  /** goes in front of the species ("Rocker shark") and on the Settings card */
  label: string;
  /** one line under the label on the Settings card */
  blurb: string;
  /** the scene: background, clothes, instrument and hands, with the species' face and tail */
  Scene: ComponentType<ActProps>;
}

/**
 * What the critter does, in picker order ("Switch act" steps through this list). Any species can play any
 * act (species.tsx). To add an act: a component in this folder (see CONTRIBUTING.md, "Add a critter, an
 * act or an outfit"), its id in `Act` in store/settings.ts and an entry here.
 */
export const ACTS: ActInfo[] = [
  { id: 'dj', label: 'DJ', blurb: 'Scratches records behind two decks', Scene: DJ },
  { id: 'country', label: 'Country', blurb: 'Cowboy hat, banjo, taps a boot on the porch', Scene: Country },
  { id: 'rapper', label: 'Rapper', blurb: 'Cap, shades and chain, raps into the mic', Scene: Rapper },
  { id: 'rocker', label: 'Rocker', blurb: 'Mohawk, flying-V, headbangs in front of the amps', Scene: Rocker },
  { id: 'drums', label: 'Drummer', blurb: 'Sailor tee, drum kit and bubbles, under the sea', Scene: Drums },
  { id: 'theremin', label: 'Theremin', blurb: 'Space suit, plays a theremin on the moon under a UFO', Scene: Theremin },
  { id: 'synth', label: 'Synth', blurb: 'Plays a synth in a crop circle under a tractor beam', Scene: Synth },
  { id: 'accordion', label: 'Accordion', blurb: 'Beanie and sweater, squeezes an accordion by the campfire', Scene: Accordion },
];

/** Unknown ids (e.g. synced from a newer app) fall back to the first entry. */
export const findSpecies = (id: Species) => SPECIES.find((s) => s.id === id) ?? SPECIES[0];
export const findAct = (id: Act) => ACTS.find((a) => a.id === id) ?? ACTS[0];

/** "Rocker shark", "DJ raccoon", "Synth grey alien" */
export const critterLabel = (species: Species, act: Act) => `${findAct(act).label} ${findSpecies(species).noun}`;

const after = <T,>(list: T[], item: T) => list[(list.indexOf(item) + 1) % list.length];
export const nextSpecies = (id: Species) => after(SPECIES, findSpecies(id));
export const nextAct = (id: Act) => after(ACTS, findAct(id));

/**
 * Now Playing critter scene: `species` playing `act`. Every act shares one rig (`rig.ts`: bob to the beat,
 * blink, sing along, yawn when paused) and one head (`parts.tsx`: holiday hats and skin-group outfits over
 * the species' face). `still` draws one paused frame, for the Settings cards.
 */
export function Critter({ species, act, still }: { species: Species; act: Act; still?: boolean }) {
  const { Scene } = findAct(act);
  // keyed by species so the rig picks up the new face's parts when only the species changes
  return <Scene key={species} species={findSpecies(species)} still={still} />;
}
