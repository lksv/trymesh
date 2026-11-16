# Architecture: the extrusion

Part of [architecture.md](../architecture.md), the design as implemented. The extrusion, its extent and targets, the offset of a profile and a wall along curves, profile generators.

## Extrude

Krok přepočtu má tři oddělené části (D35 krok 0), aby šla každá později vyměnit nebo zopakovat samostatně:

1. **Profil.** Ze zdroje profilu vzejdou oblasti v rovině a souřadný systém roviny. A generated profile comes from its generator (below); regions with an offset and a wall along curves come from an exact outline ("Profile offset and a wall", below). U zdroje `regions` se vyhodnotí rovina skici a vybrané oblasti; neplatný profil → `invalidProfile`, chybějící oblast → `noProfile`. Oblouky a kružnice jsou rozdělené na segmenty podle `chordTolerance`, nejvýš na 4096 úseček na křivku (u obřích poloměrů pak dělení toleranci nedodrží).
2. **Tool.** The engine builds the closed mesh of a prism over an interval along the normal of the sketch plane: two caps (triangulated by the kernel) and the side faces. For the extent `distance` the interval is `start` to `start + distance`; for `throughAll` it is measured against the targets (below). Every triangle gets a face number by name; `startCap` is the cap at the start of the interval and `endCap` at its end, whichever way the interval points.
3. **Application.** `new` stores the tool as a body. `add` and `cut` hand a tool recipe to `applyTool`, which runs one boolean per target body.

**Tool recipe.** `ToolRecipe` is the operation, the targets and the function `build(targets, firstFaceId, placement?)`, which builds the tool again for the given target solids with face numbers from the given number; `placement` is the rigid transform and the copy tag of a copy made by a pattern. `applyTool` works from the recipe alone and knows nothing about extrusions, so any later feature that produces a tool (a revolve) is applied the same way. It is a function of a model (bodies and the face table) that returns the changed model and the targets it left unchanged, or the reason it failed; the caller decides what that means for its feature. The recompute state keeps the recipe of every `add` and `cut`, also when the operation had no effect (`noEffect`); a feature in error (`brokenReference`, `kernelFailure`, `emptyResult`, a profile error) has none. The pattern reads the stored recipe to repeat the tool in another position. A recipe is stored instead of a mesh because the length of "through all" has to be measured again for every copy.

### Extent and targets (D35, point 2)

**Targets.** `new` has no target, `add` exactly one (adding to several bodies would merge them) and `cut` one or more: a screw hole through two bolted parts is one cut with both bodies as targets. A target may not be listed twice. The tool is built once and subtracted from every target in the order of the list; every changed body carries the tool's faces under the same names, which is unambiguous because a face is always referred to together with its body.

**Through all.** `{ type: 'throughAll', side }` is accepted only with the operation `cut`, because its length comes from the targets. The side is always explicit: `forward` is along the normal of the sketch plane, `backward` against it, `both` on both sides. For a sketch on a face the normal points out of the body, so an ordinary hole is `backward`.

- The interval is computed by `toolSpan` from the vertices of all targets together, projected onto the normal of the sketch plane: `forward` is `[0, high + overshoot]`, `backward` is `[0, low − overshoot]` and `both` is `[low − overshoot, high + overshoot]`, where `low ≤ 0 ≤ high` is the extent of the targets measured from the sketch plane.
- The extent of the whole body counts, not only the part under the profile.
- The overshoot is `max(1 mm, 1 % of the largest absolute coordinate of the targets and of the origin of the sketch plane)`. It keeps the cap of the tool out of the plane of a body face. The kernel adapter resolves about 1e-4 of the largest coordinate of body and tool together, so the overshoot is normally two orders of magnitude above it. Where it is not (a profile far larger than the targets), the adapter takes the cap as flush with the face, which it handles like any flush face; holes then still go through.
- The length is measured every time the tool is built, against the targets in the state the tool is applied to. A hole through all therefore follows a later change of the thickness, and a pattern measures it for every copy.
- A side on which no target reaches gets just the overshoot: the tool misses and the result is `noEffect`.
- `throughAll` (`recompute/extent.ts`) measures it and answers, next to the span, the reach of the targets on the side asked for without the overshoot, the largest coordinate it follows and the overshoot itself; `toolSpan` returns its span. The hole of D46 compares its head with the reach ([hole.md](hole.md)).
- The extent has no numeric field, so it has no expression; `FEATURE_TYPE_INFO.extrude.fields` lists `extent/start`, `extent/distance` and the optional `extent/taper` (D45) with `when: extent/type = distance`, and `extent/start` once more with the optional `extent/gap` for `upTo` (D47).

