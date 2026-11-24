# Architecture: the revolve

Part of [architecture.md](../architecture.md), the design as implemented. The revolve feature, its tool, the names and the surfaces of its faces, the circles surfaces of revolution meet in, and the axis of a line of a sketch (D58). The design with its alternatives, measurements and reviews is [d36/4a-revolve/design.md](../d36/4a-revolve/design.md).

## Revolve (D58)

```ts
interface RevolveFeature extends FeatureBase {
  type: 'revolve';
  profile: Exclude<ProfileSource, { type: 'generated' }>;  // regions (with an offset) or a wall
  axis: AxisRef;                                           // in the plane of the profile's sketch
  extent: { type: 'full' } | { type: 'angle'; start: number; angle: number };  // radians
  operation: 'new' | 'add' | 'cut';
  targets?: Id[];
}
```

A profile of a sketch turned about an axis that lies in the plane of the sketch: a new body, an addition to one body or a cut from bodies. The profile is the profile service of an extrusion ([extrude.md](extrude.md)); the tool is a second build beside the prism and the stack, applied by `applyTool` and `toolResult` and repeated by a pattern like any tool recipe.

**Document** (`features/revolve.ts`).

- `profile`: `profileSource` of `features/profile.ts`; a generated profile is refused before it is read ("a revolve takes regions or a wall"). The references are those of the profile.
- `axis`: `axisRef` of `validation.ts`; its references at `axis`. Whether it lies in the plane is a matter of the recompute.
- `extent`: a variant by `type`. `full` has no field. `angle` has `start` (`extent/start`, rad, any value) and `angle` (`extent/angle`, rad, not zero, strictly between −2π and 2π). Another key is refused (`onlyFields`). A whole turn is `full`; an expression that reaches 2π is an invalid command, and after a change of a parameter `invalidExpression` with the last valid value kept.
- `operation`, `targets`: the rules of an extrusion.
- The fields of the registry: `profile/offset`, `profile/thickness` (from `PROFILE_FIELD_SPECS` without the parameters of generators), `extent/start`, `extent/angle`.
- The patch: `profile`, `axis`, `extent`, `operation`, `targets`, merged by the rules of `updateFeature`; `normalize` drops the targets of a change to `new`; `removable` takes the targets and what `removableFromProfile` allows (the offset), nothing of the extent.
- No schema step: a build without the type refuses the document by itself (an unknown feature type, an unknown kind of an axis).

**Recompute**, in this order; the first problem is the error of the feature.

1. The profile (`profile` of `recompute/profile.ts`): `brokenReference`, `noProfile`, `invalidProfile` as for an extrusion.
2. The axis (`axis` of `recompute/services.ts`): `brokenReference`, or `invalidAxis` for a line without length.
3. The setup (`revolveSetup` of `recompute/tool-revolve.ts`), once per step, in the coordinates of the sketch:
   - *In the plane*: the direction of the axis within `ANGLE_TOLERANCE` of the plane of the sketch, the point of the reference (the origin for a base axis, the point `a` of a line) within `LENGTH_TOLERANCE` of it; otherwise `invalidAxis` with the axis in `refs` and the angle or the distance in the message. The axis used is the projection of the reference into the plane.
   - *One side*: for every curve of the exact outline (`ResolvedProfile.outline()`) its extreme signed distances from the axis: the ends of a line, the ends of an arc and the points of its sweep straight across the axis from its centre, the centre of a circle plus and minus its radius. When the outline reaches beyond `LENGTH_TOLERANCE` to both sides: `invalidAxis`, `refs` the axis and the curve that reaches farthest to each side (one curve twice when it crosses the axis), the message how far each reaches.
   - *The polylines*: the outline divided again for half the chord tolerance (`outlineRegions` with `nestingOf`), every test of a moved outline; a refusal is `invalidProfile` with its message. Selected regions that meet in a point are refused here (the outline of a selection refuses them).
   - *The steps*: the turn (2π, or `|angle|`) divided by the rule of an arc (`segments` of `sketch.ts`) at the largest distance of a vertex from the axis, for half the chord tolerance: at least 8 for a whole turn, at most 4096.
   - *The size*: two triangles per edge of a loop and step, one where an end lies on the axis, none where both do, and two triangulations of the regions for a partial turn. Above `MAX_REVOLVE_TRIANGLES` (1 000 000): `invalidProfile` with the count and the cure (raise the chord tolerance, divide the part).
