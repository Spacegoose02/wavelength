import { useEffect, useState } from 'react';
import { artistBio, type ArtistBio } from '../lib/artistInfo';
import { useArtistMeta } from '../lib/artistMeta';
import { useFeature } from '../lib/features';
import type { HubTourEvent } from '../sources/hub';
import { hubClient, useHub } from '../store/hub';

const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: new Date(`${d}T12:00:00`).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });

/** Artist page: the story (Wikipedia), facts and members (MusicBrainz), links, and upcoming shows (lib/artistInfo.ts, hub/src/tours.ts). */
export function ArtistAbout({ name }: { name: string }) {
  const info = useFeature('artistInfo');
  const [bio, setBio] = useState<ArtistBio | null | undefined>();
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (!info) return;
    let alive = true;
    setBio(undefined);
    setMore(false);
    artistBio(name).then((b) => alive && setBio(b), () => alive && setBio(null));
    return () => {
      alive = false;
    };
  }, [name, info]);

  const facts = bio ? [
    bio.type && bio.area ? `${bio.type === 'Group' ? 'Formed in' : 'From'} ${bio.area}` : bio.area,
    bio.began ? `${bio.type === 'Person' ? 'Born' : 'Started'} ${bio.began.slice(0, 4)}` : undefined,
    bio.ended ? `${bio.type === 'Person' ? 'Died' : 'Ended'} ${bio.ended.slice(0, 4)}` : undefined,
  ].filter(Boolean) : [];
  // a biography an admin wrote in Edit artist comes first, and shows even with artist info turned off
  const own = useArtistMeta(name)?.bio;
  const summary = own || bio?.summary;
  const hasBio = !!own || (info && !!bio && (!!bio.summary || facts.length > 0 || bio.members.length > 0));

  return (
    <>
      {hasBio && (
        <section className="artist-about">
          <h2>About</h2>
          {summary && <>
            <p className={`bio ${more ? '' : 'short'}`}>{summary}</p>
            {summary.length > 420 && <button className="link small" onClick={() => setMore(!more)}>{more ? 'Less' : 'Read more'}</button>}
          </>}
          {bio && facts.length > 0 && <div className="facts muted small">{facts.map((f) => <span key={f}>{f}</span>)}</div>}
          {bio && bio.members.length > 0 && (
            <div className="members small">
              <b>Members:</b>{' '}
              {bio.members.slice(0, 16).map((m, i) => (
                <span key={m.name} className={m.current ? '' : 'muted'}>{i ? ', ' : ''}{m.name}{m.years ? ` (${m.years})` : ''}</span>
              ))}
            </div>
          )}
          {bio && (bio.links.length > 0 || bio.wikipedia) && (
            <div className="row gap wrap small">
              {bio.links.map((l) => <a key={l.url} className="chip" href={l.url} target="_blank" rel="noreferrer">{l.label}</a>)}
              {bio.wikipedia && <a className="chip" href={bio.wikipedia} target="_blank" rel="noreferrer">Wikipedia</a>}
            </div>
          )}
          {bio && <p className="muted small credit-src">{own ? 'Facts and links from MusicBrainz.' : 'From Wikipedia and MusicBrainz.'}</p>}
        </section>
      )}
      <TourDates name={name} />
    </>
  );
}

function TourDates({ name }: { name: string }) {
  const on = useFeature('tourDates');
  const signedIn = useHub((s) => !!s.token);
  const [events, setEvents] = useState<HubTourEvent[]>();
  const [all, setAll] = useState(false);
  useEffect(() => {
    const c = hubClient();
    if (!on || !signedIn || !c) return;
    let alive = true;
    setEvents(undefined);
    c.toursStatus()
      .then((s) => (s.available ? c.tours(name) : { events: [] }))
      .then((r) => alive && setEvents(r.events), () => alive && setEvents([]));
    return () => {
      alive = false;
    };
  }, [name, on, signedIn]);
  if (!events?.length) return null;
  const shown = all ? events : events.slice(0, 5);
  return (
    <section className="artist-about">
      <h2>On tour</h2>
      <ul className="tour-list">
        {shown.map((e) => (
          <li key={`${e.date}${e.venue}`}>
            <span className="tour-date">{fmtDate(e.date)}</span>
            <span>{e.venue}<br /><small className="muted">{[e.city, e.country].filter(Boolean).join(', ')}{e.time ? ` · ${e.time}` : ''}</small></span>
            {e.url ? <a className="btn small" href={e.url} target="_blank" rel="noreferrer">Tickets</a> : <span />}
          </li>
        ))}
      </ul>
      {events.length > 5 && <button className="link small" onClick={() => setAll(!all)}>{all ? 'Fewer dates' : `All ${events.length} dates`}</button>}
    </section>
  );
}
