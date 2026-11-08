import { useEffect, useState } from 'react';
import { clearLyricsPick, lyricQueries, lyricsCandidates, lyricsPickFor, maskForKids, pastedLyrics, setLyricsPick, type LyricsCandidate } from '../lib/lyrics';
import { useIsKid } from '../lib/kids';
import type { Track } from '../sources/types';
import { fmtTime, Spinner } from './common';

/**
 * "Wrong lyrics?" under the lyrics (components/Lyrics.tsx): other LRCLIB entries for the song to choose from, a search
 * of your own, a box to paste lyrics into (plain or LRC), or "no lyrics". The choice is remembered for the song on
 * this device and replaces the house's shared copy on the Hub (lib/lyrics.ts `setLyricsPick`).
 */
export function LyricsFixer({ track, onDone }: { track: Track; onDone: () => void }) {
  const kid = useIsKid();
  const q = lyricQueries(track)[0];
  const [query, setQuery] = useState(q ? `${q.artist} ${q.title}` : track.title);
  const [asked, setAsked] = useState<string | undefined>(undefined);
  const [state, setState] = useState<{ loading: boolean; list?: LyricsCandidate[]; error?: string }>({ loading: true });
  const [open, setOpen] = useState<string>();
  const [tries, setTries] = useState(0);
  const [paste, setPaste] = useState('');
  const pick = lyricsPickFor(track);

  useEffect(() => {
    let live = true;
    setState({ loading: true });
    lyricsCandidates(track, asked).then(
      (list) => live && setState({ loading: false, list }),
      () => live && setState({ loading: false, error: "Couldn't reach LRCLIB." }),
    );
    return () => {
      live = false;
    };
  }, [track.sourceId, track.id, asked, tries]);

  const use = (c: LyricsCandidate) => {
    setLyricsPick(track, c.lyrics);
    onDone();
  };
  const pasted = pastedLyrics(paste);
  const show = (s: string) => (kid ? maskForKids(s) : s);

  return (
    <div className="lyrics-fix">
      <div className="lyrics-fix-head">
        <strong>Pick the right lyrics</strong>
        <button type="button" className="link small" onClick={onDone}>Cancel</button>
      </div>
      <form
        className="lyrics-fix-search"
        onSubmit={(e) => {
          e.preventDefault();
          setAsked(query);
        }}
      >
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Artist and song" aria-label="Search LRCLIB" />
        <button type="submit" className="chip small">Search</button>
      </form>
      {state.loading ? (
        <Spinner />
      ) : state.error ? (
        <p className="errors small">{state.error} <button type="button" className="link small" onClick={() => setTries((n) => n + 1)}>Try again</button></p>
      ) : !state.list?.length ? (
        <p className="muted small">Nothing on LRCLIB for that. Try other words, or paste the lyrics below.</p>
      ) : (
        <ul className="lyrics-fix-list">
          {state.list.map((c) => {
            const first = c.lyrics.lines.filter((l) => l.text).slice(0, open === c.id ? 8 : 2);
            const off = track.duration && c.duration ? Math.round(c.duration - track.duration) : 0;
            return (
              <li key={c.id} className={c.likely ? 'likely' : ''}>
                <button type="button" className="lyrics-fix-pick" onClick={() => setOpen(open === c.id ? undefined : c.id)} aria-expanded={open === c.id}>
                  <span className="lyrics-fix-name">
                    {c.title} <span className="muted">· {c.artist}{c.album ? ` · ${c.album}` : ''}</span>
                  </span>
                  <span className="muted small">
                    {c.duration ? fmtTime(c.duration) : ''}
                    {Math.abs(off) > 2 ? ` (${off > 0 ? '+' : ''}${off} s)` : ''}
                    {c.lyrics.synced ? ' · synced' : c.hasTimes ? ' · words only (other length)' : ' · words only'}
                  </span>
                  <span className="lyric-extra">{first.map((l) => show(l.text)).join(' / ')}</span>
                </button>
                <span className="lyrics-fix-use">
                  <button type="button" className="chip small" onClick={() => use(c)}>Use</button>
                  {c.timedAnyway && (
                    <button type="button" className="chip small" title="Keep its times though its length differs; they may be early or late" onClick={() => use({ ...c, lyrics: c.timedAnyway! })}>
                      Use with times
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <details className="lyrics-fix-paste">
        <summary>Paste lyrics</summary>
        <textarea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Plain lines, or LRC with times:\n[00:12.30]First line'} />
        <button
          type="button"
          className="chip small"
          disabled={!pasted}
          onClick={() => {
            if (!pasted) return;
            setLyricsPick(track, pasted);
            onDone();
          }}
        >
          Use these{pasted?.synced ? ' (synced)' : ''}
        </button>
      </details>
      <div className="lyrics-fix-foot">
        <button
          type="button"
          className="link small"
          onClick={() => {
            setLyricsPick(track, null);
            onDone();
          }}
        >
          This song has no lyrics
        </button>
        {pick && (
          <button
            type="button"
            className="link small"
            onClick={() => {
              clearLyricsPick(track);
              onDone();
            }}
          >
            Forget my pick and look again
          </button>
        )}
      </div>
    </div>
  );
}
