import { useAiArtists } from '../lib/aiArtists';
import { useHub } from '../store/hub';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';

/** Your two choices about AI-generated artists (lib/aiArtists.ts). Both start off and follow you to every device. */
export function AiArtistSwitches() {
  const prefs = useSettings((s) => s.aiArtists);
  const set = useSettings((s) => s.setAiArtists);
  return (
    <>
      <label className="check">
        <span className="switch"><input type="checkbox" checked={prefs.hideInDiscover} onChange={(e) => set({ hideInDiscover: e.target.checked })} /><span /></span>
        <span><b>Hide AI artists from Discover</b>: the charts, Release Radar and Artists you might like skip them</span>
      </label>
      <label className="check">
        <span className="switch"><input type="checkbox" checked={prefs.outOfPicks} onChange={(e) => set({ outOfPicks: e.target.checked })} /><span /></span>
        <span><b>Keep AI artists out of my picks</b>: song radio, Sounds like this, Smart Shuffle, DJ mode and Made for you mixes, like Don't play</span>
      </label>
    </>
  );
}

/** Settings → Playback → AI artists. */
export function AiArtistSettings() {
  const n = useAiArtists((s) => s.artists.length);
  const signedIn = useHub((s) => !!s.token);
  if (!signedIn) return null;
  return (
    <section id="ai-artists">
      <h2>AI artists</h2>
      <p className="muted">
        Artists your Hub admin marked as AI-generated have a <span className="ai-badge">✦ AI</span> badge. You can still play them yourself.{' '}
        <button className="link" onClick={() => useUi.getState().go({ view: 'aiArtists' })}>See {n === 1 ? 'the 1 artist' : `all ${n}`} marked</button>
      </p>
      <AiArtistSwitches />
    </section>
  );
}
