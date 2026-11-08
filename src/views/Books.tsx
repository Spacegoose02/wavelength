import { useState } from 'react';
import { useCatalog } from '../store/catalog';
import { useSettings } from '../store/settings';
import { usePlayer } from '../store/player';
import { sourceFor } from '../sources/registry';
import type { Book } from '../sources/types';
import { Cover, Empty, Grid, Spinner, fmtTime } from '../components/common';
import { SortSelect } from '../components/SortSelect';
import { BOOK_SHOWS, BOOK_SORTS, saveChoice, savedChoice, sortBooks, type BookShow, type BookSort } from '../lib/shelfSort';

const SORT_KEY = 'wavelength.booksSort';
const SHOW_KEY = 'wavelength.booksShow';

async function playBook(book: Book) {
  const cfg = useSettings.getState().sources.find((s) => s.id === book.sourceId);
  if (!cfg) return;
  const { tracks, resumeAt } = await sourceFor(cfg).startBook!(book.id);
  if (!tracks.length) return;
  // find which file the resume point falls in
  let idx = tracks.findIndex((t) => resumeAt >= (t.bookOffset ?? 0) && resumeAt < (t.bookOffset ?? 0) + (t.duration ?? 0));
  if (idx < 0) idx = 0;
  usePlayer.getState().playTracks(tracks, idx, Math.max(0, resumeAt - (tracks[idx].bookOffset ?? 0)));
}

export function BookCard({ book }: { book: Book }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  return (
    <button className="card" title={err} onClick={async () => {
      setBusy(true);
      setErr(undefined);
      try {
        await playBook(book);
      } catch (e) {
        setErr(String((e as Error).message ?? e));
      } finally {
        setBusy(false);
      }
    }}>
      <div className="book-cover">
        <Cover src={book.coverUrl} alt={book.title} />
        {book.progress ? <div className="progress"><i style={{ width: `${Math.round(book.progress * 100)}%` }} /></div> : null}
        {busy && <div className="cover-overlay"><Spinner /></div>}
      </div>
      <div className="card-title" title={book.title}>{book.title}</div>
      <div className="card-sub">
        <span>{book.author}{book.duration ? ` · ${fmtTime(book.duration)}` : ''}{book.finished ? ' · Finished' : ''}</span>
      </div>
      {err && <div className="card-err">{err}</div>}
    </button>
  );
}

export function Books() {
  const { books, loading } = useCatalog();
  const hasAbs = useSettings((s) => s.sources.some((x) => x.kind === 'audiobookshelf' && x.enabled));
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<BookSort>(() => savedChoice(SORT_KEY, BOOK_SORTS, 'added'));
  const [show, setShow] = useState<BookShow>(() => savedChoice(SHOW_KEY, BOOK_SHOWS, 'all'));
  if (!hasAbs) return <Empty title="No Audiobookshelf connected">Add your Audiobookshelf server in Settings.</Empty>;
  const f = filter.toLowerCase();
  const matching = books.filter((b) => !f || b.title.toLowerCase().includes(f) || b.author.toLowerCase().includes(f) || !!b.series?.toLowerCase().includes(f) || !!b.narrator?.toLowerCase().includes(f));
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
