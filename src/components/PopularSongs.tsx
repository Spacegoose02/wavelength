import { useEffect, useMemo, useState } from 'react';
import { TrackList } from './common';
import { IconPlay, IconShuffle } from './Icons';
import { popularSongs } from '../lib/popularSongs';
import { useHidden } from '../lib/kids';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import type { Track } from '../sources/types';

/** Rows shown before "Show more". */
const FIRST = 5;

/**
 * "Popular" on an artist page: the artist's best-known songs that are in your library (lib/popularSongs.ts), with
 * Play and Shuffle for all of them. Nothing shows until they're found, and nothing at all when none are.
 */
export function PopularSongs({ artist }: { artist: string }) {
  const [songs, setSongs] = useState<Track[]>([]);
  const [more, setMore] = useState(false);
  const sources = useSettings((s) => s.sources);
  const dontPlay = useSettings((s) => s.dontPlay);
  const hidden = useHidden();
  const playTracks = usePlayer((s) => s.playTracks);

  useEffect(() => {
    let alive = true;
    setSongs([]);
    setMore(false);
    popularSongs(artist).then((s) => alive && setSongs(s));
    return () => {
      alive = false;
    };
  }, [artist, sources, dontPlay]);

  // a kid profile's hidden songs are left out of the count and Play too, not just the rows
  const shown = useMemo(() => songs.filter((t) => !hidden.track(t)), [songs, hidden]);
  if (!shown.length) return null;
  const rows = more ? shown : shown.slice(0, FIRST);

  return (
    <section className="popular">
      <h2>
        Popular
        <button className="btn small primary" onClick={() => playTracks(shown)} title={`Play ${artist}'s popular songs`}><IconPlay /> Play</button>
        <button className="btn small" title="Shuffle them" onClick={() => {
          if (!usePlayer.getState().shuffle) usePlayer.getState().toggleShuffle();
          playTracks(shown, Math.floor(Math.random() * shown.length));
        }}><IconShuffle /> Shuffle</button>
      </h2>
      <TrackList tracks={rows} showCover showAlbum />
      {shown.length > FIRST && (
        <button className="btn small link-more" onClick={() => setMore(!more)}>{more ? 'Show less' : 'Show more'}</button>
      )}
    </section>
  );
}
