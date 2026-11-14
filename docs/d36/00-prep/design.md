# 00 Preparatory step

**State: scope approved, design not written.** The owner approved all six parts on 2026-11-14: first the registry of queries and the split of `app.ts`, then the four parts Claude added from reading the code (a module per feature type, the shared vocabulary, documents by area, working in several trees). Each part below still says "proposal" for how it is done: nothing is designed to the level of signatures yet. That is the next piece of work on this file, together with `contract.ts`.

The step is the counterpart of step 0 of D35. It changes no behaviour: every existing test passes unchanged, except where a test calls a method that moved. Its purpose is that the packages of [the plan](../README.md) add files and single lines instead of rewriting the same places.

It is done by one session, not in parallel, after D35 point 7 is closed, and it follows the procedure of CLAUDE.md like any point.

## 1. Registry of queries

**Today.** A query is a method of `Engine` (`diagnoseSketch`, `explainConstraint`, `interference`), and its MCP tool is written by hand in `packages/mcp/src/tools.ts`. Three things follow:

- A new query touches the `Engine` interface, `engine.ts`, `tools.ts` and the guard table. Step 1 of D36 is six queries, so six packages would edit the same four places.
- The tool checks its arguments itself. `check_interference` verifies the threshold and the list of bodies in `tools.ts`; a caller of `engine.interference` in the app gets none of that.
- Part of what the AI is told is computed in the MCP package and the app cannot use it: `bodyDetail` and `edgeShape` (area and normal of a face, length, ends, centre and radius of an edge), `sketchDetail` (areas of regions, advice on what to constrain). That is the mirror image of the rule that the app must not compute.

**Proposal.** A catalog `QUERIES` in the engine, built like the registry of feature types.

- An entry has a title and a summary for the description, a specification of its arguments, an example that the engine accepts, and a function over a context (the document and the evaluation at a chosen feature, the kernel, a cache).
- `Engine.query(name, args)` is the one way in. The three existing queries become entries; the app's collisions panel and the sketch diagnosis call `query`.
- The same function runs over a state that a preview returned. A parameter can then be stepped and the collisions asked for without touching the history, which is what the pose sweep of step 5 needs.
- Arguments are read through one reader, as numeric fields are read through `Fields`: numbers with a unit and a range (`NumberSpec`), and references to named things (see the shared vocabulary). The description for the AI and the checks come from the same specification.
- A result is plain data with full precision. Rounding belongs to whoever presents it.
- MCP generates its tools from the catalog: name, description and input schema. Existing tool names stay (`check_interference`, `explain_constraint`), so nothing changes for a client.
- The description of a body (`bodyDetail`, `edgeShape`) moves into the engine as a query. Package 1b builds on it.
- Tests: every entry of the catalog is offered as a tool and its example runs, as the tests of the constraint catalog do today. The guard table over the methods of `Engine` stays, with fewer rows.

**Open.**

- How a query reports a failure: a result with an error, as commands do, or an exception, as the three methods do today.
- A cache. `interference` has one of its own; the context should give every query the same means.
- A limit on the time and on the size of the answer. A subtraction with a clearance or a section through a gear can be slow or large.
- Whether `get_model`, `get_document` and `get_sketch` become entries as well or stay hand-written summaries. Proposed: they stay, they are views of the state and not computations; only what they compute moves.

## 2. A module per feature type

**Today.** `document.ts` (1370 lines) holds the validators of all feature types and the registry `FEATURE_TYPES`. `Evaluator` in `evaluate.ts` has a private method per type (`plane`, `sketch`, `extrude`, `pattern`) and a `switch` over them. D36 adds at least six feature types (hole, import, insert, boolean of bodies, split, revolve, chamfer and fillet), each of which would add a block to both files.

**Proposal.** `packages/engine/src/features/<type>.ts` holds what belongs to one type: its entry of the registry (validation, references, bodies, the fields a patch may change) and its step of the recompute. The registry and the `switch` keep one line per type, and the compiler still guards that both are complete.

- The step needs what are private methods of `Evaluator` today: `frame`, `profile`, `applyTool`, the `done` and `failed` callbacks. They become an explicit context that a step receives.
- `document.ts` keeps what the types share: the reader of numeric fields, the checks of references, the commands.
- This is the most delicate file of the engine. The change gets its own review and is done before any other part touches `evaluate.ts`.

