# 4c Chamfers and fillets of edges that run out into round faces (D67)

**State: design, written on 2026-11-17 against `master` at `ad8cf61` (every package of D36 merged, schema version 9), with a spike against the real kernel adapter ("Measured"); revised after the first round of reviews ("Reviews"), which cut the scope down to the run-out, after the second, which added the void check and an exact side test, and after the third, which put the void check on the actual tools. Ready for implementation: no fourth round; what is open is under "Known limits".** Written by Claude Opus 5.5. It builds on 4b (D63, [../4b-edge-chamfer-fillet/design.md](../4b-edge-chamfer-fillet/design.md), as implemented: [../../architecture/edge-blend.md](../../architecture/edge-blend.md)). It adds no feature type, face role, issue code, edge name field, edge kind, command, query or schema step. It widens which ends of an edge `chamfer` and `fillet` accept, with new details of the errors.

Files: [contract.ts](contract.ts) (what is accepted, the least crossing angle, the texts, the new parts of the recompute), [calls.ts](calls.ts) (validation scenario 17), and the spike `spikes/edge-blend-round-ends.spike.ts`.

## Where it came from

Converting a real Onshape model (a 3D-printed cycloidal actuator, [../../onshape-import.md](../../onshape-import.md)) converted 4 of 10 chamfers and none of its one fillet. Every refusal was a limit of D63:

| Part, feature | Geometry | What it is | This package |
|---|---|---|---|
| Housing, Chamfer 2 (0.5, 32 edges) | The top rim of a bore R 29.5 broken into 16 arcs by 16 pin pockets r 2.5 cut into its wall | An arc that runs into the air of a pocket (a cylinder parallel to its axis) | **Covered** (a run-out, "Measured", R1) |
| Housing, Fillet 1 (r 1, 32 edges) | The vertical lines where the pockets meet the bore | A straight edge between two cylinders; and each pocket meets the bore in two lines that share one name (the two faces) | **Not covered**: deferred ("Deferred", 1 and 2) |
| Motor shaft, the chamfer of a slot (0.5) | Two straight convex edges at the top of a slot from a hex socket out through the shaft's cylinder r 6 | At the outer end a run-out into the air outside a cylinder; at the inner end a face of the socket | **Outer end covered** (R4). The inner end is one plane of the socket in a synthetic model (D63 ends there already); in the Onshape model D63 names two faces of the socket there, which this package does not take ("To verify") |
| Motor shaft Chamfer 1, motor shell Chamfer 2 (4, 8 edges, concave) | The foot of a rib standing flush with the outer edge of a round plate | A concave edge that runs past the rim into the air: the blend has to **stop** at the rim | **Not covered**: stops are deferred ("Deferred", 3) |
| Input shaft, Chamfers 1 and 2 (0.5) | The circular edges of two eccentric lobes stacked | The rim of the lower lobe runs under the upper one, to a vertex where it meets the upper lobe's side and its underside where it overhangs (two faces); and the converter split each circle into arcs (half a smooth chain, tried one by one) | **Not covered**: two faces at an end, refused with both named (R7); the split arcs are a matter of the converter ("For the plan") |

The model's data is not in the repository (the converter writes it to a folder of its own); the motor-shaft and motor-shell cases are reconstructed from the messages and the description.

## The problem from the user's side

In printed and machined parts the edges people chamfer or fillet often end at a round face, or run between round faces:

| Case | Example | The edge | Its end |
|---|---|---|---|
| A rim interrupted by a void | The rim of a bore broken by pin pockets, slots, bolt holes, a keyway; the top edge of a plate notched by a hole near its side | Circular (the rim) or straight | Runs into the air of the pocket, the slot or the hole: a cylinder, a countersink cone, or a plane of a slot off the bore's axis |
| An edge out through a round wall | The edges of a slot in a shaft that runs out through the shaft's cylinder | Straight | Runs into the air outside the cylinder |
| An edge into a boss | The foot of a rib that runs into a boss; a gusset against a tube | Straight, concave | Runs into the boss's material |
| An edge into a wall | The top edge of a rib that runs into a taller boss; the rim of a lobe under another lobe | Convex | Would cut into the wall: the blend has to stop at it |
| An edge past a rim | The foot of a rib flush with the rim of a round plate | Concave | Would add material outside the rim: the blend has to stop at it |
| Two cylinders with parallel axes | A pocket cut into a bore's wall, two overlapping holes, the flat of a D-shaped shaft | Straight, between round faces | Planes |
| An end at an earlier blend | An edge that ends at the fillet of a boss's foot or at a chamfer's cone | Any | A torus, a cone; often tangent to a face of the edge |

**What users expect.** Fusion and Onshape run the blend into the round face: the chamfer's or fillet's surface goes on until it meets that face, and the end of the new face follows the round surface. The user picks no end condition.

**What a 3D-printing user can live with.** A printer lays lines of 0.4 mm in layers of 0.1 to 0.3 mm and holds its outline to about ±0.1 mm. A deviation of a few hundredths of a millimetre is invisible and changes no fit. The obvious cheap end, the tool ending **in the plane across the edge at its end vertex**, is not fine in general: the first round measured a corner 0.48 mm proud of a rim (a concave chamfer of 4 on a rim of 25), 0.5 mm³ cut under another lobe, and a notch the size of the chamfer behind a hole that only notches the edge (3.7 mm³ for a chamfer of 2). Where the round face crosses the edge squarely it is nearly right, but the kernel refused fillets ending so at a pocket, whose cap lies on a vertex of the pocket's polygon. Rejected (alternative 1).

**What this package covers.** The **run-out**: an edge that runs, past its end, into what the tool does not change beyond the end face. A convex edge runs into the face's air: the rim into a pocket, an edge into a hole that breaks it, a slot's edge out through a shaft's cylinder, the rim of a hole out through a disc's side, the rim of a bore into a keyway. A concave edge runs into the face's material: the foot of a rib into a boss. The tool runs on until its corner has crossed the end face, and the air or the material beyond does the rest. A check before the booleans proves that the part of the tool past the end takes (or adds) nothing beyond the end face: a pin standing in the pocket, a post in the hole or a pocket shallower than the chamfer is refused, not cut. The result is then the blend made before the feature that made the end face. It costs two kernel calls per run-out on solids the size of the run-out, moves nothing off a face, and was measured equal to that reference on every accepted case of the spike. Everything else on the list is refused with a message that says what to do, or deferred with the reasons the reviews found, so that the later package starts from them.

## The cheap variant

**In:**

