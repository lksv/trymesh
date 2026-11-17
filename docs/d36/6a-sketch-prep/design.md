# 6a Preparatory part and shared vocabulary of step 6 (D64)

**State: designed 2026-11-17 against `master` at `9162198` (schema version 9), on Opus 5.5; reviewed as recorded in "Reviews". Implemented 2026-11-17 in the branch `d36/6a`, the five parts in the order 4, 3, 1, 2, 5, as recorded in "As implemented".** The owner's open question was not answered before the implementation; it follows the recommendation (derived geometry as a kind of entry of `external`). The plan of the step is [6-plan.md](../6-plan.md), "6a Preparatory part and shared vocabulary"; the owner agreed to all ten of its recommendations on 2026-11-17, among them question 4 (which geometry forms regions), which this design writes down.

Files: [contract.ts](contract.ts) (the types and signatures of the five parts and of the vocabulary), [calls.ts](calls.ts) (existing documents and calls as they stay, and how 6b, 6c, 6d, 6e and 6f plug in).

## For 6e, first: the table of the app's sketch tools

6e (trim, extend, split) is designed at the same time and needs only part 4. Its shape, in full in [contract.ts](contract.ts), section 4:

- A tool of the sketch bar is a file in `packages/app/src/sketch-tools/` and one line of `SKETCH_TOOL_UI` in `packages/app/src/sketch-tools/index.ts`. The bar shows the tools in the order of the table; `SketchMode.tool` is a key of the table.
- An entry is `SketchToolUi<O>`: `label`, `hint`; `picks`: `sketch` (the default: a place snapped to a point or a curve, points first, as today), `curve` (a place on a curve only, of the curves `eligible` lets through: its `at` the point of the curve nearest the pointer and the curve its snap, as a snap to a curve is today; away from every such curve the bare pointer without a snap), `edge` (an edge of the model), or a picker of the tool's own (`pick`, for what the mode does not know: the geometry of another sketch, 6b), whose place may carry a snap the mode keeps as it is (`{ kind: 'foreign', sketch, id }`: the mode drops a kept place only when its own snap is gone); `clicks` (a shape of so many places; without it `click` is called at every click); `click(host, m, places, context, options, event)`, which returns the places to keep for the next click, nothing meaning none (the line returns its end, so the chain goes on; a spline returns all it has); `finish` (Enter); `draw(places, cursor, context, options)`, polylines drawn dashed while the pointer moves; `options` (`initial` and `panel`) for what the tool remembers; the flags `infer`, `hovers`, `drags`, `atClick`.
- A drawing tool sends its batch through `drawn`, which applies the switch of construction curves. A tool whose batch must stay as the engine made it (the fillet; trim, extend, split) runs it with `host.run` and says what it did, as the fillet does today.
- So the tool *Trim* of 6e has `picks: 'curve'` (a click near a crossing point still gives the curve), one click, the batch of the engine's sketch tool run as it is, and `draw` returning the piece that click would remove; calls.ts, section g, writes it.

## What the plan says, checked against the code

| Statement of the plan | What the code says |
|---|---|
| `entityOf` and `derivedPoints` (`sketch-content.ts`) know an own point or curve, the origin and the derived points of a projected edge | True. The derived IDs of a projection are spelled out in seven more places: `solverSetup` and `externalGeometry` of `sketch.ts`, `shapeOf` of `sketch-tools.ts`, `sketchDetail` of `packages/mcp/src/tools.ts`, and in the app `sketch-view.ts`, `axis-picker.ts` and `features/mesh.ts` (`features/extrude.ts` calls `derivedPoints`). The label of a row of the list of projections (`panels/sketch.ts`) and the lines an axis may run along (`lineIds`, `sketch-commands.ts`) read `ref.kind`. The fillet's list `shortened` reads `ref.edge` of every entry (`sketch-tools.ts`), and the description for the AI spells `<id>/center` and the ends of a projected line in its text (`packages/mcp/src/api.ts`) |
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
- **No test imports `sketch-content.ts` directly**; `entityOf` and `derivedPoints` reach the tests through the re-exports of `document.ts`, and `derivedPoints` (not `entityOf`) reaches the app through `index.ts`. They can move.
- **Two readers of a solved sketch take curves from the input of the solver**: the axis of the kind `sketchLine` (`recompute/services.ts`, `axis`) and the circle operand of a generator (`recompute/profile.ts`, `generated`). Curves that never enter that input (derived curves, 6c; an axis of the origin that nothing constrains, 6b) would be invisible to them.
- **The expressions of a sketch are kept only under `constraints/`**: `withConstraints` of `document.ts` drops every other address when a constraint is added or removed, and `addExternal` validates an entry without a reader of numeric fields. A numeric field of an entry (the count of a pattern, 6c) needs both.
- **The app's own copy of the kinds**: `sketch-view.ts` declares `EntityKind = 'point' | 'line' | 'circle' | 'arc'` beside its `Shape`, so a kind added to the engine does not reach it by type.

## The cheap variant

Five parts, each a point of work with the procedure of CLAUDE.md, each verified by "the existing tests pass unchanged" (the snapshots of the app included). Parts 1 to 4 change no public type; part 5 adds a field to `SketchResult` and two exported functions, changes no answer, and changes one test, which builds a result by hand (`packages/app/test/sketch-tools.test.ts`, "promítnutá kružnice je v pohledu…": its hand-made result gets the curve `x` that the engine now gives). The vocabulary is written into the contract and the docs of the area before 6b to 6f design against it.

| Part | What | Public type | Review (CLAUDE.md) |
|---|---|---|---|
| 1 | The kinds of the entries of `external` as a registry | none | none if the tests pass unchanged |
| 2 | The profile, the sides and the wall read a list of curves with a region flag; one rule of joins | none | none if the tests pass unchanged |
| 3 | Every switch on the kind of a sketch curve exhaustive | none | none if the tests pass unchanged |
| 4 | The app's sketch tools as a table | none (app only) | none if the snapshots do not change |
| 5 | The result of a sketch carries its curves that are not own; the app and MCP read them and the registry | `SketchResult.curves`; `referenceEntities`, `curvePoints` exported; one test's hand-made result | light |

**Order of the commits:** 4 first (6e waits only for it), then 3, 1, 2, 5. Parts 1 and 3 do not depend on each other; 2 builds on the resolved references of 1; 5 on both.

**Deferred** to the packages that need it: any kind of reference or derived geometry (6a adds none), the `derived` source in the code of the step, the axes of the origin, any curve kind, the exhaustive switches over the exact outline (`OutlineCurve`, "Ring 2" below).

**Slots, not mechanisms.** Parts 1 and 2 move code and change no behaviour, so CLAUDE.md lets them go without a review when the tests pass unchanged. What no kind of today uses would be code without a caller and without a test: the numeric fields of an entry and their expressions, the declared joins and the join keys, a resolved reference without a value, the parts of the rule of an update that the edge never reaches (a constrained entity that goes, a change of source). 6a fixes their form in the contract and the one function each goes into (`withConstraints` and the two commands of `document.ts`; `joinPairs` of `sketch.ts`; `solverSetup`; `updateProblem`); the first package that uses one writes it there with its tests and its review (6c the fields, the declared joins and the keys of copies; 6b the keys of projections and the slot of the axes; 6c or 6f the rest of the rule of an update). So they are named places with a fixed form, not shared code each package redesigns.

## Part 1: the kinds of reference geometry as a registry

**Today.** One kind, the projection of an edge, written into `externalRef` and `projected` (validators), the first stage of `step` and `refs` of `features/sketch.ts`; `solverSetup` and `externalGeometry` of `sketch.ts`; `entityOf` and `derivedPoints` of `sketch-content.ts`; `addExternal`, `updateExternal` and `removeExternal` of `document.ts`.

