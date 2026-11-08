/** A small "Sort: …" dropdown for a page header (Audiobooks, Podcasts, a show's episodes). */
export function SortSelect<T extends string>({ value, options, onChange, label = 'Sort' }: {
  value: T;
  options: [T, string][];
  onChange(v: T): void;
  label?: string;
}) {
  return (
    <label className="sort-select">
      <span className="muted small">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={label}>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  );
}
