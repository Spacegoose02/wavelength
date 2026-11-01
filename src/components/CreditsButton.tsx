import { Fragment, useEffect, useRef, useState } from 'react';
import { songCredits, type Credit } from '../lib/artistInfo';
import { useFeature } from '../lib/features';
import type { Track } from '../sources/types';

/** Now Playing: who wrote, produced and played on the song (MusicBrainz, lib/artistInfo.ts). */
export function CreditsButton({ track }: { track: Track }) {
  const on = useFeature('artistInfo');
  const [open, setOpen] = useState(false);
  const [credits, setCredits] = useState<Credit[] | null>();
  const ref = useRef<HTMLDivElement>(null);
  const id = `${track.sourceId}:${track.id}`;
  useEffect(() => {
    setCredits(undefined);
  }, [id]);
  useEffect(() => {
    if (!open) return;
    if (credits === undefined) songCredits(track).then(setCredits, () => setCredits(null));
    const click = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', click);
      document.removeEventListener('keydown', key);
    };
  }, [open, id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!on || track.kind !== 'track') return null;
  return (
    <div className="eq-anchor" ref={ref}>
      <button className={`chip ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title="Who wrote and produced this song">Credits</button>
      {open && (
        <div className="eq-pop credits-pop" role="dialog" aria-label="Song credits">
          <h3>{track.title}</h3>
          {credits === undefined ? <p className="muted small">Looking it up…</p> : !credits?.length ? (
            <p className="muted small">{credits === null ? 'Couldn’t reach MusicBrainz.' : 'MusicBrainz has no credits for this song yet.'}</p>
          ) : (
            <dl className="small">
              {credits.map((c) => <Fragment key={c.role}><dt>{c.role}</dt><dd>{c.names.join(', ')}</dd></Fragment>)}
            </dl>
          )}
          <p className="muted small">From MusicBrainz, which anyone can add to.</p>
        </div>
      )}
    </div>
  );
}
