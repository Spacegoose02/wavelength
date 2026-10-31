/** Item ids for Android Auto (lib/carBrowse.ts). */

/** `a:b:c` → ['a', 'b', 'c:…'] (ids from servers may contain colons). */
export function parseId(id: string): { kind: string; source?: string; rest: string } {
  const i = id.indexOf(':');
  if (i < 0) return { kind: id, rest: '' };
  const kind = id.slice(0, i);
  const after = id.slice(i + 1);
  if (kind === 'pl') return { kind, rest: after };
  const j = after.indexOf(':');
  return j < 0 ? { kind, rest: after } : { kind, source: after.slice(0, j), rest: after.slice(j + 1) };
}
