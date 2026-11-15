# 2f Extent up to a planar face (D47)

**State: design, second version, after the first round of reviews ("Reviews").** Written against the sixth version of the contract of the preparatory step and the code at `0dc424b`. It adds to the declaration of the extrusion that [2a](../2a-offset/design.md) owns for track B, and it needs 2a in the code as well: the extent as a service (`features/extent.ts`), the prism in a module of its own and the rule of an optional numeric field. A prism with a tilted end, also one that ends flush on a tilted face, was run through the real kernel adapter in the spike of [2b](../2b-taper/design.md) ("What was tried"); nothing else was run.

Files: [contract.ts](contract.ts) (the variant, the issue code, the facts), [calls.ts](calls.ts) (its part of validation scenario 12).

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "Extent 'up to a face'": up to a planar face; the engine builds the prism itself, so the far cap can lie in that plane also when it is tilted; the length follows the face when the model changes; a curved face is deferred. The brief adds: the reference and when it is verified; what happens when the face is behind the start, is not planar, or the tool misses it; with a pattern per copy, like "through all".

| Statement | What the code says |
|---|---|
| "A new variant of the extent" | `extrudeFeature` (`document.ts`) picks the variant from a list of two types, so a build without the package refuses the document: no upgrade step. `types.ts` already announces it ("Further extents ('up to face') will come as variants") |
| "The engine builds the prism itself, so the far cap can lie in that plane" | `buildPrism` (`solid.ts`) puts every vertex of the profile at two levels along the normal, `low` and `high`, and decides the winding from which is which. A tilted end is one level per vertex instead of one for all; the 2D triangulation of the cap is the same, because a tilted cap projects onto the profile one to one |
| "The length follows the face" | `toolSpan` (`evaluate.ts`) is where "through all" measures the targets; it gets the solids of the targets and nothing else. The plane of a face comes from the face table of the state (`faceFrame` over `FaceInfo`), which the step of the extrusion has and `build` does not; the step resolves the plane and `build` keeps it |
| "With a pattern: per copy, like 'through all'" | `applyTool` calls `recipe.build` once per copy with the copy's placement, so the length can be measured per copy in the frame of the copy. But `applyTool` turns every exception of a build into `kernelFailure`; a plane a copy cannot reach needs a way to fail with its own code |
| A face is referred to by a body and a face name | `PlaneRef` does that, and also names plane features and base planes; `planeRef` validates it, `planeRefs` lists its references, `frame` resolves it, `faceFrame` reports `brokenReference` and `nonPlanarFace`. Nothing new is needed to refer to the plane |

## The cheap variant

```ts
type Extent = ... | { type: 'upTo'; plane: PlaneRef; start: number; gap?: number };
```

- **The plane is a `PlaneRef`**: a planar face of a body, a plane feature or a base plane.
- **For a face it is the plane the face lies in.** The tool ends in that plane whether or not its profile, carried along the normal, hits the face itself. This answers "the tool misses the face": it is not an error and not a special case.
- **The direction follows the plane.** The tool runs from `start` to the plane on whichever side it lies; there is no `side` to get wrong. What is refused is a plane that never comes (parallel to the direction) or that passes through the start. This answers "the face is behind the start": there is no behind.
- **The end may be tilted.** The end cap lies in the plane; the sides are those of a straight extrusion.
- **`gap`**, an optional numeric field: the end stays that far before the plane, or passes it by as much when negative. A gap as large as the way to the plane is refused; it never turns the tool round.
- **The plane is resolved at every recompute of the feature**, in the state before it, so the length follows the model. **The length is measured at every build**, so each copy of a pattern runs from its own start to that same plane.
- **For `new`, `add` and `cut`.** No taper.
- The result of the feature publishes the length it got (`facts`: `lengthMin`, `lengthMax`, `forward`).

**Deferred:**

- Up to a curved face, up to a body (the end follows a surface), up to the next face the tool meets (a ray cast against the mesh).
- The extent of the face itself: a tool that ends only where it hits the face.
- An `upTo` for a hole (2c): a blind hole that keeps a set floor above a face. The variant and the build are there; the hole does not take it yet.
- A taper together with `upTo`.
- The same facts for "through all".

## Decisions

### The reference, and when it is verified

- `plane: PlaneRef`, validated by `planeRef` like the plane of a sketch: a command verifies that the body, the feature that named the face and every pattern in its copy tags exist and come before the extrusion, and only for a reference the feature did not have before (the rule of `updateFeature`). A document may hold a reference to a removed feature, as everywhere.
- The references are listed by `planeRefs(extent.plane, 'extent/plane')`, so `moveFeature` keeps the extrusion behind what the plane needs.
- Whether the face is still there and planar shows in the recompute: `brokenReference`, `nonPlanarFace`, the codes a sketch on a face gets.
- Not a face reference of its own (`{ body, face }`): it would need its own validator, references and resolver for less (a plane feature is a natural end as well: "up to the middle plane").

