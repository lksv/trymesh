# 6d Splines, the cheap variant (D70)

**State: designed 2026-11-17 against `master` at `e70cd65` (schema version 10; 6a, D64, implemented and merged; 2h, D66, merged), on Opus 5.5; reviewed as recorded in "Reviews". Not implemented.** 6e (trim, extend, split, D65) is being implemented on another branch and refuses a spline by name; 6c (mirror and pattern in a sketch, D68) is designed and is merged before 6d, which adds the spline to its derive; 6b (D69) and 6f come after or beside 6d and take what "Other packages" says.

Files: [contract.ts](contract.ts) (the curve, the module `spline.ts`, what the profile, the solver port, the result, the commands and the app add), [calls.ts](calls.ts) (validation scenario 15, step 4 with the grip and the part of step 7 that is 6d's, the refusals, a closed spline, a crossing one, a change of control points).

The package in short:

1. **A curve kind `spline`** over control points that are ordinary points of the sketch: `{ type: 'spline', points: Id[] }`, 3 to 64 points, a clamped, uniform, non-rational B-spline of degree min(3, n − 1). Closed when the first point comes again as the last. No other field.
2. **The solver sees only the points.** The spline is in the solver's input as every own curve is; the adapter adds nothing for it, the analysis no equation. No constraint takes a spline; tangency at an end is a constraint on the end leg of the control polygon, which existing constraints say.
3. **The profile takes a spline as one curve over its polyline** within the chord tolerance (a bound of the second derivative per Bezier piece, measured to keep the tolerance); its tests of crossing, touching and self-crossing run on that polyline. A loop through a spline has no exact curves, so the offset, the taper and the revolve refuse it by one message naming the spline; the wall refuses it at the command.
4. **The side face is one face per spline, `{ role: 'side', curve }`, a swept surface** along the extrusion, as the side of gear teeth; its edges are of the kind `other`, so they are not projected, chamfered or filleted.
5. **No command, no constraint, no query, no issue code, no schema step.** The app gets a tool Spline (click the control points; Enter, or a click on the first point to close) and draws the control polygon; MCP shows the spline through the generated `describe_api` and `get_sketch`.

## What the plan and the backlog say, checked against the code

| Statement | What the code says |
|---|---|
| "A curve kind `spline` over control points that are ordinary points of the sketch (own points or the origin)" (6-plan.md) | A curve names its points by ID and the validator accepts own points and `origin` (`curve` in `features/sketch.ts`). A list fits that rule; the table `CURVE_POINTS` (`sketch-content.ts`) maps a kind to fields of one ID each, so a list is a new form there (below, "The curve") |
| "The solver sees only the points: the adapter passes them and nothing for the curve" | `solverSetup` passes every own curve to the solver (`sketch.ts`); the adapter's `buildPrimitives` throws for an unknown kind (A1 of 6a); the points are pushed as point primitives whatever curve uses them, so a control point with no constraint is a free point (measured below) |
| "The analysis of freedom gets no equation from it" | `SketchAnalysis` takes equations from constraints and from the rules of arcs (`arcRows`); a curve that no constraint names and that is not an arc gives none (`analysis.ts`) |
| "Tangency at an end is a constraint on the end leg of the control polygon, which existing constraints express" | True: `pointOnCurve` holds a point on a line including its extension (the second control point on the line that ends at the first: tangent), and `tangent` of a line and an arc holds a construction leg tangent to the arc; measured with the real solver below |
| "The profile samples the curve within the chord tolerance; its crossing test runs on the samples" | The profile is a planar graph of half-edges over lines and arcs (`profileOf`, `sketch.ts`); a spline fits in as one more kind of `Shape` with its polyline, as an arc is divided by `segments` |
| "The side face is a general surface (the kind of the side of a generated profile)"; the backlog: "of the `swept` kind, as for gear teeth" | Both: `curveOf` answers `{ type: 'general' }` and the prism builds that side as `FaceInfo` `swept` along the normal of the sketch (`tool-prism.ts`), published as `Surface` `swept`. The general shape of a side is the swept surface of an extrusion |
| "Its edges have the kind `other`, so they cannot be projected or chamfered" | `edgeKind` (`solid.ts`) gives `other` to every edge with a swept face; a projection refuses it (`unsupportedProjection`), a chamfer and a fillet too (`unsupportedEdge`, D63) |
| "The offset and the wall of a spline are refused with `invalidProfile` naming the curve" | The offset reads the exact outline (`selectionOutline` of `recompute/outline.ts`), which refuses a loop without `exact` with a text about a generated profile. The wall's command refuses a curve whose kind is not in `WALL_CURVE_KINDS` (`features/profile.ts`), which is structural and earlier |
| "Whether the revolve takes it as it is is to be checked" | It does not: `revolveSetup` (`tool-revolve.ts`) reads the exact outline too, re-divides it for half the chord tolerance and builds round faces from it. Refused, with the offset's message (decision below) |
| "A closed outline of one spline is a spline whose first and last points are one point" | The half-edge graph takes an edge from a vertex to itself (a forward and a backward half, two loops); an arc may not, but nothing in the graph forbids it |
| 6a's spike: a spline stops `tsc` at 13 places in 11 files; the separate unions (`Shape` of the profile, of `sketch-tools.ts`, of the app) and the exact outline (`OutlineCurve`, Ring 2) are not reached by it | True; every place, with what it does with a spline, is in "Every switch on the kind of a curve" |

Not in the plan, found in the code:

- **`CURVE_POINTS` and its guards** require every field of a shape other than `type` to be listed as a point name (`Complete` in `sketch-content.ts`). A spline's `points` is a list, not a point name; `setCurvePoint` (D52) and the app's re-pointing (`repointRow`) read the table.
- **`removeEntity` of a point removes every curve on it** (`curvePoints(c).includes(id)`, `document.ts`): removing a control point removes the spline.
- **A snap to a curve becomes `pointOnCurve`** in the engine's sketch tools (`placeAnchor`) and in the app; on a spline that constraint is refused, so a snap to a spline has to be refused before it.
- **2h's start at a plane** (`exactStart`, `recompute/extent.ts`) falls back to the points of the polyline for a loop without `exact`, so a spline profile can start at a plane with no change.
- **The section query** writes a span on a swept face across the sweep as a `curve` of mesh corners, and the export of an outline (D54) writes a curve span as straight pieces; nothing there needs the spline.

## The cheap variant

What 6d does:

- The curve kind, its validation, and a case for it at every switch on the kind of a curve (the engine, the solver adapter, the app).
- `spline.ts`: the Bezier pieces of a B-spline and the polyline of a spline within the chord tolerance.
- The profile: a spline as one shape over its polyline; the self-test; closed splines; loops through a spline named in `Loop.sampled` and without `exact`.
- The side faces of a spline (swept) and the refusals of the offset, the taper, the revolve and the wall.
- The app: the tool Spline, the curve and its control polygon in the view, no snap to a spline.
- The docs of the area and the comment of the curve in `types.ts`, which `describe_api` shows the AI.

Deferred:

- **The full variant** (the plan): a point on a spline, a tangency in its middle, a dimension of the curve, which need planegcs `bspline`, `point_on_bspline` and a parameter per point on the curve in the solver port.
- **A spline through given points** (interpolation): a later sketch tool that computes control points and sends this curve.
- **Non-uniform knots, degree above 3, weights (rational), periodic splines**: an imported spline of any knots becomes a chain of Bezier splines exactly (`bsplineBeziers`); conics are refused by 6f.
- **The revolve, the offset, the taper and the wall of a spline**: they read an exact outline, and a spline has none (decision below; Open 1 for the revolve).
- **An exact edge kind for the straight edge where a spline flank meets a planar side**, and a fillet or chamfer of any edge of a spline face.
- **In the app**: inserting or removing one control point, dragging the curve itself.
- **The Onshape converter's mapping** of B-splines (Open 2).

## Measured

All in the session scratchpad (`6d/`), with the real engine of `master` at `e70cd65` where an engine is named.

**A. The polyline.** A prototype of `splinePolyline`: the clamped uniform knot vector, Boehm's insertion of every inner knot to multiplicity p, and per Bezier piece `ceil(sqrt(M / (8 tol)))` equal steps of its parameter, M the largest length of `p (p − 1) (B[i+2] − 2 B[i+1] + B[i])`. The deviation is measured by 50 points per step against the chord.

| Spline | Tolerance | Pieces | Largest deviation | Of the tolerance |
|---|---|---|---|---|
| The grip of scenario 15 (5 points, 2 spans) | 0.1 | 6 + 6 | 0.0372 | 0.37 |
| | 0.01 | 19 + 19 | 0.00402 | 0.40 |
| | 0.001 | 58 + 58 | 0.000441 | 0.44 |
| 2000 random splines (3 to 10 points in a square of 100 mm; tolerances 0.1, 0.01, 0.001) | | | | at most 1.000, on average 0.78 |

The bound is tight for a quadratic piece (its second derivative is constant) and about 2.5 times too fine for the grip; it never failed. The polyline of the reversed control points equals the polyline reversed to 2e-14 (it is not computed so: the profile computes it once per curve, in the order of the points). The end points come out exactly the first and the last control point.

**B. The area of the lid with two grips** (scenario 15, step 4; W 84, H 54, R 5, the grip 4 deep, the legs 10). By hand the grip takes 9.8 · d mm² ([calls.ts](calls.ts), the derivation over its two Bezier pieces): 39.2 per grip, and the prototype's Gauss–Legendre integral, exact for a polynomial, gives 39.200000. So the lid is 4514.5398 − 78.4 = 4436.1398 mm².

| | Tolerance 0.01 | 0.001 |
|---|---|---|
| The polygon of the lid (lines, arcs by `segments`, the grips by the polyline) | 4435.9046 (−0.2352) | 4436.1149 (−0.0249) |
| One grip's polygon against 39.2 | 39.2221 (+0.022) | 39.2024 (+0.0024) |

**C. The real profile and kernel**, the spline put in as a chain of own lines through its polyline at 0.01 (the shape the profile divides a spline into), both halves own geometry: 82 curves, the profile valid, one region, the sketch in 31 ms; extruded 2 mm the volume is 8871.8091 mm³ against 8872.2796 by hand, the area from the volume 4435.9046, as the polygon of B. The chain also tells how the profile's tests meet a spline's pieces: a spline tangent to a line at its end (its first leg along the line) gives a valid profile with one region; a spline whose control polygon makes it cross itself gives an invalid one. The time of `detectProfile` for a chain of 188, 588 and 1307 pieces (each piece a curve, so every pair is tested): 23, 170 and 805 ms; a spline as one shape tests its pieces only against the other curves and itself by a sweep, so this is an upper bound.

**D. The solver.** The half of the lid with the grip's control points and its legs (`l1`, `l2`: construction lines, vertical and tangent to the corner arcs), solved by the real planegcs adapter without the spline (which is what the solver sees once the spline is in): status ok, 0 degrees of freedom, no redundant constraint; g1 (42, 15), g2 (38, 27), g3 (42, 39), a3 (42, 49), a5 (0, 54); `grip` 6 moves g2 to x = 36.

**E. A closed spline** over the corners of a square 20 × 20 (five entries, the first again at the end): the exact area 240 (Gauss–Legendre), the polygon at 0.01 is 239.8216 with 82 pieces, at 0.001 239.9822 with 260.

## Decisions

### The curve

`{ type: 'spline'; points: Id[] }`, with `construction?` as every curve. The comment of the contract (section 1) goes into `types.ts` at `CurveShape`, where `describe_api` gives it to the AI.

- **Control points**: own points of the sketch or `origin`, at least 3 and at most 64 (`MAX_SPLINE_POINTS`). No point twice, except the first again as the last, which closes the spline; a closed spline has at least three different points (four entries). A projected or derived point is refused, as for every curve (a curve names own points; a coincident joins a point to a projected one).
- **Degree**: min(3, n − 1) of the n entries: 2 for three points, 3 otherwise. Cubic is what every source of step 6 carries (an SVG `C`, a cubic DXF `SPLINE`, Onshape's B-splines from knowledge); three points are an SVG `Q` exactly.
- **Knots**: uniform and clamped, 0 repeated p + 1 times, 1 to m − 1, m repeated p + 1 times (m = n − p spans). Not stored: they follow from n. Four points are one cubic Bezier curve.
- **Not rational, not periodic.** A closed spline is clamped at its point: it leaves along the first leg and arrives along the last, a corner unless the two legs are put on one line by a constraint (the three points on one line: a `pointOnCurve` of the second point on a construction line through the last two, for example).
- **No `degree`, `knots` or `weights` field.** No source needs one: a B-spline of any knots and of degree up to 3 is a chain of Bezier pieces exactly, each a spline of 4 points (3 for degree 2), joined at shared points. A field added later is dropped by this build without a word (the validator rebuilds a curve from the fields it knows), so it needs an upgrade step then.
- **`CURVE_POINTS.spline = []`.** A spline has no named point, so the table, the completeness guard and `CurvePointName` keep their meaning ("the fields that hold one ID"); the guard is changed to count only those fields. `CURVE_KINDS` (its keys) then includes `spline`, so the validator accepts it once its switch has the case. `curvePoints(spline)` is the list as it is, the closing repeat included.
- **`EntityKind` gets `spline`.** No constraint lists it among the kinds it takes, so every constraint on a spline is refused by the catalog with today's text ("… je spline, čeká se line nebo circle nebo arc").

### The solver and the analysis

- The spline stays in `SolveInput.curves`, as every own curve: the stamp of the sketch includes it, and the port keeps saying "the curves of the sketch" (the full variant would turn it into a primitive there). The adapter's case checks that each control point is a point of the input (`point(id)`, as for the ends of a line) and adds no primitive; its `rank` of the tangency table gets the entry `spline: 3`, never reached (the engine refuses the constraint), and the pair it would form throws as an unknown pair does today.
- The analysis gives a spline no row; `pointsOf` reads `curvePoints`, so a constraint never touches it. The control points are free points with two degrees of freedom each until constrained; the diagnosis lists them as free (measured D: 0 degrees of freedom once the grip's points are dimensioned).
- `ports.md` gets the sentence: "a spline in `curves`: an adapter adds no primitive and no equation for it; its control points are points of the input".

### Tangency and the snap to a spline

- **At an end, by the control polygon**: to a line that ends at the spline's first point, `pointOnCurve` of the second point on that line (it holds the point on the extension too, so the side is the solver's start); to an arc or a circle through the first point, a construction line from the first to the second point and `tangent` of it and the arc (measured D: the legs of the grip tangent to the corner arcs, solved, no conflict). The same at the last point with the last leg. The comment of the curve says both recipes.
- **No point is held on a spline.** A snap to a spline is refused by the engine's sketch tools (`anchorProblem`: "a point cannot be held on a spline; snap to a control point or leave the place free"), and the app's mode skips splines when it snaps to a curve, for every tool. A control point may snap onto a line, an arc or a circle (held on it): that is how the app's tool makes a tangent end.

### Commands

No new command.

- `addCurve` takes a spline; `radius` is refused for it as for every curve but a circle.
- `setCurvePoint` (D52) refuses a spline by its own text, before the generic one: "… is a spline, which has no named points; to change its control points, remove it and add it again under its ID in one batch". No constraint names a spline, so the batch loses nothing (the construction flag is given again with the curve), and the features that name it in a region keep the name (D52 measured that an ID removed in a batch can be given again; calls.ts, `sixPoints`).
- `removeEntity` of a control point removes the spline, as it removes a line with its end: the rule of the cascade stays one rule. Removing a point from the list instead is the batch above.
- `setConstruction`, `dragPoint` and `removeEntity` of the spline itself work as for every curve.

### The polyline (`spline.ts`)

A leaf of the engine beside `sketch-content.ts` (types and `util.ts` only; `repository.md` gets the row, `modules.test.ts` the module):

- `bsplineBeziers(control, knots, degree)`: Boehm's knot insertion until every inner knot has multiplicity `degree`, then one piece per span of non-zero length. General, for 6f and the converter.
- `splineBeziers(control)`: the same over the clamped uniform knots of the spline.
- `splinePieces(bezier, tolerance)`: `ceil(sqrt(M / (8 · tolerance)))` steps of the parameter of the piece, at least 1, at most 4096 (`MAX_SPLINE_PIECES`, the cap of `segments` for arcs), M the largest length of the control points of the second derivative. A chord over a step h lies within h² M / 8 of the curve (measured A: never above the tolerance).
- `splinePolyline(control, tolerance)`: the pieces in order, each at its equal steps by de Casteljau, then the last control point. The first and last points are the control points, exactly.

Rejected: a fixed number of steps per span (does not follow the tolerance), the arc rule `segments` (a spline has no radius), adaptive subdivision by a flatness test (deterministic too, but a recursion and a second rule where a closed form exists).

### The profile

A spline is one more kind of the profile's `Shape`: `{ kind: 'spline', id, a, b, pa, pb, pts }`, the polyline from `pa` to `pb`. `placedCurve` (6a's one shape function) gets the case: its ends read as a line's ends are (at the joined vertex in the profile and the wall, raw in `curveOf`), the control points between raw, as a centre is, the first and last replaced by the end positions; the profile computes the polyline from them at the chord tolerance of the document, once per curve.

- **Validity of the curve itself**: a spline whose polyline has no length above the length tolerance, or whose polyline comes within the length tolerance of itself away from two consecutive pieces (a crossing, a touch, or a piece folding back onto the one before), makes the profile invalid, as two crossing curves do. The test is a sweep over the pieces, as `polygonProblem` does for a loop (the first and the last piece of a closed spline are consecutive).
- **Ends**: a spline whose ends are one vertex (the same point, or two points joined) is closed: one forward and one backward half-edge from that vertex to itself, which the graph turns into two loops (an outer one and a hole of the other sense), a region named by the spline alone when nothing else meets the vertex. An open spline with both ends at one vertex is that case too. Otherwise its ends are two vertices, as a line's are.
- **Touches with other curves** (`compatible`): each piece of the spline is taken as a line shape against the other curve (or against each piece of another spline) by the rule of today: the contacts of the carriers, the ends and the middle of the pieces as candidates, a candidate within the length tolerance of both curves allowed only within the reach of a shared vertex (10 tolerances plus the reach of a round partner, as today). A box of each piece skips the far ones. The chain of C is this test with each piece a curve of its own; it found the tangent join valid and the crossing invalid.
- **The half-edges**: the direction a half leaves its vertex is the direction to the point of the polyline at the distance of the rule of today from the vertex (half the shortest of the curves at the vertex; for a spline its chord, or for a closed one the length of its polyline): the rule of the arc, which turns the tangent by the chord's angle, says the same. The curvature for a tie is that of the end of its Bezier piece, signed by the direction.
- **The area of a loop**: the polyline's pieces in the direction the loop passes them, in place of the chord.
- **The polyline of a loop**: the points of the polyline between the ends, keyed `c:<spline>:<k>` by their index in the polyline (as an arc's), in reverse for the backward half: regions on both sides of a spline share them.
- **Inside a loop** (the ray of `crossings`): piece by piece.
- **`Loop.exact` and `Loop.sampled`**: a loop that passes a spline has no `exact`, and `sampled` lists its splines in the order it passes them. A loop that passes none keeps its exact curves, so a region of the same sketch away from its splines is offset, tapered and revolved as today.
- **`soundTessellation`** runs on the loops as today.

Measured (C) with the chain; "To verify" asks the same cases of the real shape.

### Faces, edges and names

- **The side face** of a spline in an extrusion is `{ feature, role: 'side', curve: <spline> }`, one face for the whole spline, closed or open, as for every curve; its surface `swept` with the axis the normal of the sketch (the prism builds a side of the shape `general` so, as it builds the side of gear teeth). [naming.md](../../architecture/naming.md) gets the sentence; no rule of names changes. A copy of 6c is `side` with `m/1/c2`.
- **Its edges** are of the kind `other`: with the caps, and with a neighbouring side, planar or round, even where that edge is straight (calls.ts, `lidWithGripChecks`: four edges of the grip face, all `other`). So: no projection of them (`unsupportedProjection`), no chamfer or fillet (`unsupportedEdge`), and a chamfer of a straight edge of the top that runs on smoothly into a spline's edge is refused too (D63, "runs on smoothly into the second edge"; adding that edge is refused by its kind).
- **A sketch cannot stand on the face** (`nonPlanarFace`), and it is no axis (`invalidAxis`).
- **The extent `upTo` (2f) and the start `from` (2h)** build the same sides; `exactStart` takes the polyline of a loop without `exact`.

### What reads the exact outline

`selectionOutline` (`recompute/outline.ts`), through which the offset of regions (2a), the taper (2b) and the revolve (4a) read the outline, refuses a selection with a loop that has `sampled`: `invalidProfile` with the splines of the whole selection in `refs` (each once, sorted) and the text "The curve "c2" is a spline, which has no exact form: a profile with a spline cannot be offset, tapered or revolved. Draw that part with lines and arcs, or leave the offset, the taper or the revolve out." (plural for more). The text for a loop without `exact` and without `sampled`, a generated profile, stays.

- **The revolve**: a revolved spline is a general surface of revolution, which no `FaceInfo` describes (a `swept` surface is a translation), and the revolve re-divides the exact outline for half the chord tolerance. Taking it would need a variant of `OutlineCurve` for a spline (its control points, so that the division can be redone), the exhaustive switches of Ring 2 over it (6a counted about 25), and a general face kind besides `mesh`. Refused here; Open 1.
- **The offset and the taper**: the offset of a spline is not a spline; moving its polyline would make one face of many planes under one name, against what a side of an offset is (an exact surface). Refused.
- **The wall**: `WALL_CURVE_KINDS` stays `line`, `arc`, `circle`, so the command refuses a spline (structural, with the kinds in the text); a wall whose curve ID names a spline later (removed and added again in a batch) is refused in the recompute by the case of the spline in the wall's switch, `invalidProfile` "The curve "c2" is a spline; a wall runs along lines, arcs and circles.", `refs` the spline.

### Every switch on the kind of a curve

The places of 6a's part 3 (its numbering) and the separate unions, with what each does with a spline. "Never an operand" means: no constraint and no generator takes a spline, so a validated document never reaches the case; it throws as `unreachable` does, with the text of the place.

| # | Place | A spline |
|---|---|---|
| E1 | `CURVE_POINTS` | `spline: []`; the guard counts the fields of one ID |
| E2 | `curvePoints` | the control points, in order |
| E3 | `curve` (validator) | the case: the list, the limits, the repeats (contract, `SPLINE_REFUSALS`) |
| E4 | radii of circles | none (no radius; `addCurve` refuses one) |
| E5 | `setCurvePoint` | refused by its own text |
| E6 | `measure` (radius, diameter) | never an operand: no value |
| E7, E8 | the profile's shapes and the eight functions over `Shape` | the spline shape ("The profile") |
| E9 | `curveOf` | `{ type: 'general' }` |
| E10 | the circle operand of a generator, the axis `sketchLine` | none: they ask for one kind |
| E11 | the wall (`wallOfCurves`) | refused, `invalidProfile` |
| E12–E14, E16 | `EQUATIONS.pointOnCurve`, `tangent`, `geometry.radius`, the size in `derive` | never an operand (the size: no radius, as a line) |
| E15 | `pointsOf` | `curvePoints` |
| E18 | `shapeOf` of `sketch-tools.ts` | undefined: nothing snaps to a spline; `anchorProblem` refuses the snap first, by its kind |
| E19 | `closestOn` of `sketch-tools.ts` | unchanged (`shapeOf` gives no spline) |
| E20 | `cornerLines` (`ends`) | the first and last control point (`curveEnds`), so a corner of a line and a spline is refused naming "c2" (spline) |
| E21 | `nearestCurvePoint` | none (no named point) |
| E22 | the catalog's kinds | unchanged: no constraint takes a spline |
| E23 | `solverSetup` | passes it as every own curve |
| E24 | `WALL_CURVE_KINDS` | unchanged: refused |
| — | `curveEnds` (`sketch.ts`) | the first and last control point |
| — | `placedCurve` | the case of "The profile" |
| — | `anchorProblem` (`sketch-tools.ts`) | a snap to a spline refused |
| — | `selectionOutline` | the refusal of "What reads the exact outline" |
| — | `exactStart` (2h) | unchanged: the loop's polyline |
| A1 | `buildPrimitives` | its points checked, no primitive |
| A2, A3, A5 | `pointOnCurve`, `equalRadius`, `radius`/`diameter` of the adapter | never an operand: throw |
| A4 | `rank` of the tangency | `spline: 3`, never reached |
| A6 | `fixed`, `usable`, `pairOf` | none: they ask for one kind |
| P1 | `sketchView` (own curves) | the view's spline shape: control polygon and polyline |
| P2 | `polyline`, `closestOn`, `measure` (radius), `anchorOf` | the polyline; the nearest point of it; no radius; never an operand |
| P3 | `sort` | in no group (no constraint, no dimension from it) |
| P4 | `roundDimension` | never reached (`sort` gives no spline) |
| P5 | `CURVE_POINT_LABELS`, `repointRow` | unchanged; a spline has no re-pointing rows |
| P6 | the pickers of lines | none |
| — | `anchorAt` of `sketch-mode.ts` | skips splines when it snaps to a curve |
| M1 | `sketchDetail` | lists the curve with `points`; the advice for an invalid profile adds "or a spline crosses itself" (the line is written in English, as it changes) |

`OutlineCurve` (Ring 2) gets no variant, so its consumers stay as they are; the profile simply gives them no exact outline for a loop through a spline.

### Queries and exports

- **`section`**: a spline face across the sweep is a `curve` span through the corners of the mesh, along the sweep a `line` span (the table of `section.ts`); nothing changes.
- **DXF and SVG (D54)**: the export writes a curve span as straight pieces through its points, so a spline is a polyline of the mesh, within the chord tolerance; not a DXF `SPLINE`. The section is of the mesh and does not know the spline (a `SPLINE` would need the face to carry its control points). Scenario 15 compares the areas of the section read back by 6f, which a polyline keeps (calls.ts, `lidSection`).
- **`measure`**: a spline face is `swept` with its direction and no distance (as gear teeth); `mass`, `gap`, `print`, `body`, `partsList`: from the mesh, unchanged.
- **The hole feature, a joint, a generator, an axis**: a control point is a point and is taken where a point is; nothing else of a spline is.

### The app

- **The tool Spline** (`packages/app/src/sketch-tools/spline.ts`, one line of `SKETCH_TOOL_UI` after `arc`): click the control points; Enter draws the spline through them (three at least, else a message and the places stay); a click on the first point again, with three places before it, draws the closed spline; Escape drops them. Each place becomes a control point by `placeAnchor` (a point snapped is used again; a place on a line, an arc or a circle is a new point held on it, which gives a tangent end when it is the second point and the first is that line's end). No `clicks`: `click` keeps every place and redraws the scene. `draw` shows the control polygon to the cursor and, from three places, the spline. The switch of construction curves applies (`drawn`).
- **The view** (`sketch-view.ts`): a spline's shape is its control polygon and its polyline by `splinePolyline` at `VIEW_TOLERANCE` (0.0005) times the largest side of the box of its control points, a rule of the view as the arc's π/48 is; the regions the view fills are the engine's. The scene draws the control polygon of every spline of the open sketch thin and dashed and does not pick it; the control points are own points, drawn, picked and dragged as every point (a drag solves the sketch as today).
- **No snap to a spline**, for every tool (`anchorAt`).
- **The panel**: the curve's kind reads "Spline"; no re-pointing rows; the construction switch and delete as for every curve.
- **The snapshots** of `packages/app/test/app.test.ts` change: the bar has one more button. The commit says so.

### MCP

- `describe_api` shows the curve and its comment (`types.ts`) with no change in `packages/mcp`.
- `get_sketch` lists a spline as `{ id, type: 'spline', points }`; its control points are in `points` with their freedom; the advice for an invalid profile names a self-crossing spline.
- **No sketch tool.** A spline is `addPoint` for each control point and one `addCurve`; tangency is one more constraint (the comment of the curve). A tool with a list of anchors and tangency flags would add an input kind to the shared `SketchToolInput` (6e adds two) for what the AI writes in three lines; rejected. The spline through given points (deferred) is the tool that will be worth one.

### The Onshape converter

Not changed by 6d (Open 2). The recipe, for when a model needs it: `tools/onshape/sketch.ts` maps a non-rational B-spline of degree 1 to 3 (its poles, knots and degree, from knowledge of the format, not checked against a dump) by `bsplineBeziers` to a chain of splines of `degree + 1` points (degree 1: lines), the poles own points, the ends of neighbouring pieces one point, no constraints (Onshape's constraints on a spline have no counterpart); a rational one (a conic) stays left out with a note. The actuator of `docs/onshape-import.md` has splines only in the cycloidal disc, which the generator of D61 replaces with a better, exact profile; so the mapping has no model that needs it yet.

### Other packages

- **6c (mirror and pattern)**, merged before 6d: 6d adds the spline to the derive's exhaustive switch: a copy of a spline runs over the copies of its control points in the same order (the image of a clamped B-spline under an isometry is the B-spline of the images); `occupies` compares the control points in order or reversed, within the length tolerance. The copy's ends are `curveEnds` of the copy, so the joins of 6c take it as they take a line. The grip of scenario 15 is that copy ([calls.ts](calls.ts), `oneRegionWithGrip`).
- **6e (trim, extend, split)**: refuses a spline by name and takes no contact with it as a cut (its design). 6d's profile shape is the case its switches refuse.
- **6b (projection from another sketch)**: a projected spline is a spline of the result over the projected control points (each a projected point keyed by its source vertex, by 6a's rule); it forms regions only with the reference's flag, as every projected curve. 6b decides it; 6d gives the shape.
- **6f (import of an outline)**: an SVG `C` is a spline of 4 points, a `Q` of 3, a chain of them splines sharing their ends; a DXF `SPLINE` of degree 2 or 3, not rational, becomes `bsplineBeziers` pieces, each a spline (degree 1: lines); rational and degree above 3 refused and listed.

## The document and the schema

A spline is a new member of `CurveShape`. **An older build refuses it by itself**: the validator of a curve takes the type from a list (`CURVE_KINDS` since 6a, a hand-written list before), so a load or a command with a spline fails with "…type: čeká se jedna z hodnot line, circle, arc", and a stored document (D62) is validated the same way. Nothing is dropped without a word, so **no upgrade step** and `SCHEMA_PENDING` stays 0. A field added to the spline later (`knots`, `degree`, `weights`) would be dropped by this build's validator, which rebuilds the curve from the fields it knows, and needs a step then.

## Where the code lives

| File | Change |
|---|---|
| `packages/engine/src/types.ts` | `CurveShape` gets the spline with its comment (contract section 1) |
| `packages/engine/src/catalog.ts` | `EntityKind` gets `spline` |
| `packages/engine/src/spline.ts` (new) | the Bezier pieces, the steps, the polyline |
| `packages/engine/src/sketch-content.ts` | `CURVE_POINTS.spline`, the guard, `curvePoints` |
| `packages/engine/src/features/sketch.ts` | the case of the validator |
| `packages/engine/src/document.ts` | `setCurvePoint`'s refusal |
| `packages/engine/src/sketch.ts` | `curveEnds`, `placedCurve`, the profile's spline shape, `Loop.sampled` |
| `packages/engine/src/recompute/profile.ts`, `outline.ts` | `curveOf`; `selectionOutline`'s refusal; the wall's case |
| `packages/engine/src/analysis.ts`, `sketch-tools.ts` | the cases of the table above; `anchorProblem` |
| `packages/engine/src/index.ts` | exports `bsplineBeziers`, `splineBeziers`, `splinePolyline`, `MAX_SPLINE_POINTS` |
| `packages/solver-planegcs/src/index.ts` | A1 to A5 |
| `packages/app/src/sketch-view.ts`, `sketch-commands.ts`, `sketch-mode.ts`, `sketch-tools/spline.ts`, `sketch-tools/index.ts`, the label of the kind | the view, `splineCommands`, the snap, the control polygon, the tool |
| `packages/mcp/src/tools.ts` | the advice text |
| `packages/scenarios/test/` | scenario 15, step 4 with the grip, by [calls.ts](calls.ts) |
| docs | `architecture/sketch.md` (the kind, the profile, the solver), `naming.md` (the face), `extrude.md` (the side), `revolve.md` (the refusal), `ports.md` (the input), `repository.md` (the module), `ui/sketch.md` (the tool), `decisions.md` (D70) |

**Points of work** (CLAUDE.md, one commit each with its review): (1) the engine and the adapter: the kind, `spline.ts`, the profile, the faces, the refusals, every switch, with their tests; review **full** (new geometry). (2) The app: the tool, the view, the snap; review light. (3) Scenario 15, step 4 with the grip in `packages/scenarios`, and the docs.

## Issue codes

None. A self-crossing or touching spline makes the profile invalid as crossing curves do (`invalidProfile` of the features over it); the offset, the taper, the revolve and the wall refuse with `invalidProfile` and a text; edges are refused with the codes of today.

## Rejected alternatives

1. **The full variant now** (planegcs `bspline`, a point on a spline, tangency in its middle). It changes the solver port (a parameter of the curve per point on it) and the analysis; the plan defers it until a part needs it.
2. **A curve through given points** as the kind. Natural to write, but the control points follow from all the points at once (moving one bends the whole curve), the end tangents need conditions of their own, and every source of step 6 carries control points. It is a later tool that sends this curve.
3. **Fields `degree`, `knots`, `weights`.** No source needs them once a B-spline is split into Bezier pieces, which is exact; each would be a validator, a recompute and a schema step for no part.
4. **A periodic closed spline.** Wrap-around knots and a second form of every function over a spline; closing by the first point again, with the legs on one line where smoothness matters, covers a closed outline.
5. **The spline outside the solver's input** (filtered by the engine). The adapter would never see it, but the input would no longer be the curves of the sketch, and the full variant would have to put it back; the adapter's case is two lines.
6. **A spline as a chain of lines drawn by a tool.** No single face, no editing of the curve, an ID per piece.
7. **A `setCurvePoints` command, or `setCurvePoint` with an index.** No constraint names a spline, so removing it and adding it again in a batch loses nothing.
8. **A cascade that keeps the spline when one of its control points is removed** (the point dropped from the list). An exception to the one rule of the cascade, which would change the degree and the knots without a word.
9. **An exact outline for a spline (its polyline as lines)** so the offset and the taper would run. The offset of a spline is not a spline: one side would become many planes under one name.
10. **A DXF `SPLINE` in the export.** The export writes a section of the mesh, which does not know the spline.
11. **An edge kind `line` where a swept face meets a plane along the sweep.** Nothing that reads a `line` edge (a projection, a chamfer, a fillet) handles a swept face; the kind would promise what they cannot keep.
12. **A sketch tool `spline` in `SKETCH_TOOLS`** (a list of anchors, tangency flags). See "MCP".
13. **The polyline of a spline in the sketch's result** for the app. The app calls the engine's sampler, so the computation stays in the engine, and the result does not grow for every sketch.
14. **Sampling by a fixed count per span, by the arc rule, or by adaptive subdivision.** See "The polyline".

## Known limits

- **No point on a spline and no tangency in its middle**; no dimension of the curve itself (its length, a distance to it). Constrain the control points.
- **Uniform knots only**: an imported spline of other knots becomes several splines, so several faces.
- **A touch of a spline and another curve away from a shared end is decided by the polyline**: within the chord tolerance of a tangency it can come out valid (the polyline passes beside) or invalid (it crosses).
- **A closed spline has a corner at its point** unless constraints put its first and last legs on one line.
- **Every edge of a spline face is `other`**, also the straight one where it meets a planar side: no chamfer, fillet or projection of it, and none of a straight edge that runs on smoothly into it.
- **No offset, taper, revolve or wall of a spline.**
- **Removing a control point removes the spline**; edit by replacing it in a batch. The app has no insertion or removal of one control point.
- **At most 64 control points**: a longer curve is several splines joined at their ends.
- **The DXF and SVG of a section write a spline as a polyline** within the chord tolerance.

## To verify before the implementation

- The cases of "Measured" C with the spline as one shape of the real profile: the lid (valid, one region, the volume of the chain to float precision: the same polyline), a tangent join to a line and to an arc (valid), the crossing spline (invalid), a spline touching a line between vertices, a closed spline alone and with a line at its point, and the time of the profile of two splines of 64 points at the tolerance 0.001 crossing each other's boxes (expected well under the 805 ms of the chain of 1307 pieces).
- That `splinePolyline` of the engine gives the prototype's points (the scenario's volume depends on them).
- 6a's spike again with the real variant: every place of the table stops `tsc` or is in the table as "none".
- That a spline in the solver's input changes no position (the same sketch with and without a spline over its points).
- That 6c's derive with a spline joins the copy's ends as a line's (6c merged first).
- That `modules.test.ts` takes `spline.ts` as a leaf.
- That the app's snapshots change only by the new button and its hint.

## Tests the implementation owes

- `spline.ts`: the Bezier pieces evaluate to the B-spline (de Boor) at random parameters; the polyline keeps the tolerance on random splines (the measurement A as a test); the ends exact; `bsplineBeziers` on a non-uniform knot vector.
- The validator: each refusal of `SPLINE_REFUSALS`, a projected point, a radius; `setCurvePoint`; the cascade of a control point; a constraint on a spline refused; the replacement in a batch keeps the names.
- The profile: the cases of "To verify"; `Loop.sampled`; a region away from the splines of its sketch keeps `exact` and is offset.
- The faces: the swept side, its four edges `other`, a projection and a chamfer of one refused.
- The refusals of the offset, the taper, the revolve and the wall, with their `refs`.
- The adapter and the analysis: a spline adds no equation; free control points count two each.
- MCP: `describe_api` names `spline`; `get_sketch` lists its `points`.
- The app: the tool (three clicks and Enter, a closing click, Escape, too few places), no snap to a spline, the control polygon in the scene; the snapshots.
- Scenario 15, step 4 with the grip ([calls.ts](calls.ts)), in `packages/scenarios`.

## Open

1. **The revolve of a spline profile.** Refused in 6d (a variant of the exact outline for a spline, the switches of Ring 2 and a general face kind would make it work). *Recommendation: refused now; a package of its own when a turned part with a free-form profile (a knob, a bottle) is wanted.*
2. **The Onshape converter's mapping of B-splines** (the recipe above). *Recommendation: not in 6d; the converted model's only splines are the disc's, which the generator replaces better.*

## Reviews

The design, the contract and the calls were written on Opus 5.5.

## Rows for the indexes

**docs/d36/README.md**, the row of 6d, column "Design now":

> full ([6d-sketch-spline/design.md](6d-sketch-spline/design.md), D70): a curve kind `spline` over 3 to 64 own control points (`{ type: 'spline', points }`, closed by the first point again), a clamped uniform non-rational B-spline of degree min(3, n − 1), with no degree, knot or weight field (any B-spline of degree up to 3 is a chain of Bezier splines exactly, `bsplineBeziers`); the solver sees only the points (the adapter adds no primitive, no constraint takes a spline; tangency at an end by the end leg of the control polygon, measured); the profile takes a spline as one curve over its polyline within the chord tolerance (a bound of the second derivative per Bezier piece, measured), with a self-test and closed splines; a loop through a spline has no exact curves (`Loop.sampled`), so the offset, the taper and the revolve refuse it by one message and the wall at its command; the side face is one swept face per spline with edges `other`; DXF and SVG write it as a polyline; the app's tool Spline and the control polygon; no command, no issue code, no schema step (an older build refuses the unknown kind). Open for the owner: the revolve of a spline, the converter's mapping

**docs/decisions.md**, the row of D70:

> | D70 | [6d Splines, the cheap variant](d36/6d-sketch-spline/design.md) | designed 2026-11-17 | A spline is a curve over 3 to 64 own control points, a clamped uniform non-rational B-spline of degree min(3, n − 1), closed by repeating its first point; the solver sees only the points and no constraint takes a spline (tangency at an end by its end leg); the profile uses its polyline within the chord tolerance; one swept side face with edges of the kind `other`; offset, taper, revolve and wall refused; no schema step |

**docs/requirements.md**, validation scenario 15, the part of 6d:

> *Splines (6d, D70).* Step 4: the flank of the lid's half is a spline over five control points (a grip 4 deep at mid-height, its end legs 10 long, vertical and tangent to the corner arcs), mirrored with the half by 6c into one region named as before; the copy of the spline runs over the copies of its control points. The half is fully determined; the lid's area by hand 4436.1398 mm² (each grip 9.8 · its depth), the polygon at the chord tolerance 0.2353 below; the grip 6 deep follows its parameter. The grip is one swept face whose four edges are of the kind `other`; its offset, a revolve of a spline, a wall along it, a chamfer of its edge, a constraint on it and `setCurvePoint` are refused; a closed spline is one region (240 mm² by hand) and one side face; a self-crossing spline makes the profile invalid; a sixth control point by replacing the spline in a batch keeps every name. Step 7: the section of the lid as DXF has the area of the region's polygon ([d36/6d-sketch-spline/calls.ts](d36/6d-sketch-spline/calls.ts)).
