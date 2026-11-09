import { useMemo } from 'react';
import { decadeLabel, decadeOf, genreCounts } from '../lib/browse';
import { useItemTags } from '../lib/itemTags';
import { FIELDS, type FieldId, type FieldKind, fieldOf, isGroup, newGroup, newRule, OPS, type Rule, type RuleGroup } from '../lib/smartRules';
import { useCatalog } from '../store/catalog';
import { IconX } from './Icons';

/**
 * The advanced smart playlist rules (lib/smartRules.ts), laid out like Plex's filter builder: "Match all/any of the
 * following", then rows of field, operator and value, and groups inside groups.
 */
export function RuleBuilder({ value, onChange }: { value: RuleGroup; onChange: (g: RuleGroup) => void }) {
  return (
    <div className="rule-builder">
      <RuleSuggestions />
      <GroupEditor group={value} onChange={onChange} depth={0} />
    </div>
  );
}

const KINDS: FieldKind[] = ['Artist', 'Album', 'Track'];

function GroupEditor({ group, onChange, onRemove, depth }: { group: RuleGroup; onChange: (g: RuleGroup) => void; onRemove?: () => void; depth: number }) {
  const set = (i: number, r: Rule | RuleGroup) => onChange({ ...group, rules: group.rules.map((x, j) => (j === i ? r : x)) });
  const remove = (i: number) => onChange({ ...group, rules: group.rules.filter((_, j) => j !== i) });
  return (
    <div className={`rule-group${depth ? ' nested' : ''}`}>
      <div className="rule-group-head">
        <span>Match</span>
        <select value={group.match} aria-label="Match" onChange={(e) => onChange({ ...group, match: e.target.value as RuleGroup['match'] })}>
          <option value="all">all</option>
          <option value="any">any</option>
        </select>
        <span>of the following</span>
        {onRemove && <button type="button" className="icon-btn" title="Remove this group" onClick={onRemove}><IconX /></button>}
      </div>
      {group.rules.map((r, i) => (isGroup(r)
        ? <GroupEditor key={i} group={r} depth={depth + 1} onChange={(g) => set(i, g)} onRemove={() => remove(i)} />
        : <RuleRow key={i} rule={r} onChange={(x) => set(i, x)} onRemove={() => remove(i)} />))}
      <div className="row gap">
        <button type="button" className="btn small ghost" onClick={() => onChange({ ...group, rules: [...group.rules, newRule()] })}>+ Rule</button>
        {depth < 3 && <button type="button" className="btn small ghost" onClick={() => onChange({ ...group, rules: [...group.rules, newGroup(group.match === 'all' ? 'any' : 'all')] })}>+ Group</button>}
      </div>
    </div>
  );
}

function RuleRow({ rule, onChange, onRemove }: { rule: Rule; onChange: (r: Rule) => void; onRemove: () => void }) {
  const f = fieldOf(rule.field);
  const ops = OPS[f.type];
  const pickField = (id: FieldId) => {
    const nf = fieldOf(id);
    // keep the operator and value when they still make sense
    const same = nf.type === f.type;
    onChange(same ? { ...rule, field: id } : newRule(id));
  };
  const val = (value: string) => onChange({ ...rule, value });
  return (
    <div className="rule-row">
      <select aria-label="Field" value={rule.field} onChange={(e) => pickField(e.target.value as FieldId)}>
        {KINDS.map((k) => (
          <optgroup key={k} label={k}>
            {FIELDS.filter((x) => x.kind === k).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </optgroup>
        ))}
      </select>
      {ops.length > 1
        ? <select aria-label="Operator" value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value as Rule['op'] })}>{ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}</select>
        : <span className="muted small">{ops[0].label}</span>}
      <ValueInput rule={rule} onChange={val} />
      <button type="button" className="icon-btn" title="Remove this rule" onClick={onRemove}><IconX /></button>
    </div>
  );
}

