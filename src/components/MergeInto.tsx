import { useEffect, useMemo, useRef, useState } from 'react';
import { applyMerge, navidromeRefs, planAlbums, planArtists, type MergePlan } from '../lib/merge';
import type { Album, Artist } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { useUi } from '../store/ui';
import { LibraryServer, libraryServer } from '../lib/serverName';

/**
 * Plex's way of merging, from the duplicate: **Merge into…** on an artist or album page opens a list of the
 * library's artists (or albums), the likely duplicates first, and the one picked is kept; this one merges into it.
 * Under the hood it's the same merge as Select → Merge (src/lib/merge.ts): one tag-editor Save through the Hub,
 * undone in one go under Settings → Server → Tag edits.
 */

/** A name with the small differences between duplicates taken out: case, accents, "The", "&"/"and", punctuation. */
export function looseKey(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/^the\s+|,\s*the$/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** An album title without its edition: "(Deluxe)", "[Clean]", "- Remastered 2011". */
export const albumKey = (title: string) => looseKey(title.replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/\s+-\s+.*(edition|remaster|version|deluxe).*$/i, ''));

/** How alike two names are, for sorting the list: 2 the same loosely, 1 one inside the other, 0 not. */
export function likeness(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 2;
  return a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a)) ? 1 : 0;
}

const refKeys = (x: Album | Artist) => new Set((x.refs ?? [x]).map((r) => `${r.sourceId}:${r.id}`));
const sameItem = (a: Album | Artist, b: Album | Artist) => {
  const k = refKeys(a);
  return (b.refs ?? [b]).some((r) => k.has(`${r.sourceId}:${r.id}`));
};

type Props = { kind: 'artist'; item: Artist } | { kind: 'album'; item: Album };

