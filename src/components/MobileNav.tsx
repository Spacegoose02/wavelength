import { trackArt, useArtworkList } from '../lib/artwork';
import type { ReactNode } from 'react';
import { usePlayer } from '../store/player';
import { useUi, type Route } from '../store/ui';
import { useLibrary } from '../store/library';
import { isAndroid } from '../lib/platform';
import { Cover } from './common';
import {
  IconAlbum, IconArtist, IconBook, IconCompass, IconDownload, IconHeart, IconHistory, IconHome, IconLibrary,
  IconNext, IconPause, IconPlay, IconPlaylist, IconPodcast, IconRadio, IconSearch, IconSettings, IconSparkle, IconWave, IconInbox, IconDj,
} from './Icons';
import { useDjAvailable } from '../lib/djStatus';
import { inboxBadge, useInbox } from '../lib/inbox';
import { KID_VIEWS, useIsKid } from '../lib/kids';
import { useHub } from '../store/hub';

const TABS: { view: Route['view']; label: string; icon: ReactNode; also?: Route['view'][] }[] = [
  { view: 'home', label: 'Home', icon: <IconHome /> },
  { view: 'discover', label: 'Discover', icon: <IconCompass /> },
  { view: 'search', label: 'Search', icon: <IconSearch /> },
  { view: 'subwave', label: 'SUB/WAVE', icon: <IconWave /> },
  { view: 'library', label: 'Library', icon: <IconLibrary />, also: ['albums', 'artists', 'album', 'artist', 'favorites', 'recent', 'playlists', 'playlist', 'serverPlaylist', 'history', 'books', 'podcasts', 'podcast', 'radio', 'downloads', 'inbox', 'settings', 'offline', 'offlineCollection', 'dj'] },
];

/** Phone layout: mini player + bottom tab bar (replaces the sidebar and desktop deck). */
export function MobileNav() {
  const { route, go, setNowPlaying } = useUi();
  const p = usePlayer();
  const t = p.current();
  useArtworkList();
  const art = p.liveCover ?? trackArt(t);
  const badge = useInbox(inboxBadge);
  const live = t?.kind === 'radio';
  return (
    <div className="mobile-dock">
      {t && (
        <div className="mini-player" onClick={() => setNowPlaying(true)}>
          <div className="mini-progress"><i style={{ width: live ? '100%' : `${(p.position / (p.duration || 1)) * 100}%` }} /></div>
          <Cover key={art} src={art} alt={t.title} className="tiny" />
          <div className="track-main">
            <div className="track-title">{live ? p.liveTitle ?? t.title : t.title}</div>
            {p.error
              ? <div className="track-sub err" title={p.error}>{p.error}</div>
              : <div className="track-sub">{live ? (p.liveTitle ? t.title : 'Live radio') : t.artist}</div>}
          </div>
          <button className="tbtn" onClick={(e) => { e.stopPropagation(); p.toggle(); }}>{p.playing ? <IconPause /> : <IconPlay />}</button>
          {!live && <button className="tbtn" onClick={(e) => { e.stopPropagation(); p.next(); }}><IconNext /></button>}
        </div>
      )}
      <nav className="tabbar">
        {TABS.map((tab) => {
          const on = route.view === tab.view || tab.also?.includes(route.view);
          return (
            <button key={tab.view} className={on ? 'on' : ''} onClick={() => go({ view: tab.view } as Route)}>
              {tab.icon}
              <span>{tab.label}</span>
              {tab.view === 'library' && badge > 0 && <i className="tab-dot" title={`${badge} new in your Inbox`} />}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/** The "Library" tab: everything that lives in the desktop sidebar. */
export function LibraryHub() {
  const go = useUi((s) => s.go);
  const playlists = useLibrary((s) => s.playlists);
  const hubOn = useHub((s) => !!s.token);
  const badge = useInbox(inboxBadge);
  const kid = useIsKid();
  const dj = useDjAvailable();
  const items: { view: Route['view']; label: string; icon: ReactNode }[] = [
    { view: 'recent', label: 'Recently added', icon: <IconSparkle /> },
    { view: 'albums', label: 'Albums', icon: <IconAlbum /> },
    { view: 'artists', label: 'Artists', icon: <IconArtist /> },
    { view: 'offline', label: 'Downloaded', icon: <IconDownload /> },
    { view: 'favorites', label: 'Favorites', icon: <IconHeart /> },
    { view: 'playlists', label: 'Playlists', icon: <IconPlaylist /> },
    { view: 'libraryCare', label: 'Library care', icon: <IconAlbum /> },
    { view: 'history', label: 'History', icon: <IconHistory /> },
    { view: 'radio', label: 'Radio', icon: <IconRadio /> },
    { view: 'books', label: 'Audiobooks', icon: <IconBook /> },
    { view: 'podcasts', label: 'Podcasts', icon: <IconPodcast /> },
    { view: 'downloads', label: isAndroid ? 'Downloads (deemix)' : 'Downloads', icon: <IconDownload /> },
    ...(dj ? [{ view: 'dj' as const, label: 'AI DJ', icon: <IconDj /> }] : []),
    ...(hubOn ? [{ view: 'inbox' as const, label: badge ? `Inbox (${badge})` : 'Inbox', icon: <IconInbox /> }] : []),
    { view: 'settings', label: 'Settings', icon: <IconSettings /> },
  ];
  return (
    <div className="page">
      <header className="page-head"><h1>Library</h1></header>
      <div className="hub">
        {items.filter((i) => !kid || KID_VIEWS[i.view]).map((i) => (
          <button key={i.view} className="hub-item" onClick={() => go({ view: i.view } as Route)}>
            {i.icon}<span>{kid && i.view !== 'inbox' ? KID_VIEWS[i.view] : i.label}</span>
          </button>
        ))}
      </div>
      {playlists.length > 0 && (
        <section>
          <h2>Your playlists</h2>
          {playlists.map((p) => (
            <button key={p.id} className="hub-row" onClick={() => go({ view: 'playlist', id: p.id })}>
              <IconPlaylist /> {p.name} <small className="muted">{p.tracks.length}</small>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
