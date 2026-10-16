import { useState } from 'react';
import { useCatalog } from '../store/catalog';
import { useSettings } from '../store/settings';
import { usePlayer } from '../store/player';
import { sourceFor } from '../sources/registry';
import type { Book } from '../sources/types';
import { Cover, Empty, Grid, Spinner, fmtTime } from '../components/common';

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
        <span>{book.author}{book.duration ? ` · ${fmtTime(book.duration)}` : ''}</span>
      </div>
      {err && <div className="card-err">{err}</div>}
    </button>
  );
}

export function Books() {
  const { books, loading } = useCatalog();
  const hasAbs = useSettings((s) => s.sources.some((x) => x.kind === 'audiobookshelf' && x.enabled));
  const [filter, setFilter] = useState('');
  if (!hasAbs) return <Empty title="No Audiobookshelf connected">Add your Audiobookshelf server in Settings.</Empty>;
  const f = filter.toLowerCase();
  const shown = books.filter((b) => !f || b.title.toLowerCase().includes(f) || b.author.toLowerCase().includes(f));
  const inProgress = shown.filter((b) => b.progress && b.progress > 0 && b.progress < 1);
  return (
    <div className="page">
      <header className="page-head">
        <h1>Audiobooks <small>{shown.length}</small></h1>
        {loading && <Spinner />}
        <input className="filter" placeholder="Filter books…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </header>
      {inProgress.length > 0 && (
        <section>
          <h2>Continue listening</h2>
          <div className="row-scroll">{inProgress.map((b) => <BookCard key={b.id} book={b} />)}</div>
        </section>
      )}
      <section>
        <h2>All</h2>
        <Grid>{shown.map((b) => <BookCard key={b.id} book={b} />)}</Grid>
      </section>
    </div>
  );
}
