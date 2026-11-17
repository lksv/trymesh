# 4c Chamfers and fillets of edges that run out into round faces (D67)

**State: design, written on 2026-11-17 against `master` at `ad8cf61` (every package of D36 merged, schema version 9), with a spike against the real kernel adapter ("Measured"); revised after the first round of reviews ("Reviews"), which cut the scope down to the run-out.** Written by Claude Opus 5.5. It builds on 4b (D63, [../4b-edge-chamfer-fillet/design.md](../4b-edge-chamfer-fillet/design.md), as implemented: [../../architecture/edge-blend.md](../../architecture/edge-blend.md)). It adds no feature type, face role, issue code, edge name field, edge kind, command, query or schema step. It widens which ends of an edge `chamfer` and `fillet` accept, with new details of the errors.

Files: [contract.ts](contract.ts) (what is accepted, the least crossing angle, the texts, the new parts of the recompute), [calls.ts](calls.ts) (validation scenario 17), and the spike `spikes/edge-blend-round-ends.spike.ts`.

## Where it came from

Converting a real Onshape model (a 3D-printed cycloidal actuator, [../../onshape-import.md](../../onshape-import.md)) converted 4 of 10 chamfers and none of its one fillet. Every refusal was a limit of D63:

| Part, feature | Geometry | What it is | This package |
|---|---|---|---|
| Housing, Chamfer 2 (0.5, 32 edges) | The top rim of a bore R 29.5 broken into 16 arcs by 16 pin pockets r 2.5 cut into its wall | An arc that runs into the air of a pocket (a cylinder parallel to its axis) | **Covered** (a run-out, "Measured", R1) |
| Housing, Fillet 1 (r 1, 32 edges) | The vertical lines where the pockets meet the bore | A straight edge between two cylinders; and each pocket meets the bore in two lines that share one name (the two faces) | **Not covered**: deferred ("Deferred", 1 and 2) |
| Motor shaft, the chamfer of a slot (0.5) | Two straight convex edges at the top of a slot from a hex socket out through the shaft's cylinder r 6 | At the outer end a run-out into the air outside a cylinder; at the inner end a face of the socket | **Outer end covered** (R4). The inner end is one plane of the socket in a synthetic model (D63 ends there already); in the Onshape model D63 names two faces of the socket there, which this package does not take ("To verify") |
| Motor shaft Chamfer 1, motor shell Chamfer 2 (4, 8 edges, concave) | The foot of a rib standing flush with the outer edge of a round plate | A concave edge that runs past the rim into the air: the blend has to **stop** at the rim | **Not covered**: stops are deferred ("Deferred", 3) |
| Input shaft, Chamfers 1 and 2 (0.5) | The circular edges of two eccentric lobes stacked | The rim of the lower lobe runs under the upper one: a **stop** at a vertex of four faces; and the converter split each circle into arcs (half a smooth chain, tried one by one) | **Not covered**: stops are deferred; the split arcs are a matter of the converter ("For the plan") |

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

**What this package covers.** The **run-out**: an edge that runs, past its end, into what the tool does not change beyond the end face. A convex edge runs into the face's air: the rim into a pocket, an edge into a hole that breaks it, a slot's edge out through a shaft's cylinder, the rim of a bore into a keyway. A concave edge runs into the face's material: the foot of a rib into a boss. The tool runs on until its corner has crossed the end face, and the air or the material beyond does the rest. The result is exactly the blend made before the feature that made the end face. It is cheap (no new boolean, nothing moved off a face), and measured equal to that reference on every case of the spike. Everything else on the list is refused with a message that says what to do, or deferred with the reasons the reviews found, so that the later package starts from them.

## The cheap variant

**In:**

