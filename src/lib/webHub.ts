import { create } from 'zustand';
import { isTauri } from './http';
import { useHub } from '../store/hub';

/**
 * Wavelength opened in a browser from the Hub's own address (docs/HUB.md "In a browser"): sign in to that
 * Hub first, without typing its address.
 */
const SKIP_KEY = 'tonearm.webSkipSignIn';

/** `checked`: detectWebHub has finished (or there was nothing to check), so a missing `origin` means "not a Hub". */
export const useWebHub = create<{ origin?: string; skipped: boolean; checked: boolean }>()(() => ({ skipped: readSkip(), checked: isTauri || typeof location === 'undefined' }));

function readSkip() {
  try {
    return localStorage.getItem(SKIP_KEY) === '1';
  } catch {
    return false;
  }
}

export function skipWebSignIn() {
  try {
    localStorage.setItem(SKIP_KEY, '1');
  } catch {
    /* private window: skip for this visit only */
  }
  useWebHub.setState({ skipped: true });
}

/** Is this page served by a Hub? Then that's the Hub to sign in to. */
export async function detectWebHub() {
  if (isTauri || typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return void useWebHub.setState({ checked: true });
  try {
    const h = await (await fetch('/api/health', { headers: { accept: 'application/json' } })).json();
    if (h?.name !== 'wavelength-hub') return;
    const hub = useHub.getState();
    if (!hub.url || !hub.token) hub.setUrl(location.origin);
    useWebHub.setState({ origin: location.origin });
  } catch {
    /* not a Hub (the dev server, a plain web host) */
  } finally {
    useWebHub.setState({ checked: true });
  }
}

/**
 * The web page signs in from tinyauth by itself (views/HubSettings.tsx SignedOut), unless the person signed out
 * or chose another sign-in in this tab. `?sso=1` (the Hub's /auth/sso/web sends people back with it) always tries.
 */
const NO_AUTO_KEY = 'tonearm.webNoAutoSso';

export function wantsWebSso() {
  try {
    if (new URLSearchParams(location.search).get('sso') === '1') return true;
    return sessionStorage.getItem(NO_AUTO_KEY) !== '1';
  } catch {
    return true;
  }
}

export function stopWebSso() {
  if (isTauri) return;
  try {
    sessionStorage.setItem(NO_AUTO_KEY, '1');
    if (new URLSearchParams(location.search).has('sso')) history.replaceState(null, '', location.pathname + location.hash);
  } catch {
    /* storage blocked: it may sign in again on reload */
  }
}
