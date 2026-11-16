# 2e Linear pattern and mirror of features and bodies (D53)

**State: designed 2026-11-16, not implemented.** Written against the code of `master` at `cdf5995`, with tracks A, B (2a, 2b, 2c, 2f), E (3a), H (5a, 5e, 5f) merged. The engine side was built as a prototype in a copy of the repository and run against the real adapters; the numbers are under "What was measured". The reviews and what changed after them are under "Reviews".

Files: [contract.ts](contract.ts) (the two variants of the transform, their fields, the rule of a mirrored tool), [calls.ts](calls.ts) (its part of validation scenario 12).

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "Bodies and features": *Linear pattern and mirror of features and bodies. Further kinds of the transform of the D35 pattern. Mirror reverses the winding, which the transform function of point 4 handles.* [architecture/pattern.md](../../architecture/pattern.md) says the same from the other side: the step asks one function for the transforms of the copies, "so a linear pattern or a mirror is another kind and nothing else".

| Statement | What the code says |
|---|---|
| "Further kinds of the transform" | True for the step: `step` of `features/pattern.ts` gets a list of `RigidTransform` from `transformsOf` and does not look at the kind again. Not the whole of it: the validator (`patternFeature`) reads the fields of the one kind inline, `refs` lists `transform.axis`, and `transform/count` is listed in the registry without a condition, which is wrong for a kind without a count |
| "Mirror reverses the winding, which the transform function handles" | True for a body: `transformSolid` (`solid.ts`) swaps two vertices of every triangle when the determinant is negative. False for a tool: a copy of a feature is not a moved mesh, `build` of the recipe builds it again in `transformFrame(placement.transform, frame)`, and `buildPrism` and `buildStack` wind their triangles as for a right-handed frame (the comment of `buildStack` says so; 2b and 2f left it "to be agreed with 2e"). Measured: every kind of tool comes out facing inwards, and the kernel adapter refuses it (`kernelFailure`, "síť je orientovaná dovnitř"); nothing is cut or added wrongly |
| The descriptions of faces under a mirror | `FaceInfo` carries no side: the normal of a plane and the axis of a cylinder are unsigned, and the axis of a cone is a vector from the apex to the face, which a linear map keeps right. `transformFace` and the builds therefore need nothing. Measured on every kind of face |
| A reference to the mirror plane | `PlaneRef` (a base plane, a plane feature, a planar face) with `planeRef`, `planeRefs` and `frame(ref, state)`, as the plane of a sketch and the end of an extent `upTo` use them. Nothing new is needed |
| A reference to a direction | `AxisRef` (a base axis, or the normal of a sketch plane through a sketch point) with `axisRef`, `axisRefs` and `axis(ref, state)`. It names a line; a direction is the direction of that line. It has no kind for a direction that lies in a sketch plane (a line of a sketch) or along an edge; the owner deferred further kinds of `AxisRef` to come together (5a, "Open", 2026-11-16) |
| Copy IDs (3a, 5a) | A copy of a body is `<pattern>/<number>`; `createsBody` and `bodySource` of the pattern's entry in the registry decide by the source alone, not by the kind of the transform. A new kind of the same feature type inherits both |
| The extent `upTo` and the hole in a copy (2f, 2c) | Both measure in `build`, in the frame of the copy: the way to the plane the feature saw, the reach of the targets for "through all", and the mark `refuseChange`. Nothing in them asks what kind of transform made the frame |
| An older build and a new kind | `patternFeature` picks the kind from a list of one (`oneOf(transform.type, ['circular'])`). Measured: `master` refuses a document with either new kind on load (`invalidDocument`, "features[2].transform.type: čeká se jedna z hodnot circular") |

## The cheap variant

```ts
type PatternTransform =
  | { type: 'circular'; axis: AxisRef; count: number; span: { type: 'full' } | { type: 'angle'; angle: number } }      // as today
  | { type: 'linear'; direction: AxisRef; count: number; span: { type: 'spacing'; spacing: number } | { type: 'length'; length: number } }
  | { type: 'mirror'; plane: PlaneRef };
```

- **Two more variants of the transform of the feature type `pattern`.** The source (a list of features that apply a tool, or one body), the copies, their numbers, their face names, the atomic failure and the warning `noEffect` are those of today for every kind.
- **Linear**: `count − 1` copies shifted along a direction. The direction is an `AxisRef` of which only the direction is used. The span is the spacing between neighbours, or the length between the original and the last copy. One direction.
- **Mirror**: one copy, the mirror image in a plane given by a `PlaneRef`. No count; the copy has the number 1.
- **A mirrored tool is turned over in one place.** `applyTool` reverses the triangles of a tool whose placement mirrors; no build changes.
- **No new feature type, command, query, face role or issue code, and no upgrade step.**
- **The app**: the form of the pattern gets a select of the kind and the rows of each kind. **MCP** needs no code.

