# 2b Taper on extrusion (D45)

**State: implemented on the branch `d36/2b` (2026-11-16); see "As implemented" for where the code differs from this design.** The design below is its fourth version, after three rounds of reviews, the last allowed ("Reviews"; what is still open is listed there as known limits). Written against the sixth version of the contract of the preparatory step and the code at `0dc424b`, and on top of [2a](../2a-offset/design.md), whose outline and offset it uses. The tool shapes of this package were tried against the real kernel adapter in a spike ("What was tried"); nothing else was run.

Files: [contract.ts](contract.ts) (the field, the upgrade step, the rule for circles as one function), [calls.ts](calls.ts) (its part of validation scenario 12).

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "Taper on extrusion": an optional field `extent/taper` on the distance extent; the far profile is the near one offset by `distance · tan(taper)`; a ruled surface between the two; a cone for a circle; not with "through all"; the sign is a proposal.

| Statement of the backlog | What the code says |
|---|---|
| "An optional numeric field of the distance extent" | `extrudeFeature` (`document.ts`) reads `start` and `distance` of the extent and ignores every other key, so a build without the package loads a document with a taper and saves it without one. The field needs a named upgrade step (the preparatory step, "Schema version") |
| "The 1:1 mapping of curves gives the correspondence of vertices for free" | True for the vertices. Not for the surface between them where an arc meets its neighbour at an angle: the side of the arc is a cone, the side of the line a plane, and the two meet in a conic, not in the straight segment between the two corners. See "Levels" |
| "Arcs are divided by the larger of the two radii, the same count at both ends" | Needed, and the sweeps of the two arcs differ as well when a corner slides along the arc; the count is the larger of the two counts `segments` (`sketch.ts`) gives |
| "`FaceInfo` needs a cone next to the cylinder" | Four places of `solid.ts` assume that a face that is not planar is a cylinder or a swept surface: the union `FaceInfo`, `transformFace` (everything but a cylinder is moved as a swept surface: only its axis), `edgeKind` (two faces that are both not planar are `other`) and `projectEdge` (casts the round face of a circle to a cylinder). `interference.ts` only asks whether a face is planar and needs no change |
| "With 'through all' the taper is an invalid command" | Kept, and the same holds for a generated profile (no curves to move) and for the extent of 2f |
| The tool is "another tool build over the same recipe" | True: `ToolRecipe.build` hides the builder. But the kernel adapter was only ever given prisms and cylinders (architecture.md, SolidKernel, "Omezení"), so cones and tilted sides were tried first |

## The cheap variant

- `taper?: number` on the extent `distance` (field `extent/taper`, radians, between −π/2 and π/2, an expression allowed): the angle between a side face and the direction of the extrusion.
- The profile at the start of the extent is the profile of the sketch (with its offset); the profile at the end is that one moved by `|distance| · tan(taper)` with the offset of 2a. **Positive widens away from the start.**
- The sides are ruled between the two: a tilted plane from a line, a cone from an arc or a circle. Face names are those of the straight extrusion.
- Works for a profile of regions and for a wall of 2a. Not for a generated profile, not on `throughAll` and `upTo`.
- A feature without the field, or with a taper that evaluates to exactly zero, is built by the prism of today.

**Deferred:**

- Chamfered ends as fields of one extrusion: the stack of this package with three sections. Nothing but the fields and their validation is missing.
- A taper up to a plane (2f) when the plane is parallel to the sketch: the far size would follow the target.
- A taper of a generated profile; different angles per curve; a taper that lets small curves drop out at the far end (see 2a, "Open questions").
- Twist: another build.

## The sign and where the profile holds

**Positive widens away from the start; negative narrows.** The size at the end is the size at the start plus `|distance| · tan(taper)` on every side, whichever way `distance` points.

| Use | Sketch | Extent |
|---|---|---|
| a countersink from the face the head sits in | the circle of the head, on that face | a cut with a negative `distance` (into the body) and a negative taper of half the included angle of the cone: `deg(-45)` for a cone of 90°, as an example of the arithmetic. The angle of a real screw head comes from the catalog of 2c, not from here |
| the same from the bore | the circle of the bore | `start` at the bottom of the cone, `distance` up to the face, `deg(45)` |
| a chamfer of the bottom edge against elephant foot | the outline | a slab with `profile/offset: -c`, `distance: c` and `deg(45)`; the body continues straight above it |
| a draft on a rib or a boss | its profile | `deg(-2)` |
| a roof that prints without support | the outline | `deg(-45)` |

