import { useEffect, useState } from 'react';
import { getSong, NotOnDeezer } from '../lib/getSong';
import { findInLibrary } from '../lib/match';
import { songFromTitle } from '../lib/radioPicks';
import type { Track } from '../sources/types';
import { usePlayer } from '../store/player';
import { IconDownload, IconPlus } from './Icons';

/**
 * On a radio station, the song it's playing: queue it from your library when you have it, else Get or Request
 * it (lib/getSong.ts), like a song in Discover.
 */
export function RadioGetButton({ text, className = 'chip' }: { text?: string; className?: string }) {
  const song = songFromTitle(text);
  const [mine, setMine] = useState<Track | null>();
  const [msg, setMsg] = useState<string>();

  useEffect(() => {
    setMine(undefined);
    setMsg(undefined);
    if (!song) return;
    let alive = true;
    void findInLibrary()(song).then((t) => alive && setMine(t ?? null), () => alive && setMine(null));
    return () => {
      alive = false;
    };
  }, [song?.artist, song?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!song) return null;
  if (mine) {
    return (
      <button className={className} title={`${mine.title} by ${mine.artist} is in your library: play it after this`} disabled={!!msg} onClick={() => {
        usePlayer.getState().enqueue([mine]);
        setMsg('In your queue');
      }}><IconPlus /> {msg ?? 'Queue from library'}</button>
    );
  }
  const get = async () => {
    setMsg('…');
    try {
      const via = await getSong(song);
      setMsg(via === 'request' ? 'Requested' : 'Downloading');
    } catch (e) {
      setMsg(e instanceof NotOnDeezer ? 'Not on Deezer' : String((e as Error).message ?? e));
    }
  };
  return (
    <button className={className} title={msg ?? `Get ${song.title} by ${song.artist}`} disabled={mine === undefined || !!msg} onClick={() => void get()}>
      <IconDownload /> {msg && msg.length < 16 ? msg : 'Get this song'}
    </button>
  );
}
