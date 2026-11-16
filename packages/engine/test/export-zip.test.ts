// The stored ZIP and the numbers and texts of a file (D54): the parts the formats of 2g are built
// from, read back by a reader of the test (zip-reader.ts) and checked against `node:zlib`.
import { crc32 as zlibCrc } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decimals, float32Text, plain, xmlText } from '../src/export/text';
import { ZIP_NAME_LIMIT, crc32, storedZip } from '../src/export/zip';
import { QueryFailure } from '../src/query/spec';
import { readZip } from './zip-reader';

const bytes = (text: string) => new TextEncoder().encode(text);
const failure = (run: () => unknown): [string, string] | undefined => {
  try {
    run();
  } catch (error) {
    if (error instanceof QueryFailure) return [error.code, error.message];
    throw error;
  }
  return undefined;
};

describe('a stored ZIP', () => {
  it('the checksum is CRC-32 as zlib has it', () => {
    expect(crc32(bytes('123456789')).toString(16)).toBe('cbf43926'); // the check value of the polynomial
    expect(crc32(new Uint8Array())).toBe(0);
    const random = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7919 + ((i * i) % 251)) & 0xff);
    for (const length of [1, 2, 3, 255, 256, 4999, 5000]) expect(crc32(random.slice(0, length))).toBe(zlibCrc(random.slice(0, length)));
  });

  it('three files read back: names, sizes, offsets, the stored bytes, the version, the date, the flag of a name that is not ASCII', () => {
    const entries = [
      { name: '[Content_Types].xml', bytes: bytes('<Types/>') },
      { name: 'folder/empty.txt', bytes: new Uint8Array() },
      { name: 'díl/šroub.stl', bytes: Uint8Array.from({ length: 300 }, (_, i) => i & 0xff) },
    ];
    const zip = storedZip(entries);
    const read = readZip(zip);
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
    expect(zip.length).toBe(files + names.reduce((sum, name) => sum + 46 + name, 0) + 22);
    // the same files give the same bytes
    expect(storedZip(entries)).toEqual(zip);
  });

  it('an archive with nothing in it is the end record alone', () => {
    const zip = storedZip([]);
    expect(zip.length).toBe(22);
    expect(readZip(zip)).toEqual([]);
  });

  it('the edges: a name of 65 489 bytes passes and one more byte is refused, counted in bytes of UTF-8', () => {
    expect(ZIP_NAME_LIMIT).toBe(65489);
    const longest = storedZip([{ name: 'n'.repeat(ZIP_NAME_LIMIT), bytes: bytes('x') }]);
    expect(readZip(longest)[0].name.length).toBe(ZIP_NAME_LIMIT);
    expect(failure(() => storedZip([{ name: 'n'.repeat(ZIP_NAME_LIMIT + 1), bytes: bytes('x') }]))?.[0]).toBe('failed');
    // two bytes a letter: 32 744 letters are 65 488 bytes, one more is 65 490
    expect(failure(() => storedZip([{ name: 'é'.repeat(32744), bytes: bytes('x') }]))).toBeUndefined();
    expect(failure(() => storedZip([{ name: 'é'.repeat(32745), bytes: bytes('x') }]))).toEqual(['failed', expect.stringMatching(/^the files do not fit a ZIP without ZIP64: the name ".*" has 65490 bytes, the most is 65489$/)]);
  });

  it('the edges: 65 534 entries pass and 65 535 are refused', () => {
    const one = new Uint8Array([1]);
    const most = Array.from({ length: 65534 }, (_, i) => ({ name: `f${i}`, bytes: one }));
    const zip = storedZip(most);
    const read = readZip(zip);
    expect(read.length).toBe(65534);
    expect(read[65533].name).toBe('f65533');
    expect(failure(() => storedZip([...most, { name: 'last', bytes: one }]))).toEqual(['failed', 'the files do not fit a ZIP without ZIP64: 65535 files, the most is 65534']);
  });

  it('the edges of 4 GiB, by the arithmetic: an entry that claims that size is refused before anything is laid out', () => {
    const huge = { name: 'big', bytes: { length: 0xffffffff } as unknown as Uint8Array };
    expect(failure(() => storedZip([huge]))).toEqual(['failed', 'the files do not fit a ZIP without ZIP64: "big" has 4 GiB or more']);
    // files that together, with their local headers, reach 4 GiB
    const half = { name: 'half', bytes: { length: 0x7fffffff } as unknown as Uint8Array };
    expect(failure(() => storedZip([half, { ...half, name: 'other' }]))).toEqual(['failed', 'the files do not fit a ZIP without ZIP64: the files have 4 GiB or more together']);
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

  it('xmlText: the five characters, the three white spaces, a control character, a lone surrogate', () => {
    expect(xmlText('Lid <A&B> "top"')).toBe('Lid &lt;A&amp;B&gt; &quot;top&quot;');
    expect(xmlText("it's")).toBe("it's"); // in an attribute in double quotes an apostrophe needs nothing
    expect(xmlText('a\tb\nc\rd')).toBe('a&#9;b&#10;c&#13;d');
    expect(xmlText('a\u0000b\u0008c\u001fd')).toBe('abcd');
    expect(xmlText('x\ud800y\udfffz')).toBe('xyz');
    expect(xmlText('￾￿')).toBe('');
    expect(xmlText('šroub 😀 Ω')).toBe('šroub 😀 Ω'); // a pair of surrogates is one character
  });
});
