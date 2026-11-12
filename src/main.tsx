import React from 'react';
import ReactDOM from 'react-dom/client';
import { loadBigStore } from './lib/bigStore';
import { loadSecrets } from './lib/secrets';
import './styles.css';

// the mini player window (src-tauri/src/desktop.rs) only draws the mini player: the main window plays
const isMini = '__TAURI_INTERNALS__' in window && (window as unknown as { __TAURI_INTERNALS__: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__.metadata?.currentWindow?.label === 'mini';

if (isMini) {
  void loadBigStore().then(() => import('./components/MiniPlayer')).then(({ MiniPlayer }) => ReactDOM.createRoot(document.getElementById('root')!).render(<MiniPlayer />));
} else {
  // Logins come out of the OS keychain (lib/secrets.ts), and playlists out of IndexedDB (lib/bigStore.ts), before
  // the saved stores load, so everything that reads them is imported after.
  Promise.all([loadSecrets(), loadBigStore()]).finally(async () => {
    const [{ default: App }, { enableTvNavigation }, { enableNativeMedia }, { ErrorBoundary }, { enableSharedLyrics }, { enableSmartShuffle }, { startMotion }] = await Promise.all([
      import('./App'),
      import('./lib/tvNav'),
      import('./lib/nativeMedia'),
      import('./components/ErrorBoundary'),
      import('./lib/sharedLyrics'),
      import('./lib/smartShuffle'),
      import('./lib/motion'),
    ]);
    enableTvNavigation();
    enableNativeMedia();
    enableSharedLyrics();
    enableSmartShuffle();
    startMotion();
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        {/* last resort: an error outside a page's own boundary shows what broke instead of a blank window */}
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>,
    );
  });
}
