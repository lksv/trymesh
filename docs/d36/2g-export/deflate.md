# 2g, an addition: the 3MF compressed (D54)

**State: designed on 2026-11-17, not implemented.** An addition to [design.md](design.md), which is implemented and merged with a 3MF whose parts are stored. Written against the code of `master` at `633a6ca`. The compressors were measured and the writer was prototyped in the session scratchpad; the files were read back by independent readers ("Measured"). Nothing under `packages/` was changed, and no library was installed in the repository.

The owner decided on 2026-11-17 (question 1 of "Open" of design.md): the 3MF is to be compressed, with an existing third-party library that the session chooses; the owner approves it under D2 once it is named. **The library this design names is `pako` 3.0.3.**

Files: the last part of [contract.ts](contract.ts) ("the addition of 2026-11-17": the port, the writer, the adapter) and part g of [calls.ts](calls.ts) (the scenario with the compressor).

## What the decision says, checked against the code

| Statement | What the code and the specifications say |
|---|---|
| "The 3MF is to be compressed" | A file of a 3MF package "MUST use the compression method `Deflate` ... or be `stored uncompressed`" (3MF core 1.4.0, 1.1), and a package "shall not use compression algorithms except DEFLATE" (Open Packaging Conventions, 7.3.6). So compressed means deflate, method 8 of a ZIP, and nothing else. `storedZip` (`export/zip.ts`) writes every entry with method 0; the 3MF of the box is 1.21 times its STL |
| "With an existing third-party library" | What a ZIP entry of method 8 holds is a raw DEFLATE stream (APPNOTE 5.5, RFC 1951). The container itself the engine already writes, tested to its edges: the three records, the CRC-32, the date, the refusals. So the library is needed for one function, bytes to a raw DEFLATE stream, and for nothing of the ZIP |
| D2: "every library sits behind its own interface defined in the engine", and the engine has no dependencies | `packages/engine/package.json` has no `dependencies`. The two libraries of the engine are behind the ports `SketchSolver` and `SolidKernel` (`types.ts`), each with an adapter package, passed to `createEngine({ solver, kernel })` by `packages/app/src/main.ts` and `packages/mcp/src/main.ts`. A query and a format read the kernel from their context (`QueryContext.kernel`) |
| The export is synchronous | `Engine.export` returns `QueryOutcome<Exported>`, no promise. What the platforms have built in does not fit: `CompressionStream` of a browser is a stream (Compression Standard, WHATWG), `node:zlib` is in Node only. A library has to compress synchronously, in Node and in a browser, without native code |
| "The same model gives the same bytes" (design.md, the container) | It has to stay true with a compressor: the same bytes from the app and from the server. That is a demand on the library (no clock, no randomness, nothing that depends on the JavaScript engine) and was measured |
| `storedZip` is also what the app saves a set with | `panels/export.ts` calls it for an export of the layout `directory` (`stl` with `perBody`; later the robot description of 5b). The files of a set are binary STL, which deflate makes 4.3 to 4.9 times smaller ("Measured"). The panel reaches the engine only through `PanelHost` |
| The tests read a ZIP back with a reader of their own | `packages/engine/test/zip-reader.ts`, used by the tests of the engine, scenario 12 and the app; it refuses an entry that is not stored. Some tests look into the raw bytes of a 3MF or pin its size (`scenario12.test.ts`, `server.test.ts`, the snapshot `export.txt`), and twelve snapshots of the app record the summary of the format with the toolbar |

## The cheap variant

- **A third port, `Deflater`**, beside the solver and the kernel: one function, `deflate(bytes)`, that returns a raw DEFLATE stream. `createEngine` takes it and may go without it.
- **The engine keeps its ZIP writer.** `storedZip` becomes `zip(entries, deflater?)`: an entry is written deflated when a compressor is given and its stream is shorter than its bytes, and stored otherwise. Without a compressor the bytes are those of today.
- **The format `3mf`** passes the compressor of its context to the writer. Nothing else of the format changes.
- **An adapter package, `packages/deflate-pako`**, is the one place that imports the library. The app and the server create it and give it to their engine, as they do with the solver and the kernel.
- **The app** compresses the ZIP of a set with the same compressor.
- **Nothing of the document changes**: no command, no query, no feature type, no schema step. No tool and no code of `packages/mcp/src` but one line of `main.ts`.

**Deferred:**

- ZIP64, and with it a package over 4 GiB or 65 534 entries (as before).
- A choice of the level by the caller. The adapter has one, fixed.
- A compressor that works in pieces (a stream), and one in a worker: an export stays one synchronous call. A model whose 3MF takes long to compress would need it; the largest measured is 17 MB of model text in 0.73 s.
- A check at run time that the stream inflates back to the bytes.

## Sources

Nothing about a library or a format is taken from memory. Every claim below was read on 2026-11-17 in these places:

