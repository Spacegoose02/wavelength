import { hubClient, useHub } from '../store/hub';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';

/**
 * Tell the Hub what this device is playing, so admins see who's listening now (Settings → Server). Sent
 * when the song changes, every minute while playing, and once when playback stops. Radio and audiobooks
 * count too. Nothing is sent without a Hub.
 */
let started = false;
let last = '';
let lastAt = 0;

function report() {
  const c = hubClient();
  if (!c) return;
  const { queue, index, playing } = usePlayer.getState();
  const t = playing ? queue[index] : undefined;
  const key = t ? `${t.sourceId}:${t.id}` : '';
  if (key === last && (!key || Date.now() - lastAt < 60_000)) return;
  last = key;
  lastAt = Date.now();
  const source = t && useSettings.getState().sources.find((s) => s.id === t.sourceId)?.kind;
  c.playing(t ? { title: t.title, artist: t.artist, album: t.album, source: source ?? t.kind } : { stopped: true }).catch(() => {
    last = ''; // try again next time
  });
}

export function startListeningReports() {
  if (started) return;
  started = true;
  usePlayer.subscribe((s, prev) => {
    if (s.playing !== prev.playing || s.index !== prev.index || s.queue[s.index] !== prev.queue[prev.index]) report();
  });
  setInterval(report, 60_000);
  useHub.subscribe((s, prev) => {
    if (s.token !== prev.token) last = '';
  });
}
