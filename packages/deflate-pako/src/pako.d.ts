// The one function the adapter calls of `pako` 2.1.0, which ships no types (`index.ts`).
// `lib/deflate.js` exports `deflateRaw(input, options)`: the raw DEFLATE stream of `input` as a new
// `Uint8Array`. It writes `raw: true` into the options object it is given, so a call passes an
// object of its own. It throws an `Error` with the message of zlib when the stream reports one.
declare module 'pako/lib/deflate.js' {
  export function deflateRaw(input: Uint8Array, options: { level: number }): Uint8Array;
}
