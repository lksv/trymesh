# 5c A plane tilted about a line, the midplane of two planes (D60)

**State: full design, 2026-11-17, against the code of `master` at `d080fa8`.** Written on Opus 5.5 (the owner's note of 2026-11-17: Fable is not available). Reviewed in one round ("Reviews"). Not implemented.

Files: [contract.ts](contract.ts) (the two optional fields of the plane feature, the third kind of an axis, the issue code, the upgrade step, the frames as functions), [calls.ts](calls.ts) (its part of validation scenario 13).

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "More planes" in the comparison with the three tools: "Midplane of two faces, plane through three points, plane at an angle … Midplane together with the tilted plane; it is the natural plane for a mirror. Until then an offset by half an expression does the same." D36 step 5 has "a plane tilted about a line (links whose axes are not at right angles) and a midplane of two faces". The design of 5a lists "a joint whose axis is not along a coordinate axis" as a known limit and names this package as the way such an axis is modelled ([5a](../5a-mechanism/design.md), "What follows for the design"); the design of 2e names the midplane as the natural plane of a mirror ([2e](../2e-pattern-mirror/design.md)).

| Statement | What the code says |
|---|---|
| "A plane at an angle" | `PlaneFeature` (`types.ts`) is `{ base: PlaneRef; offset: number }`; its step (`features/plane.ts`) resolves the base with `frame` (`recompute/services.ts`) and moves its origin along the normal. Nothing turns a frame |
| "About a line" | There is no reference to a line. `AxisRef` (`types.ts`) is a base axis or `sketchPoint`, the normal of a sketch plane through a point of the sketch. It is resolved by `axis(ref, state)` into a point and a unit direction and is used by the pattern (`circular.axis`, `linear.direction`), the joints of the mechanism and the argument kind `axis` of a query (the mass about an axis). The design of 2e lists "a direction along a sketch line or an edge (with the other kinds of AxisRef)" as deferred |
| "Midplane of two faces" | `PlaneRef` names one plane; a face is resolved by `faceFrame` over `FaceInfo`, exact, with its outward normal. A plane feature that is the midplane needs a second `PlaneRef` |
| "The natural plane for a mirror" | The mirror of 2e takes a `PlaneRef`; a plane feature is one. A sketch, an extent `upTo`, a split (3d, designed) and the section query take one too. A new way to make a plane feature reaches all of them without a change |
| Can an older build drop the new fields? | Yes: `planeFeature` rebuilds the feature from `base` and `offset` and drops any other field without a word. So the package needs an upgrade step (`schema.ts`, "When a step is needed") |

## The cheap variant

Two optional fields of the plane feature, one new kind of an axis, one issue code, one upgrade step.

```ts
interface PlaneFeature extends FeatureBase {
  type: 'plane';
  base: PlaneRef;
  offset: number;
  midplaneWith?: PlaneRef;                     // the midplane of `base` and this plane
  tilt?: { axis: AxisRef; angle: number };     // turned about the axis; numeric field `tilt/angle`
}
type AxisRef = ... | { kind: 'sketchLine'; sketch: Id; line: Id };
```

The plane is built in a fixed order, each part optional but the base:

1. **The base**, as today: a base plane, a plane feature or a planar face (the whole plane it lies in).
2. **The midplane** (`midplaneWith`): the plane halfway between the base and the second plane. For parallel planes it is the plane in the middle; for planes at an angle it is the plane that bisects the angle between them, through the line where they meet. Which of the two bisecting planes is decided by the normals (below).
3. **The tilt** (`tilt`): the plane through the axis, turned from the plane of steps 1 and 2 by `angle` about the axis (right-hand rule about the direction of the axis). The axis has to be parallel to that plane; it need not lie in it. With the angle 0 it is the plane parallel to the base through the axis.
4. **The offset**, as today, along the normal of the plane of steps 1 to 3.

A plane that is only offset is what it is today: same document, same frame, same numbers.

**The third kind of an axis**, `sketchLine`: the line of a sketch, its own (construction or not) or projected (an edge of a body projected as a line: `addExternal` with the kind `line`). The axis goes through its end `a` towards its end `b`. It is a kind of `AxisRef`, so the pattern (a circular pattern about a line, a linear one along it), the joints of the mechanism and the queries get it as well: one line per consumer in the engine, nothing in their documents.

**Deferred:**

- **A plane through three points.** It does not compose with a base: the three points give the plane alone, so it is a variant of the plane feature (the base optional, or a `type`), which changes the shape of every plane of every document and the form of the app. It also needs a reference to a point that is not an axis (`{ sketch, point }` without the normal), a rule for the side of its normal and an error for points on one line. Nothing in steps 3 to 5 asks for it: an arm needs planes at an angle to other planes, which the tilt gives, and a plane through an edge and a point is a tilt about the projected edge with an angle a parameter can compute. A package of its own when a part asks for it; the variant can be added then, and an older build refuses a variant it does not know.
- **An edge of a body as an axis** (`{ kind: 'edge', body, edge }`). A straight edge projected into a sketch is a `sketchLine` already, and the projection follows the edge. A direct reference would need the line of an edge from the mesh, which the engine has only as a projection today.
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
- **Parallel within the angle tolerance.** The axis is accepted when the sine of its angle to the plane is at most `sin(ANGLE_TOLERANCE)` (1e-4 rad, the tolerance of planar faces of `document.md`); its direction is then made exactly parallel (the part along the normal removed) before the turn, so the tilted plane contains the line through its point exactly and the angle is exactly the angle asked for. An axis further off is the error `invalidAxis`, which says by how much. A projected edge is float32 geometry; its direction is off by about 1e-7 relative, far below the tolerance.
- **The sign.** The right-hand rule about the direction of the axis, as for a circular pattern: a base axis points along its positive half, a `sketchLine` from `a` to `b`, a `sketchPoint` along the normal of its sketch. Tilting the base plane XY about the base axis X by +30° gives the normal (0, −0.5, 0.866) (measured).
- **Rejected: the rigid turn of the base plane about the axis** (the plane need not contain the axis). The two agree when the axis lies in the base plane. For an axis beside it (a base axis and a plane feature offset from a base plane, a hinge projected into a sketch of another plane) the plane would pass beside the hinge by a distance that changes with the angle; "a plane through this edge at 30° to that face" is what a model asks for.
- **Rejected: an angle of the plane from the base without an axis** (two angles about the axes of the base frame). An arm turns a link about a hinge, not about the origin of a sketch.

### The midplane: which bisector

Two planes that are not parallel have two bisecting planes. With `n1`, `n2` the normals of the base and of the second plane and `s1(p) = n1 · (p − o1)`, `s2(p) = n2 · (p − o2)` the signed distances from them:

- `n1 · n2 ≤ 0`, the normals look away from each other (the two faces of a slab, the two sides of a drafted rib or a wedge, outer faces at a convex corner): the plane `s1 = s2`, normal `normalize(n1 − n2)`;
- `n1 · n2 > 0`, they look the same way (the floor of a pocket and the top of the part, a base plane and a plane feature offset from it): the plane `s1 = −s2`, normal `normalize(n1 + n2)`.

The plane is at `nm · p = c` with `c = (n1 · o1 − n2 · o2) / |n1 − n2|` or `(n1 · o1 + n2 · o2) / |n1 + n2|`. Both vectors have a length of at least √2 in their case, so the midplane always exists; there is no error of its own. For parallel planes both rules give the plane in the middle, and its normal is that of the base in both. For faces of one body (outward normals) the rule picks the bisector inside the material, which is the plane of symmetry of a drafted rib (its two sides look away from each other); for planes without an outside (a base plane, a plane feature) it picks the bisector between the two normals.

- **The frame** is the frame of the base turned by the smallest rotation that takes `n1` to the normal of the midplane (about `n1 × nm`; none for parallel planes), its origin carried along the normal into the midplane. A midplane of parallel planes has the axes of the base; the midplane of the two caps of a slab, with the top as the base, has the frame of the top moved halfway down (measured).
- **The switch at a right angle.** Where the two normals pass through a right angle, the rule switches between the two bisectors, which are a quarter turn apart. A model whose two planes pass through a right angle when a parameter changes sees its midplane jump. Two planes at a right angle have no "middle" a user means; this is a known limit, said in the description.
- **Rejected: parallel planes only**, with an error otherwise. The plane of symmetry of a drafted rib is a bisector, and the bisector of the top of a link and a tilted plane is the plane at half the angle (measured: 15° from a top and a plane tilted by 30°, through the hinge both share). The rule costs one comparison.
- **Rejected: the bisector of the smaller angle between the planes as lines.** It ignores the normals and so cannot tell the inside of a corner from the outside; for the faces of a body the rule above does.

### `sketchLine` as a kind of every axis

- **Rejected: a reference to a line only for the tilt** (`tilt.line: { sketch, line }`). A tilt about the axis X is as common as a tilt about a hinge, so the tilt would take "an `AxisRef` or a line": a second type of axis next to `AxisRef`. The pattern wants the same kind (2e deferred "a direction along a sketch line"), and so will the revolve of 4a (its axis lies in the sketch plane, which a `sketchPoint` never does). One kind of `AxisRef` serves all of them.
- What it costs: the validator and the references of an axis (`validation.ts`), `axis()` (`recompute/services.ts`), the check of an axis argument of a query (`query/check.ts`), the entities a joint names (`names` of `sections/mechanism.ts`), the picker of an axis in the app (`axis-picker.ts`, `changeAxis` and `axisKind` of `sketch-commands.ts`) and the axis control of the generic query form (`queries/controls.ts`), the text of the pattern in `packages/mcp/src/api.ts`. `axisKind` of the app answers `sketchPoint` for any kind that is not a base axis and compiles unchanged with a third kind: the implementation must change it, a test of the picker with a `sketchLine` guards it.
- **What it is.** The line through the solved end `a` towards the solved end `b`, in model coordinates by the frame of its sketch. A line of projected geometry has its ends at `<id>/a` and `<id>/b`. A line shorter than `LENGTH_TOLERANCE` has no direction: `invalidAxis` with the line in `refs`, for every consumer (a pattern, a joint, a plane, a query) — the code a joint and a pattern get today from a missing sketch is `brokenReference`, which is not this.
- **Validation.** The sketch is a reference of the kind `sketch`; the line an entity of the kind `line` of that sketch, own or projected (`accepts: ['line']`), as for an operand of a generator. A circle or a point is an invalid command; a line removed later is a `brokenReference` in the recompute, as for a `sketchPoint`.
- **For a joint** the origin the result reports (`JointResult.axis.origin`) is the end `a`; for a mass about an axis the axis is the infinite line.

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
| `invalidAxis` | error, new | the line of a `sketchLine` axis is shorter than the length tolerance (for every consumer of an axis); the axis of a tilt is not parallel to the plane it tilts (more than 1e-4 rad off; the detail says the angle) |
| `brokenReference` | error | the base, the second plane, the sketch or the line of the axis is not in the state before the feature |
| `nonPlanarFace` | error | the base or the second plane is a face that is not planar |

`invalidAxis` reaches a pattern and a joint through `axis()` with no change of theirs: a pattern ends in error with it, a joint is in error with it as with a broken axis today.

## Where the code lives

| File | What 5c does there |
|---|---|
| `types.ts` | the two fields of `PlaneFeature` with their comment (the description for the AI); the kind `sketchLine` of `AxisRef` with its comment; `invalidAxis` in `ErrorCode` with its comment; the member of `FeaturePatch` |
| `features/plane.ts` | the validation, the references, the patch, the field `tilt/angle`, the step; `midplaneFrame` and `tiltedFrame`; the summary of `info` |
| `validation.ts` | `axisRef` and `axisRefs` with the third kind |
| `recompute/services.ts` | `axis()` for a `sketchLine`; the text of `invalidAxis` in `MESSAGE` |
| `query/check.ts` | an axis argument of the kind `sketchLine`: the line exists in the sketch of the state asked about |
| `sections/mechanism.ts` | `names`: the sketch and the line of an axis |
| `schema.ts` | the step `5c-more-planes`; `SCHEMA_PENDING` on the branch |
| `packages/mcp/src/api.ts` | the paragraph of the pattern: the third kind of an axis; the advice on the plane of symmetry names the midplane |
| `packages/app` | below |

## The app and MCP

- **MCP** needs no code beyond the text of the pattern: the fields are in the comment of `PlaneFeature`, which `describe_api` cuts out of `types.ts`, and `tilt/angle` is in the numeric fields of the registry.
- **The picker of an axis** (`axis-picker.ts`) gets a third choice, "Along a line of a sketch", with a select of the sketch and a select of its lines (own and projected; a line that is gone stays marked as missing, as a point does). `AxisKind` gets `sketchLine`, `AxisChange` a `line`, and `changeAxis` starts a new `sketchLine` at the first line of the latest sketch that has one. The form of a pattern, the form of a joint and the plane form use it. The axis control of the generic query form gets the same choice.
- **The plane form** (`features/plane.ts` of the app):
  - "Base" as today: a click in the view picks it.
  - "Midplane with": none, or a plane shown by `planeText`, with a button *Pick* that arms the next click to pick the second plane instead of the base (as the extrusion form picks its plane for `upTo`), and *Remove*. `picks` stays faces and planes.
  - "Tilt": none, or the rows of the axis picker and the field of the angle (in degrees in the form, as every angle of the GUI), with *Remove*; *Add a tilt* starts one about the axis X by 30°.
  - The offset as today. The preview of the draft shows the square of the plane as today; the axis of a tilt is drawn as a line through the square.
  - The summary in the model panel: the offset, "midplane with …", "tilted by … about …".
- The snapshots of `packages/app/test/app.test.ts` change where the plane form is shown (its new rows); the commit says so.

## Shared vocabulary

- **Takes:** `PlaneRef` and `frame`, `AxisRef` and `axis`, `faceFrame`, the rule of an optional part of a feature (D44: a reference or an object removed by `null`), `planeText` and the picker of an axis of the app.
- **Adds:** the kind `sketchLine` of `AxisRef` (every consumer of an axis gets it: the pattern of 2e, its grid, the mechanism of 5a, the queries, the revolve of 4a); the issue code `invalidAxis`; the upgrade step `5c-more-planes`. Nothing in `FaceName`, no feature type, no command, no query.

## Known limits

- The midplane switches between its two bisectors where the normals of its planes pass through a right angle.
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
| The midplane of the top and the tilted plane | normal (0.258819, 0, 0.965926), 15° from Z; both ends of the hinge in it to 1.4e-14; four points of it equally far from both planes to 1e-9 (an independent check of the rule) |
| XY and a plane facing the same way at z = 10 | origin (0, 0, 5), normal (0, 0, 1) |
| The section of the forearm at z = 12 (query `section`, base plane XY with the offset 12, and the top face with the offset −4) | 15390.877 mm² in one loop (π · 70² = 15393.804; the polygon of the circle is smaller); the frame of the second has the origin (0, 0, 12) |

## To verify before the implementation

- That the patch `{ tilt: { angle } }` merges into an existing tilt and keeps the axis with the merge rule of `updateFeature` as it is (`api.md`, "Vnořený objekt …"); the design expects no `normalize` in the patch of the plane.
- That nothing besides the places in "Where the code lives" switches over the kinds of `AxisRef` (a grep for `sketchPoint` on 2026-11-17 found these and the `EntityRef` of queries, which is another type).

## Needs from the preparatory step

- **A kind of `AxisRef` cannot be added in a draft.** The contract of the preparatory step stands for the unions of `types.ts` with maps a package merges into (`FeatureTypes`, `IssueCodes`, …); there is none for the kinds of an axis, and `AxisRef` is used as it is by the pattern of 2e, the joints of 5a and the argument kind `axis` of a query. Case: `calls.ts`, the linear pattern along the hinge and the refusal of an unknown field of a tilt, which go through one cast (`withLineAxis`). In the code it is one member of the union in `types.ts`, and nothing is missing; recorded so that the cast is not read as a hole of this package.

## Open

Nothing for the owner. (A plane through three points is deferred above with its reasons; if the owner wants it in this package, it is a variant of the plane feature and a second upgrade step.)

## Tests the implementation owes

- Engine, without adapters: the two fields in the document (absent, given, removed by `null`, a patch of the angle alone, a tilt without an axis refused, a field of the tilt that does not exist refused, a second plane from a later feature refused); the fields listed by `fieldsOf`; `setField` on `tilt/angle` without a tilt refused; a document that loads to itself; the step in `UPGRADES` and a document of the branch refused by a build without it; `midplaneFrame` for parallel planes facing each other and the same way, for planes at an angle in both cases, at exactly a right angle, with the second plane as the base; `tiltedFrame` about an axis in the plane, beside it, off by 0.5e-4 rad (accepted and made exact) and by 2e-4 (refused), with the angle 0, ±π; the sketch coordinates of a point on the axis kept.
- `sketchLine` for every consumer: the validation (a circle, a point, an unknown line refused; a projected line accepted), `axis()` (an own line, a projected line, a line of no length), a circular pattern about a line, a linear pattern along it, a joint about it, the query `mass` about it, `names` of the mechanism.
- Against the real adapters: scenario 13 (`calls.ts`).
- App: the picker with a `sketchLine` (choose a sketch and a line, a line that is gone), the plane form (pick the second plane, add and remove a tilt, the angle in degrees), the snapshots.

## Rows for the indexes

**docs/d36/README.md**, the row of 5c:

| 5c | Plane tilted about a line, midplane of two faces | 5 | I | 00 | full design 2026-11-17, D60 ([5c-more-planes/design.md](5c-more-planes/design.md)): two optional fields of the plane feature, `midplaneWith` (the midplane of the base and a second `PlaneRef`; for planes at an angle the bisector chosen by the normals) and `tilt` (`{ axis, angle }`: the plane through the axis turned from the base, numeric field `tilt/angle`), applied in the order base, midplane, tilt, offset; the third kind of an axis `sketchLine` (own or projected line, for every consumer of `AxisRef`); the error `invalidAxis`; schema step `5c-more-planes`. A plane through three points deferred |

**docs/decisions.md**, the row of D60:

| D60 | A plane tilted about a line and the midplane of two planes (D36 5c) | Two optional fields of the plane feature composed in a fixed order (base, midplane, tilt, offset); the tilted plane contains its axis and the axis must be parallel to the plane it tilts; the midplane is the bisector the normals choose; `sketchLine` is a kind of `AxisRef` for every consumer; an upgrade step that converts nothing. Rejected: a variant of the plane feature, new kinds of `PlaneRef`, new feature types, a line reference only for the tilt. A plane through three points deferred. [d36/5c-more-planes/design.md](d36/5c-more-planes/design.md) |

**docs/requirements.md**, scenario 13, a new item:

- *More planes (5c, D60): designed, not done yet* ([d36/5c-more-planes/calls.ts](d36/5c-more-planes/calls.ts)). A wrist at the end of the forearm whose axis is tilted by 30° to the elbow's: a sketch on the top of the forearm with a hinge line, a plane through the hinge tilted by an expression in degrees, a sketch and a cylinder on it, and a revolute joint about the normal of that sketch, whose axis the mechanism reports as (0.5, 0, 0.866) through the hinge; the wrist clears the forearm by 0.196 mm. The midplane of the two caps of the forearm (z = 12, the axes of the top) follows the thickness of the forearm (z = 14 at 12 mm), and the section there has the area of the forearm's disc; the midplane of the top and the tilted plane is the bisector, 15° from the axis, through the hinge. A plane about the base axis X; a circular pattern about a sketch line. Refused: an axis not parallel to the plane (`invalidAxis`), a circle as the axis, a tilt without its axis, a second plane from a later feature, a round face as the second plane (`nonPlanarFace`). The document saves and loads to the same model, with the step `5c-more-planes`.

## Reviews

Not yet reviewed.
