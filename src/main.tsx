import React from 'react';
import ReactDOM from 'react-dom/client';
import { loadSecrets } from './lib/secrets';
import './styles.css';

// Logins come out of the OS keychain before the saved settings load (lib/secrets.ts), so everything that
// reads them is imported after.
loadSecrets().finally(async () => {
  const [{ default: App }, { enableTvNavigation }, { enableNativeMedia }] = await Promise.all([
    import('./App'),
    import('./lib/tvNav'),
    import('./lib/nativeMedia'),
  ]);
  enableTvNavigation();
  enableNativeMedia();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