What the package adds, place by place:

| Place | Added |
|---|---|
| The document | two variants of `PatternTransform` (`linear`, `mirror`); nothing else changes shape |
| Commands | none; `addFeature`, `updateFeature` and `setField` carry the variants |
| Queries, export formats, operations of the app | none |
| Feature types | none; the entry `pattern` of the registry gets the fields of the variants and its summary |
| Face roles, face names | none; a face of a copy is the name of its source with the tag of the copy |
| Issue codes | none ("Issue codes" lists what the new kinds report) |
| The schema | no step ("Document and validation") |
| The app | the entry `pattern` of `FEATURE_UI`: its form and its lines in the model panel; the picker of an axis gets an option; no panel, no view of a query |
| MCP | no code; one paragraph of `CONVENTIONS` |

**Deferred:**

- **A grid** (rows and columns) and **a mirror of a mirror of features**: a pattern of features as a source of another pattern. See "A grid is a pattern of a pattern, later".
- **A pattern of several bodies** in one feature. The ID of a copy would have to name its source as well as its number.
- **A direction in a sketch plane or along an edge**, and an axis of a bore: further kinds of `AxisRef`, which come together for the pattern, the joints and the mass query (decided by the owner with 5a). The linear pattern takes them without a change of its own.
- A linear pattern to both sides of the original, copies left out of a row, a pattern along a curve.
- Joining a body with its mirror image into one body: the boolean of bodies of 3d.
- A button *Mirror* of its own on the toolbar.

## Decisions

### Kinds of the transform, not feature types

A mirror is `type: 'pattern'` with `transform.type: 'mirror'`, not a feature type `mirror`.

- Everything but the list of transforms is shared: the source, the placement of tools, the copy of a body with its faces, the tags, `createsBody`, `bodySource`, the form of the source in the app. A second feature type would repeat the module or share it through a third file.
- What other packages hang on the type stays true without a line: a face name refers to "the pattern that made the copy" (`RefKind` `pattern`, checked by `faceRefs` and `requireFace`); body properties ask `bodySource`; a link lists `<pattern>/<number>`.
- The cost is a word: a mirror is called a pattern in the document and in the title of the type. The app names a new draft by its kind (`Mirror 7`), and the summary for the AI says what the three kinds are.

### Linear: the direction is an axis

`direction: AxisRef`, validated by `axisRef`, listed by `axisRefs(direction, 'transform/direction')`, resolved by `axis(ref, state)`; only `direction` of the answer is used.

- A base axis points along its positive half. A sketch gives the normal of its plane: for a sketch on a face that is out of the body. A negative spacing or length runs the other way, so no kind needs a flag for the sense.
- The point of `{ kind: 'sketchPoint' }` does not matter for a direction. The reference is still checked as written: a point that is gone is `brokenReference`. `origin` always exists, and the app sends it.
- Not a type of its own (`{ kind: 'base' } | { kind: 'sketchNormal'; sketch }`): it would need its own validator, references, resolver and picker for less, and every kind `AxisRef` gets later (a line, the axis of a bore) would have to be added twice.
- The field is `direction`, not `axis`: the two kinds then share no field but `type`, `count` and `span`, and a patch that switches the kind cannot half-merge. (A patch with another `type` replaces the transform anyway.)
- **The limit**: a direction that lies in the plane of a tilted sketch has no reference yet. Base axes cover a part that is modelled along them, which a bracket and a box are.

### Linear: two spans, and where a copy stands

- `spacing`: copy `k` is shifted by `k · spacing`. A larger count adds copies at the far end and moves none, so `<pattern>/3` and a face tagged `index: 3` stay what they were. This is the span to prefer when something refers to a copy.
- `length`: the distance between the original and the last copy; the step is `length / (count − 1)`. It is the linear form of the span `angle` of the circular pattern. A change of the count moves every copy; a count of 1 has no copy and does not divide.
- Both are numeric fields in millimetres, not zero (`nonZero`, as the angle of the circular pattern), without a bound of their own; the general bound of a document number holds.
- The fields are named after their span (`transform/span/spacing`, `transform/span/length`), as `transform/span/angle` is. Not `step`: a later span of the circular pattern "angle between neighbours" would then share a path with another unit.
- `count` is the field of today: `transform/count`, an integer from 1 to 200 that includes the original.

### Mirror: a plane reference, one copy

- `plane: PlaneRef`. For a face it is the plane the face lies in. The plane is resolved in the state before the pattern, so a pattern may mirror in a face of its own source or target.
- `brokenReference` and `nonPlanarFace` with the plane in `refs`, the codes and the shape of `refs` an extent `upTo` gives for its plane.
- The natural plane of a symmetric part is a base plane, or a plane feature offset by half an expression (`offset: 'L / 2'`); the midplane of two faces is 5c.
- One copy with the number 1. A count would mean nothing (the mirror image of the mirror image is the original).