Reasons:

- It is the sign of the offset: "positive grows the profile" holds for both fields, and the far profile is literally the near one with an offset.
- It does not flip when the direction of the extrusion flips. A convention tied to the normal of the sketch plane would make the same countersink positive from one face and negative from the other.
- As far as Claude recalls, Fusion and FreeCAD read a positive taper angle of an extrusion the same way. This was not checked against their documentation and is not the reason.

**The sketched profile holds at the start of the extent**, also when `start` is not zero. The alternative (it holds in the sketch plane, and the tool is cut out of a cone through it) would make `start` change the size of the start cap, which reads as a bug in every use above.

**The angle is measured from the direction of the extrusion, per side**, so a cone with an included angle of 90° is a taper of 45°. The included angle of a cone is what a hole says (2c); a taper applies to planes as well, where "included" means nothing.

## The tool: a stack of sections

A new build, `recompute/tool-stack.ts`, beside the prism (2a, "Tool builds and extents as modules"). Internal types, not type-checked:

```ts
interface Ring { w: number; regions: Region[] }      // a level along the normal and the outline there, tessellated
interface Section {
  rings: Ring[];                                     // two or more; the same loops and the same number of points in each
  sideOf(key: string): { name: Omit<FaceName, 'feature' | 'copy'>; info: FaceInfo };
}
// Sections follow each other along the normal. Where two meet in one outline they share its ring.
// Where they meet in different outlines there is a planar step between them (package 2c).
function buildStack(feature: Id, sections: Section[], caps: [name, name], frame: Frame, firstFaceId: number, kernel: SolidKernel, cache?: Map<Region, Uint32Array>): BuiltTool
```

- **Caps.** The first ring and the last are triangulated by the kernel, each on its own (`triangulate` with the outer loop and the holes of each region): the triangulation of the near cap is not valid for the far one once the outline has moved. They are `startCap` and `endCap`, with the rule of today: `startCap` is at the start of the extent.
- **Sides.** Between two rings every edge of a loop becomes two triangles, with the face of the curve the edge belongs to. Rings pair point by point, so the mesh is closed by construction.
- **Orientation** follows the sign of `distance`, as in the prism. Like the prism, the build assumes a right-handed frame: handed a mirrored one (a copy of the mirror of 2e; `transformFrame` keeps the reflection), both builds give a solid turned inside out. Where the winding is reversed for such a copy, once and for every build, is to be agreed with 2e ("For the plan").
- **What depends on what.** The rings are computed once per recompute step, in the coordinates of the sketch: they depend on the profile, the distance and the taper, not on the targets or on a placement. `ToolRecipe.build` only puts them into the frame, which for a copy of a pattern is the transformed one. An error of the far profile is therefore an error of the feature's step, found before any tool is built, and a pattern repeats a tapered tool like any other.
- The planar step between sections of different outlines is specified here and first used and tested by 2c.

### The far outline and the levels

