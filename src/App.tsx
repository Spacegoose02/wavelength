import { BlendView, MixView } from './views/Mix';
import { startSmartOffline } from './lib/smartOffline';
import { startDeadZone } from './lib/deadZone';
import { startDjVoice } from './lib/djVoice';
import { startDjStation } from './lib/djStation';
import { startSingMode } from './lib/singMode';
import { startDesktop } from './lib/desktop';
import { startHouseActivity } from './lib/houseActivity';
import { HouseActivity } from './components/HouseActivity';
import { startDiscord } from './lib/discord';
import { startHifi } from './lib/hifi';
import { startArtworkChecks } from './lib/artwork';
import { startPlaylistCoverChecks } from './lib/playlistCovers';
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
import { KidLockScreen, KidSettings, KidSignedOutScreen } from './components/KidLock';
import { ProfileButton } from './components/WhosListening';
import { useHub } from './store/hub';
import { useDjAvailable } from './lib/djStatus';
import { skinGroup, useSettings } from './store/settings';
import { useUi, type Route } from './store/ui';
import { usePlayer } from './store/player';
import { PlayerBar } from './components/PlayerBar';
import { NowPlaying, QueuePanel } from './components/NowPlaying';
import { IconAlbum, IconArtist, IconBack, IconBook, IconDownload, IconHistory, IconHome, IconPlaylist, IconPlus, IconPodcast, IconRadio, IconSearch, IconSettings, IconWave, IconCompass, IconSparkle, IconHeart, IconInbox, IconDj } from './components/Icons';
import { Podcasts, PodcastView } from './views/Podcasts';
import { History } from './views/History';
import { HouseholdPlaylistView } from './views/Household';
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
import { TrackMenuHost } from './components/TrackMenu';
import { groupPlaylists } from './lib/playlistFolders';

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
const ArtistReleases = page(() => import('./views/ArtistReleases'), 'ArtistReleases');
const Inbox = page(() => import('./views/Inbox'), 'Inbox');
const Settings = page(() => import('./views/Settings'), 'Settings');
const DJ = page(() => import('./views/DJ'), 'DJ');

type NavGroup = 'main' | 'library' | 'discover' | 'you';
const NAV: { view: Route['view']; label: string; icon: ReactNode; group: NavGroup }[] = [
  { view: 'home', label: 'Home', icon: <IconHome />, group: 'main' },
  { view: 'search', label: 'Search', icon: <IconSearch />, group: 'main' },
  { view: 'dj', label: 'AI DJ', icon: <IconDj />, group: 'main' },
  { view: 'discover', label: 'Discover', icon: <IconCompass />, group: 'main' },
  { view: 'recent', label: 'Recently added', icon: <IconSparkle />, group: 'library' },
  { view: 'albums', label: 'Albums', icon: <IconAlbum />, group: 'library' },
  { view: 'artists', label: 'Artists', icon: <IconArtist />, group: 'library' },
  { view: 'favorites', label: 'Favorites', icon: <IconHeart />, group: 'library' },
  { view: 'offline', label: 'Downloaded', icon: <IconDownload />, group: 'library' },
  { view: 'history', label: 'History', icon: <IconHistory />, group: 'library' },
  { view: 'books', label: 'Audiobooks', icon: <IconBook />, group: 'library' },
  { view: 'podcasts', label: 'Podcasts', icon: <IconPodcast />, group: 'library' },
  { view: 'radio', label: 'Radio', icon: <IconRadio />, group: 'discover' },
  { view: 'subwave', label: 'SUB/WAVE', icon: <IconWave />, group: 'discover' },
  { view: 'downloads', label: 'Downloads', icon: <IconDownload />, group: 'you' },
  { view: 'inbox', label: 'Inbox', icon: <IconInbox />, group: 'you' },
  { view: 'settings', label: 'Settings', icon: <IconSettings />, group: 'you' },
];
/** Sidebar section headings; the main group has none. Each section folds, remembered on this device. */
const GROUP_LABELS: Partial<Record<NavGroup, string>> = { library: 'Your library', discover: 'Explore' };
const FOLDED_KEY = 'tonearm.navFolded';
function useFoldedGroups() {
  const [folded, setFolded] = useState<NavGroup[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  });
  const toggle = (g: NavGroup) => {
    const next = folded.includes(g) ? folded.filter((x) => x !== g) : [...folded, g];
    setFolded(next);
    try {
      localStorage.setItem(FOLDED_KEY, JSON.stringify(next));
    } catch {
      // private mode
    }
  };
  return { folded, toggle };
}

