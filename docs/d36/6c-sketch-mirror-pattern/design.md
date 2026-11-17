# 6c Mirror and pattern in a sketch (D68)

**State: designed 2026-11-17 against `master` at `2aed001` (schema version 9) and the design of 6a (D64, [6a-sketch-prep/design.md](../6a-sketch-prep/design.md)), on Opus 5.5; reviewed as recorded in "Reviews". Not implemented.** 6a is being implemented in the branch `d36/6a` (its part 4, the table of the app's sketch tools, is committed there; parts 1, 2, 3 and 5 are not), so this design is written against 6a's contract, and what depends on 6a's code is listed under "To verify". 6e (trim, extend, split, D65) is designed and is implemented before 6c; what 6c adds to its tools is in "Copies and the sketch tools".

Files: [contract.ts](contract.ts) (the entry, its kind, the slots of 6a that 6c writes, what the tools and the app add), [calls.ts](calls.ts) (validation scenario 15, steps 4, 5 and the part of step 7 that is 6c's, and the rest of the mechanism).

The package in short:

1. **One derived kind of entry of `external`, `pattern`**, with three transforms in the shapes of D53: `mirror` about a line, `linear` along a line (with `second` a grid), `circular` about a point. It names own curves and points of the sketch; its count, spacing, length and angle are numeric fields at `external/<id>/transform/…` and take expressions.
2. **The copies are computed after the solver** from the solved geometry, under `<entry>/<copy>/<source>`. The solver sees none of them. They form regions as their source does, name side faces by their IDs, are in the result of the sketch, and no constraint of their own sketch can name them.
3. **Their ends join any point at their place**, so a half drawn up to the axis closes with its image into one region, and a chain that the pattern carries onto its own start closes into a ring.
4. **The count follows a parameter and the IDs stay**: a higher count adds copies and keeps every region and face named by the others; a lower one removes the highest, and what named them is a broken reference.
5. **No command, no query, no feature type, no face role, no schema step**; one warning, `brokenCopies`. The commands are `addExternal`, `updateExternal`, `removeExternal` (their input form), and `setField` with the sketch as the feature for one numeric field.

## What the plan says, checked against the code

[6-plan.md](../6-plan.md), "6c Mirror and pattern in a sketch"; the owner agreed to its recommendations on 2026-11-17 (derived geometry, not a tool; copies form regions as their source; the numbers are numeric fields; copies cannot be constrained in their own sketch). [backlog.md](../../backlog.md), "Sketch", has the row "Zrcadlení a pole ve skice" (the backlog proposes the tool variant first; the plan and the owner chose the other).

| Statement of the plan | What the code (and 6a) says |
|---|---|
| "An entry of the sketch names own curves and a transform" | 6a makes derived geometry a kind of entry of `external` (`REFERENCE_KINDS`, `DerivedKindSpec`, "One family of entries"); 6c is its first derived kind. Points are named too (below) |
| "A mirror about a line (own, projected or an axis of 6b)" | `entityOf` (`sketch-content.ts`) answers `line` for an own line and for the projection of a straight edge; the axes `origin/x`, `origin/y` are entities only after 6b. So before 6b a mirror about the Y axis is a mirror about a construction line through the origin |
| "The count, the angle and the spacing are numeric fields, so they take expressions" | Not yet possible: `externalRef` (`features/sketch.ts`) gets no reader of numeric fields, `withConstraints` (`document.ts`) drops every expression whose address does not start with `constraints/`, and the commands type `ref` as `ExternalRef`, not its input form. 6a fixed the slot (fields at `external/<id>/<name>`); 6c writes it |
| "After the solver, the copies are computed from the solved curves under derived IDs" | The step (`features/sketch.ts`) solves, then calls `detectProfile(feature, geometry)` directly. 6a's slot "the `derived` source in the code of the step" goes between the two |
| "They form regions like their source (a construction curve copies as one)" | 6a's list of curves with a region flag (`SketchCurve.regions`); a copy of a construction curve is one |
| "Name side faces" | `sideOf(curve)` of `recompute/profile.ts` names a side `{ role: 'side', curve }` for any key of a loop. The key of such a face is ambiguous once the curve ID has a slash (6a, "Face names"); 6c is the first package that names a face so, and quotes it |
| "Later sketches can project them" | A face of a copy is a face of a body like any other: a later sketch projects an edge of it today (`{ type: 'edge' }`); projecting the copy itself is 6b's projection from another sketch |
| "A copy of a point that falls on its source is that point, which is what closes a mirrored half" | 6a: declared joins of an entry (a copy and its source) and join keys across entries. Measured: a circular pattern of an open chain closes only if images join each other too (the end of copy k is the start of copy k + 1). 6c joins an image with any point at its place ("Joins") |
| "With derived copies the IDs of copy 1 to n stay when the count changes" | True with a `spacing`: copy k stays where it was. With a `length` (and a circle over the full turn) every copy moves, but keeps its ID |
| Deferred by the plan: constraining to a copy, a pattern along a curve, a pattern of a pattern, the offset of an outline as derived geometry, copies as points of a hole | All stay deferred; the hole is weighed below ("What reads a copy") |

Not in the plan, found in the code:

- **A count that is an expression and a command.** A command is validated against the document, where the count is the number of the last recompute. D53 met this for the bodies of a pattern (`createsBody` accepts every copy number, "because the count may be an expression"). 6c follows it: an ID of a copy is an entity by its form, whatever the count ("Entities").
- **The validator runs on `load`**, and `removeEntity`, `setCurvePoint` and `setConstruction` do not look at entries (6a). A validator that refused an entry naming a removed curve would make such a document fail to load. So the validator checks the form and the commands check the sketch ("Validation").
- **The fillet of D52 patches regions by names** (`sketch-tools.ts`, `fillet`): its arc joins a region that passes the corner. A corner of a source has its copies too, so the arc has to join the entry and its copy the regions of copies ("Copies and the sketch tools").
- **The hole's side keys split on a slash** (`features/hole.ts`, `sideKey` and `sideOf` read `key.split('/')`), so a hole at a copied point needs more than its validator ("What reads a copy").
- **`derivedPoints(id, ref)` reads `ref.kind`**, which a pattern has not; it narrows to the edge.
- **The profile tests every pair of curves** (`compatible` in `detectProfile`): its time grows with the square of the curves, and copies multiply them (measured below).
- **The specs of the numeric fields of D53** (`PATTERN_COUNT`, the angle, the spacing, the length, `GRID_STRIDE`, `MAX_PATTERN_PLACES`) live in `features/pattern.ts`, a module of a feature type, which `references/*` sits below (6a, the layers of `repository.md`). They move to a leaf both import; `features/pattern.ts` re-exports what the engine exports today.
- **`get_sketch` spreads the fields of an entry** (`sketchDetail`, `packages/mcp/src/tools.ts`) and lists the expressions of constraints from the feature's map; the expressions of an entry need the same.

## The cheap variant

```ts
interface SketchPattern { type: 'pattern'; entities: Id[]; transform: SketchTransform }
type SketchTransform =
  | { type: 'mirror'; axis: Id }
  | { type: 'linear'; direction: Id; count: number; span: LinearSpan; second?: { direction: Id; count: number; span: LinearSpan } }
  | { type: 'circular'; center: Id; count: number; span: { type: 'full' } | { type: 'angle'; angle: number } };
type ExternalRef = EdgeProjection | SketchPattern;
```

| Place | Added |
|---|---|
| The document | a member of `ExternalRef`; its expressions at `external/<id>/transform/…` in the sketch's `expressions` |
| Commands | none; `addExternal` and `updateExternal` take `Input<ExternalRef>`; `setField` reaches the numeric fields |
| Queries, export formats, operations of the app | none |
| Feature types, face roles | none; a side face of a copy is `side` with the copy's ID |
| Issue codes | the warning `brokenCopies` |
| The schema | no step |
| The engine | `references/pattern.ts` (the kind), a leaf with the specs of D53, the derived stage of the step, the slots of 6a listed below, the patches of entries in the fillet and in 6e's tools |
| The app | the row of the kind in the list of entries with its form; three tools of the sketch bar; the copies drawn |
| MCP | no code but the expressions and the copy numbers of an entry in `get_sketch`; one paragraph of the conventions of `api.ts` |

**The slots of 6a that 6c is the first user of** (6a, "Slots, not mechanisms"; each written here with its tests and its review): the numeric fields of an entry and their expressions (`validate` with the reader, `addExternal`, `updateExternal`, `removeExternal`, `withConstraints`); the declared joins (`joinPairs`); the check of a change of source (`updateProblem`); the derived stage of the step; `Entity.derived`; the face key of a text field with a slash (`faceKey`); a derived kind's row in `REFERENCE_UI`. **Not used by 6c**: the join keys (6b's: the images join by position, "Joins") and the refusal of an update that removes a constrained entity (no constraint names a copy; 6f writes it).

**Deferred:**

- Constraining to a copy in its own sketch (by design; a later sketch projects it, 6b).
- Sources that are not own: a projected curve, a curve of an imported outline, a copy (a pattern of a pattern, a mirror of a pattern). D53's grid covers the commonest pattern of a pattern.
- A pattern along a curve; a pattern to both sides of the source; copies left out of a row.
- Copies as points of a hole, and as curves of a wall ("What reads a copy").
- The offset of an outline as derived geometry (2a left it to step 6; it would be one more derived kind).
- In the app, a grid made by a tool: the tool makes a row, and its form adds the second direction.

## Measured

**Recipe.** A prototype of the derive (`proto.ts` in the session's scratchpad, `6c/`): the transforms of the three kinds, the copies of points and curves (a reflected arc with its ends swapped), the rule of a copy that occupies what its source occupies, and the joins by position through a grid of cells. The copies are put into an in-memory sketch as curves with derived IDs and their joins as `coincident` constraints, which `pointJoins` reads exactly as 6a's declared joins will be read, and the real `detectProfile` of `master` runs over it. The sketches were drawn off their places and solved by the real planegcs adapter through the engine (`createEngine`), and the derive read the solved positions. Run from the worktree with `npx vitest run --config <scratchpad>/6c/vitest.config.ts` (`a-copies.spike.ts`, `b-scenario.spike.ts`). Not run: the engine with the kind in it (6a is not implemented), so the commands, the fields, the face keys and the bodies were not; the volumes below are the areas of the regions' polygons times the thickness, which is what an extrusion of them is.

| Case | Result |
|---|---|
| The lid half (W 84, H 54, R 5): `c1` from the origin, two corner arcs, the flank, the top `c3` ending at `a5` held on a vertical construction line through the origin by `pointOnCurve`; solved | 0 degrees of freedom; `a5` at x = 0 exactly; the image of `a5` 0 mm from `a5`. The derive declares exactly two joins: `m/1/origin`–`origin`, `m/1/a5`–`a5` |
| Its mirror (step 4) | valid, one region `c1, c2, c3, m/1/c1, m/1/c2, m/1/c3, m/1/r1, m/1/r2, r1, r2`, 4514.3488 mm² (by hand W·H − (4 − π)R² = 4514.5398; the four arcs are polygons within the chord tolerance 0.01) |
| Row A of vents in the lid sketch (a slot 12 × 3 at (−12, 14), spacing 6), count 5, 7, 2 (step 5) | valid; the lid's region keeps its name and has 5, 7, 2 holes; net 4344.3018, 4276.2830, 4446.3300 mm² (by hand 4344.1969, 4276.0597, 4446.4026); the regions of the copies `va/1/…` to `va/6/…` with the same names at every count |
| Row B (the same slot at y = 40, its own sketch), count 5, 7, 3, 2 | the regions of copies 1 and 3 at 34.0094 mm² each with 5 and 7 (by hand 34.0686); with 3 and 2 copy 3 has no region |
| A tooth of three lines from (20, 0) out to radius 24 and back to the point at 15° on radius 20, that point placed by a distance and an angle dimension; a circular pattern of 24 over the full turn | the solved end 8.9e-16 mm off its ideal place; valid, one region of 72 lines, 1606.455 mm². With 23 copies the chain stays open: valid, no region. With joins only between a copy and its own source (6a's declared pairs) the 24 never close |
| A half circle (centre, both ends on the axis) mirrored | one region `h, m/1/h`, 313.761 mm² (π·100 = 314.159) |
| A D (the half circle and its diameter on the axis) mirrored | the image of the diameter occupies it and forms no regions; two regions `dia, h` and `dia, m/1/h`, 156.880 mm² each |
| The time of the derive and the profile, a row of slots (4 curves each) | 5: 0.7 ms; 7: 1.0 ms; 50 (201 curves): 27.6 ms; 100: 86.7 ms; 200 (801 curves): 313 ms. A grid of 14 × 14 circles (196 places, 202 curves): 39.6 ms |

The time of the profile grows with the square of its curves (the pairwise test of `compatible`); the derive itself is linear (the joins through a grid of cells). 200 copies of a slot cost a third of a second at every recompute of the sketch, a drag included ("Known limits").

## Decisions

### One kind, `pattern`, with the transforms of D53

A mirror, a linear and a circular pattern are one kind of entry, `type: 'pattern'`, with `transform.type` `mirror`, `linear` or `circular`, as D53 made them one feature type. The fields have the names and ranges of D53 (`count` 1 to 200 with the source, `span` `spacing` or `length` in mm, `full` or `angle` in radians from −2π to 2π, `second` a grid of at most 200 places numbered `i + 1000 · j`), so an AI that knows the pattern of features knows this one, and the specs are shared. The differences: a sketch names its references by the IDs of its own entities (`axis`, `direction`, `center`), not by `AxisRef` and `PlaneRef`; the source is a list of entities, not features or a body. An `updateExternal` that changes the kind of transform keeps the entry and the IDs of the copies it still has, as a patch of D53 does.

### What is copied

- **`entities`**: own curves and own points of the sketch, and `origin`; at least one, none twice. A curve takes its points along; a point listed and also a point of a listed curve is copied once. A construction curve is copied as a construction curve (no regions): a copied centre line can serve as an axis of a revolve or a joint, or a later sketch's projection.
- **Not copied**: reference geometry (a projected edge, a projection of 6b, an outline of 6f) and copies. A copy of a projection would be a second kind of copy (its points fixed, not solved) for little: the projection can be made in the shape needed. A pattern of a pattern: D53's grid covers the common case, and two entries over each other would make the order of derived entries matter.
- **Points alone** are copied for what reads points: a generator's operand, an axis of a revolve, a pattern or a joint (`sketchPoint`), the query `measure`, a projection by a later sketch (6b). Not a hole ("What reads a copy").

### The axis, the direction and the centre

- `mirror.axis` and `linear.direction` (and `second.direction`): a line of the sketch, own (a construction line too), the projection of a straight edge, a line projected by 6b or of an outline of 6f, or an axis of the origin after 6b. The mirror reflects in the whole line through its two points; the direction is from its `a` to its `b` (`origin/x` points along +X).
- `circular.center`: a point of the sketch, own, `origin`, or a point of reference geometry (`x2/center`).
- Not a copy: the copies are computed from what the solver gives, and a copy as an axis would make one entry depend on another.
- The axis and the direction are read from 6a's list of curves after the solver, so a projected line or an axis of the origin serves although it is not in the solver's input (6a, part 2, "the other readers").

### The copies

- **IDs** (6a, "IDs"): `<entry>/<n>/<source>`. A mirror has `n = 1`; a row and a circle number from 1; a grid numbers the copy i steps along the first direction and j along the second `i + 1000 · j` (D53). The copy of a curve runs over the copies of its points; `origin` as a point of a copied curve gives `<entry>/<n>/origin`.
- **Shapes**: a line and an arc over the copied points; a circle over the copied centre with the radius of the source. A reflection turns the sense of an arc, so its image runs counter-clockwise from the image of the source's `end` to the image of its `start` (6a, "Shapes"); a translation and a rotation keep it.
- **Where they stand**: copy k of a row is shifted by k steps, a step being the spacing or `length / (count − 1)`; copy k of a circle is turned by k steps counter-clockwise, a step being `2π / count` over the full turn or `angle / (count − 1)`; a mirror reflects in the line of the axis. A count of 1 has no copies and no warning.
- **A grid**: its places are compared as D53 compares them (each with the source and every place before it); two within the length tolerance are `brokenCopies` with the two named, and the entry makes no copies. More than 200 places: the same.

### Entities: from the document, any copy number

6a requires that the entities of an entry are known from the sketch alone, so that commands and `load` are validated without a recompute. For a pattern that is:

- **`entities` (6a's listing)**: the copies the count of the document makes, by copy number, then in the order of `entities`, a curve followed by its points. `referenceEntities`, `get_sketch`, the pickers of the app and the list of entries read it.
- **`entity` (one ID, added by 6c to the derived spec)**: `<entry>/<n>/<s>` is an entity when `n` is a number the transform may have (a mirror: 1; a row or a circle: 1 to 199; a grid: `i + 1000 · j` with i and j from 0 to 199, not both 0), written in decimal without leading zeros, and `s` is a listed own curve (its kind), a listed own point or `origin`, or a point of a listed own curve (a point). `entityOf` asks it. It does not ask the count, as D53's `createsBody` does not: a count may be an expression that only the recompute evaluates, and a batch that raises the parameter and names copy 6 is valid. Such a reference is broken until the count reaches it, as a reference to a body `<pattern>/6` is.
- The entity is marked `derived` (6a's slot; `own` false). The validator of a constraint refuses it (`COPY_IN_CONSTRAINT`: "a copy cannot be constrained in its own sketch, it is computed after the sketch is solved; constrain its source, or project the copy in a later sketch"), before the rule that a constraint needs a movable operand.

### The step

After 6a the step resolves the references, sets up and runs the solver, and finds the profile of 6a's list of curves. 6c fills the stage 6a left between the solver and the profile:

1. `SolvedOwn`: the sketch, the curves of the list (own, reference, the axes of the origin after 6b), every used position after the solver, and the vertices by the joins of the coincidents and the references.
2. Every derived entry in the order of `external`: its `derive` gives an `EntryGeometry` (points, curves, radii, regions, joins) or a failure; its positions go into the geometry, its curves into the list with `source: 'derived'`, its joins into the pairs.
3. The joins of the whole sketch, the profile, and the result: `SketchResult.curves` gets the copies (6a, part 5), `points` and `radii` their positions.

The solver's input, the stamp, the write-back, the analysis of freedom and the diagnosis do not see the copies: a change of the count does not solve the sketch again, and the stored sketch does not change. Each entry reads only `SolvedOwn`, never another derived entry, which is why a copy is no source, axis or centre.

### A copy that lies on its source

A copy that occupies what its source, or an earlier copy of the same source, occupies forms no regions (two curves on each other make the profile invalid). It stays in the list and in the result under its ID with `regions: false`: 6a wrote "left out", but then whether an ID exists would depend on solved positions, and the entities of an entry are known from the document. What a curve occupies (6a, "decided from what the curve occupies"): a line its segment, either way; a circle its centre and radius; an arc its centre and its two ends in order (both run counter-clockwise). So the image of a line on the axis, of a circle at the centre of a circular pattern, of a line through the centre turned by π, forms no regions; a half circle whose centre and ends lie on the axis is not one, since its image is the other half (measured: one region of the two; and a D with its diameter on the axis gives two regions, the image of the diameter left out).

### Joins

6a: the profile joins points that are one ID or a pair within the length tolerance, transitively; the pairs are the coincidents, the `joins` an entry declares, and the points that share a join key. **6c declares as joins every pair of an image and a point at its place**: an image with any point of the sketch within the length tolerance (own, `origin`, reference; not a hidden point, the far end of an axis) and with any other image of the same entry. The pairs are found through a grid of cells of the tolerance, not all against all. 6c uses no keys.

- **Why more than a copy and its source.** A chain that a pattern carries onto its own start (the teeth of a ring, a rack, a pie of sectors) closes only when the end of copy k joins the start of copy k + 1, which is another point (measured: 24 teeth, one region; with source pairs only, none). An image cannot be joined by a constraint (it cannot be named), so position is the only way.
- **Why it changes no profile of today.** Own points at one place without a `coincident` stay two vertices (6a's alternative 4 is kept for them): only images are joined by position, and an entry is new. Two ends of two curves at one place that are not joined make the profile invalid (`compatible`), so a join of an image can only close a loop that was open, never open one.
- **Why no keys.** 6a gave a copy the key of its source's vertex so that the images of two joined source points join. Two joined source points are within the tolerance of each other, so their images are too, and join by position. The keys stay 6b's (a projected point's vertex in its source sketch is not a position this sketch has).
- **What it costs.** An image that falls on an unrelated own end by chance is joined to it. That end is at one place with the image's curve, which without the join is an invalid profile anyway.
- **What the user does.** An end of a mirrored half has to lie on the axis within 1e-6 mm, by a constraint (`pointOnCurve` with the axis line, a coordinate). The solver puts it there exactly (measured); a point placed by eye is not joined, and the outline does not close.
- **A line across the axis.** A line drawn across the axis and listed is its own mirror image (the image occupies it), and the images of its two ends join its other ends: so the bottom of the lid can be one line and one side face, without the seam of two collinear halves ("Known limits"), when its ends are tied by a `symmetric` constraint.

### Regions, face names and the result

- **A region** is named by the curves of its outer loop (`RegionRef`), copies and sources alike: the lid of step 4 is `{ c1, c2, c3, m/1/c1, m/1/c2, m/1/c3, m/1/r1, m/1/r2, r1, r2 }`, the region of copy 3 of a slot `{ vb/3/we1, vb/3/we2, vb/3/wg1, vb/3/wg2 }`. An extrusion or a revolve names them as any region.
- **A side face** of a copy is `{ role: 'side', curve: 'm/1/c2' }`, of a copy of an arc a cylinder. **Its key quotes the slashed ID** (6a, "Face names"): `lid/side/"m/1/c2"`; with a copy tag of a later pattern of the body `lid/side/"m/1/c2"/@p:2`. `faceKey` writes a text field of a role that holds a slash as a JSON string; no face of today has one, so no key of today changes; the two expectations of `face-roles.test.ts` with `rim/center` change to `H/holeBore/"rim/center"` and `H/holeFlat/2/"rim/center"`, and the header of `face-roles.ts` and the rule in `naming.md` ("at most one free field, so unambiguous") say why.
- **The planar side of a copy of a line** starts at the copy's `a`, the image of the source's `a`, as for every line; a sketch on it has its origin there.
- **The result** has the copies in `curves` (`source: 'derived'`, `regions`), their points in `points`, the radii of copied circles in `radii`. The degrees of freedom, the conflicting and redundant constraints and the measurements are those of the own geometry.

### Numeric fields and expressions

6a's slot, written by 6c:

- The kind's `validate` reads `count`, the span's `spacing`, `length` or `angle`, and those of `second`, through `context.fields` at `external/<id>/transform/count`, `…/transform/span/spacing` and so on, with D53's specs.
- `addExternal` validates the entry with a fresh reader over no expressions (as `addConstraint` does) and hands the expressions it read to the cleanup as changes; `updateExternal` first sets every address under `external/<id>/` to null, so a number removes an expression; `withConstraints` keeps an expression under `external/<id>/` while the entry is there and its kind reads that address (it validates the entry once to learn the addresses, as `fieldsOf` learns those of a feature); `removeExternal` drops them.
- So `fieldsOf(sketch)` lists them, `setField { feature: <sketch>, path: 'external/va/transform/count', value: 'vents + 1' }` changes one, `renameParameter` renames in them, the recompute evaluates them and writes the numbers back, and an expression that fails is `invalidExpression` of the sketch with the last valid number kept (the sketch keeps last valid values).
- The commands take the input form: `addExternal` and `updateExternal` type `ref` as `Input<ExternalRef>` (an edge, which has `kind`, stays as it is).

### Validation: the form in the validator, the sketch in the commands

- **The validator** (on `load`, `addFeature`, `setField`, `updateExternal`) checks the form: `entities` a non-empty list of strings without repeats, the transform by its kind with the fields of that kind only (a field of another kind is refused, as in D53), the numbers in their ranges, `axis`, `direction`, `center` strings. It does not ask whether the sketch has them: a document whose source curve or axis line was removed since has to load, as a reference to a removed feature does.
- **`addExternal` and `updateExternal`** also ask the kind's `commandProblem` against the sketch as it is: every source an own curve, own point or `origin`; the axis and the direction a line of the sketch that is not a copy; the centre a point that is not a copy. The text names the ID and what it is.
- **`updateExternal`**: an update may change everything of a pattern (sources, kind of transform, numbers). It may not turn an entry from reference into derived geometry or back (the part of 6a's `updateProblem` 6c writes): the source of an entry decides whether constraints may name its entities. A change of `type` within the derived source would be allowed; there is one derived kind.
- **What the step reports** (`brokenCopies`, a warning of the sketch, the entry first in `refs`): an axis, direction or centre that is not a line (a point) with a position after the solver, or a line of no length (no copies at all); a source that is not an own curve or point (the others are copied); a grid of more than 200 places or with two places in one (no copies). The message says which. The sketch is solved and its profile found with the copies that could be made.

### When the count drops

The copies above the new count are not made. What names them:

- a region of a copy in an extrusion or a revolve: `noProfile` with the region in `refs` (calls.ts: `vents` 3, the cut of copies 1 and 3);
- an operand of a generator, an axis (`sketchPoint`, `sketchLine`) of a revolve, a pattern, a plane's tilt or a joint, a point of the query `measure`: `brokenReference` with the ID, as a missing own entity is;
- a face of a copy (a sketch on it, an edge projected from it, a chamfer of its edge): the reference to a face that is not there, as for any face.

Raising the count brings them back unchanged (calls.ts: 5 again). As for a pattern of features, nothing is patched: the IDs say which copy is meant, and a copy that is not there is an error, not a silent change.

**The idiom for "follow the count".** A region is named by its outer loop, so copies inside an outline are its holes: the lid's region keeps its name and gains holes as `vents` grows (measured: 5, 7, 2 holes). A feature that names a region of a copy names that copy, and a new copy is not in it. `api.ts` says so to the AI.

### What reads a copy

| Consumer | Accepts a copy | Why |
|---|---|---|
| An operand of a constraint of its own sketch | no | it does not exist while the sketch is solved (`COPY_IN_CONSTRAINT`) |
| A point of a curve (`addCurve`, `setCurvePoint`) | no | a curve runs over own points and `origin` (today's rule) |
| `removeEntity`, `dragPoint`, `setConstruction` | no | not own; the entry is changed by `updateExternal` |
| A source, axis, direction or centre of another entry | no | "What is copied" |
| A region of an extrusion or a revolve | yes | by the region flag (6a) |
| An operand of a generator (a point, a circle) | yes | 6a's table: derived as reference |
| An axis `sketchPoint`, `sketchLine` (revolve, pattern, plane tilt, joint), the query `measure` | yes | read from 6a's list and geometry |
| A point of a hole | no (deferred) | see below |
| A curve of a wall | no (deferred) | see below |
| A sketch tool (fillet, polygon, trim, extend, split) | no | "Copies and the sketch tools" |

**A hole at copied points**, weighed because the plan asked "if cheap". It would take four changes: a reference flag that lets a derived point through `notProjected`, the step reading a derived position (`has(sketch.feature.points, point)` today), the hole's side keys (`sideKey` and `sideOf` split on `/`), and the quoted face key (6c has it). Cheap, but worse than what exists: a hole feature fails as a whole when one of its points is gone (`brokenReference`), so lowering the count would take every hole of the feature with it, while a pattern of the hole feature (D53) follows a count and loses only the copies it no longer makes. Deferred, with the pattern of the hole as the way.

**A wall along copies**: the wall reads own curves (`wallOutline` over the own curves of 6a's list, `notProjected` in its validator), and its faces `wallSide` and `wallEnd` would carry copies' IDs. Like the hole it would fail as a whole when the count drops; a pattern of the extrusion of one wall (D53) follows the count. Deferred.

**The offset of 2a and the taper of 2b** work over regions of copies unchanged: they read the exact loops of the regions (`selectionOutline`) and the shape of a side from 6a's list (`curveOf`), which has the copies. A test is owed. **The revolve** takes regions of copies and a copied line as its axis.

### Copies and the sketch tools

- **A copy is never cut, extended, filleted or used by a tool.** The tools take own curves and points already (6e: "the curve is not an own curve of the sketch"; the fillet: `cornerLines` reads own curves; the polygon and rectangle make own geometry). 6c gives the refusal its reason when the ID is a copy (`COPY_IN_TOOL`: "is a copy of the mirror or pattern …; change its source, and the copies follow"), and a corner on the axis between a source and its image is no corner of two own lines (the fillet refuses it; "Known limits").
- **A source changed by a tool**: the batch also patches every derived entry that lists a curve the tool changes, by `updateExternal`, so the copies keep the shape of their source. A split or a trim lists the pieces that stay in the place of the cut curve; a curve removed whole leaves the list (an entry left with no source keeps its last one, and is in `broken`); the fillet adds its arc where both of its lines are listed. An own curve the tool did not make from a listed one (the circle of a notch that a trim turns into an arc) is not added: whether the notch is to be copied is the user's choice, and until it is added the copy has a gap.
- **Regions over copies follow.** The fillet's patch by names adds `<entry>/<n>/<arc>` to every region that passes `<entry>/<n>/<line1>` and `<entry>/<n>/<line2>`, for every copy number the count of the document gives. 6e's rule of the faces runs over the profile with the derived entries: the sketch after the batch with the entries as the batch leaves them, the faces with the removed pieces put back into the lists that held them, the sketch as it was with the entries as they were (`deriveAll` over each, in memory). So a region of copies is followed as a region of own curves is.
- **The lists**: `moved` and `shortened` name a feature on a side face of a copy of a changed line as they name one on the side of the line (a copy starts at the copy of its `a`, the image of the source's start); `ids.entries` (a new list of the fillet and of 6e's fifteen) names the entries patched.
- 6e is implemented before 6c, so these are changes 6c makes to `sketch-tools.ts` and `sketch-cut.ts`, with tests.

## The document and the schema

- **No upgrade step, no new version.** A build without the kind refuses an entry of an unknown `type` by itself (`externalRef`, "promítnout jde jen hranu" today; after 6a the registry's text): such a document is an invalid document there, not a model with the copies dropped. An expression under `external/` alone (without its entry) cannot exist. Nothing else changes shape: region references and face names hold IDs with slashes, which every build accepts as strings, and face keys are never stored. `SCHEMA_PENDING` does not change. This confirms 6a ("No upgrade step for 6b, 6c and 6f").
- **Stamps** do not change: the copies are neither in the solver's input nor stamped, so no stored sketch is solved again on load.

## Where the code lives

| File | What 6c does there |
|---|---|
| `packages/engine/src/types.ts` | `EdgeProjection` (the name of today's interface), `SketchPattern`, `SketchTransform`, `ExternalRef` as their union with a comment on reference and derived entries; `addExternal` and `updateExternal` take `Input<ExternalRef>`; the warning `brokenCopies` with its comment. The AI reads these comments (`describe_api`) |
| `packages/engine/src/pattern-numbers.ts` (new leaf) | `MAX_PATTERN_COUNT`, `MAX_PATTERN_PLACES`, `GRID_STRIDE` and the four specs, moved from `features/pattern.ts`, which imports and re-exports them |
| `packages/engine/src/references/pattern.ts` (new) | the kind: `validate`, `refs` (none), `faces` (none), `entities`, `entity`, `commandProblem`, `derive` (the transforms, the copies, `occupies`, the joins through a grid) |
| `packages/engine/src/references/index.ts` (6a) | its line in `REFERENCE_KINDS`; `entityOf` asks `entity` and marks `derived`; the text for an unknown type lists `edge` and `pattern`; `updateProblem` refuses a change of source |
| `packages/engine/src/sketch-content.ts` | `Entity.derived` |
| `packages/engine/src/features/sketch.ts` | the derived stage of the step (`deriveAll`); the constraint validator refuses a derived operand; the validator fills derived entries after the curves (6a) |
| `packages/engine/src/sketch.ts` | `joinPairs` reads the declared `joins` (6a's slot) |
| `packages/engine/src/document.ts` | `addExternal`, `updateExternal` ask `commandProblem`; the expressions of entries (6a's slot) |
| `packages/engine/src/features/index.ts` | the text of `notProjected` names a copy as a copy |
| `packages/engine/src/face-roles.ts` | `faceKey` quotes a text field with a slash; its header |
| `packages/engine/src/sketch-tools.ts`, `sketch-cut.ts` (6e) | the refusal of a copy with its reason; the patches of entries; the regions of copies in the fillet's patch and in 6e's rule; `ids.entries`; the copies in `moved` and `shortened` |
| `packages/engine/src/index.ts` | `derivedPoints` leaves the exports |
| `packages/mcp/src/tools.ts` | `sketchDetail`: for an entry its expressions (by the field's path in the entry, as for constraints), `source: 'derived'` and `copies` (the copy numbers made) |
| `packages/mcp/src/api.ts` | a paragraph of the conventions: what a pattern of a sketch is, its IDs, that copies are not constrained, the ends on the axis, the idiom of holes for a count |
| `packages/app/src/references/pattern.ts` (new), one line of `REFERENCE_UI` | the row and the form ("The app") |
| `packages/app/src/sketch-tools/mirror.ts`, `linear-pattern.ts`, `circular-pattern.ts`, three lines of `SKETCH_TOOL_UI` | the tools |
| `packages/app/src/sketch-view.ts` (6a's reading of the result) | the style of derived curves; no snap to a copy |
| tests | `packages/engine/test/sketch-pattern.test.ts` (new), `face-roles.test.ts` (two expectations), `packages/scenarios/test/scenario15.test.ts` (steps 4 and 5, from calls.ts), MCP and app tests ("Tests the implementation owes") |
| docs | `architecture/sketch.md` (derived geometry: the kind, the step, joins, regions), `naming.md` (faces of copies, the quoted key), `ui/sketch.md` (the tools, the row, the form), `decisions.md` (D68), `backlog.md` (the row closed, what is deferred) |

## The app

- **The list of entries** of the sketch panel (6a's `REFERENCE_UI`, typed by every kind): the row of a pattern says "Mirror", "Linear pattern" ("Grid" with `second`) or "Circular pattern", then the number of sources and the axis, direction or centre with the count ("5 curves about origin/y", "4 curves, 5 along origin/x, 6 mm"); its warning, if any, as the rows of projections show theirs; the hover marks its copies; the button ✕ removes it. 6c adds to `ReferenceUi` one member, `edit`: a click on the row opens the entry's form.
- **The form**: the sources as a list with a button *Use selection* (the own curves and points selected); the kind of the transform; its line or point, picked in the view from the lines (points) that may serve, not copies; the numeric fields as text inputs that take expressions (`vents`, `deg(30)`), with the span kind as a select; for a linear pattern a switch *Second direction* with its line, count and span (the grid). It sends `updateExternal` in the input form; an invalid change is said with the engine's message.
- **Three tools of the sketch bar** (6a's `SKETCH_TOOL_UI`, after `fillet` and 6e's three): *Mirror*, *Linear pattern*, *Circular pattern*. Each takes the own curves and points selected before it as its sources; with none it says "Select the curves and points to copy first, then pick …" and does nothing. *Mirror* and *Linear pattern* pick a line (`picks: 'curve'`, `eligible`: a line that is not a copy); *Circular pattern* picks a point (a place snapped to a point that is not a copy). One click sends `addExternal` with a fresh ID (`m1`, `p1`, …) and opens the form. The pattern tools have a panel while active (6a's `options`): the count (initial `3`), and the spacing (`10`) or the angle (`360°` meaning the full turn), as text that may be an expression.
- **The copies are drawn** from `SketchResult.curves` in the style of derived geometry (dashed, the colour of projections, not the colour of own curves), their points without handles. No place snaps to a copy while drawing (a curve may only run over own points, and a `coincident` with a copy would be refused); the constraint buttons stay off while the selection has a copy; the select tool selects a copy (to find its entry), and the row of its entry is marked.
- **Regions of copies** are picked for an extrusion as any region: they are in `regions` of the result.
- The snapshots of the app change by the three buttons of the bar and nothing else; the commit says so.

## MCP

- **No tool and no change of a tool's schema.** An AI adds a mirror or a pattern with `execute` and `addExternal` (`{ type: 'pattern', entities, transform }`), changes it with `updateExternal` (the whole entry, input form) or one number with `setField` on the sketch (`external/<id>/transform/count`), and removes it with `removeExternal`. `describe_api` shows `SketchPattern`, `SketchTransform` and `brokenCopies` with their comments, since they are in the part of `types.ts` it cuts out.
- **`get_sketch`** lists the entry as 6a makes it (its fields, `entities` with the copies the count makes, `at` the positions of their points) plus `source: 'derived'`, `copies` (the numbers made, `[1, 2, 3, 4]`) and `expressions` (`{ "transform/count": "vents" }`). The regions with their copies are in `regions`.
- **A paragraph of `api.ts`** (its conventions): the IDs of copies; constrain the sources, not the copies; the ends of a mirrored half on the axis by a constraint; a count follows a parameter, and a feature that should follow it names a region the copies lie in (they are its holes); a feature that names a region of a copy names that copy, and a copy above the count is a broken reference; a projection or a copy is no source.
- The fillet's description gets one sentence (the arc joins an entry that lists both lines, `ids.entries`); 6e's lists get `entries`.

## Issue codes

`brokenCopies`, a warning of the sketch (in `WarningCode`, with the comment the contract writes): an entry cannot make all its copies. It is not `brokenReference` (an error code) because the sketch itself is fine: it is solved, its profile found, its own regions usable.

## Later kinds

- **6b (projection from another sketch, the axes of the origin).** `origin/x` and `origin/y` become lines of every sketch's list, so they serve as an axis or a direction with no change in 6c (`commandProblem` accepts any line entity that is not a copy). A projection of an entity of another sketch may be a copy there (6b: "its own, projected or derived entities too"); its join key is the vertex of the copy's point in that sketch by the joins of the whole sketch, the derived joins included. A projected line serves as an axis; a projection is no source.
- **6d (splines).** 6d is merged after 6c and adds the spline to the derive's exhaustive switch: a copy of a spline runs over the copies of its control points in the same order (the image of a clamped B-spline under a rotation, a translation or a reflection is the B-spline of the images of its control points; a spline has no sense to turn), and `occupies` compares the control points in order or reversed. The grip of step 4 is then a spline.
- **6f (import of an outline).** A line of an outline serves as an axis or a direction, a point as a centre. An outline is no source (deferred with the other reference sources).

## Rejected alternatives

1. **Mirror and pattern as sketch tools** that draw own copies tied by constraints (`symmetric`, the construction of the polygon). The count would not follow a parameter, and drawing again would make new IDs (the plan; agreed by the owner).
2. **Three kinds of entry** (`mirror`, `linearPattern`, `circularPattern`). D53 made one feature type with three transforms; the same shape here lets an AI carry over what it knows, shares the specs, and lets an update switch the transform and keep the entry.
3. **`AxisRef` and `PlaneRef` for the axis and the direction** (as D53). A sketch names its own entities by ID; an `AxisRef` names a line of a sketch through the sketch too, and would let a mirror in sketch A use a line of sketch B, which needs 6b's projection.
4. **Joins only between a copy and its own source, with 6a's keys for joined sources.** A chain that a pattern carries onto its own start does not close (measured).
5. **Joins by position for every point of the sketch.** Changes today's profiles (6a's alternative 4); only images, which no constraint can join, join by position.
6. **Leaving a copy that lies on its source out of the curves** (6a's wording). Whether an ID exists would then depend on solved positions; kept with `regions: false`.
7. **Entities by the count of the document only.** A batch that raises a parameter and names a new copy would be refused; D53's rule for bodies is the precedent for accepting every possible number.
8. **Checking the sources and the axis in the validator.** A document whose source curve was removed (6a: `removeEntity` does not look at entries) would not load.
9. **`removeEntity` removing a source from the entries that list it.** A command that changes another part of the document without being asked; the step's warning says what is gone, and `updateExternal` repairs it, as a feature with a removed reference is repaired.
10. **Holes and walls at copies now.** Cheap, but a hole or wall feature fails as a whole when a copy goes, while a pattern of the feature (D53) follows the count.
11. **A region reference that names all copies of an entry** (a wildcard), so that a cut follows the count. A change of `RegionRef` and of how regions are named, which every reference depends on; copies inside an outline already follow as its holes.
12. **Copies of reference geometry and of copies.** A second kind of copy (fixed points) and an order among derived entries, for cases a projection made in the needed shape or D53's grid covers.
13. **A sketch tool or a command of its own** (`addSketchPattern`, `setPatternCount`) for MCP. `addExternal` and `setField` do it, and 6a decided one family of entries.
14. **The copies in the solver's input as fixed geometry**, so that constraints could name them. They do not exist before the solver; a second solve after the derive would make the sketch depend on its own copies.

## Known limits

- **The time of the profile** grows with the square of its curves (measured: 200 copies of a 4-curve slot, 801 curves, 313 ms at every recompute of the sketch, a drag included). D53's bounds hold (200 per direction, 200 places); a broad phase in `detectProfile` (sorting by bounding boxes) would remove it and is not part of 6c.
- **The seam of a mirrored line**: a line from the axis and its image are two collinear curves and two coplanar side faces with an edge between them (a chamfer of the edge along the lid's bottom needs both). A line across the axis listed as a source avoids it ("Joins").
- **A corner between a source and its image** (on the axis of a mirror) cannot be filleted by the tool: it is no corner of two own lines. A fillet drawn on the source half up to the axis is copied.
- **Copies that cross own curves, each other, or their source** make the profile invalid, and 6e cannot cut a copy. The source has to be changed.
- **The end of a mirrored half must lie on the axis by a constraint**, within 1e-6 mm.
- **A feature that names a region of a copy** names that copy; new copies do not join it (the idiom of holes in "When the count drops").
- **A batch that names a copy above the count** is valid; the copy is a broken reference until the count reaches it (as in D53).
- **A new curve that closes a trimmed source** (the arc of a notch) is not added to an entry by 6e's tools: the copy has a gap until it is.
- **Copies of points** serve generators, axes, the query `measure` and later sketches, not holes.
- **Before 6b** there are no `origin/x`, `origin/y`: a mirror about the Y axis is a mirror about a construction line through the origin.
- **In the app** a grid is made in the form of an entry, not by a tool of its own.

## To verify before the implementation

- **6a's code, which this design is written against**: the registry and `DerivedKindSpec` (6c adds `commandProblem` and `entity`), the derived stage left free in the step, `SolvedOwn` (with the axes of 6b later), `joinPairs` and `joinsOf`, the list of curves read by `curveOf`, `axis` and `generated`, `SketchResult.curves`, `REFERENCE_UI` (6c adds `edit`), `SKETCH_TOOL_UI` and `picks: 'curve'` with `eligible`. Where 6a's implementation differs, the plug-in points of this design move with it.
- **The joins through a grid of cells** find every pair within the tolerance at a cell boundary (the prototype looks into the 3 × 3 neighbouring cells of 1e-3 mm cells; the code should take cells of the tolerance and the neighbours, and be tested at a boundary).
- **A drag** in a sketch with 50 to 200 copies: whether the time of the profile is acceptable in the app; if not, the broad phase of "Known limits" is the cure, or the app skips the profile while dragging.
- **The faces of copies through the kernel**: an extrusion of the lid of step 4 (the face table with quoted keys, the edges between `side/c1` and `side/"m/1/c1"`, a sketch on the side of a copy), which the prototype did not build.
- **6e's rule of the faces with copies**: a trim of a source curve whose copy closes a region with it (the lid's flank trimmed by a notch), with the entries patched, followed by the face rule; the fillet of a source corner (calls.ts).
- **`setField` on a sketch** for an entry's field: `fieldsOf(sketch)` lists the field, and the field of a grid's second direction is reached only while the entry has one (as `when` does for a feature's variants).
- **The expressions of an entry and `withConstraints`**: an `addConstraint` or `removeConstraint` in a sketch with a pattern keeps the entry's expressions.

## Tests the implementation owes

- **Engine, the kind**: the form (each kind of transform, a field of another kind refused, ranges, repeats, an empty list); `commandProblem` (a projected curve, a copy, a missing ID, an arc as an axis, a copy as an axis, direction or centre); `entity` (copy numbers by kind, leading zeros, a grid number, a point of a listed curve, a source not listed); `entities` by the count; a constraint, a curve, `removeEntity` and `dragPoint` on a copy refused; `updateExternal` across sources refused, across transforms allowed.
- **Engine, the derive**: each transform with lines, arcs and circles (a reflected arc swapped; a turned arc not), a point alone, `origin` in a copied curve, shared points of two curves, a construction curve, a count of 1, the span by length, a negative spacing and angle, a grid and its numbering, a grid too large and with two places in one, a missing axis, a line of no length, a missing source with the rest copied, `occupies` (a line on the axis, a circle at the centre, a half circle, a D), the joins (an end on the axis, a ring of teeth, two joined source points, a hidden point not joined, the cell boundary), the result's curves, points and radii, the stamp unchanged by a change of the count.
- **Engine, fields**: an expression in a count (add, update, `setField`, `renameParameter`, a failing expression keeps the last number with `invalidExpression`), `withConstraints` keeping them across constraint commands, `removeExternal` dropping them, `fieldsOf` of a sketch with a grid.
- **Engine, faces**: the quoted key (`face-roles.test.ts`, the two expectations changed and a case of a side of a copy); an extrusion of regions of copies with a copy tag of a later pattern.
- **Engine, consumers**: a generator at a copied point; a revolve about a copied line; a revolve and an extrusion with an offset (2a) and a taper (2b) of regions of copies; a hole at a copy refused with its text; a count that drops under each consumer and rises again.
- **Engine, tools**: the fillet of a source corner (the entry, the regions of copies, `ids.entries`, `moved` of a sketch on a copy's side); 6e's trim and split of a source curve (entries patched, regions of copies followed); every tool refusing a copy with its reason.
- **Scenarios**: scenario 15, steps 4 and 5 and the part of step 7 (calls.ts), with the volumes by hand.
- **MCP**: `get_sketch` of an entry (`source`, `copies`, `expressions`); the examples of the conventions run.
- **App**: the three tools by clicks (with and without a selection), the row and its form (a field as an expression, the second direction, *Use selection*), the copies drawn and not snapped to; the snapshots change by the three buttons.

The review of the implementation is a full one: new geometry (the derive, the joins) and the step of the sketch (CLAUDE.md, "Depth of the review").

## Open

For the owner:

1. **Copies join any point at their place** (an image with an own, reference or other copied point within 1e-6 mm), where 6a wrote that points are not joined by position and gave copies join keys. Own points stay as they are; without it a pattern of a chain onto its own start (a ring of teeth, a rack) never closes. *Recommendation: yes.*
2. **Holes and walls at copies deferred**, with a pattern of the hole or wall feature (D53) as the way, because a hole or wall feature fails as a whole when a copy it names goes. *Recommendation: yes.*

## Reviews

The design, the contract and the calls were written on Opus 5.5.

(Filled in by the rounds below.)

## Rows for the indexes

**docs/d36/README.md**, the row of 6c, column "Design now":

> full ([6c-sketch-mirror-pattern/design.md](6c-sketch-mirror-pattern/design.md), D68): one derived kind of entry of `external`, `pattern`, with the transforms of D53 in the plane of a sketch (`mirror` about a line, `linear` along a line with `second` a grid numbered `i + 1000 · j`, `circular` about a point; count, spacing, length and angle numeric fields at `external/<id>/transform/…` that take expressions); copies of own curves and points computed after the solver under `<entry>/<copy>/<source>`, forming regions as their source (a copy that occupies its source forms none), naming side faces with the slashed ID quoted in the key, never operands of a constraint of their own sketch; images join any point at their place (a mirrored half closes, a ring of teeth closes); entities by the form of a copy ID, as D53's bodies; a lower count makes references to the copies broken, a higher one keeps every name; the fillet and 6e's tools patch the entries that list a changed source; the warning `brokenCopies`; no command, no schema step. Open for the owner: joins by position for copies, holes and walls at copies deferred

**docs/decisions.md**, the row of D68:

> | D68 | [6c Mirror and pattern in a sketch](d36/6c-sketch-mirror-pattern/design.md) | designed 2026-11-17 | Mirror and pattern in a sketch are derived geometry: one kind of entry of `external`, `pattern`, with D53's transforms (mirror, linear with a grid, circular) and numeric fields that take expressions; copies `<entry>/<copy>/<source>` of own curves and points computed after the solver, forming regions as their source, never constrained in their own sketch, joined to any point at their place; a lower count leaves broken references, a higher one keeps every name; no schema step |

**docs/requirements.md**, validation scenario 15, a sub-item after the one of 6e:

> - *Lid outline and vents (6c, D68).* The right half of the lid outline (W × H, corners of radius R, the top ending on the Y axis by a constraint; the grip flank a line until 6d) is mirrored about the Y axis as a pattern entry of the sketch: one region holds both halves (W·H − (4 − π)R² within the chord tolerance), its side faces are named by the copies' IDs, and the width moves the copy. A slot and a linear pattern of it with the count `vents` and the spacing `ventPitch` in the lid's sketch are holes of the lid's region, which keeps its name; a second row in a sketch of its own is cut through the lid by the regions of copies 1 and 3. `vents` from 5 to 7: two more holes, no feature patched, the cut keeps its references and its volume; 3: the cut is `noProfile` naming the region of copy 3, and 5 brings it back. The count is a numeric field of the sketch (`setField`, `renameParameter`). Also: a bolt circle as a circular pattern (the Onshape converter's lost `CIRCULAR_PATTERN`), a ring of teeth closed by a circular pattern of an open chain, a grid numbered as D53, a D whose diameter lies on the axis, the fillet of a source corner copied. Refused: a constraint, a curve, a removal or a drag on a copy, a copy as a source or an axis, an arc as an axis, a missing source, a count of 201, a change from derived to reference geometry, a trim of a copy.