1. The near outline is `outline()` of the resolved profile (2a): exact curves, after `profile/offset`.
2. The far outline is the near one moved by `|distance| · tan(taper)`, with every check of 2a. A failure is `invalidProfile` and names the curves; the text says that it is the far end.
3. Every curve gets one number of points for all rings of the section: the largest `segments` gives for it over the rings (its radius differs from ring to ring, and its sweep where a corner slides along the arc).
4. **Levels.** Between a line and a line, and across a tangent joint, the straight segment from a near corner to its far corner lies in both side faces: the offset keeps a line parallel to itself and keeps a tangent joint tangent, so the side of a line is exactly a plane, the side of an arc exactly a cone, and the corner edge is a ruling of the cone that lies in the plane. An outline of lines, circles and tangent arcs (a rectangle, a rounded rectangle, a slot, a circle) therefore has two rings, and its cones deviate from the true ones by the sagitta the count was chosen for.

   Where an arc meets a neighbour at an angle, its sweep changes from ring to ring, and straight edges between two rings go wrong in two ways. The corner moves along a conic, so the segment between the two corners leaves the cone of the arc (and the cone of the neighbour, when that is an arc too; when the neighbour is a line the segment stays in its plane, which holds both of its ends). And the points of the arc, spread evenly over a sweep that differs between the rings, do not lie on common rulings of the cone, so the triangles between them are sheared across it. (The first version of this design tested the corner only; a review computed a triangle 0.011 mm off its cone where the corner passed at 0.004, for a tolerance of 0.01.) Both errors shrink with rings in between: the outline moved by `t · |distance| · tan(taper)` at the level `t` of the way.

   The rule tests the mesh that will be built, not a model of it, and it tests one point per triangle with a bound that covers the rest:
   - an arc whose sweep changes is divided for **a quarter** of the chord tolerance (twice the points of today);
   - for every such arc and every interval between two rings, the centroid of every triangle of its side is measured against the exact cone: `(r − R) · cos(taper)`, with `r` the distance of the point from the axis and `R` the radius of the cone at its level;
   - the number of intervals doubles until every centroid is within **a third** of the chord tolerance, at most 64. At 64 the tool is built as it is and the rule has not shown the tolerance there; the docs say so. (Such a mesh is usually within it all the same: a review sampled 44 meshes that ended at the cap and found 42 within the tolerance.)

   The division and the limit are two numbers on purpose. Between two rings that are close, a triangle of the side has an edge of a ring and its third corner next to one end of that edge, so its centroid lies a third of the way along the chord, where the deviation is 8/9 of the sagitta. With rings ever closer the measure therefore tends to `8/9 · cos(taper)` of the sagitta the arc was divided for, and no lower: 0.22 of the tolerance for a quarter. The limit of a third leaves the shear between the rings the rest, 0.11 of the tolerance. (The third version divided for a third as well; its measure tended to 0.296 against a limit of 0.333, the loop had to push the shear below 0.04 of the tolerance, and a review counted 44 cap endings in 900 D shapes, most of them on meshes that were fine.)

   Why a third at one point bounds the whole triangle. `r` is a convex function of the position (the length of a linear image of it) and `R` is linear, so `r − R` is convex over a flat triangle. Its three corners lie on the cone (the points of every ring are on the exact arc of that level, and a corner of the outline is on both of its curves), so it is zero there, never positive inside, and has a deepest point `m` with the value `−M`. The line from `m` through the centroid leaves the triangle at a point `q` of its border, where the value is not positive; the centroid divides `m q` so that at least a third of the weight is on `m` (its barycentric coordinates are all a third, and those of `m` at most one). By convexity the value at the centroid is at most `−M / 3`. So `M` is at most three times what is measured, edges and diagonals included, and the tolerance is kept wherever the loop ended by passing. (The second version measured the middle of every edge and diagonal against the whole tolerance; a review computed a diagonal at 0.0101 for a tolerance of 0.01 where every middle passed. The deepest point of a convex function with two zeros need not be the middle, only within twice its value, and the inside of a triangle can be deeper than its edges.)

   The corner edge needs no test of its own: it is an edge of triangles of the cone, and on the other side the triangles of a line lie in its plane exactly, because both ends of every corner edge are in that plane. What the polyline of the corner misses is the place of the edge within the two surfaces, not the distance of the mesh from either.

   Every ring built is checked like the far one.

### Surfaces of the sides

| Curve | Surface | `FaceInfo` |
|---|---|---|
| a line | a plane through the near line and the far line | `origin`: where that plane meets the sketch plane, across the line from its start point `a` (see below); `y`: the unit vector in the plane across the line, on the side of the normal of the sketch plane (for a taper of zero it is that normal, as today); `normal`: across both, without a sign |
| an arc, a circle | a cone about the normal of the sketch plane through the centre | `apex`: on that axis, where the radius would be zero: at the level `start − r₀ · distance / (r₁ − r₀)` for the radii `r₀` at the start and `r₁` at the end; `axis`: the normal of the sketch plane, signed so that it points from the apex to the face; `halfAngle`: `|taper|` |

- A sketch can stand on the tilted plane of a line, as on a straight side (`calls.ts`, `ribDraft`). Its origin stays in the sketch plane, as today: the origin of a straight side is the point `a` in the sketch plane also when `start` is not zero (`buildPrism`; a probe of the review gave `[2, 48, 0]` for a cut that starts at 2). For a tilted side it is `a` moved across the line by `−start · tan(taper)` times the sign of `distance`, the place where the plane, continued beyond the start of the tool, meets the sketch plane. That is `a` for a taper of zero and for a start of zero, so a taper whose expression passes through zero moves no sketch. (The first version put the origin at the start of the extent; adding a taper to an extrusion with a start would then have moved every sketch on its sides by the start.)
- Both radii are positive (the offset refuses a radius that is not), so the face lies on one half of the cone and the apex is never inside it.
- A hole of a profile tapers the other way than its outer loop: with a positive taper the outer cone opens towards the end and the cone of a hole closes towards it. Both have the half angle `|taper|`; their axes point opposite ways.
- `Surface` of the preparatory step is derived from these as it is for the kinds of today.