### Extent up to a plane (D47)

`{ type: 'upTo', plane, start, gap? }`: the tool runs from `start` (as for a distance) to a plane. The design with its alternatives and reviews is [d36/2f-upto/design.md](../d36/2f-upto/design.md).

- **The plane** is a `PlaneRef`, validated by `planeRef` as the plane of a sketch: a base plane, a plane feature, or a planar face of a body. Its references are listed by `extentRefs` (`features/extent.ts`), so a command refuses a plane of a later feature and `moveFeature` keeps the extrusion behind what the plane needs. For a face it is the whole plane the face lies in: the tool ends there also where its profile passes beside the face (a miss is no error).
- **No side.** The tool runs to the plane on whichever side of the start it lies; the result says which (`forward`).
- **The variant lists its fields** (`type`, `plane`, `start`, `gap`): another key, a `taper` among them, is an invalid command. `start` is the field `extent/start` (a second row of the registry with `when: extent/type = upTo`); `gap` is an optional field `extent/gap` by the rule of [document.md](document.md). A patch with `plane` replaces the reference; a patch with another `type` replaces the variant and has to be complete. For every operation (`extentOf` takes `upTo` from its caller). No upgrade step: an older build refuses the unknown type.

**Recompute.**

1. The step resolves the plane with `frame` (`recompute/services.ts`) in the state before the feature: `brokenReference` or `nonPlanarFace` (refs: the plane) end the step. The recipe keeps the plane as a point and a unit normal (`EndPlane`) in the closure of `build`, so a copy of a pattern of features measures to the plane the feature saw, also when the feature itself swallowed the face. A pattern of a body copies the body as it is, so under a tilted plane its copies do not end in the plane.
2. `upToSpan` (`recompute/extent.ts`) measures, for every vertex of the polylines of the profile (the tool that is built; the length is linear, so the vertices test all of it), the length from the start along the normal of the frame to the plane: `N · (Q − P) / (N · n)`.
   - `|N · n| ≤ sin(UP_TO_MIN_ANGLE)` (0.01 rad): `invalidExtent`, the plane is parallel to the direction or nearly so. The angle bounds every length by a hundred times the distance of the start from the plane.
   - The lengths have one sign, each beyond `LENGTH_TOLERANCE`; otherwise the plane passes through the start or touches it: `invalidExtent`.
   - The gap moves the plane along its own normal towards the side of the start (measured across the plane, so a tilted plane shortens the tool by the gap over the cosine of the tilt); the lengths to the moved plane have to keep their sign beyond the tolerance, otherwise `invalidExtent` ("the gap … is as large as the way to the plane").
   - Lengths that differ by no more than `LENGTH_TOLERANCE` (a plane parallel to the sketch) give one length, the middle of the extremes: the span `[start, start + length]` of a distance extent, with its end cap, and `lengthMin` equal to `lengthMax` exactly.
   - Otherwise the span is a `TiltedSpan`: the end level as a function of the point of the sketch, and the plane of the end cap: `origin` the origin of the sketch carried along the normal into the plane, `y` its Y axis carried the same way, `normal` the normal of the plane.
3. The feature's own lengths are measured in the step: a refusal is the error of the step, with `refs` the plane and a detail that says why. A copy measures its own in `build` (the frame of the copy) and throws `ToolProblem('invalidExtent', [plane], detail)` (`recompute/state.ts`); `applyTool` and the step of an extrusion with the operation `new` turn it into the error with that code, so a pattern reports the copy first in `refs` as for any failed copy. Every other exception of a build stays `kernelFailure`.
4. `buildPrism` takes the end as a level per vertex; the side of the first vertex decides the winding and which cap is `startCap`. With one length the mesh is that of a distance extent, vertex for vertex.
5. `facts` of the result: `lengthMin`, `lengthMax` (positive, along the normal of the sketch plane) and `forward`, for the tool of the feature itself, next to the facts of a profile generator.

