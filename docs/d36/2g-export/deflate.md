# 2g, an addition: the 3MF compressed (D54)

**State: designed on 2026-11-17; implemented on 2026-11-17 with `pako` 2.1.0 in place of 3.0.3 ("As implemented", at the end).** This is its third version, after two rounds of reviews ("Reviews"). An addition to [design.md](design.md), which is implemented and merged with a 3MF whose parts are stored. Written against the code of `master` at `633a6ca`. The compressors were measured and the writer was prototyped in the session scratchpad; the files were read back by independent readers ("Measured"). While it was designed, nothing under `packages/` was changed and no library was installed in the repository.

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
| `storedZip` is also what the app saves a set with | `panels/export.ts` calls it for an export of the layout `directory` (`stl` with `perBody`; later the robot description of 5b). The owner's decision is about the 3MF; the set is the second question of "Open" |
| The tests read a ZIP back with a reader of their own | `packages/engine/test/zip-reader.ts`, used by the tests of the engine, scenario 12 and the app; it refuses an entry that is not stored. Some tests look into the raw bytes of a 3MF or pin its size (`scenario12.test.ts`, `server.test.ts`, the snapshot `export.txt`), and twelve snapshots of the app record the summary of the format with the toolbar |

## The cheap variant

- **A third port, `Deflater`**, beside the solver and the kernel: one function, `deflate(bytes)`, that returns a raw DEFLATE stream. `createEngine` takes it and may go without it.
- **The engine keeps its ZIP writer.** `storedZip` becomes `zip(entries, deflater?)`: an entry is written deflated when a compressor is given and its stream is shorter than its bytes, and stored otherwise. Without a compressor the bytes are those of today.
- **The format `3mf`** passes the compressor of its context to the writer. Nothing else of the format changes.
- **An adapter package, `packages/deflate-pako`**, is the one place that imports the library. The app and the server create it and give it to their engine, as they do with the solver and the kernel: a line of each `main.ts`.
- **Nothing of the document changes**: no command, no query, no feature type, no schema step. No tool, and no code of `packages/mcp/src` but one line of `main.ts`.

**Deferred:**

- **The ZIP of a set of the app compressed.** It stays stored, as it is: the owner asked for the 3MF. The gain would be the largest measured (STL is 4.3 to 4.9 times smaller) and the cost a member of `PanelHost` and an argument of `App`; "The app" has the design, and the second question of "Open" asks.
- ZIP64, and with it a package over 4 GiB or 65 534 entries (as before).
- A choice of the level by the caller. The adapter has one, fixed.
- A compressor that works in pieces (a stream), and one in a worker: an export stays one synchronous call. A model whose 3MF takes long to compress would need it; the largest measured is 17 MB of model text in 0.73 s.
- A check at run time that the stream inflates back to the bytes.

## Sources

Nothing about a library or a format is taken from memory. Every claim below was read on 2026-11-17 in these places:

| Source | Read for |
|---|---|
| The npm registry, `registry.npmjs.org/<package>` (the document of each package), `api.npmjs.org/downloads/point/last-week/<package>` and `api.npmjs.org/versions/<package>/last-week` | versions and their dates, licences, dependencies, entry points, unpacked sizes, the descriptions and READMEs of the packages that were not installed; downloads of the week of 9 to 15 November 2026, of a package and of each of its versions |
| `pako` 3.0.3 as installed from the registry (integrity `sha512-tmrebBBY…kVeZAQ==`): `README.md`, `LICENSE`, `package.json`, `dist/pako.d.ts`, `dist/pako.mjs`; and `pako` 2.1.0 and 2.2.0 as installed, to compare the lines | what it is, the API and its options, the licences, the entry points, what the code touches of its environment |
| `github.com/nodeca/pako`: `CHANGELOG.md`, `src/zlib/README`, and through the GitHub API the repository and its open issues | the history of the 2.x and 3.x lines, which zlib it follows and under which licence, the state of maintenance |
| `fflate` 0.8.3 as installed (integrity `sha512-tbZNuJrL…CsPvgA==`): `README.md`, `CHANGELOG.md`, `LICENSE`, `package.json`, `lib/index.d.ts`, `esm/browser.js`, `esm/index.mjs` | the same for the runner-up |
| `github.com/101arrowz/fflate` through the GitHub API: the repository, and the open issues 296, 314, 260, 282 and 267 | the state of maintenance; reports about its output |
| `uzip` 0.20201231.0 and `zlibjs` 0.3.1 as installed: `README`, `LICENSE`, `package.json`; `github.com/photopea/UZIP.js` and `github.com/imaya/zlib.js` through the GitHub API | the two older candidates |
| `pnpm-lock.yaml` of `master`; `manifold-3d` 3.5.5 (`package.json`, `lib/export-3mf.js`), `@types/three` 0.187.0 (`package.json`) and `three` 0.187.0 (`examples/jsm/libs/fflate.module.js`) in `node_modules` | where `fflate` already is in the tree |
| RFC 1951, DEFLATE Compressed Data Format Specification (`rfc-editor.org/rfc/rfc1951.txt`) | the format of a stream: blocks (3.2.3), stored blocks (3.2.4), dynamic codes and a block without a distance code (3.2.7) |
| .ZIP File Format Specification 6.3.10, PKWARE (the copy read for design.md) | a file with no content (4.3.8), version made by and needed (4.4.2, 4.4.3), the bits of the flag for method 8 (4.4.4), the methods (4.4.5), the CRC and the sizes (4.4.7 to 4.4.9), the method Deflate (5.5) |
| 3MF Core Specification 1.4.0 and ECMA-376 part 2, fifth edition (the copies read for design.md) | which methods a package may use (3MF 1.1; OPC 7.3.6 and annex B, tables B.2 to B.5) |
| `github.com/madler/zlib`, `trees.c` (branch `master`) | why zlib never writes a block without a distance code |
| Compression Standard, WHATWG, Living Standard (last updated 19 October 2026) | what a browser has built in: `CompressionStream`, a stream, with the format `deflate-raw` |

## The library

**The candidates.** Everything on npm that compresses to deflate in JavaScript and that the search for the two examples of the task led to, with what the registry says of each:

| Package | Latest, published | Licence | Dependencies | Why it was or was not measured |
|---|---|---|---|---|
| `pako` | 3.0.3, 2026-10-26 | `(MIT AND Zlib)` | none | measured; its older lines 2.1.0 and 2.2.0 too (below) |
| `fflate` | 0.8.3, 2026-05-16 | MIT | none | measured |
| `uzip` (UZIP.js) | 0.20201231.0, 2020-12-31 | MIT | none | measured; the package has not been published since 2020 (its repository has four commits since), it has no types and is a CommonJS object |
| `zlibjs` (zlib.js) | 0.3.1, 2017-07-06 | MIT | none | measured; last commit of its repository 2017-12-30; its raw deflate has no levels |
| `jszip` | 3.10.2, 2026-09-08 | `(MIT OR GPL-3.0-or-later)` | `pako` ~1.0.2 and three more | no: a ZIP library whose writer is `generateAsync`; its compressor is `pako` 1 |
| `@zip.js/zip.js` | 2.25.0, 2026-11-12 | BSD-3-Clause | none | no: a ZIP library with promises throughout (`await zipWriter.add`), 8.7 MB unpacked |
| `client-zip` | 2.5.1, 2026-09-14 | MIT | none | no: "It does *not* compress the files" (its README) |
| `browserify-zlib`, `zlib-wasm` | 2017-06-03, 2020-06-13 | MIT, "MIT & zlib" | `pako` 1 | no: wrappers of `pako` 1 |
| `wasm-flate` | 1.0.2-browser, 2020-03-25 | none stated | none | no: no licence in the registry |
| `@stardazed/zlib`, `zlib-asm` | 2020-08-16, 2016-08-17 | Zlib, zlib | none, one | no: two and nine versions, the last six and ten years old |
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
| Releases | five in 2026 (2.2.0 in June to 3.0.3 in October); before them 2.1.0 of November 2022 | one of its current line since February 2024 (0.8.3, May 2026), and four backports to older lines in July 2026 | none since 2020 | none since 2017 |
| Open in its repository | 4 issues, 1 pull request; none about `deflateRaw` (a streaming class with a flush and a tiny chunk, two about inflate, the types of an entry point the adapter does not use) | 34 issues, 24 pull requests; among them the reports below | 1 | 38 |
| Downloads in a week, the package | 191 million | 161 million | 2 million | 6 million |
| Downloads in a week, this version | **0.5 million** (all of 3.x: 1.5 million; 2.2.0: 19.8; 2.1.0: 17.9; 1.0.11: 105.8) | **90.3 million** | | |
| Already in the tree | no | yes: a dependency of `manifold-3d` 3.5.5 (its own 3MF export) and of `@types/three`, and `three` ships a copy | no | no |

