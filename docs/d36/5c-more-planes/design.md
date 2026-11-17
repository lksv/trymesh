# 5c A plane tilted about a line, the midplane of two planes (D60)

**State: full design, 2026-11-17, against the code of `master` at `d080fa8`.** Written on Opus 5.5 (the owner's note of 2026-11-17: Fable is not available). Reviewed in three rounds ("Reviews"). Implemented on the branch `d36/5c` from `master` at `fe95b55` (after 4a); the deviations are under "As implemented" at the end.

Files: [contract.ts](contract.ts) (the two optional fields of the plane feature, two more kinds of an axis, the issue code, the upgrade step, the frames as functions), [calls.ts](calls.ts) (its part of validation scenario 13).

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "More planes" in the comparison with the three tools: "Midplane of two faces, plane through three points, plane at an angle … Midplane together with the tilted plane; it is the natural plane for a mirror. Until then an offset by half an expression does the same." D36 step 5 has "a plane tilted about a line (links whose axes are not at right angles) and a midplane of two faces". The design of 5a lists "a joint whose axis is not along a coordinate axis" as a known limit and names this package as the way such an axis is modelled ([5a](../5a-mechanism/design.md), "What follows for the design"); the design of 2e names the midplane as the natural plane of a mirror ([2e](../2e-pattern-mirror/design.md)).

| Statement | What the code says |
|---|---|
| "A plane at an angle" | `PlaneFeature` (`types.ts`) is `{ base: PlaneRef; offset: number }`; its step (`features/plane.ts`) resolves the base with `frame` (`recompute/services.ts`) and moves its origin along the normal. Nothing turns a frame |
| "About a line" | There is no reference to a line. `AxisRef` (`types.ts`) is a base axis or `sketchPoint`, the normal of a sketch plane through a point of the sketch. It is resolved by `axis(ref, state)` into a point and a unit direction and is used by the pattern (`circular.axis`, `linear.direction`), the joints of the mechanism and the argument kind `axis` of a query (the mass about an axis). The owner decided with 5a (2026-11-16) that further kinds of `AxisRef` "come together, for the pattern, the joints and the mass query", the axis of a bore among them ([5a](../5a-mechanism/design.md), "Decided"; [2e](../2e-pattern-mirror/design.md)) |
| "Midplane of two faces" | `PlaneRef` names one plane; a face is resolved by `faceFrame` over `FaceInfo`, exact, with its outward normal. A plane feature that is the midplane needs a second `PlaneRef` |
| "The natural plane for a mirror" | The mirror of 2e takes a `PlaneRef`; a plane feature is one. A sketch, an extent `upTo`, a split (3d, designed) and the section query take one too. A new way to make a plane feature reaches all of them without a change |
| Can an older build drop the new fields? | Yes: `planeFeature` rebuilds the feature from `base` and `offset` and drops any other field without a word. So the package needs an upgrade step (`schema.ts`, "When a step is needed") |

## The cheap variant

Two optional fields of the plane feature, two new kinds of an axis, one issue code, one upgrade step.

```ts
interface PlaneFeature extends FeatureBase {
  type: 'plane';
  base: PlaneRef;
  offset: number;
  midplaneWith?: PlaneRef;                     // the midplane of `base` and this plane
  tilt?: { axis: AxisRef; angle: number };     // turned about the axis; numeric field `tilt/angle`
}
type AxisRef = ... | { kind: 'sketchLine'; sketch: Id; line: Id } | { kind: 'face'; body: Id; face: FaceName };
```

The plane is built in a fixed order, each part optional but the base:

1. **The base**, as today: a base plane, a plane feature or a planar face (the whole plane it lies in).
2. **The midplane** (`midplaneWith`): the plane halfway between the base and the second plane. For parallel planes it is the plane in the middle; for planes at an angle it is the plane that bisects the angle between them, through the line where they meet. Which of the two bisecting planes is decided by the normals (below).
3. **The tilt** (`tilt`): the plane through the axis, turned from the plane of steps 1 and 2 by `angle` about the axis (right-hand rule about the direction of the axis). The axis has to be parallel to that plane; it need not lie in it. With the angle 0 it is the plane parallel to the base through the axis.
4. **The offset**, as today, along the normal of the plane of steps 1 to 3.

A plane that is only offset is what it is today: same document, same frame, same numbers.

**Two more kinds of an axis**, the ones the owner wants to come together (above):

- `sketchLine`: the line of a sketch, its own (construction or not) or projected (an edge of a body projected as a line: `addExternal` with the kind `line`). The axis goes through its end `a` towards its end `b`.
- `face`: the axis of a round face of a body, a cylinder or a cone (a bore, a pin, a boss, a countersink): the axis of its exact surface (`FaceInfo`, the same description `Evaluation.faceSurfaces` publishes), through its `origin` (a cylinder) or its `apex` (a cone), in the direction of its `axis`. "The axis of this bore" of the decision of 5a.

Both are kinds of `AxisRef`, so the pattern (a circular pattern about a line or a bore, a linear one along it), the joints of the mechanism and the queries get them as well: one branch per place in the engine, nothing in their documents.

**Deferred:**

- **A plane through three points.** It does not compose with a base: the three points give the plane alone, so it is a variant of the plane feature (the base optional, or a `type`), which changes the shape of every plane of every document and the form of the app. It also needs a reference to a point that is not an axis (`{ sketch, point }` without the normal), a rule for the side of its normal and an error for points on one line. Nothing in steps 3 to 5 asks for it: an arm needs planes at an angle to other planes, which the tilt gives, and a plane through an edge and a point is a tilt about the projected edge with an angle a parameter can compute. A package of its own when a part asks for it; the variant can be added then, and an older build refuses a variant it does not know.
- **An edge of a body as an axis** (`{ kind: 'edge', body, edge }`). A straight edge projected into a sketch is a `sketchLine` already, and the projection follows the edge. The line of a straight edge is available (`projectEdge` builds it exactly from the planes of its two faces; the query `body` reports its ends), and its sense would follow the same convention of the names a projected line follows; a direct reference would only save the sketch. The axis of a circular edge is the axis of the round face beside it, which `face` gives. Deferred for scope, not for want of geometry.
- **A plane tangent to a cylinder, a plane normal to a curve, a plane at the end of a line.** Nothing in the plan needs them.
- **The angle between two planes as a value of an expression** (a plane at the angle another one makes). Names of reference dimensions in expressions are step 7.

## Decisions

### Fields of the plane feature, not a variant and not new kinds of `PlaneRef`

- **Two optional fields** keep every plane of every document as it is, and compose: the midplane of two faces offset by a gap, a plane through a hinge tilted by a parameter and offset by the thickness of a part. A plane that has neither is the plane of today.
- **Rejected: a variant of the plane feature** (`{ type: 'offset' | 'angle' | 'midplane', … }`). It changes the shape of every plane of every document (an upgrade step that converts), every test and scenario that builds a plane, and the form of the app, for the same result; and it cannot compose a midplane with a tilt.
- **Rejected: new kinds of `PlaneRef`** (`{ kind: 'midplane', a, b }`, used directly as the plane of a sketch or a mirror). The angle of a tilt is a numeric field with an expression, and only a feature holds fields; a composite reference would make every consumer of `PlaneRef` resolve a tree, and the app could not pick one with a click. A plane feature is the place where planes are composed.
- **Rejected: new feature types** (`midplane`, `planeAtAngle`). A reference `{ kind: 'plane', feature }` accepts a feature of the type `plane` only (`requireRef`, the argument kind `plane` of a query), so either every such check learns the new types or a midplane cannot be the plane of a sketch. And the composition is lost again.

### The tilted plane goes through the axis

The plane of the tilt contains the axis; the base gives only the direction from which the angle is counted. So the axis has to be parallel to the plane of steps 1 and 2, and it need not lie in it: a hinge drawn on a face of a body, a base axis, an edge projected into a sketch on another plane.

- **The frame.** The frame of steps 1 and 2 is moved along its normal until it contains the axis, then turned about the axis by the angle (Rodrigues' rotation of its origin about the point of the axis, and of its x, y and normal). So a point of the base plane on the axis keeps its coordinates in a sketch on the tilted plane (a hinge drawn at x = 230 in a sketch on the base is at x = 230 in a sketch on the tilted plane), and the angle 0 gives the frame of the base moved onto the axis. The origin of the frame is turned with it and may lie far from the axis; a sketch places its geometry from the origin either way (measured, "Measured", the frame of `wristPlane`).
- **Parallel within the angle tolerance.** The axis is accepted when the sine of its angle to the plane is at most `sin(ANGLE_TOLERANCE)` (1e-4 rad, the tolerance of planar faces of `document.md`); its direction is then made exactly parallel (the part along the normal removed) before the turn, so the tilted plane contains the line through its point exactly and the angle is exactly the angle asked for. An axis further off is the error `invalidAxis`, which says by how much. A projected straight edge has an exact direction: `projectEdge` builds its line from the two planes of its faces in doubles, and takes only the extent from the mesh.
- **The sign.** The right-hand rule about the direction of the axis, as for a circular pattern: a base axis points along its positive half, a `sketchLine` from `a` to `b`, a `sketchPoint` along the normal of its sketch. Tilting the base plane XY about the base axis X by +30° gives the normal (0, −0.5, 0.866) (measured).
- **Rejected: the rigid turn of the base plane about the axis** (the plane need not contain the axis). The two agree when the axis lies in the base plane. For an axis beside it (a base axis and a plane feature offset from a base plane, a hinge projected into a sketch of another plane) the plane would pass beside the hinge by a distance that changes with the angle; "a plane through this edge at 30° to that face" is what a model asks for.
- **Rejected: an angle of the plane from the base without an axis** (two angles about the axes of the base frame). An arm turns a link about a hinge, not about the origin of a sketch.

### The midplane: which bisector

Two planes that are not parallel have two bisecting planes. With `n1`, `n2` the normals of the base and of the second plane and `s1(p) = n1 · (p − o1)`, `s2(p) = n2 · (p − o2)` the signed distances from them:

- `n1 · n2 ≤ 0`, the normals look away from each other (the two faces of a slab, the two sides of a drafted rib or a wedge, outer faces at a convex corner): the plane `s1 = s2`, normal `normalize(n1 − n2)`;
- `n1 · n2 > 0`, they look the same way (the floor of a pocket and the top of the part, a base plane and a plane feature offset from it): the plane `s1 = −s2`, normal `normalize(n1 + n2)`.

The plane is at `nm · p = c` with `c = (n1 · o1 − n2 · o2) / |n1 − n2|` or `(n1 · o1 + n2 · o2) / |n1 + n2|`. Both vectors have a length of at least √2 in their case, so the midplane always exists; there is no error of its own. For parallel planes both rules give the plane in the middle, and its normal is that of the base in both.

**What the rule is, in one sentence:** of the two bisectors, the one whose normal is nearer to the normal of the base, so the midplane is the base turned by at most 45° (`n1 · nm` is `√((1 − n1·n2)/2)` or `√((1 + n1·n2)/2)`, the larger of the two). It does not know where the material is:

- two faces of a slab, the two sides of a drafted rib (normals that look away from each other): the bisector inside the material, the plane of symmetry;
- a floor of a pocket and the top of the part, a base plane and a plane feature offset from it (normals that look the same way): the plane in the middle;
- **two faces that meet at a convex edge at an inner angle above 90°** (two neighbouring sides of a hexagonal prism, a face and a chamfer): their outward normals are less than 90° apart, and the rule gives the bisector *outside* the material, the plane that touches the body along the edge (a review's case: normals (1, 0, 0) and (0.5, 0.866, 0)). The plane of symmetry is the other bisector. It is reached with the parts the package has: the edge where the two faces meet, projected as a line into a sketch on one of them, is a `sketchLine` that lies in both bisectors, and a tilt of the midplane by π/2 about it gives the other one exactly.

A rule that knew the material (faces of one body always `s1 = s2`, unless they are parallel and face the same way) was weighed and not taken: it jumps where two faces become parallel (a wedge whose angle a parameter drives to zero: from the plane through its far edge to the plane in the middle), and it needs to know that both references are faces of one body, which a plane feature or a base plane is not. A field that picks the other bisector is a question for the owner ("Open").

- **The frame** is the frame of the base turned by the smallest rotation that takes `n1` to the normal of the midplane (about `n1 × nm`; none for parallel planes), its origin then moved along the normal of the midplane into the midplane. A midplane of parallel planes has the axes of the base; the midplane of the two caps of a slab, with the top as the base, has the frame of the top moved halfway down (measured).
- **The switch at a right angle.** Where the two normals pass through a right angle, the rule switches between the two bisectors, which are a quarter turn apart. A model whose two planes pass through a right angle when a parameter changes sees its midplane jump. This is a known limit, said in the description, with the tilt by π/2 as the way to the other bisector.
- **Rejected: parallel planes only**, with an error otherwise. The plane of symmetry of a drafted rib is a bisector, and the bisector of the top of a link and a tilted plane is the plane at half the angle (measured: 15° from a top and a plane tilted by 30°, through the hinge both share). The rule costs one comparison.
### `sketchLine` and `face` as kinds of every axis

- **Rejected: a reference to a line only for the tilt** (`tilt.line: { sketch, line }`). A tilt about the axis X is as common as a tilt about a hinge, so the tilt would take "an `AxisRef` or a line": a second type of axis next to `AxisRef`. The pattern wants the same kind (2e deferred "a direction along a sketch line"), and so will the revolve of 4a (its axis lies in the sketch plane, which a `sketchPoint` never does). One kind of `AxisRef` serves all of them.
- **Why `face` comes with it.** The owner decided with 5a that the further kinds of an axis come together, for the pattern, the joints and the mass query, and named the axis of a bore. Its geometry is exact and already there (the surface of a round face), so it costs a branch next to the line. The axis of a straight edge is the third candidate and is deferred above, with the question to the owner whether that is enough ("Open").
- **What it costs.** Every place that switches over the kinds of an axis or reads a field of one kind:
  - the engine: the validator and the references of an axis (`validation.ts`); `axis()` (`recompute/services.ts`); the check of an axis argument of a query (`query/check.ts`, which shapes the reference with `SHAPE_ONLY`, so it checks itself that the entity is a line of the sketch, or that the face is a face of the body, in the state asked about); the context of a query (`query/context.ts`: `problem()` maps every code but `nonPlanarFace` to `brokenReference`, and `axis` is never posed: a `face` axis of a posed body is moved with the body, as `frame` moves a face); `RefProblem` of `query/spec.ts` (it gets `invalidAxis`); the message of the mass about an axis (`query/mass.ts`, which says "not in the state" for any problem, and its comment "a base axis or a sketch point"); the entities and bodies a joint names (`names` of `sections/mechanism.ts`);
  - the app: the picker of an axis (`axis-picker.ts`, `changeAxis` and `axisKind` of `sketch-commands.ts`), the axis control of the generic query form (`queries/controls.ts`), the summary of a pattern (`features/pattern.ts`: it says "the normal of <sketch>" for any direction that is not a base axis, and reads `axis.point`), the panel of the mechanism (`panels/mechanism.ts`, which reads `axis.point`);
  - MCP: the text of the pattern in `packages/mcp/src/api.ts`.
  `axisKind` of the app and the summary of a pattern compile unchanged with a third kind and would say the wrong thing: the implementation changes them, and tests of the picker and of the summary with each new kind guard them. The places that read `axis.point` stop compiling and are found.
- **`sketchLine`.** The line through the solved end `a` towards the solved end `b`, in model coordinates by the frame of its sketch. A line of projected geometry has its ends at `<id>/a` and `<id>/b`. A line shorter than `LENGTH_TOLERANCE` has no direction: `invalidAxis` with the line in `refs`, for every consumer (a pattern, a joint, a plane, a query). Validation: the sketch is a reference of the kind `sketch`; the line an entity of the kind `line` of that sketch, own or projected (`accepts: ['line']`), as for an operand of a generator. A circle or a point is an invalid command; a line removed later is a `brokenReference` in the recompute, as for a `sketchPoint`. For a joint the origin the result reports (`JointResult.axis.origin`) is the end `a`.
- **`face`.** The body and the face as a sketch on a face names them (`planeRef` of the kind `face`: the body, the feature that named the face and every pattern of its copy tags come before the referring feature). In the recompute the face has to be on the body in the state (`brokenReference` otherwise) and round: a cylinder gives the line through its `origin` along its `axis`, a cone the line through its `apex` along its `axis`; a planar, swept or general face is `invalidAxis` ("the face has no axis"). For a joint the origin is that point of the axis.
- **The sense of a `face` axis is the one its build gives the face; for an extrusion (tapered or not) and a hole, the normal of its sketch.** It matters: it is the way a linear pattern goes, the sign of the angle of a circular one, of a joint's value and limits, of a tilt. The description of a face cannot give it: `Surface.axis` of a cylinder carries no sign (`types.ts`), and a cone's points from its apex to the face, so it turns round when a taper passes through zero (`recompute/taper.ts`) or with the direction of a hole (`features/hole.ts`). So the cylinder and the cone members of `FaceInfo` get one more field, `along`, required, so that a later build of round faces (the clearance of 3d, `movedOutwards`; the revolve of 4a, whose axes lie in the sketch plane) does not compile until it says which sense it gives: the prism sets `frame.normal`, a tapered side and a hole `[0, 0, 1]` in the coordinates of the sketch (which `local` of `tool-stack.ts` maps to the model); a copy carries it like `axis` (a mirrored copy's is the mirror image). `axis()` returns the axis of the surface turned to point along `along`. For a bore of an extrusion or a hole that is the normal of its sketch: out of the body for a sketch on a face, so a joint about a bore drilled from the top turns counter-clockwise seen from above. The field is internal to the engine (`FaceInfo` is not in the document); `Evaluation.faceSurfaces` stays as it is.
- **In a pose** a `face` axis moves with its body, as the frame of a face does; a `sketchLine` does not move (an axis of a query is as modelled). The axis of a bore and the edge of that bore projected into a sketch therefore differ in a posed query; the comment of `AxisRef` says so.
- For a mass about an axis the axis is the infinite line, whatever the kind.

### The angle is a numeric field without a default

`tilt/angle`: radians, from −π to π, both included; an expression in degrees with `deg(…)`. It has no default: a tilt is given whole (`axis` and `angle`), and `setField` on `tilt/angle` of a plane without a tilt is refused (D44: `setField` adds only a field whose description has a default). `updateFeature` with `{ tilt: null }` removes the tilt, `{ tilt: { angle: 'deg(20)' } }` changes the angle of a plane that has one (a nested object is merged by fields; the axis is a reference and is replaced whole), and on a plane without a tilt it is an invalid command because the axis is missing. The same for `midplaneWith`: a reference, set and replaced whole, removed by `null`.

## Recompute

`step` of `features/plane.ts`, in the state before the feature:

1. `frame(base)`: `brokenReference` or `nonPlanarFace` with the base in `refs`, as today.
2. With `midplaneWith`: `frame(midplaneWith)`, the same errors with that reference in `refs`; then `midplaneFrame(base, second)`.
3. With `tilt`: `axis(tilt.axis, state)`; its errors (`brokenReference` with the sketch or the entity, `invalidAxis` for a line without a length) end the step. Then `tiltedFrame(frame, line, angle)`: `invalidAxis` with the axis in `refs` and the angle between the axis and the plane in the detail when it is not parallel.
4. The offset along the normal, as today. The frame is published in `FeatureResult.plane` and in `state.planes`, as today.

`midplaneFrame` and `tiltedFrame` are pure functions over frames (`contract.ts`), next to the step in `features/plane.ts`; the engine tests call them directly. Nothing else in the recompute changes: what refers to a plane feature reads `state.planes`.

The memoisation holds without a change: a plane depends on the state before it, and a face that moved, a line of a sketch that moved, a second plane that moved all make another state object.

## Document and validation

- `planeFeature` (`features/plane.ts`) reads `midplaneWith` with `planeRef` and `tilt` as an object with exactly the fields `axis` (`axisRef`) and `angle` (`fields.number(…, 'tilt/angle', TILT_ANGLE)`); any other field of the tilt is an invalid command. Unknown fields directly on the plane feature stay dropped, as for every feature type (`validateDocument` rebuilds a feature from what it knows).
- `refs`: `planeRefs(base, 'base')`, `planeRefs(midplaneWith, 'midplaneWith')`, `axisRefs(tilt.axis, 'tilt/axis')`. So `moveFeature` keeps a plane behind its second plane and the sketch of its axis, and a removed sketch leaves a reference that is valid in a document, as everywhere.
- `info.fields`: `offset` and `tilt/angle`. `patch.fields`: `base`, `offset`, `midplaneWith`, `tilt`; `patch.removable`: `['midplaneWith']` and `['tilt']`.
- `FeaturePatch`: `Patch<Pick<PlaneFeature, 'base' | 'offset' | 'midplaneWith' | 'tilt'>>`.
- **The upgrade step `5c-more-planes`** converts nothing: a build without it would drop `midplaneWith` and `tilt` from a plane without a word, so it has to refuse the document instead. The new kind of an axis alone would not need a step (`axisRef` lists its kinds and an older build refuses one it does not know), and the step covers it anyway. The branch counts it in `SCHEMA_PENDING` until the merge.

## Issue codes

| Code | Kind | When |
|---|---|---|
| `invalidAxis` | error, new | the line of a `sketchLine` axis is shorter than the length tolerance, or the face of a `face` axis is not a cylinder or a cone (for every consumer of an axis; a query answers with it in its error); the axis of a tilt is not parallel to the plane it tilts (more than 1e-4 rad off; the detail says the angle) |
| `brokenReference` | error | the base, the second plane, the sketch or the line of the axis, the body or the face of the axis is not in the state before the feature |
| `nonPlanarFace` | error | the base or the second plane is a face that is not planar |

`invalidAxis` reaches a pattern and a joint through `axis()` with no change of theirs: a pattern ends in error with it, a joint is in error with it as with a broken axis today. A query gets it through its context (`RefProblem` with `invalidAxis`), and the mass says "about: the axis has no direction" or "about: the face has no axis" in place of "not in the state asked about".

## Where the code lives

| File | What 5c does there |
|---|---|
| `types.ts` | the two fields of `PlaneFeature` with their comment (the description for the AI); the kinds `sketchLine` and `face` of `AxisRef` with their comment; `invalidAxis` in `ErrorCode` with its comment; the member of `FeaturePatch` |
| `features/plane.ts` | the validation, the references, the patch, the field `tilt/angle`, the step; `midplaneFrame` and `tiltedFrame`; the summary of `info` |
| `validation.ts` | `axisRef` and `axisRefs` with the two kinds (a `face` with `requireFace` and `faceRefs`, as `planeRef`) |
| `recompute/services.ts` | `axis()` for a `sketchLine` and a `face`; the text of `invalidAxis` in `MESSAGE` |
| `query/check.ts` | an axis argument of the kind `sketchLine`: it is a line of the sketch of the state asked about (by its kind in `entityOf`); of the kind `face`: the face is a face of the body in that state |
| `query/context.ts`, `query/spec.ts`, `query/mass.ts` | `RefProblem` and `problem()` with `invalidAxis`; a `face` axis moved with its posed body; the message of the mass |
| `sections/mechanism.ts` | `names`: the sketch and the line of an axis; for a face, the body (and its feature for a derived body, as the links do), the feature of the face and every pattern of its copy tags (as `faceRefs` lists them) |
| `solid.ts`, `recompute/tool-prism.ts`, `recompute/taper.ts`, `features/hole.ts` | `along` of a round `FaceInfo`, set by each build and carried through a copy |
| `schema.ts` | the step `5c-more-planes`; `SCHEMA_PENDING` on the branch |
| `packages/mcp/src/api.ts` | the paragraph of the pattern: the two kinds of an axis; the advice on the plane of symmetry names the midplane |
| `packages/app` | below |

## The app and MCP

- **MCP** needs no code beyond the text of the pattern: the fields are in the comment of `PlaneFeature`, which `describe_api` cuts out of `types.ts`, and `tilt/angle` is in the numeric fields of the registry.
- **The picker of an axis** (`axis-picker.ts`) gets two choices: "Along a line of a sketch", with a select of the sketch and a select of its lines (own and projected; a line that is gone stays marked as missing, as a point does), and "The axis of a round face", picked by a click in the view on a cylinder or a cone (the form arms the pick, as for the second plane). `AxisKind` gets `sketchLine` and `face`, `AxisChange` a `line` and a `face`, and `changeAxis` starts a new `sketchLine` at the first line of the latest sketch that has one. The form of a pattern, the form of a joint and the plane form use it. The axis control of the generic query form gets the same choices. The summary of a pattern names the line or the face.
- **The plane form** (`features/plane.ts` of the app):
  - "Base" as today: a click in the view picks it.
  - "Midplane with": none, or a plane shown by `planeText`, with a button *Pick* that arms the next click to pick the second plane instead of the base (as the extrusion form picks its plane for `upTo`), and *Remove*. `picks` stays faces and planes.
  - "Tilt": none, or the rows of the axis picker and the field of the angle (in degrees in the form, as every angle of the GUI), with *Remove*; *Add a tilt* starts one about the axis X by 30°.
  - The offset as today. The preview of the draft shows the square of the plane as today; the axis of a tilt is drawn as a line through the square.
  - The summary in the model panel: the offset, "midplane with …", "tilted by … about …".
- The snapshots of `packages/app/test/app.test.ts` change where the plane form is shown (its new rows); the commit says so.

## Shared vocabulary

- **Takes:** `PlaneRef` and `frame`, `AxisRef` and `axis`, `faceFrame`, the rule of an optional part of a feature (D44: a reference or an object removed by `null`), `planeText` and the picker of an axis of the app.
- **Adds:** the field `along` of a round `FaceInfo` (the shared place `FaceInfo` of the plan: one required field, set by every build that makes round faces, so 3d's `movedOutwards` and 4a's revolve set it too; the row of `FaceInfo` in docs/d36/README.md gets it at the merge); the kinds `sketchLine` and `face` of `AxisRef` (every consumer of an axis gets them: the pattern of 2e, its grid, the mechanism of 5a, the queries, the revolve of 4a); the issue code `invalidAxis`; the upgrade step `5c-more-planes`. Nothing in `FaceName`, no feature type, no command, no query.

## Known limits

- The midplane is the bisector nearer to the base; for two faces at a convex edge with an inner angle above 90° that is the plane outside the material, and the plane of symmetry is reached by a tilt of π/2 about the edge projected as a line. The choice switches where the normals pass through a right angle.
- The sense of a projected line is `n_a × n_b` of the outward normals of the two faces of its edge in the order of their names (`projectEdge` of `solid.ts`), a convention, not a choice of the user; the line keeps it while the edge keeps its faces. To turn a pattern or a joint the other way, give a negative angle or span.
- The test time of scenario 13: a joint about the tilted axis left in the mechanism makes every later posed sweep with collisions pay seconds per pair across it (the limit of 5a); the part of 5c comes after the sweeps of 5a, or removes its joint before them.
- A joint about a tilted axis is the known limit of 5a: its pairs are never called collisions wrongly, but each costs seconds in the kernel. A tilted plane makes such joints easy to model, so the description of the tilt repeats the advice of 5a.
- The origin of a tilted frame is the base origin turned about the axis and can lie far from the material (the measured frame: 131 mm above the forearm for a hinge 230 mm from the origin of its sketch). A sketch on it is placed from that origin; a dimension to a point of the axis, which keeps its coordinates, is the way to place geometry near the hinge.
- An axis must be parallel to the plane it tilts; a line that is not is refused, not projected onto the plane.

## Measured

A spike over the real engine and adapters (`packages/scenarios/test/arm.ts`, the arm of scenario 13) and a copy of the two frames of this design in the spike itself, run on 2026-11-17 with vitest from the worktree; the recipe is the spike `planes.spike.ts` of the session (a test that builds the arm, puts sketches on the two caps of the forearm, reads their frames, and computes the frames of `midplaneFrame` and `tiltedFrame` as the contract states them). The numbers become the expectations of `calls.ts`:

| What | Result |
|---|---|
| The top of the forearm (`forearm`, `endCap`) | origin (0, 0, 16), x (1, 0, 0), normal (0, 0, 1) |
| Its underside (`startCap`) | origin (0, 0, 8), x (−1, 0, 0), normal (0, 0, −1) |
| XY tilted by 30° about the base axis X | origin (0, 0, 0), x (1, 0, 0), y (0, 0.866025, 0.5), normal (0, −0.5, 0.866025) |
| XY tilted about the base axis Z | refused (the axis is at 90° to the plane) |
| The top tilted by 30° about the line x = 230 from y = −20 to 20 (along +Y) | origin (30.814157, 0, 131), x (0.866025, 0, −0.5), normal (0.5, 0, 0.866025); both ends of the line in the plane to 1.4e-14; 30° from the top; the ends keep the coordinates (230, ∓20) in the tilted frame |
| A cylinder of radius 10 on the hinge, started 6 along the tilted normal | its lowest point 0.196152 above the top (`6 cos 30° − 10 sin 30°`) |
| The midplane of the top and the underside | origin (0, 0, 12), the axes of the top; with the underside as the base the normal is (0, 0, −1) and x (−1, 0, 0) |
| The same with the forearm 12 thick (z 8 to 20) | origin (0, 0, 14) |
| The midplane of the top and the tilted plane | origin (15.407079, 0, 73.5) (the origin of the top turned by 15° about its own origin, then moved along the normal of the midplane), normal (0.258819, 0, 0.965926), 15° from Z; both ends of the hinge in it to 1.4e-14; four points of it equally far from both planes to 1e-9 (an independent check of the rule) |
| XY and a plane facing the same way at z = 10 | origin (0, 0, 5), normal (0, 0, 1) |
| The section of the forearm at z = 12 (query `section`, base plane XY with the offset 12, and the top face with the offset −4) | 15390.877 mm² in one loop (π · 70² = 15393.804; the polygon of the circle is smaller); the frame of the second has the origin (0, 0, 12) |

## To verify before the implementation

- That every build that makes a round face can give `along` (a prism, a tapered side, the bore, the head and the cone of a hole, their copies); a test with a taper that passes through zero holds the sense of a cone.
- That nothing besides the places in "What it costs" switches over the kinds of `AxisRef` or reads one kind's fields (a grep for `sketchPoint` and `.point` after the change of the type; the first review found four places the first version of this list had missed).

Closed by the first review: the patch `{ tilt: { angle } }` merges into an existing tilt by fields and replaces the axis whole (`mergePatch` of `document.ts`: the tilt has no `kind` or `type`, the axis has a `kind`); on a plane without a tilt it is taken whole and the validation refuses the missing axis; `{ tilt: null }` drops the expression of `tilt/angle` (`replacedPaths`). No `normalize` is needed.

## Needs from the preparatory step

- **Kinds of `AxisRef` cannot be added in a draft.** The contract of the preparatory step stands for the unions of `types.ts` with maps a package merges into (`FeatureTypes`, `IssueCodes`, …); there is none for the kinds of an axis, and `AxisRef` is used as it is by the pattern of 2e, the joints of 5a and the argument kind `axis` of a query. Case: `calls.ts`, the linear pattern along the hinge and the mass about the axis of a face, whose axes go through one cast (`asAxis`). In the code it is one member of the union in `types.ts`, and nothing is missing; recorded so that the cast is not read as a hole of this package.

## Open

Questions for the owner, each answerable in one line:

1. **The other bisector.** The midplane is the bisector nearer to the base; for two faces at a convex edge with an inner angle above 90° that is the plane outside the material, and the plane of symmetry needs a tilt of π/2 about the projected edge. Is that enough, or should the plane feature get a field that picks the other bisector (`midplaneOther: true`)?
2. **The kinds of an axis that "come together".** This package adds the line of a sketch and the axis of a round face; the straight edge of a body stays deferred (a projected edge is a line of a sketch). Is that the set the decision of 5a meant?
3. **The plane through three points** is deferred (it is a variant of the plane feature, not a field). Agreed?

## Tests the implementation owes

- Engine, without adapters: the two fields in the document (absent, given, removed by `null`, a patch of the angle alone, a tilt without an axis refused, a field of the tilt that does not exist refused, a second plane from a later feature refused); the fields listed by `fieldsOf`; `setField` on `tilt/angle` without a tilt refused; a document that loads to itself; the step in `UPGRADES` and a document of the branch refused by a build without it; `midplaneFrame` for parallel planes facing each other and the same way, for planes at an angle in both cases, at exactly a right angle, with the second plane as the base; `tiltedFrame` about an axis in the plane, beside it, off by 0.5e-4 rad (accepted and made exact) and by 2e-4 (refused), with the angle 0, ±π; the sketch coordinates of a point on the axis kept.
- `sketchLine` and `face` for every consumer: the validation (a circle, a point, an unknown line refused; a projected line accepted; a face of a later feature refused), `axis()` (an own line, a projected line, a line of no length; a cylinder, a cone, a planar face), a circular pattern about each, a linear pattern along each, a joint about each, the query `mass` about each (and its message for `invalidAxis`, also in a pose), `names` of the mechanism, the summary of a pattern in the app.
- The sense of a `face` axis: a bore of an extrusion and of a hole, a cone of a taper whose angle passes through zero (the sense does not turn), a copy of a pattern and of a mirror.
- The midplane of two neighbouring sides of a hexagonal prism (the bisector outside the material) and the plane of symmetry reached by a tilt of π/2 about their edge projected as a line.
- Against the real adapters: scenario 13 (`calls.ts`).
- App: the picker with a `sketchLine` (choose a sketch and a line, a line that is gone), the plane form (pick the second plane, add and remove a tilt, the angle in degrees), the snapshots.

## Rows for the indexes

**docs/d36/README.md**, the row of 5c:

| 5c | Plane tilted about a line, midplane of two faces | 5 | I | 00 | full design 2026-11-17, D60 ([5c-more-planes/design.md](5c-more-planes/design.md)): two optional fields of the plane feature, `midplaneWith` (the midplane of the base and a second `PlaneRef`; for planes at an angle the bisector chosen by the normals) and `tilt` (`{ axis, angle }`: the plane through the axis turned from the base, numeric field `tilt/angle`), applied in the order base, midplane, tilt, offset; two more kinds of an axis, `sketchLine` (own or projected line) and `face` (the axis of a round face), for every consumer of `AxisRef`; the error `invalidAxis`; schema step `5c-more-planes`. A plane through three points and an edge as an axis deferred. Open for the owner: a field for the other bisector, the set of axis kinds, the three points |

**docs/decisions.md**, the row of D60:

| D60 | A plane tilted about a line and the midplane of two planes (D36 5c) | Two optional fields of the plane feature composed in a fixed order (base, midplane, tilt, offset); the tilted plane contains its axis and the axis must be parallel to the plane it tilts; the midplane is the bisector nearer to the base; `sketchLine` and `face` are kinds of `AxisRef` for every consumer; an upgrade step that converts nothing. Rejected: a variant of the plane feature, new kinds of `PlaneRef`, new feature types, a line reference only for the tilt. A plane through three points deferred. [d36/5c-more-planes/design.md](d36/5c-more-planes/design.md) |

**docs/requirements.md**, scenario 13, a new item:

- *More planes (5c, D60): designed, not done yet* ([d36/5c-more-planes/calls.ts](d36/5c-more-planes/calls.ts)). A wrist at the end of the forearm whose axis is tilted by 30° to the elbow's: a sketch on the top of the forearm with a hinge line, a plane through the hinge tilted by an expression in degrees, a sketch and a cylinder on it, and a revolute joint about the normal of that sketch, whose axis the mechanism reports as (0.5, 0, 0.866) through the hinge; the wrist clears the forearm by 0.196 mm. The midplane of the two caps of the forearm (z = 12, the axes of the top) follows the thickness of the forearm (z = 14 at 12 mm), and the section there has the area of the forearm's disc; the midplane of the top and the tilted plane is the bisector, 15° from the axis, through the hinge. A plane about the base axis X; a linear pattern of the wrist along the hinge; the mass of the wrist about the axis of its own round side (no distance from its centre of mass). Refused: an axis not parallel to the plane (`invalidAxis`), a circle as the axis, a tilt without its axis, a second plane from a later feature, a round face as the second plane (`nonPlanarFace`). The document saves and loads to the same model, with the step `5c-more-planes`.

## Reviews

### Round 1 (2026-11-17): both packages together, at `3893a78`

Written on Opus 5.5. One brief for both packages (what to read, what to check against the code, what to return), given to three reviewers, read-only:

- an internal subagent on Opus 5.5 at high effort (the owner's note of 2026-11-17: Opus in place of Fable): 22 findings over both packages, 2 major;
- codex (gpt-6-astra, high): 8 findings, 5 major, none a blocker;
- agy (gemini-4-argon-high): did not run, its account was out of quota (HTTP 429), tried once.

Each finding was checked against the code before it was acted on. The findings on this package (those on 5d are in [its design](../5d-generators/design.md)):

| Finding | Who | Severity | Accepted? | What changed |
|---|---|---|---|---|
| "For faces of one body the rule picks the bisector inside the material" is false: two faces at a convex edge with an inner angle above 90° (normals (1, 0, 0) and (0.5, 0.866, 0)) have n1 · n2 > 0, and the rule gives the plane outside the body | codex, internal | major | In part: the claim was wrong; the rule stays | The rule is stated as what it is (the bisector nearer to the base, at most 45° from it), the claim and the rejected alternative corrected, the other bisector reached by a tilt of π/2 about the projected edge; the rule "faces always `s1 = s2`" is weighed and not taken (it breaks a drafted floor against the top); a field for the other bisector is a question for the owner; the hexagon is a test |
| A query loses `invalidAxis`: `problem()` of `query/context.ts` maps it to `brokenReference`, `RefProblem` has no such code, the mass says "not in the state" | codex, internal | major / minor | Yes (read in the code) | `RefProblem` and `problem()` get the code, the mass its message; the files are listed; tests |
| The owner decided with 5a that further kinds of `AxisRef` come together, the axis of a bore among them; the design added one and said "nothing for the owner" | internal | major | Yes (5a, "Decided"; 2e) | The kind `face` (the axis of a round face) is added beside `sketchLine`; the edge stays deferred; the set is a question for the owner |
| "The engine has the line of an edge only as a projection" is false: the query `body` reads the ends of a straight edge | codex | minor | Yes | The deferral of the edge is justified by scope and by the direction an edge reference lacks |
| The list of consumers of `AxisRef` is incomplete: the summary of a pattern says "the normal of" for any non-base axis, `features/pattern.ts` and `panels/mechanism.ts` read `axis.point`, `query/context.ts`, the comment of `query/mass.ts` | internal | minor | Yes | "What it costs" lists them, with tests of the picker and of the summary |
| `query/check.ts` shapes the axis with `SHAPE_ONLY`, so the check has to verify that the entity is a line itself | internal | nit | Yes | Said so |
| A projected line of 0.1 mm carries a direction error of about 1e-4 rad from float32 | internal | minor | As a known limit; withdrawn in round 2 (the projected line is exact) | Known limits, removed again in round 2 |
| "Carried along the normal into the midplane" does not say which normal; the origin of the bisector was not measured | internal | nit | Yes | "along the normal of the midplane"; the origin (15.407079, 0, 73.5) in "Measured" |
| The row of requirements.md says a circular pattern, `calls.ts` makes a linear one | internal | nit | Yes | The row says what `calls.ts` does, and the mass about the face |
| `engine.load` takes a string; the fix was in the working tree, not committed | internal | nit | Yes | Committed with this round |
| The state line says "reviewed", "Reviews" said "not yet" | internal | nit | Yes | Both say two rounds |
| The first item of "To verify" can be closed: `mergePatch` merges the tilt by fields and replaces the axis whole | internal | nit | Yes | Closed, with the reason |
| A joint about a tilted axis in scenario 13 makes later posed sweeps slow | internal | nit | Yes | A known limit and a note in `calls.ts`: the part comes after the sweeps of 5a |

Checked by the reviewers and found sound: every frame of "Measured" and of `calls.ts` (recomputed by both), the gap 0.196152, the midplanes of the caps and their move with the thickness, the 15° bisector, the formula of `c` and `|n1 ∓ n2| ≥ √2`, the need of the upgrade step and that `axisRef` refuses an unknown kind, `setField` on a field without a default, the refusal of a later second plane, the validation of a line through `entityOf`, the deferral of the plane through three points.

Round 1 had more than six findings with three serious ones, so a second round looks at the fixes ("Round 2").

### Round 2 (2026-11-17): the fixes of round 1, at `1b5e1ac`

The diff of the fixes of both packages, to the same reviewers: the internal subagent on Opus 5.5 at high effort (11 findings over both packages, 2 major), codex (5 findings, 1 major); agy was tried once more and was still out of quota. The findings on this package:

| Finding | Who | Severity | Accepted? | What changed |
|---|---|---|---|---|
| The sense of a `face` axis is not defined: `Surface.axis` of a cylinder carries no sign and a cone's turns round with the sign of its taper, while a pattern, a joint and a tilt read the sense | internal (major), codex (minor) | major | Yes (`types.ts`, `recompute/taper.ts`, `features/hole.ts`) | The sense is the normal of the sketch the face was built from, carried in a new field `along` of a round `FaceInfo`; a test with a taper through zero |
| `aboutItsBore` fails its own tolerances: the circle of radius 10 has 71 sides, so the moment is `m r² (2 + cos(2π/71))/6`, 0.13 % below `m r²/2`; the distance is float32 at x ≈ 230 | codex, internal | major | Yes (computed by both; codex through the real kernel: 49.9347789 per gram) | The expectation is that of the polygon, to 1e-5; the distance to 1e-4 |
| The argument against "faces always `s1 = s2`" used a drafted floor, but a draft tilts the walls, not the floor | internal | minor | Yes | The argument is the jump of a wedge driven to zero and that the rule needs both references to be faces |
| The known limit on float32 directions is wrong: `projectEdge` builds a straight edge from the two planes, exactly; the sense of the line is `n_a × n_b` in the order of the names | codex, internal | minor | Yes (`solid.ts`) | The limit is gone (it was a finding of round 1, accepted wrongly); the sense of a projected line is a known limit; the deferral of the edge argued again |
| `names` of the mechanism needs, for a face, the body, its feature, the feature of the face and every pattern of its copy tags | internal | minor | Yes | Listed |
| In a pose a `face` axis moves and a projected `sketchLine` of the same body does not | internal | nit | Yes | Said in the design and the contract |
| The errors in the comment of the plane feature omit the `face` kind | internal | nit | Yes | Added |

Found holding by both: `RefProblem` and `problem()` with `invalidAxis`; the check of `query/check.ts`; the validation of a `face` axis as `planeRef` does it; the errors of `axis()` reaching a pattern and a joint unchanged; the restated midplane rule (at most 45° from the base, the inner angle above 90° exactly when `n1 · n2 > 0`, both bisectors through the common edge and a quarter turn apart, so the tilt by π/2 gives the other exactly); the numbers of `calls.ts`.

Round 2 had a serious finding whose fix is not small (a field of `FaceInfo`), so a third and last round reads the diff of these fixes ("Round 3").

### Round 3 (2026-11-17), the last: the diff of the fixes of round 2, at `a7b60d6`

The same reviewers (agy still out of quota): the internal subagent on Opus 5.5 at high effort (6 findings over both packages, none major), codex (1 nit). Accepted and fixed, read by no reviewer after:

| Finding | Who | Severity | Accepted? | What changed |
|---|---|---|---|---|
| "The normal of the sketch" holds for extrusions and holes only; a revolve (4a) has its axes in the sketch plane, and the clearance of 3d makes new round `FaceInfo`s; an optional `along` lets a later build drop it | internal | minor | Yes | The rule is "the sense its build gives", with extrusions and holes named; `along` is required on the round members, so 3d and 4a do not compile without it; the row of `FaceInfo` in the plan gets it at the merge |
| The prism builds in model coordinates (`frame.normal`), not `[0, 0, 1]` | internal | nit | Yes | Said per build |
| A countersink's cone turns with the direction of the hole, not with a taper | internal | nit | Yes | Said |
| Wording: the sense of a projected line uses the outward normals; "to turn the other way, give a negative angle"; `RoundFaceSense` under the heading of the upgrade step; a broken line of a comment | internal | nit | Yes | Fixed |

Found holding by both: `along` can be set by every round build of today and carried through a copy and a mirror; "out of the body, counter-clockwise seen from above" for a bore drilled from the top; the expectation of `aboutItsBore` (49.93478 per gram, codex also through the kernel); the statements on `projectEdge`; `names` of the mechanism for a face.

Still open after the last round, as known limits: the other bisector of two faces at a convex edge above 90° (by a tilt, or a field if the owner wants one, "Open"); the sense of a projected line, a convention of the names; the edge of a body as an axis, deferred.

## As implemented

Implemented on the branch `d36/5c` from `master` at `fe95b55`, where 4a (the revolve, D58) was merged. The design as built is in [architecture/naming.md](../../architecture/naming.md) ("The plane feature (D60)", "The axis of a round face (D60)"), [architecture/api.md](../../architecture/api.md) (the step) and [ui/plane.md](../../ui/plane.md); the tests are listed in [architecture/verification.md](../../architecture/verification.md), "More planes". Deviations and findings:

- **`sketchLine` and `invalidAxis` came with 4a** and are taken over as they are: the kind of the axis, its validation (`accepts: ['line']`), `axis()` with the line from `a` to `b` (its direction not of unit length), the error with the line in `refs` and the detail "the line of the axis has no length", `RefProblem` with `invalidAxis`, the check of a query (`sketchLine` of `query/check.ts`), the pickers of the app and the summaries. 5c adds the kind `face` and the code's two more cases (a face without an axis, an axis of a tilt not parallel to its plane). The text of `MESSAGE.invalidAxis` names all of them.
- **The message of a query.** `RefProblem` got an optional `detail` (what `axis()` says), and the mass says `about: <detail>`: "about: the line of the axis has no length" as before, "about: the face is a plane and has no axis" (or "a surface of the kind sphere"), in place of the two fixed texts of the design.
- **The torus is a round face with an axis too.** 4a makes tori (a revolved arc off the axis; 4b's fillets of circular edges will), whose axis is exact and whose sense is the direction of the axis of the revolve; so the torus member of `FaceInfo` got the required `along` as well, and a torus is a valid `face` axis (its line through the centre). A sphere, a plane, a swept and a general surface are `invalidAxis`, with the kind in the detail.
- **`along` per build**: the prism `frame.normal`, a tapered side and the bore, counterbore and countersink of a hole `[0, 0, 1]` in the coordinates of the sketch, a revolve the direction of its axis (on the cylinder, the cone and the torus of `sideInfo`); `transformFace` maps it as `axis`. `movedOutwards` of 3d needed no change: it spreads the description of a face, so the moved face keeps its `along` (as designed, the field is required, but a spread of the old description compiles). The test kit of 3d (`combine-kit.ts`) and the spike `moved-fuzz.spike.ts`, which build `FaceInfo` from published surfaces, set `along` to the axis of the surface.
- **The references of an error of `axis()` for a face**: `brokenReference` names the body when the body is not in the state and the face when the face is not on it; `invalidAxis` names the axis (`{ kind: 'face', body, face }`).
- **The query check of a `face` axis** reads the body and the face of the body in the state asked about (as an entity of the kind `face`); whether the face is round is the recompute's to say, through the context.
- **A tilted plane tells its axis in its facts** (`axisPoint`, `axisDirection`, the direction made parallel): the app draws the axis of the preview from them, as it does for a revolve. Not in the design; nothing else reads them.
- **`tiltedFrame` returns `{ code, detail }`** without `refs`; the step adds the axis. The detail: "the axis of the tilt is at 90° to the plane it tilts; it has to be parallel to it". `midplaneFrame` turns the axes by `v c + k × v + k (k · v) / (1 + c)` (k = n1 × n, c = n1 · n), which needs no normalised axis and is stable for a small turn; `c ≥ 1/√2` by the rule, so `1 + c` never vanishes. Every frame is cleaned of negative zeros.
- **`Input<T>` takes a reference as it is.** With a `FaceName` inside an `AxisRef`, `Input<AxisRef>` typed the index of a copy as `number | Expr`, so the draft of an axis in the app, `JointInput` and the draft contract of 5b no longer took an `AxisRef`. `Input<T>` now stops at an object with `kind` (a plane, an axis, an entity): a reference has no numeric field. A change of a type only; `Patch<T>` already replaced such objects whole.
- **The schema step is needed**, confirmed in the code: `planeFeature` of `master` rebuilds the plane from `base` and `offset` and drops any other field without a word. `5c-more-planes` is the last step, `SCHEMA_PENDING = 1` on the branch (version 7 with `schemaSteps`); the tests that pin the branch values (`schema.test.ts`, `mesh.test.ts`, the parts of 3a, 5a, 5b, 3b and 3d of scenario 13, scenario 14) say what the merge flips (version 8 without names).
- **The app.** The axis picker takes an optional `FacePick` (`{ armed, arm }`); without it the kind `face` is not offered (an axis of a face the draft has is still shown). Choosing the kind arms the pick; a click on a cylinder, a cone or a torus (`faceSurfaces[i].kind`) is handed over as `{ face }` to `changeAxis`; another face is refused in the status line and the pick stays armed. The pattern form arms it per direction (the axis or the first direction, the second direction) and refuses a face of its own copies; the plane form arms it for the tilt (the view then picks faces only); the form of a joint, which lives in the model panel, takes the click through `takeMechanismSelection` in `onUp` of `app.ts` next to the armed query and export controls. The revolve form passes no pick: its axis lies in the plane of the profile, where a line of the sketch serves (the engine takes a `face` axis for a revolve all the same). The axis control of the generic query form has *The axis of a round face*, which arms its pick; `selected` takes any non-planar face for an axis argument and leaves the rest to the engine. The plane form: *Midplane with… (pick)* (a pick of a plane or a planar face), *Remove the midplane*, *Add a tilt* (about X by 30°), the picker, *Tilt angle* in degrees, *Remove the tilt*; an edited plane sends `midplaneWith` and `tilt` with `null` for a part the draft no longer has. The title of the button *Rovina* on the toolbar is unchanged, so that the snapshots of the other forms change only where 5c shows.
- **Scenario 13** runs the part of 5c on an engine of its own (the joint about the tilted axis would make the later posed sweeps of 5a slow, as `calls.ts` warns). Every number of `calls.ts` held against the real adapters, the clearance of the wrist 0.196152 within the accuracy of the gap and the moment about the axis of its side to 1e-5 of the polygon of 71 sides.
- **The owner's three questions** were not answered and are taken at the defaults of the design: the other bisector by a tilt of π/2 about the projected edge (no field), `sketchLine` and `face` as the set of kinds of an axis (the edge of a body deferred), the plane through three points deferred.
