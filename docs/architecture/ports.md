# Architecture: ports

Part of [architecture.md](../architecture.md), the design as implemented. The contracts of `SketchSolver`, `SolidKernel` and `Deflater`.

## Ports

### SketchSolver

```ts
interface SketchSolver {
  solve(input: SolveInput): SolveResult;
}

interface SolveInput {
  points: Record<Id, { x: number; y: number }>;   // initial estimate
  radii: Record<Id, number>;                      // initial estimate of the radii of circles
  curves: Record<Id, Curve>;                      // including projected curves
  constraints: Record<Id, Constraint>;
  fixed: Id[];                                    // points that do not move, and circles with a fixed radius
  drag?: { point: Id; target: { x: number; y: number } };
}

interface SolveResult {
  status: 'solved' | 'conflict' | 'failed';
  points: Record<Id, { x: number; y: number }>;
  radii: Record<Id, number>;
  degreesOfFreedom: number;          // 0 = fully constrained
  conflicting: Id[];                 // constraints in conflict
  redundant: Id[];
}
```

A spline in `curves` (D70): an adapter adds no primitive and no equation for it; its control points are points of the input (checked as the ends of a line are), and no constraint names a spline, so the planegcs adapter's cases of a spline in a constraint throw (never reached). The analysis of freedom gives it no row either.

A stateless function. Loading the WASM is asynchronous and happens when the adapter is created; `solve` is synchronous.

What an implementation guarantees:
1. Points in `fixed` do not move; circles in `fixed` do not change their radius.
2. For every arc, `start` and `end` lie at the same radius around `center`.
3. The same input always gives the same output.

planegcs moreover returns a satisfied input bit for bit unchanged (verified by a spike), but the design does not rely on it.

When the solver finds a state that is not usable geometry (an infinite value, a radius that is not positive, an arc with its ends at different radii), the adapter returns `failed`.

How the planegcs adapter solves:
1. During a drag it first solves the sketch without the drag and finds the redundant constraints. With the temporary target of the drag the library would report them as a conflict, so they are left out during the drag. They are left out by the constraints of the library, not of the engine: of a fixed point only the coordinate the library called redundant goes (a point fixed on a horizontal line from the origin), the other one keeps the point in place during the drag.
2. It solves the sketch. When the default algorithm (DogLeg) does not converge and reports no conflict, it tries Levenberg–Marquardt; FreeCAD does the same.
3. It solves again from the state found until the state is stable. The library reports the degrees of freedom and the redundant constraints by the initial estimate, not by the result, and in the state `Converged` it may leave a redundant constraint unsatisfied. So the returned diagnostics describe the returned geometry, and solving again from the result gives the same; step 2 of solving a sketch (only the diagnostics from the stored variables) relies on that.

The adapter translates every variant of `Constraint` to the matching constraint of the library one to one by `type`. Two exceptions (D35, point 6): `equalRadius` becomes `equal_radius_cc`, `equal_radius_ca` or `equal_radius_aa` by the kinds of its two curves (the library wants the circle first in the mixed one), and `fixed` becomes two constraints of the library, `coordinate_x` under the ID of the constraint and `coordinate_y` under a derived ID that the adapter maps back, so `conflicting` and `redundant` name the constraint once. A point with a `fixed` constraint starts every pass at the coordinates of the constraint and not at its estimate: from a rough estimate the library could stop where a dimension agreeing with the coordinates looked like a conflict. A third (D75): `distanceLineLine` becomes two constraints too, `parallel` under the ID of the constraint and, under the derived ID, `p2l_distance` of an end of one line from the other (`point_on_line_pl` at 0, where the unsigned distance has a kink); each is left out on its own while dragging, so a `parallel` of the same lines beside it is redundant once. The end is chosen for the way to the solution (`measuredEnd`: one that is not fixed first, in the order `a.a`, `a.b`, `b.a`, `b.b`), and a solve that fails without a conflict is tried again with the distance measured from the other line, by both algorithms; such a try is not taken when it shrank one of the two lines to a point. Of two lines with a common end the second constraint is left out at 0 and measured from the common end otherwise, which makes the constraint the conflict. The other kinds of D75 are one to one: `horizontal_pp`, `vertical_pp`, `p2p_symmetric_ppp` for `midpointPoints` (with the fallbacks of a pair at one place, as the midpoint of a line), and `c2ldistance` for `distanceLineCircle`, which takes an arc as its circle. An unknown kind of curve, or an ID in `fixed` that is neither a point nor a circle, is an exception. The auxiliary constraints it adds itself (the conditions of an arc, the fixed radius of a projected circle) are filtered out of `conflicting` and `redundant`: the result may hold only IDs of the input. In the state `conflict` or `failed`, `degreesOfFreedom` has no meaning: the library returns −1, the adapter passes on 0, and the UI goes by the warning `sketchConflict` and the list `conflicting`.

