# D36: plan of the work

The working plan for [D36](../decisions/D36-order-after-d35.md), the order of work after D35. D36 decides the order of seven steps; this file cuts them into work packages and says which package needs which, where they write to the same places, and what can run at the same time.

Last change: 2026-11-15. State: D35 is closed; of the preparatory step, parts 2 (a module per feature type), 1 with 4 (the registries and the shared vocabulary) and 3 (the panels and forms of the app) are implemented, and parts 5 and 6 (documents by area, working in several trees) are done, so the preparatory step is complete; the full designs of tracks A, B and E (twelve packages) are written, reviewed in three rounds each and merged, and read together in [cross-review.md](cross-review.md). Of the packages, 1b (measuring, with the generic form of a query in the app) and 1a (the section, with the section view of the app) and 1c (the smallest gap, with the gap view of the app; the kernel port stayed as it is) and 1d (mass properties) and 1e (the print check, with the print view of the app) and 1f (a picture of the model for the AI, with the button that saves one) are implemented and merged: track A is complete. Track B is next (2a, 2b, 2c; 2f beside them).

## How the work goes

1. **The preparatory step** ([00-prep/design.md](00-prep/design.md)) is done first, by one session, after D35 point 7 is closed (it was, on 2026-11-15). It does not change behaviour.
2. **Design of the packages.** Each package gets its design before any code (see "A package" below). Designs do not touch the code, so all of them can be written at the same time.
3. **Review of the designs.** Each design by an independent reviewer, then one review over the whole set against the maps of this file. For the twelve full designs it is [cross-review.md](cross-review.md): the names they add, what they need of the preparatory step and where that lands, and the decisions that wait for the owner.
4. **Implementation** by the procedure of CLAUDE.md (implement, test, docs, independent review, fix, separate commits), each package on its own branch, merged in the order of the dependencies.

## Work packages

The step is the step of D36 and gives the priority. The track groups packages that write to the same code; inside a track the work is sequential, between tracks it can run at the same time.

| ID | Package | Step | Track | Needs | Design now |
|---|---|---|---|---|---|
| 00 | Preparatory step (D37) | | | D35 closed | implemented, all six parts ([00-prep/design.md](00-prep/design.md)) |
| 1a | Section: the query (loops with areas and face names) and the section view in the app | 1 | A | 00 | implemented and merged 2026-11-15 ([1a-section/design.md](1a-section/design.md), "As implemented") |
| 1b | Measuring between two named entities; builds on the description of a body that the preparatory step moves into the engine, and reads circles from the surfaces instead of fitting them. Also the generic form of a query in the app, which the app side of 1a, 1c, 1d and 1e builds on | 1 | A | 00 | implemented and merged 2026-11-15 ([1b-measure/design.md](1b-measure/design.md), "As implemented") |
| 1c | Smallest gap between bodies | 1 | A | 00 | implemented and merged 2026-11-15 ([1c-gap/design.md](1c-gap/design.md), "As implemented") |
| 1d | Mass properties | 1 | A | 00; the density comes as an argument until 3a | implemented and merged 2026-11-15 ([1d-mass/design.md](1d-mass/design.md), "As implemented"); 3a fills in `massSourceOf` |
| 1e | Print queries | 1 | A | 00 | implemented and merged 2026-11-15 ([1e-print/design.md](1e-print/design.md), "As implemented") |
| 1f | View image for the AI | 1 | A | 00; shares the viewport with the view of 1a | implemented and merged 2026-11-15 ([1f-image/design.md](1f-image/design.md), "As implemented") |
| 2a | Profile offset and a wall from a line | 2 | B | 00 | full |
| 2b | Taper on extrusion | 2 | B | 2a | full |
| 2c | Hole feature and the hardware catalog | 2 | B | 2b for the countersink; plain and counterbored holes need only 00 | full |
| 2f | Extent up to a planar face | 2 | B | 00; same code as 2a and 2b | full |
| 2d | Command that re-points an end of a curve, fillet of a sketch corner | 2 | C | D35 point 7 | full |
| 2e | Linear pattern and mirror of features and bodies | 2 | D | 00 | full |
| 2g | Export: 3MF, outline as DXF and SVG, as entries of the registry of formats of the preparatory step | 2 | F | 00; the outline needs 1a | full |
| 3a | Body properties and the catalog of materials | 3 | E | 00 | full: adds a section to the document |
| 3b | Import of a mesh as a reference body | 3 | E | 3a | outline |
| 3c | Inserting another document as a part | 3 | E | 3b | outline |
| 3d | Boolean of bodies, subtraction with a clearance, split by a plane | 3 | E | 00 | outline |
| 3e | Parts list | 3 | E | 3a, 2c | outline |
| 4a | Revolve | 4 | G | 2b (same code: tool build, face kinds) | outline |
| 4b | Chamfer and fillet of edges: spike, chamfer, fillet | 4 | G | 4a | outline; the spike can run any time |
| 5a | Mechanism description and the posed queries | 5 | H | 1c, 3a; scenario 13 also 1d; its app side the generic form of 1b | full for the description: adds a section to the document |
| 5b | Export of URDF and MJCF | 5 | H | 5a, 1d, 3a, 2g | outline |
| 5c | Plane tilted about a line, midplane of two faces | 5 | I | 00 | outline |
| 5d | Generators: cycloidal disc, GT2 pulley, profile shift of the gear | 5 | I | none | outline |
| 6, 7 | Sketch (derived geometry and what stands on it, splines, trim and extend); tube along a path, twist and threads, names of reference dimensions | 6, 7 | | | not yet |