- D63's edges, unchanged: straight between two planes; circular between faces about one axis whose profile in a half plane through the axis is a straight line (a plane across the axis, a cylinder, a cone).
- One more kind of end, the **run-out**, at one end face C:
  - a straight piece: C a **cylinder** of any axis;
  - an arc: C a **cylinder whose axis is parallel to the arc's**, or a **plane parallel to the arc's axis that does not hold it** (the side of a keyway or of a slot through a bore's rim; D63 refuses a plane off the axis);
  - faces at the end that lie on one cylinder (the same axis line and radius: two extrusions flush with each other) are one end face, named by the one next to face `a`, else the first;
  - the edge runs, past its end, into what the tool does not change beyond C: a convex edge into C's air, a concave edge into C's material;
  - it crosses C at **10° or more** (`BLEND_MIN_CROSSING`), read where its line or circle meets C exactly;
  - the corner of the blend crosses C before the tool reaches the next piece of the same edge.
- The tool runs on until every point of the corner lies beyond C by the lift; the chamfer or fillet then ends on C's surface. Nothing else changes: names, facts, faces, codes.

**Refused, with a detail that says what to do** (`unsupportedEdge` unless said otherwise):

- **A stop** (deferred): a convex edge that runs into C's material, or a concave edge that runs into C's air. "The edge runs into the material of the end face in refs, so the chamfer would have to stop at that face, which this feature does not do yet; where that face comes from a later feature, chamfer the edge before it." For a concave edge, "runs past the end face in refs into the air beyond it" instead.
- **A bridge** (deferred): the corner passes behind C before crossing it (a hole that notches the edge less deep than the chamfer). "The chamfer passes behind the end face in refs before it crosses it (the face notches the edge less deep than the chamfer); chamfer the edge before the feature that makes that face, or use a smaller size."
- **A crossing under 10°**: "the edge meets the end face in refs at 8°, less than 10°".
- **C of a kind not taken yet**: "the edge ends at a cone (refs), which this feature cannot run out into yet". The same for a sphere, a torus (an end at an earlier blend of a circular edge), a swept or an imported face, and for an arc's cylinder or plane not parallel to its axis. Faces at the end on two surfaces keep D63's detail.
- `blendDoesNotFit` with the edge and C: the cap of a run-out is left in the result ("the chamfer runs on past the face in refs into material beyond it: the void is too shallow or too narrow for it"), as for pockets shallower than the chamfer.

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

   It is the case of the motor shell, the input shaft's lobes, and a rib's top edge into a boss.
4. **Bridges.** One tool across the gap between two pieces was the reference in every case measured. But its safety cannot be checked cheaply: material wholly inside the bridged tool leaves no face of the tool, and the widened volume bound swallows it. And D63's per-piece checks (the blend face, slivers, caps, volume entries) assume one tool per piece. Refused, with the advice to blend before the feature that makes C, which gives the same result.
5. **Ends at a cone, a sphere, a torus**, and an arc's end at a cylinder or a plane not parallel to its axis: not measured. The cone is needed after a chamfer of a rim (an edge running up into the chamfer's cone) and for countersinks. Ends at an earlier fillet are usually tangent to a face of the edge, where D63's smooth rule applies and the edge of the fillet is `other`: a known limit.
6. **An end at two planes** that both cross the edge (the inner end of the motor shaft's slot in the Onshape model). Without the model it cannot be told whether the void there is the intersection of their air sides or a sliver left where the slot meets the socket at a vertex. In a synthetic model of the same slot the end is one plane, which D63 takes.
7. A variable radius, a ball at a vertex, general (`other`) edges, an end condition chosen by the user (D36 keeps these out).

## Document

Nothing changes: no feature type, field, face role, edge name field, edge kind, issue code, command, query or schema step. A build with D63 alone opening a document of this package shows the newly accepted edges in error (`unsupportedEdge`), in the open; it drops nothing.

## Recompute

The step of D63 (`blendStep`, recompute/edge-blend.ts) in its order; only what changes is written here.

1. **The body, the edges, their kind, the pieces, the corner, the profile.** As D63.
2. **The ends.** D63's rules first and unchanged: a convex and a concave edge at a vertex; another edge of the feature (smooth, mitre, plane of the other's face); one face continuing `a` or `b` (smooth); a seam. Then the faces at the end besides `a` and `b`:
   - Faces on one cylinder are one end face C (`sameCylinder`: axes parallel within the angle tolerance, the distance of one axis line from the other and the difference of the radii within ten precisions of the coordinates; a cylinder's `center` is any point of its axis and is not compared). Planes on one plane as D63.
   - **One planar C the tool can end in flat** (a straight piece at a plane crossing it at more than `BLEND_MIN_ANGLE`; an arc at a plane through its axis): D63's planar end, unchanged.
   - **One cylinder C, or a plane C an arc cannot end in flat**: a candidate run-out.
     - *The kinds taken.* A straight piece with any cylinder; an arc with a cylinder or a plane parallel to its axis. Otherwise refused ("cannot run out into yet").
     - *Where the edge meets C exactly* (`crossingAt`): the straight piece's line with the cylinder (a quadratic) or the plane; the arc's circle with the cylinder (two circles in the plane across the axis) or the plane; the root nearest the end vertex of the mesh. The angle and the side are read there, not at the mesh vertex. At the vertex the direction of a cylinder's normal is off by up to half a step of its polygon: R2 read a crossing of 12° as 9° at 0.05. No root (the line or circle does not meet C): refused as too flat.
     - *The angle.* The angle between the edge's way past its end (the tangent for an arc) and C's tangent plane there, at least `BLEND_MIN_CROSSING` (10°), else refused.
     - *Air or material.* The sign of the dot product of the edge's way past its end with C's outward normal there; the normal's sign comes from C's triangles at the end vertex, area-weighted, as D63 signs the faces of an edge. Into C's air when positive. A **run-out** when that equals `convex`; otherwise a **stop**, refused (deferred).
     - *The reach* (`reachPast`), exactly. For every point of the profile's `wedge` (the corner and the exact blend, which D63's corner of two straight face lines closes exactly), the set of parameters t ≥ 0 at which the point, carried past the end, lies beyond C by at least the lift:
       - a straight piece and a cylinder: an interval or two from the roots of a quadratic, at the radius r − lift when beyond is inside, r + lift when outside;
       - a straight piece and a plane: a half line;
       - an arc and a cylinder parallel to its axis: the arcs of one circle inside or outside another;
       - an arc and a plane parallel to its axis: the arc of a circle on one side of a line.

       The reach is the least t in all the sets at once (their intersection, so a point that has crossed and come back does not count), up to the limit: the next piece of the same edge on that way, and for an arc the rest of the turn. Where beyond is the outside of a cylinder (a region that is not convex), every side of the wedge polygon at the reach is also checked against the axis (its distance at least r), since points alone do not clear a side that dips into the cylinder. No such t: a **bridge**, refused (deferred).
     - The overshoot of the profile need not cross: it lies in the air (or, concave, in the material) anyway. Requiring it refused right cases in the first round (a hole whose centre lies behind the face never takes the overshoot in front of it).
   - Anything else: D63's refusal.
