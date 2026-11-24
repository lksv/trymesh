# 6a2 The axes of the origin (D71)

**State: carved out of the design of 6b (D69) on 2026-11-24 and revised the same day; read by one independent review as part of that design, and as a text of its own by a second round the same day (Fable, `codex`, `agy`; "Reviews"), whose findings are fixed here. Implemented on 2026-11-24 in the branch `d36/6a2` (on Opus 5.5), as one point of work; "As implemented" says where the code differs from this text.** The axes were designed on 2026-11-17 inside 6b's design (on Opus 5.5, against `master` at `e70cd65`). The owner moved them into a point of their own, right after 6a, on 2026-11-24 (answer 1 of [6-cross-review.md](../6-cross-review.md)): 6c needs them for its main case, a half mirrored about the Y axis. The review of 6b's design on Fable read these parts and left notes for this point (its sections C and F; "Reviews" below). This text is those parts with the notes taken in, written against `master` at `9c43be9` (schema version 10; 6a, D64, implemented with its fix) and, since the second round, against the design of 6e as merged (`438b9ff`) and the third round of 6c's (`d36/6c-design-r` at `e8d9af1`). The plan of the point is [6-plan.md](../6-plan.md), "6a2 The axes of the origin".

Files: [contract.ts](contract.ts) (the two lines, the solver's slot, the reader of a solved sketch, the extent of a line, the refusals), [calls.ts](calls.ts) (validation scenario 15, the stand-in board of step 1, and the rest of the mechanism).

The point in short:

1. **`origin/x` and `origin/y` are lines of every sketch**, through its origin along its X and Y: an operand of a constraint (a point on the Y axis, two points symmetric about it, a distance to it), the axis of a mirror or the direction of a pattern of 6c, a `with` curve of 6e's tools, and the line of an `AxisRef` (`{ kind: 'sketchLine', sketch, line: 'origin/x' }`: a revolve, a pattern, a tilted plane, a joint).
2. **They are in the solver only when a constraint of the sketch names one**, so the stamp of every stored sketch stays and none is solved again on load.
3. **They are not in `SketchResult`.** One function, `solvedCurves`, gives a reader that has only the sketch and its result the curves and positions the recompute holds, the axes among them; the sketch tools, the base of the profiles the tools build in memory (6e's `toolBase`) and the app's view read it. **An axis is a whole line**: every reader that takes a line as the stretch between its ends asks one helper, `lineExtent`, for the ends.
4. **Refused**: an axis in `midpoint` or `equalLength` (a whole line has no middle and no length); a constraint with no own operand, as for any fixed entity; an axis as a side of a region or a curve of a wall; anything under `origin/` as a source of a projection (6b).
5. **The stand-in board of scenario 15**, which 6c and 6b build on until 6f imports one: placed symmetric about the two axes, fully determined, with no redundant constraint and one solution.
6. **No command, no query, no feature type, no face role, no issue code, no schema step.**

## What the plan says, checked against the code

| Statement of the plan | What the code says |
|---|---|
| "Two fixed lines through its origin along its X and Y, `origin/x` and `origin/y`, the only entities under `origin/`" | 6a fixed the slot: a resolved reference without a value under the key `origin` (`ResolvedReference` in `references/spec.ts`: "enters the input of the solver and is neither stamped nor stored"). Nothing fills it: `sketchCurves` adds no axes, `entityOf('origin/x')` answers undefined, `resolveReferences` puts nothing under `origin`. Run by the review of the step: an axis `{ kind: 'sketchLine', line: 'origin/x' }` is refused today, "the sketch has no entity `origin/x`" |
| "In the solver's input only when a constraint of the sketch names one" | `solverSetup` takes any key of the resolved references, fixes its points and stamps only the entries that have a value. Measured (below): with the axes under `origin` a point on an axis, a pair symmetric about one, a tangent circle and a distance to one all solve |
| 6a: "The result of every sketch then carries them in `curves` and their far points in `points`" | Not taken (below, "Not in the result"): a curve of the result would name a point the result does not have, or the far points would be in `points`, where the app fits its camera (`scene.ts`, `grow`) and every result of every model would change |
| "The engine's sketch tools see an axis as a long line" | `closestOn` of `sketch-tools.ts` clamps a line to its segment, and the segment of an axis is 1 mm long. `shapeOf` reads the document's curves and `result.curves`; an axis is in neither |
| "An axis in `midpoint` or `equalLength` is refused" | The catalog does not know a line without length: both constraints take any line (`catalog.ts`), and on an axis they would measure the hidden segment from the origin to the far point |
| "The stand-in board: its corners and holes placed by `symmetric` constraints about `origin/x` and `origin/y`, fully determined" | The first draft of the board (6b's calls of 2026-11-17) gave each corner four dimensions where the rule of the arc leaves three: eight redundant constraints, and `sketchConflict` when `boardW` jumped from 60 to 120 (measured by the review of 6b's design). The board of this point has none (below, "The stand-in board") |

Not in the plan, found in the code:

- **The points of an axis for the own rule of a constraint.** Since the fix of 6a, `ruleProblem` (`features/sketch.ts`) reads the points of an entry from the registry. An axis is no entry, so its points are one more line there: `origin`. Without it `symmetric` of `origin` and a point about an axis is accepted (measured with the mock), though the origin is an end of the axis.
- **`positionsOf` and `shapeOf` of the sketch tools, and the app's `sketchView`, each build their own picture of a solved sketch** from the document and the result. With the axes outside the result each of them, and after them 6e's and 6c's profiles in memory, would add two constants. They read one function instead (the review's note).

## The cheap variant

Two constants of every sketch, in the solver only when named, read by everything else from the list of curves the recompute already keeps.

**Deferred**: the axes drawn in the model view outside the sketch mode; the axes of another sketch as a source of a projection (6b refuses anything under `origin/`: this sketch has its own axes, and the origin of the other projects as a point); a third reserved entity (a diagonal, a circle about the origin).

## Measured

**Recipe.** The second round re-ran the board (its Q1: 99 jumps of `boardW`, three forms; "Reviews"). The designers' spike of 2026-11-17 (`a-solver.spike.ts`, kept in the scratchpad of the review, `step6-review/6b-design/designers/`) feeds the real planegcs adapter and the engine's `SketchAnalysis` the inputs `solverSetup` would make. The probes of this revision are in the scratchpad of the session, `step6-review/6b-revision/` (`r.probe.ts`, rows R1, R7 and R8 of its log `r.log`), run from the worktree with `npx vitest run --config <scratchpad>/step6-review/6b-revision/vitest.config.ts`: they prototype the axes by `vi.mock` of `entityOf`, `resolveReferences` and `sketchCurves` and run the real engine with the real planegcs and manifold adapters. Not run: the points of an axis in `ruleProblem`, the refusals of the catalog, `solvedCurves`, the app, MCP.

| What | Result |
|---|---|
| The axes as fixed lines from `origin` to a far point at 1 mm and at 1000 mm: a point on the X axis at x = 500, two points symmetric about the Y axis, a circle tangent to the X axis, a line parallel to X with an angle and a point–line distance to Y (the designers' a3; reproduced by the review) | all solved, 0 degrees of freedom, the same positions for both far points |
| The stand-in board of calls.ts (R1) | `ok`, 0 degrees of freedom, no redundant constraint in the solver's list or in the diagnosis; the body 3776.38 mm³ against 3776.17 by hand |
| The board, one parameter changed from the drawn state (R7): `boardW` 30, 45, 66, 70, 80, 90, 100, 110, 120; `boardH` 20, 30, 44, 60, 80, 120; `boardR` 0.2, 1, 4, 6, 8 | all solved, the body `ok` |
| `boardW` in steps 80, 100, 120, 160, 240, 120, 60 (R7) | all solved, the volume by hand at each within 0.22 mm³ |
| `boardW` 62 → 120 in one step; 60 → 200; the three sizes at once to 2000 × 1400, R 311 (R1, R7) | **`sketchConflict`** (the solver does not converge); the sketch keeps its last state and solves again at the next smaller change |
| The same board as a filleted rectangle (lines horizontal and vertical, arcs tangent, one radius and `equalRadius`, the size by two dimensions; R1) | 0 degrees of freedom, no redundancy; `boardW` 62 → 120: **`ok` with another shape**: the corner arcs turned outwards (the centre of the first at (57, 23) for (57, 17)), the body 8819.70 mm³ for 7616.17, and the next changes end in an error of the body |
| A reference dimension from an own point to `origin/y` (R8) | measured, 26.5 |
| A rectangle from 2 to 5 above the X axis, 10 long, revolved about `{ kind: 'sketchLine', line: 'origin/x' }` (R8) | `ok`, 658.87 mm³ against 659.73 by hand |
| The board, 99 jumps of `boardW` in one step, 9 starts × 11 targets (the second review's Q1) | the linear form: 93 `ok`, 6 `sketchConflict` (60 → 200, 61 → 120, 62 → 120, 64 → 200, 80 → 400, 100 → 240), **no wrong shape**; the tangent form: 47 of 99 end `ok` with the corner arcs turned outward; the first review's form (lines horizontal and vertical, tangents, a radius) turns outward too, also at 60 × 40 → 30 × 20 |
| A place on an axis as a segment from −10⁶ to 10⁶ mm: the foot of (10, 7.3), of (99999.9, 7.3); the crossing with a line at x = 10 and at x = 900000.5 (computed in double precision, the formulas of `closestOn`) | within 1.5e-10 mm of the exact place. On the segment of 1 mm: the foot of (10, 7.3) is (1, 0), and the crossing at x = 10 lies outside it |
| A constraint between `origin` and an axis (R8) | refused by today's rule ("vazba jen mezi pevnými entitami …") |
| `symmetric` of `origin` and an own point about `origin/y`, without the rule of the points of an axis (R8) | accepted, which is why the rule is needed |

What the numbers decide:

- **The far point of an axis is at 1 mm**: the direction is exact, its distance changes nothing in the solver, and the hidden segment is measured by nothing (`midpoint` and `equalLength` are refused).
- **The board is drawn with every point placed by a linear constraint**, so it has one solution. A board held by tangency has several, and the solver reached a wrong one at a jump without a word, which is the worse failure: `ok`, 0 degrees of freedom, a body of the wrong shape. The review of 6b's design proposed the filleted rectangle and measured its status and the radii of its arcs after each jump, not its shape.
- **A jump the solver does not converge on is said aloud** (`sketchConflict`, the last state kept), with either form and with the first draft too. It depends on where the solve starts (62 → 120 fails, 60 → 120 solves), not on the constraints, so it is the solver adapter's and not this point's ("Known limits"; a backlog row).

## Decisions

### The two lines

- **IDs and shape**: `origin/x` and `origin/y` are lines from `origin` to the hidden points `origin/x/b` at (1, 0) and `origin/y/b` at (0, 1) (6a's vocabulary). A caller's ID cannot hold a slash, so no document has them. The constants are `ORIGIN_AXES`, `isOriginAxis` and `underOrigin` in `util.ts` beside `ORIGIN`, and their geometry `AXES_GEOMETRY` (with `hidden`) in `sketch-content.ts`, the leaf that says what an entity of a sketch is (its type, `EntryGeometry` of `references/spec.ts`, is imported as a type only, which `modules.test.ts` allows).
- **The sense**: an axis runs from `origin` towards +X (`origin/x`) or +Y (`origin/y`). An `angle` dimension, a revolve about `sketchLine` and a direction of a pattern of 6c read it.
- **`entityOf`** answers `{ kind: 'line', own: false }` for both and nothing for the far points; `referenceEntities` does not list them (they are no entry of `external`).
- **The list of curves** (`sketchCurves`) has them in every sketch, `source: 'reference'`, `regions: false`; the state's `geometry` has their far points in every sketch. So a mirror about `origin/y` (6c), an axis `{ kind: 'sketchLine', sketch, line: 'origin/x' }` (`axis` of `recompute/services.ts` reads `curves` and `geometry`) and a query find them, whatever the constraints of the sketch.

### In the solver only when named

`resolveReferences` adds `origin: { geometry: AXES_GEOMETRY }` with no value when a constraint of the sketch names an axis (`axesNamed`; a dimension too, so a reference dimension to an axis is measured: `measure` reads the curves of the input). `solverSetup` puts the far points into `fixed` and the lines into the input as it does for any entry, and stamps no value under `origin`: the slot of 6a. A sketch whose constraints name no axis has the input and the stamp it has today, so no stored sketch is solved again on load.

### Not in the result

`SketchResult.curves` holds no axis and `SketchResult.points` no far point (the far points are hidden points, and the result lists no hidden point). 6a wrote that the result would carry them; this point amends that (the vocabulary of 6a, "Amendments after the review of step 6", row 7). Why:

1. **A curve of the result would name a point the result does not have.** The far points are hidden: no entity, so nothing may list them as points. With the lines in `curves` and their ends missing, every reader of `result.curves` would need a special case for two curves; with the ends in `points`, they are points a picker offers and the camera fits.
2. **Every result of every model would change** for two lines that are the same in every sketch: the records of the app's tests, the answers of `get_sketch`, the size of every result.

The first design gave the camera as its reason (the app fits its view to `result.points`); the review pointed out that this is moot once hidden points are not in the result, and that the reason is the first one above.

**One function for the readers that have no recompute**: `solvedCurves(sketch, result)` in `sketch.ts`, beside `sketchCurves`. It answers the curves and the positions of a solved sketch as the state of the recompute holds them:

- **the curves**: the own curves of the sketch given, the curves of `result.curves` whatever their source (reference curves; after 6c the copies too, as that result has them), and the two axes;
- **the positions**: those of the result, the two far points, and **for a point of the sketch that the result does not have, the position the sketch holds**, per point, as `pointAt` of `sketch-tools.ts` does today. A tool gives the sketch after its batch with the result from before it, and the points the batch added are found this way;
- **without a result** (the sketch did not evaluate): the own curves and the axes over the positions of the sketch.

The axes as curves of the list are made in one place, the constant `AXIS_CURVES` of `sketch.ts` (from `AXES_GEOMETRY`), which `sketchCurves` and `solvedCurves` append and nothing else does.

| Reader | Today | After |
|---|---|---|
| `shapeOf` and `positionsOf` of `sketch-tools.ts` (a snap of a tool, the fillet) | the document's curves, `result.curves`, `result.points` | `solvedCurves` |
| The app's `sketchView` | the document and the result | `solvedCurves` |
| 6e's `toolBase(sketch, result, more?)`, the base of every profile a tool builds in memory (`sketchWorld(toolBase(…))`, `references/world.ts`) | not written yet | `solvedCurves` less the curves with `source: 'derived'` (the core derives the copies again from the entries of the sketch it is given), with `more.points` and `more.radii` over the positions |
| 6e's `stepBase(feature, references, geometry)`, the base of the sketch step | not written yet | nothing of this: it reads `sketchCurves`, which has the axes, and the geometry of the state, which has the far points |

So no reader adds the axes by itself, and a package that puts a further kind of curve into the state and not into the result has one place to do it. 6e's design asks for "one helper of 6a2 that both builders call" should the result not carry the axes: that is `AXIS_CURVES` behind the two functions the builders are made of.

### An axis is a whole line: the sketch tools and the app

The curve of an axis in the list is the segment of 1 mm from `origin` to its far point, which is right for everything that reads a direction or a carrier (the solver, `measure`, `axis` of `recompute/services.ts`, a mirror of 6c). A reader that takes a line as the stretch between its two ends would see only that millimetre. The first text said this of `shapeOf` alone; the second round found that 6e's contact search is such a reader too and never calls `shapeOf` (its `curveContacts` builds its shapes from two `SketchCurve`s and the positions), so a construction line at x = 10 trimmed or extended `with: 'origin/x'` would have found no contact.

- **One helper, `lineExtent(curve, geometry)`** in `sketch.ts`, exported: for an axis of the origin the two points at ∓`AXIS_REACH` (10⁶ mm) along it, for any other line the positions of its `a` and `b`. **Its readers, each of which builds the shape of a line through it**: `shapeOf` of `sketch-tools.ts` (the snap of an anchor to a curve, the fillet); the wrapper of `curveContacts` in `sketch.ts` (6e's shape builder: trim, extend and split with an axis as the `with` curve, `curveUnder`, `extendReach`, the query `sketchContacts`); the hit test and the snap of the app's sketch view. The shape of an axis made so carries no vertex: its ends are no points of the sketch, so 6e's wrapper gives them no key of the joins, and a line that starts at `origin` meets an axis there as an end on a curve, not at a common end.
- **A snap**: an anchor snapped to an axis (`snap: { kind: 'curve', id: 'origin/x' }`) gets `pointOnCurve` on it, as a snap to any curve; the place found on the long segment is within 1.5e-10 mm of the exact one (computed), and the constraint puts the point on the axis exactly.
- **The app draws the axes** in an open sketch as two thin lines through the origin, in a bucket of their own (`axes` in `sketchScene`; not the solid bucket `external` every curve that is not own goes to today), each as the stretch of the axis inside the visible part of the sketch plane, computed again when the camera moves: the camera sees a depth of 10000, so a line drawn to ∓10⁶ would be cut or lost. The fit of the camera does not read them.
- **They can be hovered, selected and snapped to as lines**: a point and `origin/x` selected offer *Point on curve* and the distance to it, two points and `origin/y` *Symmetric*. Deleting an axis by the selection does nothing.
- **A line without a length in the app's offers**: `hasLength` of `sketch-commands.ts` is false for an axis, and the offers that measure a line read it: `equalLength` (`geometricFor` has it in a `case` of its own, past the catalog's `check`, so the button would stay enabled for an own line and an axis and the engine would refuse on the click), `midpoint`, and the length dimension of one selected line (`lineEnds` of `dimensionFor` would name the hidden point `origin/x/b`).
- **The pickers of a line of a sketch** (`lineIds` of `sketch-commands.ts`: the axis picker, the mechanism panel) list `origin/x` and `origin/y` after the lines of the sketch.
- **What the snapshots of the app see**: the two axis lines in every scene with an open sketch; and, where a test picks `sketchLine` in a model whose sketches have no line, the axis picker now starts at `origin/x` of the latest sketch (it changed nothing before). The commit that changes them says so.

### What consumers accept

6a's table, the row of the axes:

| Consumer | `origin/x`, `origin/y` |
|---|---|
| A point of a curve of the sketch | no (they have no point but `origin`) |
| An operand of a constraint of its sketch | yes, with at least one own operand, as any fixed entity; not `midpoint` or `equalLength` (the catalog's `check`: "origin/x is an axis of the origin, a whole line: it has no length and no middle") |
| An `AxisRef` (`sketchLine`), the axis of a tilted plane or a joint | yes, along +X or +Y of the sketch, from `origin` |
| A mirror axis, a direction of 6c | yes |
| A `with` curve of 6e's tools, a cut of a construction curve | yes; never cut |
| A curve of a wall, a side of a region, a point of a hole | no |
| `setCurvePoint`, `removeEntity`, the fillet's corner | no: an axis is no own curve |
| A source of a projection from another sketch (6b) | no, and neither is a far point: anything under `origin/` is refused |

The points of an axis for the own rules of the catalog (a symmetric point is no end of its axis; a midpoint is no end of its line) are `origin`.

## The document and the schema

- **What the document gains**: constraints and `AxisRef`s that name `origin/x` or `origin/y`. Nothing changes shape.
- **No upgrade step, no new version** (confirming 6a, "No upgrade step for 6b, 6c and 6f"). A build without the axes refuses a constraint on one (`constraint`: "entita "origin/x" ve skice není"), so such a document is invalid there, not a model with the constraint dropped. An `AxisRef` on `origin/x` is not checked on `load` (`requireRef` checks commands only), so an older build loads it and the feature is `brokenReference` at the recompute: an error, not a silent change. `SCHEMA_PENDING` does not change.
- **Stamps of stored sketches**: unchanged, since the axes enter the input only when named and no stored sketch names them.

## Where the code lives

| File | What changes |
|---|---|
| `packages/engine/src/util.ts` | `ORIGIN_AXES`, `isOriginAxis`, `underOrigin`, `AXIS_REACH` |
| `packages/engine/src/sketch-content.ts` | `AXES_GEOMETRY` |
| `packages/engine/src/references/index.ts` | `entityOf` answers the axes; `resolveReferences` fills the slot `origin` when a constraint names one |
| `packages/engine/src/sketch.ts` | `AXIS_CURVES`; `sketchCurves` adds the axes; `solvedCurves`; `lineExtent`; the type of the resolved references in `solverSetup` (a key without a value) |
| `packages/engine/src/features/sketch.ts` | the step: the far points in the state's geometry, no hidden point in the result's `points`; `ruleProblem`'s points of an axis |
| `packages/engine/src/catalog.ts` | `check` of `midpoint` and `equalLength`: no axis |
| `packages/engine/src/sketch-tools.ts` | `shapeOf` and `positionsOf` through `solvedCurves`; the shape of a line through `lineExtent` |
| `packages/engine/src/types.ts` | the comments the AI reads: the axes in the comment of `ExternalRef` and of the constraints; `SketchResult.points` and `curves` (no axis, no hidden point) |
| `packages/engine/src/index.ts` | exports `ORIGIN_AXES`, `isOriginAxis`, `underOrigin`, `AXIS_REACH`, `solvedCurves`, `lineExtent` |
| `packages/mcp/src/api.ts` | the sentence on the axes in the paragraph on sketches |
| `packages/app/src/sketch-view.ts` | the view through `solvedCurves`: the axes as two curves that are not own, picked and snapped to as lines through `lineExtent` |
| `packages/app/src/sketch-mode.ts` | `sketchScene`: the bucket `axes`, each axis as its stretch inside the view |
| `packages/app/src/sketch-commands.ts` | `lineIds` lists `origin/x`, `origin/y` after the lines of a sketch (`axis-picker.ts` and `panels/mechanism.ts` read it); `hasLength`, read by the offers of `equalLength`, `midpoint` and the length dimension of a line |
| docs | `architecture/sketch.md` (the bullets "IDs" and what the result carries), `architecture/api.md` (`AxisRef` on an axis), `architecture/ai.md`, `architecture/verification.md`; `ui/` the sketch mode and the axis picker; `decisions.md` D71; `requirements.md` scenario 15, the part of 6a2; the vocabulary of 6a (row 7 of its amendments) |

No new module and no new layer: `docs/architecture/repository.md` is unchanged.

## MCP

- `describe_api` shows the comments on the axes from `types.ts` with no change in `packages/mcp`.
- The paragraph on sketches of `api.ts` gains: "Every sketch has the lines `origin/x` and `origin/y` through its origin along its X and Y. A constraint may name one with at least one own operand (a point on it, two points symmetric about it, a distance to it, parallel, perpendicular, an angle, a tangent circle); `midpoint` and `equalLength` do not take them. `{ kind: 'sketchLine', sketch, line: 'origin/x' }` is an axis of a revolve, a pattern, a tilted plane or a joint. `get_sketch` does not list them."
- `sketch_tool`: a snap to `origin/x` or `origin/y` (`snap: { kind: 'curve', id }`) works as a snap to any curve.

## Where 6a2 meets 6e, 6c, 6b and 6h

- **6e** (next in the sequence; its design as merged, "Plug-in points" and "Later kinds"): an axis is a reference line that forms no regions and can hold a point: a `with` curve, and a cut of a construction curve; never cut; it does not count as "a curve that is not own" for the place of a `trim` without a curve. What 6e reads of this point:
    - **the base of its world**: `toolBase` is `solvedCurves` less the derived curves, `stepBase` reads `sketchCurves` and the geometry of the state, so both have the axes with no line of 6e's ("Not in the result");
    - **the extent of a line**: the wrapper of `curveContacts` makes the shape of a line through `lineExtent`, so an axis is cut against as a whole line;
    - **a test 6e owes for it** (this point is implemented first and has no trim): a construction line that crosses `origin/x` at x = 10 and one at x = −10, each split `with: 'origin/x'`, the point held on the axis by `pointOnCurve`; a construction line that ends short of `origin/y` at y = 25 and at y = −25, extended onto it; and the same far from the origin (900 m). The row is in 6e's "To verify".
- **6c**: a mirror about `origin/y`, a row along `origin/x`: its `commandProblem` accepts any line entity that is not a copy. The axes form no regions, so they neither join nor prevent a join in its position stage, and a copy that lands on an axis keeps its regions (6c's design says both).
- **6b**: the skeleton of scenario 15 measures the hole pair from `origin/y` by two reference dimensions (fixed operands only, allowed for a reference dimension). A projection refuses any source entity under `origin/` (`underOrigin`).
- **6h**: Onshape's origin point becomes `origin`; a default plane seen edge-on in a sketch on a base plane becomes `origin/x` or `origin/y` by the sketch's matrix (on a sketch on Front, Top is the X axis), with the sign of the frame.

## Scenario 15, step 1: the stand-in board

The plan: "a board drawn by hand whose corners and holes are placed by `symmetric` constraints about `origin/x` and `origin/y`, fully determined". calls.ts draws it so:

- the two ends of the first corner arc by four dimensions from the origin (`boardW / 2`, `boardH / 2 − boardR`, `boardW / 2 − boardR`, `boardH / 2`);
- the ends of the other three corners by six `symmetric` constraints about the axes, which is what puts the board's centre lines on them;
- each centre by one distance of 0 to the end of its arc; the rule of the arc gives its other coordinate (two lines that cross once);
- the first hole by two dimensions, the others by `symmetric`; one diameter and `equalRadius`.

Twenty equations for the twenty freedoms the four arcs leave their twelve points, all linear in the positions: one solution, no redundancy (measured). "Fully determined" is checked as no freedom and no redundant constraint, in the solver's list and in the diagnosis; the first draft checked the count of the freedoms alone.

## Rejected alternatives

1. **The axes in `SketchResult`** (6a's vocabulary). Above, "Not in the result".
2. **The axes in the solver's input always.** Every stamp would change and every stored sketch be solved again on load (6a's alternative 10).
3. **A long hidden segment for the axes** (far points at ±10⁶ mm in the solver and in the list). Measured: the far point's distance changes nothing in the solver; the length matters only to a reader that clamps a line to its ends, and those read `lineExtent`. A segment in the list would also have to run both ways from the origin, so `origin` would no longer be its end, which the own rule of `symmetric` and the sense of the axis read.
4. **Each reader in memory adds the axes from the constants** (the first design: the app, the sketch tools and 6c's tools each read `axesGeometry()`). Four readers, and a fifth with each package; `solvedCurves` is one.
5. **The board as a filleted rectangle held by tangency** (the review's proposal). No redundancy either, but several solutions, and the solver took a wrong one at a jump with the sketch `ok` (measured).
6. **The board with four dimensions a corner** (the first draft). Eight redundant constraints; "fully determined" was not true of it.
7. **`shapeOf` alone widening an axis** (the first text). 6e's contact search builds its shapes elsewhere, so a trim against an axis away from the origin found nothing (the second round, finding 1).

## Known limits

- **The axes are not drawn outside the sketch mode** and not listed by `get_sketch`; the description for the AI names them.
- **A reserved name**: nothing else may ever be an entity under `origin/`; a far point is not offered by any picker.
- **An axis reaches 1 km**: a tool or the app's pick finds a place on an axis up to 10⁶ mm from the origin; beyond it the place is clamped to that reach, though numbers go to 10⁹. A constraint on an axis has no such limit.
- **A reference dimension to an axis solves the sketch once more**: it puts the axes into the input, so the stamp changes when the first one is added. Harmless, and the same as for any constraint on an axis.
- **A big jump of a dimension may not solve.** The board with `boardW` from 62 to 120 in one step is `sketchConflict` and keeps its last state, while 60 to 120 solves and any jump solves in two steps (measured). It is how the solver adapter converges on a sketch with arcs, with every form of the board tried, and no point of step 6 changes the adapter but 6d. A backlog row: a sketch that fails to solve after a big change of a parameter is tried again in smaller steps.

## To verify before the implementation

- That the stamp of every stored sketch stays: load the documents of the tests and `packages/scenarios`, compare `solved.inputs` before and after (the axes must not enter an input no constraint names). Read by the review: the axes reach the stamp only through the resolved references, so it holds by the code.
- That `measure` of a reference dimension to an axis has the axis in its curves. Run with the mock (26.5), and by the review through the real `solverSetup` and `measure`.
- The app's snapshots: which change (the axes in the scene of an open sketch; the axis picker of a model without lines) and nothing else. Not checkable before the implementation.
- That 6e as implemented builds `toolBase` over `solvedCurves` and the shapes of `curveContacts` through `lineExtent`. 6e's design as merged leaves both open ("if 6a2 keeps them out of `SketchResult` …, `toolBase` adds them from the helper 6a2 exports, which `stepBase` beside it calls as well"); this text settles them, and 6e's "To verify" has the row. 6c's third round reads the axes from the base of `sketchWorld` and needs nothing more.

## Tests the implementation owes

- **Engine, the entities**: `entityOf` of both axes and of a far point (none); `referenceEntities` without them; the list of curves and the geometry of a sketch with no constraint on an axis.
- **Engine, constraints**: a constraint on each axis (point on, symmetric about, tangent, parallel, perpendicular, angle, distance point–line); the refusals (`midpoint`, `equalLength`, a constraint between an axis and `origin` or two fixed operands, `symmetric` with `origin` as a point); a reference dimension to an axis measured.
- **Engine, the stamp and the result**: the stamp unchanged without a constraint on an axis, changed with one; the stored documents of the tests loaded with their stamps unchanged; the result without the axes and without far points; `solvedCurves` equal to the state's curves and geometry for a sketch with an edge projection.
- **Engine, the stamp of a reference dimension**: the first reference dimension to an axis changes the stamp once, a second does not.
- **Engine, `solvedCurves`**: a point the result lacks read from the sketch (the sketch after an `addPoint`, the result from before); a sketch without a result.
- **Engine, consumers**: a revolve and a pattern about `sketchLine` `origin/x`; a plane tilted about it; `lineExtent` of an axis and of an own line; a snap of a sketch tool to each axis away from the origin, on both sides of it (x = ±500 on `origin/x`, y = ±500 on `origin/y`), the anchor on the axis and not at its far point; the fillet's lists unchanged.
- **Owed by 6e, for this point**: split and extend with an axis as the `with` curve away from the origin, both signs ("Where 6a2 meets 6e").
- **Scenario 15**: the stand-in board of step 1, from calls.ts (`packages/scenarios/test/scenario15.test.ts`, a `describe` of its own): determined with no redundancy, its volume, one parameter changed and back.
- **MCP**: `describe_api` names the axes; a constraint on an axis through `execute`; `get_sketch` without them.
- **App**: the axes in the view of an open sketch (hover, a constraint with a point, a snap away from the origin), drawn in their bucket and inside the view after a zoom far out; `equalLength` and `midpoint` not offered for a selection with an axis, no length dimension for an axis alone, the distance of a point to an axis offered; the pickers; the snapshots as said above.

## Open

Nothing waits for the owner. Answered on 2026-11-24: **the axes have a decision of their own, D71** (answer 31; the plan had given 6a2 none).

Recorded for the backlog, not step 6's: a sketch that fails to solve after a big change of a parameter is tried again in smaller steps ("Known limits"; proposed here because this point measured it).

## Reviews

**The first design (2026-11-17, inside 6b's design)** was written on Opus 5.5 and had no review.

**The review of 6b's design (2026-11-24, on Fable, read-only; the report is in the scratchpad of the session, `step6-review/reports/6b-design.md`, its probes in `step6-review/6b-design/`)** read the axes as part of that design. What it said of them, and what this text does:

| # | Note | Settled |
|---|---|---|
| A1 | The axes leave 6b (the owner's answer 1); it lists the parts to move | This file, its contract and its calls are those parts. 6b keeps the refusal to project anything under `origin/` and uses the board of this point |
| F1 | Keeping the axes out of `SketchResult` is workable, but four readers in memory then add constants; give them one engine helper | `solvedCurves` ("Not in the result") |
| F2 | The camera argument is moot once hidden points are filtered from `result.points`; the real reason is that curves in the result would name points the result lacks | The reasons rewritten |
| F3 | The rows of the axes in "Measured" reproduce for far points at 1 and 1000 mm | Kept |
| C2 | The stamps of stored sketches stay: holds by reading `solverSetup` | "To verify" |
| C3 | `measure` has the axis for a reference dimension: holds, run through the real `solverSetup` and `measure` | "To verify" |
| 5 | The stand-in board is over-dimensioned: eight redundant constraints, `sketchConflict` at 60 → 120; draw it as a filleted rectangle and assert `redundant.length === 0` | The assertion taken. The filleted rectangle measured and **not** taken: it has no redundancy but more than one solution, and reached a wrong one at 62 → 120 with the sketch `ok` ("Measured"). The board is drawn with linear constraints only |
| F4 | Tangency fails in planegcs from about 10 m from the origin | Not this point's; noted for the adapter with the jump of "Known limits" |

**The second round (2026-11-24)**: this text read as a design of its own, with 6b's revision, by an independent review on Fable (read-only; the report is `step6-review/reports/6b-r2-fable.md` in the scratchpad of the session, its probes in `step6-review/6b-round2/`) and by `codex` and `agy` (`6b-r2-codex.md`, `6b-r2-agy.md`), whose findings the Fable review ruled on. Verdict: ready after the listed fixes, which are text-level; the light review at implementation is enough. It re-ran the board (Q1) and read the rest against the code of 6a.

| # | Finding | Sev. | Settled |
|---|---|---|---|
| 1 | The "whole line" does not reach 6e's contact search: `curveContacts` builds its shapes from curves and positions, not through `shapeOf`, so a line at x = 10 trimmed or extended `with: 'origin/x'` finds no contact (`codex` 5 says the same) | major | One exported helper, `lineExtent`, and its readers named: `shapeOf`, the wrapper of `curveContacts`, the app's hit test ("An axis is a whole line"). The test of split and extend on an axis away from the origin, both signs, is owed by 6e and written into its "To verify" |
| 2 | Stale names for 6e's core (`toolWorld`, `withDerived`) | minor | `stepBase` over `sketchCurves`, `toolBase` over `solvedCurves`; "Not in the result", "Where 6a2 meets 6e", "To verify", the contract |
| 3 | `solvedCurves` leaves two cases unsaid: a point the result lacks; the derived copies it returns after 6c | minor | Said: the position of the sketch per point; the copies returned as the result has them, and dropped by `toolBase` |
| 4 | The app: `equalLength` offered past the catalog's `check`; `lineEnds` would name `origin/x/b` for the length of an axis; the scene's bucket and the camera's depth (`agy` 4 and 8, held as minor) | minor | `hasLength` read by the three offers; the bucket `axes`, drawn inside the view |
| nit | `AXIS_REACH` 1e6 is below `MAX_NUMBER` | nit | A known limit |
| nit | A reference dimension to an axis changes the stamp | nit | A known limit and a test |
| nit | `underOrigin` is not in the export row | nit | Added |
| nit | `AXES_GEOMETRY` in the leaf `sketch-content.ts` is typed by `references/spec.ts` | nit | Said: a type-only import |

Checked and found sound by it: the board (the linear form, the claim against the filleted rectangle, "a failed jump is said aloud"); the slot `origin` in `solverSetup`; `resultCurves` over `external` only; `axis` of `recompute/services.ts` reading the state; the points of `ruleProblem`; that only `midpoint` and `equalLength` of the catalog measure a segment.

**The owner's answers to the revision** (2026-11-24, [6-cross-review.md](../6-cross-review.md), "Later answers"): **31**, the axes have their own decision, D71. Answers 29 (the hold of an own arc by a radius line) and 30 (the inputs of `projectSketch`) are 6b's and recorded in its design; neither changes this point.

**The light read of the fixes** (2026-11-24, the diff of `0f12c89`): ready to merge. Its nits, fixed: the shape of an axis carries no vertex keys (one sentence for 6e's wrapper); the comment of `hasLength` against its declaration; the numbering of the rejected alternatives; the stale "a review as a text of its own is owed" in the row of the README; the link at the end of the row D71; the sentence of 6e's design that left open whether the result carries the axes; the paragraph above the later answers of the cross review.

Owed at implementation: the light review of a point that adds catalog entries and a reader.

## As implemented

Implemented on 2026-11-24 in the branch `d36/6a2`, as one point of work (the design gives none), against `master` at `15d6f48`. The names and signatures of the contract stand: `ORIGIN_AXES`, `OriginAxis`, `isOriginAxis`, `underOrigin`, `AXIS_REACH` (`util.ts`), `AXES_GEOMETRY` (`sketch-content.ts`), `AXIS_CURVES`, `solvedCurves(sketch, result): SolvedCurves` and `lineExtent(curve, geometry)` (`sketch.ts`), `axesNamed` (`references/index.ts`), `hasLength(line)` and `lineIds(sketch)` (`packages/app/src/sketch-commands.ts`); the engine exports the constants, `AXIS_CURVES`, `solvedCurves`, `lineExtent` and the types `SketchCurve`, `SketchGeometry`, `SolvedCurves`, `OriginAxis`. The board of calls.ts is `standInBoard` of `packages/scenarios/test/scenario15.test.ts`, exported with `BOARD_OUTLINE` for 6c and 6b to build on.

What differs from the text above, and why:

1. **The app draws the axes through the view, not by the scene alone.** The text has `sketchScene` compute the stretch of each axis inside the visible part of the sketch plane, again when the camera moves. The scene is not built again when the camera moves (the controls only ask for a frame), and building it at every frame of an orbit would also diagnose the sketch at every frame. So `sketchScene` puts the axes into a field of their own, `SceneModel.axes` (a frame, a direction in it, a colour, a width: lines without ends), and the view makes the stretch of each at every frame (`Viewport.placeAxes`: the corners of the view cast onto the plane, then `stretchInView` of `draw.ts`, the part of the line inside that quadrilateral; one segment written in place, so an orbit allocates nothing). The bucket of the axes is that field; the colour is that of a plane (`COLOR.plane`, width 1), or of a hovered, focused, implied or selected curve (width 3). The test view writes each axis down by its frame and direction. Seen once in a browser (a new sketch on XY: both axes run from edge to edge of the view, no error in the console); `stretchInView` is tested by itself, an orbit and a zoom were not tried by hand.
2. **The snapshots of the app changed in one more way than the text says.** The test of the sketch clicked at y = 0 (a chain of lines from (60, 0)) and at x = 0 (the start of a construction line), which now snap to an axis, so the steps that test the inference of a horizontal and a vertical line would have tested a snap instead. The clicks were moved off the axes (the chain at y = 10, the construction line from x = 10); the snapshot shows the moved coordinates and nothing else of it. Otherwise, as the text says: the two axes in every scene with an open sketch (`features`, `fillet`, `mechanism`, `revolve`, `sketch`), and `origin/x`, `origin/y` in the select of the lines of a sketch in the revolve form (its sketches have lines, so the picker did not start at an axis anywhere). `fillet.txt` also shows two lines of points moved within a step by the diff of the records, with the same content.
3. **More readers of `solvedCurves` in the sketch tools.** `pointAt` (the position of a snap to a point, of the corner of the fillet, `nearestCurvePoint`) reads the positions of `solvedCurves` too, not only `shapeOf` and the positions of the fillet, so the tools have one picture of the sketch; it is made once for a sketch and its result (a `WeakMap` by the sketch object). The positions are the same as before but for the far points.
4. **The result leaves out every hidden point**, of the axes and of any resolved entry that has `hidden` (none today), not only the far points of the axes.
5. **The wrapper of `curveContacts` does not exist yet**: it is 6e's. `lineExtent` is exported for it and read today by `shapeOf` of the sketch tools and by the app's view (its hit test and its snaps read the shape of the view, which is made through `lineExtent`).
6. **The midpoint offer of the app** reads `hasLength` as the text says, and the catalog's `check` refuses an axis there anyway (`fromCatalog` asks it).
7. **Where the tests are.** The engine's tests of this point run against the real solver and kernel in `packages/scenarios/test/origin-axes.test.ts` (the tests of `packages/engine/test` use stand-ins of the adapters); they read the state of the recompute through the engine's `Evaluator`. The stamps of stored documents: `fixtures/v1-plate.json` and the four entries of `fixtures/d52-saved-by-master.json` saved without a conflict load with the stamps they were saved with (the fifth was saved in a conflict and is solved on load, as before). The app's tests are `packages/app/test/origin-axes.test.ts`; `sketch-tools.test.ts` and `sketch-tool-table.test.ts` expect the X axis where a pick past the end of a line or near y = 0 found nothing before (one assertion each kept with the axes skipped). MCP: `packages/mcp/test/tools.test.ts`.
8. **Measured as the text says**: the board solves with no freedom and no redundant constraint (the solver's list and the diagnosis), its volume within 0.5 mm³ of the hand formula, `boardW` 62 and back and one parameter at a time (30 to 120 wide, 20 to 120 high, R 0.2 and 8); a reference dimension to `origin/y` reads 26.5; the ring about `origin/x` within 2 mm³ of π (5² − 2²) 10.

Found on the way, not changed: an axis as a curve of a wall is refused with the text for projected geometry ("is projected geometry; an own … is expected", `notProjected`), which is true of what the rule means (own only) but names the axis wrongly; `geometricFor` offers `horizontal` and `vertical` of an axis alone, which the engine refuses (fixed operands only), as it does for a projected line.

## Rows for the indexes

**docs/d36/README.md**, the row of 6a2, column "Design now":

> full ([6a2-origin-axes/design.md](6a2-origin-axes/design.md), D71), carved out of 6b's design on 2026-11-24 and fixed after a second round of reviews the same day: `origin/x` and `origin/y` as lines of every sketch from `origin` to a hidden far point at 1 mm; in the list of curves and the geometry of every sketch, in the solver only when a constraint names one (the slot of 6a: no value, no stamp), not in `SketchResult`; one function, `solvedCurves`, for every reader that has only the sketch and its result (the sketch tools, 6e's `toolBase`, the app's view); `midpoint` and `equalLength` refuse an axis; an axis is a whole line, and every reader that clamps a line to its ends asks one helper, `lineExtent` (the snaps, 6e's contact search, the app's hit test); the stand-in board of scenario 15 placed by linear constraints only (no redundancy, one solution; a filleted rectangle held by tangency reached a wrong solution at a jump, measured); no command, no issue code, no schema step. Read by the review of 6b's design, and as a text of its own by the second round and its light read: ready

**docs/decisions.md**, the row of D71:

> | D71 | [6a2 The axes of the origin](d36/6a2-origin-axes/design.md) | designed 2026-11-17 inside 6b's design (D69), a point and a text of its own since 2026-11-24 (owner, answer 31), reviewed in a second round the same day | `origin/x` and `origin/y` are lines of every sketch, in the solver only when a constraint names one, so no stored sketch is solved again; they are not in the result of a sketch (a curve there would name a hidden point), and every reader without a recompute takes them from one function, `solvedCurves`; an axis has no length and no middle, and a reader that clamps a line to its ends takes the ends of an axis from one helper, `lineExtent`; no schema step |

**docs/requirements.md**, validation scenario 15, the first sub-item:

> - *The stand-in board (6a2, D71).* Until 6f imports one, the board is drawn by hand on XY: four lines, four corner arcs and four holes, the ends of its first corner by four dimensions from the origin, the ends of the others by `symmetric` about `origin/y` and `origin/x`, each centre by one distance of 0 to an end of its arc, the first hole by two dimensions and the others by `symmetric`. Fully determined: no freedom and no redundant constraint; the body 1.6 thick by `mass` within the chord tolerance of the volume by hand (3776.2 mm³; measured 3776.4), and `boardW` to 62 and back follows. Also: a reference dimension from a hole centre to `origin/y` reads 26.5; a ring revolved about `origin/x` of its sketch. Refused: `midpoint` and `equalLength` with an axis, a constraint between an axis and the origin, `symmetric` with the origin as a point, a far point as an operand.
