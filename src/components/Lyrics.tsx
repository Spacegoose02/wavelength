import { useEffect, useMemo, useRef, useState } from 'react';
import { currentLine, lyricQueries, lyricsFor, lyricsPickFor, maskForKids, type Lyrics } from '../lib/lyrics';
import { LyricsFixer } from './LyricsFixer';
import { useFeature } from '../lib/features';
import { useIsKid } from '../lib/kids';
import { deviceLanguage, type LyricsMode, needsRomanizing, translateLyrics } from '../lib/lyricsTranslate';
import { useHub } from '../store/hub';
import { sourceFor } from '../sources/registry';
import type { Track } from '../sources/types';
import { useSettings } from '../store/settings';
import { usePlayer } from '../store/player';
import { Spinner } from './common';

/**
 * Now Playing lyrics (lib/lyrics.ts). Synced lyrics follow the song, karaoke style: the line being sung is lit and
 * kept in view, and tapping a line jumps there. Plain lyrics just scroll.
 */
export function LyricsPanel({ track }: { track: Track }) {
  const [state, setState] = useState<{ key: string; lyrics?: Lyrics; loading: boolean; failed?: boolean }>({ key: '', loading: true });
  const [attempt, setAttempt] = useState(0);
  const key = `${track.sourceId}:${track.id}`;
  const kid = useIsKid();
  const position = usePlayer((s) => s.position);
  const seek = usePlayer((s) => s.seek);
  const list = useRef<HTMLDivElement>(null);
  const translateFeature = useFeature('lyricsTranslate');
  const hasHub = useHub((s) => !!s.token);
  const translateOn = translateFeature && hasHub;
  // "Wrong lyrics?" open for this song (LyricsFixer)
  const [fixing, setFixing] = useState('');
  const fixDone = () => {
    setFixing('');
    setExtra({ key: '' });
    setAttempt((n) => n + 1);
  };
  const [extra, setExtra] = useState<{ key: string; mode?: LyricsMode; lines?: string[]; busy?: boolean; error?: string }>({ key: '' });

  useEffect(() => {
    let live = true;
    setState({ key, loading: true });
    const cfg = useSettings.getState().sources.find((s) => s.id === track.sourceId);
    lyricsFor(track, cfg ? sourceFor(cfg) : undefined).then(
      (lyrics) => live && setState({ key, lyrics, loading: false }),
      () => live && setState({ key, loading: false, failed: true }),
    );
    return () => {
      live = false;
    };
    // one fetch per song (track objects change when a source refreshes them), again on Try again
  }, [key, attempt]);

  const lines = useMemo(
    () => state.lyrics?.lines.map((l) => ({ ...l, text: kid ? maskForKids(l.text) : l.text })) ?? [],
    [state.lyrics, kid],
  );
  const synced = !!state.lyrics?.synced;
  const shown = extra.key === key && extra.lines ? extra : undefined;
  const pick = async (mode: LyricsMode) => {
    if (shown?.mode === mode) return setExtra({ key: '' });
    setExtra({ key, mode, busy: true });
    try {
      const out = await translateLyrics(track, lines.map((l) => l.text), mode);
      setExtra({ key, mode, lines: out.map((x) => (kid ? maskForKids(x) : x)) });
    } catch (e) {
      setExtra({ key, error: String((e as Error).message ?? e) });
    }
  };
  const busy = extra.key === key && extra.busy;
  const at = synced ? currentLine(lines, position + 0.2) : -1;

  useEffect(() => {
    if (at < 0) return;
    // scroll only the lyrics box (scrollIntoView would move the whole Now Playing page too)
    const box = list.current;
    const line = box?.querySelector<HTMLElement>(`[data-line="${at}"]`);
    if (box && line) box.scrollTo({ top: line.offsetTop - box.clientHeight / 2 + line.offsetHeight / 2, behavior: 'smooth' });
  }, [at]);

  if (fixing === key) return <LyricsFixer track={track} onDone={fixDone} />;
  if (state.loading || state.key !== key) return <div className="lyrics"><Spinner /></div>;
  const fix = (label: string) => (
    <button type="button" className="link small" onClick={() => setFixing(key)}>{label}</button>
  );
  const mine = !!lyricsPickFor(track);
  if (state.lyrics?.instrumental) return <div className="lyrics empty">♪ Instrumental ♪ {fix('Not an instrumental?')}</div>;
  if (state.failed)
    return (
      <div className="lyrics empty">
        Couldn't reach the lyrics services. <button className="link" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </div>
    );
  if (!lines.length) {
    // what was looked up, so a miss can be told apart from a song tagged in a way the lookup didn't expect
    const q = lyricQueries(track)[0];
    return (
      <div className="lyrics empty">
        {mine ? 'You marked this song as having no lyrics.' : `No lyrics found${q ? ` for “${q.title}” by ${q.artist}` : ' for this song'}.`} {fix('Find lyrics')}
      </div>
    );
  }
  const under = (i: number) => (shown?.lines?.[i] && shown.lines[i] !== lines[i].text ? <span className="lyric-extra">{shown.lines[i]}</span> : null);
  const lang = deviceLanguage();
  return (
    <div className={`lyrics ${synced ? 'synced' : ''}`} ref={list}>
      <div className="lyrics-tools">
        {translateOn && (
          <>
          <button type="button" className={`chip small ${shown?.mode === 'translate' ? 'on' : ''}`} disabled={!!busy} onClick={() => void pick('translate')} aria-pressed={shown?.mode === 'translate'}>
            {busy && extra.mode === 'translate' ? 'Translating…' : `In ${lang}`}
          </button>
          {needsRomanizing(lines.map((l) => l.text)) && (
            <button type="button" className={`chip small ${shown?.mode === 'romanize' ? 'on' : ''}`} disabled={!!busy} onClick={() => void pick('romanize')} aria-pressed={shown?.mode === 'romanize'}>
              {busy && extra.mode === 'romanize' ? 'Writing…' : 'In Latin letters'}
            </button>
          )}
          {extra.key === key && extra.error && <span className="errors small">{extra.error}</span>}
          </>
        )}
        <span className="lyrics-tools-end">{fix('Wrong lyrics?')}</span>
      </div>
      {lines.map((l, i) => (
        synced ? (
          <button key={i} data-line={i} className={`lyric ${i === at ? 'now' : i < at ? 'past' : ''}`} onClick={() => l.time !== undefined && seek(l.time)}>
            {l.text || '♪'}
            {under(i)}
          </button>
        ) : (
          <p key={i} className="lyric">{l.text || ' '}{under(i)}</p>
        )
      ))}
      <div className="lyrics-credit muted small">{mine ? 'Lyrics you picked, ' : 'Lyrics from '}{state.lyrics?.source}{kid ? ', strong words hidden' : ''}{shown ? (shown.mode === 'translate' ? `; ${lang} by the AI DJ, may not be exact` : '; Latin letters by the AI DJ') : ''}</div>
    </div>
  );
}
