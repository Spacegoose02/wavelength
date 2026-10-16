import { useEffect, type ReactNode } from 'react';
import { useCatalog } from './store/catalog';
import { useSettings } from './store/settings';
import { useUi, type Route } from './store/ui';
import { usePlayer } from './store/player';
import { PlayerBar } from './components/PlayerBar';
import { NowPlaying, QueuePanel } from './components/NowPlaying';
import { IconAlbum, IconArtist, IconBack, IconBook, IconDownload, IconHistory, IconHome, IconPlaylist, IconPlus, IconPodcast, IconRadio, IconSearch, IconSettings, IconWave, IconCompass, IconSparkle, IconHeart } from './components/Icons';
import { Podcasts, PodcastView } from './views/Podcasts';
import { History } from './views/History';
import { PlaylistView, Playlists, ServerPlaylistView } from './views/Playlists';
import { SubWave } from './views/SubWave';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Discover } from './views/Discover';
import { Favorites } from './views/Favorites';
import { RecentlyAdded } from './views/RecentlyAdded';
import { LibraryHub, MobileNav } from './components/MobileNav';
import { useIsPhone } from './lib/platform';
import { Offline, OfflineCollectionView } from './views/Offline';
import { useLibrary } from './store/library';
import { AlbumView, Albums, ArtistView, Artists, Home } from './views/Library';
import { Search } from './views/Search';
import { Radio } from './views/Radio';
import { Books } from './views/Books';
import { Downloads } from './views/Downloads';
import { Settings } from './views/Settings';

const NAV: { view: Route['view']; label: string; icon: ReactNode }[] = [
  { view: 'home', label: 'Home', icon: <IconHome /> },
  { view: 'search', label: 'Search', icon: <IconSearch /> },
  { view: 'discover', label: 'Discover', icon: <IconCompass /> },
  { view: 'recent', label: 'Recently added', icon: <IconSparkle /> },
  { view: 'albums', label: 'Albums', icon: <IconAlbum /> },
  { view: 'artists', label: 'Artists', icon: <IconArtist /> },
  { view: 'favorites', label: 'Favorites', icon: <IconHeart /> },
  { view: 'offline', label: 'Downloaded', icon: <IconDownload /> },
  { view: 'subwave', label: 'SUB/WAVE', icon: <IconWave /> },
  { view: 'radio', label: 'Radio', icon: <IconRadio /> },
  { view: 'history', label: 'History', icon: <IconHistory /> },
  { view: 'books', label: 'Audiobooks', icon: <IconBook /> },
  { view: 'podcasts', label: 'Podcasts', icon: <IconPodcast /> },
  { view: 'downloads', label: 'Downloads', icon: <IconDownload /> },
  { view: 'settings', label: 'Settings', icon: <IconSettings /> },
];

function View({ route }: { route: Route }) {
  switch (route.view) {
    case 'home': return <Home />;
    case 'albums': return <Albums />;
    case 'artists': return <Artists />;
    case 'artist': return <ArtistView key={route.artist.id} artist={route.artist} />;
    case 'album': return <AlbumView key={route.album.id} album={route.album} />;
    case 'search': return <Search initial={route.q} />;
    case 'radio': return <Radio />;
    case 'books': return <Books />;
    case 'podcasts': return <Podcasts />;
    case 'podcast': return <PodcastView key={route.podcast.id} podcast={route.podcast} />;
    case 'history': return <History />;
    case 'playlists': return <Playlists />;
    case 'playlist': return <PlaylistView key={route.id} id={route.id} />;
    case 'serverPlaylist': return <ServerPlaylistView key={`${route.playlist.sourceId}:${route.playlist.id}`} playlist={route.playlist} />;
    case 'subwave': return <SubWave key={route.sourceId ?? ''} sourceId={route.sourceId} />;
    case 'discover': return <Discover />;
    case 'favorites': return <Favorites />;
    case 'recent': return <RecentlyAdded />;
    case 'library': return <LibraryHub />;
    case 'offline': return <Offline />;
    case 'offlineCollection': return <OfflineCollectionView key={route.id} id={route.id} />;
    case 'downloads': return <Downloads />;
    case 'settings': return <Settings />;
  }
}

function SidebarPlaylists({ route }: { route: Route }) {
  const playlists = useLibrary((s) => s.playlists);
  const go = useUi((s) => s.go);
  return (
    <div className="side-playlists">
      <div className="side-head">
        <button onClick={() => go({ view: 'playlists' })} className={route.view === 'playlists' ? 'on' : ''}><IconPlaylist /> Playlists</button>
        <button className="icon-btn" title="New playlist" onClick={() => {
          const id = useLibrary.getState().createPlaylist('New playlist');
          go({ view: 'playlist', id });
        }}><IconPlus /></button>
      </div>
      <div className="side-list">
        {playlists.map((p) => (
          <button key={p.id} className={`side-item ${route.view === 'playlist' && route.id === p.id ? 'on' : ''}`} onClick={() => go({ view: 'playlist', id: p.id })}>
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const skin = useSettings((s) => s.skin);
  const { route, history, go, nowPlayingOpen, queueOpen } = useUi();

  useEffect(() => {
    document.documentElement.dataset.skin = skin;
  }, [skin]);

  useEffect(() => {
    useCatalog.getState().load();
  }, []);

  // keyboard: space = play/pause, ctrl+f = search, alt+left = back
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea, select');
      if (e.code === 'Space' && !typing) {
        e.preventDefault();
        usePlayer.getState().toggle();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        go({ view: 'search' });
      } else if (e.altKey && e.key === 'ArrowLeft') window.history.back();
      else if (e.key === 'Escape' && useUi.getState().nowPlayingOpen) window.history.back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Android back button / browser back → close Now Playing, else go back a page
  useEffect(() => {
    const onPop = () => {
      const ui = useUi.getState();
      if (ui.nowPlayingOpen) ui.setNowPlaying(false);
      else if (ui.queueOpen) ui.toggleQueue();
      else ui.back();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const phone = useIsPhone();
  const tabRoot = ['home', 'discover', 'search', 'subwave', 'library'].includes(route.view);

  return (
    <div className={`app ${queueOpen ? 'with-queue' : ''} ${phone ? 'phone' : ''}`}>
      {!phone && (
        <nav className="sidebar">
          <div className="brand"><span className="brand-mark" />Wavelength</div>
          {NAV.map((n) => (
            <button key={n.view} className={`nav ${route.view === n.view ? 'on' : ''}`} onClick={() => go({ view: n.view } as Route)}>
              {n.icon}<span>{n.label}</span>
            </button>
          ))}
          <SidebarPlaylists route={route} />
        </nav>
      )}
      <main className="main">
        {history.length > 0 && (!phone || !tabRoot) && <button className="back" onClick={() => window.history.back()} title="Back (Alt+←)"><IconBack /></button>}
        <ErrorBoundary key={JSON.stringify(route).slice(0, 200)} onReset={() => go({ view: 'home' })}>
          <View route={route} />
        </ErrorBoundary>
      </main>
      {queueOpen && <QueuePanel />}
      {phone ? <MobileNav /> : <PlayerBar />}
      {nowPlayingOpen && <NowPlaying />}
    </div>
  );
}