### A mirrored tool is turned over by `applyTool`

A copy of a feature is built in the frame of the copy, so that "through all" and the way to a plane are measured where the copy stands (D35 point 4, D47). In a mirrored placement that frame is left-handed, and a build that places vertices by the frame gives exactly the mirror image of the tool, with every triangle facing inwards.

- **The rule**: a build places every vertex by the frame it is given and winds its triangles as for a right-handed frame; it does not look at the handedness. `applyTool` (`recompute/services.ts`), the one place that builds a tool for a copy, reverses the triangles when `mirrors(placement.transform)`. One line, for every build of today and for the revolve of 4a.
- `buildPrism` and `buildStack` satisfy the rule as they are: vertices come from `toWorld(frame, u, v, w)`, the winding from the order of the 2D triangulation and the sign of the levels along the normal. The descriptions of the faces are built from the frame and are right in a left-handed one (first table).
- The other half of 2b's suggestion, "the wrapper of `build` that tags the faces of a copy", is not taken: that wrapper exists once per module (`extrude.ts`, `hole.ts`), and a module that forgets it would pass every test without a mirror.
- A mistake here cannot pass silently: a tool that faces inwards is refused by the kernel adapter before any boolean.

### What a mirrored copy is

The copy is the mirror image of its source as a set of points; the measurements agree to the precision of the meshes. Four things follow from the rules the engine already has, and are stated so that nobody has to find them:

| | In a mirrored copy |
|---|---|
| Face names | The name of the source face with the tag of the copy, as for every pattern. A name says which face it is the image of, not where it lies: the `wallSide` of a curve with `side: 'left'` is on the right of the image of the curve, and the flats of a nut pocket, counted counter-clockwise from the corner the rotation points to, run clockwise |
| A sketch on a face | The frame is right-handed with the normal out of the body, as every sketch frame ([naming.md](../../architecture/naming.md)): the origin and the Y axis are the images of those of a sketch on the source face, and X = Y × N is the opposite of the image of X. A sketch on a face of the copy is thus not the mirror image of the same sketch on the source: its `x` coordinates run the other way |
| The ends of a projected line | A line is oriented by `n_a × n_b` of the outward normals of its two faces, and a mirror reverses a cross product: the end `<id>/a` of the copy's edge is the image of the end `<id>/b` of the source's |
| Two mirrors | A mirror of a mirrored body is a turned copy: the three rows above hold for an odd number of mirrors among the tags of a face |

Names stay stable through a recompute in every row; that is what a name is for. Changing the rule of the frame or of the ends for copies with an odd number of mirrors (so that a mirrored sketch would be the image) was considered and rejected: "X = Y × N, normal out" and "`a` is the lower end along `n_a × n_b`" would then depend on the history of a face.

### Copy IDs, body properties and links

Nothing changes, and that is the decision: a linear pattern or a mirror of a body creates `<pattern>/<number>` from 1.

- **3a**: `bodySource` answers with the source for every kind, so a mirrored pad is made of what its source is made of, and a copy of a copy follows the chain. Measured: `padXY/1` ← `padX/1` ← `pad` inherits the material and the density, and the mass query weighs it.
- **5a**: a link lists a copy like any body; the pose of a link is composed of turns and shifts and never mirrors, whatever the bodies are.
- The numbers of a linear pattern with a `spacing` are stable against the count; see above.
- **A mirrored copy is not the same part as its source.** A row of copies is one part several times; a mirror image is another part (a left and a right bracket) unless the part is symmetric. Nothing reads that today. The parts list (3e) and a robot description that would write one mesh for a body and its copies (5b) have to tell them apart, and can: follow `bodySource` and count the patterns with a mirror on the way.

### `upTo` and holes in the copies of the new kinds

Both keep the rules of their packages, because the rules never asked for the kind of the transform:

- **`upTo`** (D47): the plane is resolved once, in the state before the source feature, and every copy runs from its own start to that plane. A row of posts under a tilted lid gets a length per post. A mirrored copy runs to the same plane, not to its mirror image: where the mirror maps the plane onto itself (a lid above a vertical plane of symmetry) the copy is the mirror image; elsewhere it ends where the original ends, which is what "up to this face" says. The direction of a copy follows the plane as for the original; a copy the plane passes through, or one parallel to it, is `invalidExtent` with the copy first in `refs`, and the pattern is in error.
- **A hole** (D46): "through all" measures the targets as they are when the copy is applied, in the direction the copy points in, so a hole in a copied post goes through the post that the same copy has just added: the sources are listed in their order (`['post', 'hole']`), and the pattern applies them in that order for each copy. The mark `refuseChange` of a head as deep as the targets holds per copy.
- Measured in a mirrored placement and in a row: a prism with a tilted end, a tapered stack, a wall, the four kinds of hole, blind and through.

### A grid is a pattern of a pattern, later

A grid of slots or holes is the first thing a linear pattern is asked for, and the cheap variant does not have it. Two ways were weighed:

