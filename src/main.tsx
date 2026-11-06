import React from 'react';
import ReactDOM from 'react-dom/client';
import { loadSecrets } from './lib/secrets';
import './styles.css';

// Logins come out of the OS keychain before the saved settings load (lib/secrets.ts), so everything that
// reads them is imported after.
loadSecrets().finally(async () => {
  const [{ default: App }, { enableTvNavigation }, { enableNativeMedia }, { ErrorBoundary }, { enableSharedLyrics }, { enableSmartShuffle }] = await Promise.all([
    import('./App'),
    import('./lib/tvNav'),
    import('./lib/nativeMedia'),
    import('./components/ErrorBoundary'),
    import('./lib/sharedLyrics'),
    import('./lib/smartShuffle'),
  ]);
  enableTvNavigation();
  enableNativeMedia();
  enableSharedLyrics();
  enableSmartShuffle();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {/* last resort: an error outside a page's own boundary shows what broke instead of a blank window */}
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
});
