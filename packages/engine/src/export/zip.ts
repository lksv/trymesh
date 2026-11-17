// The ZIP of the engine (D54): the container of 3MF, and what the app saves a set of files of an
// export as. The engine writes the archive itself (.ZIP File Format Specification 6.3.10, PKWARE):
// three kinds of records and a checksum. An entry is stored (4.4.5: method 0), or deflated
// (method 8) when the caller gives a compressor, the port `Deflater`: the one thing of a ZIP the
// engine does not do itself.
//
// - A local file header (4.3.7) and the bytes of the file (4.3.8), or its stream, for every entry
//   in the order given; then a central directory header (4.3.12) per entry in the same order; then
//   the end of central directory record (4.3.16). All numbers little-endian (4.4.1.1).
// - Which entry is deflated: one that has bytes, when a compressor is given and its stream is
//   shorter than the bytes. Every other entry is stored. So the writer never makes a file larger,
//   and without a compressor it writes the bytes it wrote before it had one. An entry with no
//   bytes is not given to the compressor (4.3.8: such an entry "MUST NOT include file data").
// - A stored entry: version needed to extract and version made by 10, 1.0 with MS-DOS attributes
//   (4.4.2, 4.4.3.2). A deflated one: both 20, 2.0 (4.4.3.2: "File is compressed using Deflate
//   compression"), the bits 1 and 2 of its flag 0 ("normal" compression, 4.4.4), the length of the
//   stream as its compressed size. The version made by is that of the entry, also when both kinds
//   are in one archive: a stored entry is the same bytes whatever else is in the archive (4.4.2.3
//   reads as one value for the writer; the readers take it, deflate.md, "Measured").
// - General purpose bit flag 0, or bit 11 for a name that is not ASCII: the name is UTF-8
//   (4.4.4, appendix D).
// - Time 0 and date 0x0021: 1 January 1980, 0:00:00 (4.4.6, MS-DOS format: day in bits 0 to 4,
//   month in 5 to 8, years since 1980 in 9 to 15). The engine has no clock: the same files give
//   the same bytes.
// - CRC-32 of the bytes of the file, not of the stream (4.4.7), with the polynomial 0xedb88320,
//   preset to all ones and complemented (RFC 1952, section 8).
// - No extra field, no comment, no data descriptor, one disk, attributes 0.
// - No ZIP64. A ZIP64 archive marks a field that is too small with 0xFFFF or 0xFFFFFFFF
//   (4.4.1.4). The writer keeps clear of those values, a policy stricter than the format, and
//   refuses (`QueryFailure('failed')`) 65 535 entries or more, an entry of 0xFFFFFFFF bytes or
//   more and a name longer than `ZIP_NAME_LIMIT` bytes before anything is compressed; and files
//   that with their local headers reach 0xFFFFFFFF bytes as written (the offset of the directory)
//   and a directory of that size after, before anything is laid out.
// - A compressor that throws, or answers with something that is not a `Uint8Array`, is
//   `QueryFailure('failed')`. Nothing checks that its stream inflates back (deflate.md, "Known
//   limits"): the port guarantees it.
import { QueryFailure } from '../query/spec';
import type { Deflater } from '../types';

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
const ENTRY = {
  stored: { method: 0, version: 10 }, // 1.0
  deflated: { method: 8, version: 20 }, // 2.0
} as const;
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

// What the compressor gives for the bytes of one entry, or the refusal it becomes.
function deflated(deflater: Deflater, bytes: Uint8Array): Uint8Array {
  let stream: unknown;
  try {
    stream = deflater.deflate(bytes);
  } catch (error) {
    throw new QueryFailure('failed', `the compressor failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!(stream instanceof Uint8Array)) throw new QueryFailure('failed', `the compressor failed: it answered with ${typeof stream} where bytes are expected`);
  return stream;
}

export function zip(entries: readonly ZipEntry[], deflater?: Deflater): Uint8Array {
  if (entries.length >= MOST_ENTRIES) tooLarge(`${entries.length} files, the most is ${MOST_ENTRIES - 1}`);
  const encoder = new TextEncoder();
  const named = entries.map((entry) => {
    const name = encoder.encode(entry.name);
    if (name.length > ZIP_NAME_LIMIT) tooLarge(`the name "${entry.name.slice(0, 40)}…" has ${name.length} bytes, the most is ${ZIP_NAME_LIMIT}`);
    if (entry.bytes.length >= MOST_BYTES) tooLarge(`"${entry.name}" has 4 GiB or more`);
    return { name, entry };
  });
  let [files, directory] = [0, 0];
  const items = named.map(({ name, entry }) => {
    const stream = deflater && entry.bytes.length > 0 ? deflated(deflater, entry.bytes) : undefined;
    const shorter = stream !== undefined && stream.length < entry.bytes.length;
    const data = shorter ? stream : entry.bytes;
    files += LOCAL + name.length + data.length;
    directory += CENTRAL + name.length;
    return { name, flags: /^[\x00-\x7f]*$/.test(entry.name) ? 0 : 0x0800, kind: shorter ? ENTRY.deflated : ENTRY.stored, bytes: entry.bytes, data, offset: 0 };
  });
  if (files >= MOST_BYTES || directory >= MOST_BYTES) tooLarge('the files have 4 GiB or more together');
  const out = new Uint8Array(files + directory + END);
  const view = new DataView(out.buffer);
  let at = 0;
  const crcs = items.map((item) => crc32(item.bytes)); // of the bytes, not of the stream
  items.forEach((item, i) => {
    item.offset = at;
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, item.kind.version, true); // version needed to extract
    view.setUint16(at + 6, item.flags, true);
    view.setUint16(at + 8, item.kind.method, true);
    view.setUint16(at + 10, 0, true); // time
    view.setUint16(at + 12, DOS_DATE, true);
    view.setUint32(at + 14, crcs[i], true);
    view.setUint32(at + 18, item.data.length, true); // compressed size
    view.setUint32(at + 22, item.bytes.length, true); // uncompressed size
    view.setUint16(at + 26, item.name.length, true);
    view.setUint16(at + 28, 0, true); // extra field
    out.set(item.name, at + LOCAL);
    out.set(item.data, at + LOCAL + item.name.length);
    at += LOCAL + item.name.length + item.data.length;
  });
  const start = at;
  items.forEach((item, i) => {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, item.kind.version, true); // version made by: that of the entry, MS-DOS
    view.setUint16(at + 6, item.kind.version, true); // version needed to extract
    view.setUint16(at + 8, item.flags, true);
    view.setUint16(at + 10, item.kind.method, true);
    view.setUint16(at + 12, 0, true); // time
    view.setUint16(at + 14, DOS_DATE, true);
    view.setUint32(at + 16, crcs[i], true);
    view.setUint32(at + 20, item.data.length, true);
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
