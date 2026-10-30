/**
 * ICY ("Shoutcast") in-stream metadata: the song title most internet radio stations send inside the audio
 * stream itself. Ask for it with the `Icy-MetaData: 1` request header; the station answers with an
 * `icy-metaint: N` header, and then every N bytes of audio comes one length byte L followed by L×16 bytes of
 * text such as `StreamTitle='Artist - Title';StreamUrl='';`, padded with NULs.
 *
 * No imports, so the Hub's tests can check that this and hub/src/radio.ts read the same bytes the same way.
 */

/** Largest `icy-metaint` we'll skip over (stations use 8–32 KB; anything huge isn't worth the download). */
export const MAX_METAINT = 256 * 1024;

/** The `StreamTitle` in one metadata block, '' when the station sent it empty, undefined when there is none. */
export function parseIcyMetadata(bytes: Uint8Array): string | undefined {
  const text = decode(bytes).replace(/\0+$/, '');
  // Titles can hold an apostrophe ("Don't Stop"), so the closing quote is the one followed by `;` and then
  // another `Key=` or the end.
  const m = /StreamTitle='([\s\S]*?)';(?=\s*(?:[A-Za-z]+=|$))/.exec(text) ?? /StreamTitle='([\s\S]*?)'?;?\s*$/.exec(text);
  if (!m) return undefined;
  return cleanIcyTitle(m[1]);
}

/** Trim a station's title and drop the placeholders some send between songs ("-", " - ", "Unknown"). */
export function cleanIcyTitle(raw: string): string {
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!/[\p{L}\p{N}]/u.test(t)) return '';
  if (/^(unknown|unknown - unknown|n\/a|null|undefined)$/i.test(t)) return '';
  return t;
}

/** UTF-8 when it decodes cleanly, else Latin-1 (what older Shoutcast servers send). */
function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}

/**
 * Read the first metadata block from a stream that was asked for ICY metadata. `undefined` when the station
 * doesn't send in-stream titles at all (no or silly `icy-metaint`), else the title ('' while it's empty).
 * Reads at most metaint + 4 KB, then cancels the stream.
 */
export async function readIcyTitle(metaintHeader: string | null, body: ReadableStream<Uint8Array> | null): Promise<string | undefined> {
  const metaint = Number(metaintHeader);
  if (!body || !Number.isInteger(metaint) || metaint <= 0 || metaint > MAX_METAINT) {
    await body?.cancel().catch(() => undefined);
    return undefined;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let have = 0;
  const need = async (n: number) => {
    while (have < n) {
      const { done, value } = await reader.read();
      if (done) throw new Error('Stream ended before its first title');
      chunks.push(value);
      have += value.length;
    }
  };
  try {
    await need(metaint + 1);
    const all = concat(chunks, have);
    const len = all[metaint] * 16;
    if (len === 0) return '';
    await need(metaint + 1 + len);
    return parseIcyMetadata(concat(chunks, have).subarray(metaint + 1, metaint + 1 + len)) ?? '';
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

function concat(chunks: Uint8Array[], size: number) {
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  chunks.splice(0, chunks.length, out);
  return out;
}