export function MergeIntoButton(props: Props) {
  const { kind, item } = props;
  const { artists, albums } = useCatalog();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string>();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const nameOf = (x: Album | Artist) => (kind === 'artist' ? (x as Artist).name : `${(x as Album).title} – ${(x as Album).artist}`);
  const list = useMemo(() => {
    if (!open) return [];
    const f = q.trim().toLowerCase();
    if (kind === 'artist') {
      const me = looseKey((item as Artist).name);
      return artists
        .filter((a) => !sameItem(a, item))
        .map((a) => ({ x: a as Album | Artist, score: likeness(me, looseKey(a.name)) }))
        .filter(({ x, score }) => (f ? (x as Artist).name.toLowerCase().includes(f) : score > 0))
        .sort((a, b) => b.score - a.score || (a.x as Artist).name.localeCompare((b.x as Artist).name))
        .slice(0, 50);
    }
    const me = item as Album;
    const title = albumKey(me.title), artist = looseKey(me.artist);
    // an album target has to be on Navidrome, since its files' tags are what the others take
    return albums
      .filter((a) => !sameItem(a, item) && navidromeRefs(a).length)
      .map((a) => ({ x: a as Album | Artist, score: likeness(title, albumKey(a.title)) * 2 + likeness(artist, looseKey(a.artist)) }))
      .filter(({ x, score }) => (f ? `${(x as Album).title} ${(x as Album).artist}`.toLowerCase().includes(f) : score >= 3))
      .sort((a, b) => b.score - a.score || (a.x as Album).title.localeCompare((b.x as Album).title))
      .slice(0, 50);
  }, [open, q, kind, item, artists, albums]);

  const pick = async (target: Album | Artist) => {
    setOpen(false);
    setBusy('Reading tags…');
    try {
      const plan = kind === 'artist' ? await planArtists([target as Artist, item as Artist]) : await planAlbums([target as Album, item as Album]);
      if (await confirmMerge(plan, [nameOf(item)], setBusy)) {
        if (kind === 'artist') {
          forgetArtists([item as Artist]);
          useUi.getState().go({ view: 'artist', artist: target as Artist });
        } else {
          forgetAlbums([item as Album]);
          useUi.getState().go({ view: 'album', album: target as Album });
        }
      }
    } catch (e) {
      alert(String((e as Error).message ?? e));
    } finally {
      setBusy(undefined);
      setQ('');
    }
  };

  return (
    <div className={`menu-wrap ${open ? 'open' : ''}`} ref={ref}>
      <button className="btn" disabled={!!busy} title={`Merge this ${kind} into another one: pick the one to keep`} onClick={() => setOpen(!open)}>
        {busy ?? 'Merge into…'}
      </button>
      {open && (
        <div className="menu merge-menu">
          <input autoFocus placeholder={kind === 'artist' ? 'Find the artist to keep…' : 'Find the album to keep…'} value={q} onChange={(e) => setQ(e.target.value)} />
          {!q.trim() && <div className="menu-hint">{list.length ? 'Looks like the same one:' : `Type to find the ${kind} to keep`}</div>}
          {q.trim() && !list.length && <div className="menu-hint">Nothing called that{kind === 'album' ? ` on ${libraryServer()}` : ''}</div>}
          {list.map(({ x }) => (
            <button key={[...refKeys(x)].join('|')} className="menu-item" onClick={() => void pick(x)}>
              <span>{kind === 'artist' ? (x as Artist).name : (x as Album).title}</span>
              {kind === 'album' && <small>{(x as Album).artist}{(x as Album).year ? ` · ${(x as Album).year}` : ''}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Show what a merge will change, ask, and save it. True when it was saved. */
export async function confirmMerge(plan: MergePlan, others: string[], setBusy: (s?: string) => void) {
  if (!plan.changes.length) {
    alert(`Nothing to change: ${others.join(', ')} already ${others.length === 1 ? 'has' : 'have'} the same tags as ${plan.into}.${plan.missing.length ? ` (${plan.missing.length} files weren't found in the Hub's music folder.)` : ''}`);
    return false;
  }
  const list = others.slice(0, 8).map((x) => `• ${x}`).join('\n') + (others.length > 8 ? `\n…and ${others.length - 8} more` : '');
  const missing = plan.missing.length ? `\n\n${plan.missing.length} file${plan.missing.length === 1 ? ' isn’t' : 's aren’t'} in the Hub's music folder and will be left out.` : '';
  if (!confirm(`Merge into ${plan.into}?\n\n${list}\n\nThis rewrites the tags of ${plan.changes.length} song${plan.changes.length === 1 ? '' : 's'}. The audio isn't touched, and you can undo it under Settings → Server → Tag edits.${missing}`)) return false;
  setBusy('Merging…');
  const r = await applyMerge(plan);
  alert(`Merged: ${r.changed.length} song${r.changed.length === 1 ? '' : 's'} retagged${r.failed.length ? `; ${r.failed.length} failed (${r.failed[0].error})` : ''}. ${LibraryServer()} rescans in a minute or two to show it.`);
  // the library refreshes once Navidrome has had time to rescan
  window.setTimeout(() => void useCatalog.getState().load(), 120_000);
  return r.changed.length > 0;
}

/** Take merged albums and artists off the lists now; the refresh after the rescan shows the result. */
export function forgetAlbums(gone: Album[]) {
  const keys = new Set(gone.flatMap((a) => navidromeRefs(a)).map((r) => `${r.sourceId}:${r.id}`));
  const keep = (a: Album) => {
    const refs = (a.refs ?? [a]).filter((r) => !keys.has(`${r.sourceId}:${r.id}`));
    return refs.length === (a.refs ?? [a]).length ? [a] : refs.length ? [{ ...a, ...refs[0], refs }] : [];
  };
  useCatalog.setState((s) => ({ albums: s.albums.flatMap(keep), recent: s.recent.flatMap(keep) }));
}

export function forgetArtists(gone: Artist[]) {
  const keys = new Set(gone.flatMap((a) => navidromeRefs(a)).map((r) => `${r.sourceId}:${r.id}`));
  useCatalog.setState((s) => ({
    artists: s.artists.flatMap((a) => {
      const refs = (a.refs ?? [a]).filter((r) => !keys.has(`${r.sourceId}:${r.id}`));
      return refs.length === (a.refs ?? [a]).length ? [a] : refs.length ? [{ ...a, ...refs[0], refs }] : [];
    }),
  }));
}
