# 6a Preparatory part and shared vocabulary of step 6 (D64)

**State: designed 2026-11-17 against `master` at `9162198` (schema version 9), on Opus 5.5; reviewed as recorded in "Reviews".** Nothing is implemented. The plan of the step is [6-plan.md](../6-plan.md), "6a Preparatory part and shared vocabulary"; the owner agreed to all ten of its recommendations on 2026-11-17, among them question 4 (which geometry forms regions), which this design writes down.

Files: [contract.ts](contract.ts) (the types and signatures of the five parts and of the vocabulary), [calls.ts](calls.ts) (existing documents and calls as they stay, and how 6b, 6c, 6d, 6e and 6f plug in).

## For 6e, first: the table of the app's sketch tools

6e (trim, extend, split) is designed at the same time and needs only part 4. Its shape, in full in [contract.ts](contract.ts), section 4:

- A tool of the sketch bar is a file in `packages/app/src/sketch-tools/` and one line of `SKETCH_TOOL_UI` in `packages/app/src/sketch-tools/index.ts`. The bar shows the tools in the order of the table; `SketchMode.tool` is a key of the table.
- An entry is `SketchToolUi<O>`: `label`, `hint`; `picks` (`sketch`, the default: a place snapped to a point or a curve; or `edge`: an edge of the model); `clicks` (a shape of so many places; without it `click` is called at every click); `click(host, m, places, context, options, event)`, which returns the places to keep for the next click (the line keeps its end); `finish` (Enter); `draw(places, cursor, context, options)`, polylines drawn dashed while the pointer moves; `options` (`initial` and `panel`) for what the tool remembers; the flags `infer`, `hovers`, `drags`, `atClick`.
- A drawing tool sends its batch through `drawn`, which applies the switch of construction curves. A tool whose batch must stay as the engine made it (the fillet; trim, extend, split) runs it with `host.run` and says what it did, as the fillet does today.
- So the tool *Trim* of 6e is one click on a curve (`places[0].snap.kind === 'curve'`), the batch of the engine's sketch tool run as it is, and `draw` returning the piece that click would remove; calls.ts, section g, writes it.

## What the plan says, checked against the code

| Statement of the plan | What the code says |
|---|---|
| `entityOf` and `derivedPoints` (`sketch-content.ts`) know an own point or curve, the origin and the derived points of a projected edge | True. The derived IDs of a projection are spelled out in seven more places: `solverSetup` and `externalGeometry` of `sketch.ts`, `shapeOf` of `sketch-tools.ts`, `sketchDetail` of `packages/mcp/src/tools.ts`, and in the app `sketch-view.ts`, `axis-picker.ts` and `features/mesh.ts` (`features/extrude.ts` calls `derivedPoints`). The label of a row of the list of projections (`panels/sketch.ts`) and the lines an axis may run along (`lineIds`, `sketch-commands.ts`) read `ref.kind` |
| `Projected` is a line or a circle | True (`types.ts`); it is also what `solved.external` stores, so it is part of the document |
| `detectProfile` takes `sketch.curves` and skips projected curves; `curveOf` reads `sketch.feature.curves` | True. Not in the plan: `wallOutline` (`recompute/outline.ts`) reads `sketch.curves` as well and builds the shapes of lines, circles and arcs a second time |
| The profile joins points by ID or by a satisfied `coincident` (`pointJoins`) | True; the fillet's `cornerLines` and the wall use the same function |
| `SketchResult` has points and radii, not curves; the app draws projected curves from `external` and the points of the result | True (`sketch-view.ts`); `get_sketch` does the same |
| 15 files of the engine, the solver adapter and the app name the kind `arc` | True by `grep "'arc'"` (11 of the engine, 1 of the adapter, 3 of the app), but the count is neither the list of switches nor complete: `export/outline.ts` and `query/section.ts` name the kind of a span of a section, `types.ts` and `catalog.ts` declare, and `sketch-content.ts` switches on the kind without naming `'arc'` in quotes. The places, one by one, are in part 3 |
| `architecture/sketch.md` requires that an unknown kind of curve is refused, not skipped | True ("Připravenost na elipsu"); about half of the switches skip or misread one today (part 3) |
| `sketch-mode.ts` has a union `Tool` and a chain of `if`; the options of a tool live in `SketchHost.sketching` | True: the union, `TOOLS`, branches by tool in `sketchMove`, `sketchClick`, `sketchDown` and `sketchScene`, and the panel picks the options of the polygon and the fillet by name |

Not in the plan, found in the code:

- **`externalGeometry` of `sketch.ts` is dead code**: exported, called nowhere. The points and radii of projections reach the result through the input of the solver.
- **The stamp of a sketch** (`solved.inputs`) is the fingerprint of the curves of the solver's input, the driving constraints and the values of the projections. A sketch whose stamp no longer matches is solved again on load and its positions are written back. So anything a later package adds to the input of every sketch (the axes of the origin, 6b) would solve every stored sketch again. The vocabulary takes that into account.
- **`updateExternal` refuses a change of `kind`**, because the derived IDs would change and constraints name them. That is a rule about entities, not about edges, and it generalises (part 1).
- **The tests call the internal functions with their signatures of today**: `detectProfile(sketch, geometry, tolerance)` (`profile.test.ts`, `outline.test.ts`, `review.test.ts`), `solverSetup(sketch, {})` (`profile.test.ts`, `document.test.ts`), `wallOutline(sketch, geometry, ids, thickness, move)` (`outline.test.ts`, `review.test.ts`). "The existing tests pass unchanged" therefore keeps these signatures; the new forms are added beside them.
- **No test imports `sketch-content.ts` directly**; `entityOf` and `derivedPoints` reach the tests and the app through the re-exports of `document.ts` and `index.ts`. They can move.
- **The app's own copy of the kinds**: `sketch-view.ts` declares `EntityKind = 'point' | 'line' | 'circle' | 'arc'` beside its `Shape`, so a kind added to the engine does not reach it by type.

## The cheap variant

Five parts, each a point of work with the procedure of CLAUDE.md, each verified by "the existing tests pass unchanged" (the snapshots of the app included). Parts 1 to 4 change no public type; part 5 adds a field to `SketchResult` and two exported functions and changes no answer. The vocabulary is written into the contract and the docs of the area before 6b to 6f design against it.

| Part | What | Public type | Review (CLAUDE.md) |
|---|---|---|---|
| 1 | The kinds of the entries of `external` as a registry | none | none if the tests pass unchanged |
| 2 | The profile, the sides and the wall read a list of curves with a region flag; one rule of joins | none | none if the tests pass unchanged |
| 3 | Every switch on the kind of a sketch curve exhaustive | none | none if the tests pass unchanged |
| 4 | The app's sketch tools as a table | none (app only) | none if the snapshots do not change |
| 5 | The result of a sketch carries its curves that are not own; the app and MCP read them and the registry | `SketchResult.curves`; `referenceEntities`, `curvePoints` exported | light |

**Order of the commits:** 4 first (6e waits only for it), then 3, 1, 2, 5. Parts 1 and 3 do not depend on each other; 2 builds on the resolved references of 1; 5 on both.

**Deferred** to the packages that need it: any kind of reference or derived geometry (6a adds none), the `derived` source in the code of the step, the axes of the origin, any curve kind, the exhaustive switches over the exact outline (`OutlineCurve`, "Ring 2" below).

## Part 1: the kinds of reference geometry as a registry

**Today.** One kind, the projection of an edge, written into `externalRef` and `projected` (validators), the first stage of `step` and `refs` of `features/sketch.ts`; `solverSetup` and `externalGeometry` of `sketch.ts`; `entityOf` and `derivedPoints` of `sketch-content.ts`; `addExternal`, `updateExternal` and `removeExternal` of `document.ts`.

**Change.** A registry `REFERENCE_KINDS` typed by the union of entries (`ExternalRef['type']`), so a member without an entry does not compile, in a directory of its own:

| File | Content |
|---|---|
| `references/spec.ts` | `ReferenceKindSpec<R, V>` and the type of the derived kind 6c will add (`DerivedKindSpec<R>`, declared in the contract only), `ReferenceContext`, `GeometrySource` |
| `references/edge.ts` | the entry `edge`: `validate` (the body of `externalRef` of today), `refs` (the body and the two faces of the edge), `entities` (the curve, then `a`, `b` or `center`), `value` (the body of `projected` with the check of its kind), `compute` (the projection of today: `lookup` of the body, `analyzeBody`, `projectEdge`), `geometry` (a line over `<id>/a`, `<id>/b`; a circle over `<id>/center` with its radius) |
| `references/index.ts` | `REFERENCE_KINDS`; `kindOf(ref)` with the one cast; `externalRef(context, sketch, entry, what)`, which reads `type` and hands over; `updateProblem`; `entityOf`, `derivedPoints` and `referenceEntities` (moved from `sketch-content.ts`); `resolveReferences`, the first stage of the step |

