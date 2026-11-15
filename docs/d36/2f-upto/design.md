# 2f Extent up to a planar face (D47)

**State: design, first version, before the reviews.** Written against the sixth version of the contract of the preparatory step and the code at `0dc424b`. It adds to the declaration of the extrusion that [2a](../2a-offset/design.md) owns for track B. A prism with a tilted end, also one that ends flush on a tilted face, was run through the real kernel adapter in the spike of [2b](../2b-taper/design.md) ("What was tried"); nothing else was run.

Files: [contract.ts](contract.ts) (the variant, the issue code, the facts), [calls.ts](calls.ts) (its part of validation scenario 12).

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "Extent 'up to a face'": up to a planar face; the engine builds the prism itself, so the far cap can lie in that plane also when it is tilted; the length follows the face when the model changes; a curved face is deferred. The brief adds: the reference and when it is verified; what happens when the face is behind the start, is not planar, or the tool misses it; with a pattern per copy, like "through all".

| Statement | What the code says |
|---|---|
| "A new variant of the extent" | `extrudeFeature` (`document.ts`) picks the variant from a list of two types, so a build without the package refuses the document: no upgrade step. `types.ts` already announces it ("Further extents ('up to face') will come as variants") |
| "The engine builds the prism itself, so the far cap can lie in that plane" | `buildPrism` (`solid.ts`) puts every vertex of the profile at two levels along the normal, `low` and `high`, and decides the winding from which is which. A tilted end is one level per vertex instead of one for all; the 2D triangulation of the cap is the same, because a tilted cap projects onto the profile one to one |
| "The length follows the face" | `toolSpan` (`evaluate.ts`) is where "through all" measures the targets; it gets the solids of the targets and nothing else. A face needs the bodies with the face table, so `ToolRecipe.build` has to be handed the model the tool is applied to |
| "With a pattern: per copy, like 'through all'" | `applyTool` calls `recipe.build` once per copy with the copy's placement and the model as the copies before it left it. The same call can resolve the plane, so "per copy" costs nothing more. But `applyTool` turns every exception of a build into `kernelFailure`; a plane that cannot be reached needs a way to fail with its own code |
| A face is referred to by a body and a face name | `PlaneRef` does that, and also names plane features and base planes; `planeRef` validates it, `planeRefs` lists its references, `frame` resolves it, `faceFrame` reports `brokenReference` and `nonPlanarFace`. Nothing new is needed to refer to the plane |

## The cheap variant

```ts
type Extent = ... | { type: 'upTo'; plane: PlaneRef; start: number; gap?: number };
```

- **The plane is a `PlaneRef`**: a planar face of a body, a plane feature or a base plane.
- **For a face it is the plane the face lies in.** The tool ends in that plane whether or not its profile, carried along the normal, hits the face itself. This answers "the tool misses the face": it is not an error and not a special case.
- **The direction follows the plane.** The tool runs from `start` to the plane on whichever side it lies; there is no `side` to get wrong. What is refused is a plane that never comes (parallel to the direction) or that passes through the start. This answers "the face is behind the start": there is no behind.
- **The end may be tilted.** The end cap lies in the plane; the sides are those of a straight extrusion.
- **`gap`**, an optional numeric field: the end stays that far before the plane, or passes it by as much when negative.
- **Resolved at every build**, in the model the tool is applied to: the length follows the model, and each copy of a pattern runs from its own start to the same plane.
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

The plane is moved by `gap` along its own normal towards the start, and the tool ends there. For a plane parallel to the sketch that is the shortening of the tool; for a tilted one it is the clearance a printed part actually has. Measured along the extrusion it would be a different clearance for every tilt.

### Per copy

For a copy made by a pattern the tool is built in the copy's frame and ends in the plane as the model has it, not in a plane turned with the copy. A circular pattern of posts under a flat lid gives posts of one length; under a tilted lid each gets its own, which is what "the posts end at the lid" means. Copying the tool rigidly (the other reading) would let copies stick through the lid or stop short of it.

The plane is resolved in the model the copy is applied to. Its position comes from the definition of the face (`FaceInfo`), so earlier copies cannot move it; they can only remove the face from the body altogether, and then the copy fails with `brokenReference` and the pattern with it, as for any copy that fails.

## Recompute

1. **The span.** `toolSpan` of `recompute/extent.ts` returns the start and either an end level (as today) or an end plane in model coordinates. For `upTo` it resolves the plane with the service `frame(ref, …)` over the bodies and face tables of the model the tool is applied to and the plane features of the state the feature was computed in, and moves it by the gap.
2. **The lengths.** For every vertex of the profile the length is where the line through its point at the start, along the normal, meets the plane. With `N` the normal of the plane and `n` the normal of the sketch plane:
   - `|N · n| ≤ sin(ANGLE_TOLERANCE)`: the plane is parallel to the direction, `invalidExtent`;
   - the lengths have to be all positive or all negative, each beyond `LENGTH_TOLERANCE`; otherwise the plane passes through the start or touches it, `invalidExtent`. The length is linear over the profile, so testing the vertices tests every point.