### No side

The alternative is `side: 'forward' | 'backward'` as "through all" has it, with a plane on the other side as an error. Rejected for the cheap variant:

- An AI would have to derive the side from the normal of the sketch plane and the place of the face, which is the reasoning the variant is there to spare; both wrong answers would be errors.
- "Through all" needs a side because either one is meaningful there. Here the plane says where the tool goes.
- The risk is a model change that moves the plane to the other side of the start: the tool then silently grows the other way. The result says which way it went (`forward`) and how far, so a `check`-minded caller can see it; and a tool that turned round nearly always ends in `noEffect` or in a visible change.

If this turns out to bite, an optional `side` that only restricts is an addition the variant's own list of fields makes safe: an older build refuses a field it does not know.

### The gap is measured across the plane

The side of the plane the start lies on is found first, with the plane where it is. Then the plane is moved by `gap` along its own normal towards that side, and the tool ends there. For a plane parallel to the sketch that is the shortening of the tool; for a tilted one it is the clearance a printed part actually has (the tool is shorter by the gap over the cosine of the tilt). Measured along the extrusion it would be a different clearance for every tilt.

The moved plane has to lie on the same side of the start as the plane itself, for every point of the profile. A gap that reaches the start or passes it is `invalidExtent`. (In the first version the direction was read from the moved plane: a gap of 20 before a plane 10 away gave a tool of 10 the other way.)

### Per copy, to the plane the feature saw

For a copy made by a pattern the tool is built in the copy's frame and ends in the same plane, not in a plane turned with the copy. A circular pattern of posts under a flat lid gives posts of one length; under a tilted lid each gets its own, which is what "the posts end at the lid" means. Copying the tool rigidly (the other reading) would let copies stick through the lid or stop short of it.

The plane is resolved once per recompute of the feature, in the state before it, and the recipe keeps it as a point and a normal. A copy measures its own length to that plane. The first version resolved the plane again for every build, in the model the copy is applied to, as "through all" measures its targets. A review showed what that costs: the position of the plane cannot differ (it comes from the definition of the face, `FaceInfo`, not from the mesh), but the face can be gone. An addition that ends on a whole face of its target swallows that face, and every copy would then fail with `brokenReference` although the feature itself succeeded; the same extent given through a plane feature at that place would work. So the recipe needs nothing but what the step of the feature already has, and `build` keeps its signature.

## Recompute

