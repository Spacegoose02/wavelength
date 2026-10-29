import type { RaccoonKind } from '../../store/settings';
import { Country } from './Country';
import { DJ } from './DJ';
import { Rapper } from './Rapper';
import { Rocker } from './Rocker';

/** The raccoons the raccoon scene can show, in picker order. */
export const RACCOONS: { id: RaccoonKind; label: string; blurb: string }[] = [
  { id: 'dj', label: 'DJ raccoon', blurb: 'Scratches records behind two decks' },
  { id: 'country', label: 'Country raccoon', blurb: 'Cowboy hat, acoustic guitar, taps his boot' },
  { id: 'rapper', label: 'Rapper raccoon', blurb: 'Cap, shades and chain, raps into the mic' },
  { id: 'rocker', label: 'Rocker raccoon', blurb: 'Mohawk, flying-V, headbangs in front of the amps' },
];

export const raccoonLabel = (kind: RaccoonKind) => RACCOONS.find((r) => r.id === kind)?.label ?? 'Raccoon';

/**
 * Now Playing raccoon scene. All four share one rig (`rig.ts`: bob to the beat, blink, yawn when paused)
 * and one head (`parts.tsx`: holiday hats and skin-group outfits). `still` draws a single frame for
 * the Settings picker.
 */
export function Raccoon({ kind, still }: { kind: RaccoonKind; still?: boolean }) {
  switch (kind) {
    case 'country': return <Country still={still} />;
    case 'rapper': return <Rapper still={still} />;
    case 'rocker': return <Rocker still={still} />;
    default: return <DJ still={still} />;
  }
}