1. **A second direction inside `linear`** (`second?: { direction, count, span }`). One feature, for features and bodies. But a copy has one number, and any numbering of a grid by one number moves copies when a count changes (row by row: a change of the first count renumbers every row but the first). A sketch on a face of copy 5, a target `<pattern>/5` and a link that lists it would silently mean another copy.
2. **A pattern of features as a source of a pattern.** `producesTool` answers true for a pattern of features, its recipe is the recipes of its sources in each of its placements, and `Placement.copy` becomes a list. A grid is then a row of a row, and a face of it carries two tags (`[{ pattern: 'row', index: 2 }, { pattern: 'grid', index: 1 }]`), which the names, their keys and the references already allow ("a pattern of a pattern appends another tag"). Each count keeps its own numbers. The same step gives a mirror of a mirror (four corners from one) and a circle of rows.

The second is the design to take, as a package of its own: the recipe of a pattern, a bound on the product of the counts, and the shape of `refs` for a copy inside a copy need their own decisions and tests. Until then:

- a grid of holes is a hole feature with the points of a sketch, and a grid of slots is an extrusion of several regions;
- four corners from one are two mirrors and a circular pattern of two about the line the two planes meet in (two mirrors make a half turn), each listing the same sources;
- for bodies, a mirror of a copy is allowed today (a body source may be a copy): the four pads of the scenario are three mirrors.

Nothing of this package blocks it: no document changes shape, and a build without it reports a pattern listed as a source as `brokenReference` in the recompute (a command refuses it: "is not a feature that applies a tool").

## Recompute

`transformsOf(transform, state)` answers the transforms of the copies, the original excluded:

| Kind | Resolves | Transforms |
|---|---|---|
| `circular` | `axis(transform.axis, state)` | as today |
| `linear` | `axis(transform.direction, state)`, the direction only | `shift(direction, k · step)` for `k` = 1 … `count − 1`; `step` is `spacing`, or `length / (count − 1)` (zero copies for a count of 1) |
| `mirror` | `frame(transform.plane, state)` | `[reflection(origin, normal)]`; an error code of `frame` is the error of the pattern, with the plane in `refs` |

`reflection(point, normal)` joins `rotation` and `shift` in `solid.ts`: the matrix `I − 2 n nᵀ` and the translation `2 (n · p) n`.

The rest of the step is unchanged. `applyTool` gets one line (above). `transformSolid` and `transformFace` are unchanged.

## Document and validation

- `patternFeature` picks the kind from `['circular', 'linear', 'mirror']` and validates the fields of that kind. Every variant lists its fields (`onlyFields`): `count` on a mirror, `axis` on a linear pattern, `length` in a span `spacing` are invalid commands.
- References: `refs` lists `axisRefs(direction, 'transform/direction')` or `planeRefs(plane, 'transform/plane')`, so `moveFeature` keeps the pattern behind the sketch of its direction, the plane feature, the body of the face and every pattern in the copy tags of that face. A command verifies only a reference the feature did not have before, as everywhere.
- Numeric fields in the registry (`contract.ts`, `PATTERN_FIELDS`): `transform/count` once for `circular` and once for `linear` (a condition names one value; `extent/start` is listed twice the same way), `transform/span/angle`, `transform/span/spacing`, `transform/span/length`. `fieldsOf` reports what the validator read, so a mirror has no numeric field.
- `updateFeature`: the patch rules of today. A transform of the same `type` merges by field; another `type` replaces the transform, has to be complete, and drops the expressions under `transform/`; `direction`, `plane` and a span of another type are replaced whole.
- **The schema: no upgrade step.** The rule of `schema.ts`: a step is needed for what a build without the addition would drop without a word; none "where a build without the addition refuses by itself: a new feature type, a new variant, a field where the validator lists the fields it allows". A build of `master` refuses both kinds on load (measured, first table), and the new variants list their fields, so a later field of them is refused by this build in turn. `SCHEMA_VERSION` stays 6 and `SCHEMA_PENDING` is not touched. Documents of today load unchanged: a circular transform is what it was.

## Where the code lives

| File | What 2e does there |
|---|---|
| `packages/engine/src/types.ts` | the two variants of `PatternTransform` with their comments (read by `describe_api`); the comment of `PatternFeature` ("rigid transforms" becomes isometries: a mirror is one) |
| `features/pattern.ts` | the validation per kind, `transformsOf`, the references, the fields, the summary of the type |
| `solid.ts` | `reflection`, `mirrors` (the sign of the determinant, which `transformSolid` computes privately today), turning the triangles of a solid over (shared with `transformSolid`); the comments that say "a mirror, later" |
| `recompute/services.ts` | `applyTool`: the tool of a mirrored placement is turned over |
| `recompute/state.ts`, `recompute/tool-prism.ts`, `recompute/tool-stack.ts` | comments only: the rule of a build in a left-handed frame, at `ToolRecipe.build` and where `buildStack` says the solid "comes out turned inside out" |
| `packages/mcp/src/api.ts` | `CONVENTIONS`: the paragraph of the pattern (below) |
| `packages/app` | below |
| docs | `architecture/pattern.md` (the kinds, the mirrored tool, "What a mirrored copy is"), `architecture/naming.md` (the frame of a sketch and the ends of a line on a mirrored copy), `architecture/extrude.md` (the limit "to be settled with the mirror of 2e" goes), `ui/pattern.md`, `architecture/verification.md` |

