# 2h The start of an extent at a face or a plane (D66)

**State: design, third version (2026-11-17), after two rounds of reviews ("Reviews"); ready for implementation.** Asked for by the owner on 2026-11-17, after the conversion of an Onshape model found 31 extrusions that start at a face ([onshape-import.md](../../onshape-import.md)). Written against the code at the current head of `master` (`ad8cf61`). The extent of today (`distance` with its taper, `throughAll`, `upTo`) and the hole are in the code, and this package adds to them; step 6 is being worked on at the same time ("Order against step 6"). It is the counterpart of [2f](../2f-upto/design.md) at the other end of the tool and reuses its reference to a plane, its resolution, its error and its form button *Pick*. Track B, needs 2f. The part of the model this package needs was run through the real engine with the starts written as numbers ("Measured"); nothing of the package itself was run.

Files: [contract.ts](contract.ts) (the field, the fact, the upgrade step, the parts of the recompute), [calls.ts](calls.ts) (validation scenario 16, a part from one layout sketch).

## 1. The problem from the user's side

Today an extrusion starts at a number: `start`, the offset of the start from the sketch plane along its normal. Where the start should be a face of the model, the user writes the height of that face into `start` (or an expression that adds up the heights below it), or puts the sketch on the face. Both work while nothing changes; the first one stops following the face as soon as its height is not a plain sum of parameters, the second one costs a sketch per height and a frame per sketch.

### Where a start at a face is wanted

| Use | What the user does | Today |
|---|---|---|
| **A layout sketch** ("global sketch"): every outline of a part in one sketch on one plane, the features at several heights | each feature starts at the face it stands on: a boss on the top of a plate, a rib on the top of the boss | a number or an expression per feature; the converted Onshape model has 31 such starts of about 60 extrusions, all baked into numbers ([onshape-import.md](../../onshape-import.md), "Extrusions") |
| **A boss or a rib on a face that is not the sketch plane** | the outline is where it belongs (in the layout, or in the sketch of the part below), the feature starts at the face | a second sketch on the face, with the outline drawn or projected again |
| **A pocket that starts below a face** | a closed cavity for a magnet or a nut printed over: from the top, 0.6 mm down, then 3 mm deep | `start: 'base - 0.6'`, which breaks when the top is not `base` |
| **A cut from a face by a depth** | a recess, a slot, a label engraved into the top of a part whose sketch is at the bottom | the same expression, or a sketch on the top |
| **A cut or a hole from a face through all** | a counterbored screw hole whose head is at the top of a part whose sketch is at the bottom; a cut through the boss and nothing below | not possible: "through all" starts at the sketch plane, so the head of a hole is at the bottom, and a cut upward through all also removes what lies between the sketch and the face |
| **Layers whose thickness is a parameter** | a base, a shim, a cover, each starting at the top of the one below | expressions that repeat the sum of the thicknesses below; they follow parameters but not anything else |
| **A feature between two faces** | standoffs from the floor of a case up to the underside of a lid; a rib from a floor up to a shelf | `upTo` (D47) gives the end; the start is still a number |
| **A face whose height is not a parameter** | the top of a post that ends at a lid (`upTo`), the face of an inserted part (D62), a midplane (D60), the depth of a hole a catalogue chose | no expression can name it; names of reference dimensions are step 7 of D36 ("Why not wait for step 7") |
| **An AI through MCP** | prefers one sketch per part (one frame for every coordinate, no frame of a face to derive) and names faces by their stable names | computes every height by hand; a wrong sign or a forgotten term is a silent error |

The same start makes sense for a hole (its mouth) and for "through all" on one side. For a revolve the start is an angle, not a level; a start at a plane through the axis is another feature of the revolve and is not this package.

### What a user expects

- **The face moves** (a parameter, an earlier depth, an `upTo` length, a changed insertion): the start follows at the next recompute. Nothing about the feature is edited.
- **The face disappears** (its feature is removed or suppressed, a later cut swallows it): the feature reports which reference is gone (`brokenReference` with the plane in `refs`), acts as an empty operation, and what depends on it is broken; the fix is to point `from` elsewhere or to remove it. Fusion and Onshape do the same. Keeping the last height silently would need geometry stored in the document, which the document never holds.
- **The face is tilted against the sketch**: Fusion's "Start: Object" starts on the face as it is (the profile carried onto it). Here the first version refuses it with a message that names the two ways out (a sketch on that face, or a plane parallel to the sketch); see 3, "Parallel only".
- **The face is parallel to the direction** (a side wall): there is no start; refused, as D47 refuses an end plane parallel to the direction.
- **The start lies beyond the end**: with `distance` there is no beyond (the end is measured from the start); with `upTo` the tool runs from the effective start towards the plane on whichever side it lies (D47), and a plane through the effective start is refused; with "through all" a start beyond every target gives the warning `noEffect`, as a tool that misses its targets does today.
- **A pattern repeats the feature**: the copy stands on the image of the face, as a copy of a feature whose sketch is on that face does; see 3, "A copy carries its start", also for what that means together with `upTo`.

### What the package covers

Covered: every row of the table above where the face is parallel to the sketch plane, for the extrusion (`distance` with or without a taper, `upTo`, `throughAll` on one side) and for the hole (its mouth, by a distance or through all).

Not covered, and why:

