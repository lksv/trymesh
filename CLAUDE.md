# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A proof of concept of a parametric 3D CAD editor in the style of Fusion: sketches solved by a constraint solver, extrusions, patterns, a feature timeline that can be edited in the middle and recomputed. The weight is on the design and the engine, not the GUI. Models are mostly built together with an AI through the MCP server, so every function has to be reachable both from the app and through MCP.

## Commands

pnpm workspace (`pnpm@9.15.9`), Node, TypeScript, Vitest. `pnpm` is often not on PATH in the agent's shell; the `npx` forms below work from the repo root.

| Task | Command |
|---|---|
| All tests | `npx vitest run` (`pnpm test`) |
| One file | `npx vitest run packages/engine/test/expression.test.ts` |
| One test by name | `npx vitest run packages/engine/test/expression.test.ts -t "name"` |
| Type check (all packages and tests) | `npx tsc -p tsconfig.json --noEmit` (`pnpm typecheck`) |
| Type check the D35 contract draft | `npx tsc -p docs/d35-contract/tsconfig.json` |
| Type check the D36 contracts | `npx tsc -p docs/d36/tsconfig.json` |
| Spikes (slow, real adapters) | `npx vitest run --config spikes/vitest.config.ts` |
| Build the MCP server | `cd packages/mcp && npx vite build` (`pnpm mcp:build`) |
| Run the app | `pnpm dev` (Vite, port 5173) |
| More kernel fuzz cases | `FUZZ_COUNT=30000 FUZZ_FIRST=1 npx vitest run packages/kernel-manifold/test/fuzz.test.ts` |

There is no linter. Before a commit run the tests, both type checks, the spikes and the MCP build.

The MCP server in `.mcp.json` runs the bundle `packages/mcp/dist/server.js`, which is gitignored. After a change in the engine, an adapter or `packages/mcp`, rebuild it and restart the server, otherwise the `mcp__trymesh__*` tools run old code.

## Architecture

`docs/architecture.md` is the source of truth for the design and is detailed (document types, ports, recompute, commands, validation rules). Read the relevant section before changing engine behaviour. What follows is the map.

```
app (three.js UI)  ──commands (JSON)──▶  engine  ◀──tools──  mcp (MCP server + bridge to the running app)
                                           │ ports
                         solver-planegcs ──┴── kernel-manifold      (WASM adapters)
```

- **`packages/engine`** has no dependencies at all (enforced by its `package.json`). It knows neither the adapters nor the renderer; the adapters are passed to `createEngine({ solver, kernel })`. Third-party libraries live only behind the ports `SketchSolver` and `SolidKernel`.
- **`packages/solver-planegcs`, `packages/kernel-manifold`** implement the ports over WASM libraries. Loading is async at creation, the calls are sync.
- **`packages/scenarios`** has tests only: multi-step validation scenarios (numbered in `docs/requirements.md`) against the real adapters in Node. `test/kit.ts` has the helpers for building sketches and extrusions.
- **`packages/app`** only composes commands and shows state. Anything that computes belongs to the engine or to a shared module.
- **`packages/mcp`**: `tools.ts` holds the tools as pure functions over `Engine` (no Node or browser dependency), so the same code serves the server's own engine and, through the HTTP bridge on 127.0.0.1, the engine of the running app.

Packages are not built: each exports its TypeScript source directly (`exports: "./src/index.ts"`). Only `mcp` is bundled, because Node runs it without Vite.

### Ideas that span files