3. **The tools.** A run-out lengthens the tool of its piece. A straight piece's end is the plane across the edge at the reach, an arc's the half plane through the axis at the reach angle. The part inside the wedge for the volume check is lengthened alike. Face numbers as D63 (seven per piece; the cap of a run-out is the cap at that end).
4. **The booleans.** As D63: the cut tools united and subtracted, the added ones united and joined. No fallback to one by one.
5. **The checks.** D63's, and the cap of a run-out: it lies beyond C in the air (or the material), so it is left in the result only where C bounds a void too shallow or too narrow for the blend. Above the bound of a cap at a joint of D63 (lift × (size + overshoot) mm²) it is `blendDoesNotFit` with the edge and C; a sliver goes to the blend.
6. **The renumbering, the result, the facts.** As D63. C keeps its name and loses what the run-out took of it: the chamfer of the rim takes a piece of every pocket's wall.

## Faces and edges of the result

As D63. The new face of an edge meets C along a curve: a cone with a pocket's cylinder, a plane with a shaft's cylinder. That edge is generally of the kind `other`, and a plane with a plane (a keyway's side) a `line`. The faces of the edge and C keep their names.

## Issue codes

The codes of D63. `MESSAGE.unsupportedEdge` changes (contract `MESSAGE_UNSUPPORTED_EDGE`): "The edge cannot be chamfered or filleted: only a straight edge between two planes and a circular edge between a plane, a cylinder or a cone about one axis can, ending at a plane, running out into a hole, a pocket or a boss it crosses, meeting another edge of the same feature at a vertex, or running on smoothly into an edge of the same feature." The details of "The cheap variant" replace D63's "the edge ends at a round face (…) that does not continue a face of the edge" (still said of an end that is neither a run-out nor a stop) and "the arc ends at a plane (…) that does not hold its axis" (still said of a plane not parallel to the axis). Every detail names C in `refs`.

## Where the code lives

| File | What |
|---|---|
| `recompute/tool-edge.ts` | `reachPast` (the intervals), `BLEND_MIN_CROSSING` |
| `recompute/edge-blend.ts` | `runOutFace`, `sameCylinder`, `crossingAt`; the ends: faces on one cylinder, run-out or refusal; the tool lengthened; the check of a run-out cap |
| `recompute/services.ts` | `MESSAGE.unsupportedEdge` |
| `features/chamfer.ts`, `features/fillet.ts` | The summaries (`SHARED_SUMMARY_4C`) |
| `types.ts` | The comments of the two feature types (read by the AI) |
| mcp: `api.ts` | The paragraph of `CONVENTIONS` on the two types: run-outs, refused stops and bridges |
| docs | `architecture/edge-blend.md` (the ends), `ui/chamfer-fillet.md` (nothing in the form; the texts) |

The app changes nothing but texts it already prints from the engine. The imports go one way, as D63's.

## Measured

The spike `spikes/edge-blend-round-ends.spike.ts`, revised after the reviews, runs against the real kernel adapter (`packages/kernel-manifold`, `manifold-3d` 3.5.5) on bodies made by the engine of `master`: `npx vitest run --config spikes/vitest.config.ts spikes/edge-blend-round-ends.spike.ts`, 2.9 minutes. It follows the path the implementation takes:

- the pieces and their end vertices come from the body's own edge (its mesh segments, chained);
- the end face comes from the triangles at the vertex;
- the angle and the side are read at the exact meeting point, the normal signed by C's triangles;
- the reach is solved exactly, as intervals;
- the tools are D63's profile swept along the piece and lengthened, united first, with no fallback;
- what is left of a tool besides its blend (the overshoot, the cap of a run-out) is measured.

Every outcome is counted: `ok`, `bridge`, `flat`, `stop` (the last three refused by design), and `left`, `kernel`, `noFace` (failures). The tests fail on a failure in scope. "Reference" is the same blend made by the engine before the feature that made C, the same set of points.

**R1. The housing** (a plate 80 × 80 × 8, a bore R 29.5 through, 16 pockets r 2.5 on the circle 29, 4 deep; the rim is one edge of 16 arcs, each crossing a pocket at 76°). D63: "the edge ends at a round face (P/side/k9) that does not continue a face of the edge".

| Chord tol. | Blend | Outcome | Taken: run-out, reference (mm³) | Reach (mm) |
|---|---|---|---|---|
| 0.01 | chamfer 0.5 / 1.5 | ok | 13.782, 13.763 / 130.289, 130.186 | 0.20 / 1.07 |
| 0.01 | fillet 0.5 / 1 | ok | 6.155, 6.139 / 24.410, 24.347 | 0.20 / 0.52 |
| 0.05 | chamfer 0.5 / 1.5 | ok | 14.630, 14.648 / 133.531, 133.318 | 0.23 / 1.14 |
| 0.05 | fillet 0.5 / 1 | ok | 7.046, 7.064 / 27.239, 26.793 | 0.23 / 0.57 |
| 0.001 | chamfer 0.5 | ok | 13.583, 13.582 | 0.18 |
| 0.001 | fillet 0.5 | ok | 5.822; the reference refused by the kernel (the pockets cut after the fillet) | 0.18 |

Nothing of a tool is left in any case. The run-out and the reference differ by 0.01 to 1.7 %, under the area of the blend times half the chord tolerance. The tools are divided from different starts: an arc of each piece here, a whole circle from the model's X there. The exact chamfer of 0.5 takes 13.562 mm³.

**R2. A straight edge broken by a hole, by the angle it crosses at** (a box 60 × 40 × 20, the top-front edge broken by a hole r 4 at (30, ±4 cos φ), crossing at φ: 90° to 3°; the centre behind or in front of the face; chamfers of 1 and 2, a fillet of 1; chord tolerances 0.01 and 0.05):

- From 12° up: 34 run-outs, each equal to the reference to 10⁻³ mm³, nothing left, reach 0.015 to 1.9 mm. 20 bridges, refused as designed: the centre in front, the notch less deep than the corner.
- Without a least angle: every case from 5° up is right or a bridge. At 0.05 every case under 12° is a bridge, since the lift (0.075) keeps the corner from getting the lift inside a hole that only grazes the face. At 3° the side test misreads the side at 0.01 (6 stops that are run-outs). So the least angle is 10°, twice the margin over that.
- With the least angle read at the mesh vertex instead of the exact point, six cases of 12° were refused as 9° at 0.05. Hence `crossingAt`.

**R3. The concave foot of a rib running into a boss** (a plate 60 × 40 × 5, a rib 2 wide and 10 high, a boss r 6, 15 high; crossing 80°): chamfer 1.5, fillets 1.5 and 3 at 0.01 and 0.05, all `ok`. Each is equal to the reference to 10⁻³ mm³ (28.360, 12.333, 49.194 mm³ added at 0.01), nothing left, reach 0.48 to 1.52 mm.

**R4. The slot of the motor shaft** (a shaft r 6, a hex socket of circumradius 2√3 5 deep, a slot from its corners (3, ±√3) out to x 7, 2 deep; the slot's two top edges cross the cylinder at 73° into the air outside it, and their inner ends are one face of the socket, D63's planar end). D63: "the edge ends at a round face (E/side/c) that does not continue a face of the edge". A chamfer of 0.5 takes 0.372 mm³ per edge at 0.01 and 0.367 at 0.05 (exact 0.373, computed between the socket's face and the exact cylinder). A fillet of 0.5 takes 0.162 and 0.180. All `ok`, nothing left; the sides of the wedge clear the cylinder.

**R5. The rim of a bore broken by a keyway** (a bore R 10, a keyway 3 wide, 4 deep; the arc ends at the keyway's sides, planes parallel to the axis and off it). D63: "the arc ends at a plane (K/side/kl2) that does not hold its axis". Chamfers 0.5 and 1, a fillet 0.5 at 0.01 and 0.05, all `ok`, equal to the reference within 0.003 mm³ (7.705 and 7.704 for the chamfer of 0.5 at 0.01), nothing left.

**R6. Random cases**, 40 of each kind with seed 1 (`ROUND_ENDS_COUNT`, `ROUND_ENDS_SEED`), the chord tolerances 0.01, 0.05 and 0.001 in turn:

- a hole of radius 1 to 6 through the top-front edge of a box 8 to 28 high, crossing at 12° to 90°, the centre on either side, a chamfer or a fillet of 0.2 to 2.5: 22 `ok`, 18 bridges refused;
- 3 to 20 pockets of radius 1 to 4 around a bore R 29.5, their centres within ±1 of its circle, a chamfer or a fillet of 0.2 to 1.5: 38 `ok`, 2 bridges.

No `left`, `kernel`, `flat`, `stop` or `noFace`. The largest difference from the reference was 1.7 %, the arcs against the whole circle as in R1. Seed 7, 60 of each kind: holes 44 `ok` and 16 bridges, pockets 53 `ok` and 7 bridges; no failure; the largest difference 1.85 %; the kernel refused one reference (the pockets cut after the blend), not the run-out. Together: 157 run-outs, 43 bridges, no failure.

**Round 1, kept as evidence for the deferred parts.** The first spike, its tools built by hand from exact geometry, measured three things:

- the prism with a profile of two circles at the housing's ridges: with the lift nothing left, the blend within the lift of its curve; without the lift 0.06 to 12.6 mm² left;
- stops clipped by C moved by the lift towards the edge: nothing left; on C or moved away, slivers of 0.001 to 0.69 mm² left;
- a random set of 578 stops: 1 refused by the kernel and 1 sliver of 0.004 mm², both at 0.001.

The reviews found its chamfer lift, its plane-as-circle and its chord-closed wedge wrong for these purposes ("Deferred", 1 and 3), so these numbers are a starting point, not a result.

**A bug of the prototype, for the implementation.** The kernel triangulates a clockwise loop into a fan of slivers, and a union of two prisms with such caps is refused ("folded triangle"). D63's `edgePrism` always gets the counter-clockwise profile; a lengthened tool has to keep that.

## Decisions

1. **The scope is the run-out.** *Why:* it is measured equal to the reference in every case (R1 to R6). It adds no boolean, no face, no name and no field, and it covers the actuator's housing chamfer and the shaft's slot. Stops, bridges, straight edges with round faces and two lines of one name each brought serious findings that need a design of their own ("Reviews"; the coordinator's decision on scope, on the owner's standing instruction to prefer robust over broad).
2. **Run-out or stop by the side the edge goes into, not by the user.** A run-out where the tool changes nothing beyond C; a stop otherwise, refused for now. *Why:* that is where the air or the material beyond C does the rest; a user of Fusion or Onshape never chooses.
3. **The angle and the side at the exact meeting point.** *Why:* at the mesh vertex the normal of a cylinder is off by up to half a polygon step (R2).
4. **The reach exactly, as intervals, from the wedge alone.** *Why:* exact for every kind taken (a quadratic, two circles, a circle and a line). The intersection of the sets handles a point that crosses back. The overshoot need not cross (R2 of round 1).
5. **The least crossing angle 10°.** *Why:* R2: right from 5° up, the side misread at 3°.
6. **A bridge is refused, with the advice to blend before the feature that makes C.** *Why:* that order gives exactly the bridged result, and a bridge's safety cannot be checked cheaply.
7. **Faces on one cylinder are one end face, compared by axis line and radius.** *Why:* two extrusions flush with each other are one face to the user; a cylinder's `center` is any point of its axis.
8. **No new code, role, field or schema step.** *Why:* what changes is what is accepted; the errors of D63 carry the new refusals in their details.

## Rejected alternatives

1. **End every tool in the plane across the edge at its end vertex.** Up to 0.48 mm proud of a rim, a notch of 3.7 mm³ behind a hole, 0.53 mm³ under another lobe, and refused by the kernel for fillets at pockets (round 1).
2. **The same, accepted where its error is below a tolerance.** Needs the same geometry as the run-out to measure the error, and then still gives the wrong shape above it.
3. **Clip every end by C's solid, run-outs too.** A boolean more per end, a surviving face off C's surface, where the reference shows none is needed.
4. **The reach by sampling, or by every point of the profile.** Sampling in an angle has no physical step, and a point's first crossing is not a time when all are beyond. Every point refuses right cases.
5. **The angle and side at the mesh vertex.** Misread by up to half a polygon step (R2).
6. **Stops, bridges, straight edges with round faces, `which`, in this package.** See "Deferred" and "Reviews".
7. **Reorder: make the blend before the feature that made C.** Not possible in a timeline the user wrote; it is the reference, and the advice a refused bridge or stop gives.

## Known limits

- Stops are refused: the motor shell's concave rib feet flush with a round plate's rim, the input shaft's lobes, a rib's top edge into a taller boss. Where C comes from a later feature, blending before it gives the right result.
- Bridges are refused: a hole that notches an edge less deep than the chamfer.
- A crossing under 10° is refused; at the chord tolerance 0.05 most crossings under about 12° are bridges, since the lift keeps the corner from getting inside a face that only grazes the edge.
- Ends at a cone, a sphere, a torus, a swept or an imported face; an arc's end at a cylinder or a plane not parallel to its axis; an end at two planes that both cross the edge; ends at an earlier fillet tangent to a face of the edge (D63's smooth rule, an `other` edge).
- Straight edges between a plane and a cylinder or two cylinders, and edges on two lines of one pair of faces, stay `other` and refused, as in D63.
- The reach treats C's surface as unbounded; a void that ends within the corner (a pocket shallower than the chamfer) is refused by its cap, not cut to fit.
- The volume check is looser by the wedge that runs past the end inside C's void.

## To verify before the implementation

- The fuzz of D63 (`spikes/edge-blend-fuzz.spike.ts`) with these ends:
  - at 2 000 mm from the origin, where the lift grows with the kernel's band;
  - concave arcs (none was measured: the foot of a ring boss into a cylinder parallel to it);
  - a fillet ending at a cylinder on the other face of an arc.
- The shaft's slot in the Onshape model: whether its inner end is one face of the socket (taken by D63) or two (refused); see "Deferred", 6.
- That D63's check of a cap at a joint is the right bound for a run-out cap far from the origin.
- The housing's rim chamfer and pockets in the real model (16 pockets, the converter's split curves), and its time: the spike's 16 arcs take 0.1 to 0.4 s at 0.01, 1.2 s at 0.001.

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
  - `crossingAt`: a line and a cylinder of any axis; an arc and a parallel cylinder; a plane; no root; the nearest root;
  - `reachPast`: each kind; a point that crosses back; the outside of a cylinder with a side dipping in; no reach;
  - `sameCylinder` with axes given at different points;
  - each new detail of `unsupportedEdge` and the run-out cap's `blendDoesNotFit`;
  - `modules.test.ts`.
- Scenarios: `scenario17.test.ts` from [calls.ts](calls.ts); `edge-blend-round-ends.test.ts` with R1, R3, R4, R5 and R2's angles as assertions against the reference; the random cases of R6 added to D63's fuzz spike.
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

**After the fix.** The spike as described in "Measured": R1 to R5 all `ok` where in scope, R2's angles, and R6 with two seeds (157 run-outs, 43 bridges refused, no failure). The review of the next round looks mainly at the run-out as revised.

## Rows for the indexes

**`docs/d36/README.md`, the row of 4c** (column "Design now"):

> full design, D67 ([4c-blend-round-ends/design.md](4c-blend-round-ends/design.md)), revised after round 1 to the run-out alone: a chamfer or fillet of D63's edges may end at a cylinder (a straight piece: any axis; an arc: parallel to its axis) or (an arc) at a plane parallel to its axis and off it, where the edge runs into what the tool does not change beyond it (a convex edge into its air, a concave one into its material) at 10° or more: the tool runs on until its corner has crossed the face, the reach solved exactly. Stops, bridges, straight edges with round faces and two lines of one name are refused or deferred with the findings of the reviews. No new type, role, code, field or schema step. Measured: every run-out equal to the blend made before the void; the least angle from 5° right, 3° misread. Covers the actuator's housing chamfer and the shaft's slot; not its fillet, motor shell or lobes

**`docs/decisions.md`, the row:**

> | D67 | [4c Chamfers and fillets of edges that run out into round faces](d36/4c-blend-round-ends/design.md) | designed 2026-11-17 from the conversion of an actuator from Onshape (4 of 10 chamfers, no fillet), cut to the run-out after the first round of reviews. Spike along the implementation's path: every run-out at a cylinder or a keyway's plane equal to the blend made before the void (the housing's rim, holes through edges at 12° to 90°, a rib's foot into a boss, a shaft's slot through its cylinder, 157 random run-outs), nothing of a tool left; read at the mesh vertex a crossing of 12° looked like 9°; at 3° the side was misread | An edge of D63 may run out into a cylinder or (an arc) a plane off its axis it crosses at 10° or more, into what the tool does not change beyond it; the tool runs on until its corner has crossed it, the reach solved exactly. Stops and bridges refused with advice to blend before the feature that makes the face; straight edges with round faces and two lines of one name deferred. No new type, role, code, field or schema step |

**`docs/requirements.md`, scenario 17:**

> 17. *Blends that run out into round faces (4c, D67): designed, not done yet* ([d36/4c-blend-round-ends/calls.ts](d36/4c-blend-round-ends/calls.ts)). The housing of a cycloidal actuator (a plate with a bore and 16 pin pockets cut into its wall) gets a chamfer of 0.5 of the bore's rim: one edge of 16 arcs running out into the pockets, one cone meeting every pocket's wall. A hub's bore broken by a keyway gets a chamfer of its rim running out past the keyway's sides. A rib's concave foot running into a boss gets a fillet of 1.5 running out inside the boss. The motor shaft's slot from a hex socket out through the shaft gets a chamfer of 0.5 of its two top edges, nothing outside the shaft's radius. A box whose top edge a hole notches takes a chamfer of 1 and refuses one of 2 as a bridge, advising to chamfer before the hole. Refused, each at its place in the timeline: stops (a rib's top edge into the boss, a rib's foot flush with the rim of a disc, the rim of a lobe under another lobe), an edge between two cylinders, an end at a tapered hole's cone, a hole crossing the edge at 8°, pockets shallower than the chamfer (`blendDoesNotFit`). Wider pockets keep every face; save and load give the same volumes.
