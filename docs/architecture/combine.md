# Architecture: the boolean of bodies, the clearance and the split

Part of [architecture.md](../architecture.md). Two feature types over finished bodies (D56): `combine` (a union, a difference or an intersection of a target with tool bodies, a difference optionally with a clearance) and `split` (a body cut by a plane into two). The design with its measurements, its rejected alternatives and its known limits is [d36/3d-body-boolean/design.md](../d36/3d-body-boolean/design.md); this file says what the code does.

## Combine (D56)

```ts
interface CombineFeature extends FeatureBase {
  type: 'combine';
  operation: BooleanOp;       // union | difference | intersection
  target: Id;                 // a body; it keeps its ID, its place, its properties and its link
  tools: Id[];                // one or more bodies, none twice, none the target
  keepTools: boolean;         // no default: false = the tools leave the model with this feature
  clearance?: number;         // numeric field `clearance` (mm, ≥ 0, default 0); a difference only
}
```

- **Module** `features/combine.ts`; references: the target and the tools as bodies. It creates no body, names no faces, leaves no tool a pattern could repeat, and as a difference it may tag faces (`tagsFaces`, below).
- **Validation.** The operation, a non-empty list of tools without repetition and without the target, `keepTools` given, a clearance only for a difference (`CLEARANCE` is a `NumberSpec` with `min 0` and `default 0`, so `setField` reaches it while absent, D44). `updateFeature` replaces `tools` whole; `{ clearance: null }` removes the field, and a patch to another operation drops it (`normalize`).
- **Step.** A body that is missing is `brokenReference`; an imported body (D55: a body with a face of a stored mesh, `isImported` of `recompute/services.ts`) as the target or any tool is `importedTarget` with those bodies in `refs`, also with a clearance and before any tool is moved. No feature changes an imported body, and a tool of one would make the target imported. The tools are applied one after another, each through `booleanOfBodies` (`recompute/body-boolean.ts`). A tool that did not change the target goes to the warning `noEffect` (with "only the tools in refs" when others did); nothing left of the target, or an intersection with nothing shared, is `emptyResult` with the target and the tool; an exception of the port or of the checks is `kernelFailure` with the tool. With `keepTools: false` the tools are deleted from the bodies of the state after the last one. In error nothing changes and no tool leaves.
- **Faces.** Without a clearance the faces of the result keep their numbers, so their names (where a face of a tool lies flush on one of the target, the overlapped part takes the tool's name, for an intersection the target's). A face may then lie on two bodies, the target and a kept tool.

### Copy tags of a combine

A copy tag (`CopyTag`, `{ pattern, index }`) names the feature that made the face. A combine with a clearance tags the faces its tools leave: the name of the face of the tool with `{ pattern: <combine>, index: <the place of the tool in tools, from 1> }` appended (a face of a copy made by a pattern keeps that tag first). The registry decides which features may stand in a tag: the optional member `tagsFaces` of a `FeatureModule` (a pattern: always; a combine: as a difference). `requireRef` asks it for a reference of the kind `pattern`; whether the clearance is above 0 is known only to the recompute, where a tag that names no face is a broken reference like any other. `bodyRefs` (exported) lists the bodies a feature names, for the app.

## The clearance (D56)

With a clearance c above 0 every tool is moved outwards before it is subtracted: `movedOutwards(body, faceInfos, faceNames, c, chordTolerance, kernel)` in `recompute/moved-body.ts`. Its moved faces get the next free numbers of the face table and their tagged names; their descriptions (`FaceInfo`) are the moved surfaces, exact: a plane by c along its normal out of the body, a cylinder by c in radius, a cone by its apex, a swept surface as it is. They enter the face table only when the tool changed the target.

The move, in order (the design, "The moved tool" and "Revision after the verification"):

1. `tooSmall` for a clearance under ten precisions of the coordinates, and for one not more than `CHORDS_PER_CLEARANCE` (2) chord tolerances on a tool with a face that is not planar. `noSurface` for a face without a description. The side of every face (the material is on one side of its surface; both is `bothSides`). A hole whose radius is no larger than c `closes`. A sphere and a torus of a revolve (D58, [revolve.md](revolve.md)) move along their exact surfaces: the radius of a sphere and the minor radius of a torus grow or shrink by c away from the material, the centre of the tube (the signed major radius) stays; a socket or a groove whose radius is no larger than c `closes`, and so does a ring whose hole the clearance fills (`R − r − c ≤ 0` for a positive R). A vertex on the axis of a torus (the tip of an ogive) moves along the axis only.
2. Every vertex is solved onto the moved surfaces of its faces (Gauss–Newton, `minimalShift`); a vertex that cannot meet them all is solved again without the conditions of *narrow* faces (every triangle narrower than the chord tolerance), which are then *carried* there. One still off by more than 10⁻⁴ is `vertex`.
3. **Passed-over vertices.** An edge whose direction the move turned round is collapsed into its vertex with more faces when the faces of the other are a proper subset of them; flaps folded flat go; at most one collapse round a vertex per pass, until none is left. A face that loses every triangle, or a vertex lost otherwise than so, is `vertex`.
4. **Carried faces.** A carried face lies within the chord tolerance on its moved surface at every vertex, or it is `vertex`, unless every vertex of it lies within the chord tolerance on its own surface and on those of the same two other (not carried) faces that cross there (normals at least 1° apart): such a face is a polygon of the curve the three share (the crescent between a countersink and its bore), its triangles take the number of the nearer of the two, and it has no moved description.
5. Planar faces (not carried) are triangulated again from their moved outline with `kernel.triangulate` (`outline` when the outline crosses itself or cannot be triangulated).
6. The checks: the mesh is closed and every vertex has one fan of triangles (`outline`, `vertex`); no triangle of a round, swept or carried face turned over (against its vertices before the move, or, where a collapse changed it, against the moved surface of the face it came from at its centroid; slivers aside; `turned`); no edge through a triangle (`crosses`); and no sample of the moved mesh (vertices, edge middles, centroids) nearer to the body than the bound of its pair of faces (`tooNear`): c less p in general, c (1 − `ROUND_ALLOWANCE`) less the chord tolerance for a round face against itself or a neighbour (a point of a cylinder or a cone is also measured against the exact surface of its own face), c less the chord tolerance for a carried face. It is a test of samples, not a proof; the fuzz (`spikes/moved-fuzz.spike.ts`) holds it.

