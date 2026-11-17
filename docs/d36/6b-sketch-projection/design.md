# 6b Projection from another sketch, and the axes of the origin (D69)

**State: designed 2026-11-17 against `master` at `e70cd65` (schema version 10), with 6a (D64) implemented and merged, and against the designs of 6c (D68) and 6e (D65), which are implemented before 6b; on Opus 5.5; reviewed as recorded in "Reviews". Not implemented.** The plan of the step is [6-plan.md](../6-plan.md), "6b Projection from another sketch, and the axes of the origin"; the owner agreed to all its recommendations on 2026-11-17, among them question 4 (a curve projected from another sketch forms regions only when a flag on its reference says so) and question 8 (the axes as two fixed lines of every sketch under reserved IDs).

Files: [contract.ts](contract.ts) (the entry, its value, the kind, the axes, the sketch tool, the app), [calls.ts](calls.ts) (validation scenario 15, steps 2 and 3 and the part of step 7 that is 6b's, and the rest of the mechanism).

The package in short:

1. **A reference kind of entry of `external`, `sketch`**: `{ type: 'sketch', sketch, entity, kind, regions? }` projects one point, line, circle or arc of an earlier sketch (its own entities, `origin`, and the entities of its entries: projected edges, projections, copies of 6c) into a sketch on a parallel plane, either normal, any offset. The entry is the projected entity itself (`<id>`), its points are `<id>/a`, `<id>/b`, `<id>/center`, `<id>/start`, `<id>/end` as for an own curve of that kind.
2. **Its values follow the source on every recompute** (from the solved state of the source sketch before this one); a source that is gone, or whose entity is no longer of that kind, freezes the projection at its last values with the warning `brokenProjection`, as a lost edge does; a plane that is not parallel is `unsupportedProjection` with the angle in the message.
3. **Projections of one point of the source join**: each projected point carries the vertex of its source point (a join key, 6a's slot), so the eight entries that project a rounded rectangle close into one loop. **With `regions: true` a projected curve forms regions**, and the side face it makes is named by the entry's ID.
4. **The axes of the origin `origin/x` and `origin/y`** are lines of every sketch: an operand of a constraint, the axis of a mirror (6c), a line of an `AxisRef`. They are in the solver only when a constraint names one, so no stored sketch changes; they are not in `SketchResult` (the app and the tools know them as constants).
5. **A sketch tool `projectSketch`** projects every curve and lone point of a sketch in one batch (the app's button, the AI's one call); one entity is one `addExternal`.
6. **No command, no query, no feature type, no face role, no issue code, no schema step.** The texts of the three projection warnings become English and general, with a detail.

## What the plan says, checked against the code

| Statement of the plan | What the code (and 6a, 6c, 6e) says |
|---|---|
| "A new kind of reference, `{ type: 'sketch', sketch, entity }`" | 6a's registry (`REFERENCE_KINDS`, `packages/engine/src/references/`) takes it as one module and one line. **It needs a `kind` too**: `entities` of a kind is computed from the sketch alone (6a: so that commands and `load` validate without a recompute), and the kind of an entity of another sketch is not in this sketch. The edge stores `kind` for the same reason (`architecture/sketch.md`, "Promítnutá geometrie") |
| "Its own, projected or derived entities" | `entityOf(source, entity)` answers an own point or curve, `origin`, and every entity of the source's entries (`references/index.ts`); 6c adds the copies (`entity` of its kind). The recompute reads the source's `SketchState`: `curves` (own, reference, and from 6c derived) and `geometry` (every used position), which 6a made the list every reader shares. The axes of the source are left out (below) |
| "Parallel planes (either normal, any offset)" | Measured (spike b): a source on XY and a sketch on the bottom face of a body (normal −Z, its x along −X) map exactly; an arc has to swap its ends there to stay counter-clockwise |
| "A tilted plane is `unsupportedProjection`, as for a circular edge" | The code for an edge (`projectEdge`, `solid.ts`) uses `ANGLE_TOLERANCE` (1e-4 rad) for "parallel"; the same here. The text of the code speaks of an edge ("Hranu nejde promítnout jako zvolený druh křivky.", `recompute/services.ts`) and the step adds no detail, so the warning needs a detail to say why |
| "A failure freezes them as for an edge (`brokenProjection`)" | `resolveReferences` already falls back to the stored value through the kind's `value` (6a); measured: a removed hole circle of the board leaves the frame's projection in place with `brokenProjection` |
| "Projected curves do not form regions unless question 4 decides otherwise" | The owner decided: a flag on the reference (6a, "Which geometry forms regions"). `EntryGeometry.regions` carries it; the profile reads `SketchCurve.regions` and nothing else (6a part 2) |
| "Projecting a whole sketch is a batch (a button in the app, a batch of `addExternal` through MCP)" | A batch works, but which entities "the whole sketch" is (curves that are not construction, lone points) is a rule, and a rule the app follows belongs to the engine and to MCP alike: a sketch tool (below, "The sketch tool"; Open, question 2) |
| "The axes … under reserved derived IDs `origin/x`, `origin/y`" | 6a fixed the slot: a resolved reference without a value under the key `origin`, in the solver only when a constraint names an axis, in the list of curves of every sketch. The slot is not filled in the code: `sketchCurves` adds no axes, `entityOf('origin/x')` answers undefined, and `resolveReferences` puts nothing under `origin` |
| 6a: "The result of every sketch then carries them in `curves` and their far points in `points`" | Not taken (below, "The axes are not in the result"): the app fits its camera to `result.points` (`scene.ts`, `grow`), so a far point at (1, 0) would move the view of every sketch drawn left of its origin, and every result of every model would change for readers that can know the axes as constants |
| "The converter skips every constraint with an external operand, the origin among them" | True (`tools/onshape/sketch.ts`, `p.externalFirst \|\| p.externalSecond \|\| p.externalMirror`); "The Onshape converter" below. The count of the 287 lost constraints by kind of operand still cannot be made: the dump is not in the tree |
| "The solver adapter is touched by 6d alone (6b's axes are fixed lines as projected edges are)" | True for the axes. **A projected arc is new to the adapter**: no reference was an arc before. Measured (spike a): a fixed arc works, but only when its ends lie on one radius within about 1e-10 mm; so the projection makes the arc exact, and the adapter does not change |

Not in the plan, found in the code:

- **The catalog does not know a line without length.** `midpoint` and `equalLength` take any line; on an axis they would measure the hidden segment from the origin to the far point. They are refused for an axis in the catalog's `check`.
- **`ruleProblem` reads the points of an entry by `derivedPoints(id, ref)`**, which knows the edge only (`ref.kind === 'line' ? a, b : center`) and which 6c narrows to the edge. For a projection the points of the curve are `CURVE_POINTS[kind]` under the entry; for an axis, `origin`.
- **The sketch tools' `closestOn` clamps a line to its segment** (`sketch-tools.ts`). A snap of a tool to an axis (`snap: { kind: 'curve', id: 'origin/x' }`) has to see a long line, not the hidden segment of 1 mm.
- **The fillet's list `shortened` reads the faces of an entry** (`faces(ref)` of the kind). A sketch that projects a line the fillet shortens reads no face, so it would be in no list; the kind says which entities of other sketches it reads (`reads`), and the fillet and 6e's tools list it.
- **`updateExternal` drops the stored value of the entry** ("Zmrazené hodnoty patřily původní hraně", `document.ts`). Switching the region flag of a projection whose source is gone would lose its frozen geometry; the kind says when an update keeps the source (`keepsValue`).
- **The scene draws only the own curves of other sketches** (`scene.ts`, `if (curve.own)`), so a sketch made only of projections (the skeleton `frame`) is invisible outside its own sketch mode; the tool's picker draws its candidates itself.

## The cheap variant

What the plan asks, with these choices:

- One entity per entry; the whole sketch is a batch the tool `projectSketch` makes.
- Parallel planes only; the projection is along the normal of the target.
- The value is the projected positions and the vertex of each source point in the source (the key); stored and stamped as an edge's value is.
- A source curve whose kind changed (a circle trimmed into an arc by 6e) breaks the projection (frozen); the repair is a new entry.
- The axes as constants of every sketch, in the solver only when named.

**Deferred**: the projection into a tilted plane (an ellipse, as for an edge); a projected spline (6d: refused with the way round, its control points projected as points); the axes of another sketch (refused: project its `origin`); a reference to a whole sketch as one entry (the plan's deferral); keys that travel through a chain of projections (two projections of one board point, one through the skeleton and one directly, are two vertices; "Known limits"); patching the projections of a curve the fillet or 6e's tools change (they are listed in `shortened`, not patched); projecting from a sketch of an inserted document (D62 brings bodies, not sketches).

## Measured

**Recipe.** Three spike files in the session's scratchpad (`6b/`), run from the worktree with `npx vitest run --config <scratchpad>/6b/vitest.config.ts`: `a-solver.spike.ts` feeds the real planegcs adapter and the engine's `SketchAnalysis` the inputs `solverSetup` would make; `b-prototype.spike.ts` and `c-scenario.spike.ts` register a prototype of the kind in `REFERENCE_KINDS` at run time, put the join keys into `joinPairs` and, in `c`, prototype the axes (`entityOf`, `resolveReferences`, `sketchCurves`) by `vi.mock` of the engine's modules, and run the real engine with the real planegcs and manifold adapters. Not run: the commands' validation of the kind (the prototype validates nothing), the app, MCP.

| What | Result |
|---|---|
| a1. A fixed arc (three fixed points, after a turn of the frame and back: radii 8 and 7.999999999999998) | solved, no redundancy, 0 degrees of freedom |
| a1. An own line tangent to it and horizontal; an own point on it at a distance from the origin | solved (the line at y = 13, 2 degrees of freedom left: its two x); the point at (15.897, 10.406), 0 left |
| a1. An own arc held on a fixed arc: its ends coincident with the fixed ends and `equalRadius` | solved, 0 degrees of freedom, no redundancy |
| a1. An own arc held by all three points (centre, start, end coincident) | **`conflict`** of the three coincidents (four equations of the arc rules over three fixed points) |
| a2. A fixed arc whose end lies off the radius of its start by δ, alone | solved up to δ = 1e-6 mm; `failed` at 1e-5 |
| a2. The same with an own point on it | solved for δ ≤ 1e-10 mm; **`failed` for δ ≥ 1e-9** |
| a3. The axes as fixed lines from `origin` to a far point at 1 mm and at 1000 mm: a point on the X axis at x = 500, two points symmetric about the Y axis, a circle tangent to the X axis, a line parallel to X with an angle and a point–line distance to Y | all solved, 0 degrees of freedom, the same positions for both far points |
| a4. An own rounded rectangle held on a fixed one (60 × 40, R 4): ends coincident with the fixed ends; arcs held by the centre too / by `equalRadius` / by nothing more | **conflict** / solved, 0 degrees of freedom, no redundancy / solved, 4 degrees of freedom (each centre on its bisector) |
| b. Board on XY (60 × 40, R 4, four holes, sizes from parameters); `frame` on a plane 10 above projects its eight outline curves and four holes; `baseSk` on the bottom face of the board (normal −Z) projects the outline from `frame` with the flag | `frame`: valid, no region; `baseSk`: one region of the eight entries (`["ba0" … "bl3"]`), joined by the keys alone; `ba0` maps (26, 16), (30, 16), (26, 20) to (−26, 16), start (−26, 20), end (−30, 16): ends swapped, counter-clockwise |
| b. The region extruded 5 with the offset 2 | 13924.30 mm³ against 13925.49 by hand (the arcs are polygons within the chord tolerance); side faces `{ feature: "base", role: "side", curve: "ba0" }` … |
| b. `W` from 60 to 64 | every feature `ok`; 14804.30 (+880.00, by hand +880.00); the stored value of `ba0` follows: centre (−28, 16) |
| b. A sketch on a plane tilted by 0.3 rad projecting a line of `frame` | warning `unsupportedProjection` (with the edge's text of today) |
| b. The hole `h0` of the board removed | `frame`: `brokenProjection` of `fh0`, which keeps its circle (26, 14), r 1.6; the rest unchanged |
| c. Scenario 15, steps 2 and 3, as calls.ts writes them (below) | the stand-in board fully determined by constraints on the axes (0 degrees of freedom); the frame measures 26.5 from both hole centres to `origin/y`; the floor sketch with its own outline held on the projection: 0 degrees of freedom, no redundancy; the rim's projected outline one region of eight entries; the standoff sketch: four rings (own circle with the projected hole as its hole) and four discs; the base 7835.04 mm³ against 7836.90 by hand; faces `rim/side/ra0`, `standoffs/side/sh0` (the bores) |
| c. `boardW` from 60 to 62 | all ten features `ok`; the base 8047.04 (+212.00, by hand +212.00); the frame measures 27.5 |

What the numbers decide:

- **The projected arc is made exact** (a2): its end is put on the circle of its start, `end = center + |start − center| · (end − center) / |end − center|`, in the coordinates of the target. A source arc is solved within the adapter's tolerance (its check `usable` allows 1e-6 relative), and a projection turns and moves it, so without this a point on a projected arc can fail the sketch.
- **Own geometry is held on a projected arc by its ends and `equalRadius`**, not by its centre as well (a1, a4: a conflict). That goes into the description for the AI and into the help of the tool.
- **The far point of an axis is at 1 mm** (a3: no difference to 1000 mm): the direction is exact, and the hidden segment is measured by nothing (midpoint and equal length are refused).
- **The keys close a projected outline**, the region flag, the offset of 2a and the side faces work on reference curves with no change of the profile code (b, c), and the stamp re-solves the chain when the board changes (b, c).

## Decisions

### The entry `sketch`

```ts
interface SketchProjection {
  type: 'sketch';
  sketch: Id;       // an earlier sketch of the document
  entity: Id;       // a point or a curve of it
  kind: 'point' | 'line' | 'circle' | 'arc'; // the kind of `entity`
  regions?: true;   // the projected curve forms regions of this sketch
}
```

- **`kind` is stored and required**, as for an edge: the entities of the entry, and so `entityOf`, the constraints on it and `load`, follow from the document of this sketch alone. A command checks it against the source (`requireRef` of the kind `entity` with `accepts: [kind]`, which says "c1 is a circle, expected arc"). A caller who does not know the kind asks `get_sketch` of the source or uses the tool.
- **`regions`** is stored only as `true`; `false` in a command is the same as leaving it out (so a document has one form). On a point it is refused ("a point forms no regions").
- **The ID of the entry is the projected entity**; its points are `<id>/<name>` with `CURVE_POINTS[kind]` (`a`, `b`; `center`; `center`, `start`, `end`); a projected point is `<id>` itself (6a's vocabulary). An arc keeps its sense: its `start` is the projection of the source's `start`, except across a flip of the normal, where it is the projection of the source's `end` (below).
- **One entry per entity of the source**: a second entry with the same `sketch` and `entity` is refused, naming the first ("c1 of board is projected already as fl1"). A duplicate would only overlap itself, and with the flag make the profile invalid.

### Which sketches, which planes

- **Earlier on the timeline only**: `refs` gives `{ path: 'external/<id>', id: sketch, kind: 'sketch' }` and the entity reference `{ id: entity, kind: 'entity', sketch, accepts: [kind] }`, so a command checks the order and the entity (`requireRef`), `moveFeature` refuses to put the sketch before its source, and a reference to a removed sketch or entity is valid in a document, as every reference is (the step reports it). Itself is not earlier than itself: refused.
- **Parallel planes**: the normals parallel or opposite within `ANGLE_TOLERANCE` (1e-4 rad, as for an edge), any offset along the normal and any shift or turn in the plane. The plane of a sketch is known only at recompute (it may be a face), so this is not a command's check: a tilted plane gives the warning `unsupportedProjection` with the detail "the plane of board is at 17.2° to this sketch; only a parallel plane is projected", and the entry keeps its last values.
- **The map**: a point `p` of the source goes to `toPlane(T, toWorld(S, p))`, its distance along the normal dropped (the functions of `solid.ts`). Lengths and radii are kept. When the normals are opposite the map reflects the plane: an arc runs clockwise, so its start and end swap (as 6c's mirrored arc does, 6a's vocabulary "Shapes").

### What is projected, and its entities

| Source entity | `kind` | Entities of the entry `x` | Value |
|---|---|---|---|
| an own point, `origin`, a point of an entry of the source (`fl1/a`, `h/center`, a copy's point `m/1/p3`) | `point` | `x` (point) | `{ kind: 'point', at, vertices: [v] }` |
| a line: own (a construction line too), a projected edge, a projection, a copy | `line` | `x` (line), `x/a`, `x/b` | `{ kind: 'line', a, b, vertices: [va, vb] }` |
| a circle, likewise | `circle` | `x` (circle), `x/center` | `{ kind: 'circle', center, radius, vertices: [vc] }` |
| an arc, likewise | `arc` | `x` (arc), `x/center`, `x/start`, `x/end` | `{ kind: 'arc', center, start, end, vertices: [vc, vs, ve] }` |

- **Refused by the validator**: `origin/x` and `origin/y` of the source ("the axes of another sketch are not projected: use origin/x and origin/y of this sketch, or project the origin of board"); a hidden point (`origin/x/b`, a hidden point of 6c) is no entity, so `requireRef` refuses it already; a spline after 6d ("a spline is not projected yet: project its control points as points").
- A construction curve of the source is projected as any curve; the flag decides whether it forms regions here.
- `vertices` are the vertices of the source points in the source (`SketchState.joins` of the source, 6a: the smallest ID of the points joined with it, through the coincidents, the keys and from 6c the joins of copies), in the order of `CURVE_POINTS[kind]` (after the swap of a flipped arc).

### The value, the stamp, the arc made exact

- **`compute`**: the source's `SketchState` from `state.sketches` (absent: `brokenProjection`, "board is not evaluated before this sketch: removed, suppressed, in error, or later on the timeline"); the planes (above); the entity: a point from `geometry.points`, a curve from `curves` (absent: `brokenProjection`, "board has no curve c1"; of another kind: `brokenProjection`, "c1 of board is an arc now, not a circle"); the positions mapped; a circle's radius from `geometry.radii`; an arc's ends swapped across a flip and its end made exact (above, "Measured").
- **The value is stored** in `solved.external` and stamped (the whole value, its `vertices` too: a change of the joins of the source solves this sketch again, which costs a solve and changes nothing else), as 6a requires of a reference: a frozen projection keeps its positions and its keys.
- `solved.external` holds `Projected | ProjectedEntity` (`SolveStamp.external` in `types.ts`). A stored value is read by its form first (6a's `storedValue`): a value with `vertices` is a `ProjectedEntity`, one without is an edge's `Projected`; then the kind's `value` checks that it fits its entry (the same `kind`; the edge's `value` now refuses a value with `vertices`, so neither kind takes the other's).
- **`compute` may say why** (`{ code, detail }` beside a bare code): `resolveReferences` keeps the detail in `lost`, and the step's warning carries it with the constraints left out, "(board has no curve c1; the constraints on it were left out of the solve)".

### Joins: the keys of the source's vertices

6a's slot, written here (`joinPairs`, `sketch.ts`): after the coincident pairs and the entries' declared `joins`, **every two points of the entries with the same key are a pair**, joined when they lie within the length tolerance, as any pair. The key of a projected point is `JSON.stringify(["sketch", <source sketch>, <vertex>])`, made by `geometry` from the stored `vertices`. So the end of a projected line and the start of the projected arc after it (two points of the source joined by being one point, or by a coincident) are one vertex here, and eight entries projecting a rounded rectangle close into one loop (measured, b and c). Pairs are made in the order of the entry IDs, each later point with the first of its key, which `joinsOf` closes transitively.

- Keys of different sources never meet (6a, "Known limits"): an own point tied to both by two coincidents joins them.
- 6c's join stage comes after (its rule 3 joins the ends of copies to the ends of reference curves with `regions` that are one vertex already: those of a projected outline are, by the keys).

### Regions and face names

- A projected curve with `regions: true` is in the profile like an own curve that is not construction (`EntryGeometry.regions: [id]`); without the flag it is in the list of curves with `regions: false` and bounds nothing, as a projected edge or a construction curve.
- **A region is named by the IDs of its outer loop**, entries included (`["ra0", …, "rl3"]`, measured), and the side face of a projected curve by the entry's ID: `{ feature, role: 'side', curve: 'ra0' }`, `wallSide` never (a wall takes own curves, `notProjected`). The ID has no slash, so the face key is today's (6a's quoting is for slashed IDs).
- Own and projected curves mix in one loop where an own end is coincident with a projected point (a coincident between an own and a fixed point is allowed), and a profile is invalid where an own curve lies over a projected one that forms regions, as for two own curves.
- **Holding own geometry on a projection, without the flag**: own points coincident with the projected points, own lines over them, an own arc by its two ends and `equalRadius` with the projected arc (measured: fully determined, no redundancy; the centre as well is a conflict). That is how the floor of scenario 15 is drawn, so that 6e's tools can cut it.

### When the source changes

| Change in the source | The projection |
|---|---|
| a point moved, a dimension changed, a parameter | follows at the next recompute (the source is solved first); the stamp of this sketch changes, it is solved again and written back |
| the entity removed (`removeEntity`, `removeExternal` of a projection there, a copy beyond a lowered count of 6c) | `brokenProjection` with the detail, frozen at its last values; constraints on it keep acting on the frozen geometry |
| the source sketch removed, suppressed, in error, moved after this sketch (refused by `moveFeature`), its plane tilted | `brokenProjection` or `unsupportedProjection`, frozen |
| 6e splits the curve | the piece that keeps the ID is projected (shorter); the new pieces are not. With the flag the region here may open. 6e's tools list this sketch in `shortened` (through `reads`, below) |
| 6e trims a circle into an arc (the same ID, another kind) | `brokenProjection` ("c1 of board is an arc now, not a circle"), frozen as the circle. `updateExternal` cannot change the kind of an entity that stays (6a's rule); the repair is a new entry (`removeExternal`, then `addExternal` with `kind: 'arc'`), the constraints on it made again |
| 6e trims, extends or the fillet shortens a line | the shorter line is projected; the sketch is in `shortened` |
| the vertex of a source point changes (a coincident added or removed) | the key changes; the stamp changes and the sketch is solved again |

`reads(ref)` is a member a kind may have: the entities of other sketches an entry reads (`[{ sketch, entity }]` here). The fillet (D52) and 6e's tools put a sketch whose entry reads a curve they change into `shortened`, as they do a sketch that projects an edge of its side face. Patching such a projection (adding the fillet's arc as one more entry) is deferred.

### Constraints on projections and on the axes

What consumers accept (6a's table, the rows of 6b):

| Consumer | A projection from a sketch | `origin/x`, `origin/y` |
|---|---|---|
| A point of a curve of the sketch | no (a coincident joins to it) | no (no point) |
| An operand of a constraint of its sketch | yes, with at least one own operand, as any fixed entity | yes, likewise; not `midpoint` or `equalLength` (catalog `check`: "origin/x is an axis of the origin, a whole line: it has no length and no middle") |
| An operand of a generator (`sketchPoint`, a circle) | yes | — (lines) |
| An `AxisRef` (`sketchPoint`, `sketchLine`), a frame of a placement | yes | `sketchLine` yes (along +X, +Y of the sketch, from `origin`) |
| A mirror axis, a direction of 6c | yes (a line) | yes |
| A point of a hole, a curve of a wall (`notProjected`) | no | no |
| `setCurvePoint`, the fillet's corner, 6e's cuts | no; a cut of an own curve when `with` names it (6e) | no; 6e's `with` may name one |
| A region | with `regions: true` | never |

- An axis runs from `origin` towards +X (`origin/x`) or +Y (`origin/y`): the sense an `angle` dimension, a revolve about `sketchLine` and 6c's direction read.
- `ruleProblem`'s points of a curve (the catalog's rule that a symmetric point is no end of its axis, a midpoint no end of its line): for an entry, `CURVE_POINTS[kind]` under the entry; for an axis, `origin`. `derivedPoints(id, ref)` stays the edge's (6c narrows it).

### The axes of the origin

- **IDs and shape**: `origin/x` and `origin/y` are lines from `origin` to the hidden points `origin/x/b` at (1, 0) and `origin/y/b` at (0, 1) (6a's vocabulary). The constants are `ORIGIN_AXES` and `isOriginAxis` in `util.ts` beside `ORIGIN`, and their `EntryGeometry` (`axesGeometry()`, with `hidden`) in `references/axes.ts`.
- **`entityOf`** answers `{ kind: 'line', own: false }` for both; `referenceEntities` does not list them (they are no entry).
- **The list of curves** (`sketchCurves`) has them in every sketch, `source: 'reference'`, `regions: false`; the state's `geometry` has their far points in every sketch. So a mirror about `origin/y` (6c), a revolve or a pattern about `{ kind: 'sketchLine', sketch, line: 'origin/x' }` (`axis` of `recompute/services.ts` reads `curves` and `geometry`) and a projection's reading of the list find them, whatever the constraints.
- **The solver** gets them only when a constraint of the sketch names one (a dimension too, so a reference dimension to an axis is measured: `measure` reads the curves of the input): `resolveReferences` adds `origin: { geometry: axesGeometry() }` with no value (6a's slot), and `solverSetup` puts the far points into `fixed` and the lines into the input as it does any entry, but stamps no value under `origin`. A sketch whose constraints name no axis has the input and the stamp it has today, so no stored sketch is solved again on load.
- **The axes are not in `SketchResult`**, neither its `curves` nor its `points` (the far points are taken out of `points` when they were in the input). 6a wrote that the result would carry them; it does not, because (1) the app fits its view to `result.points`, so a far point at (1, 0) would change the camera of every sketch drawn left of its origin, (2) every result of every model would change for readers that can read the axes as constants, which is what the app, the sketch tools and 6c's tools in memory do (`axesGeometry()`, `isOriginAxis`). `get_sketch` does not list them (the description for the AI names them).
- **The sketch tools** (`shapeOf` of `sketch-tools.ts`) give an axis as a line through the origin from −`AXIS_REACH` to +`AXIS_REACH` (10⁶ mm), so `closestOn` and 6e's contacts treat it as a whole line; an anchor snapped to an axis gets `pointOnCurve` on it, as a snap to any curve.

### Validation and the commands

- **The validator of the kind** (`validate`, on `load`, `addFeature` of a sketch, `addExternal`, `updateExternal`): the fields (`onlyFields`: `type`, `sketch`, `entity`, `kind`, `regions`); `kind` one of the four; `entity` not an axis; `regions` a boolean, not on a point; the references (`requireRef`, which a command checks and `load` does not); no other entry of this sketch with the same `sketch` and `entity` (the entry itself excepted, so `updateExternal` of the flag passes).
- **`updateExternal` checks only the references the update brings in**, as `updateFeature` does (`kept` in `document.ts`): the validator gets a context whose `requireRef` passes a reference the entry has already (`refs` of the old entry, by `refKey`). Without it the flag of a projection whose source entity is gone could not be switched, nor its frozen geometry kept: the command would fail on the entity it already names. (Today the edge's `updateExternal` checks every reference again; for the edge this changes nothing a user meets, since an update of an edge projection always names a new edge.)
- **`addExternal`, `updateExternal`, `removeExternal`** as they are otherwise. `updateExternal` may change the source (`sketch`, `entity`) and the flag; it may not change `kind` (6a's rule of an entity that stays), and an edge projection may become a sketch projection of the same kind or back (6a: "a projection repaired from an edge to another source"). It keeps the stored value when the kind says the update keeps the source (`keepsValue(before, after)`: the same `sketch`, `entity` and `kind`), so switching the flag of a frozen projection keeps its geometry; otherwise it drops it, as today.
- **The text for an unknown type** lists the kinds (6c made it; 6b adds `sketch`).

### The sketch tool `projectSketch`

An entry of `SKETCH_TOOLS` with a new input kind `sketch` (the ID of a sketch of the document):

```ts
projectSketch: { sketch: Id; as?: 'reference' | 'regions' }
```

- It answers a batch of `addExternal`, one per curve of the source that is not a construction curve (own curves, then the curves of its entries in the order of `external` and of their kinds; the axes never) and one per lone point (an own point no own curve uses, and a point entry of the source), with fresh IDs (`newId('x')`), `kind` from the source, and `regions: true` for the curves when `as` is `regions`.
- `ids`: `entries` (the new entries), `sources` (the entity each projects, in the same order).
- Refused: a sketch the document does not have, this sketch, a sketch after this one on the timeline ("board is after this sketch; only an earlier sketch is projected"), a source with nothing to project; an entity projected already is skipped and named in the message of the result (`skipped`), not refused, so the tool can be run again after the source grew.
- The tool does not know the planes (no recompute); a tilted source gives the warning on every entry.

### The step, in order

1. `resolveReferences`: every entry in the order of its ID, its value fresh, else the stored one, else none, with the detail of a failure; then, when a constraint names an axis, `origin` with the axes' geometry.
2. `solverSetup` and the solver, as today.
3. The state's `geometry`: the solved positions and the axes' far points; `curves`: `sketchCurves` with the axes; `joins`: `joinPairs` with the keys (then 6c's derived stage and its joins).
4. The profile, the result (`points` without hidden points, `curves` of the entries, the axes not among them), the warnings with their details.

## The document and the schema

- **What the document gains**: an entry `{ type: 'sketch', … }` in `external`, its value in `solved.external`, and constraints and `AxisRef`s that name `origin/x` or `origin/y`. Nothing else changes shape; region references and face names hold entry IDs, which every build accepts as strings.
- **No upgrade step, no new version** (confirming 6a, "No upgrade step for 6b, 6c and 6f"). A build without the kind refuses the entry (`externalRef`, with the text that lists the kinds it knows, which 6c writes), so a document with a projection is an invalid document there, not a model with the projection dropped. A constraint on an axis is refused there too (`constraint`: "entita "origin/x" ve skice není"). An `AxisRef` on `origin/x` (a revolve, a pattern, a joint) is not checked on `load` (`requireRef` checks commands only), so an older build loads it and the feature is `brokenReference` at recompute: an error, not a silent change. `SCHEMA_PENDING` does not change.
- **Stamps of stored sketches**: unchanged, since the axes enter the input only when named and no stored sketch names them.

## Where the code lives

| File | What changes |
|---|---|
| `packages/engine/src/types.ts` | `SketchProjection` (with the comment the AI reads), a member of `ExternalRef`; `ProjectedEntity`; `SolveStamp.external: Record<Id, Projected \| ProjectedEntity>`; the comment of `SketchResult.curves` and `points` (the axes are not in them); the comment of `ExternalRef` on the axes |
| `packages/engine/src/references/sketch.ts` (new) | the kind: `validate`, `refs`, `faces` (none), `reads`, `entities`, `compute` (the map, the flip, the exact arc, the details), `value`, `geometry` (with `keys`), `keepsValue`; `projectedEntity` (the reader of a stored value's form) |
| `packages/engine/src/references/axes.ts` (new) | `axesGeometry()` |
| `packages/engine/src/references/spec.ts` | `ReferenceValues.sketch`; `compute` may return `{ code, detail }`; the optional members `reads` and `keepsValue` |
| `packages/engine/src/references/index.ts` | the line of the registry; `storedValue` reads both forms; `entityOf` answers the axes; `resolveReferences` keeps details and fills the slot `origin`; the text of an unknown type lists `sketch` |
| `packages/engine/src/references/edge.ts` | `value` refuses a value with `vertices` |
| `packages/engine/src/sketch.ts` | `joinPairs` reads the keys; `sketchCurves` adds the axes; the type of `used` in `solverSetup` |
| `packages/engine/src/features/sketch.ts` | the step: the details in the warnings, the far points in the state's geometry, no hidden point in the result; `ruleProblem`'s points of an entry curve and of an axis |
| `packages/engine/src/catalog.ts` | `check` of `midpoint` and `equalLength`: no axis |
| `packages/engine/src/util.ts` | `ORIGIN_AXES`, `isOriginAxis`, `AXIS_REACH` |
| `packages/engine/src/recompute/services.ts` | the texts of `brokenProjection`, `unsupportedProjection`, `degenerateProjection` in English and general |
| `packages/engine/src/document.ts` | `updateExternal` checks only the references the update brings in, and keeps the stored value when `keepsValue` says so |
| `packages/engine/src/sketch-tools.ts` | `shapeOf` of an axis; the tool `projectSketch` and the input kind `sketch`; the fillet's `shortened` reads `reads` |
| `packages/engine/src/index.ts` | exports `ORIGIN_AXES`, `isOriginAxis`, `AXIS_REACH`, `sketchMap` (the map between two frames the projection uses, for the app's picker) |
| `packages/mcp/src/api.ts` | the paragraph on projected geometry (today Czech, edges only) rewritten; `describe` of the input kind `sketch`; the example of `projectSketch` |
| `packages/app/src/sketch-tools/project-sketch.ts` (new), `index.ts` | the tool *From sketch* and its line |
| `packages/app/src/references/sketch.ts` (new), `index.ts`, `spec.ts` | the row of the kind; `ReferenceUi` gains `flag` (a checkbox in the row) and the host of `detail` a `featureName` |
| `packages/app/src/sketch-view.ts` | the axes as two curves of the view (not own), drawn across the view and picked as lines |
| `packages/app/src/sketch-commands.ts`, `axis-picker.ts` | `lineIds` lists `origin/x`, `origin/y` after the lines of a sketch |
| `packages/app/src/panels/sketch.ts` | the flag's checkbox in the row of an entry that has one |
| docs | `architecture/sketch.md` ("Promítnutá geometrie": the kind, the axes, the keys); `ui/` the sketch panel and the tool; `decisions.md` D69; `requirements.md` scenario 15; `backlog.md` the row "Promítnutí geometrie z jiné skici" closed with what is deferred |

`references/sketch.ts` imports `solid.ts` (`toWorld`, `toPlane`), `recompute/services.ts` (`lookup`), `sketch-content.ts` and `validation.ts`, as `edge.ts` does; it reads `State.sketches`, which `recompute/state.ts` declares. No new layer (`docs/architecture/repository.md` unchanged; `modules.test.ts` finds the file).

## The app

- **The tool *From sketch*** (`projectSketch` in `SKETCH_TOOL_UI`, after *Project*): a tool with its own picker (6a's `picks: { pick }`, a place with a foreign snap). While it is active its `draw` gives the curves and points of every candidate sketch mapped into the open sketch (`sketchMap`), dashed: the sketches before the open one on the timeline that are evaluated and whose planes are parallel to it, hidden ones included, own and non-own entities alike (the scene shows other sketches' own curves only). The picker takes the place under the pointer in the open sketch's plane (`host.planePoint`) and the nearest entity of a candidate within the reach of a pick, points before curves, the latest sketch first where several lie on each other (the skeleton before the board it projects). Its options (6a's `options`, the panel while active): *Forms regions* (a checkbox), *Whole sketch* (a checkbox), *From* (any, or one sketch). A click sends `addExternal` with `kind` from the source's entity (`referenceEntities`/the source's own content) and `regions` from the option; with *Whole sketch*, the engine's tool `projectSketch` with that sketch; with an entry being repaired (`m.repair`) or one sketch projection selected, `updateExternal` keeping the ID (refused by the engine when the kind differs, with its text).
- **The row of an entry** (`REFERENCE_UI.sketch`): title by kind ("Point", "Line", "Circle", "Arc"), detail "board: c1", tag "projected", repair by *From sketch*, and a checkbox *regions* for a curve (`flag`), which sends `updateExternal` with the flag switched. The warning of an entry shows as the rows of projections show theirs.
- **The axes** are drawn in the open sketch as two thin lines through the origin across the view (`AXIS_REACH`), in the style of reference geometry, and can be hovered, selected and snapped to as lines: a point and `origin/x` selected offer *Point on curve*, two points and `origin/y` *Symmetric*. Deleting an axis by the selection does nothing. The pickers of an axis (`lineIds`) list `origin/x` and `origin/y` after the lines of the sketch.
- **What the snapshots of the app see**: the two axis lines in every scene with an open sketch; and, where a test picks `sketchLine` in a model whose sketches have no line, the axis picker now starts at `origin/x` of the latest sketch (it changed nothing before). The commit that changes them says so.

## MCP

- `describe_api` shows `SketchProjection`, `ProjectedEntity` and the comments on the axes from `types.ts` with no change in `packages/mcp`.
- **The paragraph on projected geometry** of `api.ts` (today "Promítnutá hrana (addExternal) je ve skice pevná křivka …") is rewritten in English: an entry of `external` projects an edge of a body (`type: 'edge'`) or a point, line, circle or arc of an earlier sketch on a parallel plane (`type: 'sketch'`, with `kind`, and `regions: true` when the curve should bound regions); its derived IDs; it follows its source and freezes when the source is gone; every sketch has the lines `origin/x` and `origin/y`; constrain to fixed geometry with at least one own operand; hold an own arc on a projected one by its two ends (`coincident`) and `equalRadius`, not by its centre as well (a conflict); projections of one sketch join at their common points, projections of two sources only through an own point; the tool `projectSketch` projects a whole sketch.
- **The AI's ways**: one entity, `addExternal { sketch: 'base', id: 'x1', ref: { type: 'sketch', sketch: 'board', entity: 'c1', kind: 'line' } }`; a whole sketch, `sketch_tool { sketch: 'base', tool: 'projectSketch', input: { sketch: 'frame', as: 'regions' } }`; the IDs of the source from `get_sketch` of it (`points`, `curves`, `external[].entities`). `get_sketch` lists a projection's entry with its fields, `entities`, the positions of its points and, for a circle, its radius (6a's generic answer, no change).
- **`sketch_tool`'s catalog** describes the input kind `sketch` as "the ID of an earlier sketch of the document".

## Issue codes

None new. `brokenProjection`, `unsupportedProjection` and `degenerateProjection` get general English texts ("The projected geometry is no longer in its source; it keeps its last valid place.", "The geometry cannot be projected into this sketch.", "The edge is perpendicular to the sketch plane and projects to a point.") and the detail of the kind in brackets, as `issue(code, refs, detail)` composes it. The edge passes no detail, so its message is the general text.

## The Onshape converter

What 6b makes possible in `tools/onshape/` (not part of this package; the converter is the owner's tool):

- **Constraints on external geometry** (`externalFirst`, `externalSecond`, `externalMirror`, all skipped today): an Onshape origin point → `origin` (the engine accepts it already; the plan's finding); a default plane seen edge-on in a sketch on a base plane → `origin/x` or `origin/y` by the sketch's matrix (on a sketch on Front, Top is the X axis), with the sign of the frame; an entity of another sketch of the studio → an entry `{ type: 'sketch' }` from that sketch (earlier on the timeline, as Onshape requires), the constraint on the entry; an edge of a body → an entry `{ type: 'edge' }` (D23, also not used by the converter). The converter's merging of points at one position must leave projected points alone (a curve cannot run over a fixed point): it ties an own point to them by `coincident`.
- **Derived sketches** (`importDerived`) stay copies: they come from another part studio, which is another document, and a sketch of another document cannot be projected (D62 brings bodies). What 6b changes is that the constraints of the studio on the copied sketch's entities are kept, as projections from the copy.
- **The count of the 287** by operand needs the dump (not in the tree); the converter's report could count `external*` skips apart from the constraint types (one line in `constraints` of `tools/onshape/sketch.ts`).

## Where 6b meets 6c, 6e, 6d and 6f

- **6c** (implemented before 6b): `origin/x`, `origin/y` become lines of every sketch's list, so a mirror about the Y axis is `axis: 'origin/y'` with no change in 6c (its `commandProblem` accepts any line entity that is not a copy); calls.ts of 6c replaces its construction line `ay` then. A projection of a copy reads the copy from the source's `curves` and its vertex from the source's `joins` (6c's derived joins included). 6c's in-memory `SolvedOwn` of the tools takes the reference curves from `result.curves` (6c's contract): the axes are not there, so it adds them from `axesGeometry()`, as `sketchCurves` does. 6c's join stage joins copy ends to the ends of projected curves with `regions` (its rule 3), which the keys made one vertex.
- **6e** (implemented before 6b): projected curves are not cut; a cut of an own curve where `with` names a projection or an axis (`shapeOf` gives the axis as a long line); its tools list sketches that `reads` a changed curve in `shortened`. The scenario's floor is an own outline held on the projection (below), so 6e trims the notch into it.
- **6d** (splines): a projected spline is refused with the way round until a package projects control points; if 6d merges after 6b it adds the refusal to `validate` (`kind: 'spline'`) and to the tool `projectSketch` (a spline of the source skipped and named).
- **6f** (an imported outline): reference geometry that forms regions always, many entities per entry. It reuses what 6b adds: the fixed arc made exact (an outline's arcs come from a file), the keys or IDs shared within an entry, the detail of a failure, `reads` (none), `keepsValue`. An outline's entities are projected by 6b like any entry's entities (`o1/l3`).

## Scenario 15: steps 2 and 3, and 6e's own outline

The plan's step 3 extrudes the base from the board outline projected with the flag; 6e's design (its "Open", question 1) needs the outline the notch is trimmed into to be own curves, since projected curves are not cut. Both hold with the base in three features, which is also how a tray is modelled:

1. **The floor** (`baseSk` on a plane `standoffH + baseT` below the board): the outline projected from `frame` **without** the flag, an own outline held on it (ends coincident, arcs by `equalRadius`; measured 0 degrees of freedom), extruded `baseT` with the offset `clearance + wall`. 6e's notch (step 6) is trimmed into this own outline.
2. **The rim** (`rimSk` on the frame's plane): the outline projected from `frame` **with** the flag, one region of eight entries joined by keys; added `rimH` with the offset `clearance + wall` and pocketed with the offset `clearance` (2a's offset on reference curves).
3. **The standoffs** (`standSk` on the frame's plane): the four hole circles projected from `frame` with the flag and four own circles of `standoffD` centred on the projected centres (coincident); the rings are added `standoffH`, their bores named by the projections (`standoffs/side/sh0`).

The skeleton (step 2) projects the outline and the hole circles (whose centres are the hole centres, `fh0/center`) from `board` and measures the hole pair symmetric about `origin/y` by two reference dimensions. **"Puts the centre lines on the axes"** cannot happen in the skeleton: its projections are fixed, so the frame cannot move the board. It happens in the board: 6f places the import by a point and a turn of its sketch; calls.ts, written before 6f, draws a stand-in board whose corners and holes are placed by `symmetric` constraints about `origin/x` and `origin/y` (measured: fully determined).

## Rejected alternatives

1. **The kind of the entity read from the source, not stored.** `entities` would need the document of the source, so `entityOf` (the validation of every constraint) would read another feature, and `load` would depend on the order of validation. The edge stores its `kind` for the same reason.
2. **One entry for a whole sketch** (the plan's deferral). The entities would be `<id>/<source entity>`, the regions and faces named by slashed IDs, a source that grows would add entities nobody asked for, and the flag would be one for all. Per entity, with a tool that makes the batch, each has its flag and its repair.
3. **Projection into a tilted plane** as a line, a polyline or a sampled curve: an ellipse is a curve kind (backlog), and a line or polyline would be wrong geometry with a name.
4. **The projected arc copied as it is.** Measured: a point on it fails the sketch when its ends are 1e-9 mm off one radius; the source's solve allows 1e-6 relative.
5. **Joins of projections by position** (any two projected points at one place are one). It would weld points of different sources and own points never meant to meet; the key says "one point of the source", which is the intent of a projected outline (6a's rule: points are not joined by position alone).
6. **Keys through a chain** (a projection of a projection carries the key of the original vertex). Needs the source's keys in its `SketchState`; the case (one board point reached by two routes) has the workaround of an own point with two coincidents. Deferred.
7. **The axes in `SketchResult`** (6a's vocabulary). The camera of the app fits `result.points`; every result of every model would change; the readers that need the axes know them as constants.
8. **The axes in the solver's input always.** Every stamp would change and every stored sketch be solved again on load (6a's alternative 10).
9. **A long hidden segment for the axes** (far points at ±10⁶ mm in the solver). Measured: the far point's distance changes nothing in the solver; the length matters only to a reader that clamps to the segment, which is the tools' `shapeOf`, where it is said once.
10. **A projection of another sketch's axes**: a fixed line of 1 mm with a hidden end; a midpoint or an equal length on it would be nonsense. Its `origin` is a point and projects.
11. **A whole sketch only as a batch the caller writes** (the plan). The rule which entities belong to "the whole sketch" would live in the app; as a sketch tool it is one rule for the app, MCP and the converter (Open, question 2).
12. **A new warning code per failure** (`sourceGone`, `notParallel`). The existing codes say it; the detail names the case. New codes would also reach the app's texts and the AI's description.
13. **A flag per projection to keep it frozen** (not follow the source). Not asked for; the copy is an own outline drawn over it, held or not.

## Known limits

- **Keys of different sources never meet**, also when one source projected the other (the base projecting from `frame` and from `board` gets two vertices for one board corner); an own point with two coincidents joins them.
- **A projection follows the ID, not the shape**: after 6e splits a source curve, only the piece that kept the ID is projected; a fillet in the source shortens the projected lines and the arc is not projected. Both list the sketch in `shortened`.
- **A source circle trimmed into an arc** breaks its projection; the repair is a new entry and the constraints on it again.
- **Parallel planes only**; the projection of a circle into a plane tilted within 1e-4 rad is a circle (the ellipse differs by under 5e-9 of its radius).
- **The axes are not drawn outside the sketch mode** and not listed by `get_sketch`.
- **The app's picker** maps every candidate sketch at every move of the pointer while the tool is active; a model with hundreds of sketches before the open one would make it slow (none of the scenarios has more than a dozen).
- **Sketches of an inserted document** (D62) cannot be projected.

## To verify before the implementation

- That 6c's implementation reads the axes from the list of curves and `geometry` as its design says, and that its in-memory `SolvedOwn` takes `axesGeometry()`; that 6e's `shortened` is the list the fillet's is, so `reads` reaches both.
- That the stamp of every stored sketch stays: load the documents of the tests and `packages/scenarios`, compare `solved.inputs` before and after (the axes must not enter an input no constraint names).
- That `measure` of a reference dimension to an axis has the axis in its curves (the input has it when a constraint names it; a reference dimension is a constraint).
- That the adapter's `fixed` check takes a projected arc (its points are fixed, the arc itself is not in `fixed`, as spike a fed it).
- The app's snapshots: which change (the axes in the scene of an open sketch; the axis picker of a model without lines) and nothing else.
- That the projected arc made exact gives the face of a side the same radius from its start as the profile reads (`placedCurve` takes the radius from the start).

## Tests the implementation owes

- **Engine, the kind**: the form (each field, `regions` on a point, an unknown field, a spline after 6d); the references (a later sketch, itself, a missing entity, a kind that differs, an axis of the source, a hidden point, a duplicate, the entry itself on update); `entities` of each kind; the value read by its form (an edge's value with `vertices` refused, a sketch value without them refused); `keepsValue` (the flag switched on a frozen projection keeps its geometry, its gone entity not checked again; another entity drops it); an edge projection repaired into a sketch projection of the same kind and back; the text of an unknown type.
- **Engine, the compute**: each kind, a flipped normal (the arc's ends swapped, counter-clockwise), an offset and a turn in the plane, the arc made exact (an end off by 1e-7 in the source), a tilted plane with its detail, a missing sketch, entity and kind change with their details, a copy of 6c and a projection of a projection as sources, `vertices` through a coincident of the source.
- **Engine, joins and profile**: a projected rounded rectangle closes by keys into one region named by the entries; without the flag no region; a mixed loop of own and projected curves through a coincident; two sources do not join; an own curve over a flagged projection makes the profile invalid; the side faces of projected curves.
- **Engine, the axes**: `entityOf`; a constraint on each (point on, symmetric about, tangent, parallel, perpendicular, angle, distance point–line), the refusals (`midpoint`, `equalLength`, a constraint between an axis and `origin` or two fixed operands); the stamp unchanged without a constraint on an axis, changed with one; the result without far points; a revolve and a pattern about `sketchLine` `origin/x`; a mirror of 6c about `origin/y`.
- **Engine, the tool**: `projectSketch` (the curves not construction, the lone points, the skipped ones, the order, `as: 'regions'`, the refusals); `shapeOf` of an axis in a snap.
- **Engine, the recompute**: the chain board → frame → base follows a parameter (the stamps change, the bodies follow); a lost source freezes with the constraints acting; `shortened` of the fillet lists a sketch that projects a shortened line.
- **Scenario 15**: steps 2 and 3 and 6b's part of step 7, from calls.ts (`packages/scenarios`).
- **MCP**: `describe_api` contains `SketchProjection` and the axes; `sketch_tool` describes the input kind `sketch`; an `addExternal` of the kind through `execute` and `get_sketch` of the entry.
- **App**: the tool *From sketch* (a pick of a point and a curve of another sketch, the latest first, the option of regions, the whole sketch, a repair), the row (title, detail, the flag), the axes in the view (hover, a constraint with a point), the snapshots as said above.

## Open

For the owner:

1. **Scenario 15, step 3**: the floor of the base drawn as an own outline held on the projected board outline (so that 6e trims the notch into it), with the region flag tested by the rim (the outline projected with the flag, added and pocketed with offsets) and by the standoffs (projected hole circles inside own circles); the plan had the whole base from the flagged outline. *Recommendation: yes; it answers 6e's open question 1 the way 6e recommended and keeps 6b's flag in the scenario.*
2. **A sketch tool `projectSketch`** that projects a whole sketch in one call, for the app's button, MCP and the converter alike; the plan had a batch of `addExternal` written by the caller. *Recommendation: the tool; the rule of what "the whole sketch" is then lives in the engine once.*

## Reviews

The design, the contract and the calls were written on Opus 5.5 (Fable limited until 2026-11-23).

## Rows for the indexes

**docs/d36/README.md**, the row of 6b, column "Design now":

> full ([6b-sketch-projection/design.md](6b-sketch-projection/design.md), D69): a reference kind of entry of `external`, `sketch` (`{ sketch, entity, kind, regions? }`), projecting one point, line, circle or arc of an earlier sketch (own, projected or derived entities) into a sketch on a parallel plane, following its source on recompute and frozen with `brokenProjection` when the source is gone or changes kind, `unsupportedProjection` with the angle for a tilted plane; projected arcs made exact (measured: a point on a fixed arc fails the solve from 1e-9 mm off one radius); projected points keyed by the vertex of their source point, so projections of one sketch close into loops; with `regions: true` a projected curve forms regions and names its side face; the axes of the origin `origin/x`, `origin/y` as lines of every sketch, in the solver only when a constraint names one, not in the result; the sketch tool `projectSketch` for a whole sketch; general texts of the projection warnings with a detail; no command, no issue code, no schema step. Open for the owner: the floor of scenario 15 as an own outline held on the projection (6e's question), the tool `projectSketch`

**docs/decisions.md**, the row of D69:

> | D69 | [6b Projection from another sketch, and the axes of the origin](d36/6b-sketch-projection/design.md) | designed 2026-11-17 | A projection from another sketch is a reference kind of entry of `external`, `sketch`, one entity per entry with its `kind` stored, from an earlier sketch on a parallel plane; it follows the source and freezes when the source is gone; projected arcs are made exact; projected points join by the vertex of their source point (join keys); a flag `regions` lets a projected curve form regions; the axes `origin/x`, `origin/y` are lines of every sketch, in the solver only when named and not in the result; a sketch tool projects a whole sketch; no schema step |

**docs/requirements.md**, validation scenario 15, a sub-item before the one of 6e:

> - *Skeleton and base (6b, D69).* A stand-in board (until 6f) drawn with its corners and holes placed symmetric about the axes of the origin (`symmetric` about `origin/x` and `origin/y`; fully determined). The skeleton `frame` on a parallel plane projects the board's outline and hole circles and measures both holes of a pair 26.5 mm from `origin/y`. The floor of the base is an own outline held on the projected outline (ends coincident, arcs by `equalRadius`; fully determined, no redundancy), extruded with the offset `clearance + wall`; the rim projects the outline with the region flag (one region of eight entries joined at their common points) and is added and pocketed with offsets; four standoffs are rings of own circles around the projected hole circles, their bores named by the projections. The base by `mass` within the chord tolerance of the volume by hand (7836.9 mm³; measured 7835.0). `boardW` from 60 to 62: every feature follows (+212.0 mm³). Also: a source on the other side (an arc swapped), a tilted plane (`unsupportedProjection`), a removed hole (`brokenProjection`, frozen), the whole sketch by `projectSketch`, a projection repaired. Refused: a later sketch, itself, another kind, an axis of another sketch, a duplicate, `regions` on a point, `midpoint` on an axis.