## Circles between surfaces

The preparatory step fixed the rule ([00-prep/contract.ts](../00-prep/contract.ts), "Kinds of edges"); this package is the first that has a cone, so it writes the code. One function gives the circle two surfaces meet in, and both `edgeKind` and `projectEdge` ask it (`circleBetween` in `contract.ts`, over `FaceInfo` in the engine):

| Pair | The circle |
|---|---|
| a plane and a cylinder, the normal of the plane along the axis | as today: the centre where the axis meets the plane, the radius of the cylinder |
| a plane and a cone, the normal along the axis | the centre where the axis meets the plane, at the distance `t` from the apex along `axis`; the radius `t · tan(halfAngle)`; only for `t` above zero |
| a cylinder and a cone about one axis | the radius of the cylinder; the centre at `radius / tan(halfAngle)` from the apex along `axis` |
| two cones about one axis | the point of the common axis where the two radii are equal, if it lies on the faces' halves of both cones; none when the cones are the same surface or never meet |

- "About one axis": the directions are parallel within `ANGLE_TOLERANCE` and a point of one axis lies within `LENGTH_TOLERANCE` of the other.
- A radius that is not above `LENGTH_TOLERANCE` is no circle (a plane through the apex).
- `edgeKind` returns `circle` when the function answers, and otherwise what it returns today. Two cylinders stay `other`, also when they are stacked on one axis, as the vocabulary says.
- `projectEdge` projects that circle when its axis is along the normal of the sketch (otherwise `unsupportedProjection`, as today for a cylinder seen from the side).
- So the mouth of a countersink (the face it is cut into and the cone) and its lower rim (the cone and the bore) are circles that a sketch can project, whether the countersink is one hole feature or, as in `calls.ts`, a tapered cut and a bore.

The same function is needed by package 1b over `Surface` (the circles of a body description); see "Needs from the preparatory step".

## Document and validation

- `Extent`: `{ type: 'distance'; start: number; distance: number; taper?: number }`.
- An optional numeric field with the rules of 2a ("An optional numeric field"): absent means none and is not stored, what is given is kept, `setField` reaches it, a patch `{ extent: { taper: null } }` removes it.
- In the registry: `extent/taper` when `extent/type` is `distance`, with the range above. A taper of 89° is a valid number; whether the far profile exists is the recompute's question.
- Invalid commands, structural (they do not depend on the value): the field on an extrusion with a generated profile; the key `taper` on an extent that is not `distance`. The second needs a line of its own in `features/extent.ts`, because the validator of an extent drops keys it does not know.
- **Upgrade step `2b-taper`**, with nothing to convert. Its branch counts it as pending (`SCHEMA_PENDING`); after the merge the version of the schema is one higher.
- The hole of 2c uses the extent without the taper: the validator of `features/extent.ts` takes "may have a taper" as an argument.

## Where the code lives

| File | What 2b does there |
|---|---|
| `types.ts` | the field in `Extent` and its comment |
| `features/extent.ts` | the field, its description, the two refusals |
| `features/extrude.ts` | one line in `info.fields`; the step picks the stack when the taper is not zero |
| `recompute/tool-stack.ts` | new: `buildStack` |
| `recompute/outline.ts` | the rings of a tapered section (the far outline, the counts, the levels) |
| `solid.ts` | the cone in `FaceInfo` and `transformFace`; `circleBetween`; `edgeKind`; `projectEdge` |
| where the preparatory step derives `Surface` and `BodyFace.convex` | the cone |
| `document.ts` | the step in `UPGRADES` |
| `packages/kernel-manifold/test` | tapered tools in the fuzz of the adapter |
| `packages/mcp/src/api.ts` | `CONVENTIONS`: the sign with the table of uses above |
| `packages/app` | the field "Taper (degrees or an expression)" under the distance extent of the extrusion form; `changeExtrude` gets `taper`; a bare number is degrees, as for the other angles of the forms |

