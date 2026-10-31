import { useState } from 'react';
import { songRadio } from '../lib/songRadio';
import type { Track } from '../sources/types';
import { usePlayer } from '../store/player';
import { IconRadio } from './Icons';

/**
 * "Song radio" / "Artist radio": replace the queue with songs from your library like this one (lib/songRadio.ts).
 * With a track, it keeps playing and the radio follows it.
 */
export function SongRadioButton({ artist, track, className = 'btn' }: { artist: string; track?: Track; className?: string }) {
  const [msg, setMsg] = useState<string>();
  const label = track ? 'Song radio' : 'Artist radio';
  const start = async () => {
    setMsg('Finding songs…');
    try {
      const list = await songRadio({ artist, title: track?.title, track }, (n) => setMsg(`Found ${n}…`));
      const fresh = list.filter((t) => t.id !== track?.id);
      if (!fresh.length) return setMsg('Nothing like it in your library');
      const p = usePlayer.getState();
      if (track && p.current()?.id === track.id) {
        // keep the song that's playing and replace what comes after it
        usePlayer.setState({ queue: p.queue.slice(0, p.index + 1) });
        p.enqueue(fresh);
      } else p.playTracks(list);
      setMsg(undefined);
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    }
  };
  return (
    <button className={className} title={msg ?? `Play songs from your library like ${track ? 'this one' : artist}`} disabled={msg === 'Finding songs…' || msg?.startsWith('Found')} onClick={start}>
      <IconRadio /> {msg ?? label}
    </button>
  );
}
