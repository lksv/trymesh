// The adapter of the port `Deflater` over `pako` 2.1.0 (D54): the guarantees of the port, with
// `node:zlib` as the inflater (it shares no code with the library), and the streams of fixed
// inputs pinned.
//
// The pinned streams are those of zlib at level 6 with a window of 15 and the memory level 8, the
// raw format: what `pako` 2.1.0 writes with its defaults is zlib's stream byte for byte. To make
// them again with a stock zlib, for example from Python:
//   c = zlib.compressobj(6, zlib.DEFLATED, -15, 8); stream = c.compress(data) + c.flush()
// (checked on 2026-11-17 against zlib 1.2.12 and 1.3.2). A new version of the library may write
// other streams that are as valid; the version is pinned exactly, and a change shows here.
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PAKO_LEVEL, createPakoDeflater } from '../src/index';

const deflater = createPakoDeflater();
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const text = (value: string) => new TextEncoder().encode(value);
// What `node:zlib` inflates the stream to, and how many bytes of the stream it read.
const inflate = (stream: Uint8Array): { bytes: Uint8Array; read: number } => {
  const result = inflateRawSync(stream, { info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
  return { bytes: new Uint8Array(result.buffer), read: result.engine.bytesWritten };
};
// Bytes that do not compress, from a generator of the test, so a run is repeatable.
const noise = (length: number): Uint8Array => {
  let state = 7;
  return Uint8Array.from({ length }, () => {
    state = (state * 1103515245 + 12345) >>> 0;
    return state >>> 24;
  });
};
// A text of a few kilobytes with the repetitions of a model part.
const vertices = () => text(Array.from({ length: 120 }, (_, i) => `<vertex x="${i * 0.5}" y="${(i * 7) % 13}" z="${(i * i) % 17}"/>`).join('\n'));

// The inputs of "The edges of a stream" of deflate.md, but the two large ones (16 MiB of zeros and
// the model part of the joint sixteen times over).
const inBuffer = new Uint8Array(20000).fill(0x41);
inBuffer.set(text('b'.repeat(9000)), 5000);
const EDGES: [string, () => Uint8Array][] = [
  ['no bytes', () => new Uint8Array(0)],
  ['one byte', () => new Uint8Array([0x7a])],
  ['65 535 equal bytes', () => new Uint8Array(65535).fill(9)],
  ['65 536 equal bytes', () => new Uint8Array(65536).fill(9)],
  ['1 MiB of noise', () => noise(1 << 20)],
  ['9 000 bytes that are a view into a larger buffer, at an offset', () => inBuffer.subarray(5000, 14000)],
  ['forty letters', () => text('a'.repeat(40))],
  ['a text of a few kilobytes', vertices],
];

describe('the compressor over pako', () => {
  it('the level is 6, the default of zlib', () => {
    expect(PAKO_LEVEL).toBe(6);
  });

  for (const [name, make] of EDGES) {
    it(`${name}: one complete stream that inflates back, read to its end; the input unchanged, the result an array of its own`, () => {
      const input = make();
      const before = input.slice();
      const stream = deflater.deflate(input);
      expect(stream).toBeInstanceOf(Uint8Array);
      expect(stream.buffer).not.toBe(input.buffer);
      const { bytes, read } = inflate(stream);
      expect(read).toBe(stream.length); // nothing follows the last block
      expect(bytes).toEqual(before);
      expect(input).toEqual(before);
      // the same input gives the same stream
      expect(deflater.deflate(input)).toEqual(stream);
    });
  }

  it('the streams of fixed inputs, those of zlib at level 6', () => {
    expect([...deflater.deflate(text('a'.repeat(40)))]).toEqual([0x4b, 0x4c, 0x24, 0x0e, 0x00, 0x00]);
    expect([...deflater.deflate(new Uint8Array(0))]).toEqual([0x03, 0x00]);
    expect([...deflater.deflate(new Uint8Array([0x07]))]).toEqual([0x63, 0x07, 0x00]);
    const input = vertices();
    expect(input.length).toBe(3648);
    const stream = deflater.deflate(input);
    expect([stream.length, sha256(stream)]).toEqual([587, '5cf09702db021fccadfbba0a8c5b7562a7b1bce61520887a5daae12afe5f1fb2']);
  });

  it('noise: the stream is longer than its bytes, which the writer of the engine then stores', () => {
    const input = noise(4096);
    expect(deflater.deflate(input).length).toBeGreaterThan(input.length);
  });
});