The prototype of the engine side is 75 lines added and 23 removed in four files (`types.ts`, `features/pattern.ts`, `solid.ts`, `recompute/services.ts`); with it the tests of the engine, the scenarios and MCP pass but for the three that pin the list of kinds and of fields (`pattern.test.ts`: the fields of the registry, and "`transform.type: linear` is refused"; `tools.test.ts`: the numeric fields of the pattern).

## The app and MCP

**MCP.** No code: `execute` and `preview` take the commands, `describe_api` is generated (the types from `types.ts`, the fields from the registry). The paragraph of the pattern in `CONVENTIONS` is rewritten to say:

- the three kinds and their fields; that the count includes the original, and that a mirror has one copy, number 1;
- the direction of a linear pattern (the positive half of a base axis, the normal of a sketch plane, the sign of the spacing), and that `spacing` keeps the numbers of the copies when the count changes while `length` does not;
- the plane of a mirror, and that a plane of symmetry is a base plane or a plane feature with an expression;
- what a mirrored copy is: the four rows of the table above, in two sentences;
- that a copy goes to the targets of its source, so what a mirrored body should get later belongs before the mirror on the timeline;
- how to make a grid and four corners today.

**The form of the pattern** (`features/pattern.ts` and `changePattern` in `sketch-commands.ts`):

- **Kind**, a select below *Repeat*: *Around an axis*, *Along a direction*, *Mirror in a plane*. The form remembers the transform the draft had in each kind and returns to it, as it remembers the angle today. A new linear pattern starts with the axis X, a count of 3 and a spacing of 10; a new mirror with the base plane YZ.
- **Along a direction**: the picker of an axis with the label *Direction* and without the row of the point (`axis-picker.ts` gets an option for that; the reference keeps `origin`); *Count*; *Span*, a select with *Spacing between neighbours* and *Length between the first and the last copy*, and its field in millimetres or as an expression.
- **Mirror in a plane**: the plane chosen, by its label (`planeText` of `features/plane.ts`), a select with the base planes and the plane features before the pattern, and a button *Pick*. While it is armed the next click in the view takes a plane or a planar face (`host.planeRefOf`), as in the form of an extrusion up to a plane; otherwise a click picks the source body as today. A face of the preview's own copy is refused with a message.
- A new draft is named by its kind while its name is the default one (`Pattern 7`, `Mirror 7`).
- The summary in the model panel says the kind: "Count 5 with the original, along axis X, spacing 4 mm; features: Vent" and "Mirrored in Mid plane; body: Pad".
- The toolbar keeps the one button *Pattern*; its title names the three kinds.
- Texts of issues are those of today (`copy 1 of Rib`); a face of a copy is described with its copy as today.
- Tests of the app: `changePattern` for the kinds (`sketch-tools.test.ts`); the form in `app.test.ts`, whose snapshots of the pattern form change by the row *Kind*, which the commit says.

## Issue codes

None is added.

| Code | Kind | When, for the new kinds |
|---|---|---|
| `brokenReference` | error | the sketch or the point of the direction, or the plane, the body or the face of the mirror, is not in the state before the pattern; a source is missing, suppressed or in error (as today) |
| `nonPlanarFace` | error | the face of the mirror is not planar |
| `invalidExpression` | error | a count, a spacing or a length whose expression fails or leaves its range (a spacing of zero) |
| `invalidExtent`, `invalidHole`, `emptyResult`, `kernelFailure` | error | a copy fails as copies do today; `refs` start with `{ copy, feature }` |
| `noEffect` | warning | copies that changed none or only some of their targets, as `{ copy, feature, targets }` |

## Shared vocabulary

- **Takes:** `AxisRef` and `PlaneRef` with their validators, references and resolvers; `RigidTransform` and the transforms of `solid.ts`; `Placement`, `ToolRecipe` and `applyTool`; the copy tags of a face name; `bodySource` of the registry (3a).
- **Adds:** the two variants of `PatternTransform`; `reflection` and `mirrors`; the rule of a build in a left-handed frame, which 4a inherits.

## What was measured

**The recipe.** A copy of the repository at `cdf5995` in the scratchpad of the session, with the engine side of this design applied (the 98 lines above; the reversal in `applyTool` behind a switch, to measure both ways), and spike tests in `packages/scenarios/test` against the real solver and kernel adapters: a plate 60 × 40 × 10 with every kind of tool, an L-shaped body, and scenario 12 with the calls of `calls.ts`. Nothing of it is in the repository.

