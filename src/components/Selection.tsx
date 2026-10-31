import { useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Plex-style multi-select for album and artist grids (docs/USER-GUIDE.md "Selecting several albums or
 * artists"). Press Select, or the round tick on a card, or Ctrl/⌘- or Shift-click a card, to start. Then a
 * click ticks a card, Shift-click ticks every card between it and the last one ticked, and Done stops.
 *
 * The ticks keep the order they were made in, because the first one ticked matters: it's the one the others
 * merge into (src/lib/merge.ts), and its card says so.
 */
export function useSelection<T>(items: T[], keyOf: (x: T) => string) {
  const [order, setOrder] = useState<string[] | null>(null);
  const last = useRef<string | undefined>(undefined);
  const byKey = useMemo(() => new Map(items.map((x) => [keyOf(x), x])), [items]); // eslint-disable-line react-hooks/exhaustive-deps
  const picked = useMemo(() => new Set(order ?? []), [order]);
  // ticked and still on screen (a filter can hide some), in the order they were ticked
  const chosen = useMemo(() => (order ?? []).flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : [])), [order, byKey]);

  const pick = (x: T, e?: { shiftKey?: boolean }) => {
    const k = keyOf(x), from = last.current;
    last.current = k;
    setOrder((o) => {
      const cur = o ?? [];
      if (e?.shiftKey && from && from !== k) {
        const keys = items.map(keyOf);
        const a = keys.indexOf(from), b = keys.indexOf(k);
        if (a >= 0 && b >= 0) return [...cur, ...keys.slice(Math.min(a, b), Math.max(a, b) + 1).filter((r) => !cur.includes(r))];
      }
      return cur.includes(k) ? cur.filter((r) => r !== k) : [...cur, k];
    });
  };

  return {
    selecting: order !== null,
    chosen,
    /** Undefined when not selecting, so cards open as usual. */
    isPicked: (x: T) => (order ? picked.has(keyOf(x)) : undefined),
    /** "Merge target" on the first card ticked, once there's something to merge into it. */
    badge: (x: T) => (order && order.length > 1 && chosen[0] === x ? 'Merge target' : undefined),
    pick,
    /** A card was clicked: tick it while selecting; Ctrl/⌘- or Shift-click starts selecting. False = open it. */
    click: (x: T, e?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
      if (order || e?.ctrlKey || e?.metaKey || e?.shiftKey) {
        pick(x, order ? e : undefined);
        return true;
      }
      return false;
    },
    start: () => setOrder([]),
    stop: () => {
      last.current = undefined;
      setOrder(null);
    },
    /** Tick exactly these, in this order (Select all keeps the ones already ticked first). */
    set: (xs: T[]) => setOrder((o) => {
      const keep = (o ?? []).filter((k) => xs.some((x) => keyOf(x) === k));
      return [...keep, ...xs.map(keyOf).filter((k) => !keep.includes(k))];
    }),
    clear: () => setOrder([]),
  };
}

export type Selection<T> = ReturnType<typeof useSelection<T>>;

/** The bar over a grid while selecting: Select all, how many, who the merge target is, and the actions. */
export function SelectBar<T>({ sel, all, filtered, name, status, children }: {
  sel: Selection<T>;
  /** What Select all ticks: the cards on screen. */
  all: T[];
  filtered: boolean;
  /** The first ticked card's name, for the merge hint. */
  name: (x: T) => string;
  status?: string;
  children: ReactNode;
}) {
  const n = sel.chosen.length;
  return (
    <div className="row select-bar">
      <label className="check">
        <input type="checkbox" checked={all.length > 0 && n === all.length} onChange={(e) => (e.target.checked ? sel.set(all) : sel.clear())} />
        Select all{filtered ? ' matching' : ''}
      </label>
      <span className="muted small">
        {status ?? (n ? `${n} selected${n > 1 ? ` · merges into ${name(sel.chosen[0])}` : ''}` : 'Tap to select. Shift-click selects a range')}
      </span>
      <span className="grow" />
      {children}
    </div>
  );
}
