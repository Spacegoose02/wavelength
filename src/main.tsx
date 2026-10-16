import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { enableTvNavigation } from './lib/tvNav';
import { enableNativeMedia } from './lib/nativeMedia';

enableTvNavigation();
enableNativeMedia();
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
