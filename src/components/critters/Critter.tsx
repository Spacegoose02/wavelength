import type { ComponentType } from 'react';
import { useSettings, type Act, type Species } from '../../store/settings';
import { Accordion } from './Accordion';
import { Bongo } from './Bongo';
import { Country } from './Country';
import { DJ } from './DJ';
import { Drive } from './Drive';
import { Drums } from './Drums';
import { GirlContext } from './faces';
import { Harp } from './Harp';
import { Marimba } from './Marimba';
import { Piano } from './Piano';
import { Rapper } from './Rapper';
import { Reactor } from './Reactor';
import { Rocker } from './Rocker';
import { Sax } from './Sax';
import { SPECIES, type ActProps, type SpeciesInfo } from './species';
import { Synth } from './Synth';
import { Theremin } from './Theremin';
import { Tuba } from './Tuba';
import { Violin } from './Violin';

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
  { id: 'rapper', label: 'Rapper', blurb: 'Gold chain and a mic, raps between the speakers', Scene: Rapper },
  { id: 'rocker', label: 'Rocker', blurb: 'Leather jacket, flying-V, headbangs in front of the amps', Scene: Rocker },
  { id: 'drums', label: 'Drummer', blurb: 'Sailor tee, drum kit and bubbles, under the sea', Scene: Drums },
  { id: 'theremin', label: 'Theremin', blurb: 'Space-age tunic, plays a theremin on the moon under a UFO', Scene: Theremin },
  { id: 'synth', label: 'Synth', blurb: 'Plays a synth in a crop circle under a tractor beam', Scene: Synth },
  { id: 'accordion', label: 'Accordion', blurb: 'Beanie and sweater, squeezes an accordion by the campfire', Scene: Accordion },
  { id: 'drive', label: 'Driver', blurb: 'Cap and scarf, swerves an open-top car down the road at sunset, singing', Scene: Drive },
  { id: 'reactor', label: 'Reactor', blurb: 'Hard hat and lab coat, rocks a keytar in front of a glowing reactor core', Scene: Reactor },
  { id: 'bongo', label: 'Bongo', blurb: 'Hawaiian shirt, lei and straw hat, slaps bongos on the beach by the tiki torches', Scene: Bongo },
  { id: 'piano', label: 'Pianist', blurb: 'Tuxedo and bow tie, plays stride piano on a grand in a jazz lounge', Scene: Piano },
  { id: 'marimba', label: 'Marimba', blurb: 'Pith helmet and khaki, plays a marimba in the jungle by a waterfall', Scene: Marimba },
  { id: 'violin', label: 'Violinist', blurb: 'Long coat and flat cap, busks on the violin under a street lamp in the rain', Scene: Violin },
  { id: 'sax', label: 'Saxophone', blurb: 'Beret and roll-neck, plays the sax on a city rooftop under a string of lights', Scene: Sax },
  { id: 'harp', label: 'Harpist', blurb: 'Laurel wreath and toga, plays a golden harp on a cloud at sunrise under a rainbow', Scene: Harp },
  { id: 'tuba', label: 'Tuba', blurb: 'Band hat and braided jacket, oom-pahs on a tuba in a snowy town square', Scene: Tuba },
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
 * the species' face). `still` draws one paused frame, for the Settings cards. The boy or girl look comes
 * from settings (`critterLook`) unless `girl` is given.
 */
export function Critter({ species, act, still, girl }: { species: Species; act: Act; still?: boolean; girl?: boolean }) {
  const { Scene } = findAct(act);
  const look = useSettings((s) => s.critterLook);
  const isGirl = girl ?? look === 'girl';
  // keyed by species and look so the rig picks up the new face's parts (lashes live in the eyes group)
  return (
    <GirlContext.Provider value={isGirl}>
      <Scene key={`${species}-${isGirl}`} species={findSpecies(species)} still={still} />
    </GirlContext.Provider>
  );
}
