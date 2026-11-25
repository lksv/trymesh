# 6h The Onshape converter on the tools of step 6

**State: designed, and reviewed in three rounds (three reviews of the first version `314188c`, two of the first revision `2f7eb2f`, two of the second revision `d4d51ee`, the last on its diff only; "Reviews"). This is the text after the third round, of 2026-11-25. It waits for the owner's answers to the three questions of "Open"; it goes ahead with the recommendations unless the owner says otherwise. Not implemented.** Written against `master` at `c01e765` (6a2, 6e, 6c, 6b and 6d merged). Every finding of the three rounds was checked on the downloaded model with a throwaway copy of `tools/onshape` outside the repository, and the numbers of "Measured" are those of the rules as they now stand. There is no `contract.ts` and no `calls.ts`: the point changes `tools/onshape` and `docs/onshape-import.md` only, no type, command, query or field of the engine, and it takes no decision number ([6-plan.md](../6-plan.md), "6h"; the owner's answers 4, 25 and 39 of [6-cross-review.md](../6-cross-review.md)). Its record is [onshape-import.md](../../onshape-import.md).

The converter gains heuristics over geometry (what an external operand is, when a pattern can be an entry, which constraint is implied), so every point gets a full review (CLAUDE.md, "Depth of the review"; "Points of work").

The point in short:

1. **Of the 287 constraints reported lost, 156 are not lost.** 155 are realised by one shared point (Onshape ties the ends of curves by coincident constraints; the converter makes them one point) and one is written twice. **131 of 380 are lost**, and the report says so from now on, by cause.
2. **The tools of step 6 recover 125 of the 131**, measured: 37 on curves the converter split (`split`), 31 on the origin, 13 on a default plane, 12 on an entity of another sketch and 1 on an edge of a body (entries `sketch` and `edge`), 19 patterns (10 as entries `pattern`, 9 by construction spokes), 5 mirrors about a line of the sketch, and 7 of the 9 constraints of a kind the converter did not map.
3. **6 stay lost**: 4 `FIX` of the disc's splines and 2 midpoints of two points. With the owner's "no" to question 2 of "Open" it is 12.
4. **The converted document is tried away from today's values, and what the conversion promised is asserted there.** Every parameter is walked two steps each way and back, every literal dimension and every count of an entry is changed, and at each state the probe checks that pattern instances are still their seeds turned and that the two copies of a derived sketch still agree. It is part of the report and of the acceptance. The baseline passes every status and leaves its patterns behind (in 6 of 40 walks the instances are no longer their seed turned); the first version broke at 3 changes of 48; this version breaks at no change of a parameter or of a dimension and fails no assertion. A count of a pattern cannot be changed in a converted document, and the probe says so where the status would not.
5. **A constraint is removed as implied only where a sketch is shown not to follow, only when it then follows better, and only if it is needed for that.** The first revision removed nine by rank and harmed a sketch; the second took its candidates from the solver's list, whose content follows the IDs of the constraints, and missed the cure. Now the candidates are the engine's diagnosis and a last pass puts back what was not needed: four constraints are removed in two sketches.
6. **With those four, Motor Shell 1 and 3 follow their parameter and all their literal dimensions**, which as Onshape wrote them they refuse. No change of a literal dimension breaks in the document (0 of 96; 14 before the removal). Which constraints go follows the numbering the converter gives them, so it is fixed (zero padded, in the order written) and named a known limit.
7. **The parts do not change**: all 16 volumes within 7e-6 mm³ of today's, the same regions in all 24 sketches, the same 4 of 10 chamfers. 21 of the 24 sketches come out fully determined (none today); the freedom of all sketches together drops from 771 to 10.
8. **What differs from the plan's outline**, each because of what the model holds: a mirror or a pattern is an entry only where nothing names or meets its copies (otherwise a mirror is written by `symmetric` and a pattern by spokes); the angle, "horizontal of two points" and the distance of two lines are mapped here; an external ID is decoded, not only searched by geometry; and the disc's splines convert correctly but cost 108 s a recompute, so splines have a cap and the disc keeps its generator.

## The brief, and what the measurements changed in it

The plan gives six steps: count by cause, crossing curves by `split`, patterns and mirrors as entries, external operands, splines, count again. The acceptance is the count before and after in `docs/onshape-import.md`, no sketch split with its constraints lost, and the part volumes unchanged. No target was set, because nobody knew how many of the 287 were step 6's.

What the count, the trials and the reviews settled:

- **The 287 was a miscount.** The converter's line "n of m constraints" counted the constraints it wrote. A coincident constraint of two points is never written: the two are one point of trymesh already. That is 151 of the 380. Four mirrors of a point that is an end of the mirror line are realised the same way, and one constraint was a duplicate. The 380 are the set today's report counts: the constraints of the 24 sketches the converter makes of the 8 part studios of the dump that have sketches (23 sketches; the two derived ones are converted in both studios that derive them, and the three of their source studio are not converted on their own).
- **An external operand is a bare deterministic ID** (`IB`, `JCC`, `JFE`), and `fetch.ts` dumps the geometry behind the queries of features, not of sketch constraints. **The ID is not opaque, though** (found by the first review): it holds the operation that made the entity, its kind and an index, and `fs.json` says which operations belong to which sketch ("External operands"). With it 12 of the 13 operands in other sketches are identified exactly, and the thirteenth turns out to be an edge of a body.
- **Onshape's pattern and mirror are constraints among own curves**: an instance is an entity like any other, with constraints of its own, cut by other curves, a seed of another pattern. A copy of 6c can be none of these. Of the 19 patterns, 9 have a copy that is constrained or crossed, and of the 13 mirrors of curves, 11.
- **A conversion that holds at today's values can break beside them.** Two sketches of the first version did: one by redundant constraints, one by a pattern left free; and one of the first revision did at the second step of a change. The check at today's positions cannot see any of them, so the document is also tried with changed values ("The probes").
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
| `twice` | Every constraint it would write says what one written for another Onshape constraint says (below). Its record names that constraint, and its final fate is read through it: if the one that was written ends `shared` by the cut, `implied` or `refused`, so does this one, with the detail "as …" |
| `implied` | Written, and then removed whole, because with it the sketch could not follow a change that it follows without it, and its relation still held at every state tried ("Implied constraints"). One on this model |
| `lost` | Nothing stands for it; it has a cause |

The headline number is `lost`. `written` counts Onshape constraints, not commands, so a sketch no longer reads "13 of 12".