**Change.** A registry `REFERENCE_KINDS` typed by the union of entries (`{ [T in ExternalRef['type']]: … }`, each entry with the source its kind has), so a member without an entry does not compile, in a directory of its own:

| File | Content |
|---|---|
| `references/spec.ts` | `ReferenceKindSpec<R, V>` and the type of the derived kind 6c will add (`DerivedKindSpec<R>`, declared in the contract only), `ReferenceContext`, `GeometrySource` |
| `references/edge.ts` | the entry `edge`: `validate` (the body of `externalRef` of today), `refs` (the body and the two faces of the edge), `faces` (the two faces of the edge, which the fillet's `shortened` reads), `entities` (the curve, then `a`, `b` or `center`), `value` (the check that a stored value is of the kind of the reference), `compute` (the projection of today: `lookup` of the body, `analyzeBody`, `projectEdge`), `geometry` (a line over `<id>/a`, `<id>/b`; a circle over `<id>/center` with its radius) |
| `references/index.ts` | `REFERENCE_KINDS`; `kindOf(ref)` with the one cast; `externalRef(context, sketch, entry, what)`, which reads `type` and hands over; `updateProblem`; `entityOf`, `derivedPoints` and `referenceEntities` (moved from `sketch-content.ts`); `resolveReferences`, the first stage of the step |

- An entry says what it is in five places of the document side (`validate`, `refs`, `faces`, `entities`, `value`) and two of the recompute (`compute`, `geometry`). `entities` is computed from the sketch alone, so commands and `load` are validated from the document, which is why `kind` of an edge projection is stored today ([sketch.md](../../architecture/sketch.md), "Promítnutá geometrie").
- **The layer.** `references/*` sits beside `features/profile.ts`: it imports `solid.ts`, `validation.ts` and `recompute/services.ts`, and is imported by `features/sketch.ts`, `features/index.ts`, `document.ts`, `query/check.ts` and `sketch-tools.ts`, which are all the callers of `entityOf`. Nothing below that layer needs the registry once `solverSetup` takes resolved references, so there is one table per kind, not a leaf table of entities plus a registry. `docs/architecture/repository.md` gets the row and its place in the order of the layers; `modules.test.ts` finds the directory and guards that no cycle comes of it (it does not check the order of the layers itself).
- **`solverSetup(sketch, references)`** takes `Record<Id, ResolvedReference>` (a value and its `EntryGeometry`) in place of `Record<Id, Projected>`. It adds the points and curves of every entry in the order of the entry IDs, puts every point and every circle of them into `fixed` in that order, and stamps the values by entry ID. The slot for 6b: a resolved reference may come without a value, under a key that is no entry (`origin` for the axes); it enters the input and is neither stamped nor stored, and its curves change the stamp through the curves of the input, as they should. `resolveReferences` puts the axes there only when a constraint names one; the list of curves of part 2 has them always. (Implemented by 6b.) That is byte for byte the input and the stamp of today for the edge: `fixed` is `origin`, `x1/a`, `x1/b`, `x2/center`, `x2` for a line `x1` and a circle `x2` (calls.ts, a). The tests that pass `{}` compile and pass as they are.
- **The step** asks `resolveReferences` (compute, else the stored value through `value`, else nothing; `lost` with the code), then `solverSetup`, then as today. The constraints left out because an entry has no values are found by the owner of an operand (`operand === id || operand.startsWith(id + '/')`), as now. The write-back stores the values by entry ID, as now.
- **The validator of the sketch** calls `externalRef` where it calls it today (before the curves), in the order of the document. A stored value is first read by its form (the union of the values; today `projected`, with its texts), then its entry is looked up and the kind's `value` checks that it fits; one that does not is refused with today's text ("neodpovídá promítnuté geometrii skici"). So a value that is malformed and has no entry still gets the text of a malformed value, as today.
- **Numeric fields of an entry** (the form; implemented by 6c). `validate` gets the `ValidationContext` (the reader of numeric fields) and reads a field of an entry at `external/<id>/<name>`, so `fieldsOf`, `setField` and `renameParameter` reach it as they reach a constraint's value (`setField` writes it with `withPath`, the recompute reads it the same way). `addExternal` and `updateExternal` validate the entry with a fresh reader over no expressions, as `addConstraint` does (`new Fields('add', {}, …)`), and hand its expressions to the cleanup as changes: `updateExternal` first sets every address under `external/<id>/` to `null`, so a number given for a field removes its expression, as `setConstraintValue` and `setField` do. `withConstraints` keeps an expression under `external/<id>/` while the entry is there and its kind reads that address, which it learns by validating the entry once (as `fieldsOf` learns the fields of a feature); `removeExternal` drops them. The edge has no field, so nothing changes for it.
- **`addExternal`, `updateExternal`, `removeExternal`** keep their branches and texts. `updateExternal` (`updateProblem`, checked in this order) refuses an update that changes the source of the entry (reference or derived; written by 6c, the first package with a second source), and one under which an entity that stays (the same ID) changes its kind, with today's text for the edge ("druh promítnutí změnit nejde"); for the edge, whose curve `<id>` is a line or a circle by `kind`, that is exactly the rule of today. Then (6c or 6f writes this part) it refuses one under which an entity that a constraint of the sketch names goes away, naming the constraint: the caller removes it first (an update never removes constraints by itself). Other entities may come and go. So the count of a pattern (6c), whose entities no constraint names, is an update, and so is a revised outline (6f) as long as what is constrained stays.
- **An entry may name an own entity that is gone** (a mirror whose source curve was removed): the entry stays valid, as a reference to a removed feature does, and its kind reports it in the step (`brokenReference` with the entity). `removeEntity`, `setCurvePoint` and `setConstruction` do not look at entries; `entities` of a kind skips what it cannot find.
- **An unknown `type`** keeps today's text ("promítnout jde jen hranu") while the registry has one kind; the package that adds the second kind makes it list the kinds.
- **`externalGeometry`** is removed (dead).
- **The fillet's `shortened`** reads the faces of every entry through the kind (`faces(ref)`), not `ref.edge`.
- `ExternalRef` in `types.ts` does not change. A package adds its kind as one member of the union (`ExternalRef = EdgeProjection | …`; the edge's interface is then given a name), one line of the registry and its module.

## Part 2: the profile from a list of curves

**Today.** `detectProfile` builds its shapes from `sketch.curves`, skipping construction curves; `curveOf` of `recompute/profile.ts` reads `sketch.feature.curves` for the shape of a side; `wallOutline` reads `sketch.curves` and builds the same shapes again. Joins: `pointJoins(sketch, geometry)` over the `coincident` constraints.

**Change.**

- `SketchCurve` (contract): `{ id, shape: CurveShape, source, regions }`, the shape over point IDs whose positions are in the used geometry. `sketchCurves(feature, references)`: the own curves (`regions` = not construction), then the curves of the resolved entries (`regions` from `EntryGeometry.regions`: none for an edge).
- `profileOf(curves, joins, geometry, chordTolerance)`: the body of `detectProfile`, over the curves with `regions`, **sorted by ID** as `detectProfile` sorts the own curves, so its loops, its polylines and therefore the meshes stay the same to the bit. `detectProfile(sketch, geometry, chordTolerance)` stays as the profile of the own curves with the coincident joins, for the tests.
- `joinPairs(feature, references)`: the operands of every `coincident`, then (written by 6c and 6b) the `joins` of the entries and every two points of entries that carry the same join `key` (see "Joins" for why a key is needed across entries); `joinsOf(pairs, geometry)` is the union-find of `pointJoins` over them. The state's joins are built after the derived entries of 6c, whose pairs and keys come after the solver. `pointJoins(sketch, geometry)` stays (the fillet's `cornerLines`, the tests).
- `SketchState` (internal, `recompute/state.ts`) gets `curves: ReadonlyMap<Id, SketchCurve>` and `joins`; its `geometry` holds every used position (own, origin, reference, and from 6c derived). `curveOf` takes the shape from `sketch.curves`; `wall` hands the core of `wallOutline` the own curves of the list and the joins of the state. `wallOutline(sketch, geometry, ids, thickness, move)` stays as the wrapper the tests call.
- **The other readers of a solved sketch's curves** take them from `sketch.curves` too: the axis `sketchLine` (`recompute/services.ts`, `axis`) and the circle operand of a generator (`recompute/profile.ts`, `generated`). Today the list holds exactly the curves of the solver's input, so nothing changes; from 6b and 6c on it also holds what never enters that input.
- The shape of a side (`SideCurve`) and of a profile's curve is computed by one function from a `SketchCurve` **and a reader of the positions of its ends**: `curveOf` reads raw positions throughout, as today; the profile and the wall read the ends (a line's `a`, `b`, an arc's `start`, `end`) at their joined vertices and the centre of an arc or a circle raw, as today (`detectProfile` and `wallOutline` read `geometry.points[c.center]` directly). One function, the same numbers to the bit.

## Part 3: every switch on the kind of a sketch curve exhaustive

A switch ends in `default: return unreachable(value, what)` (`util.ts`; at run time it throws, which a validated document never reaches). The solver adapter and the app write the two lines locally (`const kind: never = value; throw …`), so nothing is exported for it. A table typed by the union (`CURVE_POINTS`, the adapter's `rank`) is a guard already.

**Measured.** In a copy of the tree (`rsync` of the worktree without `node_modules`, the worktree's `node_modules` linked in), three edits: `| { type: 'spline'; points: Id[] }` added to `CurveShape` (`types.ts`), `'points'` added to `CurvePointName`, and `'spline'` added to `EntityKind` (`catalog.ts`); then `npx tsc -p tsconfig.json --noEmit`. It stops at 13 places in 11 files (36 diagnostics on 19 lines; a place is one function), because they read a field that only the round kinds have or index a table by the kind. Without the edit of `CurvePointName` it is 10 files (the reviewers' count): `CURVE_POINT_LABELS` fails only through that name. The other places compile and would treat a spline as an arc or a circle, or skip it, without a word. The three unions of shapes that are not `CurveShape` (the profile's `Shape` in `sketch.ts`, `Shape` of `sketch-tools.ts`, `Shape` of the app's `sketch-view.ts`) are independent and are not reached by that edit; their places are in the list by reading. The list below is every place, read one by one.

| # | Place | What it does with the kind today | 6a |
|---|---|---|---|
| | **Engine** | | |
| E1 | `sketch-content.ts` `CURVE_POINTS` | a table over `CurveShape['type']` with a check of completeness | guard already |
| E2 | `sketch-content.ts` `curvePoints` | line, circle, else arc (tsc stops here) | switch |
| E3 | `features/sketch.ts` `curve` (validator) | `oneOf` over a hand-written list, then line, circle, else arc | the list from the keys of `CURVE_POINTS` (`CURVE_KINDS`), and a switch |
| E4 | `features/sketch.ts` `sketchFeature` (radii); `document.ts` `addCurve` | asks "a circle?": only a circle has a radius variable | none: not a switch over the kinds |
| E5 | `document.ts` `setCurvePoint` | `CURVE_POINTS[type]` | guard already |
| E6 | `sketch.ts` `measure` (radius, diameter) | circle, arc, else no value | switch |
| E7 | `sketch.ts` `detectProfile` (the shapes) | circle, else line or arc (tsc stops here) | switch, in the one function of part 2 |
| E8 | `sketch.ts` the profile's `Shape`: `distanceTo`, `midpoint`, `carrierContacts`, `compatible`, the half-edges, `areaOf`, `polyline`, `crossings` | each line, (circle,) else arc; `compatible` takes "not a line" as round; `areaOf` adds the bulge of an arc only, so another curved kind would lose its bulge, and the area decides the sense of a loop and the nesting; `polyline` takes "not an arc" as a line | switch in each (8); the filter of circles needs none |
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
| E24 | `features/profile.ts` `WALL_CURVE_KINDS` | a list of the kinds a wall takes: a kind not listed is refused | none: 6d says whether a wall takes a spline (the plan: refused) |
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

So 6a makes 33 switches exhaustive (22 in the engine, 4 in the adapter, 7 in the app) and derives the validator's list from the table; 6 places are guarded by a table already, and the rest ask for one kind or pass every kind on, which is no switch over the kinds.

**Ring 2: the exact outline.** `OutlineCurve` (a line, an arc or a circle of an exact loop, `sketch.ts`) is a second union. Its consumers are the offset, the wall, the taper and the revolve: `touchingCurves` of `sketch.ts`, about 20 places of `recompute/outline.ts` (`reversed`, `numbered`, the middle, the area, the crossings, `selectionOutline`, the corners of a moved outline, the radii of an offset, the division, `sideShape`, the comparison of curves, the chain of a wall), `recompute/taper.ts` (3) and `recompute/tool-revolve.ts` (2). The same spike with a variant added to `OutlineCurve` stops `tsc` at 8 of them (and in one test). 6a does not change them: a loop through a curve that has no exact `OutlineCurve` has no `exact`, and the consumers already refuse such a profile ("The profile has no exact curves…", `selectionOutline`, `taper.ts`, `tool-revolve.ts`), which is the cheap way of 6d (whose text then has to stop saying "a generated profile"). A package that adds a variant to `OutlineCurve` makes these places exhaustive itself; this list is where to start.

## Part 4: the app's sketch tools as a table

**Today.** `Tool` is a union in `sketch-mode.ts`; `TOOLS` lists label and hint; `sketchMove` (the project tool picks edges, the line infers a direction, the select tool highlights), `sketchClick` (project, fillet, select, point, then the shapes of two or three clicks by name), `sketchDown` (only select drags) and `sketchScene` (the rubber band by name) branch by tool; the panel shows the options of the polygon and of the fillet by name; `App.sketching` holds `polygon` and `fillet`.

**Change.** The table of the contract, section 4, in `packages/app/src/sketch-tools/`: `spec.ts` (`SketchToolUi`, `drawn`), a file per tool (`select`, `point`, `line`, `rect`, `polygon`, `circle`, `arc`, `fillet`, `project`) and `index.ts` (`SKETCH_TOOL_UI`). The mode keeps what is common: the place under the pointer and its snap (points first for `picks: 'sketch'`, curves only for `picks: 'curve'`), the inferred direction (for a tool with `infer`), the drag (for one with `drags`), the hover (for one with `hovers`), the places kept (what `click` returned; nothing means none, and the mode redraws the scene when it keeps the places of an unfinished shape, as `sketchClick` does today), Escape, the marker of a snap, the hover of an edge (for `picks: 'edge'`), and the dispatch to the entry. `App.sketching` holds the options by tool (`tools: Partial<Record<SketchToolName, unknown>>`), each read with its entry's `initial` until set. The polygon's options and the fillet's radius move into their files with their panels (`polygonOptions`, `filletOptions` of `panels/sketch.ts`).

- **The place of a click** is the cursor of the last move (it carries the inferred direction of a line) for every tool but those with `atClick` (select, fillet), which take the place under the click: that is what `sketchClick` does today, and the snapshots would see a difference.
- **What stays exactly:** the labels and hints, the order of the bar, which tool resets what (`setTool`), the batches each tool sends and their messages, the scene (the rubber band of each tool is its `draw`), the panel, and **the calls that redraw**: the snapshots count the scenes set (`app-kit.ts`, "view: N scene(s) set"), and today a kept click, a finished shape and the select tool redraw the scene (select also the panel) while the point tool does not. Each entry's `click` makes the calls its branch makes today; the mode adds only the redraw after a kept place of an unfinished shape (`clicks` not reached), which is the call of today. The file per tool holds the code that is in the branches today, moved.
- The tools of the app and `SKETCH_TOOLS` of the engine stay two catalogs: most tools of the app are interactions (select, a chain of lines, project), and an engine tool reaches MCP without the app. A tool of the app that runs an engine tool calls `sketchTool` (rectangle, polygon, fillet today; trim, extend and split of 6e).
- The guard is the snapshot test of the app (`packages/app/test/app.test.ts`), which presses every tool of the bar today; it must pass without `-u`.

## Part 5: the result and its readers

**Today.** The result of a sketch has the used positions (own, origin, projected) and radii; the app builds the curves of projections from `external` and those positions, and spells out their derived IDs in four files; `get_sketch` does the same; the engine's `shapeOf` (sketch tools) reads `external[id].kind`.

**Change.**

- `SketchResult.curves: Record<Id, ResultCurve>` (one literal of `SketchResult` in the engine, the sketch step): the curves that are not own, `{ shape, source, regions }`, the shape over the IDs whose positions are in `points` (a circle's radius in `radii`). An entry that never had values has none, as it has no points today. **Order:** the entries in the order of `external` in the document (`Object.keys`, as the app iterates today), and within an entry the order of its kind; the app draws and hit-tests in that order, and so do the snapshots.
- `referenceEntities(sketch, id)` and `curvePoints(shape)` are exported by the engine.
- **The app** (`sketch-view.ts`): own curves as today; then for each entry of `external` its entities (`referenceEntities`): points with a position become `PointView`s that are not own, curves with a result curve become `CurveView`s that are not own. The pickers (`axis-picker.ts`, `features/mesh.ts`, `features/extrude.ts`, `lineIds` of `sketch-commands.ts`) list the entities of the entries by kind instead of spelling them. The row of an entry in the panel reads a table by kind, `REFERENCE_UI` (`packages/app/src/references/`: `title`, `detail`, the word of the pickers `tag`, the button `repair`), typed by the union of all kinds, reference and derived, so a new kind does not compile in the app until it has its row; the edge's row is today's ("Úsečka" or "Kružnice", the body, the button that repairs by the tool Project). The rest of the row reads the entities of the entry, not its ID: "bez geometrie" when no entity of the entry has a position (today: its curve is not in the view, which is the same for an edge), the hover marks the curves of the entry (for an edge its one curve, as today; its points are not marked), or its point when the entry is one. Deleting by the selection removes an entry when its own ID is selected, as today; an entry whose ID is no entity (an outline, a mirror) is removed by its row.
- **MCP** (`sketchDetail`): `entities` from `referenceEntities` (the same IDs in the same order), `at` the positions of its point entities, `radius` when the entry itself is a circle. The answer does not change.
- **The engine's sketch tools** (`shapeOf`) take the shape of a curve that is not own from `result.curves`.
- **One test changes**: `packages/app/test/sketch-tools.test.ts`, "promítnutá kružnice je v pohledu jako pevná křivka se středem", builds a result by hand from a real one plus the point `x/center` and the radius of `x`; it gets `curves: { x: { shape: { type: 'circle', center: 'x/center' }, source: 'reference', regions: false } }` as well, which is what the engine now gives for such a sketch. No other test builds a result by hand (the engine, MCP, scenario and app tests were searched). A fallback in the view that rebuilt the curve from the document when the result has none was rejected: it is the code part 5 removes.

## The vocabulary of step 6

What 6b to 6f share, decided here so that none of them decides it by being merged first.

### IDs

- An ID a caller gives has no slash and is not `origin` (as today). An ID with a slash is derived: `<owner>/<local>`, the owner being the part before the first slash, an entry of `external` of the same sketch or `origin`. `local` is not empty and may hold slashes. No document can hold a derived ID already, and two entries never share one.
- **A single curve of a reference** (the projection of an edge; a projection of one entity of another sketch, 6b) is the entry itself, `<owner>`; its points are `<owner>/<name>` with the names of `CURVE_POINTS`: `a`, `b`; `center`; `center`, `start`, `end`. A projected point (6b) is `<owner>` itself.
- **An entry of several entities** (an imported outline, 6f) names them `<owner>/<local>` with the local IDs it stores, curves and points alike; its curves name its points, so two curves of an outline share a vertex as two own curves share a point.
- **A copy** (6c) is `<owner>/<copy>/<source>`: the number of the copy from 1 in decimal (a mirror has copy 1 only; a pattern in two directions numbers its copies as D53 does, `i + 1000 · j`, so a larger count renumbers nothing) and the ID of the own entity it copies, a curve or a point, `origin` included (a copied curve through the origin runs through `<owner>/<copy>/origin`). The copy of a curve runs over the copies of its source's points, so copies of two curves that share a point share its copy. Raising the count of a pattern adds IDs, lowering it removes the highest; the others stay, and with them the regions and faces named by them.
- **The axes of the origin** (6b) are `origin/x` and `origin/y`, lines through `origin`, the only entities under `origin/`. A point a line of an axis needs is `origin/x/b` or `origin/y/b`, which is no entity (`EntryGeometry.hidden`). **The axes are in the list of curves and the geometry of every sketch** (so a mirror, a revolve, a pattern or a joint about `origin/x` finds them): `sketchCurves` and the state's geometry add them, with their hidden far points, whatever the constraints. **They are in the solver's input only when a constraint names one** (a resolved reference without a value under the key `origin`, part 1). The result of every sketch then carries them in `curves` and their far points in `points`, which changes every result once 6b is in (6b's change, as it should be); the app draws no hidden point, and whether it draws the axes is 6b's. So the stamp of a sketch whose constraints do not use the axes does not change, and no stored sketch adopts a new solution on load. (The solver is called at every recompute anyway, for the status; what the stamp decides is whether its positions are taken.)

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

The profile and the chain of a wall join points by one rule: the same ID, or a pair that is within the length tolerance in the used positions, transitively, the vertex named by the smallest ID it holds. The pairs are the operands of the `coincident` constraints and the `joins` an entry declares. (The corner of the fillet keeps reading the `coincident` pairs alone: only own curves count there, and a declared pair joins a curve that is not own.) **A copy and its source are a declared pair** (6c), so a point on the axis of a mirror, or the centre of a circular pattern, is one point with its image, and a half drawn up to the axis closes into one region with its mirror image (calls.ts, d: one region whose outer loop holds both halves).

**Joins travel with the geometry.** Two points that are one vertex where they come from are one vertex where they arrive, and an entry says so by a **join key** per point (`EntryGeometry.keys`): every two points of the sketch's entries with the same key are a pair, joined when they are within the length tolerance, as any pair. A key is a tuple written as JSON, its first element the kind that made it (`["mirror","m",1,"p3"]`, `["sketch","s1","p2"]`), so keys of different kinds never meet and an ID with a colon or a slash cannot make two keys alike.
- A copy carries the vertex of its source: the key of `<owner>/<n>/p` holds `<owner>`, `n` and the vertex of `p` in the solved sketch by the joins of the whole sketch before the derived entries (coincidents, the declared joins and keys of the references: `SolvedOwn.joins`), so the images of two source ends that a `coincident` joins (two points, not one) are joined too, and so are the images of two own ends tied to one projected point. Without it such a mirrored half would leave its images apart and the profile invalid (codex reproduced it).
- A projection from another sketch (6b) keys each projected point by the source sketch and the vertex of its source point there. The vertex depends on the solved source, which `geometry` does not see, so the **value** of such a kind carries the key of each point: it is stored with the value and stamped with it (a change of the joins in the source then solves this sketch again, as it should), and a frozen value keeps its keys; so four entries that project the four sides of a rectangle close into one loop. By hand it takes an own point tied to both ends by two `coincident` constraints (one between the two fixed points is refused, `features/sketch.ts`, "vazba jen mezi pevnými entitami"): four more points for a rectangle; the key makes it automatic.
- An outline (6f) shares its vertices by ID and needs no key.
- The edge has none, so today's joins do not change.

**A copy that lies on its source** (a curve on the axis of a mirror) is left out of the curves by 6c, since two curves on each other make the profile invalid. "Lies on" is decided from what the curve occupies, not from its defining points: a half circle with its centre and both ends on the axis keeps all three points under the mirror but is the other half circle (the ends swap), and the two halves form one region; a line on the axis and its image occupy the same segment. Points are not joined by position alone: two own points at one place without a `coincident` are two vertices today, and stay so.

### One family of entries: derived geometry in `external`

Derived geometry (6c) is a kind of entry of `external`, with `source: 'derived'`, not a second map with commands of its own. `addExternal`, `updateExternal` and `removeExternal` add, change and remove a mirror or a pattern as they do a projection.

- **No upgrade step for 6b, 6c and 6f.** A build without a kind refuses an entry of an unknown `type` by itself ("promítnout jde jen hranu"), where a second map would be dropped without a word and need a step.
- **One set of commands and one place for the cleanup** (`removeExternal` removes the constraints on what the entry owns, and its expressions), one lookup in `entityOf`, one list of entries in the panel. An update follows the rule of part 1: the source stays, a constrained entity stays with its kind, others may come and go (the count of a pattern).
- **What differs by source**: a reference is computed before the solver, stored as its last valid value and stamped; a derived entry is computed after the solver, never stored or stamped, and no constraint of its own sketch names its entities. The validator of the sketch creates the keys of `external` in the order of the document, validates the entries of a reference kind where it does today and fills those of a derived kind after the curves (they name them), so a saved and loaded document keeps the order of its entries and the app draws them in it.
- The name `external` stays (a rename is a schema step for no gain); the comment of `ExternalRef` in `types.ts`, which the AI reads, says that an entry is reference or derived geometry. Whether the owner prefers a second map is the open question below.

### What consumers accept

| Consumer | Own entity | `origin` | Reference entity | Derived entity |
|---|---|---|---|---|
| A curve of the sketch (its points) | yes | yes | no: a `coincident` joins to it | no |
| An operand of a constraint of its own sketch | yes | yes | yes | **no**: it does not exist when the sketch is solved |
| An operand of a generator (`sketchPoint`, a circle) | yes | yes | yes | yes, by the rule of a reference (the plan) |
| An axis (`sketchPoint`, `sketchLine`), a frame of a placement | yes | yes | yes | yes, likewise (read from the list of curves and the geometry, part 2) |
| A point of a hole (`notProjected`) | yes | yes | no | no (6c defers it; D53 patterns the hole feature) |
| A curve of a wall (`notProjected`) | yes | | no | no |
| `setCurvePoint`, the fillet's corner | yes | yes | no | no |
| A region of a profile | by `regions` | | by `regions` | by `regions` |

A package that wants another row says why. `notProjected` keeps its meaning "own only"; 6c adds to `Entity` that an entity is derived, which the validator of a constraint refuses.

### What the result carries

`SketchResult` (part 5): `points` and `radii` are every used position, own, origin, reference and derived; `curves` the curves that are not own with their `source` and `regions`; `regions` as today (a region's `outerLoop` may name derived and reference curves). The app draws and picks from it; `get_sketch` lists each entry with its `entities`, the positions of its points and, for a single circle, its radius. 6c, 6f decide what more `get_sketch` says of an entry of several entities; the generic part is there.

### Face names

A side face is named by the ID of its curve whatever its source: `{ feature, role: 'side', curve: 'm/1/c2' }` for a copy, `o1/l3` for a curve of an outline, `x2` for a projected curve that forms regions; `wallSide` and `wallEnd` likewise with a derived curve or point. [naming.md](../../architecture/naming.md) allows a text field of a role to hold any ID of a sketch, **but the key of today is not unambiguous once that ID has a slash**: `{ curve: 'o/l/@p:1' }` and `{ curve: 'o/l', copy: [{ pattern: 'p', index: 1 }] }` both key `E/side/o/l/@p:1` (`faceKey`, `face-roles.ts`), and the table of face numbers keeps one number per key (codex reproduced it; the comparison by fields afterwards cannot bring the other face back). So **a text field of a role that holds a slash is written into the key as a JSON string** (`E/side/"o/l"/@p:1`), as the key of an insertion quotes its inner key (D62). No face a feature makes today has a slash in such a field (holes take own points, walls own curves and the points they name, sides own curve IDs, generators the names of their catalog), so no key of a model of today changes. The key of a name with such a field does change, and two expectations of `face-roles.test.ts` pin it for hypothetical names (`point: 'rim/center'` keys `H/holeBore/rim/center`); the package that quotes (6c or 6f, whichever names a face so first) changes them, the header of `face-roles.ts` and the rule in naming.md ("at most one free field, so unambiguous"), and adds the case. A copy in a sketch is **not expressed by a copy tag**: a copy tag names a body copied by a feature (D53, D56), while a copy in a sketch is a curve with an ID of its own; a body copied by a pattern afterwards adds its tag to that name as to any (`E/side/"m/1/c2"/@p:2`). The planar side of a derived line starts at its `a`, the copy of the source's `a` (for a mirrored line the image of `a`), as for every line.

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
13. **An update of an entry that removes the constraints on entities it loses.** An update would then lose data without being asked; it is refused instead, naming the constraint.
14. **Joins across entries by a hook that sees all resolved entries.** A key per point says the same with no code that knows two kinds at once; a hook would have to.
15. **A `coincident` between two fixed points as a join that the solver does not get.** It is refused today on purpose (it would never act), and a user would have to add one per vertex of every projected outline.
16. **"A copy lies on its source" by its defining points.** A half circle with its centre and ends on the axis keeps them and is the other half.
17. **A fallback in the app's view that builds a curve that is not own from the document** when the result has none (to keep the one hand-made test). It is the reading of the document part 5 removes.

## Known limits

- **`derivedPoints(id, ref)`** stays exported with its signature; it is right for the kinds whose entities follow from the entry alone. Nothing calls it after part 5 outside the engine's own constraint rule; 6c, whose entities need the sketch, removes it from the exports or gives it the sketch.
- **Ring 2** (`OutlineCurve`) is not exhaustive; a package that adds a variant there makes it so.
- **The text for an unknown kind of entry** names only the edge until 6b.
- **A kind whose entities live outside the sketch** (6f's stored outline) has to copy the list of its entities into its entry, or `entityOf` cannot answer from the sketch alone: a constraint of 6f.
- **The face key** is ambiguous for a text field with a slash until the first package that makes such a face quotes it (vocabulary, "Face names").
- **Projections from two different sources get no join of their own** (an edge and a projection from a sketch, or two sketches): their keys differ, and a `coincident` between two fixed points is refused. They join only through an own point tied to both by `coincident` constraints (joins are transitive), which is how such a loop closes today for projected points.
- **Deleting an entry by the selection** works only for an entry whose ID is an entity (an edge, a projection of one entity); an outline or a mirror is removed by its row.
- **`Entity.own: false`** says "fixed for the solver"; 6c adds the mark of a derived entity.

## To verify before the implementation

- That the stamp of every stored sketch stays: load the documents of the tests and of `packages/scenarios`, and compare `solved.inputs` with a recompute of part 1 (a test that runs before and after).
- That `modules.test.ts` passes with `references/*` where part 1 puts it.
- That the snapshots of the app do not change by part 4 or part 5 (the draw order of projections, the place of a click of the fillet).
- That `get_sketch` answers byte for byte as before (the MCP tests, and one sketch with a line and a circle projected compared by hand).
- That the spike of part 3 leaves no place out: after part 3, add a variant to `CurveShape` (as in "Measured") and, one at a time, to the profile's `Shape`, to `Shape` of `sketch-tools.ts` and to the app's `Shape`; every place of the table that 6a makes exhaustive must be among the errors of one of the four.
- That `curveOf`, the profile and the wall give the same numbers through the one shape function (the raw positions for `curveOf`, the joined ones for the others): the tests of the taper and the offset compare outlines to the last digit.

## Open

1. **Derived geometry as a kind of entry of `external`** (a mirror is `addExternal { ref: { type: 'mirror', … } }`), or a second map with commands of its own and a schema step? *Recommendation: `external`, for the reasons of "One family of entries".*

## Reviews

The design, the contract and the calls were written on Opus 5.5. Every finding was checked against the code before it was acted on.

### Round 1 (2026-11-17), on the first version

Three reviewers got the same brief, read-only: `codex` (gpt-6-astra, effort high) returned 11 findings, reproducing several in memory; an internal subagent (Opus) returned 15 and 6 notes, with a spike of its own in a copy of the tree; `agy` (gemini-4-argon-high) did not run: its account is out of quota (HTTP 429).

| Finding | Who | Severity | Holds? | What changed |
|---|---|---|---|---|
| The face key is ambiguous once a curve ID has a slash: `{ curve: 'o/l/@p:1' }` and `{ curve: 'o/l' }` copied by `p` share a key, and the table of face numbers keeps one | codex | major | yes (`faceKey`; reproduced by codex) | Vocabulary, "Face names": a text field with a slash is quoted in the key; no key of today changes; the first package that names a face so changes `faceKey` |
| Joins do not travel: the images of two source ends joined by a `coincident` stay apart; projections of a rectangle by four entries never close, and a `coincident` between fixed points is refused | codex, internal | major | yes (both reproduced the mirror case; `features/sketch.ts` refuses the constraint) | Join keys per point (`EntryGeometry.keys`) across entries; part 2's `joinPairs`; calls.ts b and d |
| "A copy lies on its source" by its defining points throws away the mirrored half circle | codex | major | yes (reproduced) | Decided by what the curve occupies |
| `updateProblem` ("the same entities") forbids changing the count of a pattern, and allows a change of source | codex, internal | major | yes | The rule: the source stays, an entity that stays keeps its kind, a constrained entity may not go (the constraint is named), others come and go |
| Entries have no numeric fields: the validator gets no reader of fields, and `withConstraints` drops every expression outside `constraints/` | codex | major | yes (`document.ts`) | Part 1: fields at `external/<id>/<name>`, `ValidationContext`, the cleanup of expressions |
| `axis` (`sketchLine`) and the circle operand of a generator read the input of the solver, which will hold neither derived curves nor unused axes | codex, internal | major | yes (`recompute/services.ts`, `recompute/profile.ts`) | Part 2: they read the list; the axes are in every sketch's list and geometry and in the solver only when constrained |
| A derived kind cannot see projected lines or the axes as the axis of a mirror | internal, codex | major | yes (`SolvedOwn` had only the sketch) | `SolvedOwn.curves`; calls.ts d reads it |
| The table of tools has no pick of curves only (a click near a crossing gives a point) and none for another sketch | codex, internal | major / minor | yes (`anchorAt` takes points first) | `picks: 'curve'` with `eligible`, and a picker of the tool's own; Trim in calls.ts g uses it |
| `areaOf` asks "an arc?" and would lose the bulge of another curved kind | codex, internal | major / minor | yes | E8 has eight switches; 33 in all |
| Part 5 breaks a test that builds a result by hand | internal | major | yes (`packages/app/test/sketch-tools.test.ts`) | Said in part 5: the test's hand-made result gets the curve; a fallback in the view rejected (alternative 17) |
| The spike's counts and recipe; the three other unions of shapes are not reached by it; `WALL_CURVE_KINDS` missing | codex, internal | minor | yes (10 files without the edit of `CurvePointName`) | The recipe with its three edits; E24; the check of four unions under "To verify" |
| The registry and `REFERENCE_UI` keyed by maps of different shapes; derived kinds without an app row | codex, internal | minor | yes | One shape for both maps; `REFERENCE_UI` over both |
| `entityOf` is not exported by `index.ts` | codex | minor | yes | Corrected |
| What `click` returning nothing means | internal | minor | yes (select would pile up places) | Nothing means none |
| The snapshots count the scenes set | internal | minor | yes (`app-kit.ts`) | The redraw calls of each tool are kept |
| The axes have no slot in `solverSetup` | internal | minor | yes | A resolved reference without a value, under `origin` |
| One shape function would read joined positions in `curveOf` | internal | minor | yes (`curveOf` reads raw positions) | The function takes a reader of positions |
| The fillet's `shortened` reads `ref.edge` | internal | minor | yes (`sketch-tools.ts`) | `faces(ref)` of a kind |
| A second pass for derived entries would change the order of `external` after a load | internal | minor | yes | Keys created in document order, derived entries filled later |
| What happens when an own entity a derived entry names is removed | internal | minor | yes | The entry stays valid; the step reports it |
| The panel's row reads the entry's ID ("bez geometrie", hover, delete) | internal | minor | partly | "bez geometrie" and the hover read the entities; deleting by the selection stays by the entry's ID, an outline or a mirror by its row (known limit) |
| Notes: the order of the checks of a stored value; `modules.test.ts` guards cycles, not layers; the radius in calls.ts a needs a tolerance; `api.ts` spells derived IDs in its text; the copies of a grid; the copy of `origin` | internal | note | yes | Each corrected or stated |

Checked and found sound by both: the statements about today's code (apart from the export of `entityOf`), the order of `fixed` and the stamp, the profile's order by ID and the region refs of calls.ts a, the draw order of part 5 and the answer of `get_sketch`, the place of a click of the select tool and the fillet, the layer of `references/`, the ID scheme against `documentIds` and body IDs, the claim that an older build refuses an unknown entry by itself, leaving `OutlineCurve` alone.

More than six findings with more than three serious, and a fix that touches every section: a second round follows.

### Round 2 (2026-11-17), on the fixes of round 1

The same brief narrowed to the fixes (`git diff 70c2768 aaf8722`): `codex` (gpt-6-astra, high) returned 4 major and 4 minor findings, with probes in memory; the internal subagent (Opus) 2 major, 6 minor and 5 notes; `agy` was still out of quota (HTTP 429).

| Finding | Who | Severity | Holds? | What changed |
|---|---|---|---|---|
| The axes "in every sketch's list" had no way into it: the only mechanism was the slot of the solver, filled when a constraint names an axis; calls.ts c still had the old rule | internal, codex | major | yes | `sketchCurves` and the state's geometry add the axes always; the slot of the solver only when constrained; what the result then carries; calls.ts c rewritten (`axes`, `axesForSolver`) |
| "A reader over the sketch's expressions, as `addConstraint` does" is wrong: `addConstraint` uses a fresh reader; built literally it refuses every command in a sketch with an expression and keeps an expression a number should remove | internal, codex | major (factual) | yes (`document.ts`, `validation.ts`) | A fresh reader; `updateExternal` sets the entry's addresses to null first; `withConstraints` learns the addresses by validating the entry |
| The key of a projection cannot be computed in `geometry`, which does not see the source, and a frozen value would lose it; the key of a copy ignored the joins of references | codex, internal | major / minor | yes (codex probed the second) | The value of a projection carries its keys (stored, stamped); `SolvedOwn.joins` are the joins of the whole sketch before the derived entries |
| `${sketch}:${vertex}` can make two keys alike (IDs may hold `:`) | codex, internal | major / note | yes | Keys are JSON tuples led by the kind |
| A common reader of joined positions would move centres (the profile and the wall join ends, not centres) | codex | major | yes (reproduced) | Ends joined, centres raw, `curveOf` raw throughout |
| New logic of parts 1 and 2 (fields, joins, keys, value-less references, the rule of an update for constrained entities) would be untested code with no review | internal | minor (procedure) | yes | "Slots, not mechanisms": 6a fixes their form and place; the first package that uses one writes it with its tests and review; parts 1 and 2 stay moves |
| Intermediate clicks of a shape lost their redraw | codex | minor | yes | The mode redraws when it keeps an unfinished shape, as today |
| The mirror example did not leave out a copy on its source | codex | minor | yes | `liesOnSource` in calls.ts d |
| `picks: 'curve'` defined two ways | codex, internal | minor | yes | The nearest point of the curve, the bare pointer away from one, in both files |
| The hover of a row would mark the points of a projection too | codex | minor | yes | The hover marks the curves of an entry (or its point when it is one) |
| The quoting changes two expectations of `face-roles.test.ts` and the rule's text in `face-roles.ts` and naming.md; "no copy tag" read as contradicting the example | internal | minor | yes | Said, with who changes them; the wording of the copy tag |
| A tool's own picker cannot name an entity of another sketch, and the mode would drop such a place | internal | minor | yes | `PlaceStandIn` with a foreign snap the mode keeps |
| Notes: projections from two sources never join; the joins of 6c come after `derive`; the order of the checks of an update; which joins a copy keys by | internal | note | yes | Known limit; part 2; the order in part 1; the vocabulary |

Checked and found sound: the join keys close a mirrored half whose ends are joined by a `coincident` and a rectangle projected by four entries (both reproduced by codex) and join nothing today's profiles keep apart; the quoting is unambiguous beside the keys of insertions; the rule of an update is today's for the edge and lets 6c and 6f do what they need; `external/<id>/<name>` works with `fieldsOf`, `setField`, `renameParameter` and the recompute; unconstrained axes keep every stamp; the slot under `origin` is consistent with the stored values and `removeExternal`; part 5 changes exactly the one test; the counts add up.

Many findings again, though narrower: a third round reads only the diff of these fixes.

### Round 3 (2026-11-17), the diff of the fixes of round 2

`codex` (gpt-6-astra, high) and the internal subagent (Opus) read `git diff aaf8722 e4980c8`; `agy` was out of quota. No blocker and no major. While the subagent was reading, the two findings of codex were already being fixed in the tree (a slip against the rule that the tree stays unchanged during a review); the subagent saw the edits, said so, and judged them correct.

| Finding | Who | Severity | Holds? | What changed |
|---|---|---|---|---|
| The comment of `externalRef` in the contract kept the reader over the sketch's expressions | codex, internal | factual | yes | A fresh reader, as in part 1 |
| "Projections from two sources never join" is false: an own point tied to both by `coincident` constraints joins them transitively | codex, internal | factual | yes (codex probed it) | The known limit reworded; the vocabulary says how the pair is made by hand |
| Who writes the check of a change of source was said two ways | internal | factual | yes | 6c writes it; 6a writes only today's rule of the kind |

Sound by both: the fresh reader and the nulling of addresses, ends joined and centres raw, the keys of a projection stamped with its value, the axes and the mirror of calls.ts, the redraw of a kept shape, the face keys, the section "Slots, not mechanisms" against the rule of CLAUDE.md on the depth of a review. This was the last round the owner's rule allows; nothing is left open from it.

## As implemented

The parts in the order of their commits, each with what it changed against the design.

### Part 4: the app's sketch tools as a table

As designed: `packages/app/src/sketch-tools/` with `spec.ts` (`SketchToolUi`, `SketchPlaceTool`, `SketchEdgeTool`, `drawn`), a file per tool and `index.ts` (`SKETCH_TOOL_UI`, `SketchToolName` its keys); `SketchMode.tool` is a `SketchToolName`, `App.sketching` is `{ tools, explained? }`, the panels of the polygon and the fillet moved into their files. The snapshots of the app pass without `-u`; no public type of the engine changed. Beside the contract:

- **`Place`** (`spec.ts`) is the contract's `PlaceStandIn`: an anchor, or a place with a foreign snap. A tool that picks in the sketch reads its places through `anchor(place)`, which drops a foreign snap (only a tool's own picker makes one); the mode positions a kept place by `placePosition` (a foreign snap keeps its `at`).
- **After the last place of a shape** (a tool with `clicks`) the mode, not each `click`, drops the inferred direction and redraws the scene, which is what the end of `sketchClick` did after every shape; `click` makes only the calls of its own (select: the panel and the scene).
- **`hovers` also means "no marker of a snap and no shape in progress"**: the mode tells the select tool from the drawing tools by it, as `m.tool !== 'select'` did.
- **A click whose pointer misses the plane of the sketch** does nothing for every tool. Before, the fillet then said "Click a point where two lines meet."; the pointer misses the plane only when the view looks along it.
- **Enter** calls `sketchFinish`, which runs the tool's `finish` with the places kept; no tool of today has one.
- `placeAt` (the place under the pointer as a tool picks it) is exported for `packages/app/test/sketch-tool-table.test.ts`, which checks `picks: 'sketch'`, `'curve'` with and without `eligible`, and a tool's own picker, and the order and kinds of the table.

### Part 3: every switch on the kind of a sketch curve exhaustive

As designed: `unreachable` in `util.ts`, `CURVE_KINDS` (the keys of `CURVE_POINTS`, in `sketch-content.ts`) for the validator of a curve, and a switch in every place of the table. No test and no public type changed; the meshes are those of before (the tests compare them). Beside the table:

- **E8.** `compatible` reads the round shapes through one switch, `roundOf`; `carrierContacts` switches on both kinds and calls one function per pair of kinds (line–line, line–round, round–round), whose bodies are those of before.
- **E14, A5.** A line in the place of a circle keeps what it got before: the radius of the analysis reads the variable or the value of a circle for a line too, and the adapter sends a radius or a diameter of a line as that of a circle. Validation never lets a line there.
- **P4.** The dimension of a round curve is `roundDimension`, a switch over the kinds of the app; `sort` (P3) is one too.
- **A1, A2.** The adapter throws its text of today, with the value as `cause`.
- `packages/engine/test/curve-kinds.test.ts` checks `CURVE_KINDS` and that `unreachable` throws.
- **The spike of "To verify"**, run in a copy of the tree after the part: a `spline` added to `CurveShape` (with `points` in `CurvePointName` and `spline` in `EntityKind`) stops `tsc` in the engine at E1 to E3, E6, E7, E9, E11 to E14, E16, E18, E20, E21 and `document.ts` (E5), in the adapter at A1 to A5, in the app at P1 and P5; added to the app's `Shape`, at P2 (four functions), P3 and P4; added to the profile's `Shape`, at the eight functions of E8; added to `Shape` of `sketch-tools.ts`, at E19. E15 reads `curvePoints` (E2), E10 and E17 ask for one kind.

### Where 6a meets 2h (D66), merged in from `master`

2h (the start of an extent at a face or a plane) reads no curve of a sketch and nothing part 2 replaced: its start and end planes read the exact outline of the regions (`exactStart` of `recompute/extent.ts`, over `Loop.exact`, falling back to the polyline of a loop without one) and the outline of a hole it builds itself (`ExactCurve`, its own union of a line, a circle and points). `exactStart` is one more consumer of `OutlineCurve` ("Ring 2", not made exhaustive by 6a), for the package that adds a variant there; a loop without exact curves already falls back. The one conflict was the import list of `packages/app/src/features/extrude.ts` (2h's `PlaneRef` and `startText` beside part 5's entity helpers in place of `derivedPoints`).

### Part 1: the kinds of reference geometry as a registry

As designed: `packages/engine/src/references/` with `spec.ts`, `edge.ts` and `index.ts`; `externalGeometry` removed; `entityOf` and `derivedPoints` moved out of `sketch-content.ts` (`document.ts` re-exports them from `references/index.ts`, so the public surface is the same); `solverSetup(sketch, references)` takes the resolved entries; the step asks `resolveReferences`; the refs of a sketch, the fillet's `shortened` and `updateExternal` read the kind. No test and no public type changed. Beside the contract:

- **The values.** The value of each kind is in `ReferenceValues` (`spec.ts`), keyed by the name of the kind, in place of the contract's map `ReferenceKinds`; `StoredValue` is their union, and `storedValue` (`index.ts`) reads a stored value by its form before it is matched with its entry. The edge's `value` returns the stored object itself once it fits, so a frozen value is the object `load` made, as before.
- **`DerivedKindSpec`, `SolvedOwn`** stay in the contract (6c writes them); `GeometrySource` and the slots of `EntryGeometry` (`joins`, `keys`, `hidden`) are declared in `spec.ts` and read by nothing yet.
- **The commands** validate an entry with `entryContext` (`document.ts`): the references of the sketch at its place and a fresh reader of numeric fields over no expressions. The expressions it reads are not handed on yet: the edge has no field (6c writes the cleanup).
- **Checked before and after**, in a copy of `master` and in the tree: a plate with a projected line and circle, constraints on both, a projection that is lost (its edge removed, the frozen value used), the saved document loaded again, and the fixture `v1-plate.json` give the same documents (stamps, stored values), the same results and the same meshes, byte for byte.
- The vocabulary of step 6 is written into `docs/architecture/sketch.md` and the rule of the face key into `docs/architecture/naming.md`.

### Part 2: the profile from a list of curves

As designed: `SketchCurve`, `sketchCurves`, `joinPairs`, `joinsOf` and `profileOf` in `sketch.ts`; `detectProfile` and `pointJoins` stay as the forms over the own content; `SketchState` has `curves` and `joins`, built by the sketch step from the resolved entries; `curveOf`, the circle operand of a generator and the axis `sketchLine` read `curves`. No test and no public type changed. Beside the design:

- **The one shape function** is `placedCurve(curve, radii, end, centre)`: the ends through `end` (the joined vertex in the profile and the wall, the raw position in `curveOf`), the centre through `centre` (raw), an arc's `start` and `sweep` and its radius from its first end, which are the numbers the three places computed each. It answers undefined for a missing position or radius: the wall then reports a broken reference as before; the profile calls the sketch invalid (before, a missing point could not happen and would have thrown).
- **The wall** is `wallOfCurves(curves, joins, geometry, ids, …)` over the list and the joins of the state; `wallOutline` keeps its signature and builds them from the own content. A curve of the list that is not own is a broken reference of the wall, as a curve the sketch does not have was. `curveEnds(shape)` (`sketch.ts`) names the points at the ends of a line or an arc.
- `joinPairs` takes the resolved entries and reads none of them yet: the declared joins and the join keys are 6c's and 6b's.
- **Checked before and after**, as for part 1, with a wall along two lines and a region extruded with an offset added: the same documents, results and meshes, byte for byte. The tests of the taper and the offset, which compare outlines to the last digit, pass unchanged.

### Part 5: the result and its readers

As designed: `SketchResult.curves` (`ResultCurve` in `types.ts`), filled by the sketch step in the order of `external` and of the kind; `referenceEntities` and `curvePoints` exported by the engine; the app's view, its pickers, `lineIds`, the row of an entry (`REFERENCE_UI` in `packages/app/src/references/`) and the hover of a row read the entities of the entries; `get_sketch` lists them from the registry; the engine's `shapeOf` takes a curve that is not own from `result.curves`. One test changed, as the design says: the hand-made result of `packages/app/test/sketch-tools.test.ts` ("promítnutá kružnice je v pohledu…") got the curve `x`. The app's snapshots pass unchanged. Beside the contract:

- **`ReferenceUi.repair`** is data, `{ title, tool, hint }`: the panel chooses the tool, sets the entry to repair and says the hint, which is what the button did. A function `start(host, m, id)` would have made the rows import the sketch mode, which imports the rows (the hover marks).
- **The hover** of a row sets `m.hover` to the entry's ID as before; the scene marks `hoverMarks(sketch, id)`: the curves of an entry, or the entry itself when it has none. For an edge that is its curve, the ID it marked before.
- **`describe_api`** shows `ResultCurve` and the new field of `SketchResult` with their comments, as the design says (`engineTypes` of `packages/mcp/src/api.ts` leaves out only the ports, between `// --- porty` and `// --- přepočet`); nothing in `packages/mcp` changed for it. The AI reads `source: 'reference' | 'derived'` before a derived kind exists.
- **`ResultCurve.source`** is written `'reference' | 'derived'` in `types.ts`, which does not import `references/spec.ts`; `GeometrySource` there is `'own' | ResultCurve['source']`, so the two cannot drift apart. The step takes the source of a result curve from the kind of its entry (`kindOf(ref).source`).
- **Checked before and after** in a copy of `master`: `get_sketch` of a sketch with a projected line and circle (and of the same sketch with the circle's projection lost, frozen) answers byte for byte as before; the documents, results and meshes are the same apart from the new field.

## Rows for the indexes

**docs/d36/README.md**, the row of 6a, column "Design now":

> designed 2026-11-17, D64 ([6a-sketch-prep/design.md](6a-sketch-prep/design.md)): five parts with no change of behaviour, the mechanisms no kind of today uses (fields of entries, declared joins and join keys, the solver's slot of the axes) fixed as slots their first package writes (the kinds of `external` as a registry `REFERENCE_KINDS`, the edge its one entry; the profile, the sides and the wall from a list of curves with a region flag and one rule of joins; 33 switches on the kind of a curve made exhaustive; the app's sketch tools as a table `SKETCH_TOOL_UI`; the result's curves that are not own, `SketchResult.curves`, read by the app and `get_sketch`), and the vocabulary of step 6: derived IDs `<owner>/<local>` (a copy `<owner>/<copy>/<source>`, the axes `origin/x`, `origin/y`, in every sketch's curves and in the solver only when constrained), which geometry forms regions, joins declared by an entry (a copy and its source) and join keys that carry vertices across entries, derived geometry as a kind of entry of `external` (no schema step; numeric fields of an entry at `external/<id>/<name>`), what consumers accept, face names by the ID of the curve with a slashed field quoted in the key; no schema step. Open for the owner: `external` or a second map for derived geometry

**docs/decisions.md**, the row of D64:

> | D64 | 6a: the preparatory part of step 6 and its vocabulary | A registry of the kinds of entries of `external` (the projection of an edge its one entry); the profile from a list of curves with a region flag and joins declared by entries; exhaustive switches on the kind of a curve; the app's sketch tools as a table; the result carries the curves that are not own. Derived IDs `<owner>/<local>`; copies `<owner>/<copy>/<source>`; axes `origin/x`, `origin/y` in the solver only when constrained; joins by declared pairs and join keys; regions by the owner's answer to question 4; derived geometry is a kind of entry of `external`, not a second map | [d36/6a-sketch-prep/design.md](d36/6a-sketch-prep/design.md) |

**docs/requirements.md**, validation scenario 15: no part. 6a changes no behaviour; its check is that every existing test passes unchanged, the snapshots of the app included.
