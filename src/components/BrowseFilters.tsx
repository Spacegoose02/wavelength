import { useMemo } from 'react';
import { ALBUM_SORTS, decadeCounts, decadeLabel, genreTree, isFiltered, TAG_FACETS, tagCounts, yearRange, type BrowseQuery } from '../lib/browse';
import { useItemTags } from '../lib/itemTags';
import type { Album } from '../sources/types';

/**
 * Genre, decade / years, style, mood, collection and sort for Albums and Artists (lib/browse.ts). Genres list
 * sub-genres under their genre. "Pick years…" swaps the decade for a from–to range. Style, mood and collection
 * show only when the Hub has some (lib/itemTags.ts).
 */
export function BrowseFilters<S extends string>({ albums, q, set, sorts }: {
  albums: Album[];
  q: BrowseQuery & { sort: S };
  set(q: Partial<BrowseQuery & { sort: S }>): void;
  sorts: { id: S; label: string }[];
}) {
  const tree = useMemo(() => genreTree(albums), [albums]);
  const decades = useMemo(() => decadeCounts(albums), [albums]);
  const range = useMemo(() => yearRange(albums), [albums]);
  const tagsAt = useItemTags().albums;
  const tags = useMemo(() => TAG_FACETS.map((f) => [f, tagCounts(albums, f)] as const), [albums, tagsAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const years = !!(q.from || q.to);
  const when = years ? 'years' : q.decade !== undefined ? String(q.decade) : '';
  if (!tree.length && !decades.length) return null;
  return (
    <div className="browse-filters row gap wrap">
      {tree.length > 0 && (
        <select aria-label="Genre" value={q.genre ?? ''} onChange={(e) => set({ genre: e.target.value || undefined })}>
          <option value="">All genres</option>
          {tree.map((g) => [
            <option key={g.genre} value={g.genre}>{g.label} ({g.albums})</option>,
            ...g.subs.map((s) => <option key={`${g.genre}/${s.genre}`} value={s.genre}>{'   '}{s.label} ({s.albums})</option>),
          ])}
        </select>
      )}
      {decades.length > 0 && (
        <select aria-label="Decade" value={when} onChange={(e) => {
          const v = e.target.value;
          if (v === 'years') set({ decade: undefined, from: range?.min, to: range?.max });
          else set({ decade: v ? Number(v) : undefined, from: undefined, to: undefined });
        }}>
          <option value="">Any year</option>
          {decades.map((d) => <option key={d.decade} value={d.decade}>{decadeLabel(d.decade)} ({d.albums})</option>)}
          <option value="years">Pick years…</option>
        </select>
      )}
      {years && (
        <span className="row gap browse-years">
          <input type="number" aria-label="From year" min={range?.min} max={range?.max} value={q.from ?? ''}
            onChange={(e) => set({ from: Number(e.target.value) || undefined })} />
          <span className="muted">to</span>
          <input type="number" aria-label="To year" min={range?.min} max={range?.max} value={q.to ?? ''}
            onChange={(e) => set({ to: Number(e.target.value) || undefined })} />
        </span>
      )}
      {tags.map(([f, list]) => list.length > 0 && (
        <select key={f} aria-label={LABEL[f]} value={q[f] ?? ''} onChange={(e) => set({ [f]: e.target.value || undefined })}>
          <option value="">{`Any ${LABEL[f].toLowerCase()}`}</option>
          {list.map((t) => <option key={t.name} value={t.name}>{t.name} ({t.albums})</option>)}
        </select>
      ))}
      <select aria-label="Sort" value={q.sort} onChange={(e) => set({ sort: e.target.value as S })}>
        {sorts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      {isFiltered(q) && <button className="btn small ghost" onClick={() => set({ genre: undefined, decade: undefined, from: undefined, to: undefined, style: undefined, mood: undefined, collection: undefined })}>Clear</button>}
    </div>
  );
}

const LABEL = { style: 'Style', mood: 'Mood', collection: 'Collection' } as const;

export { ALBUM_SORTS };
export const ARTIST_SORTS: { id: 'name' | 'albums'; label: string }[] = [
  { id: 'name', label: 'A to Z' },
  { id: 'albums', label: 'Most albums' },
];
