# 6d Splines, the cheap variant (D70)

**State: designed 2026-11-17 on Opus 5.5 against `master` at `e70cd65`; reviewed independently on Fable on 2026-11-24 (the first review of this design that finished), answered by the owner the same day, and revised the same day on Fable ("Reviews"). Not implemented.** The revision is written against `master` at `9c43be9` (schema version 10; 6a, D64, implemented with the fix of its review) and against the designs of the packages that are implemented before 6d: the sequence of the step is 6a, 6a2, 6e, 6c, 6b, 6d, 6f, 6h ([6-plan.md](../6-plan.md)). Those designs are read as they stand on their branches on 2026-11-24: 6e (D65) revised on `d36/6e-design-r`, 6c (D68) revised on `d36/6c-design-r`, 6b (D69, with the axes of 6a2) on `d36/6b-design`, whose revision after its review was not finished. "Other packages" says what 6d adds to each and what it needs of each.

Files: [contract.ts](contract.ts) (the curve, the module `spline.ts`, what the profile, the solver port, the result, MCP and the app add, and the places of 6e, 6c and 6b), [calls.ts](calls.ts) (validation scenario 15: step 4 with the grip, the second notch of step 6 with the flank in, the part of step 7 that is 6d's; the refusals, a closed spline, a crossing one, a change of control points).

The package in short:

1. **A curve kind `spline`** over control points that are ordinary points of the sketch: `{ type: 'spline', points: Id[] }`, 3 to 64 points, a clamped, uniform, non-rational B-spline of degree min(3, n − 1). Closed when the first point comes again as the last. No other field.
2. **The solver sees only the points.** The spline is in the solver's input as every own curve is; the adapter adds nothing for it, the analysis no equation. No constraint takes a spline; tangency at an end is a constraint on the end leg of the control polygon, which existing constraints say.
3. **The profile takes a spline as one curve over its polyline** within the chord tolerance (a bound of the second derivative per Bezier piece, measured to keep the tolerance); its tests of crossing, touching and self-crossing run on that polyline, and its half-edges leave a vertex towards the place where the polyline leaves a circle about it (measured against 14,843 random sketches). A loop through a spline has no exact curves, so the offset, the taper and the revolve refuse it by one message naming the spline; the wall refuses it at the command.
4. **The side face is one face per spline, `{ role: 'side', curve }`, a swept surface** along the extrusion, as the side of gear teeth; its edges are of the kind `other`, so they are not projected, chamfered or filleted. The rim of a part whose outline holds a spline therefore takes no chamfer and no fillet (a known limit, the owner's answer 24).
5. **Not cut, not projected.** 6e's tools refuse a spline and no contact with one is a cut; a projection of a spline into another sketch is refused (answer 22).
6. **No command, no constraint, no query, no issue code, no schema step.** The app gets a tool Spline (click the control points; Enter, or a click on the first point to close) and draws the control polygon; a drawing tool does not snap to a spline, the Select tool selects it. MCP shows the spline through the generated `describe_api`; `get_sketch` says where each spline runs (the points it passes and its box, answer 26), and 6e's query `sketchContacts` says why a profile with a spline is invalid (answer 5).

## What the plan and the backlog say, checked against the code

| Statement | What the code says |
|---|---|
| "A curve kind `spline` over control points that are ordinary points of the sketch (own points or the origin)" (6-plan.md) | A curve names its points by ID and the validator accepts own points and `origin` (`curve` in `features/sketch.ts`). A list fits that rule; the table `CURVE_POINTS` (`sketch-content.ts`) maps a kind to fields of one ID each, so a list is a new form there (below, "The curve") |
| "The solver sees only the points: the adapter passes them and nothing for the curve" | `solverSetup` passes every own curve to the solver (`sketch.ts`); the adapter's `buildPrimitives` throws for an unknown kind (A1 of 6a); the points are pushed as point primitives whatever curve uses them, so a control point with no constraint is a free point (measured below) |
| "The analysis of freedom gets no equation from it" | `SketchAnalysis` takes equations from constraints and from the rules of arcs (`arcRows`); a curve that no constraint names and that is not an arc gives none (`analysis.ts`) |
| "Tangency at an end is a constraint on the end leg of the control polygon, which existing constraints express" | True: `pointOnCurve` holds a point on a line including its extension (the second control point on the line that ends at the first: tangent, smoothly so only on the far side of the end, I), and `tangent` of a line and an arc holds a construction leg tangent to the arc; measured with the real solver below |
| "The profile samples the curve within the chord tolerance; its crossing test runs on the samples" | The profile is a planar graph of half-edges over lines and arcs (`profileOf`, `sketch.ts`); a spline fits in as one more kind of `Shape` with its polyline, as an arc is divided by `segments` |
| "The side face is a general surface (the kind of the side of a generated profile)"; the backlog: "of the `swept` kind, as for gear teeth" | Both: `curveOf` answers `{ type: 'general' }` and the prism builds that side as `FaceInfo` `swept` along the normal of the sketch (`tool-prism.ts`), published as `Surface` `swept`. The general shape of a side is the swept surface of an extrusion |
| "Its edges have the kind `other`, so they cannot be projected or chamfered" | `edgeKind` (`solid.ts`) gives `other` to every edge with a swept face; a projection refuses it (`unsupportedProjection`), a chamfer and a fillet too (`unsupportedEdge`, D63) |
| "The offset and the wall of a spline are refused with `invalidProfile` naming the curve" | The offset reads the exact outline (`selectionOutline` of `recompute/outline.ts`), which refuses a loop without `exact` with a text about a generated profile. The wall's command refuses a curve whose kind is not in `WALL_CURVE_KINDS` (`features/profile.ts`), which is structural and earlier |
| "Whether the revolve takes it as it is is to be checked" | It does not: `revolveSetup` (`tool-revolve.ts`) reads the exact outline too, re-divides it for half the chord tolerance and builds round faces from it. Refused, with the offset's message (decision below) |
| "A closed outline of one spline is a spline whose first and last points are one point" | The half-edge graph takes an edge from a vertex to itself (a forward and a backward half, two loops); an arc may not, but nothing in the graph forbids it |
| 6a's spike: a spline stops `tsc` at 13 places in 11 files; the separate unions (`Shape` of the profile, of `sketch-tools.ts`, of the app) and the exact outline (`OutlineCurve`, Ring 2) are not reached by it | Run again on `master` at `9c43be9` ("Measured", J): 32 diagnostics in 10 files for the kind alone, three more places once the table of points, `EntityKind` and `PlacedCurve` have it, and the functions over each `Shape` once that union has it. Some places never stop. Every place, with what it does with a spline, is in "Every switch on the kind of a curve" |
| The plan of 2026-11-17: "6b and 6f come after or beside 6d"; 6e "refuses a spline by name" | No longer: 6d is implemented after 6e, 6c and 6b (plan, amended 2026-11-24). So the refusals of a spline in 6e's switches, the spline in 6c's derive, and the refusal of a projected spline in 6b's code are 6d's to write ("Other packages") |

Not in the plan, found in the code:

- **`CURVE_POINTS` and its guards** require every field of a shape other than `type` to be listed as a point name (`Complete` in `sketch-content.ts`). A spline's `points` is a list, not a point name; `setCurvePoint` (D52) and the app's re-pointing (`repointRow`) read the table.
- **`removeEntity` of a point removes every curve on it** (`curvePoints(c).includes(id)`, `document.ts`): removing a control point removes the spline.
- **A snap to a curve becomes `pointOnCurve`** in the engine's sketch tools (`placeAnchor`) and in the app; on a spline that constraint is refused, so a snap to a spline has to be refused before it. The same picker also serves the Select tool, which has to reach a spline ("The app").
- **2h's start at a plane** (`exactStart`, `recompute/extent.ts`) falls back to the points of the polyline for a loop without `exact`, so a spline profile can start at a plane with no change.
- **The section query** writes a span on a swept face across the sweep as a `curve` of mesh corners, and the export of an outline (D54) writes a curve span as straight pieces; nothing there needs the spline.
- **A test pins the kinds of a curve** (`packages/engine/test/curve-kinds.test.ts`: `CURVE_KINDS` equals `line`, `circle`, `arc`, and `unreachable` is tried with `{ type: 'spline' }`). It fails once the spline is in and is rewritten with it.
- **D63's chain rule and a smooth outline.** A chamfer or a fillet of an edge that runs on smoothly into another needs that edge too. An outline that is smooth all round (the lid: lines, corner arcs and the grips, all tangent) has no edge that ends at a corner, so every chain reaches a spline edge, which is of the kind `other`; and an edge that ends at a spline face at a corner is refused as well (measured, K).

## The cheap variant

What 6d does:

- The curve kind, its validation, and a case for it at every switch on the kind of a curve (the engine, the solver adapter, the app, and the code 6e, 6c and 6b will have written).
- `spline.ts`: the Bezier pieces of a B-spline, the polyline of a spline within the chord tolerance, the points it passes and its box.
- The profile: a spline as one shape over its polyline; the self-test; closed splines; the direction of its half-edges; loops through a spline named in `Loop.sampled` and without `exact`.
- The side faces of a spline (swept) and the refusals of the offset, the taper, the revolve and the wall.
- In 6e's code: a spline is not cut and holds no point; its contacts and their reasons in the query `sketchContacts`; the two tests of a region that passes a spline and is followed through a cut.
- In 6c's code: the copy of a spline, when two splines lie on each other, its box for the broad phase.
- In 6b's code: the two refusals of a projected spline.
- The app: the tool Spline with its inferred tangent start, the curve and its control polygon in the view, no snap of a drawing tool to a spline.
- MCP: the comment of the curve in `types.ts`, which `describe_api` shows the AI; `through` and `box` of a spline in `get_sketch`.
- The docs of the area, with each point of work.

Deferred (the first six are rows of [backlog.md](../../backlog.md), "Kandidáti", written with this revision):

- **The full variant** (the plan): a point on a spline, a tangency in its middle, a dimension of the curve, which need planegcs `bspline`, `point_on_bspline` and a parameter per point on the curve in the solver port. With it a crossing of a spline becomes a cut of 6e, and a spline a target of `extend`.
- **A spline through given points** (interpolation): a later sketch tool that computes control points and sends this curve.
- **The revolve of a profile with a spline** (the owner's answer 23), and its offset, taper and wall: they read an exact outline, and a spline has none.
- **A chamfer and a fillet along a swept edge** (answer 24): the edge of a spline face with a cap, and so the rim of a part with a spline.
- **Trim, split and extend of a spline** (6e defers them: cutting a B-spline changes its control points).
- **A projected spline** (answer 22): until a package projects it over projected control points, the control points are projected as points.
- **Non-uniform knots, degree above 3, weights (rational), periodic splines**: an imported spline of any knots becomes a chain of Bezier splines exactly (`bsplineBeziers`); conics are refused by 6f.
- **An exact edge kind for the straight edge where a spline flank meets a planar side.**
- **In the app**: inserting or removing one control point, dragging the curve itself, an inferred tangent at the last point.

Not 6d's: **the Onshape converter's mapping of B-splines** is 6h's (answer 25); 6d delivers `bsplineBeziers` for it.

## Measured

**Where it was measured.** A to E are the measurements of the first design (2026-11-17, a prototype in the scratchpad of that session, with the real engine of `master` at `e70cd65` where an engine is named). Its scripts are gone; the review of 2026-11-24 wrote a prototype of its own from the text of the design alone (a scratch copy of `packages/` with `spline.ts`, the validator, the profile's spline shape, the side and the adapter's case) and reproduced every number of A to E on it. F to K are the revision's: the reviewer's prototype copied to the scratchpad of the session, `scratchpad/step6-review/6d-revision/proto`, and patched there with the revised rules (the direction of a half-edge, the short pieces of a polyline, the joints and the box); the probes are `h-halfedge.probe.ts` and `i-revision.probe.ts` beside it, run with `cd proto && npx vitest run --config ../vitest.config.ts ../<file>`, and the reviewer's probes `a` to `g` run again on the patched copy give the numbers of A to E unchanged. The compiler was run in a second copy, `spike/`, of the tree at `9c43be9`. Nothing in the repository was changed.

**A. The polyline.** A prototype of `splinePolyline`: the clamped uniform knot vector, Boehm's insertion of every inner knot to multiplicity p, and per Bezier piece `ceil(sqrt(M / (8 tol)))` equal steps of its parameter, M the largest length of `p (p − 1) (B[i+2] − 2 B[i+1] + B[i])`. The deviation is measured by 50 points per step against the chord.

| Spline | Tolerance | Pieces | Largest deviation | Of the tolerance |
|---|---|---|---|---|
| The grip of scenario 15 (5 points, 2 spans) | 0.1 | 6 + 6 | 0.0372 | 0.37 |
| | 0.01 | 19 + 19 | 0.00402 | 0.40 |
| | 0.001 | 58 + 58 | 0.000441 | 0.44 |
| 2000 random splines (3 to 10 points in a square of 100 mm; tolerances 0.1, 0.01, 0.001) | | | | at most 1.000, on average 0.78 |

The bound is tight for a quadratic piece (its second derivative is constant) and about 2.5 times too fine for the grip; it never failed. The polyline of the reversed control points equals the polyline reversed to 5e-14 (it is not computed so: the profile computes it once per curve, in the order of the points). The end points come out exactly the first and the last control point.

**B. The area of the lid with two grips** (scenario 15, step 4; W 84, H 54, R 5, the legs 10, the middle control point of each grip pulled in by 4). The curve is half as deep as its control point is pulled: the two Bezier pieces of a grip are (42, 5) (42, 15) (40, 21) (40, 27) and the mirror image, so the curve passes (40, 27), `grip / 2` inside the flank (H: the joints). By hand the grip takes 9.8 · d mm² for a pull of d ([calls.ts](calls.ts), the derivation over its two Bezier pieces): 39.2 per grip, and the prototype's Gauss–Legendre integral, exact for a polynomial, gives 39.200000. So the lid is 4514.5398 − 78.4 = 4436.1398 mm².

| | Tolerance 0.01 | 0.001 |
|---|---|---|
| The polygon of the lid (lines, arcs by `segments`, the grips by the polyline) | 4435.9046 (−0.2352) | 4436.1149 (−0.0249) |
| One grip's polygon against 39.2 | 39.2221 (+0.022) | 39.2024 (+0.0024) |

**C. The real profile and kernel.** First with the spline put in as a chain of own lines through its polyline at 0.01, both halves own geometry: 82 curves, the profile valid, one region; extruded 2 mm the volume is 8871.8091 mm³ against 8872.2796 by hand. The review then ran the spline as one shape of the profile: the lid is valid with one region and the volume 8871.8091, the chain's number to the last digit; pulled by 6, 8832.5934 against 8833.0796 by hand. A spline tangent to a line at its end gives a valid profile with one region; a spline whose control polygon makes it cross itself an invalid one; a spline that touches a line between vertices an invalid one. The time of `detectProfile` for a chain of 188, 588 and 1307 pieces (each piece a curve, so every pair is tested): 23, 170 and 805 ms; as one shape, two splines of 64 points with overlapping bands at 0.001 (3306 pieces) take 7.8 ms.

**D. The solver.** The half of the lid with the grip's control points and its legs (`l1`, `l2`: construction lines, vertical and tangent to the corner arcs), solved by the real planegcs adapter: status ok, 0 degrees of freedom, no redundant constraint; g1 (42, 15), g2 (38, 27), g3 (42, 39), a3 (42, 49), a5 (0, 54); `grip` 6 moves g2 to x = 36. With the spline in the input (the review's adapter case) no position changes (largest difference 0), and free control points count two degrees of freedom each (8 before and after).

**E. A closed spline** over the corners of a square 20 × 20 (five entries, the first again at the end): the exact area 240 (Gauss–Legendre), the polygon at 0.01 is 239.8216 with 82 pieces, at 0.001 239.9822 with 260. Alone it is one region and one side face (volume 479.6431 at 2 mm); as a hole of a plate 40 × 40 the plate's volume is 2720.3569, which is (1600 − 239.8216) · 2.

**F. The direction of a half-edge of a spline.** The rule of the first design took, for a closed spline, the point of its polyline at half the shortest "length" at the vertex, and the length of a closed curve as its reach. The review's case: the closed spline of E with a triangle of lines at its point.

| Lines at the point | The first design: common distance, directions of the two halves of the spline | Regions | The revised rule | Regions |
|---|---|---|---|---|
| about 16 mm | 7.8; 4.7° and 85.3° | `[s]`, `[u1,u2,u3]` | 7.8; 4.7° and 85.3° | `[s]`, `[u1,u2,u3]` |
| 42 mm and longer (48, 96, 320) | 21.2 and above; 45.00° and 45.00° | `[u1,u2,u3]` only, `valid: true` | 10.6; 7.1° and 82.9° | `[s]`, `[u1,u2,u3]` |

A closed spline never gets farther from its point than its farthest point (here 21.2 mm, less than half the length of its polyline), so the first rule asked for a point the curve does not have; both halves got the farthest point, and the region of the spline was lost without a word. The revised rule ("The profile", the half-edges) was then compared with an oracle on random sketches: the same sketch with every spline replaced by a chain of own lines through its polyline, which the profile of today takes, must give regions of the same areas. A sketch is a spline of 3 to 8 control points round a centre (closed in 6 cases of 10, else closed by one or two lines) and, at its first point, a fan of one to three triangles of lines 1/40 to 40 times its size; in the second and third run half of the lines are arcs.

| Run | Sketches | Valid in both | Regions differ, the first design | Regions differ, the revised rule | Validity differs |
|---|---|---|---|---|---|
| lines, tolerance 0.01 | 20,000 | 8,537 | 1,367 | 0 | 0 |
| lines and arcs, 0.01 | 20,000 | 3,334 | 711 | 0 | 0 |
| lines and arcs, 0.1 | 10,000 | 1,670 | 357 | 0 | 0 |
| lines, 0.001 | 3,000 | 1,302 | 208 | 0 | 0 |

So on 14,843 valid sketches the revised rule gives the regions of the chain every time, and the first rule failed on 2,643 of them. In no sketch of the 53,000 did the spline as one shape and the chain disagree on validity, which is the measurement the first design asked for under "To verify" (the tests of touching and crossing piece by piece). The rest of the sketches are invalid in both (the fan crosses the spline).

**G. Pieces shorter than the length tolerance.** Three control points at one place (two coincidents; a spline with 5 points, closed by a line): at the chord tolerance 1e-4 one piece of the polyline is 8.2e-7 long and the self-test finds the two pieces beside it within the length tolerance of each other, so the profile is invalid; at 1e-5 there are four such pieces. With the points nearer than the length tolerance to the last one kept left out, the shortest piece is 6.5e-6 and 1.6e-6 and the profile is valid at 0.01, 0.001, 1e-4 and 1e-5. On 2000 random splines the rule leaves out none of 590,705 points and the deviation stays at most 0.9999 of the tolerance.

**H. The joints and the box** (`splineJoints`, `splineBox`). The grip pulled by 4: the curve passes (42, 5), (40, 27), (42, 49), and its box is x 40 to 42, y 5 to 49, where the box of its control points is x 38 to 42. Pulled by 6: (39, 27), x 39 to 42. The closed spline of E passes (10, 0), (25, 15), (10, 0), and its box is 10 to 27.78 by 0 to 17.78 (its control points span 10 to 30 by 0 to 20). On 500 random splines the box differs from the box of a polyline at 1e-5 by at most 9.8e-6 and never leaves the box of the control points.

**I. A tangent start.** A line from (0, 0) to (20, 0), a spline from its end, its second control point held on the line by `pointOnCurve`, solved by the real adapter:

| The second control point starts | After the solve | The first leg | The profile and the body |
|---|---|---|---|
| beyond the end, at x = 26 | x = 26 | continues the line: a smooth join | valid, one region, extruded |
| behind the end, at x = 12 (a click "onto the line") | x = 12 | runs back over the line: a cusp of zero angle | valid, one region, extruded: nothing reports it |

The solver keeps the side the point starts on, also after a drag of another control point. So the smooth join needs the second point beyond the end, where there is nothing to snap to; a click onto the line gives the cusp.

**J. The compiler**, on a copy of the tree at `9c43be9` (the engine, the adapter and the app as they are before 6a2, 6e, 6c and 6b). With `{ type: 'spline'; points: Id[] }` added to `CurveShape` alone: 32 diagnostics in 10 files. With `CURVE_POINTS.spline`, its guard, `spline` in `EntityKind`, the cases of `curvePoints` and `curveEnds`, and the variant of `PlacedCurve`: `document.ts`, `references/index.ts`, `nearestCurvePoint` and the app's `repointRow` compile, and three places are new (the switch of `profileOf` on the placed curve, `curveOf` of `recompute/profile.ts`, the wall of `recompute/outline.ts`). The review went on: with the variant in the profile's `Shape`, the functions over it stop. Never stopped: `selectionOutline`, `exactStart`, `anchorProblem`, the app's picker and the advice text of `get_sketch`. The table of "Every switch" has each place with its ring.

**K. Taken over from the review** (run on its prototype; its probes run again on the patched copy give the same answers), and one case of the revision's own:

- **The rim of the lid under D63.** A chamfer of the top edge of `c3` alone is refused because it "continues smoothly into" the edge of `r2`; of `c3`, the copy's top, and the two arcs because the end face `lid/side/c2` "does not continue a face of the edge" (a fillet the same); of the whole rim because the spline edge is of the kind `other`. No list of edges of that rim passes.
- **A spline that meets its neighbours at corners** (run by the revision, `j-corner.probe.ts`: a rectangle 40 × 20 with one short side a spline of three points, extruded 5 mm). A chamfer and a fillet of the top edge of the side away from the spline, and of the vertical edge between two lines, are `ok`. Of the top edge of a line that ends at the spline face: `unsupportedEdge`, "the edge ends at a round face (E/side/sp) that does not continue a face of the edge". Of the vertical edge between a line and the spline: `unsupportedEdge` by its kind.
- **The chord tolerance decides validity near a tangency.** A Bezier curve whose lowest point is 0.5 µm below a line: the profile is valid at the tolerance 0.1, invalid at 0.01, valid at 0.001, invalid at 1e-4. At 4 µm below: valid at 0.1 only. At 0.5 µm and 4 µm above: valid at all four.
- **A plate whose hole is a closed spline** is not offset at all: the refusal comes through the hole's loop. A region of the same sketch away from its splines is offset and revolved as today.
- **The section of the lid as DXF**: one loop, no circle, the area equal to the volume over the thickness to 1e-12.
- **The flank**: one `swept` face with the axis [0, 0, 1], four edges, all `other`; a sketch on it is `nonPlanarFace`, the projection of its edge `unsupportedProjection`, a chamfer and a fillet `unsupportedEdge`.
- **An older build** refuses the kind on `addCurve` and on `load` ("…type: čeká se jedna z hodnot line, circle, arc").
- **planegcs 1.3.0 has the full variant**: a `bspline` with knots 0, 1, 2 and multiplicities 4, 1, 4 is this design's curve (a point held at a fixed parameter lands on it to 8e-15), and with a free parameter the point slides along it.

## Decisions

### The curve

`{ type: 'spline'; points: Id[] }`, with `construction?` as every curve. The comment of the contract (section 1) goes into `types.ts` at `CurveShape`, where `describe_api` gives it to the AI.

- **Control points**: own points of the sketch or `origin`, at least 3 and at most 64 (`MAX_SPLINE_POINTS`). No point twice, except the first again as the last, which closes the spline; a closed spline has at least three different points (four entries). A projected or derived point is refused, as for every curve (a curve names own points; a coincident joins a point to a projected one).
- **Degree**: min(3, n − 1) of the n entries: 2 for three points, 3 otherwise. Cubic is what every source of step 6 carries (an SVG `C`, a cubic DXF `SPLINE`, Onshape's B-splines from knowledge); three points are an SVG `Q` exactly.
- **Knots**: uniform and clamped, 0 repeated p + 1 times, 1 to m − 1, m repeated p + 1 times (m = n − p spans). Not stored: they follow from n. Four points are one cubic Bezier curve.
- **Not rational, not periodic.** A closed spline is clamped at its point: it leaves along the first leg and arrives along the last, a corner unless the two legs are put on one line by a constraint (the three points on one line: a `pointOnCurve` of the second point on a construction line through the last two, for example).
- **Where it runs.** The curve passes its first and last control point and, between them, the joints of its Bezier pieces; the inner control points lie off it. A control point pulled aside moves the curve less than itself: the grip of scenario 15 is `grip / 2` deep for a middle control point pulled in by `grip` (measured, B and H). The comment says so, and `get_sketch` gives the points and the box ("MCP").
- **No `degree`, `knots` or `weights` field.** No source needs one: a B-spline of any knots and of degree up to 3 is a chain of Bezier pieces exactly, each a spline of 4 points (3 for degree 2), joined at shared points. A field added later is dropped by this build without a word (the validator rebuilds a curve from the fields it knows), so it needs an upgrade step then.
- **`CURVE_POINTS.spline = []`.** A spline has no named point, so the table, the completeness guard and `CurvePointName` keep their meaning ("the fields that hold one ID"); the guard is changed to count only those fields. `CURVE_KINDS` (its keys) then includes `spline`, so the validator accepts it once its switch has the case. `curvePoints(spline)` is the list as it is, the closing repeat included.
- **`EntityKind` gets `spline`.** No constraint lists it among the kinds it takes, so every constraint on a spline is refused by the catalog with today's text ("… je spline, čeká se line nebo circle nebo arc").

### The solver and the analysis

- The spline stays in `SolveInput.curves`, as every own curve: the stamp of the sketch includes it, and the port keeps saying "the curves of the sketch" (the full variant would turn it into a primitive there). The adapter's case checks that each control point is a point of the input (`point(id)`, as for the ends of a line) and adds no primitive; its `rank` of the tangency table gets the entry `spline: 3`, never reached (the engine refuses the constraint), and the pair it would form throws as an unknown pair does today.
- The analysis gives a spline no row; `pointsOf` reads `curvePoints`, so a constraint never touches it. The control points are free points with two degrees of freedom each until constrained; the diagnosis lists them as free (measured D: 0 degrees of freedom once the grip's points are dimensioned).
- `ports.md` gets the sentence: "a spline in `curves`: an adapter adds no primitive and no equation for it; its control points are points of the input".

### Tangency, and no point on a spline

- **Tangency at an end is said by the control polygon**, since the curve leaves its first point along the first leg and reaches its last along the last.
    - **To a line that ends at the spline's first point**: `pointOnCurve` of the second control point on that line. The constraint holds the point on the whole line, so both sides satisfy it, and the solver keeps the side the point starts on (measured, I). Beyond the end the spline runs on smoothly; behind it, over the line, the first leg runs back and the join is a cusp of zero angle, which the profile takes as valid. So the recipe is: start the second point beyond the end, and read its position after the solve. The app's tool puts it there ("The app").
    - **To an arc that ends at the spline's first point**: a construction line from the first to the second control point and `tangent` of it and the arc (measured D: the legs of the grip tangent to the corner arcs, solved, no conflict). The side is again the start's.
    - **To a circle**: only to a construction circle. A circle of the outline has no vertex, so a spline that ends on one touches it away from a common end and the profile is invalid.
    - The same at the last point with the last leg. The comment of the curve says all of it.
- **No point is held on a spline.** A snap to a spline is refused by the engine's sketch tools (`anchorProblem`: "a point cannot be held on a spline; snap to a control point or leave the place free"). In the app a drawing tool does not snap to a spline, and the Select tool does ("The app"). A control point may snap onto a line, an arc or a circle (held on it).
- **Nothing warns of the cusp** (I): it is a valid profile and a closed body. "Open", 1, asks whether `get_sketch` should say it.

### Commands

No new command.

- `addCurve` takes a spline; `radius` is refused for it as for every curve but a circle.
- `setCurvePoint` (D52) refuses a spline by its own text, before the generic one: "… is a spline, which has no named points; to change its control points, remove it and add it again under its ID in one batch". The command compiles without it (J): with the empty entry of the table the generic text would read "has the points , not "a"". No constraint names a spline, so the batch loses nothing (the construction flag is given again with the curve), and the features that name it in a region keep the name (D52 measured that an ID removed in a batch can be given again; calls.ts, `sixPoints`).
- `removeEntity` of a control point removes the spline, as it removes a line with its end: the rule of the cascade stays one rule. Removing a point from the list instead is the batch above.
- `setConstruction`, `dragPoint` and `removeEntity` of the spline itself work as for every curve.

### The polyline (`spline.ts`)

A leaf of the engine beside `sketch-content.ts` (types and `util.ts` only; `repository.md` gets the row, `modules.test.ts` the module):

- `bsplineBeziers(control, knots, degree)`: Boehm's knot insertion until every inner knot has multiplicity `degree`, then one piece per span of non-zero length. General, for 6f and 6h.
- `splineBeziers(control)`: the same over the clamped uniform knots of the spline.
- `splinePieces(bezier, tolerance)`: `ceil(sqrt(M / (8 · tolerance)))` steps of the parameter of the piece, at least 1, at most 4096 (`MAX_SPLINE_PIECES`, the cap of `segments` for arcs), M the largest length of the control points of the second derivative. A chord over a step h lies within h² M / 8 of the curve (measured A: never above the tolerance). The cap is per Bezier piece: a spline of 64 points has up to 61 pieces, so up to 61 · 4096 straight pieces at a tolerance far below its size; above the cap the polyline no longer keeps the tolerance, as an arc does not.
- `splinePolyline(control, tolerance)`: the pieces in order, each at its equal steps by de Casteljau, then the last control point. The first and last points are the control points, exactly. **A point nearer than the length tolerance to the last one kept is left out**, and the last inner point too when the end is that near to it: control points at one place make steps shorter than the tolerance, and two pieces with such a piece between them read as a touch of the curve with itself (measured G: a valid outline was invalid at fine chord tolerances). A point left out moves a chord by less than the length tolerance.
- `splineJoints(control)` and `splineBox(control)`: where the curve runs, without a tolerance. The joints are the ends of the Bezier pieces, which the curve passes exactly; the box is the box of the curve itself, from the ends of the pieces and the places where a coordinate of the derivative of a piece is zero (a quadratic per coordinate). Measured H.

Rejected: a fixed number of steps per span (does not follow the tolerance), the arc rule `segments` (a spline has no radius), adaptive subdivision by a flatness test (deterministic too, but a recursion and a second rule where a closed form exists); the self-test skipping short pieces in place of the polyline leaving them out (the short pieces would stay in the body, in the keys of the loop and in the tests of other curves).

### The profile

A spline is one more kind of the profile's `Shape`: `{ kind: 'spline', id, a, b, pa, pb, control, pts }`, the polyline `pts` from `pa` to `pb`. `placedCurve` (6a's one shape function) gets the case: its ends read as a line's ends are (at the joined vertex in the profile and the wall, raw in `curveOf`), the control points between raw, as a centre is, the first and last replaced by the end positions; the profile computes the polyline from them at the chord tolerance of the document, once per curve.

- **The profile of a sketch with a spline is the profile of its polylines.** Lines and arcs are tested as exact curves and then once more as polylines (`soundTessellation`); a spline has only its polyline. So whether a spline that passes within a few micrometres of another curve crosses it is decided by the chord tolerance, and a change of `settings.chordTolerance` can turn such a sketch valid or invalid, in either direction (measured K). `architecture/sketch.md`, which says that validity is tested on exact curves, gets the exception.
- **Validity of the curve itself**: a spline whose polyline has no length above the length tolerance, or whose polyline comes within the length tolerance of itself away from two consecutive pieces (a crossing, a touch, or a piece folding back onto the one before), makes the profile invalid, as two crossing curves do. The test is a sweep over the pieces, as `polygonProblem` does for a loop (the first and the last piece of a closed spline are consecutive). `splineSelfContact` answers with the place, for the query of the contacts.
- **Ends**: a spline whose ends are one vertex (the same point, or two points joined) is closed: one forward and one backward half-edge from that vertex to itself, which the graph turns into two loops (an outer one and a hole of the other sense), a region named by the spline alone when nothing else meets the vertex. An open spline with both ends at one vertex is that case too. Otherwise its ends are two vertices, as a line's are.
- **Touches with other curves** (`compatible`): each piece of the spline is taken as a line shape against the other curve (or against each piece of another spline) by the rule of today: the contacts of the carriers, the ends and the middle of the pieces as candidates, a candidate within the length tolerance of both curves allowed only within the reach of a shared vertex (10 tolerances plus the reach of a round partner, as today). Measured F: on 53,000 random sketches it agrees with the chain of lines on validity every time.
- **The broad phase** (6c writes it, `nearPairs`; the owner's answer 15): the box of a spline is the box of its control points, which holds the curve and every polyline of it (the convex hull property), so a spline is a shape of the broad phase like any other. Within a pair it lets through, the pieces are tested only where their own boxes meet (C: 3306 pieces of two splines in 7.8 ms). The box of a face for the nesting of holes takes the same box for a spline on its boundary (the ray test reads the pieces, which lie in it).
- **The half-edges.** Round a vertex the half-edges are ordered by the direction to a point of each curve at one common distance d from the vertex, not by the tangents (the rule of today, written for a line and an arc that leave a vertex tangentially).
    - **The reach** of a curve at a vertex is how far from it the curve surely gets: for a line and an arc the distance of their ends, as today; for a spline the largest distance of a point of its polyline from that vertex. For a closed spline that is the distance of its farthest point, not its length: a closed curve never gets half its length away from its point (the defect of the first design, F).
    - **d** is half the smallest reach of the curves at the vertex.
    - **The direction of a spline's half** is to the first point where its polyline, walked from the vertex in the direction of the half, leaves the circle of the radius d about the vertex: the first piece that ends on or outside the circle, cut by the circle (the root of a quadratic in the piece). "First" and "by the straight distance from the vertex" are part of the rule: a point at the distance d along the curve, or a later crossing of the circle, is another point. A line leaves along itself and an arc towards its point at the distance d (the tangent turned by asin(curvature · d / 2)), as today; both are the same rule, since their distance from the vertex only grows up to d.
    - **Why it orders them right.** Every half reaches the distance d before it ends (d is at most half its reach; the two halves of a closed spline reach it on the two sides of its farthest point), so the part of each half inside the circle is one path from the vertex to the circle. Curves of a valid profile do not cross, so these paths meet only at the vertex, and paths from the centre of a disc to its rim that do not cross reach the rim in the order they leave the centre.
    - The curvature for a tie of two directions is that of the end of the Bezier piece, signed by the direction, as before.
    - Measured F: the regions of 14,843 random valid sketches against the chain of lines, no difference; the first rule lost a region in 2,643 of them.
- **The area of a loop**: the polyline's pieces in the direction the loop passes them, in place of the chord.
- **The polyline of a loop**: the points of the polyline between the ends, keyed `c:<spline>:<k>` by their index in the polyline (as an arc's), in reverse for the backward half: regions on both sides of a spline share them.
- **Inside a loop** (the ray of `crossings`): piece by piece.
- **`Loop.exact` and `Loop.sampled`**: a loop that passes a spline has no `exact`, and `sampled` lists its splines in the order it passes them. A loop that passes none keeps its exact curves, so a region of the same sketch away from its splines is offset, tapered and revolved as today (measured K). A reader of `Loop.exact` is not found by the compiler; they are listed in "Every switch".
- **`soundTessellation`** runs on the loops as today.

### Faces, edges and names

- **The side face** of a spline in an extrusion is `{ feature, role: 'side', curve: <spline> }`, one face for the whole spline, closed or open, as for every curve; its surface `swept` with the axis the normal of the sketch (the prism builds a side of the shape `general` so, as it builds the side of gear teeth). [naming.md](../../architecture/naming.md) gets the sentence; no rule of names changes. A copy of 6c is `side` with `m/1/c2`, quoted in the key as 6c's rule says.
- **Its edges** are of the kind `other`: with the caps, and with a neighbouring side, planar or round, even where that edge is straight (calls.ts, `lidWithGripChecks`: four edges of the grip face, all `other`). So: no projection of them (`unsupportedProjection`), no chamfer or fillet (`unsupportedEdge`, D63).
- **The rim of a part with a spline takes no chamfer and no fillet** (the owner's answer 24: a known limit of the cheap variant, said plainly). D63 asks for every edge an edge runs on smoothly into; on an outline that is smooth all round, every chain of the rim reaches the edge of a spline face, which is refused by its kind. Measured on the lid (K): no list of edges of its rim passes, the straight top alone included. And a corner does not help: an edge that ends at a spline face is refused too, since the end of a chamfer or a fillet has to lie on a face that continues one of its own (measured K, on a rectangle with one side a spline: the top edge of a line that meets the spline at a corner is refused, the top edge of the side away from the spline and the vertical edge between two lines pass). The rule in one sentence: **an edge can be chamfered or filleted only when it is not an edge of a spline face and neither of its ends lies on one.** So the lid of scenario 15 has no chamfer, and a cover that needs a broken rim is drawn with arcs until a chamfer along a swept edge exists (a backlog row). `docs/onshape-import.md` records the same need: the chamfer of the converted disc is on the edges of its splines.
- **A sketch cannot stand on the face** (`nonPlanarFace`), and it is no axis (`invalidAxis`).
- **The extent `upTo` (2f) and the start `from` (2h)** build the same sides; `exactStart` takes the polyline of a loop without `exact`.

### What reads the exact outline

`selectionOutline` (`recompute/outline.ts`), through which the offset of regions (2a), the taper (2b) and the revolve (4a) read the outline, refuses a selection with a loop that has `sampled`: `invalidProfile` with the splines of the whole selection in `refs` (each once, sorted) and the text "The curve "c2" is a spline, which has no exact form: a profile with a spline cannot be offset, tapered or revolved. Draw that part with lines and arcs, or leave the offset, the taper or the revolve out." (plural for more). The text for a loop without `exact` and without `sampled`, a generated profile, stays.

- **The loops of the selection are its outer loops and its holes**, so a plate whose hole is a closed spline is not offset either, though its outer loop is lines (measured K); the refusal names the spline of the hole.
- **The revolve** (the owner's answer 23: refused now, a backlog row): a revolved spline is a general surface of revolution, which no `FaceInfo` describes (a `swept` surface is a translation), and the revolve re-divides the exact outline for half the chord tolerance. Taking it would need a variant of `OutlineCurve` for a spline (its control points, so that the division can be redone), the exhaustive switches of Ring 2 over it (6a counted about 25), and a general face kind besides `mesh`.
- **The offset and the taper**: the offset of a spline is not a spline; moving its polyline would make one face of many planes under one name, against what a side of an offset is (an exact surface). Refused.
- **The wall**: `WALL_CURVE_KINDS` stays `line`, `arc`, `circle`, so the command refuses a spline (structural, with the kinds in the text); a wall whose curve ID names a spline later (removed and added again in a batch) is refused in the recompute by the case of the spline in the wall's switch, `invalidProfile` "The curve "c2" is a spline; a wall runs along lines, arcs and circles.", `refs` the spline.

### Every switch on the kind of a curve

Two tables: the places of `master` at `9c43be9`, where the compiler was run (J), and the places 6a2, 6e, 6c and 6b will have added by the time 6d is implemented, read from their designs. The column "Found by" says how the implementer reaches the place:

- **1**: `tsc` stops there once `CurveShape` has the spline;
- **2**: it stops once `CURVE_POINTS`, `EntityKind` and `PlacedCurve` have it;
- **3**: it stops once the `Shape` union of that file has the variant;
- **hand**: it never stops; the place is found by this list. For such a place the table says whether there is anything to write.

"Never an operand" means: no constraint and no generator takes a spline, so a validated document never reaches the case; it throws as `unreachable` does, with the text of the place. The numbers E, A, P and M are those of 6a's part 3.

**On `master`:**

| # | Place | Found by | A spline |
|---|---|---|---|
| E1 | `CURVE_POINTS` and its two guards (`sketch-content.ts`) | 1 | `spline: []`; the guards count the fields of one ID |
| E2 | `curvePoints` | 1 | the control points, in order |
| E3 | `curve`, the validator (`features/sketch.ts`) | 1 | the case: the list, the limits, the repeats (contract, `SPLINE_REFUSALS`) |
| — | `entityOf` (`references/index.ts`) | 1 | the kind `spline`, once `EntityKind` has it |
| E5 | `setCurvePoint` (`document.ts`) | 1, then silent | refused by its own text; with the empty entry of the table it compiles and would give the generic text |
| E6 | `measure` (radius, diameter; `sketch.ts`) | 1 | never an operand: no value |
| — | `placedCurve`, `curveEnds` (`sketch.ts`) | 1 | the case of "The profile"; the first and last control point |
| E12–E14, E16 | `EQUATIONS.pointOnCurve`, `tangent`, `geometry.radius`, the size in `derive` (`analysis.ts`, five switches) | 1 | never an operand (the size: no radius, as a line) |
| E18 | `shapeOf` of `sketch-tools.ts` | 1 | undefined: nothing snaps to a spline, and the `Shape` of that file gets no variant, so E19 (`closestOn`) is unchanged |
| E20 | `cornerLines` (`ends`) | 1 | the first and last control point (`curveEnds`), so a corner of a line and a spline is refused naming "c2" (spline) |
| E21 | `nearestCurvePoint` | 1, then silent | none (no named point); compiles with the empty entry |
| — | the switch of `profileOf` on the placed curve | 2 | the spline shape, with its self-test |
| E9 | `curveOf` (`recompute/profile.ts`) | 2 | `{ type: 'general' }` |
| E11 | the wall (`wallOfCurves`, `recompute/outline.ts`) | 2 | refused, `invalidProfile` |
| E7, E8 | the functions over the profile's `Shape` (`distanceTo`, `midpoint`, `roundOf`, `carrierContacts`, the half-edges, the area, the polyline of a loop, the ray) | 3 | "The profile". The exact ones (`distanceTo`, `midpoint`, `roundOf`, `carrierContacts`) are never called with a spline: `compatible` takes its pieces as lines first |
| — | the direction and the common distance of the half-edges | hand | the reach and the direction of "The profile"; the line that computes the distance reads `pa` and `pb` of every shape, which a spline has too, so nothing stops, and that silent line is where the first design went wrong |
| — | `selectionOutline` (`recompute/outline.ts`) | hand | the refusal of "What reads the exact outline", for a loop with `sampled` |
| — | `exactStart` (2h, `recompute/extent.ts`) | hand | nothing to write: the polyline of a loop without `exact` |
| — | `soundTessellation` | hand | nothing to write: it reads the loops |
| — | `anchorProblem` (`sketch-tools.ts`) | hand | a snap to a spline refused, before `shapeOf` |
| E4, E10, E22–E24 | the radii of circles; the circle operand of a generator and the axis `sketchLine`; the catalog's kinds; `solverSetup`; `WALL_CURVE_KINDS` | hand | nothing to write: they ask for one kind, list the kinds they take, or pass every own curve |
| A1 | `buildPrimitives` (the adapter) | 1 | its points checked, no primitive |
| A2, A3, A5 | `pointOnCurve`, `equalRadius`, `radius` and `diameter` of `translate` | 1 | never an operand: throw |
| A4 | `rank` of the tangency | 1 | `spline: 3`, never reached |
| A6 | `fixed`, `usable`, `pairOf` | hand | nothing to write: they ask for one kind |
| P1 | `sketchView` (own curves and the curves of the result) | 1 | the view's spline shape: control polygon and polyline |
| P5 | `repointRow` (`panels/sketch.ts`), `CURVE_POINT_LABELS` | 1, then silent | no row for a curve without named points; with the empty entry it compiles and would show an empty choice |
| P2 | `polyline`, `closestOn`, `measure` (radius), `anchorOf` of the view | 3 | the polyline; the nearest point of it; no radius; never an operand |
| P3, P4 | `sort`, `roundDimension` | 3 | in no group (no constraint, no dimension from it); never reached |
| P6 | the pickers of lines | hand | nothing to write |
| — | the place of a drawing tool (`placeAt` of `sketch-mode.ts`) | hand | a curve snap to a spline dropped for a tool that does not hover ("The app") |
| — | the inferred direction (`sketchMove`), the scene (`sketchScene`), the label of the kind in the panel | hand | the kind `extension` and its label (the line tool, which hands `m.infer` to its batch, stops `tsc` once the mode's field has the third value, and narrows it); the control polygon; "Spline" |
| M1 | `sketchDetail` (`packages/mcp/src/tools.ts`) | hand | lists the curve with `points`, and `through` and `box` ("MCP") |
| — | `packages/engine/test/curve-kinds.test.ts` | a failing test | the kinds with `spline`; `unreachable` tried with another value |

`OutlineCurve` (Ring 2) gets no variant, so its consumers stay as they are; the profile simply gives them no exact outline for a loop through a spline.

**Added by 6a2, 6e, 6c and 6b** (from their designs; the compiler is run again on the tree 6d starts from, and "To verify" asks that every row be met):

| Package | Place | Found by | A spline |
|---|---|---|---|
| 6a2 | the axes of the origin | — | none: an axis is a line |
| 6e | `curvePredicates` (`sketch-cut.ts`) | 1, if it switches on the kind (6e's revision writes every reader of the kind as a switch) | `mayCut` false, `holdsPoint` false; `formsRegions` reads the flag |
| 6e | the shape functions of the contact search (`sketch.ts`) | 1 | the pieces of the polyline, as lines |
| 6e | `curveContacts`, `curvesTouch` and their callers | hand | they take no chord tolerance, and a spline has a shape only with one: the parameter is added, from the settings of the document a tool and the query already read for `profileOf` |
| 6e | the switches of `sketch-cut.ts` (the cut of a curve, the piece writer, `extendEnd`, the problem of an end) | 1 | refused by name with 6e's text; a spline is no target of `extend` and no `with` curve |
| 6e | the query `sketchContacts` (`query/sketch.ts`) | hand | the contacts of a spline and its reasons ("Queries and exports") |
| 6e | the test of a point in a loop (the face rule) | hand | nothing to write: 6e's revision tests a loop without exact curves on its polygon. 6d brings the first such loop and owes its two tests |
| 6c | the derive's switch (`references/derive.ts`) | 1 | the copy over the copies of the control points, in the same order |
| 6c | `occupies` and the place a curve is filed under | 1 | the control points in order or reversed; the middle of the two middle control points |
| 6c | the box of a shape for `nearPairs`, the box of a face | 3 | the box of the control points |
| 6c | the position stage of the joins | hand | nothing to write: it reads the ends through `curveEnds` |
| 6c | the short form of a derived entry in `get_sketch` | hand | nothing to write: copies are not listed curve by curve |
| 6c | "no snap to a copy" in the app | hand | one predicate with the spline, `holdsPoint` ("The app") |
| 6b | the validator of the kind `sketch` (`references/sketch.ts`) | hand | the two refusals: its `kind` is a union of its own, so nothing stops |
| 6b | the values of a projection, by the kind of its source | 1 | never reached after the validator: throws |
| 6b | the tool `projectSketch`; the candidates of the app's tool *From sketch* | hand | the splines left out and named; not offered |

### Queries and exports

- **`sketchContacts`** (6e's query, the owner's answer 5): where the outline curves of a sketch meet apart from common points, and why its profile is invalid. The first design put "or a spline crosses itself" into the hand-written advice of `get_sketch`; it belongs here, where the AI and the app's marks read one answer. 6d adds (contract, section 7):
    - a contact of a spline with another curve that forms regions, found on the polyline, with `repair: 'none'` and the reason that a spline is not cut and holds no point;
    - a spline that crosses or touches itself, as one contact whose two curves are the spline;
    - a spline of no length among `degenerate`;
    - the `reason` in words: "the spline "k" crosses or touches itself", "the curve "x" meets the spline "c2" away from a common end".
- **`section`**: a spline face across the sweep is a `curve` span through the corners of the mesh, along the sweep a `line` span (the table of `section.ts`); nothing changes.
- **DXF and SVG (D54)**: the export writes a curve span as straight pieces through its points, so a spline is a polyline of the mesh, within the chord tolerance; not a DXF `SPLINE`. The section is of the mesh and does not know the spline (a `SPLINE` would need the face to carry its control points). Scenario 15 compares the areas of the section read back by 6f, which a polyline keeps (calls.ts, `lidSection`).
- **`measure`**: a spline face is `swept` with its direction and no distance (as gear teeth); `mass`, `gap`, `print`, `body`, `partsList`: from the mesh, unchanged.
- **The hole feature, a joint, a generator, an axis**: a control point is a point and is taken where a point is; nothing else of a spline is.

### The app

Written against the table of the sketch tools as implemented (`sketch-tools/spec.ts` after the fix of 6a's review: `finish` returns the places to keep, the mode redraws after a click of a tool without `clicks` that keeps places, Enter is taken only while places are kept).

- **The tool Spline** (`packages/app/src/sketch-tools/spline.ts`, one line of `SKETCH_TOOL_UI` after `arc`): click the control points; Enter draws the spline through them; a click on the first place again, with at least three places kept, draws the closed spline; Escape drops them.
    - **No `clicks`.** `click` gets the places kept and the new one and returns all of them; the mode keeps them and redraws. The tool does not redraw in `click` (a redraw there would not show the place, which the mode keeps only after `click` returns).
    - **The closing click is told by position**: the new place within the reach of a pick (`PICK_REACH × host.pixelSize()`) of the first place. The first place is seldom a point of the sketch yet (nothing is sent before the end), so its snap cannot be compared.
    - **`finish`** (Enter): the batch of `splineCommands`, sent through `drawn` (the switch of construction curves applies). With a problem the message is said and the places are returned, so they stay: fewer than three places, or two of the places at one point (an existing point picked twice, which the engine would refuse as "listed twice", or two places within the length tolerance).
    - **Each place becomes a control point by `placeAnchor`**: a point snapped is used again; a place on a line, an arc or a circle is a new point held on it.
    - **`draw`** shows the control polygon to the cursor and, from three places, the spline.
- **A tangent start, inferred** (review, finding 6). A click onto a line lands on its segment, behind the end the spline starts at, and gives the cusp of I. So the tool infers the other side, as the line tool infers horizontal: `infer: 'extension'`, a second kind of the mode's inferred direction. While one place is kept and it is snapped to a point at which a line that can hold a point ends, a bare place under the pointer that lies beyond that end and within the reach of a pick of the line's extension is moved onto the extension; the mode shows the inference by its colour and a label, as it shows "horizontal". `splineCommands` then holds the second control point on that line by `pointOnCurve`: it finds the case again by position (the second place bare and on the extension of a line that ends at the first point, within the length tolerance), so the tool carries no state from the click to Enter. The rule is `extensionOf` (contract, section 9), one function for the mode and the batch.
    - Only at the start, and only for a line. The end of a spline is not known when its last-but-one point is clicked, and tangency to an arc needs a construction leg. Both are made afterwards with the constraints of the panel (the last-but-one point and the line selected: point on curve; a construction line and tangent), or by drawing the spline from its other end.
- **Which curves a drawing tool snaps to** (review, finding 4). The first design let the mode's picker skip splines for every tool. But the Select tool selects a curve through the same picker, so a spline could not have been hovered, selected, deleted, switched to construction, or handed to 6c's Mirror tool, which reads the selection. The rule is: the place of a tool that picks in the sketch and does not hover (the drawing tools) drops a curve snap to a curve that cannot hold a point and is the bare place under the pointer; the Select tool gets the curve. `holdsPoint(view, curve)` says which curves those are: not a spline, and not a copy of 6c, which has the same rule for the same reason and writes the predicate first. 6e's tools pick curves by their own `eligible` and get a spline; the engine's tool answers with the reason.
- **The view** (`sketch-view.ts`): a spline's shape is its control polygon and its polyline by `splinePolyline` at `VIEW_TOLERANCE` (0.0005) times the largest side of the box of its control points, a rule of the view as the arc's π/48 is; the regions the view fills are the engine's. The scene draws the control polygon of every spline of the open sketch thin and dashed and does not pick it; the control points are own points, drawn, picked and dragged as every point (a drag solves the sketch as today). A copy of a spline (6c) is drawn from the result's curves without a control polygon.
- **The panel**: the curve's kind reads "Spline"; no re-pointing row; the construction switch and delete as for every curve.
- **The snapshots** of `packages/app/test/app.test.ts` change: the bar has one more button. The commit says so.

### MCP

- `describe_api` shows the curve and its comment (`types.ts`) with no change in `packages/mcp`.
- **`get_sketch` says where each spline runs** (review, finding 5; the owner's answer 26). It listed only `{ id, type: 'spline', points }`, and the control points lie off the curve, so the AI could not tell how deep a grip is; the one function that says where the curve is, `splinePolyline`, is exported for the app, which is the hole D36 names. Each own spline now also has:
    - `through`: the points the curve passes at the joints of its Bezier pieces, its two ends included (`splineJoints`): three points for the grip, (42, 5), (40, 27), (42, 49);
    - `box`: the box of the curve (`splineBox`), `[minX, minY, maxX, maxY]`.
    - Both at the solved positions, rounded as the positions of points are; left out while a control point has no position. A copy of a spline has neither: 6c lists a derived entry in a short form, without its curves.
- **Why a profile with a spline is invalid** is answered by the query `sketchContacts`, not by a sentence of the advice of `get_sketch` ("Queries and exports").
- **No sketch tool.** A spline is `addPoint` for each control point and one `addCurve`; tangency is one more constraint (the comment of the curve). A tool with a list of anchors and tangency flags would add an input kind to the shared `SketchToolInput` for what the AI writes in three lines; rejected. The spline through given points (deferred) is the tool that will be worth one.

### The Onshape converter

Not 6d's: the mapping of Onshape's B-splines is 6h's (the owner's answer 25), on the model the plan names, after the format is checked against a dump (the review could not: the dump's folder of sketches was empty, so "poles, knots, degree" is from knowledge). What 6d delivers for it is `bsplineBeziers`: a non-rational B-spline of degree 1 to 3 becomes a chain of splines of `degree + 1` points (degree 1: lines), the poles own points, the ends of neighbouring pieces one point. The actuator of `docs/onshape-import.md` has splines only in the cycloidal disc, which the generator of D61 replaces with a better, exact profile, and its chamfer on their edges is lost either way ("Faces, edges and names").

### Other packages

6d is implemented after all of them but 6f and 6h. For each: what 6d writes into its code, and what 6d needs of it The needs are small: each is something the other design already states, or a line it should keep.

- **6a2 (the axes of the origin)**, the owner's answer 1. Nothing is written there. calls.ts mirrors about `origin/y` and holds the top's end on it, as 6c's calls do since their revision; the construction line `ay`, its point and its two constraints are gone. *Needs:* `origin/y` as an operand of `pointOnCurve` and as the axis of 6c's mirror, which is what 6a2 is.
- **6e (trim, extend, split)**. Its revision already carries what the review of this design found in its code: every reader of the kind of a curve is a switch, and a loop without exact curves is tested on its polygon `Loop.xy` with a margin of twice the chord tolerance (finding 3 here, finding 5 of the review of the step). What 6d still writes:
    - **The predicates**: a spline is not cut (`mayCut`) and holds no point (`holdsPoint`); it forms regions by its flag. So no tool cuts it, no contact with it is a cut, it is no target of `extend` and no `with` curve.
    - **The refusals** in the switches of `sketch-cut.ts`, by name, with 6e's text.
    - **The contact search**: the shape of a spline is its polyline, so `curveContacts` and `curvesTouch` get the chord tolerance; the query's cases ("Queries and exports").
    - **The two tests of a region that passes a spline**, with the first real loops of that kind. (A) The lid with its spline flank, extruded; the second notch of scenario 15, a circle across the top line `c3` of the source half, trimmed: the lid's region is followed, the lid is not in `dropped`, and its volume loses the two half discs (calls.ts, `notchWithGrip`). On the started implementation of 6e, as the review read it, no face had a sample, the lid kept region names that no longer existed and ended in `noProfile`. (B) A plate with a hole that is a closed spline, extruded; a notch trimmed into its edge: the plate keeps its hole and does not take the region of the spline (calls.ts, `plateWithSplineHole`). On the started implementation the test skipped a hole without exact curves, so a point inside it counted as plate and the hole's region was added to the plate's feature.
    - **The margin never bites for a spline.** 6e leaves a point within twice the chord tolerance of a polygon undecided because two polylines of one curve may differ. A spline is never cut, and its polyline is computed from its control points in one order, so every profile a tool builds in memory has the same points for it.
    - *Needs:* the readers of the kind as switches and the polygon test, both in its revision; `KnownUncut` keeps its member `spline`; `why` and `reason` of the query stay free texts.
- **6c (mirror and pattern)**. 6d adds:
    - **The copy** in the derive's switch: a copy of a spline runs over the copies of its control points in the same order (the image of a clamped B-spline under a rotation, a translation or a reflection is the B-spline of the images; a spline has no sense to turn, as an arc has). Its ends are `curveEnds` of the copy, so the position stage joins them as it joins a line's. The grip of scenario 15 is that copy (calls.ts, `oneRegionWithGrip`).
    - **`occupies`**: two splines occupy the same when their control points agree in order or in reverse within the length tolerance. A spline and a line or an arc never do; a spline that lies on one is an invalid profile, as two such curves are.
    - **The place a spline is filed under** in the grid of that pass: the middle of its two middle control points, `control[⌊(n − 1) / 2⌋]` and `control[⌈(n − 1) / 2⌉]` (for an odd count the middle one). Reversing the order swaps the two, and the mean of two numbers does not depend on their order, so both orders give the same place to the last bit (measured: 2000 random splines, no difference).
    - **The box** for the broad phase: of the control points (answer 15).
    - **The app**: the spline in the predicate that keeps a drawing tool from snapping to a copy.
    - *Needs:* those four places written as switches on the kind, so that the compiler leads to them; the ends of copies read through `curveEnds`; one predicate in the app for "a drawing tool does not snap to it".
- **6b (projection from another sketch)**, the owner's answer 22. A projected spline is refused, as 6b's design says, and both refusals are 6d's, since 6b is implemented first:
    - **The validator** of an entry `{ type: 'sketch' }`: `kind: 'spline'`, and an entity that is a spline in the source sketch whatever `kind` says, with "… is a spline, and a spline is not projected yet: project its control points as points".
    - **The tool `projectSketch`**: the splines of the source are left out of the batch and named in the answer with the reason; the rest of the sketch is projected. The app's tool *From sketch* does not offer a spline.
    - A later sketch therefore reaches a grip only through its control points and what `get_sketch` says of its curve. The first design said the opposite ("a spline of the result over the projected control points; 6b decides it"); contract section 5 no longer lists a projected spline.
    - *Needs:* the answer of `projectSketch` has a place for what it left out and why (its design names "skipped and named").
- **6f (import of an outline)**, after 6d: an SVG `C` is a spline of 4 points, a `Q` of 3, a chain of them splines sharing their ends; a DXF `SPLINE` of degree 2 or 3, not rational, becomes `bsplineBeziers` pieces, each a spline (degree 1: lines); rational and degree above 3 refused and listed. Its entities are reference geometry, so it decides whether a spline of an outline is a spline of the result or its control points and a polyline; 6d's shape function takes a spline from any source.
- **6h (the converter)**: the mapping of B-splines, with `bsplineBeziers` ("The Onshape converter").

## The document and the schema

A spline is a new member of `CurveShape`. **An older build refuses it by itself**: the validator of a curve takes the type from a list (`CURVE_KINDS` since 6a, a hand-written list before), so a load or a command with a spline fails with "…type: čeká se jedna z hodnot line, circle, arc", and a stored document (D62) is validated the same way. Nothing is dropped without a word, so **no upgrade step** and `SCHEMA_PENDING` stays 0. A field added to the spline later (`knots`, `degree`, `weights`) would be dropped by this build's validator, which rebuilds the curve from the fields it knows, and needs a step then.

## Where the code lives

| File | Change |
|---|---|
| `packages/engine/src/types.ts` | `CurveShape` gets the spline with its comment (contract section 1) |
| `packages/engine/src/catalog.ts` | `EntityKind` gets `spline` |
| `packages/engine/src/spline.ts` (new) | the Bezier pieces, the steps, the polyline, the joints, the box |
| `packages/engine/src/sketch-content.ts` | `CURVE_POINTS.spline`, the guards, `curvePoints` |
| `packages/engine/src/features/sketch.ts` | the case of the validator |
| `packages/engine/src/document.ts` | `setCurvePoint`'s refusal |
| `packages/engine/src/sketch.ts` | `curveEnds`, `placedCurve`, the profile's spline shape with its self-test, the reach and the direction of the half-edges, `Loop.sampled`; the box of a spline in 6c's broad phase; the spline in 6e's contact search, which gets the chord tolerance |
| `packages/engine/src/recompute/profile.ts`, `outline.ts` | `curveOf`; `selectionOutline`'s refusal; the wall's case |
| `packages/engine/src/analysis.ts`, `sketch-tools.ts` | the cases of the table of switches; `anchorProblem`; in 6b's tool `projectSketch`, the splines left out |
| `packages/engine/src/sketch-cut.ts` (6e) | the predicates of a spline, the refusals in its switches. Nothing in the face rule |
| `packages/engine/src/query/sketch.ts` (6e) | the contacts and the reasons of a spline in `sketchContacts` |
| `packages/engine/src/references/derive.ts` (6c) | the copy of a spline, `occupies`, the place it is filed under |
| `packages/engine/src/references/sketch.ts` (6b) | the two refusals of a projected spline |
| `packages/engine/src/index.ts` | exports `bsplineBeziers`, `splineBeziers`, `splinePolyline`, `splineJoints`, `splineBox`, `MAX_SPLINE_POINTS` |
| `packages/solver-planegcs/src/index.ts` | A1 to A5 |
| `packages/app/src/sketch-view.ts`, `sketch-commands.ts`, `sketch-mode.ts`, `sketch-tools/spec.ts`, `sketch-tools/spline.ts`, `sketch-tools/index.ts`, `panels/sketch.ts` | the view's shape and `holdsPoint`; `splineCommands` and `extensionOf`; the place of a drawing tool, the inferred `extension`, the control polygon; the kind of `infer`; the tool and its line; the label of the kind and no re-pointing row |
| `packages/mcp/src/tools.ts` | `through` and `box` of a spline in `sketchDetail` |
| tests | `packages/engine/test/spline.test.ts` (new), `curve-kinds.test.ts` (the kinds with `spline`), `profile.test.ts`, `modules.test.ts` (the leaf), `review.test.ts` (the closed spline with long lines at its point; the short pieces); the tests of 6e, 6c and 6b for their places; `packages/solver-planegcs/test`; `packages/mcp/test/tools.test.ts`; `packages/app/test` (the tool, the snap rule, the snapshots); `packages/scenarios/test/scenario15.test.ts` (a `describe` of its own, from calls.ts) |
| docs | below, by point of work |

**Points of work** (CLAUDE.md: each is implemented, tested, documented and reviewed before the next, with a commit of its own and one for the fixes of its review):

1. **The engine and the adapter**: the kind, `spline.ts`, the profile, the faces, the refusals, every switch of the two tables, the places of 6e, 6c and 6b, with their tests. Docs: `architecture/sketch.md` (the kind; the profile of a sketch with a spline is the profile of its polylines, where the file says validity is tested on exact curves; the half-edges; the solver), `naming.md` (the face), `extrude.md` (the side), `revolve.md` (the refusal), `ports.md` (the input), `repository.md` (the module), `api.md` (the curve in `addCurve`, `setCurvePoint`), `verification.md` (the comparison of the half-edges with the chain of lines, kept as a test on a fixed seed). Review **full** (new geometry).
2. **MCP**: `get_sketch`, the query's cases. Docs: `architecture/ai.md` (`get_sketch`, the comment of the curve). Review light.
3. **The app**: the tool, the inferred extension, the view, the snap rule. Docs: `ui/sketch.md`. Review light.
4. **Scenario 15**, the part of 6d in `packages/scenarios`, and the indexes: `decisions.md` (D70), `requirements.md` (item 15), `backlog.md` (the rows written with this revision checked against what was built), `docs/onshape-import.md` (the row "Splines": the kind exists, the converter's mapping is 6h's; the chamfer on the edges of splines stays a gap). Review light.

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
15. **The picker of the mode skipping splines for every tool** (the first design). The Select tool picks through it, so a spline could not have been selected or deleted. Only a drawing tool's place drops the snap.
16. **The reach of a spline as its chord, or as the length of its polyline when it is closed** (the first design). A closed curve does not get half its length away from its point: both halves got one direction and a region was lost without a word (measured F).
17. **A projected spline as a spline over projected control points** (the first design). 6b refuses a projected spline, and the owner agreed (answer 22). The control points projected as points give a later sketch what it can be dimensioned from; a projected spline as a curve waits for a package that needs it.
18. **"A spline crosses itself" in the advice of `get_sketch`** (the first design). The reasons of an invalid profile are 6e's query (answer 5), one answer for the AI and the app.
19. **The polyline of a spline in `get_sketch`.** Tens to hundreds of points per curve at the chord tolerance of the document, and a different list after a change of that setting. The joints are a handful of points the curve passes exactly, and with the box they say how deep and how wide it is.
20. **The box of the control points as the `box` of `get_sketch`.** It is the cheap bound the broad phase uses, but for the grip it is twice as deep as the curve (H), which is the mistake the field is there to prevent.
21. **A click onto the line as the tangent gesture of the tool** (the first design). It lands behind the end and gives a cusp (I). The tool infers the extension.
22. **The tool remembering the inferred tangent in the place it keeps** (a new kind of snap). The mode drops and compares kept places by their snaps; a place on the extension is found again by its position.
23. **An inferred tangent at the last point, or to an arc.** The last point is not known when the one before it is clicked, and an arc needs a construction leg; both are two clicks in the panel afterwards.
24. **The self-test skipping pieces shorter than the length tolerance**, in place of the polyline leaving such points out. See "The polyline".

## Known limits

- **No point on a spline and no tangency in its middle**; no dimension of the curve itself (its length, a distance to it). Constrain the control points.
- **The rim of a part with a spline takes no chamfer and no fillet.** Every edge of a spline face is `other`, also the straight one where it meets a planar side, and an edge that ends at a spline face or runs on smoothly into one of its edges is refused too. On an outline that is smooth all round, such as the lid of scenario 15, that is every edge of the rim (the owner's answer 24; a backlog row for a chamfer along a swept edge).
- **No offset, taper, revolve or wall of a profile with a spline** (answer 23 for the revolve), also when the spline bounds only a hole of the region.
- **Not cut and not projected.** A spline is not trimmed, split or extended, a curve that crosses one cannot be cut there, and a later sketch reaches it only through its control points (answer 22).
- **The profile of a sketch with a spline is the profile of its polylines.** Whether a spline that comes within a few micrometres of another curve, or of itself, crosses it is decided at the chord tolerance of the document, and a change of that setting can make such a sketch valid or invalid, in either direction (measured K).
- **A cusp where a spline turns back over the line it should continue** is a valid profile, and nothing reports it ("Open", 1).
- **Uniform knots only**: an imported spline of other knots becomes several splines, so several faces.
- **A closed spline has a corner at its point** unless constraints put its first and last legs on one line.
- **Removing a control point removes the spline**; edit by replacing it in a batch. The app has no insertion or removal of one control point.
- **At most 64 control points**: a longer curve is several splines joined at their ends. At a chord tolerance far below its size a spline has up to 4096 straight pieces per Bezier piece.
- **The app infers a tangent start only**, from a line; a tangent end, and tangency to an arc, are constraints added afterwards.
- **A copy of a spline has no `through` and `box` in `get_sketch`**: its entry's transform says where it is.
- **The DXF and SVG of a section write a spline as a polyline** within the chord tolerance.

## To verify before the implementation

Verified since the first design, by the review's prototype and the revision's probes ("Measured"): the lid as one shape of the real profile (valid, one region, the volume of the chain to the last digit); a tangent join to a line and to an arc; a crossing spline; a spline touching a line between vertices; a closed spline alone, with a line at its point, with a region of long lines at its point, and as a hole; the time of two splines of 64 points; that a spline in the solver's input changes no position; the compiler on `master`.

Still to verify, on the tree 6d starts from (after 6b is merged):

- **The compiler again**: every row of the second table of "Every switch" is met or is by hand, and nothing 6e, 6c or 6b added reads the kind of a curve outside a switch (a ternary on `curve.type` gives a spline an empty list without a word; the review found three on 6e's started branch).
- **The two cases of 6e's face rule with a real spline loop** (calls.ts, `notchWithGrip` and `plateWithSplineHole`). 6e's revision measured its polygon test on its own cases with the exact test switched off; no spline was in that code.
- **6c's derive with a spline**: the copy's ends joined by position as a line's, the lid one region under 6c's names; a spline mirrored onto itself (its control points symmetric about the axis) forms no regions by `occupies`.
- **That `splinePolyline`, `splineJoints` and `splineBox` of the engine give the prototype's numbers** (the scenario's volumes and the texts of the comment depend on them).
- **That `modules.test.ts` takes `spline.ts` as a leaf.**
- **That the app's snapshots change only by the new button and its hint**, and that the Select tool hovers and selects a spline.
- **The Onshape format** ("poles, knots, degree") is 6h's to check against a dump.

## Tests the implementation owes

- `spline.ts`: the Bezier pieces evaluate to the B-spline (de Boor) at random parameters; the polyline keeps the tolerance on random splines (the measurement A as a test); the ends exact; `bsplineBeziers` on a non-uniform knot vector; no piece at or below the length tolerance for control points at one place (G); the joints and the box of the grip and of the closed square (H); the box inside the box of the control points on random splines.
- The validator: each refusal of `SPLINE_REFUSALS`, a projected point, a radius; `setCurvePoint` with its own text; the cascade of a control point; a constraint on a spline refused; the replacement in a batch keeps the names.
- The profile: the lid; a tangent join to a line and to an arc; a crossing spline and a spline touching a line between vertices; a closed spline alone, as a hole, and with a dangling line at its point; **a closed spline with a region of long lines at its point** (the review's case, in `review.test.ts`); the comparison of F on a fixed seed, the spline as one shape against the chain of its polyline (regions and validity), with a time bound loose enough for a loaded machine; `Loop.sampled`; a region away from the splines of its sketch keeps `exact` and is offset; two splines of 64 points under a time bound.
- The faces: the swept side, its four edges `other`, a projection and a chamfer of one refused; the rim of the lid refused for every list of its edges tried in K, and the edges of a part that pass (K, the corner case).
- The refusals of the offset (also through a hole), the taper, the revolve and the wall, with their `refs`.
- The adapter and the analysis: a spline adds no equation; free control points count two each; a second control point held on a line keeps the side it starts on (I).
- 6e's places: every tool refusing a spline by name, as the curve and as `with`; no cut at a contact with a spline; the query's contacts and reasons (a curve across a spline, a self-crossing spline, a spline of no length); the two cases of the face rule.
- 6c's places: the copy of a spline under a mirror and under a circular pattern; `occupies` for a spline mirrored onto itself, in both orders of its control points; the box of the broad phase (a random sketch with splines against the double loop, in 6c's comparison).
- 6b's places: the validator refusing `kind: 'spline'` and a spline entity; `projectSketch` over a sketch with a spline (the rest projected, the spline named).
- MCP: `describe_api` names `spline`; `get_sketch` lists its `points`, `through` and `box`, and leaves the two out for an unsolved sketch; `sketchContacts` over a sketch with a self-crossing spline (its rows in `queries.test.ts` are 6e's).
- The app: the tool (three clicks and Enter, a closing click told by position, Escape, too few places kept with a message, a point picked twice); the inferred extension (the place moved, the constraint in the batch, none behind the end); a drawing tool does not snap to a spline and the Select tool selects it; the control polygon in the scene; the snapshots.
- Scenario 15, the part of 6d ([calls.ts](calls.ts)), in `packages/scenarios`.

## Open

The two questions of the first design are answered (the revolve of a spline profile: refused, answer 23; the converter's B-splines: 6h, answer 25). One is new:

1. **Should something report the cusp of a spline that turns back over the line it should continue?** A second control point held on a line behind its end gives a join of zero angle (measured I); the profile is valid, the body closed, and neither `get_sketch` nor the query says anything. The same shape can be drawn today with an arc that leaves the end of a line back along it. *Recommendation: not in 6d. The comment of the curve tells the AI to start the point beyond the end and to read its position after the solve, `through` shows where the curve went, and the app's tool puts the point on the right side. A general advice of `get_sketch` for two outline curves that leave a vertex in one direction (a line and an arc, or a spline) is a small package of its own if the cusp turns up in practice; it is a row of the backlog.*

## Reviews

The first design, its contract and its calls were written on Opus 5.5 on 2026-11-17. No review of them finished then: a brief was written and an `agy` run was interrupted, so the state line of that version ("reviewed as recorded") was not true.

### Round 1 (2026-11-24), an independent review on Fable, and the revision of the same day

One reviewer, read-only, on Fable, with a prototype of its own written from the text of the design (a scratch copy of `packages/` with the spline in the validator, the profile, the side and the adapter; no app, and none of 6e, 6c and 6b, which are not in `master`), five probes, the compiler spike, and the code of the started branch of 6e and the designs of 6b, 6c and 6e read. Verdict: no blocker; six major findings, seven minor, four nits; every number of "Measured" reproduced. The report is in the scratchpad of the session, `step6-review/reports/6d-design.md`, its prototype and probes in `step6-review/6d-design/`. The revision was written on Fable; every finding was checked before it was acted on, and what the revision measured itself is in "Measured", F to K.

| Finding | Severity | Holds? | What changed |
|---|---|---|---|
| 1. The direction of a half-edge is wrong for a closed spline once long curves meet its point: both halves get one direction, and a region disappears with `valid: true` | major | yes (run again: the case reproduced; against the chain of lines the first rule lost a region in 2,643 of 14,843 random sketches) | "The profile", the half-edges: the reach of a spline is the largest distance of its polyline from the vertex, the direction is to the first place the polyline leaves the circle of the common distance. No difference from the chain in 14,843 sketches (F). The test with long lines at the point of a closed spline is owed |
| 2. The design is written for an order that no longer holds: its parts on 6b, 6e and 6c, its table of switches, contract section 5, the header of calls.ts | major | yes | The state line; "Other packages" for the sequence 6a2, 6e, 6c, 6b, 6d; two tables of switches, the first from the compiler on `master` at `9c43be9` (J), the second from the three designs, with what the compiler does not reach; the refusals of a projected spline are 6d's; the reasons of an invalid profile in 6e's query; the box of the broad phase; calls.ts about `origin/y`; the place 6c files a spline under |
| 3. After 6d, 6e's face rule loses or mis-assigns every region bounded by a spline (a loop without `exact` answered "outside", a hole without it was skipped) | major | yes for the started branch; 6e's revision has since changed the rule (a loop without exact curves is tested on its polygon) | `sketch-cut.ts` is among the places; "Other packages", 6e: nothing to write in the rule, the two cases (the lid with the second notch; a plate with a spline hole) as tests and in calls.ts. Not measured with a spline: 6e's revised prototype has none ("To verify") |
| 4. "No snap to a spline, for every tool" makes a spline impossible to select, delete or hand to 6c's tools | major | yes (the Select tool picks through the same function) | "The app": only the place of a drawing tool drops the snap; `holdsPoint`, one predicate with 6c's copies |
| 5. Nobody knows where the curve runs: the "grip 4 deep" is 2 deep, and `get_sketch` lists only control points | major | yes (the curve passes (40, 27); H) | `through` and `box` in `get_sketch` (answer 26), `splineJoints` and `splineBox` in `spline.ts`; the comment of the curve; the texts of the scenario say "the control point pulled in by `grip`; the curve is `grip / 2` deep" |
| 6. The tangent gesture gives a cusp, and the mode cannot do what the tool describes | major | yes for the cusp (I: the solver keeps the side; a click onto the line is behind the end). The mode's two defects are fixed in `master` by the fix of 6a's review | "Tangency": the side and the recipe; "The app": the inferred extension, found again by position at Enter; the tool written against the table as implemented (no redraw in `click`, `finish` returns the places, the closing click by position) |
| 7. No edge of the lid's rim can be chamfered or filleted | minor | yes; and a corner does not help either (K, run by the revision) | Said plainly in "Faces, edges and names", in the comment of the curve and in "Known limits"; a backlog row; the lid has no chamfer (answer 24) |
| 8. Validity depends on the chord tolerance, in both directions | minor | yes | "The profile", the first bullet; "Known limits"; `architecture/sketch.md` gets the exception |
| 9. Pieces shorter than the length tolerance make a false self-touch | minor | yes (G) | `splinePolyline` leaves out a point nearer than the length tolerance to the last one kept; valid at all four tolerances, no point lost on 2000 random splines |
| 10. Missing from "Where the code lives" and "Tests": `curve-kinds.test.ts`, the backlog, `ai.md`, `api.md`, `verification.md`, `onshape-import.md`; the docs sit in the last point of work only | minor | yes | The table of files; four points of work, each with its docs; the backlog rows written with this revision |
| 11. "Reviews" was empty while the state line said "reviewed as recorded"; the measuring scripts were gone | minor | yes | This section; the state line; "Measured" says where each number was measured and that A to E were reproduced by the review |
| 12. The comment offers tangency "to an arc or a circle at an end on it"; an end on an outline circle makes the profile invalid | minor | yes | "Tangency"; the comment: an arc that ends at the point, or a construction circle |
| 13. `splineCommands` answers undefined only for consecutive equal places; a point picked twice elsewhere reaches the engine's refusal | minor | yes | It answers with a message for any two places at one point, and for too few |
| Nit. The allowances of calls.ts have small margins (0.486 against 0.52; 0.357 against 0.4) | nit | yes | The volume is first compared with the polygon of the region, which it equals; the allowances against the values by hand are wider |
| Nit. `setCurvePoint` and `nearestCurvePoint` compile with the empty entry of the table | nit | yes (J) | Marked "1, then silent" in the table of switches; the own text and its test stay |
| Nit. `MAX_SPLINE_PIECES` is per Bezier piece | nit | yes | Said in "The polyline", the contract and "Known limits" |
| Nit. A plate whose hole is a closed spline cannot be offset | nit | yes | "What reads the exact outline"; "Known limits"; a test |

Checked and found sound by the review, and unchanged: the measurements A, B and E; the lid's volume as one shape; the solver (no position moved by the spline, free control points two degrees each); the flank as one swept face with four edges `other`; the refusals and their texts; the replacement of a spline in a batch; the section as DXF; no schema step (an older build refuses the kind aloud); the side-face naming; that neither the fillet nor 6e's clean-up of points removes a spline by cascade; the decisions on the fields, the cascade and the rejected alternatives; and that planegcs 1.3.0 has the deferred full variant.

**What this revision changed that no reviewer has read**: the rule of the half-edges as rewritten, and the argument why it orders them; the rule of the short points of a polyline; `splineJoints` and `splineBox`; the inferred extension of the app's tool and how the batch finds it again; `holdsPoint`; the cases of a spline in 6e's query; the second table of switches, which is read from designs and not compiled; the two new functions of calls.ts. The first three are measured; the rest are argued, and the part a review of this revision should read first is the second table and "Other packages", because the code they describe does not exist yet.

**The external reviewers** (`codex`, `agy`) have not read this design: the first design's `agy` run was interrupted, and none ran on the revision.

### The owner's answers (2026-11-24)

The numbers are those of "Decisions of the owner" and "Later answers" in [6-cross-review.md](../6-cross-review.md); every answer was "yes" to its recommendation.

| # | Answer | Where it is in this design |
|---|---|---|
| 1 | The axes of the origin come before 6c, as the point 6a2 | calls.ts mirrors about `origin/y` and holds the top's end on it; the stand-in axis `ay`, its point and its two constraints are gone |
| 5 | The places where curves cross are a query of 6e | "Queries and exports": the contacts and the reasons of a spline in `sketchContacts`; nothing in the advice of `get_sketch` |
| 15 | The broad phase of the profile is 6c's | "The profile": the box of a spline is the box of its control points; "Other packages", 6c |
| 19 | Curves that are not own join by position | Nothing changes: the ends of a copy of a spline are `curveEnds` of the copy, which 6c's position stage reads. No reference curve is a spline (answer 22) |
| 22 | A projected spline is refused; 6d writes both refusals | "Other packages", 6b; contract section 5; `SPLINE_NOT_PROJECTED`, `SPLINES_LEFT_OUT` |
| 23 | The revolve of a profile with a spline is refused now; a backlog row | "What reads the exact outline"; the row |
| 24 | The rim of a part with a spline cannot be chamfered or filleted: a known limit, said plainly, with a backlog row; the lid has no chamfer | "Faces, edges and names", with the rule in one sentence; "Known limits"; the comment of the curve; the row; calls.ts keeps the chamfer only as a refusal |
| 25 | The converter's B-splines are 6h's | "The Onshape converter"; 6d delivers `bsplineBeziers` |
| 26 | `get_sketch` gives each spline the points at the joints of its Bezier pieces and its box | "MCP"; contract section 7 |
| 3, 4 | 6f assembles scenario 15; 6h closes the step with the converter | calls.ts is 6d's part on its stand-ins; the second notch with the flank in is 6d's (plan, "Who builds what") |

## Rows for the indexes

**docs/d36/README.md**, the row of 6d, column "Design now":

> full ([6d-sketch-spline/design.md](6d-sketch-spline/design.md), D70), revised 2026-11-24 after its independent review and the owner's answers 22 to 26: a curve kind `spline` over 3 to 64 own control points (`{ type: 'spline', points }`, closed by the first point again), a clamped uniform non-rational B-spline of degree min(3, n − 1), with no degree, knot or weight field (any B-spline of degree up to 3 is a chain of Bezier splines exactly, `bsplineBeziers`); the solver sees only the points (the adapter adds no primitive, no constraint takes a spline; tangency at an end by the end leg of the control polygon, on the side the point starts on); the profile takes a spline as one curve over its polyline within the chord tolerance, with a self-test, closed splines, and half-edges that leave a vertex towards the place the polyline leaves a circle about it (no difference from a chain of lines on 14,843 random sketches); a loop through a spline has no exact curves (`Loop.sampled`), so the offset, the taper and the revolve refuse it by one message and the wall at its command; the side face is one swept face per spline with edges `other`, so the rim of a part with a spline takes no chamfer or fillet (a known limit); not cut by 6e's tools and not projected by 6b, both refusals written by 6d; `get_sketch` gives the points a spline passes and its box, and 6e's query the reasons of an invalid profile; DXF and SVG write it as a polyline; the app's tool Spline with an inferred tangent start, the control polygon, no snap of a drawing tool to a spline; no command, no issue code, no schema step (an older build refuses the unknown kind). Open for the owner: whether a cusp at a tangent start is reported

**docs/decisions.md**, the row of D70:

> | D70 | [6d Splines, the cheap variant](d36/6d-sketch-spline/design.md) | designed 2026-11-17; revised 2026-11-24 after an independent review and the owner's answers 22 to 26 ([d36/6-cross-review.md](d36/6-cross-review.md)); not implemented | A spline is a curve over 3 to 64 own control points, a clamped uniform non-rational B-spline of degree min(3, n − 1), closed by repeating its first point; the solver sees only the points and no constraint takes a spline (tangency at an end by its end leg); the profile uses its polyline within the chord tolerance; one swept side face with edges of the kind `other`, so no chamfer or fillet of the rim of a part with a spline; offset, taper, revolve and wall refused; not trimmed, split, extended or projected; `get_sketch` says where the curve runs; no schema step |

**docs/requirements.md**, validation scenario 15, the part of 6d:

> *Splines (6d, D70).* Step 4: the flank of the lid's half is a spline over five control points (a grip: the middle control point pulled in by `grip` = 4 at mid-height, so the curve is `grip / 2` = 2 deep; its end legs 10 long, vertical and tangent to the corner arcs), mirrored with the half about `origin/y` by 6c into one region named as before; the copy of the spline runs over the copies of its control points. The half is fully determined; `get_sketch` gives the three points the grip passes, (42, 5), (40, 27), (42, 49), and its box; the lid's area by hand 4436.1398 mm² (each grip 9.8 · `grip`), the polygon at the chord tolerance 0.2352 below; `grip` = 6 moves the control point and the volume follows. The grip is one swept face whose four edges are of the kind `other`; its offset, a revolve of a spline, a wall along it, a chamfer of its edge (the lid has none: no edge of its rim can be chamfered), a trim of it, a constraint on it and `setCurvePoint` are refused; a closed spline is one region (240 mm² by hand) and one side face; a self-crossing spline makes the profile invalid and the query `sketchContacts` says why; a sixth control point by replacing the spline in a batch keeps every name. Step 6: the second notch, a circle trimmed into the top line of the source half, with the spline flank in: the lid's region, whose loop has no exact curves, is followed through the cut; and a plate with a hole that is a closed spline keeps its hole through a trim of its edge. Step 7: the section of the lid as DXF has the area of the region's polygon ([d36/6d-sketch-spline/calls.ts](d36/6d-sketch-spline/calls.ts)).

**docs/backlog.md**, "Kandidáti": the rows of the full variant of the spline, a spline through given points, the revolve (and the offset, the taper and the wall) of a profile with a spline, a chamfer and a fillet along a swept edge, trim, split and extend of a spline, a projected spline, and the advice for a cusp; the paragraph "Splines" of the assessed features points to them.