- **`shared` is established, not assumed**: a coincidence of two points is `shared` only when the two are the same point of the written sketch; if they are not (they stand apart in the dump), a `coincident` is written and the check decides. Measured: all 151 are one point.
- **`twice` is by meaning, the engine's key is by structure.** `constraintKey` sorts the two operands of `angle`, `horizontalDistance` and `verticalDistance` (the catalog calls them unordered, since a swap only turns the sign), so it finds the constraint the sketch cannot hold twice, and does not say whether the two agree. The converter compares in a canonical form: the operands in the key's order and, for those three kinds, the value negated when that swapped them, **an angle then brought back into (−π, π]** (π stays π: `(A, B, π)` and `(B, A, π)` are the same antiparallel pair, and −π is outside the engine's range) and a negative zero made zero. Two constraints are compared **by their values at today's parameters**, not by the text of their expressions. Equal in that form is `twice`; when one of the two is a number and the other an expression, the expression is the one written. The same key with another canonical value is a contradiction the engine would refuse: the second is lost with the cause `refused` ("another value for the same operands"). So `(A, B, d)` and `(B, A, −d)` are `twice`, and `(A, B, d)` and `(B, A, d)` are not, unless `d` is zero.
- **`shared` says how the converter realised it, not that Onshape's relation is proven kept.** Where the one point is a weld without a constraint, see "Welded points".

### Causes

A lost constraint has one cause, and the record keeps two things apart: **what its operand is** (the category: the origin, a default plane, another sketch, an edge, a spline) and **why it is lost**. The cause is the reason; the category is a column of the detail, so a constraint on the origin that the check refuses reads `refused (on the origin)`, not `origin`. The reasons, the first of the list that applies:

| Cause | When |
|---|---|
| `refused` | Made, then dropped by the check (the reason and the engine's list of conflicting constraints with it), or with another value than a constraint of the same key |
| `pattern` | A sketch pattern that is neither an entry nor written by spokes (the detail says why) |
| `origin` | An external operand that is Onshape's origin, not mapped (the baseline only) |
| `plane` | An external operand that is a default plane and no axis of the sketch, a face of a plane feature, or not mapped |
| `sketch` | An external operand that the decode gives to another sketch (the detail: not found there, several fit, or the sketch is not in this document) |
| `edge` | An external operand that the decode gives to a body (the detail: no edge fits, or several) |
| `unknown` | An external operand whose ID does not decode, or whose operation belongs to no feature the rules name |
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

**Welded points.** The converter makes one point of points at one place whether or not a constraint ties them. Over the 23 sketches of the dump, 157 places hold more than one Onshape point; at 81 the points are tied by coincident or concentric constraints, at 76 they are not, and all 76 hold a point of a pattern or mirror instance (70 only such points, 6 an instance point and a point outside). No two plain entities are welded without a constraint.

- **A weld without a constraint is a relation the converter adds.** Onshape holds such points together only by today's geometry (the ends of neighbouring instances of a ring), and they need not stay together under an edit there. Without the weld the ring would not close into a region here. Every such weld is recorded in `summary.json` by its class (among the instances of one pattern or mirror; an instance and an entity outside; two plain entities) and the last two classes are listed one by one in the report: 6 and 0 on this model.
- **The merge** goes from rounded cells of 1e-4 mm (which can part two points 2e-7 apart and join two 9.8e-5 apart) to a distance of 1e-6 mm, in clusters: points are joined when a chain of steps of at most 1e-6 links them, and a cluster wider than 1e-6 is reported, since a distance is not transitive. On this model no two distinct places are nearer than 0.25 mm and no welded points differ by more than 1e-9.

### The report and `summary.json`

- **`tools/onshape/fates.ts`** (new): the types `Fate` and `Cause`, the record of a constraint and a `Tally` that the `Report` holds; a test asserts that the fates of a sketch add up to its constraints.
- **The line of a sketch** in `report.md`: `Sketch 2: 6 points, 4 curves; of 12 constraints 9 written, 2 shared, 1 lost; 5 degrees of freedom`, and under it one line per cause: `Sketch 2: lost: 1 MIDPOINT of two points (kind)`. The line "constraints without a counterpart: {…}" goes.
- **Sections at the end**: `## Sketch constraints` (the two tables above, as the run found them), `## External operands` (every operand with what it was decoded to, the candidates and the pick), `## Entries` (every pattern and mirror with the rule that kept it out), `## Expressions dropped` (every dimension written as a number, with why), `## Welds` (those without a constraint that reach outside a pattern), `## Redundant constraints` (what the solver still lists, per sketch, with the sketch's probe), `## Probe` (the document's probe: every change that is not plainly followed, with its verdict, and what drives nothing).
- **`summary.json`** beside `report.md` is what the acceptance compares. Every key is qualified by the studio (`Motor Shell/Sketch_1`; a derived copy by the feature that derives it), since `Sketch_1` exists in seven studios. It holds:
    - the run: the converter's commit, the fingerprint of the dump (a hash over its files), the override used, the settings;
    - the fates and causes, in total and per sketch; per constraint its record without the commands;
    - per sketch: status and warnings, freedom, the constraints the solver still lists as redundant and the number the engine's diagnosis counts (`diagnoseSketch`; the solver's list is partial), validity, the number of regions and Onshape's number, the areas of the regions sorted, the welds with and without a constraint, the step of the check that passed, the entries with the rule that failed, the operands with their candidates;
    - per part: its body and volume in full precision, and Onshape's;
    - per feature that can fail in part: fillets and chamfers with edges kept of edges asked, starts written as `from` or as a number;
    - the loaded document: whether it loads, the features in error, the number of bodies;
    - the sketch's probe of every sketch that had one (its changes, its breaks before and after, the removals tried, put back and kept, and for each kept one the number of states at which its relation was checked) and the document's probe (every change with all its verdicts, the assertions, what drives nothing). A removed constraint's record is keyed by the studio like everything else: `Sketch_1.c004` exists in seven studios.
- **A comparator**: `ONSHAPE_BASELINE=<summary.json>` makes `convert.test.ts` compare its summary with that file, by scope:
    - **strict**, the same keys and values on both sides: the parts (volume within 1e-3 mm³, none missing, none not finite), the features that can fail in part (a fillet or chamfer by **which** of the Onshape edges it asks for were converted, named by their place in Onshape's list and not by engine face names or the reason text, which change with the cut; the number alone would pass a part that kept the opposite edge. A start by `from` or number), the 24 sketches of the source by their Onshape feature (the number of regions, the sorted areas within 1e-6 mm²), the loaded document (it loads, the features in error, the number of bodies);
    - **allowed to grow**, each addition listed: helper copies, entries, parameters in use, the probe's cases;
    - **expected to change**, compared with the numbers the point of work predicts: fates and causes.
- **The fingerprint** of the run is a hash over a manifest of the raw input files of the dump (the files `fetch.ts` writes), not over the folder, which by default also holds the converter's output.
- The report prints volumes to 0.1 mm³, which is too coarse for "unchanged"; the rounded table of "Measured" is evidence, the baseline file is the reference.
- **The `summary.json` files of before and after are not committed.** They stay with the dump of the model, which is not in the repository (the owner, 2026-11-25, answer 39 of [6-cross-review.md](../6-cross-review.md)). The tables of `docs/onshape-import.md` are the record in the repository.

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
4. **Then the implied constraints**, where a sketch cannot follow ("Implied constraints"), and the fates are final.

**What the ladder does not promise.** One by one keeps a subset that depends on the order: of a group that conflicts, the one added last is the one called `refused`, and the subset is not the largest possible. Every constraint of Onshape holds at Onshape's positions, so a refusal means a wrong mapping or a wrong value, and the report gives the engine's list to find it.

**Cost.** A preview of a sketch of the model takes 1 to 60 ms. Measured: 24 previews when all sketches pass in step 1 (they do), 16 more for the two helper copies that needed step 2; the sketch's probe and its trial removals add 2,138 solves over seven sketches. The whole conversion takes 47 s (32 s without the probe).

On this model all 24 sketches pass step 1, before and after the cut. Step 2 ran on the two helper copies of "Open", question 2: their source studio's geometry has the housing circle at 72 mm where `HOUSING_DIAMETER` gives 70, so that one diameter is written as its number and noted. The cut inside the test and the dropped entry are tested on fixtures.

### Implied constraints

Four rules were tried in turn, each measured on the model.

- **The first version kept every constraint**, redundant ones too, because they were consistent. Motor Shell Sketch 1 (no freedom, four `symmetric` that the solver lists as redundant) then answered every change of `HOUSING_DIAMETER` with `sketchConflict`; nothing moved and the body kept its volume.
- **The first revision removed by rank**: every listed constraint whose removal gave the sketch no freedom back, nine on this model. The second round measured that rule: two removals cure the conflict above, seven cure nothing, and one harms (Input Shaft Sketch 2 conflicts at the second step of a change of `E` and does not come back). "No freedom back" says that the constraint is dependent at today's state, not that the sketch behaves the same without it.
- **The second revision judged by behaviour, with the solver's list as its candidates.** The third round measured that: the list is partial and follows the IDs of the constraints, so with the same constraints numbered in ten ways Motor Shell 1 came out in three ways (cured of its parameter; not cured, the acceptance failing; following everything with nothing removed); one of its two removals cured nothing; and the constraint whose removal cures everything was never on the list.
- **Now**: by behaviour, lazily, with the engine's diagnosis as the candidates and a last pass that puts back what was not needed.

**The IDs of constraints are an input of the solver.** The adapter hands the constraints to the solver in the string order of their IDs, and that order decides which of a dependent group the solver holds on to, what it lists as redundant, and whether a consistent redundant set follows a change at all. So the converter numbers its constraints **zero padded in the order written** (`Sketch_1.c000`, `c001`, …): the order the solver sees is then the order of writing and does not jump at 10 and at 100 (`c10` sorts before `c2`). That makes a run repeatable; it is not a cure ("What the rule does not do").

**The sketch's probe.** For a sketch in which the diagnosis (`diagnoseSketch().redundant`) lists a redundant constraint (and for one that holds a "distance of two lines", "Kinds taken along"), after the cut: every parameter the sketch reads, itself or through what its entries name, and every literal driving dimension of it (not the angles of spokes, not the zeros that stand for "horizontal"), is set to +3 %, to +6 % and back, then to −3 %, −6 % and back, each step executed on the document being built from the state before it, and all undone. A break is a step after which the sketch does not pass (status, conflict) or its profile has turned invalid, or a command that is refused, or, **in a sketch without freedom**, a return after which it is not the sketch it was (its points, the areas of its regions). A sketch with freedom that comes back elsewhere wanders (gap 8); that is a note, since a removal could otherwise be credited with curing a wander it only moved.

**The rule.**

1. If the probe has no break, nothing is removed. What is listed stays and is in the notes.
2. Else the candidates are the constraints the diagnosis lists as redundant that the converter wrote (not those the cut added), **and no driving dimension**: one that a parameter drives is the parameter's relation, and a literal one is itself a change of the probe, whose command would have no target once it is gone.
3. A candidate is removed on trial. The sketch must still pass and be valid. Its probe, with the list of changes taken before any removal, must have no break that the full set did not have, and not more breaks than before the trial. And every constraint removed so far, this one with them, must still hold at every state of the probe that solves: **put back on a preview there, it changes no point and no radius by more than 1e-6** (a radius is a variable of its own: `equalRadius` put back can change one and move nothing) and leaves the status `ok`. Of the candidates that pass, the one that leaves the fewest breaks is removed, the first written of equals; then the list is taken again. A step that leaves the breaks as they were is allowed, because some cures need two or three removals together.
4. The loop ends when the probe has no break, or no candidate passes.
5. **A last pass puts back**: every removal in turn is put back, and stays back when the probe is then no worse. What remains removed is needed for the cure.
6. The removals are kept only if the probe at the end has fewer breaks than at the start, and only if each of them was checked, in the last probe, at one changed state at least that solves (where every state conflicts the check of rule 3 never runs, and passing it is no evidence). Else all are undone.
7. What stays listed, every break that remains, and for each removal the number of states at which its relation was checked, is in the notes and in `summary.json`.

**A unit may lose part of its constraints here**, the one exception to "a unit is kept or dropped whole". The unit stays `written` and its record says how many were implied; only a unit that loses all is `implied`.

Measured, with the numbering above (2,138 solves, of changes and of constraints put back on a preview, and 57 trial removals over the seven sketches; the conversion takes 47 s, 32 s without the probe):

| Sketch | Listed by the diagnosis, by the solver | Changes of the probe | Breaks with the full set | Removed | Breaks after |
|---|---|---|---|---|---|
| Input Shaft 1 | 2, 1 | 4 | 0 | none | 0 |
| Input Shaft 2 | 5, 1 | 4 | 0 | none | 0 |
| Output Shaft 4 | 1, 1 | 4 | 0 | none | 0 |
| Output Shaft 5 | 1, 1 | 6 | 0 | none | 0 |
| Motor Shell 1 | 22, 4 | 8 | 8: `HOUSING_DIAMETER` and its three literal dimensions (58 mm, 45°, 30°), both ways, all `sketchConflict` | **1**: a `pointOnCurve`, the centre of a circle held on a mirrored line (Onshape's COINCIDENT of a line and a point), in 22 tries; put back, the 8 breaks return | **0** |
| Motor Shell 2 | 2, 1 | 18 | 2: two diameters at 6 % turn the profile invalid (circles that meet; geometry) | none (2 tries) | 2 |
| Motor Shell 3 | 12, 2 | 8 | 8: its four literal dimensions (12 mm, 45°, 36 and 58 mm), both ways, all `sketchConflict` | **3** `equalLength` of spokes of one pattern, in 33 tries, the breaks going 8, 6, 6, 0; each put back gives 6 again | **0** |

- **Four constraints are removed, and both sketches then follow their parameter and every one of their literal dimensions.** One Onshape constraint is `implied` as a whole (the COINCIDENT of Motor Shell 1); the pattern of Motor Shell 3 stays `written` by spokes with three of its `equalLength` implied, and its instances stay their seeds turned at every state of the document's probe. Each of the four was checked at 16 changed states in the last probe.
- **Neither cure was on the solver's list**: the solver lists four constraints in Motor Shell 1, and the one that cures is not among them (with the list as the candidates the best found was 6 breaks of 8); it lists two in Motor Shell 3, where three removals are needed.
- **What stays listed**: 13 by the solver after the removals (it lists more, with four constraints fewer in the document: 4 in each of the two cured sketches); the diagnosis's lists in full in the notes. In Input Shaft 1 and 2, Output Shaft 4 and 5 and Motor Shell 2 nothing breaks that a removal could cure.

The other rules, as measured (the first four rows and the last by the designer's trials, the others by the reviews):

| Rule | Result |
|---|---|
| Keep everything | Motor Shell 1 conflicts at every change of `HOUSING_DIAMETER` |
| Skip a constraint when the solver lists any redundant one right after it is added | 18 units dropped, and the sketches gain 13 degrees of freedom |
| Skip a constraint that takes no freedom away when added | 9 dropped, 8 still listed, one degree of freedom more |
| Remove listed ones before the cut | 25 dropped, among them points held on curves that the cut needs; 74 s |
| Remove by rank after the cut (the first revision) | 9 removed; Motor Shell 1 follows its parameter; Input Shaft 2 breaks at the second step of `E` and stays broken |
| The set the engine's diagnosis calls removable at once (`diagnoseSketch().removable`) | 25 removed; Motor Shell 1 still conflicts; Input Shaft 2 has an invalid profile and three extrusions in error at `E` − 3 % |
| By behaviour, candidates from the solver's list, kept when the end has fewer breaks (the second revision) | 2 `symmetric` removed in Motor Shell 1, of which one cures nothing; its parameter follows, its three dimensions and Motor Shell 3's four do not (14 breaks of 96 in the document). Under ten numberings of the same constraints: this result in 4, no cure and the parameter not followed in 3, nothing to cure in 3 |
| **By behaviour, candidates from the diagnosis, a last pass that puts back** | **4 removed, each needed; both sketches follow everything; 0 breaks of 96** |

**What the rule does not do.**

- **It does not make the result independent of the numbering.** With the diagnosis's candidates and the same constraints numbered otherwise (the third round: reversed, and one shuffle), Motor Shell 1 is cured as well, by two other removals, and Motor Shell 3 keeps 6 of its 8 breaks. The padded numbering in written order is what this design fixes and what its numbers are of; an implementation whose constraints come in another order measures its own.
- **When no candidate cures**, the sketch stays as written and the report names it, the changes it cannot follow and the candidates tried. If one of those changes is of a parameter, Acceptance 5 fails on it; there is no further move in 6h.
- It finds what the probe can see: 3 % and 6 % of one value at a time. The two relations the second revision removed were checked by the third round at 234 wider states (every parameter from half to one and a half of its value) and held at all; the four of this version were checked at the probe's states only.
- A sketch in which the diagnosis lists nothing is not probed here; the document's probe is what tries it.
- **The cost grows with the product of changes, candidates and rounds**: 1,192 solves for Motor Shell 3 here, some 3,500 on the worst numbering the third round tried.

### The probes

The check holds a sketch to Onshape's positions at today's values. Whether the document still works beside them is asked by changing it. There are two probes over one piece of code (`probe.ts`): the sketch's, inside the converter, which decides the removal above; and the document's, after the conversion, which is part of the report and of the acceptance.

**The document's probe.** `convert.test.ts` loads every stored studio document that has a sketch, alone, and makes three kinds of change, each from the loaded state and each undone:

| Change | Steps |
|---|---|
| Every parameter that an expression of the document names and whose own expression is a number | +3 %, +6 %, back; −3 %, −6 %, back (a whole number read as a count, of an entry, a pattern or a generator: ±1, ±2, a step under 1 left out; a zero: ±0.1, ±0.2) |
| Every literal driving dimension of a sketch (a number, or an expression without a parameter; not the angles of spokes, not the zeros that stand for "horizontal") | +3 % and back; −3 % and back. The value stays in the field's range: a zero that is a real dimension takes an absolute step (0.1 mm, 1°), an angle of π only goes down, and a direction the range does not allow is recorded as not available, not as followed |
| The count of every circular entry | +1; −1 |

**The verdicts of a state.** Every one that applies is recorded; the order below is only the order in which a line of the report names them, and none excuses another (a state whose later feature fails in the kernel and whose other feature loses its region has both, and fails by the second):

| Verdict | When | Whose it is |
|---|---|---|
| refused | the engine refuses the change itself | the probe's or the document's; never a pass |
| cannot follow | a sketch's status leaves `ok` or its `conflicting` list fills. With no constraint named in a sketch that was cut, the report adds that the pieces of the cut may no longer exist ("Known limits") | the conversion's, a redundant set's (gap 6) or the cut's (gap 9) |
| invalid profile | a sketch's profile turns invalid | geometry (curves that newly meet), or a pattern left free |
| reference | a later feature loses what it names (`noProfile`, `brokenReference`), or the number of bodies changes | the way regions are named |
| other | a later feature fails with any other code but the kernel's (the code is given) | to be read case by case |
| fails in part | a later feature that was whole goes to a warning: a chamfer that keeps fewer edges, a start that no longer finds its face | to be read case by case |
| an assertion fails | below | the conversion's |
| not back | after the return the document is not the loaded one: any of the above, a volume or a number of regions that differs | a sketch with freedom, or a solver that does not return (gap 8) |
| kernel | a later feature fails in the kernel | the kernel's; named apart |
| drives nothing | none of the above, and no volume and no solved point outside a helper copy differs | listed, not a break |

**The assertions.** "No break" is not "right": the patterns held only by equal sizes passed every status while their instances stood 0.87 mm apart. So at every state that solves, the probe checks on the solved geometry what the conversion promised and did not write as one constraint of the engine:

- **every instance point of an Onshape pattern is its seed point turned by k steps about the pivot** (1e-6), in the sense the converter read off the positions. The rows of seed and instance points are taken from Onshape's pattern constraint, whatever became of the pattern (spokes, lost; the copies of an entry are that by construction), so the assertion can be run on the baseline, where every pattern is lost;
- the two lines of every "distance of two lines" are parallel;
- every constraint removed as implied still holds (put back on a preview, no point and no radius changes), in the studio it was removed in;
- **the copies of one derived sketch in two studios are the same, point for point and radius for radius**, after the same change of a parameter, so the holes of two mating parts still mate. The report says in how many of the compared pairs the copy moved at all;
- **after a change of a count, every region that a copy of the entry bounds is named by a feature**, as the regions of its siblings are. Without it a count raised by one reads as followed while the new instance is in no extrusion.

A constraint that is written is held by the solver wherever the status is `ok`; it needs no assertion.

Measured:

| Document | Parameters: walks, breaks | Dimensions: changes, breaks | Counts up, down: breaks |
|---|---|---|---|
| The baseline | 40, 0 by any verdict; **6 fail the assertion of the patterns**: at `Phi_R` ± 3 % the pockets of Housing 1 stand 0.87 mm off their seed turned, at `M3_NUT_SIZE` the hexagon of Global Sketch 3 0.08 mm, in both studios | 62, 0 by any verdict; 8 fail that assertion (the hexagons of Input Shaft 4 and Motor Shaft 2, a pattern of Motor Shell 2) | no entries |
| The first revision (removal by rank), by the second round's walks of 1 % | 54, 4: Input Shaft 2 with `E` both ways, not back; two failures of the kernel | 96, 14 | as this version; the 8 upwards without an error were then read as followed |
| The second revision (candidates from the solver's list) | 56, 0 | 96, 14: all 6 of Motor Shell 1 and all 8 of Motor Shell 3, `sketchConflict` | the same |
| **This version** | **56, 0** | **96, 0** | 10 of 10 (8 a reference: the new copy bounds a region that no feature names; 2 an invalid profile), 10 of 10 (9 a reference, 1 an invalid profile) |
| This version without the helper copies | 48, 2: `M3_NUT_SIZE` in Motor Shell is not back (the volume off by up to 0.3 mm³): the copy of Global Sketch 3 has freedom there and wanders | | |

- **The baseline passes every status and is wrong beside today's values**: its patterns are lost, so their instances stay where they were when the seed moves. That is the answer to "the baseline survives all its changes": by status, yes. (The third round ran the baseline's walks to the end and confirmed both numbers.)
- **No assertion on a parameter or a dimension fails** in this version: the nine patterns by spokes stay their seeds turned, also the one of Motor Shell 3 that lost three `equalLength`; the three pairs of lines stay parallel; the four removed constraints hold at every state where their sketch is in the document (232 checks); and the copies of Global Sketch 2 and 3 in Housing and Motor Shell are the same at every step (56 pairs of a change and a sketch, in 24 of which the copy moved or changed a radius; the largest difference 0 mm).
- **Counts: no change of a count is followed.** No parameter of the model is a count (the 19 patterns have `2`, `4`, `6`, `12`, `16` as numbers), so the entries are changed directly. Downwards the extrusions over the copies lose a named region in 9 of 10 and one profile turns invalid (Motor Shell 2 from 4 to 3). Upwards two profiles turn invalid (Motor Shaft 3 from 2 to 3, Motor Shell 2 from 4 to 5), and in the other eight nothing is in error and the new copy is in no feature: the earlier revisions counted those eight as followed.
- **Several verdicts at one state** occur 5 times, all at counts (an invalid profile with the extrusions over it; lost regions with a lost body).
- **Drives nothing**: `M3_INSERT_SIZE` in Housing; `OUTPUT_MOUNTING_PATTERN` in Housing and in Motor Shell, where only a circle of the helper copy reads it; the helper copies' 72 mm; one 12 mm diameter of Motor Shaft 3. A list of the parameters a studio names is therefore not a list of what drives it, and the report gives the second.
- **The second round's walks of 1 % to ± 5 % and back** were run on the second revision by the designer and on Motor Shell of this rule by the third round: the two failures of the kernel (Chamfer 1 of Housing at `HOUSING_DIAMETER` − 1 %, Extrude 8 of Motor Shell at − 4 %; gap 11) and no other break, every walk back at its start. The standing probe's steps of 3 % and 6 % do not hit the two, and they are not the conversion's to fix.
- **Cost**: about 6 minutes for the document on a machine busy with other sessions (the parameters 150 s, the dimensions and counts 190 s); the first revision's single jumps took 35 s. It is a step of the acceptance, run with the dump, not of the root tests.

**What it cannot show.** Two steps of 3 % of one value at a time: a sense that is wrong only after a design flips, a value far away, two parameters together (the second round tried all pairs at 10 % and found no break that needs two). A failure that lies between the steps: the kernel failures above. And whether Onshape itself would follow: an over-determined sketch of Onshape's may conflict there too.

## Crossing curves

`splitAtCrossings` and its tests go. The sketch is written whole (its points, its curves uncut, its entries, its constraints) and executed; then

```ts
sketchTool('split', { sketch, result, parameters, document, features }, {}, freshIds(document, `${id}.cut.`))
```

is called once. The tool cuts every contact of two outline curves, joins ends at one place, moves each constraint to the piece that carries it and turns a point held on a curve at a cut into the shared point (D65). `Converted.kind` keeps every curve, so no constraint is dropped for naming one.

- **Its batch is previewed and checked before it is executed** ("What passes"). The tool answering `ok` is not enough: without a curve named it refuses only when it has nothing to do for an invalid profile; it can cut what it can and return a batch that leaves the profile invalid, with the rest in `ids.uncut` (a review's probe: a crossing circle and two partly overlapping lines give `ok`, 15 commands and an invalid profile).
- **It runs on solved positions**, not on Onshape's; that is why the check before it holds the points to 1e-6.
- **Exact duplicates first.** Two curves of the same kind over the same points with the same construction flag (a circle: the same centre point and radius within 1e-6) are written once. The converter's map from an Onshape entity to its curve (`rep`, not only the kind) points the second at the first, with its direction: a line drawn from `b` to `a` over one drawn from `a` to `b` is kept as "the same line, reversed", which the angle reads. A construction line and an outline line at one place are both kept. A partial overlap is no longer repaired ("Known limits").
- **A constraint the cut removes** is in `ids.removed` for one of four reasons, and its fate follows the reason, which the converter reads off the sketch after the cut: the point it held on a curve became the shared point of the pieces (`shared`; all 20 of this model); it would repeat one the sketch has (`twice`); it went with a curve the tool removed, or would name one curve twice (lost, cause `refused`, "removed by the cut").
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

- **A mirror of two curves is written by the symmetry of their points**: `symmetric` for each pair of points (the ends of two lines paired by reflecting the positions; the centres of two circles, with `equalRadius`; the centre and the swapped ends of two arcs). A pair that is one point is on the mirror line: nothing when it is an end of that line or the origin on an axis, else `pointOnCurve` with it. Both curves stay own, so they can be constrained and cut. The fate is `written`. Three `symmetric` of two arcs hold one scalar condition twice (an arc's ends are at one distance from its centre already). That surplus is one equation of six, not a whole `symmetric`: a review's probe has 5 degrees of freedom with the three and 6 with any one removed, and the solver lists nothing as redundant there. So the three are written and nothing promises that one goes; the fixture changes a parameter under the mirrored arcs and asks that the sketch follows. The model has no mirrored arcs.
- **A circular pattern is written by spokes.** For every point Onshape lists in an instance (the ends and centres of its curves), a construction line from the pivot to it. The spoke of each image point has `equalLength` with the spoke of the seed point, and an `angle` of 2π/n to the spoke of the instance before; an image circle has `equalRadius` with its seed. The image points are then the seed points turned, whatever the seed does, and the instances stay own curves that can be constrained and cut. The fate is `written`, with the detail "by spokes".
    - **The angles tie the spokes as a tree, never as a ring**: two spokes already tied through angles get no further one. A hexagon's spokes close a ring, and the sixth angle is a redundant constraint that made Global Sketch 3 conflict at every change of a parameter (measured).
    - **The sense of the turn** is read from the positions the converter wrote, in its frame (the sign of the cross product of the seed's and the first image's spoke), so a sketch seen from the other side is right without a rule of its own. **A count of 2** is a turn of π, the edge of the range (−π, π], where that cross product is zero: `pi` is written.
    - **The pivot.** A curve of the sketch may end only on an own point or `origin`. A pivot that is a projected point gets one own point, tied to it by `coincident`, and the spokes start there. A point of an instance that is the pivot itself (the centre of an arc about it) is the same point in every instance and gets no spoke.
    - **The count is a number, and the pattern cannot be counted again.** `2 * pi / 6` is written. When `patternc1` holds a parameter, its value of today is written and the report says that the pattern no longer follows it; a changed count needs another number of instances, which own curves do not get, by a parameter or by hand. No pattern of the model has a parameter as its count (the 19 are `2`, `4`, `6`, `12`, `16`), so that branch is from knowledge.
    - **The rows of points.** Onshape lists the points of an instance as rows of their own (all 9 on this model). A curve whose points are not listed gets them in the order start, end, centre, checked by turning the seed's; a point that does not land is the pattern lost with the cause `pattern`.
- **The count of an entry cannot be changed in a converted document, in either direction, as the converter writes extrusions.** `count` holds the expression of `patternc1`, and the sketch follows it: the copies are spaced again. But an extrusion over a patterned sketch names the region of every copy one by one (`matchRegion`, by Onshape's faces). One copy fewer leaves a named region without its copy, which the engine makes a broken reference (D68). One copy more is worse, because nothing reports it: no feature names the new copy (0 of the 26 features over the 10 sketches of circular entries, measured by the third round), so the part gets twelve holes of thirteen, re-spaced, and every status is `ok`. The probe asserts the naming ("The probes"); naming regions by rule and not by copy is engine gap 10 and not in 6h.
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

**The ID decodes** (read off this dump by the first review; Onshape does not document it). After the first character, the second is the operation that made the entity, and the rest is a number in base 64, least significant digit first, whose low two bits are the kind (0 a vertex, 1 an edge, 2 a face, 3 a body) and the rest an index. `fs.json` lists the bodies and faces every feature created (`created`), so the operations of every feature are known. Over the 8 studios 939 bodies, 957 faces and 746 edges decode to their kind without exception, and each of the 53 operations that hold bodies of a sketch belongs to one sketch.

- **What an operation is, is decided by the type of the feature that owns it**, not by "a sketch or else a body" (the second round of review: an `importDerived` owns operations too, two per sketch it brings, and an own sketch held on a derived one would have been searched among the edges of bodies):

    | The operation belongs to | The operand is |
    |---|---|
    | a `newSketch` | an entity of the trymesh sketch made from it |
    | an `importDerived` that brings sketches | an entity of one of the copies made from it (candidates over all of them) |
    | a feature that makes or changes solids | an edge or a vertex of a body |
    | anything else (a plane, a mate connector, a curve, a feature type the converter does not list), or no feature of `created` | nothing the converter knows: `plane` for a face of a plane feature, else `unknown` |

    "Makes or changes solids" is a list of feature types in the converter (those it converts, today `extrude`, `fillet` and `chamfer`), not "everything else". **An operation can be listed under several features**: of the 113 operations of this dump 29 are, all of them solids (`JQx`'s operation `Q` under Extrude 3, Extrude 4 and Chamfer 1 of Motor Shaft, and not under Extrude 1, whose rim the point lies on). `created` is taken at the end of the studio, so for a solid the operation in an ID seems to be the last one that touched the entity, and the lists say which features still carry it (read off this dump by the third round, not checked further). The rule: an operation with several owners is decided when all of them are of one row of the table, else it is `unknown`; none mixes rows here. An operation none of whose faces or bodies lasts to the end of the studio is in no list and is `unknown`.
- **Judged per ID, with no search without it.** An ID whose operation `created` does not know, or whose kind is a face or a body where an edge or a vertex is asked, is lost with the cause `unknown`. There is no fallback "by geometry over all kinds": that is the ranking the first round rejected, where a point and a curve through it cannot be told apart.
- **A self-test at the start of every studio**: every ID of `created` must decode to the kind it is listed under. It tests the kind bits for a face and a body only (`created` lists no vertex and no edge) and says nothing of the operation; a studio that fails it gets no operand resolved by the decode, and the report says so.
- **The limit of what was read**: the operation is one base-64 digit. The largest studios of the model use 50 and 49 of the 64 values (every sketch takes two); nothing in the dump shows how the 65th is written, and a studio of some 25 features has it. Such an ID is `unknown` by the rule above, and it is the trigger of "Open", question 3.
- **The decode is a filter and a cross-check, not a lookup.** The kind restricts the candidates (a vertex is a point, an edge a curve) and the operation says where they are. The index is only a hint (it is the k-th curve of the feature for the three edges of this model and not simply the order of the points), so the entity itself is still found by geometry among those candidates.

What the IDs are:

1. **`IB` is the origin** (vertex 0 of operation B), and becomes `origin`.
2. **`JCC`, `JDC`, `JEC` are the Front, Top and Right planes** (face 0 of the operations C, D, E, the three before the first feature, F). A default plane is a line in the sketch when it is perpendicular to the sketch plane: with the plane's normal `n` and the base of the sketch, `origin/x` when `n` is along the base's Y and `origin/y` when it is along the base's X; a plane parallel to the sketch is no operand. Every sketch of trymesh the converter makes stands on a base plane or a plane feature offset from one, so its origin is the world's origin cast onto it and both lines pass through it.

    | Sketch on | Front (XZ) | Top (XY) | Right (YZ) |
    |---|---|---|---|
    | XY | `origin/x` | none | `origin/y` |
    | XZ | none | `origin/x` | `origin/y` |
    | YZ | `origin/y` | `origin/x` | none |

    The three IDs are from knowledge of Onshape, supported by the decode. On this model `JDC` is Top by the dump (the plane of all 24 sketches, normal (0, 0, 1) through the origin); `JEC` and `JCC` are confirmed by the geometry: every mirror about `JEC` reflects across x = 0 and about `JCC` across y = 0, and every angle to `JCC` is its value measured from +X. A use that contradicts the mapping (a mirror that does not reflect across the axis) is refused by its unit and reported.
3. **An ID of a sketch's operation** is an entity of the trymesh sketch made from that Onshape sketch, and an ID of an `importDerived`'s operation an entity of one of its copies (an ID lives in the studio that holds the constraint's own feature, so the IDs of a derived sketch are read in its source studio). Candidates are its own points and curves and the copies of its entries, of the decoded kind, mapped into the sketch by `sketchMap` with the frames of the two trymesh planes:
    - a vertex: a point at the place of every local operand that is coincident with it (1e-6);
    - an edge: a curve that fits every use. A point held on it lies on it, **within its extent** when any candidate holds it so; a circle or an arc equal to it has its radius (an arc cut from a circle counts, with the kind `arc`); a line parallel, perpendicular or at an angle to it is a line in the direction the constraint's value gives.
4. **An ID of an operation of a feature that makes or changes solids** is an edge or a vertex of a body: the bodies of the state before the sketch, the query `body`. A circular edge counts only with its axis along the sketch's normal (1e-4 rad), since otherwise it is no circle in the sketch; a straight edge perpendicular to the sketch is a point and no candidate. The entry is `{ type: 'edge', body, edge, kind: 'line' | 'circle' }` (D23); a point of it is the entry's own derived point (`<entry>/a`, `<entry>/b`, `<entry>/center`), the end taken by position on the previewed entry.
5. **The pick.** One candidate is the answer. Several candidates are an answer only when they are **the same by construction**, which is one of two narrow cases:
    - points or curves of one sketch that the converter wrote as one entity (welded points, exact duplicates);
    - **whole circular edges on one side face of one extrusion along the sketch's normal, without taper**, under a constraint that uses the edge as a curve (a point on it, a circle equal to it): seen along the normal each is the full circle the face was extruded from. Straight edges and arcs of one side face are not the same by this: their extent and their ends come from the other face of each edge.

    The first by the timeline is entered, and it is one reference, not both: the entry names that edge by its two faces, and an edit that removes its cap breaks the entry while the other rim lives. The operand's record says so and names the other candidate.

    Anything else is not chosen among, also when the candidates are at one place today (one place is a distance of 1e-6, not equal text): the operand stays unresolved and its constraint is lost with the cause `sketch` or `edge` and the candidates in the detail. Two edges that only project onto each other now can part after an edit, and the first by the timeline would be an arbitrary dependency. Every operand is in the report and in `summary.json` with what it decoded to, the candidates and the pick; a pick is **inferred** from geometry within what the decode allows, and is named so.

The entry of a sketch entity:

```ts
{ type: 'addExternal', sketch, id: `${sketch}.ref${n}`, ref: { type: 'sketch', sketch: source, entity, kind } }
```

One per entity of the source, reused by every constraint of the sketch that names it. Own points are never merged with a projected point: the point of the sketch stays own and is tied by the constraint (6b, "The Onshape converter"). The converter reads positions of own, origin and projected geometry through one lookup over the previewed sketch (`solvedCurves`), not over its own table of own points.

### Derived sketches and the skeleton

A derived sketch (`importDerived`) is a copy, as today, and its constraints are converted like any sketch's. `studio.ts` keeps **all** the sketches one `importDerived` brings (today a map by the feature's ID keeps the last one only), by source studio and source feature.

The constraints of the model's two derived sketches name `JFE` and `JFJ`, which decode to Sketch 1 of their source studio: the end of its construction line at (32, 0) and that line. Neither studio derives that sketch. It is **the skeleton of the document**: four construction curves whose diameters are `#HOUSING_DIAMETER`, `#HOUSING_MOUNTPATTERN` and `#OUTPUT_MOUNTING_PATTERN`. The six constraints hold the seed of the 12 mounting holes (Global Sketch 2) and of the 12 nut pockets (Global Sketch 3) on the mount pattern circle. Without them `HOUSING_MOUNTPATTERN` is used by no converted studio, and the holes of two mating parts hang free.

**A helper copy** closes it: when a derived sketch names an entity of a sketch of its source studio that this studio does not derive, that sketch is copied too, before the derived one, as a sketch of construction use (`Global Sketch 2 (Global Sketch: Sketch 1, a helper)`), and the operands are found in it. The decode says exactly which sketch. It is the recommendation of "Open", question 2, which is the owner's.

- **One per destination studio and source sketch**: the copy is kept by (destination studio, source studio, source feature) and reused by every derived sketch of the studio that needs it; its record keeps where it came from.
- **One level only.** A helper copy's own constraints on a further sketch that is not in the studio are lost with the cause `sketch`; there is no closure over dependencies.
- **Counted apart**: its constraints are in a row of their own, outside the 380, so "before" and "after" stay the same set.
- **A parameter that only a helper copy reads is not "in use"** by the part; the probe lists it as driving nothing ("The probes").
- **An expression the dump contradicts.** One diameter of the helper is written as a number: the dump's geometry has the circle at 72 mm under `DIAMETER = #HOUSING_DIAMETER`, and the variable is 70 (no variable feature in that studio). The same in a sketch of a part would turn an expression into a number with one line among hundreds, so the report has a section of its own, `## Expressions dropped`, for every dimension written as a number because the geometry does not have the expression's value.

Measured with the helper copies: one sketch of 4 curves and 9 constraints in each of the two studios (6 written, 3 shared; one diameter as a number); the 6 lost constraints are written; `HOUSING_MOUNTPATTERN` comes into use in Housing and Motor Shell and moves the holes with no conflict at ± 3 % and ± 6 % (the volume of Housing goes from 33562.6 to 33652.9 and 33614.5 at ± 3 %, of Motor Shell from 22516.8 to 22576.2 and 22559.4); **the copies of Global Sketch 2 and 3 in the two studios stay point for point the same** at every one of the probe's changes (56 pairs of a change and a sketch compared, the largest difference 0 mm), which is what makes the holes of the two parts mate; the two copies have no freedom left (2 and 3 without). `OUTPUT_MOUNTING_PATTERN` is read in the two studios by a circle of the helper only and drives nothing there.

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

- **The origin**: 31 of 31 made (22 `coincident`, 8 `pointOnCurve` with `origin/x`, 1 `horizontalDistance` with the expression `E`).
- **The default planes**: 13 of 13 (5 angles, 6 mirrors by `symmetric`, 2 mirrors as entries).
- **Another sketch and an edge**, by the decode:

    | ID | Use | Decoded | Candidates of that kind there | Pick |
    |---|---|---|---|---|
    | `JFB` | Housing 2, EQUAL, r 35 | an edge of Sketch 1 | 1 | its circle of r 35 |
    | `JFF` | Output Shaft 3, EQUAL, r 22.5 | an edge of Sketch 1 | 1 | its circle of r 22.5 |
    | `IF`, `JFE` | Input Shaft 2, points at (±1.25, 0) | vertices of Sketch 1 | 1 each | the two centres |
    | `JKM` | Output Shaft 4 and 5, a point at (17, 0) | a vertex of Sketch 2 | 1 | the centre of its fourth circle |
    | `JQx` | Motor Shaft 3, a point at (3, 5.196) | an edge of a body (operation Q) | 6 edges at 3 places; within their extent 2, both on one side face of Extrude 1 | the rim of radius 6 of Extrude 1, as an `edge` entry |
    | `JFE`, `JFJ` | Global Sketch 2 and 3, in two studios | a vertex and an edge of Sketch 1 of the source studio | 1 each in the helper copy; without it the sketch is not in the document | the end of the construction line, and the line |

    With the kind and the sketch known, no operand in a sketch has more than one candidate. The first version searched all earlier sketches and picked `JKM` 1 of 2 and `JQx` 1 of 3; its picks for the sketch operands were the right entities, and for `JQx` the circle of Sketch 1 under the edge, a sketch entity where Onshape names the body. `JQx` fits four more edges only as endless lines (the point is beyond the ends of two hexagon sides); the two circular edges are whole circles on one side face, the one Extrude 1 made of that circle of Sketch 1, so they are the same by construction; the one entered is the rim at the start cap of Extrude 1.
- **All 13 are written** (7 without the helper copies).

## Kinds taken along

Three kinds the plan left to the backlog are mapped, because the external operands need the first and the others cost a line each ("Open", question 1):

- **ANGLE of two lines.** trymesh measures from the direction of `a` to the direction of `b`, counter-clockwise, in (−π, π]; Onshape gives an unsigned value and the flags `clockwise`, `aligned` and `flipped`. The angle is measured on the positions the converter wrote, in its own frame (so a sketch seen from the other side, `frame.sign`, and a line that is a reversed duplicate are already in the measured sign), and of the forms `e`, `-(e)`, `pi - (e)`, `(e) - pi` of the Onshape expression `e` those whose value (`expressionValue` over the parameters of the document) equals the measured angle within 1e-6 fit.
    - **One fits**: it is written.
    - **Two fit** (at 0, ± π/2 and π: `e` and `pi - (e)` agree at 90° and part as soon as the value changes). If `e` names no parameter, both are the same number for good and the first is written. **Else the measured number is written**, the expression is listed under `## Expressions dropped` with the two forms, and the record says "ambiguous". The first revision chose by the flag `clockwise`; the second round showed that the six angles of the model cannot support it: none of them is at an ambiguous value, `clockwise` and `flipped` are confounded in them ((true, true, false) for the one that needs `-(e)`, `clockwise` false and `flipped` true for the other five), and a flag of Onshape's frame would have to be turned with the frame's handedness.
    - **None fits**: the measured number, with a note.
    - `summary.json` records the three flags, the frame's sign and the form of every angle, so a second model can give the rule that this one cannot.
    - Measured: all 6 angles written with their expression (5 as `e`, 1 as `-(e)`), at 30°, 45° and 60°.
- **HORIZONTAL or VERTICAL of two points**: `verticalDistance` (or `horizontalDistance`) of 0 between them, a driving dimension. Measured: 3 of 3. It reads as a dimension of 0 in the app; a constraint of its own is a backlog row.
- **DISTANCE of two lines**: `distancePointLine` of the start of the first line to the second, written when the two lines are parallel in the geometry (1e-9), else lost with the cause `kind`. Onshape's distance of two lines also keeps them parallel, and one `distancePointLine` does not. Whether they stay parallel is asked of the sketch, not assumed, and it is asked inside the converter, where something can still be done about it: the sketch's probe ("Implied constraints") also runs for a sketch that holds such a pair, with "the pair is no longer parallel" as a break; a pair that parts gets `parallel` in the same unit and the probe runs again. The document's probe asserts it once more afterwards. Measured: 3 of 3 (the hexagons across flats, driving dimensions) written as the one constraint; the pairs stay parallel at every change, held by the spokes of their pattern, and the hexagons follow the distance.

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
5. **The budget: 193 control points of splines in one sketch**, counted as the points that would be written, after the decomposition into pieces, over all its splines and before any is written (64 cubic pieces, or three uniform splines of 64 points). It is a guard measured on sketches of splines alone, not a bound on the time of a sketch that also holds much else. Over it, none of the sketch's splines is written (a region bounded by half its splines is of no use), and each is listed with what it needs and what there is. Measured on the disc's two visible splines:

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
7. **A region bounded by a spline** is matched by the chain, not by a piece: an Onshape edge of the kind `other` matches a run of loop curves that is the whole chain of one spline, in either direction, when the chain's two ends are the edge's and the edge's middle lies within 1e-3 mm of the chain. The chain is sampled by the converter for this, each Bezier piece halved until its chord error is under 1e-4 mm: the engine's polyline of a spline is made to the document's chord tolerance of 0.01 mm (a review's probe: the middle of an exact cubic 0.0062 mm off its polyline), which is coarser than the match. `matchRegion` skips `other` edges today and tests every loop curve alone; both change.
8. **`FIX` of a spline** is one unit: `fixed` on every control point of its chain, each once.

No spline of the model is under the budget, so rules 1 to 4, 7 and 8 are tested on fixtures only.

## The order within a sketch

1. Read the entities: points welded by distance, lines, circles, arcs, splines; exact duplicates redirected.
2. Decide the entries by rules 1 to 4; their images are not made.
3. Make the units: resolve external operands (which adds reference entries), map each Onshape constraint, start its record.
4. The ladder of "The check": all units, or one by one.
5. Execute; preview the cut and check it, with rules 5 and 6 of the entries; execute the cut.
6. Where the solver lists a redundant constraint: the sketch's probe, and the removal of what it shows to be implied.
7. Close the records: fates, causes, what the cut removed.

## Regions and the features over a sketch

- **`matchRegion` reads `solvedCurves(sketch, result)`** in place of `document.curves`: a curve of the outer loop may be a copy (`Sketch_2.pattern0/3/Sketch_2.abc`), which the document does not hold. Spokes are construction lines and are in no loop.
- **The names of side faces** change where a curve is now a copy or a piece of the tool. Nothing in a converted document names a face but through the lookups by geometry (`trymeshFace`, the edges of chamfers), which read the body.
- **The override of the disc** needs no change (measured).

## Measured (2026-11-25)

The model: the dump of the cycloidal actuator 5010 of 2026-11-25 (the assembly, the 8 part studios that have sketches with their dumps, 66 parts of other documents as STL). The baseline: the converter at `c01e765`, 31 s. The trial: a copy of the converter with every step of this design but the splines, rule 5 of the entry, the choice of a mirror's seed, the cut inside the test of a unit, the weld by distance, the canonical form of `twice`, the decode by the type of the owning feature and the pivot's own point (none of which this model exercises); 47 s, and about 6 minutes for the document's probe. "Now" is with the helper copies of question 2; where a second number stands in brackets or in a last column, it is without them.

**Fates** (380 constraints, 24 sketches):

| Fate | Before | The first version | The first revision | The second revision | Now | Now, no helper copies |
|---|---|---|---|---|---|---|
| Written | 93 | 184 | 176 | 181 | 180 (1 of them, a pattern by spokes, with three constraints removed as implied) | 174 |
| Entry | 0 | 12 | 12 | 12 | 12 | 12 |
| Shared | 155 | 155 | 176 | 176 | 176 (92 by a point, 63 by copies, 1 an end of the curve, 20 by the cut) | 176 |
| Twice | 1 | 5 | 5 | 5 | 5 (4 mirrors of two points that a mirror of their lines already writes, 1 coincidence) | 5 |
| Implied | 0 | 0 | 5 | 0 | 1 (a coincidence of a line and a point in Motor Shell 1) | 1 |
| Lost | 131 | 24 | 6 | 6 | 6 | 12 |

The helper copies add, outside the 380: 2 sketches, 18 constraints, 12 written (2 as numbers) and 6 shared.

**The lost, by cause:**

| Cause | Before | The first version | Now | By what |
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

| | Before | The first version | Now |
|---|---|---|---|
| In the first step of the ladder | 24 of 24 | 24 of 24 | 24 of 24 (the 2 helper copies one by one) |
| Status `ok`, conflicting constraints | 24, 0 | 24, 0 | 24, 0 |
| Largest drift of a point or a radius, before and after the cut | | | 7e-15 mm, 0 |
| Valid profile, nothing uncut, no contact without a fix | 24 | 24 | 24 |
| Regions | | the same number in every sketch as before; the largest difference of an area 6.5e-8 mm² | the same; Onshape's number in 23 (the disc 7 of 8) |
| Degrees of freedom, all sketches | 771 | 159 | 10 (20 without the helper copies) |
| Fully determined sketches | 0 | 11 | 21 (17) |
| Constraints the solver lists as redundant | 2 | 10 | 13 (the diagnosis counted 45 before the four removals) |
| Own curves, own points | 520, 409 | 275, 208 | 347 (72 of them spokes), 208 |
| Constraints in the document, entries | 93, 0 | 175, 19 | 327, 25 |
| Changes of a parameter that break, of the probe of its time | 0 of 40 jumps | 3 of 48 jumps | 0 of 56 walks (2 of 48, not back) |
| Changes of a literal dimension that break | 0 of 62 | | 0 of 96 (14 in the second revision, Motor Shell 1 and 3) |
| Changes after which a pattern is no longer its seed turned | 6 of 40 walks, 8 of 62 dimensions | | 0 |

The three sketches that keep freedom: the disc's (8; its splines are left out), Input Shaft 2 (1; along a walk of `E` the count reads 0 once and 1 again, gap 8), and Motor Shell 2 (1; the two midpoints that stay lost).

**The parts** (with the override of the disc; volumes in mm³ of the baseline):

| Part | Volume | Part | Volume |
|---|---|---|---|
| Cycloidal Disk | 4951.520 | Output Shaft Front | 17118.317 |
| Housing Front | 5665.516 | Output Shaft Rear | 7360.887 |
| Housing Middle | 22171.440 | Output Shaft Spacer (six) | 43.900 |
| Housing Rear | 5725.680 | Motor Shell | 22516.843 |
| Input Shaft | 891.154 | Hex Standoff | 224.294 |
| Motor Shaft | 2561.152 | | |

The largest difference of a volume between the baseline and the trial is 6.9e-6 mm³ (3.1e-10 of the part, Housing Middle), in every version of the trial. The same 4 of 10 chamfers convert, with the same refusals; 31 starts at a face are `from`; the loaded document has 335 bodies with the override of the disc and 333 without (counted by the reviews).

**The tolerances of the contacts**: over all sketches of the dump, 475 pairs of a point and a curve, or of two curves, are in contact, the worst by 2.8e-14 mm; the nearest pair that is not is 0.42 mm apart.

## What stays lost, and where it stands

| Lost | Count | Where it stands |
|---|---|---|
| `FIX` of the disc's splines | 4 | The splines are over the budget; the generator replaces them |
| MIDPOINT of two points | 2 | Backlog row, a kind of constraint |
| A constraint of a derived sketch on the skeleton sketch | 0, or 6 with "no" to question 2 | With "no": the row says that `HOUSING_MOUNTPATTERN` then drives nothing and the mounting holes of Housing and Motor Shell are free |

Not lost and not as Onshape has it either, so listed in the report: the 9 patterns by spokes cannot be counted again; one diameter of each helper copy is a number; the four constraints removed as implied (one of them the whole of an Onshape constraint, counted `implied`); the constraints the diagnosis still lists as redundant; the 6 welds of an instance point with a point outside its pattern that no constraint backs.

## Engine gaps

Rows of `docs/backlog.md` the closing point adds; none is fixed here.

1. **A pattern or a mirror among own curves.** The copies of D68 cannot be constrained or cut, which keeps 9 of the 19 patterns of this model from being entries: a hexagon drawn as a pattern of one side is closed by a coincidence on a copy, and pin pockets patterned on a bore cross it. The converter writes them by spokes, which is the backlog's "sketch tool that makes a batch of copies tied by constraints" done by hand (6c chose derived geometry); the row gains the measured need (72 construction lines for 9 patterns, the count no parameter) and the two narrower forms: a constraint that may name a copy, and an own curve cut where a copy crosses it.
2. **Horizontal and vertical of two points** as a constraint (today a dimension of 0).
3. **A midpoint of two points; a distance of two parallel lines as a constraint of two lines, and from a line to a circle.**
4. **A sketch of thousands of spline pieces**: 108 s for 6,285 pieces (18,855 free points), where 256 take 77 ms. Either a spline refitted within a tolerance, or the cost of the sketch step with many free points looked into; which part is slow was not measured.
5. **A sketch of another document projected**: a derived sketch stays a copy that drifts from its source, and a helper copy with it.
6. **Whether a consistent redundant set follows a change depends on the order in which the solver gets the constraints, and the solver does not name the constraint whose removal cures.** Motor Shell Sketch 1 as Onshape wrote it (seven mirrors of lines whose ends lie on circles; 22 redundant constraints by the diagnosis) answers a change of `HOUSING_DIAMETER` and of each of its three literal dimensions with `sketchConflict` under the converter's numbering, and follows all of them with every constraint in place under three other numberings of ten (the third round). What the engine offers:
    - the solver's list of redundant constraints (`SketchResult.redundant`) is partial and follows the IDs: 4 and 2 in Motor Shell 1 and 3, where the diagnosis lists 22 and 12, and the constraints whose removal cures are not among them;
    - the diagnosis's list (`diagnoseSketch().redundant`) holds the cure, and nothing says which of its members to take: the converter finds them by trial (57 trial removals for 4 kept);
    - the diagnosis's set that can be removed at once (`diagnoseSketch().removable`) is judged at today's position: removing it (25 constraints over the model) leaves Motor Shell 1 in conflict and breaks Input Shaft 2, whose mirror it calls removable.

    What would serve: a solver that does not depend on the order of dependent constraints, or drops what is dependent while it solves; or a tool that says which constraints are implied by the others for every value and not only at this one.
7. **The solver out of memory is reported as a conflict.** 769 fixed points (1,538 equations) abort the solver; the sketch gets `sketchConflict` with no constraint named. The solver works again afterwards, but a large solve leaves less for the next (150 pieces failed right after 140, where 160 alone passed). `fixed` on a few hundred points is also slow (1.7 s for 385).
8. **A sketch does not always come back.** Set to a value and back, a sketch can stay in conflict (Input Shaft 2 under the first revision's removal), and its count of freedom can read differently along the way (1, 0, 1, 1 along a walk of `E`, with and without that removal): the solver starts from where the last solve left the points, and the count is of a rank at one position.
9. **A cut sketch holds its topology.** After `split` a sketch is its pieces; when a parameter moves two curves apart that were cut where they met, the pieces cannot exist and the sketch gives `sketchConflict` with nothing named, where Onshape forms other regions (Housing 1 follows `Phi_R` only from 0.931 to 1.103 of its 58 mm; the second round, with and without spokes).
10. **A profile cannot say "the regions of every copy of this entry".** It names the regions one by one, so a count that goes down leaves a broken reference (`noProfile`, D68) and a count that goes up leaves the new copy out with no error at all.
11. **Two failures of the kernel beside today's values**: Chamfer 1 of Housing at `HOUSING_DIAMETER` − 1 % and Extrude 8 of Motor Shell at − 4 % (`kernelFailure`; the second round's walks of 1 %). They pass at 3 % and 6 %. The first does not occur in the baseline (the review's guess, not checked: Sketch 2 now follows the diameter, so the chamfer meets a shape the baseline never made). Not looked into here.

Found on the way and not an engine gap: `fetch.ts` does not dump what the external operands of sketch constraints are ("Open", question 3); the skeleton studio's geometry in the dump has a diameter that its variable does not give (72 against `HOUSING_DIAMETER` = 70).

## Acceptance

1. **`docs/onshape-import.md` has the tables of "Measured"**: fates and causes, before and after, as the implementation's runs give them. The "before" column is taken by the first point of work with the converter otherwise unchanged. If the implementation's numbers differ from this text's, the run is the evidence: the difference is explained and the text corrected, in either direction.
2. **No sketch is split by the converter**: `splitAtCrossings` is gone; every sketch of the model has a valid profile after `split`, nothing in `ids.uncut`, no contact without a fix, and Onshape's number of regions (the disc's sketch excepted, by its splines); no constraint has the cause `split`.
3. **The parts are unchanged**, by the strict scope of the comparator over two `summary.json` files (the baseline's and the run's): every volume within 1e-3 mm³, the same number of regions in every one of the 24 sketches with areas within 1e-6 mm², the same edges of the same chamfers and fillets converted, the same starts written as `from`, the same number of bodies in the loaded document, no feature newly in error, no part missing.
4. **The lost are at most 6** (12 with "no" to question 2), by the causes of "What stays lost". A higher number is explained cause by cause in the notes, not accepted silently.
5. **The document's probe**:
    - **must pass**: no change of a parameter has the verdict "cannot follow", "invalid profile", "reference", "other", "fails in part" or "not back", none is refused, and no assertion fails at any state. A "kernel" verdict is named apart with its feature and is no failure of this point, but it excuses nothing else: every verdict of a state is recorded, and a state with "kernel" and another verdict fails by the other;
    - **this needs the helper copies of question 2.** With "no" there, two walks of `M3_NUT_SIZE` in Motor Shell are "not back" (the free copy of Global Sketch 3 wanders); those two are then the expected result, named in the notes, as the 12 lost are in item 4;
    - **when a parameter cannot be followed and no removal cures it** ("Implied constraints"), this item fails and the point is not closed: the case goes to the owner with the sketch, the parameter and the candidates tried. On a later model the converter reports such a sketch and goes on;
    - the changes of literal dimensions and of counts are listed in `docs/onshape-import.md` with their verdicts. Each verdict there is explained, by a named engine gap (the counts of entries, gap 10) or **as geometry, case by case** (two circles that meet when one grows; a pattern whose copies overlap at another count). A verdict that is neither fails the acceptance;
    - what drives nothing is listed.
6. **Every constraint the diagnosis lists as redundant after the conversion is in the notes**, per sketch, with the sketch's probe (what broke with the full set, what was tried, what was removed and at how many states it was checked) and the solver's list beside it.

## Where the code lives

All in `tools/onshape/`; nothing in `packages/`.

| File | What |
|---|---|
| `fates.ts` (new) | `Fate`, `Cause`, the record of a constraint, `Tally`; the tables of the report; `summary.json` and its comparator |
| `check.ts` (new) | What passes, the units, the ladder, the implied constraints |
| `probe.ts` (new) | The changes, the verdict of a state and the assertions, shared by the sketch's probe inside the converter and the document's probe after it |
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
| 1 | **The count.** `fates.ts` with the records, the report, `summary.json` and the comparator, the weld count, the decode used only to name the cause of an external operand (12 in a sketch, 1 on an edge), `probe.ts`. The document written must be byte for byte the baseline's. The "before" tables and the baseline's probe (40 walks and 62 changes of a dimension with no verdict; 6 and 8 of them fail the pattern assertion, whose rows come from Onshape's pattern constraints and need no spokes) into `docs/onshape-import.md` | 131 | Full, focused on the classification and the records: it is new code that defines every number of the acceptance, so "anything else" of CLAUDE.md's table. The first version said light; two reviews objected |
| 2 | **The check.** `check.ts`: what passes (status, radii, 1e-6), units, the ladder with numbers per unit, the sketch's probe and the implied constraints; `shared` established from identity, the weld by distance, `twice` in the canonical form, a point on its own end `shared`. The constraints are numbered zero padded from this point on. Until point 3 the probe and the removal run after `splitAtCrossings`. The document changes here for the first time: by the new IDs, and by the one point held on its own end, which is no longer written (the one constraint the baseline's solver lists that is the converter's doing). Nothing is removed as implied: the baseline has no break a removal could cure (its Input Shaft 4, 13 degrees of freedom, comes back elsewhere after a change of a 3 mm distance, which in a sketch with freedom is a note) | 131 | Full |
| 3 | **Crossing curves** by `split`, previewed and checked; duplicates redirected; `splitAtCrossings` removed | 94 | Full |
| 4 | **Known operands and kinds**: the origin, the default planes for everything but mirrors of curves, the angle, horizontal and vertical of two points, the distance of two lines, an arc's kind, Onshape's horizontal by the matrix, `expression` | 51 (the 8 mirrors of curves about a default plane wait for point 6) | Full |
| 5 | **Found operands**: the decode as the filter, entities of sketches, edges of bodies, all sketches of an `importDerived`, the helper copies if the owner says yes | 38 (44 without the helper copies) | Full |
| 6 | **Mirrors and patterns**: the rule of the entry, the entries, `symmetric`, spokes; `matchRegion` over `solvedCurves` | 6 (12) | Full |
| 7 | **Splines**, with `FIX` and the chains in `matchRegion` | 6 (12) | Full; small |
| 8 | **The close**: the "after" tables, the sections "Sketches" and "Gaps" of `docs/onshape-import.md`, the backlog rows, "As implemented" here | | Full by CLAUDE.md's table (it has no row for documents, so "anything else"), and narrow: the reviewer checks every number of `docs/onshape-import.md` against the run's `summary.json` and the backlog rows against "Engine gaps". No code changes in this point; if the owner wants it light, that is an exception for the owner to make |

Points 5 and 6 are the risky ones. If the review of a point finds more than six issues with three serious ones, it gets a second round (CLAUDE.md, "Further rounds").

## Tests the implementation owes

The unit tests run in the root run and read no dump: each builds a part studio of one to three sketches in the shape of Onshape's JSON with `kit.ts` (entities, constraints with their parameters, the sketch matrix, `created` with IDs made by the encoding), writes it to a temporary folder in the layout of `fetch.ts` where a whole studio is converted, and runs the converter with the real adapters. Nothing in a fixture is copied from the owner's document; the IDs are made up.

**A test of a shape no dump has shown is named "from knowledge"** (a linear and an open pattern, a turned sketch, an arc with a constraint, a spline under the budget, a vertex of a body), and the converter writes a note the first time a real dump takes such a path, so the owner knows that the case ran on real data for the first time.

1. **The tally and the summary**: the fates of a sketch add up to its constraints; the tables as text; the reason kept apart from the operand's category; the comparator's three scopes (a missing part fails, a helper copy is listed, a changed fate is compared with the prediction), a value that is not finite, an outcome by edges kept and not by its text; the fingerprint unchanged by an output folder inside the dump; a small assembly written, loaded again and its bodies counted.
2. **The check**: a diameter with a wrong value (a radius changes, no point moves): refused; a solver failure with nothing named: not passed; a wrong dimension among good constraints: the others keep their expressions, the one falls to its number and is listed under "Expressions dropped", and one that fits no number is `refused`; a mirror whose second half fails: the whole unit dropped.
3. **`twice`**: `(A, B, d)` and `(B, A, −d)` of a signed distance and of an angle are `twice`; `(A, B, d)` and `(B, A, d)` are not, the second `refused`, and are `twice` at `d` = 0; `(A, B, π)` and `(B, A, π)` of an angle are `twice`; `E` against `1.25` at `E` = 1.25 is `twice` and the expression is the one written; a `twice` whose written constraint is consumed by the cut is `shared` with it.
4. **Implied constraints**: the IDs are zero padded and a sketch of more than ten constraints gives the solver the written order; a sketch with a redundant constraint that follows everything: nothing removed, the constraint in the notes; a sketch that the diagnosis lists and the solver does not is probed; a four-fold symmetry by mirrors of mirrors that cannot follow its diameter: the removal makes it follow, and what is removed holds at every state; **one removal that cures and a second candidate that passes every test and cures nothing: the second is put back**; a cure that needs two removals together (a step with the breaks unchanged, then the cure; both stay after the last pass); a driving dimension, literal or of a parameter, listed as redundant (a review's example: a point fixed by numbers and also by a dimension that a parameter drives): never a candidate, and the parameter still moves the point; an `equalRadius` whose removal lets a radius differ at a changed state while no point moves: seen by the radius, not removed; a sketch whose every changed state conflicts: nothing is kept on a check that never ran; a constraint whose removal passes one step and breaks at the second and on the return (the shape of Input Shaft 2): kept; a constraint the cut added is never a candidate; a sketch with freedom that comes back elsewhere: a note, no break; no candidate cures: the sketch reported with what was tried.
5. **The document's probe**: each verdict made on purpose (a conflict; a profile that turns invalid; a later feature that loses its region; one that fails with another code; a chamfer that keeps fewer edges; a state that does not come back; a command that is refused); **a state with a kernel failure and a lost region has both verdicts and fails**; a count changed by one both ways (down: a reference; up: the new copy bounds a region that no feature names); a parameter that only a helper copy reads listed as driving nothing; a zero parameter and a literal zero that is a real dimension (an absolute step); an angle of π (only downwards, the other direction recorded as not available); a pattern by sizes alone (the rejected variant, built by hand) caught by the assertion while every status is `ok`; a pattern that turns clockwise, on a sketch seen from the other side, passing its assertion; a lost pattern caught with rows taken from Onshape's constraint; two studios that derive one sketch and are made to disagree, by a point and by a radius alone, caught; two studios that both have a removed `Sketch_1.c004`, each checked in its own.
6. **Crossing curves**: a line through a circle that has a diameter and a point held on it: two D-shaped regions, the diameter written, the point `shared` by the cut; the four reasons of `ids.removed`, each with its fate; a line that touches a circle: not cut; a crossing with two partly overlapping lines beside it: the tool's `ok` not taken for a valid profile; two identical circles: one, both IDs usable; a construction line on an outline line: both kept; a reversed duplicate line under an angle.
7. **Welds**: two points 2e-7 apart are one, two 9.8e-5 apart are two; three points in a chain of steps under 1e-6 whose ends are further apart (one cluster, reported); a coincidence of two points that stand apart is written, not `shared`; a weld without a constraint is recorded by its class.
8. **The origin and the default planes**: coincident, horizontal and vertical of a point, a horizontal distance with a parameter, on sketches on XY and on XZ with a flipped normal; the table of "What an external ID is" on the three base planes and an offset plane; a plane parallel to the sketch; a mirror and an angle to each axis; a sketch turned in its plane (from knowledge).
9. **The decode**: IDs of each kind and of several lengths; the self-test failing on a studio whose `created` contradicts it (no operand resolved there); an operation `created` does not know (`unknown`, no search); an operation of a plane feature; an operation listed under two solid features (a body) and one listed under a solid and a feature the converter does not know (`unknown`); a vertex ID with a curve through the place (the point, never the curve); an edge ID with a point at the place (the curve).
10. **Another sketch**: one candidate; two at two places, and two distinct entities at one place (both unresolved, lost with the candidates); two Onshape points welded into one (one answer); a point beyond the end of a line and on a circle (the circle); an arc cut from a circle under EQUAL; **an own sketch held on a derived copy, with an extrusion over that copy before it** (the copy's entity, not an edge of the body); a derived copy whose operand is in a sketch not derived, with and without the helper copy; a helper copy whose own operand is in a further sketch (lost, no second helper); two derived sketches that need one helper (one copy); two sketches from one `importDerived`; a source on a parallel offset plane.
11. **An edge**: a point on the rim of an extrusion (the entry, the slide along the rim kept when the sketch under it changes); the two whole rims of one extrusion (one answer, the record naming the other) and of a tapered one (unresolved); two straight edges of one side face at one place (unresolved); two edges of two bodies at one place (unresolved); a circle equal to a circular edge; a circular edge whose axis is not the sketch's normal (no candidate); a point on the end of a straight edge (from knowledge).
12. **Mirrors**: an image that nothing names (an entry); a mirrored line with the MIRRORs of its ends (an entry); the first curve named and the second not (the second is the copy); an image with a tangent line (by `symmetric`, the profile valid after the cut); a mirror of a mirror; a point on the mirror line and on the origin; two arcs by three `symmetric`, a parameter changed under them (the sketch follows; nothing asks that a `symmetric` is removed).
13. **Patterns**: holes on a circle with the count a parameter (an entry; the count lowered: the extrusion's lost region; raised: the probe's "the new copy bounds a region that no feature names"; both the known limit they are); a hexagon of one side (spokes, a tree of angles, the hexagon follows its across-flats dimension and its opposite sides stay parallel); a ring closed only by coincidences of two instances (no entry); pockets across a circle (spokes, cut by `split`, the regions as Onshape's, the pockets follow the circle's diameter); instances that overlap each other (no entry, by rule 2 or 6); a pattern of a pattern (the outer an entry); a pattern by spokes about a projected pivot (the own point), with an arc centred on the pivot (no spoke there), of two instances (`pi`), on a sketch seen from the other side (the sense), and with a parameter as its count (from knowledge: a number, the note); an entry whose copies do not land, and one with a copy too many (dropped by rule 5); an open and a linear pattern (from knowledge).
14. **The angle**: the four forms; a value that fits none; 90° with a parameter (the number, listed as ambiguous; from knowledge of the flags, which are only recorded); 0° and 180°; a plain number at 90° (the expression kept); the same angles on a sketch seen from the other side.
15. **The distance of two lines**: parallel through other constraints (one `distancePointLine`; the sketch's probe runs for the pair and finds it parallel at every state); free to turn (the sketch's probe finds them parting, `parallel` joins the unit, the probe passes); not parallel in the geometry (lost).
16. **Splines**: a uniform cubic of six points (one spline); a non-uniform one (a chain, its area against the polygon of its samples); rational, periodic, unclamped, a repeated inner knot, end points that disagree (each listed); 193 and 194 points counted after the decomposition, and two splines that pass alone and not together; `FIX` of a chain; a region bounded by a chain of several pieces matched in either direction, with a curved piece whose engine polyline is more than 1e-3 off its middle, and extruded.
17. **`matchRegion`** with a copy in the outer loop.

The run on the dump is the acceptance, made by hand at every point and recorded in `docs/onshape-import.md`.

## Risks

For a reviewer, the riskiest first.

1. **The probes decide, and they are small.** What is removed as implied, and what the acceptance passes, rests on two steps of 3 % of one value at a time and on a handful of assertions. A constraint that matters only further away, or only with two values changed, is not seen.
2. **The result of the removal follows the numbering of the constraints.** The design fixes a numbering and measures with it; the implementation will write its constraints in another order here and there (a pivot's own point, `parallel` in a unit, new modules), and may find other removals, or for Motor Shell 3 a cure of fewer of its dimensions (6 of 8 breaks stayed under two other numberings). Its own run is the evidence, and Acceptance 5 holds it to the parameters, not to the dimensions.
3. **The decode is read off one dump**, with studios of at most 50 operations and one digit for them. If Onshape encodes otherwise elsewhere, the self-test catches a wrong kind of a face or a body, not a wrong operation and not a vertex or an edge. A wrong pick within the decoded sketch still holds at today's positions; the report names every pick as inferred, and an ID the rules do not cover is lost, not guessed.
4. **The rule of the entry.** Rules 1 to 4 are the converter's reading; what they miss is caught by rules 5 and 6 only where the engine sees it now. A copy that meets nothing today and would after a parameter change is seen by the probe at 3 %, not beyond.
5. **Spokes** make sketches larger (Housing 1 and Motor Shell 3 gain 16 construction lines each) and write the count as a number. A pattern whose count is a parameter stops following it, and says so only in the report.
6. **A recovered constraint that holds now and misbehaves later**: an angle written as `pi - (e)` is right at today's value and wrong in sense if the design flips. An angle at an ambiguous value loses its expression rather than guess.
7. **The helper copy is a second copy of a copy.** It drifts from its source like the derived sketch does, and one of its dimensions is a number because the dump's geometry and variable disagree.
8. **The volumes are checked on one model.** The unit tests cover the shapes of this model and the cases it lacks; a second real model was not converted.
9. **Removing `splitAtCrossings`** removes the repair of partly overlapping collinear lines, which the tool refuses. Not on this model.
10. **A sketch with entries has other IDs than Onshape's instances.** A later change of the converter that names an instance by its Onshape ID (an override, a chamfer by curve) would find nothing; lookups go by geometry and should stay so.
11. **The dump is not in the repository**, so the acceptance cannot be repeated by CI or by a reviewer without the owner's copy. The numbers of "Measured" and the baseline `summary.json` kept with the dump are the reference.

## Rejected

- **Every pattern and mirror as an entry, as the outline says.** Nine patterns and eleven mirrors have a copy that is constrained or met by a curve. As entries, three sketches would be left with an invalid profile (the housing's bore is crossed by fifteen copies that cannot be cut), which changes the parts, and the constraints on images would be lost in place of the pattern.
- **Every mirror by `symmetric`, no mirror entry.** One mechanism, and it always works. Not taken: the two mirrors that can be entries cost nothing beyond the rule the patterns need anyway, and an entry is what a person would draw.
- **A pattern that is no entry left lost**, as the first version had it, or held only by `equalRadius` and `equalLength` with its seed: measured in "Otherwise".
- **Keeping the redundant constraints**, as the first version had it; **removing them by rank**, as the first revision had it; **candidates from the solver's list**, as the second revision had it; **the engine's removable set**: all measured in "Implied constraints".
- **Accepting a removal only when it lowers the breaks**: Motor Shell 3 goes 8, 6, 6, 0, and the middle step is needed. The last pass that puts back is what keeps a removal that cures nothing out.
- **A driving dimension as a candidate of the removal**: its own change is one of the probe's, and has no target once it is gone.
- **Choosing an ambiguous angle's form by the flag `clockwise`**, as the first revision had it: no sample at an ambiguous value, the flag confounded with `flipped`, the frame's handedness not in it.
- **Taking the first of several candidates at one place**, as the first revision had it: two edges that project onto each other today are not one dependency. Only what is the same by construction is one answer.
- **A search by geometry over all kinds when the decode fails**: the ranking of the first version by another door.
- **`parallel` always beside the distance of two lines**: where the pair is parallel through other constraints it is a redundant constraint of the kind gap 6 is about. It is added only where the probe shows the pair parting.
- **Closing a hexagon on its seed**: replacing the coincidence on a copy by two spokes to the ends of the seed and their angle of 2π/n, so the pattern could be an entry. It is a recognition of one shape; the distance across flats names a copy as well.
- **The search by geometry over all earlier sketches, ranked** (a point before a curve, the earliest sketch), as the first version had it: it can turn a point held on an edge into a coincidence with a sketch point at the same place, and can never find an edge of a body, since nearly every edge has a sketch curve under it.
- **A stand-in for an edge of a body** (the sketch curve the edge was extruded from): it behaves the same only while that extrusion stays as it is.
- **Keeping `splitAtCrossings` as the fallback** when the tool refuses: two cutting codes with two tolerances, the second with the losses this point removes.
- **The step "every dimension as a number"** before one by one: one bad expression costs every good one.
- **A target count.** The acceptance is the tables and the bound this model gives.
- **The two `summary.json` files committed beside the design** (a review's proposal): they hold the names and measures of the owner's model. The owner decided on 2026-11-25 (answer 39 of `6-cross-review.md`) that they stay with the dump; the tables of `docs/onshape-import.md` are the record.

## Known limits

What stays open after three rounds of review is here, each with its reason; there is no further round.

- **The removal of implied constraints follows the numbering of the constraints**, because the solver's behaviour with a redundant set does (gap 6). The numbering is fixed (zero padded, in the order written), which makes a run repeatable and does not make it robust: under two other numberings Motor Shell 3 kept 6 of its 8 dimension breaks. Nothing in the converter can remove the dependence.
- **When no candidate cures a sketch that cannot follow**, it stays as written and is reported; for a parameter that fails the acceptance. No further search is designed: the diagnosis's list is all the engine gives.
- **Removal as implied is judged on what the sketch's probe tries**: 3 % and 6 % of one value at a time, in the sketches the diagnosis lists. A relation that fails only further away would be removed wrongly; the four of this model were checked at 16 states each.
- **The probes are two steps of 3 %, one value at a time.** What breaks between the steps (the two kernel failures at − 1 % and − 4 %), further away, or only when two values change together, is not found. Finer walks cost four times as much and found only the kernel's failures.
- **A pattern by spokes cannot be counted again**, by a parameter or by hand, and a pattern or mirror by constraints is heavier than Onshape's one constraint. A linear pattern that is no entry is lost. Own curves have a fixed number of instances.
- **The count of an entry cannot be changed either way** in a converted document: extrusions name the region of each copy (gap 10). Down it is a broken reference; up the new copy is left out with no error, which only the probe's assertion shows.
- **A cut sketch holds its topology**: a change that parts two curves which were cut where they met leaves a conflict with nothing named. Housing 1 follows `Phi_R` from 0.931 to 1.103 of its value. It is what a cut is (gap 9).
- **An operand is picked by geometry within what its ID decodes to.** An ID whose operation is not one base-64 digit, belongs to a feature the rules do not name, or has owners of two kinds, is lost. The exact identity needs Onshape (question 3).
- **An `edge` entry names one edge of several that are the same by construction**; it breaks when that edge's cap goes, though another would do.
- **A weld without a constraint** (76 places, all at instance points) ties what Onshape holds together only by today's geometry. Whether Onshape would let them part under an edit cannot be tried from a dump.
- **An angle at 0, 90° or 180° whose expression has a parameter loses the expression**: the dump's flags cannot be read with six samples that are all elsewhere.
- **Mirrored arcs are written by three `symmetric`** that hold one equation twice; whether the solver follows a change under them was not tried on a model (none has them), only asked of a fixture.
- **A sketch with freedom may come back elsewhere** after a change and its return (gap 8); the sketch's probe notes it and the document's probe calls it "not back".
- **Partly overlapping collinear lines** are refused by `split` and reported; the old converter cut them.
- **Splines of more than 193 control points in a sketch are left out**, and a region bounded by them is not converted, as today.
- **A chain of Bezier pieces is smooth only as written.** Its control points are free points; once one moves, nothing holds the tangents of neighbouring pieces together (D70 has no such constraint). `FIX` holds an imported one in place.
- **An open pattern loses the expression of its angle; a linear pattern is written from positions.** Neither was seen in a dump.
- **Constraints that name a point of a spline between its ends** (a spline drawn through points in Onshape) have no counterpart: nothing holds a point on a spline (D70). From knowledge; the model's splines are imported and have none.
- **The converter still builds no tilted plane**, so a default plane is an axis only for sketches parallel to a base plane, which are all it converts.
- **The one-by-one step keeps a subset that depends on the order** and is not the largest possible.

## Open

**Three choices are the owner's, and they are still open after the three rounds of review. None holds the implementation up: the design goes ahead with the recommendation unless the owner says otherwise.** (A fourth, whether the `summary.json` files are committed, the owner answered on 2026-11-25: no; answer 39 of `6-cross-review.md`.)

1. **The angle, "horizontal of two points" and the distance of two lines in this point**, though the plan names the angle and other distances among the kinds left to the backlog. *Recommendation: yes, all three.* Five of the six angles are to a default plane and step 4 cannot recover them otherwise; all six map with their expressions, the three two-point constraints by a dimension of 0, the three distances of two lines by one `distancePointLine` each (they are the hexagons' driving dimensions, and the hexagons follow them). Without them the lost are 18, not 6. *The reviewers:* every review that spoke of it says yes (three in the first round, two in the second; the third round raised nothing against it). Their conditions are in the design: an angle at an ambiguous value is written as a number and not chosen by a flag; the distance of two lines is written alone only while the sketch's probe finds the pair parallel at every state, else with `parallel`.
2. **Copy the skeleton sketch that the derived sketches are held on** (a helper copy of Global Sketch 1 in Housing and in Motor Shell). *Recommendation: yes.* The six constraints are the link from `HOUSING_MOUNTPATTERN` to the mounting holes of two mating parts, which without the copy no parameter drives. Measured with the copy: lost 6, not 12; that parameter moves the holes of both parts with no conflict, and the copies in the two studios stay the same, point for point and radius for radius, at every step of the probe; the two derived sketches have no freedom left, where without the copy one of them wanders (two walks of `M3_NUT_SIZE` in Motor Shell do not come back to the same volume, so **Acceptance 5 passes in full only with the copy**); the 380 stay the same set, the copies' 18 constraints counted apart. The cost is one sketch of four construction curves in two studios, a second copy that can drift from its source, and one diameter written as a number. *The reviewers:* in the first round one yes and two no (a boundary of scope); in the second round both say yes, with conditions that are in the design (one level only, one copy per destination and source, the numeric diameter reported apart, a parameter that only the copy reads not counted as driving the part, the agreement of the two parts tested); the third round added that the acceptance has to say what it expects with "no", which it now does. If the owner says no, "What stays lost" names the parameter that drives nothing.
3. **What an external ID is, from Onshape.** One FeatureScript call per studio (`sketchEntityQuery` for every entity of every sketch, and the geometry of the IDs that are no sketch entity) would say it exactly; `fetch.ts` would write it to a file of its own and the converter would prefer it, keeping the decode as a check. *Recommendation: not in 6h; the decode in its place now, with nothing guessed.* The decode needs no call, identifies the kind and the owner of all 13 operands and leaves one candidate for each of the 12 in a sketch; the thirteenth has two edges that are the same by construction (two whole rims of one cylinder). What the decode does not settle is not chosen among and not searched otherwise: it is lost and listed, so a wrong dependency cannot come from it; on this model that costs nothing. The call needs the API (about 8 calls of the FeatureScript budget of about 150). **It is due before a second model is converted, and before any studio with more than 64 operations** (the decode is read off studios of at most 50, with one digit for the operation, and off solids whose operation has several owners in a way that was read, not documented). *The reviewers:* the first round one "use the decode", one "not in 6h", one "bring it forward"; in the second round one says not in 6h with the trigger above, and the other still prefers it brought forward as an optional cached file, or else every ambiguous operand left unresolved with the lost count adjusted, which is what the design does; the third round narrowed "the same by construction" to whole circular rims and asked for the rule for several owners, both taken. If the owner reads the rim rule as still too generous, `JQx` is lost and the lost are 7.

For the owner to know, since they follow from the measurements and not from the plan:

- **The headline was 131, not 287.** `docs/onshape-import.md` says "93 of 380 have a counterpart"; the closing point corrects it.
- **Nine patterns are written by spokes**, not as Onshape's one constraint, by a limit of D68 (engine gap 1).
- **The disc's splines convert, and are not used**: 108 s a recompute.
- **Four constraints of Onshape's are not written, on purpose**: one coincidence of Motor Shell 1 and three equal lengths of a pattern of Motor Shell 3. With them the two sketches refuse every change of their own dimensions (and Motor Shell 1 of its parameter); without them they follow all of them, and the relations still hold. Which constraints these are is found by trial and follows the numbering the converter gives its constraints (engine gap 6), so the implementation may name others.
- **The count of a pattern cannot be changed in a converted document**, in either direction, and a pattern by spokes not at all (engine gap 10).
- **Point 8 has a full, narrow review** by CLAUDE.md's table; making it light is the owner's exception to give.
- **In the dump, the skeleton studio's housing circle is 72 mm where `HOUSING_DIAMETER` is 70.** Nothing converted uses that circle.

## Reviews

### The first round

Three independent reviews read the first version (`314188c`) on 2026-11-25: a subagent with the dump and the trial (called the first below; it ran probes of its own), codex without the dump (the second; three probes on the engine), and agy without the dump (the third). Together 43 findings, 24 of them rated serious. All were checked; none was refuted outright, a few were taken in another form than proposed. What changed in the first revision (three of its answers were withdrawn after the second round, which the rows say):

| Finding | By | What changed |
|---|---|---|
| Redundant constraints freeze a sketch against its parameter (Motor Shell 1) | 1 (S1) | Confirmed. The fate `implied` and a removal after the cut. The proposed rule (skip what is listed right after adding) was tried and frees 13 degrees of freedom; the first revision removed by rank, which the second round showed to be unsound, and the rule is now by behaviour ("Implied constraints"). Engine gap 6 |
| Nothing is tested away from today's values (Output Shaft 6) | 1 (S3) | Confirmed. The probe is part of the report, `summary.json` and the acceptance. For a pattern that is no entry the proposed `equalRadius` and `equalLength` were measured (no break, the pattern crooked) against spokes (exact), and spokes taken; such a pattern is now `written` |
| The ID decodes; `JQx` is an edge of a body; the ranking can pick wrong; picks must be named inferred | 1 (S2), 2 (6), 3 (7) | Confirmed on the dump. The decode with its self-test is the filter; the ranking is gone; candidates at several places stay unresolved (after the second round: all that are not the same by construction); every operand is reported; a line holds a point within its extent first; arcs, the fit per kind of constraint, the frames for `sketchMap` and the scope of an ID by studio are said. `JQx` is an `edge` entry (1 of 2 edges at one place) |
| The six constraints on Global Sketch 1 tie the mounting pattern to its variable | 1 (S4) | Confirmed. The helper copy is designed and measured; the recommendation of question 2 changed to yes |
| The rule of the entry: coincidences across instances, contacts among copies and with seeds, mixed tolerances, external pivots, mirrored lines, the seed of a mirror, points of images, a one-way rule 5 | 1 (S5), 2 (4, 5), 3 (5) | Rule 1 exempts only one instance with one seed point, and the MIRRORs of a mirrored line's ends; rule 2 covers seeds and other instances; rule 5 is two-way with kind and construction flag; rule 6 lets the engine judge; the pivot may be external; a mirror takes as its copy the curve nothing names. On this model no entry changes (measured); the 63 `shared` coincidences are all of one instance |
| The check: solver failures with nothing named, radii, the status, 1e-4 against 1e-6 | 2 (2), 3 (1), 1 (S6) | "What passes": status `ok` without warnings, radii, 1e-6. A solver failure of exactly that shape was then met in the spline trial (engine gap 7) |
| `split` answering `ok` is not a valid profile; nothing said for a failure after the cut | 2 (3), 1 (S6), 3 (6) | The cut is previewed and checked (`valid`, `ids.uncut`, contacts, Onshape's region count); the ladder says what follows |
| One Onshape constraint must be kept or dropped whole; numbers per constraint, not for the sketch; order dependence; a silent `mismatch` | 2 (8), 1 (S6) | Units; the number per unit; the limits of the order stated; the mismatch is `refused`. The step was then needed on the model (the helper copies) |
| `shared` assumed, the merge by rounded cells, welds without a constraint | 2 (1) | `shared` from identity (all 151 are one point); the weld by distance; welds counted: 76 of 157 places have no constraint, all at instance points |
| `twice` by a key that drops values and sorts operands; fates before the cut | 2 (9), 3 (12), 1 (M3, M1) | `constraintKey` with the value; one record per constraint, final after the last step; consumed by the cut is `shared` (20); the reason kept apart from the operand's category |
| Splines: unclamped knots, repeated knots, end points; `matchRegion` and `FIX` over several pieces; what the cap counts; `fixed` not timed; smoothness | 2 (10, 11, 14), 3 (3), 1 (M4) | Rule 1 validates; chains for regions and `FIX`; the budget is 193 control points over the sketch, all or none; `fixed` timed, which lowered the budget from 256 pieces and found engine gap 7; the smoothness is a known limit |
| Duplicate curves: the construction flag, direction, redirecting the ID | 2 (13), 3 (6) | "Exact duplicates first" |
| Two arcs mirrored by three `symmetric` are over-constrained; one lookup of positions for own and projected geometry; a point on the axis | 3 (2) | The three are written; the first revision promised that the surplus goes as implied, which the second round corrected (the surplus is one equation, not one `symmetric`); one lookup over `solvedCurves`; the origin on an axis handled |
| An `edge` entry is not its points; a circular edge needs its axis along the normal | 3 (4) | "What an external ID is", rule 4 |
| Arcs: the cause table and "To verify" disagreed | 3 (8) | An arc gets the kind `arc` in point 4; the cause is empty before and after |
| `studio.ts` keeps one sketch per `importDerived` | 3 (11) | All are kept, by source studio and feature |
| HORIZONTAL of two points against a point and the origin; the dot product's sign; `*deg` and `*mm` | 3 (13, 14) | The origin form first; the absolute value; units as factors |
| The angle is ambiguous at 0, 90° and 180° | 1 (M1), 2 (7) | In the first revision the flag `clockwise` decided between two fitting forms. Withdrawn after the second round: such an angle is written as its number, as the second review asked from the start; the flags are recorded |
| `summary.json` lacks what the acceptance compares; keys not unique; no comparator | 1 (M2), 2 (12), 3 (9) | The fields, studio-qualified keys, the fingerprint, the comparator. The files are not committed ("Rejected") |
| DISTANCE of two lines is one `distancePointLine` | 1 (M5) | Taken, measured (3 of 3), put to the owner with question 1 |
| Points of work: point 1 is not a light review; the check belongs before the cut; point 3 was three things; dependencies between points; "the count is wrong, not the text" | 1 (M6), 2 (15), 3 (10) | Eight points: the count (full review), the check, the cut, known operands, found operands, mirrors and patterns, splines, the close; what each is expected to leave lost; the run corrects the text |
| Tests on shapes nobody saw | 1 (M7), 2 (15) | Named "from knowledge", with a note at the first real use; the fixtures the second review lists are in "Tests" |
| Errors of the text | 1 (M8) | Global Sketch 3 has 13 degrees of freedom with entries alone; 335 bodies with the override; the four mirrors not nested are kept out by COINCIDENT (3) and HORIZONTAL (1); 3,145 or 3,146 control points; the 380 are the set of today's report; the tolerances of the contact tests named |

Not taken as proposed in the first round: the fate of a pattern that is no entry staying `lost` (it is `written` by spokes); the summaries in the repository; the exact identity of external IDs brought into 6h (question 3). Taken in the first revision and withdrawn in the second: the removal of implied constraints by rank; an ambiguous angle chosen by a flag; the first of several candidates at one place.

### The second round

Two reviews read the first revision (`2f7eb2f`) on 2026-11-25 (the third reviewer was out of quota): the subagent with the dump, which ran the trial again byte for byte, changed it by switches and probed the result (the first below), and codex without the dump, with probes on the engine (the second). The first found 3 serious and 10 minor points, the second 7 and 4. Both confirmed that the first round is resolved in the text and that the headline numbers reproduce. Both found the two mechanisms added in the first revision unsound as specified, and they were right:

| Finding | By | What changed |
|---|---|---|
| The removal of implied constraints is judged by rank at one state: it harms Input Shaft 2 at a second step of `E`, cures nothing in 7 of 9 removals, leaves Motor Shell 1 and 3 unable to take their literal dimensions, can remove the relation a parameter drives; "none listed" is not "none redundant"; the engine's `removable` set exists and does not serve either | 1 (S1), 2 (1) | Confirmed by the designer's trial. "Implied constraints" is rewritten: lazy, judged by the sketch's probe, a dimension of a parameter never a candidate, the removed relation asserted at every state, the changes listed before any removal. Measured then: 2 removals in place of 9, Input Shaft 2 whole. The third round showed that the candidates must come from the diagnosis and that a last pass must put back (below); partial removal is the stated exception to whole units |
| The acceptance probe is too thin: one jump, parameters only, symptoms and not geometry | 1 (S2), 2 (2) | "The probes": two steps each way and the return, literal dimensions, counts of entries, verdicts by kind with the kernel's apart, "drives nothing" by volume and points, and four assertions on the solved geometry (instances are their seeds turned, lines of a distance parallel, removed relations hold, the two copies of a derived sketch agree). Measured on the new document, and on the baseline, which passes every status and fails the pattern assertion in 6 of 40 walks. Acceptance 5 says which part must pass and which is listed. Not taken: walks of 1 % as the standing probe (four times the cost; the second step and the return are what found the break); the two kernel failures they found are gap 11 |
| The decode sends an operand on a derived sketch to "a body" | 1 (S3) | The owner of the operation decides by its feature type; a test with an extrusion over the derived copy |
| The operation is one digit; the self-test tests two kinds; the fallback over all kinds | 1 (M1), 2 (4) | The limit is named and is the trigger of question 3; IDs are judged one by one; there is no fallback search; "one place" is a distance |
| "The same place" hides an ambiguity (the two rims of `JQx`) | 2 (4) | Several candidates are one answer only when the same by construction: one written entity, or edges on one side face of an untapered extrusion along the normal. `JQx` qualifies and stays written; anything else is unresolved |
| `constraintKey` sorts the operands of signed kinds, so "the same key and value" is wrong both ways | 2 (3) | Confirmed in the engine. `twice` is by a canonical form with the sign; a `twice` record follows the fate of the constraint that was written |
| The angle at an ambiguous value: no sample validates the flag, `clockwise` is confounded with `flipped`, the frame's handedness | 2 (5), 1 (M7) | The flag rule is withdrawn: such an angle is written as its number and listed; the flags and the frame's sign are recorded. Unambiguous angles are measured in the converter's frame, which holds the handedness |
| Spokes: a projected pivot cannot end a line; a point at the pivot; the sense after the frame; a count of 2; the count branch never ran; cannot be counted again | 2 (6), 1 (M6) | An own point tied to the pivot; no spoke for the pivot itself; the sense from the written positions; `pi` for two; the parameter branch named from knowledge; the limit said in full |
| The spline's match is tighter than the engine's polyline | 2 (7) | The converter samples the chain itself to 1e-4; either direction; the budget counts points after the decomposition |
| Three statements did not match the runs | 1 (M2) | The volumes after `HOUSING_MOUNTPATTERN` (those quoted were of a run before the spokes were tied as a tree), the freedom of Input Shaft 2, and a row of the table of rules: corrected or gone |
| The cut freezes the topology | 1 (M3) | Engine gap 9, a known limit, and a line of the report when a conflict names nothing in a cut sketch |
| The comparator: strict keys contradict what the points add; outcomes by text; the fingerprint over a folder that holds the output | 1 (M4), 2 (10) | Three scopes; outcomes by edges kept; a manifest of the raw input |
| `ids.removed` has four reasons | 1 (M5) | A fate per reason |
| Mirrored arcs cannot shed a whole `symmetric` | 2 (8) | The promise is gone; the fixture asks only that the sketch follows |
| Welds: identity is made by the weld; record all; not evidence | 2 (9), 1 (M10) | Every weld without a constraint recorded by class, the classes that reach outside a pattern listed; clusters by single linkage; `shared` says how it was realised. Not taken: exercising such welds in the probe, which cannot show what Onshape would do with them |
| The helper copy: one level; the dump contradicting itself; cache and provenance; agreement of the mating parts; a parameter "in use" that drives nothing | 1 (M9, S2d), 2 (open 2) | All in "Derived sketches and the skeleton" and the probe; the agreement is measured (0 mm over 56 pairs) |
| The distance of two lines only while parallelism is kept | 2 (open 1) | Asserted by the probe at every state; `parallel` joins the unit where it fails. Measured: holds for the three |
| Points of work: point 8 light is not in CLAUDE.md's table; the removal "after the cut" in a point before the cut | 1 (M8), 2 (11) | Point 8 full and narrow; point 2 says what it runs on and what it changes |

### The third round

Two reviews read the second revision (`d4d51ee`) on 2026-11-25, its diff only (the third reviewer was out of quota): the subagent with the dump, which ran the trial again byte for byte, renumbered its constraints in ten ways, changed the removal rule by switches and probed the results (the first below), and codex without the dump (the second). The first found 3 serious and 9 minor points, the second 6 and 4. It was the last round; what could not be settled is in "Known limits".

| Finding | By | What changed |
|---|---|---|
| The removal's candidates are the solver's partial list, which follows the IDs of the constraints: three outcomes for Motor Shell 1 under ten numberings, the parameter not followed in three; the diagnosis's list holds a cure for both sketches; "nothing tried cures it" is wrong | 1 (S1) | Confirmed with the designer's trial under the padded numbering. The candidates are the diagnosis's list; the IDs are zero padded in written order and said to be an input of the solver; four constraints are removed and Motor Shell 1 and 3 follow their parameter and all seven literal dimensions (the document's 14 dimension breaks are 0). The summary, gap 6, the owner's list and the known limits are corrected; that the result still follows the numbering is a known limit and a risk |
| A removal that cures nothing is kept beside one that cures; the loop has no end at zero breaks; "the relation holds" is empty where no state solves | 1 (S2) | A last pass puts every removal back and keeps it back when the probe is no worse; the loop ends at no break; a removal must have been checked at a changed state that solves. Steps that leave the breaks unchanged stay allowed (Motor Shell 3 needs one) |
| "Put back, no point moves" misses a radius | 2 (1) | The check compares points and radii, for every constraint removed so far, against the set as it then is |
| Literal dimensions are candidates and also changes of the probe | 2 (2), 1 (S2) | No driving dimension is a candidate; a refused command is a break |
| A count raised by one gives a pattern with an instance missing, and the probe calls it followed | 1 (S3), 2 (3) | Confirmed with the designer's probe. The design says that a count cannot be changed either way; the probe asserts that the new copy's region is named, so the 8 that "left nothing in error" read as a reference; gap 10 covers both directions; Tests 13 and the owner's list follow |
| "The same by construction" proves a common curve, not interchangeable edges | 2 (4), 1 (M9) | Narrowed to whole circular edges of one side face under a constraint that uses the curve; the entry is one reference, the record names the other, and that it can break alone is a known limit |
| The first verdict hides the others; `kernel` can excuse a reference failure | 2 (5), 1 (M5) | Every verdict of a state is recorded and precedence is only for presentation; "other" and "fails in part" are verdicts; a refused command is one |
| The comparator counts chamfer edges | 2 (6) | It compares which of Onshape's edges were converted, by their place in Onshape's list |
| The acceptance cannot pass as written: "not back" without the helper copies; invalid profiles of counts are no engine gap | 1 (M4), 2 (7) | Acceptance 5 says what is expected with "no" to question 2, admits geometry explained case by case, and says what happens when no candidate cures |
| Signed duplicates at ± π and at zero; expressions compared as text | 2 (8), 1 (M7) | The angle is brought back into its range, a zero has no sign, values are compared at today's parameters and the expression is the one kept |
| The pattern assertion turns one way | 2 (9) | It uses the sense the converter read; the trial did (it reads the sense off the loaded positions), the text did not say so |
| Probe values at zero and at the edge of a range | 2 (10) | A literal zero that is a real dimension gets an absolute step; an angle at π only goes down; a direction that is not available is recorded |
| An operation has several owners | 1 (M1) | Decided when all owners are of one row of the table, else `unknown`; the solid-making types are a list; what the dump shows of `created` is said as read, not known |
| The baseline's "a removed constraint does not hold" lines are artifacts; the pattern assertion needs rows that do not depend on spokes | 1 (M2, M9) | Records are keyed by the studio; the rows come from Onshape's pattern constraints whatever the fate, so point 1 records the baseline's 6 of 40 and 8 of 62 |
| The derived copies: 12 pairs of substance, radii not compared | 1 (M3) | Radii are compared and the pairs that moved are reported (measured again below) |
| No probe is in a position to add `parallel` | 1 (M6) | The sketch's probe runs for a sketch with a distance of two lines and counts the parting as a break |
| "Not back" in a sketch with freedom counted as a break of the sketch's probe | 1 (M8) | A note there, a break only without freedom; the sentence about the baseline in point 2 is corrected |
| The number of states at which a removed relation was checked | 1 (M9) | In the record: 16 for each of the four |

Not taken: nothing was refused outright in this round. Left as known limits, with their reasons: the dependence of the removal on the numbering; no further move when no candidate cures; the size of the probes; the kernel's two failures between the steps; one reference of several for an edge.

## To verify in the implementation

Nothing stands in the way of the first point. What the trial did not cover, so the implementation measures it first on fixtures:

1. **The numbers of "Implied constraints" under the implementation's own numbering**: which constraints are removed, whether Motor Shell 3 is cured of all four dimensions, and the cost. The design's are of one numbering.
2. **Rule 5 of the entry** as a two-way match: the trial relied on the regions and the volumes, which agreed.
3. **A mirror with the second curve as its seed**: how many of the 11 mirrors become entries.
4. **The cut inside the test of a unit, and an entry dropped by rule 5 or 6**: no sketch of the model needs either.
5. **The weld by distance and in clusters, the canonical form of `twice`**: the trial kept the rounded cells and the engine's key; on this model nothing differs.
6. **The decode by the type of the owning feature and with several owners, a pivot that is projected, a pattern point at its pivot, a count that is a parameter, a helper copy that names a further sketch**: none in the model.
7. **A vertex of a body, a linear and an open pattern, an arc with a constraint, a sketch on Front or Right or turned in its plane, a spline under the budget, an angle at 0, 90° or 180°, a literal dimension of zero or at the edge of its range**: none in the model.
8. **The sketch's probe for a "distance of two lines"** in a sketch the diagnosis does not list: the trial asserted the three pairs in the document's probe only.
9. **The numbers of point 1** against "Before"; the run corrects the text if they differ.
10. **`sketchMap` for a source on another parallel plane**: every pair of the model is on one plane.
11. **The intermediate numbers of "Points of work"**: predicted from the causes, not each measured.