4. The facts of the feature itself: `axisPoint`, `axisDirection` (model coordinates, unit) and `steps`.
5. The tool recipe: `buildRevolve` in the frame of the sketch, or of a copy (`transformFrame`), the faces of a copy tagged. The triangulation of the caps is a cache shared by the builds.
6. The operation as for an extrusion.

**The build** (`buildRevolve`). In the coordinates of the sketch `(u, v, w)` the axis is the point `o` and the unit direction `d`, `e` the unit vector across `d` towards the profile (`side` times the left normal of `d`). A vertex at `t` along the axis and `ρ` from it is placed at the angle `φ` at `o + t·d + ρ·cos φ·e + ρ·sin φ·side·ŵ` and then through `toWorld(frame, u, v, w)`; that is the right-hand turn about `d`. Nothing is computed in model coordinates, so a mirrored frame gives the mirror image facing inwards and `applyTool` turns it over (D53).

- A vertex within `LENGTH_TOLERANCE` of the axis is one vertex of the mesh (a pole); every other vertex has `steps` copies for a whole turn and `steps + 1` for a partial one, at `start + j · angle / steps`.
- An edge of a loop from `p` to `q` gives between the steps `j` and `j + 1` the triangles `(p_j, q_j, q_j+1)` and `(p_j, q_j+1, p_j+1)`, one where an end is a pole, none where both are. They are turned over when the profile lies on the right of the axis or the angle is negative, not when both.
- A partial turn has the caps: the regions triangulated by the kernel, placed at the first and at the last step. The start cap keeps the winding of the triangulation when the profile lies on the right and the angle is positive, or on the left and negative.
- A body pinched to a point (a profile that touches the axis in a corner) keeps one vertex there; the kernel takes it.

**Faces.** The names are those of an extrusion of the same profile: `side` with the curve (`wallSide`, `wallEnd` for a wall), `startCap` and `endCap` of a partial turn; a curve along the axis has no face. The surfaces, from the exact curves (`sideOf(key).shape`) in the coordinates of the sketch, placed with the frame:

| Curve | Surface |
|---|---|
| a line whose ends differ by at most `LENGTH_TOLERANCE` in their distance from the axis | a cylinder about the axis |
| a line whose ends differ by at most that in their place along the axis | a plane across the axis |
| any other line | a cone: the apex where the line meets the axis, the axis from the apex towards the face |
| an arc or a circle whose centre lies within `LENGTH_TOLERANCE` of the axis | a sphere |
| an arc or a circle whose centre lies off the axis | a torus: the centre the point of the axis nearest to the centre of the arc, the minor radius that of the arc, the major radius the distance of its centre from the axis, positive on the side of the profile and negative across the axis |
| the caps of a partial turn | planes through the axis |

The cylinder, the cone and the torus carry `along` (D60), the direction of the axis of the revolve: the sense of the axis of the face for an `AxisRef` of the kind `face` ([naming.md](naming.md), "The axis of a round face").

**A sketch on a face** (`faceFrame`, X = Y × N):

| Face | Origin | Y | Normal |
|---|---|---|---|
| a side from a line across the axis | the start `a` of the line turned to the start of the turn | `cos(start)·side·ŵ − sin(start)·e`, the direction the angle grows (`start` 0 for a whole turn) | out of the body |
| `startCap`, `endCap` | the origin of the profile's sketch turned to the start or to the end of the turn | the Y of that sketch turned likewise | out of the body |

So a sketch on the start cap of a turn from 0 has the frame of the profile's sketch with the normal out of the body.

