# Parts 1 and 4 as implemented

**State: implemented in eight commits (`85a3fe8` to `b563c61`), reviewed once and fixed; the review is recorded at the end.** The design is in [design.md](design.md) (parts 1 and 4) and the signatures in [contract.ts](contract.ts), sixth version. This file says where the code is and what differs from the contract. `docs/architecture.md` describes the result as part of the engine.

## The eight steps

| Commit | What | Where |
|---|---|---|
| `85a3fe8` (1) | `Surface` and `Evaluation.faceSurfaces`; `Unit` grows by area, volume, mass and density | `types.ts`, `solid.ts` (`surfaceOf`), `evaluate.ts`, `catalog.ts` |
| `a18357d` (2) | The catalog of the roles of faces | `face-roles.ts` (`FACE_ROLES`, `faceKey`, `faceParts`), `validation.ts` (`faceName`) |
| `0847159` (3) | The catalog of queries, `Engine.query`, the MCP tool `query` | `query/args.ts`, `spec.ts`, `check.ts`, `context.ts`, `index.ts`, `interference.ts`, `sketch.ts`; `packages/mcp/src/tools.ts`, `api.ts` |
| `b7e9b11` (4) | The description of a body as a query | `query/body.ts`; `get_body` prints it |
| `5d8080c` (5) | Data catalogs and the query `catalog` | `data-catalogs.ts`, `query/catalog.ts` |
| `f332154` (6) | The catalog of export formats, `Engine.export`, the MCP tool `export` | `export/spec.ts`, `stl.ts`, `index.ts`; `packages/mcp/src/export-writer.ts`, `server.ts` |
| `9250dc6` (7) | The registry of operations of the app | `packages/mcp/src/host.ts`, `bridge-client.ts`, `server.ts` |
| `b563c61` (8) | The schema of the document as named upgrade steps | `schema.ts`, `document.ts` |

Every commit passed all the tests, both type checks, the spikes and the MCP build. The tests of behaviour passed unchanged, with these exceptions, each a consequence of a decision below: the lists of tools in two tests got `query` and `export`; the table of coverage got rows for `Engine.query` and `Engine.export`; two tests that matched the Czech text for an unsupported schema version match the new text; the test of the version-1 fixture expects version 3 in the saved document.

## What differs from the contract

- **The six maps of additions** (`FeatureTypes`, `FeaturePatches`, `Commands`, `DocumentSections`, `FaceRoles`, `IssueCodes`) and the types named `…After` exist only in the contract, as it says: they stand for the line a package adds to a union of `types.ts`. `QuantityUnit` is `Unit` itself, which grew; `QUERY_TOOL`, `EXPORT_TOOL`, `QueryToolInput` and `ExportToolInput` are the tools `query` and `export` of `packages/mcp`.
- **`Engine.query` and `Engine.export` choose the state** with `QueryOptions`, `{ at }` or `{ state }`, not both. A state has to be one this engine handed out: the engine keeps the state of the recompute and the document with every evaluation it returns (a `WeakMap`), so a query over a preview reads the previewed document, and an evaluation cannot be paired with another document.
- **The four methods of before** (`diagnoseSketch`, `explainConstraint`, `interference`, `exportMesh`) keep their checks, their texts and their throws, and run the entry of the catalog that `query` and `export` run.
- **`Exported.empty`.** An export with nothing worth writing is a successful answer that says why; the tools refuse with that text. `layout: 'file'` is exactly one file, which `runExport` checks together with the form of the paths; a format that breaks either throws, as a defect.
- **The writer knows only files directly in the target folder**, as the contract states; the tool `export` refuses a path with a folder until the first format that has one (5b) adds folders to the writer. No test reaches that refusal, because no format returns such a path yet.
- **`ToolAnswer` of the kind `image` is handled by the server now** (image content of the protocol), not left to package 1f: the way of an operation is tested end to end with operations made up for the test, and an image is one of its answers. `files` from an operation is refused, because an operation takes no path.
- **Catalogs can be given to the runners for tests.** `runExport` takes the catalog of formats as its last argument, and the server and `connectBridge` take the set of operations as an option; the default is the real catalog. `faceName` and `faceKey` take the catalog of roles the same way.
- **An operation of the app gets its host from the app**: `connectBridge(engine, { host })`, where `host` is the app's own object, an `AppHost` with its engine, handed to an operation as it is. Without a host an operation answers `notAvailable`. The app passes `host: { engine }` today, so it stops compiling when `AppHost` gets its first member.
- **A failure of the app while it serves a call** is worded by what the call was: a tool that changes the document keeps the Czech warning that the change may have been made; anything else (a query, a read, an operation) says in English that the app failed to answer and that nothing was changed.
- **The schema version is 3, not 2.** The upgrade from version 1 is the first step, and a second step, `d37-schema-steps`, converts nothing. The reason came from the design of package 3a (track E, checked there with a probe): a build from before the list of steps accepts version 2 and rebuilds a document from the fields it knows, so it would strip a document saved on a branch of `schemaSteps` and of what the pending steps added, without a word. It is the contract's own rule (an addition that an older build would drop gets a step even when it converts nothing) applied to the field `schemaSteps`. The cost: a build from before this commit, such as a stale MCP bundle, refuses documents saved from now on, with the old text about an unsupported version.
- **The test that compares the two orders of pending steps** (the steps of a branch before and after the steps merged meanwhile) is not written: `master` has no pending step to run it on. The runner is tested with lists made up for the test, the rebase included; a branch that appends a step adds the comparison for its step.
- **`describedQueries()`** of the contract is `queryCatalog()` in `packages/mcp/src/api.ts`, next to `hostOperations()`, `dataCatalogs()` and `exportFormats()`; `describe_api` has the four sections.

