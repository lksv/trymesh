# Architecture: the chamfer and the fillet of edges

Part of [architecture.md](../architecture.md), the design as implemented. The feature types `chamfer` and `fillet` (D63): the edges they take, the corner of an edge, its ends, the tools, the checks and the faces of the result. The design with its alternatives, measurements and reviews is [d36/4b-edge-chamfer-fillet/design.md](../d36/4b-edge-chamfer-fillet/design.md); what changed at the implementation is its section "As implemented".

## Chamfer and fillet (D63)

```ts
interface ChamferFeature extends FeatureBase { type: 'chamfer'; body: Id; edges: EdgeName[]; distance: number }
interface FilletFeature  extends FeatureBase { type: 'fillet';  body: Id; edges: EdgeName[]; radius: number }
```

**Document** (`features/chamfer.ts`, `features/fillet.ts` over `features/edge-blend.ts`).

- `body`: a body of an earlier feature (`requireRef` of the kind `body`).
- `edges`: a list of at least one edge name, each in its canonical order (`edgeName`), each face checked by `requireFace` (the feature names faces and lies before this one; the tags of copies name patterns). An edge twice (by `edgeKey`) is an invalid command that names both places ("edges[2]: the edge is listed twice, also at 0"). Whether an edge is on the body, and of what kind, is a matter of the recompute.
- `distance` (chamfer) and `radius` (fillet): the one numeric field of each, mm, above 0, with an expression.
- The registry: `createsBody` false, `namesFaces` true, `producesTool` false, `info.bodies: 'none'`; `refs` the body at `body` and the faces of every edge at `edges/<i>/a` and `edges/<i>/b` (`faceRefs`). The patch: `body`, `edges` (replaced whole), the size; nothing is removable with `null`.
- No schema step: an older build refuses a feature of a type and a face of a role it does not know.

**Recompute** (`blendStep` of `recompute/edge-blend.ts`, one function for both types). The first problem is the error of the feature; a feature in error changes nothing. A `BlendProblem` thrown on the way carries the code, the references and the detail.

1. **The body.** Missing: `brokenReference` with the body. An imported body (D55): `importedTarget`. Its faces and edges: `analyzeBody` with the chord tolerance of the state.
2. **The edges.** Each by `edgeKey` among the edges of the body, else `brokenReference` with the edge.
3. **The kind.** A `line` whose two faces are planes is straight: the line of the two planes, its direction `n_a × n_b` of their (unsigned) normals. A `circle` whose two faces are planes, cylinders or cones about the axis of its circle (`circleBetween` with the points of the edge) is circular. Anything else is `unsupportedEdge`, the detail naming the kind and the two surfaces.
4. **The pieces.** The segments of the edge chained by their vertices, vertices at one place in float32 being one (exact equality of the coordinates). A vertex with more than two segments of the edge is `unsupportedEdge`. A straight piece runs between the ends of its chain; a circular one is a whole circle (a closed chain) or an arc whose signed angle about the axis is summed along the chain and made positive by reversing the chain. `EdgeData` of `solid.ts` keeps per segment its two vertices and the triangle of each face along it.
5. **The corner** of each piece, in the plane across a straight edge (3D) or in the half plane `(ρ, z)` through the axis of a circular one:
   - The directions along the faces are exact: `d × n` for a plane along a straight edge; for a circular edge `(1, 0)` for a plane across the axis, `(0, 1)` for a cylinder, the generator from the apex for a cone. Only their signs come from the mesh: each triangle of the face along a segment gives the unit direction into it across the segment (`n × (pⱼ − pᵢ)` for its side `i → j` in its winding), carried for an arc into `(ρ, z)` of the half plane through the middle of the segment, summed weighted by area. A sum whose projection on the exact direction is less than half its length, or triangles that disagree in sign over more than half the weight of those that agree, is `unsupportedEdge` ("the side a face of the edge lies on along it is not clear").
   - β, the angle between the two directions: within `BLEND_MIN_ANGLE` (0.01 rad) of 0 or π is `unsupportedEdge`.
   - Convex (cut) when the direction along `b` points against the outward normal of `a` (the area-weighted normals of the same triangles); concave (added) otherwise.
   - The pieces of an edge must agree in the sides of both faces and in convexity, else `unsupportedEdge` ("the pieces of the edge need different chamfers").
