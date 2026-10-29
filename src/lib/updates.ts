/**
 * In-app updates from GitHub Releases (Windows and Android).
 *
 * The app asks GitHub for the latest release on launch and every few hours, and if it's newer than
 * this build shows a banner and a card in Settings → Updates. Installing downloads the right file
 * (setup exe, portable Wavelength.exe or the APK, see `update_target` in src-tauri/src/update.rs)
 * and then runs the installer (Windows) or hands the APK to Android's installer (UpdateBridge.kt).
 * Pre-releases are skipped unless Settings → Updates → "Include pre-releases" is on.
 */
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from './http';
import { useSettings } from '../store/settings';

export const RELEASES_URL = 'https://github.com/Spacegoose02/wavelength/releases';

/** How this copy was installed (update.rs → `update_target`). `none`: dev build or a browser. */
export type UpdateTarget = 'installer' | 'portable' | 'android' | 'none';

interface Updater {
  canInstall(): boolean;
  allowInstalls(): void;
  install(path: string): string;
}

declare global {
  interface Window {
    WavelengthUpdater?: Updater;
  }
}

interface GhAsset { name: string; browser_download_url: string; size: number }
interface GhRelease { tag_name: string; name: string | null; body: string | null; html_url: string; draft: boolean; prerelease: boolean; published_at: string; assets: GhAsset[] }

export interface Release {
  version: string;
  prerelease: boolean;
  notes: string;
  pageUrl: string;
  published: string;
  asset: { name: string; url: string; size: number };
}

/** `v0.10.2` → [0, 10, 2]; anything that isn't plain X.Y.Z → undefined. */
export function parseVersion(v: string): number[] | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? m.slice(1).map(Number) : undefined;
}

/** > 0 when `a` is newer than `b`. */
export function compareVersions(a: string, b: string) {
  const x = parseVersion(a) ?? [0, 0, 0];
  const y = parseVersion(b) ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** The file this kind of install updates from. */
export function assetFor(release: Pick<GhRelease, 'assets'>, target: UpdateTarget): GhAsset | undefined {
  const match = {
    installer: (n: string) => /_x64-setup\.exe$/i.test(n),
    portable: (n: string) => n.toLowerCase() === 'wavelength.exe',
    android: (n: string) => /-android\.apk$/i.test(n),
    none: () => false,
  }[target];
  return release.assets.find((a) => match(a.name));
}

/**
 * The newest release that's newer than `current` and has a file for `target`. A release published
 * a few minutes ago has no files yet (Actions takes 15–25 minutes), so it's skipped until it does.
 */
export function pickUpdate(releases: GhRelease[], current: string, target: UpdateTarget, includePre: boolean): Release | undefined {
  const best = releases
    .filter((r) => !r.draft && (includePre || !r.prerelease) && parseVersion(r.tag_name) && compareVersions(r.tag_name, current) > 0)
    .filter((r) => assetFor(r, target))
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0];
  if (!best) return undefined;
  const a = assetFor(best, target)!;
  return {
    version: best.tag_name.replace(/^v/, ''),
    prerelease: best.prerelease,
    notes: best.body ?? '',
    pageUrl: best.html_url,
    published: best.published_at,
    asset: { name: a.name, url: a.browser_download_url, size: a.size },
  };
}

type Phase = 'idle' | 'checking' | 'downloading' | 'installing' | 'error';

interface UpdateState {
  target: UpdateTarget;
  current: string;
  phase: Phase;
  available?: Release;
  lastChecked?: number;
  error?: string;
  /** Download progress 0–1, while downloading. */
  progress?: number;
  /** Version whose banner was closed this session (Settings still shows it). */
  bannerClosed?: string;
  check(): Promise<void>;
  install(): Promise<void>;
  closeBanner(): void;
}

export const useUpdates = create<UpdateState>()((set, get) => ({
  target: 'none',
  current: '',
  phase: 'idle',
  check: async () => {
    const { target, current, phase } = get();
    if (target === 'none' || phase === 'downloading' || phase === 'installing') return;
    set({ phase: 'checking', error: undefined });
    try {
      const releases = await invoke<GhRelease[]>('update_releases');
      const available = pickUpdate(releases, current, target, useSettings.getState().updates.prerelease);
      set({ phase: 'idle', available, lastChecked: Date.now() });
    } catch (e) {
      set({ phase: 'error', error: String((e as Error)?.message ?? e), lastChecked: Date.now() });
    }
  },
  install: async () => {
    const { available, target } = get();
    if (!available) return;
    const android = window.WavelengthUpdater;
    if (target === 'android' && !android) return set({ phase: 'error', error: 'This build of the app can’t install updates; download the APK from GitHub.' });
    // ask for "Install unknown apps" before downloading: Android may restart the app when it's switched on
    if (android && !android.canInstall()) return android.allowInstalls();
    set({ phase: 'downloading', progress: 0, error: undefined });
    const stop = await listen<{ received: number; total?: number }>('update-progress', (e) => {
      const total = e.payload.total ?? available.asset.size;
      if (total) set({ progress: Math.min(1, e.payload.received / total) });
    });
    try {
      const path = await invoke<string>('update_download', { url: available.asset.url, name: available.asset.name });
      set({ phase: 'installing', progress: 1 });
      if (android) {
        const err = android.install(path);
        if (err) throw new Error(err);
        // the system installer takes over; if the user cancels they can tap Install again
        set({ phase: 'idle' });
      } else {
        await invoke('update_install', { path }); // quits Wavelength
      }
    } catch (e) {
      set({ phase: 'error', error: String((e as Error)?.message ?? e) });
    } finally {
      stop();
    }
  },
  closeBanner: () => set({ bannerClosed: get().available?.version }),
}));

const HOURS = 6;

/** Start checking on launch and every few hours (if Settings → Updates → Check automatically is on). */
export async function startUpdateChecks() {
  if (!isTauri) return;
  try {
    const [target, current] = await Promise.all([invoke<UpdateTarget>('update_target'), getVersion()]);
    useUpdates.setState({ target, current });
  } catch {
    return; // an older Rust side without the update commands
  }
  const auto = () => {
    if (useSettings.getState().updates.auto) useUpdates.getState().check();
  };
  window.setTimeout(auto, 8_000); // let the library load first
  window.setInterval(auto, HOURS * 3_600_000);
  // turning pre-releases on or off changes which release counts as newest
  useSettings.subscribe((s, prev) => {
    if (s.updates.prerelease !== prev.updates.prerelease && useUpdates.getState().lastChecked) useUpdates.getState().check();
  });
}
