import { useSettings } from '../store/settings';

/** Settings → Playback: the artists and songs set to "Don't play" from the song menu, each with a way back. */
export function DontPlaySettings() {
  const dontPlay = useSettings((s) => s.dontPlay);
  const set = useSettings((s) => s.setDontPlay);
  const none = !dontPlay.artists.length && !dontPlay.songs.length;
  return (
    <section>
      <h2>Don't play</h2>
      <p className="muted">
        Kept out of song radio, Sounds like this, Smart Shuffle, DJ mode and your Made for you mixes. You can still play them yourself. Add more from
        any song's menu (right-click a song).
      </p>
      {none && <p className="muted">Nothing yet.</p>}
      <ul className="dont-play-list">
        {dontPlay.artists.map((a) => (
          <li key={`a:${a}`}>
            <span>{a}</span> <span className="muted">all songs</span>
            <button type="button" className="ghost" onClick={() => set({ ...dontPlay, artists: dontPlay.artists.filter((x) => x !== a) })}>Play again</button>
          </li>
        ))}
        {dontPlay.songs.map((s) => (
          <li key={`s:${s.artist}|${s.title}`}>
            <span>{s.title}</span> <span className="muted">{s.artist}</span>
            <button type="button" className="ghost" onClick={() => set({ ...dontPlay, songs: dontPlay.songs.filter((x) => x !== s) })}>Play again</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