const LISTS: Partial<Record<FieldId, string>> = {
  artist: 'rule-artists',
  artistGenre: 'rule-artist-genres',
  genre: 'rule-genres',
  trackGenre: 'rule-genres',
  artistStyle: 'tag-styles',
  style: 'tag-styles',
  artistMood: 'tag-moods',
  mood: 'tag-moods',
  artistCollection: 'tag-collections',
  collection: 'tag-collections',
  label: 'rule-labels',
  albumType: 'rule-album-types',
  format: 'rule-formats',
};

function ValueInput({ rule, onChange }: { rule: Rule; onChange: (v: string) => void }) {
  const f = fieldOf(rule.field);
  const decades = useDecades();
  switch (f.type) {
    case 'bool':
      return <select aria-label="Value" value={rule.value} onChange={(e) => onChange(e.target.value)}><option value="true">on</option><option value="false">off</option></select>;
    case 'rating':
      return (
        <select aria-label="Value" value={rule.value} onChange={(e) => onChange(e.target.value)}>
          <option value="">…</option>
          {[0, 1, 2, 3, 4, 5].map((r) => <option key={r} value={r}>{r ? '★'.repeat(r) : 'Not rated'}</option>)}
        </select>
      );
    case 'decade':
      return (
        <select aria-label="Value" value={rule.value} onChange={(e) => onChange(e.target.value)}>
          <option value="">…</option>
          {decades.map((d) => <option key={d} value={d}>{decadeLabel(d)}</option>)}
        </select>
      );
    case 'days':
      return <span className="rule-days"><input aria-label="Days" type="number" min={1} value={rule.value} onChange={(e) => onChange(e.target.value)} /> days</span>;
    case 'number':
      return <input aria-label="Value" type="number" value={rule.value} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <input aria-label="Value" value={rule.value} list={LISTS[rule.field]} onChange={(e) => onChange(e.target.value)} />;
  }
}

function useDecades(): number[] {
  const albums = useCatalog((s) => s.albums);
  return useMemo(() => {
    const set = new Set<number>();
    for (const a of albums) {
      const d = decadeOf(a.year);
      if (d) set.add(d);
    }
    return set.size ? [...set].sort((a, b) => b - a) : [2020, 2010, 2000, 1990, 1980, 1970, 1960, 1950];
  }, [albums]);
}

/** Suggestions for the value boxes: the library's artists, genres, labels and album types, and the Hub's tags. */
function RuleSuggestions() {
  const albums = useCatalog((s) => s.albums);
  const tags = useItemTags();
  const lists = useMemo(() => {
    const artists = new Set<string>();
    const labels = new Set<string>();
    const types = new Set<string>(['album', 'single', 'ep', 'compilation', 'live', 'soundtrack', 'remix']);
    for (const a of albums) {
      artists.add(a.artist);
      for (const l of a.labels ?? []) labels.add(l);
      for (const t of a.releaseTypes ?? []) types.add(t.toLowerCase());
    }
    const genres = genreCounts(albums).map((g) => g.name);
    const artistGenres = new Set([...(tags.values.genre ?? []).map((v) => v.name), ...genres]);
    return { artists: [...artists].sort(), labels: [...labels].sort(), types: [...types], genres, artistGenres: [...artistGenres] };
  }, [albums, tags.values]);
  const opts = (xs: string[]) => xs.slice(0, 2000).map((x) => <option key={x} value={x} />);
  return (
    <>
      <datalist id="rule-artists">{opts(lists.artists)}</datalist>
      <datalist id="rule-genres">{opts(lists.genres)}</datalist>
      <datalist id="rule-artist-genres">{opts(lists.artistGenres)}</datalist>
      <datalist id="rule-labels">{opts(lists.labels)}</datalist>
      <datalist id="rule-album-types">{opts(lists.types)}</datalist>
      <datalist id="rule-formats">{opts(['flac', 'mp3', 'm4a', 'aac', 'alac', 'opus', 'ogg', 'wav', 'dsf'])}</datalist>
      {(['style', 'mood', 'collection'] as const).map((f) => <datalist key={f} id={`tag-${f}s`}>{opts((tags.values[f] ?? []).map((v) => v.name))}</datalist>)}
    </>
  );
}