**Edges.** Two neighbouring curves meet in a circle about the axis: the kind `circle` by `circleBetween` (below). A cap meets a plane across the axis in a line, a sphere or a torus in a circle, and a cylinder or a cone in a straight line on a curved face, which is `other`. Two faces on one sphere or torus meet in a seam of the kind `other`.

## The circles of two surfaces (D58)

`surfaces.ts`. `circlesBetween(a, b)` is every circle two surfaces meet in, exact, from the surfaces alone, at most two:

- two faces of one surface give none;
- a sphere and any plane: one circle, none where the plane touches the sphere within `LENGTH_TOLERANCE`; two spheres: about the line of their centres;
- two surfaces about one axis (a plane across it, a cylinder, a cone on the half its axis points along, a sphere whose centre is on it, a torus by its signed major radius): where their curves meet in a half plane through the axis, in the coordinates `(z, ρ)`; a point with `ρ ≤ LENGTH_TOLERANCE` is none, never folded back. Touching is tested on the distance both ways: a line whose distance from a circle's centre differs from the radius by at most `LENGTH_TOLERANCE` meets it at the foot of the perpendicular, two circles whose distance differs from the sum or the difference of their radii by at most that meet on the line of their centres. The axis of the circle is that of the cone of the pair, else of the cylinder, else of the torus;
- a torus and a plane that holds its axis: the two circles of the tube in that plane, centred at the signed major radius towards either side;
- nothing else.

`circleBetween(a, b, points?, tolerance?)` is the circle of an edge: the only one, or of two the one the points of the edge say.

- About one axis each circle has a reach, `2 · tolerance / sin θ` plus the precision of the coordinates (1e-6 of the largest coordinate of the points, of 1 mm at least), θ the angle at which the two curves meet there. The two are told apart only when their distance in the half plane, `hypot(ρ₁ − ρ₂, z₁ − z₂)`, is more than the sum of their reaches; the chosen one is then the circle every point lies within the reach of. Otherwise undefined: the edge is `other`.
- A torus and a plane through its axis: the side of the axis the points lie on, the points within `LENGTH_TOLERANCE` plus the precision of the axis left out; points on both sides give undefined.
- Two possible without points or without a tolerance: undefined.

The pairs of planes, cylinders and cones give the circles they gave before (a test compares the two on 20 000 random pairs).

**Who passes the points.** `analyzeBody(solid, faceNames, faceInfos, chordTolerance)` decides the kind of an edge after its segments are collected; `projectEdge` passes them and the tolerance. `State.chordTolerance` is the chord tolerance of the document, set where the evaluator builds the state before the first feature; the three callers of `analyzeBody` (the bodies of the evaluation, a projected edge of a sketch, `frame` of a face) pass it. The memo of `analyzeBody` keeps the tolerance with the result and analyses again for another. The queries read the tolerance from `settings` of the document: the description of a body (`query/body.ts`), the shape of an entity (`query/entity.ts`) and the spans of a section (`query/section.ts`, whose circle of a span is `circleBetween` of the surface and the plane the section was taken at, `below` under the asked plane, with the points of the span; where that plane meets no circle, the asked plane is tried, so that a section through the axis of a torus gives the circles of its tube).

**The readers of a surface.** `entityShape` and `measure`: a sphere is `{ is: 'sphere', center, radius, convex }` measured from its centre, a torus `{ is: 'torus', center, axis, majorRadius, minorRadius, convex }` measured from its axis (two tori about one axis are 0 apart). `convex` of the description of a body: the material on the side of the centre of the sphere, or of the centre of the tube of a torus in the half plane of each triangle. `transformFace` and `transformSurface` are exhaustive switches.

## The axis of a line of a sketch (D58)

`AxisRef` has the kind `{ kind: 'sketchLine'; sketch; line }` for every user of an axis: the revolve, the circular and the linear pattern (both directions of a grid), a joint of the mechanism and the argument kind `axis` of a query (`mass` with `about`).

