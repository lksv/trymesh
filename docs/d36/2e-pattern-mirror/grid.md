# 2e, an addition: the grid (D53)

**State: designed 2026-11-17; implemented 2026-11-17 ("As implemented", at the end).** An addition to [design.md](design.md) (the linear pattern and the mirror, implemented and merged). The owner decided on 2026-11-17 that the grid is wanted, as an addition to 2e; the decision stays D53. Written against the code of `master` at `633a6ca` and checked again at `c2a506c`: `master` has since gained only the compressed 3MF (D54), which touches the export and nothing the grid reads. The engine side was built as a prototype in a copy of the repository and run against the real adapters; the numbers are under "What was measured". This is its fourth version, after three rounds of reviews ("Reviews").

Files: [contract.ts](contract.ts) (the parts marked "the grid": the second direction, the numbers of its copies, its fields, the error code), [calls.ts](calls.ts) (`scenario12grid`, its part of validation scenario 12).

## What the design of 2e and the backlog say, checked against the code

[design.md](design.md), "A grid, later", weighed three routes and took none: copies of a second direction numbered row by row (rejected there: a change of a count renumbers the copies), a second direction with numbers that do not depend on the counts (features and bodies), and a pattern of features as a source of a pattern (features only; also a mirror of a mirror). [backlog.md](../../backlog.md) keeps "a grid (two routes named there)". The owner asked for a route that covers bodies as well as features unless measurements show it is worse.

| Statement of 2e | What the code of `master` says |
|---|---|
| "Numbers with gaps are legal already: `createsBody` and the tag of a face accept any number from 1" | True, measured on `master` with a row of three bodies: a cut into `<row>/1000` is a valid command and `brokenReference` in the recompute; body properties of `<row>/2003` are accepted; a link that lists `<row>/1001` names it under `missing`; a sketch on a face tagged `index: 1001` is a valid command and `brokenReference`. Every reader takes the number as it is: `createsBody` (a number from 1 without leading zeros), the tag of a face (`faceName`: an integer from 1), `faceKey` (`/@<pattern>:<index>`), `FeatureResult.bodies`, `refs` of the shape `{ copy, feature }` |
| "Only the pattern's own `index: i + 1` would change" | True: the number of a copy is made in one line of `step` (`features/pattern.ts`), from the position of its transform in the list `transformsOf` answers. Nothing else derives a number from a position |
| "The stride becomes part of the meaning of every document, so the bound of a count can never grow" | True of any stride. With the stride 200 named there the bound could never grow; this design takes 1000, which leaves room up to a count of 1000 ("The numbers") |
| "The product of the two counts needs a bound that only the recompute can check" | True. A field holds its last valid value and its expression is evaluated by the recompute (`Evaluator.resolve`), which writes the new values back whatever the step then says; a product checked by the validator would refuse, on load, a document this build saved. The precedent is the hole: "the head is not wider than the bore" is the error `invalidHole` of the recompute, also for plain numbers |
| "A second direction is a field the variant `linear` does not list, so this build refuses the document by itself" | True, measured: `master` refuses a document whose linear transform has a field `second` ("features[4].transform.second: a transform of the type linear has no such field"), a field inside its span, and an expression at `transform/second/count`; the commands as well. **A field directly on the pattern feature is dropped without a word** (measured: the document loads and the pattern is a row). So where the field lies decides whether a schema step is needed |
| "A pattern listed as a source of a pattern is loaded and is then `brokenReference`" | True, measured: the command is refused ("is not a feature that applies a tool"), a document that holds it loads and the pattern is `brokenReference` |
| The third route changes "`State.tools`, `applyTool`'s placement and `producesTool`" | True, and more: `ToolRecipe` is one operation with one list of targets; `Placement` is one transform and one `CopyTag`; the wrappers of `build` in `features/extrude.ts` and `features/hole.ts` write `copy: [placement.copy]`, a list of one |

## The route

**A second direction of the linear pattern, with copy numbers that do not depend on the counts** (the second route of 2e).

| | A second direction (taken) | A pattern as a source of a pattern |
|---|---|---|
| Covers | features and bodies | features only: a pattern of a body has one source body, and a pattern of several bodies is deferred |
| The engine | prototyped: 84 lines added and 23 removed in three files; every test of the repository passes but the three that pin the list of the fields | not prototyped. A pattern would leave a list of applications instead of one recipe; `Placement` would hold a product of transforms and a list of tags; each wrapper of `build` appends instead of writing a list of one; `refs` of a failed copy name a copy inside a copy |
| Names | one tag per face, as today; the number says the place (`1002`: two steps along the first direction, one along the second) | two tags per face; each count keeps numbers of its own |
| Also gives | nothing | a mirror of a mirror of features (four corners from one), a circle of rows |
| A build without it | refuses the document (measured): no schema step | loads the document and reports `brokenReference` (measured): nothing is dropped, but the model lacks the grid. The rule of `schema.ts` names neither that case as needing a step nor as needing none, so that route has a decision to make here (2e left it open) |
| Time | one boolean per copy and target, as every pattern of features. A change of either count computes every boolean of the step again, as in a row today | the same booleans; a change of the outer count would find the inner row memoised |

No measurement speaks against the second direction: numbers with gaps pass through every place that reads a body or a face (bodies, body properties, links, the queries, the exports, sketches on faces of copies; "What was measured"), and the time is of the order of a row of as many copies (a grid of holes measured a fifth to a good third slower than the row: 21 to 37 %). What it does not give is the mirror of a mirror and the circle of rows. The other route stays open for them and is not blocked: it would add a second tag to the faces, which the names allow today.

## The cheap variant

```ts
type LinearSpan = { type: 'spacing'; spacing: number } | { type: 'length'; length: number };
type PatternTransform =
  | { type: 'circular'; … }                                                                            // as today
  | { type: 'linear'; direction: AxisRef; count: number; span: LinearSpan;
      second?: { direction: AxisRef; count: number; span: LinearSpan } }                               // `second` is new
  | { type: 'mirror'; plane: PlaneRef };                                                               // as today
```

- **An optional second direction of the variant `linear`**, with its own direction, count and span. Without it the pattern is the row of today, to the last field.
- **The places** are the pairs (i, j): i steps along the first direction, j steps along the second. (0, 0) is the original, every other place one copy.
- **The number of the copy at (i, j) is `i + 1000 · j`.** The row of the original keeps the numbers 1 … `count − 1` of a row; the next row is 1000, 1001, …; the one after 2000, …
- **At most 200 places** (`count × second.count`), and **no two places in one place** (whole numbers of steps along parallel directions that reach the same point, a step of next to nothing, directions a hair apart); both are the new error `invalidPattern` of the recompute.
- Everything else is the pattern of today for features and for a body: the tools built again in the place of each copy, the atomic failure, `noEffect`, the copy tags, `bodySource`.
- **No feature type, command, query or face role, and no upgrade step.** One error code.
- **The app**: the form of a linear pattern gets a checkbox for the second direction and its rows. **MCP** needs no code but a paragraph of `CONVENTIONS`.

What the addition adds, place by place:

| Place | Added |
|---|---|
| The document | the optional field `second` of the transform `linear`; nothing else changes shape |
| Commands | none; `addFeature`, `updateFeature` and `setField` carry it |
| Queries, export formats, operations of the app | none |
| Feature types | none; the entry `pattern` of the registry gets four field descriptions and its summary |
| Face roles, face names | none; the tag of a copy carries the number of its place |
| Issue codes | `invalidPattern`, an error ("Issue codes") |
| The schema | no step ("Document and validation") |
| The app | the entry `pattern` of `FEATURE_UI`: the rows of the second direction in its form, its line in the model panel; the picker of an axis takes a label |
| MCP | no code; the paragraph of the pattern in `CONVENTIONS` |

**Deferred:**

- **A mirror of a mirror of features and a circle of rows**: a pattern of features as a source of a pattern, as above. Until then four corners from one are two mirrors and a circular pattern of two, as today.
- **A second transform of another kind in the same feature** (a second mirror plane, a row of circles). The numbering would carry it (`1`, `1000`, `1001` for two mirrors), but the order of two transforms that do not commute has to be decided first. `second` lists its fields, so a later `type` in it is refused by a build of this addition by itself.
- **Staggered rows** (every other row shifted by half a step), **a third direction**, **copies left out** of a grid, a grid to both sides of the original.
- **A skewed grid in a chosen plane**: the directions are those of `AxisRef` (a base axis, the normal of a sketch plane); a direction along a line of a sketch or an edge comes with the further kinds of `AxisRef`, for both directions at once.
- A grid of several bodies (a pattern of several bodies is deferred by 2e).
- Fewer booleans for many copies ("Known limits").

## Decisions

### The second direction is a field of the transform `linear`

`transform.second`, an object with the three fields of a direction: `direction`, `count`, `span`.

- **Inside the transform, not on the feature.** The variant `linear` lists its fields, so a build without the grid refuses the document; a field on the feature would be dropped without a word and would need a schema step (both measured, first table).
- **One object, not three fields beside the first three** (`direction2`, `count2`, `span2`). A grid has all three or none: the validator asks for a whole object, a patch adds it whole, `second: null` removes it with its expressions, and the numeric fields get paths that say what they are (`transform/second/count`).
- **Not a list of directions.** `directions: [{…}, {…}]` would change the shape of every linear pattern of today (a schema step that converts, and other field paths for the expressions documents hold), for a third direction nobody asked for.
- **No `type` in it.** It is not a transform of its own; a second transform of another kind is deferred, and the field can come with it.
- **Only on `linear`.** `second` on a circular pattern or a mirror is an invalid command (they list their fields; measured).
- The fields mean what they mean in the first direction: `direction` is an `AxisRef` of which only the direction counts, checked as written (a point of a sketch that is gone is `brokenReference`); `count` is an integer from 1 to 200 that includes the row of the original; the span is a `spacing` between neighbouring rows or a `length` between the first row and the last, in millimetres, not zero, negative against the direction.
- A second direction with a count of 1 makes the copies of a row: no copy uses the direction (it is still a reference, and still checked, and the two rules of a grid are still asked of the pattern).

### The numbers: `i + 1000 · j`