**The choice: `pako` 3.0.3, called as `deflateRaw(bytes, { level: 6, legacyHash: true })`.** The reasons, in the order of their weight:

1. **Its stream is the stream of zlib, and that can be checked by anyone.** A file format is judged by the programs that read it, and every inflater in the field has been tested against what zlib writes. `pako` is a port of zlib's deflate, and with `legacyHash` (the hash of zlib; "matches canonical zlib output byte-for-byte", `pako.d.ts`) its output was measured to be the output of zlib byte for byte, on both model parts at the levels 1, 3, 6 and 9 and on the edges of a stream: of zlib 1.2.12, the system's (reached through the `zlib` module of Python and through `node:zlib`, which on this machine are that one library), and of zlib 1.3.2, the version the port says it follows, a separate build called directly. (The reviewers repeated it on inputs of their own.) So "this stream is valid" does not rest on this project's tests of a compressor, and the streams a test pins have a reference outside the project.
2. **The files are smaller**: 2.5 % for the box and the joint (29 823 against 30 583 bytes, 166 268 against 170 468), at 13 to 20 % more time (1.2 ms and 5.2 ms).
3. **The state of the repositories.** `pako` had five releases in the last five months and has four open issues, none about the function the adapter calls. `fflate` has 34, among them reports of this year that its streaming classes write streams other inflaters refuse (260, 282, 267: not the function the adapter would call, which the reports themselves found correct), that level 0 writes a wrong stream for an input of a multiple of 65 535 bytes (314: not the level the adapter would use), and the one below.
4. **`fflate` writes a block that zlib avoids on purpose.** For data with no back-reference, `deflateSync` writes a dynamic block with one distance code of length zero (its issue 296, run again here: the stream starts `05 c0 83 11 c3`, HDIST 1, lengths `[0]`). RFC 1951 allows it (3.2.7: "One distance code of zero bits means that there are no distance codes used at all"). zlib does not write it: "The pkzip format requires that at least one distance code exists ... So ... we force at least two codes of non zero frequency" (`trees.c`), and `pako` and zlib write the same input as `05 c1 07 02 42`, two codes of length 1. The report says the ZIP viewer of Windows refuses such an entry; it is one report without an answer, every reader at hand here takes the entry, and Windows was not tried. **It has little weight for this design**: the parts of a 3MF always have back-references (measured: 8 to 27 distance codes in every part), so no file the engine writes would hold that block. It would matter for a set of the app, were that compressed, when it holds a small file with nothing repeated. It is here as the one measured case where the stream of `fflate` and the stream of zlib differ in kind.

What speaks for `fflate`, said as plainly:

- **The version in question is used 180 times as much**: 90 million downloads a week of 0.8.3 against half a million of `pako` 3.0.3. Among those users are 3MF files: `manifold-3d` writes its own with `fflate`'s `zipSync`.
- **It is a quarter of the size**: 24 kB less of minified code. The app already loads `three` and two WASM modules; 24 kB does not change what it is.
- **It is already in `node_modules`**, at the same version, because `manifold-3d` and `@types/three` depend on it. That makes the lockfile one package shorter than with `pako` (which has no dependencies of its own). It does not make it approved: a library the project's own code imports needs the owner's yes either way.
- **One licence instead of two.** Both of `pako`'s are permissive; see "Known limits" for what they ask.

What speaks against `pako` 3.0.3:

- **The 3.x line is five months old and little used, and 3.0.3 itself is three weeks old.** 3.0.0 (26 June 2026) moved the sources to TypeScript and changed the exports; it is a major version that a user has to choose, and 0.8 % of `pako`'s downloads are of it. 3.0.2 ported a fix of zlib that had been missed (for the strategy `Z_FIXED`, which the adapter does not use).
- **In 3.x the adapter does not take the default path.** `legacyHash` is `false` by default since 3.0.0 (`CHANGELOG.md`), so what the users of 3.x mostly run is the other hash; the hash the adapter selects is the default of 2.2.0 and the only one of 2.1.0. The gap in field use is larger than the numbers per version show, and the evidence for this path in 3.0.3 is the comparison of bytes below.
- What stands against that: **the bytes the adapter gets are those of the old lines.** `pako` 2.1.0 (November 2022, 18 million downloads a week) and 2.2.0 give, with their defaults, the same streams as 3.0.3 with `legacyHash`: measured in Node on both model parts and on five edges, at the same speed. The option selects the hash those versions had; the default of 3.x is a newer hash (added in 2.2.0, June 2026), which the adapter does not use. The version is pinned exactly.
- **`legacyHash` costs time**: 7.3 against 6.3 ms and 44.7 against 40.0 ms, for bytes that can be checked against zlib. The files are 0.3 to 0.5 % larger than with the default hash.

**The older lines of `pako`**, since they give the same bytes:

| Version | Published | Downloads in the week | Types in the package | The call in the bundle | Time once warm, box and joint |
|---|---|---|---|---|---|
| 3.0.3, `legacyHash: true` | 2026-10-26 | 0.5 million | yes | 33.4 kB | 7.4 ms, 44.6 ms |
| 2.2.0 | 2026-06-22 | 19.8 million | no | 63.1 kB from its main entry, which brings inflate along; 38.1 kB from `pako/lib/deflate.js`, its entry for deflate alone (CommonJS) | 7.2 ms, 44.1 ms |
| 2.1.0 | 2022-11-07 | 17.9 million | no | 62.8 kB from its main entry | 7.1 ms, 44.0 ms |

3.0.3 is taken: it is the line that is maintained, it is one ES module for Node and a bundler, and it has its types (2.x would need a declaration written by hand in the adapter, or `@types/pako`, a second package to approve). The size is no reason: 5 kB. If the owner wants the version with the field use, 2.2.0 is the same adapter with another number in its `package.json`, the import of its deflate entry and a declaration of one function; the files do not change by a byte. It was run in Node only, so the check in a browser would be owed with it.

Should the owner prefer `fflate` after all, the design holds as it is: the port, the writer and the tests of the engine do not name the library. What changes with the library is the adapter (one file and the streams its test pins), its name where it is composed (the two `main.ts`, the three kits, three `package.json`), and the sizes of files written through it that a test or a snapshot records.

**The level.** Level 6, the default of zlib. Measured with the adapter's hash, box and joint:

| Level | Times smaller | Time once warm |
|---|---|---|
| 1 | 4.86, 5.08 | 1.8 ms, 12.4 ms |
| 3 | 5.28, 5.42 | 2.9 ms, 19.2 ms |
| 6 | 6.08, 6.43 | 7.3 ms, 44.7 ms |
| 9 | 6.44, 6.75 | 36.4 ms, 233.1 ms |

Level 9 makes the file 5 % smaller for five times the time; level 3 saves 25 ms on the joint and makes its file 19 % larger. The level is fixed in the adapter and stated there, with `legacyHash`, so no default of the library decides the bytes.

## Measured

The spike (2026-11-17, session scratchpad, directory `2g-deflate`): Node 25.9.0 on an Apple M5, macOS 27.0.1. The libraries were installed with `npm install --ignore-scripts` into directories of the scratchpad, never into the repository.

- `gen/models.spike.ts`, run by Vitest against the sources of the worktree with the real adapters: builds the box of scenario 12 (every step of `box.ts`, as the part of 2g of the scenario does) and the joint of scenario 9, and writes what `engine.export('3mf', {})` and `engine.export('stl', {})` return. The files have the sizes design.md states (177 803 bytes for the box, 177 999 with a name, a colour and a material set, 1 066 092 for the joint).
- `bench/one.mjs`, `bench/bench.mjs`: one compressor, one level, one input in a process of its own, five processes per row; the driver refuses a row whose streams differ between processes or calls, that `node:zlib` does not inflate back to the input, or whose input was changed. `bench/lines.mjs`: the three lines of `pako` side by side.
- `proto/zip.mjs`, `proto/reader.mjs`, `proto/write.mjs`, `proto/mixed.mjs`: the writer of `master` with the one branch of this design, the reader of the tests with deflate, and the files written again and read back. `proto/issue296.mjs`: the report about `fflate`.
- `tools/read3mf.py`: `zipfile` of Python and `lib3mf` 2.5.0 in strict mode, from the Python environment the spike of design.md left in the scratchpad.

