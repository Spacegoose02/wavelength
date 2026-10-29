import { create } from 'zustand';
import { isTauri } from './http';
import { useHub } from '../store/hub';

/**
 * Wavelength opened in a browser from the Hub's own address (docs/HUB.md "In a browser"): sign in to that
 * Hub first, without typing its address.
 */
const SKIP_KEY = 'tonearm.webSkipSignIn';

export const useWebHub = create<{ origin?: string; skipped: boolean }>()(() => ({ skipped: readSkip() }));

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
  if (isTauri || typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return;
  try {
    const h = await (await fetch('/api/health', { headers: { accept: 'application/json' } })).json();
    if (h?.name !== 'wavelength-hub') return;
    const hub = useHub.getState();
    if (!hub.url || !hub.token) hub.setUrl(location.origin);
    useWebHub.setState({ origin: location.origin });
  } catch {
    /* not a Hub (the dev server, a plain web host) */
  }
}
