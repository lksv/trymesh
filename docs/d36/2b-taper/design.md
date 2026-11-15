# 2b Taper on extrusion (D45)

**State: design, first version, before the reviews.** Written against the sixth version of the contract of the preparatory step and the code at `0dc424b`, and on top of [2a](../2a-offset/design.md), whose outline and offset it uses. The tool shapes of this package were tried against the real kernel adapter in a spike ("What was tried"); nothing else was run.

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
| a countersink from the face the head sits in | the circle of the head, on that face | a cut with a negative `distance` (into the body) and a negative taper: `deg(-45)` for a 90° head |
| the same from the bore | the circle of the bore | `start` at the bottom of the cone, `distance` up to the face, `deg(45)` |
| a chamfer of the bottom edge against elephant foot | the outline | a slab with `profile/offset: -c`, `distance: c` and `deg(45)`; the body continues straight above it |
| a draft on a rib or a boss | its profile | `deg(-2)` |
| a roof that prints without support | the outline | `deg(-45)` |

Reasons:

- It is the sign of the offset: "positive grows the profile" holds for both fields, and the far profile is literally the near one with an offset.
- It does not flip when the direction of the extrusion flips. A convention tied to the normal of the sketch plane would make the same countersink positive from one face and negative from the other.
- As far as Claude recalls, Fusion and FreeCAD read a positive taper angle of an extrusion the same way. This was not checked against their documentation and is not the reason.

**The sketched profile holds at the start of the extent**, also when `start` is not zero. The alternative (it holds in the sketch plane, and the tool is cut out of a cone through it) would make `start` change the size of the start cap, which reads as a bug in every use above.

**The angle is measured from the direction of the extrusion, per side**, so a 90° countersink is 45°. The included angle of a cone is what a hole says (2c); a taper applies to planes as well, where "included" means nothing.

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
- **Orientation** follows the sign of `distance`, as in the prism.
- **What depends on what.** The rings are computed once per recompute step, in the coordinates of the sketch: they depend on the profile, the distance and the taper, not on the targets or on a placement. `ToolRecipe.build` only puts them into the frame, which for a copy of a pattern is the transformed one. An error of the far profile is therefore an error of the feature's step, found before any tool is built, and a pattern repeats a tapered tool like any other.
- The planar step between sections of different outlines is specified here and first used and tested by 2c.

### The far outline and the levels

1. The near outline is `outline()` of the resolved profile (2a): exact curves, after `profile/offset`.
2. The far outline is the near one moved by `|distance| · tan(taper)`, with every check of 2a. A failure is `invalidProfile` and names the curves; the text says that it is the far end.
3. Every pair of corresponding curves gets one number of points: the larger of what `segments` gives for the near and for the far curve (their radii differ, and their sweeps where a corner slid along the arc).
4. **Levels.** Between a line and a line, and across a tangent joint, the straight segment from a near corner to its far corner lies in both side faces: the offset keeps a line parallel to itself and keeps a tangent joint tangent, so the side of a line is exactly a plane, the side of an arc exactly a cone, and the corner edge is a ruling of the cone that lies in the plane. Where an arc meets its neighbour at an angle the corner moves along a conic as the offset grows, and the straight segment leaves both surfaces. For such an outline the section gets intermediate rings: the outline moved by `t · |distance| · tan(taper)` at the level `t` of the way. The number of intervals doubles until, for every such corner and every interval, the corner of the exact outline at the middle of the interval lies within the chord tolerance of the middle of the segment; at most 64. Every ring built is checked like the far one. An outline of lines, circles and tangent arcs (a rectangle, a rounded rectangle, a slot, a circle) has one interval.

Tessellation error: a cone between two rings of the same count deviates from the true cone by at most the sagitta at the larger radius, which is what the count was chosen for.

### Surfaces of the sides

| Curve | Surface | `FaceInfo` |
|---|---|---|
| a line | a plane through the near line and the far line | `origin`: the start point of the line (its point `a`) at the start of the extent; `y`: the unit vector in the plane across the line, on the side of the normal of the sketch plane (for a taper of zero it is that normal, as today); `normal`: across both, without a sign |
| an arc, a circle | a cone about the normal of the sketch plane through the centre | `apex`: on that axis, where the radius would be zero: at the level `start − r₀ · distance / (r₁ − r₀)` for the radii `r₀` at the start and `r₁` at the end; `axis`: the normal of the sketch plane, signed so that it points from the apex to the face; `halfAngle`: `|taper|` |

- A sketch can stand on the tilted plane of a line, as on a straight side (`calls.ts`, `ribDraft`). With `start` not zero its origin is at the start of the extent, not in the sketch plane; with `start` zero it is the origin of today.
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
| `recompute/state.ts` | `Prism` becomes `BuiltTool` |
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
| the same countersink cut a second time (a copy of a pattern that lands on the original) | no change of the volume; the faces of the second tool take the place of the first, which is the case `applyTool` already reports as `noEffect` for a copy |
| a tapered cut followed by a straight bore of the radius of its lower ring, the bore with 36, 40, 48 and 64 sides against 48 of the cone | passes every time. With another count, slivers of the end cap of the tapered cut stay between the two polygons, so the cone has a third edge. With the same count they do not |

One position each and no random placement: it shows that the adapter takes these shapes, not that it is robust for them. The fuzz of the adapter has to get tapered tools (tilted planes flush with tilted faces are the case its coplanar handling has to prove; cones are not planar and it leaves them alone, as it does cylinders).

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

- Whether 64 intervals and the test at the middle of an interval are the right bound for the levels. It is a heuristic: the conic has no inflection between two corners, so the middle is where a chord is furthest from it or close to that.
- The text of the paragraph for the AI. The table of uses is the candidate.

## Needs from the preparatory step

- **A home for the circle of two surfaces.** The vocabulary states the rule in prose; `edgeKind` and `projectEdge` need it over `FaceInfo` (this package) and the body description of 1b over `Surface`. If both packages write it, the rule exists twice. Case: `mouthOf` in `calls.ts` asks the radius of the mouth of a countersink from its two surfaces; today nothing declares that function. Stand-in: `circleBetween` in `contract.ts`. Proposed: the engine has it once, over `Surface` (a `FaceInfo` is turned into one already), and 1b imports it.
- **Who writes the cone.** The contract says `FaceInfo` "gets the two new kinds" and that `BodyFace.convex` covers "a cylinder and a cone", without saying which package adds the cone to `FaceInfo`, to the derivation of `Surface` and to `convex`. This design takes all three, because no face is a cone before it. If the preparatory step writes them first, 2b only builds the faces.

## Tests the implementation owes

- Engine: the volume of a tapered box and of a frustum of a circle against the formulas; the surfaces (the plane of a line, the cone of a circle and of a hole in a profile, the apex and the direction of the axis for both signs of the taper and of the distance); the kinds of the edges and both projections of a countersink; a sketch on a tilted side; a D shape with levels (the corner within the tolerance); every refusal; a pattern of a tapered cut; `circleBetween` for the four pairs and for what must not be a circle.
- The adapter: tapered tools in the fuzz.
- The upgrade: a document with a taper saved, loaded, and refused by a list of steps without `2b-taper`.
- Scenario 12.

## Reviews

Not yet run.
