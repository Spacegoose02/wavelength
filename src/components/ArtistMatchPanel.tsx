import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { type ArtistCandidate, inLibraryCount, libraryAlbumsBy } from '../lib/artistMatch';
import { parseArtistLink } from '../lib/artistMatches';
import { type ArtistBio, artistBioById, artistBioByName, type MbCandidate, searchMusicBrainz } from '../lib/artistInfo';
import { ownedIndex } from '../lib/artistReleases';
import { useFeature } from '../lib/features';
import { getDeezerReleases } from '../sources/deemix';
import type { HubArtistMatch } from '../sources/hub';
import { deezerArtistById, deezerArtistsByName, searchDeezerArtists } from '../sources/releaseRadar';
import { useCatalog } from '../store/catalog';
import { Spinner } from './common';

/**
 * Edit artist → Match (docs/USER-GUIDE.md, "Match an artist by hand"): which MusicBrainz artist (bio, facts, links,
 * members) and which Deezer artist (Browse releases, the newest release banner, Follow, Release Radar) a library
 * artist is, when looking them up by name finds nobody or the wrong one. Search both sites, or paste a link or id,
 * and **Use this**; **Automatic** goes back to looking them up by name, and **Not on …** stops looking them up there.
 * Nothing is saved here: the dialog's Save does it (lib/artistMatches.ts keeps the list).
 */

type Mb = HubArtistMatch['musicbrainz'];
type Dz = HubArtistMatch['deezer'];

const fans = (n: number) => `${n.toLocaleString()} fan${n === 1 ? '' : 's'}`;
const errText = (e: unknown) => String((e as Error)?.message ?? e);
const mbLine = (c: Pick<MbCandidate, 'type' | 'area' | 'began' | 'ended'>) =>
  [c.type, c.area, c.began && `${c.type === 'Person' ? 'born' : 'from'} ${c.began.slice(0, 4)}`, c.ended && `${c.type === 'Person' ? 'died' : 'until'} ${c.ended.slice(0, 4)}`].filter(Boolean).join(' · ');

/** Who an id or a name lookup is, for the two boxes at the top. */
type Who<T> = { state: 'loading' } | { state: 'none' } | { state: 'error'; error: string } | { state: 'found'; it: T; extra?: string };