function View({ route }: { route: Route }) {
  switch (route.view) {
    case 'home': return <Home />;
    case 'albums': return <Albums />;
    case 'artists': return <Artists />;
    case 'artist': return <ArtistView key={route.artist.id} artist={route.artist} />;
    case 'artistReleases': return <ArtistReleases key={`${route.artist.id}:${route.open?.id ?? ''}`} artist={route.artist} open={route.open} />;
    case 'album': return <AlbumView key={route.album.id} album={route.album} focus={route.track} />;
    case 'search': return <Search initial={route.q} />;
    case 'radio': return <Radio />;
    case 'books': return <Books />;
    case 'podcasts': return <Podcasts />;
    case 'podcast': return <PodcastView key={route.podcast.id} podcast={route.podcast} />;
    case 'history': return <History />;
    case 'rewind': return <Rewind />;
    case 'playlists': return <Playlists />;
    case 'playlist': return <PlaylistView key={route.id} id={route.id} />;
    case 'household': return <HouseholdPlaylistView key={route.id} id={route.id} />;
    case 'mix': return <MixView key={route.id} id={route.id} />;
    case 'blend': return <BlendView />;
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
    case 'dj': return <DJ />;
    case 'settings': return useHub.getState().user?.role === 'kid' ? <KidSettings /> : <Settings tab={route.tab} />;
  }
}

/** What the player bar or queue shows when it hits an error: the rest of the app keeps working. */
const partCrashed = (what: string) => (retry: () => void, error: Error) => (
  <div className="part-crash" title={`${error.name}: ${error.message}`}>
    <span>{what} hit an error.</span>
    <button className="btn small" onClick={retry}>Try again</button>
  </div>
);

/** Now Playing covers the screen, so its error note keeps a way out. */
const nowPlayingCrashed = (retry: () => void, error: Error) => (
  <div className="np">
    <button className="np-close" onClick={() => window.history.back()} title="Close"><IconBack /></button>
    <div className="crash">
      <h2>Now Playing hit an error</h2>
      <p className="muted">The music keeps playing. Close this, or try again.</p>
      <pre>{`${error.name}: ${error.message}`}</pre>
      <button className="btn primary" onClick={retry}>Try again</button>
    </div>
  </div>
);