**A tool in a mirrored placement**, each mirrored in the middle plane of the plate:

| Tool | Without the reversal | With it |
|---|---|---|
| a prism added, cut blind and cut through all (an L-shaped profile) | `kernelFailure`: the tool faces inwards | ok; the change of volume is exactly twice that of the source (1400, −1400, −3500) |
| a tapered stack (the L with a draft of 5°) | the same | ok, twice 644.66 |
| a wall from a line | the same | ok, 360 for twice 180 |
| a prism up to a tilted plane (the drafted side of a block) | the same | ok; the copy runs to the same plane from the other side and is longer than its source (about 32 against 22) |
| holes: plain blind, counterbore and countersink through all, nut pocket | the same | ok, twice the volume of the source each |

- The result is the mirror image: a plate with a drafted L, a nut pocket and a countersink mirrored as features, and the same plate mirrored as a body, have the volumes 24343.08581 and 24343.08590 and share 24343.08567.
- The surfaces of the faces of the copies hold the vertices of the meshes to 3 · 10⁻⁶ mm (planes, cylinders, cones), as for the sources.

**A mirrored body** (the L-shaped pad, 120 mm³):

- each of `padX/1`, `padY/1` and `padXY/1` (a mirror of a copy) is closed, has the volume 120 and the bounds of its corner;
- a sketch on the top of `padX/1` has the origin [80, 0, 2] (the image), x [1, 0, 0] (not the image) and a right-handed frame; a boss extruded from it by a positive distance grows out of the body;
- the edge of the top with the side of `l0` projects to (0, 0) → (15, 0) for the source and (65, 0) → (80, 0) for the copy: the image of the end `a` is the end `b`. For the mirror of the mirror it is (80, 50) → (65, 50), the image of `a` again;
- the copies inherit the material and the density of the source along the chain, and the mass query weighs `padXY/1` (0.15 g at 1.25 g/cm³).

**Linear.**

- Five slots through a plate with the count and the spacing as parameters remove five times one slot (1200 for 240); a span `length` of 40 puts the last of the five 40 from the original; a count of 1 and a length with a count of 1 are fine; a negative spacing runs the other way; 20 copies along a plate that holds 14 give the warning `noEffect` with the copies 14 to 19 by number.
- Time, a through hole repeated along a plate: 25 holes 0.3 s, 50 holes 1.3 s, 100 holes 4.6 s. One boolean per copy on a body that keeps growing, as for the circular pattern.
- A body: `stack/1` and `stack/2` along the normal of a sketch, closed, with the volume of the source.

**Scenario 12** (the whole model, then the calls of `calls.ts`): the five vents remove 240 mm³ and a sixth 48 more; 18 name the copies 16 and 17 as idle; the mirror of the rib and the brace adds 492.7792 mm³ where the originals added 492.7793; the copy of the brace ends in the plane the source ends in (x = 39.54 at its far end, both); a sketch stands on the copy of the rib's drafted side; the lid still clears the box; the four pads and the box do not collide (15 pairs); the document saves and loads to the same model. A post up to the lid with a counterbored hole in its top, as the sources `['post', 'hole']`, is right in a row of three and in a mirror.

**Copies onto the original.** A through hole mirrored in a plane through its own axis is reported as `noEffect` when its circle has an even number of sides (radius 5: 50 sides; 2.5: 36) and cuts slivers when it has an odd number (radius 4: 45 sides, 0.61 mm³; 3: 39 sides; 10: 71 sides). A half turn about its own axis by the circular pattern of today does exactly the same, with the same volumes: a polygon with an odd number of sides is not its own image in either. A rectangle mirrored in its plane of symmetry is `noEffect`.

**An older build.** `master` loads neither kind: `invalidDocument`, "features[2].transform.type: čeká se jedna z hodnot circular".

Not measured: anything of the app; a mirrored generated profile (a gear is built by `buildPrism` like any region); the route to a grid.

## Rejected alternatives

