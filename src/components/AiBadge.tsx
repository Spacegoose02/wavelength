import { useState } from 'react';
import { aiMarkOf, setAiArtist, useAiArtists, useIsAi } from '../lib/aiArtists';
import { useHub } from '../store/hub';

/**
 * The ✦ AI badge on an artist a Hub admin marked as AI-generated (lib/aiArtists.ts): next to their name on their
 * page, on their cards and on Discover's rows. Nothing for anyone else.
 */
export function AiBadge({ artist, className = '' }: { artist?: string; className?: string }) {
  const on = useIsAi(artist);
  if (!on) return null;
  return <span className={`ai-badge ${className}`} title="AI-generated artist" aria-label="AI-generated artist">✦ AI</span>;
}

/** The artist page's line under the name: who marked them. */
export function AiNote({ artist }: { artist: string }) {
  const list = useAiArtists((s) => s.artists);
  const mark = aiMarkOf(list, artist);
  if (!mark) return null;
  return <div className="muted small ai-note">AI-generated artist{mark.setBy ? `, marked by ${mark.setBy}` : ''}</div>;
}

/** Admins (`library.edit`): mark an artist as AI-generated, or not, from a page that has no Edit artist (their Deezer page). */
export function AiMarkButton({ artist, className = 'btn' }: { artist: string; className?: string }) {
  const can = useHub((s) => !!s.token && s.permissions.includes('library.edit'));
  const on = useIsAi(artist);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  if (!can || !artist) return null;
  const toggle = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      await setAiArtist(artist, !on);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className={className} disabled={busy} onClick={() => void toggle()}
        title={on ? 'Take the AI badge off this artist, for everyone on your Hub' : 'Badge this artist as AI-generated for everyone on your Hub, so people can hide them'}>
        {on ? 'Not AI' : '✦ Mark as AI'}
      </button>
      {err && <span className="card-err small">{err}</span>}
    </>
  );
}
