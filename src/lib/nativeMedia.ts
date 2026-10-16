/**
 * Bridge to the native Android media session (MediaBridge.kt). Android only sends steering-wheel,
 * Bluetooth, headset and lock-screen media buttons to an app with a real MediaSession, and the
 * WebView doesn't create one — so we mirror the player state into a native session and take the
 * button presses back as commands.
 */
import { usePlayer } from '../store/player';

interface NativeMedia {
  update(json: string): void;
}

declare global {
  interface Window {
    WavelengthNative?: NativeMedia;
    __wlMedia?: (cmd: string) => void;
  }
}

export function enableNativeMedia() {
  const native = window.WavelengthNative;
  if (!native) return; // desktop / browser: navigator.mediaSession already covers media keys

  // buttons → player
  window.__wlMedia = (cmd: string) => {
    const p = usePlayer.getState();
    if (cmd === 'play') {
      if (!p.playing) p.toggle();
    } else if (cmd === 'pause') {
      if (p.playing) p.toggle();
    } else if (cmd === 'next') p.next();
    else if (cmd === 'prev') p.prev();
    else if (cmd.startsWith('seek:')) p.seek(Number(cmd.slice(5)));
  };

  // player → native session. Push on any meaningful change; position every ~5 s so the
  // car/lock-screen progress bar stays honest without flooding the bridge.
  let last = '';
  let lastPosPush = 0;
  const push = () => {
    const s = usePlayer.getState();
    const t = s.current();
    const live = t?.kind === 'radio';
    const state = {
      hasTrack: !!t,
      playing: s.playing,
      live,
      title: t ? (live ? s.liveTitle ?? t.title : t.title) : '',
      artist: t ? (live ? (s.liveTitle ? t.title : 'Live radio') : t.artist) : '',
      album: t?.album ?? '',
      art: s.liveCover ?? t?.coverUrl ?? '',
      duration: s.duration || t?.duration || 0,
      position: s.position,
    };
    const key = JSON.stringify({ ...state, position: 0 });
    const now = Date.now();
    if (key === last && now - lastPosPush < 5000) return;
    last = key;
    lastPosPush = now;
    try {
      native.update(JSON.stringify(state));
    } catch {
      /* bridge gone (activity recreated) */
    }
  };
  usePlayer.subscribe(push);
  push();
}