## Issue codes

None new. `invalidProfile` when the outline at the end (or at a level) cannot be built, with the package's own text.

## What was tried

A spike in the scratch directory of the session (not in the repository) built tools by hand and ran them through the real kernel adapter (`createManifoldKernel`), on a plate of 40 × 30 × 5 mm:

| Tool | Result |
|---|---|
| a countersink in one tool (a cone and a cylinder sharing a ring), the mouth flush with the top of the plate | closed result, the volume as computed, the cone and the cylinder in the result as two faces |
| four of them as one tool | the same |
| a tapered square boss added with its base flush on the plate, then a pocket with the opposite draft cut into it | both volumes as computed |
| the same countersink cut a second time (a copy of a pattern that lands on the original) | no exception; the volume changed by 4e-8 mm³ and the faces of the second tool are in the result in place of the first. Whether `applyTool` then reports the copy as `noEffect` (it tests the faces of the tool against the surface the target had, `onSurface`) was not run. Coincident round faces are the case the adapter gives no guarantee for (architecture.md, SolidKernel, "Omezení": the surface may come out wrong without an error), cylinders today and cones with this package |
| a tapered cut followed by a straight bore of the radius of its lower ring, the bore with 36, 40, 48 and 64 sides against 48 of the cone | passes every time. With another count, slivers of the end cap of the tapered cut stay between the two polygons, so the cone has a third edge. With the same count they do not |
| for 2c: a counterbore (two cylinders and a planar step between them, blind) and a nut pocket (a hexagon, a step with the circle of the bore as its hole, a bore through) | both volumes as computed; the head, the step, the bore and the bottom (the six flats, the step and the bore) in the result as faces of their own |
| for 2f: a round post whose far end lies in a tilted plane, added on the plate; a square pocket cut down to a tilted floor; a cut and an addition that end flush on that tilted floor | all four volumes as computed |

One position each and no random placement: it shows that the adapter takes these shapes, not that it is robust for them. The fuzz of the adapter has to get tapered tools (tilted planes flush with tilted faces are the case its coplanar handling has to prove; cones are not planar and it leaves them alone, as it does cylinders). The internal reviewer ran the spike again (nine tests pass) and added the scenario's own sizes: the countersink by hand at three positions, and a round brace that ends flush on a face tilted by three degrees.

The last row is a limit to state in the docs: two features that meet in a circle are two polygons. The lower ring of a cone has the count of its larger ring. A hole feature (2c) builds the cone and the bore as one tool and has no such seam.

## Rejected alternatives

