# 6b Projection from another sketch (D69)

**State: designed 2026-11-17 on Opus 5.5 with no review; reviewed independently on Fable on 2026-11-24 (one review; `codex` and `agy` have not read it); answered by the owner the same day; revised 2026-11-24 ("Reviews"). Not implemented.** The revision is written against `master` at `9c43be9` (schema version 10; 6a, D64, implemented with its fix). The sequence of the step is 6a, 6a2, 6e, 6c, 6b, 6d, 6f, 6h ([6-plan.md](../6-plan.md)): 6b is implemented after the axes of the origin (6a2, D71), after 6e (D65) and after 6c (D68). The designs of 6e and 6c are being revised on the branches `d36/6e-design-r` (read at `3bb8bf7`) and `d36/6c-design-r` (read at `6b68cf1`); this text is written against those and lists what it needs of them ("What 6b needs from 6a2, 6e and 6c"). The axes of the origin, which the first design held, are a point and a text of their own since the owner's answer 1: [6a2-origin-axes/design.md](../6a2-origin-axes/design.md).

Files: [contract.ts](contract.ts) (the entry, the stored value, the kind, the joins and the lists it asks of 6c and 6e, the sketch tool, the query, the app), [calls.ts](calls.ts) (validation scenario 15: steps 2 and 3, the seam with 6c of step 5, the part of step 7 that is 6b's, and the rest of the mechanism).

The package in short:

1. **A reference kind of entry of `external`, `sketch`**: `{ type: 'sketch', sketch, entity, kind, regions }` projects one point, line, circle or arc of an earlier sketch (its own entities, `origin`, and the entities of its entries: projected edges, projections, copies of 6c) into a sketch on a parallel plane, either normal, any offset. The entry is the projected entity itself (`<id>`), its points are `<id>/a`, `<id>/b`, `<id>/center`, `<id>/start`, `<id>/end` as for an own curve of that kind.
2. **Its values follow the source on every recompute**; a source that is gone, or whose entity is no longer of that kind, freezes the projection at its last values with the warning `brokenProjection`, as a lost edge does; a plane that is not parallel is `unsupportedProjection` with the angle in the message. A projected arc is made exact.
3. **With `regions: true` a projected curve forms regions**, and the side face it makes is named by the entry's ID. **The ends of such curves join by position** (owner, answer 19), in the one stage 6c writes for its copies: with each other, whatever their sources, and with an own end at their place. Nothing but positions is stored.
4. **A sketch tool `projectSketch`** projects a whole sketch or a list of its entities in one batch. Each curve keeps the role it has in the source, or all are reference only, or all form regions; **or an own outline is drawn over the projections and held on them** (owner, answer 21), which is what the sketch tools of 6e can cut. The tool reads the planes, so it refuses a tilted source.
5. **A query `sketchSources`** says what a sketch can project: the earlier sketches with whether their planes are parallel, and the entities of one of them where a projection would put them. The app's picker is its view.
6. **No command, no feature type, no face role, no issue code, no schema step.** The texts of the three projection warnings become English and general, with a detail.

## What the plan says, checked against the code

| Statement of the plan | What the code (and 6a, 6a2, 6e, 6c) says |
|---|---|
| "A new kind of reference, `{ type: 'sketch', sketch, entity }`" | 6a's registry (`REFERENCE_KINDS`, `packages/engine/src/references/`) takes it as one module and one line; after 6c the registry is typed in two halves and the kind is one of the reference half. **It needs a `kind` too**: `entities` of a kind is computed from the sketch alone (6a: so that commands and `load` validate without a recompute), and the kind of an entity of another sketch is not in this sketch. The edge stores `kind` for the same reason (`architecture/sketch.md`, "Promítnutá geometrie") |
| "Its own, projected or derived entities" | `entityOf(source, entity)` answers an own point or curve, `origin`, and every entity of the source's entries (`references/index.ts`); 6c adds the copies (`entity` of its kind) and 6a2 the two axes. The recompute reads the source's `SketchState`: `curves` (own, reference, the axes, and from 6c derived) and `geometry` (every used position), which 6a made the list every reader shares. Anything under `origin/` is refused (below) |
| "Parallel planes (either normal, any offset)" | Measured: a source on XY and a sketch on the bottom face of a body (normal −Z, its x along −X) map exactly; an arc has to swap its ends there to stay counter-clockwise |
| "A tilted plane is `unsupportedProjection`, as for a circular edge" | The code for an edge (`projectEdge`, `solid.ts`) uses `ANGLE_TOLERANCE` (1e-4 rad) for "parallel"; the same here. The text of the code speaks of an edge ("Hranu nejde promítnout jako zvolený druh křivky.", `recompute/services.ts`) and the step adds no detail, so the warning needs a detail to say why |
| "A failure freezes them as for an edge (`brokenProjection`)" | `resolveReferences` already falls back to the stored value through the kind's `value` (6a); measured: a removed hole circle of the board leaves the frame's projection in place with `brokenProjection` |
| "Projected curves do not form regions unless question 4 decides otherwise" | The owner decided: a flag on the reference (6a, "Which geometry forms regions"). `EntryGeometry.regions` carries it; the profile reads `SketchCurve.regions` and nothing else (6a part 2) |
| The plan as amended on 2026-11-24 after answer 12: "Projections keep their join keys; joining by position is for copies only" | **Replaced by the owner's answer 19** (the plan is amended again with this revision): projections that form regions join by position, in one stage with the copies; the keys are dropped. Measured by the review: keys left three ordinary cases with an invalid profile (two routes to one corner, a source made of projected edges, a projected construction copy), and a profile computed in memory did not see them at all |
| "Projecting a whole sketch is a batch (a button in the app, a batch of `addExternal` through MCP)" | A batch works, but which entities "the whole sketch" is, and which of them form regions, is a rule, and a rule the app follows belongs to the engine and to MCP alike: a sketch tool (owner, answer 21) |
| "The solver adapter is touched by 6d alone" | True. **A projected arc is new to the adapter** (no reference was an arc before), and the adapter does not change: measured, a fixed arc works when its ends lie on one radius within about 1e-10 mm, so the projection makes the arc exact |
| "The converter skips every constraint with an external operand" | True (`tools/onshape/sketch.ts`). What the converter does with projections is 6h's (owner, answer 4): "The Onshape converter" below |

Not in the plan, found in the code:

- **`updateExternal` drops the stored value of the entry** ("Zmrazené hodnoty patřily původní hraně", `document.ts`). Switching the region flag of a projection whose source is gone would lose its frozen geometry; the kind says when an update keeps the source (`keepsValue`).
- **`updateExternal` checks every reference of the new entry again**, so the flag of a projection whose source entity is gone could not be switched at all.
- **The scene draws only the own curves of other sketches** (`scene.ts`, `if (curve.own)`), so a sketch made only of projections (the skeleton `frame`, the rim's sketch) is invisible outside its own sketch mode, though it may have a region to extrude.
- **A sketch tool does not know the plane of any sketch**: its context is the sketch, its result and the document. A tool that reads another sketch needs the result and the plane of that sketch, and the plane of its own: the context of `sketchTool` gets the results of the features.
- **An own arc held on a fixed arc by its two ends and `equalRadius` has two solutions and, at a half turn, none the analysis accepts** (measured below). The first design gave that hold to the AI as the recipe.
- **The points of an entry for the own rule of a constraint** (`ruleProblem`) were the edge's when the first design was written; since the fix of 6a they are read from the registry, so a projection needs nothing there.

## The cheap variant

What the plan asks, with these choices:

- One entity per entry; the whole sketch is a batch the tool `projectSketch` makes.
- Parallel planes only; the projection is along the normal of the target.
- The value is the projected positions; stored and stamped as an edge's value is.
- Joins by position, for the ends of projected curves that form regions, in 6c's stage.
- A source curve whose kind changed (a circle trimmed into an arc by 6e) breaks the projection (frozen); the repair is a new entry.

**Deferred**: the projection into a tilted plane (an ellipse, as for an edge); a projected spline (owner, answer 22: refused; 6d writes the refusals); a reference to a whole sketch as one entry (the plan's deferral); patching the projections of a curve the fillet or 6e's tools change (they are listed, not patched); an existing projection taken over as own curves (the tool makes projections and own curves together; a backlog row with 6e's); projecting from a sketch of an inserted document (D62 brings bodies, not sketches).

## Measured

**Recipe.** Three generations of probes, all run from the worktree with `npx vitest run --config <dir>/vitest.config.ts` against the real engine, the real planegcs adapter and the real manifold kernel, with the kind registered in `REFERENCE_KINDS` at run time and the axes of 6a2 put in by `vi.mock`:

- **The designers' spikes** (2026-11-17): `a-solver.spike.ts` feeds the adapter and the engine's `SketchAnalysis` the inputs `solverSetup` would make; `c-scenario.spike.ts` runs steps 2 and 3. Kept by the review in `step6-review/6b-design/designers/` of the session's scratchpad; both reproduce. The file of their rows "b" is lost; the review measured those cases again.
- **The review's probes** (2026-11-24): `step6-review/6b-design/` (`e*.probe.ts`, `s*.probe.ts` and their logs).
- **The probes of this revision** (2026-11-24): `step6-review/6b-revision/`. `proto.ts` is the kind without keys and a prototype of 6c's position stage over "not own and forms regions", put into the step by mocks of `joinPairs` and `joinsOf`; `r.probe.ts` (log `r.log`, rows R2 to R6) has a prototype of the tool `projectSketch`; `h.probe.ts` (log `h.log`, rows H1 to H3) feeds the adapter directly.

Not run: the commands' validation of the kind (the prototype validates nothing), 6c's stage as 6c will write it, 6e's tools over a sketch with projections, the query, the app, MCP.

| What | Result |
|---|---|
| A fixed arc (three fixed points, after a turn of the frame and back: radii 8 and 7.999999999999998); an own line tangent to it; an own point on it (designers, a1) | solved, no redundancy |
| A fixed arc whose end lies off the radius of its start by δ, with an own point on it (a2; the review's S2 with a tangent line and a hold as well) | solved for δ ≤ 1e-10 mm; **`failed` for δ ≥ 1e-9** |
| The error `\|rs − re\|` of solved source arcs, sizes 60 to 20000 mm and after a drag (review, E1) | 0 to 1.0e-11 mm |
| An own arc held on a fixed one by all three points (a1, a4) | **`conflict`** (the rule of the arc is one equation too many) |
| The outline projected onto the bottom face of the board (normal −Z) with the flag, extruded, also with the offset 1 (review, E3) | one region, the arcs counter-clockwise; 2392.16 and 2590.12 against 2392.27 and 2590.27 by hand |
| A mixed loop (an own chain closed on a flagged line); an own circle inside a flagged outline; an own circle across it (review, E5) | one region; a hole of the outline's region; invalid |
| A source in `sketchConflict` (review, E6) | the projection reads the positions the source keeps; no warning in the projecting sketch |
| **R2.** Scenario 15, steps 2 and 3, on the board of 6a2, the kind without keys and the position stage: `frame` (twelve projections, two reference dimensions) | valid, no region; both holes measure 26.5 from `origin/y` |
| R2. The rim's sketch: eight entries with the flag | one region of the eight entries; the stored value of `ra0` is `{ kind: 'arc', center, start, end }` |
| R2. The same profile built from the sketch and its result alone, as a tool in memory has them: with the position stage / with the joins of the `coincident` constraints alone | the same one region / **`valid: false`, no region** (the review's finding 1) |
| R2. The step without the stage | `rimSk` invalid, `rim` in error `invalidProfile` |
| R2. The standoff sketch | four discs and four rings (own circle with the projected hole as its hole), the same in memory |
| R2. The base (floor with the offset 2.5, rim added and pocketed, four rings) | 7835.04 mm³ against 7836.90 by hand; `boardW` 60 → 62: all ten features `ok`, +212.00 (by hand +212.00), the frame measures 27.5 |
| **R3.** An own rectangle inside the flagged outline: the step and the profile in memory | both valid, two regions (the review's E2 gave "invalid" in memory) |
| R3. The outline from `frame` with one line straight from `board` (two routes to two corners; the review's E4 with keys: invalid) | valid, one region, no redundant constraint |
| R3. A source whose curves are four projected edges of a box, projected again with the flag (the review's E8 with keys: invalid) | valid, one region; extruded 2: 400.000 mm³ |
| R3. An own chain closed on a flagged line, its ends at the line's ends by `coincident` / by their own `fixed` constraints, with no `coincident` | one region `[n1, n2, x]` both ways |
| R3. Two own ends at one end of the flagged line that are two vertices | `valid: false` (the projection's end joins neither) |
| **H1.** An own arc held on a fixed arc by its ends and `equalRadius`, the fixed arc turned step by step, the solve started from the last solution | a half turn: 1 degree of freedom and 1 redundant constraint at once, then `conflict` at every turn. 178.4° and 170°: 0 degrees of freedom, but **the centre on the mirrored solution** after a turn of 44° (0.28 and 1.7 mm off); a 270° arc after a step of 90° (14 mm off). 128°, 90°, 60°: right at every step |
| H2. The same in jumps | a quarter arc: the mirrored solution after a jump of 180° (14 mm off) |
| H1, H2. The centre pinned to the projected one along one axis of the sketch (a distance of 0), in place of `equalRadius` | right at every sweep, the half turn too, until the chord has turned a quarter turn: then 1 degree of freedom, 2 redundant, and `conflict` after |
| H1, H2. **A construction line from the own centre to the own start, and the projected centre on it** (`pointOnCurve`), in place of `equalRadius` | 0 degrees of freedom, no redundancy, the centre on the projected one (under 1e-9 mm) at every sweep from 60° to 270°, at every turn and jump, and for sizes from ×0.01 to ×40. `failed`, never a wrong shape: a 270° arc after a jump of 90°, and a jump of the size by ×20000 |
| H3. The own centre started 1.5 radii away, past the chord | `equalRadius`: the mirrored solution with 0 degrees of freedom (90° and 60°: 14 and 17 mm off, at every later step). The line: right for 178.4°, `failed` for 90° and 60° |
| **R4.** The tool, a whole sketch with each curve in its role: `board` / `frame` / `baseSk` (an own outline over eight projections) | 12 entries, 12 with the flag, the outline with four holes and four discs / 12 entries, none / 16 entries, 8 with the flag, one region |
| R4. `baseSk` with every curve flagged | `valid: false` (the review's finding 7) |
| R4. The tool with `as: 'own'`, the outline of `frame` into a new sketch | 44 commands (8 entries, 12 points, 8 own curves, 4 construction lines, 12 constraints); 0 degrees of freedom, no redundancy in the solver's list or the diagnosis; one region of the own curves; extruded 2 with the offset 2.5: 5797.67 mm³ against 5798.07 by hand |
| R4. That outline with the board changed in one step: 62 × 40 R 3; 60 × 40 R 9; 120 × 80 R 3; 120 × 80 R 30; 60 × 40 R 0.5; 2000.77 × 1400.5 R 311.3; back | `ok` every time, 0 degrees of freedom, the volume by hand within the chord tolerance, the own centres within 1e-11 mm of the projected ones |
| R4. The whole board with `as: 'own'` (the holes as own circles: centre `coincident`, `equalRadius`) | 64 commands; 0 degrees of freedom, no redundancy; five regions |
| R4. The own outline on the bottom face of the board (normal −Z), extruded 2 with the offset 1 | 0 degrees of freedom, no redundancy; 5180.24 mm³ against 5180.53 by hand |
| R4. The tool on a plane tilted by 0.3 rad | refused, "the plane of frame is at 17.2° to this sketch" |
| R5. A slot of two half-turn arcs as the source, the tool's own outline over it, the source turned by a parameter (in the engine: the validator, the diagnosis) | the line: 0 degrees of freedom, no redundancy, at every turn. `equalRadius`: 2 degrees of freedom and 2 redundant at once, `sketchConflict` at the first turn |
| R6. The tool's batch with every own centre moved 4 mm outside its corner before it is sent | `equalRadius`: `ok`, 0 degrees of freedom, **the mirrored corners** (4.2 mm off) through every later change. The line: `sketchConflict` at first and after the first change, then right |
| An own outline with a half-round notch on its edge, extruded with the offset 2.5 (review, E11); a rectangular notch 8 and 6 wide (E12) | `invalidProfile` at radii 4, 3, 2.6, 2.5 and 1.5; `ok` with the exact volume (5 wide: refused). 6e's revision measured the bound: a round notch of radius `r` centred `y` inside the edge fits an offset `o` while `y + o ≤ r − o` |

What the numbers decide:

- **The projected arc is made exact** (a2, S2): its end is put on the circle of its start, `end = center + |start − center| · (end − center) / |end − center|`, in the coordinates of the target. Real source arcs are within 1e-11 mm (E1) and the solver's limit is between 1e-10 and 1e-9, so this is one order of margin that the turn and the shift of a projection would otherwise use up.
- **Joins by position close what keys did not**, need nothing stored, and are the same for the step and for a profile in memory (R2, R3).
- **An own arc is held on a projected one by its two ends and a radius line**, not by `equalRadius` (H1 to H3, R5, R6). The ends leave the centre one freedom, along the bisector of the chord. `equalRadius` takes it with a quadratic equation: two solutions, which ordinary changes cross (a turn of 44° of a 170° arc), and a double root at a half turn, which a slot has. The line from the own centre to the own start with the projected centre on it is a second straight line through the centre's place: one solution at every sweep. The owner's answer 21 asked for a hold without a second solution and named the start at the projected centre as the way; measured, the start is not enough, so the hold itself changes ("Open", 1).
- **The tool knows the planes**: it starts every own point at its place and refuses a tilted plane itself (R4).

## Decisions

### The entry `sketch`

```ts
interface SketchProjection {
  type: 'sketch';
  sketch: Id;       // an earlier sketch of the document
  entity: Id;       // a point or a curve of it
  kind: 'point' | 'line' | 'circle' | 'arc'; // the kind of `entity`
  regions: boolean; // the projected curve forms regions of this sketch
}
```

- **`kind` is stored and required**, as for an edge: the entities of the entry, and so `entityOf`, the constraints on it and `load`, follow from the document of this sketch alone. A command checks it against the source (`requireRef` of the kind `entity` with `accepts: [kind]`, which says "c1 is a circle, expected arc"). A caller who does not know the kind asks `get_sketch` of the source, the query `sketchSources`, or uses the tool.
- **`regions` is always in the document, as a boolean.** The input form of a command may leave it out; the validator of the kind then writes the kind's default, `false`. On a point `true` is refused ("a projected point forms no regions"). This is the convention for the flag of any entry, fixed now because 6f's outline has the same flag with the default `true` (owner, answer 2): with "stored only when it differs from the default", one field name would mean two things in `describe_api`, and a document would depend on a default that a later build may change.
- **The ID of the entry is the projected entity**; its points are `<id>/<name>` with `CURVE_POINTS[kind]` (`a`, `b`; `center`; `center`, `start`, `end`); a projected point is `<id>` itself (6a's vocabulary). An arc keeps its sense: its `start` is the projection of the source's `start`, except across a flip of the normal, where it is the projection of the source's `end` (below).
- **One entry per entity of the source**: a second entry with the same `sketch` and `entity` is refused, naming the first ("c1 of board is projected already as fl1"). A duplicate would only overlap itself, and with the flag make the profile invalid.

### Which sketches, which planes

- **Earlier on the timeline only**: `refs` gives `{ path: 'external/<id>', id: sketch, kind: 'sketch' }` and the entity reference `{ id: entity, kind: 'entity', sketch, accepts: [kind] }`, so a command checks the order and the entity (`requireRef`), `moveFeature` refuses to put the sketch before its source, and a reference to a removed sketch or entity is valid in a document, as every reference is (the step reports it). Itself is not earlier than itself: refused.
- **Parallel planes**: the normals parallel or opposite within `ANGLE_TOLERANCE` (1e-4 rad, as for an edge), any offset along the normal and any shift or turn in the plane. The plane of a sketch is known only at recompute (it may be a face), so this is not a command's check: a tilted plane gives the warning `unsupportedProjection` with the detail "the plane of board is at 17.2° to this sketch; only a parallel plane is projected", and the entry keeps its last values. The tool and the query, which read the evaluation, say it before anything is made.
- **The map** (`sketchMap`, one function for the kind, the tool and the query): a point `p` of the source goes to `toPlane(T, toWorld(S, p))`, its distance along the normal dropped (the functions of `solid.ts`). Lengths and radii are kept. When the normals are opposite the map reflects the plane: an arc runs clockwise, so its start and end swap (as 6c's mirrored arc does).

### What is projected, and its entities

| Source entity | `kind` | Entities of the entry `x` | Value |
|---|---|---|---|
| an own point, `origin`, a point of an entry of the source (`fl1/a`, `h/center`, a copy's point `m/1/p3`) | `point` | `x` (point) | `{ kind: 'point', at }` |
| a line: own (a construction line too), a projected edge, a projection, a copy | `line` | `x` (line), `x/a`, `x/b` | `{ kind: 'line', a, b }` |
| a circle, likewise | `circle` | `x` (circle), `x/center` | `{ kind: 'circle', center, radius }` |
| an arc, likewise | `arc` | `x` (arc), `x/center`, `x/start`, `x/end` | `{ kind: 'arc', center, start, end }` |

- **Refused by the validator: anything under `origin/`** of the source: its axes `origin/x` and `origin/y`, and their far points `origin/x/b` and `origin/y/b` ("origin/x of board is not projected: this sketch has its own axes origin/x and origin/y; project the origin of board for a point at its origin"). It is a rule of the form, read from 6a2's `underOrigin`, so `load` checks it too. The first design refused the two axes and left the far points to `requireRef`, which `load` skips, while the far point is in the source's geometry (the review).
- **A spline** (after 6d) is refused: `kind` has no `spline`, and 6d writes the text ("a spline is not projected yet: project its control points as points") into `validate` and into the tool, which skips and names a spline of the source (owner, answer 22). The hook is the kind's `validate` and the tool's list of what it projects.
- A construction curve of the source is projected as any curve; the flag decides whether it forms regions here.

### The value, the stamp, the arc made exact

- **`compute`** (`projectFromSketch`): the source's `SketchState` from `state.sketches` (absent: `brokenProjection`, "board is not evaluated before this sketch: removed, suppressed, in error, or later on the timeline"); the planes (above); the entity: a point from `geometry.points`, a curve from `curves` (absent: `brokenProjection`, "board has no circle bh3"; of another kind: `brokenProjection`, "c1 of board is an arc now, not a circle"); the positions mapped; a circle's radius from `geometry.radii`; an arc's ends swapped across a flip and its end made exact (above, "Measured").
- **The value is stored** in `solved.external` and stamped, as 6a requires of a reference: a frozen projection keeps its positions. It holds positions and nothing else, so a change of the joins of the source does not reach this sketch.
- **`Projected` gets two more forms**, a point and an arc; it stays the one type of `solved.external` (`SolveStamp.external` in `types.ts`), and `describe_api` shows it. One reader reads a stored value by its form (`projected`, which moves from `edge.ts` to the registry); the kind's `value` then checks that the form is the entry's `kind`. An edge's entry is a line or a circle, so a stored point or arc never fits an edge, and `ReferenceValues.edge` narrows to those two forms.
- **`compute` may say why** (`{ code, detail }` beside a bare code): `resolveReferences` keeps the detail in `lost`, and the step's warning carries it with the constraints left out, "(board has no circle bh3; the constraints on it were left out of the solve)".

### Joins: by position

The owner's answer 19: curves that are not own and form regions join by position, in one stage; 6b's join keys are dropped. So:

- **`joinPairs` stays what it is**, the operands of the `coincident` constraints. The value of a projection has no `vertices`, the geometry of an entry no `keys`; 6b removes the slot `keys` of `EntryGeometry`, which 6a drew for this and nothing uses.
- **The stage is 6c's `positionJoins`** (its revised design, "Joins"), with its predicate answering for every curve that is not own. Its three rules then read, for a projection: only the two ends of a line or an arc take part, and only when the entry has the flag; ends of such curves within the length tolerance (1e-6 mm) are paired with each other, a projection's with a projection's or a copy's; a group is paired with the own ends at its place when those are one vertex already, and with none of them when they are two.
- **What closes**: eight entries projecting a rounded rectangle; an outline whose curves come from two sketches; projections of the projected edges of a body (all three measured); and, by the same rule, a projected construction copy of 6c, which in its own sketch joins nothing (not run: 6c is not implemented). The three cases the keys left invalid are the same case under position.
- **What does not change**: two own points at one place without a `coincident` are two vertices, with or without a projection there (rule 3 never welds them). A projection without the flag joins nothing by position, as a construction curve joins nothing. A projected point, and the centre of a projected circle or arc, join nothing by position: they are no vertex of a profile.
- **An own end at the end of a flagged projection is its vertex**, by a `coincident` or by position alone when the own ends there are one vertex (measured: an own chain whose ends are put on the ends of a projected line by their own constraints closes with it). That is 6c's rule for copies, and now the rule for every curve that is not own.
- **Why position does not weld what was never meant to meet**, which was the first design's objection: the stage reads only ends of curves that form regions. Two such ends at one place that are not joined are an invalid profile anyway, so "joined" is the only reading under which the sketch means anything.
- **One function for the step and for a reader in memory.** The step, 6e's tools and 6c's tools build the curves and the joins of a sketch through one function (6c's `withDerived`, behind 6e's `toolWorld`), which runs the stage over positions. A tool has the positions (`SketchResult.points`) and the flags (`SketchResult.curves`), so it sees a projected outline closed as the recompute does (measured, R2 and R3). With keys it would have needed the stored values of the document as well.
- **Ends that stay open** are in `SketchResult.openEnds` (6c): an end of a flagged projection that met two own vertices, or nothing, is listed there with the same two reasons as an end of a copy.

### Regions and face names

- A projected curve with `regions: true` is in the profile like an own curve that is not construction (`EntryGeometry.regions: [id]`); without the flag it is in the list of curves with `regions: false` and bounds nothing, as a projected edge or a construction curve.
- **A region is named by the IDs of its outer loop**, entries included (`["ra0", …, "rl3"]`, measured), and the side face of a projected curve by the entry's ID: `{ feature, role: 'side', curve: 'ra0' }`, `wallSide` never (a wall takes own curves, `notProjected`). The ID has no slash, so the face key is today's (6c's quoting is for slashed IDs).
- A profile is invalid where an own curve lies over a projected one that forms regions, or two flagged projections lie on each other, as for two own curves.
- **A flagged projection is never cut** (6e: geometry that is not own is not cut), so an own curve that crosses it leaves the profile invalid for good. Where the outline has to be cut, it is drawn as own curves over the projection.

### Holding own geometry on a projection

How an outline that 6e's tools can cut is made from a projected one; the tool `projectSketch` with `as: 'own'` does it, and the description for the AI gives the recipe for a hand:

- the projections without the flag;
- **one own point per place where ends of the projected curves lie**, `coincident` with one projected end there (one constraint a point: a second one to another projected point at that place would be redundant);
- **an own line** between two of those points;
- **an own circle** with a centre of its own, `coincident` with the projected centre, and `equalRadius` with the projected circle;
- **an own arc** between two of those points, with a centre of its own started at the projected centre, **a construction line from that centre to the arc's start, and the projected centre on that line** (`pointOnCurve`). The two ends put the centre on the bisector of the chord; the line through the start and the projected centre crosses the bisector once, at the projected centre.

Measured: 0 degrees of freedom and no redundant constraint for the rounded rectangle, for a slot with two half turns, for circles, and on a flipped plane; right through every change of the source tried. Not `equalRadius` for an arc (two solutions, none at a half turn), and not the centre `coincident` as well (a conflict: one equation too many).

### When the source changes

| Change in the source | The projection |
|---|---|
| a point moved, a dimension changed, a parameter | follows at the next recompute (the source is solved first); the stamp of this sketch changes, it is solved again and written back |
| the entity removed (`removeEntity`, `removeExternal` of a projection there, a copy beyond a lowered count of 6c) | `brokenProjection` with the detail, frozen at its last values; constraints on it keep acting on the frozen geometry |
| the source sketch removed, suppressed, in error, moved after this sketch (refused by `moveFeature`), its plane tilted | `brokenProjection` or `unsupportedProjection`, frozen |
| the source sketch in `sketchConflict` | **it follows the positions the source keeps** (its last solved ones), with no warning here: the source says it, and its state holds those positions for every reader (measured) |
| 6e splits the curve | the piece that keeps the ID is projected (shorter); the new pieces are not. With the flag the region here may open. 6e's tools list this sketch in `shortened` |
| 6e trims a circle into an arc (the same ID, another kind) | `brokenProjection` ("c1 of board is an arc now, not a circle"), frozen as the circle. `updateExternal` cannot change the kind of an entity that stays (6a's rule); the repair is a new entry (`removeExternal`, then `addExternal` with `kind: 'arc'`), the constraints on it made again. The tool lists this sketch in `broken` |
| 6e removes the curve or a point (a whole piece trimmed away) | `brokenProjection`, frozen; the tool lists this sketch in `broken` |
| 6e trims, extends or the fillet shortens a line | the shorter line is projected; the sketch is in `shortened` |

**The lists of the tools.** 6e's `readersOf` computes `moved`, `shortened` and `broken` for the fillet of D52 and the three tools in one place. 6b adds one kind of reader there, and it needs no member on the kind: the references of an entry (`refs`) already name `{ kind: 'entity', sketch, id }`, so a sketch one of whose entries names an entity of the changed sketch is found by walking the references the registry of feature types gives. It is in `shortened` when the entity keeps its ID and its kind with another extent, and in `broken` when the entity is removed or is of another kind now. The first design put every case into `shortened` through a new member `reads`; the review found that a removed source and a circle turned into an arc belong in `broken`, and that the list was computed in two places (6e's revision made it one). Patching such a projection (the fillet's arc as one more entry) is deferred.

### What consumers accept

6a's table, the row of a projection from a sketch:

| Consumer | A projection from a sketch |
|---|---|
| A point of a curve of the sketch | no (a coincident joins to it) |
| An operand of a constraint of its sketch | yes, with at least one own operand, as any fixed entity |
| An operand of a generator (`sketchPoint`, a circle) | yes |
| An `AxisRef` (`sketchPoint`, `sketchLine`), a frame of a placement | yes |
| A mirror axis, a direction or a centre of 6c | yes (a line, a point); not a source of a pattern |
| A point of a hole, a curve of a wall (`notProjected`) | no |
| `setCurvePoint`, the fillet's corner, a cut of 6e | no; a cut of an own curve when `with` names it, or the own curve is construction (6e) |
| A source of a projection of a later sketch | yes |
| A region | with `regions: true` |

### Validation and the commands

- **The validator of the kind** (`validate`, on `load`, `addFeature` of a sketch, `addExternal`, `updateExternal`): the fields (`onlyFields`: `type`, `sketch`, `entity`, `kind`, `regions`); `kind` one of the four; `entity` nothing under `origin/`; `regions` a boolean or absent, not `true` on a point; the references (`requireRef`, which a command checks and `load` does not); no other entry of this sketch with the same `sketch` and `entity` (the entry itself excepted, so `updateExternal` of the flag passes).
- **`updateExternal` checks only the references the update brings in**, as `updateFeature` does (`kept` in `document.ts`): the validator gets a context whose `requireRef` passes a reference the entry has already (`refs` of the old entry, by `refKey`). Without it the flag of a projection whose source entity is gone could not be switched, nor its frozen geometry kept. (For the edge this changes nothing a user meets, since an update of an edge projection always names a new edge. 6c's `commandProblem` follows the same rule for its entries.)
- **`addExternal`, `updateExternal`, `removeExternal`** as they are otherwise. `updateExternal` may change the source (`sketch`, `entity`) and the flag; it may not change `kind` (6a's rule of an entity that stays), and an edge projection may become a sketch projection of the same kind or back. It keeps the stored value when the kind says the update keeps the source (`keepsValue(before, after)`: the same `sketch`, `entity` and `kind`), so switching the flag of a frozen projection keeps its geometry; otherwise it drops it, as today.
- **The text for an unknown type** lists the kinds (6c made it; 6b adds `sketch`).

### The sketch tool `projectSketch`

An entry of `SKETCH_TOOLS` with two new input kinds, `sketch` (the ID of a sketch of the document) and `entities` (IDs of entities of that sketch):

```ts
projectSketch: { sketch: Id; entities?: Id[]; as?: 'source' | 'reference' | 'regions' | 'own' }
```

- **What is projected.** `entities`, in the order given; or, without it, the whole sketch: its own curves that are not construction curves; then the curves of its entries in the order of the entries (6c's `entryOrder`) and of their kinds: every curve of a reference entry (that is what a skeleton is made of), and of a mirror or a pattern the copies that form regions; then its lone points (an own point no own curve uses, and a point entry). Never anything under `origin/`. Each is one `addExternal` with a fresh ID (`newId('x')`) and its `kind` from the source.
- **`as`, the role of the projected curves here:**
    - **`source`** (the default; owner, answer 21): a curve forms regions here exactly when it forms regions in the source: an own curve that is not construction, a curve of an entry with its flag, a copy as the source's result has it (a copy that lies on its source has none). So a sketch projected whole has the regions of its source, and a source that holds an own outline over its projections gives one outline, not two on each other (measured).
    - **`reference`**: none forms regions: a skeleton.
    - **`regions`**: every curve forms regions (the outline of a skeleton, as the rim of scenario 15 takes it). Refused when two of them lie on each other in the source (6c's `occupies`), naming the pair: both would bound the same regions here, and the profile would be invalid (measured).
    - **`own`**: none forms regions, and an own curve is drawn over each projected curve and held on it ("Holding own geometry on a projection"). A projected point gets no own point.
- **It reads the evaluation.** The context of `sketchTool` gets the results of the features (`features`, `evaluation.features`): the solved result and the plane of the source, and the plane of the target. The tool maps the positions of the source (`sketchMap`), so every own point of `as: 'own'` starts at its place and a flipped arc has its ends swapped; it reads the role of a copy from the source's result; and it refuses what the recompute would only warn of: a source that is not evaluated, a target that is not, planes that are not parallel ("the plane of frame is at 17.2° to this sketch; only a sketch on a parallel plane is projected"). The first design had a tool that knew no plane and left a tilted source to a warning on every entry.
- **`ids`**: `entries` (the new entries), `sources` (the entity each projects, in the same order), `skipped`; with `own` also `curves` (the own curves, one per projected curve), `points`, `helpers` (the construction lines of the arcs), `constraints`.
- **An entity this sketch projects already is skipped** and listed in `skipped`: no entry and no own curve for it, so the tool can be run again after the source grew, and running it twice draws nothing twice.
- **Refused**: a sketch the document does not have, this sketch, a sketch after this one on the timeline ("board is after this sketch; only an earlier sketch is projected"), an entity the source does not have (named), anything under `origin/`, a source with nothing to project or with all of it projected already.

### The query `sketchSources`

An entry of `QUERIES` (the review's finding 8: which sketches can be projected, and where their entities would land, was a rule of the app's picker, and an AI learned of a tilted plane from the warnings after its batch).

- **Arguments**: `sketch` (the one that would project), `from` (optional: one earlier sketch), `max` (the most entities to list, default 200).
- **Without `from`**: every sketch before `sketch` on the timeline, each with `status` (`parallel`, `tilted`, `notEvaluated`), `angle`, `flips` and how many curves and points it has.
- **With `from`**: that one sketch, and, when it is parallel, its entities with their kind, whether they form regions there (`regions`), whether an own curve is construction, the entry of `sketch` that projects each already (`entry`), and their place in the coordinates of `sketch` (`at`; `a`, `b`; `center`, `radius`; `center`, `start`, `end`, the ends of an arc swapped when the map flips), at most `max` with `total`.
- It reads what the recompute kept of the two sketches (`context.sketch`), no body (`geometry: 'none'`), and is kept by the two solved sketches (`context.memo`). It costs its line in `QUERIES` and its rows in the two typed tables of `packages/mcp/test/queries.test.ts`; the app reaches it through the generic form too.

### The step, in order

1. `resolveReferences`: every entry of a reference kind in the order of its ID, its value fresh, else the stored one, else none, with the detail of a failure (and 6a2's slot of the axes).
2. `solverSetup` and the solver, as today.
3. 6c's `withDerived`: the curves of the sketch, the derived entries, the occupation pass, **the position stage over every curve that is not own**; the joins of the sketch.
4. The profile, the result (the curves of the entries with their flags, `openEnds`), the warnings with their details.

## The document and the schema

- **What the document gains**: an entry `{ type: 'sketch', … }` in `external` and its value in `solved.external`, of which two forms are new (`point`, `arc`). Nothing else changes shape; region references and face names hold entry IDs, which every build accepts as strings.
- **No upgrade step, no new version** (confirming 6a, "No upgrade step for 6b, 6c and 6f"). A build without the kind refuses the entry (`externalRef`, with the text that lists the kinds it knows), so a document with a projection is an invalid document there, not a model with the projection dropped; a stored point or arc belongs to such an entry and goes with it. `SCHEMA_PENDING` does not change.

## Where the code lives

| File | What changes |
|---|---|
| `packages/engine/src/types.ts` | `SketchProjection` (with the comment the AI reads), a member of `ExternalRef`; `Projected` with the forms `point` and `arc`; the comment of `SketchResult.curves` |
| `packages/engine/src/references/projection.ts` (new) | the kind: `validate`, `refs`, `faces` (none), `entities`, `compute` (`projectFromSketch`: the map, the flip, the exact arc, the details), `value`, `geometry`, `keepsValue`, `summary`, `example`; `sketchMap` |
| `packages/engine/src/references/spec.ts` | `ReferenceValues.sketch`, `ReferenceValues.edge` narrowed; `compute` may return `{ code, detail }`; the optional member `keepsValue`; the slot `keys` of `EntryGeometry` removed |
| `packages/engine/src/references/index.ts` | the line of the registry; `projected` (the reader of a stored value, four forms) moved here from `edge.ts`; `resolveReferences` keeps details; the text of an unknown type lists `sketch` |
| `packages/engine/src/references/derive.ts` (6c's) | the predicate of the position stage answers for every curve that is not own, if 6c did not write it so |
| `packages/engine/src/features/sketch.ts` | the step: the details in the warnings |
| `packages/engine/src/recompute/services.ts` | the texts of `brokenProjection`, `unsupportedProjection`, `degenerateProjection` in English and general |
| `packages/engine/src/document.ts` | `updateExternal` checks only the references the update brings in, and keeps the stored value when `keepsValue` says so |
| `packages/engine/src/sketch-tools.ts` | the tool `projectSketch`, the input kinds `sketch` and `entities`; `SketchToolCall` gets `features` |
| `packages/engine/src/sketch-cut.ts` (6e's) | `readersOf`: a sketch whose entry names an entity of the changed sketch, in `shortened` or `broken`; `toolWorld` needs no line of 6b's if it calls the stage of the step |
| `packages/engine/src/query/sketch.ts`, `query/index.ts` | the query `sketchSources` and its line |
| `packages/engine/src/index.ts` | exports `sketchMap` |
| `packages/mcp/src/tools.ts` | `sketchToolBatch` hands the tool `evaluation.features` |
| `packages/mcp/src/api.ts` | the kind's `summary` and `example` in the generated section on the kinds of entries (6c's); the paragraph on projected geometry rewritten; `describe` of the input kinds `sketch` and `entities`; the example of `projectSketch` |
| `packages/mcp/test/queries.test.ts` | the rows of `sketchSources` in the two typed tables |
| `packages/app/src/sketch-tools/project-sketch.ts` (new), `index.ts` | the tool *From sketch* and its line; the app's calls of `sketchTool` hand it `evaluation.features` |
| `packages/app/src/references/projection.ts` (new), `index.ts`, `spec.ts` | the row of the kind; `ReferenceUi` gains `flag` (a checkbox in the row), `inModel`, and the host of `detail` a `featureName` |
| `packages/app/src/queries/index.ts` | the view of `sketchSources` (the candidates of the picker) |
| `packages/app/src/scene.ts` | the curves of entries with `inModel` drawn in the model view |
| `packages/app/src/panels/sketch.ts` | the flag's checkbox in the row of an entry that has one |
| docs | `architecture/sketch.md` ("Promítnutá geometrie": the kind, the joins by position, the hold); `architecture/api.md` (`ExternalRef`, the rule of `updateExternal`, `Projected`, the query); `architecture/ai.md` (`get_sketch` of the entry, the input kinds `sketch` and `entities`, the query); `architecture/naming.md` (a side face named by an entry); `architecture/verification.md`; `ui/` the sketch panel, the tool and the query's view; `decisions.md` D69; `requirements.md` scenario 15; `backlog.md` the row "Promítnutí geometrie z jiné skici" closed with what is deferred; `docs/onshape-import.md` (what 6h can now use); `docs/d36/README.md`, the rows of "Shared places" on reference geometry and on `sketch-cut.ts`; the vocabulary of 6a (below) |

`references/projection.ts` imports `solid.ts` (`toWorld`, `toPlane`), `recompute/services.ts` (`lookup`), `sketch-content.ts` and `validation.ts`, as `edge.ts` does; it reads `State.sketches`, which `recompute/state.ts` declares. No new layer (`docs/architecture/repository.md` gets the file in its table; `modules.test.ts` finds it). The first design named the file `references/sketch.ts`, which would have been the third `sketch.ts` of the engine.

## The app

- **The tool *From sketch*** (`projectSketch` in `SKETCH_TOOL_UI`, after *Project*): a tool with its own picker (6a's `picks: { pick }`, a place with a foreign snap). Its candidates are the answers of the query `sketchSources`, one per earlier sketch on a parallel plane, asked when the tool starts and when the document changes: while it is active its `draw` gives their curves and points where a projection would put them, dashed, hidden sketches included. The picker takes the place under the pointer in the open sketch's plane (`host.planePoint`) and the nearest entity within the reach of a pick, points before curves, the latest sketch first where several lie on each other (the skeleton before the board it projects). Its options (6a's `options`, the panel while active): *Forms regions* (a checkbox), *Whole sketch* (a checkbox) with *As* (in its source, reference, regions, own curves), *From* (any, or one sketch). A click sends `addExternal` with `kind` from the candidate and `regions` from the option; with *Whole sketch*, the engine's tool `projectSketch` with that sketch; with an entry being repaired (`m.repair`) or one sketch projection selected, `updateExternal` keeping the ID (refused by the engine when the kind differs, with its text). A sketch on a tilted plane is listed in *From* with its angle and cannot be picked.
- **The row of an entry** (`REFERENCE_UI.sketch`): title by kind ("Point", "Line", "Circle", "Arc"), detail "board: c1", tag "projected", repair by *From sketch*, and a checkbox *regions* for a curve (`flag`), which sends `updateExternal` with the flag switched. The warning of an entry shows as the rows of projections show theirs.
- **In the model view** the curves of an entry whose row says `inModel` are drawn with the own curves of their sketch: solid when they form regions, dashed otherwise. A projection from a sketch says so; a projected edge does not (the edge of the body lies there). So the skeleton and the rim's sketch are seen outside the sketch mode (the review's finding 9).
- **What the snapshots of the app see**: nothing in a model without a projection from a sketch. The commit says so if one changes.

## MCP

- `describe_api` shows `SketchProjection` and the two new forms of `Projected` from `types.ts` with no change in `packages/mcp`, and the kind in the generated section on the kinds of entries (6c's `summary` and `example` on every kind, with the test that the examples are accepted; the review of the step, finding 15). 6b writes no paragraph for the kind by hand.
- **The paragraph on projected geometry** of `api.ts` (today "Promítnutá hrana (addExternal) je ve skice pevná křivka …") is rewritten in English for what the kinds share: an entry of a reference kind is fixed for the solver and follows its source; its derived IDs; it freezes when the source is gone; constrain to it with at least one own operand; a curve with `regions: true` bounds regions, and the ends of such curves join at their place, with each other and with an own end there; such a curve is never cut by the sketch tools, so an outline to be cut is drawn as own curves over the projection, which `projectSketch` with `as: 'own'` does (by hand: own points `coincident` with the projected ends, an own arc with a construction line from its centre to its start and the projected centre on that line; not `equalRadius`, which has a second solution).
- **The AI's ways**: what can be projected, `query { query: 'sketchSources', args: { sketch: 'base', from: 'board' } }`; one entity, `addExternal { sketch: 'base', id: 'x1', ref: { type: 'sketch', sketch: 'board', entity: 'c1', kind: 'line' } }`; a whole sketch or a list, `sketch_tool { sketch: 'base', tool: 'projectSketch', input: { sketch: 'frame', entities: [...], as: 'own' } }`. `get_sketch` lists a projection's entry with its fields, `entities`, the positions of its points and, for a circle, its radius (6a's generic answer, no change), and `openEnds` when ends of flagged projections stayed open (6c).
- **`sketch_tool`** hands the tool the results of the features; its catalog describes the input kind `sketch` as "the ID of an earlier sketch of the document" and `entities` as "IDs of points and curves of that sketch, as its get_sketch or the query sketchSources lists them".

## Issue codes

None new. `brokenProjection`, `unsupportedProjection` and `degenerateProjection` get general English texts ("The projected geometry is no longer in its source; it keeps its last valid place.", "The geometry cannot be projected into this sketch.", "The edge is perpendicular to the sketch plane and projects to a point.") and the detail of the kind in brackets, as `issue(code, refs, detail)` composes it. The edge passes no detail, so its message is the general text.

## The Onshape converter

The converter's part is the closing point of the step, 6h (owner, answer 4; [6-plan.md](../6-plan.md), "6h"). What 6b gives it:

- **Constraints on an entity of another sketch of the studio** (`externalFirst`, `externalSecond`, `externalMirror`, all skipped today): an entry `{ type: 'sketch' }` from that sketch (earlier on the timeline, as Onshape requires), the constraint on the entry. The converter's merging of points at one position must leave projected points alone (a curve cannot run over a fixed point): it ties an own point to them by `coincident`. The origin and the default planes are 6a2's part of 6h; an edge of a body is an entry `{ type: 'edge' }` (D23).
- **Derived sketches** (`importDerived`) stay copies: they come from another part studio, which is another document, and a sketch of another document cannot be projected (D62 brings bodies). What 6b changes is that the constraints of the studio on the copied sketch's entities are kept, as projections from the copy.

## What 6b needs from 6a2, 6e and 6c

Each is implemented before 6b; "As implemented" of each says where the point is in the code, and 6b verifies against it.

**From 6a2 (D71):**

1. The entities `origin/x` and `origin/y`: the skeleton of scenario 15 measures from `origin/y`.
2. `underOrigin`, for the refusal of a source entity.
3. The stand-in board of its calls, which 6b's calls build on.
4. No hidden point in `SketchResult.points`, so the query and the tool never offer a far point.

**From 6e (D65), its revised design:**

1. **`toolWorld` builds its joins with the position stage of the step**, not from the `coincident` constraints alone (its "Open", 2, is the owner's answer 19). With 6c's `withDerived` behind it, 6b adds nothing there.
2. **`readersOf` walks the entity references of every feature** (`refs` with `kind: 'entity'`), or has a place where 6b adds that walk: `shortened` for an entity that keeps its ID and kind, `broken` for one that is removed (`removed`, `removedPoints`) or changed its kind (`rekinded`). Its design names the member `reads` of the first design of 6b; that member is gone.
3. `curvePredicates`: a flagged projection forms regions, is never cut and can hold a point. It reads `SketchCurve.regions`, so nothing is added.
4. The input kind `curve` with `reference: true` takes a projection as a `with` curve.
5. `sketchTool`'s context with the document (`SketchToolCallAfter`), to which 6b adds `features`.
6. The query `sketchContacts` lists two flagged projections that lie on each other in `lying`, and a crossing of an own curve with a flagged projection with `repair: 'none'`.
7. The rectangular notch of scenario 15 (owner, answer 20) is trimmed into the own outline that 6b's tool draws; 6e tests it on a plain own outline.

**From 6c (D68), its revised design:**

1. **The predicate of `positionJoins` answers for every curve that is not own** (its "Joins", the paragraph marked pending, and `PENDING_NOT_OWN_JOINS_BY_POSITION` of its contract). If 6c is implemented with the copies' predicate, 6b changes that line and adds the tests.
2. **The stage runs in every sketch**, also one with no derived entry (a sketch of projections alone), and `withDerived` is the one function the step and the tools call.
3. **`openEnds` names an open end of any curve of the predicate**, a projection's too; its texts say "a copy" today.
4. The occupation pass counts a flagged projection as a curve that forms regions (it does), and `occupies` is exported: the tool's refusal of `as: 'regions'` reads it.
5. The source's result has each copy with `regions` as the occupation pass left it, which is the role `projectSketch` keeps; `entryOrder`.
6. A copy as a source: `<entry>/<copy>/<source>` is an entity by the form of its ID, a curve of the source's `curves` and a point of its `geometry`. A projection of a copy above the count is valid and `brokenProjection`.
7. The registry in two halves, with `summary` and `example` on every kind and the generated section of `describe_api`; the text for an unknown type.
8. It removes the slot `joins` of `EntryGeometry`; 6b removes `keys`.

## Where 6b meets 6d and 6f

- **6d** (splines): a projected spline is refused until a package projects control points. 6d adds the refusal to the kind's `validate` (`kind: 'spline'`) and to the tool (a spline of the source skipped and named), and to the query (a spline listed with its kind and no place to project). The ends of a spline are ends: nothing changes in the stage.
- **6f** (an imported outline): reference geometry that forms regions by the same flag, default `true` (the convention of "The entry" above), many entities per entry. It reuses what 6b adds: the forms `point` and `arc` of `Projected` and the fixed arc made exact (an outline's arcs come from a file), the detail of a failure, `keepsValue`, the position stage (an outline's ends join as a projection's), `inModel`. An outline's entities are projected by 6b like any entry's entities (`o1/l3`), and `projectSketch` with `as: 'own'` draws an own outline over an import. 6f assembles scenario 15.

## What 6b changes in 6a's vocabulary

The record is the table "Where later packages change the vocabulary" of [6a-sketch-prep/design.md](../6a-sketch-prep/design.md), amended in the same commit as this revision (rows 3 and 15 to 18; row 7 is 6a2's). In short:

| 6a says | 6b does |
|---|---|
| A projection from another sketch keys each projected point by its source vertex; `EntryGeometry.keys` | No keys: the ends of curves that are not own and form regions join by position, in 6c's stage. The slot `keys` goes |
| `Projected` is a line or a circle | Also a point and an arc; the edge's value narrows to the two |
| `compute` answers a value or the code of a warning | Or `{ code, detail }`, which the warning carries |
| An update of an entry validates the whole entry and drops its stored value | It checks only the references it brings in, and keeps the value when the kind's `keepsValue` says so |
| A flag of an entry (`regions`) | Always stored as a boolean; a command may leave it out, and the kind has the default |

Outside 6a's vocabulary 6b changes one more shared type: the context of `sketchTool` (`SketchToolCall`, D52) gets the results of the features.

## Scenario 15

The one text is [6-plan.md](../6-plan.md), "Validation scenario 15"; 6f, the last package, assembles the cover as one model and owns its cross checks (owner, answer 3). 6b tests its part on the stand-in board of 6a2, as a `describe` of its own in `packages/scenarios/test/scenario15.test.ts`, from calls.ts.

**Step 2, the skeleton.** `frame` on a parallel offset plane projects the outline and the hole circles of `board` (whose centres are the hole centres, `fh0/center`) and measures the hole pair from `origin/y` by two reference dimensions. It constrains nothing of the board: its projections are fixed, and the symmetry is the board's.

**Step 3, the base, in three features** (owner, answer 6), as a tray is modelled:

1. **The floor** (`baseSk` on a plane `standoffH + baseT` below the board): one call of the tool, `projectSketch { sketch: 'frame', entities: <the outline>, as: 'own' }`: the outline projected without the flag and an own outline held on it (measured: 0 degrees of freedom, no redundancy), extruded `baseT` with the offset `clearance + wall`. The cable notch of step 6 is trimmed into this own outline, and it is **rectangular**, drawn wider by twice the offset (owner, answer 20): a round notch fits an offset floor only while it is large against the offset. 6b's text promises no round notch there.
2. **The rim** (`rimSk` on the frame's plane): the outline projected from `frame` **with** the flag, one region of eight entries joined by position; added `rimH` with the offset `clearance + wall` and pocketed with the offset `clearance` (2a's offset on reference curves).
3. **The standoffs** (`standSk` on the frame's plane): the four hole circles projected from `frame` with the flag and four own circles of `standoffD` centred on the projected centres (coincident); the rings are added `standoffH`, their bores named by the projections (`standoffs/side/sh0`).

**The rim and the notch.** The rim is a flagged projection, which is never cut, so the notch of the floor does not go through the rim: the rim bridges it. Whether the cable slot also opens the rim (a cut feature of its own, or the rim's sketch drawn as an own outline too) is for 6f, which assembles the model and settles its numbers.

**Step 5, the seam with 6c.** The sketch of the second row of vents projects one copy of the lid's mirror (`m/1/c2`, the mirrored flank) and places its first slot from it: a projection of a copy. Written in calls.ts against 6c's calls; 6b, the later of the two, writes the case when it is implemented.

**Step 7, the part of 6b.** `boardW` from 60 to 62: the board, the frame, the own outline of the floor, the rim and the standoffs follow, and no feature is in error (+212.00 mm³, measured). The revised DXF is 6f's.

## Rejected alternatives

1. **The kind of the entity read from the source, not stored**, or optional in a command and filled in (the review's nit). `entities` would need the document of the source, so `entityOf` (the validation of every constraint) would read another feature, and `load` would depend on the order of validation. Filled in by a command alone, it would need a reader of another feature in the validator's context, which only checks references today (`requireRef` answers nothing). A caller that names an entity has read it from `get_sketch` or `sketchSources`, which give its kind, and the tool fills it in.
2. **One entry for a whole sketch** (the plan's deferral). The entities would be `<id>/<source entity>`, the regions and faces named by slashed IDs, a source that grows would add entities nobody asked for, and the flag would be one for all. Per entity, with a tool that makes the batch, each has its flag and its repair.
3. **Projection into a tilted plane** as a line, a polyline or a sampled curve: an ellipse is a curve kind (backlog), and a line or polyline would be wrong geometry with a name.
4. **The projected arc copied as it is.** Measured: a point on it fails the sketch when its ends are 1e-9 mm off one radius.
5. **Join keys** (the first design: each projected point carries the vertex of its source point; points with one key join). Measured by the review: two routes to one corner, a source made of projected edges and a projected construction copy of 6c end with an invalid profile, since their keys differ or do not exist; the cure by an own point with two coincidents adds two redundant constraints a corner; and a profile computed in memory does not have the keys at all. The owner chose position (answer 19).
6. **Keys carried through a chain of projections, or read back from the stored values by the tools.** Both mend one of the three cases and keep the others.
7. **Every projected point joins by position**, with or without the flag, a centre too. It would weld points never meant to meet; the ends of curves that form regions are the points a profile reads.
8. **A whole sketch only as a batch the caller writes** (the plan). The rule which entities belong to "the whole sketch", and which form regions, would live in the app.
9. **The tool with `as: 'regions'` as the way to project a whole sketch** (the first design). From a source that holds own curves over its projections it flags both and the profile is invalid (measured). The default keeps the role of the source.
10. **A tool that knows no plane** (the first design). A tilted source would give a warning on every entry after the batch, and `as: 'own'` could not start its points at their places.
11. **An own arc held by its ends and `equalRadius`** (the first design; the owner's answer 21 with the centre started at the projected centre). Two solutions that ordinary changes cross, and a double root at a half turn (measured).
12. **An own arc with its centre pinned along one axis of the sketch** (a distance of 0 to the projected centre). One solution and no trouble at a half turn, but it is tied to the direction the chord has when the tool runs: a source that turns a quarter turn leaves the arc with a freedom (measured).
13. **A member `reads` on the kind** (the first design) for the lists of the tools. The references of an entry say the same, and one walk finds axes and frames on an entity as well.
14. **`regions` stored only as `true`** (the first design). With 6f's default `true` the same field would be stored only as `false` there.
15. **The candidates of the picker computed in the app** (the first design, with `sketchMap` exported for it). The AI had no way to ask what can be projected.
16. **A new warning code per failure** (`sourceGone`, `notParallel`). The existing codes say it; the detail names the case. New codes would also reach the app's texts and the AI's description.
17. **A flag per projection to keep it frozen** (not follow the source). Not asked for; the copy is an own outline drawn over it, held or not.
18. **A projection of another sketch's axes**: a fixed line of 1 mm with a hidden end. Its `origin` is a point and projects.

## Known limits

- **A projection follows the ID, not the shape**: after 6e splits a source curve, only the piece that kept the ID is projected; a fillet in the source shortens the projected lines and the arc is not projected. Both list the sketch in `shortened`.
- **A source circle trimmed into an arc** breaks its projection; the repair is a new entry and the constraints on it again.
- **A source in conflict** is followed at the positions it keeps, with no warning in the projecting sketch.
- **Parallel planes only**; the projection of a circle into a plane tilted within 1e-4 rad is a circle (the ellipse differs by under 5e-9 of its radius).
- **Two flagged projections of one place** (the same line by two routes, both with the flag) lie on each other and make the profile invalid; a command does not see it (it knows no positions), 6e's query `sketchContacts` lists the pair.
- **A flagged projection is never cut**, so an own curve across it cannot be repaired by a tool, and in scenario 15 the rim bridges the notch of the floor.
- **The own outline of the tool carries a construction line per arc**, and is drawn only together with its projections: an entity projected already is skipped, so an existing projection is not taken over as own curves (a backlog row, with 6e's).
- **A hold started far from its solution may not solve**: the tool starts every point at its place; a hand that puts the own centre of a quarter arc 1.5 radii away gets `sketchConflict`, not a wrong shape (measured). The solver's failures on a very big jump (measured: a size changed by ×20000) are the adapter's ([6a2-origin-axes/design.md](../6a2-origin-axes/design.md), "Known limits").
- **The query lists at most `max` entities** of a source (200 unless asked); the app asks for all of a candidate, once per sketch and state.
- **Sketches of an inserted document** (D62) cannot be projected.

## To verify before the implementation

- **6c as implemented**: that the position stage runs in a sketch with no derived entry, that its predicate can answer for reference curves, and that `withDerived` is what the step and the tools call. Until then the measurements of this text stand on a prototype of the stage written from 6c's rules (`proto.ts`), which closed every case here; 6c's own prototype measured four flagged projections of a rectangle the same way (its R5).
- **6e as implemented**: that `readersOf` is one function and where the walk of entity references goes; that `toolWorld` calls the stage. The review ran the started implementation (`d36/6e`, before its revision): two places and joins from the coincidents alone.
- **The adapter's `fixed` check takes a projected arc** (its points are fixed, the arc itself is not in `fixed`). Holds: read by the review (the adapter checks points and circles only) and run (fixed arcs solved in `frame`, `rimSk`, `baseSk`).
- **The projected arc made exact gives the side face the radius the profile reads.** Holds by the review's reading: the formula moves only `end`, and `curveOf` and `placedCurve` both take the radius from `start`; the volumes agree.
- **`pointOnCurve` of a projected point on an own construction line** passes the validator and the analysis. Holds: run in the engine (R4, R5).
- **The app's snapshots**: none should change. Not checkable before the implementation.

## Tests the implementation owes

- **Engine, the kind**: the form (each field, `regions` left out and written as `false`, `true` on a point, an unknown field, a spline after 6d); the references (a later sketch, itself, a missing entity, a kind that differs, an axis and a far point of the source, also on `load`, a duplicate, the entry itself on update); `entities` of each kind; the stored value read by its form (a point or an arc under an edge's entry refused); `keepsValue` (the flag switched on a frozen projection keeps its geometry, its gone entity not checked again; another entity drops it); an edge projection repaired into a sketch projection of the same kind and back; the text of an unknown type.
- **Engine, the compute**: each kind, a flipped normal (the arc's ends swapped, counter-clockwise), an offset and a turn in the plane, the arc made exact (an end off by 1e-7 in the source), a tilted plane with its detail, a missing sketch, entity and kind change with their details, a source in conflict, a copy of 6c and a projection of a projection as sources.
- **Engine, joins and profile**: a projected rounded rectangle closes by position into one region named by the entries; without the flag no region; **two routes to one corner; a source of projected edges; a projected construction copy** (the review's three cases, pinned in `review.test.ts`); an own end at a projected end by `coincident` and by position; two own vertices there (invalid, and in `openEnds`); an own curve over a flagged projection and two flagged projections on each other (invalid); the side faces of projected curves.
- **Engine, in memory**: **a trim in a sketch that also holds a flagged projected outline** (the review's finding 1): the profile the tool builds is the step's, the feature over the outline is not `pending`; the same for the fillet.
- **Engine, the tool**: `projectSketch` whole and by `entities`; each role (`source` from a sketch with own curves, with projections and with an own outline over projections; `reference`; `regions` and its refusal; `own`: the batch, 0 degrees of freedom, no redundant constraint, on a flipped plane, a slot of two half turns, circles); the skipped ones; the order; the refusals (a tilted plane, a source not evaluated, an entity under `origin/`).
- **Engine, the hold**: the own arc on a projected one through a turn of the source and through jumps of its size, against the projected centre (the cases of H1 and H2 that the engine can drive), pinned in `review.test.ts` with the second solution of `equalRadius` as the case it guards.
- **Engine, the query**: `sketchSources` without and with `from`, a tilted and a suppressed source, `entry` of what is projected, the places against the result of a sketch that projects them, `max` and `total`.
- **Engine, the recompute**: the chain board → frame → base follows a parameter (the stamps change, the bodies follow); a lost source freezes with the constraints acting; `readersOf` lists a sketch that projects a shortened line in `shortened` and one that projects a removed curve, a removed point or a circle turned into an arc in `broken`.
- **Scenario 15**: steps 2 and 3, the seam with 6c of step 5 and 6b's part of step 7, from calls.ts (`packages/scenarios`).
- **MCP**: `describe_api` contains `SketchProjection`, the generated section of the kind, the query and the tool; `sketch_tool` describes the input kinds `sketch` and `entities`; an `addExternal` of the kind through `execute`, `get_sketch` of the entry, `projectSketch` with `as: 'own'` through `sketch_tool`.
- **App**: the tool *From sketch* (a pick of a point and a curve of another sketch, the latest first, the option of regions, the whole sketch with each role, a repair, a tilted sketch not offered), the row (title, detail, the flag), a sketch of projections in the model view, the snapshots unchanged.

## Open

For the owner:

1. **The hold of an own arc on a projected one.** Answer 21 chose the tool's own outline "held on the projection (the own centre started at the projected centre, so the hold has no second solution)", with the hold of the first design: the two ends and `equalRadius`. Measured for this revision, that hold keeps its second solution whatever the start (a 170° arc is on the mirrored centre after its source turned 44°; a quarter arc after a jump of 180°) and has no solution the analysis accepts at a half turn, which every slot has. This text holds the arc by its two ends and a construction line from its centre to its start with the projected centre on it: one solution at every sweep, measured through every change tried. It costs one construction line an arc. *Recommendation: take it; it is what the answer asked for, by another constraint. The plan and `requirements.md` say "a radius line" where they said `equalRadius`.*
2. **The tool takes a list of entities and has four roles**, where answer 21 named two things (the role of the source, and the own outline). Without `entities` the floor of scenario 15 could not be drawn by the tool (the whole skeleton has the holes too), and without `reference` and `regions` a skeleton could not be made, or used as an outline, in one call. *Recommendation: as written; say if the tool should be only the two.*

Not for the owner, recorded for the packages they belong to: the rim that bridges the notch (6f); the solver's failures on a big jump (a backlog row, proposed by 6a2).

## Reviews

**The first design (2026-11-17)**, the contract and the calls were written on Opus 5.5 (Fable limited until 2026-11-23). It had no review; its state line said "reviewed as recorded in Reviews" with nothing recorded.

**The review of 2026-11-24**, independent, on Fable, read-only (the report is in the scratchpad of the session, `step6-review/reports/6b-design.md`; its probes in `step6-review/6b-design/`). No blocker for 6b's own steps; three major findings, eight minor, five nits, a list of what the owner's answers change, and three questions. It ran the designers' spikes (both reproduce) and probes of its own (E1 to E12, S1 to S3). The owner answered its questions the same day ([6-cross-review.md](../6-cross-review.md), "Later answers", 19 to 22). This revision was written on Fable on 2026-11-24.

What the owner's answers change (the review's section A):

| # | Answer | Settled |
|---|---|---|
| A1 | 1: the axes leave 6b | [6a2-origin-axes/](../6a2-origin-axes/design.md): a design, a contract and calls carved out of this one (D71). Here: the refusal of anything under `origin/`, extended to the far points as the review asked; the calls build on 6a2's board |
| A2 | 6: the base in three features | "Scenario 15"; the first "Open" question is gone |
| A3 | 2: 6f's flag, default true | "The entry": the flag is always stored (finding 10); "Where 6b meets 6d and 6f" |
| A4 | 12, 14: 6c's joins by position, rule 0 dropped | No hidden point of 6c is named any more; a projected construction copy closes under answer 19 |
| A5 | 3, 4: 6f assembles; 6h takes the converter | "Scenario 15" names 6f and the seam with 6c; "The Onshape converter" points to 6h |
| A6 | 17 | Nothing to change |
| A7 | The state line claimed a review | The state line and this section say what was reviewed, by whom, and what is owed |

The findings (the review's section B):

| # | Finding | Sev. | Settled |
|---|---|---|---|
| 1 | Readers in memory do not have the key joins, so they see a flagged projected outline as an invalid profile | major | Answer 19: joins by position, from positions a tool has; one function for the step and the tools ("Joins"). Measured in memory (R2, R3); the test "a trim in a sketch that also holds a flagged projected outline" is owed and written in calls.ts; `sketch-cut.ts` and 6c's stage are in the file table |
| 2 | Join keys do not close three ordinary cases, and the limit is understated | major | Moot under answer 19: all three close (measured: R3 for two routes and for projected edges; the copies by the rule). The three are tests owed. The known limit on keys is gone |
| 3 | The floor cannot take 6e's round notch: the offset refuses it | major | Answer 20: a rectangular notch on the floor, wider by twice the offset. This text promises no round notch there; the bound is 6e's (measured by its revision: `y + o ≤ r − o`). The rim that bridges the notch is said and left to 6f |
| 4 | `reads` does not reach 6e's lists as assumed; a removed source belongs in `broken` | minor | The member `reads` is dropped: `readersOf` (one function in 6e's revision) walks the entity references; `shortened` and `broken` by what happened to the entity ("When the source changes") |
| 5 | The stand-in board is over-dimensioned | minor | Moved to 6a2 with the board. Its fix was measured there: the filleted rectangle the review proposed has no redundancy but took a wrong solution at a jump; the board is drawn with linear constraints only, and `redundant.length === 0` is asserted |
| 6 | The hold recipe has a silent second solution | minor | Measured further: the second solution is reached also from the right start, and a half turn has none. The hold is by a radius line ("Holding own geometry on a projection"; "Open", 1) |
| 7 | `projectSketch` with `as: 'regions'` makes an invalid profile from a source with own curves over projections | minor | Answer 21: the default keeps the role of the source (measured: one region); `regions` stays as a named role and refuses two curves that lie on each other |
| 8 | The candidates of the picker are computed in the app only | minor | The query `sketchSources`; the picker is its view; the tool refuses a tilted plane itself |
| 9 | A sketch made only of projections stays invisible in the model view | minor | Drawn: `inModel` of the kind's row ("The app") |
| 10 | Flag convention for 6f | minor | The flag is always stored; the default is the kind's ("The entry") |
| 11 | What the design leaves out: a spike file no longer exists; no section on what 6b changes in 6a's vocabulary; documents missing from the file table; the `api.ts` paragraph by hand | minor | "Measured" says which rows cannot be run again and what measured them since; "What 6b changes in 6a's vocabulary" and the rows of 6a's amendments in the same commit; the documents added; the kind described from the registry, as 6c's |
| 12 | Key pairs are each later point with the first of its key | nit | Moot: no keys |
| 13 | `kind` could be optional in the command | nit | Not taken: alternative 1 |
| 14 | "board has no curve c1" against the contract's "board has no circle bh3" | nit | One text, the contract's |
| 15 | `references/sketch.ts` would be the third `sketch.ts` | nit | `references/projection.ts` |
| 16 | "Source in conflict" is not in the table "When the source changes" | nit | A row there, and a known limit |

The questions (the review's section E):

| # | Question | Answer (owner, 2026-11-24) | Here |
|---|---|---|---|
| E1 | Join flagged projections by keys or by position? | 19: by position, one stage with 6c's | "Joins: by position" |
| E2 | Where does the cable notch go? | 20: a rectangular notch on the floor | "Scenario 15" |
| E3 | `projectSketch` as a tool | 21: yes, the role of the source kept, and a variant that draws the own outline. 22: a projected spline refused, by 6d | "The sketch tool"; the hold differs from the answer's ("Open", 1) |

The review's "To verify" (its section C): item 1b was false (finding 4); items 4 and 6 hold and are kept above with how they were established; items 1a, 2 and 3 moved to 6a2 with the axes.

**Still owed.** `codex` and `agy` have read neither the first design nor this revision (the owner's rule for design reviews; `agy` ran on none of the designs of step 6 before 2026-11-24). This revision changed the joins, the tool and the hold, and added a query: a second independent read of the revised text is due before the implementation, with the diff of the first design.

## Rows for the indexes

**docs/d36/README.md**, the row of 6b, column "Design now":

> full ([6b-sketch-projection/design.md](6b-sketch-projection/design.md), D69), revised 2026-11-24 after its independent review and the owner's answers: a reference kind of entry of `external`, `sketch` (`{ sketch, entity, kind, regions }`), projecting one point, line, circle or arc of an earlier sketch (own, projected or derived entities; nothing under `origin/`) into a sketch on a parallel plane, following its source on recompute and frozen with `brokenProjection` when the source is gone or changes kind, `unsupportedProjection` with the angle for a tilted plane; projected arcs made exact; `Projected` with a point and an arc; with `regions` (always stored, default false) a projected curve forms regions and names its side face, and the ends of such curves join by position in 6c's stage, so an outline closes whatever its sources and a profile in memory sees it as the recompute does; the sketch tool `projectSketch` (a whole sketch or a list; each curve in the role it has in its source, reference only, forming regions, or an own outline drawn over the projections and held on them by a radius line, with no second solution), which reads the planes; the query `sketchSources`; general texts of the projection warnings with a detail; no command, no issue code, no schema step. Open for the owner: the hold by a radius line in place of `equalRadius`, the list of entities and the four roles of the tool. Owed: `codex`, `agy` and a second read of the revision

**docs/decisions.md**, the row of D69:

> | D69 | [6b Projection from another sketch](d36/6b-sketch-projection/design.md) | designed 2026-11-17; reviewed independently and revised 2026-11-24 with the owner's answers 19 to 22; the axes of the origin, once part of it, are D71 | A projection from another sketch is a reference kind of entry of `external`, `sketch`, one entity per entry with its `kind` stored, from an earlier sketch on a parallel plane; it follows the source and freezes when the source is gone; projected arcs are made exact; a flag `regions`, always stored, lets a projected curve form regions, and the ends of such curves join by position in one stage with the copies of 6c (join keys rejected: three ordinary cases stayed invalid and profiles in memory did not see them); a sketch tool projects a whole sketch with each curve in the role it has in its source, or draws an own outline held on the projections by a radius line (`equalRadius` rejected: a second solution, and none at a half turn); a query says what a sketch can project; no schema step |

**docs/requirements.md**, validation scenario 15, the sub-item after the one of 6a2:

> - *Skeleton and base (6b, D69).* On the stand-in board of 6a2. The skeleton `frame` on a parallel plane projects the board's outline and hole circles and measures both holes of a pair 26.5 mm from `origin/y`. The floor of the base is drawn by one call of the sketch tool `projectSketch` with `as: 'own'`: the outline projected without the region flag and an own outline held on it (own points coincident with the projected ends, each own arc by a construction line from its centre to its start with the projected centre on it; fully determined, no redundant constraint), extruded with the offset `clearance + wall`; the rim projects the outline with the region flag (one region of eight entries, their ends joined by position) and is added and pocketed with offsets; four standoffs are rings of own circles around the projected hole circles, their bores named by the projections. The base by `mass` within the chord tolerance of the volume by hand (7836.9 mm³; measured 7835.0). `boardW` from 60 to 62: every feature follows (+212.0 mm³). The sketch of the second row of vents projects a copy of the lid's mirror. Also: a trim in a sketch that holds a projected outline follows its features; an outline whose curves come from two sketches, and one made of projected edges, close; a source on the other side (an arc swapped), a tilted plane (`unsupportedProjection`; refused by the tool and named by the query `sketchSources`), a removed hole (`brokenProjection`, frozen), a whole sketch projected with each curve in its role, a projection repaired. Refused: a later sketch, itself, another kind, anything under `origin/` of another sketch, a duplicate, `regions` on a point, every curve of a sketch with regions when two lie on each other.