| Source | Read for |
|---|---|
| The npm registry, `registry.npmjs.org/<package>` (the document of each package), and `api.npmjs.org/downloads/point/last-week/<package>` | versions and their dates, licences, dependencies, entry points, unpacked sizes, the descriptions and READMEs of the packages that were not installed; downloads of the week of 9 to 15 November 2026 |
| `pako` 3.0.3 as installed from the registry (integrity `sha512-tmrebBBY…kVeZAQ==`): `README.md`, `LICENSE`, `package.json`, `dist/pako.d.ts`, `dist/pako.mjs` | what it is, the API and its options, the licences, the entry points, what the code touches of its environment |
| `github.com/nodeca/pako`: `CHANGELOG.md`, `src/zlib/README`, and through the GitHub API the repository and its open issues | the history of the 3.x line, which zlib it follows and under which licence, the state of maintenance |
| `fflate` 0.8.3 as installed (integrity `sha512-tbZNuJrL…CsPvgA==`): `README.md`, `CHANGELOG.md`, `LICENSE`, `package.json`, `lib/index.d.ts`, `esm/browser.js`, `esm/index.mjs` | the same for the runner-up |
| `github.com/101arrowz/fflate` through the GitHub API: the repository, and the open issues 296, 314, 260, 282 and 267 | the state of maintenance; reports about its output |
| `uzip` 0.20201231.0 and `zlibjs` 0.3.1 as installed: `README`, `LICENSE`, `package.json`; `github.com/photopea/UZIP.js` and `github.com/imaya/zlib.js` through the GitHub API | the two older candidates |
| `pnpm-lock.yaml` of `master`; `manifold-3d` 3.5.5 (`package.json`, `lib/export-3mf.js`), `@types/three` 0.187.0 (`package.json`) and `three` 0.187.0 (`examples/jsm/libs/fflate.module.js`) in `node_modules` | where `fflate` already is in the tree |
| RFC 1951, DEFLATE Compressed Data Format Specification (`rfc-editor.org/rfc/rfc1951.txt`) | the format of a stream: blocks (3.2.3), stored blocks (3.2.4), dynamic codes and a block without a distance code (3.2.7) |
| .ZIP File Format Specification 6.3.10, PKWARE (the copy read for design.md) | a file with no content (4.3.8), version made by and needed (4.4.2, 4.4.3), the bits of the flag for method 8 (4.4.4), the methods (4.4.5), the CRC and the sizes (4.4.7 to 4.4.9), the method Deflate (5.5) |
| 3MF Core Specification 1.4.0 and ECMA-376 part 2, fifth edition (the copies read for design.md) | which methods a package may use (3MF 1.1; OPC 7.3.6 and annex B, tables B.3 to B.5) |
| `github.com/madler/zlib`, `trees.c` (branch `master`) | why zlib never writes a block without a distance code |
| Compression Standard, WHATWG, Living Standard (last updated 19 October 2026) | what a browser has built in: `CompressionStream`, a stream, with the format `deflate-raw` |

## The library

**The candidates.** Everything on npm that compresses to deflate in JavaScript and that the search for the two examples of the task led to, with what the registry says of each:

| Package | Latest, published | Licence | Dependencies | Why it was or was not measured |
|---|---|---|---|---|
| `pako` | 3.0.3, 2026-10-26 | `(MIT AND Zlib)` | none | measured |
| `fflate` | 0.8.3, 2026-05-16 | MIT | none | measured |
| `uzip` (UZIP.js) | 0.20201231.0, 2020-12-31 | MIT | none | measured; the package has not been published since 2020 (its repository has two commits since, "Add files via upload"), it has no types and is a CommonJS object |
| `zlibjs` (zlib.js) | 0.3.1, 2017-07-06 | MIT | none | measured; last commit of its repository 2017-12-30; its raw deflate has no levels |
| `jszip` | 3.10.2, 2026-09-08 | `(MIT OR GPL-3.0-or-later)` | `pako` ~1.0.2 and three more | no: a ZIP library whose writer is `generateAsync`; its compressor is `pako` 1 |
| `@zip.js/zip.js` | 2.25.0, 2026-11-12 | BSD-3-Clause | none | no: a ZIP library with promises throughout (`await zipWriter.add`), 8.7 MB unpacked |
| `client-zip` | 2.5.1, 2026-09-14 | MIT | none | no: "It does *not* compress the files" (its README) |
| `browserify-zlib`, `zlib-wasm` | 2017-06-03, 2020-06-13 | MIT, "MIT & zlib" | `pako` 1 | no: wrappers of `pako` 1 |
| `wasm-flate` | 1.0.2-browser, 2020-03-25 | none stated | none | no: no licence in the registry |
| `@stardazed/zlib`, `zlib-asm` | 2020-08-16, 2016-08-17 | Zlib, zlib | none, one | no: two and nine versions, the last four and ten years old |
| `deflate-js`, `compressjs` | 2013-05-04, 2015-07-27 | GPL | none, two | no: the licence |
| `tiny-inflate` | 1.0.3, 2019-11-17 | MIT | none | no: it only inflates |
| `fast-zlib`, `adm-zip`, `yazl`, `archiver`, `zip-stream` | | MIT | | no: for Node only ("with node's native zlib", "for nodejs", "for node", streams of Node) |

**The four that were measured**, each as its raw deflate function at level 6 (zlib.js has no level), on the model parts of the two packages the engine of `master` writes: the box of scenario 12 (177 078 bytes of XML) and the joint of scenario 9 (1 065 171 bytes). The numbers are under "Measured"; what decides is here.

| | `pako` 3.0.3 | `fflate` 0.8.3 | `uzip` | `zlibjs` |
|---|---|---|---|---|
| Licence | MIT, and Zlib for the code ported from zlib (`README`: "MIT - all files, except `/src/zlib` folder; ZLIB - `/src/zlib` content") | MIT | MIT | MIT |
| The call | `deflateRaw(bytes, { level, legacyHash })`, synchronous, types in the package | `deflateSync(bytes, { level, mem })`, synchronous, types in the package | `UZIP.deflateRaw(bytes, { level })`, no types | `new Zlib.RawDeflate(bytes).compress()`, no types |
| What it is | a port of zlib ("follows zlib C sources as close as possible", `src/zlib/README`; "This port is based on zlib 1.3.2") | a compressor of its own | a compressor of its own ("made from scratch") | a compressor of its own |
| Times smaller, box and joint | 6.08, 6.43 | 5.93, 6.27 | 5.93, 6.27 | 5.94, 6.21 |
| Time once warm, box and joint | 7.3 ms, 44.7 ms | 6.1 ms, 39.5 ms | 6.1 ms, 37.4 ms | 19.4 ms, 130.4 ms |
| In the bundle of the app (minified, and gzipped) | 33.4 kB, 9.0 kB | 9.0 kB, 3.6 kB | 22.6 kB, 7.2 kB | not built |
| Releases | five in 2026 (2.2.0 in June to 3.0.3 in October); before them 2.1.0 of November 2022 | 0.8.3 in May 2026; before it 0.8.2 of February 2024 | none since 2020 | none since 2017 |
| Open in its repository | 4 issues, 1 pull request; none about `deflateRaw` (a streaming class with a flush and a tiny chunk, two about inflate, the types of an entry point the adapter does not use) | 34 issues, 24 pull requests; among them the reports below | 1 | 38 |
| Downloads in a week | 191 million | 161 million | 2 million | 6 million |
| Already in the tree | no | yes: a dependency of `manifold-3d` 3.5.5 (its own 3MF export) and of `@types/three`, and `three` ships a copy | no | no |

