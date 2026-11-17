# 2e, an addition: the grid (D53)

**State: designed 2026-11-17; not implemented.** An addition to [design.md](design.md) (the linear pattern and the mirror, implemented and merged). The owner decided on 2026-11-17 that the grid is wanted, as an addition to 2e; the decision stays D53. Written against the code of `master` at `633a6ca`. The engine side was built as a prototype in a copy of the repository and run against the real adapters; the numbers are under "What was measured".

Files: [contract.ts](contract.ts) (the parts marked "the grid": the second direction, the numbers of its copies, its fields, the error code), [calls.ts](calls.ts) (`scenario12grid`, its part of validation scenario 12).

## What the design of 2e and the backlog say, checked against the code

[design.md](design.md), "A grid, later", weighed three routes and took none: copies of a second direction numbered row by row (rejected there: a change of a count renumbers the copies), a second direction with numbers that do not depend on the counts (features and bodies), and a pattern of features as a source of a pattern (features only; also a mirror of a mirror). [backlog.md](../../backlog.md) keeps "a grid (two routes named there)". The owner asked for a route that covers bodies as well as features unless measurements show it is worse.

| Statement of 2e | What the code of `master` says |
|---|---|
| "Numbers with gaps are legal already: `createsBody` and the tag of a face accept any number from 1" | True, measured on `master` with a row of three bodies: a cut into `<row>/1000` is a valid command and `brokenReference` in the recompute; body properties of `<row>/2003` are accepted; a link that lists `<row>/1001` names it under `missing`; a sketch on a face tagged `index: 1001` is a valid command and `brokenReference`. Every reader takes the number as it is: `createsBody` (a number from 1 without leading zeros), the tag of a face (`faceName`: an integer from 1), `faceKey` (`/@<pattern>:<index>`), `FeatureResult.bodies`, `refs` of the shape `{ copy, feature }` |
| "Only the pattern's own `index: i + 1` would change" | True: the number of a copy is made in one line of `step` (`features/pattern.ts`), from the position of its transform in the list `transformsOf` answers. Nothing else derives a number from a position |
| "The stride becomes part of the meaning of every document, so the bound of a count can never grow" | True of any stride. With the stride 200 named there the bound could never grow; this design takes 1000, which leaves room up to 999 ("The numbers") |
| "The product of the two counts needs a bound that only the recompute can check" | True. A field holds its last valid value and its expression is evaluated by the recompute (`Evaluator.resolve`), which writes the new values back whatever the step then says; a product checked by the validator would refuse, on load, a document this build saved. The precedent is the hole: "the head is not wider than the bore" is the error `invalidHole` of the recompute, also for plain numbers |
| "A second direction is a field the variant `linear` does not list, so this build refuses the document by itself" | True, measured: `master` refuses a document whose linear transform has a field `second` ("features[4].transform.second: a transform of the type linear has no such field"), a field inside its span, and an expression at `transform/second/count`; the commands as well. **A field directly on the pattern feature is dropped without a word** (measured: the document loads and the pattern is a row). So where the field lies decides whether a schema step is needed |
| "A pattern listed as a source of a pattern is loaded and is then `brokenReference`" | True, measured: the command is refused ("is not a feature that applies a tool"), a document that holds it loads and the pattern is `brokenReference` |
| The third route changes "`State.tools`, `applyTool`'s placement and `producesTool`" | True, and more: `ToolRecipe` is one operation with one list of targets; `Placement` is one transform and one `CopyTag`; the wrappers of `build` in `features/extrude.ts` and `features/hole.ts` write `copy: [placement.copy]`, a list of one |

## The route

**A second direction of the linear pattern, with copy numbers that do not depend on the counts** (the second route of 2e).

| | A second direction (taken) | A pattern as a source of a pattern |
|---|---|---|
| Covers | features and bodies | features only: a pattern of a body has one source body, and a pattern of several bodies is deferred |
| The engine | prototyped: 77 lines added and 22 removed in three files; every test of the repository passes but the three that pin the list of the fields | not prototyped. A pattern would leave a list of applications instead of one recipe; `Placement` would hold a product of transforms and a list of tags; each wrapper of `build` appends instead of writing a list of one; `refs` of a failed copy name a copy inside a copy |
| Names | one tag per face, as today; the number says the place (`1002`: two steps along the first direction, one along the second) | two tags per face; each count keeps numbers of its own |
| Also gives | nothing | a mirror of a mirror of features (four corners from one), a circle of rows |
| A build without it | refuses the document (measured): no schema step | loads the document and reports `brokenReference` (measured): the model lacks the grid, so a step would have to make older builds refuse |
| Time | one boolean per copy and target, as every pattern of features | the same booleans |

