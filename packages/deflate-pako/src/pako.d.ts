// The one function the adapter calls of `pako` 2.1.0, which ships no types (`index.ts`).
// `lib/deflate.js` exports `deflateRaw(input, options)`: the raw DEFLATE stream of `input` as a new
// `Uint8Array`. It writes `raw: true` into the options object it is given, so a call passes an
// object of its own. It throws an `Error` when the stream cannot be set up (options out of range)
// and the message of zlib as a string (not an `Error`) when the stream reports an error.
declare module 'pako/lib/deflate.js' {
  export function deflateRaw(input: Uint8Array, options: { level: number }): Uint8Array;
}
