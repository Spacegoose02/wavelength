import { useEffect, useState } from 'react';
import { useDeemixQueue, useFollowDeemix } from '../lib/deemixQueue';
import { NotOnDeezer, sendSong } from '../lib/getSong';
import { findInLibrary } from '../lib/match';
import { radioGetStatus, type RadioSent } from '../lib/radioGet';
import { songFromTitle } from '../lib/radioPicks';
import type { Track } from '../sources/types';
import { usePlayer } from '../store/player';
import { IconDownload, IconPlus } from './Icons';

/** How often, and for how long, the library is checked again for a song that was sent. */
const RECHECK_MS = 20_000;
const RECHECK_FOR_MS = 30 * 60_000;

/**
 * On a radio station, the song it's playing: queue it from your library when you have it, else Get or Request
 * it (lib/getSong.ts), like a song in Discover. After sending, it follows the download in deemix's queue
 * (lib/radioGet.ts) and checks the library again until the song is there, then offers to queue it.
 */
export function RadioGetButton({ text, className = 'chip' }: { text?: string; className?: string }) {
  const song = songFromTitle(text);
  const [mine, setMine] = useState<Track | null>();
  const [queued, setQueued] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<RadioSent>();
  const [error, setError] = useState<string>();
  const items = useDeemixQueue((s) => s.items);
  const read = useDeemixQueue((s) => s.read);
  useFollowDeemix(sent?.via === 'deemix' && !mine);

  useEffect(() => {
    setMine(undefined);
    setQueued(false);
    setSending(false);
    setSent(undefined);
    setError(undefined);
    if (!song) return;
    let alive = true;
    void findInLibrary()(song).then((t) => alive && setMine(t ?? null), () => alive && setMine(null));
    return () => {
      alive = false;
    };
  }, [song?.artist, song?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  // sent: look in the library again now and then, so the button turns into "Queue from library" once it's there
  useEffect(() => {
    if (!song || !sent || mine) return;
    let alive = true;
    const look = () => void findInLibrary()(song).then((t) => alive && t && setMine(t), () => undefined);
    const timer = window.setInterval(() => {
      if (Date.now() - sent.at > RECHECK_FOR_MS) window.clearInterval(timer);
      else look();
    }, RECHECK_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [sent, mine]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!song) return null;
  if (mine) {
    return (
      <button className={className} title={`${mine.title} by ${mine.artist} is in your library: play it after this`} disabled={queued} onClick={() => {
        usePlayer.getState().enqueue([mine]);
        setQueued(true);
      }}><IconPlus /> {queued ? 'In your queue' : 'Queue from library'}</button>
    );
  }
  const get = async () => {
    setSending(true);
    setError(undefined);
    setSent(undefined);
    try {
      const r = await sendSong(song);
      setSent({ ...r, at: Date.now() });
    } catch (e) {
      setError(e instanceof NotOnDeezer ? 'Not on Deezer' : String((e as Error).message ?? e));
    } finally {
      setSending(false);
    }
  };
  const status = sent ? radioGetStatus(sent, items, read) : undefined;
  const label = sending ? 'Sending…' : status ? status.label : error ? (error.length < 24 ? error : 'Couldn’t get it') : 'Get this song';
  const title = status ? status.detail ?? status.label : error ?? `Get ${song.title} by ${song.artist}`;
  // a failed send or download can be tried again; anything else waits
  const canClick = mine === null && !sending && (!sent || status?.kind === 'error') && error !== 'Not on Deezer';
  return (
    <button className={className} title={title} disabled={!canClick} onClick={() => void get()}>
      <IconDownload /> {label}
    </button>
  );
}