**The choice: `pako` 3.0.3, called as `deflateRaw(bytes, { level: 6, legacyHash: true })`.** The reasons, in the order of their weight:

1. **Its stream is the stream of zlib.** A file format is judged by the programs that read it, and every inflater in the field has been tested against what zlib writes. `pako` is a port of zlib's deflate, and with `legacyHash` (the hash of zlib; "matches canonical zlib output byte-for-byte", `pako.d.ts`) its output was measured to be the output of zlib 1.2.12 byte for byte: against the `zlib` module of Python and against `node:zlib`, on both model parts, at the levels 1, 3, 6 and 9. So the claim "this stream is valid" does not rest on this project's tests of a compressor: it rests on zlib.
2. **`fflate` writes a block that zlib avoids on purpose, in the very function the adapter would call.** For data with no back-reference, `deflateSync` writes a dynamic block with one distance code of length zero (its issue 296, run again here: the stream starts `05 c0 83 11 c3`, HDIST 1, lengths `[0]`). RFC 1951 allows it (3.2.7: "One distance code of zero bits means that there are no distance codes used at all"). zlib does not write it: "The pkzip format requires that at least one distance code exists ... So ... we force at least two codes of non zero frequency" (`trees.c`), and `pako` and `node:zlib` write the same input as `05 c1 07 02 42`, two codes of length 1. The report says the ZIP viewer of Windows refuses such an entry; every reader at hand here takes it, and Windows was not tried. The parts of a 3MF always have back-references (measured: 8 to 27 distance codes in every part), so the engine's own files would not show it, but the same writer saves the sets of the app, whose content 5b widens. The issue is open since September with no answer.
3. **The files are smaller**: 2.5 % for the box and the joint (29 823 against 30 583 bytes, 166 268 against 170 468), at 13 to 20 % more time (1.2 ms and 5.2 ms).
4. **Maintenance.** Both are the work of one or two people. `pako` had five releases in the last five months and has four open issues; `fflate` had one release since February 2024 and has 34, among them reports of this year that its streaming classes write streams other inflaters refuse (260, 282, 267: not the function the adapter would call, which the reports themselves found correct) and that level 0 writes a wrong stream for an input of a multiple of 65 535 bytes (314: not the level the adapter would use).

What speaks for `fflate`, and why it does not decide:

- **It is a quarter of the size**: 24 kB less of minified code. The app already loads `three` and two WASM modules; 24 kB does not change what it is.
- **It is already in `node_modules`**, at the same version, because `manifold-3d` and `@types/three` depend on it. That makes the lockfile one package shorter than with `pako` (which has no dependencies of its own). It does not make it approved: a library the project's own code imports needs the owner's yes either way.
- **One licence instead of two.** Both of `pako`'s are permissive; see "Known limits" for what they ask.

What speaks against `pako`, said plainly:

- **The 3.x line is five months old.** 3.0.0 (26 June 2026) moved the sources to TypeScript and changed the exports; 3.0.2 ported a fix of zlib that had been missed (for the strategy `Z_FIXED`, which the adapter does not use). The part that compresses is the port of zlib that 1.x and 2.x had, and the option `legacyHash` selects the hash those versions had; the default of 3.x is a newer hash (added in 2.2.0, June 2026), which the adapter does not use. The version is pinned exactly.
- **`legacyHash` costs time**: 7.3 against 6.3 ms and 44.7 against 40.0 ms, for bytes that can be checked against zlib anywhere. The files are 0.3 to 0.5 % larger than with the default hash.

Should the owner prefer `fflate` after all, the design holds as it is: the port, the writer and every test but those of the adapter package do not name the library. The adapter is one file.

**The level.** Level 6, the default of zlib. Measured with the adapter's hash, box and joint:

| Level | Times smaller | Time once warm |
|---|---|---|
| 1 | 4.86, 5.08 | 1.8 ms, 12.4 ms |
| 3 | 5.28, 5.42 | 2.9 ms, 19.2 ms |
| 6 | 6.08, 6.43 | 7.3 ms, 44.7 ms |
| 9 | 6.44, 6.75 | 36.4 ms, 233.1 ms |

Level 9 makes the file 5 % smaller for five times the time; level 3 saves 25 ms on the joint and makes its file 19 % larger. The level is fixed in the adapter and stated there, with `legacyHash`, so no default of the library decides the bytes.

## Measured

The spike (2026-11-17, session scratchpad, directory `2g-deflate`): Node 25.9.0 on an Apple M5, macOS 27.0.1. The libraries were installed with `npm install --ignore-scripts` into a directory of the scratchpad, never into the repository.

- `gen/models.spike.ts`, run by Vitest against the sources of the worktree with the real adapters: builds the box of scenario 12 (every step of `box.ts`, as the part of 2g of the scenario does) and the joint of scenario 9, and writes what `engine.export('3mf', {})` and `engine.export('stl', {})` return. The files have the sizes design.md states (177 803 bytes for the box, 177 999 with a name, a colour and a material set, 1 066 092 for the joint).
- `bench/one.mjs`, `bench/bench.mjs`: one compressor, one level, one input in a process of its own, five processes per row; the driver refuses a row whose streams differ between processes or calls, that `node:zlib` does not inflate back to the input, or whose input was changed.
- `proto/zip.mjs`, `proto/reader.mjs`, `proto/write.mjs`: the writer of `master` with the one branch of this design, the reader of the tests with deflate, and the files written again and read back.
- `tools/read3mf.py`: `zipfile` of Python and `lib3mf` 2.5.0 in strict mode, from the Python environment the spike of design.md left in the scratchpad.

