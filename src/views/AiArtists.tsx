import { useMemo, useState } from 'react';
import { AiArtistSwitches } from '../components/AiArtistSettings';
import { ArtistCard, Empty, Grid } from '../components/common';
import { normName as norm, setAiArtist, useAiArtists } from '../lib/aiArtists';
import type { Artist } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { useHub } from '../store/hub';
import { useUi } from '../store/ui';

/**
 * Browse → AI artists (docs/USER-GUIDE.md, "AI-generated artists"): every artist a Hub admin marked as
 * AI-generated (lib/aiArtists.ts), the ones in your library as cards and the rest by name (their Deezer page), with
 * your own two switches on top. Admins can take a mark off from here.
 */
export function AiArtistsView() {
  const list = useAiArtists((s) => s.artists);
  const artists = useCatalog((s) => s.artists);
  const signedIn = useHub((s) => !!s.token);
  const admin = useHub((s) => !!s.token && s.permissions.includes('library.edit'));
  const [busy, setBusy] = useState<string>();
  const [err, setErr] = useState<string>();
  const go = useUi((s) => s.go);
  const byName = useMemo(() => new Map(artists.map((a) => [norm(a.name), a])), [artists]);
  const inLibrary = list.map((m) => byName.get(norm(m.name))).filter((a): a is Artist => !!a);
  const elsewhere = list.filter((m) => !byName.has(norm(m.name)));

  const unmark = async (name: string) => {
    setBusy(name);
    setErr(undefined);
    try {
      await setAiArtist(name, false);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>AI artists <small>{list.length}</small></h1>
      </header>
      <p className="muted">
        Artists {admin ? 'you and other admins' : 'your Hub admin'} marked as AI-generated. They have a <span className="ai-badge">✦ AI</span> badge
        everywhere. {admin && 'Mark more from Edit artist, an artist’s Deezer page or a song’s menu.'}
      </p>
      {signedIn && <AiArtistSwitches />}
      {err && <div className="errors">{err}</div>}
      {!list.length ? (
        <Empty title="No AI artists yet">{signedIn ? (admin ? 'Mark an artist as AI from Edit artist or a song’s menu.' : 'Your Hub admin hasn’t marked any yet.') : 'Marking AI artists needs a Wavelength Hub.'}</Empty>
      ) : (
        <>
          {inLibrary.length > 0 && (
            <>
              <h2>In your library</h2>
              <Grid>{inLibrary.map((a) => <ArtistCard key={`${a.sourceId}:${a.id}`} artist={a} onOpen={(x) => go({ view: 'artist', artist: x })} />)}</Grid>
            </>
          )}
          {(elsewhere.length > 0 || admin) && <h2>{inLibrary.length ? 'Everyone marked' : 'Marked'}</h2>}
          <ul className="ai-artist-list">
            {(admin ? list : elsewhere).map((m) => {
              const mine = byName.get(norm(m.name));
              return (
                <li key={m.name}>
                  <button className="link grow" style={{ textAlign: 'left' }} onClick={() => go(mine ? { view: 'artist', artist: mine } : { view: 'artistReleases', artist: { id: '', sourceId: '', name: m.name } as Artist })}>{m.name}</button>
                  <span className="muted small">{m.setBy ? `by ${m.setBy} · ` : ''}{new Date(m.setAt).toLocaleDateString()}</span>
                  {admin && <button className="btn small ghost" disabled={busy === m.name} onClick={() => void unmark(m.name)}>Not AI</button>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