- An entry says what it is in four places of the document side (`validate`, `refs`, `entities`, `value`) and two of the recompute (`compute`, `geometry`). `entities` is computed from the sketch alone, so commands and `load` are validated from the document, which is why `kind` of an edge projection is stored today ([sketch.md](../../architecture/sketch.md), "Promítnutá geometrie").
- **The layer.** `references/*` sits beside `features/profile.ts`: it imports `solid.ts`, `validation.ts` and `recompute/services.ts`, and is imported by `features/sketch.ts`, `features/index.ts`, `document.ts`, `query/check.ts` and `sketch-tools.ts`, which are all the callers of `entityOf`. Nothing below that layer needs the registry once `solverSetup` takes resolved references, so there is one table per kind, not a leaf table of entities plus a registry. `docs/architecture/repository.md` gets the row; `modules.test.ts` guards the direction.
- **`solverSetup(sketch, references)`** takes `Record<Id, ResolvedReference>` (a value and its `EntryGeometry`) in place of `Record<Id, Projected>`. It adds the points and curves of every entry in the order of the entry IDs, puts every point and every circle of them into `fixed` in that order, and stamps the values by entry ID. That is byte for byte the input and the stamp of today for the edge: `fixed` is `origin`, `x1/a`, `x1/b`, `x2/center`, `x2` for a line `x1` and a circle `x2` (calls.ts, a). The tests that pass `{}` compile and pass as they are.
- **The step** asks `resolveReferences` (compute, else the stored value through `value`, else nothing; `lost` with the code), then `solverSetup`, then as today. The constraints left out because an entry has no values are found by the owner of an operand (`operand === id || operand.startsWith(id + '/')`), as now. The write-back stores the values by entry ID, as now.
- **The validator of the sketch** calls `externalRef` where it calls it today (before the curves). A stored value is read through the kind's `value`; one that does not fit is refused with today's text ("neodpovídá promítnuté geometrii skici").
- **`addExternal`, `updateExternal`, `removeExternal`** keep their branches and texts. `updateExternal` refuses an update that changes the entities of the entry (`updateProblem`: the same IDs with the same kinds), with today's text for the edge ("druh promítnutí změnit nejde"); for the edge that is exactly the rule of today. `removeExternal` removes the constraints whose operands the entry owns, as now.
- **An unknown `type`** keeps today's text ("promítnout jde jen hranu") while the registry has one kind; the package that adds the second kind makes it list the kinds.
- **`externalGeometry`** is removed (dead).
- `ExternalRef` in `types.ts` does not change. A package adds its kind as one member of the union (`ExternalRef = EdgeProjection | …`; the edge's interface is then given a name), one line of the registry and its module.

## Part 2: the profile from a list of curves

**Today.** `detectProfile` builds its shapes from `sketch.curves`, skipping construction curves; `curveOf` of `recompute/profile.ts` reads `sketch.feature.curves` for the shape of a side; `wallOutline` reads `sketch.curves` and builds the same shapes again. Joins: `pointJoins(sketch, geometry)` over the `coincident` constraints.

**Change.**

- `SketchCurve` (contract): `{ id, shape: CurveShape, source, regions }`, the shape over point IDs whose positions are in the used geometry. `sketchCurves(feature, references)`: the own curves (`regions` = not construction), then the curves of the resolved entries (`regions` from `EntryGeometry.regions`: none for an edge).
- `profileOf(curves, joins, geometry, chordTolerance)`: the body of `detectProfile`, over the curves with `regions`, **sorted by ID** as `detectProfile` sorts the own curves, so its loops, its polylines and therefore the meshes stay the same to the bit. `detectProfile(sketch, geometry, chordTolerance)` stays as the profile of the own curves with the coincident joins, for the tests.
- `joinPairs(feature, references)`: the operands of every `coincident`, then the `joins` of the entries (none for an edge); `joinsOf(pairs, geometry)` is the union-find of `pointJoins` over them. `pointJoins(sketch, geometry)` stays (the fillet's `cornerLines`, the tests).
- `SketchState` (internal, `recompute/state.ts`) gets `curves: ReadonlyMap<Id, SketchCurve>` and `joins`. `curveOf` takes the shape from `sketch.curves`; `wall` hands the core of `wallOutline` the own curves of the list and the joins of the state. `wallOutline(sketch, geometry, ids, thickness, move)` stays as the wrapper the tests call.
- The shape of a side (`SideCurve`) is computed by one function from a `SketchCurve`, which the profile, `curveOf` and the wall share.

## Part 3: every switch on the kind of a sketch curve exhaustive

A switch ends in `default: return unreachable(value, what)` (`util.ts`; at run time it throws, which a validated document never reaches). The solver adapter and the app write the two lines locally (`const kind: never = value; throw …`), so nothing is exported for it. A table typed by the union (`CURVE_POINTS`, the adapter's `rank`) is a guard already.

**Measured.** A spline added to `CurveShape` (`{ type: 'spline'; points: Id[] }`, with `'spline'` in `EntityKind`) in a copy of the tree: `tsc` stops at 13 places in 11 files, because they read a field that only the round kinds have or index a table by the kind. The other places compile and would treat a spline as an arc or a circle, or skip it, without a word. The list below is every place, read one by one.

| # | Place | What it does with the kind today | 6a |
|---|---|---|---|
| | **Engine** | | |
| E1 | `sketch-content.ts` `CURVE_POINTS` | a table over `CurveShape['type']` with a check of completeness | guard already |
| E2 | `sketch-content.ts` `curvePoints` | line, circle, else arc | switch |
| E3 | `features/sketch.ts` `curve` (validator) | `oneOf` over a hand-written list, then line, circle, else arc | the list from the keys of `CURVE_POINTS` (`CURVE_KINDS`), and a switch |
| E4 | `features/sketch.ts` `sketchFeature` (radii); `document.ts` `addCurve` | asks "a circle?": only a circle has a radius variable | none: not a switch over the kinds |
| E5 | `document.ts` `setCurvePoint` | `CURVE_POINTS[type]` | guard already |
| E6 | `sketch.ts` `measure` (radius, diameter) | circle, arc, else no value | switch |
| E7 | `sketch.ts` `detectProfile` (the shapes) | circle, else line or arc (tsc stops here) | switch, in the one function of part 2 |
| E8 | `sketch.ts` the profile's `Shape`: `distanceTo`, `midpoint`, `carrierContacts`, `compatible`, the half-edges, `polyline`, `crossings` | each line, (circle,) else arc; `compatible` takes "not a line" as round; `polyline` takes "not an arc" as a line | switch in each (7); `areaOf` (adds the segment of an arc) and the filter of circles need none |
| E9 | `recompute/profile.ts` `curveOf` | line, else round (tsc stops here) | switch (part 2's shape of a side) |
| E10 | `recompute/profile.ts` `generated`; `recompute/services.ts` `axis` | ask for a circle operand, for a line | none |
| E11 | `recompute/outline.ts` `wallOutline` | line, circle, else arc in four lines (tsc stops at two) | switch (part 2 moves it into the shape function) |
| E12 | `analysis.ts` `EQUATIONS.pointOnCurve` | line, else round | switch |
| E13 | `analysis.ts` `EQUATIONS.tangent` | the line first if there is one, then line–round or round–round; the ends of an arc, else none | switch |
| E14 | `analysis.ts` `geometry.radius` | arc, else the variable of a circle | switch |
| E15 | `analysis.ts` `pointsOf` | line, circle, else arc (tsc stops here) | `curvePoints` |
| E16 | `analysis.ts` the size in `derive` | "not a line" has a radius | switch |
| E17 | `analysis.ts` the free radii, `arcRows` | ask "a circle?", "an arc?" | none |
| E18 | `sketch-tools.ts` `shapeOf` (own curves) | line, circle, else arc (tsc stops here) | switch |
| E19 | `sketch-tools.ts` its `Shape`, `closestOn` | line, else round | switch |
| E20 | `sketch-tools.ts` `cornerLines` (`ends`) | line, arc, else no ends | switch |
| E21 | `sketch-tools.ts` `nearestCurvePoint` | `CURVE_POINTS[type]` | guard already |
| E22 | `catalog.ts` the kinds an operand accepts (`ROUND`, `CURVE`), `tangent.check` | lists: a kind not listed is refused | none: 6d says per constraint |
| E23 | `sketch.ts` `solverSetup` | passes every own curve to the solver as it is | none here; A1 makes the adapter decide |
| | **Solver adapter** (`packages/solver-planegcs/src/index.ts`) | | |
| A1 | `buildPrimitives` | line, circle, arc, else throws | `never` (the same throw) |
| A2 | `translate` `pointOnCurve` | line, circle, arc, else throws | `never` |
| A3 | `translate` `equalRadius` | pairs as text, else throws | switch over the kinds of both |
| A4 | `translate` `tangent` | a table `rank` over the kinds (tsc stops here) | guard already |
| A5 | `translate` `radius`, `diameter` | arc, else circle | switch |
| A6 | `fixed` check, `usable`, `pairOf` | ask for one kind | none |
| | **App** | | |
| P1 | `sketch-view.ts` `sketchView` (own curves) | line, circle, else arc (tsc stops here) | switch |
| P2 | `sketch-view.ts` `Shape` and `EntityKind`; `polyline`, `closestOn`, `measure` (radius), `anchorOf` | line, else round | `EntityKind = 'point' \| Shape['type']`; a switch in each (4) |
| P3 | `sketch-commands.ts` `sort` | point, line, else round | switch |
| P4 | `sketch-commands.ts` `dimensionFor` (round) | circle, else radius | switch |
| P5 | `sketch-commands.ts` `CURVE_POINT_LABELS`; `panels/sketch.ts` `repointRow` | a record over `CurvePointName`; `CURVE_POINTS[kind]` (tsc stops at both) | guard already |
| P6 | `sketch-view.ts` `endpoints`, `sketch-commands.ts` `lineEnds`, `lineIds`, `features/revolve.ts` | ask for a line | none |
| | **MCP** | | |
| M1 | `tools.ts` `sketchDetail` | asks "a circle?" for the radius; lists the fields of any kind | none |

So 6a makes 32 switches exhaustive (21 in the engine, 4 in the adapter, 7 in the app) and derives the validator's list from the table; 6 places are guarded by a table already, and the rest ask for one kind or pass every kind on, which is no switch over the kinds.

**Ring 2: the exact outline.** `OutlineCurve` (a line, an arc or a circle of an exact loop, `sketch.ts`) is a second union. Its consumers are the offset, the wall, the taper and the revolve: `touchingCurves` of `sketch.ts`, about 20 places of `recompute/outline.ts` (`reversed`, `numbered`, the middle, the area, the crossings, `selectionOutline`, the corners of a moved outline, the radii of an offset, the division, `sideShape`, the comparison of curves, the chain of a wall), `recompute/taper.ts` (3) and `recompute/tool-revolve.ts` (2). The same spike with a variant added to `OutlineCurve` stops `tsc` at 8 of them (and in one test). 6a does not change them: a loop through a curve that has no exact `OutlineCurve` has no `exact`, and the consumers already refuse such a profile ("The profile has no exact curves…", `selectionOutline`, `taper.ts`, `tool-revolve.ts`), which is the cheap way of 6d (whose text then has to stop saying "a generated profile"). A package that adds a variant to `OutlineCurve` makes these places exhaustive itself; this list is where to start.

## Part 4: the app's sketch tools as a table

**Today.** `Tool` is a union in `sketch-mode.ts`; `TOOLS` lists label and hint; `sketchMove` (the project tool picks edges, the line infers a direction, the select tool highlights), `sketchClick` (project, fillet, select, point, then the shapes of two or three clicks by name), `sketchDown` (only select drags) and `sketchScene` (the rubber band by name) branch by tool; the panel shows the options of the polygon and of the fillet by name; `App.sketching` holds `polygon` and `fillet`.

**Change.** The table of the contract, section 4, in `packages/app/src/sketch-tools/`: `spec.ts` (`SketchToolUi`, `drawn`), a file per tool (`select`, `point`, `line`, `rect`, `polygon`, `circle`, `arc`, `fillet`, `project`) and `index.ts` (`SKETCH_TOOL_UI`). The mode keeps what is common: the place under the pointer and its snap, the inferred direction (for a tool with `infer`), the drag (for one with `drags`), the hover (for one with `hovers`), the places kept, Escape, the marker of a snap, the hover of an edge (for `picks: 'edge'`), and the dispatch to the entry. `App.sketching` holds the options by tool (`tools: Partial<Record<SketchToolName, unknown>>`), each read with its entry's `initial` until set. The polygon's options and the fillet's radius move into their files with their panels (`polygonOptions`, `filletOptions` of `panels/sketch.ts`).

- **The place of a click** is the cursor of the last move (it carries the inferred direction of a line) for every tool but those with `atClick` (select, fillet), which take the place under the click: that is what `sketchClick` does today, and the snapshots would see a difference.
- **What stays exactly:** the labels and hints, the order of the bar, which tool resets what (`setTool`), the batches each tool sends and their messages, the scene (the rubber band of each tool is its `draw`), the panel. The file per tool holds the code that is in the branches today, moved.
- The tools of the app and `SKETCH_TOOLS` of the engine stay two catalogs: most tools of the app are interactions (select, a chain of lines, project), and an engine tool reaches MCP without the app. A tool of the app that runs an engine tool calls `sketchTool` (rectangle, polygon, fillet today; trim, extend and split of 6e).
- The guard is the snapshot test of the app (`packages/app/test/app.test.ts`), which presses every tool of the bar today; it must pass without `-u`.

## Part 5: the result and its readers

**Today.** The result of a sketch has the used positions (own, origin, projected) and radii; the app builds the curves of projections from `external` and those positions, and spells out their derived IDs in four files; `get_sketch` does the same; the engine's `shapeOf` (sketch tools) reads `external[id].kind`.

**Change.**

- `SketchResult.curves: Record<Id, ResultCurve>`: the curves that are not own, `{ shape, source, regions }`, the shape over the IDs whose positions are in `points` (a circle's radius in `radii`). An entry that never had values has none, as it has no points today. **Order:** the entries in the order of `external` in the document (`Object.keys`, as the app iterates today), and within an entry the order of its kind; the app draws and hit-tests in that order, and so do the snapshots.
- `referenceEntities(sketch, id)` and `curvePoints(shape)` are exported by the engine.
- **The app** (`sketch-view.ts`): own curves as today; then for each entry of `external` its entities (`referenceEntities`): points with a position become `PointView`s that are not own, curves with a result curve become `CurveView`s that are not own. The pickers (`axis-picker.ts`, `features/mesh.ts`, `features/extrude.ts`, `lineIds` of `sketch-commands.ts`) list the entities of the entries by kind instead of spelling them. The row of an entry in the panel reads a table by kind, `REFERENCE_UI` (`packages/app/src/references/`: `title`, `detail`, the word of the pickers `tag`, the button `repair`), typed by the union so a new kind does not compile in the app until it has its row; the edge's row is today's ("Úsečka" or "Kružnice", the body, the button that repairs by the tool Project).
- **MCP** (`sketchDetail`): `entities` from `referenceEntities` (the same IDs in the same order), `at` the positions of its point entities, `radius` when the entry itself is a circle. The answer does not change.
- **The engine's sketch tools** (`shapeOf`) take the shape of a curve that is not own from `result.curves`.

## The vocabulary of step 6

What 6b to 6f share, decided here so that none of them decides it by being merged first.

### IDs

- An ID a caller gives has no slash and is not `origin` (as today). An ID with a slash is derived: `<owner>/<local>`, the owner being the part before the first slash, an entry of `external` of the same sketch or `origin`. `local` is not empty and may hold slashes. No document can hold a derived ID already, and two entries never share one.
- **A single curve of a reference** (the projection of an edge; a projection of one entity of another sketch, 6b) is the entry itself, `<owner>`; its points are `<owner>/<name>` with the names of `CURVE_POINTS`: `a`, `b`; `center`; `center`, `start`, `end`. A projected point (6b) is `<owner>` itself.
- **An entry of several entities** (an imported outline, 6f) names them `<owner>/<local>` with the local IDs it stores, curves and points alike; its curves name its points, so two curves of an outline share a vertex as two own curves share a point.
- **A copy** (6c) is `<owner>/<copy>/<source>`: the number of the copy from 1 in decimal (a mirror has copy 1 only) and the ID of the own entity it copies, a curve or a point. The copy of a curve runs over the copies of its source's points, so copies of two curves that share a point share its copy. Raising the count of a pattern adds IDs, lowering it removes the highest; the others stay, and with them the regions and faces named by them.
- **The axes of the origin** (6b) are `origin/x` and `origin/y`, lines through `origin`, the only entities under `origin/`. A point a line of an axis needs in the solver's input is `origin/x/b` or `origin/y/b`, which is no entity (`EntryGeometry.hidden`). **An axis enters the solver's input only when something of the sketch names it** (a constraint, the axis of a mirror), so the stamp of a sketch that does not use the axes does not change and no stored sketch is solved again on load.

### Shapes

The shapes of all sources are `CurveShape` over point IDs: a line, a circle (radius in `radii`), an arc (counter-clockwise from `start` to `end`), and from 6d a spline over control points (6d decides its fields). A point is an entity of the kind `point` with a position. A reference's value in sketch coordinates is the kind's own type (`Projected` for the edge, stored in `solved.external`); its `geometry` turns it into shapes over points. **A mirrored arc swaps its ends** so that it stays counter-clockwise: the image's `start` is the image of the source's `end` (calls.ts, d); its centre side, and so `wallSide` `left`, stays the side of the centre.

### Which geometry forms regions

The owner's answer to question 4 of the plan (2026-11-17), as the flag `regions` of a curve:

| Source | Forms regions |
|---|---|
| An own curve | when it is not a construction curve (as today) |
| The projection of an edge | never (as today) |
| The axes of the origin (6b) | never |
| A curve projected from another sketch (6b) | only when its reference says so (a flag on the reference) |
| An imported outline (6f) | always |
| A copy of a mirror or a pattern (6c) | as its source: a copy of a construction curve forms none |

### Joins

The profile and the chain of a wall join points by one rule: the same ID, or a pair that is within the length tolerance in the used positions, transitively, the vertex named by the smallest ID it holds. The pairs are the operands of the `coincident` constraints and the `joins` an entry declares. (The corner of the fillet keeps reading the `coincident` pairs alone: only own curves count there, and a declared pair joins a curve that is not own.) **A copy and its source are a declared pair** (6c), so a point on the axis of a mirror, or the centre of a circular pattern, is one point with its image, and a half drawn up to the axis closes into one region with its mirror image (calls.ts, d: one region whose outer loop holds both halves). A copied curve all of whose points join those of its source lies on it; 6c leaves such a copy out of the curves, since two curves on each other make the profile invalid. Points are not joined by position alone: two own points at one place without a `coincident` are two vertices today, and stay so.

### One family of entries: derived geometry in `external`

Derived geometry (6c) is a kind of entry of `external`, with `source: 'derived'`, not a second map with commands of its own. `addExternal`, `updateExternal` and `removeExternal` add, change and remove a mirror or a pattern as they do a projection.

- **No upgrade step for 6b, 6c and 6f.** A build without a kind refuses an entry of an unknown `type` by itself ("promítnout jde jen hranu"), where a second map would be dropped without a word and need a step.
- **One set of commands and one place for the cleanup** (`removeExternal` removes the constraints on what the entry owns), one lookup in `entityOf`, one list of entries in the panel.
- **What differs by source**: a reference is computed before the solver, stored as its last valid value and stamped; a derived entry is computed after the solver, never stored or stamped, and no constraint of its own sketch names its entities. The validator of the sketch reads the entries of a derived kind after the curves (it names them), those of a reference kind where it reads entries today.
- The name `external` stays (a rename is a schema step for no gain); the comment of `ExternalRef` in `types.ts`, which the AI reads, says that an entry is reference or derived geometry. Whether the owner prefers a second map is the open question below.

### What consumers accept

| Consumer | Own entity | `origin` | Reference entity | Derived entity |
|---|---|---|---|---|
| A curve of the sketch (its points) | yes | yes | no: a `coincident` joins to it | no |
| An operand of a constraint of its own sketch | yes | yes | yes | **no**: it does not exist when the sketch is solved |
| An operand of a generator (`sketchPoint`, a circle) | yes | yes | yes | yes, by the rule of a reference (the plan) |
| An axis (`sketchPoint`, `sketchLine`), a frame of a placement | yes | yes | yes | yes, likewise |
| A point of a hole (`notProjected`) | yes | yes | no | no (6c defers it; D53 patterns the hole feature) |
| A curve of a wall (`notProjected`) | yes | | no | no |
| `setCurvePoint`, the fillet's corner | yes | yes | no | no |
| A region of a profile | by `regions` | | by `regions` | by `regions` |

A package that wants another row says why. `notProjected` keeps its meaning "own only"; 6c adds to `Entity` that an entity is derived, which the validator of a constraint refuses.

### What the result carries

`SketchResult` (part 5): `points` and `radii` are every used position, own, origin, reference and derived; `curves` the curves that are not own with their `source` and `regions`; `regions` as today (a region's `outerLoop` may name derived and reference curves). The app draws and picks from it; `get_sketch` lists each entry with its `entities`, the positions of its points and, for a single circle, its radius. 6c, 6f decide what more `get_sketch` says of an entry of several entities; the generic part is there.

### Face names

A side face is named by the ID of its curve whatever its source: `{ feature, role: 'side', curve: 'm/1/c2' }` for a copy, `o1/l3` for a curve of an outline, `x2` for a projected curve that forms regions; `wallSide` and `wallEnd` likewise with a derived curve or point. [naming.md](../../architecture/naming.md) allows it already: a text field of a role holds any ID of a sketch, the key stays unambiguous because one field of a role holds a free ID, and a name is compared field by field after its key is found. Such a face has **no copy tag**: a copy tag names a body copied by a feature (D53, D56), while a copy in a sketch is a curve with an ID of its own. The planar side of a derived line starts at its `a`, the copy of the source's `a` (for a mirrored line the image of `a`), as for every line.

## The document and the schema

6a adds nothing to the document and changes nothing an older build reads: no upgrade step. The vocabulary keeps that true for the packages after it as far as it can: a new kind of entry is a new `type`, which an older build refuses by itself; the axes do not enter stamps of sketches that do not use them. A field added to the entry of the edge would be dropped by an older build (its validator rebuilds the entry from the fields it knows) and would need a step.

## Issue codes, MCP and the app

- **Issue codes:** none. A kind of reference reports with the codes of projections today (`brokenProjection`, `unsupportedProjection`, `degenerateProjection`) or adds its own.
- **MCP:** no tool changes its name, schema or answer. `describe_api` shows the new field of `SketchResult` with its comment.
- **The app:** no visible change (part 4 moves the tools, part 5 the reading of projections).

## Rejected alternatives

1. **A second map for derived geometry** (`derived`, with `addDerived`, `updateDerived`, `removeDerived`). Three commands more in `document.ts` (a shared place), a second lookup in `entityOf`, `documentIds`, the IDs of the app and `namedBySections`, and an upgrade step, because an older build would drop the map without a word. Its gain is a clearer name for an AI; the comment of `ExternalRef` gives that too.
2. **A leaf table of entities beside `sketch-content.ts` and a registry above it** (two tables per kind). Every caller of `entityOf` is above the layer of the registry; one table is enough.
3. **The derived points of every curve named after the curve** (`<curve>/a` for a copy too). Copies of two curves that share a point would get two points, and a mirrored outline would not close without joins by position.
4. **Joins by position for all points.** It changes today's profiles: two own points at one place without a `coincident` are two vertices today.
5. **One value type for every kind** (a `Projected` for an outline, a copy). An outline or a mirror is many curves with shared points; the kind's own value and `geometry` say it.
6. **All curves in the result**, own ones too. The document has them with their construction flag; the result would grow for every sketch.
7. **The result and the app left to 6b and 6c.** Both would edit `sketch-view.ts`, the pickers, the panel and `sketchDetail`: the shared place the plan asks 6a to remove.
8. **New signatures for `detectProfile`, `solverSetup`, `wallOutline` with the tests changed.** "The existing tests pass unchanged" is the check of a preparatory part; the old forms stay as wrappers.
9. **The switches over `OutlineCurve` exhaustive now.** About 25 places, and the cheap spline may never add a variant there, since a loop without `exact` is refused by its consumers already.
10. **The axes of the origin in the input of every sketch.** Every stamp would change and every stored sketch would be solved again on load.
11. **One catalog for the tools of the app and the engine's `SKETCH_TOOLS`.** Most tools of the app are interactions, and an engine tool reaches MCP without the app; `FEATURE_UI` keeps the same split between engine and app.
12. **A table of tools with a fixed number of clicks only.** The spline of 6d collects any number of control points, and would edit the mode again.

## Known limits

- **`derivedPoints(id, ref)`** stays exported with its signature; it is right for the kinds whose entities follow from the entry alone. Nothing calls it after part 5 outside the engine's own constraint rule; 6c, whose entities need the sketch, removes it from the exports or gives it the sketch.
- **Ring 2** (`OutlineCurve`) is not exhaustive; a package that adds a variant there makes it so.
- **The text for an unknown kind of entry** names only the edge until 6b.
- **A kind whose entities live outside the sketch** (6f's stored outline) has to copy the list of its entities into its entry, or `entityOf` cannot answer from the sketch alone: a constraint of 6f.
- **`Entity.own: false`** says "fixed for the solver"; 6c adds the mark of a derived entity.

## To verify before the implementation

- That the stamp of every stored sketch stays: load the documents of the tests and of `packages/scenarios`, and compare `solved.inputs` with a recompute of part 1 (a test that runs before and after).
- That `modules.test.ts` passes with `references/*` where part 1 puts it.
- That the snapshots of the app do not change by part 4 or part 5 (the draw order of projections, the place of a click of the fillet).
- That `get_sketch` answers byte for byte as before (the MCP tests, and one sketch with a line and a circle projected compared by hand).
- That the spike of part 3 compiles with no error left out of the table: add a variant to `CurveShape` after part 3 and count the errors; every place of the table that 6a makes exhaustive must be among them.

## Open

1. **Derived geometry as a kind of entry of `external`** (a mirror is `addExternal { ref: { type: 'mirror', … } }`), or a second map with commands of its own and a schema step? *Recommendation: `external`, for the reasons of "One family of entries".*

## Reviews

(Filled after the reviews.)

## Rows for the indexes

**docs/d36/README.md**, the row of 6a, column "Design now":

> designed 2026-11-17, D64 ([6a-sketch-prep/design.md](6a-sketch-prep/design.md)): five parts with no change of behaviour (the kinds of `external` as a registry `REFERENCE_KINDS`, the edge its one entry; the profile, the sides and the wall from a list of curves with a region flag and one rule of joins; 32 switches on the kind of a curve made exhaustive; the app's sketch tools as a table `SKETCH_TOOL_UI`; the result's curves that are not own, `SketchResult.curves`, read by the app and `get_sketch`), and the vocabulary of step 6: derived IDs `<owner>/<local>` (a copy `<owner>/<copy>/<source>`, the axes `origin/x`, `origin/y`, entering the solver only when named), which geometry forms regions, joins declared by an entry (a copy and its source), derived geometry as a kind of entry of `external` (no schema step), what consumers accept, face names by the ID of the curve; no schema step. Open for the owner: `external` or a second map for derived geometry

**docs/decisions.md**, the row of D64:

> | D64 | 6a: the preparatory part of step 6 and its vocabulary | A registry of the kinds of entries of `external` (the projection of an edge its one entry); the profile from a list of curves with a region flag and joins declared by entries; exhaustive switches on the kind of a curve; the app's sketch tools as a table; the result carries the curves that are not own. Derived IDs `<owner>/<local>`; copies `<owner>/<copy>/<source>`; axes `origin/x`, `origin/y` in the solver only when named; regions by the owner's answer to question 4; derived geometry is a kind of entry of `external`, not a second map | [d36/6a-sketch-prep/design.md](d36/6a-sketch-prep/design.md) |

**docs/requirements.md**, validation scenario 15: no part. 6a changes no behaviour; its check is that every existing test passes unchanged, the snapshots of the app included.
