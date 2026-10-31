import { useEffect, useMemo, useRef, useState } from 'react';
import { currentLine, lyricsFor, maskForKids, type Lyrics } from '../lib/lyrics';
import { useIsKid } from '../lib/kids';
import { sourceFor } from '../sources/registry';
import type { Track } from '../sources/types';
import { useSettings } from '../store/settings';
import { usePlayer } from '../store/player';
import { Spinner } from './common';

/**
 * Now Playing lyrics (lib/lyrics.ts). Synced lyrics follow the song, karaoke style: the line being sung is lit and
 * kept in view, and tapping a line jumps there. Plain lyrics just scroll.
 */
export function LyricsPanel({ track }: { track: Track }) {
  const [state, setState] = useState<{ key: string; lyrics?: Lyrics; loading: boolean }>({ key: '', loading: true });
  const key = `${track.sourceId}:${track.id}`;
  const kid = useIsKid();
  const position = usePlayer((s) => s.position);
  const seek = usePlayer((s) => s.seek);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    setState({ key, loading: true });
    const cfg = useSettings.getState().sources.find((s) => s.id === track.sourceId);
    lyricsFor(track, cfg ? sourceFor(cfg) : undefined)
      .catch(() => undefined)
      .then((lyrics) => live && setState({ key, lyrics, loading: false }));
    return () => {
      live = false;
    };
    // one fetch per song (track objects change when a source refreshes them)
  }, [key]);

  const lines = useMemo(
    () => state.lyrics?.lines.map((l) => ({ ...l, text: kid ? maskForKids(l.text) : l.text })) ?? [],
    [state.lyrics, kid],
  );
  const synced = !!state.lyrics?.synced;
  const at = synced ? currentLine(lines, position + 0.2) : -1;

  useEffect(() => {
    if (at < 0) return;
    // scroll only the lyrics box (scrollIntoView would move the whole Now Playing page too)
    const box = list.current;
    const line = box?.querySelector<HTMLElement>(`[data-line="${at}"]`);
    if (box && line) box.scrollTo({ top: line.offsetTop - box.clientHeight / 2 + line.offsetHeight / 2, behavior: 'smooth' });
  }, [at]);

  if (state.loading || state.key !== key) return <div className="lyrics"><Spinner /></div>;
  if (state.lyrics?.instrumental) return <div className="lyrics empty">♪ Instrumental ♪</div>;
  if (!lines.length) return <div className="lyrics empty">No lyrics found for this song.</div>;
  return (
    <div className={`lyrics ${synced ? 'synced' : ''}`} ref={list}>
      {lines.map((l, i) => (
        synced ? (
          <button key={i} data-line={i} className={`lyric ${i === at ? 'now' : i < at ? 'past' : ''}`} onClick={() => l.time !== undefined && seek(l.time)}>
            {l.text || '♪'}
          </button>
        ) : (
          <p key={i} className="lyric">{l.text || ' '}</p>
        )
      ))}
      <div className="lyrics-credit muted small">Lyrics from {state.lyrics?.source}{kid ? ', strong words hidden' : ''}</div>
    </div>
  );
}