**The compressors**, on the model parts (box 177 078 bytes, joint 1 065 171 bytes), level 6. "First" is the first call in a fresh process, the best of five processes; "warm" is the fastest of the 75 calls that followed. The machine ran other work during two of three runs; these are of the third, on a quiet machine, and the sizes and hashes were the same in all three.

| Compressor | Box: bytes, times smaller | Box: first, warm | Joint: bytes, times smaller | Joint: first, warm |
|---|---|---|---|---|
| `pako` 3.0.3, `legacyHash` (the adapter) | 29 106, 6.08 | 19.8 ms, 7.3 ms | 165 551, 6.43 | 57.6 ms, 44.7 ms |
| `pako` 3.0.3, its default hash | 28 968, 6.11 | 16.0 ms, 6.3 ms | 164 980, 6.46 | 51.3 ms, 40.0 ms |
| `fflate` 0.8.3 (`mem` 8 or its default: the same bytes) | 29 865, 5.93 | 16.0 ms, 6.1 ms | 169 750, 6.27 | 49.1 ms, 39.5 ms |
| `uzip` 0.20201231.0 | 29 865, 5.93 | 11.4 ms, 6.1 ms | 169 749, 6.27 | 45.8 ms, 37.4 ms |
| `zlibjs` 0.3.1 (no level) | 29 814, 5.94 | 29.8 ms, 19.4 ms | 171 642, 6.21 | 153.8 ms, 130.4 ms |
| `node:zlib` of Node 25.9.0, for comparison | 29 106, 6.08 | 5.5 ms, 4.2 ms | 165 551, 6.43 | 27.5 ms, 26.4 ms |

- `pako` with `legacyHash` and `node:zlib` give the same bytes at the levels 1, 3, 6 and 9, on both inputs (eight streams, compared by SHA-256). The `zlib` module of Python (zlib 1.2.12, `compressobj(6, DEFLATED, -15)`) gives the same two streams at level 6. design.md's figure for "the model part deflated (zlib, level 6)", 29 112 and 165 557 bytes, is these streams with the six bytes of a zlib wrapper.
- `fflate` and `uzip` give the same bytes for the box at level 6 and for both inputs at level 9: the same method of compression.
- The bundles: an ES module with the adapter's one call, built by Vite 8.3.8 as the app is built (tree-shaken, minified): `pako` 33 367 bytes (9 031 gzipped), `fflate` 9 007 (3 646), `uzip` 22 606 (7 220). Each bundle gives the bytes of the library called directly.
- `pako`'s `dist/pako.mjs` is one file for Node and for a bundler (`exports` of its `package.json` has no condition by environment). It does not name `require`, `process`, `Date`, `Math.random`, `Math.log`, `Worker`, `navigator` or a timer; of the globals it uses typed arrays and `TextEncoder` (for a string input, which the adapter does not give).

**The same bytes everywhere.** The adapter's call on the two model parts:

| Where | Box | Joint | Time, box and joint (the median of 15 calls after the first) |
|---|---|---|---|
| Node 25.9.0 (V8) | 29 106 bytes, SHA-256 `4ad4d4e1a9b8e383…` | 165 551 bytes, `605132f55018d64b…` | 7.3 ms, 44.7 ms (the fastest, as above) |
| Chrome 156, headless, the file `dist/pako.mjs` and the bundle | the same | the same | 10.7 ms, 43.7 ms |
| Firefox 160, headless, the same two | the same | the same | 12 ms, 60 ms |
| `jsc` of macOS 27.0.1 (JavaScriptCore, the engine of Safari) | the same (by CRC-32) | the same | 5.3 ms, 29.5 ms |

In both browsers the stream was also inflated back to the input by the browser's own `DecompressionStream('deflate-raw')`.

**The files**, written by the prototype writer with the adapter:

| | Box, with properties set | Box, as the scenario exports it | Joint | A model with no body |
|---|---|---|---|---|
| Stored (the engine of `master`) | 177 999 bytes | 177 803 | 1 066 092 | 1 150 |
| Deflated | 29 823 | 29 673 | 166 268 | 889 |
| Times smaller | 5.97 | 5.99 | 6.41 | 1.29 |
| The STL of the same bodies | 146 384 | 146 384 | 857 384 | |
| The 3MF over the STL: stored, deflated | 1.22, 0.204 | 1.21, 0.203 | 1.24, 0.194 | |
| The items: content types, relationships, model | 319 to 197, 260 to 178, 177 078 to 29 106 | 319 to 197, 260 to 178, 176 882 to 28 956 | 319 to 197, 260 to 178, 1 065 171 to 165 551 | 319 to 197, 260 to 178, 229 to 172 |
| The writer alone: stored, deflated | 0.6 ms, 8.3 ms | 0.6 ms, 8.4 ms | 3.6 ms, 49.6 ms | |
| The whole export on `master` (stored), and with the difference added | 4.6 ms, about 12 ms | 4.6 ms, about 12 ms | 30.7 ms, about 77 ms | |

The prototype writer without a compressor writes the files of `master` byte for byte. With `fflate` the three files would be 30 583, 30 437 and 170 468 bytes.

| Reader of the deflated files | What it said |
|---|---|
| `unzip -t` (Info-ZIP 6.00), `zipinfo -v` | no errors in any of the four; every item "deflated", sub-type "normal", version 2.0 to extract, made by 2.0 on MS-DOS, 1 January 1980, no extra field |
| `bsdtar` (libarchive), `ditto` of macOS | extract the three items of the box and of the joint with their sizes; the model part `bsdtar` extracts is that of the stored file |
| Python `zipfile` | `testzip()` finds no bad item; method 8, version 20; every part read is the part of the stored file, byte for byte |
| `lib3mf` 2.5.0, strict mode | no warning; what it reads of each deflated file equals what it reads of the stored one: the objects with their names (`Lid <A&B> "top"`), part numbers, counts, "manifold and oriented", the volumes to nine decimals (28 409.368025381 and 18 154.713184659), the two base materials, the build items; 2, 8 and 0 objects |
| BambuStudio 2.9.1, `--info` | both files load: 2 of 2 and 8 of 8 objects "manifold = yes", the box 80 × 50 × 30 with 1 440 facets and the volume 28 409.37, as for the stored files |
| The prototype reader (`node:zlib`) | every item inflates to the item of the stored file; the inflater reads the whole stream of an item and nothing after it |