No measurement speaks against the second direction: numbers with gaps pass through every place that reads a body or a face (bodies, body properties, links, the queries, the exports, sketches on faces of copies; "What was measured"), and the time is that of a row of as many copies. What it does not give is the mirror of a mirror and the circle of rows. The other route stays open for them and is not blocked: it would add a second tag to the faces, which the names allow today.

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
- **At most 200 places** (`count × second.count`), and **the two directions must not be parallel**; both are the new error `invalidPattern` of the recompute.
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
- A second direction with a count of 1 is a row: no copy uses the direction (it is still a reference, and still checked).

### The numbers: `i + 1000 · j`

- **A place keeps its number whatever the counts are.** With the span `spacing` in both directions a larger count adds copies and moves none, so `<pattern>/1002`, a face tagged `index: 1002`, a sketch on that face and a link that lists the body keep meaning the same place. (With the span `length` a change of that count moves the copies along that direction, as in a row today; the numbers stay.) Measured: a sketch on a face of copy 1002 of a grid 4 × 3 stays where it was in a grid 5 × 4.
- **The row of the original has the numbers of a row.** The stride multiplies the steps along the second direction, not the first, so a row that gets a second direction keeps its copies: `1` … `count − 1` are what they were, and the new rows start at 1000. Measured on the vent row of scenario 12.
- **The stride is 1000**, not the bound of a count (200) and not a pairing function:
  - it is read without a calculator: `2003` is three steps along the first direction and two along the second;
  - the bound of a count may still grow, up to 999;
  - a pairing of two numbers (Cantor's, or the one that fills squares) has no bound at all, but gives the row of the original other numbers than a row has (so adding a second direction would rename every copy) and numbers nobody can read.
- **The stride is part of the meaning of every document with a grid** and is never changed: `GRID_STRIDE` (`features/pattern.ts`, exported). A test pins it above `MAX_PATTERN_COUNT − 1`.
- **The numbers have gaps.** A grid 4 × 3 has the copies 1, 2, 3, 1000 … 1003, 2000 … 2003. Nothing counts copies by their numbers: `FeatureResult.bodies` lists the bodies that exist, the tags of the faces say which copies there are.
- **The order of the copies is the order of their numbers**: row by row, the row of the original first. It is the order the copies of features are applied in (for each copy the sources in the order of the list, as today), the order of `refs` of `noEffect`, and the order of `FeatureResult.bodies`.

### At most 200 places, judged by the recompute

`count × second.count ≤ MAX_PATTERN_PLACES` (200, the bound of a count: "a pattern has at most 200 places, the original included, in a row or in a grid").

- Each count has its own bound of 200, which keeps a typo in an expression from starting thousands of booleans; two counts at that bound would be 40 000 places. One number for both cases: a grid 14 × 14 or 20 × 10, a row of 200.
- The bound is that of the time of a pattern of features: 200 holes take 20 to 25 s in a grid as in a row (measured). Bodies would allow more (199 copies in 0.06 s); one rule is kept for both sources.
- **The recompute judges it, never the validator.** Either count may be an expression; the recompute evaluates the expressions and writes their values into the fields whatever the step then answers, so a document can hold two counts that are each in range and too many together. A validator that refused the product would refuse such a document on load (measured: with the check in the step alone it loads, and the pattern is in error). With plain numbers it is the same rule in the same place, as for the dimensions of a hole.
- The error is `invalidPattern` with `refs: ['transform/count', 'transform/second/count']` and the product in the detail; the pattern is in error as a whole and the model stays as it was before it.

### Parallel directions are an error

When both counts are above 1 and the two directions are parallel, the pattern is `invalidPattern` with `refs: ['transform/direction', 'transform/second/direction']`.

- Two places then fall into one (with equal steps the place (1, 0) is the place (0, 1)). For features the second copy would only be a `noEffect`; for a body it would be a second body in the place of the first, with nothing to say so: twice the mass and a collision of two copies.
- It is the only way two places can meet: with independent directions and steps that are not zero, `i · a + j · b` is another point for another (i, j).
- The directions are known to the recompute only (the normal of a sketch plane), so the validator cannot ask; two equal base axes could be refused by a command, and are left to the same rule.
- Parallel means the cross product of the two unit directions is shorter than 10⁻⁹. Directions that are nearly parallel make a narrow grid, which is a grid.

### An error code of the pattern

`invalidPattern`, an error: "The counts and the directions do not make a pattern", with the reason in the detail.

- The two conditions above are neither a broken reference nor a failed copy, and they are found where the values and the directions are known. The extent and the hole have a code of this kind (`invalidExtent`, `invalidHole`).
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

- More columns or rows add copies; fewer take the copies of the places that are gone, and what refers to them is `brokenReference` (a link: `missing`), as with a smaller count today.
- `second: null` leaves the row of the original with its numbers.
- A change of the kind keeps the IDs and the tags, as 2e says. A circular pattern or a mirror has no copy from 1000 on.

## Recompute

`step` of `features/pattern.ts` asks for the copies with their numbers instead of a bare list of transforms (`PatternCopy` in `contract.ts`): `copiesOf(transform, state)`.

| Transform | Copies |
|---|---|
| `circular`, `mirror`, `linear` without `second` | as today: the transforms of `transformsOf`, numbered from 1 in their order |
| `linear` with `second` | resolves both directions (`axis(ref, state)`; the error of either is the error of the pattern, as today); then the bound of the places; then the parallel directions; then, for j from 0 to `second.count − 1` and i from 0 to `count − 1` without (0, 0): the transform `compose(shift(a, i · u), shift(b, j · v))` and the number `i + GRID_STRIDE · j` |

`u` and `v` are the steps: the `spacing`, or `length / (count − 1)` (zero steps for a count of 1). The rest of the step is unchanged: it reads `index` from the copy where it computed `i + 1`.

## Document and validation

- `patternTransform` validates the first direction and, when `second` is there, the second by the same function with the paths `transform/second/…`; `onlyFields` lists `second` among the fields of `linear`, and `direction`, `count`, `span` as the fields of `second`.
- **References**: `refs` adds `axisRefs(second.direction, 'transform/second/direction')`, so `moveFeature` keeps the pattern behind the sketch of its second direction (measured).
- **Numeric fields** in the registry (`PATTERN_FIELDS` in `contract.ts`): `transform/second/count`, `transform/second/span/spacing`, `transform/second/span/length`. The count is listed once per span, with the condition on `transform/second/span/type`: a condition names one value, and a pattern without a second direction has neither (as `transform/count` is listed per kind). `fieldsOf` reports what the validator read.
- **`updateFeature`**, by the rules of today (`mergePatch`): `{ transform: { second: { … } } }` merges by field with the second direction the pattern has (the span of another type is replaced whole, the direction is a reference and replaced whole); on a row it is the new value and has to be complete. `{ transform: { second: null } }` removes it, and the expressions under `transform/second/` go with it; the module answers `removable` for that path on a linear pattern, so the patch is accepted on a row as well (a form sends it either way). A patch with another `type` replaces the transform, the second direction included. All measured.
- **`setField`** reaches the fields of a second direction the pattern has; it cannot add one (no field of it has a default).
- **The schema: no upgrade step.** The rule of `schema.ts`: no step "where a build without the addition refuses by itself: … a field where the validator lists the fields it allows". `master` lists the fields of the variant `linear` and refuses `second` on load (measured, first table), and `second` lists its own fields, so a later field of it is refused by a build of this addition in turn. `SCHEMA_VERSION` stays 6, `SCHEMA_PENDING` is not touched, documents of today load unchanged. The error code is not part of a document.

## Where the code lives

| File | What the grid does there |
|---|---|
| `packages/engine/src/types.ts` | `second` in the variant `linear` and the type `LinearSpan`, with the comment of `PatternTransform` (read by `describe_api`): the places, the numbers, the bound, the parallel directions; at `PatternFeature` ("numbered from 1"), that a grid numbers its copies `i + 1000 · j`; `invalidPattern` in `ErrorCode` with its comment |
| `features/pattern.ts` | the validation of a direction as one function used twice; `copiesOf`; the references; the fields; `removable`; `GRID_STRIDE`, `MAX_PATTERN_PLACES`; the summary of the type |
| `recompute/services.ts` | `MESSAGE.invalidPattern` |
| `document.ts`, `index.ts` | the exports (`GRID_STRIDE`, next to `MAX_PATTERN_COUNT`) |
| `packages/mcp/src/api.ts` | `CONVENTIONS`: the paragraph of the pattern (below) |
| `packages/app` | below |
| tests | below; the three that pin the list of the fields change (`pattern.test.ts`, `tools.test.ts`, `scenario12.test.ts`) |
| docs | `architecture/pattern.md` (the linear kind, the numeric fields, the validation, the derived body IDs, the limits), `ui/pattern.md`, `architecture/verification.md`, and the indexes ("Rows for the indexes") |

`createsBody`, `bodySource`, `applyTool`, `solid.ts`, `validation.ts`, `document.ts` beyond an export, the sections and every query stay as they are.

## The app and MCP

**MCP.** No code: the commands carry the field, `describe_api` is generated. The paragraph of the pattern in `CONVENTIONS` changes: the sentence "There is no grid yet: a grid of holes is one hole feature …, a grid of slots one extrusion of several regions" is replaced by the grid, and the part (2) gets:

- `second: { direction, count, span }` makes a grid, each field as in the first direction;
- the number of the copy i steps along the first direction and j along the second is `i + 1000 · j`: the first row is 1, 2, …, the second 1000, 1001, …; the numbers do not depend on the counts, so with a spacing a larger count keeps every copy, and `bodies` of the pattern lists the copies that exist;
- at most 200 places together; parallel directions are refused; both as the error `invalidPattern` of the pattern, not of the command;
- `updateFeature` with `transform: { second: null }` makes a row again;
- four corners from one stay as they are described today.

**The form of the pattern** (`features/pattern.ts`, `changePattern` in `sketch-commands.ts`, `axis-picker.ts`), in the kind *Along a direction*, below the span of the first direction:

- **A second direction (a grid)**, a checkbox. Ticked, the draft gets the second direction the form had last, or a new one: a base axis other than the first direction (Y, or X when the first is Y), a count of 2 and a spacing of 10. Cleared, the form remembers it (`PatternMemory`), as it remembers the transform of each kind.
- **Second direction**: the picker of a direction with that label (`axisRows` takes the label of a direction instead of a flag). **Count along the second direction**; **Span** and its field, as for the first.
- A hint: "Copy numbers: steps along the first direction + 1000 × steps along the second, so the second row starts at 1000. At most 200 places."
- The count of the first direction is labelled *Count along the direction* while the second is there.
- `PatternChange` gets `grid?: boolean` and `second?:` the changes of a direction (an axis change, `count`, `span`, `spacing`, `length`); `changeTransform` applies them to `transform.second`.
- **`draftCommand`** sends `second: null` for a linear draft without a second direction: the patch of a transform of the same type merges, so a second direction the draft no longer has must be removed by name (as the taper of an extent is).
- **The summary** in the model panel: "Count 5 × 2 with the original, along axis X, spacing 4 mm, and along axis Y, spacing 47.5 mm; features: Vent".
- A copy is named by its number wherever it is named today ("copy 1002 of Pattern 5", "Pattern 5 / 1002"); the issue `invalidPattern` shows the message of the engine with its detail, like every issue.
- Tests of the app: `changePattern` for the second direction (`sketch-tools.test.ts`); the form in `app.test.ts` (the snapshot of the kinds of the pattern gets the checkbox row and a step with a grid, which the commit says).

## Issue codes

| Code | Kind | When |
|---|---|---|
| `invalidPattern` (new) | error | a grid with more than 200 places (`refs`: the two count fields); a grid with parallel directions and both counts above 1 (`refs`: the two direction fields) |
| `brokenReference` | error | the sketch or the point of the second direction is not in the state before the pattern; as today otherwise |
| `invalidExpression` | error | a count, a spacing or a length of the second direction whose expression fails or leaves its range, with `fieldErrors` by its path |
| `invalidExtent`, `invalidHole`, `emptyResult`, `kernelFailure` | error | a copy fails as copies do today; `refs` start with `{ copy, feature }`, `copy` the number of the place |
| `noEffect` | warning | copies that changed none or only some of their targets, as `{ copy, feature, targets }`, in the order of the numbers |

## Shared vocabulary

- **Takes:** `AxisRef` with its validator, references and resolver; `shift` and `compose` of `solid.ts`; `Placement` and `CopyTag` as they are; the patch rules of `updateFeature` with `removable`.
- **Adds:** `LinearSpan`; `GRID_STRIDE` and the rule of the numbers; `MAX_PATTERN_PLACES`; the error code `invalidPattern`.

## What was measured

**The recipe.** A copy of the repository at `633a6ca` in the scratchpad of the session. First unchanged, for what a build without the grid does. Then with the engine side of this design applied (77 lines added and 22 removed in `types.ts`, `features/pattern.ts` and `recompute/services.ts`), and spike tests in `packages/scenarios/test` against the real solver and kernel adapters. Nothing of it is in the repository.

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

- 4 × 3: status ok; removed 528 mm³, eleven copies and the original at 48 each; the tags on the faces are 1, 2, 3, 1000 … 1003, 2000 … 2003; copy 3 stands at (20, 5), 1000 at (5, 15), 1002 at (15, 15), 2003 at (20, 25);
- a sketch on a side face of copy 1002 has its origin at (15, 21, 4); in a grid 5 × 4 (912 mm³ removed, nineteen copies) it is still ok with the same origin, 1002 and 2003 stand where they stood, and the new copies are 4 at (25, 5) and 3004 at (25, 35) among others;
- 5 × 1 by a parameter: the copies 1 to 4, and the sketch on copy 1002 is `brokenReference`;
- 26 × 2 on a plate that holds 23 columns: the warning `noEffect` with the copies 23, 24, 25, 1023, 1024, 1025 in that order;
- a copy that would remove a second target whole (place (1, 1)): `emptyResult` with `refs` `[{ copy: 1001, feature: 'slot' }, 'B']`, and no face of the grid in the model;
- posts with a counterbored hole through all, sources `['post', 'bore']`, 4 × 3: 1483.8254 mm³ added for twelve times 123.6521 (1483.8255), twelve bores;
- 20 × 11: `invalidPattern`, "(20 × 11 is 220 places; a pattern has at most 200, the original included)", `refs` the two counts; parallel directions with the counts 3 and 2: `invalidPattern`, `refs` the two directions; a column 1 × 3 has the copies 1000 and 2000;
- the second span as a length of 40 over 3 rows: the rows 20 apart;
- the second direction as the normal of a sketch on a side face: resolved; moving that sketch behind the grid is refused; removing it leaves the grid `brokenReference` with the sketch in `refs`.

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
| X and X, 2 × 2 | `invalidPattern` (parallel) |
| X and X, 1 × 3 and 3 × 1 | ok, two copies: a count of 1 leaves one direction unused |
| Y and the normal of a sketch on the base plane XZ (−Y), 2 × 2 | `invalidPattern`: opposite directions are parallel |
| X and the normal of a sketch on the base plane YZ (+X), 2 × 2 | `invalidPattern` |
| X and the normal of a sketch on the base plane XZ, 2 × 2 | ok, three copies |
| a spacing of −5 and a length of −20 over three rows | ok; the copy 2001 at (−5, −20, 0) |

**A grid of bodies** (a block 20 × 10 × 3, 3 × 2):

- `bodies`: `G/1`, `G/2`, `G/1000`, `G/1001`, `G/1002`; `G/1002` at (50, 15, 0);
- `G/1002` inherits the material and the density of the source (`from: 'A'`), the mass query weighs it; body properties set on `G/1001` are kept when a count grows; body properties of `G/7` are accepted as an entry without a body;
- a link lists copies of both rows; the queries `interference` (15 pairs), `body` and `mass` and the exports `stl` and `3mf` take them;
- a sketch on a face of `G/1002` and a cut into it: ok; a grid of that copy: `H/1`, `H/1000`, `H/1001`, faces with both tags (`A/endCap@G:1002@H:1001`), `from: 'G/1002'`;
- 4 × 2: `G/3` and `G/1003` are added, `G/1002` stays in place and keeps its cut; 4 × 1: the copies of the second row are gone, the cut and the grid of the copy are `brokenReference`, the link names `G/1000` and `G/1002` as missing.

**Time** (a through hole of 2 mm in a plate, one boolean per copy; one run each):

| Copies with the original | As a grid | As a row |
|---|---|---|
| 25 | 5 × 5: 0.9 s | |
| 50 | 10 × 5: 1.7 s | |
| 100 | 10 × 10: 6.3 s; 50 × 2: 5.8 s | 100: 4.7 s |
| 196, 200 | 14 × 14: 25.6 s; 20 × 10: 24.9 s | 200: 19.6 s |

- A grid of bodies: 99 copies in 0.03 s, 199 in 0.06 s.
- The same holes as one tool, an extrusion that cuts all the circles of one sketch (the way to a grid before this addition): 100 circles 7.4 s, 196 circles 35.4 s, 200 circles 27.3 s, 400 circles 97 s. One boolean with one large tool is not faster than one boolean per copy.

**Scenario 12** (the model as `packages/scenarios/test/box.ts` builds it up to the part of 2e, then the calls of `scenario12grid`):

- the vent row with `second` along Y, a count of 2 and the spacing `W - wall - 0.5` (47.5): the box loses 240.0000 mm³ more; the copies 1 to 4 stay (copy 4 at x = 32); the far wall has the copies 1000 (x = 16, y from 48 to 50) to 1004 (x = 32); there is no copy 5 and no 1005; the lid clears the box;
- a sketch on a slot of the far wall (copy 1004) has its origin at (32, 47.5, 22) and keeps it with six slots per wall, which remove 336 mm³ more than the row of five did and add the copies 5 and 1005; eighteen per wall: `noEffect` with the copies 16, 17, 1016, 1017;
- the drain holes: one hole removes 6.2053 mm³, the grid 4 × 3 removes 74.4639 (twelve times 6.2053); the bore of copy 2003 is at (33, 22), of 1002 at (28, 16), of 3 at (33, 10); 5 × 4 removes 124.1065 (twenty times), 2003 stays, 4 is at (38, 10) and 3004 at (38, 28); 50 × 5: `invalidPattern` with the two counts in `refs` and the box as it was before the grid; a second direction along X: `invalidPattern`; `second: null`: the four holes of a row, the expression of the second count gone; `second` on the mirror of the rib: an invalid command;
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
10. **`invalidExpression` for the bound, and a warning or nothing for parallel directions.** Above ("An error code of the pattern", "Parallel directions are an error").
11. **Tightening `createsBody`** to the numbers a grid can have (a column below 200, a row below 200). It would refuse `<grid>/500` by a command but not `<grid>/7` of a grid of five columns, which is the mistake that happens; and it would change the answer for the rows and circles of today. The recompute says which copies exist.
12. **A schema step "to be safe".** As in 2e: the rule says when one is needed, and the measurement says this is not such a case.

## Known limits

- **200 places per pattern.** A larger grid of features is two patterns of two source features; the time grows with the square of the number of copies anyway (25 s for 200 holes).
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
- **`CLAUDE.md`** says the current schema version is 5; the code saves 6 (`UPGRADES` has five steps). Not part of this addition.
- **Shared places**: `features/pattern.ts` alone, with one line in `types.ts`'s `ErrorCode` and one in `MESSAGE`; the row "Pattern: transform kinds" of the plan holds.

## Tests the implementation owes

- **Validation** (`engine/test/pattern.test.ts`): `second` with its fields and the refusal of any other; `second` on the other kinds; the references of the second direction (`moveFeature`, a sketch that is gone); the patches (adding, a merge, the span alone, half of one, `null` on a grid and on a row, another kind) and the expressions that go with a removed second direction; `setField` on its fields; the fields of the registry against `fieldsOf`; `GRID_STRIDE` above `MAX_PATTERN_COUNT − 1`; a document of today loads unchanged and the version is unchanged; a document with two counts that are too many together loads.
- **The numbers** (`scenarios/test`): the tags and the places of a grid; a row that gets a second direction keeps its copies; a larger count in either direction moves none and a sketch on a face of a copy stays; a smaller one breaks what stood on a lost copy; the order of `refs` of `noEffect` and of `bodies`; a copy that fails names its number and leaves the model as it was.
- **The bound and the directions**: 200 places pass, 201 do not (as numbers and through a parameter); parallel base axes, a base axis against a sketch normal that is parallel to it, antiparallel directions; a count of 1 in either direction with parallel directions.
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

Not reviewed yet.

## Rows for the indexes

**`docs/d36/README.md`**, the row of 2e in "Work packages": after "…no feature type, no issue code, no schema step." the last sentence ("A grid is deferred to a package of its own, with two routes named") becomes:

> The grid (owner, 2026-11-17) is an addition designed in [2e-pattern-mirror/grid.md](2e-pattern-mirror/grid.md): an optional second direction of `linear`, the copy at (i, j) numbered `i + 1000 · j`, at most 200 places, the error `invalidPattern`; no schema step

**`docs/decisions.md`**, the row D53: the state gets "the grid designed 2026-11-17 as an addition ([grid.md](d36/2e-pattern-mirror/grid.md)); not implemented. Measured: `master` refuses a document with `transform.second` and drops a field put on the feature itself, so the field lies in the transform and needs no schema step; numbers with gaps pass every reader of a body and of a face; 200 holes take as long in a grid as in a row", and in the decision the last sentence ("A grid is deferred, with two routes named …") becomes:

> A grid is a second direction of the linear pattern (`transform.second`: a direction, a count, a span), for features and for a body. The copy i steps along the first direction and j along the second has the number `i + 1000 · j`, so a place keeps its number whatever the counts are and a row that becomes a grid keeps its copies. At most 200 places, and the two directions not parallel: the error `invalidPattern`, judged by the recompute. A pattern of features as a source of a pattern stays open for a mirror of a mirror and a circle of rows

**`docs/requirements.md`**, scenario 12, a part after "Linear pattern and mirror":

> - *The grid (2e, D53, an addition).* The vent row gets a second direction along Y with a count of 2 and the spacing `W - wall - 0.5`, a patch that names the second direction alone: the far long wall loses the 240 mm³ the near one lost, the copies of the row keep the numbers 1 to 4 and the far wall has 1000 to 1004. A sketch stands on a slot of the far wall (copy 1004) and stays where it is when a sixth slot per wall is added by the one parameter (the copies 5 and 1005); eighteen per wall give the warning `noEffect` with the copies 16, 17, 1016 and 1017. The floor gets drain holes: one plain hole of 2 mm through all at a point of a sketch on the floor, and a grid of it, 4 columns 5 apart along X and 3 rows 6 apart along Y, both counts parameters: twelve times the volume of one hole, the bore of the last place tagged 2003; a fifth column and a fourth row are two parameters, add eight holes and move none. Fifty columns of five rows are the error `invalidPattern` of the pattern with the two count fields in `refs`, and the box is as it was before the grid; a second direction parallel to the first is `invalidPattern`; `second: null` makes the grid a row again and drops the expression of its count; `second` on a mirror is an invalid command, and half a second direction on a row as well. Six lids for the print bed are the row of three with a second direction: the bodies `lids/1`, `lids/2`, `lids/1000`, `lids/1001`, `lids/1002`, the last two lids along X and one along Y from the original; each takes the material of the lid and its mass, a link lists copies of both rows, a sketch stands under a copy of the second row, and no pair collides. A fourth lid per row adds `lids/3` and `lids/1003` and moves none; one row leaves a link that listed `lids/1002` with it under `missing`. The document loads to the same model, and its schema version is the one it had.

**`docs/backlog.md`**, the entry "Linear pattern and mirror of features and bodies": "a grid (two routes named there)" becomes "the grid as a second direction of the linear pattern (designed, [grid.md](d36/2e-pattern-mirror/grid.md))", and what is left for later gets: a pattern of features as a source of a pattern (a mirror of a mirror, a circle of rows), a second transform of another kind in one pattern, staggered rows, a third direction, copies left out of a grid.
