import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { isArtistBlocked, isSongBlocked } from '../lib/dontPlay';
import { useFeature } from '../lib/features';
import { shareOfTracks } from '../lib/inbox';
import { sonicOn, soundsLike } from '../lib/sonic';
import { primaryArtist } from '../lib/match';
import { songRadio } from '../lib/songRadio';
import { albumOfTrack, artistOfTrack } from '../lib/trackLinks';
import type { Track } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { useHub } from '../store/hub';
import { useSettings } from '../store/settings';
import { usePlayer } from '../store/player';
import { useUi } from '../store/ui';
import { AddToPlaylist } from './AddToPlaylist';
import { ShareButton } from './ShareButton';
import { useCanEditSong, useSongEditor } from './EditSong';

/**
 * One menu for a song, the same everywhere: right-click a song row (or press the ⋯ "Menu" item on phones) and
 * every action is in one place instead of a row of separate buttons. Opened with `openTrackMenu`, drawn once by
 * `<TrackMenuHost/>` in App.tsx.
 */
interface MenuState {
  open?: { x: number; y: number; track: Track; list?: Track[]; index?: number };
  show(x: number, y: number, track: Track, list?: Track[], index?: number): void;
  close(): void;
}

export const useTrackMenu = create<MenuState>()((set) => ({
  show: (x, y, track, list, index) => set({ open: { x, y, track, list, index } }),
  close: () => set({ open: undefined }),
}));

export const openTrackMenu = (e: { clientX: number; clientY: number; preventDefault(): void }, track: Track, list?: Track[], index?: number) => {
  e.preventDefault();
  useTrackMenu.getState().show(e.clientX, e.clientY, track, list, index);
};

export function TrackMenuHost() {
  const open = useTrackMenu((s) => s.open);
  const close = useTrackMenu((s) => s.close);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);
  if (!open) return null;
  return (
    <div className="track-menu-scrim" onMouseDown={close} onContextMenu={(e) => { e.preventDefault(); close(); }}>
      <TrackMenu key={`${open.track.sourceId}:${open.track.id}:${open.x}:${open.y}`} {...open} onClose={close} />
    </div>
  );
}

function TrackMenu({ x, y, track: t, list, index, onClose }: NonNullable<MenuState['open']> & { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [msg, setMsg] = useState<string>();
  const albums = useCatalog((s) => s.albums);
  const artists = useCatalog((s) => s.artists);
  const go = useUi((s) => s.go);
  const sonicFeature = useFeature('sonic');
  const hasHub = useHub((s) => !!s.token);
  const album = t.album ? albumOfTrack(t, albums) : undefined;
  const artist = artistOfTrack(t, artists, album);
  const song = t.kind === 'track';
  const canEdit = useCanEditSong()(t);
  const dontPlay = useSettings((s) => s.dontPlay);
  const setDontPlay = useSettings((s) => s.setDontPlay);
  const songOff = isSongBlocked(dontPlay, t);
  const artistOff = !!t.artist && isArtistBlocked(dontPlay, t.artist);
  const toggleSong = () =>
    setDontPlay({ ...dontPlay, songs: songOff ? dontPlay.songs.filter((s) => !isSongBlocked({ artists: [], songs: [s] }, t)) : [...dontPlay.songs, { artist: t.artist, title: t.title }] });
  const toggleArtist = () =>
    setDontPlay({ ...dontPlay, artists: artistOff ? dontPlay.artists.filter((a) => !isArtistBlocked({ artists: [a], songs: [] }, t.artist)) : [...dontPlay.artists, primaryArtist(t.artist)] });

  // keyboard: the first item takes focus, arrows move, Esc (TrackMenuHost) closes and focus goes back
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('.menu-item')?.focus();
    return () => back?.focus?.();
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('.menu-item:not(:disabled)') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  // keep it on screen: open up or left when there's no room below or to the right
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8));
    const top = y + r.height > window.innerHeight - 8 ? Math.max(8, y - r.height) : y;
    setPos({ left, top });
  }, [x, y]);

  const p = usePlayer.getState();
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const radio = async (find: () => Promise<Track[]>, empty: string) => {
    setMsg('Finding songs…');
    try {
      const found = (await find()).filter((x) => x.id !== t.id || x.sourceId !== t.sourceId);
      if (!found.length) return setMsg(empty);
      usePlayer.getState().playTracks([t, ...found]);
      onClose();
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    }
  };

  return (
    <div ref={ref} className="menu track-menu" role="menu" aria-label={`Song menu: ${t.title}`} style={pos} onKeyDown={onKeyDown} onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      <div className="menu-hint track-menu-title">{t.title}{t.artist ? ` · ${t.artist}` : ''}</div>
      <button type="button" className="menu-item" onClick={run(() => (list ? p.playTracks(list, index ?? 0) : p.playTracks([t])))}>Play</button>
      <button type="button" className="menu-item" onClick={run(() => p.playNext([t]))}>Play next</button>
      <button type="button" className="menu-item" onClick={run(() => p.enqueue([t]))}>Add to queue</button>
      {t.kind !== 'book' && <AddToPlaylist tracks={[t]} label="Add to playlist…" className="menu-item" />}
      {song && (
        <>
          <div className="menu-sep" />
          <button type="button" className="menu-item" disabled={!!msg} onClick={() => void radio(() => songRadio({ artist: t.artist, title: t.title, track: t }), 'Nothing like it in your library')}>Song radio</button>
          {sonicFeature && hasHub && sonicOn() && (
            <button type="button" className="menu-item" disabled={!!msg} onClick={() => void radio(() => soundsLike(t), 'Nothing that sounds like it yet')}>Sounds like this</button>
          )}
        </>
      )}
      {(artist || album) && <div className="menu-sep" />}
      {artist && <button type="button" className="menu-item" onClick={run(() => go({ view: 'artist', artist }))}>Go to artist</button>}
      {album && <button type="button" className="menu-item" onClick={run(() => go({ view: 'album', album, track: { id: t.id, sourceId: t.sourceId, title: t.title } }))}>Go to album</button>}
      <div className="menu-sep" />
      {canEdit && <button type="button" className="menu-item" onClick={run(() => useSongEditor.getState().open(t))}>Edit song…</button>}
      {song && <ShareButton what={() => shareOfTracks('track', t.title, [t], [t.artist, t.album].filter(Boolean).join(' — '))} className="menu-item" />}
      {song && (
        <>
          <button type="button" className="menu-item" title="Keep it out of radio, mixes, DJ mode and Smart Shuffle. You can still play it yourself." onClick={run(toggleSong)}>
            {songOff ? 'Play this song again' : "Don't play this song"}
          </button>
          {t.artist && (
            <button type="button" className="menu-item" onClick={run(toggleArtist)}>
              {artistOff ? `Play ${primaryArtist(t.artist)} again` : `Don't play ${primaryArtist(t.artist)}`}
            </button>
          )}
        </>
      )}
      <button type="button" className="menu-item" onClick={run(() => void navigator.clipboard?.writeText(`${t.artist} – ${t.title}`).catch(() => undefined))}>Copy song name</button>
      {msg && <div className="menu-hint">{msg}</div>}
    </div>
  );
}
