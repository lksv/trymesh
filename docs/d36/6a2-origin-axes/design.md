# 6a2 The axes of the origin (D71)

**State: carved out of the design of 6b (D69) on 2026-11-24 and revised the same day; read by one independent review as part of that design; not reviewed as a text of its own; not implemented.** The axes were designed on 2026-11-17 inside 6b's design (on Opus 5.5, against `master` at `e70cd65`). The owner moved them into a point of their own, right after 6a, on 2026-11-24 (answer 1 of [6-cross-review.md](../6-cross-review.md)): 6c needs them for its main case, a half mirrored about the Y axis. The review of 6b's design on Fable read these parts and left notes for this point (its sections C and F; "Reviews" below). This text is those parts with the notes taken in, written against `master` at `9c43be9` (schema version 10; 6a, D64, implemented with its fix). The plan of the point is [6-plan.md](../6-plan.md), "6a2 The axes of the origin".

Files: [contract.ts](contract.ts) (the two lines, the solver's slot, the reader of a solved sketch, the refusals), [calls.ts](calls.ts) (validation scenario 15, the stand-in board of step 1, and the rest of the mechanism).

The point in short:

1. **`origin/x` and `origin/y` are lines of every sketch**, through its origin along its X and Y: an operand of a constraint (a point on the Y axis, two points symmetric about it, a distance to it), the axis of a mirror or the direction of a pattern of 6c, a `with` curve of 6e's tools, and the line of an `AxisRef` (`{ kind: 'sketchLine', sketch, line: 'origin/x' }`: a revolve, a pattern, a tilted plane, a joint).
2. **They are in the solver only when a constraint of the sketch names one**, so the stamp of every stored sketch stays and none is solved again on load.
3. **They are not in `SketchResult`.** One function, `solvedCurves`, gives a reader that has only the sketch and its result the curves and positions the recompute holds, the axes among them; the sketch tools, the profiles the tools build in memory and the app's view read it.
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

**Recipe.** The designers' spike of 2026-11-17 (`a-solver.spike.ts`, kept in the scratchpad of the review, `step6-review/6b-design/designers/`) feeds the real planegcs adapter and the engine's `SketchAnalysis` the inputs `solverSetup` would make. The probes of this revision are in the scratchpad of the session, `step6-review/6b-revision/` (`r.probe.ts`, rows R1, R7 and R8 of its log `r.log`), run from the worktree with `npx vitest run --config <scratchpad>/step6-review/6b-revision/vitest.config.ts`: they prototype the axes by `vi.mock` of `entityOf`, `resolveReferences` and `sketchCurves` and run the real engine with the real planegcs and manifold adapters. Not run: the points of an axis in `ruleProblem`, the refusals of the catalog, `solvedCurves`, the app, MCP.

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
| A constraint between `origin` and an axis (R8) | refused by today's rule ("vazba jen mezi pevnými entitami …") |
| `symmetric` of `origin` and an own point about `origin/y`, without the rule of the points of an axis (R8) | accepted, which is why the rule is needed |

What the numbers decide:

- **The far point of an axis is at 1 mm**: the direction is exact, its distance changes nothing in the solver, and the hidden segment is measured by nothing (`midpoint` and `equalLength` are refused).
- **The board is drawn with every point placed by a linear constraint**, so it has one solution. A board held by tangency has several, and the solver reached a wrong one at a jump without a word, which is the worse failure: `ok`, 0 degrees of freedom, a body of the wrong shape. The review of 6b's design proposed the filleted rectangle and measured its status and the radii of its arcs after each jump, not its shape.
- **A jump the solver does not converge on is said aloud** (`sketchConflict`, the last state kept), with either form and with the first draft too. It depends on where the solve starts (62 → 120 fails, 60 → 120 solves), not on the constraints, so it is the solver adapter's and not this point's ("Known limits"; a backlog row).

## Decisions

### The two lines

- **IDs and shape**: `origin/x` and `origin/y` are lines from `origin` to the hidden points `origin/x/b` at (1, 0) and `origin/y/b` at (0, 1) (6a's vocabulary). A caller's ID cannot hold a slash, so no document has them. The constants are `ORIGIN_AXES`, `isOriginAxis` and `underOrigin` in `util.ts` beside `ORIGIN`, and their geometry `AXES_GEOMETRY` (with `hidden`) in `sketch-content.ts`, the leaf that says what an entity of a sketch is.
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

**One function for the readers that have no recompute**: `solvedCurves(sketch, result)` in `sketch.ts`, beside `sketchCurves`. It answers the curves and the positions of a solved sketch as the state of the recompute holds them: the own curves of the document, the curves of the entries from `result.curves`, and the two axes; the positions of the result with the two far points. Its readers:

| Reader | Today | After |
|---|---|---|
| `shapeOf` and `positionsOf` of `sketch-tools.ts` (a snap of a tool, the fillet) | the document's curves, `result.curves`, `result.points` | `solvedCurves` |
| The profile a tool builds in memory (6e's `toolWorld`; 6c's stage called from a tool) | not written yet | `solvedCurves`, each adding its joins |
| The app's `sketchView` | the document and the result | `solvedCurves` |

So no reader adds the axes by itself, and a package that puts a further kind of curve into the state and not into the result has one place to do it.

### The sketch tools and the app

- **`shapeOf`** gives an axis as the line through the origin from −`AXIS_REACH` to +`AXIS_REACH` (10⁶ mm), so `closestOn` and the contacts of 6e treat it as a whole line; an anchor snapped to an axis (`snap: { kind: 'curve', id: 'origin/x' }`) gets `pointOnCurve` on it, as a snap to any curve.
- **The app** draws the axes in an open sketch as two thin lines through the origin across the view, in the style of reference geometry; they can be hovered, selected and snapped to as lines: a point and `origin/x` selected offer *Point on curve*, two points and `origin/y` *Symmetric*. Deleting an axis by the selection does nothing. The pickers of a line of a sketch (`lineIds` of `sketch-commands.ts`: the axis picker, the mechanism panel) list `origin/x` and `origin/y` after the lines of the sketch.
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
| `packages/engine/src/sketch.ts` | `sketchCurves` adds the axes; `solvedCurves`; the type of the resolved references in `solverSetup` (a key without a value) |
| `packages/engine/src/features/sketch.ts` | the step: the far points in the state's geometry, no hidden point in the result's `points`; `ruleProblem`'s points of an axis |
| `packages/engine/src/catalog.ts` | `check` of `midpoint` and `equalLength`: no axis |
| `packages/engine/src/sketch-tools.ts` | `shapeOf` and `positionsOf` through `solvedCurves`; an axis as a long line |
| `packages/engine/src/types.ts` | the comments the AI reads: the axes in the comment of `ExternalRef` and of the constraints; `SketchResult.points` and `curves` (no axis, no hidden point) |
| `packages/engine/src/index.ts` | exports `ORIGIN_AXES`, `isOriginAxis`, `AXIS_REACH`, `solvedCurves` |
| `packages/mcp/src/api.ts` | the sentence on the axes in the paragraph on sketches |
| `packages/app/src/sketch-view.ts` | the view through `solvedCurves`: the axes as two curves that are not own, drawn across the view and picked as lines |
| `packages/app/src/sketch-commands.ts` | `lineIds` lists `origin/x`, `origin/y` after the lines of a sketch (`axis-picker.ts` and `panels/mechanism.ts` read it) |
| docs | `architecture/sketch.md` (the bullets "IDs" and what the result carries), `architecture/api.md` (`AxisRef` on an axis), `architecture/ai.md`, `architecture/verification.md`; `ui/` the sketch mode and the axis picker; `decisions.md` D71; `requirements.md` scenario 15, the part of 6a2; the vocabulary of 6a (row 7 of its amendments) |

No new module and no new layer: `docs/architecture/repository.md` is unchanged.

## MCP

- `describe_api` shows the comments on the axes from `types.ts` with no change in `packages/mcp`.
- The paragraph on sketches of `api.ts` gains: "Every sketch has the lines `origin/x` and `origin/y` through its origin along its X and Y. A constraint may name one with at least one own operand (a point on it, two points symmetric about it, a distance to it, parallel, perpendicular, an angle, a tangent circle); `midpoint` and `equalLength` do not take them. `{ kind: 'sketchLine', sketch, line: 'origin/x' }` is an axis of a revolve, a pattern, a tilted plane or a joint. `get_sketch` does not list them."
- `sketch_tool`: a snap to `origin/x` or `origin/y` (`snap: { kind: 'curve', id }`) works as a snap to any curve.

## Where 6a2 meets 6e, 6c, 6b and 6h

- **6e** (next in the sequence): an axis is a reference line that forms no regions and can hold a point: a `with` curve, and a cut of a construction curve; never cut. Its `toolWorld` takes the curves and the positions from `solvedCurves`, so the axes are there with no line of 6e's.
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
3. **A long hidden segment for the axes** (far points at ±10⁶ mm in the solver). Measured: the far point's distance changes nothing in the solver; the length matters only to a reader that clamps to the segment, which is `shapeOf`, where it is said once.
4. **Each reader in memory adds the axes from the constants** (the first design: the app, the sketch tools and 6c's tools each read `axesGeometry()`). Four readers, and a fifth with each package; `solvedCurves` is one.
5. **The board as a filleted rectangle held by tangency** (the review's proposal). No redundancy either, but several solutions, and the solver took a wrong one at a jump with the sketch `ok` (measured).
6. **The board with four dimensions a corner** (the first draft). Eight redundant constraints; "fully determined" was not true of it.

## Known limits

- **The axes are not drawn outside the sketch mode** and not listed by `get_sketch`; the description for the AI names them.
- **A reserved name**: nothing else may ever be an entity under `origin/`; a far point is not offered by any picker.
- **A big jump of a dimension may not solve.** The board with `boardW` from 62 to 120 in one step is `sketchConflict` and keeps its last state, while 60 to 120 solves and any jump solves in two steps (measured). It is how the solver adapter converges on a sketch with arcs, with every form of the board tried, and no point of step 6 changes the adapter but 6d. A backlog row: a sketch that fails to solve after a big change of a parameter is tried again in smaller steps.

## To verify before the implementation

- That the stamp of every stored sketch stays: load the documents of the tests and `packages/scenarios`, compare `solved.inputs` before and after (the axes must not enter an input no constraint names). Read by the review: the axes reach the stamp only through the resolved references, so it holds by the code.
- That `measure` of a reference dimension to an axis has the axis in its curves. Run with the mock (26.5), and by the review through the real `solverSetup` and `measure`.
- The app's snapshots: which change (the axes in the scene of an open sketch; the axis picker of a model without lines) and nothing else. Not checkable before the implementation.
- That 6e's and 6c's designs, which are being revised, name `solvedCurves` as the source of their curves in memory; 6e's text of today says "`toolWorld` adds them from the helper 6a2 exports".

## Tests the implementation owes

- **Engine, the entities**: `entityOf` of both axes and of a far point (none); `referenceEntities` without them; the list of curves and the geometry of a sketch with no constraint on an axis.
- **Engine, constraints**: a constraint on each axis (point on, symmetric about, tangent, parallel, perpendicular, angle, distance point–line); the refusals (`midpoint`, `equalLength`, a constraint between an axis and `origin` or two fixed operands, `symmetric` with `origin` as a point); a reference dimension to an axis measured.
- **Engine, the stamp and the result**: the stamp unchanged without a constraint on an axis, changed with one; the stored documents of the tests loaded with their stamps unchanged; the result without the axes and without far points; `solvedCurves` equal to the state's curves and geometry for a sketch with an edge projection.
- **Engine, consumers**: a revolve and a pattern about `sketchLine` `origin/x`; a plane tilted about it; a snap of a sketch tool to an axis far from the origin (`shapeOf` as a long line); the fillet's lists unchanged.
- **Scenario 15**: the stand-in board of step 1, from calls.ts (`packages/scenarios/test/scenario15.test.ts`, a `describe` of its own): determined with no redundancy, its volume, one parameter changed and back.
- **MCP**: `describe_api` names the axes; a constraint on an axis through `execute`; `get_sketch` without them.
- **App**: the axes in the view of an open sketch (hover, a constraint with a point, a snap), the pickers, the snapshots as said above.

## Open

Nothing waits for the owner in this point. Two things for the report of the revision:

1. **The decision number.** The plan gave 6a2 none ("its design is the part of 6b's design about the axes"). With the axes out of D69 and a text of their own that amends 6a's vocabulary (where the axes are carried), they have D71, the next free number. *If the owner prefers them under D64 or D69, it is one row of `decisions.md` and three mentions.*
2. **The backlog row** of "Known limits" (a failed solve tried again in smaller steps) is not step 6's; it is proposed here because this point measured it.

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

Still owed: a review of this text as a design of its own (light: it adds two constants and one reader, and its geometry is two fixed lines), and `codex` and `agy` under the owner's rule for design reviews, which ran on none of the designs of step 6 before 2026-11-24.

## Rows for the indexes

**docs/d36/README.md**, the row of 6a2, column "Design now":

> full ([6a2-origin-axes/design.md](6a2-origin-axes/design.md), D71), carved out of 6b's design on 2026-11-24: `origin/x` and `origin/y` as lines of every sketch from `origin` to a hidden far point at 1 mm; in the list of curves and the geometry of every sketch, in the solver only when a constraint names one (the slot of 6a: no value, no stamp), not in `SketchResult`; one function, `solvedCurves`, for every reader that has only the sketch and its result (the sketch tools, the profiles in memory of 6e and 6c, the app's view); `midpoint` and `equalLength` refuse an axis; an axis as a long line for the tools; the stand-in board of scenario 15 placed by linear constraints only (no redundancy, one solution; a filleted rectangle held by tangency reached a wrong solution at a jump, measured); no command, no issue code, no schema step

**docs/decisions.md**, the row of D71:

> | D71 | [6a2 The axes of the origin](d36/6a2-origin-axes/design.md) | designed 2026-11-17 inside 6b's design (D69), a point and a text of its own since 2026-11-24 | `origin/x` and `origin/y` are lines of every sketch, in the solver only when a constraint names one, so no stored sketch is solved again; they are not in the result of a sketch (a curve there would name a hidden point), and every reader without a recompute takes them from one function, `solvedCurves`; an axis has no length and no middle; no schema step |

**docs/requirements.md**, validation scenario 15, the first sub-item:

> - *The stand-in board (6a2, D71).* Until 6f imports one, the board is drawn by hand on XY: four lines, four corner arcs and four holes, the ends of its first corner by four dimensions from the origin, the ends of the others by `symmetric` about `origin/y` and `origin/x`, each centre by one distance of 0 to an end of its arc, the first hole by two dimensions and the others by `symmetric`. Fully determined: no freedom and no redundant constraint; the body 1.6 thick by `mass` within the chord tolerance of the volume by hand (3776.2 mm³; measured 3776.4), and `boardW` to 62 and back follows. Also: a reference dimension from a hole centre to `origin/y` reads 26.5; a ring revolved about `origin/x` of its sketch. Refused: `midpoint` and `equalLength` with an axis, a constraint between an axis and the origin, `symmetric` with the origin as a point, a far point as an operand.
