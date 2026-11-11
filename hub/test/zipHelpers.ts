import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';
import { readZip } from '../src/zipSplit.ts';

/** A plain zip (deflated members, no data descriptors), the way adm-zip writes SUB/WAVE's backups. */
export function makeZip(files: Record<string, Buffer | string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, raw] of Object.entries(files)) {
    const data = Buffer.from(raw);
    const comp = deflateRawSync(data);
    const n = Buffer.from(name);
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(offset, 42);
    const local = Buffer.concat([lh, n, comp]);
    locals.push(local);
    centrals.push(Buffer.concat([ch, n]));
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length, 8);
  end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Each member's name and unpacked contents, read back through the central directory. */
export function unzip(zip: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of readZip(zip)) {
    const nameLen = m.local.readUInt16LE(26);
    const extraLen = m.local.readUInt16LE(28);
    const size = m.central.readUInt32LE(20);
    const data = m.local.subarray(30 + nameLen + extraLen, 30 + nameLen + extraLen + size);
    out[m.name] = (m.local.readUInt16LE(8) === 8 ? inflateRawSync(data) : data).toString();
  }
  return out;
}