A problem is the error `invalidClearance` of the combine with the tool and the faces in `refs` (none for `tooSmall`) and the detail of the move, which names faces by their keys (`faceKey`). An exception of the move (a guard, the triangulation of the kernel) is `kernelFailure` with the tool; it never leaves the step. The result is kept by the identity of the solid with the clearance and the chord tolerance (a `WeakMap`, the last four keys per solid), so a recompute that changes neither does not move the tool again.

## The boolean of two bodies and its checks (D56)

`booleanOfBodies(kernel, op, target, tool, firstFree, chordTolerance)` in `recompute/body-boolean.ts`, for every boolean of two bodies of one face table:

- **Numbers of its own.** Every face number of the tool is replaced by a number from `firstFree` on for the call and put back in the result: two bodies of a model may share numbers, and the port refuses a union or a difference whose operands do ([ports.md](ports.md)).
- **`changed`**: false when the volume is what it was (the tolerance of `applyTool`) and, for a difference and an intersection, every face of the tool in the result lies on the surface the target had (`onSurface`); decided on the temporary numbers.
- **The volume**, for a union and a difference: against vol(A) + vol(B) − vol(A ∩ B), respectively vol(A) − vol(A ∩ B), with the intersection of the port; a piece of the intersection no thicker than the band of guarantee 3 on average may count or not, so the shared volume is a range. The tolerance is `volumeSlack`: the largest of 0.001 mm³, 10⁻⁶ of the two volumes and 0.1 p times the two areas. When the port refuses the intersection the volume is not checked.
- **Sheets**, for a changed result: by face number, the area of triangles that lie back to back within the sheet tolerance (`sheetTriangles`: the centroid, the three vertices and the three edge middles each within it of a triangle facing the other way; normals within 2.6° of opposite, wider for two narrow triangles that share no vertex) beyond what the operands had under that number; more than 0.001 mm² in all is a wall of the tool left inside or a face that should be gone. The sheet tolerance is 10 p, at most a tenth of the chord tolerance, at least half a precision (`sheetToleranceOf`).
- **An intersection** keeps no band in the port; a connected piece of its result that is all sheet is dropped under 0.001 mm³ (two bodies that only touch) and refused above.

Each check that fails throws `ResultCheckFailed`, which the feature reports as `kernelFailure`. The checks are not given to `applyTool` (an extrusion that adds or cuts keeps its behaviour).

## Split (D56)

```ts
interface SplitFeature extends FeatureBase {
  type: 'split';
  body: Id;                       // keeps its ID and the part on the other side than `side`
  plane: PlaneRef;                // a base plane, a plane feature or a planar face (its whole plane)
  side: 'forward' | 'backward';   // the part that becomes the new body with the ID of the feature
}
```

- **Module** `features/split.ts`; references: the body and the plane. It creates the body with its own ID (`createsBody` without a local name), takes after the body it was cut from (`bodySource`, body properties D48), names one face, `{ feature, role: 'splitFace' }`, a role of `FACE_ROLES` without further fields.
- **Step.** An imported body (D55) is `importedTarget` with the body in `refs`. The plane is resolved in the state before the feature (`frame`: `brokenReference`, `nonPlanarFace`). Two boxes on the two sides of the plane (`halfSpaceBox`: the extent of the body in the frame of the plane with a margin of max(1, 5 % of its diagonal); the face in the plane numbered as the cut face, the five others with the following numbers): the body less the box on the side `side` keeps the ID, the body less the other box is the new body. A box that would be empty, or a part without a triangle, is `emptyResult`; a part that holds a face of a box other than the cut face, or volumes of the two parts that do not add up to the body (`volumeSlack`), is `kernelFailure`. The cut face is appended to the face table with the plane of the frame as its description; a body of pieces on both sides of the plane is taken apart without it.
- Later features that name the body work on the part that kept its ID; the app lists them under the split.

## The app and MCP

`FEATURE_UI` has `combine` and `split` (`packages/app/src/features/combine.ts`, `split.ts`) and the toolbar their buttons ([ui/combine.md](../ui/combine.md)). `issue-text.ts` names the role, prints the faces of an `invalidClearance`, names the tool of an `invalidClearance` and a `kernelFailure`, and reads a tag of a combine as "in the pocket of tool N of …" when it is given the types of the features. The MCP description is generated from the registry and the comments of `types.ts`; `CONVENTIONS` in `packages/mcp/src/api.ts` has a paragraph on both types.