1. **A feature type `mirror`.** Above ("Kinds of the transform").
2. **Reversing the winding in each build**, or in the wrapper of `build` of each module. Above: one place instead of one per build, and a build that forgets passes every test without a mirror.
3. **Building the tool of a mirrored copy in the frame of the source and moving the mesh** (`transformSolid`, which reverses already). The mirror would then be the only kind whose copies do not measure for themselves: a mirrored hole "through all" would have the length of its source, and a mirrored post would not follow the plane of `upTo`. One rule for every kind is worth one line in `applyTool`.
4. **A second direction inside `linear`.** Above ("A grid").
5. **A direction type of its own**, or a new kind of `AxisRef` for a line of a sketch in this package. Above ("The direction is an axis"); a new kind belongs to all users of `AxisRef` at once, and needs an answer to a line of no length for each of them.
6. **One numeric field `spacing` and no `length`.** `length / (count − 1)` as an expression needs the count as a parameter and fails for a count of 1. The second span is three lines of the engine and one select of the form, and the circular pattern has the same pair.
7. **A count on the mirror** ("mirror and keep the original" as an option, or `count: 2`). There is nothing to choose: the original stays, as for every pattern.
8. **Frames and line ends of a mirrored copy as images of the source's.** Above ("What a mirrored copy is").
9. **Mirroring the plane of `upTo` with the copy.** It would contradict D47 for one kind ("to the plane the feature saw"), and the mirrored plane is in general no face of anything.
10. **A step of the schema "to be safe".** The rule says when one is needed, and the measurement says this is not such a case; an empty step would raise the version of every document for nothing.

## Known limits

- One direction per pattern; no grid in one feature, and no pattern of a pattern of features yet.
- A direction is a base axis or the normal of a sketch plane.
- One body per pattern of a body.
- A mirrored copy of a feature goes to the targets of its source. It does not follow a mirrored body: what a mirrored body should have is modelled before the mirror on the timeline (the body is copied as it is at the pattern), not mirrored onto it afterwards.
- A mirrored body is a body of its own; a part modelled as a half and joined with its image needs the union of 3d. Mirroring features onto one body works today, because an addition is united with its target.
- A copy that falls onto its original is `noEffect` only when the polygons of the two coincide; a circle with an odd number of sides mirrored in a plane through its axis cuts slivers of the size of the chord tolerance and is reported as a change. The same holds for a half turn today.
- A sketch on a face of a mirrored copy and the ends of its projected lines are not the images of the source's (the table above).
- The time of a pattern of features grows with the square of the count, for every kind.
- A copy far from the origin has the precision of float32 at that distance, as any body there.
- The app has no button *Mirror*; the kind is chosen in the form of the pattern.

## To verify before the implementation

- That `buildPrism`, `buildStack` and anything merged since `cdf5995` that builds a tool (the revolve, if 4a comes first) still place vertices by the frame alone: the table of mirrored tools above becomes a test with a row per build and per kind of hole, and a new build adds its row.
- The form: a click with *Pick* armed against a click that picks the source body, and the refusal of a face of the preview's own copy, in `app.test.ts`.
- That nothing else lists the kinds or the fields of the transform by hand. Found by the prototype: the three tests named above, and in the app `features/pattern.ts`, `changePattern` and `PatternSpan` of `sketch-commands.ts`, and the tests of `changePattern` (the type check of the app fails exactly there).
- `CLAUDE.md` says the schema version is 5; `master` saves 6 since 5a. Not this package's line; for the session that merges.

## For the plan

- **2b, 2f, 2c** ("to be agreed with 2e"): settled as above. Their builds do not change.
- **4a (revolve)**: its build inherits the rule of a left-handed frame and adds a row to the test.
- **3e (parts list)** and **5b (robot description)**: a mirrored copy is another part and another mesh than its source; a row of copies is the same one. See "Copy IDs, body properties and links".
- **3d (boolean of bodies)**: a half and its mirror image joined is the use that waits for it.
- **5c (midplane of two faces)**: the natural plane of a mirror; `PlaneRef` takes a plane feature already.
- **Further kinds of `AxisRef`**: a linear pattern along a line of a sketch or an edge needs one; nothing else.
- **Step 7 (threads)**: a mirrored thread is a left-hand thread, by the same build.
- **Shared places**: `recompute/services.ts` (one line in `applyTool`) and `solid.ts` are touched; the row "Pattern: transform kinds" of the plan holds.

## Tests the implementation owes

- **Validation**: the fields of each kind and the refusal of a field of another kind; the references of the direction and of the plane (before the pattern; a face of a copy with its pattern; `moveFeature`); the patches (a merge within a kind, another span, another kind complete and incomplete, the expressions that go with a replaced transform); the fields of the registry per kind against `fieldsOf`; a spacing of zero as a number and as an expression; a document of today loads unchanged, and the version is unchanged.
- **Transforms**: `reflection` (points of the plane stay, twice is the identity, the determinant, a normal of any length and sense); the shifts of both spans, a negative one, a count of 1.
- **Mirrored tools**: the table of "What was measured" as tests, a row per build and per kind of hole: the volume, a closed mesh that faces outwards, the vertices on the surfaces of the faces; the plate mirrored as features against the plate mirrored as a body.
- **A mirrored body**: volume, bounds, names with tags, surfaces; a sketch on its faces with a right-handed frame and the origin of the image; an extrusion from it that goes out; the ends of a projected line; a mirror of a mirror; a mirror in a face of the source; a cut into a mirrored copy.
- **Linear**: features and a body; along a base axis and along the normal of a sketch on a face; copies that leave the body named in `noEffect`; a copy that fails names itself and leaves the model as it was; the count as an expression.
- **`upTo` and holes in copies**: a row of posts under a tilted plane with a length per copy; a mirrored copy to a plane the mirror does not keep; a copy the plane passes through; a hole "through all" in a row and in a mirror; a hole in a copied post; a headed hole whose copy must not change its target.
- **The plane of a mirror**: a base plane, a plane feature, a face, a face of a copy; a round face; a removed plane.
- **Other packages**: body properties inherited through a mirror and through a mirror of a copy; a link with mirrored copies; the mass, the print and the section queries on a mirrored body.
- **MCP**: the numeric fields of the pattern in `describe_api`; a command of each kind through `execute`; the summary of a pattern of each kind in `get_model`.
- **The app**: above.
- **Scenario 12**, the part of this package.

