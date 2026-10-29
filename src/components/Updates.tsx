import { useEffect, useState } from 'react';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { RELEASES_URL, useUpdates } from '../lib/updates';

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(0)} MB`;

function InstallButton({ small }: { small?: boolean }) {
  const { phase, progress, available, target, install } = useUpdates();
  // re-read the "Install unknown apps" permission when the user comes back from Android's settings
  const [, refresh] = useState(0);
  useEffect(() => {
    const on = () => refresh((n) => n + 1);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  if (!available) return null;
  const busy = phase === 'downloading' || phase === 'installing';
  const needsPermission = target === 'android' && window.WavelengthUpdater && !window.WavelengthUpdater.canInstall();
  const label = phase === 'downloading' ? `Downloading… ${Math.round((progress ?? 0) * 100)}%`
    : phase === 'installing' ? (target === 'android' ? 'Opening installer…' : 'Installing…')
    : needsPermission ? 'Allow installs from Wavelength' : 'Install update';
  return <button className={`btn primary ${small ? 'small' : ''}`} disabled={busy} onClick={() => install()}>{label}</button>;
}

/** Thin bar at the top of the page when a newer release is out. */
export function UpdateBanner() {
  const { available, bannerClosed, closeBanner, phase, error } = useUpdates();
  const go = useUi((s) => s.go);
  if (!available || bannerClosed === available.version) return null;
  return (
    <div className="update-banner" role="status">
      <span><b>Wavelength {available.version}</b> is available{available.prerelease ? ' (pre-release)' : ''}.</span>
      {phase === 'error' && error && <span className="small">{error}</span>}
      <span className="row gap">
        <InstallButton small />
        <button className="btn small ghost" onClick={() => go({ view: 'settings', tab: 'updates' })}>What's new</button>
        <button className="btn small ghost" title="Hide until next launch" onClick={closeBanner}>✕</button>
      </span>
    </div>
  );
}

/** Settings → Updates. */
export function UpdatesTab() {
  const { target, current, phase, available, lastChecked, error, check } = useUpdates();
  const updates = useSettings((s) => s.updates);
  const setUpdates = useSettings((s) => s.setUpdates);

  if (target === 'none') {
    return (
      <section>
        <h2>Updates</h2>
        <p className="muted small">Updates are checked in the Windows and Android apps. Get the latest from {RELEASES_URL}.</p>
      </section>
    );
  }

  return (
    <>
      <section>
        <h2>Updates</h2>
        <p className="muted small">
          This is Wavelength {current}{target === 'portable' ? ' (portable Wavelength.exe)' : ''}.
          {' '}{phase === 'checking' ? 'Checking…' : lastChecked ? `Last checked ${new Date(lastChecked).toLocaleString()}.` : ''}
        </p>
        {phase === 'error' && error && <div className="errors">{error}</div>}
        {available ? (
          <div className="editor">
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <span>
                <b>Wavelength {available.version}</b>{available.prerelease ? <span className="chip" style={{ marginLeft: 8 }}>pre-release</span> : null}
                <br /><small className="muted">{new Date(available.published).toLocaleDateString()} · {available.asset.name} · {mb(available.asset.size)}</small>
              </span>
              <InstallButton />
            </div>
            {available.notes && <pre className="update-notes">{available.notes.trim()}</pre>}
            <p className="muted small">
              {target === 'android'
                ? 'Android shows its install prompt; tap Install (or Update). Your settings and downloads are kept.'
                : target === 'portable'
                  ? 'Wavelength.exe is replaced in place and restarted.'
                  : 'The installer runs with a progress bar, closes Wavelength and opens it again when it’s done.'}
            </p>
          </div>
        ) : lastChecked && phase !== 'error' ? <p className="ok">You're on the latest version.</p> : null}
        <div className="row gap">
          <button className="btn" disabled={phase === 'checking' || phase === 'downloading' || phase === 'installing'} onClick={() => check()}>Check now</button>
        </div>
      </section>
      <section>
        <h2>Options</h2>
        <label className="check">
          <input type="checkbox" checked={updates.auto} onChange={(e) => setUpdates({ auto: e.target.checked })} />
          Check for updates automatically (on launch and every 6 hours)
        </label>
        <label className="check">
          <input type="checkbox" checked={updates.prerelease} onChange={(e) => setUpdates({ prerelease: e.target.checked })} />
          Include pre-releases (test builds; may have bugs)
        </label>
        <p className="muted small">Updates come from {RELEASES_URL}. Nothing is installed without you pressing Install.</p>
      </section>
    </>
  );
}