- **A start plane tilted against the sketch.** It changes the tool (a start per point, a tilted start cap), raises questions of its own (is the distance along the sketch normal or across the face? a taper? the mouth of a hole on a slope?) and no use above needs it once the sketch can stand on the face. Deferred, with the door open ("Deferred").
- **A start at a curved face** (the start follows the surface) and **"from the next face the tool meets"**: a ray cast against the mesh, as for the end (D47, deferred there too).
- **A start at a point, an edge or a vertex** (Onshape's start entity may be one; the converted model has none): a plane through a point parallel to the sketch is not a `PlaneRef`; a plane feature through a point is deferred in 5c.
- **A start per copy of a pattern** (each copy on its own platform): neither the copy nor the face knows which face belongs to which copy.
- **The start of a revolve**: an angle; another package.
- **An offset start for "through all" without a plane** (`start` on `throughAll`): a plane feature at that offset is the `from`; not added until a case needs it.

## 2. The cheap variant

```ts
type Extent =
  | { type: 'distance'; from?: PlaneRef; start: number; distance: number; taper?: number }
  | { type: 'throughAll'; side: 'forward' | 'backward' | 'both'; from?: PlaneRef } // `from` with forward or backward only (validator)
  | { type: 'upTo'; from?: PlaneRef; plane: PlaneRef; start: number; gap?: number };
type HoleExtent =
  | { type: 'distance'; from?: PlaneRef; start: number; distance: number }
  | { type: 'throughAll'; side: 'forward' | 'backward'; from?: PlaneRef };
```

- **`from`** (optional) is the reference plane the extent starts from instead of the sketch plane: a base plane, a plane feature or a planar face of a body, referred to as a sketch refers to its plane (`PlaneRef`, as the end plane of `upTo`). For a face it is the whole plane the face lies in.
- **`start` keeps its meaning and its field** (`extent/start`): the offset of the start along the normal of the sketch plane, now measured from `from`. The **effective start** is the level of the plane plus `start`; the tool starts there, and lies in the plane `from` only when `start` is 0. `{ from: <the top of the plate>, start: 0, distance: 12 }` is a boss on the plate; `{ from: <the top>, start: -0.6, distance: -3 }` a cavity under a skin of 0.6.
- **Parallel only.** The plane has to be parallel to the sketch plane: its level along the normal of the sketch may differ over the exact outline at the start by no more than the length tolerance. Then the tool is the tool of today with its start at the effective start. The prism, the stack of a taper and the stacks of a hole are built as today; what changes is the step of the extrusion, the step of the hole and "through all", which take the start as an argument (section 4).
- **Resolved at every recompute**, in the state before the feature, so the start follows the face. Measured once, for the feature itself: **a copy of a pattern carries its start** with it.
- **"Through all" from a plane** goes `forward` or `backward`; `both` with `from` is an invalid command. One member of the union, as above, with the rule in its comment and in the validator, so that `extent.from` reads on every variant.
- **The result** tells the effective start in `facts.startLevel`; the facts that measure from the start (`lengthMin`/`lengthMax` of `upTo`, `depth` of a hole through all) measure from the effective start.
- **No new issue code**: `brokenReference`, `nonPlanarFace` and `invalidExtent` (D47, with a second meaning) with the plane in `refs`.
- **An upgrade step** that converts nothing (`2h-extent-start`), because an older build would drop `from` from `distance` and `throughAll` without a word.

**Deferred:**

- **A tilted start plane.** What it would be, so that the first version does not close it: the start becomes a level per point, as the end of `upTo` is (`TiltedSpan` grows a start function and a start cap); `distance` keeps its length at every point, so the end is parallel to the start plane (a sheared prism, its sides those of a straight extrusion); `upTo` measures from the start of each point; "through all" runs from the farthest start. Not with a taper (the rings of the stack are at one level each) and not for a hole (a counterbore has a flat seat). The refusal of the first version becomes a build; a document that loaded before still loads.
- A curved start, the next face, a point or an edge as the start, a start per copy, a revolve, `start` on `throughAll`, as above.

## 3. Decisions

### A field on the variants, not a variant of its own

The start and the end are independent: three ends (`distance`, `throughAll`, `upTo`) times two starts would be six variants, each with the rules of its end repeated. A field that every variant takes keeps the rules of each end where they are and is one sentence for the AI: "any extent may start from a plane". The variant `upTo` lists its fields and gets `from` in its list; the other two take it like the taper.

### `from` is a `PlaneRef`

Validated by `planeRef`, listed by `planeRefs(from, 'extent/from')`, resolved by `frame(ref, state)`: the functions the plane of a sketch, the end of `upTo`, a mirror and a plane feature use. So a base plane, a plane feature (a deck at a parameter height, a midplane, the plane of a pattern) and any planar face of any body (also of an inserted one, D62) are a start, a face of a feature after this one is an invalid command, and `moveFeature` keeps the feature after what the plane needs. A reference of its own (`{ body, face }`) would need its own validator, references and resolver for less (2f, "The reference").

### Parallel only

The first version accepts a plane whose level over the exact outline at the start differs by no more than `LENGTH_TOLERANCE` (1e-6 mm) and refuses any other with `invalidExtent`. Reasons:

- **Every use of section 1 is parallel**, and so is the model that asked for the package: all 31 starts from an entity of the converted actuator are planar faces parallel to their sketch ("Verified").
- **The tool stays the tool of today.** The level is a number; the effective start is a number. The builds (`buildPrism`, `buildStack`, `taperedSection`, the sections of a hole, `upToSpan`) read it as they read `start` today.
- **A tilted start has questions this package does not need to answer** (along what is the distance measured; a taper; a hole on a slope), and the way out exists: a sketch on the tilted face.

**Over what the level is tested.** Not by the angle between the planes at the origin of the sketch: 2f learnt that a plane a hair off parallel, measured at an origin far from the profile, is off by the tilt times that distance without a bound (2f, round 2). Not over the vertices of the profile's regions either, which round 1 showed is not what is built: with a taper, `taperRings` resamples the outline (a circle of radius 0.1 widening to 1 has 8 vertices in the regions and 23 in the start ring), and a spread of 9.62e-7 accepted on the regions became 1.038e-6 over the ring that was built. The test runs **over the exact curves of the outline at the start** (`PlaneLevel`, `ExactStart` of the contract):

- the curves are the `exact` curves of the resolved loops (`Loop.exact` of sketch.ts, which the taper reads too), not the solved curves of the sketch: for unoffset regions `detectProfile` joins coincident ends at one representative position, so the built outline can differ from the solved one by up to the join tolerance (round 2: an analytic spread of 9.99996e-7 on the solved arc against 1.000005e-6 on the built one); with the loops' own curves, and the actual end points of every curve tested as points as well, the test reads what is built;
- a line at its two ends;
- a circle or an arc over its whole circle: the level is linear in (u, v), so its extremes on a circle are the level at the centre ± r · |gradient|, with no tessellation; an arc tested on its whole circle can only be stricter (the difference is below the tolerance for any plane the test accepts);
- a curve without an exact form (the side of a generated profile, a spline of step 6) at the vertices of its polyline, which is what is built for it, since such a profile has no taper.

Every vertex any build makes lies on these curves (the regions, the rings of a taper however they resample, the circles and hexagon corners of a hole), so a plane accepted here is parallel within the tolerance at every built vertex, independently of the tessellation. The curves come from `exact` of the loops of the resolved regions (also for an offset and a wall, whose loops carry the moved curves); a loop without `exact` (a generated profile, a spline) falls back to its vertices; the hole gives its circles and corners itself. The level used is the middle of the extremes, so the start is off the plane by at most half the tolerance.

The order of the tests: first the angle of D47 (a plane within `UP_TO_MIN_ANGLE`, 0.01 rad, of the direction has no level worth the name, and the division would blow up), then the spread of the levels. Both are `invalidExtent`, with a detail that says which and, for a tilted plane, by how much and what to do.

### `start` is measured along the normal of the sketch

`start` is the offset along the normal of the sketch plane with and without `from`. The alternative, along the normal of the face ("0.6 under the top" as −0.6 whichever way the sketch faces), was rejected:

- the sign of `start` and of `distance` would mean two different directions in one extent;
- a plane feature and a base plane have a normal that says nothing about the material (XZ points to −Y); a face's normal points out of its body, which for the underside of a lid is down;
- an AI that writes all numbers of a part in the frame of one sketch would have to look up every face's normal.

### The reference plane and the effective start

Two things that the first version of this design mixed up, kept apart everywhere now:

- the **reference plane** `from`, which is resolved, tested for parallelism and named in `refs`;
- the **effective start**, its level plus `start`, which is where the tool starts, where its start cap lies, what `facts.startLevel` reports and what every rule of an end applies to.

So the refusals of D47 for `upTo` (the end plane passes through the start or touches it; the gap reaches it) apply to the effective start: `from` equal to the end plane with `start: 0` is refused, with `start: -2` it is a tool 2 mm long. The start cap lies in `from` only when `start` is 0.

### A copy carries its start

A pattern of features builds each copy in the frame of the copy (`applyTool`). The level is measured once in the step of the feature and kept in the resolved extent, so a copy starts at the same offset from its own sketch plane: at the image of the face under the copy's transform. That is what a copy of the same feature with its sketch on the face would do, and what "the boss stands on the plate" means:

- a row or a circle of bosses on a plate: all on the plate (a shift across the normal or a turn about it keeps the level);
- a boss mirrored in the middle plane of the plate starts at the underside of the plate, its mirror image (measured, "Measured");
- a linear pattern along the normal (a stack of layers) puts copy k at k times the spacing above the source: the copies follow the layer below only when the spacing equals the thickness of the layer (an expression `spacing: 't'` does it). The pattern moves the copy; it does not look for a face.

The other reading, each copy starting at the face itself, is what `upTo` does for its end (D47: "each copy runs to the plane the feature saw"), and it is right there: the end is a destination (posts up to a lid). For the start it would make the mirrored boss run down through the plate, a stack of copies all start at the bottom layer, and a copy turned off the normal fail as a tilted start. The start is where the feature stands; the end is where it goes.

**A feature with both** (`from` and `upTo`) does both, and the result can surprise: a post from the top of a plate up to a lid, mirrored in the middle plane of the plate, starts at the image of the top, the underside of the plate, and runs up through the plate to the lid, because the lid does not move with the copy. A row or a circle of such posts is what one expects (each stands on the plate and ends at the lid). This goes into the comment of `Extent`, the conventions for the AI and [architecture/pattern.md](../../architecture/pattern.md), next to the sentence on `upTo`.

This needs no code: the copy is built from the same resolved extent.

### Resolved in the state before the feature

As the end of `upTo` (2f, "Per copy"): `frame(from, state)` in the state before the feature. An addition that starts at a face of its own target covers part of that face; it is resolved before, so that does not matter. A pattern after it does not resolve the plane again, so a copy does not need the face to be there.

### A schema step, not a design an older build refuses by itself

`validateDocument` rebuilds an extent from the fields it knows: the variants `distance` and `throughAll` of a build without the package would drop `from` and put every such tool at the sketch plane, without a word (schema.ts says exactly this of a field of an extent). The ways for an older build to refuse by itself:

- **New variants** (`distanceFrom`, `throughAllFrom`, ...): refused by an older build, but they multiply the variants (above).
- **`start` as a number or a reference** (`start: { plane, offset }`): an older build refuses an object in a numeric field, but `extent/start` would stop being a numeric field in some features (`setField`, expressions, `fieldsOf`, the forms all read it as one).

Both cost more than one line of `UPGRADES`, which is the precedent of the taper (`2b-taper`) and of 5c: a step that converts nothing. On the branch it is counted in `SCHEMA_PENDING`; the version it raises `master` to is the next one at the merge, decided by the order against the steps of step 6. A stored document of an insertion (D62) gets the step when it is validated, as every step.

### `invalidExtent` gets a second meaning

Not a new code `invalidStart`: one more code for the AI to learn, and the reason is the same kind (the extent cannot use one of its planes). `refs` hold the plane `from`, which tells a start from an end; the detail says which test failed. The general text of the code, which says "the extrusion" today, changes to cover both meanings and the hole.

### The hole and "through all" take it too

The layout sketch puts the points of the holes in the sketch at the bottom; the head of a counterbore belongs at the top. Without `from` on the hole that is not possible at all (the mouth of "through all" is the sketch plane, and a `distance` from an expression does not follow a face). The hole uses the same `extentOf`, so it gets the field from the validation; its step reads the level and passes the mouth to "through all". "Through all" needs a start for the hole anyway, and the extrusion's cut gets it with it.

### `startLevel` in `facts`

The effective start, along the normal of the sketch from the sketch plane: what a caller needs to check that the boss stands where it should, without a query. Only when `from` is given, so the results of today do not change. (The function that measures the reference plane is `planeLevel`, so that the two are not confused.)

### Why not wait for step 7

Step 7 of D36 plans names of reference dimensions in expressions: an expression could then read the height of a face (`start: 'level(plate.top)'` or the like). That would cover the boss, the pocket and the layers. It does not make 2h unnecessary:

- the mouth of a hole through all and "through all" from a face are not a number in a field: "through all" has no start to write an expression in, and a hole through all has no depth;
- a field with an expression over a face is a reference that validation, `moveFeature` and the order of the timeline would have to learn to see inside expressions; `from` is a reference those already know;
- for the AI, "from this face" is one reference it already writes for a sketch plane and for `upTo`; an expression over geometry is a second language.

The two coexist: `from` says where the start is measured from, `start` (a field) may then take any expression of step 7 for the offset. Nothing of 2h stands in the way of step 7.

## 4. Architecture

### The document and validation

- `from?: PlaneRef` on every variant of the extrusion's extent and on both variants of the hole's (contract.ts, `ExtentH`, `HoleExtentH`). Read in `extentOf` (features/extent.ts) by `planeRef(context, given.from, `${what}.from`)` for every variant; `onlyFields` of `upTo` gets `from`; `throughAll` with `from` and `side: 'both'` fails ("through all from a plane goes forward or backward: both sides of a start are all of the targets"). No flag in `allows`: every caller takes it.
- No numeric field: `from` is a reference, and `extent/start` is the field it was. `FEATURE_TYPE_INFO.*.fields` does not change.
- `extentRefs` lists `planeRefs(extent.from, 'extent/from')` next to the end plane; the hole's `refs` get `extentRefs` as well (today its extent has no reference).
- `updateFeature`: a patch with `from` replaces the reference (an object with `kind` is never merged; `replacedPaths` in document.ts). Removing it:
  - the extrusion: `removableFromExtent` gets `from`, so `{ extent: { from: null } }` is accepted also where the extent has none;
  - the hole: its `patch.removable` accepts only `label` today; it gets `extent/from` and nothing else (not `removableFromExtent`, which would accept `taper: null` and `gap: null` on a hole, fields a hole never has).
  
  A patch with another `type` replaces the variant and has to be complete, `from` included if wanted.
- The upgrade step `2h-extent-start` at the end of `UPGRADES` (schema.ts), converting nothing, counted in `SCHEMA_PENDING` on the branch.

### The recompute

1. **The level of the reference plane** (`planeLevel`, in recompute/extent.ts beside `upToSpan`): the plane `from` resolved by `frame(from, state)` in the state before the feature (`brokenReference`, `nonPlanarFace` end the step, `refs: [from]`), kept as an `EndPlane`. With `N` its normal and `n` the normal of the frame: `|N · n| ≤ sin(UP_TO_MIN_ANGLE)` is `invalidExtent` (parallel to the direction); otherwise the level under a point (u, v) of the sketch is `N · (P − Q(u, v)) / (N · n)`, `Q` the point in the sketch plane; its spread over the exact outline at the start (`ExactStart`) may be no more than `LENGTH_TOLERANCE`, else `invalidExtent` (tilted, with the spread in the detail); the level is the middle of the extremes.
2. **The resolved extent** (`ResolveStart`): `from` dropped; for `distance` and `upTo` `start` raised by the level (the effective start). "Through all" keeps its variant; its start (the level) is passed as an argument. One function for the extrusion and the hole. Every build, the feature's and each copy's, uses it.
3. **The extrusion** (features/extrude.ts, its step): profile, then the level over `ExactStart(profile.regions)`, then `upToSpan` and `taperedSection` with the resolved extent, then the builds, whose call `toolSpan(extent, frame, targets)` becomes `toolSpan(extent, frame, targets, level)` (0 without `from`). `facts.startLevel` joins the facts of a generator and of `upTo`.
4. **The hole** (features/hole.ts, its step): the level comes first, before the guards against the resolution of the kernel (hole.ts, the checks of the head and of a blind bore against `1e-4 · scale`): those guards take `scale` from the targets and the sketch plane only, and a mouth far from both raises the resolution the kernel actually has (round 2, a probe of today's numeric equivalent: the mouth at z = 1000, a head 1000 deep and a hole 1000.01 deep into a target at z = −10 … 0 passes the guards, the kernel loses the 0.01 mm bore and the feature ends in `noEffect`). So the hole resolves its mouth first and the guards use a scale that includes the coordinates of the tool (the mouth and the far end), from a helper of its own (`toolScale` of the contract), so that `throughAll('both', …)` keeps its start 0. Then the level over its exact circles and the corners of its hexagon; `mouth` is the resolved `start` of a distance and the level for "through all"; its two calls `throughAll(extent.side, frame, targets)` (the build) and `throughAll(extent.side, sketch.frame, …)` (the fact `depth`) get the mouth as `start`, so the depth of a hole through all is how far the targets reach from the mouth. The resolution test (`throughAll('both', …)`) keeps 0. `facts.startLevel` with `from`.
5. **"Through all"** (`throughAll` and `toolSpan` of recompute/extent.ts, `ThroughAllFrom` and `ToolSpanFrom` of the contract): a fourth parameter `start`, passed explicitly by every caller. The extremes start at `start` instead of 0, the interval runs from `start` to the farthest target on the side plus the overshoot, `reach` is measured from `start`, and `scale` includes the coordinates of the start (the overshoot follows the size of what is built). `both` is called with 0.
6. **What does not change**: `buildPrism`, `buildStack`, `taperedSection`, the sections of a hole, `upToSpan` and the end cap of `upTo` read the number they read today. The start cap (`startCap`) lies at the effective start: its origin is the origin of the sketch carried to that level, its `y` and normal those of the sketch, as today. An addition flush on a face of its target loses its start cap inside the union and the target keeps its face where it is not covered; a cut from a face of its target opens that face. Both are the flush faces the kernel port guarantees ([architecture/ports.md](../../architecture/ports.md), `SolidKernel`, guarantee 3), and both are today's case of a numeric start equal to the height of the face (the converter built 31 of them; "Measured").

### Composition

- **With `upTo`:** from one plane to another. The start is the effective start, the end the plane of D47 with its gap; the lengths of `facts` are from the effective start, and the refusals of D47 apply to it (section 3).
- **With a taper:** the taper holds from the effective start, as today: the profile at the start is the sketch's, the far one moved by `|distance| · tan(taper)`. The cones of the sides have their apex measured from the effective start (taper.ts reads `start`). Parallelism is tested on the exact outline, so the resampling of the rings does not matter.
- **With an offset of the profile, a wall, a generated profile:** the loops of the first two carry their moved curves in `exact`; a generated profile is tested at its vertices, which are what is built.
- **With a pattern of features:** the copy carries its start (section 3). A pattern of a body copies the body as it is.
- **With a sketch on a face:** the sketch plane may itself be a face; `from` is then another face parallel to it, and the offset is from that one.

### Face names

None new. `startCap` and `endCap` keep their meaning (the cap at the start of the extent and at its end), the sides theirs. A face of a feature that starts at a face is named as it would be with the same start written as a number.

### Errors

| Code | Kind | When (with `from`) |
|---|---|---|
| `brokenReference` | error | the plane, the body or the face is not in the state before the feature; `refs: [from]` |
| `nonPlanarFace` | error | the face is not planar; `refs: [from]` |
| `invalidExtent` | error, second meaning | the plane is within 0.01 rad of the direction of the extrusion or of the hole; the plane is tilted against the sketch plane (its level differs over the exact outline at the start by more than 1e-6 mm); `refs: [from]`, the detail says which and how much |

A copy of a pattern cannot fail on its start (it carries the level). Texts that change: `MESSAGE.invalidExtent` (recompute/services.ts, "The extrusion cannot reach …" today) covers both meanings and the hole; the comment of `invalidExtent` in `types.ts`; the list of errors in the comment of `HoleFeature` (`brokenReference`, `nonPlanarFace`, `invalidExtent` from its extent); the comment of `HoleExtent` ("the depth … from the sketch plane" becomes "from the mouth").

### What the MCP description gets for free, and what not

- **Free:** the comments of `Extent`, `HoleExtent`, `HoleFeature` and `invalidExtent` in `types.ts` are in the part `describe_api` cuts out, so the field, its rules and the errors reach the AI with the type. `get_model` prints `facts`. No tool, no query, no numeric field.
- **By hand: `info.summary`** of the extrusion and of the hole, one sentence each ("An extent may start from a plane or a planar face parallel to the sketch: `from`").
- **By hand: `CONVENTIONS`** in packages/mcp/src/api.ts, rewritten, not appended to, where it says something that `from` makes untrue or incomplete:
  - the paragraph of the extent: `start` "is the offset of the start from the sketch plane" becomes "from the sketch plane, or from `from`"; "`both` is the safe default" stays for a cut without `from` and gets "with `from`, forward or backward";
  - the paragraph of `upTo`: the start may be `from`; the per-copy rule stays for the end and gets its counterpart, "a copy carries its start";
  - the paragraphs of the pattern: a copy of a feature with `from` starts at the image of the face; the end of `upTo` stays the plane the feature saw (the mirrored post of section 3);
  - the paragraph of the hole: "no upTo, not both sides" stays, and the mouth may be at a face ("the top of a part whose sketch is at the bottom: `from` that face, through all backward"); `depth` is from the mouth.

### The app

The form row is the simple one (round 1 decided it): no "incomplete" state of a start.

- **The extrusion form** ([ui/extrude.md](../../ui/extrude.md)): above the start a row "Start at", which shows "Sketch plane" or the label of the plane picked (`planeText`). Next to it a button *Pick*; with a plane chosen also a button "Sketch plane", which removes it. A pick arms picking; the next click on a planar face, a plane feature or a base plane sets `from`; Escape, a second press of the armed button or leaving the form disarms it and leaves the start as it was. Escape needs code: `App` (app.ts, the key handler) leaves the draft mode on Escape and drops the draft, and `FeatureForm` (features/draft.ts) has no hook for it. `FeatureForm` gets an optional `cancel?(mode): boolean`, asked before the draft mode is left; a form that consumes Escape (picking armed: it disarms and answers true) keeps the draft. The extrusion and the hole implement it; the edge pickers of D63 may use it later. So the draft never holds "a plane or face, none chosen yet": the absence of `from` already means the sketch plane, and `FeatureForm.incomplete(draft)` (which gets no `extra`) needs no change. The label of the field `extent/start` says from what the offset is.
- **Picking state:** `extra.picking` becomes `'start' | 'end' | undefined`. `picks` answers `{ faces, planes, before }` for `'start'` (the plane is resolved in the state before the feature, so the view shows that state, and the preview of a cut from a face cannot hide part of it) and `{ faces, planes }` for `'end'`, as today. Reset rules: a pick or a disarm resets it; a change of the extent away from `upTo` resets `'end'` only (today extrude.ts resets every picking on any change that is not `upTo`, which would cancel a start being picked); `'start'` survives a change of the variant, the operation and the profile.
- **The patch:** `draftCommand` (sketch-commands.ts) sends `from: draft.extent.from ?? null`, because a patch of the same variant merges and would otherwise keep a `from` the draft no longer has.
- **Variant changes:** `changeExtrude` takes `from?: PlaneRef | null` and carries the current `from` across every change of the variant (distance ↔ upTo ↔ throughAll). The remembered extents (`extra.distance`, `extra.upTo`) bring back their numbers, never a `from`: the `from` of the draft wins, also when it was removed meanwhile. "Through all" with `from` defaults to `backward`, and its side select disables `both` while `from` is set (setting `from` on "through all" both switches it to `backward`).
- **The hole form** ([ui/hole.md](../../ui/hole.md)): the same row above the start of the mouth. The hole form has no `picks` and no `click` today; both are new code, as in the forms of the insert and the mesh (`picks: (m) => m.extra.picking ? { faces: true, planes: true, before: true } : undefined`). `holeCommand` sends `from: draft.extent.from ?? null`. The extent select, the side select and "Fill from the catalog" (which rewrites the extent of an insert to a distance) keep `from`.
- **The model panel** line adds "from <plane>" for both features.
- **Tests** (packages/app/test/app.test.ts, snapshots): picking a start for a boss and removing it; Escape while picking disarms the picker and keeps the draft (and a second Escape leaves the draft mode, as today); distance → upTo → throughAll and back with `from` kept and a removed `from` not resurrected by the remembered extents; "through all" with `from` (side `backward`, `both` disabled); a hole with a start, its extent and side changed and filled from the catalogue; an edited feature whose `from` is removed sends `from: null`.
- No new panel, no view of a query.

### The converter (tools/onshape)

`studio.ts` writes a start "from an entity" as the level of the entity today. With the package, in this order:

1. **Which face.** The start entity is a face of the Onshape model; its identity comes from provenance, not from the plane alone (two coplanar boss tops on one body are two faces; both caps of an extrusion 0.0005 mm long lie within 1e-3 mm of one plane and come from one Onshape feature, but depend on different things). The dump's `created[featureId].faces` says which Onshape feature created the face; the converter knows which trymesh features it made for that Onshape feature (`id`, `${id}_k`, `${gid}_j`). Among the planar faces of those trymesh features in the state before the new feature (the query `body`), take the ones in the plane of the Onshape face (normal parallel within 1e-6, the point within 1e-3 mm), then keep those whose oriented normal (`meshNormal` of the query `body`, out of the body) agrees with the Onshape face's normal (out of its part) and whose cap role (`startCap`, `endCap`) is the one Onshape's face has on its feature (the start or the end of its extrude, from the dump's position of the face along the extrude direction). One candidate: `from: { kind: 'face', body, face }`. Several, all of features made for one Onshape extrusion (one Onshape extrusion split into groups shares its extent, so the faces move together): the first by ID, with a report line. Still ambiguous otherwise, or none, or an entity that is not a face, or a face created by no feature the dump lists (consumed before the end of the timeline): the number as today, with a report line.
2. **Eligibility.** Before writing `from`, the converter checks that the plane is parallel to the sketch over the profile: it previews the feature, and on `invalidExtent`, `brokenReference` or `nonPlanarFace` writes the number, with a report line.
3. **The offset.** With `from` at the face: a blind extrusion gets `start: 0` (the converter adds no offset to an entity start today); a symmetric blind one keeps the residual offset, `start = −s · depth / 2` with `frame.sign` and the expression of the depth (`-(depth) / 2` or `(depth) / 2`); every symmetric "through all" is normalised first, before either kind of start is handled, to a plain `{ type: 'throughAll', side: 'both' }` without `from` (both sides of any start are all of the targets; `{ both, from }` is refused, and a one-sided cut would lose half of it), whether its start is an entity or a numeric offset.
4. **"Through all" from a start:** from an entity, the face of step 1 as `from` with the side; from a numeric offset start, a plane feature at that offset (the converter makes plane features by offset already, `planeOf` in `studio.ts`) as `from`, instead of 1000 mm.
5. **Last, and marked as 2f's gap, not 2h's:** the same lookup gives the end `upTo` for `UP_TO_FACE`, which the converter writes as a length today ("would need the trymesh name of that face").

The report counts the starts written as `from` and as numbers.

## 5. Where the code lives

| File | What 2h does there |
|---|---|
| `types.ts` | `from` in the variants of `Extent` and `HoleExtent`, with the comment the AI reads (the rule for `both`, the effective start, a copy carries its start, the mirrored post); the comments of `invalidExtent`, `HoleFeature` (its errors) and `HoleExtent` (depth from the mouth) |
| `schema.ts` | the step `2h-extent-start`, `SCHEMA_PENDING` on the branch |
| `features/extent.ts` | `from` in `extentOf`, `extentRefs`, `removableFromExtent`; `both` with `from` refused |
| `recompute/extent.ts` | `planeLevel` over the exact outline, the resolved extent, `toolSpan` and `throughAll` with `start` |
| `features/extrude.ts` | the level in the step, the resolved extent for every build, `toolSpan(…, level)`, `facts.startLevel`; one sentence in `info.summary` |
| `features/hole.ts` | the mouth resolved before the guards of the kernel's resolution, whose scale includes the tool (`toolScale`); the level over its circles and corners, `throughAll(…, mouth)` at its two call sites, `refs` of the extent, `patch.removable` for `extent/from`, `facts.startLevel`; one sentence in `info.summary` |
| `recompute/services.ts` | the text of `invalidExtent` in `MESSAGE` (both meanings, the hole) |
| `packages/mcp/src/api.ts` | the paragraphs of `CONVENTIONS` on the extent, `upTo`, the pattern and the hole, rewritten |
| `packages/app/src/app.ts`, `features/draft.ts` | `FeatureForm.cancel`, asked by the Escape handler before the draft mode is left |
| `packages/app/src/features/extrude.ts`, `features/hole.ts`, `sketch-commands.ts` | `cancel` of both forms; the row "Start at", the picking state and its reset rules, `picks`/`click` of the hole (new), `draftCommand` and `holeCommand`, `changeExtrude`, the model panel lines |
| `packages/scenarios/test/scenario16.test.ts` | from calls.ts |
| `tools/onshape/studio.ts` | the face by provenance, the eligibility, the offsets, "through all" from a start; then `upTo` (2f's gap) |

Docs with the implementation: [architecture/extrude.md](../../architecture/extrude.md) (a section "Start at a plane (D66)"), [architecture/hole.md](../../architecture/hole.md), [architecture/pattern.md](../../architecture/pattern.md) (a copy carries its start, next to the sentence on `upTo`, with the mirrored post and the stack), [architecture/api.md](../../architecture/api.md) ("load": the step), [architecture/verification.md](../../architecture/verification.md), [ui/extrude.md](../../ui/extrude.md), [ui/hole.md](../../ui/hole.md), [onshape-import.md](../../onshape-import.md) (the row "Start of an extrusion at a face" of the gaps says "Not planned" today; it becomes D66, and the section "Extrusions" says what the converter writes), and at the merge the indexes (decisions.md, the tables of the D36 README, the scenario list of requirements.md).

### Order against step 6

Step 6 (6a to 6f) is designed and worked on at the same time. Files 2h shares with it: `features/extrude.ts` and the profile it resolves (6a reads the profile from a list of shapes; 6d adds a spline side, which `ExactStart` tests at its vertices), `packages/app/src/sketch-commands.ts` (6a's table of the app's tools; 2h changes `changeExtrude` and `draftCommand`), `schema.ts` (if a package of step 6 adds a step) and `packages/mcp/src/api.ts`. The changes of 2h there are small and in other functions. Whichever merges second rebases onto the other and runs all the checks; the schema version is the one `master` has after the earlier merge plus one.

## 6. Shared vocabulary

- **Takes:** `PlaneRefAfter` and its resolution (`frame`), `EndPlane` and `UP_TO_MIN_ANGLE` of 2f, `ThroughAll` of 2c, `Loop.exact` (the exact curves of a resolved loop), `UpgradeStep`.
- **Adds:** the field `from` of the extent (inside track B's extent), `facts.startLevel`, the step `2h-extent-start`. `invalidExtent` gets a second meaning.
- **No new** feature type, face role, command, query, numeric field, issue code, member of a port.

## Verified

- **The starts of the converted model** (the coordinator, in the fetched data of the actuator, 2026-11-17): all 31 starts from an entity are planar faces parallel to their sketch, 20 with the normal −Z and 11 with +Z; none is tilted, none is an edge or a vertex. So the parallel-only variant covers the model that asked for the package, and the converter needs no fallback for edges or vertices there.

## Measured

On 2026-11-17, at `41317d7`, a temporary Vitest file (deleted afterwards) built the part of [calls.ts](calls.ts) through the real engine with the starts written as the numbers this package resolves `from` to (`start: 'base'`, `start: 'base + bossH'`, the post `upTo` the lid from `start: 'base'`, the hole as a distance from `'base'` by `'-base'` because "through all" has no start today):

- plate, boss, pocket, post and hole all `ok`; the post `lengthMin = lengthMax = 26`, the hole `depth` 4;
- the mirror of the boss and the pocket in the plane `base / 2`: the top of the mirrored boss (`boss/endCap` of copy 1) at z = −12 with the normal (0, 0, −1), the floor of the mirrored pocket at z = −7; with `base` at 6 the post gets 24 and the mirrored top stays at −12.

So the rigid copy of section 3 is what the builds do today with a numeric start, and an addition and a cut that start flush on a face of their target build cleanly. Not run: anything of the package (the level, its refusals, "through all" from a start, the forms). The figures on the resampled taper ring in section 3 are the reviewer's.

## To verify before the implementation

1. **`throughAll` with a start far from the sketch plane**: that the overshoot (`max(1, 0.01 · scale)`) with the start in `scale` still clears the farthest target and does not land in a face; a test with the sketch at z = 0 and the start at z = 500.
2. **The hole with a raised mouth**: `refuseChange` of a head as deep as the reach, measured from the mouth (a counterbore from the top of a plate thinner than its head).
3. **The exact outline**: that `Loop.exact` is present on every loop of a regions profile, an offset and a wall (a wall's straight ends included), so that only generated sides fall back to vertices.
4. **The app**: two *Pick* buttons over one `picking` state with the reset rules above, and `before` while the start is picked.
5. **The patch rules**: `{ extent: { from: null } }` on an extrusion and on a hole whose extent has no `from`, has one, and after a change of the variant; a patch that changes `type` from `throughAll` with `from` to `distance` (complete, `from` carried only if given).

## Open questions

Each with the recommendation the design follows.

1. **Tilted start planes.** Refuse in the first version, defer the build. *Recommendation: accept;* the uses of section 1 and all 31 starts of the converted model are parallel, and the deferred design keeps the door open.
2. **A copy of a pattern carries its start** (rigid), unlike the end of `upTo`, with the consequence for a mirrored post (section 3). *Recommendation: accept;* it is the reading of a copy of a feature standing on a face, the mirrored boss shows the other reading is wrong, and it costs no code.
3. **The name of the field: `from`.** Alternatives `startPlane`, `startAt`. *Recommendation: `from`;* it reads as the JSON is read ("from the top of the plate, start 0, distance 12") and does not collide with `plane`, the end of `upTo`.
4. **`start` along the normal of the sketch**, not of the face. *Recommendation: accept* (section 3).
5. **`start` on `throughAll`** (an offset start without a plane). *Recommendation: not now;* a plane feature at the offset is the `from`, and the converter has one.
6. **A start at a point or an edge.** *Recommendation: not now;* the converted model has none.
7. **The schema step** for a field that converts nothing. *Recommendation: accept;* the precedent of 2b and 5c, cheaper than a design an older build refuses by itself.
8. **The converter as part of the package.** *Recommendation: yes, as its last step,* with `upTo` by the same lookup as a separate last sub-step, marked as 2f's gap.
9. **Scenario 16, not an extension of 12.** Scenario 12 (track B) is a box whose features stand on sketches on faces; this package is about the opposite style, one layout sketch. *Recommendation: a new scenario 16,* which leaves 12 as it is.

## Tests the implementation owes

- Engine (`packages/engine/test/extent.test.ts`, `upto.test.ts`, `hole.test.ts`, `taper.test.ts`, `schema.test.ts`; the findings of the reviews also in `review.test.ts`): round 2's hole (a mouth at z = 1000 by `from`, a head 1000 deep, a hole 1000.01 deep, a target at z = −10 … 0) is refused by the guard as `invalidHole`, not built into `noEffect`; a profile of regions whose arc ends are joined to representative positions (coincident ends a hair apart) under a plane whose spread is just under the tolerance on the solved arc and just over it on the built one is refused; a boss from a cap face, from a plane feature, from a base plane (the result equals the numeric start, mesh and faces); a pocket under a face (negative start); a cut and a hole through all from a face (the hole's `depth` from the mouth, the head at the top); `from` with `upTo` (lengths from the effective start; `from` equal to the end plane refused with `start: 0`, a 2 mm tool with `start: -2`); `from` with a taper, including the reviewer's case (a circle of radius 0.1 widening to 1 under a plane whose spread over the regions is 9.62e-7: tested on the exact circle, refused, so that no built ring exceeds the tolerance) and a plane accepted on the exact circle whose built ring stays within it; a wall and a generated profile from a face; the refusals: a side wall, a plane 0.005 rad off the direction, a plane tilted by 1e-6 rad under a profile far from the origin of the sketch (spread above the tolerance: refused; below: built), a cylinder (`nonPlanarFace`), a removed and a suppressed face (`brokenReference`), a face of a later feature (invalid command), `both` with `from` (invalid command); the start follows a changed parameter and a changed `upTo` length; a linear pattern along the normal (spacing equal to and different from the thickness), a circular one about the normal, a mirror (the copy at the mirror image), a mirrored post from a face up to a plane (it runs through the plate, as documented); the patch rules of the extrusion and of the hole (`from: null` absent, present, after a change of the variant); `facts.startLevel` present only with `from`; a document of the older version loads; a document saved with `from` is refused by a build without the step.
- Scenario 16 (calls.ts).
- Converter (`tools/onshape/convert.test.ts` or a unit test of the lookup): two caps of a very short extrusion are told apart by their role and normal, and an ambiguous match falls back to the number; a symmetric "through all" with a numeric start and with an entity start both become `throughAll both` without `from`.
- App: the transitions listed under "The app".
- MCP: the description `describe_api` gives contains the field (it is cut from `types.ts`, so this is a check that the comment sits between the two markers); the rewritten paragraphs of `CONVENTIONS`.

## Reviews

### Round 1 (2026-11-17): the first version

Reviewers: an internal subagent and codex (agy was out of quota). The coordinator collected the findings, decided where a choice was needed, and settled three points of its own: the numbers (D64, D65 and scenario 15 went to step 6 meanwhile; 2h is D66 with scenario 16, reserved in the D36 README at `ad8cf61`), the owner's request in the state line rather than as an open question, and the starts of the converted model ("Verified").

| Finding | Holds? | What changed |
|---|---|---|
| The hole's `patch.removable` accepts only `label`, so `{ extent: { from: null } }` on a hole without `from` is invalid | Yes (hole.ts) | The hole's predicate gets `extent/from` only, not `removableFromExtent` (which would accept `taper`/`gap` null on a hole); tests for absent, present, changed variant |
| The forms: `draftCommand` and `holeCommand` must send `from: … ?? null` (a same-variant patch merges); `from` across variant changes, remembered extents must not resurrect a stale `from`; "through all" with `from` defaults to `backward`, `both` disabled; the hole form's selects and "Fill from the catalog" keep `from`; app tests | Yes | Section 4, "The app", says each; the tests are listed |
| An "incomplete" start cannot be expressed (no `from` already means the sketch plane; `incomplete` gets no `extra`); extrude.ts resets picking on any non-`upTo` change; the hole form has no `picks`/`click` | Yes | The simple row: the start switches to a plane only when one is picked; `picking: 'start' \| 'end'` with its reset rules; the hole's `picks`/`click` named as new code |
| The shape of `throughAll` with `from`: a separate union member makes `extent.from` fail to type-check on the old member (codex) | Yes | One member with `from` optional on every variant; the rule for `both` in the comment and the validator; the stricter type is only a check in calls.ts; §2, §4 and the contract agree |
| The start of "through all" should be an explicit argument, not an internal field of the variant; "nothing else changes / no change to the hole" was wrong | Yes | `toolSpan(…, start)` and `throughAll(…, start)`, every call site listed; `ResolvedExtent` without the internal `start`; §2 and §4 say what changes |
| With a taper, the vertices of the regions are not what is built: `taperRings` resamples (8 → 23 vertices; a spread of 9.62e-7 accepted became 1.038e-6 built) | Yes | The level is tested over the exact curves of the start outline (lines at their ends, circles analytically, generated sides at their vertices), independent of the tessellation and stricter than any built ring |
| The reference plane and the effective start were mixed: `from` equal to the end plane is refused only with `start: 0`; the start cap lies in `from` only then | Yes | Both kept apart everywhere (section 3, "The reference plane and the effective start"); D47's refusals apply to the effective start |
| `CONVENTIONS` would contradict the new field if only appended to | Yes | Four paragraphs to rewrite, each named |
| The hole's comments and `MESSAGE.invalidExtent` ("The extrusion …") do not cover the hole | Yes | Named in "Errors" and in the rows of §5 |
| contract.ts: `ResolveStart` over `ExtentH` only, while the hole computes its mouth; the function returning the plane's level was named like the fact | Yes | `ResolveStart` generic over both extents; the function is `planeLevel`, the fact stays `startLevel` |
| calls.ts claimed the mirror makes the hole's depth 16; the hole precedes the mirror, so it stays 4 | Yes | The claim is deleted |
| The consequences of "a copy carries its start" with `upTo` (a mirrored post runs through the plate) and for a stack (follows only when the spacing equals the thickness) were not stated | Yes | Stated in section 3 and planned for architecture/pattern.md and the comment of `Extent`; tests listed |
| The converter: the symmetric blind and symmetric "through all" from an entity; "through all" from an entity by the face lookup; face identity by plane is ambiguous; eligibility before writing `from`; `upTo` | Yes | The converter's five steps: provenance through `created[…].faces`, a preview for eligibility, the offsets, "through all" from a start, `upTo` last as 2f's gap |
| "Schema version 10" is not known on a branch | Yes | "The next version at the merge", counted in `SCHEMA_PENDING`; a test that a document with `from` is refused by a build without the step |
| Why not wait for step 7 (face levels in expressions) | Yes | A paragraph: a hole's mouth and "through all" from a face are not expressible as a field, and the two coexist |
| The order against step 6, which touches the same files | Yes | "Order against step 6" |

Rejected: nothing.

### Round 2 (2026-11-17): the second version

Reviewer: codex. Nothing serious; five medium findings, all holding and all fixed:

| Finding | What changed |
|---|---|
| The hole's guards against the kernel's resolution take their scale from the targets and the sketch only; a mouth far away passes them and the kernel loses the bore (codex's probe with today's numeric equivalent, above) | The hole resolves its mouth before the guards, and their scale includes the tool (`toolScale` in the contract, apart from `throughAll`, whose `both` keeps 0); a regression test |
| The converter's face lookup cannot tell the two caps of a very short extrusion (both in the plane within 1e-3 mm, one Onshape feature) | Candidates are also filtered by the cap role and the oriented normal; still ambiguous falls back to the number |
| The exact-curve test read the solved curves, but `detectProfile` joins coincident ends, so the built outline can differ (9.99996e-7 against 1.000005e-6) | The curves are the loops' own `exact` curves with their actual end points; vertices for curves without `exact`; a regression test |
| A symmetric "through all" with a numeric offset start became `{ both, from }` (refused) or lost half the cut | Every symmetric "through all" is normalised to a plain `throughAll both` first; tests for both kinds of start |
| Escape while picking leaves the draft mode and drops the draft (app.ts); `FeatureForm` has no cancel hook | `FeatureForm.cancel?(mode)`, asked before leaving the draft mode; both forms consume Escape while picking; app.ts and draft.ts in §5; a test |

Two rounds; the second found nothing serious and its fixes are local, so no third round: the design is ready for implementation. The fixes of round 2 were read by no reviewer.
