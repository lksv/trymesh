# Parts 1 and 4 as implemented

**State: implemented in eight commits (`85a3fe8` to `b563c61`); the review of the implementation is recorded at the end.** The design is in [design.md](design.md) (parts 1 and 4) and the signatures in [contract.ts](contract.ts), sixth version. This file says where the code is and what differs from the contract. `docs/architecture.md` describes the result as part of the engine.

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
- **An operation of the app gets its host from the app**: `connectBridge(engine, { host })`, where `host` is an `AppHost`; the bridge client adds the engine. Without a host an operation answers `notAvailable`. The app passes `host: {}` today, so it stops compiling when `AppHost` gets its first member.
- **A failure of the app while it serves a call** is worded by what the call was: a tool that changes the document keeps the Czech warning that the change may have been made; anything else (a query, a read, an operation) says in English that the app failed to answer and that nothing was changed.
- **The schema version is 3, not 2.** The upgrade from version 1 is the first step, and a second step, `d37-schema-steps`, converts nothing. The reason came from the design of package 3a (track E, checked there with a probe): a build from before the list of steps accepts version 2 and rebuilds a document from the fields it knows, so it would strip a document saved on a branch of `schemaSteps` and of what the pending steps added, without a word. It is the contract's own rule (an addition that an older build would drop gets a step even when it converts nothing) applied to the field `schemaSteps`. The cost: a build from before this commit, such as a stale MCP bundle, refuses documents saved from now on, with the old text about an unsupported version.
- **The test that compares the two orders of pending steps** (the steps of a branch before and after the steps merged meanwhile) is not written: `master` has no pending step to run it on. The runner is tested with lists made up for the test, the rebase included; a branch that appends a step adds the comparison for its step.
- **`describedQueries()`** of the contract is `queryCatalog()` in `packages/mcp/src/api.ts`, next to `hostOperations()`, `dataCatalogs()` and `exportFormats()`; `describe_api` has the four sections.

## Not in this step

- A cone and a general surface are kinds of `Surface`, and no feature makes one yet. The rule that decides the kind of an edge from the surfaces of its two faces, and `projectEdge`, still know a plane and a cylinder; they change with the first package that makes a cone (2b).
- The placement of a body and data coming in (a mesh to import) are left to the packages that need them first, as the design says.

## Review of the implementation

Not run yet.
