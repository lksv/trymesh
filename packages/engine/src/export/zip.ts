// A ZIP that is not compressed (D54): the container of 3MF, and what the app saves a set of files
// of an export as. No library: every file is stored (.ZIP File Format Specification 6.3.10,
// PKWARE, 4.4.5: method 0), and the archive is three kinds of records and a checksum.
//
// - A local file header (4.3.7) and the bytes of the file (4.3.8) for every entry in the order
//   given; then a central directory header (4.3.12) per entry in the same order; then the end of
//   central directory record (4.3.16). All numbers little-endian (4.4.1.1).
// - Version needed to extract and version made by 10: 1.0, MS-DOS attributes (4.4.2, 4.4.3.2).
// - General purpose bit flag 0, or bit 11 for a name that is not ASCII: the name is UTF-8
//   (4.4.4, appendix D).
// - Time 0 and date 0x0021: 1 January 1980, 0:00:00 (4.4.6, MS-DOS format: day in bits 0 to 4,
//   month in 5 to 8, years since 1980 in 9 to 15). The engine has no clock: the same files give
//   the same bytes.
// - CRC-32 with the polynomial 0xedb88320, preset to all ones and complemented (4.4.7; RFC 1952,
//   section 8).
// - No extra field, no comment, no data descriptor, one disk, attributes 0.
// - No ZIP64. A ZIP64 archive marks a field that is too small with 0xFFFF or 0xFFFFFFFF
//   (4.4.1.4). The writer keeps clear of those values, a policy stricter than the format, and
//   refuses (`QueryFailure('failed')`, before anything is laid out) 65 535 entries or more, an
//   entry of 0xFFFFFFFF bytes or more, files that with their local headers reach 0xFFFFFFFF bytes
//   (the offset of the directory), a directory of that size, and a name longer than
//   `ZIP_NAME_LIMIT` bytes.
import { QueryFailure } from '../query/spec';

export interface ZipEntry {
  // Relative, with forward slashes, no leading slash (4.4.17.1); the paths of `ExportFile` have
  // this form. At most `ZIP_NAME_LIMIT` bytes as UTF-8.
  name: string;
  bytes: Uint8Array;
}

// The longest name of an entry in bytes of UTF-8: "the combined length of any directory record and
// these three fields SHOULD NOT generally exceed 65,535 bytes" (4.4.10 to 4.4.12: the name, the
// extra field and the comment; the last two are empty here), and a central header is 46 bytes
// before its name.
export const ZIP_NAME_LIMIT = 0xffff - 46; // 65 489
const MOST_ENTRIES = 0xffff; // refused from here on
const MOST_BYTES = 0xffffffff; // refused from here on

const LOCAL = 30; // bytes of a local file header before its name
const CENTRAL = 46; // bytes of a central directory header before its name
const END = 22; // bytes of the end record without a comment
const VERSION = 10; // 1.0
const DOS_DATE = (1 << 5) | 1; // year 1980 + 0, month 1, day 1

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const tooLarge = (what: string): never => {
  throw new QueryFailure('failed', `the files do not fit a ZIP without ZIP64: ${what}`);
};

export function storedZip(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length >= MOST_ENTRIES) tooLarge(`${entries.length} files, the most is ${MOST_ENTRIES - 1}`);
  const encoder = new TextEncoder();
  let [files, directory] = [0, 0];
  const items = entries.map((entry) => {
    const name = encoder.encode(entry.name);
    if (name.length > ZIP_NAME_LIMIT) tooLarge(`the name "${entry.name.slice(0, 40)}…" has ${name.length} bytes, the most is ${ZIP_NAME_LIMIT}`);
    if (entry.bytes.length >= MOST_BYTES) tooLarge(`"${entry.name}" has 4 GiB or more`);
    files += LOCAL + name.length + entry.bytes.length;
    directory += CENTRAL + name.length;
    return { name, flags: /^[\x00-\x7f]*$/.test(entry.name) ? 0 : 0x0800, bytes: entry.bytes, offset: 0 };
  });
  if (files >= MOST_BYTES || directory >= MOST_BYTES) tooLarge('the files have 4 GiB or more together');
  const out = new Uint8Array(files + directory + END);
  const view = new DataView(out.buffer);
  let at = 0;
  const crcs = items.map((item) => crc32(item.bytes));
  items.forEach((item, i) => {
    item.offset = at;
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, VERSION, true); // version needed to extract
    view.setUint16(at + 6, item.flags, true);
    view.setUint16(at + 8, 0, true); // stored
    view.setUint16(at + 10, 0, true); // time
    view.setUint16(at + 12, DOS_DATE, true);
    view.setUint32(at + 14, crcs[i], true);
    view.setUint32(at + 18, item.bytes.length, true); // compressed size
    view.setUint32(at + 22, item.bytes.length, true); // uncompressed size
    view.setUint16(at + 26, item.name.length, true);
    view.setUint16(at + 28, 0, true); // extra field
    out.set(item.name, at + LOCAL);
    out.set(item.bytes, at + LOCAL + item.name.length);
    at += LOCAL + item.name.length + item.bytes.length;
  });
  const start = at;
  items.forEach((item, i) => {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, VERSION, true); // version made by: 1.0, MS-DOS
    view.setUint16(at + 6, VERSION, true); // version needed to extract
    view.setUint16(at + 8, item.flags, true);
    view.setUint16(at + 10, 0, true); // stored
    view.setUint16(at + 12, 0, true); // time
    view.setUint16(at + 14, DOS_DATE, true);
    view.setUint32(at + 16, crcs[i], true);
    view.setUint32(at + 20, item.bytes.length, true);
    view.setUint32(at + 24, item.bytes.length, true);
    view.setUint16(at + 28, item.name.length, true);
    // extra field, comment, disk, internal and external attributes: 0 (the buffer is zeroed)
    view.setUint32(at + 42, item.offset, true);
    out.set(item.name, at + CENTRAL);
    at += CENTRAL + item.name.length;
  });
  view.setUint32(at, 0x06054b50, true);
  // number of this disk and of the disk with the directory: 0
  view.setUint16(at + 8, items.length, true);
  view.setUint16(at + 10, items.length, true);
  view.setUint32(at + 12, at - start, true);
  view.setUint32(at + 16, start, true);
  // comment length: 0
  return out;
}
