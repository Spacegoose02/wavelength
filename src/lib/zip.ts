/**
 * Read files out of a .zip in the app, without a library: the central directory says where each file is, and the
 * browser's DecompressionStream inflates it. Enough for Spotify's data export and Exportify's "export all"
 * (lib/spotifyExport.ts): no encryption, no ZIP64, files stored or deflated.
 */

export interface ZipEntry {
  name: string;
  size: number;
  /** The file's bytes as text (UTF-8). */
  text(): Promise<string>;
}

const u16 = (v: DataView, at: number) => v.getUint16(at, true);
const u32 = (v: DataView, at: number) => v.getUint32(at, true);
const view = async (blob: Blob, from: number, to: number) => new DataView(await blob.slice(from, to).arrayBuffer());

export async function isZip(blob: Blob): Promise<boolean> {
  if (blob.size < 22) return false;
  const v = await view(blob, 0, 4);
  return u32(v, 0) === 0x04034b50 || u32(v, 0) === 0x06054b50;
}

/** The files in a zip (folders left out), each read only when asked. */
export async function readZip(blob: Blob): Promise<ZipEntry[]> {
  // the end record is in the last 22 bytes plus up to 64 KB of comment
  const tailFrom = Math.max(0, blob.size - 22 - 0xffff);
  const tail = await view(blob, tailFrom, blob.size);
  let end = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (u32(tail, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('That isn’t a zip file, or it’s damaged');
  const count = u16(tail, end + 10);
  const dirSize = u32(tail, end + 12);
  const dirAt = u32(tail, end + 16);
  if (dirAt === 0xffffffff || count === 0xffff) throw new Error('That zip is too big to read here. Unzip it and choose the files inside instead');
  const dir = await view(blob, dirAt, dirAt + dirSize);
  const decoder = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let p = 0, n = 0; n < count && p + 46 <= dir.byteLength; n++) {
    if (u32(dir, p) !== 0x02014b50) throw new Error('That zip is damaged');
    const flags = u16(dir, p + 8);
    const method = u16(dir, p + 10);
    const packed = u32(dir, p + 20);
    const size = u32(dir, p + 24);
    const nameLen = u16(dir, p + 28);
    const extraLen = u16(dir, p + 30);
    const commentLen = u16(dir, p + 32);
    const local = u32(dir, p + 42);
    const name = decoder.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || flags & 1) continue; // a folder, or encrypted
    out.push({
      name,
      size,
      async text() {
        const head = await view(blob, local, local + 30);
        const start = local + 30 + u16(head, 26) + u16(head, 28);
        const data = blob.slice(start, start + packed);
        if (method === 0) return data.text();
        if (method !== 8) throw new Error(`${name} is packed in a way Wavelength can’t read`);
        const stream = data.stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Response(stream).text();
      },
    });
  }
  return out;
}
