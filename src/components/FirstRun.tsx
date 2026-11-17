import { useEffect, useState } from 'react';
import { useWebHub } from '../lib/webHub';
import { useHub } from '../store/hub';
import { useSettings } from '../store/settings';
import { SignedOut } from '../views/HubSettings';

/**
 * The welcome screen on a fresh install (docs/USER-GUIDE.md "Getting started"): one box for the server's address, so
 * someone with a Wavelength Hub types it, signs in and gets their music, podcasts and settings without visiting
 * Settings. "Skip" is for people without a Hub, who add their servers under Settings → Sources as before.
 *
 * Shown only until it's done once: signing in, skipping, or already having a server or a Hub on this device (so
 * nobody upgrading sees it). The Hub's own web page has its own sign-in screen (WebSignIn), so this one stays away there.
 */
const DONE_KEY = 'tonearm.firstRunDone';

function readDone() {
  try {
    return localStorage.getItem(DONE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markFirstRunDone() {
  try {
    localStorage.setItem(DONE_KEY, '1');
  } catch {
    /* private window: shown again next time, harmless */
  }
}

/** Both stores have read what this device saved (the keychain can answer a moment late). */
const ready = () => (useSettings.persist?.hasHydrated?.() ?? true) && (useHub.persist?.hasHydrated?.() ?? true);

function useHydrated() {
  const [ok, setOk] = useState(ready);
  useEffect(() => {
    if (ok) return;
    const check = () => ready() && setOk(true);
    const a = useSettings.persist?.onFinishHydration?.(check);
    const b = useHub.persist?.onFinishHydration?.(check);
    check();
    return () => {
      a?.();
      b?.();
    };
  }, [ok]);
  return ok;
}

export function FirstRun() {
  const hydrated = useHydrated();
  const [done, setDone] = useState(readDone);
  const hasSources = useSettings((s) => s.sources.length > 0);
  const hub = useHub((s) => !!s.token || !!s.family);
  const onHubPage = useWebHub((s) => !!s.origin);
  const checked = useWebHub((s) => s.checked);
  const settled = done || hasSources || hub;

  // anyone who already has a server or a Hub is past this for good
  useEffect(() => {
    if (hydrated && settled && !done) {
      markFirstRunDone();
      setDone(true);
    }
  }, [hydrated, settled, done]);

  if (!hydrated || !checked || settled || onHubPage) return null;
  const skip = () => {
    markFirstRunDone();
    setDone(true);
  };
  return (
    <div className="web-signin first-run">
      <div className="web-signin-card">
        <div className="brand"><span className="brand-mark" />Wavelength</div>
        <SignedOut firstRun />
        <button className="btn ghost" onClick={skip}>Skip, I’m not using a Hub</button>
        <p className="muted small first-run-note">You can connect later in Settings → Account, or add Navidrome, Plex and other servers yourself under Settings → Sources.</p>
      </div>
    </div>
  );
}
