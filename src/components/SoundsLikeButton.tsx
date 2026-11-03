import { useState } from 'react';
import { useFeature } from '../lib/features';
import { journey, soundsLike } from '../lib/sonic';
import type { HubSonicHit } from '../sources/hub';
import type { Track } from '../sources/types';
import { hubClient, useHub } from '../store/hub';
import { usePlayer } from '../store/player';

/**
 * Now Playing: "Sounds like this" (songs that sound like this one, from the Hub's sound-alike analysis) and
 * "Journey to…" (a path of songs from this one to another, each a little closer to it).
 */
export function SoundsLikeButton({ track, className = 'chip' }: { track: Track; className?: string }) {
  const on = useFeature('sonic') && useHub((s) => !!s.token);
  const [msg, setMsg] = useState<string>();
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<HubSonicHit[]>([]);
  if (!on) return null;

  const queue = (list: Track[], keepCurrent: boolean) => {
    const fresh = list.filter((t) => t.id !== track.id);
    if (!fresh.length) return setMsg('Nothing found in your library');
    const p = usePlayer.getState();
    if (keepCurrent && p.current()?.id === track.id) {
      usePlayer.setState({ queue: p.queue.slice(0, p.index + 1) });
      p.enqueue(fresh);
    } else p.playTracks(fresh);
    setMsg(undefined);
  };
  const run = async (f: () => Promise<Track[]>) => {
    setMsg('Listening…');
    try {
      queue(await f(), true);
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    }
  };
  const search = async (v: string) => {
    setQ(v);
    if (v.trim().length < 2) return setHits([]);
    const r = await hubClient()?.sonicSearch(v).catch(() => ({ songs: [] }));
    setHits(r?.songs ?? []);
  };

  return (
    <>
      <button className={className} title={msg ?? 'Songs that sound like this one'} disabled={msg === 'Listening…'} onClick={() => run(() => soundsLike(track))}>
        ≈ {msg ?? 'Sounds like this'}
      </button>
      <button className={className} title="A path of songs from this one to another" onClick={() => setPicking((v) => !v)}>
        ↝ Journey to…
      </button>
      {picking && (
        <div className="eq-pop journey-pop" role="dialog" aria-label="Sonic journey">
          <p className="small muted">Pick where to end up: 20 songs that move step by step from this song to that one.</p>
          <input autoFocus placeholder="Search your library" value={q} onChange={(e) => search(e.target.value)} />
          <div className="journey-hits">
            {hits.map((h) => (
              <button key={h.id} className="link" onClick={() => {
                setPicking(false);
                run(() => journey(track, h));
              }}>
                <b>{h.title}</b> <small className="muted">{h.artist} · {Math.round(h.bpm)} BPM · {h.mood}</small>
              </button>
            ))}
            {q.length >= 2 && !hits.length && <small className="muted">No analyzed songs match.</small>}
          </div>
        </div>
      )}
    </>
  );
}
