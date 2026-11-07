import type { HubClient, HubTags } from '../sources/hub';

/**
 * A big tag Save (Library care's "Fix 1550 titles", "Split all") sent to the Hub in small parts.
 *
 * The Hub rewrites each file with ffmpeg, which takes a moment per song. Sent as one request of a thousand
 * songs, the Save ran for minutes and the proxy in front of the Hub gave up with a 504 while the Hub kept going,
 * so the app never heard how far it got. In parts of PART songs each request is done in seconds, the app shows
 * real progress, a part that fails is tried once more (writing the same title again changes nothing), and all
 * the parts share one `batch` id so Settings → Server → Tag edits still undoes them as one Save.
 */

/** Songs per request: a few seconds of work for the Hub. */
export const PART = 25;

export interface SaveResult {
  /** the Save's id (several on a Hub too old to join the parts), for undo */
  batches: string[];
  changed: string[];
  failed: { path: string; error: string }[];
  /** why it stopped early, when a part failed twice; the songs after it weren't sent */
  error?: string;
}

const newBatch = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
const errText = (e: unknown) => String((e as Error)?.message ?? e);

export async function saveInParts(
  c: Pick<HubClient, 'saveTags'>,
  label: string,
  changes: { path: string; tags: HubTags }[],
  onProgress?: (done: number, total: number) => void,
): Promise<SaveResult> {
  const batch = newBatch();
  const out: SaveResult = { batches: [], changed: [], failed: [] };
  for (let i = 0; i < changes.length; i += PART) {
    onProgress?.(i, changes.length);
    const part = changes.slice(i, i + PART);
    let r;
    try {
      r = await c.saveTags(label, part, batch);
    } catch {
      try {
        r = await c.saveTags(label, part, batch);
      } catch (e) {
        out.error = errText(e);
        break;
      }
    }
    if (r.batch && !out.batches.includes(r.batch)) out.batches.push(r.batch);
    out.changed.push(...r.changed);
    out.failed.push(...r.failed);
  }
  onProgress?.(out.error ? out.changed.length : changes.length, changes.length);
  return out;
}