The full designs of tracks A (1a to 1f), B (2a, 2b, 2c, 2f) and E (3a, 5a) exist in their directories; the others are not written yet.

"Design now": **full** is `design.md`, `contract.ts` and `calls.ts`; **outline** is a `design.md` of a page that states the cheap variant and what the package needs from the shared vocabulary, without a contract. A contract written long before its implementation goes stale, so full designs are limited to steps 1 and 2 and to the two packages that add a section to the document (3a, 5a): the shape of the document is the thing that is expensive to change later.

## What can start when

```
D35 point 7 ──▶ 00 preparatory step ──┬─▶ 1a 1b 1c 1d 1e 1f        (track A, side by side)
                                      ├─▶ 2a ─▶ 2b ─▶ 2c            (track B, in sequence)
                                      │    └──▶ 2f ──┘
                                      ├─▶ 2d                         (track C)
                                      ├─▶ 2e                         (track D)
                                      ├─▶ 3a ─▶ 3b ─▶ 3c ; 3d ; 3e   (track E)
                                      ├─▶ 2g 3MF ; outline after 1a  (track F)
                                      ├─▶ 5c ; 5d                    (track I)
                                      └─▶ after 2b: 4a ─▶ 4b         (track G)
                                          after 1c and 3a: 5a ─▶ 5b  (track H)
```

Right after the preparatory step: all of track A, 2a, 2d, 2e, the 3MF part of 2g, 3a, 5c and 5d. That is more than can sensibly run at once; the priority of the steps picks among them.

## Shared places

Where packages collide although they do not depend on each other. The preparatory step exists to shorten this list.

| Place | Who writes there | Today | After the preparatory step |
|---|---|---|---|
| `Engine` in `types.ts`, `engine.ts`, tools in `mcp/tools.ts` | every query (track A, 3e, 5a) | a method, a hand-written tool and its own argument checks per query | a query is one module with an entry in a catalog; one general tool `query` reaches all of them |
| The feature types: until part 2 of the preparatory step `document.ts` (1370 lines) and the step methods of `Evaluator` in `evaluate.ts` | every new feature type (2c, 3b, 3c, 3d, 4a, 4b) | were: validators of all types in one file, a private method per type in one class | a module per feature type; the registry gets one line and is the one guard, the switch goes |
| `app.ts` (2321 lines, one class) | everything with a form or a panel | all panels and forms are methods of one class | a file per panel and per feature form |
| Extrusion: `ProfileSource`, `Extent`, `features/extrude.ts`, the two halves of a profile (`features/profile.ts`, `recompute/profile.ts`), `toolSpan` in `recompute/extent.ts`, `buildPrism` in `solid.ts`, the extrusion form | 2a, 2b, 2f, 4a | one feature, one step | stays shared: track B is sequential and 4a follows 2b |
| `FaceInfo` and `EdgeKind` in `solid.ts`, `edgeKind`, `projectEdge` | 2b (cone), 4a (cone, general), 4b, 3d (face of a split) | plane, cylinder, swept | the kinds are agreed once in the shared vocabulary |
| Kernel port (`SolidKernel` in `types.ts`, `kernel-manifold`) | 3d (split, offset); 1c (gap) added nothing to it in the end (D40) | `boolean`, `triangulate` | stays shared; small additions, the guarantee text needs care. A draft adds to the port by declaration merging and declares the addition as a property, not in method syntax (two methods of one name would merge as overloads without a complaint); the adapter and the fakes of the tests are work of the package |
| Pattern: transform kinds, the `pattern` step | 2e | one kind | one package, no collision |
| Sketch commands and `sketch.ts` | 2d, later step 6 | | one package for now |
| `applyCommand` and `validateDocument` in `document.ts` | every package with a command or a section of the document (2d, 3a, 5a) | one function each | stay shared: a branch of the command, a line of the document; small and in different places |
| Export: `exportMesh`, the tool `export_stl`, the export in the app | 2g, 5b; 3a changes the default list of bodies | one format | formats as a registry; one tool with a format |
| Sections of the document and `SCHEMA_VERSION` | 3a (body properties), 5a (mechanism) | version 2; `upgrade` is one function | a rule who raises the version, see the preparatory step |
| `docs/architecture.md`, `docs/ui.md` | everything | one file each | split by area into `docs/architecture/` and `docs/ui/` (done); a package writes its part in its own `design.md` until it is merged |
| Tool builds: `recompute/state.ts`, `recompute/services.ts`, `recompute/extent.ts`, the registry line and the text of `requireRef` in `features/index.ts` | 2a, 2b, 2c, 2f, then 2e and 4a | one prism | stay shared: track B is sequential; a build may fail with a code (2f), which the pattern of 2e gets without a change |
| The view: `viewport.ts` (`SceneModel`) and `scene.ts` of the app | 1a (a clipped section), 1b (what a view of a query adds), 1f (a picture), 3a (a colour, a translucent body), 5a (a pose) | one scene of the model | stay shared; small additions in different places, merged one at a time |
| What a section of the document touches: `differs` and `settle` in `engine.ts`, `renameParameter`, `Evaluator.evaluate`, `stateBefore(0)` of the app, `modelSummary` and the generated description in `packages/mcp` | 3a, 5a | no section beyond parameters and checks | 3a turns them into a registry of sections; 5a adds an entry |
| Numbers of decisions and of validation scenarios | everything | | assigned here, see below |