3. **The mesh.** `buildPrism` takes the end as a level per vertex. The winding and which cap is `startCap` follow the sign of the lengths, as they follow the sign of `distance` today.
4. **The faces.** Sides as today: the plane of a line, the cylinder of an arc, cut off by the tilted end. The end cap is a plane:
   - `origin`: the origin of the sketch carried along the normal into the plane (today: into the level of the cap);
   - `y`: the Y axis of the sketch carried the same way into the plane and normalised;
   - `normal`: the normal of the plane.
   A sketch can stand on it. Its edges with the sides of lines are lines; with a cylinder it is a circle only when the plane is across the axis, otherwise `other` (an ellipse), which is what `edgeKind` answers for those surfaces already.
5. **The facts.** `lengthMin`, `lengthMax` (positive) and `forward`, for the tool of the feature itself, not for its copies.

**A build that fails with its own code.** `ToolRecipe.build(targets, firstFaceId, placement?, model)` gets the model as a fourth argument, and a build may throw `ToolProblem(code, refs?, detail?)`, a small class in `recompute/state.ts`. `applyTool` and the step of an extrusion with the operation `new` turn it into the error of the feature with that code; every other exception stays `kernelFailure`. A pattern prefixes `refs` with the copy, as for any failed copy. Package 2c needs the same class for one case of its own; if it is implemented first, it adds the class as described here.

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
| `recompute/state.ts`, `recompute/services.ts` | the fourth argument of `build`; `ToolProblem`; its text in `MESSAGE` |
| `packages/mcp/src/api.ts` | `CONVENTIONS`: the third variant of the extent, and that `facts` tell the length |
| `packages/app` | below |

## The app and MCP

- **MCP** needs no code. The length the plane gave is in `facts`, which `get_model` prints.
- **The extrusion form:** the select of the extent gets "Up to a plane or face", for every operation. It shows the field "Start", the field "Gap", the plane chosen (its label, or "none yet") and a button "Pick". While the button is armed the next click in the view takes a planar face, a plane feature or a base plane, as the first step of a new sketch does; otherwise a click picks a region as today. `changeExtrude` gets `extent: 'upTo'`, `plane` and `gap`; the draft is incomplete until a plane is chosen.
- This needs the form to say what it wants picked depending on its own state; see "Needs from the preparatory step".

## Issue codes

| Code | Kind | When |
|---|---|---|
| `invalidExtent` | error, new | the plane is parallel to the direction of the extrusion, or passes through the start of the tool or touches it |
| `brokenReference` | error | the plane, the body or the face is not in the model the tool is applied to |
| `nonPlanarFace` | error | the face is not planar |

## Shared vocabulary

- **Takes:** `PlaneRefAfter` (a face in a role of any package ends a tool: the side of a wall of 2a in `calls.ts`), `IssueCodes`, the frame of a plane as the recompute resolves it.
- **Adds:** `upTo` among the variants of the extent (inside the track), `invalidExtent` in `IssueCodes`.

## Rejected alternatives

1. **An explicit side.** Above.
2. **A reference to a face only.** Above.
3. **The tool ends on the face itself** and misses are errors. The plane of a face is exact and stable; the extent of a face comes from the mesh, changes with every boolean, and a partial hit has no result that a planar cap could describe.
4. **A rigid copy in a pattern.** Above.
5. **The plane resolved once, in the state before the feature, for all copies.** It differs from "per copy" only when a copy removes the face, and it would make the recipe depend on a state other than the one it is applied to, which "through all" avoids.
6. **The gap along the direction of the extrusion.** Above.
7. **Reusing `distance` with an expression** that measures to the face. Expressions see parameters, not geometry; names of reference dimensions in expressions are step 7 and have their own problems.
8. **Returning the failure of a build as a value** instead of throwing. `build` is called from three places and returns a tool; an exception with a code changes one `catch` in each.

## Open questions

- Whether an optional `side` should come with the first version after all. The design says no and keeps the door open.
- Whether "through all" should publish its length the same way. Cheap, but it adds `facts` to results that have none today, which tests that compare whole results would see.

## Needs from the preparatory step

- **Part 3: what a form wants picked depends on its state.** `FeatureUi.form.picks` is a fixed value, and the design says "the extrusion must not get a pick of a face" because it finds regions from the bare event. With this package the extrusion form picks a region most of the time and a face or a plane while its button "Pick" is armed. Case: the form above. Needed: `picks` as a function of the mode, `picks?(mode): { faces?: true; planes?: true }`, asked at every pointer event. Until then the form could only offer plane features and base planes from a list, and a face not at all.
- **Part 2: `ToolRecipe.build` gets the model, and a build may fail with a code.** Not a change of a public type; both are in `recompute/state.ts`, which part 2 creates by moving. Recorded because the pattern (2e, track D) calls `applyTool` and inherits both without a change of its own.

## Tests the implementation owes

- Engine: a post up to a parallel face, to a tilted one (the volume of a cylinder cut by a plane is its area times the length at the centre), to a plane feature and a base plane; both directions; the gap with both signs; the end cap as a sketch plane; every refusal; the length after a change of the model; a cut up to a face of its own target; a pattern over a tilted plane with a length per copy, and one whose copy loses the face.
- Scenario 12.

## Reviews

Not yet run.