export function ArtistMatchPanel({ name, mb, dz, onChange }: { name: string; mb: Mb; dz: Dz; onChange(m: { mb?: Mb; dz?: Dz }): void }) {
  const info = useFeature('artistInfo');
  const all = useCatalog((s) => s.albums);
  const owned = useMemo(() => ownedIndex(libraryAlbumsBy(name, all)), [name, all]);
  const yours = useMemo(() => libraryAlbumsBy(name, all).length, [name, all]);

  // what each site has for them now: the artist picked (by hand or in this dialog), or what the name finds
  const [mbNow, setMbNow] = useState<Who<ArtistBio>>({ state: 'loading' });
  const [dzNow, setDzNow] = useState<Who<ArtistCandidate>>({ state: 'loading' });
  useEffect(() => {
    let alive = true;
    setMbNow({ state: 'loading' });
    if (mb === 'none') return setMbNow({ state: 'none' });
    (mb ? artistBioById(mb) : artistBioByName(name)).then(
      (b) => alive && setMbNow(b ? { state: 'found', it: b } : { state: 'none' }),
      (e) => alive && setMbNow({ state: 'error', error: errText(e) }),
    );
    return () => {
      alive = false;
    };
  }, [mb, name]);
  useEffect(() => {
    let alive = true;
    setDzNow({ state: 'loading' });
    if (dz === 'none') return setDzNow({ state: 'none' });
    (typeof dz === 'number' ? deezerArtistById(dz).then((a) => ({ a, n: 1 })) : deezerArtistsByName(name).then((l) => ({ a: l[0], n: l.length }))).then(
      ({ a, n }) => alive && setDzNow(a ? { state: 'found', it: a, extra: n > 1 ? `${n} artists with this name` : undefined } : { state: 'none' }),
      (e) => alive && setDzNow({ state: 'error', error: errText(e) }),
    );
    return () => {
      alive = false;
    };
  }, [dz, name]);

  // search both sites, or look up a pasted link or id on its own site
  const [text, setText] = useState(name);
  const [mbHits, setMbHits] = useState<MbCandidate[] | string>();
  const [dzHits, setDzHits] = useState<(ArtistCandidate & { inLibrary?: number })[] | string>();
  const [searching, setSearching] = useState(false);
  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t) return;
    setSearching(true);
    setMbHits(undefined);
    setDzHits(undefined);
    const link = parseArtistLink(t);
    const mbSearch = link?.site === 'deezer' ? Promise.resolve(undefined)
      : link ? artistBioById(link.id).then((b) => [{ id: b.mbid ?? link.id, name: b.name, type: b.type, area: b.area, began: b.began, ended: b.ended, score: 100 }])
      : searchMusicBrainz(t);
    const dzSearch = link?.site === 'musicbrainz' ? Promise.resolve(undefined)
      : link ? deezerArtistById(link.id).then((a) => [a])
      : searchDeezerArtists(t, 10);
    await Promise.all([
      mbSearch.then((r) => setMbHits(r), (x) => setMbHits(link ? 'MusicBrainz has no artist with that id' : `Couldn’t reach MusicBrainz: ${errText(x)}`)),
      dzSearch.then(async (r) => {
        if (!r) return setDzHits(undefined);
        setDzHits(r);
        // which of them have your albums: the top few's discographies, checked against your albums by this artist
        if (!yours) return;
        const counted = await Promise.all(r.slice(0, 5).map(async (c) => ({ ...c, inLibrary: await inLibraryCount(c, owned, (x) => getDeezerReleases(x.id, { id: x.id, name })) })));
        setDzHits([...counted, ...r.slice(5)]);
      }, (x) => setDzHits(link ? 'Deezer has no artist with that id' : `Couldn’t reach Deezer: ${errText(x)}`)),
    ]);
    setSearching(false);
  };
  useEffect(() => {
    void search();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const status = <T,>(w: Who<T>, chosen: boolean, none: boolean, show: (it: T) => React.ReactNode) =>
    w.state === 'loading' ? <Spinner />
      : w.state === 'error' ? <span className="warn">Couldn’t look them up: {w.error}</span>
      : none ? <span>Not on this site (set by hand). Nothing is looked up.</span>
      : w.state === 'none' ? <span className="warn">{chosen ? 'Not found' : 'Not found by name'}</span>
      : <span>{chosen ? 'Matched by hand: ' : 'Found by name: '}{show(w.it)}{w.extra ? <span className="warn"> ({w.extra})</span> : null}</span>;

  return (
    <div className="match-panel">
      <div className="match-now">
        <section>
          <div className="match-site">MusicBrainz <span className="muted">bio, facts, links, members</span></div>
          {status(mbNow, !!mb && mb !== 'none', mb === 'none', (b) => (
            <><b>{b.name}</b>{mbLine(b) && <span className="muted"> · {mbLine(b)}</span>}{b.mbid && <> · <a href={`https://musicbrainz.org/artist/${b.mbid}`} target="_blank" rel="noreferrer">Open</a></>}</>
          ))}
          {!info && <p className="muted small">Artist bios and credits are turned off, so this only shows once they’re on.</p>}
          <div className="row gap small">
            {mb !== null && <button type="button" className="btn small ghost" onClick={() => onChange({ mb: null })}>Automatic</button>}
            {mb !== 'none' && <button type="button" className="btn small ghost" onClick={() => onChange({ mb: 'none' })}>Not on MusicBrainz</button>}
          </div>
        </section>
        <section>
          <div className="match-site">Deezer <span className="muted">releases, new release banner, Follow</span></div>
          {status(dzNow, typeof dz === 'number', dz === 'none', (a) => (
            <><b>{a.name}</b><span className="muted"> · {fans(a.fans)}</span> · <a href={`https://www.deezer.com/artist/${a.id}`} target="_blank" rel="noreferrer">Open</a></>
          ))}
          <div className="row gap small">
            {dz !== null && <button type="button" className="btn small ghost" onClick={() => onChange({ dz: null })}>Automatic</button>}
            {dz !== 'none' && <button type="button" className="btn small ghost" onClick={() => onChange({ dz: 'none' })}>Not on Deezer</button>}
          </div>
        </section>
      </div>

      {(mb === 'none' || mbNow.state === 'none') && (
        <p className="edit-hint small"><span>Not on MusicBrainz? Fill in their biography, details, links and members yourself on the General tab.</span></p>
      )}
      <form className="art-search" onSubmit={search}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="A name, or a MusicBrainz or Deezer link" aria-label="Search MusicBrainz and Deezer" />
        <button className="btn" disabled={searching || !text.trim()}>{searching ? '…' : 'Search'}</button>
      </form>
      <p className="muted small">Search both sites by any name, or paste a link or id: musicbrainz.org/artist/… or deezer.com/artist/….</p>

      {dzHits !== undefined && (
        <section className="match-results">
          <h4>Deezer</h4>
          {typeof dzHits === 'string' ? <p className="muted small">{dzHits}</p> : !dzHits.length ? <p className="muted small">No artists found.</p> : dzHits.map((c) => (
            <div key={c.id} className="match-row">
              {c.picture ? <img src={c.picture} alt="" loading="lazy" /> : <span className="match-pic" />}
              <div className="match-text">
                <b>{c.name}</b>
                <span className="muted small">{fans(c.fans)}{c.inLibrary !== undefined && ` · ${c.inLibrary ? `${c.inLibrary} of your album${c.inLibrary === 1 ? '' : 's'}` : 'none of your albums'}`} · <a href={`https://www.deezer.com/artist/${c.id}`} target="_blank" rel="noreferrer">Open</a></span>
              </div>
              {dz === c.id ? <span className="chip on">✓ Matched</span>
                : <button type="button" className={`btn small ${c.inLibrary ? 'primary' : ''}`} onClick={() => onChange({ dz: c.id })}>Use this</button>}
            </div>
          ))}
        </section>
      )}
      {mbHits !== undefined && (
        <section className="match-results">
          <h4>MusicBrainz</h4>
          {typeof mbHits === 'string' ? <p className="muted small">{mbHits}</p> : !mbHits.length ? <p className="muted small">No artists found.</p> : mbHits.map((c) => (
            <div key={c.id} className="match-row">
              <div className="match-text">
                <b>{c.name}</b>
                <span className="muted small">{[c.disambiguation, mbLine(c)].filter(Boolean).join(' · ')}{(c.disambiguation || mbLine(c)) && ' · '}<a href={`https://musicbrainz.org/artist/${c.id}`} target="_blank" rel="noreferrer">Open</a></span>
              </div>
              {mb === c.id ? <span className="chip on">✓ Matched</span>
                : <button type="button" className="btn small" onClick={() => onChange({ mb: c.id })}>Use this</button>}
            </div>
          ))}
        </section>
      )}

      <div className="row gap small match-foot">
        {(mb !== null || dz !== null) && <button type="button" className="link small" onClick={() => onChange({ mb: null, dz: null })}>Back to automatic</button>}
        {(mb !== 'none' || dz !== 'none') && <button type="button" className="link small" onClick={() => onChange({ mb: 'none', dz: 'none' })}>Don’t match (on neither site)</button>}
      </div>
    </div>
  );
}
