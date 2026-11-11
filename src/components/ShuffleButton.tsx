import { cycleShuffle, shuffleLabel } from '../lib/smartShuffle';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { IconShuffle } from './Icons';

/** Off → Shuffle → Smart Shuffle (songs you might like mixed in, lib/smartShuffle.ts). */
export function ShuffleButton() {
  const shuffle = usePlayer((s) => s.shuffle);
  const smart = useSettings((s) => s.smartShuffle) && shuffle;
  const label = shuffleLabel(shuffle, smart);
  return (
    <button type="button" className={`tbtn small shuffle-btn ${shuffle ? 'on' : ''} ${smart ? 'smart' : ''}`} onClick={cycleShuffle} title={label} aria-label={label}>
      <IconShuffle />
      {smart && <sup>✦</sup>}
    </button>
  );
}