1. **The plane.** The step of the extrusion resolves `extent.plane` with the service `frame(ref, state)` in the state before the feature: `brokenReference` or `nonPlanarFace` end the step there. The recipe keeps the plane (a point and a normal in model coordinates).
2. **The span.** `toolSpan` of `recompute/extent.ts` returns the start and either an end level (as today) or the end as a level per point. For `upTo` it gets the kept plane and the frame the tool is built in (the feature's own, or the transformed one of a copy).
3. **The lengths.** For a point of the profile the length is where the line through that point at the start, along the normal, meets the plane. With `N` the normal of the plane and `n` the normal of the frame:
   - `|N · n| ≤ sin(ANGLE_TOLERANCE)`: the plane is parallel to the direction, `invalidExtent`;
   - the lengths to the plane where it is have to be all positive or all negative, each beyond `LENGTH_TOLERANCE`; otherwise the plane passes through the start or touches it, `invalidExtent`;
   - the lengths to the plane moved by the gap have to keep that sign, each beyond the tolerance; otherwise the gap is too large, `invalidExtent`;
   - a length above `MAX_NUMBER` of `catalog.ts` (a plane a hair off parallel gives one) is `invalidExtent` as well.

   The points tested are the vertices of the tessellated profile, which is the tool that is built: the length is linear, so the vertices of a polygon test all of it. An arc of the exact profile lies outside its polygon by up to the chord tolerance, so a plane that just touches the exact circle may pass; the tool it then gives is sound. The lengths in `facts` are those of the tool.
   - A plane parallel to the sketch plane within `ANGLE_TOLERANCE` gives one length for all points, measured at the origin of the sketch. The tool is then the prism of a distance extent, and `lengthMin` equals `lengthMax` exactly.
4. **The mesh.** `buildPrism` takes the end as a level per vertex. The winding and which cap is `startCap` follow the sign of the lengths, as they follow the sign of `distance` today.
5. **The faces.** Sides as today: the plane of a line, the cylinder of an arc, cut off by the tilted end. The end cap is a plane:
   - `origin`: the origin of the sketch carried along the normal into the plane (today: into the level of the cap);
   - `y`: the Y axis of the sketch carried the same way into the plane and normalised;
   - `normal`: the normal of the plane.
   A sketch can stand on it. Its edges with the sides of lines are lines; with a cylinder it is a circle only when the plane is across the axis, otherwise `other` (an ellipse), which is what `edgeKind` answers for those surfaces already.
6. **The facts.** `lengthMin`, `lengthMax` (positive) and `forward`, for the tool of the feature itself, not for its copies.

**A build that fails with its own code.** For the feature itself the lengths are computed in its step, and a refusal is the error of the step. A copy of a pattern points another way and may meet the same plane differently: parallel to it, or through it. That is found in `build`, which may throw `ToolProblem(code, refs?, detail?)`, a small class in `recompute/state.ts`. The two places that call `build` (`applyTool`, and the step of an extrusion with the operation `new`) turn it into the error of the feature with that code; every other exception stays `kernelFailure`. A pattern prefixes `refs` with the copy, as for any failed copy. Package 2c needs the same class for one case of its own; if it is implemented first, it adds the class as described here.

**Flush ends.** A cut up to a face of its target ends exactly on that face, and an addition up to a face of another body touches it. Flush planar faces, tilted ones included, are what the kernel port guarantees (architecture.md, SolidKernel, guarantee 3); the spike ran a cut and an addition that end flush on a tilted floor.

## Document and validation

- The variant lists its fields (`type`, `plane`, `start`, `gap`); anything else is an invalid command. (The two variants of today drop unknown keys; a new one need not.)
- `start`: the numeric field `extent/start`, as for `distance`. `gap`: an optional numeric field `extent/gap` with the rules of 2a ("An optional numeric field").
- In the registry: `extent/start` once more with `when: extent/type = upTo`, and `extent/gap`.
- A patch with `type: 'upTo'` on a distance extent replaces the variant and has to be complete; a patch with `plane` alone replaces the reference (a reference is never merged).
- No upgrade step.

## Where the code lives

| File | What 2f does there |
|---|---|
| `types.ts` | the variant of `Extent` with its comment; `invalidExtent` in `ErrorCode` |
| `features/extent.ts` | the validation of the variant, its references, its two fields |
| `features/extrude.ts` | two lines in `info.fields`; `refs` includes those of the extent; the facts |
| `recompute/extent.ts` | `toolSpan` with the plane; the lengths and their refusals |
| `recompute/tool-prism.ts` | the end as a level per vertex; the surface of the end cap |
| `recompute/state.ts`, `recompute/services.ts` | `ToolProblem` and the two places that catch it; the text of `invalidExtent` in `MESSAGE` |
| `packages/mcp/src/api.ts` | `CONVENTIONS`: the third variant of the extent, and that `facts` tell the length |
| `packages/app` | below |

## The app and MCP

- **MCP** needs no code. The length the plane gave is in `facts`, which `get_model` prints.
- **The extrusion form:** the select of the extent gets "Up to a plane or face", for every operation. It shows the field "Start", the field "Gap", the plane chosen (its label, or "none yet") and a button "Pick". While the button is armed the next click in the view takes a planar face, a plane feature or a base plane, as the first step of a new sketch does; otherwise a click picks a region as today. `changeExtrude` gets `extent: 'upTo'`, `plane` and `gap`; the draft is incomplete until a plane is chosen.
- This needs the form to say what it wants picked depending on its own state; see "Needs from the preparatory step".

## Issue codes

| Code | Kind | When |
|---|---|---|
| `invalidExtent` | error, new | the plane is parallel to the direction of the extrusion (or so near it that the length is out of range); it passes through the start of the tool or touches it; the gap reaches the start |
| `brokenReference` | error | the plane, the body or the face is not in the state before the feature |
| `nonPlanarFace` | error | the face is not planar |

## Shared vocabulary

- **Takes:** `PlaneRefAfter` (a face in a role of any package ends a tool: the side of a wall of 2a in `calls.ts`), `IssueCodes`, the frame of a plane as the recompute resolves it.
- **Adds:** `upTo` among the variants of the extent (inside the track), `invalidExtent` in `IssueCodes`.

## Rejected alternatives

1. **An explicit side.** Above.
2. **A reference to a face only.** Above.
3. **The tool ends on the face itself** and misses are errors. The plane of a face is exact and stable; the extent of a face comes from the mesh, changes with every boolean, and a partial hit has no result that a planar cap could describe.
4. **A rigid copy in a pattern.** Above.
5. **The plane resolved again for every build, in the model the copy is applied to** (the first version of this design). Above: the feature can swallow the face it ends on, and its copies would fail.
6. **The gap along the direction of the extrusion.** Above.
7. **Reusing `distance` with an expression** that measures to the face. Expressions see parameters, not geometry; names of reference dimensions in expressions are step 7 and have their own problems.
8. **Returning the failure of a build as a value** instead of throwing. `build` is called from two places (`applyTool` and the step of an extrusion with the operation `new`), each inside a `try` already, and returns a tool; an exception with a code adds one test to each `catch`.
9. **Testing the exact arcs** of the profile against the plane instead of the vertices of its polygon (a review asked for it). The tool is the polygon; the exact arc differs from it by the chord tolerance, as everywhere in the model.

## Open questions

- Whether an optional `side` should come with the first version after all. The design says no and keeps the door open.
- Whether "through all" should publish its length the same way. Cheap, but it adds `facts` to results that have none today, which tests that compare whole results would see.

## Needs from the preparatory step

- **Part 3: what a form wants picked depends on its state.** `FeatureUi.form.picks` is a fixed value, and the design says "the extrusion must not get a pick of a face" because it finds regions from the bare event. With this package the extrusion form picks a region most of the time and a face or a plane while its button "Pick" is armed. Case: the form above. Needed: `picks` as a function of the mode, `picks?(mode): { faces?: true; planes?: true }`, asked at every pointer event. Until then the form could only offer plane features and base planes from a list, and a face not at all.
- **Part 2: a build may fail with a code.** Not a change of a public type: `ToolProblem` is in `recompute/state.ts`, which part 2 creates by moving. Recorded because the pattern (2e, track D) calls `applyTool` and gets the new failure of a copy without a change of its own.

## For the plan

- **Dependencies.** The table of packages gives "00" as what 2f needs and the picture draws it after 2a. The picture is right: 2f builds on the two moves of 2a and on its optional field.
- **2e, the mirror:** the prism with an end per vertex has the same question of winding in a mirrored frame as every build ([2b](../2b-taper/design.md), "For the plan").
- **Shared places.** `ToolProblem` and the `catch` of `applyTool` are in `recompute/state.ts` and `recompute/services.ts`, which have no row in the plan (2a, "For the plan").

## Tests the implementation owes

- Engine: a post up to a parallel face (one length, the mesh of a distance extent), to a tilted one (the volume of a cylinder cut by a plane is its area times the length at the centre), to a plane feature and a base plane; both directions; the gap with both signs, and a gap larger than the way to the plane; the end cap as a sketch plane; every refusal; the length after a change of the model; a cut up to a face of its own target; an addition that swallows the face it ends on, alone and as the source of a pattern; a pattern over a tilted plane with a length per copy, and one with a copy that is parallel to the plane.
- Scenario 12.

## Reviews

### Round 1 (2026-11-15): the four designs of track B together, at `0839139`

The reviewers and the brief are in the record of [2a](../2a-offset/design.md) ("Reviews"). The findings on this package, each checked before it was acted on:

| Finding | Who | Holds? | What changed |
|---|---|---|---|
| A large positive gap turns the tool round: the start at 0, the plane at 10, a gap of 20 give a moved plane at −10, and both refusals pass | codex, major | Yes | The side is read from the plane where it is; the moved plane has to stay on it |
| The feature can destroy the face its copies need: an addition that ends on a whole face of its target swallows it, and a plane resolved in the model each copy is applied to is then a `brokenReference` | codex, major | Yes (`faceFrame` needs triangles of the face; the pattern starts from the model after its source) | The plane is resolved once per recompute of the feature, in the state before it, and the recipe keeps it; `build` keeps its signature. The alternative rejected in the first version is now the design, and the other way round |
| "Testing the vertices tests every point" holds for the polygon, not for the exact arcs: a plane can cross an exact circle between two vertices of its polygon | codex, major | In part: the tool is the polygon, and its mesh is sound. The contract promised the test for "the profile" | The design and the contract say the tessellated profile; exact arcs are not tested (rejected alternative 9) |
| "Moved towards the start" is undefined until the side is known; no bound on the length for a plane a hair off parallel; `lengthMin === lengthMax` needs a rule for a parallel plane | internal, minor | Yes | The order of the tests; a length above `MAX_NUMBER` is refused; a plane parallel to the sketch gives one length |
| "`build` is called from three places" | internal, factual | Yes: two (`extrude` and `applyTool`; the pattern goes through `applyTool`) | Corrected |
| The design did not say that it needs 2a | internal, minor | Yes | The first paragraph and "For the plan" |
| The spike was cited for rows its table did not have | internal, minor | Yes | The rows are in 2b |
| The scenario: the brace ran through a post | internal, minor | Yes (computed) | Moved beside it |

Checked by the reviewers and found sound: the lengths to a tilted plane are linear over the profile and the volume is the area times the length at the centre (computed); a round brace that ends flush on a face tilted by three degrees unions cleanly in the kernel (probe); the frames of the sketches on the floor of the cavity, on its side and on the top of the lid (probe of the engine); `lid/startCap` survives the lip and its cut; no upgrade step is needed.

Not acted on:

- The extrema of the length on exact arcs (codex): above.
