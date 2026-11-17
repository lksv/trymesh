// The port `Deflater` (D54) over `pako` 2.1.0 (github.com/nodeca/pako; licences MIT and Zlib), a
// port of zlib's deflate to JavaScript. The one module of the repository that imports the library.
//
// - The entry for deflate alone, `pako/lib/deflate.js` (CommonJS; the main entry of 2.1.0 is
//   a prebuilt file that brings inflate along). The package has no types: the one function called
//   is declared in `pako.d.ts`.
// - `deflateRaw` with level 6, the default of zlib, stated so that no default of the library
//   decides the bytes; every other option is the library's default (window 15, memory level 8,
//   the default strategy). The stream is that of zlib at level 6 byte for byte (deflate.md,
//   "Measured": against zlib 1.2.12 and 1.3.2; `pako` 3.0.3 with `legacyHash` gives the same).
// - Synchronous, in Node and in a browser, with nothing to load: no clock, no randomness.
// - When it cannot compress, 2.1.0 throws: an `Error` when the stream cannot be set up (options out
//   of range), and the message of zlib as a plain string when the stream reports an error. The
//   writer of the engine turns either into the answer `failed` (`String` of a thrown value that is
//   no `Error`).
import type { Deflater } from '@trymesh/engine';
import { deflateRaw } from 'pako/lib/deflate.js';

// The level, fixed: 6 (deflate.md, "The level").
export const PAKO_LEVEL = 6;

export function createPakoDeflater(): Deflater {
  return { deflate: (bytes) => deflateRaw(bytes, { level: PAKO_LEVEL }) };
}