**The edges of a stream**, with the adapter's call; each inflated back by `node:zlib`, which read all of the stream, with the input unchanged and the result an array of its own:

| Input | Stream |
|---|---|
| no bytes | 2 bytes |
| one byte | 3 bytes |
| 65 535 and 65 536 equal bytes | 79 bytes each |
| 1 MiB of random bytes | 1 048 896 bytes: longer than the input, so the writer stores such an entry |
| 16 MiB of zeros | 16 310 bytes, in 177 ms |
| 9 000 bytes that are a view into a larger buffer, at an offset | 61 bytes |
| The model part of the joint sixteen times over (17 042 736 bytes) | 2 651 381 bytes, in 0.73 s |
| Forty letters `a` | the six bytes `4b 4c 24 0e 00 00`, as zlib writes them |

**A set of the app.** The STL files: the box and the lid in one file 146 384 to 33 642 bytes (4.35 times smaller), the joint 857 384 to 174 860 (4.90 times). The set of the box as the form saves it (`box.stl`, `lid.stl`): 146 670 bytes stored, 33 795 deflated, read back by `unzip -t`, `zipfile` and the prototype reader. A ZIP with an entry without bytes, one that does not compress and one with a name that is not ASCII beside deflated ones is read by the same three.

**The report about `fflate`** (its issue 296), run here: 96 bytes with no sequence of three repeated. `fflate` writes 64 bytes, a dynamic block with HDIST 1 and the code lengths `[0]`; `pako` (either hash) and `node:zlib` write the same 68 bytes with HDIST 2 and `[1, 1]`. A ZIP of each is taken by `unzip -t`, `zipfile`, `bsdtar` and `ditto`. The first block of every part of the three packages, as `fflate` would write them, uses 8 to 27 distance codes.

Not measured: no file was opened on Windows, in the window of a slicer, or by a browser other than the two named. The times are of one machine. See "To verify before the implementation".

## The design

### The port

`Deflater` joins `SketchSolver` and `SolidKernel` in the section of the ports of `types.ts`:

```ts
interface Deflater {
  deflate(bytes: Uint8Array): Uint8Array;
}
```

A compressor of bytes into a raw DEFLATE stream: the format of RFC 1951 with no zlib or gzip wrapper, which is what method 8 of a ZIP holds. What an implementation guarantees (`contract.ts` has the text that goes into the code):

1. The result is one complete stream that an inflater turns back into exactly `bytes` and that ends with its last block. For every input, also one with no bytes.
2. The same input gives the same output, wherever the implementation runs.
3. `bytes` is not changed and not kept; the result is a new array.
4. It is synchronous.
5. It throws when it cannot compress.

Not guaranteed: that the stream is shorter than the input, a level, and that two implementations give the same stream.

The port is this narrow on purpose. It is the one thing the engine cannot do itself in sixty lines, and anything that deflates is an implementation: the adapter, `node:zlib` in a test of the engine (three lines), a table of known streams in a test that pins bytes.

**Where it enters.** `createEngine(deps)` takes `EngineDeps`: the two ports it has, and `deflater?`. **It is optional.** An engine without it is a whole engine whose files are stored, which is the engine of today: the nineteen other places that create an engine (tests with fakes or with a kernel of their own, a spike) do not change, and a caller that embeds the engine without the library still gets a valid 3MF. (The price is that a composition that forgets the compressor is not refused; "Known limits" and the tests of the two `main.ts`.)

**How a format reaches it.** As it reaches the kernel: a member of its context, `QueryContext.deflater?`, set from `ContextDeps`. A query gets it too and has no use for it.

### The ZIP of the engine

`storedZip(entries)` becomes `zip(entries, deflater?)` in the same module. The records, the date, the CRC, the flag of a name that is not ASCII and every refusal stay as they are. One rule is new:

- **An entry is written deflated when a compressor is given, the entry has bytes, and the stream is shorter than the bytes.** Otherwise it is stored, exactly as today. So the writer never makes a file larger, a file that does not compress (random bytes: measured) costs the time and nothing else, and `zip(entries)` is `storedZip(entries)` byte for byte, which the tests of today keep pinning.
- A deflated entry has the method 8, the version 20 to extract and as the version made by (a stored one keeps 10 and 10), the bits 1 and 2 of its flag 0 ("normal"), the length of the stream as its compressed size, and the CRC-32 of its bytes, not of the stream.
- An entry with no bytes is not given to the compressor: its stream would be two bytes, and the specification wants no data for it.
- The count of entries, the names and an entry of 4 GiB are refused before anything is compressed; the sizes together are of what is written and are checked after.
- A compressor that throws, or answers with something that is not a `Uint8Array`, becomes `QueryFailure('failed')` with `the compressor failed: <its message>`, in the writer, so both of its callers get it: a format (the answer `failed` of `export`) and the form of the app (its `problem`).

`crc32` and `ZIP_NAME_LIMIT` stay exported. The name `storedZip` goes: the function no longer only stores. It has three callers, the format, the form of the app and its tests.

### The format `3mf`

`threeMfPackage(objects, deflater?)` passes the compressor to `zip`, and `run` passes `context.deflater`. With a compressor all three items come out deflated (the two small ones too: 319 to 197 and 260 to 178 bytes). Nothing else changes: the items and their order, the model part, the path, the media type.

- **`about` stays `{ bodies, triangles }`.** Whether the items are deflated is not something about the model: it is in the file, where every ZIP tool shows it, and the size is in the answer of the tool already (`bytes`). A field would report how the engine was composed.
- **The summary** of the entry changes in its last sentence, which says "not compressed" today (`contract.ts`, `THREE_MF_SUMMARY`): compressed when the engine was given a compressor, about a fifth of the size of the STL; without one about a quarter larger. It is one text for every engine, so it says both. It goes to `describe_api` and to the tooltip of the menu of the app.

### The adapter