1. **The opposite sign, or a sign tied to the normal of the sketch plane.** See "The sign".
2. **The sketched profile holds in the sketch plane.** `start` would change the start cap.
3. **Reporting the cone as `swept`** (the backlog's fallback). The rims of a countersink would stop being circles, and with them the projection and, later, a chamfer of the rim.
4. **Scaling the profile about a point** (what `extrude` of Manifold offers as a scale of the top). A scale is not an offset: walls get thinner by different amounts, centres of circles move, and the result is no cone or plane the engine could describe. It would also take the naming of faces away from the engine.
5. **A taper as a feature of its own** that tilts faces of a body. The body is a mesh; tilting a face means rebuilding its neighbours.
6. **The field directly on the feature** instead of on the extent. It belongs to one variant of the extent; and it would need the same upgrade step.
7. **One straight segment per corner always.** Cheaper, and wrong by more than the chord tolerance for an arc that meets a line at an angle under a strong taper, while `FaceInfo` would still claim an exact cone.
8. **Replacing the prism by the stack for every extrusion.** Other triangles for every existing model.

## Open questions

- What the rule costs, and whether 64 intervals are the right cap. A review ran it on 900 D shapes (radius 1.2 to 96, tapers of 1° to 60°, far offsets up to half the radius, tolerances 0.002 to 0.05) with the constants of this version: 12 ended at the cap, the worst sampled error where the loop passed was 0.49 of the tolerance, and the meshes had 1.62 million points together, about twice what the smallest sufficient counts would need (0.84 million). So the rule is safe and spends about a factor of two; typical counts are 2 intervals at 1°, 8 to 16 between 2° and 10°, up to 32 at 15°.
- The factor of three is the bound that can be proved in three lines, not the tightest one (random triangles gave at most 1.88; "Reviews", round 2). The way to the smallest counts is the deepest point of the convex function over each triangle (a few steps of a minimisation in two variables), compared with the whole tolerance. Left for when the extra points show in real models.
- The text of the paragraph for the AI. The table of uses is the candidate.

## Needs from the preparatory step

- **A home for the circle of two surfaces.** The vocabulary states the rule in prose; `edgeKind` and `projectEdge` need it over `FaceInfo` (this package) and the body description of 1b over `Surface`. If both packages write it, the rule exists twice. Case: `mouthOf` in `calls.ts` asks the radius of the mouth of a countersink from its two surfaces; today nothing declares that function. Stand-in: `circleBetween` in `contract.ts`. Proposed: the engine has it once, over `Surface` (a `FaceInfo` is turned into one already), and 1b imports it.
- **Who writes the cone.** The contract says `FaceInfo` "gets the two new kinds" and that `BodyFace.convex` covers "a cylinder and a cone", without saying which package adds the cone to `FaceInfo`, to the derivation of `Surface` and to `convex`. This design takes all three, because no face is a cone before it. If the preparatory step writes them first, 2b only builds the faces.

## For the plan

- **2e, the mirror.** A tool built in a mirrored frame comes out turned inside out, for the prism of today as for the stack (a review built a unit cube with `buildPrism` in a reflected frame: volume −1). `transformSolid` reverses the triangles of a mirrored body; nothing does it for a tool that is built in the frame of a copy. One place has to, once, for every build: the wrapper of `build` that already tags the faces of a copy is the candidate. To be agreed with 2e, which brings the first mirrored copy.
- **1b.** The circle of two surfaces (above, "Needs").
- `FaceInfo`, `edgeKind` and `projectEdge` are in the plan's row for this package; nothing to add.

## Tests the implementation owes

- Engine: the volume of a tapered box and of a frustum of a circle against the formulas; the surfaces (the plane of a line, the cone of a circle and of a hole in a profile, the apex and the direction of the axis for both signs of the taper and of the distance); the kinds of the edges and both projections of a countersink; a sketch on a tilted side, with a start and without, and that its origin does not move when a taper is added; a D shape with levels, the half disc of the first review and the clipped disc of the second (the mesh sampled densely over every triangle of a cone, not at the points the rule measures, stays within the tolerance of its cone); every refusal; a pattern of a tapered cut; `circleBetween` for the four pairs and for what must not be a circle.
- The adapter: tapered tools in the fuzz.
- The upgrade: a document with a taper saved, loaded, and refused by a list of steps without `2b-taper`.
- Scenario 12.

## Reviews

### Round 1 (2026-11-15): the four designs of track B together, at `0839139`

The reviewers and the brief are in the record of [2a](../2a-offset/design.md) ("Reviews"). The findings on this package, each checked before it was acted on:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| The test of the corner does not bound the error of the side triangles: the points of an arc whose sweep changes do not lie on common rulings. A half disc of radius 10 under 45° passes the corner test at 0.0045 with a diagonal 0.0113 off its cone; a D shape with one interval is 0.41 off against a sagitta of 0.032. "At most the sagitta" was false, and nothing said what happens at 64 intervals | codex (major), internal (factual) | Yes (both computed it) | The levels are tested on the mesh that is built (every edge and diagonal between two rings, and the corner); such arcs are divided for half the tolerance; the count of a curve is the largest over all rings; at the cap the tolerance is not kept and the docs say so |
| The origin of a sketch on a tilted side was put at the start of the extent, while a straight side has it in the sketch plane also with a start: adding a taper would move every sketch on the sides by the start | internal, major | Yes (probe of the engine: origin `[2, 48, 0]` for a cut with `start: 2`) | The origin stays in the sketch plane, where the tilted plane meets it; 2c uses the same rule for a flat |
| A tool built in a mirrored frame is turned inside out; "the pattern inherits it without a change" misses that | codex, major | Yes for the mirror of 2e (a unit cube in a reflected frame has the volume −1 today); no copy is mirrored before 2e | Stated under the stack and "For the plan" |
| The comment of `circleBetween` made every edge without a circle `other`, two planes included | codex, minor | Yes | The comment says what `undefined` means |
| "What was tried" was cited by 2c and 2f for rows it did not have; "which `applyTool` reports as `noEffect`" was an inference, and coincident round faces are a stated limit of the adapter | internal, minor | Yes | The rows are there; the inference is marked as not run, with the limit |
| The scenario used the ID `mid` in two sketches (IDs are unique in the document), so it stopped at the countersink by hand; the sizes of that countersink looked like those of a screw | both, major | Yes (reproduced by both) | The point is `lidMid`; the sizes are made up and said to be |
| The file table renamed `Prism`, and so did the text of 2a | internal, minor | Yes | 2a does it |

Checked by the reviewers and found sound: the apex, the direction of the axis and the half angle for all four combinations of signs and for a hole of a profile (computed); the four pairs of `circleBetween`; that an extent drops an unknown key on load today (a load with `extent.taper` succeeds and the key is gone), so the step is needed; the numbers of the scenario (the rib keeps 0.34 mm at its top under −3°, the lip 0.79 mm under −10°).

Not acted on: nothing.

### Round 2 (2026-11-15), narrow: the fixes of round 1, at `83c8405`

The reviewers are in the record of [2a](../2a-offset/design.md). The findings on this package:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| The middles of edges and diagonals do not bound the error: the deepest point of a straight piece between two rings of different radii is not its middle. A disc of radius 2.26 clipped at x = −1.995, far offset −1.598, tolerance 0.01: the rule stops at four intervals with every middle within 0.009993, and a diagonal is 0.010134 off its cone at 56 % of its length | codex, major | Yes. The excess is small (1.3 %), but the design claimed the tolerance below 64 intervals. The internal reviewer ran the same rule on D shapes and saw it end between 1 and 16 intervals with the ring edges at half the tolerance; it did not sample off the middles | The rule measures the centroid of every triangle against a third of the tolerance, with the proof that this bounds the whole triangle (the deviation from a cone is convex over a flat triangle with its corners on the cone). Such arcs are divided for a third of the tolerance. The corner test is gone: it is covered |
| The right angle of a countersunk head is written in two places as if it were known | internal, flag | Yes: an example, never asserted, but it reads as a value of a standard | The two places say a cone of 90° as an example of the arithmetic; the angle of a screw comes from the catalog of 2c |

Found holding by both: the origin of a tilted side for all eight combinations of the signs of the taper, the distance and the start (it equals `a` for a taper or a start of zero and matches `buildPrism` and `faceFrame`); the note on mirrored builds (`buildPrism` has a fixed winding, `transformFrame` keeps the reflection, only `transformSolid` reverses triangles); the loop of the levels is well defined and terminates.

Not acted on: nothing.

What was run for the fix, and what was not. The bound was checked in numbers after it was written (a script outside the repository): 195 000 random flat triangles with their corners on a cone (half angles up to 45° either way, radii 1 to 21, up to 0.6 rad wide), each sampled on a grid of 861 points. The deviation was never positive, and its largest size was at most 1.88 times its size at the centroid; the proof gives three. The loop of the levels with the new rule was not run in this round; round 3 ran it.

### Round 3 (2026-11-15), the last: the diff of the fixes of round 2, at `e4056d1`

The reviewers and the rule of three rounds are in the record of [2a](../2a-offset/design.md). The findings on this package:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| The limit of the loop sits just above the value its measure tends to: with arcs divided for a third of the tolerance the centroid measure tends to 8/9 · 1/3 = 0.296 of it, against a limit of 0.333, so the loop has to push the shear below 0.04 and the shear falls only like 1/N. Run on 900 D shapes: 44 end at the cap, 42 of them on meshes within the tolerance; four times the intervals of the second version's rule in 510 cases. "The tolerance is no longer kept at the cap" and "expect about one more doubling" were false | internal, major (run) | Yes. The bound holds and the tolerance is kept wherever the loop passes; the cost was in the constants | Such arcs are divided for a quarter of the tolerance and the limit stays a third (the reviewer ran this pair on the same shapes: 12 cap endings, worst sampled error 0.49 of the tolerance, 1.62 million points against 2.38). The text states the value the measure tends to, and says "not shown" for the cap |
| "The segment between the two corners leaves both surfaces" contradicts the new paragraph on the corner: next to a line the segment stays in the plane of the line | codex, factual (read) | Yes | The sentence tells an arc beside a line from an arc beside an arc |

Found holding: the proof, step by step, by both (convexity, the corners on the cone for every vertex the stack builds, the barycentric argument, `(r − R) · cos(taper)` as the distance); the loop, run by both with dense samples over every triangle (codex: 5 151 points per triangle on six outlines, 4 to 32 intervals, sampled errors of 0.33 to 0.42 of the tolerance; a half disc that nearly collapses reaches the cap, as documented); the corner edge needs no test of its own (the internal reviewer measured the true corner 0.003 to 0.106 of the tolerance off the mesh, equal to the distance of the mesh corner from the cone); nothing of the old rule is left elsewhere in the file.

Still open, as known limits:

- The loop was run on discs cut by a line only: not on an arc between two arcs, a concave arc or a hole of a profile, and not in the engine, which has no stack yet.
- The rule spends about twice the points the tolerance needs ("Open questions").
- The constants of this round (a quarter and a third) were run by one reviewer on one family of shapes and read by none in this text.

## As implemented

### The engine, the app and the tests (2026-11-16)

The field and its two refusals in `features/extent.ts` (`extentOf` takes `noTaper`, the reason a feature may have no taper), the step `2b-taper` pending on the branch, the cone in `FaceInfo`, `surfaceOf` and `transformFace`, the cone pairs of `circleBetween`, the rings in `recompute/outline.ts` (`taperRings`), the section in a new `recompute/taper.ts` (`taperedSection`), the build in `recompute/tool-stack.ts` (`buildStack`), the step of the extrusion, the paragraph of `CONVENTIONS`, the field of the form. The rules as implemented are in [architecture/extrude.md](../../architecture/extrude.md), "Taper"; the tests in [architecture/verification.md](../../architecture/verification.md), "The taper".

Where the code differs from the design above:

- **`circleBetween` exists once, over `Surface`** (`surfaces.ts`, where 1b put it with the pair of a plane and a cylinder). `edgeKind` and `projectEdge` ask it with `surfaceOf` of the two faces; there is no copy over `FaceInfo`. What the design asked of the preparatory step ("A home for the circle of two surfaces") is so settled.
- **`buildStack` takes one section** and the caps are always `startCap` and `endCap`. The list of sections, the names of the caps and the planar step come with the hole of 2c, the first that needs them.
- **The surfaces of the sides are computed in `recompute/taper.ts`**, a module of its own beside the rings and the build, in the coordinates of the sketch; `buildStack` moves them into the frame with `transformFace`.
- **An arc "whose sweep changes"** is an arc whose start angle or sweep differs between the near ring and the far one by more than 1e-9 rad. A corner that slides along an arc moves its start or its end, and both put the points of the rings off common rulings.
- **The origin of the plane of a line** starts from the line as the straight extrusion describes it (`ResolvedProfile.sideOf(key).shape`): the start of the sketch curve for a side of regions, the rule of 2a for a wall (the moved start of a side, the left corner of an end). So a sketch on a wall end of a tapered wall stands where it stood without the taper.
- **A refusal of a tapered wall names curves of the sketch.** `movedChain` and `movedOutline` take the `curveOf` of 2a for their texts and references, and the resolved profile of a wall carries it (`ResolvedProfile.curveOf`), because the outline of a wall has keys of its own.
- **The counts of the rings** reach the polylines through `outlineRegions` (an argument `counts`, by loop and curve); without it the rule of a sketch profile counts as before.
- **The fuzz of the adapter** has a generator of its own (`packages/kernel-manifold/test/taper-fuzz.ts`): changing the generator of `fuzz.ts` would have changed the cases of its pinned seeds. Its oracle is the volume of cross sections integrated by Simpson's rule between the levels where tools start and end.
- **The app** drops the taper from a draft whose profile becomes generated (the field is not shown there, so it could not be emptied), and sends `taper: null` in the patch of a distance extent that has none.
- **Scenario 12** follows `calls.ts`, with two moves: the taper on a gear is tested in `packages/engine/test/taper.test.ts`, because the box has no gear; the lead-in of the lip is checked by the interference of the box and the lid, not by a measure.
- **The schema.** `SCHEMA_PENDING` is 1 on the branch; the test of the real list pins the branch (the version of `master` and the name of the step), and the merge sets the count to zero, the version to 4 and the test back to `master`. Scenario 0 reads the head a build writes from `SCHEMA_VERSION` and `SCHEMA_PENDING`, so it needs no change at a merge.

Known limits, besides those of the design: the text of a refusal suggests corner radii also for a profile that has none (a rectangle under a taper that makes it vanish); it reads as the text of the offset, which says the same.