- Validation (`axisRef`): the sketch exists before the referring feature; the line is a line of it (`requireRef` of the kind `entity` with `accepts: ['line']`): an own line, construction or not, a projected line, or an axis of the origin, `origin/x` or `origin/y` (D71: along +X or +Y of the sketch from `origin`, read from the list of curves and the geometry of the state, which have the axes in every sketch). `axisRefs` lists the sketch and the line.
- Recompute (`axis` of `recompute/services.ts`): the axis runs through the point `a` of the line in the direction from `a` to `b` (`direction` is `b − a`, not of unit length; every user normalises it). A sketch that did not evaluate, or a line without a place in its input (a projection that never had one), is `brokenReference`; a line whose ends are not more than `LENGTH_TOLERANCE` apart is `invalidAxis` with the line in `refs` and the detail "the line of the axis has no length", which the revolve, the pattern and a joint put into their messages. A projected line whose edge is gone keeps its last valid place and the axis follows it.
- A query: `checkArgs` checks the sketch and the line before `run` (`notAvailable` at `…/line`); the context passes `invalidAxis` on (`RefProblem`), and `mass` answers it as `notAvailable` at `about` with "the line of the axis has no length".
- The names a section reserves (`names` of the mechanism): the sketch and the line of such an axis.

## Where the revolve meets 3b and 3d (D58 with D55 and D56)

- **The clearance of a combine** (`movedOutwards`, [combine.md](combine.md)): a sphere moves its radius and a torus its minor radius by the clearance away from the material, along the exact surface; the centre of the tube stays, so the signed major radius does. A socket or a groove whose radius is no larger than the clearance is `closes` (`invalidClearance`); a torus is also decided per vertex: a vertex of it goes in its half plane to the distance ρ′ = R + (ρ − R)(r + side·c)/r from the axis, and one at the axis or across it closes the face (the hole of a ring, `R − r − c ≤ 0`; a concave lemon or ogive near its tip, which is not trimmed: a known limit). A convex torus that never reaches the inner side of its tube (a round on the top edge of a peg, an apple) is moved. A vertex within the precision of the coordinates of the axis of a torus or a cone moves along the axis only: its distance from a torus is `√(R² + h²) − r` in every half plane, from a cone `−h·sin α` (its apex moves by c / sin α), and its row is the derivative of that along the axis. The moved faces publish their surfaces (a ball's pocket is a sphere of r + c, an O-ring's groove a torus of r + c).
- **An imported body** (D55) as a target of a revolve that adds or cuts is `importedTarget`, by `applyTool` as for any tool.
- **The parts list** (D57): the copies of a revolved body made by a pattern share the mesh of the body (`shapeOrigin`), so they are one row with the body; a mirrored copy is a row of its own, `mirrored`.

## Known limits

The list of the design ("Known limits") holds as implemented: the edge of a cap with a cylinder or a cone is `other`; two faces of one sphere or torus meet in an `other` seam; an edge made of both circles of two surfaces is `other`; regions that meet in a point are refused; the steps follow the largest radius; an angle a hair short of a whole turn has caps that nearly coincide; a circle tangent to the axis inside an arc touches it in the mesh only where a vertex falls on it; the limit of a million triangles is a policy; the reach assumes faces within the chord tolerance, and the round faces of a tool moved by the clearance of 3d are flatter by up to `ROUND_ALLOWANCE` (0.15) of the clearance: the allowance is not added to the reach, so a small-angle edge of such a pocket between a moved torus and a face with two circles could take the wrong one (where the two rims of a groove lie between the same two faces, as an O-ring's, the edge is `other` anyway, which a test pins); the cavity of a lemon or an ogive is not trimmed at its tip, so a clearance moves its surface across the axis there and it is refused as `closes` though a smaller cavity would exist; a groove the clearance nearly fills (r 2 on a cylinder of radius 10 at c 1.9) lies inside the moved cylinder and is refused as `vertex`, not `closes`.
