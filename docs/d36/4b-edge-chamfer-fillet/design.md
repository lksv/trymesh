# 4b Chamfer and fillet of edges (D63)

**State: design, written on 2026-11-17 against `master` at `b4c2a86` (every package of steps 1 and 2, the grid of 2e, 3a, 3e, 5a, 5e and 5f merged; 3b, 3d, 4a, 5b, 5c and 5d designed), with the spike the plan asks for run against the real kernel adapter and the engine ("Measured"), and revised after its reviews ("Reviews"). Not implemented.** Written by Claude Opus 5.5 (Fable was not available, owner, 2026-11-17). It needs 4a (the tool of the revolve, the torus, the circles two surfaces of revolution meet in, the chord tolerance in the state) and keeps the precondition of 3d (no face number in both operands of a union or a difference). It adds two feature types, two face roles and two issue codes; no query, no command, no section of the document, no schema step.

Files: [contract.ts](contract.ts) (the two feature types with their patches and fields, the roles, the codes, the constants the spike fixed, the build of the tool of a straight edge and the setup of the revolve of a circular one), [calls.ts](calls.ts) (validation scenario 14, its part of 4b, and a short part of scenario 12).

## What the backlog says, checked against the code

[backlog.md](../../backlog.md): the entry "Chamfer and fillet of edges: realistic in a restricted form" (a body is a mesh, but faces carry an exact description; a straight edge between two planar faces gets a prism along it, cut on a convex edge and added on a concave one; a circular edge between a plane and a coaxial cylinder the same profile revolved; chamfer first; the risks to settle by a spike: the ends of an edge, a concave edge flush on two faces, a radius larger than the neighbouring face, corners where three fillets meet; not possible: edges of the kind `other`, selection that follows tangent edges, variable radius; Minkowski rejected), the rows of the taper (what 2b's taper and offset already cover: chamfered hole edges, a chamfer of the bottom edge as a slab), and step 4 of "Direction after D35" ("Revolve, then chamfer and fillet of straight and circular edges, after a spike").

| Statement | What the code says |
|---|---|
| "Faces carry an exact description (plane, cylinder) and edges a kind (`line`, `circle`, `coplanar`, `other`)" | Holds. `FaceInfo` (solid.ts) has a plane with its `y`, a cylinder, a cone, a swept surface; 4a adds the sphere and the torus. `analyzeBody` gives every edge its two faces in the canonical order, its kind and its segments (`BodyData.edges`, internal). A straight edge is `line` when both faces are planar and not parallel; a circular one is `circle` when `circleBetween` finds a circle (with 4a: `circlesBetween` and the points of the edge) |
| "A prism along the edge … cut on a convex edge and added on a concave one" | Holds, with one change the spike forced: the tool does not lie on the two faces, it reaches past them ("Measured", A and B: a tool whose legs lie on a round face leaves its own polygon in the result and is 5 to 15 times slower) |
| "The same profile revolved about the axis, so it needs the tool of the revolve" | Holds: `buildRevolve` of 4a takes a setup of its own (`RevolveSetup`, a region, an axis in the plane of a frame, the steps) and names the sides by `sideOf`; a fillet's arc becomes a torus by 4a's rule, a chamfer's line a cone |
| "A circular edge between a plane and a coaxial cylinder" | Wider at no cost: any two faces whose profile in a half plane through the axis is a straight line (a plane across the axis, a cylinder, a cone about it) make the same corner of two lines in that half plane. So the rims of a cone, of a countersink and of a tapered boss are in, and the edge of a cylinder with a cone (the groove of a pulley) |
| "The ends of an edge (the tool has to stop at the faces that meet the edge at its end points)" | The faces at an end are known from the mesh: the faces other than the two of the edge that have an edge with one of them through the end point. A planar one is the plane the tool ends in ("Measured", A: the riser of a step, a tilted end) |
| "A concave edge (the tool lies flush on two faces; the kernel adapter guarantees coplanar faces, D19, not verified for this)" | Verified for planes, both lying on them and reaching past them ("Measured", A); on round faces only reaching past them works ("Measured", B) |
| "A radius larger than the neighbouring face (an error when a face next to the edge would vanish)" | The face does vanish (a fillet of 25 on a side 20 high loses the side) and is found after the boolean ("Measured", A) |
| "Corners where three fillets meet (creases instead of a spherical patch; three chamfers are exact)" | Measured: three chamfers meet in the exact corner point; three fillets leave the crease corner 0.507 r from the sharp corner, where a ball would be 0.732 r ("Measured", D) |
| "Only edges of the kinds `line` and `circle` can be picked" | Holds, narrowed: a `line` between two planes, a `circle` between two faces of straight profile; a circle with a sphere or a torus (the rim of a dome) is refused |
| "Selection that follows tangent edges: not possible" | Following is not needed to build them; it is needed to refuse half a chain. An edge that ends where its face continues smoothly into another face (a line of an outline with round corners) ends in the plane across it, and the edge it continues into must be in the same feature, else the feature names it ("Measured", E) |
| "Rounding everything with a Minkowski sum: rejected" | Stays rejected (not selective, no names) |
| 3d: "the precondition on face numbers in the kernel port" | Kept: every face of every tool has a number of its own for the booleans, above the face table and above the numbers of the blends, and the result is renumbered after ("Recompute", 9 and 11) |
| 3d: `movedOutwards` | The faces this package makes are planes, cylinders, cones and tori, which it moves (the torus once 3d and 4a are both merged); a chamfered or filleted body is a tool like any |

## The cheap variant

```ts
interface ChamferFeature extends FeatureBase { type: 'chamfer'; body: Id; edges: EdgeName[]; distance: number }
interface FilletFeature  extends FeatureBase { type: 'fillet';  body: Id; edges: EdgeName[]; radius: number }
```

**In:**

- A **straight edge** between two planar faces (`line`), at any angle between them that is not within 0.01 rad of flat or of folded.
- A **circular edge** between two faces about one axis whose profile in a half plane through the axis is a straight line: a plane across the axis, a cylinder, a cone (`circle`). A whole circle, or an arc that ends smoothly or at a plane through the axis.
- **Convex and concave** edges: the material of a convex edge is cut away, a concave one gets material added. Both kinds in one feature, as long as no convex and concave edge of it meet at a vertex.
- **Several edges** in one feature, of one body, with one size; their tools are united and applied together. Two edges of the feature that meet at a vertex at the same angle β end in their mitre, at a convex corner of a loop as at a reflex one; at different angles, two convex straight edges at a convex corner each end in the plane of the other's face; three that meet leave a crease (three fillets), or meet exactly (three chamfers).
- **The ends of an edge**: at another edge of the feature (smoothly, in their mitre, or in the plane of the other's face, as above); at a planar face that meets the edge (the tool ends in its plane: a box, a step, a tilted end); smoothly into the next edge, also across a seam of two pairs of flush faces (the tool ends across the edge; the next edge must be in the feature). An edge cut into pieces by an earlier feature gets a tool per piece, when the pieces need the same blend.
- A chamfer with **one distance** along both faces; a fillet with **one radius**. Both numeric fields with expressions.
- **Faces**: one new face per edge, named by the feature and the place of the edge in the list (`{ feature, role: 'chamfer' | 'fillet', edge }`); exact surfaces (a plane or a cone for a chamfer, a cylinder or a torus for a fillet); the faces next to the edge keep their names; what the tool leaves in the plane of a face at an end becomes part of that face.
- **Refusals the user can see**: an edge of another kind, an end the tool cannot stop at, half a chain, a size that does not fit; each names the edge.

**Deferred:**

- A chamfer by two distances or by a distance and an angle; a variable radius; a fillet whose cross-section is not circular (a conic, a curvature-continuous blend).
- A ball patch (a setback) where three fillets meet; a smooth vertex where a convex and a concave edge meet.
- Edges of the kind `other` (a cylinder meeting a cylinder, a plane along a cylinder, teeth), a circle with a sphere or a torus (the rim of a dome, the edge of a fillet made earlier by the sketch on a turned part), an arc that ends at a face not through its axis, an edge whose end has two faces besides its own that are not a flush seam, an edge whose pieces need different blends; two edges of the feature that meet at a vertex at different angles anywhere but at a convex corner of convex straight edges; an arc that meets another edge of the feature at an angle, not smoothly (the top loop of a D-shaped boss).
- Following a tangent chain without naming it (the feature refuses half a chain and names the rest, see "Open", 2).
- A pattern of a chamfer or a fillet (it leaves no tool a pattern could place elsewhere; a pattern of the body copies them).
- The tangent edges of a straight fillet as lines (a plane that touches a cylinder along it is `other` today).

## Document

**The features** (contract.ts, `ChamferFeature`, `FilletFeature`). Each is a module of its own (`features/chamfer.ts`, `features/fillet.ts`) over one shared helper (`features/edge-blend.ts`), validated by the validators of today:

- `body`: a body of an earlier feature (`requireRef` of the kind `body` at `body`).
- `edges`: a list of at least one edge name (`edgeName` of validation.ts, which gives the canonical order), each face of it checked by `requireFace` as the edge of a projection is (the feature names faces and lies before this one; the tags of copies name patterns). No edge twice (by `edgeKey`), with the index in the message. Whether the edge is on the body, and of what kind, is a matter of the recompute, as for a projected edge.
- `distance` (chamfer, numeric field `distance`, mm, above 0) and `radius` (fillet, field `radius`, mm, above 0). No upper bound: whether it fits is known in the recompute.
- The patch: `body`, `edges`, and the size, merged by the rules of `updateFeature`; `edges` is a list and is replaced whole. Nothing is removable with `null`.
- `refs`: the body at `body`, the faces of every edge at `edges/<i>/a` and `edges/<i>/b` (`faceRefs`), so removing the feature that made a face is refused as for a projection.
- What the registry asks: `createsBody` false (the body keeps its ID), `namesFaces` true, `producesTool` false, no `bodySource`, `info.bodies: 'none'`.

**Two types, not one.** A chamfer and a fillet are the two words an AI and every CAD system use, with a field each; a change from one to the other makes another surface, so its faces would get other names anyway (rejected alternative 7).

**Face roles** (face-roles.ts, `FaceName` in types.ts): `chamfer` and `fillet`, each with the field `edge`, a whole number: the place of the edge in `edges`, from 0. The key is `<feature>/fillet/2`. A fillet of four edges has four faces, one per edge, whatever the pieces of the edge. The names are stable through a recompute and through a change of the size; changing the list renames the faces of the edges that moved in it ("Known limits"; rejected alternative 8).

**Schema.** No step. A build without this package refuses a feature of a type it does not know and a face name in a role it does not know, by the validators of today ([api.md](../../architecture/api.md), "load"); nothing is added that an older build would keep and drop.

## Recompute

The step is one function for both types (`blendStep` in `recompute/edge-blend.ts`), given the kind, the feature, the body, the edges and the size. The first problem is the error of the feature; a feature in error changes nothing.

1. **The body.** `state.bodies[body]`, else `brokenReference` with the body in `refs`. With 3b in the tree, an imported body is `importedTarget`. Its faces and edges: `analyzeBody(solid, faceNames, faceInfos, chordTolerance)` (4a passes the chord tolerance).
2. **The edges.** Each by `edgeKey` in `BodyData.edges`, else `brokenReference` with the edge in `refs`.
3. **The kind.** A `line` whose two faces are planar is straight; a `circle` whose two faces are each a plane, a cylinder or a cone about the axis of the circle is circular (its circle is the one `circleBetween` gave the edge). Anything else is `unsupportedEdge` with the edge in `refs` and the detail naming the kind of the edge and the surfaces of its faces.
4. **The pieces.** The segments of the edge chained by their common points (within the precision of the coordinates, `coordinatePrecision` of mesh-distance.ts). A straight edge may have several pieces (an earlier cut through it); each gets a tool. A circular edge is a whole circle (a closed chain) or arcs; an arc runs from the angle of its first point by the signed angle of the chain about the axis. A whole circle starts at a fixed direction, not at a point of the mesh: the model's X projected into the plane across the axis (its Y where the axis is within 0.1 rad of X), so that the mesh of the tool, and a planar chamfer's frame (4a: the origin and Y at the start of the turn), do not depend on the order of the segments.
5. **The corner.** Per piece, in the plane across a straight edge or in the half plane through the axis of a circular one (coordinates `(ρ, z)`, ρ from the axis, z along it):
   - *The directions along the faces.* For a plane across a straight edge `d × n`, for a circular edge the direction of the face's line in the half plane (across the axis for a plane, along it for a cylinder, along the generator for a cone): exact, from `FaceInfo`. Only its sign comes from the mesh: from the triangles of the face along the segments of the piece, each of whose inside lies on the left of its side `i → j` (`n × (pⱼ − pᵢ)`, n the normal of the triangle), each vector made a unit vector and carried into the coordinates of the corner (for a straight edge it lies in the plane across it already; for an arc it is carried into the `(ρ, z)` of the half plane through the midpoint of its segment, since in 3D the vectors along a whole circle turn and cancel), and summed weighted by the area of the triangle (one triangle can be a sliver of a boolean with an unreliable normal, as [naming.md](../../architecture/naming.md) says of the way out of a face). A sum whose projection on the exact direction is less than half its length, or triangles that disagree in sign beyond that weight, is `unsupportedEdge` ("the side of a face along the edge is not clear"). A centroid or a third vertex is no use: a disc has every vertex on its rim, and a face around a hole reaches back past the axis ("Measured", the bugs of the prototype).
   - *The wedge.* The angle β between the two directions. Within `BLEND_MIN_ANGLE` (0.01 rad) of 0 or of π is `unsupportedEdge` ("the faces meet at too sharp or too flat an angle").
   - *Convex or concave.* Convex when the wedge holds the material: the direction along `b` points to the inside of `a` (against the outward normal of `a`, summed over the same triangles in the same coordinates). Convex is cut, concave is added.
   - *One blend per edge.* The pieces of an edge have to agree in the side of each face and so in convexity and β (the same sides of the same surfaces give the same β, and they then lie on one plane, cylinder, cone or torus); pieces that do not (one face name on material of both sides, after a union of a body with parts of itself) are `unsupportedEdge` ("the pieces of the edge need different chamfers"). So one face, one surface and one pair of facts per edge.
6. **The ends** of every piece that is not a whole circle. At each end point P, in this order:
   - *Another edge of the feature ends at P and shares a face F with this one*, and no third one does, and the two are both convex or both concave (else 7). u and v are the unit directions away from P along the two edges (along the tangent of an arc); G₁ and G₂ the faces of the two edges other than F.
     - *Smoothly* (u = −v, and G₁ continues G₂: their normals at P parallel, both within `ANGLE_TOLERANCE`): both tools end in the plane across them at P (the half plane through the axis for an arc). Two edges of a smooth chain meet so. Collinear edges whose faces G differ (a riser between them) are not smooth and fall to the rules below.
     - *Both straight, at the same angle β* (within `ANGLE_TOLERANCE`): both end in their **mitre**, the plane through P whose normal is `u − v`, which halves the angle of the two edges in F. Reflected in that plane, one corner is the other, so the two tools meet exactly in it, at a convex corner of F as at a reflex one. At a reflex corner (an L-shaped outline, the floor loop of a cavity) the plane of the other face leaves the corner between the two planes uncut, and the adapter refused some shapes, where the mitre leaves nothing ("Measured", F).
     - *Both straight, at different angles, both convex, at a convex corner of F* (the angle of F at P, inside F, less than π): each tool ends in the plane of the other edge's G, which is where their blends meet ("Measured", H: the mitre leaves a step there). The body lies inside both planes there, so cutting the tools short at them takes only air.
     - Each of these planes has to cross its edge at more than `BLEND_MIN_ANGLE`, as a planar end below (a very sharp corner of F), else `unsupportedEdge`.
     - *Anything else* (different angles at a reflex corner or between concave edges; an arc at an angle to another edge, which no rule can end: a revolve ends only in half planes through its axis, the line's prism would have to end in the arc's round face, and two arcs that share a round face are coaxial and never meet at an angle): `unsupportedEdge` with both edges, "the two edges meet at a vertex in a way this feature cannot join; chamfer or fillet them in two features".
   - Otherwise, the faces other than `a` and `b` that have an edge with `a` or with `b` with a segment ending at P (within the precision of the coordinates). Three or more edges of the feature at P (the corner of a box with its three edges) take this way too: when all of them are convex (or all concave) the body (or the air) lies inside the planes of the faces at the corner, so the tools cut short at them take nothing they should not, at any angles; measured at the convex corners of a box ("Measured", D):
   - *One planar face C*, not continuing `a` or `b`: the tool ends in its plane. For a straight piece the plane has to cross the edge at more than `BLEND_MIN_ANGLE`; for an arc it has to hold the axis (the cap of a partial revolve, a split through the axis): the tool ends in that half plane. Otherwise `unsupportedEdge`.
   - *One face C that continues `a` or `b`* (its normal at P parallel to the face's within `ANGLE_TOLERANCE`: a coplanar plane, or a round face tangent to it, such as the round corner of an outline): a **smooth end**. The tool ends in the plane across the edge at P (for an arc, the half plane through the axis and P). The edge of C with the other face of the edge (`b` when C continues `a`) is the continuation and has to be in the feature: otherwise `unsupportedEdge` with both edges in `refs` and the detail "the edge continues smoothly into the second edge in refs; add it to this feature" ("Measured", E: half a chain leaves a step the size of the profile at each end).
   - *Two faces, C_a continuing `a` and C_b continuing `b`*: a **seam** of flush faces (a block added flush with two faces of the body, the two halves of a mirror joined by 3d): a smooth end whose continuation is the edge (C_a, C_b), on the same terms.
   - *Anything else* (no face, two or more faces that are not a seam, a round face that continues neither): `unsupportedEdge`, the faces in the detail.
7. **Mixed vertices**, checked before the pairs of 6. When an end point of a convex piece is an end point of a concave piece of the feature: `unsupportedEdge` with both edges, the detail "a convex and a concave edge meet at a vertex; chamfer or fillet them in two features" ("Measured", D: in either order the overshoot of one tool is left in the result).
8. **The profile** (`blendProfile`) in the corner of the two directions (the corner at the origin, `a` along the first axis):
   - *The blend.* A chamfer: the line between the points at `distance` along each face. A fillet: the arc of `radius` tangent to both, its centre on the bisector at `radius / sin(β/2)`, the points of touching at the **setback** `radius / tan(β/2)` along each face, divided for **half** the chord tolerance (the rule of an arc, `segments` of sketch.ts), as 4a divides a profile.
   - *The lift.* An end of the blend that lies on a **round** face is moved off it, away from the wedge, until it is `BLEND_LIFT` (1.5) × the chord tolerance from the face; an end on a plane stays exactly on it ("Measured", C: without the lift 7.5 % of the edges on round faces are refused by the adapter and most leave a ledge; with it none; a small lift on a plane makes it worse). A chamfer's end moves **along the chamfer's own line**, past the face (by 1.5 × the chord tolerance / sin((π − β)/2) along it: 2.1 × at a right angle, 15 × at β = π − 0.2; still 1.5 × from the face, within the overshoot), so the surface the mesh lies on is the published one exactly (a chamfer of a circular edge may be a plane across the axis, which a sketch can stand on); a fillet's end moves along the normal of the face, and its last chord leaves the torus by at most that much ("Measured", C and G: both the same, 0 refused).
   - *The overshoot.* From each end of the blend the profile goes away from the wedge, across the face, and round the corner to the other face: the corner point lies that far from both faces. Past a convex edge (outside the body) by `max(size, BLEND_OVERSHOOT × chordTolerance)` (4 ×; `size` the distance or the radius); past a concave edge (into the body) by `BLEND_OVERSHOOT × chordTolerance` only, so that a thin wall behind the corner is not pierced (a fillet of 2.5 in the corner of walls 2 thick is refused with the overshoot of the size, and fits with 0.04, "Measured", F and G). So the tool lies on neither face ("Measured", A, B and C).
   - *The axis.* For a circular edge the blend has to stay off the axis (every point of it farther than `LENGTH_TOLERANCE`): a setback that reaches the axis (a fillet of a convex rim at least its radius, the floor of a narrow blind hole) is `blendDoesNotFit` with the detail "reaches the axis of the circular edge". An overshoot that goes towards the axis is shortened so that no point of it comes nearer to the axis than half the nearest point of the blend. The centre of a fillet's arc may still lie on or across the axis while the arc does not (two cones meeting at a wide angle near the axis): 4a's rule then makes the face a sphere or a torus with a negative major radius, as for any revolved arc.
   - *The size of the tools.* The triangles of all the tools of the feature together, counted before they are built (a revolve: the `triangles` of its `RevolveSetup`, two per side of the profile per step and the caps of a partial turn; a prism: two per side of the profile and its two caps), and the parts inside the wedges of the volume check, which are built too, above 4a's `MAX_REVOLVE_TRIANGLES` (1 000 000) is `blendDoesNotFit` with the count and "the tools would have too many triangles; raise the chord tolerance of the document or split the feature" (`MESSAGE` of `blendDoesNotFit` says a blend does not fit, its detail the reason).
   - *Short pieces.* For a straight piece, where the two end planes would cross within the profile (a piece shorter than the slant of its ends), `blendDoesNotFit` "the ends of the piece meet within the chamfer".
9. **The tools.** Every face of every tool gets a temporary number, from the number after the blends (`faceNames.length + edges.length`) up; no number is in two tools.
   - *A straight piece* (`edgePrism`, recompute/tool-edge.ts): the profile placed in the frame of the corner (its origin a point of the edge, X along `a`, Y across towards `b`, Z = X × Y along the edge), each vertex carried along Z to the plane of each end; the two ends triangulated by the kernel; the sides two triangles per side of the profile. Faces: the blend (all its sides one face), the overshoot faces, the two caps.
   - *A circular piece* (`blendRevolveSetup` and `buildRevolve` of 4a): the profile carried from the coordinates of the corner into `(ρ, z)` by the place of the corner (the edge's point `(R, z₀)`, the direction of face `a` and the unit direction across it towards `b`, both in `(ρ, z)`; where those two are a left-handed pair the carrying mirrors the profile, so its points are reversed and its keys shifted to keep it counter-clockwise, as a `Region` must be), with its exact blend carried the same way, as the one region of a `RevolveSetup` in a frame whose origin is the centre of the circle, X the radial direction at the start of the piece, Y the axis; a whole turn (`full`) or the arc (`{ type: 'angle', start, angle }`, whose caps are the two ends). The steps by 4a's rule (half the chord tolerance at the largest radius of the profile). The sides named through `sideOf`: the blend's line or arc with its exact shape (the chamfer's line, the fillet's circle), so that 4a computes its surface by its rules: a cone, a cylinder or a plane across the axis for a chamfer; a torus (its major radius signed) or a sphere for a fillet.
10. **The booleans.** The cut tools united by `kernel.boolean('union')` one after another, the result subtracted from the body; then the add tools united and joined to it ("Measured", D: united and one by one give the same volumes to the last digit, and on bodies of a few hundred triangles about the same time; one boolean per tool with a large body would cost the adapter's return of moved faces each time, which ports.md measured at seconds on a plate of 19 000 triangles, so the tools are united first: "To verify"). An exception of the kernel is `kernelFailure` with the message.
11. **The renumbering** of the result, triangle by triangle, after the checks of 12, which see the temporary numbers of each piece:
    - the blend of every piece of edge i: number `faceNames.length + i`;
    - a cap at a planar end: the number of the face C (what the tool leaves there lies in the plane of C and is C extended: the riser of a step, the end faces of an added fillet, "Measured", A);
    - a cap at a smooth end, at a mitre, or in the plane of the other edge's G at a corner of two edges: the blend of its edge when it is no more than the step the lift leaves where a lifted tool meets one that is not, `BLEND_LIFT` × the chord tolerance × (the size + the overshoot of the edge) in mm²; more is the error below. That step does not grow with the length of the piece but with the size and the tolerance: between the tools of a chain of fillets 10⁻³ to 1.5·10⁻² mm² at sizes 1.5 to 4 and tolerances 0.01 and 0.05, at most 0.08 of this bound (a reviewer's probe, the third round; chamfers, lifted along their line, leave nothing); the steps of H at different angles, 1.5 to 3.7 mm² at size 3, are 16 to 40 times above it;
    - the overshoot faces: the blend of their edge when what is left of them is a sliver, at most `BLEND_SLIVER` (10⁻⁴ mm² per mm of the edge's length); more is the error below.
12. **The checks**, on the result before the renumbering (11 runs after them), each `blendDoesNotFit` with the edge (and the face) in `refs` but the second, **per piece**:
    - the blend of every piece has a triangle and an edge with face `a` and an edge with face `b` in the result (a fillet of 25 on a side 20 high loses the side; per piece, since one piece where the faces survive would hide another where a face is gone: a reviewer's probe of two pieces 10 and 1 thick, chamfered by 2);
    - no cap at a smooth end, a mitre or a corner of two edges left beyond its bound in 11 (two tools that do not meet: `unsupportedEdge` with both edges, "the two edges meet at a vertex in a way this feature cannot join");
    - no overshoot face left beyond the sliver (the tool reached material it must not: a boss whose foot ring hangs over the edge of the plate, a slot narrower than the size next to a convex edge);
    - **the volume**, of the cut and of the added material each: what the feature cut (added) is at most the volume of the union of the parts of its cut (add) tools inside their wedges, plus `BLEND_VOLUME` (0.5) × the chord tolerance × the area of the strips of the faces the blends eat (twice the setback times the length of each piece), plus 10⁻³ mm³. The part inside the wedge is the profile closed along the two faces instead of past them, with the same ends, built like the tool, united like the tools and only measured; their union and not their sum, since parts that meet at a corner overlap (a reviewer's probe: three chamfers of 3 at a corner of a cube, parts 270 mm³ summed and 249.75 united, swallowed a separate cube of 8 mm³ within the sum). So material the overshoot swallowed whole (a small piece of the body, a thin fin) is found although it leaves no face of the tool (a reviewer's probe: a piece of 1 mm³ inside the overshoot of a chamfer of 2 left every face as it should be). Measured with single edges ("Measured", G): the volume cut exceeded the part in the wedge by at most 0.28 of this bound; on planes, too, by up to 0.009 mm³ (a chamfer of 0.81), so the strips of planar faces stay in the bound.
13. **The result.** The body under its ID; the face table with one face per edge appended (`withFaces`), in the order of `edges`; the facts. The temporary numbers never enter the table.

**The facts**, for the AI to check what it asked for: `setback/<i>` (mm: how far from edge i the chamfer or fillet meets each of its faces, the distance of a chamfer, `radius / tan(β/2)` of a fillet) and `cut/<i>` (true where material was cut, false where it was added).

## Faces

| Edge | Chamfer face | Fillet face |
|---|---|---|
| straight | a **plane** through the two lines where the chamfer meets the faces | a **cylinder** about the line of the centres of the arc, of the radius |
| circular | the line of the chamfer turned about the axis: a **cone** (apex where the line meets the axis), or a plane across the axis or a cylinder where the line is across or along it, by 4a's rule of the move of the ends | the arc turned: a **torus** about the axis, minor radius the radius, major radius the distance of the arc's centre from the axis, signed by 4a's rule (negative when the centre lies across the axis, which a fillet between two cones at a wide angle near the axis can do); a **sphere** when the centre lies on the axis |

The surfaces are exact. The mesh of a chamfer lies on its surface; that of a fillet is within the chord tolerance of it but for its ends on a round face, which the lift moves off it by up to 1.5 × the chord tolerance ("Known limits").

**A sketch on a chamfer** of a straight edge (a plane): origin where the chamfer meets the first face of the edge (`a` of its name), at the end of the edge that its projection calls `a` (the smaller parameter along `n_a × n_b`, [naming.md](../../architecture/naming.md), "Hrany"); Y along the edge in that direction; the normal out of the body; X = Y × N. So a sketch on a chamfer reads along the edge as a projection of the edge does.

**Edges of the result.**

| Pair | Kind |
|---|---|
| a chamfer with its faces, a straight edge | `line` |
| a chamfer cone with a plane across the axis, a cylinder or a cone about it | `circle` |
| a fillet cylinder with its faces | `other` (a plane touching a cylinder along a line; "Known limits") |
| a fillet torus with its faces | `circle` (4a: a torus and a plane, cylinder or cone that touch it meet in one circle, tested on the distance) |
| a blend of a straight edge with a planar end face across the edge | `line` (chamfer), `circle` (fillet: a plane across the cylinder) |
| a blend of a straight edge with an end face at a slant, or with the blend of the next edge at a mitre | `line` (chamfer), `other` (fillet: an ellipse, or two cylinders) |
| a blend of an arc with a plane through its axis at its end | `other` (a cone or a torus cut along its generator: a line or a circle off the axis, which `circlesBetween` gives for a torus and a plane through its axis, so a fillet's is a `circle`) |
| two blends of a smooth chain (a chamfer plane with a cone, a fillet cylinder with a torus) | `other` |
| two blends of straight edges at a mitre or at a corner in the plane of the other's face | `line` (chamfers), `other` (fillets) |

**What the faces next to the edge become.** They keep their names and shrink by the setback. An end face C keeps its name and, at a concave end, grows by what the tool left in its plane.

## Issue codes

Two errors:

- `unsupportedEdge`: the edge cannot be chamfered or filleted. `refs` the edge, and a second edge where the reason is a pair; the detail says which: its kind or the surfaces of its faces; the faces meet at too sharp or too flat an angle; the side of a face along the edge is not clear; the pieces of the edge need different chamfers; an end has no face, several faces that are not a seam, or a round face that does not continue a face of the edge, or (an arc) a plane not through its axis, or (a straight edge) a plane nearly along it; the edge continues smoothly into an edge that is not in the feature (named); a convex and a concave edge of the feature meet at a vertex; it meets another edge of the feature at a vertex in a way the feature cannot join (an arc at an angle, different angles at a reflex corner), or their two tools leave a step there.
- `blendDoesNotFit`: the chamfer or fillet does not fit. `refs` the edge and the face concerned; the detail says which: a face next to the edge would vanish; the blend would vanish; the tool reached material it must not touch (next to a convex edge within the size outside its faces, or a hollow next to a concave one), seen in a face of the tool left or in the volume; it reaches the axis of a circular edge; the ends of a straight piece meet within it; the tools would have more triangles than 4a's limit.

`MESSAGE.unsupportedEdge`: "The edge cannot be chamfered or filleted: only a straight edge between two planes and a circular edge between a plane, a cylinder or a cone about one axis can, ending at one face, meeting another edge of the same feature at a vertex, or running on smoothly into an edge of the same feature." `MESSAGE.blendDoesNotFit`: "The chamfer or fillet does not fit on the faces next to the edge: a face would vanish, or the tool reaches material it must not touch." The other codes are those of today: `brokenReference`, `invalidExpression`, `kernelFailure`; with 3b, `importedTarget`.

## Where the code lives

| File | What |
|---|---|
| `features/chamfer.ts`, `features/fillet.ts` | The modules: validator, references, the patch, the step (a call of `blendStep`) |
| `features/edge-blend.ts` | What the two validators share: the body, the list of edges, no edge twice, the references |
| `features/index.ts` | Two lines in `FEATURE_TYPES` |
| `recompute/edge-blend.ts` | `blendStep`: the edges, the pieces, the corner, the ends, the profile, the booleans, the renumbering, the checks, the facts |
| `recompute/tool-edge.ts` | `blendProfile`, `edgePrism`, `blendRevolveSetup`, the parts inside the wedges for the volume check |
| `types.ts` | `ChamferFeature`, `FilletFeature` and their patches, the two members of `FaceName`, the two codes; the comments of `FaceName` and `Surface` |
| `face-roles.ts` | Two entries |
| `recompute/services.ts` | The two texts of `MESSAGE` |
| `solid.ts` | `normalAt(info, point)` of a surface (for a smooth end); `EdgeData` keeps, per segment, the indices of its vertices and the triangle of each face along it (for the side of a face), internal |
| app: `features/draft.ts`, `app.ts` | `picks` with `edges` and `before`; `view()` answers the state before the feature for a draft that asks for it while picking |
| `sketch-tools.ts` | Nothing: a chamfer and a fillet have no profile (`PROFILE_SOURCES` is typed over the types; their line answers none) |

The imports go one way, as `modules.test.ts` guards: the two modules import `features/edge-blend.ts` and `recompute/`, never each other and never the registry.

## The app and MCP

**The app.**

- `FEATURE_UI.chamfer` and `FEATURE_UI.fillet` (`features/chamfer.ts`, `features/fillet.ts` of the app, over a shared `features/edge-picker.ts`), and two buttons in `TOOLBAR` after the hole.
- The form: the edges are picked in the view, from the body **as it is before the feature**. A preview has the edges of the result, where a picked edge is gone and the new ones belong to the draft, so picking runs while a button *Pick edges* is armed, as the extrusion's *Pick* is: while it is armed, the view shows the state before the feature (`App.view()` answers `stateBefore(index)` for a draft that asks for it: `FeatureForm.picks` gets `edges?: true` and `before?: true`, and `pick` reads the state the view shows), the picked edges are drawn over it (`overlay`), a click on an edge adds it and a click on a picked one removes it. Disarmed, the view shows the preview. The first pick sets the body; an edge of another body, or of a kind other than `line` and `circle`, is refused at the click with a line in the status bar (the engine decides the rest, and its error shows as for every feature). The panel lists the picked edges (the labels of their faces, the kind) with a button to remove each, and the size (*Distance* or *Radius*, mm, an expression as in every field). Removing an edge from the middle of the list renames the faces of the edges after it; the form says so when the feature is being edited and a later feature names such a face.
- The model panel: "Fillet of 4 edges of box, radius 2", and the setbacks of the facts.
- `ownsFace`: the faces of the two roles with the feature's ID.
- The labels of the roles (`ROLES` of issue-text.ts, typed by the union, so the compiler asks for them) and of the codes; the texts that name an edge in `refs` print it by the labels of its faces.
- `docs/ui/chamfer-fillet.md`, a file of its own; `docs/ui.md` its row.
- The snapshots of `app.test.ts` change by the toolbar; the commit says so.

**MCP.** No tool: the two types, the roles and the codes reach `describe_api` from `types.ts`. `api.ts` gets a paragraph after the revolve: the edges are named by their two faces as the query `body` lists them; which edges can be (straight between planes, circular between a plane, a cylinder and a cone about one axis); a smooth chain goes into one feature and the error names what is missing; convex and concave edges meeting at a vertex go into two features; the faces `{ feature, role, edge }` by the place in the list; the facts `setback/<i>` and `cut/<i>`; the two codes.

**The documents of the architecture** at the implementation: `docs/architecture/edge-blend.md`, a file of its own with its row in `docs/architecture.md`; `naming.md` (the two roles, the frame of a sketch on a chamfer, the edges of the result, a cap renumbered into an end face); `ports.md` (the tools that reach past the faces and the lift, as what the adapter was measured with, in its list of tested tools: "Zkoušené nástroje jsou hranoly … a válce").

## Shared vocabulary

- **Takes:** `analyzeBody` with its edges and their segments, `FaceInfo` and `surfaceOf`, `edgeKey` and `faceKey`, `withFaces`, `MESSAGE`; from 4a `buildRevolve` with `RevolveSetup`, the torus, `circleBetween` with the points of an edge and `State.chordTolerance`; from 3d the precondition of the kernel port; `coordinatePrecision`; `segments` of sketch.ts; the edge picking of the view (`ViewPick` of the kind `edge`).
- **Adds:** the feature types `chamfer` and `fillet`, the roles `chamfer` and `fillet`, the codes `unsupportedEdge` and `blendDoesNotFit`, `normalAt` of a surface, `picks.edges` of a feature form.

## Measured

All in the session scratchpad, against the real kernel adapter (`packages/kernel-manifold`, `manifold-3d` 3.5.5) and bodies made by the engine of `master` at `b4c2a86` with the real adapters; nothing in the repository was changed. The prototype (about 300 lines: the corner profile, a prism between two planes, the revolve of 4a's prototype, the reading of an edge from a body of the engine) and the spikes ran by vitest with a configuration of their own whose root is the worktree. The chord tolerance is 0.01 throughout; the arc of a fillet is divided for 0.005. "Exact" is the volume of the corner's exact region (straight edges, perpendicular ends) or that of Pappus (circular edges).

**A. Straight edges**, a box 60 × 40 × 20 and profiles extruded along Y: the tool with its legs **on** the two faces ("on") and **past** them by 1 ("past"), both with the ends of the blend exactly on the faces.

| Edge | Size | Variant | Volume taken (exact) | Left of the tool besides the blend |
|---|---|---|---|---|
| top-front of the box (90°, ends at the sides) | chamfer 3 | on, past | 270.000 (270) | nothing |
| the same | fillet 4 | on, past | 207.23 (206.02, +5.9·10⁻³: the polygon of the arc) | nothing |
| the same | fillet 0.5 / 10 / 19.9 | on, past | +4.2·10⁻² / +2.4·10⁻³ / +1.2·10⁻³ | nothing |
| the same | fillet 25 (the side is 20 high) | on, past | | the front face is **lost** |
| the inner corner of an L (concave, ends at the two sides) | chamfer 3, fillet 4 | on | added 180.000 (180), 138.15 (137.35) | the caps, 4.5 and 3.45 mm², in the planes of the sides |
| the same | | past | the same | the caps, 11.5 and 12.5 mm²: the overshoot in the plane of a side takes the side's name there |
| a step: the low top-front edge, ending at the riser | chamfer 3, fillet 4 | on, past | 135.000 (135), 103.61 | the cap at the riser, 4.5 and 3.45 mm² |
| the concave edge at the foot of the riser | chamfer 3, fillet 4 | on, past | 180.000, 138.15 | the caps in the planes of the sides |
| a block with a tilted end, top-front edge | chamfer 3 | on, past | 272.25 (the triangle times the mean length 60.5) | nothing |
| its tilted edge (116.6°) | chamfer 3, fillet 4 | on, past | 160.997 (exact), 41.76 (41.25) | nothing |

Every boolean was accepted, in 1 to 80 ms. So a tool may lie on planes or reach past them; what it leaves in the plane of an end face is that face extended.

**B. Circular edges**, a box with a hole of radius 5 through it, a boss of radius 8 and 10 high on it, a boss tapered by 0.3 rad (a cone), sizes 0.2 to 4.5, both variants, the ends exactly on the faces:

- **On**: the leg on the cylinder is a polygon of the tool on the polygon of the body (ports.md: "a round face of a tool on a round face of a body is not handled"). It is left in the result as a face of the tool over most of its height (25 of 31 mm² at the rim of the hole with a chamfer of 1), and the boolean is 5 to 15 times slower (115 to 1 700 ms against 13 to 220 ms past the faces).
- **Past**: the volumes within the polygons (the chamfer of 4.5 at the rim of the hole: 413.91 against 413.51, +9.5·10⁻⁴). But a ledge of the overshoot face is left at the end on the round face (0.01 to 0.24 mm²: the strip between the polygon of the body and the exact circle the tool's end stands on), and 3 of the 10 cases at the cone were refused (a folded triangle).

**C. The lift: a fuzz of single edges.** Random convex prisms of 3 to 6 sides turned and moved up to 400 mm from the origin (a top edge and a side edge each), and boxes with a tapered or straight boss and a tapered or straight blind hole (the rim and the foot of the boss, the rim and the bottom of the hole: planes with cylinders and cones, convex and concave), each with a random chamfer and fillet up to about 0.4 of what fits. All tools reach past the faces by `max(size, 0.04)`.

| Ends of the blend lifted off the faces by | Cases | Refused by the adapter |
|---|---|---|
| 0 | 352 | 32 (all at cones of tapered bosses and holes) |
| 10⁻⁴, 10⁻³, 2.5·10⁻³ on every face | 352 | 32, 29, 32 |
| 0.003 / 0.005 / 0.0075 / 0.01 / 0.015 / 0.02 on every face | 592 | 34 / 17 / 16 / 1 / 0 / 0 |
| 0.015 on round faces, and 10⁻⁴ / 10⁻³ / 0.005 on planes | 592 | 8 / 2 / 2 |
| **0.015 (1.5 × the chord tolerance) on round faces, 0 on planes** | **7 192** (five seeds: 592, 1 200 and three of 1 800) | **0** |
| 0 (two seeds) | 3 600 | 270 (7.5 %), and 1 457 with a ledge of 0.01 mm² or more |

With the rule in bold, a face of the tool other than the blend was left in 7 cases, each at the foot of a boss whose ring reached the edge of the box (the boss stands 10 to 20 mm from it and has a radius up to 10: the blend did not fit, and the overshoot inside the box came out of its side, 1.8 to 16 mm²); in every other case nothing was left. In 6 cases the profile reached the axis (the bottom of a tapered blind hole narrower than the setback). One case takes 15 to 35 ms. Why: the polygon of a round face lies up to the chord tolerance inside its surface, so a tool whose end stands on the exact surface grazes the polygon; lifted past the deviation, the blend crosses every side of it at an angle. A plane is exact, so its end stays on it, and a lift near the tolerances of the adapter (10⁻⁴) makes a near-coincidence of its own.

**The overshoot.** The same fuzz with the overshoot fixed at 3, 4 and 10 × the chord tolerance instead of `max(size, 4 × tol)`: 2 400 cases each, refused 12, 6 and 0, and tool faces left, besides the two cases where the blend did not fit, in 28, 26 and 7 (caps and overshoot strips at prisms with slanted end faces). With `max(size, 4 × tol)` only those two.

**D. Several edges, corners.** All tools reach past the faces, lifted as in C; each tool ends in the plane of the face at its end (the mitre came with the reviews, F).

| Edges | Size | Volume, united / one by one | Left | The vertex nearest the corner of the box |
|---|---|---|---|---|
| the four top edges of the box | chamfer 3 | 47 136.000 / 47 136.000 | nothing | 1.000 c |
| the top and the four vertical edges | chamfer 3 | 46 821.000 / 46 821.000 | nothing | 0.866 c (the exact corner (c/2, c/2, c/2)) |
| all twelve | chamfer 3 | 46 002.000 / 46 002.000 | nothing | 0.866 c |
| the four top edges | fillet 4 | 47 334.016 / 47 334.016 | nothing | 0.4865 r (two fillets: the mitre) |
| the top and the vertical edges | fillet 4 | 47 092.317 / 47 092.317 | nothing | 0.5073 r (three: the crease; a ball would be at 0.732 r) |
| all twelve | fillet 4 | 46 460.939 / 46 460.939 | nothing | 0.5073 r |
| an L: the concave inner edge and two convex outer ones | chamfer 2, fillet 2 | 16 920.000, 16 965.305 / the same | the caps of the concave edge in the planes of the sides | |
| a step: two convex edges and a concave one meeting at a vertex | chamfer 2, fillet 2 | | the overshoot of a tool, 0.9 to 2 mm², in either order of cutting and adding | |

Times 2 to 250 ms (united) and 2 to 180 ms (one by one) on bodies of a few hundred triangles; on a large body the adapter's return of moved faces dominates every boolean (ports.md: 7.6 s for one boolean of a plate with 19 000 triangles), so the tools are united first.

**E. A chain of tangent edges.** The box 60 × 40 × 20 with round vertical corners of radius 6 (the fillet of the sketch, D52): the top loop of four lines and four arcs of 90°. Each line ends at the round face of a corner (smooth: the plane across the line), each arc at the faces of two lines (smooth: the half plane through the axis).

| Edges | Size | Accepted | Left |
|---|---|---|---|
| the whole loop | chamfer 1, fillet 2, fillet 5.9 | yes, in 114 to 361 ms | the caps of the lines where they meet the tools of the arcs, 10⁻³ to 7·10⁻³ mm² each |
| the four lines alone | the same | yes | the caps, 0.5 to 7.5 mm² each: the full profile as a step at each end of a line |

**F. Mitres, thin walls** (after the first round of reviews; a reviewer's probes first). Two edges of the feature that meet at a vertex, ending in the plane of the other edge's face ("plane") or in their mitre ("mitre"):

| Edges | Size | Plane: taken, left of the tools | Mitre: taken, left |
|---|---|---|---|
| an L-shaped outline extruded 20, the two top edges at its reflex corner | chamfer 3 | 315.000, two caps of 4.5 mm² (the corner between the two planes is not cut; with the mitre a CAD system takes 324) | 324.000, nothing |
| the same | fillet 3 | 136.237, two caps of 1.95 mm² | 138.858, nothing |
| the whole top loop of the L (five convex corners, one reflex) | chamfer 3, fillet 3 | 945.000, 415.068, caps at the reflex corner | 954.000, 417.689, nothing |
| the four top edges of the box (convex corners) | chamfer 3, fillet 4 | 864.000, 665.984, nothing | 864.000, 665.984, nothing |
| a pentagon with a reflex corner at 30° off square, its top loop | chamfer 2 | refused by the adapter (a folded triangle) | 342.278, nothing |
| the floor loop of a cavity with walls 2 thick (concave, convex corners of the loop seen from the cavity) | fillet 3, chamfer 3 | both refused by the adapter | 347.624, 792.000, nothing |

With the mitre the volume taken equals the sum of the parts of the tools inside their wedges to the last digit in every row. A concave fillet in the corner of an L whose plate and wall are 2 thick: with the overshoot of the size (2.5 and 4) the overshoot comes out of the back of the wall (20 to 320 mm² of the tool left, the reviewer's probe); with 0.04 (4 × the chord tolerance) nothing but the caps at the ends, which become the end faces (sizes 1, 1.9, 2.5 and 4). A reviewer's probe of a box with a block added flush on one side: at the far end of the top-front edge the faces are the block's top and front, two faces that continue the two of the edge (the seam of "Recompute", 6).

**G. The fuzz again, with the fixes of the first round** (seeds 1 and 11 of C, 3 592 edges each run): the chamfer's end lifted along its line, the overshoot past a concave edge 4 × the chord tolerance, and both together: 0 refused in each; tool faces left only where the blend did not fit (the 7 bosses of C), found as before; the profile reached the axis in 8. The volume check of "Recompute", 12 on the last of them: the largest difference between the volume taken and the parts inside the wedges was 0.228 and 0.281 of the bound, none over it.

**H. Two edges at different angles** (a reviewer's probe in the second round, checked again): a box whose end is tilted (β 90° and 116.6° at the two top edges of a corner) and one whose end is at 45° (90° and 135°), the two top edges at the convex corner of the top:

| Body, blend 3 | Plane of the other face: taken, left | Mitre: taken, left |
|---|---|---|
| tilted end, chamfer | 424.772, nothing | 423.716, a cap of 2.431 mm² |
| tilted end, fillet | 140.003, nothing | 138.900, a cap of 2.209 mm² |
| 45° end, chamfer | 394.483, nothing | 390.916, a cap of 3.728 mm² |
| 45° end, fillet | 125.705, nothing | 123.470, a cap of 2.592 mm² |

With the mitre the volume check would not have seen the step (less was taken than the parts in the wedges hold), so the caps are checked (Recompute 12). A second reviewer found the same with chamfers of 60° and 90° (1.48 mm² left).

**The bugs of the prototype**, kept because the design rests on their lesson: the side of a face first came from the third vertex of a triangle along the edge, then from its centroid. The first gave the wrong side at the rim of a boss, whose top is a disc with every vertex on the rim (the boss's chamfer took nothing); the second gave the wrong side at the round corners of the box, whose top is triangulated across the whole box, so the centroid lay past the axis of the corner. The left of a directed side of the triangle is right in every case, and only the sign is taken from it.

## Rejected alternatives

1. **The tool on the faces** (its legs in the planes or on the round faces of the edge). Fine on planes, wrong on round ones: a polygon of the tool on the polygon of the body is left in the result and is slow ("Measured", B). One construction past the faces serves both.
2. **The ends of the blend exactly on round faces.** 7.5 % refused and ledges in the rest ("Measured", C).
3. **A lift on planes too.** 0 is the best there; small lifts are worse ("Measured", C).
4. **A Minkowski sum or a rounding of the whole body.** Not selective, and every face loses its name (backlog).
5. **Moving vertices of the mesh** (cutting the corner in the mesh itself). No exact face would come of it, and the mesh of an edge is whatever earlier booleans left.
6. **A ball patch where three fillets meet.** A spherical triangle bounded by the three cylinders' ends needs a tool of its own per vertex and the vertices found and classified; deferred. The crease is measured (0.225 r proud of the ball) and stated.
7. **One feature type with a variant** (`edgeBlend` with `shape: 'chamfer' | 'fillet'`). Two types are what an AI says; a change of the shape renames the faces anyway.
8. **Names by an ID per edge** (`edges: { id, edge }[]`), or by the key of the edge as a text field. An ID per edge is a second name for the AI to invent; the key of an edge holds slashes and the tags of copies of two faces, against the rule of `FACE_ROLES` (one free text field, keys unambiguous). The place in the list is stable through every recompute.
9. **Tools applied one by one.** The same result ("Measured", D), but a boolean with the whole body per edge.
10. **Following a tangent chain by itself** (Fusion's default). The edges of a chain are known at the recompute, so the feature could add them; but then the feature would change what it rounds when the model changes (an arc that becomes a sharp corner after a parameter), silently. Naming the missing edge is explicit and cheap for an AI ("Open", 2).
11. **A cap of a tool as a face of its own** (`chamferEnd`). What it leaves lies in the plane of the end face and is that face; a name of its own would split one plane into two faces and make the edge between them `coplanar`.
12. **The kernel's own rounding** (none exists in Manifold for selected edges), or a library: not needed, and D2.
13. **Two edges that meet ending in the plane of the other's face, always; or in their mitre, always.** The plane of the other's face is right at a convex corner, wrong at a reflex one: the corner between the two planes is left, and the adapter refused some shapes ("Measured", F). The mitre is right at both when the two edges meet the shared face at the same angle, and leaves a step when they do not (H). So the mitre for the same angle, the plane at a convex corner otherwise, a refusal for the rest.
14. **The overshoot of the size past a concave edge.** It pierces a wall thinner than the size behind the corner ("Measured", F); 4 × the chord tolerance clears the polygons of the faces and refused nothing (G). Past a convex edge the size stays: smaller fixed overshoots left caps and strips at prisms with slanted ends ("Measured", C).
15. **One lift along the normal for a chamfer too.** It tilts the chamfer off its published surface (a planar chamfer of a circular edge by 1.5 × tol / √2, where a sketch stands on the published plane); along the chamfer's line the end clears the face as well and the surface stays exact (G).
16. **Lifting by a constant of the adapter's tolerances.** The deviation to clear is that of the polygons of the round faces, the chord tolerance of the document; a lift in units of the size of the model would be either too small for coarse tolerances or too large for fine ones.

## Known limits

- Three or more fillets at a vertex meet in creases: the corner stands 0.225 r proud of a rolling ball ("Measured", D). Three chamfers are exact.
- A convex and a concave edge that meet at a vertex go into two features; in one they are refused.
- A fillet on a round face ends up to 1.5 × the chord tolerance off it (the lift; a chamfer stays on its surface), and where a line on a plane meets an arc on a round face in a chain the two tools differ by that much: a step of that size in the blend at the joint.
- The overshoot past a convex edge reaches as far as the size beyond the faces; material within that (a slot narrower than the radius next to a convex edge, a piece of the body) refuses the feature, although the blend itself would fit.
- Two edges at different angles at a reflex corner, concave edges at different angles, and an arc that meets another edge of the feature at an angle, not smoothly (the top loop of a D-shaped boss), are refused; a mitre that is not a plane through the axis of an arc would need a revolve trimmed by a boolean.
- The volume check lets through material swallowed by the overshoot of less than its bound (0.5 × the chord tolerance × the strips: 10 mm³ for a chamfer of 5 on an edge of 200 at 0.01), and it is looser by the empty space inside the wedges.
- The pieces of one edge must need the same blend; a face name on material of both sides (3d's limit) can refuse an edge.
- The tangent edges of a straight fillet are `other`: not projected, and not edges a later chamfer or fillet can take; those of a fillet of a circular edge are circles.
- A fillet ending at a face at a slant meets it in an ellipse (`other`).
- Names by the place in the list: taking an edge out of the middle of the list renames the faces of the edges after it (a sketch on such a face then stands on another face, or breaks).
- A fillet of a convex rim whose setback reaches its axis is refused; so a fillet of the top loop of an outline cannot be larger than the radius of its round corners.
- Only edges of one body per feature; another body is another feature.
- An edge that ends at two faces besides its own (a vertex of four faces), or an arc that ends at a plane off its axis (a slot through the rim of a hole), is refused.
- A pattern does not repeat a chamfer or a fillet.
- The tool of a circular edge has the steps of a revolve at its largest radius (thousands of triangles for a fillet of 3 on a rim of 5); a loop of many such edges is slow.

## To verify before the implementation

- The fuzz of "Measured", C, as a test of the repository (with the constants of contract.ts), and further: 2 000 mm from the origin, chord tolerances of 0.001 and 0.05 (the lift is relative to it, the tolerances of the adapter to the size), tilted bodies (a plane of 5c or a body turned by a pattern), revolved bodies of 4a (cones, and tori at the ends of arcs: the normal of a torus for a smooth end).
- `BLEND_SLIVER`: the share left of overshoot faces in the cases that fit was 0 in every measured case; whether some fitting case leaves a sliver above it. The bound of the caps at joints at chord tolerances 0.001 and 0.05, with short lines between the arcs of a chain.
- `BLEND_VOLUME` far from the origin and at other chord tolerances; a probe of a piece of the body swallowed by the overshoot (the reviewer's 1 mm³ in the overshoot of a chamfer of 2 on an edge of 20: bound 0.4 mm³) and of a thin fin.
- The seam of flush faces with the tools of its two edges; three edges at a corner at different angles; the inner corner of a pocket with walls 2 thick, filleted along all its inner edges (three concave edges, the tools of the floor ending in the planes of the walls: the configuration the adapter refused in F, which would be `kernelFailure`, not a wrong body).
- Where the volume cut at a planar edge exceeds the part in the wedge (by up to 0.009 mm³ in G), and whether the strips of planar faces can then leave the bound.
- A fillet between two cones near the axis whose arc's centre lies on or across it (a sphere, a negative torus) through the build and the circles of its edges.
- The start of a whole circle (the model's X) gives the same mesh after a recompute that reorders the segments.
- Several edges with the lift: the chain where a line on a plane meets an arc on a round face (the step of the lift at the joint) on more shapes; a loop of a lid of scenario 12 with its holes.
- The time of the boolean on a body of scenario 12 (a few thousand triangles, faces flush at the ends) and on a body with many holes; whether uniting the tools is enough.
- The edges of the result: the circles of tori with planes, cylinders and cones by 4a's touching rule; the line of a chamfer with its faces; that a chamfer face carries a sketch with the frame stated.
- That the renumbering of a cap into an end face never gives one number two orientations on a plane (only a sliver could; `outward` reads the sum of normals).
- A piece of an edge whose two faces have material on the other sides than the rest of the edge (a face with material on both sides, 3d's limit): convexity decided per piece.

## Open

For the owner, each with the default the design takes:

1. **Three fillets at a corner give creases, not a ball.** *Is the crease (0.225 r proud of a rolling ball at a box corner) acceptable for now, with a ball patch deferred?* Default: yes.
2. **Tangent chains.** *Does a fillet of half a smooth chain refuse and name the edges to add (default), or add them by itself?*
3. **Names of the new faces by the place of the edge in the list.** *Is the index enough (default), or should every edge get an ID of the caller so that editing the list renames nothing?* Removing an edge from the middle of the list renames the faces of the edges after it; a later feature that names one then points at another blend, or at none (`brokenReference`).

## For the plan

- **4a**: 4b uses `buildRevolve` with a setup it makes itself (one region, its own frame and `sideOf`), the torus and the circles of touching; it needs 4a merged.
- **3d**: the precondition of the kernel port is kept (temporary numbers per tool face); `movedOutwards` moves every face 4b makes (the torus once 3d and 4a are both in).
- **3b**: a chamfer or fillet of an imported body is `importedTarget` (its one face has no edges of a kind 4b takes anyway).
- **5c**: a plane tilted about an edge (deferred there) would read the line of an edge as 4b does.
- **Scenario 12**: the lid's top loop and the box's bottom loop are chains of lines and arcs (the round corners of D52).

## Holes in the contract

- The pulley and the knob are 4a's (`calls.ts` of 4a); their surfaces are read through 4a's `StateD`. The query `body` and `measure` stay typed by 1b with the surfaces of today, so calls.ts reads the surfaces from `faceSurfaces` of the evaluation.
- The box of scenario 12 with its round corners is 2a's and 2d's; the fillets of 2d return their arcs (`FilletIds`), which calls.ts takes as an argument.
- `picks.edges` of a feature form is the app's and is not written in a contract.

## Tests the implementation owes

- Engine (`packages/engine/test`): the validators (no edge, an edge twice, a size of 0, a face of a later feature, the patch); `blendProfile` (the setback, the lift on a round face only, the overshoot, the axis); `edgePrism` (closed, facing outwards, ends in slanted planes); the side and convexity of a face along an edge (a disc, a face around a hole, a mirrored copy); the ends (a planar end, a smooth end with the continuation in the feature and without, a vertex of four faces, a plane along the edge, an arc ending at a plane through and off its axis); the renumbering; each detail of the two codes; `normalAt`; `modules.test.ts` with the new modules.
- Scenarios (`packages/scenarios/test`): `scenario14.test.ts` and `scenario12.test.ts` from [calls.ts](calls.ts); `edge-blend.test.ts` with the cases of "Measured", A, B, D and E as assertions; `edge-blend-fuzz.test.ts` (the fuzz of C, with `FUZZ_COUNT` as the kernel fuzz has it).
- App: the two forms in `app.test.ts` (snapshots), the edge picking, the list and its removal.
- MCP: `describe_api` names the two types, the roles and the two codes.

## Reviews

The design was written by Claude Opus 5.5. Each round has three reviewers with one brief, read-only, against the code of `master`: a fresh subagent on Claude Opus 5.5 (in place of Fable, owner, 2026-11-17), `codex` (gpt-6-astra, effort high) and `agy` (gemini-4-argon-high). Every finding was checked against the code or with a probe before it was taken.

### Round 1 (on commit `45b83ee`)

`agy` failed (HTTP 429, its quota spent until about 94 hours later); two reviewers. `codex`: 8 findings (6 major, 2 minor). The subagent: 11 (5 major, 6 minor), with probes of its own (the reflex corner, the cavity floor, the flush block, the thin wall). Both raised the volume, the pieces and the app's picking, so 16 distinct findings.

| # | Finding | Reviewer | Severity | Accepted? | What changed |
|---|---|---|---|---|---|
| 1 | Two edges meeting at a reflex corner end in the plane of the other's face, which leaves the corner between the planes uncut, and the adapter refuses some shapes (a pentagon, the floor loop of a cavity) | subagent | major | yes, measured (F) | Recompute 6: the mitre of two edges of the feature at a vertex; rejected alternative 13 |
| 2 | A block added flush with two faces of the body: the end has two faces, both continuing the edge's faces, and is refused | subagent | major | yes | Recompute 6: the seam, a smooth end whose continuation (C_a, C_b) is required |
| 3 | The overshoot of the size past a concave edge pierces a wall thinner than the size | subagent | major | yes, measured (F, G) | Recompute 8: 4 × the chord tolerance past a concave edge; contract `BLEND_OVERSHOOT`; rejected alternative 14 |
| 4 | The side of a face from one triangle trusts a sliver's normal | subagent | minor | yes | Recompute 5: the sum over the triangles along the piece, weighted by area; an unclear sum refuses |
| 5 | Picking edges on the preview picks edges of the result, where the picked edge is gone | codex, subagent | major | yes | The app: picking while *Pick edges* is armed, the view shows the state before the feature; a row in "Where the code lives" |
| 6 | Material swallowed whole by the overshoot (a small piece of the body) leaves no face of the tool, so nothing refuses | codex, subagent | major | yes, measured (G) | Recompute 12: the volume check against the parts of the tools inside their wedges; contract `BLEND_VOLUME` |
| 7 | Pieces of one edge may differ in convexity, so one face per edge and one pair of facts are not well defined | codex, subagent | major | yes | Recompute 5: the pieces must need one blend, else `unsupportedEdge` |
| 8 | `blendRevolveSetup` does not say how the profile gets from the coordinates of the corner into (ρ, z) | codex | major | yes | Recompute 9 and contract: `CornerPlace` |
| 9 | A lift along the normal tilts a chamfer off its published surface (a planar chamfer of a circle, where a sketch stands) | codex | major | yes, measured (G) | Recompute 8: a chamfer's end moves along its own line; contract `BLEND_LIFT`; rejected alternative 15 |
| 10 | The fillet's torus claims a positive major radius; 4a signs it and makes a sphere when the centre is on the axis | codex | minor | yes | Faces table, Recompute 8 and 9, contract |
| 11 | No bound on the triangles of the tools (a long chain of arcs at a fine tolerance) | codex, subagent | minor | yes | Recompute 8: 4a's `MAX_REVOLVE_TRIANGLES`, `blendDoesNotFit` |
| 12 | `knobEdgeChecks` checks `pairs` of the interference only, not `failed` | codex | minor | yes | calls.ts: the query `interference`, `failed` empty too |
| 13 | The start of a whole circle depends on the order of the segments | subagent | minor | yes | Recompute 4: a fixed direction (the model's X projected) |
| 14 | The table of the edges of the result calls the blend of an arc against a plane through its axis a `circle` and misses the joins of chains and mitres | subagent | minor | yes | Faces, "The edges of the result": rows for arcs, mitres and chains |
| 15 | The fuzz runs are not traceable to 7 192, and "united is faster" is not what was measured | subagent | minor | yes | Measured C (the seeds) and Recompute 10 (worded as measured, the rest under "To verify") |
| 16 | Removing an edge from the middle of the list renames the faces after it | subagent | minor | yes, as an open question | Open 3 and the app's form say so |

Seven of the findings were major, so a second round follows, mainly on what the fix changed.

### Round 2 (on commit `cc96372`)

`agy` failed again (the same quota). `codex`: 6 findings (4 major, 1 minor, 1 nit), with probes of its own against the adapter. The subagent (a fresh one): 9 (2 major, 3 minor, 4 nits), with a probe that was run again before the fix. Both found the mitre at different angles and the mitre of an arc, so 13 distinct findings.

| # | Finding | Reviewer | Severity | Accepted? | What changed |
|---|---|---|---|---|---|
| 1 | The mitre of two edges at different angles β leaves a step (a cap of 1.5 to 3.7 mm²), which no check finds; at a convex corner the plane of the other face was right | codex, subagent | major | yes, measured (H) | Recompute 6: the mitre for the same angle, the plane of the other face at a convex corner of convex edges, else refused; caps at mitres and corners checked in 11 and 12; rejected alternative 13; "In" |
| 2 | An arc cannot end in a mitre off its axis (4a's revolve ends in half planes through it), but the fix sent such ends there | codex, subagent | major | yes | Recompute 6: an arc meets another edge of the feature smoothly or in the plane of its face through the axis, else refused; Known limits |
| 3 | The volume check sums the parts in the wedges, which overlap at a corner, so a swallowed piece passes (codex's probe: three chamfers at a corner of a cube and a cube of 8 mm³) | codex | major | yes | Recompute 12: the union of the parts, for the cut and the added material each |
| 4 | Checking the faces per edge after the renumbering lets a piece where a face survives hide one where it is gone | codex | major | yes | Recompute 11 and 12: the checks per piece, on the temporary numbers, before the renumbering |
| 5 | The triangles of a revolve are not the vertices times the steps (two per side per step, and the caps) | codex | minor | yes | Recompute 8: the `triangles` of 4a's setup, the prisms', and the parts of the volume check |
| 6 | The vectors for the side of a face, summed in 3D around a whole circle, cancel | subagent | minor | yes | Recompute 5: unit vectors carried into the coordinates of the corner, weighted by area |
| 7 | The volume bound counts the strips of planar faces, where the difference should be 0, so it is loose | subagent | minor | no, measured | The fuzz again: on planes the volume cut exceeds the part by up to 0.009 mm³, 2.4 times a bound of round strips only; the strips stay, and the looseness is a known limit with a "To verify" |
| 8 | `CornerPlace` mirrors the profile when its directions are a left-handed pair | subagent | minor | yes | Recompute 9 and contract: the points reversed and the keys shifted |
| 9 | The comment of `BlendProfile` keeps the overshoot of the size for both kinds | codex | nit | yes | contract.ts |
| 10 | The refusal for too many triangles prints a message about faces; the parts of the volume check are not counted | subagent | nit | yes | Recompute 8: the detail and the count |
| 11 | The chamfer's lift along its line can be long near flat | subagent | nit | yes | Recompute 8: the factor stated |
| 12 | Numbers and texts that disagree (3 600 against 3 592, the 7 192 cited for the lift along the line, the summaries of `describe_api` without the plane, the cylinder and the sphere, "another angle") | subagent | nit | yes | contract.ts |
| 13 | "The faces at the two ends meet" where an end can be a mitre | subagent | nit | yes | Recompute 8 and contract |

Four major findings, of 13, so a third round follows; it reads only the diff of this fix.

### Round 3 (the diff of commit `8e38f7a`)

`agy` failed again (the same quota). `codex`: 5 findings (2 major, 3 minor). The subagent (a fresh one): 11 (1 major, 4 minor, 6 nits), with probes of the caps of chains at two chord tolerances. Both found the bound of the caps, the code of the step, the arc at an angle and the order of the checks in the contract, so 12 distinct findings. The last round: nothing found in it is left open but what "Known limits" and "To verify" say.

| # | Finding | Reviewer | Severity | Accepted? | What changed |
|---|---|---|---|---|---|
| 1 | The bound of a cap at a joint by `BLEND_SLIVER` × the length refuses chains the design measured as right: the step of the lift grows with the size and the tolerance, not the length (caps up to 1.5·10⁻² mm² against 4·10⁻⁴ on lines of 4 mm) | codex, subagent | major | yes, measured by the reviewer | Recompute 11 and 12: `BLEND_LIFT` × tol × (size + overshoot); contract `BLEND_SLIVER` comment; "To verify" |
| 2 | An arc and a line at a convex corner at different angles: the line's prism would have to end in the arc's round face; no arc meets another edge at an angle with a plane to end in | codex, subagent | major | yes | Recompute 6: the plane of the other face for two straight edges only, an arc at an angle always refused, with the reason; "In", "Deferred", contract, Known limits, "To verify" |
| 3 | The step between two tools is `unsupportedEdge` in Recompute 12 and `blendDoesNotFit` in the contract | codex, subagent | minor | yes | `unsupportedEdge` with both edges everywhere |
| 4 | The contract still orders the renumbering before the checks | codex, subagent | minor | yes | contract `blendStep` |
| 5 | "Points reversed and keys shifted" does not give the mapping | codex | minor | yes | contract: `keys'[i] = keys[(n − 2 − i) mod n]` |
| 6 | "Issue codes", "In", `MESSAGE` and the table of the edges of the result were not updated | subagent | minor | yes | those places |
| 7 | Three or more edges at a vertex take the planes with "at the same angles" not enforced, and a pocket's inner corner is the shape the adapter refused | subagent | minor | yes | Recompute 6: all convex or all concave is exact at any angles (the half spaces); the pocket in "To verify" |
| 8 | The smooth branch tests only u = −v, not that the other faces continue | subagent | nit | yes | Recompute 6 |
| 9 | A convex and a concave edge reach the generic refusal of 6 before the message of 7 | subagent | nit | yes | Recompute 6 and 7 |
| 10 | 21 × at β = π − 0.2 is 15 × | subagent | nit | yes | Recompute 8 |
| 11 | No minimum angle for the mitre and the plane of the other face | subagent | nit | yes | Recompute 6 |
| 12 | Where the vector of an arc's triangle is carried | subagent | nit | yes | Recompute 5: the half plane through the midpoint of its segment |

The design was written and fixed by Claude Opus 5.5; reviewed in each round by a fresh Claude Opus 5.5 subagent and by `codex` (gpt-6-astra, high); `agy` (gemini-4-argon-high) could not run in any round (its quota).

## Rows for the indexes

**`docs/d36/README.md`, the row of 4b** (column "Design now"):

> full design, D63 ([4b-edge-chamfer-fillet/design.md](4b-edge-chamfer-fillet/design.md)): two feature types, `chamfer` (one distance) and `fillet` (one radius), on edges of one body named by their two faces: a straight edge between two planes, a circular edge between a plane, a cylinder and a cone about one axis; a tool per piece of an edge that reaches past the two faces (a prism ending in the planes of the faces at its ends, or 4a's revolve), its ends lifted off round faces by 1.5 × the chord tolerance, cut on a convex edge and added on a concave one; one new face per edge (`{ feature, role: 'chamfer' | 'fillet', edge }`, a plane, a cone, a cylinder or a torus); a smooth chain in one feature; the errors `unsupportedEdge` and `blendDoesNotFit`; no schema step. Measured: 7 192 random edges, none refused with the lift, 7.5 % without; three fillets at a corner leave a crease. Open for the owner: the crease, the chain, the names by index

In "Shared places": the row "`FaceInfo` and `EdgeKind`" names 4b (the side of a face along an edge, `normalAt`); the row "Kernel port" names 4b among those who keep 3d's precondition. In "Numbers": D63 is 4b; scenario 14 (4a, then 4b) and a part of 12.

**`docs/decisions.md`, the row:**

> | D63 | [4b Chamfer and fillet of edges](d36/4b-edge-chamfer-fillet/design.md) | designed 2026-11-17. Spike against the real adapter: a tool lying on the faces works on planes and fails on round faces (its polygon left on the body's); reaching past the faces, with the ends of the blend exactly on round faces, 7.5 % of 3 600 random edges were refused; lifted off round faces by 1.5 × the chord tolerance (not off planes), none of 7 192; tools united or applied one by one give the same volumes; three chamfers at a corner are exact, three fillets leave a crease 0.225 r proud of a ball | Two feature types, `chamfer` and `fillet`, on the edges of one body: straight edges between planes and circular edges between a plane, a cylinder and a cone about one axis, convex (cut) and concave (added). A tool per piece of an edge, a prism or 4a's revolve, that reaches past both faces and ends in the planes of the faces at its ends; what it leaves there becomes those faces. One new face per edge, named by its place in the list. A smooth chain goes into one feature; the error names what is missing. The errors `unsupportedEdge` and `blendDoesNotFit` |

**`docs/requirements.md`, scenario 14, a new part after 4a's:**

> - *Chamfer and fillet (4b, D63): designed, not done yet* ([d36/4b-edge-chamfer-fillet/calls.ts](d36/4b-edge-chamfer-fillet/calls.ts)). The bore of the pulley gets a chamfer of 0.5 at both ends (two cones of 45° about the axis, their circles with the top, the bottom and the bore, the facts `setback/0` and `setback/1` 0.5 and `cut` true), its outer rims a fillet of 1 on their four edges with the bottom, the top and the flanks (four tori of minor radius 1 about the axis, every face of the pulley kept), and the knob a fillet of 2 at its foot (a torus R 10, r 2) and a chamfer of 0.2 at the mouth of the O-ring groove, after which the ring still clears the knob with the gap of 0.05 to the groove bottom. Refused: the rim of the dome (a sphere: `unsupportedEdge`), a fillet of 5 of the rims (the rim is 4.78 high: `blendDoesNotFit`, the rim named), an edge the pulley does not have (`brokenReference`); invalid commands: no edge, an edge twice, a radius of 0. A larger diameter keeps every face, and the document loads to the same model without a schema step.

**`docs/requirements.md`, scenario 12, a new part after 2d's:**

> - *Rounded and chamfered edges (4b, D63): designed, not done yet* ([d36/4b-edge-chamfer-fillet/calls.ts](d36/4b-edge-chamfer-fillet/calls.ts)). The top loop of the lid (four lines and the four arcs of the round corners) gets a fillet of 1.5 in one feature: four cylinders and four tori, every feature `ok`, and the lid still clears the box. The bottom loop of the box gets a chamfer of 0.4 against elephant foot: four planes and four cones, and a sketch stands on the chamfer of `oa` with its origin at (cornerR, 0, 0.4), its Y along +X and its normal (0, −1, −1)/√2. The four lines of the lid alone are refused (`unsupportedEdge`, naming the edge of the arc the first line runs into).
