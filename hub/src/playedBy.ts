/**
 * Who sent each device its last song through the Hub's relay (routes/relay.ts): the Hub itself, from the music folder
 * (phase 4, catalogStream.ts), or Navidrome passed through. Listening now (routes/listening.ts) shows it, so an admin
 * can see the Hub playing. Kept in memory only. A device that never streams through the relay has no entry: it
 * talks to Navidrome directly.
 */
export type PlayedBy = 'hub' | 'navidrome';

const last = new Map<number, { by: PlayedBy; at: number }>();
/** a song longer than this between streams is rare; past it the device may have moved off the relay */
const FRESH_MS = 30 * 60_000;

export function playedBy(deviceId: number, by: PlayedBy) {
  last.set(deviceId, { by, at: Date.now() });
}

export function lastPlayedBy(deviceId: number): PlayedBy | null {
  const e = last.get(deviceId);
  return e && Date.now() - e.at < FRESH_MS ? e.by : null;
}