- **The document is an immutable JSON structure and the only source of truth.** Every command returns a new document sharing the unchanged parts. Undo is a stack of documents. Geometry is never stored, it is derived by replaying the feature list.
- **Two histories.** The timeline (`Document.features`) is the recipe of the model. The command history is for undo. A sketch is one feature; its points, curves and constraints are state, changed by sketch commands, not timeline entries.
- **Recompute** (`evaluate.ts`, class `Evaluator`) replays features linearly and memoises the state after each one by the identity of the feature object and of the previous state. A feature in error acts as an empty operation and the replay goes on; what depends on it ends in `brokenReference`.
- **Commands are validated structurally before they run** (`document.ts`), without a recompute. An invalid command changes nothing; a batch is atomic. A command that is structurally fine but leads to a recompute error runs, and the problem shows in the feature's state. A reference to a removed feature is valid in a document on purpose.
- **Feature type registry** (`FEATURE_TYPES` in `packages/engine/src/features/index.ts`). A feature type is a module in `features/` (`FeatureModule`: validator, references, what it creates, the step of the recompute) plus one line of the registry and its interface in `types.ts`; the compiler guards that an entry is complete. Validation of references, timeline order, `updateFeature`, the recompute and the API description for the AI all read the registry. A module imports neither the registry, nor `document.ts`, nor `evaluate.ts`; the imports of the engine go one way and `packages/engine/test/modules.test.ts` guards it (table in `docs/architecture.md`, "Struktura repozitáře").
- **Catalogs drive validation, the app's forms and the MCP description**: constraints (`CONSTRAINTS` in `catalog.ts`), profile generators (`GENERATORS`), numeric fields (`FEATURE_TYPE_INFO[type].fields`), expression functions, tables of data such as hardware and materials (`DATA_CATALOGS` in `data-catalogs.ts`, read by code with its row type and by the query `catalog`), roles of faces (`FACE_ROLES` in `face-roles.ts`: the validator of a face name, its key and its label read it), sketch tools (`SKETCH_TOOLS` in `sketch-tools.ts`: whole shapes as batches of commands, run by the app's drawing tools and by the MCP tool `sketch_tool`). Add to the catalog rather than special-casing a consumer.
- **Numeric fields and expressions.** A field always holds a number (the last valid value); its expression lives in `feature.expressions` under the field address. Commands take the input form instead (`Input<T>`, the expression as a string in the field). Validators read every numeric field through one reader (`Fields.number`), which is also what `fieldsOf` reports.
- **Stable names.** Faces and edges are named by the feature and role that created them (`FaceName`, `EdgeName`), not by index, so references survive a recompute. A body ID is `<feature>` or `<feature>/<local name>`.
- **`describe_api` is generated.** `packages/mcp/src/api.ts` imports `packages/engine/src/types.ts` as raw text and cuts out the part between the section comments `// --- porty` and `// --- přepočet`. Comments in `types.ts` are therefore read by the AI, and those two markers must stay. A new command, constraint, field or generator shows up in MCP with no change in `packages/mcp`.
- **Queries are a catalog** (`QUERIES` in `packages/engine/src/query/index.ts`), reached by `Engine.query` and by the one MCP tool `query` (with `at` and `after`). A new query is a module in `query/` with the description of its arguments, its line in the catalog and its rows in the two typed tables of `packages/mcp/test/queries.test.ts`, without which it does not compile; do not add a method to `Engine` for it. A query reads the geometry of bodies only from its context. Any other new method on `Engine` still needs an MCP tool and an entry in the typed table in `packages/mcp/test/coverage.test.ts`.
- **Export formats are a catalog** (`EXPORT_FORMATS` in `packages/engine/src/export/index.ts`), reached by `Engine.export` and by the one MCP tool `export`. A format is a module in `export/` that returns files (`Exported`), its line in the catalog and its rows in the two typed tables of `packages/mcp/test/export-formats.test.ts`. The server writes the files (`packages/mcp/src/export-writer.ts`); `exportMesh` and `export_stl` stay and share the entry `stl` and the writer.
- **Operations of the app are a registry** (`HOST_OPERATIONS` in `packages/mcp/src/host.ts`): what only the running app can do (asynchronous, needs the renderer). An entry is described like a query, becomes a tool of the server under its key, runs in the app over the bridge, and answers with a `ToolAnswer` (data, files or an image). What it needs of the app is a member of `AppHost`; its rows go into the typed tables of `packages/mcp/test/host-operations.test.ts`.

### Conventions of the model

Lengths are millimetres, angles radians everywhere (in expressions `deg(x)` and `pi`; only the GUI converts bare numbers). IDs are generated by the caller and sent in commands; they must be unique, without `/` (reserved for derived IDs) and not `origin`. Solids are closed triangle meshes in float32, not B-rep. The current document schema version is 3; `load` upgrades older documents by the named steps of `UPGRADES` (`packages/engine/src/schema.ts`). A change that an older build would drop without a word needs a step there; a branch counts its steps in `SCHEMA_PENDING` (see `docs/architecture.md`, `load`).

## Documentation

The docs are living documents kept good enough to repeat the implementation from them alone. Update them with the code.

| File | Content |
|---|---|
| `docs/requirements.md` | What the PoC must do, validation scenarios |
| `docs/decisions.md` | Overview table of decisions D1 to D37 and the short ones in full, with reasons and alternatives |
| `docs/decisions/` | Decisions too long for the overview: `D35-robot-joint.md`, and `D36-order-after-d35.md`, the order of work ahead |
| `docs/d36/` | Plan of the work of D36: work packages, map of dependencies and shared places, and the design of each package |
| `docs/architecture.md` | The design as implemented |
| `docs/ui.md` | UI functions as tables of commands and state read; implementation status of the app |
| `docs/backlog.md` | Features not done yet and why the design does not block them |
| `docs/d35-contract/` | Draft contract for D35, type-checked only; deviations are recorded in its README |

Record a new requirement or decision from a conversation in `requirements.md` or `decisions.md` when it is made.

## Procedure for a point of work

Work on an approved list of points (such as the points of D35 or the steps of D36) goes point by point, autonomously. Each point is closed before the next one starts:

1. **Implement.**
2. **Test.** For engine features consider a multi-step validation scenario in `packages/scenarios` as well.
3. **Docs**: `docs/ui.md`, `docs/architecture.md` and the decision in `docs/decisions.md`.
4. **Independent review** by a subagent that did not write the code, read-only. Keep the working tree unchanged while it runs.
5. **Fix** the findings.
6. **Separate commits**: one for the point, one for the fixes of the review. Run the checks from Commands before each.

**Second round.** Consider one more round of independent review and fix when the review found more than 6 issues of which at least 3 are serious, or when the fix turned out large or complex. The second review looks mainly at what the fix changed; its fixes get a commit of their own.

## Rules of the project

- **New text is English**: identifiers, comments, test names, docs, commit messages and runtime strings (engine messages, MCP descriptions, UI labels). Existing Czech text stays unless the line changes anyway, so the code, the UI and the docs are mixed-language.
- **Every third-party library needs the owner's explicit approval** and has to sit behind its own interface (D2 in `docs/decisions.md` keeps the list). Approved: `@salusoft89/planegcs`, `manifold-3d`, `@modelcontextprotocol/sdk`, and a DOM for the tests of the app (`happy-dom` or `jsdom`, development only; not installed yet). `three` is the renderer of the app by design; Vite is a development tool the owner did not approve explicitly (D31). Record a library as approved only after the owner says so.
- Tests named `review.test.ts` hold regressions from reviews; previously failing fuzz seeds are pinned in `fuzz.test.ts`. Add a finding there with its fix.
- The branch is `master`. `robot-joint-parts-schemas/` (source material for scenario 9) and `.playwright-mcp/` are gitignored.