6. **The ends** of every piece that is not a whole circle, at its end vertex P. First, a convex and a concave edge of the feature that end at P: `unsupportedEdge` with both. Then, when exactly one other edge of the feature ends at P and shares exactly one face F with this one (G₁ and G₂ the other faces of the two, u and v the directions away from P along them, the tangent for an arc):
   - *smooth*: `|u + v|` within the angle tolerance and G₁, G₂ with parallel normals at P (`normalAt`): both end in the plane across them at P (for an arc, its half plane through P);
   - otherwise an arc is refused ("an arc meets another edge at an angle, not smoothly");
   - two straight edges at the same β: their mitre, the plane through P with the normal `u − v`;
   - two straight convex edges at different β at a convex corner of F (v points into F from the line of this edge): each in the plane of the other's G;
   - anything else: `unsupportedEdge` with both edges; a plane of these within 0.01 rad of the edge too.

   Otherwise the faces besides `a` and `b` that have an edge with `a` or `b` through P:
   - one face C that continues `a` (or `b`): a smooth end, in the plane across; the edge of C with `b` (or `a`) must be in the feature, else `unsupportedEdge` with both edges, "the edge continues smoothly into the second edge in refs; add it to this feature";
   - one planar face C, or several planes in one plane (a plate and a wall added flush with its end; C is the one next to `a`, else the first): a straight piece ends in its plane (crossing the edge at more than 0.01 rad); an arc needs C to hold its axis (the cap of a partial revolve), else `unsupportedEdge`;
   - two faces, one continuing `a` and the other `b`: a seam of flush faces, a smooth end whose continuation is the edge of the two;
   - anything else (none, a round face that continues neither, several faces): `unsupportedEdge` naming the faces.

   The tolerance of "parallel" and of `u = −v` is the angle tolerance plus ten precisions of the coordinates over the smallest radius of curvature at P, at most five angle tolerances.
7. **The lift and the overshoot.** The lift is `liftOf(chordTolerance, band)`: 1.5 chord tolerances (`BLEND_LIFT`), at least two bands of the kernel (`BLEND_LIFT_BANDS`, `bandOf` of `body-boolean.ts`: 10⁻⁵ of the larger of the diagonal of the body and twice its largest coordinate). The overshoot past a concave edge is `BLEND_OVERSHOOT / BLEND_LIFT` (4 / 1.5) lifts, which is four chord tolerances where the band does not hold the lift up; past a convex edge the larger of that and the size.
8. **The profile** (`blendProfile` of `recompute/tool-edge.ts`), counter-clockwise in the coordinates of the corner (`a` along +x, `b` along (cos β, sin β)):
   - the blend: a chamfer's line between the points at `distance` along each face, a fillet's arc of `radius` tangent to both, its centre at `radius / sin(β/2)` on the bisector, its points of touching at the setback `radius / tan(β/2)`, divided for half the chord tolerance (`segments` of sketch.ts);
   - an end on a round face lifted off it by the lift, a chamfer's along its own line (by lift / |sin| of its angle to the face) and a fillet's along the normal of the face; an end on a plane stays;
   - then past `b`, round the corner `k · o` (k · mA = k · mB = 1) and back past `a`, by the overshoot o. The sides are keyed `blend`, `pastB`, `cornerB`, `cornerA`, `pastA`;
   - `wedge`: the corner and the exact blend, closed along the two faces: what the volume check measures.
   - For a circular edge, a blend with a point within `LENGTH_TOLERANCE` of the axis is `blendDoesNotFit` ("reaches the axis"); an overshoot that comes nearer to the axis than half the nearest point of the blend is shortened to that, and one shortened below two lifts is refused too.
   - A straight piece whose two end planes cross within the profile or the wedge (`prismLength`) is `blendDoesNotFit` ("the ends of a piece of the edge meet within the chamfer").
