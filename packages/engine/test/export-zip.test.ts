// The ZIP of the engine and the numbers and texts of a file (D54): the parts the formats of 2g are
// built from, read back by a reader of the test (zip-reader.ts) and checked against `node:zlib`.
// The compressors here are doubles: `node:zlib` where any valid stream does (no test compares
// with what it writes: a Node as distributed carries another zlib than the system's), a table
// of one known stream, and compressors that fail. The library of the app and the server is tested
// in packages/deflate-pako.
import { createHash } from 'node:crypto';
import { deflateRawSync, crc32 as zlibCrc } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decimals, float32Text, plain, xmlText } from '../src/export/text';
import { ZIP_NAME_LIMIT, crc32, zip } from '../src/export/zip';
import { QueryFailure } from '../src/query/spec';
import type { Deflater } from '../src/types';
import { readZip } from './zip-reader';

const bytes = (text: string) => new TextEncoder().encode(text);
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
// The three files of the first test below, and their archive as `storedZip` of master (8367ccc)
// wrote it, by its length and SHA-256: captured before the writer got its compressor.
const threeFiles = () => [
  { name: '[Content_Types].xml', bytes: bytes('<Types/>') },
  { name: 'folder/empty.txt', bytes: new Uint8Array() },
  { name: 'díl/šroub.stl', bytes: Uint8Array.from({ length: 300 }, (_, i) => i & 0xff) },
];
const STORED_THREE_FILES = [658, '1a1395cc97aa5c2d4cc80587f2430b4cea55d1d21d61e86bb1a9ab86abc67a3a'];
const failure = (run: () => unknown): [string, string] | undefined => {
  try {
    run();
  } catch (error) {
    if (error instanceof QueryFailure) return [error.code, error.message];
    throw error;
  }
  return undefined;
};

describe('a ZIP without a compressor: every entry stored', () => {
  it('the checksum is CRC-32 as zlib has it', () => {
    expect(crc32(bytes('123456789')).toString(16)).toBe('cbf43926'); // the check value of the polynomial
    expect(crc32(new Uint8Array())).toBe(0);
    const random = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7919 + ((i * i) % 251)) & 0xff);
    for (const length of [1, 2, 3, 255, 256, 4999, 5000]) expect(crc32(random.slice(0, length))).toBe(zlibCrc(random.slice(0, length)));
  });

  it('three files read back: names, sizes, offsets, the stored bytes, the version, the date, the flag of a name that is not ASCII', () => {
    const entries = threeFiles();
    const archive = zip(entries);
    const read = readZip(archive);
    expect(read.map((entry) => entry.name)).toEqual(entries.map((entry) => entry.name));
    read.forEach((entry, i) => {
      expect(entry.bytes).toEqual(entries[i].bytes);
      expect([entry.method, entry.needed, entry.madeBy, entry.time, entry.date]).toEqual([0, 10, 10, 0, 0x21]); // stored, 1.0, MS-DOS, 1 January 1980
    });
    expect(read.map((entry) => entry.flags)).toEqual([0, 0, 0x0800]);
    // the offsets: each local header right after the file before it
    const names = entries.map((entry) => new TextEncoder().encode(entry.name).length);
    expect(read.map((entry) => entry.offset)).toEqual([0, 30 + names[0] + 8, 30 + names[0] + 8 + 30 + names[1]]);
    const files = names.reduce((sum, name, i) => sum + 30 + name + entries[i].bytes.length, 0);
    expect(archive.length).toBe(files + names.reduce((sum, name) => sum + 46 + name, 0) + 22);
    // the same files give the same bytes
    expect(zip(entries)).toEqual(archive);
    // and the bytes `storedZip` of master (8367ccc) wrote for them, before the compressor came
    expect([archive.length, sha256(archive)]).toEqual(STORED_THREE_FILES);
  });

  it('an archive with nothing in it is the end record alone', () => {
    const archive = zip([]);
    expect(archive.length).toBe(22);
    expect(readZip(archive)).toEqual([]);
  });

  it('the edges: a name of 65 489 bytes passes and one more byte is refused, counted in bytes of UTF-8', () => {
    expect(ZIP_NAME_LIMIT).toBe(65489);
    const longest = zip([{ name: 'n'.repeat(ZIP_NAME_LIMIT), bytes: bytes('x') }]);
    expect(readZip(longest)[0].name.length).toBe(ZIP_NAME_LIMIT);
    expect(failure(() => zip([{ name: 'n'.repeat(ZIP_NAME_LIMIT + 1), bytes: bytes('x') }]))?.[0]).toBe('failed');
    // two bytes a letter: 32 744 letters are 65 488 bytes, one more is 65 490
    expect(failure(() => zip([{ name: 'é'.repeat(32744), bytes: bytes('x') }]))).toBeUndefined();
    expect(failure(() => zip([{ name: 'é'.repeat(32745), bytes: bytes('x') }]))).toEqual(['failed', expect.stringMatching(/^the files do not fit a ZIP without ZIP64: the name ".*" has 65490 bytes, the most is 65489$/)]);
  });

  it('the edges: 65 534 entries pass and 65 535 are refused', () => {
    const one = new Uint8Array([1]);
    const most = Array.from({ length: 65534 }, (_, i) => ({ name: `f${i}`, bytes: one }));
    const archive = zip(most);
    const read = readZip(archive);
    expect(read.length).toBe(65534);
    expect(read[65533].name).toBe('f65533');
    expect(failure(() => zip([...most, { name: 'last', bytes: one }]))).toEqual(['failed', 'the files do not fit a ZIP without ZIP64: 65535 files, the most is 65534']);
  });

  it('the edges of 4 GiB, by the arithmetic: an entry that claims that size is refused before anything is laid out', () => {
    const huge = { name: 'big', bytes: { length: 0xffffffff } as unknown as Uint8Array };
    expect(failure(() => zip([huge]))).toEqual(['failed', 'the files do not fit a ZIP without ZIP64: "big" has 4 GiB or more']);
    // files that together, with their local headers, reach 4 GiB
    const half = { name: 'half', bytes: { length: 0x7fffffff } as unknown as Uint8Array };
    expect(failure(() => zip([half, { ...half, name: 'other' }]))).toEqual(['failed', 'the files do not fit a ZIP without ZIP64: the files have 4 GiB or more together']);
  });
});

