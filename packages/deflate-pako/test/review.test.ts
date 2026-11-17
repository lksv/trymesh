// Regressions from the review of the compressed 3MF (D54).
import { QueryFailure, zip } from '@trymesh/engine';
import { deflateRaw } from 'pako/lib/deflate.js';
import { describe, expect, it } from 'vitest';

const failure = (run: () => unknown): string | undefined => {
  try {
    run();
  } catch (error) {
    if (error instanceof QueryFailure) return `${error.code}: ${error.message}`;
    throw error;
  }
  return undefined;
};
const FORTY = new TextEncoder().encode('a'.repeat(40));

describe('the review of the compressed 3MF', () => {
  // The comments said that pako throws an `Error` with the message of zlib. In 2.1.0 that holds
  // only for a stream that cannot be set up; an error of the stream itself is thrown as the message,
  // a plain string (`throw deflator.msg || msg[deflator.err]`). The writer takes both.
  it('pako 2.1.0 throws an Error for options out of range, and the writer makes it failed', () => {
    let thrown: unknown;
    try {
      deflateRaw(FORTY, { level: 99 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(failure(() => zip([{ name: 'a.txt', bytes: FORTY }], { deflate: (bytes) => deflateRaw(bytes, { level: 99 }) }))).toBe(`failed: the compressor failed: ${(thrown as Error).message}`);
  });

  it('a message thrown as a string, as pako 2.1.0 throws an error of its stream, is failed with that message', () => {
    const asPako = {
      deflate: (): Uint8Array => {
        throw 'data error';
      },
    };
    expect(failure(() => zip([{ name: 'a.txt', bytes: FORTY }], asPako))).toBe('failed: the compressor failed: data error');
  });
});