**The compressors**, on the model parts (box 177 078 bytes, joint 1 065 171 bytes), level 6. "First" is the first call in a fresh process, the best of five processes; "warm" is the fastest of the 75 calls that followed. The machine ran other work during two of three runs; these are of the third, on a quiet machine, and the sizes and hashes were the same in all three.

| Compressor | Box: bytes, times smaller | Box: first, warm | Joint: bytes, times smaller | Joint: first, warm |
|---|---|---|---|---|
| `pako` 3.0.3, `legacyHash` (the adapter) | 29 106, 6.08 | 19.8 ms, 7.3 ms | 165 551, 6.43 | 57.6 ms, 44.7 ms |
| `pako` 3.0.3, its default hash | 28 968, 6.11 | 16.0 ms, 6.3 ms | 164 980, 6.46 | 51.3 ms, 40.0 ms |
| `fflate` 0.8.3 (`mem` 8 or its default: the same bytes) | 29 865, 5.93 | 16.0 ms, 6.1 ms | 169 750, 6.27 | 49.1 ms, 39.5 ms |
| `uzip` 0.20201231.0 | 29 865, 5.93 | 11.4 ms, 6.1 ms | 169 749, 6.27 | 45.8 ms, 37.4 ms |
| `zlibjs` 0.3.1 (no level) | 29 814, 5.94 | 29.8 ms, 19.4 ms | 171 642, 6.21 | 153.8 ms, 130.4 ms |
| zlib 1.2.12 itself, through `node:zlib` of this Node, for comparison | 29 106, 6.08 | 5.5 ms, 4.2 ms | 165 551, 6.43 | 27.5 ms, 26.4 ms |

- **zlib.** The Node of this machine is built against the system's zlib (`process.config.variables.node_shared_zlib` is true, version 1.2.12), and so is Python; the last row and Python's `compressobj(level, DEFLATED, -15)` are therefore the same library. Both give the streams of `pako` with `legacyHash` at the levels 1, 3, 6 and 9, on both inputs (eight streams, compared by SHA-256). A second zlib, 1.3.2 as Homebrew builds it, called through `ctypes` (`tools/zlib132.py`: `deflateInit2` with the window −15 and the memory level 8), gives the same eight streams, and the forty letters as the same six bytes. A Node as it is distributed carries another zlib, whose output `pako`'s documentation says its default hash matches; that was not at hand. design.md's figure for "the model part deflated (zlib, level 6)", 29 112 and 165 557 bytes, is these streams with the six bytes of a zlib wrapper.
- `pako` 2.1.0 and 2.2.0 with their defaults give the same two streams as 3.0.3 with `legacyHash`, and the same streams for no bytes, one byte, 65 535 equal bytes, forty letters and 64 KiB of random bytes; all of these are the streams of zlib.
- `fflate` and `uzip` give the same bytes for the box at level 6 and for both inputs at level 9: the same method of compression.
- The bundles: an ES module with the adapter's one call, built by Vite 8.3.8 as the app is built (tree-shaken, minified): `pako` 3.0.3 33 367 bytes (9 031 gzipped), `fflate` 9 007 (3 646), `uzip` 22 606 (7 220); `pako` 2.1.0 62 819 (16 128) and 2.2.0 63 073 (16 302) from their main entry, a prebuilt file with inflate in it, and 2.2.0 38 147 (10 432) from `pako/lib/deflate.js`. The bundles of `pako` 3.0.3, of the deflate entry of 2.2.0, of `fflate` and of `uzip` give the bytes of the library called directly.
- `pako`'s `dist/pako.mjs` is one file for Node and for a bundler (`exports` of its `package.json` has no condition by environment). It does not name `require`, `process`, `Date`, `Math.random`, `Math.log`, `Worker`, `navigator` or a timer; of the globals it uses typed arrays and `TextEncoder` (for a string input, which the adapter does not give).
- The one-shot `deflateRaw` of 3.0.3 throws an `Error` (`throw new Error(deflator.msg)`) when the stream reports one: in practice for options out of range, and a `TypeError` for an input that is not bytes. (2.1.0, the version implemented, throws the message as a string for an error of the stream: "As implemented".)

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
| The whole export on `master`, stored (the median of seven, over four runs of the spike) | 5 to 8 ms | 5 to 7 ms | 31 to 33 ms | |
| The whole export with the difference of the writer added | 13 to 16 ms | 13 to 15 ms | 77 to 79 ms | |

The prototype writer without a compressor writes the files of `master` byte for byte. With `fflate` the three files would be 30 583, 30 437 and 170 468 bytes.

| Reader of the deflated files | What it said |
|---|---|
| `unzip -t` (Info-ZIP 6.00), `zipinfo -v` | no errors in any of the four; every item "deflated", sub-type "normal", version 2.0 to extract, made by 2.0 on MS-DOS, 1 January 1980, no extra field |
| `bsdtar` (libarchive), `ditto` of macOS | extract the three items of the box and of the joint with their sizes; the model part `bsdtar` extracts is that of the stored file |
| Python `zipfile` | `testzip()` finds no bad item; method 8, version 20; every part read is the part of the stored file, byte for byte |
| `lib3mf` 2.5.0, strict mode | no warning; what it reads of each deflated file equals what it reads of the stored one: the objects with their names (`Lid <A&B> "top"`), part numbers, counts, "manifold and oriented", the volumes to nine decimals (28 409.368025381 and 18 154.713184659), the two base materials, the build items; 2, 8 and 0 objects |
| BambuStudio 2.9.1, `--info` | both files load: 2 of 2 and 8 of 8 objects "manifold = yes", the box 80 × 50 × 30 with 1 440 facets and the volume 28 409.37, as for the stored files |
| The prototype reader (`node:zlib` as the inflater) | every item inflates to the item of the stored file; the inflater reads the whole stream of an item and nothing after it (a stream with bytes after its last block is reported as read short, a cut one throws) |

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

**Every kind of entry in one archive** (`proto/mixed.mjs`): forty letters (deflated, 6 bytes), an entry with no bytes (stored), 4 096 random bytes (their stream has 4 101 bytes, so the entry is stored), and an entry with a name that is not ASCII (deflated, the flag of UTF-8 kept). Read back by the prototype reader, `unzip -t`, `zipfile` (methods 8, 0, 0, 8; the random bytes equal) and `bsdtar`; `zipinfo -v` shows the versions 2.0, 1.0, 1.0 and 2.0 side by side, made by and to extract.

**A set of the app**, were it compressed. The STL files: the box and the lid in one file 146 384 to 33 642 bytes (4.35 times smaller), the joint 857 384 to 174 860 (4.90 times). The set of the box as the form saves it (`box.stl`, `lid.stl`): 146 670 bytes stored, 33 795 deflated, read back by `unzip -t`, `zipfile` and the prototype reader. The first blocks of the streams of the STL files use 28 and 29 distance codes (counted by the internal reviewer).

**The report about `fflate`** (its issue 296), run here: 96 bytes with no sequence of three repeated. `fflate` writes 64 bytes, a dynamic block with HDIST 1 and the code lengths `[0]` (and the forty letters as five bytes, `4b 24 12 00 00`, where zlib writes six); `pako` (either hash) and zlib write the same 68 bytes with HDIST 2 and `[1, 1]`. A ZIP of each is taken by `unzip -t`, `zipfile`, `bsdtar` and `ditto`. The first block of every part of the three packages, as `fflate` would write them, uses 8 to 27 distance codes.

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

**This reverses rejected alternative 3 of design.md**, "deflate as a port given to `createEngine`". Its first reason was that the same model would give different bytes by where the engine runs: that held for the built-in compressors it considered and falls with one JavaScript library on both sides. Its second, that a port would exist for one format, is accepted: D2 asks for the interface.

**Where it enters.** `createEngine(deps)` takes `EngineDeps`: the two ports it has, and `deflater?`. **It is optional.** An engine without it is a whole engine whose files are stored, which is the engine of today: the nineteen other places that create an engine (tests with fakes, with a kernel of their own or with plain real adapters, a spike) do not change, and a caller that embeds the engine without the library still gets a valid 3MF. The price is that a composition that forgets the compressor is not refused, and neither `main.ts` is loaded by a test: "Known limits" and "To verify before the implementation".