## Open

Questions for the owner:

1. **The grid.** The design defers a grid of features (and a mirror of a mirror of features) to a package of its own, "a pattern of features as a source of a pattern", and gives the ways round it until then. Should it be part of 2e instead? (Default: no, a follow-up.)

Nothing else needs the owner: no library, no change of the document that an older build would drop, no change of another package's contract.

## Reviews

(To be filled by the rounds.)

## Rows for the indexes

**`docs/d36/README.md`**, the row of the table "Work packages":

| ID | Package | Step | Track | Needs | Design now |
|---|---|---|---|---|---|
| 2e | Linear pattern and mirror of features and bodies | 2 | D | 00 | full design written and reviewed 2026-11-16, D53 ([2e-pattern-mirror/design.md](2e-pattern-mirror/design.md)): two more variants of the transform of the pattern (`linear` along the direction of an `AxisRef` with a spacing or a length, `mirror` in a `PlaneRef`), the tool of a mirrored copy turned over in `applyTool`; no feature type, no issue code, no schema step. A grid (a pattern of features as a source of a pattern) is deferred to a package of its own |

In "Numbers", decisions: D53 is 2e. In "Shared places", the row "Tool builds" may say that 2e adds one line to `applyTool` and a rule every build keeps (it does not look at the handedness of its frame).

**`docs/decisions.md`**, the row of the overview:

| # | Téma | Stav | Rozhodnutí |
|---|---|---|---|
| D53 | [2e Linear pattern and mirror](d36/2e-pattern-mirror/design.md) | designed 2026-11-16; not implemented. Measured with a prototype against the real adapters: every tool built in a mirrored frame faces inwards and the kernel refuses it, so `applyTool` turns it over, once for every build; a mirrored copy is the mirror image to the precision of the meshes; `master` refuses a document with either new kind, so no schema step | Two more kinds of the transform of the pattern feature: `linear` (copies shifted along the direction of an axis, by a spacing or over a length) and `mirror` (one copy, the image in a plane), for a list of features and for a body. Copy IDs, face names, body properties and links are those of every pattern. A face name of a mirrored copy says which face it is the image of; a sketch on it has a right-handed frame of its own. A grid is deferred: a pattern of features as a source of a pattern |

**`docs/requirements.md`**, scenario 12, a part after "Holes with hardware":

> - *Linear pattern and mirror (2e, D53).* The long wall gets vent slots: one slot 2 × 12 cut through the wall from a sketch on its outer face, and a linear pattern of it along X with the count and the spacing as parameters (5 slots, 4 apart): the box loses five times the volume of one slot (240 mm³), a face of a copy is the face of the slot with the number of the copy, a sixth slot is one parameter and moves none, and 18 slots run past the end of the box: the pattern has the warning `noEffect` and names the copies 16 and 17. The span as a length between the first and the last slot is a patch of the span alone; a spacing of zero is refused. The rib with its draft and the brace that ends on the rib's tilted side are mirrored to the other long wall in a plane feature at half the width (`offset: '-W / 2'` from the base plane XZ): the copies add the volume the originals added, the brace of the copy ends on the copy of the rib, a sketch stands on a face of the copy with a right-handed frame, and the lid still clears the box. A mirror whose plane is removed is `brokenReference`, one in a round face `nonPlanarFace`; a patch with another kind replaces the transform and has to be complete. Four L-shaped pads under the corners are one body and three mirrors of it, one of them a mirror of a copy: four bodies of 120 mm³, each in its corner with its long leg under the long wall, none colliding with the box; the material is set once, on the source, and the last copy is weighed by it; a sketch stands on a face that carries two copy tags; a link lists the copies. Three lids in a row for the print bed are a linear pattern of a body. The document loads to the same model, and its schema version is the one it had.

**`docs/backlog.md`**: the entry "Linear pattern and mirror of features and bodies" is taken over by this design; the backlog keeps what has no package: a pattern of features as a source of a pattern (a grid, a mirror of a mirror), a pattern of several bodies, a linear pattern to both sides, and (with the other kinds of `AxisRef`) a direction along a line of a sketch or an edge.