**Faces.** The sides are those of a straight extrusion, cut off by the end. The end cap is a plane a sketch can stand on; its edges with the sides of lines are lines, with a cylinder a circle only when the plane is across the axis (`other`, an ellipse, otherwise).

**Flush ends.** A cut up to a face of its target ends exactly on that face; an addition up to a face of another body touches it. Flush planar faces, tilted ones included, are what the kernel port guarantees.

**Limits.** An addition that ends exactly flush on a face of its target keeps that face under its old name where the two overlap (the kernel's rule for coplanar faces); the face is gone only where the tool covers it and passes it. The angle 0.01 rad is a policy that keeps the length in proportion to the model, not a guarantee of the accuracy of the kernel for every model.

### Profile offset and a wall (D44)

Two ways to a profile besides plain regions, both in the profile service (`recompute/profile.ts`, `recompute/outline.ts`), so every feature that takes a profile gets them. The design with its alternatives and reviews is [d36/2a-offset/design.md](../d36/2a-offset/design.md).

```ts
type ProfileSource =
  | { type: 'regions'; sketch: Id; regions: RegionRef[]; offset?: number }   // `profile/offset`, mm, either sign
  | { type: 'wall'; sketch: Id; curves: Id[]; thickness: number }            // `profile/thickness`, mm, positive
  | { type: 'generated'; ... };                                              // no offset
```

**What a profile hands to a tool build** (`ResolvedProfile`, `recompute/state.ts`): the regions as polylines, the frame, `sideOf(key)` and `outline()`.

- `sideOf(key)` answers for what `Loop.curves` holds for an edge: the name of the side face without its feature (`{ role: 'side', curve }` for regions and a generated profile; a wall names its sides itself) and its shape (a line, a round, a general curve). `buildPrism` builds the name and the surface of a side face from it and knows no role.
- `outline()` is the exact outline the regions were divided from, after the offset: closed loops of `OutlineCurve` (`sketch.ts`: a line, an arc with a signed sweep, a circle; each with the key of its side, the direction it is passed in and, for a line and an arc, its two end points and the keys of its two vertices), the material on the left of every loop, an outer loop and its holes per region. A tool build that has to move the outline again asks for it (the taper of 2b); a generated profile has none.
- `detectProfile` keeps the exact curves of every loop it builds (`Loop.exact`), for the loops of half-edges and for the loops of circles.

**Unchanged when not used.** A profile of regions whose offset is absent, or zero after its expression is evaluated, takes the path it always took: the regions of the sketch, by reference. The meshes of a document that does not use the offset are byte for byte what they were (pinned by a hash in `packages/scenarios/test/review.test.ts`).

**The outline of the selection** (`selectionOutline`). The offset moves the selected regions together, as the prism takes them for side faces:

1. Of the curves of all loops of all selected regions, a curve that occurs twice (once from each of two selected regions) is dropped. A rectangle with circles inside it, all selected, is the plain rectangle.
2. The rest is chained by vertex keys. Where several curves leave a vertex (regions that meet in a point), the chain goes on along the loop it came by, so two squares that share a corner are two loops; when that curve was dropped as well, the profile is refused.
3. A loop with a positive area (the polygon of its corners plus the circular segments of its arcs) is an outer loop; the others are holes of the smallest outer loop that contains them.

**The move of a loop** (`movedChain`). Every curve moves to the right of its travel by `d`; the material is on the left, so a positive offset grows the profile and shrinks its holes.

- A line becomes the parallel line. An arc and a circle keep their centre; the radius grows by `d` on a counter-clockwise pass and shrinks by `d` on a clockwise one.
- The corner between two moved neighbours: tangent neighbours (directions equal within `ANGLE_TOLERANCE`) get the old corner moved along the common normal, with no intersection computed (a tangent contact is a double root); two lines get the intersection of the moved lines (a mitre, so a sharp corner moves by `d / sin(half the corner angle)`, without a limit); a line and a circle, and two circles, get the one of the two intersections of the moved carriers that lies on the branch of the old corner (the same one in the order along the line; the one on the same side of the line of centres). At a cusp (the neighbours touch and the loop turns back) the old corner is the point of contact, which lies on the axis the two intersections mirror about and so on no branch: the corner is then the intersection in the direction of travel of the curve that starts there, where the wedge of material is.
- Refused: a radius not above `LENGTH_TOLERANCE`; neighbours whose moved carriers do not meet; a curve that turned round or has no length left (a line whose new ends are not in its old direction by more than the tolerance; an arc whose new sweep, the old one plus the changes of its two end angles each taken within half a turn, has lost its sign, is not longer than the tolerance along the arc, or exceeds a full turn).
- The topology never changes: every curve maps to one curve, so side faces keep their names and their exact surfaces (the plane of the moved line, the cylinder of the new radius). A curve that vanishes is an error, not a reason to join its neighbours (decided by the owner, D44; the narrow case of a corner arc that drops out is in the [backlog](../backlog.md)).

**The polylines** (`outlineRegions`). The moved outline is divided by the rule of a sketch profile (`segments`, by the new radius), every vertex with a key of its own, and tested in this order:

1. on the exact curves, two curves touch only at a corner they share (`touchingCurves`, the check `compatible` of a sketch profile);
2. **clearance** (`polygonProblem`): any two edges that do not follow each other in one loop are farther apart than `LENGTH_TOLERANCE` (the distance of two segments, zero when they meet in any way), and of two edges that do follow each other the other end of each is farther than the tolerance from the other edge. Edges follow each other by position in the loop, not by a common key, so a loop that returns to a point is refused. The sweep is the one of `soundTessellation` with the boxes widened by the tolerance. What passes is simple polygons with no point in common;
3. **area**: every loop has the sign of area of its exact loop and an area above the tolerance times its length (a sliver between an arc and its chord that the division flattens fails here or as a loop of fewer than three points);
4. no two edges cross (`soundTessellation`, the second check of a sketch profile; the clearance covers it and names the curves, so it finds nothing new);
5. **nesting**: for every pair of loops "lies inside" is what it was for the exact loops before the move (`nestingOf`: the middle of a curve against the exact curves of the other loop), tested with one vertex against the polygon of the other loop (`polygonNesting`). It catches a hole that grew past its outer loop without touching it, and a small hole that lies inside an exact circle and outside its polygon.

The crossing test of a sketch profile alone would not do: it sees only edges whose ends lie strictly on opposite sides of each other, so an edge that ends on another, passes through its end or runs along it is no crossing to it.

**A wall** (`wallOutline`) is a chain of own curves of the sketch moved by half the thickness to each side.

1. The curves are looked up among the own curves of the solved sketch; one that is not there is a `brokenReference` that names it. A command verifies each curve it adds: an own line, arc or circle of the sketch, construction or not; projected geometry is refused (the reference has the flag `notProjected`, checked in `requireRef`), because the ends of a wall are named by sketch points. The list is stored sorted and without duplicates.
2. They are chained by joined end points, by the rule of a sketch profile (`pointJoins` of `sketch.ts`: the same point, or points held by a `coincident` that is satisfied). Refused as `invalidProfile`, with the curves named: a curve without length, three curves at a point, curves that are not connected, a circle together with anything else.
3. An open chain is walked from the free end with the smaller vertex key, a closed one counter-clockwise. It is moved by `+thickness / 2` and by `−thickness / 2`; the free ends of an open chain move along their own normals.
4. Open: the right side forwards, a straight end, the left side backwards, a straight end. Closed (a loop of curves, a circle): the right side is the outer loop and the left side, reversed, its hole.
5. The same tests of the polylines as for the offset. A chain that crosses itself, or whose two sides cross at a tight bend, is refused there.

The source reads the solved curves only. It needs neither regions nor a valid profile of the sketch, so the centre line of a rib may be a construction line, or a line that ends on the wall it stiffens.

**Faces of a wall.** Every curve of the chain makes two side faces, so `side` with the curve would name both:

| Face | Name | Surface |
|---|---|---|
| a side from a line | `{ role: 'wallSide', curve, side }` | plane; its origin is the moved start of the line in the direction of the sketch curve |
| a side from an arc or a circle | the same | cylinder |
| a free end of an open chain | `{ role: 'wallEnd', point }` | plane; its origin is the corner on the left of the end curve |
| caps | `startCap`, `endCap` | plane |

`side` is `left` or `right` of the curve in its own direction: a line from its point `a` to `b`; an arc and a circle counter-clockwise, so `left` is the side of the centre. `point` is the point the end curve names there (`a`, `b`, `start` or `end`). The names depend on the sketch curve alone, not on the order of `curves` or on the end the chain is walked from, and a curve added to the chain renames nothing but the end it extends.

**Errors.** No new code. `invalidProfile` for an offset or a wall that cannot be built carries a message of its own, like a generator's: it starts with what moved the outline ("The offset of -3 mm", "The wall 2 mm thick"), names the curves (also in `refs`) and ends with what to do (a smaller offset or a larger corner radius, or the moved outline drawn in the sketch; a thinner wall or wider bends). The curves are always curves of the sketch: the outline of a wall has keys of its own for its sides and ends, and a refusal names the curve of a side and the end curve of an end.

**A limit.** The tests of the polylines work at `LENGTH_TOLERANCE` (1e-6 mm), and a body is stored in float32. An offset that leaves a strip thinner than float32 resolves at its place (about 1e-5 mm at 100 mm from the origin) and thicker than the tolerance passes, and the body has no volume there. A sketch drawn that thin without an offset behaves the same; the offset only makes such a strip easy to reach with a parameter.

**An optional numeric field.** `profile/offset` is the first numeric field of a feature that may be absent ([document.md](document.md), "Catalog of numeric fields").

### Taper (D45)

An extent of a distance may taper: `{ type: 'distance', start, distance, taper? }`, the angle in radians between a side face and the direction of the extrusion, strictly between −π/2 and π/2. The design with its alternatives and reviews is [d36/2b-taper/design.md](../d36/2b-taper/design.md).

- **Where the profile holds and the sign.** The profile of the sketch (after `profile/offset`) holds at the start of the extent, also when `start` is not zero. At the end it is that profile moved by `|distance| · tan(taper)` with the move of the offset ("Profile offset and a wall"), so a positive taper widens away from the start whichever way `distance` points (outer loops grow, holes shrink), as a positive offset grows a profile; a negative one narrows.
- **An optional field** (`extent/taper`, unit `rad`, default 0) by the rule of [document.md](document.md) ("An optional field of a feature"): absent means none and is not stored; `setField` adds it; `{ extent: { taper: null } }` removes it, and is accepted also where the extent has none or becomes "through all" in the same patch.
- **Invalid commands**, structural: the field on an extrusion with a generated profile (it has no curves to move), and the key `taper` on an extent that is not `distance` (the size of the far end of "through all" would follow the targets). The validator of an extent drops keys it does not know, so this key is refused by a line of its own; `extentOf` takes the reason a feature may have no taper (`noTaper`) from its caller, so the hole of 2c can use the extent without one. Another variant in a patch replaces the extent, the taper with it.
- **Without a taper**, or with one that moves the far end by no more than `LENGTH_TOLERANCE` (`tapers` in `recompute/taper.ts`; zero, or the rounding remainder of an expression meant to give zero), the tool is the prism (`buildPrism`), triangle for triangle what it was. A cone whose apex lies kilometres away would only lose its precision.

**The tool: a stack of rings** (`recompute/tool-stack.ts`, `buildStack`). The rings are the outline at levels along the normal, computed once per recompute step in the coordinates of the sketch (`taperedSection` in `recompute/taper.ts`, the rings by `taperRings` in `recompute/outline.ts`); a tool build only places them in its frame, so a pattern repeats a tapered tool like any other and an outline that cannot reach the far end is an error of the step before any tool is built.

- Every ring has the same loops with the same number of points: every curve gets the largest count the rule of a sketch profile (`segments`) gives it over the rings, so rings pair point by point and the mesh is closed by construction.
- The two caps are triangulated by the kernel each on its own (`startCap` at the start of the extent, `endCap` at its end); between two neighbouring rings every edge of a loop gives two triangles, `(P[k], P[k+1], Q[k+1])` and `(P[k], Q[k+1], Q[k])` for the points `P` of the nearer ring and `Q` of the other. The winding follows the direction of the rings along the normal; like the prism the build assumes a right-handed frame.
- Side faces are numbered after the caps in the order of their keys, as the prism numbers them by the curve.
- `buildStack` takes a list of sections (D46, the hole): where a section starts in the outline the one before ends in, the two share that ring; where it starts at the same level in another outline, a planar step lies between them, triangulated by the kernel as a region with the narrower outline as its hole and named by the section (`step`, a seat of a hole). The faces are the caps, the steps, then the sides by key. An extrusion with a taper builds one section, as before.

**Levels.** The offset keeps a line parallel to itself and a tangent joint tangent, so in an outline of lines, circles and tangent arcs the straight segment between a near and a far corner lies in both side faces: such an outline (a rectangle, a rounded rectangle, a slot, a circle) has two rings. Where an arc meets a neighbour at an angle, its corner slides along it from ring to ring (its start or its sweep changes), and straight triangles between two rings leave its cone. For such arcs:

- the arc is divided for a quarter of the chord tolerance;
- the number of intervals between the ends doubles (the outline at the level `t` is the near one moved by `t · |distance| · tan(taper)`) until the centroid of every side triangle of such arcs lies within a third of the chord tolerance of its exact cone, measured as `(r − R) · cos(taper)`, at most `MAX_INTERVALS` = 64. The deviation from a cone is convex over a flat triangle whose corners lie on the cone, so a third at the centroid bounds the whole triangle by the tolerance (the proof is in the design). At 64 the tool is built as it is and the tolerance is not shown there.
- Every ring is checked like an outline moved by an offset.

**Surfaces of the sides.** The names are those of the straight extrusion.

| Curve | Surface |
|---|---|
| a line | a plane through the near and the far line. `origin`: the start of the line as the straight extrusion gives it (the start of the sketch curve; for a wall its own rule), moved across the line by `−start · sign(distance) · tan(taper)`: where the plane meets the sketch plane. It is the start itself for a start or a taper of zero, so a taper whose expression passes through zero moves no sketch on the side. `y`: across the line in the plane, on the side of the normal of the sketch plane |
| an arc, a circle | a cone about the normal through the centre: `apex` at the level `start − r₀ · distance / (r₁ − r₀)` for the radii `r₀` at the start and `r₁` at the end, `axis` the normal signed from the apex towards the face, `halfAngle` = \|taper\|. `r₁ − r₀` is taken as the move of the far end, signed by the direction the curve runs (counter-clockwise grows), not as the difference of two radii that may be nearly equal. A hole tapers the other way than its outer loop; its cone opens the other way |

**Circles between surfaces** (`circleBetween` in `surfaces.ts`, over `Surface`). `edgeKind` and `projectEdge` of `solid.ts` both ask it, and the body description of 1b reads it: a plane across the axis of a cylinder or of a cone (on the half the cone's axis points along), a cylinder and a cone about one axis, two cones about one axis where their radii are equal on the halves of both. "About one axis": parallel within `ANGLE_TOLERANCE` and a point of one axis within `LENGTH_TOLERANCE` of the other. The radius has to be above `LENGTH_TOLERANCE`. Two cylinders, also on one axis, stay `other`. So the mouth of a countersink (the face it is cut into and the cone) and its lower rim (the cone and the bore, two features) are circles a sketch projects.

**Errors.** No new code. A far outline (or a level) that cannot be built is `invalidProfile` with the text of the offset, which starts "At the far end of the extrusion, the taper of -80°" (or "At 1.5 mm from the start of the extrusion" for a level), names the sketch curves and ends with what to do: a smaller taper or a shorter distance, and a wider profile with corner radii larger than the move of the far end, or the far outline drawn in a sketch; for a wall, a thicker wall or wider bends. The ring at the start is the profile itself, checked by the stricter tests of a moved outline: selected regions that meet in a point pass as a straight extrusion and are refused here with "At the start of the extrusion, the profile …" and the advice to select regions that do not meet, or to extrude without a taper.

**Limits.**

- Two features that meet in a circle are two polygons: the lower ring of a cone has the count of its larger ring, a bore of the same radius its own count, and slivers of the end cap of the tapered cut can stay between them (a third edge of the cone, also a circle). The hole of 2c builds both in one tool.
- A tool built in a mirrored frame comes out turned inside out, for the prism as for the stack, by the rule every build keeps (it places the vertices by its frame and does not look at the handedness); `applyTool` turns the tool of a mirrored copy over (D53, [pattern.md](pattern.md)).
- The rule of the levels spends about twice the points the tolerance needs, and the levels belong to the whole outline: one arc whose corner slides multiplies the rings of every curve, unrelated circles included (a review measured a D-shaped plate with 24 holes: 2 386 vertices without a taper, 3 918 at 0.1 rad, 11 799 at 0.3 rad), because the stack pairs rings point by point. Its loop was run on discs cut by a line, a lens of two arcs, a concave bite, a half disc as a hole and a half disc near collapse (engine tests and a review), not on every shape.
- At `MAX_INTERVALS` the tool is built without a warning.

### Profile generators (D35, point 3)

A generator turns a few entities of a sketch and a few parameters into the loops an extrusion sweeps. Operation, extent and targets belong to the extrusion, so a generated profile gets "through all", several targets and later the pattern without further work.

**Catalog.** `GENERATORS` in `generators.ts` is the single source of truth, like the constraint catalog. An entry lists:

| Part | Meaning |
|---|---|
| `operands` | Entities of the sketch by name and the entity kinds accepted (a gear: `circle`). Own curves, construction or not, and projected ones qualify |
| `params` | Numbers (`NumberSpec`: unit, range, default) and flags. A number is a numeric field at `profile/params/<name>` and accepts an expression. A number without a default is required. The document type already allows a string, for options and text of later generators |
| `refs` | References to earlier extrusions whose profile comes from one of the listed generators |
| `sides` | Names of the side faces the generator creates |
| `facts` | What the generator publishes about the profile, with descriptions |

Validation, expressions, `FEATURE_TYPE_INFO.extrude.fields` (the parameters with `when: profile/generator = <name>`), the app's form and the API description for AI are built from the catalog. A new generator is an entry and a build function; the document shape does not change.

**Validation.** Dictionaries may hold only the names the catalog knows, and a profile only the fields of its variant (regions with generator parameters are an invalid command, not plain regions). In a patch `null` may name an entry the catalog knows whether the feature has it or not; any other name that is not there is rejected like every unknown field. Parameters a command leaves out get their defaults and are stored; the profile is stored in the order of the catalog. A command verifies the references the feature did not have before, as everywhere: the sketch, the operands (the entity exists in that sketch and has an accepted kind; `FeatureRef` of the kind `entity`) and the references to other features (an earlier extrusion with one of the accepted generators; kind `generated`). Loading a document verifies only the shape.

**Recompute.** The generator is a pure function `(operands, params, refs, frame, chordTolerance) → regions, facts, warnings` or a failure with a message.

- It reads only the solved operands (centre and radius of the circle), so it does not depend on the profile of the sketch being valid. Pitch circles of gears in mesh touch, which invalidates the profile of the sketch unless they are construction circles.
- An operand that is no longer in the sketch is `brokenReference` with the entity in `refs`.
- A failure (a pointed tooth) and a profile above 50 000 points are `invalidProfile` with the generator's message. The gear knows the size of its loop beforehand and refuses before building it; an arc has at most 4096 chords. A tooth whose tip, or a gap whose root, is narrower than the length tolerance counts as pointed or overlapping.
- `refs` are handed over as the facts of the features referred to; a feature that is missing, suppressed or in error has none, and the generator decides what that means (a gear warns and goes on).
- The regions have the shape of sketch regions (outer loop counter-clockwise, holes clockwise), so the prism builder takes them as they are. Every edge carries the name of its side instead of a curve ID.
- `facts` and the generator's warnings become part of the feature result (`FeatureResult.facts`); warnings make the status `warning`. A feature in error publishes no facts.

**Involute gear** (`involuteGear`). The pitch circle is the operand, the module follows from its diameter and the tooth count.

- Parameters: `teeth` (integer, 4 to 500, required), `pressureAngle` (radians, in (0, π/2), default 20°), `backlash` (mm along the pitch arc, default 0), `rotation` (radians, default 0) and the flag `internal`.
- An external profile is the gear: tip circle `r + m`, root circle `r − 1.25 m`. An internal profile is the tool that cuts a ring gear: it reaches from the tip circle of the ring `r − m` to its root circle `r + 1.25 m` and removes the centre as well.
- The flank is an involute from the base circle; below it the flank is radial. No profile shift, no fillet at the root.
- Backlash thins the tooth of an external gear on the pitch circle and widens the tooth space of a ring.
- The flank is divided evenly in arc length until the chords stay within `chordTolerance`. Chords lie inside the exact tooth, which is the safe side for a gear. The flank of the ring tool is moved outwards by the largest distance of the flank from its chords (a curve parallel to an involute is the same involute turned by distance / base radius), and its arcs are made of tangents instead of chords, so the polyline lies outside the exact tool everywhere and gears with zero backlash do not overlap. The distance is searched for along every chord, because the curvature of an involute changes along it and the farthest point is not the middle one. Without the offset the ring's teeth were up to 0.006 mm too thick.
- `rotation` is the direction of the axis of one tooth in sketch coordinates (for a ring of one tooth space).
- **Mesh.** With `refs.meshWith` the rotation is computed from the other gear's facts, which are in model coordinates, so the two gears may come from different sketches with parallel planes, also mirrored ones. The phase of a gear in a direction from its centre is the fractional part of `(direction − rotation) · teeth / 2π`. For two external gears the phases at the pitch point add up to 1/2; for a gear inside a ring they are equal. Either gear of an internal pair may be the one that refers.
- The mesh needs equal modules (relative 1e-6) and pressure angles, parallel axes and tangent pitch circles (1e-6 of the size). If something does not hold, or the other gear has no facts, the feature has the warning `gearMesh` with the reason and uses the parameter `rotation`.
- With the mesh in place the generator checks whether the tip of one gear runs into the root of the other below its base circle (`gearInterference`): the limit is `√(rb² + (a · sin α)²)`, both gears of an external pair are judged, and for a ring the inequality is reversed.
- Facts: `module`, `teeth`, `pressureAngle`, `backlash`, `internal`, `pitchDiameter`, `baseDiameter`, `tipDiameter`, `rootDiameter` (of the gear; for a ring the tip circle is the inner one), `rotation`, `meshed`, and in model coordinates `center`, `axis` and `toothDirection`.

Výsledky, které nejsou běžné:

| Situace | Chování |
|---|---|
| `cut` misses a target, `add` adds nothing | The target stays unchanged and the feature has the warning `noEffect`, whose `refs` list the unchanged targets. The other targets of a cut are cut, and the message then says that only the targets in `refs` were missed. When nothing changed at all, no face of the tool enters the face table. The change of volume is measured against the smaller of the two solids (body, tool), so a small boss on a large plate does have an effect. |
| `add` kusu, který se tělesa nedotýká | Těleso má dvě nesouvislé části; stav je `ok`. |
| `cut` would remove a whole target | Error `emptyResult` with the target in `refs`; the feature behaves as an empty operation and none of its targets changes, not even those cut before the failing one. |
| A target is missing (removed, suppressed, in error) | Error `brokenReference` with the missing targets in `refs`; nothing is cut. |
| Jádro selže | Chyba `kernelFailure`. |

**Koplanární stěny (D19).** Engine staví nástroj přesně podle skici a nic neposouvá. Skica na stěně znamená, že víko nástroje leží v rovině této stěny; že s tím jádro neumí pracovat spolehlivě, je vlastnost konkrétního jádra a řeší ji jeho adaptér (viz záruka č. 3 u SolidKernel).
