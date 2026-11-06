import { useState } from 'react';
import { useHouseActivity } from '../lib/houseActivity';
import { findInLibrary } from '../lib/match';
import { joinParty, useTogether } from '../lib/together';
import { usePlayer } from '../store/player';

/** "Listening now" in the sidebar: what the people in the house are playing (lib/houseActivity.ts). */
export function HouseActivity() {
  const listeners = useHouseActivity((s) => s.listeners);
  const parties = useHouseActivity((s) => s.parties);
  const inParty = useTogether((s) => !!s.party);
  const [msg, setMsg] = useState<Record<number, string>>({});
  if (!listeners.length) return null;
  const play = async (l: (typeof listeners)[number]) => {
    const t = await findInLibrary()({ title: l.title, artist: l.artist }).catch(() => undefined);
    if (t) usePlayer.getState().playTracks([t]);
    else setMsg((m) => ({ ...m, [l.userId]: 'Not in your library' }));
  };
  return (
    <section className="house-activity" aria-label="Listening now in the house">
      <div className="side-head-label">Listening now</div>
      {listeners.map((l) => {
        const party = parties.get(l.userId);
        return (
          <div key={l.userId} className="house-row" title={`${l.displayName} on ${l.device}`}>
            <div className="house-main">
              <span className="house-name">
                <span className={`house-dot ${l.playing ? 'on' : ''}`} aria-hidden />
                {l.displayName}
              </span>
              <span className="house-song">{msg[l.userId] ?? `${l.title}${l.artist ? ` · ${l.artist}` : ''}`}</span>
            </div>
            {party && !inParty ? (
              <button type="button" className="chip small" onClick={() => void joinParty(party).catch(() => undefined)} aria-label={`Join ${l.displayName}'s party`}>Join</button>
            ) : (
              <button type="button" className="chip small" onClick={() => void play(l)} aria-label={`Play ${l.title}`}>Play</button>
            )}
          </div>
        );
      })}
    </section>
  );
}