**Open.** Whether the extrusion splits further (profile sources, extents, tool builds as their own modules). Track B (offset, taper, extent up to a face) and revolve all write there. Proposed: yes for tool builds, because taper, revolve and twist are tool builds by the design of D35; decided in the design of 2a.

## 3. Panels and forms of the app as modules

**Today.** `packages/app/src/app.ts` is one class of 2271 lines and about 120 methods. The panels (model, collisions, parameters, sketch, extrusion, plane, pattern) and the forms are its methods, so every package with a form edits the same file.

**Proposal.** A file per panel in `packages/app/src/panels/`, as functions over a context of the app (the engine, the shown state, the mode, the helpers for fields). A form of a feature type is registered by its type (its draft, its panel, its command), so a new type is a new file.

- A panel for a query can be generated from the catalog of queries the way the form of a generator is generated from its catalog entry. Then a new query is reachable from the app without work in the app, which is the other half of the rule "from the app and through MCP". To be decided in the design of 1b, the first query with arguments worth a form.
- The app has few tests (`packages/app/test/sketch-tools.test.ts`). A split without a change of behaviour has to be checked by hand in the running app, or by a smoke test written first.

## 4. Shared vocabulary

Things that several packages need and that must be the same in all of them. They are settled here, before the contracts, not by whichever package is merged first.

| Item | Who needs it | What has to be decided |
|---|---|---|
| Kinds of faces and edges | 2b, 4a, 4b, 3d | `FaceInfo` has a plane, a cylinder and a swept surface. A cone is needed by the taper, the countersink and the revolve; a general surface by the revolve of an arc, the twist and the fillet. For each kind: can a sketch stand on it, which of its edges are circles or lines and can be projected |
| Reference to a named entity | 1b, 1e, 1a, 5a | One type for "this face", "this edge", "this sketch point", "this body" in the arguments of a query. `PlaneRef` and `AxisRef` exist for features; queries need the same for faces and edges |
| Placement of a body | 3b, 3c, 5a | A frame and offsets with expressions, for an imported mesh, an inserted part and the links of a mechanism. `RigidTransform` (a matrix and a translation) exists since the pattern; `Placement` in `evaluate.ts` is already the name of something else (the transform and the copy tag of a pattern copy) |
| Export | 2g, 5b | `exportMesh(format, bodies)` returns one array of bytes. A format becomes an entry of a registry and returns a list of files, because a robot description is several. One MCP tool with a format; `export_stl` stays as a name for the first format |
| Data catalogs | 2c (hardware), 3a (materials), 7 (threads) | One shape for a table of data in the engine and one way it reaches the description for the AI. The rule is already decided: a catalog fills fields, the document stores numbers |
| Version of the document schema | 3a, 5a, every new feature type | `SCHEMA_VERSION` is 2 and `upgrade` is one function from version 1. Two branches cannot both raise the version. Proposed: `upgrade` becomes a list of steps, one per version, and the version is raised at the merge, not in the branch of a package |
| Issue codes | most packages | `IssueCode` only grows. A package states the codes it adds in its design |

## 5. Documents by area

`docs/architecture.md` (1091 lines) and `docs/ui.md` are written by every package. Proposed: a file per area in `docs/architecture/` (document, sketch, naming, extrusion, pattern, ports, recompute, API, interface for AI) and a file per panel for the UI, with the present files as their tables of contents. `docs/decisions.md` is already split by the rule of D36.

## 6. Working in several trees

A short description of how a package gets its tree: a branch `d36/<id>`, a git worktree, the install, the build of the MCP bundle of that tree, the ports of the bridge and of the development server. No code; it is a section of CLAUDE.md.

## Order inside the step

1. Shared vocabulary (part 4): a design, no code. The contracts of the packages depend on it.
2. A module per feature type (part 2), reviewed on its own.
3. Registry of queries (part 1).
4. Panels and forms (part 3).
5. Documents by area (part 5) and the trees (part 6).

Parts 2, 3 and 4 touch different packages of code and could be three commits of one point or three points; to be decided when the step is designed in full.
