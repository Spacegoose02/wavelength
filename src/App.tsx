import { startArtworkChecks } from './lib/artwork';
import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { useCatalog } from './store/catalog';
import { startHubSync } from './lib/hubSync';
import { inboxBadge, startInboxChecks, useInbox } from './lib/inbox';
import { KID_VIEWS, startFlagChecks, useIsKid } from './lib/kids';
import { detectWebHub } from './lib/webHub';
import { startListeningReports } from './lib/listening';
import { startRemote } from './lib/remote';
import { startTogether } from './lib/together';
import { WebSignIn } from './components/WebSignIn';
import { startKidTime } from './lib/kidTime';
import { KidLockScreen, KidSettings } from './components/KidLock';
import { useHub } from './store/hub';
import { skinGroup, useSettings } from './store/settings';
import { useUi, type Route } from './store/ui';
import { usePlayer } from './store/player';
import { PlayerBar } from './components/PlayerBar';
import { NowPlaying, QueuePanel } from './components/NowPlaying';
import { IconAlbum, IconArtist, IconBack, IconBook, IconDownload, IconHistory, IconHome, IconPlaylist, IconPlus, IconPodcast, IconRadio, IconSearch, IconSettings, IconWave, IconCompass, IconSparkle, IconHeart, IconInbox } from './components/Icons';
import { Podcasts, PodcastView } from './views/Podcasts';
import { History } from './views/History';
import { PlaylistView, Playlists, ServerPlaylistView } from './views/Playlists';
import { ErrorBoundary } from './components/ErrorBoundary';
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
import { activeSkin } from './lib/seasons';
import { startUpdateChecks } from './lib/updates';
import { UpdateBanner } from './components/Updates';
import { Spinner } from './components/common';

/** A page loaded the first time it's opened, so startup only parses what Home needs (slow TV boxes notice). */
// `any`: each page has its own props, which lazy() keeps from M[K]
function page<M extends Record<K, ComponentType<any>>, K extends keyof M & string>(load: () => Promise<M>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}
const Rewind = page(() => import('./views/Rewind'), 'Rewind');
const SubWave = page(() => import('./views/SubWave'), 'SubWave');
const LibraryCare = page(() => import('./views/LibraryCare'), 'LibraryCare');
const Discover = page(() => import('./views/Discover'), 'Discover');
const ImportPlaylist = page(() => import('./views/ImportPlaylist'), 'ImportPlaylist');
const TagEditor = page(() => import('./views/TagEditor'), 'TagEditor');
const ArtistTagEditor = page(() => import('./views/ArtistTagEditor'), 'ArtistTagEditor');
const Downloads = page(() => import('./views/Downloads'), 'Downloads');
const Inbox = page(() => import('./views/Inbox'), 'Inbox');
const Settings = page(() => import('./views/Settings'), 'Settings');

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
  { view: 'inbox', label: 'Inbox', icon: <IconInbox /> },
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
    case 'rewind': return <Rewind />;
    case 'playlists': return <Playlists />;
    case 'playlist': return <PlaylistView key={route.id} id={route.id} />;
    case 'serverPlaylist': return <ServerPlaylistView key={`${route.playlist.sourceId}:${route.playlist.id}`} playlist={route.playlist} />;
    case 'subwave': return <SubWave key={route.sourceId ?? ''} sourceId={route.sourceId} />;
    case 'discover': return <Discover key={route.genre ?? ''} initialGenre={route.genre} />;
    case 'import': return <ImportPlaylist />;
    case 'tags': return <TagEditor key={route.album.id} album={route.album} />;
    case 'artistTags': return <ArtistTagEditor key={route.artist.name} artist={route.artist} />;
    case 'favorites': return <Favorites />;
    case 'recent': return <RecentlyAdded />;
    case 'library': return <LibraryHub />;
    case 'libraryCare': return <LibraryCare />;
    case 'offline': return <Offline />;
    case 'offlineCollection': return <OfflineCollectionView key={route.id} id={route.id} />;
    case 'downloads': return <Downloads key={route.soulseek ? `sl:${route.soulseek.requestId}:${route.soulseek.q}` : ''} soulseek={route.soulseek} />;
    case 'inbox': return <Inbox key={route.tab ?? ''} tab={route.tab} />;
    case 'settings': return useHub.getState().user?.role === 'kid' ? <KidSettings /> : <Settings tab={route.tab} />;
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
  const seasonal = useSettings((s) => s.seasonal);
  const randomDaily = useSettings((s) => s.randomDaily);
  const { route, history, go, nowPlayingOpen, queueOpen } = useUi();
  // re-render now and then so Seasonal / Random daily roll over at midnight on an app left open
  const [, tick] = useState(0);
  useEffect(() => {
    if (!seasonal && !randomDaily) return;
    const id = window.setInterval(() => tick((n) => n + 1), 10 * 60_000);
    return () => window.clearInterval(id);
  }, [seasonal, randomDaily]);
  const previewSkin = useUi((s) => s.previewSkin);
  const shown = previewSkin ?? activeSkin({ skin, seasonal, randomDaily });

  useEffect(() => {
    document.documentElement.dataset.skin = shown;
    // the raccoons dress for the skin's group (hazmat suits on Nuclear, visors on Lasers, …): styles.css
    document.documentElement.dataset.skinGroup = skinGroup(shown);
  }, [shown]);

  useEffect(() => {
    useCatalog.getState().load();
    startHubSync();
    startUpdateChecks();
    startInboxChecks();
    startFlagChecks();
    startArtworkChecks();
    startKidTime();
    detectWebHub();
    startListeningReports();
    startRemote();
    startTogether();
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
  const hubOn = useHub((s) => !!s.token);
  const kid = useIsKid();
  const badge = useInbox(inboxBadge);
  const tabRoot = ['home', 'discover', 'search', 'subwave', 'library'].includes(route.view);

  return (
    <div className={`app ${queueOpen ? 'with-queue' : ''} ${phone ? 'phone' : ''} ${kid ? 'kid' : ''}`}>
      {!phone && (
        <nav className="sidebar">
          <div className="brand"><span className="brand-mark" />Wavelength</div>
          {NAV.filter((n) => (n.view !== 'inbox' || hubOn) && (!kid || KID_VIEWS[n.view])).map((n) => (
            <button key={n.view} className={`nav ${route.view === n.view ? 'on' : ''}`} onClick={() => go({ view: n.view } as Route)}>
              {n.icon}<span>{kid ? KID_VIEWS[n.view] : n.label}</span>
              {n.view === 'inbox' && badge > 0 && <span className="badge">{badge}</span>}
            </button>
          ))}
          <SidebarPlaylists route={route} />
        </nav>
      )}
      <main className="main">
        <UpdateBanner />
        {history.length > 0 && (!phone || !tabRoot) && <button className="back" onClick={() => window.history.back()} title="Back (Alt+←)"><IconBack /></button>}
        <ErrorBoundary key={JSON.stringify(route).slice(0, 200)} onReset={() => go({ view: 'home' })}>
          <Suspense fallback={<Spinner />}>
            <View route={route} />
          </Suspense>
        </ErrorBoundary>
      </main>
      {queueOpen && <QueuePanel />}
      {phone ? <MobileNav /> : <PlayerBar />}
      {nowPlayingOpen && <NowPlaying />}
      <KidLockScreen />
      <WebSignIn />
    </div>
  );
}