## Rules for work at the same time

- **A branch and a git worktree per package** (`d36/<id>`). Two sessions in one working tree get in each other's way: tests fail on the other's unfinished work, a review needs the tree unchanged, commits need staging hunk by hunk.
- **Merging in the order of the dependencies**, by one session at a time. The merge updates the indexes (the table of `docs/decisions.md`, the table above, the scenario list of `docs/requirements.md`) and runs all the checks of CLAUDE.md on the merged tree.
- **A package writes its own files.** Shared files get the smallest possible change: one line in a registry, one entry in a catalog.
- **What two packages both need is settled before either starts**, in the shared vocabulary of the preparatory step, not by whichever is merged first.
- **Each worktree builds its own MCP bundle.** `.mcp.json` points at `packages/mcp/dist/server.js` relative to the tree. The bridge between the server and the app has one default port (4517); a server takes another with `--port`, but the app always connects to 4517, so the app of one tree is bridged at a time. The steps are in CLAUDE.md, "Working in several trees".

## A package

A directory `docs/d36/<id>-<name>/` with:

| File | Content |
|---|---|
| `design.md` | The cheap variant and what is deferred; architecture (where it lives, what it adds to the document, the commands and the queries); decisions with reasons and rejected alternatives; what it takes from and adds to the shared vocabulary; open questions; the reviews and what changed after them. It is the record of decision of the package: the overview in `docs/decisions.md` links to it |
| `contract.ts` | Public types and signatures. Unlike the contract of D35, it imports the real types of the engine and states only what is added or changed, so it cannot drift away from the code unnoticed |
| `calls.ts` | The validation scenario written as calls against the contract. A step that cannot be written is a hole in the contract. After the implementation it becomes a test in `packages/scenarios` |

`docs/d36/tsconfig.json` type-checks all contracts together (`npx tsc -p docs/d36/tsconfig.json`), so two packages that define the same thing differently do not compile. A package adds its queries to the map `Queries` of [00-prep/contract.ts](00-prep/contract.ts) by declaration merging; `00-prep/calls.ts` shows it on a shortened smallest gap.

What exists about a package today is in [backlog.md](../backlog.md), part "Direction after D35"; the design of a package takes that text over and the backlog keeps only what has no package.

## Numbers

Assigned when the design of a package starts, so that two packages never take the same one.

| Kind | Taken | Next |
|---|---|---|
| Decisions | D1 to D37 (D37 is the preparatory step); D38 to D43 track A (1a to 1f); D44 2a, D45 2b, D46 2c, D47 2f; D48 3a; D49 5a | D50 |
| Validation scenarios | 1 to 9; 10 is reserved for the optional prototype of D35; 11 track A, 12 track B, 13 3a and 5a | 14 |
