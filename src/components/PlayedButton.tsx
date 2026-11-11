import { useState } from 'react';
import type { Track } from '../sources/types';
import { isPlayed, setPlayed, useMarks, withMarks } from '../lib/episodes';

/** "Mark played" / "Played ✓" on a podcast episode's row. Saved on Audiobookshelf, so every device sees it. */
export function PlayedButton({ track, className = 'chip' }: { track: Track; className?: string }) {
  const marks = useMarks((s) => s.marks);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  if (track.kind !== 'episode') return null;
  const played = isPlayed(withMarks([track], marks)[0]);
  return (
    <button type="button" className={`${className} ${played ? 'played' : ''}`} disabled={busy} title={err ?? (played ? 'Mark as unplayed (starts from the top next time)' : 'Mark as played')}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        setErr(undefined);
        try {
          await setPlayed([track], !played);
        } catch (x) {
          setErr(String((x as Error).message ?? x));
        } finally {
          setBusy(false);
        }
      }}>
      {played ? 'Played ✓' : 'Mark played'}
    </button>
  );
}