A package of its own, `packages/deflate-pako` (`@trymesh/deflate-pako`), named as the other two are, by its port and its library:

```ts
import type { Deflater } from '@trymesh/engine';
import { deflateRaw } from 'pako';

export function createPakoDeflater(): Deflater {
  return { deflate: (bytes) => deflateRaw(bytes, { level: 6, legacyHash: true }) };
}
```

- Its `package.json` depends on `@trymesh/engine` and on `pako` at exactly `3.0.3`, as the other adapters pin theirs.
- Creating it is synchronous; there is no WASM to load.
- `import … from 'pako'` resolves to one file in Node, in Vitest and in the bundle of the app.
- It is the only module of the repository that imports the library. Replacing the library is replacing this file and the pinned streams of its test.

### The app

- `main.ts` creates the compressor once and gives it to `createEngine` and to `App` (a third argument of its constructor, after the view a test passes).
- `PanelHost` gets `readonly deflater?: Deflater`, and `panels/export.ts` saves a set as `zip(files, host.deflater)`. A host without one (the tests of the form) saves the set stored, as today.
- The status line says the size it has always said (`Exported model.3mf (… bytes).`), now of the smaller file.

The set could stay stored and this design would still do what the owner asked. It is in because the same writer is called, the gain is the largest measured (STL is 4.3 to 4.9 times smaller) and the cost is one member of the host; it can be left out without touching the rest.

### MCP

- `packages/mcp/src/main.ts` gives its engine the compressor. That is the whole change of `packages/mcp/src`.
- The tool `export` writes what the engine returns; `export-writer.ts` does not look into a file. A set is written as loose files, as before: nothing is zipped by the server.
- When the engine runs in the app, the file crosses the bridge as base64; the 3MF of the joint is 222 kB of it instead of 1.4 MB.
- `packages/mcp/package.json` names `@trymesh/deflate-pako` and `pako`: the bundle keeps third-party libraries outside (`vite.config.ts`), and Node finds them from `packages/mcp/node_modules`, as it finds `manifold-3d`.
- `describe_api` shows the new summary. The port is in the part of `types.ts` the description leaves out.

## Where the code lives

| File | What the addition does there |
|---|---|
| `packages/engine/src/types.ts` | the port `Deflater`, in the section of the ports |
| `packages/engine/src/engine.ts`, `index.ts` | `EngineDeps` (`Deps` with `deflater?`), exported; `queryDeps` carries the compressor |
| `packages/engine/src/query/context.ts`, `query/spec.ts` | `ContextDeps.deflater?`; `QueryContext.deflater?` |
| `packages/engine/src/export/zip.ts` | `storedZip` becomes `zip(entries, deflater?)` |
| `packages/engine/src/export/threemf.ts` | `threeMfPackage(objects, deflater?)`; `run` passes the compressor of its context; the summary |
| `packages/deflate-pako/` | new: `package.json`, `src/index.ts` (`createPakoDeflater`), `test/deflater.test.ts`. The root `tsconfig.json`, `vitest.config.ts` and `pnpm-workspace.yaml` take it by their patterns |
| `packages/mcp/src/main.ts`, `package.json` | the compressor for the engine of the server; the two dependencies |
| `packages/app/src/main.ts`, `app.ts`, `host.ts`, `panels/export.ts`, `package.json` | the compressor for the engine and for `App`; `PanelHost.deflater`; `zip` for a set; the dependency on the adapter |
| `packages/engine/test/zip-reader.ts` | reads an entry that is stored or deflated |
| `packages/scenarios/test/kit.ts`, `packages/mcp/test/kit.ts`, `packages/app/test/app-kit.ts`, `packages/scenarios/package.json` | the engines of the tests with real adapters get the compressor: a line each |
| Documents | `docs/architecture/ports.md` (the third port and its guarantees), `api.md` (`createEngine`, `zip`, the format `3mf`), `repository.md` (the package, `export/zip.ts`), `verification.md`; `docs/ui/bodies.md` ("Save a set"); `docs/decisions.md` (D2, D54); `CLAUDE.md` (the list of approved libraries, the diagram and the sentence about the adapter packages) |

The imports of the engine do not change direction: `types.ts` is a leaf, and `export/zip.ts` and `query/spec.ts` import the port as a type.

The order of the work: the engine with its tests (the port, the writer, the reader of the tests; the built app and server do not change yet, since nothing gives them a compressor); the adapter package, where the library enters the repository; the two `main.ts`, the kits, the scenario and the snapshots; the documents. The first step does not need the owner's approval of the library, the second does.

## What the addition adds

| To | What |
|---|---|
| The document, commands, queries, feature types, `FEATURE_UI`, face roles | nothing |
| Issue codes | none. One more reason for the refusal `failed` of an export: a compressor that throws |
| The ports | `Deflater`, optional in `createEngine` |
| The index of the engine | `zip` in place of `storedZip`; the types `Deflater` (with `types.ts`) and `EngineDeps` |
| `Engine` | no method. So no tool, and no row in the typed table of `packages/mcp/test/coverage.test.ts` |
| Export formats | none; `3mf` writes a smaller file and has a new last sentence in its summary |
| MCP | one line of `main.ts`; the description of the format |
| The app | the compressor at `PanelHost`; the ZIP of a set compressed |
| Packages | `packages/deflate-pako` |
| Third-party libraries | `pako` 3.0.3, for the owner to approve (D2) |

## The schema

No step. Nothing is stored: an export reads a state and returns bytes. `SCHEMA_PENDING` is not touched.

## What 5b gets

- `zip` instead of `storedZip`, and the compressor at `PanelHost`: the set of a robot description (XML and STL meshes in folders) is saved by the app as one compressed ZIP with no code of 5b.
- `context.deflater`, should a format ever have to pack files itself.
- The other helpers are untouched: `xmlText`, `plain`, `float32Text`, `chosenBodies`.
- The server still writes a set as loose files; the folders of a set are still 5b's.

## Rejected alternatives