9. **The tools**, every one with seven temporary face numbers of its own from `faceNames.length + edges.length` on (the five sides and the two ends), so no number is in two operands of a boolean (3d's precondition of the port):
   - a straight piece: `edgePrism`, the profile in the frame of the corner (origin the edge's line at the start of the piece, X along `a`, Y towards `b`, Z = X × Y), every vertex carried along Z to the plane of each end, the ends triangulated by the kernel;
   - a circular piece: 4a's `buildRevolve` with `blendRevolveSetup` (`revolveRegion` carries the profile into `(ρ, z)` by `CornerPlace` and reverses it with its keys where the place mirrors it; one region, the axis `(0, 1)` with the profile on its right; the steps by 4a's rule at the largest radius of the profile), in the frame whose origin is the centre of the circle, Y the axis and X the radial direction at the start of the piece (for a whole circle the model's X projected across the axis, its Y where the axis is within 0.1 rad of X), turned by a whole turn or by the arc. `sideOf` gives the blend its exact line or circle, so 4a's rules give its surface; the overshoot sides get their lines.
   - The triangles of all tools and of the parts inside the wedges over 4a's `MAX_REVOLVE_TRIANGLES` (1 000 000), counted before any is built: `blendDoesNotFit` with the count.
10. **The booleans.** The cut tools united one after another and subtracted from the body, then the added ones united and joined. A result without a triangle is `emptyResult`; an exception of the kernel is `kernelFailure`.
11. **The checks**, on the temporary numbers, per piece:
    - the blend has a triangle, else `blendDoesNotFit`: "too small for the chord tolerance" when the blend lies no farther from the edge than the lift and a chord tolerance (a fillet of 0.3 between a cylinder and a cone at 162°), "would vanish" otherwise;
    - the blend has an edge with `a` and an edge with `b`, else `blendDoesNotFit` with the edge and the face that would vanish;
    - a cap at a joint (smooth, mitre, the plane of the other's face) left above lift × (size + overshoot) mm²: `unsupportedEdge` with both edges ("their tools leave a step");
    - the overshoot faces left above `BLEND_SLIVER` (10⁻⁴ mm² per mm of the piece): `blendDoesNotFit` ("the tool reached material it must not touch");
    - every vertex of a blend within lift + chord tolerance + ten precisions of its exact surface, else `kernelFailure` ("the kernel left a vertex of the chamfer N mm off its surface");
    - the volume, of the cut and of the added material each: what was taken (added) at most the volume of the union of the parts inside the wedges plus `BLEND_VOLUME` (0.5) × lift / 1.5 × the strips (twice the setback times the length of each piece) plus four bands × twice the area of each profile (the shift the kernel may leave where a cap lies flush on an end face) plus 10⁻³ mm³; more is `blendDoesNotFit` naming the edges.
12. **The renumbering.** Every side of the tool of edge i and a cap at a joint become the face `faceNames.length + i`; a cap at a planar end face C becomes C where it faces the way C faces in the body (C extended: the riser of a step, the end of an added fillet). A cap that faces against C is material beyond the plane of C (a chamfer deeper than the riser its edge ends at, an added fillet standing out over a lower end wall): above lift × (size + overshoot) + 4 bands × the outline of the profile mm² it is `blendDoesNotFit` with the edge and C ("reaches past the end face"), a sliver becomes the face of the blend. (The review of the implementation found the cap renamed into C facing the wrong way, which turned a sketch on the riser round.)
13. **The result.** The body under its ID; the face table with one face per edge appended, `{ feature, role: 'chamfer' | 'fillet', edge: i }`, in the order of `edges`; the facts `setback/<i>` and `cut/<i>`.

**Faces.** A chamfer of a straight edge is a plane: its origin where it meets face `a` at the end of the edge its projection calls `a` (the smaller parameter along `n_a × n_b` of the outward normals), Y along the edge in that direction, so a sketch on it reads along the edge as a projection of the edge does. A fillet of a straight edge is a cylinder about the line of the centres of its arc, its `along` (D60) the direction in which the chamfer's Y would run. A circular edge gets 4a's surface of the blend's curve: a cone, a plane across the axis or a cylinder for a chamfer; a torus with its major radius signed, or a sphere where the centre lies on the axis, for a fillet; their `along` is the axis of the circle as the analysis of the body gives it (the Y of the frame of the revolve). The edges of the result: a chamfer with its planes `line`; a cone or a torus with its coaxial faces `circle`; a fillet cylinder with the faces it touches `other`, with a plane across it `circle`; the joins of chains and mitres of fillets `other`.

**`normalAt`** (`solid.ts`): the unit normal of a plane, a cylinder, a cone, a sphere and a torus at a point, without a sign; undefined on an axis, at an apex, and for a swept or an imported surface.

## The app and MCP

`FEATURE_UI.chamfer` and `FEATURE_UI.fillet` are `blendUi` of `packages/app/src/features/edge-picker.ts` ([ui/chamfer-fillet.md](../ui/chamfer-fillet.md)); a form's `picks` may answer `edges` and `before`, and `App.view()` then shows the state before the feature instead of the preview. `issue-text.ts` labels the two roles ("chamfer of edge 1") and prints an edge in the refs of `unsupportedEdge`, `blendDoesNotFit` and `brokenReference` by the labels of its two faces. The MCP description is generated; `CONVENTIONS` in `packages/mcp/src/api.ts` has a paragraph on the two types.

## Known limits

The list of the design ("Known limits") holds, with what the implementation found ("As implemented" of the design):

- Three or more fillets at a convex vertex meet in creases; three concave edges at a corner (the inner corner of a pocket, with its floor and two walls) end in the planes of the faces at the corner, which the kernel refuses: `kernelFailure`, not a wrong body.
- A convex and a concave edge that meet at a vertex go into two features; an arc that meets another edge at an angle, two edges at different angles at a reflex corner or between concave edges are refused.
- A fillet whose blend lies within the lift of its edge (a small fillet between two faces at a wide angle) cuts nothing and is refused as too small for the chord tolerance.
- At a chord tolerance near the band of the kernel, or far from the origin, the lift and the overshoot grow with the band; the kernel still refuses some tools there (`kernelFailure`), most at round faces 1 000 to 2 000 mm from the origin.
- The volume check lets through less than its bound, and it is looser by the empty space inside the wedges; the blend surfaces are checked, the faces next to them only by their edges with the blend.
- The tangent edges of a straight fillet are `other`; names by the place in the list; one body per feature; an end at two faces besides its own that are not a seam; an arc that ends at a plane off its axis; no pattern of a chamfer or a fillet; the steps of a revolve at its largest radius.