function SidebarPlaylists({ route }: { route: Route }) {
  const playlists = useLibrary((s) => s.playlists);
  const folders = useSettings((s) => s.playlistFolders);
  const pinned = useSettings((s) => s.pinnedPlaylists);
  const go = useUi((s) => s.go);
  const [open, setOpen] = useState<string[]>([]);
  const g = groupPlaylists(playlists, folders, pinned, 'made');
  const item = (p: (typeof playlists)[number]) => (
    <button key={p.id} className={`side-item ${route.view === 'playlist' && route.id === p.id ? 'on' : ''}`} onClick={() => go({ view: 'playlist', id: p.id })}>
      {pinned.includes(p.id) && <span className="side-pin" title="Pinned">●</span>}{p.name}
    </button>
  );
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
        {g.pinned.map(item)}
        {g.folders.map((f) => {
          // a folder opens by itself when you're on one of its playlists
          const here = route.view === 'playlist' && f.playlists.some((p) => p.id === route.id);
          const isOpen = open.includes(f.name) || here;
          return (
            <div key={f.name} className="side-folder">
              <button type="button" className="side-item side-folder-head" aria-expanded={isOpen}
                onClick={() => setOpen(open.includes(f.name) ? open.filter((x) => x !== f.name) : [...open, f.name])}>
                <span className="nav-fold">{isOpen ? '▾' : '▸'}</span> {f.name} <small className="muted">{f.playlists.length}</small>
              </button>
              {isOpen && <div className="side-folder-items">{f.playlists.map(item)}</div>}
            </div>
          );
        })}
        {g.loose.map(item)}
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
    // the critters dress for the skin's group (hazmat suits on Nuclear, visors on Lasers, …): styles.css
    document.documentElement.dataset.skinGroup = skinGroup(shown);
  }, [shown]);

  useEffect(() => {
    useCatalog.getState().load();
    startHubSync();
    startUpdateChecks();
    startInboxChecks();
    startFlagChecks();
    startArtworkChecks();
    startPlaylistCoverChecks();
    startKidTime();
    detectWebHub();
    startListeningReports();
    startRemote();
    startTogether();
    startSmartOffline();
    startDeadZone();
    startDjVoice();
    startDjStation();
    startSingMode();
    startDiscord();
    startDesktop();
    startHouseActivity();
    void startHifi();
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
      else if (ui.queueOpen) useUi.setState({ queueOpen: false });
      else ui.back();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const phone = useIsPhone();
  const hubOn = useHub((s) => !!s.token);
  const kid = useIsKid();
  const badge = useInbox(inboxBadge);
  const dj = useDjAvailable();
  const { folded, toggle } = useFoldedGroups();
  const tabRoot = ['home', 'discover', 'search', 'subwave', 'library'].includes(route.view);

  return (
    <div className={`app ${queueOpen ? 'with-queue' : ''} ${phone ? 'phone' : ''} ${kid ? 'kid' : ''}`}>
      {!phone && (
        <nav className="sidebar">
          <div className="brand"><span className="brand-mark" />Wavelength</div>
          <ProfileButton />
          {(['main', 'library', 'discover', 'you'] as NavGroup[]).map((g) => {
            const items = NAV.filter((n) => n.group === g && (n.view !== 'inbox' || hubOn) && (n.view !== 'dj' || dj) && (!kid || KID_VIEWS[n.view]));
            if (!items.length) return null;
            const label = kid ? undefined : GROUP_LABELS[g];
            // a folded section still shows the page you're on
            const shown = label && folded.includes(g) ? items.filter((n) => route.view === n.view) : items;
            return (
              <div key={g} className={`nav-group nav-${g}`}>
                {label && (
                  <button type="button" className="nav-group-head" aria-expanded={!folded.includes(g)} onClick={() => toggle(g)}>
                    {label}<span className="nav-fold">{folded.includes(g) ? '▸' : '▾'}</span>
                  </button>
                )}
                {shown.map((n) => (
                  <button key={n.view} className={`nav ${route.view === n.view ? 'on' : ''}`} onClick={() => go({ view: n.view } as Route)}>
                    {n.icon}<span>{kid ? KID_VIEWS[n.view] : n.label}</span>
                    {n.view === 'inbox' && badge > 0 && <span className="badge">{badge}</span>}
                  </button>
                ))}
              </div>
            );
          })}
          <HouseActivity />
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
      {queueOpen && <ErrorBoundary fallback={partCrashed('The queue')}><QueuePanel /></ErrorBoundary>}
      <ErrorBoundary fallback={partCrashed('The player')}>{phone ? <MobileNav /> : <PlayerBar />}</ErrorBoundary>
      {nowPlayingOpen && <ErrorBoundary fallback={nowPlayingCrashed}><NowPlaying /></ErrorBoundary>}
      <TrackMenuHost />
      <KidLockScreen />
      <KidSignedOutScreen />
      <WebSignIn />
    </div>
  );
}
