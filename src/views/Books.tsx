import { useEffect, useMemo, useState } from 'react';
import { useCatalog } from '../store/catalog';
import { useSettings } from '../store/settings';
import { seekBook, usePlayer } from '../store/player';
import { useUi } from '../store/ui';
import { sourceFor } from '../sources/registry';
import type { Book, BookDetails } from '../sources/types';
import { Cover, Empty, Grid, Spinner, fmtTime } from '../components/common';
import { IconPlay } from '../components/Icons';
import { SortSelect } from '../components/SortSelect';
import { BOOK_SHOWS, BOOK_SORTS, saveChoice, savedChoice, sortBooks, type BookShow, type BookSort } from '../lib/shelfSort';
import { setBookFinished, timeLeft, useMarks, withMarks } from '../lib/episodes';

const SORT_KEY = 'wavelength.booksSort';
const SHOW_KEY = 'wavelength.booksShow';

/**
 * Play a book from where Audiobookshelf says you are, or from `at` (seconds into the whole book: a chapter, or 0 to
 * start over).
 */
export async function playBook(book: Book, at?: number) {
  const cur = usePlayer.getState().current();
  if (at !== undefined && cur?.kind === 'book' && cur.bookId === book.id) return seekBook(at);
  const cfg = useSettings.getState().sources.find((s) => s.id === book.sourceId);
  if (!cfg) return;
  const { tracks, resumeAt } = await sourceFor(cfg).startBook!(book.id);
  if (!tracks.length) return;
  const from = at ?? resumeAt;
  // find which file the spot falls in
  let idx = tracks.findIndex((t) => from >= (t.bookOffset ?? 0) && from < (t.bookOffset ?? 0) + (t.duration ?? 0));
  if (idx < 0) idx = 0;
  usePlayer.getState().playTracks(tracks, idx, Math.max(0, from - (tracks[idx].bookOffset ?? 0)));
}