1. **`fflate` 0.8.3.** The runner-up, and the better one by size and by being in the tree already. Not taken for the reasons under "The library": its stream is not zlib's, in one case in a way a reader in the field is reported to refuse; 2.5 % larger files; the state of its issues. The port makes the choice cheap to revisit.
2. **`uzip`, `zlibjs`.** As fast or slower, no types, not published since 2020 and 2017.
3. **Compression outside the engine, with what the platforms have built in**: `node:zlib` in the writer of the server and `CompressionStream` in the form of the app, whose save could wait for a promise. No library at all, and it is rejected alternatives 3 and 4 of design.md again. `Engine.export` would go on returning a stored file, so what a format writes would depend on who saves it (the scenarios and any other caller of the engine would never see the file a user gets); the saver would have to open the package the engine made and write it again, which is a ZIP reader in the product; and the app and the server would write different bytes for one model. The owner asked for a library. The port keeps this open where it fits: `{ deflate: (bytes) => deflateRawSync(bytes) }` is a `Deflater` for a caller that runs in Node only, and it is what the tests of the engine use.
4. **A port that writes the ZIP** (`zip(entries)`, over the ZIP writer of a library). The engine's writer would be dead code or a second path, its refusals and its date of 1980 would become the library's to keep (`fflate`'s `zipSync`: "ZIP and GZIP support mtime (defaults to current time)"), and a test double would be a ZIP writer instead of three lines.
5. **A required port.** One behaviour instead of two, and a composition could not forget it. But nineteen places of the tests would pass a compressor they never call, the engine would refuse to start without something it can do without, and the stored file is a valid 3MF, the one shipped today.
6. **The compressor as a third argument of `run` of a format**, or as a function `zip` handed to it. The kernel is a member of the context; a second way to hand a port to the same code is one more thing to know.
7. **`Engine.zip(entries)`**, so the app would not need the compressor itself. A method of `Engine` needs a tool of the server by the rule of the project, and a tool that zips files is not a function of a CAD model.
8. **Every entry deflated, also when the stream is longer.** Simpler by one comparison, and a file of noise would grow. The rule "shorter, else stored" is also what keeps the writer without a compressor identical to today's.
9. **Only the model part deflated.** The two small items are 82 and 122 bytes smaller deflated; a rule by name would be a special case in a writer that has none.
10. **`about` with a field for the compression.** See "The format `3mf`".
11. **`pako`'s default hash.** 0.3 to 0.5 % smaller files and 11 to 14 % less time, for bytes of a hash added in June 2026 that match "recent (chromium) node.js output" (`pako.d.ts`) and not zlib: on this machine `node:zlib` itself gives the bytes of zlib, so there is nothing at hand to hold them against.
12. **Level 9, or level 3.** See "The level".
13. **Inflating every stream at run time to check it.** It would double the library in the bundle (`pako`'s inflate) and check the compressor with its own author's inflater. The tests check every file they write with `node:zlib`.
14. **A compressor in WASM.** Loading would be asynchronous at creation, as the kernel's is, which the project allows; the two on npm are `wasm-flate` (no licence stated) and `zlib-wasm` (a wrapper of `pako` 1), both of 2020. At 45 ms for a megabyte there is nothing to win.
15. **Deflate written in the engine.** Rejected alternative 2 of design.md stands: a compressor nobody else ever ran.
16. **`storedZip` kept beside `zip`.** Two names for one function with and without its optional argument.

## Known limits

- **An engine that was not given a compressor writes stored files, without a word.** The app and the server give theirs one; a composition that forgets it produces the 3MF of today. The answer of the tool shows the size, and the two compositions are tested ("Tests the implementation owes"), `main.ts` of the app only by hand.
- **The bytes of a file now depend on the library**: on `pako` 3.0.3 with level 6 and `legacyHash`. A newer version may write other bytes that are as valid; the version is pinned exactly and the test of the adapter pins streams, so a change is seen and said in its commit. The bytes of an engine without a compressor do not change.
- **Nothing checks at run time that a stream inflates back.** A defect of the compressor would be a file that does not open. What stands against it: the stream is zlib's, the tests inflate every file they write with another implementation, and the hand check with independent readers.
- **The export takes longer**: about 12 ms instead of 4.6 for the box and 77 ms instead of 31 for the joint, in one synchronous call. 17 MB of model text took 0.73 s. A compressor in pieces or in a worker is deferred.
- **Memory.** While an item is compressed, its bytes, its stream and the buffers of the library are alive together; the item is not given back to the collector sooner than before.
- **The limits of the ZIP are those of design.md**, with one shift: the 4 GiB together are counted on what is written, so a package can now hold more model than before.
- **Not seen on Windows, nor in the window of a slicer.** The readers were Info-ZIP, libarchive, `ditto`, Python, `lib3mf`, the command line of BambuStudio and the inflaters of Node, Chrome and Firefox. The fourth question of design.md (which programs the owner checks the files in) covers the deflated file too.
- **`pako` 3.x is five months old** (3.0.0 on 26 June 2026), and its maintenance is the work of very few people, as is that of every candidate.
- **Two licences.** MIT asks that its notice "be included in all copies or substantial portions of the Software"; the zlib licence, for the ported code, that the origin is not misrepresented and altered versions are marked. A build of the app or of the server that is given to others carries `pako`'s code and owes its notices, as it owes those of the other libraries today. Nothing is distributed yet.
- **The tests cannot use an independent ZIP reader** (design.md); for the stream they now have one, `node:zlib`, in every run.

## To verify before the implementation

- **The owner's approval of `pako` 3.0.3** (D2), before the second step of the work.
- After `pnpm install` with the adapter package: the lockfile gains `pako@3.0.3` and nothing else (the registry says it has no dependencies).
- The MCP bundle builds with `pako` left outside and the server started from `packages/mcp/dist/server.js` writes a deflated 3MF: that Node finds the library from there.
- The app built by Vite and opened in a browser saves a deflated 3MF and a deflated `stl.zip`: the wiring of `main.ts`, which no test covers, and the first run of the library inside the real bundle.
- The deflated files of the scenario in the window of the slicer the owner uses, with the check of design.md.
- That the snapshots of the app change only where this design says (below).

## Tests the implementation owes

- **`zip`** (engine, no library): everything `storedZip` is tested for, unchanged, for `zip(entries)`. With a compressor of the test over `node:zlib`: an entry that compresses is deflated and reads back; one with no bytes and one of noise are stored; a name that is not ASCII keeps its flag; the same call twice gives the same bytes. With a compressor that answers from a table (forty letters `a` as `4b 4c 24 0e 00 00`): the whole archive pinned to the byte, 114 bytes, with the method 8, the version 20, the two sizes and the CRC of the letters. A stream as long as the bytes is not written (not shorter). A compressor that throws, and one that answers with a plain array: `failed` with the text. The refusals of the count, the names and an entry of 4 GiB come before the compressor is called (a compressor that counts its calls).
- **The reader of the tests**: refuses an entry of another method, a deflated entry whose stream is cut, one with bytes after its last block, one whose inflated length or checksum differs, and a deflated entry that is not shorter than its bytes.
- **`3mf`** (engine): the pinned file of a small model stays as it is for an engine without a compressor; with the compressor over `node:zlib` the three items are deflated and hold the same bytes; a compressor that throws is the answer `failed` of `export`, with the format in its text.
- **The adapter** (`packages/deflate-pako`): the guarantees of the port against `node:zlib` as the inflater, over the inputs of "The edges of a stream" but the two large ones; the input unchanged, the result an array of its own; the streams of fixed inputs pinned (the forty letters, and a text of a few kilobytes by its length and hash), with the note that they are zlib's at level 6.
- **Scenario 12**, the part of `calls.ts`: the engine of the kit has the compressor; the three items deflated and equal to those of an engine without one; a fifth of the STL where the test says a fifth more today; everything else of the part of 2g unchanged, through the reader.
- **MCP**: `server.test.ts` reads the 3MF it wrote through the reader instead of looking for text in the raw bytes, and finds the items deflated; that is also the test of the composition of the kit. The list of formats and the two typed tables do not change.
- **The app**: `export-form.test.ts` with a host that has a compressor (a set deflated) and without (stored, as now); a compressor that throws shown as the problem of the form. The snapshot `export.txt` changes in three sizes (`model.3mf` twice, `stl.zip`), and twelve snapshots change in the one sentence of the summary of `3mf` they record with the toolbar; the commit says so.
- **By hand, once**, as under "Measured": the files of the implementation are those of the prototype (the same sizes and hashes), read again by the same readers; recorded in `docs/architecture/verification.md`.

The engine part writes a file format and adds a port: a full review. The wiring of the app is a light one by the table of CLAUDE.md; the point as a whole gets the deeper.

## Open

One question for the owner:

1. **Is `pako` 3.0.3 approved (D2)?** Licences MIT and Zlib, no dependencies, 33 kB in the bundle of the app, used only by `packages/deflate-pako` behind the port `Deflater`. *Yes* lets the implementation start. *No, take `fflate`* (0.8.3, MIT, 9 kB, already in the tree) changes the adapter package and nothing else of this design; the files are then 2.5 % larger and carry the reported defect of a block without a back-reference.

The four questions of design.md are as they were; this addition answers the first.

## Reviews

The owner's rule for designs: three independent reviewers, read-only, with one brief: a fresh internal subagent, `codex` (gpt-6-astra, high) and `agy` (gemini-4-argon-high). Every finding is checked against the code, a source or a measurement before it is acted on.

(The rounds are recorded here.)

## Rows for the indexes

**`docs/d36/README.md`, the row of 2g, column "Design now", added at its end:**

> Addition of 2026-11-17 ([2g-export/deflate.md](2g-export/deflate.md)), designed, not implemented: the 3MF compressed (owner, 2026-11-17). A third port `Deflater` (a raw DEFLATE stream), optional in `createEngine`; the engine's ZIP writer becomes `zip(entries, deflater?)` and deflates an entry whose stream is shorter; the adapter package `packages/deflate-pako` over `pako` 3.0.3 (waits for the owner's approval, D2); the app compresses the ZIP of a set too; no schema step. 5b gets `zip` and the compressor at `PanelHost`

In "Shared places", a row: the ports of `createEngine` (`types.ts`, `engine.ts`, `query/context.ts`): the addition of 2g adds `Deflater`; and the list of packages gains `packages/deflate-pako`.

**`docs/decisions.md`, D54**, the second column gets, after the owner's decision of 2026-11-17:

> Designed on 2026-11-17 as an addition ([deflate.md](d36/2g-export/deflate.md)): the library is `pako` 3.0.3, behind a port of the engine; not implemented, waits for the approval of the library

and the third column, in place of "in a ZIP the engine writes uncompressed":

> in a ZIP the engine writes, its parts deflated by the compressor the engine was given (the port `Deflater`; the adapter `packages/deflate-pako` over `pako`), about a fifth of the size of the STL, and stored when it was given none

**`docs/decisions.md`, D2**, a paragraph, with the date of the owner's yes:

> Approved on (date): `pako` 3.0.3 (`github.com/nodeca/pako`; licences MIT and Zlib; no dependencies), a port of zlib's deflate to JavaScript, to compress the parts of a 3MF package and of a ZIP the app saves (D54, [d36/2g-export/deflate.md](d36/2g-export/deflate.md)). It sits behind the port `Deflater` of the engine (`deflate(bytes)`: a raw DEFLATE stream) and is imported by the adapter package `packages/deflate-pako` alone, called as `deflateRaw(bytes, { level: 6, legacyHash: true })`; the engine has no dependency and works without a compressor (its files are then stored). Chosen over `fflate` 0.8.3 because its stream is that of zlib byte for byte.

and "Approved" in `CLAUDE.md`, "Rules of the project", gains `pako` once the owner says so.

**`docs/requirements.md`, scenario 12, the part of 2g**: in its first sentence, "a ZIP of three stored items the engine writes itself" becomes

> a ZIP of three items the engine writes itself, each deflated by the compressor the engine was given, so that the file is a fifth of the size of the STL of the same bodies (and the same three items stored when the engine was given none)
