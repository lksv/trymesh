# 6h The Onshape converter on the tools of step 6

**State: design, second version, revised on 2026-11-25 after three independent reviews of the first version (commit `314188c`; "Reviews"). Written against `master` at `c01e765` (6a2, 6e, 6c, 6b and 6d merged). Every finding of the reviews was checked on the downloaded model with a throwaway copy of `tools/onshape` outside the repository, and the numbers of "Measured" are those of the revised rules. Not implemented.** There is no `contract.ts` and no `calls.ts`: the point changes `tools/onshape` and `docs/onshape-import.md` only, no type, command, query or field of the engine, and it takes no decision number ([6-plan.md](../6-plan.md), "6h"; the owner's answers 4 and 25 of [6-cross-review.md](../6-cross-review.md)). Its record is [onshape-import.md](../../onshape-import.md).

The converter gains heuristics over geometry (what an external operand is, when a pattern can be an entry, which constraint is implied), so its points get a full review, except the last one, which only writes documents (CLAUDE.md, "Depth of the review"; "Points of work").

The point in short:

1. **Of the 287 constraints reported lost, 156 are not lost.** 155 are realised by one shared point (Onshape ties the ends of curves by coincident constraints; the converter makes them one point) and one is written twice. **131 of 380 are lost**, and the report says so from now on, by cause.
2. **The tools of step 6 recover 125 of the 131**, measured: 37 on curves the converter split (`split`), 31 on the origin, 13 on a default plane, 12 on an entity of another sketch and 1 on an edge of a body (entries `sketch` and `edge`), 19 patterns (10 as entries `pattern`, 9 by construction spokes), 5 mirrors about a line of the sketch, and 7 of the 9 constraints of a kind the converter did not map.
3. **6 stay lost**: 4 `FIX` of the disc's splines and 2 midpoints of two points. With the owner's "no" to question 2 of "Open" it is 12.
4. **A constraint that follows from the others is not written.** The first version kept the 10 redundant constraints the engine named; one sketch then conflicted at every change of its parameter. Now a redundant constraint that can go without giving a freedom back is removed and gets the fate `implied` (5 constraints).
5. **The converted document is tried away from today's values.** Every parameter a studio uses is changed by 3 % and the result is part of the report and of the acceptance: no change may break a sketch or a feature. The baseline passes 40 changes, the first version of this design broke at 3 of 48, this version passes 56.
6. **The parts do not change**: all 16 volumes within 7e-6 mm³ of today's, the same regions in all 24 sketches, the same 4 of 10 chamfers. 21 of the 24 sketches come out fully determined (none today); the freedom of all sketches together drops from 771 to 10.
7. **What differs from the plan's outline**, each because of what the model holds: a mirror or a pattern is an entry only where nothing names or meets its copies (otherwise a mirror is written by `symmetric` and a pattern by spokes); the angle, "horizontal of two points" and the distance of two lines are mapped here; an external ID is decoded, not only searched by geometry; and the disc's splines convert correctly but cost 108 s a recompute, so splines have a cap and the disc keeps its generator.

## The brief, and what the measurements changed in it

The plan gives six steps: count by cause, crossing curves by `split`, patterns and mirrors as entries, external operands, splines, count again. The acceptance is the count before and after in `docs/onshape-import.md`, no sketch split with its constraints lost, and the part volumes unchanged. No target was set, because nobody knew how many of the 287 were step 6's.

What the count, the trials and the reviews settled:

- **The 287 was a miscount.** The converter's line "n of m constraints" counted the constraints it wrote. A coincident constraint of two points is never written: the two are one point of trymesh already. That is 151 of the 380. Four mirrors of a point that is an end of the mirror line are realised the same way, and one constraint was a duplicate. The 380 are the set today's report counts: the constraints of the 24 sketches the converter makes of the 8 part studios of the dump that have sketches (23 sketches; the two derived ones are converted in both studios that derive them, and the three of their source studio are not converted on their own).
- **An external operand is a bare deterministic ID** (`IB`, `JCC`, `JFE`), and `fetch.ts` dumps the geometry behind the queries of features, not of sketch constraints. **The ID is not opaque, though** (found by the first review): it holds the operation that made the entity, its kind and an index, and `fs.json` says which operations belong to which sketch ("External operands"). With it 12 of the 13 operands in other sketches are identified exactly, and the thirteenth turns out to be an edge of a body.
- **Onshape's pattern and mirror are constraints among own curves**: an instance is an entity like any other, with constraints of its own, cut by other curves, a seed of another pattern. A copy of 6c can be none of these. Of the 19 patterns, 9 have a copy that is constrained or crossed, and of the 13 mirrors of curves, 11.
- **A conversion that holds at today's values can break beside them.** Two sketches of the first version did: one by redundant constraints, one by a pattern left free. The check at today's positions cannot see either, so the document is also tried with changed parameters ("The parameter probe").
- **All 24 sketches lie on the Top plane with the identity frame.** The mapping of a default plane by the sketch's matrix is therefore tested on fixtures, not on the model.
- **The model has no linear pattern, no open circular pattern, no arc with a constraint, no sketch turned in its plane and no spline but the disc's.** What the design says of those is from the code of the engine and from knowledge of Onshape, and says so; their tests are named so ("Tests").

## The cheap variant

- **No change of the engine.** Every gap found is a row of the backlog ("Engine gaps").
- **No new download.** The dump of 2026-11-25 has everything the count needs. What Onshape itself would say of an external ID is put to the owner ("Open") and is not needed for the acceptance.
- **One mapping table for local and external operands.** An external operand is resolved to an entity of the sketch (an ID and a kind) and the constraint then goes through the table of today. There is no second table "constraints on external geometry".
- **`splitAtCrossings` goes** (70 lines), with nothing in its place but one call of the sketch tool.
- **The engine judges, not the converter**, wherever both could: whether a profile is valid, whether two curves are in contact, whether a constraint is redundant, whether two constraints are the same (`constraintKey`). The converter's own geometry tests are filters before the engine's answer, never in place of it.
- **Tilted sketch planes, mates, drafts, second directions and the rest of the "left out" list of `onshape-import.md` stay as they are.**

## What the plan says, checked against the converter and the dump

| The plan | Read and measured |
|---|---|
| "287 of 380 sketch constraints lost" | 131 lost, 155 realised by a shared point, 1 written twice, 93 written. The 380 count the two derived sketches in both studios that derive them (2 × 40) |
| "six sketches split by the converter with their constraints lost" | True: 38 curves in Housing 1, Input Shaft 1 and 2, Output Shaft 6, Motor Shell 1 and 3; 37 constraints lost with them (and 2 patterns and 2 mirrors that also name a split curve, counted under their own cause) |
| "the converter takes a point as on a curve within 1e-5 mm and the tools within 1e-6" | True of the code, and the converter's tests are not at one tolerance (1e-9 of a length for two lines, a discriminant of 1e-7 for a line and a circle, 1e-5 for two circles). On this model it decides nothing: the 475 contacts of the dump's sketches are exact to 2.8e-14 mm and the nearest miss is 0.42 mm |
| "a default plane seen edge-on becomes `origin/x` or `origin/y` by the sketch's matrix" | Right; every sketch of the model is on Top with the identity frame, where Front is `origin/x` and Right `origin/y` |
| "an entity of another sketch of the studio becomes an entry `{ type: 'sketch' }`; an edge of a body an entry `{ type: 'edge' }`" | 13 such operands. By the decode of their IDs 12 are entities of an earlier sketch and one (`JQx`, Motor Shaft 3) is an edge of a body |
| "derived sketches stay copies, with the constraints on them kept" | No sketch of the model constrains itself to a derived sketch (both studios derive after their last own sketch). The six constraints that are lost go the other way: from the derived sketch to a sketch of its source studio that is not derived, and that sketch is the skeleton of the document ("Derived sketches and the skeleton") |
| "splines as `spline` where they are cubic and not rational" | The disc's four are cubic, not rational, not periodic, with 3,145 or 3,146 control points. As Bezier pieces they are right (the outline's area 2228.709 mm² against Onshape's 2228.71) and too slow (108 s) |
| "a distance other than point–point and point–line, an angle and `FIX` are not step 6's" | The 4 `FIX` are on the splines. 5 of the 6 angles are to a default plane, so step 4 cannot recover them without the angle; all six map. The 3 distances of two lines map one for one to `distancePointLine` ("Kinds taken along") |
| `convert.test.ts` needs the dump | It is not in the root run: the root `vitest.config.ts` includes `packages/*/test/**/*.test.ts` and `tools/**/*.unit.test.ts`; the converter runs only by its own config. So a test named `*.unit.test.ts` runs in CI and must not read a dump |

## The count by cause

### Fates

Every Onshape constraint of every converted sketch gets exactly one fate. The converter keeps **one record per Onshape constraint** from the moment it reads it: its index and type, its operands with what each was resolved to, the commands made for it (its unit, "The check"), how it was written (with its expressions, or with numbers), and its fate. **The fate is final only after the last step of the sketch** (the cut and the removal of implied constraints change it), and the tally is of the attempt that is executed, not of one that was tried and dropped.

| Fate | What it means |
|---|---|
| `written` | One or more constraints of trymesh stand for it and are in the document (a mirror of two lines is two `symmetric`; a pattern by spokes is many) |
| `entry` | A pattern or a mirror written as an entry `pattern` of the sketch |
| `shared` | Realised by the geometry, with the detail which way: two points that are one point of trymesh; a point "on" a curve it is an end of; a relation among the copies of one entry; a point held on a curve that the cut turned into the shared point of the pieces |
| `twice` | Every constraint it would write has the `constraintKey` of one written for another Onshape constraint, with the same value or expression |
| `implied` | Written, and then removed because it follows from the others: the engine listed it as redundant and its removal gave the sketch no freedom back ("Implied constraints") |
| `lost` | Nothing stands for it; it has a cause |

The headline number is `lost`. `written` counts Onshape constraints, not commands, so a sketch no longer reads "13 of 12".

- **`shared` is established, not assumed**: a coincidence of two points is `shared` only when the two are the same point of the written sketch; if they are not (they stand apart in the dump), a `coincident` is written and the check decides. Measured: all 151 are one point.
- **`twice` is by the engine's key.** The old filter dropped the value and sorted `a` and `b`, which is wrong for `angle`, `horizontalDistance` and `verticalDistance`, where the order is the sign. Two constraints with one key and different values are not `twice`: the second is lost with the cause `refused` ("another value for the same operands"), since the engine holds one constraint per key.

### Causes

A lost constraint has one cause, and the record keeps two things apart: **what its operand is** (the category: the origin, a default plane, another sketch, an edge, a spline) and **why it is lost**. The cause is the reason; the category is a column of the detail, so a constraint on the origin that the check refuses reads `refused (on the origin)`, not `origin`. The reasons, the first of the list that applies:

| Cause | When |
|---|---|
| `refused` | Made, then dropped by the check (the reason and the engine's list of conflicting constraints with it), or with another value than a constraint of the same key |
| `pattern` | A sketch pattern that is neither an entry nor written by spokes (the detail says why) |
| `origin` | An external operand that is Onshape's origin, not mapped (the baseline only) |
| `plane` | An external operand that is a default plane and no axis of the sketch, or not mapped |
| `sketch` | An external operand that the decode gives to another sketch (the detail: not found there, several fit, or the sketch is not in this document) |
| `edge` | An external operand that the decode gives to a body (the detail: no edge fits, or several) |
| `unknown` | An external operand whose ID does not decode |
| `mirror` | A mirror of two curves about a line of the sketch (the baseline only) |
| `spline` | An operand is a spline or an ellipse the converter left out |
| `arc` | An operand is an arc (the converter gives an arc no kind today; none on this model) |
| `split` | An operand is a curve the converter split (the baseline only) |
| `kind` | A kind of constraint the table does not have (the detail names it: `MIDPOINT of two points`) |

### Before: the converter of today

Taken on the dump with the counting added to an unchanged copy of the converter; the document it wrote is byte for byte the baseline's.

| Fate | Count |
|---|---|
| Written | 93 |
| Shared | 155 (151 coincident points, 4 mirrors of an end of the mirror line) |
| Twice | 1 |
| Lost | 131 |

| Cause of the loss | Count | By Onshape type |
|---|---|---|
| A curve the converter split | 37 | COINCIDENT 23, DIAMETER 11, TANGENT 3 |
| The origin | 31 | COINCIDENT 22, HORIZONTAL 8, DISTANCE (horizontal) 1 |
| A default plane | 13 | MIRROR 8, ANGLE 5 |
| An entity of another sketch | 12 | COINCIDENT 10, EQUAL 2 |
| An edge of a body | 1 | COINCIDENT 1 |
| A pattern | 19 | CIRCULAR_PATTERN 19 |
| A mirror of curves about a line of the sketch | 5 | MIRROR 5 |
| A spline | 4 | FIX 4 |
| A kind without a counterpart | 9 | HORIZONTAL of two points 3, DISTANCE of two lines 3, MIDPOINT of two points 2, ANGLE 1 |

By type this is the list known from the report: COINCIDENT 56, CIRCULAR_PATTERN 19, MIRROR 13, HORIZONTAL 11, DIAMETER 11, ANGLE 6, FIX 4, DISTANCE 4, TANGENT 3, EQUAL 2, MIDPOINT 2. The first version had 13 under "another sketch"; the decode moves one to "an edge".

**Welded points.** The converter makes one point of points at one place whether or not a constraint ties them. Over the 23 sketches of the dump, 157 places hold more than one Onshape point; at 81 the points are tied by coincident or concentric constraints, at 76 they are not, and all 76 hold a point of a pattern or mirror instance (70 only such points, 6 an instance point and a point outside). No two plain entities are welded without a constraint. The weld of instance ends is what lets a ring of instances close; the converter counts both kinds in `summary.json` and reports a weld without a constraint between entities that are no instances, case by case. The merge itself goes from rounded cells of 1e-4 mm (which can part two points 2e-7 apart and join two 9.8e-5 apart) to a distance of 1e-6 mm; on this model no two distinct places are nearer than 0.25 mm and no welded points differ by more than 1e-9.

### The report and `summary.json`

- **`tools/onshape/fates.ts`** (new): the types `Fate` and `Cause`, the record of a constraint and a `Tally` that the `Report` holds; a test asserts that the fates of a sketch add up to its constraints.
- **The line of a sketch** in `report.md`: `Sketch 2: 6 points, 4 curves; of 12 constraints 9 written, 2 shared, 1 lost; 5 degrees of freedom`, and under it one line per cause: `Sketch 2: lost: 1 MIDPOINT of two points (kind)`. The line "constraints without a counterpart: {…}" goes.
- **Sections at the end**: `## Sketch constraints` (the two tables above, as the run found them), `## External operands` (every operand with what it was decoded to, the candidates and the pick), `## Entries` (every pattern and mirror with the rule that kept it out), `## Parameters` (the probe).
- **`summary.json`** beside `report.md` is what the acceptance compares. Every key is qualified by the studio (`Motor Shell/Sketch_1`; a derived copy by the feature that derives it), since `Sketch_1` exists in seven studios. It holds:
    - the run: the converter's commit, the fingerprint of the dump (a hash over its files), the override used, the settings;
    - the fates and causes, in total and per sketch; per constraint its record without the commands;
    - per sketch: status and warnings, freedom, the constraints still listed as redundant, validity, the number of regions and Onshape's number, the areas of the regions sorted, the welds with and without a constraint, the step of the check that passed, the entries with the rule that failed, the operands with their candidates;
    - per part: its body and volume in full precision, and Onshape's;
    - per feature that can fail in part: fillets and chamfers with edges kept of edges asked, starts written as `from` or as a number;
    - the loaded document: whether it loads, the features in error, the number of bodies;
    - the probe: per studio and parameter, what changed.
- **A comparator**: `ONSHAPE_BASELINE=<summary.json>` makes `convert.test.ts` compare its summary with that file and fail on a missing or extra key, a value that is not finite, a volume off by more than 1e-3 mm³, a region count or a sorted area off by more than 1e-6 mm², a change of a conversion outcome, or a parameter change that breaks what it did not break there. The report prints volumes to 0.1 mm³, which is too coarse for "unchanged"; the rounded table of "Measured" is evidence, the baseline file is the reference.

## The check

The check decides what is written. It is its own point of work, before anything that adds constraints.

### What passes

A sketch as previewed **passes** when all of this holds:

1. **The feature's status is `ok`**: not `error`, and no warning. A solver that fails leaves the status `warning` with `sketchConflict`, the points where they were stored and possibly an empty `conflicting` list (measured: the solver running out of memory on 769 fixed points gives exactly this), so "no point moved and no conflict" is not enough. `invalidExpression` and a projection that failed are warnings too.
2. **`conflicting` is empty.**
3. **Every own point is within 1e-6 mm of Onshape's place, and every circle's radius within 1e-6 of Onshape's** (a diameter with a wrong value changes a radius and moves no point). An arc is its three points. The tolerance was 1e-4; the cut decides a contact at 1e-6, so a point may not drift further than that. Measured: the worst drift over all sketches is 7e-15 mm.

After the cut the check also asks that **the profile is valid**, that the tool left nothing uncut (`ids.uncut` empty), that the query `sketchContacts` lists no contact without a fix, and that **the number of regions is Onshape's** (the faces the sketch feature created, in `fs.json`) wherever every curve of the sketch was converted.

### Units

**One Onshape constraint is one unit**: all the commands made for it (a mirror of two lines is two `symmetric`; of two circles one and an `equalRadius`; a pattern by spokes several construction lines and constraints; `FIX` of a spline a `fixed` per point). A unit is kept or dropped whole. A pair whose positions do not mirror is not skipped in silence, as the trial did: the unit is `refused` with that reason.

### The ladder

1. **All units, each with its expressions.** If the sketch passes, all are written.
2. **Else one by one**, in the order of Onshape's list, from the sketch without constraints: a unit is added with its expressions; if the sketch no longer passes, with its dimensions as their measured numbers (the record says `number`); if it still does not pass, the unit is lost with the cause `refused`, the reason and the engine's `conflicting` list. The earlier step "every dimension as a number" is gone: one bad expression must not cost the others theirs.
3. **Then the cut** ("Crossing curves") on a preview, and the check after it. If it fails:
    - an entry that rule 5 or 6 blames is dropped and the sketch is built again from the entities (the instances own, the pattern by spokes);
    - else the units are settled one by one with the cut inside the test of each ("write, cut, check"), so the unit that breaks the cut is the one refused;
    - a sketch whose bare geometry does not pass after the cut is reported with the tool's message and the rows of `sketchContacts`, left as written, and fails the acceptance. There is no "without constraints" step that hides it.
4. **Then the implied constraints** are removed ("Implied constraints"), and the fates are final.

**What the ladder does not promise.** One by one keeps a subset that depends on the order: of a group that conflicts, the one added last is the one called `refused`, and the subset is not the largest possible. Every constraint of Onshape holds at Onshape's positions, so a refusal means a wrong mapping or a wrong value, and the report gives the engine's list to find it.

**Cost.** A preview of a sketch of the model takes 1 to 60 ms. Measured: 24 previews when all sketches pass in step 1 (they do), 16 more for the two helper copies that needed step 2, 15 trial removals of redundant constraints. The whole conversion stays at 32 s.

On this model all 24 sketches pass step 1, before and after the cut. Step 2 ran on the two helper copies of "Open", question 2: their source studio's geometry has the housing circle at 72 mm where `HOUSING_DIAMETER` gives 70, so that one diameter is written as its number and noted. The cut inside the test and the dropped entry are tested on fixtures.

### Implied constraints

The first version kept the constraints the engine listed as redundant, because they were consistent. The first review measured what that does: Motor Shell Sketch 1 (no freedom, four redundant `symmetric`) answered every change of `HOUSING_DIAMETER` with `sketchConflict`; nothing moved and the body kept its volume. A consistent set with a redundant constraint is a sketch that cannot follow its parameter.

**The rule.** After the cut, while the engine lists a redundant constraint: of the listed constraints that the converter wrote (not those the cut added), each is removed on a preview; a removal is allowed when the sketch still passes, stays valid and has no more degrees of freedom than before; of the allowed ones the removal that leaves the fewest listed is made, the first written of equals. It ends when none is listed or no listed one can go. A unit that loses all its constraints is `implied`; one that keeps some is `written`, and its record says how many were implied.

The alternatives were tried on the model, since the engine's list names some members of each dependent group, not a set that can be dropped:

| Rule | Result |
|---|---|
| Skip a constraint when the engine lists any redundant one right after it is added (the review's proposal) | 18 units dropped, and the sketches gain 13 degrees of freedom (172 against 159): constraints that are not implied go |
| Skip a constraint that takes no freedom away when added | 9 dropped, 8 still listed, one degree of freedom more |
| Remove listed ones before the cut | 25 dropped, among them points held on curves that the cut needs; 74 s |
| Remove after the cut, the first listed of the allowed | Motor Shell 1 keeps two listed, and still conflicts |
| **Remove after the cut, the one that leaves the fewest listed** | **9 removed in 15 tries; freedom unchanged; Motor Shell 1 follows its diameter** |

Measured with the chosen rule: 5 Onshape constraints are `implied` (three "horizontal with the origin" of a centre that other constraints hold on the X axis already, in Input Shaft 1 and Output Shaft 4 and 5; one coincidence with a projected point in Input Shaft 2; the fourth right angle of a rectangle in Motor Shell 2), and 3 units keep fewer constraints than they were given (two mirrors of lines in Motor Shell 1 lose one `symmetric` each, the spokes of Motor Shell 3 two constraints). One listed constraint stays, a `symmetric` of Motor Shell 3 whose removal gives a freedom back; the probe finds nothing wrong with it. The engine side is a row of the backlog (gap 6).

**Known limit:** "implied" is judged at today's values. A constraint that is redundant only at a special position (two lines that happen to be parallel) is dropped although it holds something beside it. The probe shows such a sketch by its freedom changing with a parameter.

### The parameter probe

After the conversion, `convert.test.ts` loads every stored studio document that has a sketch, alone, and for every parameter that an expression of that document names and whose own expression is a number, sets it to +3 % and to −3 % (to ±1 when a count reads it), each from the loaded state. It records per change: the features that newly are in error, the number of bodies, the volume, and per sketch its status, conflicting constraints, validity, regions and freedom.

- **A break** is a feature newly in error, a changed number of bodies, a sketch whose status leaves `ok`, whose `conflicting` list fills or whose profile turns invalid.
- **A note** is a changed number of regions or of degrees of freedom.
- The parameters each studio uses are listed, so a variable that drives nothing is visible.

Measured (about 35 s for the document):

| Document | Parameters in use | Changes | Breaks |
|---|---|---|---|
| The baseline | 20 | 40 | 0 |
| The first version of this design | 24 | 48 | 3: Motor Shell 1 conflicts at both values of `HOUSING_DIAMETER`; Output Shaft 6 is invalid, with Extrude 13 and 14 in error, at `OUTPUT_MOUNTING_PATTERN` + 3 % (and at 34, by the review) |
| This version with the implied constraints removed and the nine patterns still lost | 24 | 48 | 1: Output Shaft 6 as above |
| This version | 24 | 48 | 0 |
| This version with the helper copies of question 2 | 28 | 56 | 0 |

The baseline passes because those variables drive nothing there. Two notes remain in this version: Input Shaft Sketch 2 has 1 degree of freedom at `E` = 1.25 and none at either changed value (the first version had the same; a position where the count of the solver drops, not a loss).

The probe is 3 % around one state. It does not show a sense that is wrong only after a design flips, or a count changed far.

## Crossing curves

`splitAtCrossings` and its tests go. The sketch is written whole (its points, its curves uncut, its entries, its constraints) and executed; then

```ts
sketchTool('split', { sketch, result, parameters, document, features }, {}, freshIds(document, `${id}.cut.`))
```

is called once. The tool cuts every contact of two outline curves, joins ends at one place, moves each constraint to the piece that carries it and turns a point held on a curve at a cut into the shared point (D65). `Converted.kind` keeps every curve, so no constraint is dropped for naming one.

- **Its batch is previewed and checked before it is executed** ("What passes"). The tool answering `ok` is not enough: without a curve named it refuses only when it has nothing to do for an invalid profile; it can cut what it can and return a batch that leaves the profile invalid, with the rest in `ids.uncut` (a review's probe: a crossing circle and two partly overlapping lines give `ok`, 15 commands and an invalid profile).
- **It runs on solved positions**, not on Onshape's; that is why the check before it holds the points to 1e-6.
- **Exact duplicates first.** Two curves of the same kind over the same points with the same construction flag (a circle: the same centre point and radius within 1e-6) are written once. The converter's map from an Onshape entity to its curve (`rep`, not only the kind) points the second at the first, with its direction: a line drawn from `b` to `a` over one drawn from `a` to `b` is kept as "the same line, reversed", which the angle reads. A construction line and an outline line at one place are both kept. A partial overlap is no longer repaired ("Known limits").
- **A constraint the cut consumes** is `shared`: a `pointOnCurve` that the tool lists in `ids.removed` because the point became the shared point of the pieces. Measured: 20.
- **A refusal is reported, not worked around.** The tool refuses what a cut cannot repair (curves lying on each other, two arcs that only touch, a circle with one point). The report then has the tool's message and the first rows of `sketchContacts`.
- **The regions.** `matchRegion` reads the sketch after the cut, as it read the converter's pieces. A piece has a new ID (`Sketch_2.cut.c5`, the first piece keeps the ID of its curve), which nothing outside the sketch names.

Measured on the six sketches, with nothing else changed (the first trial; "written" counts as the first version did):

| Sketch | Curves cut | Tool: changed, added, points | Regions before and after | Largest difference of an area | Written before, after | Tool, batch |
|---|---|---|---|---|---|---|
| Housing 1 | 17 | 17, 47, 32 | 34, 34 | 6.5e-8 mm² | 3, 5 of 11 | 11, 56 ms |
| Input Shaft 1 | 2 | 2, 2, 2 | 3, 3 | 3.0e-9 | 0, 1 of 5 | 1, 1 |
| Input Shaft 2 | 2 | 2, 6, 6 | 5, 5 | 1.1e-8 | 1, 9 of 12 | 1, 3 |
| Output Shaft 6 | 13 | 13, 35, 24 | 25, 25 | 1.4e-8 | 0, 4 of 16 | 4, 19 |
| Motor Shell 1 | 2 | 2, 14, 16 | 9, 9 | 3.2e-12 | 12, 27 of 47 | 2, 5 |
| Motor Shell 3 | 2 | 2, 14, 16 | 9, 9 | 0 | 1, 8 of 16 | 2, 4 |

The numbers of curves and points after the cut equal the converter's in every sketch (66, 4, 10, 49, 25, 25 curves). 37 constraints come back, the 37 of the cause. No point moved after the cut (0 mm), nothing was left uncut, every part volume and every chamfer as before. The number of regions equals Onshape's in 23 of the 24 sketches; the disc's has 7 of 8, the eighth being bounded by the splines that are left out.

## Patterns and mirrors

### When an entry

An Onshape pattern lists its instances: the seed entities and, for each further instance, their images. A mirror of curves is one constraint per pair. Written as an entry `pattern` (D68), the images are not made as own geometry: they are the copies of the entry.

**A pattern or a mirror is an entry only when all of this holds** (the rule of the entry). Rules 1 to 4 are the converter's reading of the dump, on Onshape's entity IDs before any point is welded; rules 5 and 6 are the engine's answer on the sketch as built.

1. **Nothing else names an image**: no other constraint has a curve or a point of an image as an operand, and no own curve outside the entry, construction curves included, uses a point of an image as its end or centre. Two exceptions, both `shared` by the copies:
    - a coincidence of two image points **of one instance whose seed points are one point** (the copies of one point are one point). A coincidence of images of two instances is a condition on the seed (its end lies on its own turned start), which no copy holds; it names a copy like any other constraint;
    - for a mirror, the MIRROR of a point of the seed and its image about the same line (Onshape writes a mirrored line as one MIRROR of the line and one of each end).
2. **No curve but a neighbour of its own instance meets an image**: not a curve outside the entry, not a seed, not an image of another instance. "Meets" is crossing, touching or ending on it; two images of different instances may share an end (a ring), and curves of one instance meet as their seeds do, where they are cut. The engine refuses to cut a copy against an own curve and against a copy of another number.
3. **No image is a seed or an instance of another pattern or mirror** (a copy is no source). Of two nested ones the outer can be an entry.
4. **The transform can be said**: a circular pattern closed over the full turn; a mirror about a line of the sketch or a default plane that is an axis of the origin. The pivot is a point of the sketch or an external operand resolved like any other (`origin`, a projected point). An open circular pattern and a linear pattern are in "Not on this model".
5. **The copies are Onshape's images, both ways.** On the preview, every image of Onshape is matched by exactly one copy and every copy by one image: the same kind and construction flag, a line by its two ends, a circle by centre and radius, an arc by centre and ends, a point by its place, within the 1e-6 of the check.
6. **The engine accepts the contacts.** With the entry written and the sketch cut, the profile is valid and `sketchContacts` lists no contact whose reason names a copy.

An entry that fails rule 5 or 6 is dropped and the sketch is built again with its instances as own curves. The points of the images are not written (`addPoint` only for points something uses).

**A mirror has no fixed seed**: of the two curves the one that something names or meets stays own and the other is the copy; if both are named, it is no entry. (The trial always took Onshape's first as the seed; how many more mirrors this makes entries is counted by the implementation.)

The entry:

```ts
{ type: 'addExternal', sketch, id: `${sketch}.pattern${n}`,
  ref: { type: 'pattern', sources: [/* the seed curves, and seed points no seed curve has */],
         transform: { type: 'circular', center: /* the pivot */, count: /* patternc1 */, span: { type: 'full' } } } }
```

`count` is the expression of `patternc1` (`6`, or `N` for `#N`), so the count follows a parameter. A mirror is `{ type: 'mirror', axis }` with the line of the sketch or `origin/x`, `origin/y`.

### Otherwise

- **A mirror of two curves is written by the symmetry of their points**: `symmetric` for each pair of points (the ends of two lines paired by reflecting the positions; the centres of two circles, with `equalRadius`; the centre and the swapped ends of two arcs). A pair that is one point is on the mirror line: nothing when it is an end of that line or the origin on an axis, else `pointOnCurve` with it. Both curves stay own, so they can be constrained and cut. The fate is `written`. Three `symmetric` of two arcs say more than an arc has freedom for (its ends are at one distance from its centre already); the surplus is found and removed as implied. The model has no mirrored arcs, so that is a fixture; its mirrored lines show the same in small (two mirrors of Motor Shell 1 lose one `symmetric` each).
- **A circular pattern is written by spokes.** For every point Onshape lists in an instance (the ends and centres of its curves), a construction line from the pivot to it. The spoke of each image point has `equalLength` with the spoke of the seed point, and an `angle` of 2π/n to the spoke of the instance before; an image circle has `equalRadius` with its seed. The image points are then the seed points turned, whatever the seed does, and the instances stay own curves that can be constrained and cut. The fate is `written`, with the detail "by spokes".
    - **The angles tie the spokes as a tree, never as a ring**: two spokes already tied through angles get no further one. A hexagon's spokes close a ring, and the sixth angle is a redundant constraint that made Global Sketch 3 conflict at every change of a parameter (measured).
    - **The count is a number**: `2 * pi / 6`. When `patternc1` holds a parameter, its value of today is written and the report says that the pattern no longer follows it; a changed count needs another number of instances, which own curves do not get.
    - **The rows of points.** Onshape lists the points of an instance as rows of their own (all 9 on this model). A curve whose points are not listed gets them in the order start, end, centre, checked by turning the seed's; a point that does not land is the pattern lost with the cause `pattern`.
- **The mirror of two points** stays `symmetric`, as today.

**Why spokes after all.** The first version rejected them as too heavy (a construction line and two constraints per point, the count no parameter) and left such a pattern lost. The probe showed what a lost pattern does: the seed follows its variable, the instances do not, and the part breaks. Two ways to hold the instances were measured on the model:

| For a pattern that is no entry | Lost | Freedom of all sketches | At `Phi_R` + 3 % (Housing 1, 16 pockets) | At `OUTPUT_MOUNTING_PATTERN` + 3 % (Output Shaft 6) |
|---|---|---|---|---|
| Nothing (the first version) | 9 | 159 | valid | invalid profile, two extrusions in error |
| `equalRadius` and `equalLength` of every instance with its seed, the fate still `lost` (the review's proposal) | 9 | 97 | valid; the pocket centres stand at 6 different distances from the axis, 0.87 mm apart | valid; 0.43 mm apart |
| **Spokes** | **0** | **20** | **valid; all at one distance** | **valid; all at one distance** |

The sizes alone keep the sketch from breaking and leave the pattern crooked. Spokes cost 72 construction lines over the nine patterns and about 146 constraints (the constraints of all sketches go from 167 to 316, three of them the distances of two lines) and nothing in time (32 s).

### Measured

| | Entries | Not entries, and why |
|---|---|---|
| 19 circular patterns | 10: the six holes of the disc; Global Sketch 2 (12 × 2 circles) and the outer pattern of Global Sketch 3 (12 × 6 lines and a circle), each in two studios; Motor Shaft 3; Output Shaft 2, 4 and 5; one of the two of Motor Shell 2 (two circles, four times) | 9, all by spokes. 5 hexagons (Motor Shaft 2, Input Shaft 4, Hex Standoff 1, the inner pattern of Global Sketch 3 twice): the coincidences that close the ring name copies, one of them across two instances; in Global Sketch 3 the hexagon is also the seed of the outer pattern. The other one of Motor Shell 2: a distance to a copy. 3 whose copies cross a curve outside: the 16 pin pockets on the bore of Housing 1, Output Shaft 6, Motor Shell 3 |
| 13 mirrors of curves | 2: two circles of Motor Shell 2 about the Right plane | 11 as `symmetric`: 7 whose image is mirrored again (Motor Shell 1 builds a four-fold symmetry from mirrors of mirrors), 4 with another constraint on the image (COINCIDENT 3, HORIZONTAL 1) |

- **The changed rules change no entry of this model.** The 63 coincident constraints of two images that are `shared` by copies are all of one instance with seed points that are one point. No pattern has an external pivot. No mirror is kept out only by the MIRRORs of its points.
- **Rule 6**: after the cut, `sketchContacts` lists no contact without a fix in any of the 24 sketches, and all are valid.
- **With the entries**, the sketches that have them hold far less: Global Sketch 3 goes from 85 curves and 180 degrees of freedom to 8 curves and 13 (with the spokes of its hexagon 14 curves and 3; none with the helper copy of question 2); all sketches together from 520 curves and 409 points to 275 and 208 (347 curves with the spokes). The regions of the ten converted sketches with entries are the same in number and equal in area within 1.5e-13 mm².

### Not on this model

- **An open circular pattern** (`openPattern` true) has an angle the dump does not show a parameter for. It is written with `span: { type: 'angle' }` only when rule 5 can check it; the angle and its sense are read from the positions of the first image. Until a dump shows the parameter, its expression is lost (a number).
- **A linear pattern**: the shift is read from the positions of the first image; the entry is written when the shift runs along `origin/x`, `origin/y` or a line of the sketch, with the count of `patternc1` (and a second direction for `patternc2`), and checked by rule 5. The parameter names are from knowledge, not from a dump. One that is no entry is lost with the cause `pattern`; there are no spokes for a shift.

## External operands

### What an external ID is

A constraint names an external operand by `externalFirst`, `externalSecond`, `externalMirror`, a pivot, or `externalEntity1` and `externalEntity2` of a midpoint: a query with one deterministic ID and nothing else.

**The ID decodes** (read off this dump by the first review; Onshape does not document it). After the first character, the second is the operation that made the entity, and the rest is a number in base 64, least significant digit first, whose low two bits are the kind (0 a vertex, 1 an edge, 2 a face, 3 a body) and the rest an index. `fs.json` lists the bodies and faces every feature created (`created`), so the operations of every sketch feature are known. Over the 8 studios 939 bodies, 957 faces and 746 edges decode to their kind without exception, and each of the 53 operations that hold bodies of a sketch belongs to one sketch.

- **A self-test at the start of every studio**: every ID of `created` must decode to the kind it is listed under. If one does not, the decode is off for that studio, the report says so, and its operands are searched by geometry over all kinds, every pick marked as such.
- **The decode is a filter and a cross-check, not a lookup.** The kind restricts the candidates (a vertex is a point, an edge a curve). An operation that belongs to a sketch restricts them to the sketch made from it; any other operation is a body, so the operand is an edge or a vertex of a body. The index is only a hint (it is the k-th curve of the feature for the three edges of this model and not simply the order of the points), so the entity itself is still found by geometry among those candidates.

What the IDs are:

1. **`IB` is the origin** (vertex 0 of operation B), and becomes `origin`.
2. **`JCC`, `JDC`, `JEC` are the Front, Top and Right planes** (face 0 of the operations C, D, E, the three before the first feature, F). A default plane is a line in the sketch when it is perpendicular to the sketch plane: with the plane's normal `n` and the base of the sketch, `origin/x` when `n` is along the base's Y and `origin/y` when it is along the base's X; a plane parallel to the sketch is no operand. Every sketch of trymesh the converter makes stands on a base plane or a plane feature offset from one, so its origin is the world's origin cast onto it and both lines pass through it.

    | Sketch on | Front (XZ) | Top (XY) | Right (YZ) |
    |---|---|---|---|
    | XY | `origin/x` | none | `origin/y` |
    | XZ | none | `origin/x` | `origin/y` |
    | YZ | `origin/y` | `origin/x` | none |

    The three IDs are from knowledge of Onshape, supported by the decode. On this model `JDC` is Top by the dump (the plane of all 24 sketches, normal (0, 0, 1) through the origin); `JEC` and `JCC` are confirmed by the geometry: every mirror about `JEC` reflects across x = 0 and about `JCC` across y = 0, and every angle to `JCC` is its value measured from +X. A use that contradicts the mapping (a mirror that does not reflect across the axis) is refused by its unit and reported.
3. **An ID of a sketch's operation** is an entity of the trymesh sketch made from that Onshape sketch (an own sketch or a derived copy; an ID lives in the studio that holds the constraint's own feature, so the IDs of a derived sketch are read in its source studio). Candidates are its own points and curves and the copies of its entries, of the decoded kind, mapped into the sketch by `sketchMap` with the frames of the two trymesh planes:
    - a vertex: a point at the place of every local operand that is coincident with it (1e-6);
    - an edge: a curve that fits every use. A point held on it lies on it, **within its extent** when any candidate holds it so; a circle or an arc equal to it has its radius (an arc cut from a circle counts, with the kind `arc`); a line parallel, perpendicular or at an angle to it is a line in the direction the constraint's value gives.
4. **An ID of any other operation** is an edge or a vertex of a body: the bodies of the state before the sketch, the query `body`. A circular edge counts only with its axis along the sketch's normal (1e-4 rad), since otherwise it is no circle in the sketch; a straight edge perpendicular to the sketch is a point and no candidate. The entry is `{ type: 'edge', body, edge, kind: 'line' | 'circle' }` (D23); a point of it is the entry's own derived point (`<entry>/a`, `<entry>/b`, `<entry>/center`), the end taken by position on the previewed entry.
5. **The pick.** Candidates that are one place in the sketch (two edges of one cylinder at two heights) are one answer: the first by the timeline is taken. Candidates at more than one place are not chosen among: the operand stays unresolved and its constraint is lost with the cause `sketch` or `edge` and the candidates in the detail. Every operand is in the report and in `summary.json` with what it decoded to, the number of candidates and places, and the pick; a pick is **inferred** from geometry within what the decode allows, and is named so.

The entry of a sketch entity:

```ts
{ type: 'addExternal', sketch, id: `${sketch}.ref${n}`, ref: { type: 'sketch', sketch: source, entity, kind } }
```

One per entity of the source, reused by every constraint of the sketch that names it. Own points are never merged with a projected point: the point of the sketch stays own and is tied by the constraint (6b, "The Onshape converter"). The converter reads positions of own, origin and projected geometry through one lookup over the previewed sketch (`solvedCurves`), not over its own table of own points.

### Derived sketches and the skeleton

A derived sketch (`importDerived`) is a copy, as today, and its constraints are converted like any sketch's. `studio.ts` keeps **all** the sketches one `importDerived` brings (today a map by the feature's ID keeps the last one only), by source studio and source feature.

The constraints of the model's two derived sketches name `JFE` and `JFJ`, which decode to Sketch 1 of their source studio: the end of its construction line at (32, 0) and that line. Neither studio derives that sketch. It is **the skeleton of the document**: four construction curves whose diameters are `#HOUSING_DIAMETER`, `#HOUSING_MOUNTPATTERN` and `#OUTPUT_MOUNTING_PATTERN`. The six constraints hold the seed of the 12 mounting holes (Global Sketch 2) and of the 12 nut pockets (Global Sketch 3) on the mount pattern circle. Without them `HOUSING_MOUNTPATTERN` is used by no converted studio, and the holes of two mating parts hang free.

**A helper copy** closes it: when a derived sketch names an entity of a sketch of its source studio that this studio does not derive, that sketch is copied too, before the derived one, as a sketch of construction use (`Global Sketch 2 (Global Sketch: Sketch 1, a helper)`), and the operands are found in it. The decode says exactly which sketch. Its constraints are counted in a row of their own, outside the 380, so "before" and "after" stay the same set. It is the recommendation of "Open", question 2, which is the owner's.

Measured with the helper copies: one sketch of 4 curves and 9 constraints in each of the two studios (6 written, 3 shared; one diameter as a number, see "The ladder"); the 6 lost constraints are written; `HOUSING_MOUNTPATTERN` and `OUTPUT_MOUNTING_PATTERN` come into use in Housing and Motor Shell; `HOUSING_MOUNTPATTERN` ± 3 % moves the holes (the volume of Housing changes from 33562.6 to 33608.5 and 33594.1, of Motor Shell from 22516.8 to 22496.8 and 22493.0) with no conflict; the two copies of Global Sketch 2 and 3 have no freedom left (2 and 3 without).

### The constraint on it

The operand is now an ID and a kind (`origin` a point; an axis a line; an entry a point, a line, a circle or an arc), and the constraint goes through the table of local constraints. What that gives for the kinds the model has:

| Onshape | trymesh |
|---|---|
| COINCIDENT of a point and the origin or a projected point | `coincident` (the point stays own) |
| COINCIDENT of a point and an external curve | `pointOnCurve` |
| HORIZONTAL or VERTICAL of a point and the origin | `pointOnCurve` with `origin/x` or `origin/y` |
| DISTANCE, horizontal or vertical, of two points | `horizontalDistance` or `verticalDistance`, the two in the order that makes the value positive |
| EQUAL of a circle and an external circle | `equalRadius` |
| MIRROR about a default plane | an entry, or `symmetric` about the axis ("Patterns and mirrors") |
| ANGLE of a line and a default plane | `angle` with the axis ("Kinds taken along") |

`midpoint` and `equalLength` do not take an axis (D71); such a constraint is lost with the cause `plane`. HORIZONTAL and VERTICAL with one operand the origin are looked up before the two-point form, which would otherwise take them.

**"Horizontal" is Onshape's, not trymesh's.** The converter draws in the frame of the base plane, and Onshape's horizontal is the X of the sketch's matrix. Along the base's X (the absolute value of the dot product above 1 − 1e-9; the sense does not matter for a horizontal) it is `horizontal` (`origin/x`, `horizontalDistance`); along the base's Y it is `vertical`; turned otherwise, the constraint is lost with the cause `kind` ("the sketch is turned in its plane"). A signed distance reads the sense too. Today the converter writes `horizontal` whatever the matrix says; no sketch of the model shows it.

### Measured

- **The origin**: 31 of 31 made (22 `coincident`, 8 `pointOnCurve` with `origin/x`, 1 `horizontalDistance` with the expression `E`); 3 of the 8 are then `implied`.
- **The default planes**: 13 of 13 (5 angles, 6 mirrors by `symmetric`, 2 mirrors as entries).
- **Another sketch and an edge**, by the decode:

    | ID | Use | Decoded | Candidates of that kind there | Pick |
    |---|---|---|---|---|
    | `JFB` | Housing 2, EQUAL, r 35 | an edge of Sketch 1 | 1 | its circle of r 35 |
    | `JFF` | Output Shaft 3, EQUAL, r 22.5 | an edge of Sketch 1 | 1 | its circle of r 22.5 |
    | `IF`, `JFE` | Input Shaft 2, points at (±1.25, 0) | vertices of Sketch 1 | 1 each | the two centres |
    | `JKM` | Output Shaft 4 and 5, a point at (17, 0) | a vertex of Sketch 2 | 1 | the centre of its fourth circle |
    | `JQx` | Motor Shaft 3, a point at (3, 5.196) | an edge of a body (operation Q) | 6 edges at 3 places; within their extent 2 at one place | the rim of radius 6 of Extrude 1, as an `edge` entry |
    | `JFE`, `JFJ` | Global Sketch 2 and 3, in two studios | a vertex and an edge of Sketch 1 of the source studio | 1 each in the helper copy; without it the sketch is not in the document | the end of the construction line, and the line |

    With the kind and the sketch known, no operand in a sketch has more than one candidate. The first version searched all earlier sketches and picked `JKM` 1 of 2 and `JQx` 1 of 3; its picks for the sketch operands were the right entities, and for `JQx` the circle of Sketch 1 under the edge, a sketch entity where Onshape names the body. `JQx` fits four more edges only as endless lines (the point is beyond the ends of two hexagon sides); the two circular edges are the two ends of one cylinder.
- **All 13 are written** (7 without the helper copies); one, the coincidence with `IF`, is then `implied`.

## Kinds taken along

Three kinds the plan left to the backlog are mapped, because the external operands need the first and the others cost a line each ("Open", question 1):

- **ANGLE of two lines.** trymesh measures from the direction of `a` to the direction of `b`, counter-clockwise, in (−π, π]; Onshape gives an unsigned value and the flags `clockwise`, `aligned` and `flipped`. The angle is measured on the positions (a line that is a reversed duplicate in its own direction), and of the forms `e`, `-(e)`, `pi - (e)`, `(e) - pi` of the Onshape expression `e` those whose value (`expressionValue` over the parameters of the document) equals the measured angle within 1e-6 fit.
    - **One fits**: it is written.
    - **Two fit** (at 0, π/2 and π: `e` and `pi - (e)` agree at 90° and part as soon as the value changes). One of the two has `e` with a plus and one with a minus. If `e` names no parameter, both are the same number for good and the first is written. Else the one with the minus is written when `clockwise` is true and the one with the plus when it is false, and the report says that the form was chosen by the flag.
    - **None fits**: the measured number, with a note.
    - The rule of the flag is read off this model, where `clockwise` is true exactly for the one angle of six that needs `-(e)`. `summary.json` records the three flags and the form of every angle, so a second model can confirm or correct it.
    - Measured: all 6 angles written with their expression (5 as `e`, 1 as `-(e)`); none of them is at an ambiguous value (30°, 45° and 60°).
- **HORIZONTAL or VERTICAL of two points**: `verticalDistance` (or `horizontalDistance`) of 0 between them, a driving dimension. Measured: 3 of 3. It reads as a dimension of 0 in the app; a constraint of its own is a backlog row.
- **DISTANCE of two lines**: `distancePointLine` of the start of the first line to the second, one constraint for one, written when the two lines are parallel in the geometry (1e-9), else lost with the cause `kind`. The first version left it lost because it had `parallel` beside it. Measured: 3 of 3 (the hexagons across flats, driving dimensions), the check and the probe pass.

`expression()` of `common.ts` learns units as factors in general: `45.0*deg` and `45 deg` become `deg(45.0)`, `2*mm` becomes `2`, and a unit it does not know leaves the expression unconverted (a number, with a note), where today it passes through unchanged and fails later.

Left lost, each a backlog row:

- **MIDPOINT of two points** (2, the centre of a rectangle drawn from its centre; its operands are `externalEntity1` and `2` or local points): needs a construction line between the two points.
- **`FIX`**: of a point it is `fixed` at its place; of a converted spline `fixed` on every control point of all its pieces, within the budget of "Splines"; of a line or a circle it is lost with the cause `kind`. The 4 of the model are on the disc's splines, which are not converted, so their cause is `spline`.

**A point "on" a curve it is an end of** is `shared`, not written. Today it is written as `pointOnCurve` and is one of the two redundant constraints of the baseline (one case, Input Shaft 4).

**An arc gets a kind** (`arc`), which the converter does not give it today: EQUAL of two arcs or an arc and a circle is `equalRadius`, RADIUS and DIAMETER take an arc. No arc of the model has a constraint, so the cause `arc` is empty before and after.

## Splines

Onshape's spline is in `features.json` (`BTCurveGeometrySpline`: `controlPoints` flat in metres, `knots`, `degree`, `isRational`, `isPeriodic`); the geometry endpoint (`sketches.json`) has only its two end points and its parameter range. The converter reads the control points from the feature's entity and the IDs of the end points from the geometry endpoint (one of the disc's four splines has them empty in the feature).

1. **Not converted, listed with the reason**: rational; periodic; a degree above 3; a control point or a knot that is not finite; a number of knots that is not the number of control points plus the degree plus 1; knots that decrease; **knots that are not clamped** (the first and the last repeated degree + 1 times: `bsplineBeziers` assumes it and does not test it; a review's probe got a wrong first point from an unclamped quadratic); an inner knot repeated degree + 1 times (a break in the curve); a segment that is not the whole knot range; first and last control points that are not the end points of the geometry endpoint (1e-6); over the budget.
2. **A clamped uniform cubic of up to 64 control points** (the knots equally spaced within 1e-9 of the range) is one `spline` over its control points: the curve of D70 exactly.
3. **Any other spline that passes rule 1** goes through `bsplineBeziers` (D70 exports it for this): one `spline` of `degree + 1` points per piece (a line for degree 1), neighbouring pieces sharing their end point. The converter keeps the chain of pieces of each Onshape spline, in order.
4. **The points**: the first and the last control point are the spline's end points of Onshape and are welded by position like any end; the inner control points are own points that are never welded with anything.
5. **The budget: 193 control points of splines in one sketch**, counted over all its splines before any is written (64 cubic pieces, or three uniform splines of 64 points). Over it, none of the sketch's splines is written (a region bounded by half its splines is of no use), and each is listed with what it needs and what there is. Measured on the disc's two visible splines:

    | Pieces | Points | The batch of the sketch, points free | With `fixed` on every point |
    |---|---|---|---|
    | 16 | 49 | 13 ms | 25 ms |
    | 64 | 193 | 9 ms | 0.22 s |
    | 128 | 385 | | 1.7 s |
    | 160 | 481 | | 3.3 s alone; the solver out of memory right after another large sketch |
    | 256 | 769 | 77 ms | the solver out of memory: `sketchConflict`, nothing named |
    | 1,024 | 3,073 | 1.7 s | |
    | 6,285 (both splines whole) | 18,855 | 108 s | |

    The first version's cap was 256 pieces, set by the free points alone. An imported spline is what carries a `FIX`, and fixed points are what costs: the budget is where both columns stay under a quarter of a second. The whole outline is right: one region with an outer loop of 6,285 curves, the area by the pieces 2228.709 mm² (Onshape: the region with its bore and six holes, 2228.71), the extrusion 8914.87 mm³ in 0.27 s. But every recompute of that sketch would take 108 s, and it would hold 37,710 degrees of freedom.
6. **The disc keeps its generator** (`overrides/actuator-5010.ts`, D61): its splines are over the budget, are listed, and the override builds the disc. With the six holes as an entry, the override's reading of the hole regions (regions with one curve in the outer loop) still finds the bore and six holes; its volume is unchanged.
7. **A region bounded by a spline** is matched by the chain, not by a piece: an Onshape edge of the kind `other` matches a run of loop curves that is the whole chain of one spline, in order, when the chain's two ends are the edge's and the edge's middle lies on the chain's polyline within 1e-3. `matchRegion` skips `other` edges today and tests every loop curve alone; both change.
8. **`FIX` of a spline** is one unit: `fixed` on every control point of its chain, each once.

No spline of the model is under the budget, so rules 1 to 4, 7 and 8 are tested on fixtures only.

## The order within a sketch

1. Read the entities: points welded by distance, lines, circles, arcs, splines; exact duplicates redirected.
2. Decide the entries by rules 1 to 4; their images are not made.
3. Make the units: resolve external operands (which adds reference entries), map each Onshape constraint, start its record.
4. The ladder of "The check": all units, or one by one.
5. Execute; preview the cut and check it, with rules 5 and 6 of the entries; execute the cut.
6. Remove the implied constraints.
7. Close the records: fates, causes, what the cut consumed.

## Regions and the features over a sketch

- **`matchRegion` reads `solvedCurves(sketch, result)`** in place of `document.curves`: a curve of the outer loop may be a copy (`Sketch_2.pattern0/3/Sketch_2.abc`), which the document does not hold. Spokes are construction lines and are in no loop.
- **The names of side faces** change where a curve is now a copy or a piece of the tool. Nothing in a converted document names a face but through the lookups by geometry (`trymeshFace`, the edges of chamfers), which read the body.
- **The override of the disc** needs no change (measured).

## Measured (2026-11-25)

The model: the dump of the cycloidal actuator 5010 of 2026-11-25 (the assembly, the 8 part studios that have sketches with their dumps, 66 parts of other documents as STL). The baseline: the converter at `c01e765`, 31 s. The trial: a copy of the converter with every step of this design but the splines, rule 5 of the entry, the choice of a mirror's seed, the cut inside the test of a unit and the weld by distance; 32 s, and 35 s for the probe. "After" is with the helper copies of question 2; the last column is without them.

**Fates** (380 constraints, 24 sketches):

| Fate | Before | The first version | After | After, no helper copies |
|---|---|---|---|---|
| Written | 93 | 184 | 176 | 170 |
| Entry | 0 | 12 | 12 | 12 |
| Shared | 155 | 155 | 176 (92 by a point, 63 by copies, 1 an end of the curve, 20 by the cut) | 176 |
| Twice | 1 | 5 | 5 (4 mirrors of two points that a mirror of their lines already writes, 1 coincidence) | 5 |
| Implied | 0 | 0 | 5 | 5 |
| Lost | 131 | 24 | 6 | 12 |

The helper copies add, outside the 380: 2 sketches, 18 constraints, 12 written (2 as numbers) and 6 shared.

**The lost, by cause:**

| Cause | Before | The first version | After | By what |
|---|---|---|---|---|
| A curve the converter split | 37 | 0 | 0 | `split` (6e) |
| The origin | 31 | 0 | 0 | `origin`, `origin/x` (6a2) |
| A default plane | 13 | 0 | 0 | `origin/x`, `origin/y` (6a2), with the mirror and the angle |
| An entity of another sketch | 12 | 6 | 0 (6 without the helper copies) | entries `{ type: 'sketch' }` (6b), the decode, the helper copy |
| An edge of a body | 1 | 0 (written on a sketch curve) | 0 | an entry `{ type: 'edge' }` (D23) |
| A pattern | 19 | 9 | 0 | entries `pattern` (6c) 10, spokes 9 |
| A mirror of curves about a line of the sketch | 5 | 0 | 0 | `symmetric` |
| A spline | 4 | 4 | 4 | |
| A kind without a counterpart | 9 | 5 | 2 | `angle`; a dimension of 0; `distancePointLine` |
| Refused by the check | 0 | 0 | 0 | |

**The sketches:**

| | Before | The first version | After |
|---|---|---|---|
| In the first step of the ladder | 24 of 24 | 24 of 24 | 24 of 24 (the 2 helper copies one by one) |
| Status `ok`, conflicting constraints | 24, 0 | 24, 0 | 24, 0 |
| Largest drift of a point or a radius, before and after the cut | | | 7e-15 mm, 0 |
| Valid profile, nothing uncut, no contact without a fix | 24 | 24 | 24 |
| Regions | | the same number in every sketch as before; the largest difference of an area 6.5e-8 mm² | the same; Onshape's number in 23 (the disc 7 of 8) |
| Degrees of freedom, all sketches | 771 | 159 | 10 (20 without the helper copies) |
| Fully determined sketches | 0 | 11 | 21 (17) |
| Constraints the engine lists as redundant | 2 | 10 | 1 |
| Own curves, own points | 520, 409 | 275, 208 | 347 (72 of them spokes), 208 |
| Constraints in the document, entries | 93, 0 | 175, 19 | 322, 25 |
| Parameter changes that break a sketch or a feature | 0 of 40 | 3 of 48 | 0 of 56 (0 of 48) |

The three sketches that keep freedom: the disc's (8; its splines are left out), Input Shaft 2 (1, and none beside today's `E`), and Motor Shell 2 (1; the two midpoints that stay lost).

**The parts** (with the override of the disc; volumes in mm³ of the baseline):

| Part | Volume | Part | Volume |
|---|---|---|---|
| Cycloidal Disk | 4951.520 | Output Shaft Front | 17118.317 |
| Housing Front | 5665.516 | Output Shaft Rear | 7360.887 |
| Housing Middle | 22171.440 | Output Shaft Spacer (six) | 43.900 |
| Housing Rear | 5725.680 | Motor Shell | 22516.843 |
| Input Shaft | 891.154 | Hex Standoff | 224.294 |
| Motor Shaft | 2561.152 | | |

The largest difference of a volume between the baseline and the trial is 6.9e-6 mm³ (3.1e-10 of the part, Housing Middle), in the first version and in this one. The same 4 of 10 chamfers convert, with the same refusals; 31 starts at a face are `from`; the loaded document has 335 bodies with the override of the disc and 333 without (counted by the first review).

**The tolerances of the contacts**: over all sketches of the dump, 475 pairs of a point and a curve, or of two curves, are in contact, the worst by 2.8e-14 mm; the nearest pair that is not is 0.42 mm apart.

## What stays lost, and where it stands

| Lost | Count | Where it stands |
|---|---|---|
| `FIX` of the disc's splines | 4 | The splines are over the budget; the generator replaces them |
| MIDPOINT of two points | 2 | Backlog row, a kind of constraint |
| A constraint of a derived sketch on the skeleton sketch | 0, or 6 with "no" to question 2 | With "no": the row says that `HOUSING_MOUNTPATTERN` then drives nothing and the mounting holes of Housing and Motor Shell are free |

Not lost and not Onshape's either, so listed in the report: the count of the 9 patterns by spokes is a number; one diameter of each helper copy is a number.

## Engine gaps

Rows of `docs/backlog.md` the closing point adds; none is fixed here.

1. **A pattern or a mirror among own curves.** The copies of D68 cannot be constrained or cut, which keeps 9 of the 19 patterns of this model from being entries: a hexagon drawn as a pattern of one side is closed by a coincidence on a copy, and pin pockets patterned on a bore cross it. The converter writes them by spokes, which is the backlog's "sketch tool that makes a batch of copies tied by constraints" done by hand (6c chose derived geometry); the row gains the measured need (72 construction lines for 9 patterns, the count no parameter) and the two narrower forms: a constraint that may name a copy, and an own curve cut where a copy crosses it.
2. **Horizontal and vertical of two points** as a constraint (today a dimension of 0).
3. **A midpoint of two points; a distance of two parallel lines as a constraint of two lines, and from a line to a circle.**
4. **A sketch of thousands of spline pieces**: 108 s for 6,285 pieces (18,855 free points), where 256 take 77 ms. Either a spline refitted within a tolerance, or the cost of the sketch step with many free points looked into; which part is slow was not measured.
5. **A sketch of another document projected**: a derived sketch stays a copy that drifts from its source, and a helper copy with it.
6. **Redundant constraints.** A consistent set with a redundant constraint conflicts when a dimension changes (Motor Shell Sketch 1 with four redundant `symmetric`: `sketchConflict` at any other `HOUSING_DIAMETER`). And the engine's list of them is not a set that can be removed: it names some members of each dependent group, and one it names can be a constraint whose removal gives a freedom back. A tool "remove what is implied" would do in the engine what the converter does by trial.
7. **The solver out of memory is reported as a conflict.** 769 fixed points (1,538 equations) abort the solver; the sketch gets `sketchConflict` with no constraint named. The solver works again afterwards, but a large solve leaves less for the next (150 pieces failed right after 140, where 160 alone passed). `fixed` on a few hundred points is also slow (1.7 s for 385).

Found on the way and not an engine gap: `fetch.ts` does not dump what the external operands of sketch constraints are ("Open", question 3); the skeleton studio's geometry in the dump has a diameter that its variable does not give (72 against `HOUSING_DIAMETER` = 70).

## Acceptance

1. **`docs/onshape-import.md` has the tables of "Measured"**: fates and causes, before and after, as the implementation's runs give them. The "before" column is taken by the first point of work with the converter otherwise unchanged. If the implementation's numbers differ from this text's, the run is the evidence: the difference is explained and the text corrected, in either direction.
2. **No sketch is split by the converter**: `splitAtCrossings` is gone; every sketch of the model has a valid profile after `split`, nothing in `ids.uncut`, no contact without a fix, and Onshape's number of regions (the disc's sketch excepted, by its splines); no constraint has the cause `split`.
3. **The parts are unchanged**, by the comparator over two `summary.json` files (the baseline's and the run's): every volume within 1e-3 mm³, the same number of regions in every sketch with areas within 1e-6 mm², the same chamfers and fillets with the same edges kept, the same starts written as `from`, the same number of bodies in the loaded document, no feature newly in error, no key missing.
4. **The lost are at most 6** (12 with "no" to question 2), by the causes of "What stays lost". A higher number is explained cause by cause in the notes, not accepted silently.
5. **No parameter change of the probe breaks a sketch or a feature** that it does not break in the baseline; every note of the probe (a changed number of regions or of degrees of freedom) is listed with its cause in `docs/onshape-import.md`.
6. **Every constraint still listed as redundant is listed in the notes** with why it could not go.

## Where the code lives

All in `tools/onshape/`; nothing in `packages/`.

| File | What |
|---|---|
| `fates.ts` (new) | `Fate`, `Cause`, the record of a constraint, `Tally`; the tables of the report; `summary.json` and its comparator |
| `check.ts` (new) | What passes, the units, the ladder, the implied constraints |
| `probe.ts` (new) | The parameter probe over a converted document |
| `constraints.ts` (new) | The mapping of constraints, moved out of `sketch.ts`: the table, the angle, the symmetry of a mirror, the spokes |
| `operands.ts` (new) | What an external ID is: the decode and its self-test, the origin, the axis of a default plane, an entity of a sketch, an edge of a body; the pick |
| `derived.ts` (new) | The rule of the entry, the entries `pattern` |
| `sketch.ts` | The entities (welds, duplicates, splines), the order of "The order within a sketch", the call of `split`, `matchRegion` over `solvedCurves` and over chains; `splitAtCrossings` removed |
| `studio.ts` | The operations of the studio's sketches for the decode; all sketches of one `importDerived`; the helper copies; the outcomes of features into the summary |
| `common.ts` | `expression` reads units as factors; the `Report` holds the `Tally` |
| `convert.test.ts` | Writes `summary.json`, runs the probe, compares with `ONSHAPE_BASELINE` |
| `kit.ts` (new), `*.unit.test.ts` | Fixtures in the shape of Onshape's JSON, built by small functions, and the unit tests |

`fetch.ts`, `assembly.ts`, `extent-start.ts` and the override are not changed.

## Points of work

Each point is closed as CLAUDE.md says: implemented, tested, documented, reviewed, fixed, two commits. After every point the converter is run on the dump and its `summary.json` compared with the one before; the column "Lost after" is what the causes predict for that point (only the first and the last are measured as such), and a run that gives another number is explained before the point is closed.

| Point | What | Lost after | Review |
|---|---|---|---|
| 1 | **The count.** `fates.ts` with the records, the report, `summary.json` and the comparator, the weld count, the decode used only to name the cause of an external operand (12 in a sketch, 1 on an edge), `probe.ts`. The document written must be byte for byte the baseline's. The "before" tables and the baseline's probe (40 changes, none breaks) into `docs/onshape-import.md` | 131 | Full, focused on the classification and the records: it is new code that defines every number of the acceptance, so "anything else" of CLAUDE.md's table. The first version said light; two reviews objected |
| 2 | **The check.** `check.ts`: what passes (status, radii, 1e-6), units, the ladder with numbers per unit, implied constraints; `shared` established from identity, the weld by distance, `twice` by `constraintKey`, a point on its own end `shared` | 131 | Full |
| 3 | **Crossing curves** by `split`, previewed and checked; duplicates redirected; `splitAtCrossings` removed | 94 | Full |
| 4 | **Known operands and kinds**: the origin, the default planes for everything but mirrors of curves, the angle, horizontal and vertical of two points, the distance of two lines, an arc's kind, Onshape's horizontal by the matrix, `expression` | 51 (the 8 mirrors of curves about a default plane wait for point 6) | Full |
| 5 | **Found operands**: the decode as the filter, entities of sketches, edges of bodies, all sketches of an `importDerived`, the helper copies if the owner says yes | 38 (44 without the helper copies) | Full |
| 6 | **Mirrors and patterns**: the rule of the entry, the entries, `symmetric`, spokes; `matchRegion` over `solvedCurves` | 6 (12) | Full |
| 7 | **Splines**, with `FIX` and the chains in `matchRegion` | 6 (12) | Full; small |
| 8 | **The close**: the "after" tables, the sections "Sketches" and "Gaps" of `docs/onshape-import.md`, the backlog rows, "As implemented" here | | Light: documents only |

Points 5 and 6 are the risky ones. If the review of a point finds more than six issues with three serious ones, it gets a second round (CLAUDE.md, "Further rounds").

## Tests the implementation owes

The unit tests run in the root run and read no dump: each builds a part studio of one to three sketches in the shape of Onshape's JSON with `kit.ts` (entities, constraints with their parameters, the sketch matrix, `created` with IDs made by the encoding), writes it to a temporary folder in the layout of `fetch.ts` where a whole studio is converted, and runs the converter with the real adapters. Nothing in a fixture is copied from the owner's document; the IDs are made up.

**A test of a shape no dump has shown is named "from knowledge"** (a linear and an open pattern, a turned sketch, an arc with a constraint, a spline under the budget, a vertex of a body), and the converter writes a note the first time a real dump takes such a path, so the owner knows that the case ran on real data for the first time.

1. **The tally and the summary**: the fates of a sketch add up to its constraints; the tables as text; the reason kept apart from the operand's category; the comparator fails on a missing part, a value that is not finite, a changed outcome; a small assembly written, loaded again and its bodies counted.
2. **The check**: a diameter with a wrong value (a radius changes, no point moves): refused; a solver failure with nothing named: not passed; a wrong dimension among good constraints: the others keep their expressions, the one falls to its number, and one that fits no number is `refused`; a mirror whose second half fails: the whole unit dropped; two dimensions of one key with different values.
3. **Implied constraints**: a centre on the origin and also horizontal with it (the second `implied`); four mirrors of a four-fold symmetry (the sketch follows its diameter afterwards); a constraint the cut added is never removed; a listed constraint whose removal frees the sketch stays.
4. **The probe**: a parameter that breaks a profile is reported as a break; a count is changed by one; a parameter nothing uses is listed as unused.
5. **Crossing curves**: a line through a circle that has a diameter and a point held on it: two D-shaped regions, the diameter written, the point `shared` by the cut; a line that touches a circle: not cut; a crossing with two partly overlapping lines beside it: the tool's `ok` not taken for a valid profile; two identical circles: one, both IDs usable; a construction line on an outline line: both kept; a reversed duplicate line under an angle.
6. **Welds**: two points 2e-7 apart are one, two 9.8e-5 apart are two; a coincidence of two points that stand apart is written, not `shared`; a weld without a constraint is counted.
7. **The origin and the default planes**: coincident, horizontal and vertical of a point, a horizontal distance with a parameter, on sketches on XY and on XZ with a flipped normal; the table of "What an external ID is" on the three base planes and an offset plane; a plane parallel to the sketch; a mirror and an angle to each axis; a sketch turned in its plane (from knowledge).
8. **The decode**: IDs of each kind and of several lengths; the self-test failing on a studio whose `created` contradicts it; a vertex ID with a curve through the place (the point, never the curve); an edge ID with a point at the place (the curve).
9. **Another sketch**: one candidate; two at two places (unresolved, lost with the candidates); the same place twice (one answer); a point beyond the end of a line and on a circle (the circle); an arc cut from a circle under EQUAL; a derived copy whose operand is in a sketch not derived, with and without the helper copy; two sketches from one `importDerived`; a source on a parallel offset plane.
10. **An edge**: a point on the rim of an extrusion (the entry, the slide along the rim kept when the sketch under it changes); a circle equal to a circular edge; a circular edge whose axis is not the sketch's normal (no candidate); a point on the end of a straight edge (from knowledge).
11. **Mirrors**: an image that nothing names (an entry); a mirrored line with the MIRRORs of its ends (an entry); the first curve named and the second not (the second is the copy); an image with a tangent line (by `symmetric`, the profile valid after the cut); a mirror of a mirror; a point on the mirror line and on the origin; two arcs (three `symmetric`, the surplus implied).
12. **Patterns**: holes on a circle with the count a parameter (an entry; the count changed, the body follows); a hexagon of one side (spokes, a tree of angles, the hexagon follows its across-flats dimension); a ring closed only by coincidences of two instances (no entry); pockets across a circle (spokes, cut by `split`, the regions as Onshape's, the pockets follow the circle's diameter); instances that overlap each other (no entry, by rule 2 or 6); a pattern of a pattern (the outer an entry); an external pivot; an entry whose copies do not land, and one with a copy too many (dropped by rule 5); an open and a linear pattern (from knowledge).
13. **The angle**: the four forms; a value that fits none; 90° with a parameter and `clockwise` either way, and the sketch after the parameter changes; 0° and 180°; a plain number at 90°.
14. **Splines**: a uniform cubic of six points (one spline); a non-uniform one (a chain, its area against the polygon of its samples); rational, periodic, unclamped, a repeated inner knot, end points that disagree (each listed); 193 and 194 points, and two splines that pass alone and not together; `FIX` of a chain; a region bounded by a chain of several pieces matched, and extruded.
15. **`matchRegion`** with a copy in the outer loop.

The run on the dump is the acceptance, made by hand at every point and recorded in `docs/onshape-import.md`.

## Risks

For a reviewer, the riskiest first.

1. **The removal of implied constraints is a search by trial over a list the engine does not promise.** It may drop a constraint that is redundant only at today's values, or keep the sketch from following a parameter by keeping the wrong member of a group. The check before and after, the count of freedom and the probe guard it; all three are at or near one state.
2. **The decode is read off one dump.** If Onshape encodes otherwise elsewhere, the self-test catches a wrong kind, not a wrong operation. A wrong pick within the decoded sketch still holds at today's positions; the report names every pick as inferred.
3. **The rule of the entry.** Rules 1 to 4 are the converter's reading; what they miss is caught by rules 5 and 6 only where the engine sees it now. A copy that meets nothing today and would after a parameter change is seen by the probe at 3 %, not beyond.
4. **Spokes** make sketches larger (Housing 1 and Motor Shell 3 gain 16 construction lines each) and write the count as a number. A pattern whose count is a parameter stops following it, and says so only in the report.
5. **A recovered constraint that holds now and misbehaves later**: an angle written as `pi - (e)` is right at today's value and wrong in sense if the design flips; the flag rule for ambiguous angles rests on six samples.
6. **The helper copy is a second copy of a copy.** It drifts from its source like the derived sketch does, and one of its dimensions is a number because the dump's geometry and variable disagree.
7. **The volumes are checked on one model.** The unit tests cover the shapes of this model and the cases it lacks; a second real model was not converted.
8. **Removing `splitAtCrossings`** removes the repair of partly overlapping collinear lines, which the tool refuses. Not on this model.
9. **A sketch with entries has other IDs than Onshape's instances.** A later change of the converter that names an instance by its Onshape ID (an override, a chamfer by curve) would find nothing; lookups go by geometry and should stay so.
10. **The dump is not in the repository**, so the acceptance cannot be repeated by CI or by a reviewer without the owner's copy. The numbers of "Measured" and the baseline `summary.json` kept with the dump are the reference.

## Rejected

- **Every pattern and mirror as an entry, as the outline says.** Nine patterns and eleven mirrors have a copy that is constrained or met by a curve. As entries, three sketches would be left with an invalid profile (the housing's bore is crossed by fifteen copies that cannot be cut), which changes the parts, and the constraints on images would be lost in place of the pattern.
- **Every mirror by `symmetric`, no mirror entry.** One mechanism, and it always works. Not taken: the two mirrors that can be entries cost nothing beyond the rule the patterns need anyway, and an entry is what a person would draw.
- **A pattern that is no entry left lost**, as the first version had it, or held only by `equalRadius` and `equalLength` with its seed: measured in "Otherwise".
- **Keeping the redundant constraints**, as the first version had it, and the other rules for removing them: measured in "Implied constraints".
- **Closing a hexagon on its seed**: replacing the coincidence on a copy by two spokes to the ends of the seed and their angle of 2π/n, so the pattern could be an entry. It is a recognition of one shape; the distance across flats names a copy as well.
- **The search by geometry over all earlier sketches, ranked** (a point before a curve, the earliest sketch), as the first version had it: it can turn a point held on an edge into a coincidence with a sketch point at the same place, and can never find an edge of a body, since nearly every edge has a sketch curve under it.
- **A stand-in for an edge of a body** (the sketch curve the edge was extruded from): it behaves the same only while that extrusion stays as it is.
- **Keeping `splitAtCrossings` as the fallback** when the tool refuses: two cutting codes with two tolerances, the second with the losses this point removes.
- **The step "every dimension as a number"** before one by one: one bad expression costs every good one.
- **A target count.** The acceptance is the tables and the bound this model gives.
- **The two `summary.json` files committed beside the design** (a review's proposal): they hold the names and measures of the owner's model, which the brief keeps out of the repository. They are kept with the dump; the tables of `docs/onshape-import.md` are the record. The owner can decide otherwise.

## Known limits

- **A pattern by spokes has a fixed count**, and a pattern or mirror by constraints is heavier than Onshape's one constraint. A linear pattern that is no entry is lost.
- **"Implied" is judged at today's values**, and which member of a dependent group goes is the search's choice.
- **The probe is ± 3 % of one parameter at a time.** What breaks further away, or only when two parameters change together, is not found.
- **An operand is picked by geometry within what its ID decodes to**; of several entities of one kind at one place in one sketch the first is taken.
- **Partly overlapping collinear lines** are refused by `split` and reported; the old converter cut them.
- **Splines of more than 193 control points in a sketch are left out**, and a region bounded by them is not converted, as today.
- **A chain of Bezier pieces is smooth only as written.** Its control points are free points; once one moves, nothing holds the tangents of neighbouring pieces together (D70 has no such constraint). `FIX` holds an imported one in place.
- **An open pattern loses the expression of its angle; a linear pattern is written from positions.** Neither was seen in a dump.
- **Constraints that name a point of a spline between its ends** (a spline drawn through points in Onshape) have no counterpart: nothing holds a point on a spline (D70). From knowledge; the model's splines are imported and have none.
- **The converter still builds no tilted plane**, so a default plane is an axis only for sketches parallel to a base plane, which are all it converts.
- **The one-by-one step keeps a subset that depends on the order** and is not the largest possible.

## Open

**Three choices are the owner's. None holds the implementation up: the design goes ahead with the recommendation unless the owner says otherwise.**

1. **The angle, "horizontal of two points" and the distance of two lines in this point**, though the plan names the angle and other distances among the kinds left to the backlog. *Recommendation: yes, all three.* Five of the six angles are to a default plane and step 4 cannot recover them otherwise; all six map with their expressions, the three two-point constraints by a dimension of 0, the three distances of two lines by one `distancePointLine` each (added after the first review; they are the hexagons' driving dimensions). Without them the lost are 18, not 6. *The reviewers:* all three say yes; the first adds the distance of two lines, the second asks for the handling of ambiguous angles that "Kinds taken along" now has.
2. **Copy the skeleton sketch that the derived sketches are held on** (a helper copy of Global Sketch 1 in Housing and in Motor Shell). *Recommendation: yes; changed from "no" in the first version.* The first version saw six constraints "on a sketch of another studio" and a third copied sketch. The first review showed what they are: the link from `HOUSING_MOUNTPATTERN` to the mounting holes of two mating parts, which without the copy no parameter drives. Measured with the copy: lost 6, not 12; that parameter moves the holes of both parts with no conflict; the two derived sketches have no freedom left; the 380 stay the same set, the copies' 18 constraints counted apart. The cost is one sketch of four construction curves in two studios, a second copy that can drift from its source, and one diameter written as a number. *The reviewers:* the first says yes, for the reason above; the second and the third say no, as a boundary of scope (no closure of dependencies in 6h, the six reported precisely). If the owner says no, "What stays lost" names the parameter that drives nothing.
3. **What an external ID is, from Onshape.** One FeatureScript call per studio (`sketchEntityQuery` for every entity of every sketch, and the geometry of the IDs that are no sketch entity) would say it exactly; `fetch.ts` would write it to a file of its own and the converter would prefer it. *Recommendation: not in 6h, and the decode in its place now.* The decode needs no call, identifies the kind and the sketch of all 13 operands and leaves one candidate for each of the 12 in a sketch; every pick is reported as inferred, and operands with candidates at several places stay unresolved. The call needs the API (about 8 calls of the FeatureScript budget of about 150) and is worth making before a second model is converted, because the decode is read off this dump and not documented. *The reviewers:* the first says not in 6h, use the decode; the third says not in 6h; the second would bring it forward, or else leave ambiguous picks unresolved and name the others inferred, which the design now does.

For the owner to know, since they follow from the measurements and not from the plan:

- **The headline was 131, not 287.** `docs/onshape-import.md` says "93 of 380 have a counterpart"; the closing point corrects it.
- **Nine patterns are written by spokes**, not as Onshape's one constraint, by a limit of D68 (engine gap 1).
- **The disc's splines convert, and are not used**: 108 s a recompute.
- **The baseline `summary.json` is not committed** ("Rejected").
- **In the dump, the skeleton studio's housing circle is 72 mm where `HOUSING_DIAMETER` is 70.** Nothing converted uses that circle.

## Reviews

Three independent reviews read the first version (`314188c`) on 2026-11-25: a subagent with the dump and the trial (called the first below; it ran probes of its own), codex without the dump (the second; three probes on the engine), and agy without the dump (the third). Together 43 findings, 24 of them rated serious. All were checked; none was refuted outright, a few were taken in another form than proposed. What changed:

| Finding | By | What changed |
|---|---|---|
| Redundant constraints freeze a sketch against its parameter (Motor Shell 1) | 1 (S1) | Confirmed. The fate `implied` and the removal after the cut ("Implied constraints"). The proposed rule (skip what is listed right after adding) was tried and frees 13 degrees of freedom; the rule taken was chosen among five measured. Engine gap 6 |
| Nothing is tested away from today's values (Output Shaft 6) | 1 (S3) | Confirmed. The probe is part of the report, `summary.json` and the acceptance. For a pattern that is no entry the proposed `equalRadius` and `equalLength` were measured (no break, the pattern crooked) against spokes (exact), and spokes taken; such a pattern is now `written` |
| The ID decodes; `JQx` is an edge of a body; the ranking can pick wrong; picks must be named inferred | 1 (S2), 2 (6), 3 (7) | Confirmed on the dump. The decode with its self-test is the filter; the ranking is gone; candidates at several places stay unresolved; every operand is reported; a line holds a point within its extent first; arcs, the fit per kind of constraint, the frames for `sketchMap` and the scope of an ID by studio are said. `JQx` is an `edge` entry (1 of 2 edges at one place) |
| The six constraints on Global Sketch 1 tie the mounting pattern to its variable | 1 (S4) | Confirmed. The helper copy is designed and measured; the recommendation of question 2 changed to yes |
| The rule of the entry: coincidences across instances, contacts among copies and with seeds, mixed tolerances, external pivots, mirrored lines, the seed of a mirror, points of images, a one-way rule 5 | 1 (S5), 2 (4, 5), 3 (5) | Rule 1 exempts only one instance with one seed point, and the MIRRORs of a mirrored line's ends; rule 2 covers seeds and other instances; rule 5 is two-way with kind and construction flag; rule 6 lets the engine judge; the pivot may be external; a mirror takes as its copy the curve nothing names. On this model no entry changes (measured); the 63 `shared` coincidences are all of one instance |
| The check: solver failures with nothing named, radii, the status, 1e-4 against 1e-6 | 2 (2), 3 (1), 1 (S6) | "What passes": status `ok` without warnings, radii, 1e-6. A solver failure of exactly that shape was then met in the spline trial (engine gap 7) |
| `split` answering `ok` is not a valid profile; nothing said for a failure after the cut | 2 (3), 1 (S6), 3 (6) | The cut is previewed and checked (`valid`, `ids.uncut`, contacts, Onshape's region count); the ladder says what follows |
| One Onshape constraint must be kept or dropped whole; numbers per constraint, not for the sketch; order dependence; a silent `mismatch` | 2 (8), 1 (S6) | Units; the number per unit; the limits of the order stated; the mismatch is `refused`. The step was then needed on the model (the helper copies) |
| `shared` assumed, the merge by rounded cells, welds without a constraint | 2 (1) | `shared` from identity (all 151 are one point); the weld by distance; welds counted: 76 of 157 places have no constraint, all at instance points |
| `twice` by a key that drops values and sorts operands; fates before the cut | 2 (9), 3 (12), 1 (M3, M1) | `constraintKey` with the value; one record per constraint, final after the last step; consumed by the cut is `shared` (20); the reason kept apart from the operand's category |
| Splines: unclamped knots, repeated knots, end points; `matchRegion` and `FIX` over several pieces; what the cap counts; `fixed` not timed; smoothness | 2 (10, 11, 14), 3 (3), 1 (M4) | Rule 1 validates; chains for regions and `FIX`; the budget is 193 control points over the sketch, all or none; `fixed` timed, which lowered the budget from 256 pieces and found engine gap 7; the smoothness is a known limit |
| Duplicate curves: the construction flag, direction, redirecting the ID | 2 (13), 3 (6) | "Exact duplicates first" |
| Two arcs mirrored by three `symmetric` are over-constrained; one lookup of positions for own and projected geometry; a point on the axis | 3 (2) | The surplus goes as implied (the model has no mirrored arcs, a fixture; its mirrored lines lose a `symmetric` the same way); one lookup over `solvedCurves`; the origin on an axis handled |
| An `edge` entry is not its points; a circular edge needs its axis along the normal | 3 (4) | "What an external ID is", rule 4 |
| Arcs: the cause table and "To verify" disagreed | 3 (8) | An arc gets the kind `arc` in point 4; the cause is empty before and after |
| `studio.ts` keeps one sketch per `importDerived` | 3 (11) | All are kept, by source studio and feature |
| HORIZONTAL of two points against a point and the origin; the dot product's sign; `*deg` and `*mm` | 3 (13, 14) | The origin form first; the absolute value; units as factors |
| The angle is ambiguous at 0, 90° and 180° | 1 (M1), 2 (7) | The flag `clockwise` decides between two fitting forms when the expression has a parameter; reported; the flags recorded. Not degraded to a number, as the second review would have it: the flag agrees with all six angles of the model |
| `summary.json` lacks what the acceptance compares; keys not unique; no comparator | 1 (M2), 2 (12), 3 (9) | The fields, studio-qualified keys, the fingerprint, the comparator. The files are not committed ("Rejected") |
| DISTANCE of two lines is one `distancePointLine` | 1 (M5) | Taken, measured (3 of 3), put to the owner with question 1 |
| Points of work: point 1 is not a light review; the check belongs before the cut; point 3 was three things; dependencies between points; "the count is wrong, not the text" | 1 (M6), 2 (15), 3 (10) | Eight points: the count (full review), the check, the cut, known operands, found operands, mirrors and patterns, splines, the close; what each is expected to leave lost; the run corrects the text |
| Tests on shapes nobody saw | 1 (M7), 2 (15) | Named "from knowledge", with a note at the first real use; the fixtures the second review lists are in "Tests" |
| Errors of the text | 1 (M8) | Global Sketch 3 has 13 degrees of freedom with entries alone; 335 bodies with the override; the four mirrors not nested are kept out by COINCIDENT (3) and HORIZONTAL (1); 3,145 or 3,146 control points; the 380 are the set of today's report; the tolerances of the contact tests named |

Not taken as proposed: the fate of a pattern that is no entry staying `lost` (it is `written` by spokes); an ambiguous angle degraded to a number; the summaries in the repository; the exact identity of external IDs brought into 6h (question 3).

## To verify in the implementation

Nothing stands in the way of the first point. What the trial did not cover, so the implementation measures it first on fixtures:

1. **Rule 5 of the entry** as a two-way match: the trial relied on the regions and the volumes, which agreed.
2. **A mirror with the second curve as its seed**: how many of the 11 mirrors become entries.
3. **The cut inside the test of a unit, and an entry dropped by rule 5 or 6**: no sketch of the model needs either.
4. **The weld by distance**: the trial kept the rounded cells; on this model the two agree.
5. **A vertex of a body, a linear and an open pattern, an arc with a constraint, a sketch on Front or Right or turned in its plane, a spline under the budget**: none in the model.
6. **The numbers of point 1** against "Before"; the run corrects the text if they differ.
7. **`sketchMap` for a source on another parallel plane**: every pair of the model is on one plane.
8. **The intermediate numbers of "Points of work"**: predicted from the causes, not each measured.