/** A book: tap it for its page; the round button on the cover plays it from where you are. */
export function BookCard({ book: loaded }: { book: Book }) {
  const marks = useMarks((s) => s.marks);
  const book = withMarks([loaded], marks)[0];
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const play = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    setErr(undefined);
    try {
      await playBook(book);
    } catch (x) {
      setErr(String((x as Error).message ?? x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card book-card" role="button" tabIndex={0} title={err}
      onClick={() => useUi.getState().go({ view: 'book', book: loaded })}
      onKeyDown={(e) => e.key === 'Enter' && useUi.getState().go({ view: 'book', book: loaded })}>
      <div className="book-cover">
        <Cover src={book.coverUrl} alt={book.title} />
        {book.progress && !book.finished ? <div className="progress"><i style={{ width: `${Math.round(book.progress * 100)}%` }} /></div> : null}
        <button type="button" className="cover-play" title={book.progress && !book.finished ? 'Resume' : 'Play'} aria-label={`Play ${book.title}`} onClick={play}><IconPlay /></button>
        {busy && <div className="cover-overlay"><Spinner /></div>}
      </div>
      <div className="card-title" title={book.title}>{book.title}</div>
      <div className="card-sub">
        <span>{book.author}{book.finished ? ' · Finished' : timeLeft(book.duration, book.progress) ? ` · ${timeLeft(book.duration, book.progress)}` : book.duration ? ` · ${fmtTime(book.duration)}` : ''}</span>
      </div>
      {err && <div className="card-err">{err}</div>}
    </div>
  );
}

export function Books() {
  const { books, loading } = useCatalog();
  const marks = useMarks((s) => s.marks);
  const hasAbs = useSettings((s) => s.sources.some((x) => x.kind === 'audiobookshelf' && x.enabled));
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<BookSort>(() => savedChoice(SORT_KEY, BOOK_SORTS, 'added'));
  const [show, setShow] = useState<BookShow>(() => savedChoice(SHOW_KEY, BOOK_SHOWS, 'all'));
  if (!hasAbs) return <Empty title="No Audiobookshelf connected">Add your Audiobookshelf server in Settings.</Empty>;
  const f = filter.toLowerCase();
  const matching = withMarks(books, marks).filter((b) => !f || b.title.toLowerCase().includes(f) || b.author.toLowerCase().includes(f) || !!b.series?.toLowerCase().includes(f) || !!b.narrator?.toLowerCase().includes(f));
  const shown = sortBooks(matching, sort, show);
  // most recently played first, so the book you're in is the first card
  const inProgress = sortBooks(matching, 'played', 'started');
  return (
    <div className="page">
      <header className="page-head">
        <h1>Audiobooks <small>{shown.length}</small></h1>
        {loading && <Spinner />}
        <input className="filter" placeholder="Filter by title, author, series…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </header>
      {inProgress.length > 0 && show !== 'started' && (
        <section>
          <h2>Continue listening</h2>
          <div className="row-scroll">{inProgress.map((b) => <BookCard key={b.id} book={b} />)}</div>
        </section>
      )}
      <section>
        <div className="shelf-bar">
          <div className="chips" role="group" aria-label="Show">
            {BOOK_SHOWS.map(([v, label]) => (
              <button key={v} className={`chip ${show === v ? 'on' : ''}`} onClick={() => { setShow(v); saveChoice(SHOW_KEY, v); }}>{label}</button>
            ))}
          </div>
          <SortSelect value={sort} options={BOOK_SORTS} onChange={(v) => { setSort(v); saveChoice(SORT_KEY, v); }} />
        </div>
        {!shown.length && !loading ? <p className="muted">No books here.</p> : <Grid>{shown.map((b) => <BookCard key={b.id} book={b} />)}</Grid>}
      </section>
    </div>
  );
}

/** A series without its number: Audiobookshelf calls the second book's series "The Expanse #2". */
const seriesName = (s: string) => s.replace(/\s*#\s*[\d.]+\s*$/, '');

/**
 * A book's page: what it's about, how far you are, its chapters (tap one to play from there), mark it finished or
 * start over, and more from the same series and author.
 */
export function BookView({ book: loaded }: { book: Book }) {
  const cfg = useSettings((s) => s.sources.find((x) => x.id === loaded.sourceId));
  const marks = useMarks((s) => s.marks);
  const books = useCatalog((s) => s.books);
  const playing = usePlayer((s) => s.queue[s.index]);
  const position = usePlayer((s) => s.position);
  const fresh = books.find((b) => b.id === loaded.id && b.sourceId === loaded.sourceId) ?? loaded;
  const book = withMarks([fresh], marks)[0];
  const [details, setDetails] = useState<BookDetails | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (!cfg) return;
    let alive = true;
    const src = sourceFor(cfg);
    (src.getBookDetails?.(loaded.id) ?? Promise.resolve({}))
      .then((d) => alive && setDetails(d))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [loaded.id]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const here = playing?.kind === 'book' && playing.bookId === book.id ? (playing.bookOffset ?? 0) + position : undefined;
  const at = here ?? (book.finished ? undefined : (details?.currentTime || (book.progress && book.duration ? book.progress * book.duration : undefined)));
  const chapters = details?.chapters ?? [];
  const chapterNow = at === undefined ? -1 : chapters.findIndex((c) => at >= c.start && at < c.end);
  const started = !!book.progress && !book.finished;
  const sameSeries = book.series ? sortBooks(books.filter((b) => b.id !== book.id && b.series && seriesName(b.series) === seriesName(book.series!)), 'series') : [];
  const sameAuthor = books.filter((b) => b.id !== book.id && b.author && b.author === book.author && !sameSeries.includes(b));
  const desc = details?.description ?? '';

  return (
    <div className="page">
      <header className="hero">
        <div className="hero-art book-cover">
          <Cover src={book.coverUrl} alt={book.title} />
          {started ? <div className="progress"><i style={{ width: `${Math.round((book.progress ?? 0) * 100)}%` }} /></div> : null}
        </div>
        <div>
          <div className="kicker">Audiobook{book.series ? ` · ${book.series}` : ''}</div>
          <h1>{book.title}</h1>
          <div className="muted">
            {book.author}
            {book.narrator ? ` · Read by ${book.narrator}` : ''}
            {book.publishedYear ? ` · ${book.publishedYear}` : ''}
          </div>
          <div className="muted small book-status">
            {book.duration ? fmtTime(book.duration) : ''}
            {book.finished ? ' · Finished' : started ? ` · ${Math.round((book.progress ?? 0) * 100)}% · ${timeLeft(book.duration, book.progress)}` : book.duration ? ' · Not started' : ''}
            {chapterNow >= 0 && !book.finished ? ` · ${chapters[chapterNow].title}` : ''}
          </div>
          {details?.genres?.length ? <div className="chips book-genres">{details.genres.map((g) => <span key={g} className="chip">{g}</span>)}</div> : null}
          <div className="hero-actions">
            <button className="btn primary" disabled={busy} onClick={() => run(() => playBook(book, book.finished ? 0 : undefined))}>
              <IconPlay /> {started ? 'Resume' : book.finished ? 'Listen again' : 'Play'}
            </button>
            {started && <button className="btn" disabled={busy} onClick={() => run(() => playBook(book, 0))}>Start over</button>}
            {book.finished ? (
              <button className="btn ghost" disabled={busy} onClick={() => run(() => setBookFinished(book, false))} title="Back to not started">Mark as not finished</button>
            ) : (
              <button className="btn ghost" disabled={busy} onClick={() => run(() => setBookFinished(book, true))}>Mark as finished</button>
            )}
          </div>
        </div>
      </header>
      {error && <div className="errors">{error}</div>}
      {desc && (
        <p className="muted desc book-desc">
          {more || desc.length <= 420 ? desc : `${desc.slice(0, 400).replace(/\s+\S*$/, '')}… `}
          {desc.length > 420 && <button className="sub-link more-link" onClick={() => setMore(!more)}>{more ? ' Less' : 'More'}</button>}
        </p>
      )}
      {!details && !error && <Spinner />}
      {chapters.length > 0 && (
        <section>
          <h2>Chapters <small className="muted">{chapters.length}</small></h2>
          <div className="tracklist book-chapters">
            {chapters.map((c, i) => (
              <div key={`${i}:${c.start}`} className={`track-row ${i === chapterNow ? 'active' : ''} ${at !== undefined && c.end <= at ? 'done' : ''}`}
                onDoubleClick={() => run(() => playBook(book, c.start))}>
                <button className="track-num" title="Play from here" onClick={() => run(() => playBook(book, c.start))}>
                  <span>{i + 1}</span>
                  <IconPlay className="hover-play" />
                </button>
                <div className="track-main"><div className="track-title">{c.title}</div></div>
                <div className="track-meta">{fmtTime(c.start)}</div>
                <div className="track-time">{fmtTime(c.end - c.start)}</div>
              </div>
            ))}
          </div>
        </section>
      )}
      <MoreBooks title={book.series ? `More in ${seriesName(book.series)}` : ''} books={sameSeries} />
      <MoreBooks title={`More by ${book.author}`} books={sameAuthor} />
    </div>
  );
}

function MoreBooks({ title, books }: { title: string; books: Book[] }) {
  const list = useMemo(() => books.slice(0, 30), [books]);
  if (!title || !list.length) return null;
  return (
    <section>
      <h2>{title}</h2>
      <div className="row-scroll">{list.map((b) => <BookCard key={b.id} book={b} />)}</div>
    </section>
  );
}