**How a format reaches it.** As it reaches the kernel: a member of its context, `QueryContext.deflater?`, set from `ContextDeps`. A query gets it too and has no use for it. Unlike the kernel of the context it is not wrapped: **a format hands it to `zip` and does not call it**, and `zip` is where a failure of the compressor becomes a refusal (below).

### The ZIP of the engine

`storedZip(entries)` becomes `zip(entries, deflater?)` in the same module. The records, the date, the CRC, the flag of a name that is not ASCII and every refusal stay as they are. One rule is new:

- **An entry is written deflated when a compressor is given, the entry has bytes, and the stream is shorter than the bytes.** Otherwise it is stored, exactly as today. So the writer never makes a file larger, a file that does not compress (random bytes: measured) costs the time and nothing else, and `zip(entries)` is `storedZip(entries)` byte for byte.
- A deflated entry has the method 8, the version 20 to extract, the bits 1 and 2 of its flag 0 ("normal"), the length of the stream as its compressed size, and the CRC-32 of its bytes, not of the stream.
- **The version made by is that of the entry**: 20 for a deflated one, 10 for a stored one, also in one archive. The specification calls the field the version "supported by the software used to encode the file" (4.4.2.3), which reads as one value for a writer; this writer states per entry what the entry uses, so a stored entry is the same bytes whatever else is in the archive. The readers took it ("Measured": `zipinfo` shows 2.0 and 1.0 side by side).
- An entry with no bytes is not given to the compressor: its stream would be two bytes, and the specification wants no data for it.
- The count of entries, the names and an entry of 4 GiB are refused before anything is compressed; the sizes together are of what is written and are checked after.
- **A compressor that fails** becomes `QueryFailure('failed')` in the writer, whoever calls it. For a format that is the answer `failed` of `export`, which the form of the app shows as its `problem`; the form's own call, `zip(files)`, has no compressor unless the owner says yes to the second question. The text is `the compressor failed: ` and then the message of the `Error` it threw (the thrown value as a text when it is no `Error`), or `it answered with <what typeof says> where bytes are expected` when it returned something that is not a `Uint8Array`.

`crc32` and `ZIP_NAME_LIMIT` stay exported. The name `storedZip` goes: the function no longer only stores. It has three callers, the format, the form of the app (which calls `zip(files)` and saves the set stored, as now) and its tests.

### The format `3mf`

`threeMfPackage(objects, deflater?)` passes the compressor to `zip`, and `run` passes `context.deflater`. With a compressor all three items come out deflated (the two small ones too: 319 to 197 and 260 to 178 bytes). Nothing else changes: the items and their order, the model part, the path, the media type.

- **`about` stays `{ bodies, triangles }`.** Whether the items are deflated is not something about the model: it is in the file, where every ZIP tool shows it, and the size is in the answer of the tool already (`bytes`).
- **The summary** of the entry changes in its last sentence, which says "not compressed" today (`contract.ts`, `THREE_MF_SUMMARY`): "The file is a ZIP, compressed when the engine has a compressor: about a fifth of the size of the STL of the same bodies; otherwise about a quarter larger than the STL." It is one text for every engine, so it says both, and it names no caller. It goes to `describe_api` and to the tooltip of the menu of the app.

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

`main.ts` creates the compressor and gives it to `createEngine`, one line. `packages/app/package.json` names the adapter package. The 3MF the form saves is the compressed one, and the status line says its size as it always did (`Exported model.3mf (… bytes).`). Nothing else of the app changes; `panels/export.ts` calls `zip(files)` where it called `storedZip(files)`.

**The ZIP of a set, if the owner wants it compressed** (the second question of "Open"; designed here so a yes needs no more design):

- `PanelHost` gets `readonly deflater?: Deflater`, and `panels/export.ts` saves a set as `zip(files, host.deflater)`. A host without one saves the set stored.
- `App` takes it as a third argument of its constructor, after the view a test passes; `main.ts` gives the same compressor to `createEngine` and to `App` (`new App(engine, undefined, deflater)`): two places that have to get it.
- `packages/app/test/app-kit.ts` needs it at both of its places as well, `createEngine(deps)` and `new App(engine, view)`.
- A set of 5b (XML and STL meshes) would then be saved compressed with no code of 5b.

It is not in by default because it is not what was decided, it adds to `PanelHost` and to `App`, and a stored set is no larger than the files it carries.

### MCP

- `packages/mcp/src/main.ts` gives its engine the compressor. That is the whole change of `packages/mcp/src`.
- The tool `export` writes what the engine returns; `export-writer.ts` does not look into a file. A set is written as loose files, as before: nothing is zipped by the server.
- When the engine runs in the app, the file crosses the bridge as base64; the 3MF of the joint is 222 kB of it instead of 1.4 MB.
- `packages/mcp/package.json` names `@trymesh/deflate-pako` and `pako`: the bundle keeps third-party libraries outside (`vite.config.ts`), and Node finds them from `packages/mcp/node_modules`, as it finds `manifold-3d`.
- `describe_api` shows the new summary. The port is in the part of `types.ts` the description leaves out.
- `exportMesh` and the tool `export_stl` are untouched.

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
| `packages/app/src/main.ts`, `package.json`; `panels/export.ts` | the compressor for the engine; the dependency on the adapter; the call renamed to `zip` |
| `packages/engine/test/zip-reader.ts` | reads an entry that is stored or deflated |
| `packages/scenarios/test/kit.ts`, `packages/mcp/test/kit.ts`, `packages/app/test/app-kit.ts`, `packages/scenarios/package.json` | the engines of the tests with real adapters get the compressor: a line each |
| Documents | `docs/architecture.md` (its diagram of the adapters and ports), `docs/architecture/ports.md` (the third port and its guarantees), `api.md` (`createEngine`, `zip`, the format `3mf`), `repository.md` (the package, `export/zip.ts`), `verification.md`; `docs/ui/bodies.md` ("Save a set": `zip`); `docs/decisions.md` (D2, D54); `CLAUDE.md` (the list of approved libraries, the diagram and the sentence about the adapter packages) |

The imports of the engine do not change direction: `types.ts` is a leaf, and `export/zip.ts` and `query/spec.ts` import the port as a type.

The order of the work:

1. The engine with its tests: the port, the writer, the reader of the tests. The one call of `panels/export.ts` is renamed with it. What the built app and server write does not change yet, since nothing gives them a compressor.
2. The adapter package, where the library enters the repository.
3. The two `main.ts`, the kits, the scenario and the snapshots.
4. The documents.

The first step does not need the owner's approval of the library, the second does.

## What the addition adds

| To | What |
|---|---|
| The document, commands, queries, feature types, `FEATURE_UI`, face roles | nothing |
| Issue codes | none. One more reason for the refusal `failed` of an export: a compressor that fails |
| The ports | `Deflater`, optional in `createEngine` |
| The index of the engine | `zip` in place of `storedZip`; the types `Deflater` (with `types.ts`) and `EngineDeps` |
| `Engine` | no method. So no tool, and no row in the typed table of `packages/mcp/test/coverage.test.ts` |
| Export formats | none; `3mf` writes a smaller file and has a new last sentence in its summary |
| MCP | one line of `main.ts`; the description of the format |
| The app | one line of `main.ts` and the dependency on the adapter; of its forms and panels only the name of the function `panels/export.ts` calls |
| Packages | `packages/deflate-pako` |
| Third-party libraries | `pako` 3.0.3, for the owner to approve (D2) |

## The schema

No step. Nothing is stored: an export reads a state and returns bytes. `SCHEMA_PENDING` is not touched.

## What 5b gets

- `zip` instead of `storedZip`. The set of a robot description is saved by the app as one ZIP, stored as today; compressed if the owner says yes to the second question.
- A format that has to pack files itself gives `context.deflater` to `zip`; it does not call the compressor.
- The other helpers are untouched: `xmlText`, `plain`, `float32Text`, `chosenBodies`.
- The server still writes a set as loose files; the folders of a set are still 5b's.

## Rejected alternatives

