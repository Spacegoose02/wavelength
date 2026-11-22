import type { MenuEntry } from '../lib/contextMenu';
import { canDesktop, switchToMiniPlayer } from '../lib/desktop';
import { cycleShuffle } from '../lib/smartShuffle';
import { albumOfTrack, artistOfTrack } from '../lib/trackLinks';
import { useCatalog } from '../store/catalog';
import { type Repeat, usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { openContextMenu } from './ContextMenu';
import { useTrackMenu } from './TrackMenu';

type At = { clientX: number; clientY: number; preventDefault(): void };

const REPEATS: { id: Repeat; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'all', label: 'Repeat all' },
  { id: 'one', label: 'Repeat this song' },
];

/**
 * Right-click (or long-press) the player: the bottom deck (PlayerBar.tsx) or the phone and narrow-window bar
 * (MobileNav.tsx). `queue` adds the Queue row where there's a queue panel to open (the deck).
 */
export function openPlayerMenu(e: At, { queue = false } = {}) {
  const p = usePlayer.getState();
  const ui = useUi.getState();
  const t = p.queue[p.index];
  const smart = useSettings.getState().smartShuffle;
  const live = t?.kind === 'radio';
  const { albums, artists } = useCatalog.getState();
  const album = t && !live && t.album ? albumOfTrack(t, albums) : undefined;
  const artist = t && !live ? artistOfTrack(t, artists, album) : undefined;
  const { clientX: x, clientY: y } = e;

  const items: MenuEntry[] = [
    ...(canDesktop ? [{ label: 'Switch to mini player', hint: 'Hides this window; the mini player brings it back', onSelect: () => void switchToMiniPlayer() }] : []),
    ...(t ? [{ label: 'Open Now Playing', onSelect: () => ui.setNowPlaying(true) }] : []),
    ...(queue ? [{ label: ui.queueOpen ? 'Hide the queue' : 'Show the queue', onSelect: ui.toggleQueue }] : []),
    ...(t
      ? [
          { label: p.playing ? 'Pause' : 'Play', sep: true, onSelect: p.toggle },
          ...(live ? [] : [{ label: 'Next', onSelect: p.next }, { label: 'Previous', onSelect: p.prev }]),
        ]
      : []),
    ...(live
      ? []
      : [
          { label: 'Shuffle', sep: !t, note: p.shuffle ? (smart ? 'Smart' : 'On') : undefined, hint: 'Off → Shuffle → Smart Shuffle', onSelect: cycleShuffle },
          { label: 'Repeat', note: REPEATS.find((r) => r.id === p.repeat)?.label, items: REPEATS.map((r) => ({ label: r.label, checked: p.repeat === r.id, onSelect: () => usePlayer.setState({ repeat: r.id }) })) },
        ]),
    ...(artist ? [{ label: 'Go to artist', sep: true, onSelect: () => ui.go({ view: 'artist', artist }) }] : []),
    ...(album && t ? [{ label: 'Go to album', sep: !artist, onSelect: () => ui.go({ view: 'album', album, track: { id: t.id, sourceId: t.sourceId, title: t.title } }) }] : []),
    // the song's own menu (Add to playlist, Song radio, Share…) opens where the player's was
    ...(t && !live ? [{ label: 'Add to playlist and more…', sep: !artist && !album, onSelect: () => window.setTimeout(() => useTrackMenu.getState().show(x, y, t)) }] : []),
  ];
  const title = t ? `${live ? p.liveTitle ?? t.title : t.title}${t.artist && !live ? ` · ${t.artist}` : ''}` : 'Nothing playing';
  openContextMenu(e, items, title);
}
