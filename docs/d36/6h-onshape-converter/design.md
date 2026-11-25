# 6h The Onshape converter on the tools of step 6

**State: design, first version, written on 2026-11-25 against `master` at `c01e765` (6a2, 6e, 6c, 6b and 6d merged), with the count by cause taken on the downloaded model and every step tried in a throwaway copy of `tools/onshape` outside the repository ("Measured"). Not reviewed yet, not implemented.** There is no `contract.ts` and no `calls.ts`: the point changes `tools/onshape` and `docs/onshape-import.md` only, no type, command, query or field of the engine, and it takes no decision number ([6-plan.md](../6-plan.md), "6h"; the owner's answers 4 and 25 of [6-cross-review.md](../6-cross-review.md)). Its record is [onshape-import.md](../../onshape-import.md).

The converter gains heuristics over geometry (what an external operand is, when a pattern can be an entry), so its points get a full review, except the two that only count and write docs (CLAUDE.md, "Depth of the review"; "Points of work").

The point in short:

1. **Of the 287 constraints reported lost, 156 are not lost.** 155 are realised by one shared point (Onshape ties the ends of curves by coincident constraints; the converter makes them one point) and one is written twice. **131 of 380 are lost**, and the report says so from now on, by cause.
2. **The tools of step 6 recover 107 of the 131**, measured: 37 on curves the converter split (`split`), 31 on the origin (`origin`, `origin/x`), 13 on a default plane (`origin/x`, `origin/y`), 7 on an entity of another sketch (entries `{ type: 'sketch' }`), 10 patterns (entries `pattern`), 5 mirrors about a line of the sketch, and 4 of the 9 constraints of a kind the converter did not map.
3. **24 stay lost**: 9 patterns whose copies are constrained or crossed (a copy can be neither), 6 constraints of derived sketches on a sketch their studio does not derive, 4 `FIX` of the disc's splines, 3 distances of two lines and 2 midpoints of two points.
4. **The parts do not change**: all 16 volumes within 7e-6 mm³ of today's, the same regions in all 24 sketches, the same 4 of 10 chamfers. 11 of the 24 sketches come out fully determined (none today); the freedom of all sketches together drops from 771 to 159.
5. **Three things differ from the plan's outline**, each because of what the model holds: a mirror or a pattern is an entry only where nothing names or meets its copies (otherwise a mirror is written by `symmetric` and a pattern stays lost); the angle and "horizontal of two points" are mapped here, since 5 of the 6 angles are to a default plane; and the disc's splines convert correctly but cost 108 s a recompute, so a spline has a cap and the disc keeps its generator.

## The brief, and what the measurements changed in it

The plan gives six steps: count by cause, crossing curves by `split`, patterns and mirrors as entries, external operands, splines, count again. The acceptance is the count before and after in `docs/onshape-import.md`, no sketch split with its constraints lost, and the part volumes unchanged. No target was set, because nobody knew how many of the 287 were step 6's.

What the count and the trials settled:

- **The 287 was a miscount.** The converter's line "n of m constraints" counted the constraints it wrote. A coincident constraint of two points is never written: the two are one point of trymesh already. That is 151 of the 380. Four mirrors of a point that is an end of the mirror line are realised the same way, and one constraint was a duplicate.
- **Every external operand in the dump is a bare deterministic ID** (`IB`, `JCC`, `JFE`). `fetch.ts` dumps the geometry behind the queries of features, not of sketch constraints, so the dump does not say what `JFE` is. The origin and the default planes have fixed IDs; the rest is found by geometry ("External operands").
- **Onshape's pattern and mirror are constraints among own curves**: an instance is an entity like any other, with constraints of its own, cut by other curves, a seed of another pattern. A copy of 6c can be none of these. Of the 19 patterns, 9 have a copy that is constrained or crossed, and of the 13 mirrors of curves, 11.
- **All 24 sketches lie on the Top plane with the identity frame.** The mapping of a default plane by the sketch's matrix is therefore tested on fixtures, not on the model.
- **The model has no linear pattern, no open circular pattern, no arc with a constraint, no edge of a body as an operand and no spline but the disc's.** What the design says of those is from the code of the engine and from knowledge of Onshape, and says so.

## The cheap variant

- **No change of the engine.** Every gap found is a row of the backlog ("Engine gaps").
- **No new download.** The dump of 2026-11-25 has everything the count needs; the one thing a new download would add, what an external ID is, is put to the owner ("Open") and is not needed for the acceptance.
- **One mapping table for local and external operands.** An external operand is resolved to an entity of the sketch (an ID and a kind) and the constraint then goes through the table of today. There is no second table "constraints on external geometry".
- **`splitAtCrossings` goes** (70 lines), with nothing in its place but one call of the sketch tool.
- **Tilted sketch planes, mates, drafts, second directions and the rest of the "left out" list of `onshape-import.md` stay as they are.**

## What the plan says, checked against the converter and the dump

| The plan | Read and measured |
|---|---|
| "287 of 380 sketch constraints lost" | 131 lost, 155 realised by a shared point, 1 written twice, 93 written. The 380 count the two derived sketches in both studios that derive them (2 × 40) |
| "six sketches split by the converter with their constraints lost" | True: 38 curves in Housing 1, Input Shaft 1 and 2, Output Shaft 6, Motor Shell 1 and 3; 37 constraints lost with them (and 2 patterns and 2 mirrors that also name a split curve, counted under their own cause) |
| "the converter takes a point as on a curve within 1e-5 mm and the tools within 1e-6" | True of the code. On this model it decides nothing: the 475 contacts of the dump's sketches are exact to 2.8e-14 mm and the nearest miss is 0.42 mm |
| "a default plane seen edge-on becomes `origin/x` or `origin/y` by the sketch's matrix" | Right; every sketch of the model is on Top with the identity frame, where Front is `origin/x` and Right `origin/y` |
| "an entity of another sketch of the studio becomes an entry `{ type: 'sketch' }`; an edge of a body an entry `{ type: 'edge' }`" | 13 such operands, all with a candidate in an earlier sketch; none needs an edge. The dump does not identify them |
| "derived sketches stay copies, with the constraints on them kept" | No sketch of the model constrains itself to a derived sketch (both studios derive after their last own sketch). The six constraints that are lost go the other way: from the derived sketch to a sketch of its source studio that is not derived |
| "splines as `spline` where they are cubic and not rational" | The disc's four are cubic, not rational, not periodic, with 3,145 control points each. As Bezier pieces they are right (the outline's area 2228.709 mm² against Onshape's 2228.71) and too slow (108 s) |
| "a distance other than point–point and point–line, an angle and `FIX` are not step 6's" | The 4 `FIX` are on the splines. 5 of the 6 angles are to a default plane, so step 4 cannot recover them without the angle; all six map. 3 distances of two lines stay lost |
| `convert.test.ts` needs the dump | It is not in the root run: the root `vitest.config.ts` includes `packages/*/test/**/*.test.ts` and `tools/**/*.unit.test.ts`; the converter runs only by its own config. So a test named `*.unit.test.ts` runs in CI and must not read a dump |

## The count by cause

### Fates

Every Onshape constraint of every converted sketch gets exactly one fate, recorded where the converter decides it:

| Fate | What it means |
|---|---|
| `written` | One or more constraints of trymesh stand for it (a mirror of two lines is two `symmetric`) |
| `entry` | A pattern or a mirror written as an entry `pattern` of the sketch |
| `shared` | Realised by the geometry: two points that are one point of trymesh; a point "on" a curve it is an end of; two copies of one entry |
| `twice` | The same constraint was written already for another Onshape constraint |
| `lost` | Nothing stands for it; it has a cause |

The headline number is `lost`. `written` counts Onshape constraints, not commands, so a sketch no longer reads "13 of 12".

### Causes

A lost constraint has one cause, the first of this list that applies, so the causes add up to the lost:

| Cause | When |
|---|---|
| `pattern` | A sketch pattern that is not an entry (the detail says why) |
| `origin` | An external operand that is Onshape's origin |
| `plane` | An external operand that is a default plane |
| `sketch` | An external operand that is an entity of another sketch (the detail: not found, or in a sketch the studio does not derive) |
| `edge` | An external operand that is an edge of a body |
| `unknown` | An external operand nothing fits |
| `mirror` | A mirror of two curves about a line of the sketch |
| `spline` | An operand is a spline or an ellipse the converter left out |
| `arc` | An operand is an arc (the converter gives an arc no kind today; none on this model) |
| `split` | An operand is a curve the converter split (the baseline only) |
| `refused` | Written, then dropped by the check (the solver moved the geometry, a conflict, the command refused) |
| `kind` | A kind of constraint the table does not have (the detail names it: `DISTANCE of two lines`) |

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
| An entity of another sketch | 13 | COINCIDENT 11, EQUAL 2 |
| A pattern | 19 | CIRCULAR_PATTERN 19 |
| A mirror of curves about a line of the sketch | 5 | MIRROR 5 |
| A spline | 4 | FIX 4 |
| A kind without a counterpart | 9 | HORIZONTAL of two points 3, DISTANCE of two lines 3, MIDPOINT of two points 2, ANGLE 1 |

By type this is the list known from the report: COINCIDENT 56, CIRCULAR_PATTERN 19, MIRROR 13, HORIZONTAL 11, DIAMETER 11, ANGLE 6, FIX 4, DISTANCE 4, TANGENT 3, EQUAL 2, MIDPOINT 2.

### The report and the counting code

- **`tools/onshape/fates.ts`** (new): the types `Fate` and `Cause`, and a `Tally` that the `Report` holds. `tally.add(sketch, constraintType, fate, cause?, detail?)` is called once per Onshape constraint, at the place that decides it; a test asserts that the fates of a sketch add up to its constraints.
- **The line of a sketch** in `report.md`: `Sketch 2: 6 points, 4 curves; of 12 constraints 9 written, 2 shared, 1 lost; 5 degrees of freedom, 1 redundant`, and under it one line per cause: `Sketch 2: lost: 1 MIRROR (a default plane)`. The line "constraints without a counterpart: {…}" goes.
- **A section at the end**, `## Sketch constraints`: the two tables above, as the run found them.
- **`summary.json`** beside `report.md`: the fates and causes, per sketch its fates, freedom, redundant constraints, validity and the areas of its regions, and per part its body and volume in full precision. The acceptance compares two of these files; the report prints volumes to 0.1 mm³, which is too coarse for "unchanged".

## Crossing curves

`splitAtCrossings` and its 1e-5 tests go. The sketch is written whole (its points, its curves uncut, its entries, its constraints) and executed; then

```ts
sketchTool('split', { sketch, result, parameters, document, features }, {}, freshIds(document, `${id}.cut.`))
```

is called once, and its commands are executed as one batch. The tool cuts every contact of two outline curves, joins ends at one place, moves each constraint to the piece that carries it and turns a point held on a curve at a cut into the shared point (D65). `Converted.kind` keeps every curve, so no constraint is dropped for naming one.

- **Exact duplicates first.** Two curves of the same kind over the same points (a circle: the same centre point and radius within 1e-6) are written once, and the kind map points the second at the first. That is what is left of the old "collinear overlaps kept once"; a partial overlap is no longer repaired ("Known limits").
- **A refusal is reported, not worked around.** The tool refuses what a cut cannot repair (curves lying on each other, two arcs that only touch, a circle with one point). The report then has the tool's message and the first rows of the query `sketchContacts`; the sketch stays as written and its extrusions report no region.
- **Checked again after the cut**: the status of the sketch and the positions against Onshape's, as before it.
- **The regions.** `matchRegion` reads the sketch after the cut, as it read the converter's pieces. A piece has a new ID (`Sketch_2.cut.c5`, the first piece keeps the ID of its curve), which nothing outside the sketch names.

Measured on the six sketches, with nothing else changed:

| Sketch | Curves cut | Tool: changed, added, points | Regions before and after | Largest difference of an area | Written before, after | Tool, batch |
|---|---|---|---|---|---|---|
| Housing 1 | 17 | 17, 47, 32 | 34, 34 | 6.5e-8 mm² | 3, 5 of 11 | 11, 56 ms |
| Input Shaft 1 | 2 | 2, 2, 2 | 3, 3 | 3.0e-9 | 0, 1 of 5 | 1, 1 |
| Input Shaft 2 | 2 | 2, 6, 6 | 5, 5 | 1.1e-8 | 1, 9 of 12 | 1, 3 |
| Output Shaft 6 | 13 | 13, 35, 24 | 25, 25 | 1.4e-8 | 0, 4 of 16 | 4, 19 |
| Motor Shell 1 | 2 | 2, 14, 16 | 9, 9 | 3.2e-12 | 12, 27 of 47 | 2, 5 |
| Motor Shell 3 | 2 | 2, 14, 16 | 9, 9 | 0 | 1, 8 of 16 | 2, 4 |

The numbers of curves and points after the cut equal the converter's in every sketch (66, 4, 10, 49, 25, 25 curves). 37 constraints come back, the 37 of the cause. No point moved, no conflict, every part volume and every chamfer as before.

## Patterns and mirrors

### When an entry

An Onshape pattern lists its instances: the seed entities and, for each further instance, their images. A mirror of curves is one constraint per pair. Written as an entry `pattern` (D68), the images are not made as own geometry: they are the copies of the entry.

**A pattern or a mirror is an entry only when all of this holds** (the rule of the entry):

1. **No other constraint names an image** (a curve of an image or one of its points), except a coincident constraint of two images, which the copies realise. A constraint cannot name a copy.
2. **No outline curve outside the entry meets an image**: crosses it, touches it, or ends on it. A copy is never cut, and a point cannot be held on it, so an own curve that crosses a copy leaves the profile invalid for good (6c, "Where a curve meets a copy"). An own end at the end of a copy would join by position (D68), but nothing could hold it there; the trial counts it as a meeting too.
3. **No image is a seed or an instance of another pattern or mirror** (a copy is no source). This is rule 1 read for patterns; of two nested ones the outer can be an entry.
4. **The transform can be said**: a circular pattern closed over the full turn with a pivot that is a point of the sketch; a mirror about a line of the sketch or a default plane that is an axis of the origin. An open circular pattern and a linear pattern are in "Not on this model".
5. **The copies land on Onshape's images.** After the sketch is previewed, every image curve of Onshape coincides with a curve of the entry (a line by its two ends, a circle by centre and radius, within 1e-6). If not, the entry is dropped and the instances are written as own curves.

The entry:

```ts
{ type: 'addExternal', sketch, id: `${sketch}.pattern${n}`,
  ref: { type: 'pattern', sources: [/* the seed curves, and seed points no seed curve has */],
         transform: { type: 'circular', center: /* the pivot */, count: /* patternc1 */, span: { type: 'full' } } } }
```

`count` is the expression of `patternc1` (`6`, or `N` for `#N`), so the count follows a parameter. A mirror is `{ type: 'mirror', axis }` with the line of the sketch or `origin/x`, `origin/y`.

### Otherwise

- **A mirror of two curves is written by the symmetry of their points**: `symmetric` for each pair of points (the ends of two lines paired by reflecting the positions; the centres of two circles, with `equalRadius`; the centre and the swapped ends of two arcs). A pair that is one point is on the mirror line: nothing when it is an end of that line, else `pointOnCurve` with it. Both curves stay own, so they can be constrained and cut. The fate is `written`.
- **A pattern stays lost**, its instances own curves as today, with the cause `pattern` and the rule that failed. There is no set of constraints that stands for a turn by 2π/n without construction geometry for every instance ("Rejected").
- **The mirror of two points** stays `symmetric`, as today.

### Measured

| | Entries | Not entries, and why |
|---|---|---|
| 19 circular patterns | 10: the six holes of the disc; Global Sketch 2 (12 × 2 circles) and the outer pattern of Global Sketch 3 (12 × 6 lines and a circle), each in two studios; Motor Shaft 3; Output Shaft 2, 4 and 5; one of the two of Motor Shell 2 (two circles, four times) | 5 hexagons (Motor Shaft 2, Input Shaft 4, Hex Standoff 1, the inner pattern of Global Sketch 3 twice): the coincidence that closes the ring names a copy; in Global Sketch 3 the hexagon is also the seed of the outer pattern. The other one of Motor Shell 2: a distance to a copy. 3 whose copies cross a curve outside: the 16 pin pockets on the bore of Housing 1, Output Shaft 6, Motor Shell 3 |
| 13 mirrors of curves | 2: two circles of Motor Shell 2 about the Right plane | 11 as `symmetric`: 7 whose image is mirrored again (Motor Shell 1 builds a four-fold symmetry from mirrors of mirrors), 4 with another constraint on the image (a tangent line, a point held on it) |

With the entries, the sketches that have them hold far less: Global Sketch 3 goes from 85 curves and 180 degrees of freedom to 8 curves and 11; all sketches together from 520 curves and 409 points to 275 and 208. 63 coincident constraints of two images are `shared` by the copies. The regions of the ten converted sketches with entries are the same in number and equal in area within 1.5e-13 mm².

### Not on this model

- **An open circular pattern** (`openPattern` true) has an angle the dump does not show a parameter for. It is written with `span: { type: 'angle' }` only when rule 5 can check it; the angle and its sense are read from the positions of the first image. Until a dump shows the parameter, its expression is lost (a number).
- **A linear pattern**: the shift is read from the positions of the first image; the entry is written when the shift runs along `origin/x`, `origin/y` or a line of the sketch, with the count of `patternc1` (and a second direction for `patternc2`), and checked by rule 5. The parameter names are from knowledge, not from a dump.

## External operands

### What an external ID is

A constraint names an external operand by `externalFirst`, `externalSecond` or `externalMirror`, a query with one deterministic ID and nothing else.

1. **`IB` is the origin**, and becomes `origin`.
2. **`JCC`, `JDC`, `JEC` are the Front, Top and Right planes.** A default plane is a line in the sketch when it is perpendicular to the sketch plane: with the plane's normal `n` and the base of the sketch, `origin/x` when `n` is along the base's Y and `origin/y` when it is along the base's X; a plane parallel to the sketch is no operand. Every sketch of trymesh the converter makes stands on a base plane or a plane feature offset from one, so its origin is the world's origin cast onto it and both lines pass through it.

    | Sketch on | Front (XZ) | Top (XY) | Right (YZ) |
    |---|---|---|---|
    | XY | `origin/x` | none | `origin/y` |
    | XZ | none | `origin/x` | `origin/y` |
    | YZ | `origin/y` | `origin/x` | none |

    The three IDs are from knowledge of Onshape. On this model `JDC` is Top by the dump (the plane of all 24 sketches, normal (0, 0, 1) through the origin); `JEC` and `JCC` are confirmed by the geometry: every mirror about `JEC` reflects across x = 0 and about `JCC` across y = 0, and every angle to `JCC` is its value measured from +X.
3. **Any other ID is found by geometry**, per studio, since an ID means one entity in all sketches of a studio:
    - **All its uses are collected first**: every constraint of every sketch of the studio that names it, with its local operand.
    - **The entity exists before the first sketch that names it**: candidates are the entities of the sketches made from features before that one (own sketches and copies of derived ones; own points and curves, and copies of entries), on a plane parallel to the sketch, mapped into it by `sketchMap`.
    - **It fits every use**: for a point coincident with it, a point at that place (1e-6) or a curve through it; for a circle equal to it, a circle of that radius; for a line parallel, perpendicular or at an angle to it, a line.
    - **Of several, the most specific and the earliest**: a point before a curve, then the order of the timeline, then the order of the IDs. The report says how many there were: `COINCIDENT with JQx: Sketch_1.tzY0… (a circle), 1 of 3 by geometry`.
    - **Then the edges of bodies**, when no sketch entity fits: the state before the sketch, the query `body`: an end or the centre of an edge at the place of a point, an edge through it, a circular edge of the radius of a circle. The entry is `{ type: 'edge', body, edge, kind }` (D23). No operand of this model gets this far.
    - **Nothing fits**: the cause `unknown`.
4. **A derived sketch** (`importDerived`) is a copy, as today, and its constraints are converted like any sketch's. Its own external operands live in its source studio: the uses are collected there, and the candidates are the copies this studio has of sketches of that studio before the first use. An operand in a sketch this studio does not derive is lost, with the cause `sketch` and that detail. A sketch of the studio that names an entity of a derived sketch finds it among the copies by rule 3.

The entry of a sketch entity:

```ts
{ type: 'addExternal', sketch, id: `${sketch}.ref${n}`, ref: { type: 'sketch', sketch: source, entity, kind } }
```

One per entity of the source, reused by every constraint of the sketch that names it. Own points are never merged with a projected point: the point of the sketch stays own and is tied by the constraint (6b, "The Onshape converter").

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

`midpoint` and `equalLength` do not take an axis (D71); such a constraint is lost with the cause `plane`.

**"Horizontal" is Onshape's, not trymesh's.** The converter draws in the frame of the base plane, and Onshape's horizontal is the X of the sketch's matrix. Along the base's X it is `horizontal` (`origin/x`, `horizontalDistance`); along the base's Y it is `vertical`; turned otherwise, the constraint is lost with the cause `kind` ("the sketch is turned in its plane"). Today the converter writes `horizontal` whatever the matrix says; no sketch of the model shows it.

### Measured

- **The origin**: 31 of 31 written (22 `coincident`, 8 `pointOnCurve` with `origin/x`, 1 `horizontalDistance` with the expression `E`).
- **The default planes**: 13 of 13 (5 angles, 6 mirrors by `symmetric`, 2 mirrors as entries).
- **Another sketch**: 7 of 13 written. 4 operands have one candidate (Housing 2, Input Shaft 2 twice, Output Shaft 3); 3 are picked by the rule: `JKM` of Output Shaft 4 and 5 is the centre of a circle of Sketch 2 (the other candidate is a circle through it), and `JQx` of Motor Shaft 3 a circle of Sketch 1 (it fits two lines of Sketch 2 as well). **6 are lost**: the constraints of Global Sketch 2 and 3 on Global Sketch 1, which neither studio derives.
- **Without the rule "before the first use"** two of those six were written on a wrong entity: a point of the copy of Global Sketch 2 at the same place, which is itself held on the entity meant.

## Kinds taken along

Two kinds the plan left to the backlog are mapped, because the external operands need the first and the second costs a line:

- **ANGLE of two lines.** trymesh measures from the direction of `a` to the direction of `b`, counter-clockwise, in (−π, π]; Onshape gives an unsigned value and three flags the converter does not read. The angle is measured on the positions, and of the forms `e`, `-(e)`, `pi - (e)`, `(e) - pi` of the Onshape expression `e` the one whose value (`expressionValue` over the parameters of the document) equals the measured angle within 1e-6 is written; none fits: the measured number, with a note. The converter's `expression` also learns `45.0*deg`, which it passed through unchanged. Measured: all 6 angles written with their expression (5 as `e`, 1 as `-(e)`).
- **HORIZONTAL or VERTICAL of two points**: `verticalDistance` (or `horizontalDistance`) of 0 between them, a driving dimension. Measured: 3 of 3. It reads as a dimension of 0 in the app; a constraint of its own is a backlog row.

Left lost, as the plan says, each a backlog row:

- **DISTANCE of two lines** (3; a distance to a circle is the same kind): the distance of an end of one to the other, with `parallel`, would stand for it; not written, because it is two constraints for one and the pair may be parallel by another constraint already.
- **MIDPOINT of two points** (2, the centre of a rectangle drawn from its centre): needs a construction line between the two points.
- **`FIX`**: of a point it is `fixed` at its place, and of a converted spline `fixed` on every control point, so an imported shape cannot drift; of a line or a circle it is lost with the cause `kind`. The 4 of the model are on the disc's splines, which are not converted, so their cause is `spline`.

One more correction: **a point "on" a curve it is an end of** is `shared`, not written. Today it is written as `pointOnCurve` and is one of the two redundant constraints of the baseline (one case, Input Shaft 4). The trial did not apply it; with it the "after" column of "Measured" reads 183 written and 156 shared.

## Splines

Onshape's spline is in `features.json` (`BTCurveGeometrySpline`: `controlPoints` flat in metres, `knots`, `degree`, `isRational`, `isPeriodic`); the geometry endpoint (`sketches.json`) has only its two end points and its parameter range. The converter reads the control points from the feature's entity and the IDs of the end points from the geometry endpoint (one of the disc's four splines has them empty in the feature).

1. **Not converted, listed with the reason**: rational, periodic, a degree above 3, a segment that is not the whole knot range, more pieces than the cap.
2. **A clamped uniform cubic of up to 64 control points** (the knots equally spaced within 1e-9 of the range) is one `spline` over its control points: the curve of D70 exactly.
3. **Any other non-rational spline of degree 1 to 3** goes through `bsplineBeziers` (D70 exports it for this): one `spline` of `degree + 1` points per piece (a line for degree 1), neighbouring pieces sharing their end point.
4. **The points**: the first and the last control point are the spline's end points of Onshape and are merged by position like any end; the inner control points are own points that are never merged with anything.
5. **The cap: 256 pieces in one sketch.** Measured on the disc's two visible splines:

    | Pieces | Points | The batch of the sketch |
    |---|---|---|
    | 16 | 49 | 13 ms |
    | 64 | 193 | 9 ms |
    | 256 | 769 | 77 ms |
    | 1,024 | 3,073 | 1.7 s |
    | 6,285 (both splines whole) | 18,855 | 108 s |

    The whole outline is right: one region with an outer loop of 6,285 curves, the area by the pieces 2228.709 mm² (Onshape: the region with its bore and six holes, 2228.71), the extrusion 8914.87 mm³ in 0.27 s. But every recompute of that sketch would take 108 s, and it would hold 37,710 degrees of freedom.
6. **The disc keeps its generator** (`overrides/actuator-5010.ts`, D61): its splines are over the cap, are listed, and the override builds the disc. With the six holes as an entry, the override's reading of the hole regions (regions with one curve in the outer loop) still finds the bore and six holes; its volume is unchanged.
7. **A region bounded by a spline** is matched as other regions: the area, and for a spline of the loop the Onshape edge of the kind `other` whose two ends are the spline's and whose middle lies on its polyline within 1e-3.

No spline of the model is under the cap, so rules 2 to 4 and 7 are tested on fixtures only.

## The order within a sketch, and the check

1. Read the entities: points merged by position, lines, circles, arcs, splines.
2. Decide the entries (rules 1 to 4 of the entry); their images are not made.
3. Collect the constraints: resolve external operands (which adds reference entries), map each, record its fate.
4. **The check**, by preview, as today: the sketch is not in error, has no conflicting constraint, and every point is within 1e-4 of Onshape's place. Rule 5 of the entry is checked on the same preview.
    - all constraints with their expressions;
    - else every dimension as its measured number;
    - else **one by one**: the constraints are added in the order written, each kept when the check still passes (with its expression, else its number), each other one lost with the cause `refused` and the reason. This replaces "without constraints": with three times as many constraints written, one bad one must not cost the sketch all of them.
5. Execute; call `split`; check again.

On this model every one of the 24 sketches passes with all its constraints and their expressions, before and after the cut, so the second and third steps of the check are tested on fixtures.

**Redundant constraints stay.** The engine names 10 after the conversion (2 today). They are Onshape's own: a centre held on the X axis and also on a projected point of that axis; the third mirror of a four-fold symmetry. They are consistent, the sketches solve, and dropping them would be a loss by the count. The report gives their number per sketch.

## Regions and the features over a sketch

- **`matchRegion` reads `solvedCurves(sketch, result)`** in place of `document.curves`: a curve of the outer loop may be a copy (`Sketch_2.pattern0/3/Sketch_2.abc`), which the document does not hold. The function is otherwise as it is.
- **The names of side faces** change where a curve is now a copy or a piece of the tool. Nothing in a converted document names a face but through the lookups by geometry (`trymeshFace`, the edges of chamfers), which read the body.
- **The override of the disc** needs no change (measured).

## Measured (2026-11-25)

The model: the dump of the cycloidal actuator 5010 of 2026-11-25 (the assembly, 8 part studios with their dumps, 66 parts of other documents as STL). The baseline: the converter at `c01e765`, 31 s. The trial: a copy of the converter with every step of this design but the splines, the edges and the check one by one; 31 s as well.

**Fates, before and after** (380 constraints, 24 sketches):

| Fate | Before | After |
|---|---|---|
| Written | 93 | 184 |
| Entry | 0 | 12 |
| Shared | 155 | 155 (92 by a point, 63 by copies) |
| Twice | 1 | 5 (4 mirrors of two points that a mirror of their lines already writes) |
| Lost | 131 | 24 |

**The lost, by cause:**

| Cause | Before | After | By what |
|---|---|---|---|
| A curve the converter split | 37 | 0 | `split` (6e) |
| The origin | 31 | 0 | `origin`, `origin/x` (6a2) |
| A default plane | 13 | 0 | `origin/x`, `origin/y` (6a2), with the mirror and the angle |
| An entity of another sketch | 13 | 6 | entries `{ type: 'sketch' }` (6b) |
| A pattern | 19 | 9 | entries `pattern` (6c) |
| A mirror of curves about a line of the sketch | 5 | 0 | `symmetric` |
| A spline | 4 | 4 | |
| A kind without a counterpart | 9 | 5 | `angle`; a dimension of 0 |
| Refused by the check | 0 | 0 | |

**The sketches:**

| | Before | After |
|---|---|---|
| In the first step of the check (all constraints, with expressions) | 24 of 24 | 24 of 24 |
| Points moved, conflicting constraints | 0, 0 | 0, 0 |
| Valid profile | 24 | 24 |
| Regions | the same number in every sketch; the largest difference of an area 6.5e-8 mm² | |
| Degrees of freedom, all sketches | 771 | 159 |
| Fully determined sketches | 0 | 11 |
| Redundant constraints | 2 | 10 |
| Own curves, own points | 520, 409 | 275, 208 |

**The parts** (with the override of the disc; volumes in mm³ of the baseline, for the implementation to compare with):

| Part | Volume | Part | Volume |
|---|---|---|---|
| Cycloidal Disk | 4951.520 | Output Shaft Front | 17118.317 |
| Housing Front | 5665.516 | Output Shaft Rear | 7360.887 |
| Housing Middle | 22171.440 | Output Shaft Spacer (six) | 43.900 |
| Housing Rear | 5725.680 | Motor Shell | 22516.843 |
| Input Shaft | 891.154 | Hex Standoff | 224.294 |
| Motor Shaft | 2561.152 | | |

The largest difference of a volume between the baseline and the trial is 6.9e-6 mm³ (3.1e-10 of the part, Housing Middle). The same 4 of 10 chamfers convert, with the same refusals; 31 starts at a face are `from`; the loaded document has 333 bodies.

**The tolerances of step 2**: over all sketches of the dump, 475 pairs of a point and a curve, or of two curves, are in contact, the worst by 2.8e-14 mm; the nearest pair that is not is 0.42 mm apart.

## What stays lost, and where it stands

| Lost | Count | Where it stands |
|---|---|---|
| A pattern whose copy is named by a constraint (5 hexagons closed by a coincidence, 1 distance to a copy) | 6 | Engine gap 1 |
| A pattern whose copies cross a curve outside it (the pin pockets on the housing's bore) | 3 | Engine gap 1 |
| A constraint of a derived sketch on a sketch its studio does not derive | 6 | The converter's: "Open", question 2; a sketch of another document is not projected (D62 brings bodies) |
| `FIX` of the disc's splines | 4 | The splines are over the cap; the generator replaces them |
| DISTANCE of two lines | 3 | Backlog row, a kind of constraint |
| MIDPOINT of two points | 2 | Backlog row, a kind of constraint |

## Engine gaps

Rows of `docs/backlog.md` the closing point adds; none is fixed here.

1. **A pattern or a mirror among own curves.** The copies of D68 cannot be constrained or cut, which is what keeps 9 of the 19 patterns of this model out: a hexagon drawn as a pattern of one side is closed by a coincidence on a copy, and pin pockets patterned on a bore cross it. The backlog has the variant already as "a sketch tool that makes a batch of copies tied by constraints" (6c chose derived geometry); the row gains the measured need, and the two narrower forms: a constraint that may name a copy, and an own curve cut where a copy crosses it.
2. **Horizontal and vertical of two points** as a constraint (today a dimension of 0).
3. **A midpoint of two points; a distance of two parallel lines, and from a line to a circle.**
4. **A sketch of thousands of spline pieces**: 108 s for 6,285 pieces (18,855 free points), where 256 take 77 ms. Either a spline refitted within a tolerance, or the cost of the sketch step with many free points looked into; which part is slow was not measured.
5. **A sketch of another document projected**: a derived sketch stays a copy that drifts from its source.

Found on the way and not an engine gap: `fetch.ts` does not dump what the external operands of sketch constraints are ("Open", question 3).

## Acceptance

1. **`docs/onshape-import.md` has the two tables of "Measured"**, fates and causes, before and after, as the implementation's runs give them. The "before" column is taken by the first point of work with the converter otherwise unchanged, and has to give the numbers of "Before" above.
2. **No sketch is split by the converter**: `splitAtCrossings` is gone; no sketch of the model is left with an invalid profile after `split`; no constraint has the cause `split`.
3. **The parts are unchanged**: every volume of `summary.json` within 1e-3 mm³ of the baseline's `summary.json` (the table above), the same number of regions in every sketch with areas within 1e-6 mm², the same chamfers and fillets converted, the same number of starts written as `from`, the same number of bodies in the loaded document.
4. **The lost are at most 24**, by the causes of "What stays lost". A higher number is explained cause by cause in the notes, not accepted silently.

## Where the code lives

All in `tools/onshape/`; nothing in `packages/`.

| File | What |
|---|---|
| `fates.ts` (new) | `Fate`, `Cause`, `Tally`; the tables of the report and `summary.json` |
| `constraints.ts` (new) | The mapping of constraints, moved out of `sketch.ts`: the table, the angle, the symmetry of a mirror, the check one by one |
| `operands.ts` (new) | What an external ID is: the origin, the axis of a default plane, an entity of an earlier sketch, an edge; the uses of an ID over a studio |
| `derived.ts` (new) | The rule of the entry, the entries `pattern` |
| `sketch.ts` | The entities (with splines), the order of "The order within a sketch", the call of `split`, `matchRegion` over `solvedCurves`; `splitAtCrossings` removed |
| `studio.ts` | Passes the studio's features to the sketch (for the uses of an ID and for derived copies); the volumes into the summary |
| `common.ts` | `expression` reads `45.0*deg`; the `Report` holds the `Tally` |
| `convert.test.ts` | Writes `summary.json` |
| `kit.ts` (new), `*.unit.test.ts` | Fixtures in the shape of Onshape's JSON, built by small functions, and the unit tests |

`fetch.ts`, `assembly.ts`, `extent-start.ts` and the override are not changed.

## Points of work

Each point is closed as CLAUDE.md says: implemented, tested, documented, reviewed, fixed, two commits. After every point the converter is run on the dump and its `summary.json` compared with the one before.

| Point | What | Review |
|---|---|---|
| 1 | The count: `fates.ts`, the fates recorded in the converter as it is, the report and `summary.json`. The document written must be byte for byte the baseline's. The "before" tables into `docs/onshape-import.md` | Light: it adds counting and changes no conversion |
| 2 | Crossing curves by `split`; `splitAtCrossings` removed | Full |
| 3 | External operands (the origin, the default planes, another sketch, an edge), the angle and the two-point kinds, the check one by one | Full |
| 4 | Mirrors and patterns: the rule of the entry, the entries, `symmetric`; `matchRegion` over `solvedCurves` | Full |
| 5 | Splines, with `FIX` | Full; small |
| 6 | The close: the "after" tables, the sections "Sketches" and "Gaps" of `docs/onshape-import.md`, the backlog rows, "As implemented" here | Light: documents only |

Points 3 and 4 are the risky ones. If the review of either finds more than six issues with three serious ones, it gets a second round (CLAUDE.md, "Further rounds").

## Tests the implementation owes

The unit tests run in the root run and read no dump: each builds a part studio of one to three sketches in the shape of Onshape's JSON with `kit.ts` (entities, constraints with their parameters, the sketch matrix), writes it to a temporary folder in the layout of `fetch.ts` where a whole studio is converted, and runs the converter with the real adapters. Nothing in a fixture is copied from the owner's document; the IDs are made up.

1. **The tally**: the fates of a sketch add up to its constraints; the tables as text; the first cause of the list wins.
2. **Crossing curves**: a line through a circle that has a diameter and a point held on it: two D-shaped regions, the diameter written, the point shared; a line that touches a circle: not cut; two overlapping collinear lines: the refusal reported, the sketch left; two identical circles: one.
3. **The origin**: coincident, horizontal and vertical of a point, a horizontal distance with a parameter, on sketches on XY and on XZ with a flipped normal.
4. **The default planes**: the table of "What an external ID is" on the three base planes and an offset plane; a plane parallel to the sketch; a mirror and an angle to each axis; a sketch turned in its plane (horizontal lost with its reason).
5. **Another sketch**: one candidate; a point and a curve through it (the point); the same ID in two sketches (before the first use); nothing fits; a derived copy whose operand is not derived; a sketch that names an entity of a derived copy; a source on a parallel offset plane.
6. **An edge**: a circle equal to a circular edge of an extrusion; a point on the end of a straight edge.
7. **Mirrors**: an image that nothing names (an entry); an image with a tangent line (by `symmetric`, the profile valid after the cut); a mirror of a mirror; a point on the mirror line; two arcs.
8. **Patterns**: holes on a circle with the count a parameter (an entry; the count changed, the body follows); a hexagon of one side (lost, the instances own, the region as before); pockets across a circle (lost, cut by `split`, the regions as Onshape's); a pattern of a pattern (the outer an entry); an entry whose copies do not land (dropped by rule 5); an open and a linear pattern.
9. **The angle**: the four forms, a value that fits none.
10. **Splines**: a uniform cubic of six points (one spline); a non-uniform one (a chain, its area against the polygon of its samples); rational, periodic, over the cap (listed); `FIX`; a region bounded by a spline matched.
11. **The check one by one**: a dimension with a wrong value among good constraints: the others stay, the one is `refused`.
12. **`matchRegion`** with a copy in the outer loop.

The run on the dump is the acceptance, made by hand at every point and recorded in `docs/onshape-import.md`.

## Risks

For a reviewer, the riskiest first.

1. **A wrong entity picked by geometry.** Three of the seven operands found in other sketches had more than one candidate. A wrong pick still holds on today's positions (so the check passes) and shows only when a parameter changes: a centre held on a circle through it rather than on the point meant. The report names every pick with its number of candidates; the dump cannot settle it ("Open", question 3).
2. **The rule of the entry is the converter's own geometry test**, at 1e-5, while the engine decides a contact at 1e-6. A contact of a copy the rule misses leaves an invalid profile, which the report shows (`valid` of the sketch) and rule 5 does not. On this model no pair lies between the two tolerances.
3. **A recovered constraint moves the geometry or conflicts.** The check catches it (positions within 1e-4, no conflict), and the step one by one drops only the constraint at fault. A constraint that holds now and misbehaves later is not caught: an angle written as `pi - (e)` is right at today's value and wrong in sense if the design flips.
4. **Redundant constraints** (10) are kept. They are consistent now; one that is redundant only at today's numbers turns into a conflict when a parameter changes, as it would in Onshape.
5. **The volumes are checked on one model.** The unit tests cover the shapes of this model and the cases it lacks; a second real model was not converted.
6. **Removing `splitAtCrossings`** removes the repair of partly overlapping collinear lines, which the tool refuses. Not on this model.
7. **A sketch with entries has other IDs than Onshape's instances.** A later change of the converter that names an instance by its Onshape ID (an override, a chamfer by curve) would find nothing; lookups go by geometry and should stay so.
8. **The dump is not in the repository**, so the acceptance cannot be repeated by CI or by a reviewer without the owner's copy. The numbers of "Measured" are the reference.

## Rejected

- **Every pattern and mirror as an entry, as the outline says.** Nine patterns and eleven mirrors have a copy that is constrained or met by a curve. As entries, three sketches would be left with an invalid profile (the housing's bore is crossed by fifteen copies that cannot be cut), which changes the parts, and the constraints on images would be lost in place of the pattern.
- **Every mirror by `symmetric`, no mirror entry.** One mechanism, and it always works. Not taken: the two mirrors that can be entries cost nothing beyond the rule the patterns need anyway, and an entry is what a person would draw.
- **A circular pattern among own curves by constraints**: for every instance point a construction spoke from the pivot, `equalLength` with the seed's spoke and an `angle` of k·2π/n. Exact, but it adds a construction line and two constraints per point (a hexagon: 6 spokes, 10 constraints), and the count is no parameter. It is the "tool" variant of 6c's question, a backlog row.
- **Closing a hexagon on its seed**: replacing the coincidence on a copy by two spokes to the ends of the seed and their angle of 2π/n, so the pattern could be an entry. It is a recognition of one shape; the distance across flats names a copy as well.
- **Copying the sketches a derived sketch depends on** ("Open", question 2).
- **Keeping `splitAtCrossings` as the fallback** when the tool refuses: two cutting codes with two tolerances, the second with the losses this point removes.
- **Dropping redundant constraints**: they are Onshape's, and the count would call them lost.
- **A target count.** The acceptance is the tables and the bound of 24 this model gives.

## Known limits

- **A pattern that is not an entry is lost**, its instances free. A hexagon of the model opens when its seed is dragged.
- **Partly overlapping collinear lines** are refused by `split` and reported; the old converter cut them.
- **An operand found by geometry may be another entity than Onshape's** at the same place.
- **A spline of more than 256 pieces in a sketch is left out**, and a region bounded by it is not converted, as today.
- **An open pattern loses the expression of its angle; a linear pattern is written from positions.** Neither was seen in a dump.
- **Constraints that name a point of a spline between its ends** (a spline drawn through points in Onshape) have no counterpart: nothing holds a point on a spline (D70). From knowledge; the model's splines are imported and have none.
- **The converter still builds no tilted plane**, so a default plane is an axis only for sketches parallel to a base plane, which are all it converts.

## Open

**Three choices are the owner's. None holds the implementation up: the design goes ahead with the recommendation unless the owner says otherwise.**

1. **The angle and "horizontal of two points" in this point**, though the plan names the angle among the kinds left to the backlog. *Recommendation: yes.* Five of the six angles are to a default plane and step 4 cannot recover them otherwise; all six map with their expressions, and the three two-point constraints by a dimension of 0. Without them the lost are 33, not 24.
2. **The six constraints of derived sketches on a sketch that is not derived** (the pattern centres of Global Sketch 2 and 3 are held on Global Sketch 1). The converter could copy the sketches a derived sketch depends on, as further copies. *Recommendation: no; they stay lost and are listed.* It would put a third copied sketch into two studios (18 more constraints in the count, so "before" and "after" would no longer be the same 380), for a link that in Onshape lives in another studio.
3. **What an external ID is, from Onshape.** One FeatureScript call per studio (`sketchEntityQuery` for every entity of every sketch, and the geometry of the IDs that are no sketch entity) would say it exactly, in place of the geometry search; `fetch.ts` would write it to a file of its own and the converter would prefer it. *Recommendation: not in 6h.* It needs the API (about 8 calls of the FeatureScript budget of about 150), the acceptance does not depend on it, and the search found a candidate for all 13. Worth doing before a second model is converted; a line in the notes until then.

For the owner to know, since they follow from the measurements and not from the plan:

- **The headline was 131, not 287.** `docs/onshape-import.md` says "93 of 380 have a counterpart"; the closing point corrects it.
- **Nine patterns stay lost by a limit of D68**, not by the converter (engine gap 1).
- **The disc's splines convert, and are not used**: 108 s a recompute.

## To verify in the implementation

Nothing stands in the way of the first point. What the trial did not cover, so the implementation measures it first on fixtures:

1. **The check one by one**: no sketch of the model needs it.
2. **An edge of a body as an operand, a linear and an open pattern, an arc with a constraint, a sketch on Front or Right, a spline under the cap**: none in the model.
3. **Rule 5 of the entry** as a test of positions: the trial relied on the regions and the volumes, which agreed.
4. **The point of work 1 gives the "before" numbers of this text** with the document unchanged; if it does not, the count is wrong, not the text.
5. **`sketchMap` for a source on another parallel plane**: every pair of the model is on one plane.
