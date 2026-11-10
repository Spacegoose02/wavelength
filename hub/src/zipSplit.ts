/**
 * Just enough of the zip format to split one archive into several smaller ones without unpacking anything: each
 * member's bytes (local header, data, and any data descriptor) are copied as they are, and a new central directory
 * is written for each part. Used to send a SUB/WAVE backup that's too big for one upload in pieces
 * (`subwaveCopyStation` in upstream.ts). No zip64: SUB/WAVE's backups are far under 4 GB.
 */

export interface ZipMember {
  name: string;
  /** The member as stored: local header through the end of its data (and data descriptor). */
  local: Buffer;
  /** Its central directory record, with the local header offset still the old one. */
  central: Buffer;
}

const EOCD = 0x06054b50;
const CEN = 0x02014b50;

export function readZip(zip: Buffer): ZipMember[] {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = zip.readUInt16LE(eocd + 10);
  const cdOffset = zip.readUInt32LE(eocd + 16);
  const rows: { name: string; offset: number; central: Buffer }[] = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== CEN) throw new Error('broken zip directory');
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const size = 46 + nameLen + extraLen + commentLen;
    rows.push({ name: zip.toString('utf8', p + 46, p + 46 + nameLen), offset: zip.readUInt32LE(p + 42), central: zip.subarray(p, p + size) });
    p += size;
  }
  // a member runs from its local header to the next member's (or the directory)
  const starts = [...rows.map((r) => r.offset), cdOffset].sort((a, b) => a - b);
  return rows.map((r) => {
    const end = starts.find((s) => s > r.offset) ?? cdOffset;
    return { name: r.name, local: zip.subarray(r.offset, end), central: r.central };
  });
}

export function writeZip(members: ZipMember[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const m of members) {
    const c = Buffer.from(m.central);
    c.writeUInt32LE(offset, 42);
    centrals.push(c);
    locals.push(m.local);
    offset += m.local.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0);
  end.writeUInt16LE(members.length, 8);
  end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Members packed in order into groups of at most `budget` bytes (a bigger member gets a group of its own). */
export function pack(members: ZipMember[], budget: number): ZipMember[][] {
  const groups: ZipMember[][] = [];
  let cur: ZipMember[] = [];
  let size = 0;
  for (const m of members) {
    if (cur.length && size + m.local.length > budget) {
      groups.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(m);
    size += m.local.length;
  }
  if (cur.length) groups.push(cur);
  return groups;
}
