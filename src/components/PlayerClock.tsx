import { useShallow } from 'zustand/react/shallow';
import { usePlayer, type PlayerState } from '../store/player';
import { fmtTime } from './common';

/**
 * The player store without `position`. Position changes about four times a second while a song plays
 * (store/player.ts, timeupdate), so a component that reads the whole store re-renders that often, and
 * so does everything inside it (in Now Playing that's the critter's whole SVG, the lyrics and every
 * button). Read this instead, and show the time with the small components below, which are the only
 * parts that need to follow the clock.
 */
export function usePlayerControls(): Omit<PlayerState, 'position'> {
  return usePlayer(useShallow(({ position: _position, ...rest }: PlayerState) => rest));
}

/** Time into the song, m:ss. */
export function Elapsed() {
  const position = usePlayer((s) => s.position);
  return <>{fmtTime(position)}</>;
}

interface SeekProps {
  className?: string;
  /** live radio: the bar sits full and can't be dragged */
  live?: boolean;
  disabled?: boolean;
  /** show the time left (-m:ss) instead of the song's length on the right */
  remaining?: boolean;
}

/** The seek bar with the time on each side. */
export function Seek({ className = 'seek', live = false, disabled = false, remaining = false }: SeekProps) {
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  const max = live ? 1 : duration || 1;
  const value = live ? 1 : position;
  return (
    <div className={className}>
      <span>{fmtTime(position)}</span>
      <input type="range" min={0} max={max} step={0.5} value={value} disabled={live || disabled}
        aria-label="Seek" aria-valuetext={live ? 'Live' : `${fmtTime(position)} of ${fmtTime(duration)}`}
        onChange={(e) => seek(Number(e.target.value))}
        style={{ ['--pct' as string]: `${live ? 100 : (position / (duration || 1)) * 100}%` }} />
      <span>{live ? 'LIVE' : remaining ? `-${fmtTime(Math.max(0, duration - position))}` : fmtTime(duration)}</span>
    </div>
  );
}

/** The thin progress line on the phone's mini player. */
export function MiniProgress({ live = false }: { live?: boolean }) {
  const pct = usePlayer((s) => (live ? 100 : (s.position / (s.duration || 1)) * 100));
  return <div className="mini-progress"><i style={{ width: `${pct}%` }} /></div>;
}