- **A place keeps its number whatever the counts are.** With the span `spacing` in both directions a larger count adds copies and moves none, so `<pattern>/1002`, a face tagged `index: 1002`, a sketch on that face and a link that lists the body keep meaning the same place. (With the span `length` a change of that count moves the copies along that direction, as in a row today; the numbers stay.) Measured: a sketch on a face of copy 1002 of a grid 4 × 3 stays where it was in a grid 5 × 4.
- **The row of the original has the numbers of a row.** The stride multiplies the steps along the second direction, not the first, so a row that gets a second direction keeps its copies: `1` … `count − 1` are what they were, and the new rows start at 1000. Measured on the vent row of scenario 12.
- **The stride is 1000**, not the bound of a count (200) and not a pairing function:
  - it is read without a calculator: `2003` is three steps along the first direction and two along the second;
  - the bound of a count may still grow, up to 1000 (the steps 0 … 999);
  - a pairing of two numbers (Cantor's, or the one that fills squares) has no bound at all, but gives the row of the original other numbers than a row has (so adding a second direction would rename every copy) and numbers nobody can read.
- **The stride is part of the meaning of every document with a grid** and is never changed: `GRID_STRIDE` (`features/pattern.ts`, exported). A test pins it above `MAX_PATTERN_COUNT − 1`.
- **The numbers have gaps.** A grid 4 × 3 has the copies 1, 2, 3, 1000 … 1003, 2000 … 2003. Nothing counts copies by their numbers: `FeatureResult.bodies` lists the bodies that exist, the tags of the faces say which copies there are.
- **The order of the copies is the order of their numbers**: row by row, the row of the original first. It is the order the copies of features are applied in (for each copy the sources in the order of the list, as today), the order of `refs` of `noEffect`, and the order of `FeatureResult.bodies`. A copy that stands on the row below thus finds it there.
- **The order in which the copies are applied does depend on the first count**, which the places and the numbers do not: one more column is applied at the end of the first row, before the rows above it, where one more copy of a row is applied last. The copies that were there keep their order among themselves; the copy of the new column in row j comes between them, after row j and before row j + 1. So nothing follows unless a tool of the added column reaches a copy of a later row (touches or overlaps it), or changes what "through all" measures for one. Then what such a later copy finds can change while its number stays: which of two copies owns a face they share, which copy `noEffect` names, how far "through all" reaches on a target that has grown ("Known limits"). Measured: slots 6 long along X, the first direction X with the step 5 and the second X with the step 2.5 and the count 2; at 4 × 2 the copy 1003 cuts the plate and owns faces, at 5 × 2 the new copy 4 is applied before it and has already cut its place, so `noEffect` names 1003 as well and its faces are gone, with its place and its tool unchanged. (Reaching a later copy is needed, not enough: where a square cut of (4, 0) overlaps (3, 1) with equal steps, (3, 0) has already cut that corner in either order.)

### At most 200 places, judged by the recompute

`count × second.count ≤ MAX_PATTERN_PLACES` (200, the bound of a count: "a pattern has at most 200 places, the original included, in a row or in a grid").

- Each count has its own bound of 200, which keeps a typo in an expression from starting thousands of booleans; two counts at that bound would be 40 000 places. One number for both cases: a grid 14 × 14 or 20 × 10, a row of 200.
- The bound is that of the time of a pattern of features: 200 holes take 18 s in a row and 25 s in a grid (measured). Bodies would allow more (199 copies in 0.06 s); one rule is kept for both sources.
- **The recompute judges it, never the validator.** Either count may be an expression; the recompute evaluates the expressions and writes their values into the fields whatever the step then answers, so a document can hold two counts that are each in range and too many together. A validator that refused the product would refuse such a document on load (measured: with the check in the step alone it loads, and the pattern is in error), and in a command it would block every `updateFeature` and `setField` of that pattern that leaves the product as it is, a change of the source or of a spacing among them (both validate the whole feature; `renameFeature` and `setSuppressed` do not). With plain numbers it is the same rule in the same place, as for the dimensions of a hole.
- The error is `invalidPattern` with `refs: ['transform/count', 'transform/second/count']` and the product in the detail; the pattern is in error as a whole and the model stays as it was before it.

### No two places in one place

When two places of a grid would be one place, the pattern is `invalidPattern`, with the two copies named in the detail ("the copies 1 and 1000 would stand in one place", "the copy 1001 would stand in the place of the original"). `refs` are the paths of what the places are computed from: `transform/direction`, `transform/count`, the numeric field of the span (`transform/span/spacing` or `transform/span/length`), and the same three under `transform/second/`. They are paths into the feature, numeric or not: the two directions are references, not numeric fields, and `issueText` leaves a path as it is.

- **The harm is tested, not its cause.** For a body, the second copy would be a second body in the place of the first with nothing to say so: twice the mass, and two copies that collide. For features it would at best be a `noEffect` of one copy, and need not be even that (a tool is applied to the target as it is then).
- **The test**: the place of a copy is the translation of its transform, the one that is built. Each place is compared with the original and with every place before it, as points (at most 200 places, 19 900 pairs); two are one place when they are at most `LENGTH_TOLERANCE` apart (10⁻⁶ mm, `util.ts`), the tolerance the engine has for a length. The first pair found, in the order of the numbers, is the one the detail names. A direction of any length is normalised first (`shift` does it), so a later kind of `AxisRef` that is no unit vector is safe.
- **When places meet.**
  - *Exactly*, only on one line: with independent directions `i · a + j · b` is another point for another (i, j). With parallel directions two places meet when a whole number of steps of the first direction equals a whole number of steps of the second, within the counts and with either sign: the steps 5 and 5 meet at once (the copies 1 and 1000), 5 and 10 at the second copy (2 and 1000), 5 and −5 put the copy 1001 on the original. Parallel directions alone are not the error: 5 and 6 over 4 × 3 places do not meet (they would over 7 × 6), and neither does a second step beyond the whole row (all measured). Such a pattern is a row with odd numbers, not a grid, and is left alone.
  - *Within the tolerance*, in two more ways.
    - A step shorter than the tolerance, also with independent directions: a field must not be zero but may be 10⁻⁷, and a `length` is divided by the count less one. The first copy along that direction then stands in the place of the original: the copy 1 for a length of 2 · 10⁻⁶ over five places along the first direction, with the second direction across it; the copy 1000 in a grid 1 × 5 with that length along the second (both measured). A count of 1 in a direction is no exception: it only leaves that direction unused.
    - Directions that are nearly parallel: two directions 10⁻⁸ rad apart with the same step of 10 mm put the copies 1 and 1000 10⁻⁷ mm apart (an owed test). Base axes are exact, but the normal of a sketch on a face of a turned copy is not (`transformFace` turns the normal, `axis` takes it as it is), so such directions can come in today.
- **A grid is asked, a row is not.** A linear pattern without `second` is the row of today and is not compared: a row with a step of 5 · 10⁻⁷ mm makes its copies as it did (measured: four bodies, status ok), where the same row with a second direction of the count 1 is refused. The row is left as it is on `master`; closing it belongs with the circular pattern below.
- **The rule compares places, not meshes, and that is its limit.** Bodies are float32 meshes (`transformSolid` rounds every moved vertex to float32), and float32 has steps of 7.6 · 10⁻⁶ mm between 64 and 128 mm (1.9 · 10⁻⁶ between 16 and 32). Two places further apart than the tolerance and closer than that step at the coordinates of the copied body pass the rule, and their copies coincide to float32: each vertex is the same float, or one float32 step away, as it happens to round; two bodies in one place either way. Measured: a cube at x = 64, a grid 2 × 2 along X with the steps 5 and 5.000002: status ok, and `G/1` and `G/1000` have bit-identical positions. With the steps 5.000003 and 5.000005 the vertex at x = 64 goes to 69 and to 69.0000076 (one step apart; computed by a reviewer with `shift` and `transformSolid`). The rule therefore catches what the document states (whole steps along one line, a step of nothing, directions a hair apart), not what rounding makes equal. A threshold scaled by the coordinates was weighed and not taken: the places alone do not tell where the copied body lies (the cube above is at 64, its places at 5), the tools of features are not built yet when the copies are made, and nothing else in the engine refuses two bodies modelled a millionth of a millimetre apart. Steps typed with a few decimals fall into the band (26.66667 against `80/3` is 3.3 · 10⁻⁶ apart), and so can directions: two sketch normals turned by angles 2 · 10⁻⁷ rad apart, with steps of 10 mm, put two places 2 · 10⁻⁶ mm apart (computed by a reviewer with `rotation` and `transformFace`).
- The directions and the values are known to the recompute only, so the validator cannot ask.
- **A circular pattern of today has the same hole and keeps it**: a span `angle` of a full turn puts the last copy on the original, which for features is the tested `noEffect` of D35 ("five copies over 360°") and for a body a second body in the place of the first. The grid is new, so nothing depends on its coinciding copies; closing the hole for the circular pattern and for the row is noted for the backlog ("Rows for the indexes").

### An error code of the pattern

`invalidPattern`, an error: "The counts, the directions and the spans do not make a pattern", with the reason in the detail.

- The two conditions above (too many places, two places in one) are neither a broken reference nor a failed copy, and they are found where the values and the directions are known. The extent and the hole have a code of this kind (`invalidExtent`, `invalidHole`).
- Not `invalidExpression` for the bound: that code says "the expression of some field cannot be evaluated or gave a value outside the range of the field (details in `fieldErrors`)", and here there may be no expression and there is no entry of `fieldErrors`.

### Copy IDs, body properties and links

Nothing changes but the numbers a grid gives.

- **`createsBody` stays as it is**: a pattern of a body creates `<pattern>/<number>` for every number from 1 (a mirror only 1). Whether the copy exists shows in the recompute, as today. A number no grid can have (`<grid>/500`: a column beyond every count) is, like a number beyond a count, a valid command and a body that is not there.
- **3a**: `bodySource` answers with the source for every copy. Measured: `lids/1002` takes the material and the density of `lid`, and the mass query weighs it; body properties set on `G/1001` stay with it when a count grows.
- **5a**: a link lists a copy of any row like any body; a copy that a smaller count no longer makes is under `missing`. Measured.
- A grid of a copy works as a pattern of a copy does today (`H/1001` from `G/1002`: the faces carry both tags).

### Face names

The name of the source face with one tag, `copy: [{ pattern, index }]`, where `index` is the number of the place. `faceKey` appends `/@<pattern>:<index>`; nothing compares the numbers of two tags as numbers. The rule of 2e about the order of two face keys ("The order of two face keys can change with a tag") holds as it is and gets no new case: a grid appends one tag to both keys, like a row.

### `upTo` and holes in the copies of a grid

As in every pattern, because the rules never ask how a placement was made: each copy is built in its place, an extent `upTo` runs to the plane the source saw, "through all" is measured against the targets as they are when the copy is applied, and the sources are applied in their order for each copy. Measured: posts with a counterbored hole through all, as the sources `['post', 'bore']` in a grid 4 × 3, add twelve times what one adds; drain holes through the floor of the box of scenario 12.

### A change of the counts, of the spans, of the kind

- More columns or rows add copies; fewer take the copies of the places that are gone. What refers to one is then reported as each place reports a body or a face that is not there, as with a smaller count today and as 2e lists it: a feature (a target, the plane of a sketch, the source of a pattern) is `brokenReference`; a sketch that projects an edge of the copy keeps the curve where it was and has the warning `brokenProjection`; a link lists the body under `missing`; an entry of body properties stays an entry without a body.
- `second: null` leaves the row of the original with its numbers.
- A change of the kind keeps the IDs and the tags, as 2e says. A circular pattern or a mirror has no copy from 1000 on.

## Recompute

`step` of `features/pattern.ts` asks for the copies with their numbers instead of a bare list of transforms (`PatternCopy` in `contract.ts`): `copiesOf(transform, state)`.

| Transform | Copies |
|---|---|
| `circular`, `mirror`, `linear` without `second` | as today: the transforms of `transformsOf`, numbered from 1 in their order |
| `linear` with `second` | resolves both directions (`axis(ref, state)`; the error of either is the error of the pattern, as today); then the bound of the places; then, for j from 0 to `second.count − 1` and i from 0 to `count − 1` without (0, 0): the transform `compose(shift(a, i · u), shift(b, j · v))` and the number `i + GRID_STRIDE · j`. A place at most `LENGTH_TOLERANCE` from the original or from a place before it is the error; the place is the translation of the transform that is built, taken from it (the prototype computed the vector beside it, which differs in the last bits only) |

`u` and `v` are the steps: the `spacing`, or `length / (count − 1)` (zero steps for a count of 1). The rest of the step is unchanged but for two things: it reads `index` from the copy where it computed `i + 1`, and it hands the detail of the error on (`failed(copies.code, copies.refs, copies.detail)`; today the call passes the code and `refs` alone, and the detail is where the two copies are named). The copies of the first row are those of a row to the last bit: `compose` returns its first argument when the second is the identity.

## Document and validation

- `patternTransform` validates the first direction and, when `second` is there, the second by the same function with the paths `transform/second/…`; `onlyFields` lists `second` among the fields of `linear`, and `direction`, `count`, `span` as the fields of `second`.
- **References**: `refs` adds `axisRefs(second.direction, 'transform/second/direction')`, so `moveFeature` keeps the pattern behind the sketch of its second direction (measured).
- **Numeric fields** in the registry (`PATTERN_FIELDS` in `contract.ts`): `transform/second/count`, `transform/second/span/spacing`, `transform/second/span/length`. The count is listed once per span, with the condition on `transform/second/span/type`: a condition names one value, and a pattern without a second direction has neither. The condition stands in for "there is a second direction" (the count does not depend on the span, where `transform/count` per kind is a real condition); `describe_api` prints the count twice, and the text of `CONVENTIONS` says what it means. Every reader copes: `draftField` and the check of angles find a field by its path, `setField` asks only about fields with a default. `fieldsOf` reports what the validator read.
- **`updateFeature`**, by the rules of today (`mergePatch`): `{ transform: { second: { … } } }` merges by field with the second direction the pattern has (the span of another type is replaced whole, the direction is a reference and replaced whole); on a row it is the new value and has to be complete. `{ transform: { second: null } }` removes it, and the expressions under `transform/second/` go with it; the module answers `removable` for that path on a linear pattern, so the patch is accepted on a row as well (a form sends it either way). A patch with another `type` replaces the transform, the second direction included. All measured.
- **`setField`** reaches the fields of a second direction the pattern has; it cannot add one (no field of it has a default).
- **The schema: no upgrade step.** The rule of `schema.ts`: no step "where a build without the addition refuses by itself: … a field where the validator lists the fields it allows". `master` lists the fields of the variant `linear` and refuses `second` on load (measured, first table), and `second` lists its own fields, so a later field of it is refused by a build of this addition in turn. `SCHEMA_VERSION` stays 6, `SCHEMA_PENDING` is not touched, documents of today load unchanged. The error code is not part of a document.

## Where the code lives

| File | What the grid does there |
|---|---|
| `packages/engine/src/types.ts` | `second` in the variant `linear` and the type `LinearSpan`, with the comment of `PatternTransform` (read by `describe_api`): the places, the numbers, the bound, the places that must not meet; at `PatternFeature` ("numbered from 1"), that a grid numbers its copies `i + 1000 · j`; `invalidPattern` in `ErrorCode` with its comment |
| `features/pattern.ts` | the validation of a direction as one function used twice; `copiesOf` (`PatternCopy`); the references; the fields; `removable`; `GRID_STRIDE`, `MAX_PATTERN_PLACES`; the summary of the type |
| `recompute/services.ts` | `MESSAGE.invalidPattern` |
| `index.ts` | exports `GRID_STRIDE` and `MAX_PATTERN_PLACES`, so that the hint of the form and the text of `CONVENTIONS` are built from them and repeat no literal. (`MAX_PATTERN_COUNT` is exported by `document.ts` alone today, for the tests) |
| `packages/mcp/src/api.ts` | `CONVENTIONS`: the paragraph of the pattern and the sentence about the ID of a copy (below) |
| `packages/app` | below. Its alias `LinearSpan` (`sketch-commands.ts`, the input form of the span) keeps its meaning; it is the `Input` of the engine's type of the same name |
| tests | below; the three that pin the list of the fields change (`pattern.test.ts`, `tools.test.ts`, `scenario12.test.ts`); the steps of the scenario go to `packages/scenarios/test/box.ts`, where every package adds its own |
| docs | `architecture/pattern.md` (the linear kind, the numeric fields, the validation, the derived body IDs, the limits), `ui/pattern.md`, `ui/errors.md` (the row of the code and what the user does about it), `architecture/recompute.md` (its copy of the error codes), `architecture/verification.md`, and the indexes ("Rows for the indexes"). `ui/errors.md` and `architecture/recompute.md` lack `invalidHole` today |

What [design.md](design.md) says against a grid is superseded by this file and stays as the record of 2e: the entry of its list "Deferred" ("neither is taken here"), "A grid, later" where it leaves the choice open, and the first of its known limits. Its rejected alternative 4 (copies numbered row by row) stands, and is alternative 2 here.

`createsBody`, `bodySource`, `applyTool`, `solid.ts`, `validation.ts`, `document.ts`, the sections and every query stay as they are.

## The app and MCP

**MCP.** No code: the commands carry the field, `describe_api` is generated. The paragraph of the pattern in `CONVENTIONS` changes: the sentence "There is no grid yet: a grid of holes is one hole feature …, a grid of slots one extrusion of several regions" is replaced by the grid, and the part (2) gets:

- `second: { direction, count, span }` makes a grid, each field as in the first direction; its count is a field whenever there is a second direction (the list of the fields names it once per span);
- the number of the copy i steps along the first direction and j along the second is `i + 1000 · j`: the first row is 1, 2, …, the second 1000, 1001, …; the numbers do not depend on the counts, so with a spacing a larger count keeps every copy, and `bodies` of the pattern lists the copies that exist;
- at most 200 places together, and no two places in one place (whole numbers of steps along parallel directions that reach the same place, such as 5 and 5, 5 and 10, 5 and −5; a step of next to nothing; directions a hair apart); both as the error `invalidPattern` of the pattern, not of the command, with the copies named in its message;
- `updateFeature` with `transform: { second: null }` makes a row again;
- four corners from one stay as they are described today.

The paragraph about body IDs (`api.ts`, "a copy of a body made by a pattern has the ID `<pattern>/<number>` (numbered from 1)") gets the half sentence that the numbers of a grid have gaps and are read from `bodies`, not composed by counting. The other texts about the ID of a copy stay true as they are: `bodyProblem` ("as `<pattern>/<number>` from 1"), the tag of a face in `validation.ts` ("an integer from 1"), and the summary of the section of body properties and two texts of `tools.ts`, which say `<pattern>/<number>` without more.

**The form of the pattern** (`features/pattern.ts`, `changePattern` in `sketch-commands.ts`, `axis-picker.ts`), in the kind *Along a direction*, below the span of the first direction:

- **A second direction (a grid)**, a checkbox. Ticked, the draft gets the second direction the form had last, or a new one: a base axis other than the first direction (Y, or X when the first is Y), a count of 2 and a spacing of 10. (The new one, or the remembered one after the first direction was changed, may lie along the first and have its step; the preview then shows `invalidPattern` and says which copies meet.)
- **What the form remembers** (`PatternMemory`), in slots of their own, because `rememberPattern` runs before every change through the form (`set`, a change of the source included) and before the pick of a mirror plane (a body picked in the view goes past it), and overwrites the transform of the kind with the one the draft has: `second`, the second direction the draft had last, written only while the draft has one (so a change of the first direction after the checkbox was cleared does not lose it, and neither does a change to a mirror and back); and `secondSpacing` and `secondLength`, the span of each type the second direction had last (the slots `spacing` and `length` of today are those of the first direction).
- **Second direction**: the picker of a direction with that label; its select of a sketch is labelled *Sketch of the second direction*. `axisRows` takes the labels of a direction in place of its flag; the parameter stays optional, so the call of the form of a joint (`panels/mechanism.ts`) is untouched. **Count along the second direction**; **Second span** with *Spacing between neighbouring rows* and *Length between the first and the last row*, and its field *Second spacing* or *Second length*. No two controls of the form share a label (the tests of the app find a control by its label).
- A hint: "Copy numbers: steps along the first direction + 1000 × steps along the second, so the second row starts at 1000. At most 200 places."
- The count of the first direction is labelled *Count along the direction* while the second is there.
- `PatternChange` gets `grid?: boolean` and `second?:` the changes of a direction (an axis change, `count`, `span`, `spacing`, `length`); `changeTransform` applies them to `transform.second`.
- **`draftCommand`** sends `second: null` for a linear draft without a second direction: the patch of a transform of the same type merges, so a second direction the draft no longer has must be removed by name (as the taper of an extent is).
- **The summary** in the model panel: "Count 5 × 2 with the original, along axis X, spacing 4 mm, and along axis Y, spacing 47.5 mm; features: Vent".
- A copy is named by its number wherever it is named today ("copy 1002 of Pattern 5", "Pattern 5 / 1002"); the issue `invalidPattern` shows the message of the engine with its detail, like every issue; its `refs` are paths, which `issueText` leaves alone, so the detail is all the user is told and has to name the copies.
- Tests of the app: `changePattern` and `rememberPattern` for the second direction (`sketch-tools.test.ts`: the checkbox off, the first direction changed, the checkbox on again; the two spans of the second direction against those of the first; linear to a mirror and back); `draftCommand` for a row that becomes a grid and a grid that becomes a row, through the engine (`fields.test.ts`, where `draftCommand` is tested); the text of `invalidPattern` as shown, with "the copies … and …" and "the copy … the original" (`issue-text.test.ts`); the form in `app.test.ts` (the snapshot of the kinds of the pattern gets the checkbox row and a step with a grid, which the commit says).

## Issue codes

| Code | Kind | When |
|---|---|---|
| `invalidPattern` (new) | error | a grid with more than 200 places (`refs`: the two count fields); a grid of which two places would be one (`refs`: the direction, the count and the field of the span of each direction; the detail names the copies) |
| `brokenReference` | error | the sketch or the point of the second direction is not in the state before the pattern; as today otherwise |
| `invalidExpression` | error | a count, a spacing or a length of the second direction whose expression fails or leaves its range, with `fieldErrors` by its path |
| `invalidExtent`, `invalidHole`, `emptyResult`, `kernelFailure` | error | a copy fails as copies do today; `refs` start with `{ copy, feature }`, `copy` the number of the place |
| `noEffect` | warning | copies that changed none or only some of their targets, as `{ copy, feature, targets }`, in the order of the numbers |

## Shared vocabulary

- **Takes:** `AxisRef` with its validator, references and resolver; `shift` and `compose` of `solid.ts`; `LENGTH_TOLERANCE` of `util.ts`; `Placement` and `CopyTag` as they are; the patch rules of `updateFeature` with `removable`.
- **Adds:** `LinearSpan`; `GRID_STRIDE` and the rule of the numbers; `MAX_PATTERN_PLACES`; the error code `invalidPattern`.

## What was measured

**The recipe.** A copy of the repository at `633a6ca` in the scratchpad of the session. First unchanged, for what a build without the grid does. Then with the engine side of this design applied (84 lines added and 23 removed in `types.ts`, `features/pattern.ts` and `recompute/services.ts`, as it is after the reviews), and spike tests in `packages/scenarios/test` against the real solver and kernel adapters. Nothing of it is in the repository. The first version of the prototype refused parallel directions; after the first round of reviews it compares the places instead, and the rows that depend on that rule were run again.

**A build without the grid** (`master` unchanged, a plate with a row of three slots and a row of three bodies):

| What | Outcome |
|---|---|
| load: `second` inside the transform `linear` | refused: "features[4].transform.second: a transform of the type linear has no such field" |
| load: `second` directly on the pattern feature | **loaded, the field dropped**; the pattern is a row, status ok |
| load: a field inside the span | refused: "a span of the type spacing has no such field" |
| load: `second` in a circular transform | refused |
| load: an expression at `transform/second/count` | refused: "is not a numeric field of this feature" |
| `addFeature` and `updateFeature` with `second` | refused |
| a pattern as a source of a pattern | the command refused; a document with it loads, the pattern `brokenReference` |
| numbers beyond every count | a cut into `<row>/1000`: valid, `brokenReference`; body properties of `<row>/2003`: accepted; a link with `<row>/1001`: accepted, under `missing`; a sketch on a face tagged 1001: valid, `brokenReference` |

**The prototype against the tests of the repository.** `npx vitest run`: 1498 of 1501 pass; the three that fail pin the list of the numeric fields of the pattern (`engine/test/pattern.test.ts`, `mcp/test/tools.test.ts`, `scenarios/test/scenario12.test.ts`). The three type checks pass, the app included (the field is optional).

**A grid of features** (a plate 120 × 80 × 4, a slot 2 × 6 cut through, the counts as parameters):

- 4 × 3: status ok; the eleven copies remove 528 mm³, 48 each; the tags on the faces are 1, 2, 3, 1000 … 1003, 2000 … 2003; copy 3 stands at (20, 5), 1000 at (5, 15), 1002 at (15, 15), 2003 at (20, 25);
- a sketch on a side face of copy 1002 has its origin at (15, 21, 4); in a grid 5 × 4 (912 mm³ removed by nineteen copies) it is still ok with the same origin, 1002 and 2003 stand where they stood, and the new copies are 4 at (25, 5) and 3004 at (25, 35) among others;
- 5 × 1 by a parameter: the copies 1 to 4, and the sketch on copy 1002 is `brokenReference`;
- 26 × 2 on a plate that holds 23 columns: the warning `noEffect` with the copies 23, 24, 25, 1023, 1024, 1025 in that order;
- a copy that would remove a second target whole (place (1, 1)): `emptyResult` with `refs` `[{ copy: 1001, feature: 'slot' }, 'B']`, and no face of the grid in the model;
- posts with a counterbored hole through all, sources `['post', 'bore']`, 4 × 3: 1483.82539 mm³ added, where twelve times the one post with its hole (123.652125) are 1483.82550; twelve bores;
- 20 × 11: `invalidPattern`, "(20 × 11 is 220 places; a pattern has at most 200, the original included)", `refs` the two counts; a column 1 × 3 has the copies 1000 and 2000;
- the second span as a length of 40 over 3 rows: the rows 20 apart;
- the second direction as the normal of a sketch on a side face: resolved; moving that sketch behind the grid is refused; removing it leaves the grid `brokenReference` with the sketch in `refs`;
- the order of application (round 3): a slot 6 × 2 cut through, the first direction X with the step 5 and the count `n`, the second X with the step 2.5 and the count 2. At 4 × 2: 140 mm³ removed, `noEffect` with the copies 1000, 1001, 1002, faces tagged 1, 2, 3, 1003. At 5 × 2: 180 mm³, `noEffect` with 1000 … 1003, faces tagged 1, 2, 3, 4, 1004: the copy 1003 no longer cuts, because the copy 4 comes before it. The same prototype with a square 6 × 6 along X and Y with the steps 5 and 5: no warning at 4 × 2 or 5 × 2. The reviewer of round 3 measured a blind round pocket of radius 4 along X and Y with the steps 5 and 5, 5 × 2, against the same places with the directions swapped: the floor of the copy (3, 1) is 25.0000 mm² in the one order and 25.7418 mm² in the other.

**The document:**

- a patch that adds `second` to a row: accepted; half of one: refused ("transform.second.direction: čeká se objekt"); `second: null` on a row: accepted; a patch of the second span alone: accepted; a field of another kind in `second`, and `second` in `second`: refused; `second` on a circular pattern and on a mirror: refused;
- `setField` on `transform/second/count`: refused on a row, accepted on a grid; 0 and 201 refused, a spacing of 0 refused;
- with the expressions `m` and `m * 5` in the second count and spacing: `second: null` and a change of the kind to a mirror drop both expressions; `m = 0`: `invalidExpression` with `fieldErrors` of both fields; `m = 100` with a first count of 3: `invalidPattern`;
- two counts with the expressions `n` and `m`, then `n = 30` and `m = 20`: the pattern is `invalidPattern`, **the saved document holds `count: 30` and `second.count: 20`** with their expressions, and it loads, the pattern in error. A validator that refused the product would refuse this document;
- a document with a grid saves with the schema version 6 and loads to the same document.

**The edges of the two rules** (a block copied as a body):

| Grid | Outcome |
|---|---|
| 20 × 10, 200 × 1, 1 × 200 | ok, 199 copies each |
| 67 × 3 (201 places) | `invalidPattern` |
| X and X with the same step, 2 × 2 | `invalidPattern`: "the copies 1 and 1000 would stand in one place" |
| X and X, 1 × 3 and 3 × 1 | ok, two copies: a count of 1 leaves one direction unused |
| Y and the normal of a sketch on the base plane XZ (−Y), the same step, 2 × 2 | `invalidPattern`: "the copy 1001 would stand in the place of the original" |
| X and the normal of a sketch on the base plane YZ (+X), the same step, 2 × 2 | `invalidPattern`: the copies 1 and 1000 |
| X and the normal of a sketch on the base plane XZ, 2 × 2 | ok, three copies |
| X with the step 5 and X with the step 10, 4 × 3 | `invalidPattern`: the copies 2 and 1000 |
| X with the step 5 and X with the step −5, 3 × 2 | `invalidPattern`: the copy 1001 on the original |
| X with the step 5 and X with the step 6, 4 × 3 | ok, eleven copies on one line |
| X with the step 5 and X with the step 15, 3 × 2 | ok, five copies: the second row lies beyond the first |
| X over a length of 2 · 10⁻⁶ in five places (a step of 5 · 10⁻⁷) and Y with the step 5, 5 × 2 | `invalidPattern`: "the copy 1 would stand in the place of the original" |
| X with a count of 1 and Y over a length of 2 · 10⁻⁶ in five places | `invalidPattern`: the copy 1000 on the original |
| the same X as a row, without `second` | ok, four copies (a row is not compared) |
| a cube at x = 64; X with the step 5 and X with the step 5.000002, 2 × 2 | ok, three copies; `G/1` and `G/1000` have identical positions (the places are 2 · 10⁻⁶ apart, the float32 step there is 7.6 · 10⁻⁶) |
| a circular pattern of a body, three over an angle of a full turn | ok, two copies, the second on the original (as on `master`) |
| a spacing of −5 and a length of −20 over three rows | ok; the copy 2001 at (−5, −20, 0) |

**A grid of bodies** (a block 20 × 10 × 3, 3 × 2):

- `bodies`: `G/1`, `G/2`, `G/1000`, `G/1001`, `G/1002`; `G/1002` at (50, 15, 0);
- `G/1002` inherits the material and the density of the source (`from: 'A'`), the mass query weighs it; body properties set on `G/1001` are kept when a count grows; body properties of `G/7` are accepted as an entry without a body;
- a link lists copies of both rows; the queries `interference` (15 pairs), `body` and `mass` and the exports `stl` and `3mf` take them;
- a sketch on a face of `G/1002` and a cut into it: ok; a grid of that copy: `H/1`, `H/1000`, `H/1001`, faces with both tags (`A/endCap@G:1002@H:1001`), `from: 'G/1002'`;
- 4 × 2: `G/3` and `G/1003` are added, `G/1002` stays in place and keeps its cut; 4 × 1: the copies of the second row are gone, the cut and the grid of the copy are `brokenReference`, the link names `G/1000` and `G/1002` as missing.

**Time** (a through hole of 2 mm in a plate, one boolean per copy; the runs of a second session, two or three each, which agree with the single runs of the first to 2 s):

| Copies with the original | As a grid | As a row |
|---|---|---|
| 25, 50 | 5 × 5: 0.9 s; 10 × 5: 1.7 s (one run each) | |
| 100 | 10 × 10: 6.2, 6.1, 6.3 s; 50 × 2: 5.8, 6.0, 5.8 s | 100: 4.7, 5.2, 4.7 s |
| 196, 200 | 14 × 14: 23.6, 23.9 s; 20 × 10: 25.1, 25.0 s | 200: 18.3, 18.4 s |

- A grid is a fifth to a good third slower than a row of as many holes (21 % for 50 × 2, 27 % for 10 × 10, 37 % for 20 × 10, on the means); the order is the same, and so is the growth with the square of the count. Why a grid is slower was not looked for.
- A grid of bodies: 99 copies in 0.03 s, 199 in 0.06 s.
- The same holes as one tool, an extrusion that cuts all the circles of one sketch (the way to a grid before this addition): 100 circles 7.4 s, 196 circles 35.4 s, 200 circles 27.3 s, 400 circles 97 s. One boolean with one large tool is not faster than one boolean per copy.

**Scenario 12** (the model as `packages/scenarios/test/box.ts` builds it up to the part of 2e, then the calls of `scenario12grid`):

- the vent row with `second` along Y, a count of 2 and the spacing `W - wall - 0.5` (47.5): the box loses 240.0000 mm³ more; the copies 1 to 4 stay (copy 4 at x = 32); the far wall has the copies 1000 (x = 16, y from 48 to 50) to 1004 (x = 32); there is no copy 5 and no 1005; the lid clears the box;
- a sketch on a slot of the far wall (copy 1004) has its origin at (32, 47.5, 22) and keeps it with six slots per wall, which remove 336 mm³ more than the row of five did and add the copies 5 and 1005; eighteen per wall: `noEffect` with the copies 16, 17, 1016, 1017;
- the drain holes: one hole removes 6.2053 mm³, the grid 4 × 3 removes 74.4639 (twelve times 6.2053); the published cylinder of the bore of copy 2003 has its axis through (33, 22), of 1002 through (28, 16), of 3 through (33, 10); 5 × 4 removes 124.1065 (twenty times), 2003 stays, 4 is at (38, 10) and 3004 at (38, 28); 50 × 5: `invalidPattern` with the two counts in `refs` and the box as it was before the grid; a second direction along X with the step 5 of the first: `invalidPattern`, "the copies 1 and 1000 would stand in one place", with the six paths in `refs`; along X with a count of 2 and a step of 2.5: ok, eight separate holes on one line that remove 49.6426 mm³ (eight times 6.2053), the bore of the copy 1001 at (25.5, 10) and of 1003 at (35.5, 10); `second: null`: the four holes of a row, the expression of the second count gone; `second` on the mirror of the rib: an invalid command;
- six lids: `lids/1`, `lids/2`, `lids/1000`, `lids/1001`, `lids/1002`; `lids/1002` at (170, 55, 26) with the volume of the lid; PETG and 23.056 g each, 138.339 g for the six; a link lists copies of both rows; a sketch stands under `lids/1001`; no pair of the six collides (15 pairs); four per row: `lids/3` and `lids/1003` added, `lids/1002` in place; one row: `lids/1002` missing in its link;
- every feature of the finished model is ok, and the document loads to the same document with the schema version it had.

Not measured: anything of the app; the third route.

## Rejected alternatives

1. **A pattern of features as a source of a pattern, as the route to the grid.** It reaches features only, and the owner asked for bodies. It stays open for what only it gives ("The route").
2. **Copies numbered row by row without gaps.** Rejected by 2e: a change of a count renumbers the copies, and what refers to one silently means another.
3. **The stride 200, or a pairing function.** "The numbers".
4. **Copy IDs of two parts** (`<pattern>/2.3`, a tag `{ pattern, index, row }`). The local name of a body, the tag of a face, `faceKey`, the texts of the app and of MCP and `refs` of the shape `{ copy }` would all learn a second number, and every document of today would keep the old shape beside it. One number that can be read does the same.
5. **A field on the feature** (`PatternFeature.grid`). Dropped by a build without it; a schema step for nothing ("The second direction is a field of the transform").
6. **A feature type `grid`**, or a kind `grid` of the transform beside `linear`. A row would then be two things (a `linear` and a `grid` with one row), and turning a row into a grid would be a change of the kind: a complete patch, the expressions under `transform/` dropped.
7. **Three flat fields, or a list of directions.** Above.
8. **The bound of the places in the validator.** Above: it would refuse on load a document this build saved.
9. **No bound of the places**, or one for features and a larger one for bodies. 40 000 booleans for two typos; two rules for one field.
10. **`invalidExpression` for the bound, and a warning or nothing for places that meet.** Above ("An error code of the pattern", "No two places in one place").
11. **Refusing parallel directions** (the first version of this design: the cross product of the two directions below 10⁻⁹). It is wider than its reason (parallel directions with the steps 5 and 6 put no two copies into one place), it needs a tolerance of an angle that is not the engine's (`ANGLE_TOLERANCE` is 10⁻⁴), and whatever the threshold, directions just outside it pass with copies that may still coincide to float32. The places themselves are compared instead; that rule has a band of its own, which is stated ("No two places in one place").
12. **Tightening `createsBody`** to the numbers a grid can have (a column below 200, a row below 200). It would refuse `<grid>/500` by a command but not `<grid>/7` of a grid of five columns, which is the mistake that happens; and it would change the answer for the rows and circles of today. The recompute says which copies exist.
13. **A schema step "to be safe".** As in 2e: the rule says when one is needed, and the measurement says this is not such a case.

## Known limits

- **200 places per pattern.** A larger grid of features is two patterns of two source features; the time grows with the square of the number of copies anyway (25 s for 200 holes).
- **The order in which the copies are applied changes with the first count** (one more column comes before the rows above it). Where a tool of the added column reaches a copy of a later row, that copy, with its number unchanged, can then own another face of two that coincide, be the one `noEffect` names, or measure another reach of "through all" (measured: a copy that cut before names itself in `noEffect` after one more column). Copies that stand apart are not affected.
- **The rule of the places compares places, not meshes.** Places more than 10⁻⁶ mm apart are accepted, and below the step of float32 at the coordinates of the copied body (7.6 · 10⁻⁶ mm between 64 and 128 mm) their copies coincide to float32, each vertex the same float or one step away: two bodies in one place, with no issue (measured). Directions a hair apart can come from sketches on turned faces. Further apart they are two bodies that collide, or two cuts, as any two bodies modelled so. A row without a second direction is not compared at all, and a circular pattern of a body over a full turn still puts its last copy on the original, both as on `master`.
- **The time is that of one boolean per copy.** One extrusion of many regions is no faster (measured), so the time is not saved by joining the tools in the way the engine can today; [architecture/pattern.md](../../architecture/pattern.md) says joining the copies "would make it linear", which this measurement does not support.
- The numbers of a grid have gaps, and a number says a place only to someone who knows the stride. The app shows the number as it is.
- With the span `length` a change of the count moves the copies of that direction, as in a row.
- A grid along directions that are not base axes needs a sketch whose plane has the wanted normal; a direction in a plane has no reference yet (2e).
- A place whose copy does nothing is a `noEffect` of that copy; there is no way to leave a place out.
- A number in a body ID or in a face tag that no grid can have is a valid command and an issue of the recompute, like a number beyond a count (and the limit of 2e about the tag of a mirror stands).
- The app has no picture of the numbers; the hint of the form says the rule.
- No mirror of a mirror of features and no circle of rows.

## To verify before the implementation

- That nothing merged since `633a6ca` derives the number of a copy from its position, or lists the fields of the transform `linear` by hand. Found by the prototype: the three tests above; in the app `changeTransform` and the form (they compile unchanged, because the field is optional, and have to be extended by hand).
- That `draftCommand` with `second: null` on a row is accepted through the form (the engine side is measured; the app is not).
- The form in a browser: the checkbox, the second picker with a sketch normal, a grid previewed and confirmed, a grid edited back to a row.

## For the plan

- **3e (parts list)**: the copies of a grid are one part several times, as the copies of a row; nothing new.
- **5b (robot description)**: body IDs of a grid contain no new character (`lids/1002`).
- **Further kinds of `AxisRef`**: both directions take them without a change.
- **A pattern as a source of a pattern**: still the route to a mirror of a mirror of features and a circle of rows; a face would then carry the tag of a grid and the tag of the outer pattern.
- **The time of a pattern of features**: a package that wants large grids has to look at the booleans themselves; the measurement of one large tool is under "What was measured".
- **Shared places**: `features/pattern.ts`; in `types.ts` the variant `linear` with its comment and one member of `ErrorCode`; one line of `MESSAGE` (`recompute/services.ts`); two exports of `index.ts`; two sentences of `CONVENTIONS` (`packages/mcp/src/api.ts`); in the app `axis-picker.ts`, which the form of a joint shares (its call does not change). The row "Pattern: transform kinds" of the plan holds.

## Tests the implementation owes

- **Validation** (`engine/test/pattern.test.ts`): `second` with its fields and the refusal of any other; `second` on the other kinds; the references of the second direction (`moveFeature`, a sketch that is gone); the patches (adding, a merge, the span alone, half of one, `null` on a grid and on a row, another kind) and the expressions that go with a removed second direction; `setField` on its fields; the fields of the registry against `fieldsOf`; `GRID_STRIDE` above `MAX_PATTERN_COUNT − 1`; a document of today loads unchanged and the version is unchanged; a document with two counts that are too many together loads.
- **The numbers** (`scenarios/test`): the tags and the places of a grid; a row that gets a second direction keeps its copies; a larger count in either direction moves none and a sketch on a face of a copy stays; a smaller one breaks what stood on a lost copy; the order of `refs` of `noEffect` and of `bodies`; a copy that fails names its number and leaves the model as it was.
- **The bound and the places that meet**: 200 places pass, 201 do not (as numbers and through a parameter); the rows of "The edges of the two rules" (the same step along two parallel base axes, a base axis against a sketch normal along it and against it, steps of which one is a multiple of the other, a copy on the original, parallel directions whose places do not meet, a count of 1 in either direction); a step below the tolerance with directions across each other and with a count of 1, and the same row without `second` (accepted); the cube at x = 64 with the steps 5 and 5.000002 (accepted, the positions of the two copies bit-identical: the limit, as it is); the detail of each refusal, with its copies; and, at the function that makes the copies, two directions 10⁻⁸ rad apart with the same step of 10 mm (the places are 10⁻⁷ mm apart: refused) and a thousandth of a radian apart (0.01 mm: accepted).
- **The order of application** (the limit above, as the code has it): the slots 6 × 2 along one line with the steps 5 and 2.5, the first count grown from 4 to 5: `noEffect` names 1000 … 1002 before and 1000 … 1003 after, and the faces of 1003 are gone; a blind round pocket of radius 4 on a grid X × Y with the steps 5 and 5, 5 × 2, against the same places built with the directions swapped: the floor of the copy (3, 1) differs (25.0000 against 25.7418 mm²); and tools that stand apart, where nothing changes. (A square cut 6 × 6 with the steps 5 and 5 shows nothing: (3, 0) has cut the corner where (4, 0) and (3, 1) overlap.)
- **A grid that shrinks**: what stood on a lost copy, by place: a cut into it and a sketch on its face (`brokenReference`), a projected edge of it (`brokenProjection`, the curve kept), a link (`missing`), body properties (an entry without a body).
- **Spans**: a length in the second direction; negative steps; a count of 1.
- **Sources**: features in their order with a hole in a copied post; `upTo` to a tilted plane with a length per place; a hole through all; a headed hole whose copy must not change its target.
- **A grid of a body**: IDs, volumes and bounds, faces with tags; a grid of a copy; a cut into a copy; body properties inherited and set on a copy; a link; the mass, the interference and the section queries; an export.
- **MCP**: the nine numeric fields in `describe_api`; a grid through `execute`; `bodies` of a grid in `get_model`.
- **The app**: above.
- **Scenario 12**, the part of the grid.

## Open

Questions for the owner; each has a default the design is written with.

1. **The stride of the numbers.** The copies of a grid are numbered `steps along the first direction + 1000 × steps along the second` (the second row starts at 1000). Once a document with a grid exists this cannot change. Is 1000 right? (Default: yes.)
2. **The bound of the places.** A grid has at most 200 places (20 × 10 holes take 25 s). Should it be larger, or larger for bodies? (Default: 200 for both.)

Nothing else needs the owner: no library, no change of the document that an older build would drop, no change of another package's contract.

## Reviews

Three reviewers are asked each round, read-only, with one brief: what is under review, what to read, what to check against the code, what to return, and the core of the prototype as text. Every finding was checked against the code, or measured with the prototype, before anything was changed.

Models: the design, rounds 1 and 2 with their fixes, and the start of round 3 (its brief and the run of codex) were the work of a session on Fable 5.2, which a usage limit stopped. The owner decided on 2026-11-17 that designs continue on Opus while Fable is unavailable, so the internal reviewer of round 3 and its fixes ran on Opus 5.5. The internal reviewers of rounds 1 and 2 ran on Fable 5.2; codex on `gpt-6-astra` in all three rounds; agy in none.

### Round 1 (2026-11-17): the design at `be9b48e`

- **internal**: a fresh subagent (Fable 5.2, effort high). It read the code, traced the patch rules and recomputed the geometry and the numbers of the scenario by hand.
- **codex** (`gpt-6-astra`, reasoning effort high, read-only sandbox). It ran the type check of the contracts and, as it reports, the calls of the scenario in memory against an implementation of the prototype with the real adapters.
- **agy** (`gemini-4-argon-high`): could not run. The account is out of quota (HTTP 429, "resets in 98h"), so by the rule of the briefs it is left out.

Seventeen distinct findings; no blocker and no major. Six are factual errors in the text, and one changes a rule of the design (the test of parallel directions).

| Finding | Who | Severity | Holds? | What changed |
|---|---|---|---|---|
| The rule "parallel directions are an error" does not test its reason. Parallel directions need not put two copies into one place (the steps 5 and 7, or 5 and 6 as in the call of the scenario itself), so "two places fall into one" was false as stated; the tolerance 10⁻⁹ of the cross product is not the engine's (`ANGLE_TOLERANCE`, 10⁻⁴, in `surfaces.ts`, `solid.ts`, `generators.ts`) and lets through directions whose copies are one float32 mesh; the vectors were not normalised for a later kind of `AxisRef`; `noEffect` for a repeated copy of a feature is not guaranteed | internal, minor; codex, minor (factual) | Yes (`util.ts`; `applyTool`); measured after the change | The rule is "no two places in one place": the places are compared as points with `LENGTH_TOLERANCE`, each against those before it, and the detail names the copies. Parallel directions whose places do not meet are accepted. The decision, the recompute, the contract, the issue codes, the limits and the owed tests follow; refusing parallel directions is rejected alternative 11; the prototype was changed and the edges measured again (eight rows) |
| The call `parallelDirections` of the scenario (steps 5 and 6 over 4 × 3) has no two places in one | codex, minor | Yes | The calls `onePlaceTwice` (the step 5 in both: the copies 1 and 1000) and `onOneLine` (the steps 5 and 6: ok), both measured |
| "The time is that of a row of as many copies", "200 holes take as long in a grid as in a row": the table of the design itself shows a grid a quarter slower, on single runs | internal, minor (factual) | Yes | The runs were repeated two or three times each (they agree to 2 s): a grid is a quarter to a third slower (corrected in round 2: a fifth to a good third). The statement of "The route" says "of the order of", and the three give the numbers |
| The form: remembering the second direction needs a slot of its own, because `rememberPattern` runs before every change and overwrites the transform of the kind; the spans of the second direction would come back as those of the first; two controls would share a label, and the tests find a control by its label; the default second axis can be parallel to a first direction that is a sketch normal; `draftCommand` is tested in `fields.test.ts`, the texts of issues in `issue-text.test.ts` | internal, minor; codex, minor (the memory) | Yes (`sketch-commands.ts`: `rememberPattern`, `PatternMemory`; `features/pattern.ts` of the app: `set`; `app-kit.ts`) | "The app and MCP": the slots `second`, `secondSpacing`, `secondLength` and when each is written; labels of their own; the note on the default; the tests by file |
| A copy that a smaller count no longer makes is not `brokenReference` everywhere: a projected edge is the warning `brokenProjection` with the curve kept, body properties stay an entry without a body | codex, minor (factual) | Yes (`features/sketch.ts`: the projections; `sections/body-properties.ts`) | "A change of the counts" lists the places as 2e does; an owed test per place |
| The calls of the drain holes check volumes and the presence of tags, not that a hole stays in its place | codex, minor | Yes | `boreAt` reads the published cylinder of a bore (measured: its origin is the axis of the hole, exactly); `drainChecks` and `oneMoreEachWay` check the places of the copies 3, 1002, 2003 and of the new 4 and 3004 |
| The order in which the copies are applied is not independent of the first count: one more column is applied before the rows above it, where a longer row only appends. For tools that touch or overlap, the owner of a shared face, the copy `noEffect` names and the reach of "through all" can change under unchanged numbers | internal, minor | Yes (`applyTool`: `renamedOnly`, the faces an addition renames) | Said in "The numbers", a known limit, an owed test. The order stays row by row |
| "A step would have to make older builds refuse" for a pattern as a source: the rule of `schema.ts` prescribes no step for a document that loads and is then an error, and 2e left it open | codex, minor | Yes (`schema.ts`, the head; `requireRef` on a load) | The row of the comparison says that route has a decision to make there |
| The paragraph of `CONVENTIONS` about body IDs says "`<pattern>/<number>` (numbered from 1)"; an AI composes the IDs by counting | internal, minor | Yes (`packages/mcp/src/api.ts`) | The sentence gets its half sentence; "Where the code lives" and "The app and MCP" name it |
| Docs and files the implementation touches and the design did not name: `docs/ui/errors.md`, `docs/architecture/recompute.md` (both lack `invalidHole` today), `packages/scenarios/test/box.ts`; and `design.md` still says "no grid" in three places | internal, minor | Yes | "Where the code lives" names them; the three places of `design.md` are named as superseded (that file gets only its pointer) |
| "The bound of a count may grow up to 999": the steps run from 0 to `count − 1`, so the stride 1000 allows a count of 1000 | codex, nit (factual) | Yes | 1000, in the design and in the contract |
| "`CLAUDE.md` says the schema version is 5": it says 6 | codex, nit (factual) | Yes (the claim came from a stale copy of the file) | The item is removed |
| "`document.ts`, `index.ts`: the exports, next to `MAX_PATTERN_COUNT`": that constant is exported by `document.ts` alone | internal, nit (factual) | Yes | `GRID_STRIDE` and `MAX_PATTERN_PLACES` are exports of `index.ts`, and the texts are built from them |
| The condition of `transform/second/count` stands in for "there is a second direction"; `describe_api` prints the count twice | internal, nit | Yes | Said in "Document and validation"; a half sentence of `CONVENTIONS` |
| A circular pattern of a body over an angle of a full turn has the harm the grid refuses, with no issue | internal, nit | Yes (`PATTERN_ANGLE` allows ±2π; the step is `angle / (count − 1)`) | Said in the decision and in the limits; a line for the backlog. Not changed here: for features it is the tested `noEffect` of D35 |
| The contract: `copyNumber` and `copyBody` are exported and named nowhere in the design; `PatternCopy` is `Copy` in the prototype; the header still says "no issue code"; the engine's `LinearSpan` has the name of an alias of the app | internal, nit | Yes | The two helpers are marked as helpers of the contract and the calls; the name is said; the header is reworded; the alias is named in "Where the code lives" |
| Wording of the measurements ("528 mm³, eleven copies and the original at 48 each"; "twelve times 123.6521 (1483.8255)"); "Shared places" left out `types.ts`, `api.ts`, the exports and `axis-picker.ts`; the comparison of the routes left out that a pattern as a source would reuse a memoised inner row | internal, nit | Yes | Reworded; the list is complete; a row of the comparison |

Checked by the reviewers and found sound: that `master` refuses `transform.second` on every way a document or a command comes in (`engine.load`, the app, the MCP server), refuses an expression at `transform/second/count`, and drops a field put on the feature; the rule of `schema.ts` against it; that the recompute writes the values of expressions back whatever the step answers, so the bound cannot be the validator's (and that a validator would also block later changes of such a pattern); `invalidPattern` against `invalidExpression`; the patch rules traced through `mergePatch`, `replacedPaths` and `removedPaths`, with `second: null` on a row accepted only through `removable`; every reader of the fields of the registry and of `when`; that nothing in the engine, the sections, the queries, the exports, the app or MCP derives a copy number from a position, sorts copies or expects numbers without gaps; that the copies of the first row are those of a row to the last bit; no new case of the order of two face keys; that the directions `axis` returns are unit vectors today; every call of `scenario12grid` and its numbers, recomputed by hand by the internal reviewer (the polygon of a hole of 2 mm has 23 sides: 6.2053 mm³) and run by codex; the lines of `wrongGrid` that must not compile.

Not acted on: nothing. For the rule of the places the internal reviewer offered two ways (test the harm, or keep "parallel" with the tolerance of the engine); the first is taken.

By the rule of the briefs (more than six findings, at least three of them factual errors) a second round follows, on the fixes.

### Round 2 (2026-11-17), narrow: the fixes of round 1, at `90fc7ef`

- **internal**: another fresh subagent (Fable 5.2, effort high), given the diff of the fixes and the record above. It recomputed the examples of the new rule with a script of its own and the changed calls by hand.
- **codex**: as in round 1; it reproduced its first finding with `shift` and `transformSolid` of the repository and, as it reports, ran the eleven copies of the call `onOneLine` one by one with the real adapters.
- **agy**: tried again, still out of quota (HTTP 429); left out.

Nine distinct findings and a row of nits, no blocker. One is major (codex), three are factual errors in text the fixes of round 1 wrote.

| Finding | Who | Severity | Holds? | What changed |
|---|---|---|---|---|
| The new rule still lets through copies that are one float32 mesh: `LENGTH_TOLERANCE` compares translations in double precision, and `transformSolid` stores float32. A cube at x = 64 in a grid 2 × 2 along X with the steps 5 and 5.000002 passes, and the copies 1 and 1000 have bit-identical positions. The limit "places that nearly meet are places" described the far side of that band only | codex, major; internal, minor | Yes (`solid.ts`: `transformSolid`); reproduced with the prototype | The guarantee is narrowed and said so: the rule compares places, not meshes. The decision states the band with the measurement, why a threshold scaled by the coordinates was not taken (the places do not tell where the body lies, tools are not built yet, nothing else in the engine refuses two bodies so close), a known limit, an owed test of the behaviour as it is, the row for `decisions.md` |
| "Only parallel directions can give it" and "a count of 1 leaves places along one direction, which never meet" are false under a tolerance: a field must not be zero but may be 10⁻⁷, and a `length` is divided, so a step can be shorter than the tolerance and the copy 1 is refused against the original, with directions across each other, and in a grid 1 × 5 (there the copy 1000, corrected in round 3). A grid N × 1 is then refused where the same row without `second` is accepted | both, minor (factual) | Yes (`catalog.ts`: `nonZero` is `!== 0`; `features/pattern.ts`: the step of a length); measured | The decision tells exact meeting (one line) from meeting within the tolerance (a short step), says that a grid is asked and a row is not, and drops the claim about a count of 1; the cheap variant, the contract, the text for the AI, the limits, the backlog line (the row beside the circular pattern) and three owed tests follow. "Closer than" is "at most … apart", as the prototype compares |
| `refs` of the error of the places: `transform/span` and `transform/second/span` are addresses of nothing (a string in `refs` is an ID or the address of a numeric field), and the counts, which decide as much as the spans, are missing (the "ok" example 5 and 6 over 4 × 3 is refused at 7 × 6) | internal, minor | Yes (`evaluate.ts`: the refs of `invalidExpression`; recomputed) | `refs` are the direction, the count and the numeric field of the span of each direction; the prototype follows, and the call `onePlaceTwice` checks them |
| The step has to hand the detail on: today it calls `failed(transforms.code, transforms.refs)`, and "the rest of the step is unchanged" would lose the copies the detail names; the app shows nothing else of this issue | codex, minor | Yes (`features/pattern.ts`, the first lines of `step`; `issue-text.ts`) | "Recompute" names the call with the detail; the app and the contract say the detail is all the user is told; a test of the text as shown is owed |
| The call `onOneLine` (the steps 5 and 6 over 4 × 3) is ok by the code, but is not "twelve holes on one line": six pairs of the holes overlap and two touch, two lie under the rib; and the engine refuses that very layout as points of one hole feature | internal, minor | Yes (recomputed; `features/hole.ts`: the overlap of two points) | The call is two rows half a step apart (a count of 2, a step of 2.5): eight separate holes, eight times the volume of one, the bores of 1001 and 1003 in their places (measured). `onePlaceTwice` checks `refs` and the message as well |
| The owed test of the order of application would show nothing: slots that touch along the first direction leave the second row alone. An old copy finds something else only when a tool of the added column reaches a copy of a later row | internal, minor | Yes (the loop of `step`) | The condition is said precisely in "The numbers" and in the limit; the test is a cut 6 × 6 with the steps 5 and 5, where the copy (4, 0) overlaps (3, 1). (That test shows nothing either; replaced in round 3) |
| "It would block every later change of that pattern but one that lowers a count" is false: `second: null` and another kind pass, a count lowered too little does not, and `renameFeature` and `setSuppressed` do not validate | both, minor (factual) | Yes (`document.ts`) | Reworded: every `updateFeature` and `setField` that leaves the product as it is |
| "A quarter to a third slower" does not match the table (21 %, 27 %, 37 %); the record of round 1 says three statements say "of the order of", and one does | both, nit (factual) | Yes | "A fifth to a good third", with the three numbers; the record is corrected |
| Rejected alternative 11 said "directions inside any such tolerance still pass", the opposite of what is meant, and its criticism holds for the new threshold within its band | both, minor | Yes | "Just outside it"; the alternative says the rule taken has a band of its own |
| Leftovers and loose wording: "`document.ts` beyond an export"; "the other texts that say 'from 1'" (one of four does); the quote "neither is taken here" is in the list "Deferred" of `design.md`, and its rejected alternative 4 is not superseded; the message "the counts and the directions" when the cause can be a span; which point is compared; the line count of the prototype from before its change; "`i · step = j · second step`" without the sign; a remembered second direction can lie along the first as well; `rememberPattern` runs before every change of the transform, not of the source | internal, nits | Yes, but for the last | Each corrected where it stands; the prototype is 84 lines added and 23 removed. The last was wrong: `set` remembers before a change of the source too, as the text first said (restored in round 3) |

Found holding by both: the examples of the rule, recomputed in the order of the numbers (also Y against −Y, and directions 10⁻⁸ and 10⁻³ rad apart); the comparison (the original is among the places, the bound comes first, 19 900 pairs); that the first row is that of a row to the last bit; what is said of the circular pattern over a full turn; `boreAt` and the places and volumes of the drain calls; what refers to a copy that is gone; the exports; the two texts of `CONVENTIONS`; the memory slots, the labels, `axisRows` and the form of a joint, the files of the tests; the docs named; that no leftover of the rule about parallel directions is in the three files, and that the contract, the calls and the rows for the indexes agree with the design.

Not acted on: the threshold scaled by the largest coordinate of the places, which the internal reviewer offered as an alternative to stating the band. The band is stated; the reasons are in the decision.

The round had more than six findings, one of them major and three factual errors, so the third round, the last allowed, reads the diff of these fixes.

### Round 3 (2026-11-17), the last: the diff of the fixes of round 2

- **internal**: a fresh subagent (Opus 5.5), given the diff of the fixes and the record above. It recomputed the float32 numbers in Node, ran the order of application against the prototype (a blind round pocket in both orders) and recomputed the calls `onePlaceTwice` and `onOneLine`.
- **codex** (`gpt-6-astra`, reasoning effort high, read-only sandbox). It reproduced its first two findings with `shift`, `transformSolid`, `rotation` and `transformFace` of the repository, and ran the square cuts of the owed test with the real kernel.
- **agy**: tried once, still out of quota (HTTP 429); left out.

Ten distinct findings, all minor or nit; no blocker and no major. Four are factual errors, two of them written by the fixes of round 2.

| Finding | Who | Severity | Holds? | What changed |
|---|---|---|---|---|
| "Closer than the float32 step, the copies are one mesh to the last bit" is false in general: each vertex rounds on its own, so it is the same float or one step away (5.000003 and 5.000005 at x = 64 give 69 and 69.0000076; 26.66667 against `80/3` differs at every vertex of a cube at integer coordinates); and the contract said "their coordinates", meaning the places, against the argument that the places do not tell where the body lies | both, minor (factual) | Yes (`solid.ts`: `transformSolid` rounds each vertex) | "Coincide to float32: each vertex the same float or one step away", at the coordinates of the copied body; in the decision, the contract, the limit, the owed test, alternative 11, the rows for `decisions.md` and the backlog. The measured example stays |
| "Directions do not [fall into the band] today": `axis` takes the normal of a sketch as it is, and a sketch on a face of a turned copy has a turned normal (`transformFace`); two directions 2 · 10⁻⁷ rad apart with steps of 10 mm give places 2 · 10⁻⁶ mm apart. And the cases of meeting left out nearly parallel directions, which the owed tests already had | codex, minor (factual); internal, minor | Yes (`recompute/services.ts`: `axis`; `solid.ts`: `transformFace`) | A third case of meeting in the decision and the contract; the band names directions; the limit says where they come from |
| The owed test of the order (a square 6 × 6 with the steps 5 and 5) cannot show the order: for rectangles along the axes the overlap of (4, 0) and (3, 1) lies in (3, 0), which comes first in either order; what changes when the count grows comes from the new copy (4, 1), which a row shows as well | both, minor | Yes (codex ran the cuts in both orders; the internal reviewer ran the faces of (3, 1) both ways; the prototype here: no warning either way) | The test is two measured cases: slots along one line with the steps 5 and 2.5, where at 5 × 2 the copy 1003 joins `noEffect` and loses its faces; and a blind round pocket against the same places with the directions swapped (25.0000 against 25.7418 mm²). The example and "needed, not enough" go into "The numbers", the measurement into "What was measured" |
| The text for MCP and the row for `decisions.md` said "the same step along two parallel directions", narrower than the rule (5 and 10, 5 and −5 meet too); an AI could take 5 and 10 along one line for fine | internal, minor | Yes | "Whole numbers of steps along parallel directions that reach the same place (5 and 5, 5 and 10, 5 and −5)", a step of next to nothing, directions a hair apart; also in the cheap variant |
| "`rememberPattern` runs before every change of the transform", and the record of round 2 "not of the source": `set` remembers before every change, the source included; only a body picked in the view goes past it | both, minor (factual) / nit | Yes (`packages/app/src/features/pattern.ts`: `set`, the pick in the view) | The form's text says so; the record of round 2 says its correction was wrong |
| The example in a grid 1 × 5 names the copy 1, where it is the copy 1000 (the table of the measurements had it right) | codex, minor (factual) | Yes | The decision names both copies; the record of round 2 is corrected |
| "The same rule could close both" (the backlog) does not hold for the circular pattern: the translation of a turn about an axis through the origin is zero for every copy | internal, nit | Yes (`solid.ts`: `rotation`) | The backlog line says a turn needs a turned point compared, not the translation |
| `refs` of the error of the places: the record of round 2 justified them with "an ID or the address of a numeric field", and the two directions are neither | internal, nit | Yes | The design and the contract say they are paths into the feature, numeric or not |
| The prototype compares a vector computed beside the transform, the design the translation of the transform that is built | internal, nit | Yes (last bits only; no refusal changes) | "Recompute" says the implementation takes the translation from the transform |
| `onePlaceTwice` checked `includes('1 and 1000')`, which "21 and 1000" passes; the record of round 2 counted eleven findings for nine and a row of nits; the record of round 1 still said "a quarter to a third" | internal, nits | Yes | The call checks the whole sentence; the counts and the record are corrected |

Found holding by both: the float32 steps (2⁻¹⁷ and 2⁻¹⁹) and 26.66667 against `80/3`; the cube at x = 64 with the steps 5 and 5.000002; the reasons against a threshold scaled by the coordinates (`copiesOf` runs before the tools are built); the test of the places as the prototype runs it (the original seeded, `<=` the tolerance, 19 900 pairs, the first pair of every example of the decision); the six `refs` in the same order in the design, the contract, the call and the prototype; that the step has to hand the detail on and `issueText` adds nothing to it; the sentence about what a validator would block; the calls `onePlaceTwice` (the patch merges into a count of 3, the copies 1 and 1000) and `onOneLine` (eight holes 0.5 mm apart at x = 18 … 35.5, clear of the posts, the walls and the rib, no `noEffect`); the times (21, 27, 37 %); the size of the prototype; the texts about the ID of a copy; no leftover of what round 2 found false.

Not acted on: nothing. The prototype's own message text (an older wording) is not the design's and is not in the repository.

This was the last round allowed. What it found is fixed above; nothing is left open as a known limit beyond those listed.

## Rows for the indexes

**`docs/d36/README.md`**, the row of 2e in "Work packages": after "…no feature type, no issue code, no schema step." the last sentence ("A grid is deferred to a package of its own, with two routes named") becomes:

> The grid (owner, 2026-11-17) is an addition designed in [2e-pattern-mirror/grid.md](2e-pattern-mirror/grid.md): an optional second direction of `linear`, the copy at (i, j) numbered `i + 1000 · j`, at most 200 places and no two in one place, the error `invalidPattern`; no schema step

**`docs/decisions.md`**, the row D53: the state gets "the grid designed 2026-11-17 as an addition ([grid.md](d36/2e-pattern-mirror/grid.md)); not implemented. Measured: `master` refuses a document with `transform.second` and drops a field put on the feature itself, so the field lies in the transform and needs no schema step; numbers with gaps pass every reader of a body and of a face; 200 holes take 25 s in a grid and 18 s in a row; a cube at x = 64 copied to two places 2 · 10⁻⁶ mm apart passes the rule of the places, and the two copies have bit-identical vertices", and in the decision the last sentence ("A grid is deferred, with two routes named …") becomes:

> A grid is a second direction of the linear pattern (`transform.second`: a direction, a count, a span), for features and for a body. The copy i steps along the first direction and j along the second has the number `i + 1000 · j`, so a place keeps its number whatever the counts are and a row that becomes a grid keeps its copies. At most 200 places, and no two places in one place (whole numbers of steps along parallel directions that reach the same place, a step below 10⁻⁶ mm, directions a hair apart; places are compared, not meshes): the error `invalidPattern`, judged by the recompute. A pattern of features as a source of a pattern stays open for a mirror of a mirror and a circle of rows

**`docs/requirements.md`**, scenario 12, a part after "Linear pattern and mirror":

> - *The grid (2e, D53, an addition).* The vent row gets a second direction along Y with a count of 2 and the spacing `W - wall - 0.5`, a patch that names the second direction alone: the far long wall loses the 240 mm³ the near one lost, the copies of the row keep the numbers 1 to 4 and the far wall has 1000 to 1004. A sketch stands on a slot of the far wall (copy 1004) and stays where it is when a sixth slot per wall is added by the one parameter (the copies 5 and 1005); eighteen per wall give the warning `noEffect` with the copies 16, 17, 1016 and 1017. The floor gets drain holes: one plain hole of 2 mm through all at a point of a sketch on the floor, and a grid of it, 4 columns 5 apart along X and 3 rows 6 apart along Y, both counts parameters: twelve times the volume of one hole, the bore of the last place tagged 2003 with its axis through (33, 22); a fifth column and a fourth row are two parameters, add eight holes (the copy 4 at (38, 10), the copy 3004 at (38, 28)) and move none. Fifty columns of five rows are the error `invalidPattern` of the pattern with the two count fields in `refs`, and the box is as it was before the grid; a second direction along X with the step of the first would put the copies 1 and 1000 into one place and is `invalidPattern` with the copies named, while along X with a count of 2 and a step of 2.5 the eight holes stand apart on one line and the pattern is ok; `second: null` makes the grid a row again and drops the expression of its count; `second` on a mirror is an invalid command, and half a second direction on a row as well. Six lids for the print bed are the row of three with a second direction: the bodies `lids/1`, `lids/2`, `lids/1000`, `lids/1001`, `lids/1002`, the last two lids along X and one along Y from the original; each takes the material of the lid and its mass, a link lists copies of both rows, a sketch stands under a copy of the second row, and no pair collides. A fourth lid per row adds `lids/3` and `lids/1003` and moves none; one row leaves a link that listed `lids/1002` with it under `missing`. The document loads to the same model, and its schema version is the one it had.

**`docs/backlog.md`**, the entry "Linear pattern and mirror of features and bodies": "a grid (two routes named there)" becomes "the grid as a second direction of the linear pattern (designed, [grid.md](d36/2e-pattern-mirror/grid.md))", and what is left for later gets: a pattern of features as a source of a pattern (a mirror of a mirror, a circle of rows), a second transform of another kind in one pattern, staggered rows, a third direction, copies left out of a grid; and two holes the grid leaves as they are on `master`: a circular pattern of a body whose span is a full turn puts its last copy on the original without an issue, and a row with a step below 10⁻⁶ mm makes copies that coincide to float32 (the grid refuses two places in one; comparing places could close the row, and comparing a turned point, not the translation, which is zero for every turn about an axis through the origin, the circular pattern).

## As implemented

Implemented 2026-11-17 on the branch `d36/2e-grid` from `master` at `37772c0`, with the defaults of both open questions (the owner had not answered them): the stride 1000 as `GRID_STRIDE`, and at most 200 places for features and for bodies as `MAX_PATTERN_PLACES`. The engine side is that of the design: `second` and `LinearSpan` in `types.ts` with the comments `describe_api` reads, `invalidPattern` in `ErrorCode` and in `MESSAGE`, and in `features/pattern.ts` one validator of a direction used twice, the references, the four field descriptions, `removable`, the two constants (exported by `index.ts`) and the summary. Nothing that reads a body, a face, a link, body properties, a query or an export changed: the numbers with gaps pass through them, as measured by the design (the owed tests confirm it).

**The schema: no step, as measured.** `SCHEMA_VERSION` and `SCHEMA_PENDING` are untouched. The build of `master` lists the fields of the variant `linear` (`onlyFields(transform, ['type', 'direction', 'count', 'span'], …)` in `git show master:packages/engine/src/features/pattern.ts`), so it refuses a document with `transform.second`, and `second` lists its own fields in this build. The scenario saves and loads a document with grids at the version of the build.

Where the code differs from the design, or the design left a choice:

- **`copiesOf` is exported** from `features/pattern.ts`, with the grid in a function of its own (`gridOf`), so that the owed tests at the function that makes the copies (directions 10⁻⁸ and 10⁻³ rad apart) call it with a stub state; `PatternCopy` is internal. `transformsOf` stays for the row, the circle and the mirror, and the step of a direction is one helper (`stepOf`) for the row and the grid.
- **The labels of the form** keep the suffixes of the labels of today: *Count along the direction (a whole number or an expression)*, *Count along the second direction (…)*, *Second spacing (mm or an expression; negative = against the direction)*, *Second length (…)*. The checkbox is *A second direction (a grid)*.
- **The picker of a direction takes a record of labels** (`DirectionLabels`: the select, the select of the sketch, the button that repairs a point that is gone; `FIRST_DIRECTION`, `SECOND_DIRECTION` in `axis-picker.ts`), not only the label of the direction: the button *Use the origin of the sketch* of review of 2e would otherwise appear twice when both directions lose their point. The one of the second direction is *Use the origin of the sketch of the second direction*. The parameter stays optional; the form of a joint is untouched.
- **`PatternChange.second`** is a `DirectionChange` (an axis change, `count`, `span`, `spacing`, `length`), and one function (`changeDirection` of `sketch-commands.ts`) changes either direction, each with the remembered spans of its own slots.
- **The owed tests** are in `packages/engine/test/pattern.test.ts` (the document and `copiesOf`), a new file `packages/scenarios/test/grid.test.ts` (the recompute against the real adapters), the part of scenario 12 in `scenario12.test.ts` with its steps in `box.ts` (`ventsOnBothWalls`, `drains`, `sixLids`, `secondDirection`), `mcp/test/tools.test.ts`, and the app tests the design names. The two measured cases of the order of application are tested as the design has them: the slots along one line (`noEffect` names 1000 … 1002 at 4 × 2 and 1000 … 1003 at 5 × 2, the faces of 1003 gone) and the blind round pocket, whose floor of the place (3, 1) measured here what the design measured, 25.0000 against 25.7418 mm². The volumes of the slots (140 and 180 mm³) are not pinned: the layout of the plate here is not the prototype's. The grid of features is a plate 120 × 80 × 4 with a slot 2 × 6, as in "What was measured", and its places are those measured (copy 3 at (20, 5), 1000 at (5, 15), 1002 at (15, 15), 2003 at (20, 25)). Every number of the scenario came out as the design measured it, 6.2053 mm³ for a drain hole and 23.056 g for a lid included.
- **Docs**: `ui/errors.md` and the copy of the issue codes in `architecture/recompute.md` also got the row of `invalidHole` they lacked. The paragraph "A grid, later" of `design.md` got a line that points here.
- Not done here, for the merging session: the rows of `docs/d36/README.md` and `docs/decisions.md` ("Rows for the indexes"). Not checked in a browser: the form is driven by `app.test.ts` (snapshot `pattern-kinds.txt`) and its logic by the unit tests.

### Review of the implementation (2026-11-17)

A fresh subagent (Opus 5.5), read-only, on the diff of the implementation with this design as the reference: no blocker, no major, one minor finding and three nits. Regressions are in `packages/engine/test/review.test.ts` and in a new `packages/app/test/review.test.ts`.

| Finding | Severity | What changed |
|---|---|---|
| The test of the fields checked only that each field `fieldsOf` reports is listed in the registry, not the conditions (`transform/second/count` is listed twice, under `transform/second/span/type`) | minor | A regression compares, for a row with either span, a grid with a spacing and one with a length, a circular pattern and a mirror, the entries of the registry whose condition holds with what `fieldsOf` reports, as path and spec |
| The hint that no sketch is before the pattern would show twice when both directions are pickers | nit | The second picker passes no hint; `axisRows` shows none for an empty one |
| `addFeature` with `transform.second: null` was refused with the generic Czech text of an object, while a patch accepts `second: null` | nit | Refused in English: "an object { direction, count, span } is expected; leave the field out for a row" (also on a load); the patch still removes it. `null` is not taken for "absent" in a feature, because a feature has one spelling |
| Long lines of the comments of `types.ts` that `describe_api` reads verbatim | nit | Re-wrapped |

