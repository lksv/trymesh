// A reader of a ZIP of stored files, for the tests only: a few lines of their own over the three
// records (.ZIP File Format Specification 6.3.10, 4.3.7, 4.3.12, 4.3.16), so `storedZip` is not
// read back by the code it tests. It checks that the central directory and the local headers agree
// and that every checksum is that of `node:zlib`, and throws on anything else.
import { crc32 } from 'node:zlib';

export interface ReadEntry {
  name: string;
  bytes: Uint8Array;
  flags: number;
  method: number;
  needed: number; // version needed to extract
  madeBy: number;
  time: number;
  date: number;
  offset: number;
}

export function readZip(zip: Uint8Array): ReadEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const fail = (what: string): never => {
    throw new Error(`not a ZIP of stored files: ${what}`);
  };
  const end = zip.length - 22;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) fail('no end record without a comment at the end');
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) fail('more than one disk');
  const count = view.getUint16(end + 8, true);
  if (view.getUint16(end + 10, true) !== count) fail('the counts of entries differ');
  const size = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  if (start + size !== end) fail('the directory does not end where the end record starts');
  if (view.getUint16(end + 20, true) !== 0) fail('a comment');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries: ReadEntry[] = [];
  let at = start;
  let files = 0; // where the next local header has to be
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) fail(`no central header ${i}`);
    const madeBy = view.getUint16(at + 4, true);
    const needed = view.getUint16(at + 6, true);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const time = view.getUint16(at + 12, true);
    const date = view.getUint16(at + 14, true);
    const crc = view.getUint32(at + 16, true);
    const compressed = view.getUint32(at + 20, true);
    const length = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    if (view.getUint16(at + 30, true) || view.getUint16(at + 32, true) || view.getUint16(at + 34, true) || view.getUint16(at + 36, true) || view.getUint32(at + 38, true)) fail(`an extra field, a comment, a disk or attributes in entry ${i}`);
    const offset = view.getUint32(at + 42, true);
    const nameBytes = zip.slice(at + 46, at + 46 + nameLength);
    at += 46 + nameLength;
    if (method !== 0 || compressed !== length) fail(`entry ${i} is not stored`);
    if (offset !== files) fail(`entry ${i} is not where the one before it ends`);
    // the local header says the same
    if (view.getUint32(offset, true) !== 0x04034b50) fail(`no local header ${i}`);
    const local = [4, 6, 8, 10, 12].map((k) => view.getUint16(offset + k, true));
    if (local.join() !== [needed, flags, method, time, date].join()) fail(`the local header ${i} differs`);
    if (view.getUint32(offset + 14, true) !== crc || view.getUint32(offset + 18, true) !== length || view.getUint32(offset + 22, true) !== length) fail(`the sizes or the checksum of ${i} differ`);
    if (view.getUint16(offset + 26, true) !== nameLength || view.getUint16(offset + 28, true) !== 0) fail(`the name of ${i} differs`);
    if (zip.slice(offset + 30, offset + 30 + nameLength).join() !== nameBytes.join()) fail(`the name of ${i} differs`);
    const bytes = zip.slice(offset + 30 + nameLength, offset + 30 + nameLength + length);
    if (crc32(bytes) !== crc) fail(`the checksum of ${i}`);
    files = offset + 30 + nameLength + length;
    const ascii = nameBytes.every((byte) => byte < 0x80);
    if ((flags & 0x0800) === 0 && !ascii) fail(`the name of ${i} is not ASCII and not flagged as UTF-8`);
    entries.push({ name: decoder.decode(nameBytes), bytes, flags, method, needed, madeBy, time, date, offset });
  }
  if (files !== start) fail('the directory does not follow the last file');
  return entries;
}