**A tangency of a line and an arc at a common end** (D52, the third exception). When an end of the arc (`start` or `end`) is an end of the line (`a` or `b`), by the same point ID or by two points that one `coincident` constraint of the input names together, `tangent` becomes `perpendicular_pppp(centre, that end of the arc, line.a, line.b)`: the radius to the common end is square to the line. Otherwise it stays `tangent_la` ("the centre is the radius away from the line").

- Why: at a common end the form `tangent_la` has a double root (its derivative there is the derivative of the rule of the arc with the opposite sign). The library finds redundant constraints from the derivatives at the estimate, so when the state is exact (a fillet of the sketch tool, a slot drawn by an AI at computed coordinates) it calls the tangency redundant, solves without it and reports it as a conflict after any change of a dimension. The engine's own analysis has read such a tangency as a square radius since D32 ([sketch.md](sketch.md), "Double roots"); the adapter now agrees with it for this case.
- The two forms say the same wherever the line has a length: the end lies on the circle by the rule of the arc and on the line as its end, and a line through a point of a circle touches it there exactly when the radius is square to it. A line of no length satisfies the new form; a sketch that lets the line collapse can solve into that, and its profile then reports a curve of no length.
- **Two fixed points at one place are one end (D72).** Two ends are one end when they are one ID, or two fixed points of the input at most `FIXED_JOIN` (1e-6) mm apart and, when the arc of the tangency is fixed too, within 1e-6 of its radius (`sameEnd`). A line and an arc have a common end when an end of the line and an end of the arc are one end, or when one coincident names two points that are one end with an end of the line and with an end of the arc. So it reads the same from either side: an own line held on the end of an imported outline's line and tangent to the arc beside it (the end of `o/l1` and the start of `o/a1` are two IDs at one place), an own arc held on the start of that arc and tangent to the line, two projections of 6b that meet, an own line that starts at `origin` where a fixed arc starts. By the radius only when the arc is fixed, so that a point near in millimetres and far by the size of a small arc is not taken (no tangent passes through it); for an own arc, whose radius is a variable, by 1e-6 mm alone, so the form does not change while the arc is dragged. The rule is one function of the engine, `commonEnd` (`common-end.ts`, with `FIXED_JOIN`), which the adapter imports and the analysis of the sketch reads too. This is the one exception to the rule that an adapter knows only the public types of the engine ([architecture.md](../architecture.md)): `common-end.ts` is a leaf that imports nothing at run time (only types), shared by the analysis and the solver adapter so that the two read one rule, and `packages/engine/test/modules.test.ts` holds that it stays a leaf and that no adapter imports another value of the engine. With one function the two never disagree about the form: where the common end is found only through two fixed points at one place (`byPlace`), the analysis reads the adapter's equation (the radius to that end of the arc square to the line) also when the end of the line lies off the circle by more than `SHARED` of the size (an own arc under 1 mm held on a fixed point 8e-7 mm from the end of a fixed line, and a fixed arc at the very bound of the join, where the analysis before counted one freedom too many; the review of 6f's implementation, kind 1). Run over every test of the repository and the spikes with the decision of before logged beside the new one: 4124 decisions, none differed.
- The rule is decided from the curves and the constraints of the input and from the positions and the radius of fixed entities only (numbers of the input, never a variable of the estimate), and does not depend on the order of their keys (the start of the arc before its end, the joins by ID). Only a direct join is read; an end joined through a third point, an end held on the line by `pointOnCurve`, a line and a circle, and two arcs tangent at a common end keep the form of the library and its defect (measured in [2d-sketch-fillet/design.md](../d36/2d-sketch-fillet/design.md), "Measured"). The line may be a projected one (a line of the input with two fixed points, joined by the `coincident` of a snap) or end at `origin`. A constraint the engine leaves out of the input (one on a lost projection) is not there to be read.
- The constraint keeps its ID, so `conflicting` and `redundant` name it as before. `redundant` no longer names such tangencies.
- On load: the solver is called at every recompute, also when the stamp matches. A stored state that is exactly tangent satisfies both forms. The new form is as strict about a tangency as the library is about every other constraint (its residual grows with the angle off tangent, that of `tangent_la` with its square), so a sketch whose other constraints hold the points only nearly tangent (measured: fixed points 1e-9 to 1e-5 mm off at a size of 10 mm) gets a `sketchConflict` it did not have; its geometry is the stored one. A sketch saved in conflict because of the double root has a stamp that does not match and is solved on load to what its dimensions say. Both are pinned by `packages/scenarios/test/tangent.test.ts`.
- The fallback, should the rule have to go: the adapter is left as it was and the fillet holds its arc by two construction radii from the centre to the ends of the arc, each `perpendicular` to its line. It measures like the square radius, but every fillet carries two more lines and a tangent arc drawn by hand stays broken. The rule is one function of the engine (`commonEnd` of `common-end.ts`, which the analysis reads too) and one case of the adapter (`line-arc` of `translate`), so it can be reverted alone.

Reference dimensions (`driving: false`) are not sent to the solver. The engine filters them out before the call and computes their value from the solved positions. By the spike, planegcs does not work with them reliably.

### SolidKernel

```ts
interface Solid {
  positions: Float32Array;   // xyz
  triangles: Uint32Array;    // vertex indices
  faceIds: Uint32Array;      // the face number of every triangle
}

interface ComputedMesh { unverified: Solid }       // a mesh the kernel computed and did not verify (D50)

interface SolidKernel {
  boolean(op: 'union' | 'difference' | 'intersection', a: Solid, b: Solid): Solid;
  triangulate(loops: Float64Array[]): Uint32Array;   // a 2D polygon with holes: the outer loop counter-clockwise, the holes clockwise
  intersectionAsComputed(a: Solid, b: Solid): ComputedMesh;   // for measuring only (D50)
}
```

A precondition on the input: the face numbers in both `a` and `b` come from one common table. The same number means the same face; different faces have different numbers. The engine ensures it (see the table of face numbers in the section Recompute).

**No face number in both operands of a union or a difference** (D56). The adapter tells the faces of the tool from those of the body by their numbers, and two bodies of a model may share numbers (the two parts of a split, two bodies cut by one feature, a body and the pocket a kept tool left in another): measured, a union of two such bodies came out with a wrong volume without a word in about half the cases tried. An implementation throws for such operands (the Manifold adapter: `the operands of a union share the face number …`), so a caller that forgets gets an exception and not a wrong body. A tool of an extrusion has new numbers anyway; `booleanOfBodies` (`recompute/body-boolean.ts`) gives the tool numbers of its own for the call and puts them back. An intersection may share numbers (the collisions ask it so).

The engine asks the port for an intersection as a body as well since D56 (a combine with the operation `intersection`), and for the intersection that checks the volume of a union and a difference of two bodies. It does not trust the port blindly there: `booleanOfBodies` ([combine.md](combine.md)) checks the volume of a union and a difference against the identity with the intersection, the sheets left in the result, and drops the pieces of an intersection that are all sheet; a result that fails is `kernelFailure`.

What an implementation guarantees:
1. The output of `boolean` is a closed body.
2. Every output triangle has the `faceId` of the face it comes from.
3. Planar faces of the two operands that lie in one plane within the tolerance of the kernel and overlap are taken as coincident. The band is 10⁻⁵ D, D the diagonal of the box of the two solids but at least twice their largest coordinate (`tolerances` of the adapter; pinned in `packages/kernel-manifold/test/precondition.test.ts`). Faces in the band are joined with no gap or wall between them, but the volume is not exact: the adapter's shift of 4 · 10⁻⁵ D may stay as material, up to the shift times the area of the contact (D56, "Verified", 2); the checks of `booleanOfBodies` turn that into a refusal, an extrusion is exposed to it as before. The result holds no membranes, no inner faces and no remains of faces that should have disappeared. This holds for a union and a difference. The engine uses an intersection only in the query of collisions (`interference`), which wants its volume, not its faces: the Manifold adapter does not keep this guarantee for an intersection, does not adjust the tool before it and only cleans and verifies the result, with a second cleaning where the first fails the checks (step 8 below, D51); when it cannot verify it, it throws, and the query then asks for the intersection as computed (below) and may clear the pair by it, or reports it as failed.
4. The same input always gives the same output.

When the adapter cannot guarantee the result, it throws an exception and the engine reports it as `kernelFailure`. It must never return a silently broken body. A faulty input throws as well: a mesh that is not closed or is oriented inwards, a count of face numbers that does not match.

#### The intersection as computed (D50)

`intersectionAsComputed(a, b)` is what the two solids share as the kernel computes it, **for measuring only**. The collisions (`sharedBy` in `interference.ts`, the only caller; `packages/engine/test/modules.test.ts` holds it) ask it about a pair whose `boolean('intersection')` threw, and may only clear such a pair by it ([api.md](api.md), "Interference"). The result is wrapped (`ComputedMesh`, the field `unverified`), so it cannot be handed to `boolean`, put into a body or exported without writing `.unverified`.

What an implementation guarantees:
1. The common part of the two solids as the kernel computed it, with nothing done to it: no faces moved before, nothing welded, dropped, split or repaired after.
2. **What the two solids share is in the mesh**: every part of their common volume thicker than the precision of their coordinates (a millionth of the largest coordinate of the two, and of a millimetre at least). The mesh may hold more than they share, never less. This is what a cleared pair rests on; no test can prove it of a kernel.
3. It is closed by its indices: every edge in two triangles, once each way, so every connected piece has a volume. Two solids that are apart give a mesh without triangles.
4. Every triangle carries the number of the face of `a` or `b` it comes from.
5. The same input gives the same output.
6. It throws for an input `boolean` throws for, when the library reports an error, and when the mesh would not keep guarantee 3 (that is the one check); never because the mesh is not clean.

Not guaranteed, as `boolean` guarantees it: that the mesh is a solid (it may hold unjoined vertices at one place, triangles without an area, sheets where faces coincide, slivers thinner than the precision, pieces that touch along an edge or at a vertex, and pieces of noise that are inside out, each below 10⁻⁵ mm³ on the arm of scenario 13); a tolerance for faces in one plane (guarantee 3 of `boolean`); that another operation of the kernel takes it (Manifold would load it and silently drop a part, step 7 below); the same answer with `a` and `b` swapped (nor is a refusal of `boolean` the same both ways). A kernel whose intersection is exact (B-rep) may return that result here.

An intersection from `boolean` is not free of the first of these either: it holds sheets where faces of the two solids coincide (guarantee 3 is not kept for an intersection), and in a mesh of slivers (a pin turned in its hole) both cleanings of the adapter leave thin triangles that the rule of a null triangle calls null: the first where its loop stops inside a cycle (about 2 an answered pose of the pin along an axis, 28 askew), the second where it may not subdivide again (24 on average in the meshes the first refuses). They are triangles of the library's result or pieces of one, and the checks hold that none on a planar face is turned over. What `boolean` adds is that check, the weld, and the closed surface ([D51](../d36/5f-adapter-repair/design.md), "Known limits").

**The adapter of Manifold**: the boolean of the library as it is (the inner `rawBoolean`: both inputs checked as for `boolean`, the library asked, its error thrown, the arrays copied out), then `isClosed` of `clean.ts` on the result, then the wrapper. No shift of faces before, no cleaning after, no check of folded triangles, no tolerances. Every mesh looked at was closed (136 refused poses of the design and the poses of its tests). The library has a floor of its own: triangles colinear within its tolerance are removed and shorter edges may be collapsed; that tolerance follows the largest coordinate as the precision of the coordinates does and is about an eighth of it, so what it may lose is thinner than what the collisions call nothing ([the design](../d36/5e-kernel-second/design.md), "The port"). The option `{ prepare: false }` of `ManifoldKernel.boolean` is the same raw boolean for the tests of the adapter, without the check and the wrapper.

**How the Manifold adapter keeps guarantee no. 3.** Manifold itself has no tolerance for nearly coplanar faces and fails on tilted faces because of float32. The adapter therefore follows one rule: faces of the tool and of the body in one plane must not merely touch. It turns every such contact into a real overlap before the boolean and moves the shifted faces back after the boolean.

Before the boolean:
1. It fits planes through the faces of both bodies (by face numbers). A face is planar when its vertices lie within the tolerance of the fitted plane. The normals of single triangles do not decide: a thin triangle from an earlier boolean has an unreliable normal and would mark the whole face as not planar.
2. It finds the pairs of faces of the tool and the body in one plane that overlap, touch, or are separated by a gap of up to two overlaps. A touch counts because the side of a boss touches the side of the body only along an edge. A gap counts because the faces get stretched when the neighbouring faces are shifted by the overlap.
3. It shifts the face of the tool by the overlap so that the tool grows. The only exception: in a difference, when the tool rests on the body from outside, the tool shrinks. When a face of the tool meets faces of both orientations in its plane (a top face and the underside of an overhang), growing takes precedence; shrinking would leave a membrane on the flush part.
4. It moves the vertices along the intersection lines of the neighbouring faces, so that the neighbouring faces do not tilt.

After the boolean:
5. It moves back everything that remained in the result after the shift. The positions are not estimated from the surroundings; they are computed exactly from the original, unshifted geometry. Every vertex of the result is either a vertex of one of the bodies or the intersection of an edge of one body with a face of the other:
   - a shifted vertex of the tool returns to the original vertex,
   - the intersection of an edge of the tool whose end was shifted (including the diagonals of the triangulation) with a face of the body moves to the intersection of the original edge with the plane of that face,
   - the intersection of an edge of the body with the shifted face of the tool, and every other vertex in the band between the original and the shifted plane, moves along that edge of the body into the original plane,
   - an intersection that would lie outside the ends of the original edge does not exist in the exact geometry; it is pulled to the nearer end.
6. It cleans the mesh, always, even when nothing was shifted:
   - it merges vertices at the same place,
   - it drops triangles with their vertices on a line and membranes of zero thickness,
   - it evens out the edges left without a counterpart by that: a triangle with such an edge is split at the vertex that lies on it and at which the opposite side continues (a T-junction),
   - the two steps before can undo each other (a split leaves a piece the dropping takes for a null triangle, which opens the same edge again) and go round in a cycle of a few states, so the cleanup remembers the states it has split and stops after splitting one of them for the second time; where the mesh used to end closed it ends closed, and a cycle without a closed state fails the check of step 7 after a few passes instead of a thousand,
   - where the body touches itself only along an edge, it splits the surface by the wedges of material.
7. It verifies the result and otherwise ends with an error (`kernelFailure`):
   - the mesh is a closed surface (every edge in exactly two triangles, once in each direction),
   - no planar face has a triangle turned against its normal.
8. **For an intersection that fails step 7, a second cleaning** (`cleanBySubdivision` of `clean.ts`, D51). In a mesh of slivers (a pin turned in a hole of the same circle, faces flush only to the precision of the coordinates) the dropping and the splitting of step 6 undo each other in a thin quadrilateral with two corners a few tolerances apart, and the loop stops open or with a piece turned over. The second cleaning starts again from the raw mesh (an intersection has no faces moved): the same weld, the same membranes and the same rule of a null triangle, but the drop and the split are one operation: the long side a–b of a null triangle is subdivided at its middle vertex m in every triangle on that side, (a, b, x) becoming (a, m, x) and (m, b, x) with its face number, and the null triangle itself becoming nothing. Every state is closed by its directed edges (a subdivision replaces a→b and b→a alike and adds m→x with x→m), so it cannot end open; each subdivision (a side and a vertex) is made once at most and a pass without one ends the loop (the bound of a thousand passes leaves a closed mesh), so it ends; a null triangle whose subdivision was made before stays. Then the parting of the edges as in step 6, and the checks of step 7; a mesh that passes is the answer, otherwise the adapter throws the message of step 7. What the first cleaning verifies is returned as before, so an intersection answered before D51 keeps its arrays. A union and a difference never reach it: it may leave a null triangle carrying the number of a face that should be gone (guarantee 3). The option `{ second: false }` of `ManifoldKernel.boolean` switches it off, and the counter `secondCleanings` says how often it ran, both for the tests only.

Why steps 5 to 7 are needed:
- Without moving back, the remaining face lies an overlap away from the plane the engine computes for it analytically, and the next operation on it fails: in the spike a boss hung on such a face ended as a separate component with a gap of 0.002 mm. The output of the adapter therefore has to be consistent with the analytic geometry within the precision of float32, not within the overlap.
- Without cleaning, the band of zero width leaves triangles that still carry the number of the vanished face, and a reference to it would not break. The kernel itself leaves the same where the tool touches the body only along an edge; that is why it always cleans.
- Without the check an error would pass silently. Manifold loads a mesh that is not a closed surface without an error in the next boolean, drops part of the triangles and changes the volume (in the spike by hundreds of mm³).

What showed only in a generally turned position and in random tests:
- The planes of faces are fitted through the whole face. The normals of single triangles of the result cannot be used: thin triangles have them off by tens of degrees.
- Moving back only "into the plane" is not enough. The intersection of an edge that the shift turned stays in the right planes, but a fraction of the overlap beside. That alone does no harm until a later tool has a face exactly at that place; then the mesh folds. That is why the positions are computed from the original edges.
- A vertical edge of a cylinder may lie wholly in the plane of a side of the body. The intersection with such a plane is not determined; the face of the body most across it of those the vertex touches is taken.
- The shift of the vertices of the tool before the boolean is computed in an orthonormal basis of the normals. Computing it through a regularised 3×3 system was unstable for a vertex held by a single tilted plane.
- A thin triangle is not the same as a triangle with its vertices on a line. The kernel commonly returns needles: two vertices a few ten-thousandths apart and the third far away. A needle has an area and belongs in the mesh. So a triangle counts as null when it is narrower than a quarter of the merge tolerance (the precision of float32), and a wider one only when its middle vertex lies clearly inside its longest side.
- Only edges without a counterpart may be split. The first version split every edge that had a foreign vertex close enough to its line. At a sound edge leaving at a small angle that led to alternating between two states, neither of them closed.
- After a touch along an edge, the doubled vertices are merged again in the next boolean and split again. Splitting through a new vertex in the middle of the edge thus doubled the number of triangles at the place of the touch with every further operation. So where it can, an existing vertex is doubled.
- The precision of float32 falls with the distance from the origin. Tolerances derived only from the size of the model failed for a model 60 mm large and 450 mm away from the origin.
- A shrunk tool could skip a face of the body lying just behind its face; the material between them remained as a membrane. So the shift goes at most to half of the gap.

Consequence for names: where a face of the tool is flush with a face of the body and they overlap in area, the overlapped part carries the name of the tool's face in the result. Both faces still exist and are separated by an edge of the kind `coplanar`.

The adapter derives all tolerances from the size D: the diagonal of the bounding box of both bodies, but at least twice the largest coordinate (a model far from the origin has a worse float32 precision). Same plane 1e-5 D, overlap 4e-5 D, merging of vertices 1e-6 D. They are set neither in the document nor in the core.

Limits:
- **Resolution.** A detail smaller than about 1e-4 D (around 0.01 mm for a 70 mm model) right next to flush faces is not handled reliably by the adapter: a step or a gap of this size, by which the tool is shifted. The result is then either right or the error `kernelFailure`; the tests from the review confirm that it is not silently broken. From 0.05 mm up all tried positions passed.
- Only planar faces are handled. A cylindrical face of the tool coinciding with a cylindrical face of the body (widening a hole to the same radius, a cut-out exactly along a cylindrical boss) is not; the surface then comes out wrong and no error is reported.
- A face of the tool narrower than 8e-5 D (a pocket a few thousandths deep) is not used to determine the plane, and flushness on it is not recognised.
- An intersection is not adjusted (see guarantee no. 3).
- **A few intersections stay refused** after the second cleaning (step 8): 4 of 183 poses of the arm and of flush faces that the first cleaning refused, 49 of 9,999 cases of the sliver fuzz (0.19 % at the origin, 2.2 % 450 or 2,000 mm away). The second cleaning's mesh is closed there and has a folded triangle; where the weld itself turns a triangle of a planar face over (a square or hexagonal key nearly flush in its socket, each side a face of its own), both cleanings end folded. The collisions then take the intersection as computed (D50). The refusals of a union and a difference are not repaired by step 8 (D51, "Known limits").
- The first cleaning can take seconds before it gives up on an intersection (1.1 to 4.2 s in rare cases); that time is spent before the second cleaning is tried.
- Moving the shifted faces back compares every vertex of the result with all shifted edges of the tool and the edges of the body. For bodies of up to a few thousand triangles that does not matter; for a plate with 192 round holes (19 thousand triangles) one boolean took 7.6 s, the kernel alone 0.07 s. A spatial search is a possible later optimisation.
- Cleaning by a pass through Manifold cannot be used: it collapsed null triangles in the wrong direction and damaged the body. The adapter cleans the mesh itself.
- A body that touches itself only along an edge is handled by the adapter (the mesh has doubled vertices at the place of the touch). Geometrically it is a borderline state, though, and further operations exactly at the place of the touch are not tried.
- The tried tools are prisms (boxes, triangular prisms with a tilted face) and cylinders. Others are not made in the PoC; the tool is always an extrude. The tools of a chamfer and a fillet of edges (D63) are prisms and revolves that reach past both faces of the edge, their ends on round faces lifted off them by 1.5 chord tolerances (at least two bands); measured with them: tools lying on round faces leave their own polygons in the result and are 5 to 15 times slower, ends exactly on round faces were refused in 7.5 % of 3 600 random edges, the lifted ones in none of 7 192 at the chord tolerance 0.01 ([edge-blend.md](edge-blend.md)). At a chord tolerance near the band, and 1 000 to 2 000 mm from the origin, the adapter still refuses some of them (a folded triangle, a result that is not closed), and once collapsed a vertex of a result 0.7 mm off its face without an error at a lift of one band; the engine checks the blend faces for it.
- A cut-out whose cap is at the same time flush with the underside of an overhang and lies on an oppositely oriented face in the same plane renames the affected part of that face to the cap of the tool. The geometry is right.
- The wrapper function `triangulate` of the library does not free WASM memory (8 kB a call for a loop of 256 points). So the adapter calls the function under it and frees the memory itself; that is an internal interface of the library and has to be checked when the library is updated.

**Precision (D20).** Manifold takes and returns coordinates only in a `Float32Array`, so `Solid` has them in this type too. The engine never derives geometry from the mesh when it can compute it analytically; the analytic computations run in float64. The measured deviation of vertices from the plane after 12 booleans in a row on a tilted face was 2e-6.

`Solid` is plain data. A move to B-rep would mean another body type and another adapter; the names, the references and the recompute would stay.

### Deflater (D54)

```ts
interface Deflater {
  deflate(bytes: Uint8Array): Uint8Array;   // a raw DEFLATE stream (RFC 1951, no zlib or gzip wrapper)
}
```

A compressor of bytes into a raw DEFLATE stream, which is what the compression method 8 of a ZIP holds (.ZIP File Format Specification 6.3.10, 4.4.5 and 5.5) and the one method besides storing that a 3MF package may use (3MF core 1.4.0, 1.1; Open Packaging Conventions 7.3.6). It is the one thing of a ZIP the engine does not do itself; the container, the checksum and the refusals stay the engine's (`zip` of `export/zip.ts`, [api.md](api.md), "Export formats").

What an implementation guarantees:
1. The result is one complete stream that an inflater turns back into exactly `bytes`, and that ends with its last block: nothing follows it. For every input, also one with no bytes.
2. The same input gives the same output, wherever the implementation runs (Node, a browser): a file of the app is the file of the server.
3. `bytes` is not changed and not kept. The result is a new array that the caller owns.
4. It is synchronous, as an export is.
5. It throws when it cannot compress; the writer of the engine turns that into `failed`.

Not guaranteed: that the stream is shorter than the input (the writer then stores the entry), any particular level, and that two implementations give the same stream. Nothing checks at run time that a stream inflates back.

**Where it enters.** `createEngine(deps)` takes `EngineDeps`: the solver, the kernel and `deflater?`. It is optional: an engine without it is a whole engine whose files are stored. The compressor reaches a format as the kernel does, as a member of its context (`QueryContext.deflater`, set from `ContextDeps`); unlike the kernel it is not wrapped, because a format hands it to `zip` and does not call it, and `zip` turns its failure into `QueryFailure('failed')`. The app (`packages/app/src/main.ts`) and the server (`packages/mcp/src/main.ts`) give their engines the adapter below; so do the kits of the tests with real adapters (`packages/scenarios/test/kit.ts`, `packages/mcp/test/kit.ts`, `packages/app/test/app-kit.ts`). No test loads either `main.ts`: an engine that lost its compressor writes stored files without a word, which the size of a 3MF shows.

**The adapter of `pako`** (`packages/deflate-pako`, `createPakoDeflater()`): `deflateRaw(bytes, { level: 6 })` of `pako` 2.1.0, pinned exactly, from its entry for deflate alone, `pako/lib/deflate.js` (CommonJS; the main entry of 2.1.0 brings inflate along). The package ships no types; the one function is declared in `src/pako.d.ts`. Level 6 is the default of zlib, stated so that no default of the library decides the bytes; the other options are the library's defaults (window 15, memory level 8, the default strategy). With them the stream is that of zlib at level 6 byte for byte (measured against zlib 1.2.12 and 1.3.2; [deflate.md](../d36/2g-export/deflate.md), "Measured" and "As implemented"). Creating it is synchronous, with nothing to load. When it cannot compress, 2.1.0 throws an `Error` for a stream it cannot set up and the message of zlib as a plain string for an error of the stream; the writer takes both. It is the only module of the repository that imports the library (D2).