## Not in this step

- A cone and a general surface are kinds of `Surface`, and no feature makes one yet. The rule that decides the kind of an edge from the surfaces of its two faces, and `projectEdge`, still know a plane and a cylinder; they change with the first package that makes a cone (2b).
- The placement of a body and data coming in (a mesh to import) are left to the packages that need them first, as the design says.

## Review of the implementation

One round, on 2026-11-15, at `b563c61`: an internal subagent and `codex` (gpt-6-astra, high), both read-only with one brief; `agy` did not run (out of quota). The owner made the reviews cheaper while it ran (`CLAUDE.md`, "Depth of the review"), so the internal reviewer was asked to stop early and report what it had; what it did not get to is listed below. Neither found a blocker or a major problem, so there was no second round.

The internal reviewer loaded 448 documents of the tests into the code of before (`59318d8`) and into this one and compared what the methods and tools of before answer: 54 123 comparisons, no difference. It ran `export_stl` through the server of before and this one over 25 steps with identical replies and identical files on disk.

| Finding | Who | Held | What changed |
|---|---|---|---|
| The bridge client copied the host for every call (`{ ...host, engine }`), so the methods of a prototype were lost | codex, ran it | Yes | The host is the app's own object with its engine and is handed over as it is; `connectBridge` refuses a host of another engine |
| `query` and `export` threw for options that are `null`, and took a number as no options | both, ran it | Yes | Refused as `invalidArguments` at `options` |
| The name of a query was not checked to be a text (a list of one name ran the query; an object without `toString` threw) | both, ran it | Yes | Checked, for a format as well, with a text that does not format the value |
| A hole in a list passed the checker, and `export` then crashed on it | both, ran it | Yes | Lists and vectors are read with `Array.from`, which visits holes |
| The sketch of a constraint inside a list, a record or an alternative was reported at the wrong path (`all.sketch`) | internal, ran it | Yes | The checker carries the path of the record the siblings are in; a missing sketch says that the argument is required |
| An empty list of bodies was answered with "the model has no body to export" | internal, ran it | Yes | The option `bodies` of `stl` takes at least one item; `exportMesh` keeps its answer |
| The result of the query `body` shares its arrays with the kept description, so a caller that changes it changes later answers | internal, ran it | Yes, as a rule | `types.ts` says that a result may be kept and must not be changed, like a state (a diagnosis is shared the same way on purpose); no copy is made |
| `null` inside `args` of the tool `query` was refused, while everywhere else it counts as not given | internal, ran it | Yes | The tools drop `null` at the top level of `args` and of `options` |
| The guard against an operation with the name of a tool looped over an empty registry and never ran | internal; codex for the unused table of fixtures | Yes | `hostOperationProblems`, run by the server and by `connectBridge` at start and tested with made-up sets; the fixtures are checked against the descriptions |
| A branch merged without a rebase could put its step before a step of `master`, which changes what a version means | internal, reasoned | Yes | Stated as a rule (the list only grows at its end) in `schema.ts` and `architecture.md`; the test that pins the names says why |
| Docs: `architecture.md` named the removed class `Interferences`, and said that a document with parameters is refused on load | internal; codex | Yes | Both corrected (the second predates this step) |

Two more changes follow suspicions that were not verified, and no test reaches them, because no format and no app of today can cause them: the tool `export` refuses an answer without a file before it creates a folder, and says that the app is older than the server when the app does not know the internal tool `_export`.

Not acted on: an edge of the kind `line` without segments is described as `other` by the query `body`, where `get_body` printed `line` before. No such edge appeared in 1 550 descriptions, and a line without ends has no other description in the type.

Not reviewed, as the review stopped early: the contract and `design.md` against the code, `docs/ui.md`, and the test files `coverage.test.ts`, `face-roles.test.ts`, `data-catalogs.test.ts`, the engine's `export.test.ts` and the scenario tests of the queries. Not run by a reviewer: the writer failing in the middle of a set (the tests of `export_stl` cover it), a real browser app and a real older app on the bridge.