// A compressor over `node:zlib` that counts its calls and keeps what it was given.
const byNodeZlib = () => {
  const given: Uint8Array[] = [];
  const deflater: Deflater = {
    deflate: (input) => {
      given.push(input);
      return new Uint8Array(deflateRawSync(input));
    },
  };
  return { deflater, given };
};
// Forty letters `a` and their stream as zlib writes it at level 6: the one stream the table knows.
const FORTY = bytes('a'.repeat(40));
const FORTY_STREAM = [0x4b, 0x4c, 0x24, 0x0e, 0x00, 0x00];
const fromATable: Deflater = { deflate: () => new Uint8Array(FORTY_STREAM) };
// Bytes that do not compress: a generator of the test, not `Math.random`, so a run is repeatable.
const noise = (length: number, seed = 1): Uint8Array => {
  let state = seed;
  return Uint8Array.from({ length }, () => {
    state = (state * 1103515245 + 12345) >>> 0;
    return state >>> 24;
  });
};

describe('a ZIP with a compressor: an entry deflated when its stream is shorter', () => {
  it('the three files: the one that compresses is deflated and reads back, the empty one is stored, a name that is not ASCII keeps its flag', () => {
    const { deflater, given } = byNodeZlib();
    const entries = threeFiles();
    const archive = zip(entries, deflater);
    const read = readZip(archive);
    expect(read.map((entry) => entry.name)).toEqual(entries.map((entry) => entry.name));
    read.forEach((entry, i) => expect(entry.bytes).toEqual(entries[i].bytes));
    // `<Types/>` deflates to 10 bytes, longer than its 8: stored. The 300 bytes count up: deflated
    expect(read.map((entry) => [entry.method, entry.needed, entry.madeBy, entry.flags])).toEqual([
      [0, 10, 10, 0],
      [0, 10, 10, 0],
      [8, 20, 20, 0x0800],
    ]);
    expect(read[2].compressed).toBeLessThan(300);
    expect(read.every((entry) => entry.time === 0 && entry.date === 0x21)).toBe(true);
    // an entry with no bytes is not given to the compressor
    expect(given.map((input) => input.length)).toEqual([8, 300]);
    // the offsets follow what is written
    expect(read[2].offset).toBe(30 + 19 + 8 + 30 + 16);
    // the same call twice gives the same bytes
    expect(zip(entries, deflater)).toEqual(archive);
    // the input is not changed
    expect(entries.map((entry) => entry.bytes)).toEqual(threeFiles().map((entry) => entry.bytes));
  });

  it('the records of a deflated entry, to the byte: forty letters from a table, 114 bytes', () => {
    const archive = zip([{ name: 'a.txt', bytes: FORTY }], fromATable);
    const crc = [0x25, 0x8a, 0x5b, 0xc9]; // CRC-32 of the forty letters, 0xc95b8a25: of the bytes, not of the stream
    const name = [...bytes('a.txt')];
    expect([...archive]).toEqual([
      // local file header: signature, needed 20, flag 0, method 8, time 0, date 1980-01-01, CRC, sizes 6 and 40, name 5, extra 0
      ...[0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 8, 0, 0, 0, 0x21, 0, ...crc, 6, 0, 0, 0, 40, 0, 0, 0, 5, 0, 0, 0],
      ...name,
      ...FORTY_STREAM,
      // central directory header: made by 20, needed 20, flag, method, time, date, CRC, sizes, name, extra, comment, disk, attributes, offset 0
      ...[0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0, 8, 0, 0, 0, 0x21, 0, ...crc, 6, 0, 0, 0, 40, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ...name,
      // end record: one entry, a directory of 51 bytes at 41
      ...[0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 1, 0, 1, 0, 51, 0, 0, 0, 41, 0, 0, 0, 0, 0],
    ]);
    expect(archive.length).toBe(114);
    expect(readZip(archive)[0].bytes).toEqual(FORTY); // `node:zlib` inflates the stream of the table
  });

  it('a stored and a deflated entry side by side: versions 10 and 20, each as it would be alone', () => {
    const { deflater } = byNodeZlib();
    const random = noise(4096);
    expect(deflateRawSync(random).length).toBeGreaterThanOrEqual(random.length); // the case: noise that does not compress
    const archive = zip([{ name: 'noise.bin', bytes: random }, { name: 'a.txt', bytes: FORTY }], deflater);
    const read = readZip(archive);
    expect(read.map((entry) => [entry.method, entry.needed, entry.madeBy, entry.compressed])).toEqual([
      [0, 10, 10, 4096],
      [8, 20, 20, read[1].compressed],
    ]);
    expect(read.map((entry) => entry.bytes)).toEqual([random, FORTY]);
    // the stored entry is the bytes it is without a compressor: its local header, data and central header
    const alone = zip([{ name: 'noise.bin', bytes: random }]);
    const local = 30 + 9 + 4096;
    expect(archive.slice(0, local)).toEqual(alone.slice(0, local));
    const start = archive.length - 22 - (46 + 9) - (46 + 5);
    expect(archive.slice(start, start + 46 + 9)).toEqual(alone.slice(local, local + 46 + 9));
  });

  it('a stream that is not shorter than the bytes is not written: longer, or exactly as long', () => {
    const same: Deflater = { deflate: (input) => new Uint8Array(input.length) };
    const longer: Deflater = { deflate: (input) => new Uint8Array(input.length + 1) };
    for (const deflater of [same, longer]) {
      const read = readZip(zip([{ name: 'a.txt', bytes: FORTY }], deflater));
      expect([read[0].method, read[0].compressed]).toEqual([0, 40]);
      expect(zip([{ name: 'a.txt', bytes: FORTY }], deflater)).toEqual(zip([{ name: 'a.txt', bytes: FORTY }]));
    }
    // the bytes of master for the three files, whatever such a compressor answers
    expect(sha256(zip(threeFiles(), longer))).toBe(STORED_THREE_FILES[1]);
  });

  it('a compressor that fails: an Error, a thrown text, an answer that is not bytes', () => {
    const throwsError: Deflater = {
      deflate: () => {
        throw new Error('out of memory');
      },
    };
    const throwsText: Deflater = {
      deflate: () => {
        throw 'no';
      },
    };
    const notBytes = { deflate: () => [1, 2, 3] } as unknown as Deflater;
    const undefinedAnswer = { deflate: () => undefined } as unknown as Deflater;
    const entries = [{ name: 'a.txt', bytes: FORTY }];
    expect(failure(() => zip(entries, throwsError))).toEqual(['failed', 'the compressor failed: out of memory']);
    expect(failure(() => zip(entries, throwsText))).toEqual(['failed', 'the compressor failed: no']);
    expect(failure(() => zip(entries, notBytes))).toEqual(['failed', 'the compressor failed: it answered with object where bytes are expected']);
    expect(failure(() => zip(entries, undefinedAnswer))).toEqual(['failed', 'the compressor failed: it answered with undefined where bytes are expected']);
  });

  it('the count, a name and an entry of 4 GiB are refused before the compressor is called', () => {
    const { deflater, given } = byNodeZlib();
    const one = new Uint8Array([1]);
    const many = Array.from({ length: 65535 }, (_, i) => ({ name: `f${i}`, bytes: one }));
    expect(failure(() => zip(many, deflater))?.[1]).toBe('the files do not fit a ZIP without ZIP64: 65535 files, the most is 65534');
    expect(failure(() => zip([{ name: 'a.txt', bytes: FORTY }, { name: 'n'.repeat(ZIP_NAME_LIMIT + 1), bytes: one }], deflater))?.[0]).toBe('failed');
    const huge = { name: 'big', bytes: { length: 0xffffffff } as unknown as Uint8Array };
    expect(failure(() => zip([{ name: 'a.txt', bytes: FORTY }, huge], deflater))?.[1]).toBe('the files do not fit a ZIP without ZIP64: "big" has 4 GiB or more');
    expect(given).toEqual([]);
  });

  it('the sizes together are those of what is written, so they are checked after the compressor', () => {
    // two entries that claim 2 GiB each: refused stored, while with a compressor the first is
    // compressed before the sizes are known (the compressor stops it: the claimed bytes are not there)
    const half = { name: 'half', bytes: { length: 0x7fffffff } as unknown as Uint8Array };
    expect(failure(() => zip([half, { ...half, name: 'other' }]))?.[1]).toBe('the files do not fit a ZIP without ZIP64: the files have 4 GiB or more together');
    let calls = 0;
    const stops: Deflater = {
      deflate: () => {
        calls++;
        throw new Error('reached');
      },
    };
    expect(failure(() => zip([half, { ...half, name: 'other' }], stops))?.[1]).toBe('the compressor failed: reached');
    expect(calls).toBe(1);
  });
});

describe('the reader of the tests', () => {
  const one = (bytes: Uint8Array, deflater?: Deflater) => zip([{ name: 'a.txt', bytes }], deflater);
  // the archive of forty letters with a stream of its own in place of the six bytes of the table
  const withStream = (stream: number[]): Uint8Array => zip([{ name: 'a.txt', bytes: FORTY }], { deflate: () => new Uint8Array(stream) });
  const reads = (archive: Uint8Array): string => {
    try {
      readZip(archive);
      return 'read';
    } catch (error) {
      return (error as Error).message;
    }
  };

  it('reads a stored and a deflated entry', () => {
    expect(reads(one(FORTY))).toBe('read');
    expect(reads(one(FORTY, fromATable))).toBe('read');
  });

  it('refuses another method, a cut stream, bytes after the last block, another length or checksum, a stream not shorter', () => {
    const method = one(FORTY, fromATable);
    method[8] = 12; // bzip2, in the local header
    method[41 + 10] = 12; // and in the central one
    expect(reads(method)).toMatch(/has the method 12/);
    // the stream cut: its last byte gone (the sizes say five)
    expect(reads(withStream(FORTY_STREAM.slice(0, 5)))).toMatch(/does not inflate/);
    // a byte after the last block
    expect(reads(withStream([...FORTY_STREAM, 0x07]))).toMatch(/ends after 6 of its 7 bytes/);
    // the stream of thirty-nine letters: another length
    expect(reads(withStream([...deflateRawSync(bytes('a'.repeat(39)))]))).toMatch(/the length of 0 differs/);
    // the stream of forty other letters: the length holds, the checksum does not
    expect(reads(withStream([...deflateRawSync(bytes('b'.repeat(40)))]))).toMatch(/the checksum of 0/);
    // a deflated entry that is not shorter than its bytes: method 8 on a stored entry of the same sizes
    const notShorter = one(FORTY);
    notShorter[8] = 8;
    notShorter[30 + 5 + 40 + 10] = 8;
    expect(reads(notShorter)).toMatch(/deflated and not shorter/);
  });
});

describe('numbers and texts of a file', () => {
  it('float32Text: the shortest text that reads back as the same float32, never more than nine digits, "-0" or a form ST_Number does not take', () => {
    const ST_NUMBER = /^((-|\+)?(([0-9]+(\.[0-9]+)?)|(\.[0-9]+))((e|E)(-|\+)?[0-9]+)?)$/;
    const values: number[] = [0, -0, 1, -1, 0.1, 1 / 3, -2.5, 80, 1e-7, 1.5e-45, 3.4028234663852886e38, -3.4028234663852886e38, 123456.789, 9.9, 1e9];
    for (let k = -20; k <= 20; k++) values.push(10 ** k, -(10 ** k), 3 * 10 ** k);
    let seed = 12345;
    for (let i = 0; i < 2000; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      values.push((seed / 2147483648 - 0.5) * 10 ** ((i % 13) - 4));
    }
    for (const raw of values) {
      const value = Math.fround(raw);
      const text = float32Text(value);
      expect(Math.fround(Number(text)), `${raw} as ${text}`).toBe(value === 0 ? 0 : value);
      expect(text, String(raw)).toMatch(ST_NUMBER);
      // significant digits: not the zeros before the first digit, nor those that end a whole number
      const mantissa = text.replace(/e.*$/, '').replace('-', '');
      expect((mantissa.includes('.') ? mantissa.replace('.', '') : mantissa.replace(/0+$/, '')).replace(/^0+/, '').length, text).toBeLessThanOrEqual(9);
      expect(text).not.toBe('-0');
    }
    expect([0.1, 1 / 3, -0, 80, 1e-7].map((value) => float32Text(Math.fround(value)))).toEqual(['0.1', '0.33333334', '0', '80', '1e-7']);
  });

  it('plain: at most nine decimals, no exponent, no trailing zeros, never "-0"', () => {
    expect([0, -0, 1, -71.3, 0.1 + 0.2, 1e-10, -1e-10, 1e-9, 2.5e-7, 1234567.0000000001, 1e20, 1e21, -3e22].map(plain)).toEqual(['0', '0', '1', '-71.3', '0.3', '0', '0', '0.000000001', '0.00000025', '1234567', '100000000000000000000', '1000000000000000000000', '-30000000000000000000000']);
    expect(decimals(Math.tan(Math.PI / 8), 12)).toBe('0.414213562373');
    for (const value of [Number.NaN, Infinity, -Infinity]) {
      expect(failure(() => plain(value))?.[0]).toBe('failed');
      expect(failure(() => float32Text(value))?.[0]).toBe('failed');
    }
  });

  it('xmlText: the four characters, the three white spaces, a control character, a lone surrogate', () => {
    expect(xmlText('Lid <A&B> "top"')).toBe('Lid &lt;A&amp;B&gt; &quot;top&quot;');
    expect(xmlText("it's")).toBe("it's"); // in an attribute in double quotes an apostrophe needs nothing
    expect(xmlText('a\tb\nc\rd')).toBe('a b c d'); // a space, not a reference: lib3mf refuses a reference (the review of D54)
    expect(xmlText('a\u0000b\u0008c\u001fd')).toBe('abcd');
    expect(xmlText('x\ud800y\udfffz')).toBe('xyz');
    expect(xmlText('￾￿')).toBe('');
    expect(xmlText('šroub 😀 Ω')).toBe('šroub 😀 Ω'); // a pair of surrogates is one character
  });
});