1. **`fflate` 0.8.3.** The runner-up: the better one by size, by the use of its current version and by being in the tree already. Not taken for the reasons under "The library": its stream is its own and not zlib's, the files are 2.5 % larger, and the state of its issues. The port makes the choice cheap to revisit.
2. **`pako` 2.2.0 or 2.1.0.** The same bytes with forty times the downloads, on the path that is their default. Not taken: no types in the package, a CommonJS entry for deflate alone (the main entry brings inflate along), and a line that is behind the maintained one. Named as the fallback under "The library".
3. **`uzip`, `zlibjs`.** As fast or slower, no types, not published since 2020 and 2017.
4. **Compression outside the engine, with what the platforms have built in**: `node:zlib` in the writer of the server and `CompressionStream` in the form of the app, whose save could wait for a promise. No library at all; it is rejected alternative 4 of design.md with the app added. `Engine.export` would go on returning a stored file, so what a format writes would depend on who saves it (the scenarios and any other caller of the engine would never see the file a user gets); the saver would have to open the package the engine made and write it again, which is a ZIP reader in the product; and the app and the server would write different bytes for one model. The owner asked for a library. The port keeps this open where it fits: `{ deflate: (bytes) => deflateRawSync(bytes) }` is a `Deflater` for a caller that runs in Node only.
5. **A port that writes the ZIP** (`zip(entries)`, over the ZIP writer of a library). The engine's writer would be dead code or a second path, its refusals and its date of 1980 would become the library's to keep (`fflate`'s `zipSync`: "ZIP and GZIP support mtime (defaults to current time)"), and a test double would be a ZIP writer instead of three lines.
6. **A required port.** One behaviour instead of two, and a composition could not forget it. But nineteen places would pass a compressor they never call, the engine would refuse to start without something it can do without, and the stored file is a valid 3MF, the one shipped today.
7. **One function that composes the engine of the server**, imported by `main.ts` and by the kit of its tests, so that a test would cover what ships. It closes the gap for the server and not for the app, whose `main.ts` needs the URLs of the WASM files from Vite; a file more for one line that is checked once by hand and shows in the size of every 3MF.
8. **The compressor as a third argument of `run` of a format**, or as a function `zip` handed to it. The kernel is a member of the context; a second way to hand a port to the same code is one more thing to know.
9. **`Engine.zip(entries)`**. A method of `Engine` needs a tool of the server by the rule of the project, and a tool that zips files is not a function of a CAD model.
10. **Every entry deflated, also when the stream is longer.** Simpler by one comparison, and a file of noise would grow. The rule "shorter, else stored" is also what keeps the writer without a compressor identical to today's.
11. **Only the model part deflated.** The two small items are 82 and 122 bytes smaller deflated; a rule by name would be a special case in a writer that has none.
12. **Version made by 20 for every entry once a compressor is given.** Nearer to the words of the specification; a stored entry would then be written two ways. See "The ZIP of the engine".
13. **`about` with a field for the compression.** See "The format `3mf`".
14. **`pako`'s default hash.** 0.3 to 0.5 % smaller files and 11 to 14 % less time. Its bytes are those of a hash added in June 2026; the bytes of `legacyHash` are those of zlib, which any zlib reproduces, and of the versions of `pako` with years of use.
15. **Level 9, or level 3.** See "The level".
16. **Inflating every stream at run time to check it.** It would double the library in the bundle (`pako`'s inflate) and check the compressor with its own author's inflater. The tests check every file they write with `node:zlib`.
17. **A compressor in WASM.** Loading would be asynchronous at creation, as the kernel's is, which the project allows; the two on npm are `wasm-flate` (no licence stated) and `zlib-wasm` (a wrapper of `pako` 1), both of 2020. At 45 ms for a megabyte there is nothing to win.
18. **Deflate written in the engine.** Rejected alternative 2 of design.md stands: a compressor nobody else ever ran.
19. **`storedZip` kept beside `zip`.** Two names for one function with and without its optional argument.

## Known limits

- **An engine that was not given a compressor writes stored files, without a word**, and no test loads either `main.ts`: the kits of the tests compose their engines themselves. A `main.ts` that lost its compressor would pass every test and write the 3MF of today. What shows it: the size in the answer of the tool and in the status line of the app, and the two checks by hand of "To verify before the implementation".
- **The bytes of a file now depend on the library**: on `pako` 3.0.3 with level 6 and `legacyHash`. A newer version may write other bytes that are as valid; the version is pinned exactly and the test of the adapter pins streams, so a change is seen and said in its commit. The bytes of an engine without a compressor do not change.
- **Nothing checks at run time that a stream inflates back.** A defect of the compressor would be a file that does not open. What stands against it: the stream is zlib's, the tests inflate every file they write with another implementation, and the hand check with independent readers.
- **The version of the library is little used**: half a million downloads a week of 3.0.3, 0.26 % of `pako`'s; 3.0.0 is of 26 June 2026. Its bytes are those of 2.1.0, measured on the inputs of this design only.
- **The export takes longer**: 13 to 15 ms instead of 5 to 7 for the box and about 78 ms instead of 32 for the joint, in one synchronous call. 17 MB of model text took 0.73 s. A compressor in pieces or in a worker is deferred.
- **Memory.** While an item is compressed, its bytes, its stream and the buffers of the library are alive together.
- **The limits of the ZIP are those of design.md**, with one shift: the 4 GiB together are counted on what is written, so a package can now hold more model than before.
- **The ZIP of a set of the app is not compressed** (the second question).
- **Not seen on Windows, nor in the window of a slicer.** The readers were Info-ZIP, libarchive, `ditto`, Python, `lib3mf`, the command line of BambuStudio and the inflaters of Node (the system's zlib), Chrome and Firefox. The fourth question of design.md (which programs the owner checks the files in) covers the deflated file too.
- **Two licences, and one notice that is not in the package.** MIT asks that its notice "be included in all copies or substantial portions of the Software"; the zlib licence, for the ported code, that the origin is not misrepresented and altered versions are marked. The package ships the MIT text only, and its `dist/pako.mjs` carries no notice of zlib; that text is in `src/zlib/README` of the repository. A build of the app or of the server that is given to others carries `pako`'s code and would take both notices from there, as it owes those of the other libraries today. Nothing is distributed yet.
- **The tests cannot use an independent ZIP reader** (design.md); for the stream they now have an independent inflater, `node:zlib`, in every run.

## To verify before the implementation

- **The owner's approval of `pako` 3.0.3** (D2), before the second step of the work.
- After `pnpm install` with the adapter package: the lockfile gains `pako@3.0.3` and nothing else (the registry says it has no dependencies).
- The MCP bundle builds with `pako` left outside and the server started from `packages/mcp/dist/server.js` writes a deflated 3MF: that Node finds the library from there, and that `main.ts` of the server passes the compressor.
- The app built by Vite and opened in a browser saves a deflated 3MF: `main.ts` of the app, and the first run of the library inside the real bundle.
- The deflated files of the scenario in the window of the slicer the owner uses, with the check of design.md.
- That the snapshots of the app change only where this design says (below).
- **After the merge, every other tree** needs `npx -y pnpm@9.15.9 install` and its MCP bundle built again: a bundle built after the merge imports `pako`, and the tests import the adapter package. The merging session says so with the merge.

## Tests the implementation owes

- **`zip`** (engine, no library):
  - Before the function changes, the bytes of today are captured: the archive of the test of `export-zip.test.ts` (three entries) by its length and SHA-256 as `storedZip` of `master` writes it, and the whole 3MF of the small model of `export-3mf.test.ts` the same way (today those tests pin the texts of the items and the fields of the records, not an archive). `zip(entries)` and an engine without a compressor are held to those fixtures.
  - Everything `storedZip` is tested for, unchanged, for `zip(entries)`.
  - With a compressor of the test over `node:zlib`: an entry that compresses is deflated and reads back; one with no bytes is stored; a name that is not ASCII keeps its flag; a stored and a deflated entry side by side have 10 and 20 as their versions; the same call twice gives the same bytes. **No test compares a stream, a size or a hash with what `node:zlib` deflates**: Node as it is distributed carries another zlib than the one of this machine, and such a test would pass here and fail there. `node:zlib` compresses for a test only where any valid stream does, and inflates everywhere.
  - With a compressor that answers from a table (forty letters `a` as `4b 4c 24 0e 00 00`): the whole archive pinned to the byte, 114 bytes, with the method 8, the version 20, the two sizes and the CRC of the letters.
  - An entry of random bytes is stored: the test asserts that the compressor's stream for it is not shorter, so bytes that happen to compress cannot pass as the case. A stream exactly as long as the bytes is not written either.
  - A compressor that throws an `Error`, one that throws a text, and one that answers with a plain array: `failed`, each with its text. The refusals of the count, the names and an entry of 4 GiB come before the compressor is called (a compressor that counts its calls).
- **The reader of the tests**: refuses an entry of another method, a deflated entry whose stream is cut, one with bytes after its last block, one whose inflated length or checksum differs, and a deflated entry that is not shorter than its bytes.
- **`3mf`** (engine): the fixture above for an engine without a compressor; with the compressor over `node:zlib` the three items are deflated and hold the same bytes; a compressor that throws is the answer `failed` of `export`, with the format in its text.
- **The adapter** (`packages/deflate-pako`): the guarantees of the port with `node:zlib` as the inflater, over the inputs of "The edges of a stream" but the two large ones; the input unchanged, the result an array of its own; the streams of fixed inputs pinned (the forty letters, and a text of a few kilobytes by its length and hash), with the note that they are zlib's at level 6 and how to make them again with a stock zlib.
- **Scenario 12**, the part of `calls.ts` (`boxAs3mfCompressed`): the engine of the kit has the compressor; the three items are deflated; `zip` of the items read back, without a compressor, is the stored package (177 803 bytes), so the scenario needs no second engine; a fifth of the STL where the test says a fifth more today; everything else of the part of 2g unchanged, through the reader. The scenario pins no stream and no size of a deflated item, so it does not depend on which library compresses. The other calls of part g are not of the scenario: `whichEntries` and `doubles` are the tests of the engine above (with fakes for the solver and the kernel), and the six bytes of the forty letters are pinned in the test of the adapter and in the table of the writer's test alone.
- **MCP**: `server.test.ts` reads the 3MF it wrote through the reader instead of looking for text in the raw bytes, and finds the items deflated (the engine of its kit). The list of formats and the two typed tables do not change.
- **The app**: the snapshot `export.txt` changes in the two sizes of `model.3mf` (the kit's engine has the compressor), and twelve snapshots change in the one sentence of the summary of `3mf` they record with the toolbar; the commit says so. `export-form.test.ts` does not change but for the name of the function it cannot see. With a yes to the second question: the form with a host that has a compressor and without, a compressor that throws shown as the problem of the form, the size of `stl.zip` in the snapshot, and the kit at both of its places.
- **By hand, once**, as under "Measured": the files of the implementation are those of the prototype (the same sizes and hashes), read again by the same readers; the two `main.ts`; recorded in `docs/architecture/verification.md`.

The engine part writes a file format and adds a port: a full review. The wiring is a light one by the table of CLAUDE.md; the point as a whole gets the deeper.

## Open

Two questions for the owner:

1. **Is `pako` 3.0.3 approved (D2)?** Licences MIT and Zlib, no dependencies, 33 kB in the bundle of the app, used only by `packages/deflate-pako` behind the port `Deflater`. Its stream is that of zlib byte for byte; the 3.x line is five months old, 3.0.3 itself three weeks, and it is little used (0.5 million downloads a week, against 18 to 20 million of each 2.x and 90 million of `fflate` 0.8.3), the less so on the path the adapter takes, which is not its default. *Yes* lets the implementation start. *Yes, but 2.2.0* gives the same files from the line with the field use, where that path is the default, for a declaration written by hand, a CommonJS import and 5 kB more. *No, take `fflate`* (0.8.3, MIT, 9 kB, already in the tree) changes the adapter package and its name where it is composed, and nothing of the design; the files are then 2.5 % larger, and their streams are `fflate`'s own (the reported block without a distance code would not occur in a 3MF).
2. **Should the ZIP of a set the app saves be compressed too?** Not asked for; the STL files of a set would be 4.3 to 4.9 times smaller. *No* (the default) keeps the app as it is but for one line of `main.ts`, the dependency on the adapter and the new name of the function the form calls. *Yes* adds the compressor to `PanelHost` and to `App` as designed under "The app".

The four questions of design.md are as they were; this addition answers the first.

## Reviews

The owner's rule for designs: three independent reviewers, read-only, with one brief (what is under review, what to read, what to look for, what to return): a fresh internal subagent, `codex` (gpt-6-astra, high) and `agy` (gemini-4-argon-high). The internal reviewer could also read the scratchpad of the spike and ran its own checks there. Every finding was checked against the code, a source or a measurement before it was acted on.

### Round 1 (2026-11-17), at `6ee63ab`

`agy` did not run: its account was out of quota (HTTP 429, "Resets in 98h33m29s"). The round went on with the other two.

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| The 191 million downloads are of every line of `pako`; 3.0.3 has half a million a week (0.26 %), `fflate` 0.8.3 has 90 million. `pako` 2.1.0 and 2.2.0 are not among the candidates | internal, major | Yes (`api.npmjs.org/versions/pako/last-week`: 496 565; 2.2.0 19.8 million, 2.1.0 17.9 million; `fflate` 0.8.3 90.3 million) | The numbers per version are in the comparison, under what speaks for `fflate` and against `pako`, as a known limit and in the question for the owner. 2.1.0 and 2.2.0 were installed and measured: the same streams as 3.0.3 with `legacyHash`, at the same speed, twice the bundle, no types. A table of the lines, a rejected alternative, and 2.2.0 as an answer the owner can give |
| "The two compositions are tested" is false: no test loads `main.ts` of the server or of the app; `server.test.ts` uses the engine of its kit | internal, major | Yes (no test imports `main.ts` or starts `dist/server.js`) | Said as it is under "The port" and "Known limits": both are checked by hand, listed under "To verify before the implementation". A shared composition function for the server is rejected alternative 7 |
| "Against Python's zlib and against `node:zlib`" is one library reached twice: this Node is built against the system's zlib. The `node:zlib` row and the reason against the default hash are of this machine; a test that compared with what `node:zlib` deflates would fail on a stock Node | internal, minor | Yes (`node_shared_zlib` true, 1.2.12; Python reports the same) | Said in reason 1 and under "Measured", the row relabelled; rejected alternative 14 rests on zlib and on the old lines of `pako`; the owed tests forbid such a comparison |
| Python was run at level 6 only, the text said four levels | codex, factual | Yes | Run at the levels 1, 3, 6 and 9 on both inputs: the eight streams are those of `pako` with `legacyHash` |
| The addition adopts what rejected alternative 3 of design.md rejected, and cites it for something else | internal, minor | Yes | Said under "The port": it reverses that alternative, and why each of its two reasons no longer decides. Alternative 4 here cites alternative 4 of design.md alone |
| Compressing the set of the app goes beyond the decision, costs a member of `PanelHost` and an argument of `App` that two places must be given, and is the only place the report about `fflate` bears on. "A line each" is wrong for `app-kit.ts`, which creates the engine and `App` at two places | internal, minor; codex, minor | Yes (`app.ts`: `constructor(readonly engine: Engine, view?: View)`; `app-kit.ts` lines 250 and 272) | Out of the default: deferred, designed under "The app" as what a yes means, and the second question for the owner. The report about `fflate` moved to the last of the reasons with its weight said |
| "Would carry the reported defect" overstates the *No* branch | internal, minor | Yes (8 to 27 distance codes in every part; 28 and 29 in the STL files) | The question says the block would not occur in a 3MF |
| Version made by differs between the entries of one archive; the specification reads as a property of the writer | internal, minor | Yes (4.4.2.3); harmless (OPC table B.2, the readers) | Stated as a choice with its reason; the other way is rejected alternative 12; a test owed |
| `context.kernel` is wrapped so its exception becomes `failed`; `context.deflater` would not be, and 5b was told it may use it | internal, minor | Yes (`guarded`, `query/context.ts`; `runExport` rethrows what is no `QueryFailure`) | A format hands the compressor to `zip` and does not call it; said under "The port" and "What 5b gets" |
| The failure text is undefined for an answer that is no `Uint8Array` and for a thrown value that is no `Error` | internal, minor | Yes | Both texts are given; three tests owed. What `pako` throws is under "Measured" |
| `calls.ts` creates its engines and never builds the box in them; the scenario needs an engine without the compressor, which the kit does not give | codex, minor; internal, minor | Yes (`createEngine` starts empty; `kit.ts` exports `newEngine()` alone) | The engine of the part is the engine of the scenario; the stored package is `zip` of the items read back, so no second engine is needed. The two doubles read the package of an empty engine, and say so |
| Step 1 of the work renames `storedZip`, so `panels/export.ts` changes in it | internal, minor | Yes | The order of the work says so |
| The stored bytes have no fixed baseline: the tests of today pin texts and fields, not an archive; `calls.ts` compares with `storedZip`, which goes | codex, minor | Yes (`export-3mf.test.ts`, `export-zip.test.ts`) | Two fixtures by length and SHA-256, captured from `master` before the change, are owed; `calls.ts` compares lengths and items |
| After the merge every tree needs an install and its MCP bundle built again | internal, minor | Yes (the bundle imports `pako` bare) | Under "To verify before the implementation" and in the rows for the indexes |
| The summary names "the app and the server" while `about` was refused a field for the same reason | internal, minor | Yes | The summary names no caller |
| `docs/architecture.md` has the diagram of the adapters and ports | internal, minor | Yes | In the list of documents |
| The package ships only the MIT text; the notice of zlib is in the repository | internal, minor | Yes (`dist/pako.mjs` has no such notice) | Under "Known limits" |
| The time of the whole export, 4.6 ms, is not in the kept output (6.9 and 7.9 ms there) | internal, factual | Yes: the first run gave 4.6, a later one overwrote the file | Run three times more: 5 to 8 ms and 31 to 33 ms over four runs; the table and the limit give the ranges |
| The archive "with an entry that does not compress" held bytes that did compress; no script wrote it | internal, factual | Yes (4 096 to 940 bytes) | `proto/mixed.mjs` with random bytes (a stream of 4 101, so stored), read by the three readers; the owed test asserts that its noise does not compress |
| `fflate` had four more publications in July 2026, backports to old lines | internal, factual | Yes (0.4.9, 0.5.4, 0.6.11, 0.7.5) | "One of its current line", and the backports named |
| `@stardazed/zlib` of 2020 is six years old, not four; UZIP.js has four commits since 2020; "with fakes" does not describe all nineteen places | codex, internal, factual | Yes | Corrected |

Twenty-one rows (`codex` is named in five, the internal reviewer in nineteen, three rows name both; the last row joins three small findings), two of them major; all held. Checked by the reviewers and found sound: `pako` 3.0.3 with level 6 and `legacyHash` as a defensible choice, its stream against zlib on inputs of their own (seven of `codex`, the model parts and edges by the internal reviewer), its licence, dates, options and typings against the package; the report about `fflate` (run again by the internal reviewer at three levels) with the quotes of RFC 1951 and `trees.c`; every value of a deflated entry against APPNOTE 4.3.8, 4.4.2 to 4.4.9 and 5.5, OPC 7.3.6 and annex B, and 3MF 1.1; that the prototype without a compressor is the writer of `master`, and that the prototype reader catches a wrong stream; the numbers of the tables against the kept outputs, and their agreement between the three files; the counts (nineteen places, twelve snapshots, three callers of `storedZip`); `Deps`, `ContextDeps`, `QueryContext`, the cut of the ports out of `describe_api`, how the MCP bundle finds a library; that no method of `Engine`, no tool, no row of a typed table and no schema step is needed.

Not acted on: nothing was dismissed. Could not be verified by anyone: the claim of the report about Windows, and whether a Node as distributed gives other bytes than zlib (only `pako`'s documentation says so).

### Round 2 (2026-11-17), at `cf89de5`

The fixes of round 1 were large (the set of the app out of the default, a candidate added and measured, a second question), so a second round looked at what they changed. `agy` was tried again and was still out of quota (HTTP 429, "Resets in 98h6m53s"); the round went on with `codex` and a fresh internal reviewer.

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| The cost of `pako` 2.2.0 is overstated: 63 kB is its main entry, a prebuilt file with inflate in it; the package has an entry for deflate alone | codex, minor; internal, minor | Yes (built here: 38 147 bytes from `pako/lib/deflate.js`, the same streams) | The table of the lines, the bundles under "Measured", rejected alternative 2 and the question: 5 kB more, not 30; "half the code" is no longer a reason. That 2.x was run in Node only is said, with the check owed |
| "The version itself is five months old": 3.0.3 is of 26 October, three weeks old; the 3.x line is five months old | codex, factual; internal, factual | Yes | The question and "What speaks against" give both ages |
| In 3.x `legacyHash: true` is not the default, so the users of 3.x mostly run the other hash; the 2.x lines run the adapter's path by default | internal, minor | Yes (`CHANGELOG.md`: 3.0.0 "`legacyHash` default is now `false`") | A bullet under "What speaks against", and in the question |
| `calls.ts` pins the six bytes of forty letters through the adapter and puts the doubles into the scenario, which has no engine of its own to give them; with `fflate` the letters are five bytes, so "only the adapter changes" is too strong | codex, minor; internal, minor | Yes (`fflate`: `4b 24 12 00 00`; `kit.ts` exports `newEngine()` alone) | The scenario is `boxAs3mfCompressed` alone and pins no stream; `whichEntries` and `doubles` are labelled tests of the engine, the pin of six bytes is in the adapter's test and the table of the writer's test. What a change of library touches is listed |
| Three sentences still read as if the form gave `zip` a compressor by default, or leave out the renamed call and the dependency | internal, minor | Yes | Reworded: the failure of a compressor in the writer, the row of the app in "What the addition adds", the *No* of the second question |
| The comment of the adapter in `contract.ts` still reads as two confirmations. A second zlib, 1.3.2, is on the machine and gives the same streams | internal, minor | Yes (run again here through `ctypes`: the eight streams and the forty letters) | The comment names both; reason 1 and "Measured" record the second zlib, so the comparison is now against two builds |
| The text points to "Measured" for `zipinfo` showing 2.0 and 1.0 side by side, which was not there | internal, factual | Yes (the fact holds: 2.0, 1.0, 1.0, 2.0) | Added to the paragraph of the mixed archive |
| The tally under the table of round 1: the internal reviewer is named in nineteen rows, three name both | internal, factual | Yes | Corrected |

Eight rows (three findings of `codex`, eight of the internal reviewer, three shared), none major; all held. Checked in this round and found sound: that each fix of round 1 is in every place the claim appears; the downloads per version against the registry (fetched again by both); the three lines of `pako` giving the same streams (the internal reviewer extended it to four levels, all twelve items of the four packages, the STL files and the noise); the mixed archive; that `zip` of the items read back is the stored package (reproduced for all four files); that an engine with no body reaches the compressor and the two failure texts come out as written; which snapshots change with the set left stored (the two sizes of `model.3mf`, twelve summaries; `export-form.test.ts` not at all); the two questions as real decisions with their defaults; staying with 3.0.3 as defensible.

No third round: no serious finding, and the fixes are wording, one measurement and a relabelling in `calls.ts`. Still open after the last round, as known limits: the little use of the chosen version, the two `main.ts` checked by hand, Windows and the window of a slicer not seen.

## Rows for the indexes

*Superseded by the implementation: the rows below are those of the design, with `pako` 3.0.3 and `legacyHash`. The rows for the merge are under "As implemented", "For the merge".*

**`docs/d36/README.md`, the row of 2g, column "Design now", added at its end:**

> Addition of 2026-11-17 ([2g-export/deflate.md](2g-export/deflate.md)), designed, not implemented: the 3MF compressed (owner, 2026-11-17). A third port `Deflater` (a raw DEFLATE stream), optional in `createEngine`; the engine's ZIP writer becomes `zip(entries, deflater?)` and deflates an entry whose stream is shorter; the adapter package `packages/deflate-pako` over `pako` 3.0.3 (waits for the owner's approval, D2); no schema step. 5b gets `zip` in place of `storedZip`

In "Shared places", a row: the ports of `createEngine` (`types.ts`, `engine.ts`, `query/context.ts`): the addition of 2g adds `Deflater`. In "Rules for work at the same time" or with the merge: after this addition is merged, every tree runs the install and builds its MCP bundle again.

**`docs/decisions.md`, D54**, the second column gets, after the owner's decision of 2026-11-17:

> Designed on 2026-11-17 as an addition ([deflate.md](d36/2g-export/deflate.md)): the library is `pako` 3.0.3, behind a port of the engine; not implemented, waits for the approval of the library and for the owner's word on the ZIP of a set of the app

and the third column, in place of "in a ZIP the engine writes uncompressed":

> in a ZIP the engine writes, its parts deflated by the compressor the engine was given (the port `Deflater`; the adapter `packages/deflate-pako` over `pako`), about a fifth of the size of the STL, and stored when it was given none

**`docs/decisions.md`, D2**, a paragraph, with the date of the owner's yes:

> Approved on (date): `pako` 3.0.3 (`github.com/nodeca/pako`; licences MIT and Zlib; no dependencies), a port of zlib's deflate to JavaScript, to compress the parts of a 3MF package (D54, [d36/2g-export/deflate.md](d36/2g-export/deflate.md)). It sits behind the port `Deflater` of the engine (`deflate(bytes)`: a raw DEFLATE stream) and is imported by the adapter package `packages/deflate-pako` alone, called as `deflateRaw(bytes, { level: 6, legacyHash: true })`; the engine has no dependency and works without a compressor (its files are then stored). Chosen over `fflate` 0.8.3 because its stream is that of zlib byte for byte.

and "Approved" in `CLAUDE.md`, "Rules of the project", gains `pako` once the owner says so.

**`docs/requirements.md`, scenario 12, the part of 2g**: in its first sentence, "a ZIP of three stored items the engine writes itself" becomes

> a ZIP of three items the engine writes itself, each deflated by the compressor the engine was given, so that the file is a fifth of the size of the STL of the same bodies (and the same three items stored when the engine was given none)

## As implemented

Implemented on 2026-11-17 in the branch `d36/2g-deflate`, from `master` at `8367ccc`, by the order of the work above. The ZIP of a set the app saves stays stored (the default of the second question).

**The one deviation: `pako` 2.1.0, not 3.0.3.** The owner approved the library as 2.1.0 (D2, 2026-11-17): the line with the field use, whose default path is the path the adapter takes. It is the fallback this design describes under "The library", and it changes the adapter only:

- `packages/deflate-pako/package.json` pins `pako` at exactly `2.1.0`; the lockfile gained `pako@2.1.0` and nothing else (it has no dependencies). `packages/mcp/package.json` names it too, for the bundle of the server.
- The adapter imports `deflateRaw` from `pako/lib/deflate.js`, the CommonJS entry for deflate alone, which the `exports` of 2.1.0 allow (`"./lib/*"`). Node takes its named export from the CommonJS module, Vitest runs it, the bundle of the app takes it in (Vite 8, rolldown) and the bundle of the server leaves it outside and imports it by that path.
- 2.1.0 ships no types: the one function is declared in `packages/deflate-pako/src/pako.d.ts` (`deflateRaw(input: Uint8Array, options: { level: number }): Uint8Array`). No `@types/pako`.
- The call is `deflateRaw(bytes, { level: 6 })`: 2.x has no `legacyHash`, and its one hash is the one 3.0.3 selects with it. Level 6 is stated, the other options are the defaults of the library (window 15, memory level 8, the default strategy). The constant `PAKO_LEVEL` of the adapter is 6.

**The streams of 2.1.0, checked against the measurements of this design.** Through the adapter, in Vitest on Node 25.9.0, with the engine of the implementation:

| | This design (3.0.3 with `legacyHash`, and 2.1.0) | The implementation (2.1.0 through the adapter) |
|---|---|---|
| The model part of the box with properties, 177 078 bytes | 29 106 bytes, SHA-256 `4ad4d4e1a9b8e383…` | the same |
| The model part of the joint, 1 065 171 bytes | 165 551 bytes, `605132f55018d64b…` | the same |
| The files: the box with properties, as the scenario exports it, the joint, a model with no body | 29 823, 29 673, 166 268, 889 bytes | the same |
| The items: content types, relationships | 319 to 197, 260 to 178 | the same |
| Forty letters `a` | `4b 4c 24 0e 00 00` | the same |

The text the test of the adapter pins (3 648 bytes, a stream of 587 bytes, SHA-256 `5cf09702db02…`) was deflated again by zlib 1.2.12 (Python and `node:zlib` of this machine) and by zlib 1.3.2 (Homebrew, through `ctypes`, `deflateInit2` with the level 6, the window −15 and the memory level 8): the same stream. So are forty letters, no bytes (`03 00`) and one byte (`63 07 00`).

**Measured.** On the machine of the design (Apple M5), in Vitest: the whole export of the box about 12 ms and of the joint about 74 ms (the design: 13 to 16 ms and 77 to 79 ms). The adapter built alone by Vite in library mode, minified: 37 561 bytes, 10 104 gzipped (the design measured 38 147 for the deflate entry of 2.2.0, built as an ES module the way the app is built); the bundle of the app holds the deflate of `pako` and not its inflate. The bundled adapter gives the pinned streams.

**By hand** (`docs/architecture/verification.md`): the four files above read by `unzip -t`, `zipinfo -v`, Python `zipfile` and `bsdtar`; the built server (`dist/server.js --no-bridge`, over stdio) wrote a deflated 3MF; the built app, served by `vite preview` on a port of its own and run in Chrome 156, wrote the same file byte for byte and Chrome's `DecompressionStream('deflate-raw')` inflated its items. `lib3mf` and BambuStudio were not run again: the files are those of the prototype, which they read.

**Other choices of the implementation**, none against the design:

- `zip` checks the count, the names and an entry of 4 GiB in a first pass, compresses in a second, then checks the sizes together and computes the CRC-32 of the bytes of every entry after that check (as `storedZip` did: a test claims 2 GiB entries without bytes).
- The kinds of entry are a constant of `zip.ts` (`ENTRY`: method 0 with the version 10, method 8 with 20), not exported; the tests name the numbers.
- `QueryContext.deflater` is set only when the engine has a compressor (the member is absent otherwise, not `undefined`).
- `EngineDeps` extends `Deps` of the recompute and is exported from the index with `createEngine`.
- The reader of the tests reports how many bytes of a stream `node:zlib` read (`inflateRawSync` with `info: true`), and so refuses bytes after the last block; it returns the compressed size of every entry (`compressed`).
- The fixtures of the bytes of `master` are the archive of the three files of `export-zip.test.ts` (658 bytes) and the package of the small model of `export-3mf.test.ts` (1545 bytes), each by length and SHA-256, captured at `8367ccc` before the writer changed.
- The snapshots of the app changed where this design said: the two sizes of `model.3mf` in `export.txt` (1934 and 2723 bytes stored, 1088 and 1141 deflated) and the last sentence of the summary of `3mf` in twelve snapshots.

- `pako` 2.1.0 throws when it cannot compress in two ways: an `Error` when the stream cannot be set up (options out of range), and the message of zlib as a plain string, not an `Error`, when the stream reports an error (`throw deflator.msg || msg[deflator.err]` in `lib/deflate.js`). `zip` takes both (`String` of a thrown value that is no `Error`); `packages/deflate-pako/test/review.test.ts` holds it (the review).

**For the merge.** The index rows are the merging session's. The text for them, in place of "Rows for the indexes" above:

- `docs/architecture.md`, the row of `ports.md`: the contracts of `SketchSolver`, `SolidKernel` and `Deflater` (D54); the sections gain "Deflater (D54)".
- `docs/d36/README.md`, the row of 2g, the addition: "Addition of 2026-11-17 ([2g-export/deflate.md](2g-export/deflate.md)), implemented 2026-11-17: the 3MF compressed (owner, 2026-11-17). A third port `Deflater` (a raw DEFLATE stream), optional in `createEngine`; the engine's ZIP writer is `zip(entries, deflater?)` and deflates an entry whose stream is shorter; the adapter package `packages/deflate-pako` over `pako` 2.1.0 (D2), `deflateRaw(bytes, { level: 6 })`; the ZIP of a set the app saves stays stored; no schema step. 5b gets `zip` in place of `storedZip`". In "Shared places": the ports of `createEngine` (`types.ts`, `engine.ts`, `query/context.ts`) gained `Deflater`.
- `docs/decisions.md`, D54, the second column: "implemented 2026-11-17" in place of "not implemented yet"; the third column, in place of "in a ZIP the engine writes uncompressed": "in a ZIP the engine writes, its parts deflated by the compressor the engine was given (the port `Deflater`; the adapter `packages/deflate-pako` over `pako` 2.1.0), about a fifth of the size of the STL, and stored when it was given none". D2 already has the approval of `pako` 2.1.0.

After the merge every other tree runs `npx -y pnpm@9.15.9 install` and builds its MCP bundle again: the bundle imports `pako`, and the tests import the adapter package.

