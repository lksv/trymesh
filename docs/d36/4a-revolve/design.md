# 4a Revolve (D58)

**State: design, written on 2026-11-17 against `master` at `d080fa8` and rebased on `fae5b78` (every package of steps 1 and 2, the grid of 2e, 3a, 3e, 5a, 5e and 5f merged; 3b and 3d designed), with the tool build and the circles of surfaces prototyped against the real kernel adapter ("Measured"), and revised after its reviews ("Reviews"). Not implemented.** Written by Claude Opus 5.5 (Fable was not available, owner, 2026-11-17). It needs 2b (the profile service with its exact outline, the face kinds and `circleBetween`) and 2e (the rule of a mirrored tool). It adds a feature type, a kind of `AxisRef` for every user of an axis, two kinds of surfaces and an issue code; no face role, no query, no schema step.

Files: [contract.ts](contract.ts) (the feature type with its patch and fields, the new kind of `AxisRef`, the sphere and the torus, the circles two surfaces meet in, the issue code, the tool build and the line of the fillet's table), [calls.ts](calls.ts) (validation scenario 14, its part of 4a).

## What the backlog says, checked against the code

[backlog.md](../../backlog.md): the row "Revolve" (pulleys with a V-groove, knobs, cones, O-ring grooves, countersinks; "another build of the tool over the same profile; the tool recipe is the interface; the axis is the `AxisRef` of the pattern; the description of a face gets a general kind beside the plane and the cylinder"), the part "Sphere and ellipsoid" (a sphere, a dome, a ball socket and a torus come with the revolve, as a half circle closed by a line on the axis; no separate primitive; "the engine builds the mesh of revolution itself as it builds the prism; the kernel port does not change"; "the spherical face is of the general kind … unless `FaceInfo` gets a sphere"), step 4 of the proposed order ("Revolve, then chamfer and fillet of straight and circular edges"), and the row of the edge fillet ("a circular edge between a plane and a coaxial cylinder: the same profile revolved about the axis, so it needs the tool of the revolve").

| Statement | What the code says |
|---|---|
| "Another build of the tool over the same profile; the tool recipe is the interface" | Holds. `ToolRecipe.build(targets, firstFaceId, placement?)` returns a `BuiltTool` (a solid and its faces with `FaceInfo`); `applyTool` and `toolResult` (`recompute/services.ts`) apply any recipe; a pattern repeats any recipe the state keeps. The profile is a service (`profile` in `recompute/profile.ts`, `profileSource` in `features/profile.ts`), and a resolved profile hands out its exact outline (`outline()`) for regions and walls |
| "The axis is the `AxisRef` of the pattern" | `AxisRef` is a base axis or the normal of a sketch plane through a sketch point. The second is perpendicular to its own sketch, so it can never lie in the plane of the profile's own sketch; a base axis lies in a base plane only. A sketch on an offset plane or on a face has no axis it could turn about. The kind the revolve needs is a line of a sketch, which the owner deferred "to come with the other kinds of `AxisRef`, for the pattern, the joints and the mass query together" (5a, "Open", 2026-11-16) |
| "The face gets a general kind" | `Surface` has `general` already (no feature makes one), and `FaceInfo` has none. A revolved arc is exactly a sphere or a torus; publishing it as general would leave every edge of it `other` (not projected, not measured), and the fillet of 4b is a torus too |
| "The kernel port does not change" | Holds ("Measured": every tool the prototype built was taken by the adapter as it is) |
| "A half circle closed by a line on the axis" | The line on the axis makes no face; its ends are poles of the mesh. A sketch can draw it today: an arc and a line between its ends |
| 2e: "a build places every vertex by the frame it is given; 4a inherits it" | `applyTool` turns over the tool of a mirrored placement. The revolve places every vertex through `toWorld(frame, u, v, w)` from coordinates of the sketch, the turn included, so it keeps the rule ("Measured", A) |
| 2d: "the table of profile sources will ask for the revolve's line" | `PROFILE_SOURCES` in `sketch-tools.ts` is typed over the feature types; the revolve answers its profile |

## The cheap variant

```ts
interface RevolveFeature extends FeatureBase {
  type: 'revolve';
  profile: RegionsProfile | WallProfile;  // as an extrusion takes it, without a generated profile
  axis: AxisRef;                          // + the new kind { kind: 'sketchLine'; sketch; line }
  extent: { type: 'full' } | { type: 'angle'; start: number; angle: number };  // radians
  operation: 'new' | 'add' | 'cut';
  targets?: Id[];
}
```

**In:**

- A profile of regions (with its offset) or a wall, from the profile service, as an extrusion has it.
- An axis that lies in the plane of the profile's sketch, as an `AxisRef`: a base axis or a line of a sketch (new). The profile lies on one side of it and may touch it.
- A whole turn, or a part of one from a start angle by an angle of either sign.
- `new`, `add` and `cut` with the targets of an extrusion; a pattern repeats a revolve; a mirrored copy is turned over.
- Faces named as for an extrusion of the same profile; surfaces exact: a plane across the axis, a cylinder, a cone, a sphere (new), a torus (new), and planar caps of a partial turn.
- Circles where two surfaces of revolution meet (the rims of a dome, a fillet of the profile), so the edges of a revolved part project and measure.
- The mesh within the chord tolerance of the exact body.

**Deferred:**

- A revolve up to a face or a plane, two sides with their own angles (a symmetric turn is `start: '-a / 2'`), a thin revolve other than a wall, a helix (step 7).
- A generated profile (a gear turned about a line of its own plane is no part; its sides are general curves).
- The axis of a bore or of a circular edge as a kind of `AxisRef` (the other kind the owner named with 5a).
- Adaptive steps of the turn (fewer near the axis).
- An edge of a cap with a cylinder or a cone (a straight line on a curved face) as a line a sketch projects.
- An ellipsoid (needs an ellipse in the sketch; backlog, "Sphere and ellipsoid").

## Document

**The feature** (`RevolveFeature`, contract.ts). Validated by a module `features/revolve.ts` with the validators of today:

- `profile`: `profileSource` of `features/profile.ts`; a generated profile is an invalid command ("a revolve takes regions or a wall"). The references are those of the profile (`profileRefs`).
- `axis`: `axisRef` of `validation.ts`, with the new kind; its references at `axis` (`axisRefs`). Whether it lies in the plane is a matter of the recompute, since the plane of a sketch on a face follows the model.
- `extent`: a variant by `type`. `full` has no field; `angle` has `start` (field `extent/start`, rad, any value) and `angle` (field `extent/angle`, rad, not zero, strictly between −2π and 2π). Another key of either variant is refused (`onlyFields`). A whole turn is `full`, never an angle: the range of the field ends before 2π, so an expression that reaches it is an invalid command (and, after a parameter changes, the error `invalidExpression` with the last valid value kept, as for every field). An angle a hair short of a whole turn passes; its two caps then nearly coincide ("Known limits").
- `operation`, `targets`: the rules of an extrusion (none for `new`, exactly one for `add`, at least one for `cut`, none twice, each a body of an earlier feature).
- The patch: `profile`, `axis`, `extent`, `operation`, `targets`, merged by the rules of `updateFeature` (a variant of the same `type` by field, another `type` replaced whole; a reference replaced whole; a change to `new` drops the targets unless the patch gives them; `{ profile: { offset: null } }` removes the offset). `normalize` is the extrusion's line; `removable` covers `targets` and `removableFromProfile` only, not `removableFromExtent`: a revolve has no taper and no gap, so `{ extent: { taper: null } }` is a key it does not know, refused like any other.
- `start` is required, as `start` of an extrusion's distance is. An optional start with a default was considered; an AI writes `start: 0` as it does for an extrusion.

**The numeric fields** (`FEATURE_TYPE_INFO.revolve.fields`): `profile/offset` and `profile/thickness` (from `PROFILE_FIELD_SPECS`, without the parameters of generators), `extent/start` and `extent/angle` with `when: extent/type = angle`. The app shows angles in degrees, as every `rad` field.

**The new kind of `AxisRef`: a line of a sketch.** `{ kind: 'sketchLine'; sketch; line }`, for every user of an axis at once:

- It is one member of `AxisRef` in `types.ts`, validated by `axisRef` (the sketch exists and lies before the referring feature; the line is a line of it: `requireRef` of the kind `entity` with `accepts: ['line']`; own lines, construction or not, and projected lines), listed by `axisRefs` (the sketch and the line) and resolved by `axis(ref, state)` in `recompute/services.ts`. The circular and the linear pattern with both directions of the grid, and the joints of the mechanism, take it without a change of their own (they normalise the direction and pass a code of `axis` on as their error).
- The argument kind `axis` of a query (`mass` with `about`) needs three lines more. `checkArgs` (`query/check.ts`) checks before `run` that what an axis names is in the state asked about; for `sketchPoint` it checks the point, so it gets a branch that checks the sketch and the line (`notAvailable` at `…/line`). `RefProblem` (`query/spec.ts`) gets `invalidAxis`, which `axis` of the context (`query/context.ts`) passes on instead of turning every code but `nonPlanarFace` into `brokenReference`; `mass` answers it as `notAvailable` at `about` with "the line of the axis has no length".
- The axis goes through the point `a` of the line in the direction from `a` to `b`; for a projected line the points `<line>/a` and `<line>/b` that the sketch reads from the body. A positive angle turns by the right-hand rule about that direction, as for every axis.
- In the recompute: a sketch that did not evaluate, or a line that has no place in it, is `brokenReference` with what is missing in `refs`; a line whose ends are not more than `LENGTH_TOLERANCE` apart is `invalidAxis` with the line in `refs`, for any user. A projected line whose edge is gone keeps its last valid place in the sketch (the sketch warns `brokenProjection`, `features/sketch.ts`), and the axis follows that frozen line, as an axis through a point of it (`<line>/a`) does today; only a projection that never had a place (no frozen value) leaves the line without one.
- The names a section of the document reserves (`namedBySections` of the mechanism, `sections/mechanism.ts`) get the sketch and the line of such an axis, as they have the sketch and the point of `sketchPoint`.
- The axis of a bore or of a circular edge, the other kind named with 5a, stays deferred: the revolve does not need it (a bore does not lie in the plane of a sketch that can draw the profile, unless the sketch is drawn through it, and then a line of that sketch is the axis). See "Open", 1.

**Schema.** No step. A build without this package refuses the document by itself: an unknown feature type and an unknown kind of an axis are each refused by `oneOf` of their validators, in a feature, in the transform of a pattern and in a joint of the section `mechanism` alike ([api.md](../../architecture/api.md), "load": "No step is needed where a build without the addition refuses by itself: a new feature type, a new variant"). The surfaces are not stored.

## Recompute

The step (`features/revolve.ts`), in this order; the first problem is the error of the feature.

1. **The profile.** `profile(feature.id, feature.profile, state, chordTolerance)`: `brokenReference`, `noProfile`, `invalidProfile` as for an extrusion (an offset or a wall that cannot be built carries its own message).
2. **The axis.** `axis(feature.axis, state)`: `brokenReference`, or `invalidAxis` for a line without length.
3. **The setup** (`revolveSetup`, `recompute/tool-revolve.ts`), once per step, in the coordinates of the sketch:
   1. *In the plane.* The direction of the axis is within `ANGLE_TOLERANCE` of the plane of the sketch, and its point within `LENGTH_TOLERANCE` of it; otherwise `invalidAxis` with the axis in `refs` and the angle or the distance in the detail. The axis used is its projection into the plane: a point and a unit direction in the coordinates of the sketch.
   2. *The exact outline* (`ResolvedProfile.outline()`; regions and walls always have one). A problem of it is the error with its message (regions that meet in a point are refused here, as by the taper: "Known limits").
   3. *One side.* For every curve of the outline its extreme signed distances from the axis: the ends of a line; the ends of an arc and the points of its sweep that lie straight across the axis from its centre; the centre of a circle plus and minus its radius. A distance within `LENGTH_TOLERANCE` is on the axis. When the outline reaches beyond the tolerance to both sides: `invalidAxis`, `refs` the axis and a curve on each side (the farthest), the detail how far each reaches. The side is that of the rest: `+1` left of the direction of the axis, `−1` right of it.
   4. *The polylines.* The outline divided again for **half** the chord tolerance (`outlineRegions` with the nesting of `nestingOf`, the keys of `curveOf`), with every test of a moved outline; a refusal is `invalidProfile` with the text of D44 (a very thin profile that the finer division no longer accepts). A vertex within `LENGTH_TOLERANCE` of the axis is put on it.
   5. *The steps.* The turn (2π for `full`, `|angle|` otherwise) is divided into `steps` equal steps by the rule of an arc (`segments` of `sketch.ts`) at the largest distance of a vertex of the polylines from the axis, for **half** the chord tolerance. So a vertex lies on the exact surface, a chord of the profile and a chord of the turn each leave it by at most half the tolerance, and the mesh is within the chord tolerance of the exact body ("Measured", B). The rule of an arc gives at least 8 steps for a whole turn and at most 4096, and so does the division of an arc of the profile: where 4096 do not reach half the tolerance (a whole turn at a radius above about 17 m at the tolerance 0.01, `0.005 / (1 − cos(π / 4096))`), the mesh is off by more, as an arc of an extrusion is ([extrude.md](../../architecture/extrude.md), "Profil"). The limit of the size below does not prevent it: a thin ring of radius 100 m with a tube of 1 mm has 262 144 triangles and is off by about 0.03 (codex, round 2), and a profile of lines only stays far below the limit at any radius.
   6. *The size.* The number of triangles follows from the polylines and the steps; above `MAX_REVOLVE_TRIANGLES` (1 000 000) it is `invalidProfile` with a message that gives the number and says to raise the chord tolerance of the document or to divide the part ("Measured", C: a cut of a tool of 1.7 million triangles took the kernel 27 s).
4. **The facts**: `axisPoint`, `axisDirection` (model coordinates, unit) and `steps`, for the feature itself.
5. **The recipe.** `build(targets, firstFaceId, placement)`: the frame of the sketch, or of the copy (`transformFrame`); `buildRevolve` with the setup (the axis in the coordinates of the sketch moves with the frame, so a copy turns about the copied axis); the faces of a copy tagged, as an extrusion tags them. The planar triangulation of the caps is a cache shared by the builds. The recipe does not depend on the targets.
6. **The operation**, as an extrusion: `new` stores the body under the ID of the feature; `add` and `cut` go through `applyTool` and `toolResult` (`brokenReference` of a target, `emptyResult`, `kernelFailure`, the warning `noEffect`; with 3b in the tree, `importedTarget`).

**The build** (`buildRevolve`, `recompute/tool-revolve.ts`). The coordinates of the sketch are `(u, v, w)`, `w` along the normal of the sketch plane. The axis is the point `o` and the unit direction `d`; `e` is the unit vector in the plane across `d` towards the profile (`side` times the left normal of `d`). A vertex of the profile at the distance `t` along the axis and `ρ` from it is placed at the angle `φ` at

```
o + t·d + ρ·cos φ·e + ρ·sin φ·side·ŵ        (then toWorld(frame, u, v, w))
```

which is the right-hand turn about `d` in a right-handed frame (`d × e = side·ŵ`). Nothing is computed in model coordinates, so a mirrored frame gives the mirror image and `applyTool` turns it over (2e).

- A vertex on the axis is one vertex of the mesh. Every other vertex has `steps` copies for a whole turn (the last step closes onto the first) and `steps + 1` for a partial one, at `start + j · angle / steps`.
- Every edge of a loop, from `p` to `q` with the key of its curve, gives between the angles `j` and `j + 1` the triangles `(p_j, q_j, q_j+1)` and `(p_j, q_j+1, p_j+1)`; one of them where an end lies on the axis, none where both do (a curve along the axis makes no face). The triangles are turned over when the profile lies on the right of the axis or the angle is negative, not when both. Measured on profiles on both sides of an axis, with positive and negative angles ("Measured", A).
- A partial turn has the two caps: the regions triangulated by the kernel once, placed at the start (`startCap`) and at the end (`endCap`). The start cap keeps the winding of the triangulation when the profile lies on the right of the axis and the angle is positive, or on the left and the angle negative; the end cap in the other two cases.
- A vertex on the axis whose two edges both leave it (a diamond that touches the axis in a corner) makes a body pinched to a point in a whole turn. The kernel takes it with one vertex there, also as the target of a cut across the point and of a union through it ("Measured", A); the build does nothing special.
- The faces: `startCap` and `endCap` (a partial turn), then the sides in the order of their keys.

## Faces

The names are those of an extrusion of the same profile, so everything that reads a face by its curve reads a revolve too (the fillet of 2d, the app's labels, an AI):

| Profile | Name | Surface |
|---|---|---|
| a line across the axis | `side` with the curve (`wallSide`, `wallEnd` for a wall) | a plane across the axis: an annulus or a disc |
| a line parallel to the axis | the same | a cylinder about the axis |
| any other line | the same | a cone about the axis: the apex where the line meets the axis, the axis pointing from the apex to the face, the half angle between the line and the axis |
| a line on the axis | none | |
| an arc or a circle whose centre lies on the axis | the same | a sphere (new) |
| an arc or a circle whose centre lies off the axis | the same | a torus (new): the centre the point of the axis nearest to the centre of the arc, the minor radius the radius of the arc, the major radius the distance of the centre of the arc from the axis, **signed**: positive when the centre lies on the side of the axis the profile lies on, negative when it lies across the axis (an ogive, a lemon) |
| the profile at the start and at the end of a partial turn | `startCap`, `endCap` | planes through the axis |

"Across", "parallel" and "on" are decided by the move of the ends, not by an angle: a line whose two ends differ by at most `LENGTH_TOLERANCE` in their distance from the axis is a cylinder, in their place along it a plane, and a centre within `LENGTH_TOLERANCE` of the axis is a sphere. A cone whose apex lies kilometres away would only lose its precision (the rule of the taper, D45). The descriptions are computed from the exact curves (`sideOf(key).shape`, after an offset or for a wall the moved curves), in the coordinates of the sketch, and placed with the frame (`transformFace`).

**A sketch on a face.** Only a plane can carry one.

| Face | Origin | Y | Normal |
|---|---|---|---|
| a side from a line across the axis | the start `a` of the line, turned to the start of the turn | the normal of the half plane of the profile at the start angle, in the direction the angle grows: `cos(start)·side·ŵ − sin(start)·e` in the coordinates of the sketch (`ŵ` the normal of the sketch plane, `e` the direction from the axis towards the profile; `start` is 0 for a whole turn). It does not depend on `a`, which may lie on the axis | out of the body |
| `startCap`, `endCap` | the origin of the profile's sketch turned to the start or to the end of the turn | the Y axis of that sketch, turned the same way | out of the body |

X = Y × N, as for every face. So a sketch on the start cap of a turn that starts at 0 has the frame of the profile's sketch with the normal out of the body, and a sketch on a side face starts where its line starts, which is the rule the fillet of 2d uses to name what moved (`ids.moved`).

**Edges.** Two neighbouring curves of the profile meet in a circle about the axis (or in a point on it); with the circles of the next section such an edge has the kind `circle` and projects. Not where the two surfaces meet in two circles too close for the mesh to tell apart ("Known limits"), and not where the two faces lie on one surface: two arcs of one circle in the profile, or two collinear lines along a cylinder or a cone, stay `other` as today, and two collinear lines across the axis are two faces of one plane, `coplanar`. A cap meets a side across the axis in a line, a sphere and a torus in a circle (for a torus the circle whose centre lies at the signed major radius from the axis towards the side the cap lies on: on that side for a positive one, across the axis for a negative one, the lemon, whose two circles in that plane cross on the axis), and a cylinder or a cone in a straight line that has the kind `other` ("Known limits").

## Surfaces and the circles they meet in

**Two kinds** (contract.ts, `SphereSurface`, `TorusSurface`), in `Surface` (types.ts, published in `faceSurfaces`) and in `FaceInfo` (solid.ts): a sphere (`center`, `radius`) and a torus (`center`, `axis` without a sign, `majorRadius`, `minorRadius`). The major radius is signed. In every half plane through the axis the face lies in, the centre of its tube is the point at `majorRadius` from the axis towards that half plane: on its side when positive, across the axis when negative. A ring torus (|major| > minor) is positive; a face swept by an arc whose centre lies across the axis (a part of a spindle torus) is negative, and that is the only way to tell the two parts of a spindle torus apart, which meet a plane in different circles. `surfaceOf`, `transformFace` and `transformSurface` get their lines (`transformFace` and `transformSurface` become exhaustive switches, so a kind forgotten there does not compile: today `transformFace` ends in a line that would move the axis of a torus and not its centre); neither is planar, so a sketch on one is `nonPlanarFace`. The general surface stays what no feature makes.

**The circles of two surfaces** (`surfaces.ts`). `circleBetween(a, b)` answers the one circle two surfaces meet in, from the surfaces alone; with the sphere and the torus two surfaces can meet in two circles (a torus and a plane across its axis, a sphere and a coaxial cylinder). It becomes:

- `circlesBetween(a, b)`: every circle the two meet in, exact:
  - first, two faces of one surface give none (the same plane, cylinder, cone, sphere or torus within the tolerances), before any test of touching;
  - a sphere and any plane: one, unless the plane is within `LENGTH_TOLERANCE` of touching the sphere (then none: a point); two spheres: one, about the line of their centres, unless they touch within that (none);
  - two surfaces about one axis (a plane across it, a cylinder, a cone on the half its axis points along, a sphere whose centre is on it, a torus): where their curves meet in a half plane through the axis, `ρ` the distance from the axis and `z` the place along it: a horizontal line, a vertical line, a ray, a circle; for a torus the circle centred at `ρ` = its signed major radius. A meeting point with `ρ > LENGTH_TOLERANCE` is a circle; a point with `ρ ≤ LENGTH_TOLERANCE` is none (on the axis, or across it and so not on the face), never folded back to `|ρ|` (a torus R −3, r 10 meets the plane 5 above its centre in one circle, of radius 5.66). At most two. Touching is tested on the distance, in both directions: a line whose distance from the centre of a circle differs from the radius by at most `LENGTH_TOLERANCE` meets it in one point, the foot of the perpendicular from the centre; two circles whose distance differs from the sum or the difference of their radii by at most that meet in one point, on the line of their centres at the radius of the first from its centre. So a fillet of the profile, tangent to its neighbours, gives one circle whether the solver left the two a hair apart or a hair across;
  - a torus and a plane that holds its axis: the two circles of the tube in that plane, centred at the signed major radius from the axis towards either side (each one, for a negative major radius, centred across the axis from the side it reaches out to); the edge of a cap of a partial turn with a torus;
  - nothing else.
- `circleBetween(a, b, points?, tolerance?)`: the only circle; of two, the one the points of the edge say, when they can say it; otherwise undefined (also when two are possible and no points are given). The mesh of an edge does not lie on its exact circle: each of the two faces is a polygon that leaves its surface by up to the chord tolerance, and where the two surfaces meet at a small angle θ the line where the polygons meet moves along them by about `tolerance / sin θ` (a reviewer measured a plane cut near the top of a tube of radius 3, and a ball in a coaxial bore of nearly its radius: in half the phases of the division the edge lay nearer to the other circle). So:
  - **The reach of a circle** is `2 · tolerance / sin θ` plus the precision of the coordinates (the formula of `coordinatePrecision`, 1e-6 of the largest coordinate of the points, at least of 1 mm), with θ the angle at which the two curves in the half plane meet there (known exactly with the circle; the two candidates of a pair meet at the same angle) and `tolerance` the chord tolerance of the document. Without a tolerance two candidates give undefined.
  - **The distance of two coaxial circles** is that of their points in the half plane, `hypot(ρ₁ − ρ₂, z₁ − z₂)`; a point lies within the reach of a circle when its shortest distance to the circle is not more than the reach.
  - **Two circles about one axis** are told apart only when their distance is more than the sum of their reaches. Then the chosen one is the circle every point of the edge lies within the reach of; when no circle has all the points, or the two are closer than that (a tube thinner than about twice the tolerance against a plane, a cut near the top of a tube, a ball in a bore of nearly its radius), the edge is `other`. This is conservative: an edge that is `other` loses its projection, never gets a wrong circle, unless its mesh leaves the edge by more than the estimate.
  - **A torus and a plane that holds its axis**: the two circles are mirror images across the axis and cross on it (a spindle torus), so the side decides: the side of the axis, in that plane, the points lie on, the points within `LENGTH_TOLERANCE` plus the precision of the coordinates of the axis left out (a pole stored in float32 lies a few 1e-6 off it); points on both sides give `other`. The chosen circle is the one centred at the signed major radius towards that side.
  - The circle itself is computed from the surfaces; the mesh only says which one the edge is, as it only says how far a straight edge reaches.

The pairs of today get the answers of today: measured on 20 000 random pairs of planes, cylinders and cones, coaxial and not ("Measured", E).

**Who passes the points.** `edgeKind` in `analyzeBody` (solid.ts) decides the kind after the segments of the edge are collected (today it is decided when the edge is first met); `projectEdge`, the description of a body (`query/body.ts`) and the shape of an entity (`query/entity.ts`) pass `edge.segments`. The queries read the tolerance from `context.state.document.settings`, and the section passes it with the points of a span. A posed body moves its segments in double precision, so a query may find an edge at the boundary of a reach `other` where the evaluation found a circle; it then answers it as `other`. The tolerance is the chord tolerance of the document: `State` gets it as a field (`chordTolerance`, set where the evaluator builds the state before the first feature), and the three callers of `analyzeBody` (the evaluation of the bodies in `evaluate.ts`, a projected edge in `features/sketch.ts`, `frame` in `recompute/services.ts`) pass it; a change of the setting recomputes every feature, so the memo of `analyzeBody` by the solid stays right. This changes the principle of 00-prep that "the rule has to be decidable from the two surfaces alone" in one point: which of the circles of two surfaces, never whether the edge is exact.

**The readers of a surface** get the two kinds:

| Where | Sphere | Torus |
|---|---|---|
| `entityShape` (query/entity.ts) and `measure` | `{ is: 'sphere', center, radius, convex }`; distances are taken to the centre (a point) | `{ is: 'torus', center, axis, majorRadius, minorRadius, convex }`; distances are taken to the axis (a line), as from a cylinder, so two tori about one axis are 0 apart; the direction is the axis. The texts of `measure` name both kinds |
| the description of a body (query/body.ts) | `convex`: the material is on the side of the centre (a ball) | `convex`: the material is on the side of the centre of the tube (a ring, a bead; the centre taken in the half plane of each triangle by the signed major radius); false for a groove |
| the section (query/section.ts) | `circleIn` becomes `circleBetween(surface, the plane of the section, the points of the span)`, so the cut of a sphere by any plane is an arc, and of a torus by a plane across its axis or through it | |
| the clearance of 3d (`movedOutwards`), when both are merged | the radius moves by the clearance away from the material: a ball grows (r + c), a socket shrinks (r − c), and a socket with r ≤ c closes (the problem `closes`) | the minor radius likewise: a ring or a bead grows, a groove shrinks and closes when r ≤ c; a ring whose hole would close (`|R| − r − c ≤ 0` for a positive R) is `closes` too; the centre of the tube, and so the signed major radius, stays. A vertex on the axis (the tip of an ogive) has no half plane of its own, but its distance from the torus is the same in every one (`|√(R² + z²) − r|`): it moves along the axis only, to the point of the axis at the clearance from the moved surface, out of the material. What closes is decided per vertex: a moved vertex that leaves its half plane (ρ ≤ 0, the tube no longer reaching it) is the problem `closes` |

`circleIn` of the section is not `circleBetween` today: it takes the radius of a cone on either half (`Math.abs(along)`) and has no lower bound of the radius. For a face of a cone cut across its axis the two agree (the cut of a face lies on its half); that the section keeps its answers is to be verified on its tests and on random cuts ("To verify"), not a measured fact.

## Issue codes

`invalidAxis`, an error: the axis cannot be used.

- A line of an axis of the kind `sketchLine` has no length: any user (a revolve, a pattern, a joint); `refs`: the line.
- A revolve whose axis does not lie in the plane of the profile's sketch: `refs` the axis, the detail the angle or the distance.
- A revolve whose profile lies on both sides of its axis: `refs` the axis and a curve on each side, the detail how far each reaches.

`MESSAGE.invalidAxis`: "The axis cannot be used: its line has no length, or for a revolve it does not lie in the plane of the profile or the profile lies on both sides of it." The other codes are those of today: a size of the tool above the limit and a finer division that fails are `invalidProfile` with a message of their own, as a generator's are.

## Where the code lives

| File | What |
|---|---|
| `features/revolve.ts` | The module: validator, references, `createsBody`, `producesTool`, the patch, the step |
| `features/index.ts` | One line in `FEATURE_TYPES`; the text of a reference of the kind `tool` names the revolve ("an extrusion or a revolve with the operation add or cut, a hole") |
| `recompute/tool-revolve.ts` | `revolveSetup`, `buildRevolve` and the surfaces of the sides |
| `types.ts` | `RevolveFeature` and its patch, the member of `AxisRef`, the two members of `Surface`, `invalidAxis`; the comments of `FaceName` (`startCap` of a turn), `PatternFeature` (a revolve is a source) and `Surface` |
| `validation.ts` | `axisRef` and `axisRefs` with the new kind |
| `recompute/services.ts` | `axis` with the new kind; `MESSAGE.invalidAxis` |
| `solid.ts` | `FaceInfo` with the two kinds, `surfaceOf`, `transformFace`, `transformSurface`; `edgeKind` after the segments; `projectEdge` passes them |
| `surfaces.ts` | `circlesBetween`, `circleBetween` with the points |
| `query/entity.ts`, `query/measure.ts`, `query/body.ts`, `query/section.ts` | The lines of the table above |
| `sections/mechanism.ts` | The names an axis of the new kind reserves |
| `query/check.ts`, `query/spec.ts`, `query/context.ts`, `query/mass.ts` | The check of a line before `run`; `invalidAxis` in `RefProblem`; the context passes it on; the text of `mass` and the comment that its axis is "a base axis or a sketch point" |
| `recompute/state.ts`, `evaluate.ts`, `features/sketch.ts`, `recompute/services.ts` | `State.chordTolerance`, and the three callers of `analyzeBody` pass it |
| `sketch-tools.ts` | The line of `PROFILE_SOURCES`; the summary of the fillet names the torus of a revolve |
| `features/pattern.ts` | The summary names the revolve among the sources |

The imports go one way, as `modules.test.ts` guards: `features/revolve.ts` imports `recompute/` and `features/profile.ts`, never the extrusion.

## The app and MCP

**The app.**

- `FEATURE_UI.revolve` (`features/revolve.ts` of the app) and the button in `TOOLBAR` after the extrusion. The form, top to bottom: profile (*Sketch regions* or *Wall along curves*; no generators), sketch, regions picked in the view with their offset or the curves of a wall with its thickness, the axis, the extent (*Whole turn* or *Angle* with the start and the angle, in degrees), the operation, the targets. The facts of the preview are shown (the number of steps); its problems as for an extrusion.
- The picking of regions and curves of a wall moves from the extrusion's form into a module of its own (`features/profile-picker.ts`), unchanged, in a commit with nothing else; both forms use it.
- The axis picker (`axis-picker.ts`, `changeAxis` and `AxisKind` of `sketch-commands.ts`) gets the kind *Along a line of a sketch*: a select of the sketch and a select of its lines (own lines, construction ones marked, and projected ones). Choosing the kind takes the first line of the latest of the offered sketches that has one; the kind is not offered while none has a line (a point always has the origin, a line has no default). Another sketch takes its first line. The pattern (both directions of a grid) and the joint of the mechanism get it with the picker.
- The control of the argument kind `axis` of the generic query form (`queries/controls.ts`) builds its own choice (a base axis or a sketch point); it gets the line the same way.
- The texts that take every axis that is not a base axis for a point: the summary of a pattern (`features/pattern.ts` of the app, both kinds) and of a joint (`panels/mechanism.ts`) read "along the line ka of knobS". The compiler finds them (the property `point` is gone from the new kind).
- The default axis of a new revolve: the first construction line of the profile's sketch; else the base axis that lies in the base plane of the sketch (Z for XZ and YZ, Y for XY); else a line of the sketch; else Z, which the preview then reports as `invalidAxis`. The default operation as for an extrusion (an addition to the body whose face the sketch stands on).
- The view draws the axis of the draft and of a selected revolve as a line through the profile.
- The model panel: "Revolve of <sketch> about <axis>, a whole turn" or "… by 90°".
- `docs/ui/revolve.md`, a file of its own; `docs/ui/pattern.md`, `docs/ui/mechanism.md` and `docs/ui/queries.md` get the row of the axis.

**The documents of the architecture** at the implementation: `docs/architecture/revolve.md`, a file of its own with its row in `docs/architecture.md`; `naming.md` (the two surfaces, the circles of two surfaces and the points of an edge, the frames of a sketch on the faces of a revolve, the new kind of `AxisRef`); `pattern.md` (the axis of a line); `api.md` (the code); `extrude.md` (the tool recipe names the revolve as a second build).
- The snapshots of `app.test.ts` change by the toolbar; the commit says so.

**MCP.** Nothing new is a tool: the feature type, the kind of an axis, the surfaces and the code reach `describe_api` from `types.ts`. `api.ts` gets a paragraph on the revolve after the one on the hole (the axis in the plane, a construction line or a base axis, the half profile on one side, a whole turn or an angle, the names of the faces, a sphere from a half circle closed by a line on the axis, the code `invalidAxis`), and the paragraphs on the pattern and the mechanism name the new kind of axis. The `returns` text of the query `body` names the sphere and the torus.

## Shared vocabulary

- **Takes:** the profile service and its exact outline with `outlineRegions` and `nestingOf` (2a, 2b), `ToolRecipe`, `BuiltTool`, `applyTool`, `toolResult`, `withFaces` (track B), the rule of a mirrored tool (2e), `AxisRef` with `axisRef`, `axisRefs` and `axis` (00), `segments` of `sketch.ts`, the face roles of the extrusion and of a wall, `circleBetween` and its callers (2b, 1b).
- **Adds:** the kind `sketchLine` of `AxisRef` for every user; the surfaces `sphere` and `torus`; `circlesBetween` and the points of an edge in `circleBetween`; `invalidAxis`; `buildRevolve` as a build any feature can call with a setup of its own (4b).

## Measured

All in the session scratchpad, against the real kernel adapter (`packages/kernel-manifold`, `manifold-3d` 3.5.5) and the engine of `master` at `d080fa8`; nothing in the repository was changed. The prototype is a build of the tool (`revolve-proto.ts`) and the circles of surfaces (`circles-proto.ts`), each about a hundred lines, run by vitest with a configuration of its own whose root is the worktree. In A the turn was divided for the full chord tolerance; B compares that with half.

**A. Tools the adapter takes.** Every tool below is a closed mesh the adapter took as the operand of a union with a box far away (its checks of the input: closed by its indices, facing outwards). The volume is against the exact one (Pappus, or the formula).

| Tool | Chord tolerance | Steps | Triangles | Volume, relative to exact |
|---|---|---|---|---|
| a pulley, a polygon of 8 lines with a V-groove (radius 4 to 20, 15 wide), a whole turn | 0.01 | 100 | 1 600 | −6.6e-4 |
| the same | 0.001 | 315 | 5 040 | −6.6e-5 |
| the same, 90° | 0.01 | 25 | 412 | −6.6e-4 |
| the same, from 0.3 rad by −4 rad | 0.01 | 64 | 1 036 | −6.5e-4 |
| the same drawn on the other side of the axis | 0.01 | 100 | 1 600 | −6.6e-4 |
| a ball of radius 10 (a half circle and the line on the axis) | 0.01 | 71 | 4 970 | −3.2e-3 |
| the same, 270° (the two caps meet along the axis) | 0.01 | | 3 780 | −3.2e-3 |
| the ball | 0.001 | 223 | 49 506 | −3.3e-4 |
| a torus, R 20, r 5 | 0.01 | 112 | 11 200 | −3.2e-3 |
| the same | 0.001 | 352 | 111 232 | −3.2e-4 |
| a cone (a triangle with a side on the axis) | 0.01 | | 142 | −1.3e-3 |
| a hollow ring (a region with a hole: a body with a closed cavity) | 0.01 | | 21 432 | −2.0e-3 |
| a diamond that touches the axis in a corner (pinched), one vertex there | 0.01 | | 426 | −1.3e-3 |
| the same, a vertex per strip | 0.01 | | 426 | −1.3e-3 |
| the pinched diamond, 270° | 0.01 | | 322 | −1.3e-3 |

- The pinched body as a target: a cut by a slab across the pinch and a union with a post through it both pass the adapter. So the build keeps one vertex there.
- **Mirrored**: the pulley over 2 rad built in the frame of XZ reflected in the plane x = 30 has the volume −4515.39 as built (inside out) and +4515.39 turned over, the same as the tool built unmirrored; every vertex is the reflection of the unmirrored one within 2.4e-6 (float32). The rule of 2e holds without a line in the build.
- **Flush and cuts** (the adapter's guarantee for flush faces): a dome of radius 10 on a plate whose top is the plane of the dome's base: the union has the sum of the two volumes exactly and the base of the dome is gone. An O-ring groove (a rectangle at the radius 8.5 to 12) cut from a shaft of radius 10 made by a revolve: the bottom and the top planes and the inner cylinder of the groove are in the result, the outer one is not. A quarter of the top of the shaft cut away by a partial revolve of a rectangle that reaches the axis: both caps and its bottom are in the result.

**B. The chord tolerance.** The ball of radius 10, the deepest point of the mesh inside the exact sphere, sampled on 28 points per triangle:

| Division | Steps | Triangles | Deepest |
|---|---|---|---|
| the arc and the turn each for the tolerance 0.01 | 71 | 4 970 | 0.0193 |
| each for half of it | 100 | 9 800 | 0.0099 |

The two chords add up, as expected for a quad whose corners lie on the surface: twice the tolerance where both the profile and the turn are curved. Half each keeps the promise of the tolerance at about twice the triangles for a ball or a torus; a profile of lines only (no curve to divide) pays 1.4 times the steps. See "Open", 2.

**C. Size and time.** A torus R 100, r 50 at the tolerance 0.001 (so divided for 0.0005): 1 217 steps, 1 711 102 triangles, built in 344 ms; the adapter cut it with a box in 26.8 s. A knob of radius 30 with two round corners at the tolerance 0.01 (divided for 0.005): 173 steps, 9 688 triangles, built in 4.6 ms. Hence the limit of a million triangles: a part of ordinary size at the default tolerance is two to three orders below it.

**D. The cost of steps.** The steps are those of the largest radius for every vertex; a profile near the axis is divided as finely as its rim. For the pulley that is 100 steps at a radius of 4 where 32 would do; the triangles grow with the number of vertices times the steps, not more.

**E. The circles of two surfaces.** The prototype (`circlesBetween` and `circleBetween` with points, by the curves in a half plane through the axis of "Surfaces and the circles they meet in") against `circleBetween` of `master` on 20 000 random pairs of planes, cylinders and cones (80 % about the axis Z, the rest about a random axis; a tenth of the planes tilted): the same circle or none for every pair. The new pairs, about the axis Z:

| Pair | Circles | Chosen by the points of |
|---|---|---|
| a torus R 20 r 3 at z 10 and the plane z = 11 | r 17.17 and r 22.83 | the outer circle: r 22.83; both circles: none |
| the torus and the plane z = 13 (touching its top) | r 20 | |
| the torus and a cylinder r 23 (touching outside) | r 23 at z 10 | |
| the torus and a cylinder r 22 | r 22 at z 7.76 and 12.24 | the lower circle |
| the torus and a cone of 45° from (0, 0, −10) | r 17.88 at z 7.88, r 22.12 at z 12.12 | the inner |
| the torus and the plane XZ (through its axis) | the two tubes, at x = −20 and x = 20, r 3 | the one at +x |
| a ball r 10 and a tilted plane | one circle, r 9.165 | |
| two balls (r 10 at 0, r 5 at z 12) | one circle, r 4.091 at z 9.125 | |
| a ball r 10 and a coaxial cylinder r 6 | z −8 and z 8 | the upper |
| the ball and the cylinder off its centre | none | |
| a ball and a plane through its centre (the cap of a partial turn) | the great circle | |
| a torus and itself | none | |
| a fillet of a knob, a torus R 27 r 3 at z 17, and the plane z 20 / the cylinder r 30 (both touching) | r 27 at z 20 / r 30 at z 17 | |
| the same with the cylinder r 30 + 1e-9 | r 30 at z 17 | |

The prototype tested touching only where the two curves miss each other: a reviewer's probe with the cylinder r 30 − 1e-9 got two circles 1.5e-4 apart, and with 30 − 1e-12 two 4.9e-6 apart, which the points of the mesh would split between. The rule above tests touching on the distance in both directions; the implementation's tests take both rows. The same probe found that a torus with a negative major radius (R 3, r 10, an arc centred across the axis) met the plane z = 5 at the radius 11.66 by the circle centred at +3, where the face meets it at 5.66: hence the signed major radius.

## Rejected alternatives

1. **The axis as a line of the profile's own sketch only** (`axis: Id`). No change of a shared type; but no base axis (the natural "about Z" of an AI), no axis from another sketch or from a projected edge, and the pattern and the joints would not get the line that the revolve makes common. A revolve of a part placed by a sketch on a face would need its axis drawn in that very sketch, which it can, so this is the fallback if the owner does not want the new kind now ("Open", 1).
2. **The two kinds of `AxisRef` of today.** The normal of a sketch through a point is perpendicular to that sketch, so it never lies in the plane of the profile's own sketch; a base axis lies only in a base plane. A part off the origin could not be revolved without a plane feature and a second sketch built only to hold a point.
3. **Roles of its own** (`revolveSide`, `revolveStart`, `revolveEnd`). The face is made by the curve exactly as the side of an extrusion is, and a cap is the profile at the start or the end of the extent; new roles would make the fillet's `moved` rule, the labels of the app and every reader of `side` learn a second name for the same thing.
4. **A general surface for a revolved arc.** Every edge of it would be `other`: the rim of a dome not projected, a ball not measured, the fillet of 4b (a torus) without its circles.
5. **A primitive sphere or torus.** The backlog: no separate primitive is needed; the half circle closed on the axis is two curves.
6. **The library's `revolve`** (Manifold's `CrossSection` turned). It would be a member of the kernel port, its faces have no names of the profile's curves, its division is its own, and the rule of a mirrored copy would have to be proved for it. The engine builds every tool itself (D35).
7. **The turn and the profile divided for the whole tolerance.** Half the triangles of a ball, and up to twice the tolerance off the exact surface ("Measured", B). The promise of the chord tolerance is the reason it exists; 2b paid for it with its rule of levels.
8. **Adaptive steps** (fewer near the axis). The rings would not pair point by point and the mesh would need joins between rings of different counts; the stack of 2b keeps the same count for the same reason.
9. **Refusing a profile that touches the axis in a corner.** The adapter takes the pinched body as it is ("Measured", A).
10. **The kind of an edge from the surfaces alone, ambiguous pairs `other`.** A tangent fillet needs no points (the touching rule gives one circle). The points serve a torus or a sphere cut at a corner (a groove's torus against a plane across the axis at a good angle, a ball in a coaxial bore) and the cap of a partial turn with a torus, which would otherwise not project. Their price: the chord tolerance in the state of the recompute and a kind of an edge that depends on the mesh, made conservative by the reach.
11. **A revolve as a variant of the extrusion** (an extent `{ type: 'revolve', axis, angle }`). An extrusion runs along the normal of its sketch, with "through all", "up to a plane" and a taper, none of which a turn has; the caps mean something else; a type is one line of the registry.
12. **An optional start angle with the default 0.** The extrusion's distance has a required start; the two read alike.
13. **A generated profile.** A gear turned about a line in its own plane is no part, and its sides would be general surfaces.

## Known limits

- The edge of a cap of a partial turn with a cylinder or a cone is a straight line on a curved face; it has the kind `other` and does not project (as the edge of a planar face along a cylinder of an extrusion today).
- Two faces on one sphere or one torus (two arcs of one circle drawn in the profile) meet in a seam of the kind `other`, as two faces of one cylinder do today.
- An edge made of both circles two surfaces meet in (a torus cut through by a plane on both sides of its tube) is `other`.
- Selected regions that meet in a point are refused (`invalidProfile`), because the revolve divides the exact outline again; an extrusion takes them.
- A vertex is copied at the steps of the largest radius ("Measured", D).
- The polygons of a revolve and of an extrusion of the same circle have different numbers of sides (the revolve's come from its largest radius and half the tolerance), so a pin of one in a bore of the other is a `fit` of the collisions, as two polygons always are.
- A body pinched to a point is what the profile says; the engine keeps it. The kernel takes it ("Measured", A); the section, the 3MF and the print check of such a body are to be verified.
- A curve of the profile that touches the axis inside an arc or a circle (a circle tangent to the axis, a horn torus) touches it in the mesh only where a vertex of its polyline falls within `LENGTH_TOLERANCE` of the axis. Otherwise the mesh leaves a hole about the axis narrower than half the chord tolerance (0.0049 for a circle of radius 9 at 0.01, measured by a reviewer), which is within the tolerance and not the point of contact the exact body has.
- Two circles of two surfaces closer than the sum of their reaches (a tube thinner than about twice the chord tolerance against a plane, a plane cut near the top of a tube, a ball in a bore of nearly its radius) are not told apart: the edge is `other`. The reach is an estimate; a mesh that leaves its edge by more could still be given the other circle, which the fuzz of "To verify" is to show or rule out.
- An angle a hair short of a whole turn has two caps that nearly coincide; the kernel may refuse the tool (`kernelFailure`) or leave slivers. A whole turn is `full`.
- A whole turn has no cap and so no face a sketch could stand on but its planar sides.
- The limit of a million triangles is a policy, not a measure of a machine.
- The reach assumes every polygon lies within the chord tolerance of its surface. The round faces of a tool moved by the clearance of 3d are flatter by up to `ROUND_ALLOWANCE` of the clearance (3d, "How exact the pocket is"); a small-angle edge of such a pocket could then get the wrong circle. Adding that allowance to the reach of the faces of a moved tool is left to the implementation of whichever of 3d and 4a comes second.

## To verify before the implementation

- That `edgeKind` decided after the segments changes no kind of an existing edge: the hashes of the meshes and the snapshots of the app stay, and the tests of 1b (edges of a countersink) pass.
- That the section of 1a, with `circleIn` through `circleBetween`, gives the spans it gives today: its tests, the DXF of 2g, and a comparison of the two on random cuts of cylinders and cones.
- The tolerances of "in the plane" with a line of another sketch at coordinates of a few hundred millimetres, and with a sketch on a face whose plane passes through the axis.
- A fuzz of the build over random profiles of lines and arcs that touch the axis (in a point, along a line, tangent), whole and partial turns of either sign: every tool closed, facing outwards, taken by the adapter, with its volume within the tolerance of Pappus.
- The time of `analyzeBody` on a revolved body (each circular edge now chooses among candidates by its points).
- A pinched body through the section, the 3MF export and the print check.
- Faces of spindle tori (an ogive, a lemon) against planes, cylinders and other tori, with the signed major radius, in the tests of `circlesBetween`; a partial lemon whose cap edge projects, about an axis at x = 60.1 and a tilted one (poles off the axis by float32).
- A fuzz of `circleBetween` over booleans at small angles (a plane cut near the top of a tube, a ball in a nearly equal coaxial bore, at many phases of the division): never a wrong circle, `other` where the reach says so.
- Whether the limit of a million triangles is right on the machine of the app (a preview runs on every keystroke but for the slow ones, `SLOW_PREVIEW`).

## Open

For the owner, each with the default the design takes:

1. **The kind `sketchLine` of `AxisRef` comes with 4a, for every user of an axis.** The owner deferred "the other kinds of `AxisRef`" to come together (5a, 2026-11-16). The revolve cannot do without a line of a sketch; the axis of a bore can wait. *Does 4a bring the line of a sketch as a kind of `AxisRef` for the revolve, the pattern, the joints and the queries now, and the axis of a bore later?* Default: yes. The alternative is rejected alternative 1, a line of the profile's own sketch for the revolve alone.
2. **The tessellation keeps the chord tolerance.** *Is a revolved part to stay within the chord tolerance at about twice the triangles for a ball or a torus (default), or may it be up to twice the tolerance off with half the triangles?*

## For the plan

- **4b** (chamfer and fillet of edges): a circular edge between a plane and a coaxial cylinder gets its tool from `buildRevolve` with a setup of its own (a triangle or a corner less a quarter circle in a half plane through the axis of the edge, its own `sideOf` and roles). Its fillet face is a torus, its edges circles by `circlesBetween`. Scenario 14 is the scenario 4b continues: the rims of the pulley and the bottom of the knob.
- **3d** (the clearance): `movedOutwards` gets a line for the sphere (the radius) and the torus (the minor radius), whichever of 3d and 4a is merged second; until then a face of either is the problem `noSurface`.
- **3b**: a revolve that adds to or cuts an imported body ends in `importedTarget` through `applyTool`, as every tool.
- **3e**: a revolved body is a row of the parts list like any body; a revolved countersink is no hardware (hardware comes from the labels of hole features).
- **5c** (a plane tilted about a line): the line of a sketch is an `AxisRef` now.
- **5a**: a joint takes a line of a sketch as its axis.
- **2e, the grid** (merged on `master` since this design was started): its two directions take the line of a sketch with the rest of the pattern.

## Holes in the contract

A contract cannot restate a type another package owns, so some promised calls are not written in calls.ts:

- The pattern (`PatternFeatureD` of 2e, with the `AxisRef` of today): a circular pattern about a line and a linear one along it are added as a command of their own (`addPatternAboutLine` in `Commands`, the spacing variant only); a patch of a pattern with a line, the length variant and a grid with a line are not written.
- A joint of the mechanism (`setJoint` of 5a) and the argument `about` of the query `mass` (1d) with a line are not written: their argument types are those of their contracts.
- The results of the queries `body` and `measure` are typed by 1b with the `Surface` and `EntityShape` of today; calls.ts reads the surfaces from `faceSurfaces` of the evaluation (`StateD`) instead, and of `measure` only the distance.

In the code all of them are the one member of `AxisRef` and the two of `Surface`; the unions of `types.ts` reach every place at once.

## Tests the implementation owes

- Engine (`packages/engine/test`): the direct caller of `analyzeBody` in `mechanism.test.ts` gets the tolerance; the build (the cases of "Measured", A, as closed meshes facing outwards with their volumes; the faces and surfaces of each kind of curve; a line on the axis without a face; a pole; a pinch; a hollow ring; the caps of a partial turn with their frames; the row of the revolve in the test of mirrored tools of `pattern.test.ts`); `revolveSetup` (in the plane and not, both sides with the curves named, the finer division, the steps, the limit); `circlesBetween` and `circleBetween` (the comparison on random pairs of today's kinds, the table of "Measured", E, a touching off by ±1e-9 and ±1e-12, a ball touching a plane, spindle tori with a negative major radius (R −3, r 10 against a plane 5 above its centre: one circle of 5.66), an edge divided again and an edge cut short, a tube thinner than the chord tolerance, the cap of a lemon); the new kind of `AxisRef` (validation, a projected line, a projected line whose edge is gone, a missing line, a line without length for a revolve, a pattern, a joint and the argument of `mass`, the check of a query argument, the names the mechanism reserves); the validator of the feature (the generated profile, the range of the angle, an unknown key, the patch); `modules.test.ts` with the new module.
- Scenarios (`packages/scenarios/test`): `scenario14.test.ts` from [calls.ts](calls.ts); `revolve.test.ts` with the errors and a pattern of a revolve about a line of a sketch; the hash of a document without a revolve stays.
- App: the form of the revolve and the axis picker in `app.test.ts` (snapshots), the moved profile picker leaving the extrusion's snapshots as they are.
- MCP: `describe_api` names the revolve, `sketchLine`, the sphere, the torus and `invalidAxis`.

## Reviews

The design was written by Claude Opus 5.5. Each round has three reviewers with one brief, read-only, against the code of `master`: a fresh subagent on Claude Opus 5.5 (in place of Fable, owner, 2026-11-17), `codex` (gpt-6-astra, effort high) and `agy` (gemini-4-argon-high).

### Round 1 (2026-11-17), on the first version at `0a066a4`

`agy` did not run: its account is out of quota (HTTP 429, "resets in 96 h"). `codex` returned ten findings (five major), the subagent fifteen (three major) with a probe run against the author's prototype of the circles. Nineteen distinct findings, each checked against the code; with more than six and at least three serious, a second round follows. The fixes were made by Claude Opus 5.5.

| Finding | Reviewer | Severity | Accepted? | What changed |
|---|---|---|---|---|
| A torus with an unsigned major radius cannot tell the two parts of a spindle torus apart: an arc centred across the axis (an ogive) meets a plane at 5.66, the circle published says 11.66; `convex` and 3d's move follow the wrong centre | codex, subagent | major | yes (probe re-run) | The major radius is signed (negative when the centre of the arc lies across the axis); the curve in a half plane, `convex` and 3d's line use it; tests of spindle tori |
| Touching is tested only where the curves miss: a fillet a hair across gives two circles 1.5e-4 or 4.9e-6 apart, which the points split | subagent | major | yes (probe) | Touching on the distance, both ways; rows ±1e-9 and ±1e-12 owed by the tests; "Measured", E says so |
| The nearest candidate depends on how the edge is divided: a tube of 0.001 against a plane, a chord midpoint picks the other circle | codex | major | yes | A point has to lie nearer than half the distance of the two circles; otherwise `other`; the limit stated (circles closer than about twice the tolerance) |
| The promise of the chord tolerance ignores the cap of 4096 divisions (a radius of 100 m) | codex | major | yes | Qualified as for an arc of an extrusion; the limit of the size comes first for such parts |
| Two axis errors of calls.ts run after the fillet, whose arcs change the region: `noProfile`, not `invalidAxis` | codex | major | yes | The errors are asked before the fillet; the pattern of a line without length copies the pulley |
| The query argument `axis` needs more than `axisRef`: `checkArgs` checks only a point, the context turns `invalidAxis` into `brokenReference`, `mass` says "not in the state" | codex, subagent | major (subagent), minor (codex) | yes | A branch of `checkArgs`, `invalidAxis` in `RefProblem`, the text of `mass`; listed in "Where the code lives" |
| A circle tangent to the axis inside an arc is divided without a vertex on the axis: no pinch, a hole of 0.0049 about the axis | codex | major | in part | It is within the tolerance and a closed mesh; stated as a known limit rather than inserting points of contact |
| The app's query control, the summaries of a pattern and of a joint take every non-base axis for a point; `changeAxis` has no default line | codex, subagent | minor | yes | Listed in "The app and MCP", with the rule of the default line |
| The contract does not reach `mass.about`, `setJoint`, a patch of a pattern; query results stay typed with the surfaces of today | codex | minor | yes | "Holes in the contract" |
| A projected line whose edge is gone keeps its frozen place; "a projection that is gone is `brokenReference`" was wrong | codex | minor | yes | The axis follows the frozen line; only a line without a place is a broken reference |
| The linear pattern of the scenario checks only the status, `noEffect` included; the ring's mass is not checked | codex, subagent | minor | yes | calls.ts checks the volume taken, the place of the copied face and the mass |
| The Y of a sketch on a planar side is undefined when the line starts on the axis | subagent | minor | yes | Y is the normal of the half plane at the start angle, `cos(start)·side·ŵ − sin(start)·e` |
| `removable` of the extrusion would accept `{ extent: { taper: null } }` | subagent | minor | yes | `removable` covers the targets and the profile only |
| `circleIn` of the section is not `circleBetween` (a cone on either half, no lower bound of the radius); "keeps its answers" was not measured | subagent | minor | yes | Reworded; a comparison on random cuts is in "To verify" |
| Missing: the documents of the architecture, the texts of `measure`; the grid of 2e is merged and a user of `AxisRef` | subagent | minor | yes | Listed; the branch rebased on `fae5b78` |
| Two collinear lines across the axis meet as `coplanar`, not `other` | subagent | nit | yes | Corrected |
| "Distances along the axis" of a torus | subagent | nit | yes | "To the axis", and two coaxial tori are 0 apart |
| The comment of `grooveChecks` says two circles per pair; the copies of the groove end at z 10, on the boundary of the dome | subagent | nit | yes | Comment corrected; the mirror plane at 6.5 and the spacing 3 (z 7 to 9) |
| An angle a hair short of 2π passes with nearly coinciding caps; the steps "of the profile" in the contract; `transformSurface` has a `default`; a pinched body is unverified beyond the kernel | subagent | minor, nits | yes | A known limit; "of a vertex of the polylines" in both; an exhaustive switch; the section, 3MF and print of a pinch in "To verify" |

### Round 2 (2026-11-17), on the fixes of round 1 at `13645ac`

`agy` again out of quota. `codex` returned three findings (two major), the subagent nine (one major) with two numeric probes of booleans at small angles. Ten distinct findings, three serious, so the third and last round follows. The fixes were made by Claude Opus 5.5.

| Finding | Reviewer | Severity | Accepted? | What changed |
|---|---|---|---|---|
| The rule "nearer than half the distance" still picks the wrong circle: an edge of a boolean where the surfaces meet at a small angle moves along them by about `tol / sin θ` (a plane near the top of a tube: 400 of 635 phases; a ball in a bore of nearly its radius: up to 203 of 329); a chord of one of two circles 0.002 apart, cut short, picks the other | subagent, codex | major | yes (both probes are sound geometry) | Each circle has a reach `2 · tolerance / sin θ`; two circles are told apart only when further apart than the sum of their reaches, else `other`. The tolerance reaches `analyzeBody` through `State.chordTolerance`. A fuzz of small angles is in "To verify"; the invariance claim is gone |
| The cap edge of a spindle torus: the two circles in the plane through the axis cross on it, so a distance rule never chooses, and the poles lie on both | codex, subagent | major (codex), minor (subagent) | yes | For a plane through the axis the side of the axis decides, points on the axis left out |
| "Off the axis" with a negative major radius: a point at ρ < 0 must be dropped, not folded back | subagent | minor | yes | Stated, with the row R −3, r 10 owed by the tests |
| The radius where 4096 steps stop keeping half the tolerance is about 17 m, not 100 m; the limit of the size does not come first (a thin ring of 100 m has 262 144 triangles) | codex, subagent | minor | yes | Corrected |
| The clearance of 3d needs the sign and the cases that close, and a vertex on the axis | subagent | minor | yes | The row says them |
| The order of the tests (one surface before touching), the point of touching, a ball touching a plane | subagent | minor | yes | Stated in `circlesBetween` |
| `transformFace` is not exhaustive and would move a torus's axis without its centre | subagent | nit | yes | Both transforms become exhaustive switches |
| `start` of a whole turn in the Y of a side frame; `a` named twice; the comment of `mass` | subagent | nit | yes | `start` 0 for a whole turn; the axis point is `o`; the comment listed |

### Round 3 (2026-11-17), the last, on the diff of the fixes of round 2 at `bb90d3a`

`agy` out of quota a third time. `codex` returned three findings (all minor, no blocker or major); the subagent ten (two major in the wording of the side rule, the rest minor and nits), with the cases of round 2 recomputed: both now give `other`, the scenario's rims and fillets keep their circles, and the memo of `analyzeBody` holds (a new settings object makes a new first state). Every finding was taken; what stays open is in "Known limits". The fixes were made by Claude Opus 5.5.

| Finding | Reviewer | Severity | Accepted? | What changed |
|---|---|---|---|---|
| "The circle on the side the cap lies on" names the apple's circle for a lemon, whose cap arc is centred across the axis | subagent | major | yes | The circle centred at the signed major radius towards that side, in "Edges", `circlesBetween` and `circleBetween` |
| The side rule leaves out only points within 1e-6 of the axis; a pole in float32 lies a few 1e-6 off (axis at x = 60.1) | subagent | major | yes | Points within the tolerance plus the precision of the coordinates are left out; the owed test uses an axis at 60.1 and a tilted one |
| The tolerance is optional in `circleBetween` without a meaning; the section omits it; the queries are not told where to read it; a posed body may turn a circle to `other` | codex, subagent | minor, nit | yes | Without a tolerance two candidates give undefined; the queries read the document's setting; the pose noted; the direct caller in `mechanism.test.ts` |
| The distance of two circles and "within the reach" are not defined; the precision is not defined | codex, subagent | minor, nit | yes | `hypot(ρ₁ − ρ₂, z₁ − z₂)`, the shortest distance to a circle, `coordinatePrecision`'s formula |
| "Every such edge projects" contradicts the reach | codex | minor | yes | Qualified |
| The clearance of a vertex on the axis and the closing conditions (an apple face refused, a lemon face missing) | subagent | minor | yes | The tip moves along the axis; closing decided per vertex |
| The reach assumes polygons within the tolerance; 3d's moved round faces are flatter by up to 0.15 of the clearance | subagent | minor | yes | A known limit, with the remedy for whichever package comes second |
| Rejected alternative 10 argued with fillets, which the touching rule serves without points | subagent | minor | yes | Restated: what the points buy and cost |
| `0 < ρ ≤ 1e-6` in no branch; "leaves the tolerance by 0.03" | subagent | nit | yes | `ρ ≤ LENGTH_TOLERANCE` is none; "off by about 0.03" |

## Rows for the indexes

**`docs/d36/README.md`, the row of 4a** (column "Design now"):

> full design, D58 ([4a-revolve/design.md](4a-revolve/design.md)): the feature type `revolve` (a profile of regions or a wall turned about an axis in the plane of its sketch, a whole turn or an angle from a start, `new`, `add`, `cut`; faces named as for an extrusion of the profile; the mesh within the chord tolerance, the turn and the profile each divided for half of it), the kind `sketchLine` of `AxisRef` for every user of an axis, the surfaces `sphere` and `torus` with the circles surfaces of revolution meet in (`circlesBetween`; of two, the points of the edge choose), the issue code `invalidAxis`; no face role, no schema step; scenario 14

In "Shared places": the row "`FaceInfo` and `EdgeKind`" names 4a with the sphere and the torus and the points of an edge in `circleBetween`; a new row "`AxisRef` (`types.ts`, `axisRef` and `axisRefs` in `validation.ts`, `axis` in `recompute/services.ts`, the axis picker of the app)": the pattern, the mechanism and the queries read it, 4a adds `sketchLine`. In "Numbers": D58 is 4a, scenario 14 is step 4 (4a, then 4b).

**`docs/decisions.md`, the row:**

> | D58 | [4a Revolve](d36/4a-revolve/design.md) | designed 2026-11-17. Measured with a prototype of the build against the real adapter: every tool taken as it is (whole and partial turns of both signs, balls, tori, a hollow ring, a body pinched to a point on the axis), a mirrored tool the exact mirror image turned over by `applyTool`; dividing the turn and the profile each for half the chord tolerance keeps a ball within the tolerance (0.0099 of 0.01, against 0.0193 for the whole tolerance each); a tool of 1.7 million triangles takes the kernel 27 s to cut. The circles of surfaces of revolution prototyped: the pairs of today unchanged on 20 000 random pairs | A feature type `revolve`: a profile of regions or a wall turned about an axis that lies in the plane of its sketch, a whole turn or an angle from a start, as a new body, an addition or a cut, repeated by a pattern; its faces are named as those of an extrusion of the profile (no new role). The axis is an `AxisRef`, which gets the kind `sketchLine` (a line of a sketch) for every user of an axis. Faces of revolved arcs are spheres and tori, and two surfaces of revolution meet in circles that the edge's points choose among, so the edges of a turned part project and measure. The error `invalidAxis` for an axis outside the plane, a profile on both sides of it, and a line without length |

**`docs/requirements.md`, a new scenario:**

> 14. **Turned parts: a V-belt pulley, a knob with an O-ring** (D36, step 4; tested in `packages/scenarios/test/scenario14.test.ts`). Parts made by turning a half profile drawn in a sketch on XZ; 4a builds them and 4b adds chamfers and fillets of their circular edges.
>     - *Revolve (4a, D58): designed, not done yet* ([d36/4a-revolve/calls.ts](d36/4a-revolve/calls.ts)). A pulley of diameter 40 with a bore of 8, 15 wide, with a V-groove of 38° and 5 deep, turned about Z: its bottom and top are planes, its rims, groove bottom and bore cylinders, its flanks cones of the half angle 71°, all eight edges between them circles, no caps, the volume that of Pappus within the chord tolerance, and the facts give the axis and the steps. The two corners of the groove bottom get a radius of 0.8 by the fillet of the sketch, which patches the revolve: two tori of the minor radius 0.8 about the axis, whose edges with the flanks and the groove bottom are circles. A sketch on the top of the pulley has its origin where the line of the top starts and its normal along +Z, and four holes go through the pulley from it. A quarter cut away in a preview by a partial turn of 90° takes a quarter of the volume and leaves two planar caps through the axis (180° takes half). A knob at x = 60 turns about a construction line of its own sketch (an axis of the new kind): a cylinder of radius 12 and a dome, a sphere with its centre on the axis, which meets the cylinder in a circle, and the distance of the bottom from the dome is 10, exactly. An O-ring groove is cut into the knob and an O-ring (a torus R 11.75, r 0.9) stands in it, both about the axis of the knob from sketches of their own: the ring and the knob do not collide, the gap is 0.05 to the groove bottom, and the mass of the ring follows 2π²Rr². A mirror of the groove in a plane at z = 6.5 and a linear pattern of it 3 along the axis of the knob each cut a second groove of the same volume at z 7 to 9. Refused: an angle of 360°, a circle as the line of an axis, an addition without a target, and an angle given to a whole turn; errors `invalidAxis` (asked before the groove gets its round corners): the axis Y for a sketch on XZ, a line of the sketch through the profile, and a pattern about a line of no length. A larger diameter keeps every face, and the document loads to the same model without a schema step.