- D63's edges, unchanged: straight between two planes; circular between faces about one axis whose profile in a half plane through the axis is a straight line (a plane across the axis, a cylinder, a cone).
- One more kind of end, the **run-out**, at one end face C:
  - a straight piece: C a **cylinder** of any axis (measured: vertical, tilted 25°, a body whose faces meet at 104°);
  - an arc: C a **cylinder whose axis is parallel to the arc's**, or a **plane parallel to the arc's axis that does not hold it** (the side of a keyway or of a slot through a bore's rim; D63 refuses a plane off the axis);
  - beyond C may be the inside of the cylinder (a hole, a pocket, a boss) or its outside (a slot out through a shaft, a hole broken out through a disc's side);
  - faces at the end that lie on one cylinder (the same axis line and radius) are one end face, named by the one next to face `a`, else the first. Measured: two flush extrusions of the same circles leave one face at every end vertex, since their seam does not pass through it; the rule is cheap and keeps a seam that does from refusing the end;
  - the edge runs, past its end, into what the tool does not change beyond C: a convex edge into C's air, a concave edge into C's material;
  - it crosses C at **10° or more** (`BLEND_MIN_CROSSING`), read where its line or circle meets C exactly;
  - the corner of the blend crosses C before the tool reaches the next piece of the same edge, and two run-outs into one gap do not reach across it;
  - the part of the tool past the end takes nothing beyond C (convex) or adds nothing there (concave): the void check.
- The tool runs on until every point of the corner lies beyond C by the lift; the chamfer or fillet then ends on C's surface. Nothing else changes: names, facts, faces, codes.

**Refused, with a detail that says what to do** (`unsupportedEdge` unless said otherwise):

- **A stop** (deferred): a convex edge that runs into C's material, or a concave edge that runs into C's air. "The edge runs into the material of the end face in refs, so the chamfer would have to stop at that face, which this feature does not do yet; where that face comes from a later feature, chamfer the edge before it." For a concave edge, "runs past the end face in refs into the air beyond it" instead.
- **A bridge** (deferred): the corner passes behind C before crossing it (a hole that notches the edge less deep than the chamfer). "The chamfer passes behind the end face in refs before it crosses it (the face notches the edge less deep than the chamfer); chamfer the edge before the feature that makes that face, or use a smaller size."
  Also two run-outs into one gap whose reaches together reach across it.
- **A crossing under 10°**: "the edge meets the end face in refs at 8°, less than 10°". The same detail, with "only grazes" in place of the angle, when two roots of the edge's curve with C lie within the band of the end vertex (see "Recompute"), and "does not meet" when none does.
- **C of a kind not taken yet**: "the edge ends at a cone (refs), which this feature cannot run out into yet". The same for a sphere, a torus, a swept or an imported face, and for an arc's cylinder or plane not parallel to its axis.
- **Faces at the end on two surfaces** (the rim of a lobe under another lobe, which meets the upper lobe's side and its underside): D63's detail, now with the faces in refs.
- **An end at an earlier fillet** (or any face C that continues face `a` or `b` smoothly at the end) **whose continuing edge this feature cannot take** (of the kind `other`: the top of a box with a leaning top against the fillet of its corner, R7). D63 advises "the edge continues smoothly into the second edge in refs; add it to this feature", which cannot be done. Now: "the edge runs on smoothly into the face in refs along an edge of the kind other, which this feature cannot take; ending there is not supported yet". refs [the edge, C]. Where the continuing edge is of a kind D63 takes, its advice stays.
- `blendDoesNotFit`, refs [the edge, C]:
  - **the void check**: "the chamfer would take 0.054 mm³ beyond the end face in refs within its run-out (a pin or a post in the void, or a void shallower than the chamfer)"; concave: "the fillet would add … beyond the end face in refs, where it has no material";
  - **a cylinder too small**: beyond is its inside and its radius is not larger than the lift: "the end face in refs is too small for the chord tolerance of the document; use a finer one";
  - **a run-out cap off the blend** (a backstop, never measured): "a vertex of the end of the chamfer's run-out lies 0.14 mm off its surface".

**Deferred**, each with what the reviews found, for the package that takes it up:

1. **Straight edges with round faces** (a plane and a cylinder along it, two cylinders with parallel axes: the ridges of the housing, a rib against a boss, overlapping holes). The prism of D63 with a profile of curves worked in the first round's spike ("Round 1, kept as evidence"), but:
   - the profile's wedge has to be closed by the faces' arcs, not chords (9.7 % of the corner at the housing's ridges);
   - a chamfer's ends have to move along its own line, as D63's do;
   - a plane has to be a line, not a circle of a huge radius;
   - and these edges are of the kind `other` today, which the query `body`, the app's picking, `measure` (`query/entity.ts`) and the converter all read.
2. **Two lines of one pair of faces** (a pocket in a bore, the flat of a shaft). They need a name of their own (`which` in the first draft). The reviews found:
   - the number must come from the analytic branch, not from which lines the body has now, or blending one line renames the other;
   - a mirror swaps the handedness the order was defined by;
   - `linesBetween` over `Surface` lacks the signed axis its order needs;
   - a key suffix `#0` can collide with a legal ID;
   - every name builder needs it (`nameOfEdge` of edge-blend.ts, the app's `edge-picker.ts`, which keys edges by their two faces, `queries/controls.ts`, the converter);
   - widening `line` to tangent seams makes the app's automatic projection of a face's edges (`features/sketch.ts`) produce unsupported projections;
   - a classification within the chord tolerance is wrong near tangency (a probe: 0.084 mm off at 0.01), D58's bound `2·tol/sin θ` is the model;
   - it needs a schema step.
3. **Stops.** In the first round the tool was cut back by a cylinder of C moved by the lift towards the edge. That left nothing of the tool (578 random cases, 1 refused at 0.001), but:
   - the surviving face of the clip lies the lift off C's surface, so renaming it into C corrupts C's one `FaceInfo` (circles at R ± lift, line pairs turning `other`, wrong `measure`);
   - the strip it leaves along the edge is (lift + chord tolerance) / sin of the crossing angle, 0.085 mm at 17° and 0.01, up to 2.5 mm near 0.01 rad, not the 0.025 mm claimed;
   - the clip solid's own caps are not C and need provenance of their own;
   - two stops on one piece need nine numbers, not eight;
   - a stop needs a named face with its own exact surface, or a clip whose surviving faces lie on C within the chord tolerance with a measured bound.

   It is the case of the motor shell and of a rib's top edge into a boss. (The input shaft's lobes end at two faces, the upper lobe's side and its underside: a stop at two faces, refused as such, R7.)
4. **Bridges.** One tool across the gap between two pieces was the reference in every case measured. But its safety cannot be checked cheaply: material wholly inside the bridged tool leaves no face of the tool, and the widened volume bound swallows it; the void check of a run-out does not carry over, since a bridge's tool rightly takes material on the near side of C across the gap. And D63's per-piece checks (the blend face, slivers, caps, volume entries) assume one tool per piece. Refused, with the advice to blend before the feature that makes C, which gives the same result.
5. **Ends at a cone, a sphere, a torus**, and an arc's end at a cylinder or a plane not parallel to its axis: not measured. The cone is needed after a chamfer of a rim (an edge running up into the chamfer's cone) and for countersinks. Ends at an earlier fillet are usually tangent to a face of the edge, where D63's smooth rule applies; where the continuing edge is `other` the end is now refused with a detail that names the fillet ("Refused"), and the transition itself is left to a later package.
6. **An end at two planes** that both cross the edge (the inner end of the motor shaft's slot in the Onshape model). Without the model it cannot be told whether the void there is the intersection of their air sides or a sliver left where the slot meets the socket at a vertex. In a synthetic model of the same slot the end is one plane, which D63 takes.
7. A variable radius, a ball at a vertex, general (`other`) edges, an end condition chosen by the user (D36 keeps these out).

## Document

Nothing changes: no feature type, field, face role, edge name field, edge kind, issue code, command, query or schema step. A build with D63 alone opening a document of this package shows the newly accepted edges in error (`unsupportedEdge`), in the open; it drops nothing.

## Recompute

The step of D63 (`blendStep`, recompute/edge-blend.ts) in its order; only what changes is written here.

1. **The body, the edges, their kind, the pieces, the corner, the profile.** As D63.
2. **The ends.** D63's rules first: a convex and a concave edge at a vertex; another edge of the feature (smooth, mitre, plane of the other's face); a seam. Then the faces at the end besides `a` and `b`:
   - Faces on one cylinder are one end face C (`sameCylinder`: axes parallel within the angle tolerance, the distance of one axis line from the other and the difference of the radii within ten precisions of the coordinates; a cylinder's `center` is any point of its axis and is not compared). Planes on one plane as D63. Faces on two surfaces: refused, the faces in refs.
   - **One face C that continues `a` or `b`** (D63's smooth rule): the continuing edge (C with the other face of the edge) has to be in the feature, as D63; when it is of a kind the feature cannot take (`other`), the end is refused naming C instead of advising to add it ("Refused").
   - **One planar C the tool can end in flat** (a straight piece at a plane crossing it at more than `BLEND_MIN_ANGLE`; an arc at a plane through its axis): D63's planar end, unchanged.
   - **One cylinder C, or a plane C an arc cannot end in flat**: a candidate run-out.
     - *The kinds taken.* A straight piece with any cylinder; an arc with a cylinder or a plane parallel to its axis. Otherwise refused ("cannot run out into yet").
     - *The motion past the end* (contract `Motion`): a translation along the line of a straight piece from its end vertex; a rotation about the arc's axis, with its start angle and its sense (+1 past the end at the larger angle of the piece, −1 at the smaller). The same motion started at the middle of the piece (a point away from both ends) is the curve the crossing is solved on, and the tool and the part inside the wedge are built along it.
     - *Where the edge meets C, exactly* (`crossingAt`). The roots of the curve from the middle on with C's surface: a line and a cylinder of any axis (a quadratic), a circle and a parallel cylinder (two circles in the plane across the axis), a circle and a parallel plane (a circle and a line). The root of the end is the one within the band of the end vertex: the mesh vertex lies within the chord tolerance of C, which along a curve crossing C at the least angle is the band (tolerance + lift) / sin 10°. No root there: refused ("does not meet"); two (a curve that only grazes C, a hole of a radius near the band): refused ("only grazes"). The band keeps the choice exact: a stop read as a run-out (the exit root of a boss taken for its entry) would cut through the boss.
     - *The side* is the sign of C's implicit function (outside a cylinder positive, on the side of a plane's normal positive) on the curve between the root of the end and the root before it, or the middle if none: exact, whatever else the curve crosses on the way. Neither the mesh vertex (round 1: the side misread at 3°) nor the middle of the piece (the first draft of round 2: the circle of a bore's rim crosses the plane of a keyway's side twice, so the middle lay on the keyway's side) is right in general.
     - *The angle.* The angle between the curve's way at the root and C's tangent plane there, at least `BLEND_MIN_CROSSING` (10°), else refused. Read at the mesh vertex instead, a crossing of 12° looked like 8° (a straight edge at 0.05) and one of 8° like 5.7° (an arc).
     - *Air or material.* The side past the root is the other sign; it is C's air when C's outward normal there points to it, the normal's sign from C's triangles at the end vertex, area-weighted, as D63 signs the faces of an edge. A **run-out** when "into the air" equals `convex`; otherwise a **stop**, refused (deferred).
     - *A cylinder too small.* Where beyond is the inside of a cylinder whose radius is not larger than the lift, the region beyond by the lift is empty: refused (`blendDoesNotFit`). Before it is reached, such a hole usually only grazes the edge (R2b).
     - *The reach* (`reachPast`), exactly. For every point of the profile's `wedge` (the corner and the exact blend, which D63's corner of two straight face lines closes exactly), the set of parameters t ≥ 0 at which the point, carried by the motion, lies beyond C by at least the lift:
       - a straight piece and a cylinder: an interval or two from the roots of a quadratic, at the radius r − lift where beyond is inside, r + lift where outside;
       - an arc and a cylinder parallel to its axis: the arcs of one circle inside or outside another;
       - an arc and a plane parallel to its axis: the arc of a circle on one side of a line moved by the lift.

       The reach is the least t in all the sets at once (their intersection, so a point that has crossed and come back does not count), up to the limit: the next piece of the same edge on that way; with none, the extent of the body for a straight piece and the rest of the turn for an arc. Where beyond is the outside of a cylinder (a region that is not convex), the whole wedge polygon has to clear the cylinder grown by the lift, which its points alone do not prove: in the plane across C's axis the moving polygon against the disc of radius r + lift, exact. The parameters where a vertex lies at r + lift from the axis or a side's line at r + lift or 0 are roots (a quadratic or a line for a translation; two circles or a circle and a line for a rotation); between them the polygon is tested at the middle (a side within r + lift, or the axis inside the polygon: blocked). This set is intersected with the others. Round 2 found the old check (the sides tested only at the points' reach, against the bare radius) refusing a right case as a bridge; R4 measures it now. No such t: a **bridge**, refused (deferred). Two run-outs into one gap whose reaches add up to the gap: a bridge too.
     - The overshoot of the profile need not cross: it lies in the air (or, concave, in the material) anyway. Requiring it refused right cases in the first round.
   - Anything else: D63's refusal.
3. **The tools.** A run-out lengthens the tool of its piece and the part of it inside the wedge alike.
   - A straight piece: its end plane is the plane across the edge at the reach, `{ point: vertex + reach · direction, normal: direction }`, given to `edgePrism` as D63's planar ends are; `prismLength` as D63.
   - An arc: the start frame's X is the radial direction at the angle of the first vertex turned back by the reach of end 0; the extent is `{ type: 'angle', start: 0, angle: sweep + reach₀ + reach₁ }`; `blendRevolveSetup` with that sweep gives the steps (the turn divided for the chord tolerance at the largest radius of the profile, as D63) and the triangle count, which is added to D63's budget. reach₀ + reach₁ < 2π − sweep holds by the bridge rule (the limit of a piece without another is the rest of the turn).
   - Face numbers as D63 (seven per piece; the cap of a run-out is the cap at that end).
   - The volume check of D63 keeps its bound with the lengthened length in the strips: `2 · setback · length`, the length plus the reaches for a straight piece, the radius times the lengthened sweep for an arc; the caps term is unchanged. The lengthened part inside the wedge lies partly in C's void, so the check is looser there; the void check covers it.
4. **The void check**, before the booleans, on the actual tools (contract `checkFrom`, `beyondVolume`). Round 3 replaced a separately built extension: it was divided otherwise than the arc's tool (3.3 × 10⁻⁴ mm³ of it outside the real tool) and started too late for an acute fillet, whose setback r / tan(β / 2) (11.4 mm for r 1 at 10°) reaches C long before the end vertex.
   - *Where it starts* (`checkFrom`): going back from the end vertex, the first parameter at which the whole profile (every point; the polygon too where the own side is not convex, outside a cylinder) lies on the own side of the region beyond C, solved exactly as the reach with the motion reversed; then back by size + overshoot within the stretch where the profile stays clear, so that the cut lies away from C's polygon. None within the piece: refused (`blendDoesNotFit`, "the piece is shorter than its blend reaches into the end face").
   - *What is checked*: the actual tool of the piece (the mesh the boolean uses) with the body, once per piece (convex: intersected, what it takes; concave: the tool less the body, what it adds); that intersected with the region beyond C by lift + chord tolerance, within the part of the piece from `checkFrom` to past the reach: inside a cylinder a prism of an inscribed polygon of radius r − lift − tol; outside it a box less a circumscribed polygon of radius r + lift + tol; past a plane a box beyond it; the part of the piece a box beyond the plane across a straight piece, or for an arc a sector about its axis from `checkFrom` (moved to the middle between two rings of the tool) to the reach plus at most half the gap the tool leaves of the turn (a longer sector reached the other end of the keyway's rim).
   - *The polygon of the region* has as many sides as keep its sagitta under a quarter of the chord tolerance (`segments(2π, r, tol / 4)`); where the engine's cap of 4 096 sides leaves it larger (100 m at 0.001), the run-out is refused. Round 3 found a fixed 256-gon blind to a strip r · π² / (2 · 256²) wide (0.04 mm at r 500, 0.75 mm at 10 m; R11).
   - *The bound*: one constant, `BLEND_RUN_OUT_VOID` = 10⁻⁵ mm³, used by the contract and the spike alike. Above it: `blendDoesNotFit`, refs [the edge, C]. A non-empty result under it is accepted only where the kernel's uncertainty for it (its band times its area) is under it too; otherwise refused. Calibration: every accepted case gave an empty result, exactly 0; the least volume a regression had to be refused at was 1.9 × 10⁻⁴ mm³, 19 times the bound. The round-2 draft added 4 · band · the profile's area and so accepted a 0.3-deep pocket (8.8 × 10⁻⁴ mm³ under 3.6 × 10⁻³, round 3).

   Not checked: what lies within lift + 1.25 · tol of C (the offset and the polygon's sagitta; 0.028 mm at 0.01, 0.14 mm at 0.05), where the faces' polygons are that coarse anyway. The whole tool against the unbounded region (round 3's first proposal) refuses right cases: beyond the plane of a keyway's side lies the rest of the rim, whose own chip it counted (4.0 mm³, R5), hence the start at `checkFrom`. The choices measured in round 2 stay: the region past C's mesh by the chord tolerance as well, the body first and the region second. A boolean of the check the kernel refuses refuses the feature (`kernelFailure`), never accepts it unchecked. Kernel calls: one per piece and two or three per run-out. R1's 32 run-outs: 260 to 275 ms for the check against 130 to 310 ms for the union of the tools and the boolean at 0.01, 95 to 125 against 50 to 135 ms at 0.05. The region is C's surface unbounded beyond `checkFrom`: material beyond it where C itself does not exist (under the floor of a pocket) counts, which is what refuses a pocket shallower than the chamfer.
5. **The booleans.** As D63: the cut tools united and subtracted, the added ones united and joined. No fallback to one by one.
6. **The checks.** D63's. A run-out's cap lies beyond C by the lift in the air (or the material), so after the void check nothing of it is expected in the result. What is left of it is checked as D63 checks a blend's vertices: every vertex within D63's allowance (lift + chord tolerance + 10 precisions) of the blend's exact surface, else `blendDoesNotFit` with the edge and C. Round 2 found the area bound of a cap at a joint (lift × (size + overshoot)) letting a cap through whose vertices lay 0.141 mm off the chamfer's plane; the area bound is not used for run-out caps. D63's check of a cap facing against its planar end face does not apply (a run-out has no planar end face).
7. **The renumbering, the result, the facts.** As D63, with the ends keyed by kind (contract `BlendEnd`): a cap of a run-out becomes the blend's face, never C (it does not lie on C), so a run-out end does not carry D63's `face`. C keeps its name and loses what the run-out took of it: the chamfer of the rim takes a piece of every pocket's wall.

## Faces and edges of the result

As D63. The new face of an edge meets C along a curve: a cone with a pocket's cylinder, a plane with a shaft's cylinder. That edge is generally of the kind `other`, and a plane with a plane (a keyway's side) a `line`. The faces of the edge and C keep their names.

## Issue codes

The codes of D63. `MESSAGE.unsupportedEdge` changes (contract `MESSAGE_UNSUPPORTED_EDGE`): it adds the run-out into a hole, a pocket or a boss (a cylinder; for a circular edge also a plane parallel to its axis, such as the side of a keyway), the run-out through a round wall into the air outside it, and that an edge that would have to stop at a round face or bridge a gap is not taken yet. The details of "The cheap variant" replace D63's "the edge ends at a round face (…) that does not continue a face of the edge" (still said of an end at a round face of a kind not taken) and "the arc ends at a plane (…) that does not hold its axis" (still said of a plane not parallel to the axis), and the smooth rule's advice where the continuing edge cannot be taken. Every new detail names C in `refs`, and D63's detail of several faces at an end now names them in `refs` too. The flat-angle detail has one wording: "the edge meets the end face in refs at 8°, less than 10°". `blendDoesNotFit` keeps D63's message; its new details are the void check (convex: "takes"; concave: "adds … where it has no material"), the cylinder too small for the chord tolerance, and a run-out cap off the blend.

## Where the code lives

| File | What |
|---|---|
| `recompute/tool-edge.ts` | `Motion`, `reachPast` (the intervals and the clearance of the polygon), `BLEND_MIN_CROSSING`, `BLEND_RUN_OUT_VOID` |
| `recompute/edge-blend.ts` | `runOutFace`, `sameCylinder`, `crossingAt`, `beyondVolume`; the ends keyed by kind: faces on one cylinder, the smooth rule's check of the continuing edge, run-out or refusal; the tool lengthened; the void check; the check of a run-out cap |
| `recompute/services.ts` | `MESSAGE.unsupportedEdge` |
| `features/chamfer.ts`, `features/fillet.ts` | The summaries (`SHARED_SUMMARY_4C`) |
| `types.ts` | The comments of the two feature types (read by the AI) |
| mcp: `api.ts` | The paragraph of `CONVENTIONS` on the two types: run-outs, refused stops and bridges |
| docs | `architecture/edge-blend.md` (the ends), `ui/chamfer-fillet.md` (nothing in the form; the texts) |

The app changes nothing but texts it already prints from the engine. The imports go one way, as D63's.

## Measured

The spike `spikes/edge-blend-round-ends.spike.ts`, revised after the second round of reviews, runs against the real kernel adapter (`packages/kernel-manifold`, `manifold-3d` 3.5.5) on bodies made by the engine of `master`: `npx vitest run --config spikes/vitest.config.ts spikes/edge-blend-round-ends.spike.ts`, 2 to 2.5 minutes. It prototypes the resolver of an end, the void check and the cap check, around tools of its own; it does not run D63's step (one closure in `edge-blend.ts` that takes no other resolver), so the numbers below measure the design, and the implementation still owes them as tests of the real step ("Tests"). What it takes from the body as the step does:

- the pieces and their end vertices from the body's own edge (its mesh segments, chained);
- the corner of each piece (the directions into the faces, the angle between them, convex or concave) from the faces' triangles along the edge, as D63's `along` and `signed` (round 2 found the first spike giving them by hand at 90°);
- the faces at an end from the triangles at the vertex, their exact surfaces from the evaluation.

Then the end resolved as in "Recompute" (the root of the end in its band, the side between roots, the angle there, the reach as intervals with the polygon's clearance outside a cylinder), the void check, D63's profile swept along the lengthened piece, the tools united and applied with no fallback, D63's overshoot sliver bound and the cap check. Every outcome is counted and asserted: the accepted cases against the reference within 2.5 % (or 10⁻³ to 2 × 10⁻³ mm³ where the tools are divided alike), the refusals with their code and the face in refs. "Reference" is the same blend made by the engine before the feature that made C (the same set of points), or an exact volume.

**R1. The housing** (a plate 80 × 80 × 8, a bore R 29.5 through, 16 pockets r 2.5 on the circle 29, 4 deep; the rim is one edge of 16 arcs, each crossing a pocket at 76°). D63: "the edge ends at a round face (P/side/k9) that does not continue a face of the edge".

| Chord tol. | Blend | Outcome | Taken: run-out, reference (mm³) | Reach (mm) |
|---|---|---|---|---|
| 0.01 | chamfer 0.5 / 1.5 | ok | 13.782, 13.763 / 130.289, 130.186 | 0.20 / 1.07 |
| 0.01 | fillet 0.5 / 1 | ok | 6.155, 6.139 / 24.410, 24.347 | 0.20 / 0.52 |
| 0.05 | chamfer 0.5 / 1.5 | ok | 14.630, 14.648 / 133.531, 133.318 | 0.23 / 1.14 |
| 0.05 | fillet 0.5 / 1 | ok | 7.046, 7.064 / 27.239, 26.793 | 0.23 / 0.57 |
| 0.001 | chamfer 0.5 | ok | 13.583, 13.582 | 0.18 |
| 0.001 | fillet 0.5 | ok | 5.822; the reference refused by the kernel (the pockets cut after the fillet) | 0.18 |

Nothing of a tool is left, the void check finds 0 in every case. The run-out and the reference differ by 0.01 to 1.7 %, under the area of the blend times half the chord tolerance: the tools are divided from different starts (an arc of each piece here, a whole circle from the model's X there). The exact chamfer of 0.5 takes 13.562 mm³.

**R2. A straight edge broken by a hole, by the angle it crosses at** (a box 60 × 40 × 20, the top-front edge broken by a hole r 4 at (30, ±4 cos φ), crossing at φ from 90° to 3° with 10.5° and 9.5° either side of the least angle; the centre behind or in front of the face; chamfers of 1 and 2, a fillet of 1; chord tolerances 0.01 and 0.05):

- At 10.5° and up: 37 run-outs, each equal to the reference to 10⁻³ mm³ (to the printed digit), reach 0.015 to 1.9 mm; 29 bridges, refused as designed (the centre in front, the notch less deep than the corner; at 0.05 every case under 12°, since the lift of 0.075 keeps the corner from getting the lift inside a hole that only grazes the face). Under 10°: 48 refused as too flat, the face in refs.
- Without a least angle (`ROUND_ENDS_MIN=0`): every case from 3° up is a run-out equal to the reference or a bridge. The first round's misread side at 3° came from reading it at the mesh vertex.
- Read at the mesh vertex, a crossing of 12° looks like 11.4° at 0.01 and 8.0° at 0.05. Hence the exact root.

**R2b. Small holes at the chord tolerance 0.05** (lift 0.075; a hole crossing the edge at 60°, chamfer and fillet 0.3): radius 0.07, 0.1 and 0.2 refused as "only grazes" (their two roots lie within the band of the end vertex; 0.07 is also within the lift); 0.5 and 1 run-outs equal to the reference.

**R3. The concave foot of a rib running into a boss** (a plate 60 × 40 × 5, a rib 2 wide and 10 high, a boss r 6, 15 high; crossing 80°): chamfer 1.5, fillets 1.5 and 3 at 0.01 and 0.05, all equal to the reference to 10⁻³ mm³ (28.360, 12.333, 49.194 mm³ added at 0.01), reach 0.48 to 1.52 mm.

**R4. Out through the cylinder of a shaft.** The slot of the motor shaft (a shaft r 6, a hex socket of circumradius 2√3 5 deep, a slot from its corners (3, ±√3) out to x 7, 2 deep; the slot's two top edges cross the cylinder at 73° into the air outside it; their inner ends are one face of the socket, D63's planar end). D63: "the edge ends at a round face (E/side/c) that does not continue a face of the edge". A chamfer of 0.5 takes 0.372 mm³ per edge at 0.01 and 0.367 at 0.05 (exact 0.373, between the socket's face and the exact cylinder); a fillet of 0.5 0.162 and 0.180. A slot across the shaft (y −3 to −1, 2 deep), its wall's top edge chamfered 2 towards +y, both ends out through the cylinder: round 2 found the first spike refusing it as a bridge (its points cleared at x 5.93, a side did not); now 23.862 mm³ at 0.01 and 23.763 at 0.05 against the exact 23.948 (0.4 and 0.8 %), a chamfer of 0.5 1.483 against 1.489, a fillet of 2 accepted.

**R5. An arc past planes off its axis.** The rim of a bore R 10 broken by a keyway 3 wide, 4 deep (the arc ends at the keyway's sides, planes parallel to the axis and off it, crossed at 81°). D63: "the arc ends at a plane (K/side/kl2) that does not hold its axis". Chamfers 0.5 and 1, a fillet 0.5 at 0.01 and 0.05, all equal to the reference within 0.003 mm³ (7.705 and 7.704 for the chamfer of 0.5 at 0.01). The rim broken by a notch whose floor (a plane parallel to the axis) it crosses at 15°, 12°, 10.5°, 9.5° and 8°: run-outs equal to the reference within 0.07 % down to 10.5°, refused as too flat at 9.5° and 8°. Read at the mesh vertex, 8° looks like 5.7° at 0.05. The keyway is also why the side is read between roots: the rim's circle crosses the plane of a keyway's side twice, so the middle of the piece lies on the keyway's side of it (the first draft of this round refused the keyway as a stop).

**R6. Other corners, axes and sides.** At 0.01 and 0.05:

- the rim of a hole r 4 breaking out through the side of a disc r 10 (an arc into the air outside a cylinder parallel to its axis; crossing 49.5°): chamfers 0.5 and 1, a fillet 0.5 equal to the reference (the disc r 20, the hole, the blend, then the ring outside r 10 cut away) to 10⁻³ mm³ at 0.01 and within 0.7 % at 0.05;
- the foot of a boss r 8 running into an overlapping boss r 6 (a concave arc into material; crossing 77°): a chamfer of 1 and fillets of 1 and 2 equal to the reference to 10⁻³ mm³ at 0.01 and within 0.2 % at 0.05;
- a box whose front face leans (the faces of the edge meet at 104°) with a vertical hole through its top-front edge, and a box with a hole drilled along an axis tilted 25°: chamfers and fillets of 1, the centre behind and in front, all equal to the reference to 10⁻³ mm³.

**R7. The refusals and the void check**, at 0.01 (and 0.05 where said):

| Case | Outcome | Code, refs |
|---|---|---|
| A rib's top edge into a taller boss | stop | `unsupportedEdge`, the boss's side |
| A fin's foot running past the rim of a disc it is flush with (the fin's end does not reach the end vertex: one face there) | stop | `unsupportedEdge`, the disc's side |
| A fin overhanging the rim | two faces (the disc's side, the fin's underside) | `unsupportedEdge`, both |
| The rim of a lobe under another | two faces (the upper lobe's side and its underside) | `unsupportedEdge`, both |
| An end at the cone of a tapered hole | a kind not taken | `unsupportedEdge`, the cone |
| A box with a leaning top, its corner filleted: the top-front edge runs on into the fillet along an edge of the kind `other` | refused; D63 says "add it to this feature" | `unsupportedEdge`, the fillet |
| A hole crossing at 8° | too flat | `unsupportedEdge`, the hole |
| Pockets cut by two flush extrusions (4 and 2 deep) | accepted, one face at each of the 32 ends, equal to R1 | |
| Pockets 0.1 and 0.2 deep, chamfer 0.5; 0.3 deep, fillet 0.5; 0.8 deep, chamfer 1 (0.01 and 0.05) | the void check: 7.1 × 10⁻⁴ to 1.3 × 10⁻² mm³ | `blendDoesNotFit`, a pocket |
| Pockets 1.2 deep, chamfer 1 | accepted, within 0.1 % (0.01) and 1 % (0.05) of the reference | |
| Pins r 0.2 and 0.3 standing in a hole at 9 places within a run-out, chamfer and fillet 1, at 0.01 and 0.05 (36 cases) | the void check: 1.9 × 10⁻⁴ to 0.17 mm³ | `blendDoesNotFit`, the hole |
| A post 1 × 1 in a hole r 6, chamfer 5 | the void check: 0.71 mm³ (0.99 at 0.05) | `blendDoesNotFit`, the hole |

Round 2's probes of the first spike, a pin in a pocket (8 of 12 accepted, 0.04 to 0.13 mm³ too much taken) and a separate piece of 9 mm³ under a chamfer of 5, are all refused now; a pin out of the tool's way is accepted, equal to the reference. The void check works on the actual tool, so it refuses only what the tool would take or add beyond C.

**R8. Random cases**, 40 of each kind with seed 1 (`ROUND_ENDS_COUNT`, `ROUND_ENDS_SEED`), the chord tolerances 0.01, 0.05 and 0.001 in turn:

- a hole of radius 1 to 6 through the top-front edge of a box 8 to 28 high, crossing at 12° to 90°, the centre on either side, a chamfer or a fillet of 0.2 to 2.5: 22 run-outs, 18 bridges refused;
- 3 to 20 pockets of radius 1 to 4 around a bore R 29.5, their centres within ±1 of its circle, a chamfer or a fillet of 0.2 to 1.5: 38 run-outs, 2 bridges.

No `left`, `kernel`, `flat`, `stop` or other refusal; the largest difference from the reference 1.8 % (the arcs against the whole circle, as in R1). Seed 7, 60 of each kind: holes 44 run-outs and 16 bridges, pockets 53 run-outs and 7 bridges, the kernel refused one reference (the pockets cut after the blend), not the run-out; the largest difference 1.9 %. Together 157 run-outs and 43 bridges, no failure. Before the last two choices of the void check ("Recompute", 4) its booleans failed in the kernel three times in these 200 cases (a folded triangle); R9 pins those three, now accepted and within 1.9 % of the reference.

**R10. Acute corners** (round 3; at 0.01 and 0.05). A wedge whose edge has faces meeting at 10° (a fillet's setback r / tan 5°: 11.4 mm for r 1) broken by a hole r 25 crossing it at 45°: fillets of 1 and 0.5 and a chamfer of 1 accepted, equal to the reference to 10⁻³ mm³; pins in the hole where the profile reaches it before the end vertex (5.0 mm before it for the fillet of 1, past where round 2's check began, 4.0 mm) refused, 0.19 to 0.40 mm³, the hole in refs. A groove whose walls meet at 10° running into a boss at 45° (concave): fillets of 0.3 and 0.15 accepted, equal to the reference; holes drilled into the boss where the profile reaches it early refused, 0.05 to 0.15 mm³ that would be added, the boss in refs.

**R11. The polygon of the region** (round 3). Beyond a cylinder r 500 at 0.01, a cube 0.02 mm thick at the middle of a side of a 256-gon, 0.015 mm inside the offset cylinder: the budgeted polygon (994 sides, sagitta 0.0025 mm) finds it (4 × 10⁻⁴ mm³), the 256-gon (sagitta 0.038 mm) does not. A radius of 100 m at 0.001 needs more than 4 096 sides and is refused.

**R9. Pinned.** The three cases of R8 (seeds 1 and 7) where a boolean of the check failed in the kernel with a folded triangle before the choices of "Recompute", 4 were made; all accepted now, within 1.9 % of the reference.

**The bound of the void check.** In every accepted case of R1 to R11 the void check gave an empty result, exactly 0 mm³; the least it had to refuse was 1.9 × 10⁻⁴ mm³ (a pin at the far end of a fillet's run-out), the shallow pockets from 6.8 × 10⁻⁴. The bound, 10⁻⁵ mm³, is 19 times under the least.

**Round 1, kept as evidence for the deferred parts.** The first spike, its tools built by hand from exact geometry, measured three things:

- the prism with a profile of two circles at the housing's ridges: with the lift nothing left, the blend within the lift of its curve; without the lift 0.06 to 12.6 mm² left;
- stops clipped by C moved by the lift towards the edge: nothing left; on C or moved away, slivers of 0.001 to 0.69 mm² left;
- a random set of 578 stops: 1 refused by the kernel and 1 sliver of 0.004 mm², both at 0.001.

The reviews found its chamfer lift, its plane-as-circle and its chord-closed wedge wrong for these purposes ("Deferred", 1 and 3), so these numbers are a starting point, not a result.

**A bug of the prototype, for the implementation.** The kernel triangulates a clockwise loop into a fan of slivers, and a union of two prisms with such caps is refused ("folded triangle"). D63's `edgePrism` always gets the counter-clockwise profile; a lengthened tool has to keep that.

## Decisions

1. **The scope is the run-out.** *Why:* every accepted case was measured equal to the reference (R1 to R9). It adds no boolean, no face, no name and no field, and it covers the actuator's housing chamfer and the shaft's slot. Stops, bridges, straight edges with round faces and two lines of one name each brought serious findings that need a design of their own ("Reviews"; the coordinator's decision on scope, on the owner's standing instruction to prefer robust over broad).
2. **Run-out or stop by the side the edge goes into, not by the user.** A run-out where the tool changes nothing beyond C; a stop otherwise, refused for now. *Why:* that is where the air or the material beyond C does the rest; a user of Fusion or Onshape never chooses.
3. **The angle at the exact root of the end; the side on the curve between that root and the one before it.** *Why:* at the mesh vertex the normal of a cylinder is off by up to half a polygon step (R2, R5), and the side read there was wrong at 3° (round 1); the middle of the piece is on the wrong side where the curve crosses C's surface twice (the keyway, round 2). The band of the end vertex makes the choice of the root unambiguous or refuses it.
4. **The reach exactly, as intervals, from the wedge alone; outside a cylinder the whole polygon, exactly.** *Why:* exact for every kind taken (a quadratic, two circles, a circle and a line). The intersection of the sets handles a point that crosses back. The overshoot need not cross (R2 of round 1). The polygon test found the reach of a case the points alone called a bridge (R4).
5. **The least crossing angle 10°.** *Why:* with the side read as in 3, every case from 3° up was right or a bridge (R2); but read at the mesh vertex a crossing of 12° looked like 8°, the band of the end root grows as 1 / sin of the angle, and at 0.05 every crossing under 12° was a bridge anyway. 10° keeps the band under 0.75 mm at 0.05.
6. **A bridge is refused, with the advice to blend before the feature that makes C.** *Why:* that order gives exactly the bridged result, and a bridge's safety cannot be checked cheaply.
7. **Faces on one cylinder are one end face, compared by axis line and radius.** *Why:* two extrusions flush with each other are one face to the user; a cylinder's `center` is any point of its axis.
8. **No new code, role, field or schema step.** *Why:* what changes is what is accepted; the errors of D63 carry the new refusals in their details.
9. **The void check before the booleans, on the actual tool of each piece from where its profile is clear of C (`checkFrom`): the tool with the body, then the region beyond C; one bound of 10⁻⁵ mm³.** *Why:* round 2 found the lengthened tool silently taking a pin in a pocket (0.04 to 0.13 mm³) and a separate piece of 9 mm³, which leave no face of the tool to find afterwards; round 3 found a separately built extension divided otherwise than the tool, starting too late for acute fillets, and a bound with an area term that accepted a shallow pocket. The check measures what the real tool would change beyond C, from where it can first reach it. Measured: 0 in every accepted case, 1.9 × 10⁻⁴ mm³ the least it had to refuse (R7, R10).
10. **A run-out cap is checked by the distance of its vertices from the blend, not by an area.** *Why:* round 2 found caps of 0.02 mm² under the area bound whose vertices lay 0.141 mm off the chamfer's plane; renamed into the blend they would corrupt its `FaceInfo`.
11. **An end at a face that continues `a` or `b` along an edge the feature cannot take is refused naming that face.** *Why:* D63's advice to add the continuing edge cannot be followed for an edge of the kind `other` (R7: the top of a box with a leaning top against the fillet of its corner).

## Rejected alternatives

1. **End every tool in the plane across the edge at its end vertex.** Up to 0.48 mm proud of a rim, a notch of 3.7 mm³ behind a hole, 0.53 mm³ under another lobe, and refused by the kernel for fillets at pockets (round 1).
2. **The same, accepted where its error is below a tolerance.** Needs the same geometry as the run-out to measure the error, and then still gives the wrong shape above it.
3. **Clip every end by C's solid, run-outs too.** A boolean more per end, a surviving face off C's surface, where the reference shows none is needed.
4. **The reach by sampling, or by every point of the profile.** Sampling in an angle has no physical step, and a point's first crossing is not a time when all are beyond. Every point refuses right cases.
5. **The angle and side at the mesh vertex.** Misread by up to half a polygon step (R2).
6. **Stops, bridges, straight edges with round faces, `which`, in this package.** See "Deferred" and "Reviews".
7. **Reorder: make the blend before the feature that made C.** Not possible in a timeline the user wrote; it is the reference, and the advice a refused bridge or stop gives.

## Known limits

- Stops are refused: the motor shell's concave rib feet flush with a round plate's rim, a rib's top edge into a taller boss; so is the input shaft's lobe, whose rim ends at two faces. Where C comes from a later feature, blending before it gives the right result.
- Bridges are refused: a hole that notches an edge less deep than the chamfer.
- A crossing under 10° is refused; at the chord tolerance 0.05 most crossings under about 12° are bridges, since the lift keeps the corner from getting inside a face that only grazes the edge.
- Ends at a cone, a sphere, a torus, a swept or an imported face; an arc's end at a cylinder or a plane not parallel to its axis; an end at two faces of different surfaces (the stacked lobes); ends at an earlier fillet tangent to a face of the edge whose continuing edge is `other` (refused with a detail that names the fillet).
- The void check does not see material within lift + 1.25 · chord tolerance of C (0.028 mm at 0.01, 0.14 mm at 0.05): the faces' polygons are that coarse. A radius of C that would need more than 4 096 sides for the region's polygon is refused. It reads C's surface as unbounded, so material beyond it where C itself does not exist (under a pocket's floor) counts: right for a shallow pocket, and it could refuse a run-out where C's surface comes back within the extension elsewhere (not seen).
- A hole whose radius is near the band of the end root (under about 0.4 mm at 0.05, 0.1 mm at 0.01) is refused as "only grazes" even where it crosses the edge squarely (R2b).
- The spike prototypes the resolver of an end, the void check and the cap check around tools of its own; it does not run D63's step, which is one closure that takes no other resolver. The implementation runs scenario 17 and the cases of the spike as tests of the real step.
- Straight edges between a plane and a cylinder or two cylinders, and edges on two lines of one pair of faces, stay `other` and refused, as in D63.
- The reach treats C's surface as unbounded; a void that ends within the corner (a pocket shallower than the chamfer) is refused by the void check, not cut to fit.
- The volume check is looser by the wedge that runs past the end inside C's void; the void check covers that part.

## To verify before the implementation

- The fuzz of D63 (`spikes/edge-blend-fuzz.spike.ts`) with these ends:
  - at 2 000 mm from the origin, where the lift grows with the kernel's band;
  - concave arcs with other shapes than R6's two bosses (the foot of a ring boss into a cylinder parallel to it);
  - a fillet ending at a cylinder on the other face of an arc.
- The shaft's slot in the Onshape model: whether its inner end is one face of the socket (taken by D63) or two (refused); see "Deferred", 6.
- The void check far from the origin (2 000 mm), where the band grows: the refusal of a non-empty result within the kernel's uncertainty is not measured there.
- The housing's rim chamfer and pockets in the real model (16 pockets, the converter's split curves), and its time: the spike's 16 arcs take 0.5 to 0.7 s at 0.01 with the void check and 0.9 to 2.1 s at 0.001.

## Open

For the owner, each with the default the design takes:

1. **The scope: run-outs only, the rest deferred to a later package** that designs stops (a named face of the clip with its own surface), bridges (a safety check), straight edges with round faces and a name for one of two lines. *Accept (default)?* It leaves out the housing's fillet, the motor shell's chamfers and the input shaft's chamfers of the actuator.
2. **The least crossing angle 10°.** *Accept (default), or lower to 5° with a test at the chord tolerances in use?*
3. **Refusals that advise reordering** (blend before the feature that makes the end face). *Accept (default)?* It is exact for bridges and for stops at a later feature.

## For the plan

- **The converter** (`tools/onshape/`, not the engine): try all the edges of a feature together before one by one (half a smooth chain is refused alone: the input shaft's split arcs); group the arcs of one circle into one edge (one name, several pieces).
- **A later package** for stops, bridges, straight edges with round faces and two lines of one name, starting from "Deferred" and the findings of "Reviews".
- **2h** (D66) is designed at the same time and touches extents, not blends.

## Tests the implementation owes

- Engine:
  - `crossingAt`: a line and a cylinder of any axis; an arc and a parallel cylinder; an arc and a parallel plane crossed twice (the keyway); no root in the band; two roots in the band; the side between two roots;
  - `reachPast`: each kind; a point that crosses back; the outside of a cylinder where the points clear before the polygon does (the slot across a shaft, R4); a rotation outside a cylinder (the hole broken out through a disc, R6); no reach; two run-outs that reach across one gap;
  - `checkFrom`: a profile clear at once, an acute fillet whose profile reaches C far back, the keyway's plane crossed again far back, a piece too short;
  - `beyondVolume`: on the actual tool; a pin and a post in the void, a shallow pocket, the acute regressions of R10, a concave run-out into a boss shorter than the fillet, nothing in an accepted case, the bound shared with the contract;
  - `runOutRegionSides`: the sagitta budget, the refusal past 4 096 sides, R11's obstacle;
  - `sameCylinder` with axes given at different points;
  - each new detail of `unsupportedEdge` and `blendDoesNotFit`, D63's detail of several faces with the faces in refs, and the smooth rule's refusal of an `other` continuation;
  - `modules.test.ts`.
- Scenarios: `scenario17.test.ts` from [calls.ts](calls.ts); `edge-blend-round-ends.test.ts` with R1 to R7 as assertions against the reference; the random cases of R8 added to D63's fuzz spike.
- MCP: `describe_api` says run-outs and the refused stops.

## Reviews

### Round 1 (on the first draft)

Two reviewers, read-only: a fresh subagent on Claude Opus 5.5 (19 findings) and `codex` (gpt-6-astra, high; 21 findings); `agy` was out of quota. About 40 findings, 13 serious. The coordinator decided the scope on them: keep the run-out at cylinders, measure the least angle, solve the reach exactly; include stops only with a clean name for the clip's face and a stated bound, else defer; defer bridges unless checkable cheaply; defer `which`, straight edges with round faces and the change of kinds; defer cones, spheres and tori unless measured. Stops and bridges could not meet the bar and are deferred. I is the internal subagent, C is codex.

| # | Finding | Severity | What changed |
|---|---|---|---|
| I1, C1 | `which` given only when both lines exist renames the other line when one is blended or removed | serious | Deferred with `which` ("Deferred", 2) |
| I2 | Ends at an earlier fillet tangent to `a` or `b` are not covered | serious | Known limit; "Deferred", 5 |
| I3, C15 | calls.ts filleted the rib's foot and its vertical edge with the boss together, which the design refuses | serious | calls.ts rewritten: the foot alone; the vertical edge is out of scope |
| I4, C5 | The clip's face renamed into C lies the lift off C's surface: C's `FaceInfo` and every reader of it go wrong | serious | Stops deferred ("Deferred", 3) |
| I5, C4 | Classifying lines within the chord tolerance is wrong near tangency (a probe: 0.084 mm off at 0.01); tangency flips `which` | serious | Deferred with straight edges with round faces; D58's bound named for the later package |
| I6, C2 | The app's `edge-picker.ts` keys edges by their two faces; `queries/controls.ts` labels | serious | Deferred with `which`; nothing in the app changes now |
| I7, C3 | The app's automatic projection of a face's `line` edges meets the new kinds; `query/entity.ts` gives `other` for them | serious | Deferred with the kinds |
| I8, C12 | The shortfall of a stop along the edge is (lift + tol) / sin θ, not 0.025 mm; the lift has a kernel band term | serious | Stops deferred; the bound stated in "Deferred", 3 |
| I9, C16 | calls.ts tested refusals on consumed edges; `ridgesAreLines` counted 33 | serious | calls.ts: each refusal is a preview of the feature inserted after the feature it is about, evaluated up to it; the ridge count is gone |
| I10, C18, C19 | The spike built tools by hand from exact geometry, fell back to one by one silently, took the reach from the whole profile, measured a different chamfer lift, and did not reproduce the motivating cases | serious | Spike rewritten: ends from the mesh, the side and angle at the exact meeting point, the reach exact, no fallback, outcomes counted and failures failing the test, the housing and the shaft's slot as they are |
| C6, I12 | A bridge's safety is not established; D63's per-piece checks assume a tool per piece; the two sides of a gap may decide differently | serious | Bridges deferred, refused with advice |
| C7 | The curved corner's wedge was closed by chords (9.7 %) | serious | Deferred with straight edges with round faces (D63's wedge of two straight lines is exact) |
| C8 | Cylinders compared by `center`, which is any point of the axis | serious | `sameCylinder`: axis line and radius |
| C9, I16 | The reach took each point's first crossing (a point may have left again) and sampled in radians | serious | The reach as the least t in the intersection of each point's exact intervals; the sides checked where beyond is not convex |
| I11 | The side test by `implicit` at an unspecified step | minor | The sign of dot(way past the end, outward normal) at the exact meeting point, the least angle as its guard (`crossingAt`) |
| I13 | Seven numbers become nine with two stops; `lineBetween` and `linesBetween`; faces flush with `a`/`b` against the smooth rule | minor | Gone with stops and lines; no number added |
| I14, C10 | The order of `which` is ambiguous and a mirror swaps it | minor | Deferred with `which` |
| I15, C17 | `nameOfEdge` and other name builders omit `which`; no shared analytic edge resolver | minor | Deferred with `which` |
| I17, C13 | `implicit` of a cone's nappe and a signed torus undefined; clip solids of cones, spheres and tori undesigned | minor | Cones, spheres and tori deferred |
| I18 | A pin narrower than the tool | minor | Gone with stops (a run-out's cap check refuses material inside the void) |
| I19 | The tests list missed `body-query.test.ts`, the app's snapshots and the kinds of `edge-blend.test.ts` | minor | No kind changes now; the list rewritten |
| C11 | `linesBetween` over `Surface` lacks the signed axis its order needs | minor | Deferred with `which` |
| C14 | The clip solid's caps are not C; provenance per end | minor | Gone with stops |
| C20 | The scenario's assertions did not test what they claimed (axis-aligned bounds for a radius; the chamfer's survival for the fillets' meeting it; a constant for the schema) | minor | calls.ts: radial containment of every vertex of the shaft, each blend meeting its end face, the schema version kept |
| C21 | The key suffix `#0` can collide with a legal ID | minor | Deferred with `which` |

**After the fix.** The spike as described in "Measured" then: R1 to R5 all `ok` where in scope, R2's angles, and R6 with two seeds (157 run-outs, 43 bridges refused, no failure).

### Round 2 (on the run-out alone)

Two reviewers, read-only: a fresh subagent on Claude Opus 5.5, whose findings the coordinator summarized with probes of its own, and `codex` (gpt-6-astra, high; 10 findings, 2 serious). The coordinator decided the fix of the two serious ones (the void check, the cap rule) and listed the rest. I is the internal subagent with the coordinator's probes, C is codex.

| # | Finding | Severity | What changed |
|---|---|---|---|
| I-A, C1 | The lengthened tool silently takes material beyond C within its reach: pins r 0.2 to 0.3 in a pocket (8 of 12 accepted, 0.04 to 0.13 mm³ too much), a separate piece of 9 mm³ under a chamfer of 5; nothing of the tool is left to find afterwards | serious | The void check before the booleans ("Recompute", 4; Decision 9): the extension with the body, cut to the region beyond C by lift + tol, its volume against a bound. R7: 36 pin cases and a post all refused, pins out of the way accepted; noise 0 in every accepted case |
| I-B, C2 | The run-out cap's area bound lets shallow voids through: caps of 0.021 mm² under 0.030 cut a groove under a pocket floor 0.2 above the foot; caps whose vertices lay 0.141 mm off the chamfer's plane would be renamed into the blend; calls.ts's shallow pocket sat 1.4× from the bound and passed at 0.05 | serious | Shallow voids are the void check's (R7: 0.1 to 0.8 deep refused at 0.01 and 0.05, 1.2 deep accepted); a run-out cap is renamed into the blend only if every vertex lies within D63's allowance of its surface, else refused (Decision 10); never into C; no planar "against" check; calls.ts's pockets 0.1 deep |
| I | Read the side from a point of the piece away from the end, at the exact root where the curve leaves that side; solve the circle–plane crossing exactly; correct "right from 5°"; small radii at 0.05; test near 10° | medium | The side between the root of the end and the one before it (the middle of the piece alone was wrong for the keyway, whose plane the rim's circle crosses twice); the root of the end within a band of the vertex, none or two refused; circle–plane exact (R5: 15° to 8° notches); R2 at 10.5° and 9.5°, from 3° up right or a bridge; R2b small holes |
| C3, I | Outside a cylinder the reach took the earliest point-feasible t and refused a later one that clears (a false bridge at x 5.93); the side check sampled against the bare radius; exterior arcs had none | medium | The whole wedge polygon against the disc of r + lift, exact, intersected with the points' sets, for translations and rotations (R4: the slot across the shaft; R6: the hole broken out through a disc) |
| C4, I | The spike gave face directions and convexity by hand at 90°, built its own sweeps, omitted D63's checks, used another leftover threshold; grouped cylinders, oblique axes, concave arcs, non-right corners unmeasured; "follows the production path" overstated | medium | The corner from the faces' triangles as D63's `along` and `signed`; D63's sliver bound and the new cap check; R6: a 104° corner, a 25° axis, a concave arc, an exterior arc; R7: flush pockets (one face at each end, so the grouping rule is rarely reached); "Measured" says what the spike does not reuse (D63's step is one closure) and the implementation owes it as tests |
| C5 | Arc–plane crossing measured at the mesh vertex | medium | Solved exactly (R5) |
| C6 | No directed motion in the contract; `crossingAt` cannot tell the sense; `reachPast` takes an opaque callback | medium | `Motion` (translation: origin, direction; rotation: origin, axis, zero, start angle, sense), used by `crossingAt`, `reachPast` and the tools |
| C7 | Agreement and refusals printed, not asserted; R2 allowed `ok` or `bridge` below the least angle | medium | Every test asserts its outcomes, the agreement with the reference and the refusals' codes and refs (R7) |
| C8, I | r − lift ≤ 0 became a fictitious cylinder | medium | Refused (`blendDoesNotFit`); such holes usually only graze first (R2b) |
| I | Two run-outs into one gap may together reach across it; the limit without a next piece was 1000 mm | medium | Refused as a bridge; the limit is the body's extent (the rest of the turn for an arc) |
| I | The revolve and the volume bookkeeping of a lengthened arc unstated | medium | "Recompute", 3: the start frame, the extent, the steps, the triangle count, the strips and the bound |
| C9, I | D63's smooth rule advises adding an `other` continuation (an end at an earlier fillet) | medium | The continuing edge's kind checked; refused naming the fillet (R7; calls.ts) |
| I | A run-out `BlendEnd` reused `face`, which D63's cap check and renumbering read as a planar end face | medium | `BlendEnd` keyed by kind; a run-out carries C apart from `face` |
| I | calls.ts: the disc's stop without detail and refs; the lobe is the "several faces" refusal; no accepted flush-cylinder run-out; no pin | minor | All four added (the lobe's two faces measured in R7) |
| C10, I | The texts omit the arc at a plane parallel to its axis, the run-out out through a round wall, the refused stops and bridges; two wordings of the flat-angle detail; no concave run-out text | minor | `MESSAGE_UNSUPPORTED_EDGE`, `SHARED_SUMMARY_4C` and "Issue codes" rewritten; one wording of the flat detail; the concave void detail |

**After the fix.** The spike as described in "Measured": R1 to R9 pass with seeds 1 and 7; every accepted case equal to the reference within 1.9 %, the void check 0 in each, every refusal with its code and the face in refs.

### Round 3 (light, on the void check)

`codex` (gpt-6-astra, light; 5 findings, 2 serious) on the diff of round 2; the coordinator decided the fixes. This was the last round: there is no fourth, and what is still open is under "Known limits".

| # | Finding | Severity | What changed |
|---|---|---|---|
| C1 | The spike tested 10⁻⁶ mm³ while the contract said 10⁻⁶ + 4 · band · the profile's area; with the contract's bound a 0.3-deep pocket (8.8 × 10⁻⁴ under 3.6 × 10⁻³ mm³) and a pin were accepted | serious | One constant, `BLEND_RUN_OUT_VOID` = 10⁻⁵ mm³, in the contract and the spike, no area term; calibrated against the regressions (the least, 1.9 × 10⁻⁴, 19 times it); a non-empty result within the kernel's uncertainty (band × its area) refused rather than accepted |
| C2 | The checked extension started (size + overshoot) · (1 / tan + 1) + lift before the end; an acute fillet's setback (11.4 mm at 10°, r 1) reaches C earlier | serious | The coordinator decided to check the whole actual tool. Measured: against the unbounded region beyond a keyway's side that counts the rim's own chip (4.0 mm³, R5 refused). So the check runs on the actual tool from `checkFrom`, the first parameter going back from the end at which the whole profile is clear of the region, solved exactly; R10: a wedge of 10° and a groove of 10°, obstacles 5 mm before the end refused, the plain cases equal to the reference |
| C3 | The extension was divided apart from the arc's tool (3.3 × 10⁻⁴ mm³ of it outside the real tool) | medium | The check cuts the actual tool mesh (a box or a sector, its cut between two rings of the tool) |
| C4 | The fixed 256-gon of the region leaves a blind strip r · π² / (2 · 256²) | medium | Sides from an error budget (sagitta ≤ tol / 4), absurd radii refused; the exclusion stated as lift + 1.25 · tol; R11: an obstacle between the 256-gon and the offset cylinder found |
| C5 | `Motion` for a rotation lacked the circle's radius and start point; the band's unit for an arc unstated | medium | `Motion` carries the curve: `point` at t = 0, and for a rotation `center`, `axis`, `radius`, `sense`; the band divided by the radius for an arc |

**After the fix.** The spike: R1 to R11 pass (12 tests, about 2.5 minutes), seed 7 too; every accepted case equal to the reference within 1.9 % with an empty void check.

## Rows for the indexes

**`docs/d36/README.md`, the row of 4c** (column "Design now"):

> full design, D67 ([4c-blend-round-ends/design.md](4c-blend-round-ends/design.md)), revised after three rounds of reviews to the run-out alone: a chamfer or fillet of D63's edges may end at a cylinder (a straight piece: any axis; an arc: parallel to its axis), inside or outside it, or (an arc) at a plane parallel to its axis and off it, where the edge runs into what the tool does not change beyond it (a convex edge into its air, a concave one into its material) at 10° or more: the tool runs on until its corner has crossed the face, the reach solved exactly, the side read on the exact curve between roots, and a void check proves that the run-out takes or adds nothing beyond the face (a pin in a pocket, a shallow pocket refused). Stops, bridges, two faces at an end, straight edges with round faces and two lines of one name are refused or deferred with the findings of the reviews. No new type, role, code, field or schema step. Measured: every accepted run-out equal to the blend made before the void; the void check 0 in every accepted case. Covers the actuator's housing chamfer and the shaft's slot; not its fillet, motor shell or lobes

**`docs/decisions.md`, the row:**

> | D67 | [4c Chamfers and fillets of edges that run out into round faces](d36/4c-blend-round-ends/design.md) | designed 2026-11-17 from the conversion of an actuator from Onshape (4 of 10 chamfers, no fillet), cut to the run-out after the first round of reviews; the void check and the exact side added after the second. Spike: every accepted run-out at a cylinder (inside or outside, any axis for a straight edge) or a keyway's plane equal to the blend made before the void (the housing's rim, holes through edges at 10.5° to 90°, a rib's foot into a boss, a boss's foot into another, a shaft's slot through its cylinder, a hole broken out through a disc, random cases); pins, posts and shallow pockets within a run-out refused by the void check, which found 0 in every accepted case; read at the mesh vertex a crossing of 12° looked like 8° | An edge of D63 may run out into a cylinder or (an arc) a plane off its axis it crosses at 10° or more, into what the tool does not change beyond it; the tool runs on until its corner has crossed it, the reach solved exactly, and the part past the end may take or add nothing beyond the face. Stops, bridges and two faces at an end refused with advice; straight edges with round faces and two lines of one name deferred. No new type, role, code, field or schema step |

**`docs/requirements.md`, scenario 17:**

> 17. *Blends that run out into round faces (4c, D67): designed, not done yet* ([d36/4c-blend-round-ends/calls.ts](d36/4c-blend-round-ends/calls.ts)). The housing of a cycloidal actuator (a plate with a bore and 16 pin pockets cut into its wall) gets a chamfer of 0.5 of the bore's rim: one edge of 16 arcs running out into the pockets, one cone meeting every pocket's wall; cutting the pockets a second time flush with the first changes nothing. A hub's bore broken by a keyway gets a chamfer of its rim running out past the keyway's sides. A rib's concave foot running into a boss gets a fillet of 1.5 running out inside the boss. The motor shaft's slot from a hex socket out through the shaft gets a chamfer of 0.5 of its two top edges, nothing outside the shaft's radius. A box whose top edge a hole notches takes a chamfer of 1 and refuses one of 2 as a bridge, advising to chamfer before the hole. Refused, each at its place in the timeline: stops (a rib's top edge into the boss, a rib's foot flush with the rim of a disc), two faces at an end (the rim of a lobe under another lobe), an edge between two cylinders, an end at a tapered hole's cone, a hole crossing the edge at 8°, an end at an earlier fillet along an edge of the kind other, and (`blendDoesNotFit`) a pin standing in a hole within the run-out and pockets 0.1 deep. Wider pockets keep every face; save and load give the same volumes.

## As implemented

Implemented on the branch `d36/4c` (2026-11-17) as designed: the ends keyed by kind (`joint`, `face`, `runOut`), the candidates, `crossingAt` with the side between roots and the least angle of 10°, the stops refused, `reachPast` with the polygon's clearance outside a cylinder, two run-outs into one gap, `runOutRegionSides`, `checkFrom`, the lengthened tools, the void check on the actual tools before the booleans with `BLEND_RUN_OUT_VOID` and `runOutUncertain`, the cap of a run-out checked by the distance of its vertices and renamed into the blend, the smooth rule's refusal of an `other` continuation, the faces of several surfaces in refs, the texts. No schema step, type, role or code. The rules as built are in [../../architecture/edge-blend.md](../../architecture/edge-blend.md), "Run-outs past a round face (D67)"; the tests in [../../architecture/verification.md](../../architecture/verification.md).

**Deviations, and why:**

- *The void check falls back to the other order.* Where the kernel refuses the tool with the body (a folded triangle), the same set is measured the other way round: the tool cut to the region first, then intersected with the body (less the body, concave). Intersection is associative, so it measures the same thing, and a refusal of that is still a `kernelFailure`; the measured order stays first. Found by the fuzz at 2 000 mm ("To verify"): it took the failures where the reference builds from 4 of 11 pocket cases to 2.
- `beyondVolume(chip, region, kernel, op)` takes the tool with the body (`chip`), computed once per piece, instead of the tool, the body and the convexity; `op` is `difference` in the fallback of a concave piece. `checkFrom` takes the margin (size + overshoot, in radians for an arc) and returns the parameter already moved back.
- *The limit of an arc's run-out counts the other end of the same piece*, so the rule of two run-outs into one gap covers one arc with both ends in one gap (a keyway). Into a convex region symmetric about the gap the rule cannot bite (each reach is the first parameter of a containment interval centred in the gap); it does outside a cylinder, which the tests show with two shafts 0.02 apart.
- *The texts.* A kind not taken keeps D63's words with the new ending: "the edge ends at a round face (…, a cone) that does not continue a face of the edge, which this feature cannot run out into yet"; an arc at a plane: "does not hold its axis and is not parallel to it, which this feature cannot run out into yet"; at a cylinder off its axis: "whose axis is not parallel to its own". "Only grazes": "the edge only grazes the end face in refs: its line or circle meets that face twice near the end"; "does not meet": "the edge does not meet the end face in refs where it ends". The shared summary keeps D63's explanation of the facts in parentheses. The smooth rule refuses naming the face where the continuing edge is found and of the kind `other`; elsewhere D63's advice stays.
- *Scenario 17* (`packages/scenarios/test/scenario17.test.ts`) differs from [calls.ts](calls.ts) in two places. The motor shell's stop: in calls.ts the fin's end is an arc flush with the disc's side; at y 200 its polygon stood a sliver past the disc's, so the end had two faces (the disc's side and the fin's underside) and was refused as such, not as a stop. The test makes the disc 30 and the fin 28 long and trims both to 25 by one cut, so the fin's foot ends at the cut's one face. And `master` is at the schema version 10 now (D66), so the test checks that the version is kept, not that it is 9.
- *R4 of the spike*: the slot across the shaft chamfered by 2 is refused by D63's check that a face would vanish (the wall is 2 high), which the spike did not run; the tests use 1.5 (within 1 % of the exact volume at 0.01 and 0.05).
- The tool of a piece is built once and kept, so the void check and the boolean use the same mesh.

**Tests owed by the design, as done**: all of "Tests the implementation owes", except R11's obstacle between the old 256-gon and the offset cylinder, which stays in the spike (the engine test checks the sides of the polygon), and "nothing in an accepted case" of the void check, which is not visible through the step (every accepted case equals the reference). R8's random cases are the second test of `spikes/edge-blend-fuzz.spike.ts`.

**To verify, as found:**

- *Far from the origin* (the fuzz with `RUN_OUT_FUZZ_FAR=2000`, seed 1, 12 of each): holes through edges all right or bridges; of 11 pocket cases 2 end in `kernelFailure` where the blend made before the pockets builds (4 without the fallback above); never a wrong body. A known limit, as D63's at round faces that far out.
- *The housing in the real model* is not a plain top: a ring with an inner radius of 29 lies on the bore of 29.5, so the rim the chamfer of 0.5 is on lies under a lip 0.5 wide (and the converter split the bore at the pockets: 32 edges, the 16 arcs at the top and the 16 at the bottom). Every end runs out into its pocket, but the concave chamfer reaches the lip's inner edge exactly, and D63's check of the overshoot refuses it (0.039 mm² on the lip's wall). At 0.49 all 32 edges convert in about 1 s (24.9 mm³ added). A blend as wide as its face is D63's limit, not this package's.
- *The motor shaft in the real model*: the edges of its Chamfer 1 are the concave feet of a tab on the end of the shaft, not the convex top edges of a slot as reconstructed. Their inner end has two planes (the socket and the tab: refused, "Deferred", 6), their outer end runs past the shaft's rim into the air: a stop, deferred like the motor shell's.
- Not done: concave arcs of other shapes in the fuzz, and a fillet ending at a cylinder on the other face of an arc.

**The conversion of the actuator** ([../../onshape-import.md](../../onshape-import.md)) is unchanged by this package: the same 4 of 10 chamfers convert and every volume is the same (Housing Middle −0.55 %, Motor Shaft −0.06 % against Onshape); the refusals now say why in the terms above.
