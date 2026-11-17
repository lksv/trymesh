# 3b Import of a mesh as a reference body (D55)

**State: implemented on the branch `d36/3b`, 2026-11-17 (see "As implemented"); the design is the fourth version, after three rounds of reviews, the last allowed (see "Reviews"). The owner decided the six questions of "Open" on 2026-11-17, all as recommended.** Written against the code of `master` at `633a6ca` and checked again at `c2a506c` (schema version 6; 3a, 5a and the compressed 3MF of 2g with the port `Deflater` merged; nothing of the latter changes this design but "Open", 3). The types are in [contract.ts](contract.ts), the scenario as calls in [calls.ts](calls.ts); both are checked by `npx tsc -p docs/d36/tsconfig.json`. The package adds its part to validation scenario 13 (the arm): the motor as the mesh of a bought part.

The package adds a section to the document, a feature type and a face role. What is expensive to change later is where the mesh lives, the shape of a stored mesh, the placement and the name of the face, so those are decided in full; the app and the wording of the MCP answers are described and left to the implementation.

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "Direction after D35": a mesh (STL, 3MF) as a reference body. It serves display, interference, the smallest gap, subtraction with a clearance, mass and the robot description, which is the role of a bought part. It has no named faces, so no sketch stands on it and its edges are not projected; a bolt pattern is drawn from the data sheet and checked against the imported body. The mesh has to be a closed solid, otherwise the kernel cannot use it and the import says so. Open there: where the mesh lives (inside the document, which keeps it self-contained, or a file next to it) and a placement by a frame and offsets. D36 adds: the data cannot travel inside a command through MCP, so the tool takes a path that the server or the app reads; reading STEP needs a converter library, which needs the owner's approval (D2).

What the code says about it:

- **A body is the result of a feature and nothing else.** The state of the recompute holds `bodies: Record<Id, Solid>` and one table of faces (`faceNames`, `faceInfos`, `recompute/state.ts`); every triangle of a solid carries the number of a face of that table (`Solid.faceIds`), and every face has a name `{ feature, role, … }` and an exact description (`FaceInfo`). So "no named faces" cannot be taken literally: the surface of an imported mesh needs at least one face with a name and a description.
- **`FaceInfo` has no kind for an unknown surface.** It knows a plane, a cylinder, a cone and a swept surface (`solid.ts`); the published `Surface` already has `{ kind: 'general' }`.
- **A step of a feature does not see the document.** `StepContext` has the state before the feature, the settings and the adapters. The recompute keeps the state after a feature by the feature object (with the values of its expressions) and the state before it (`Evaluator.run`, `memo`), and nothing else.
- **`validateDocument` rebuilds a document from the fields it knows.** Probed on `master`: a document with a field `meshes` at version 6 loads, and the loaded document has no such field. A feature of an unknown type, a face name with an unknown role and an unknown command are refused by `master` by themselves (the probe is under "Measured").
- **What the kernel adapter asks of a solid** (`inputProblem` in `packages/kernel-manifold/src/index.ts`): the arrays fit together, face numbers below 2³¹, finite coordinates, indices in range, a closed surface (every edge in two triangles, once each way: `isClosed` of `clean.ts`) and a volume that is not negative; then the library takes it. The check `isClosed` lives in the adapter; the engine has none of its own.
- **The adapter keeps guarantee 3 of the port (flush planar faces) by fitting a plane to every face number** (`fitFaces`, `prepareTool`). A flat region of a face that is not planar as a whole is not seen as a plane. Measured below: this decides whether a feature may change an imported body.
- **Edges are borders between faces** (`analyzeBody`). A body with one face has none.
- **Every query reads bodies from its context**, whatever feature made them; an export takes the bodies of the state. The collisions call a face that is not planar "round" (`measure` in `interference.ts`).
- **MCP has a place for a file that comes in.** `open_document` is a tool of the server (`server.ts`): it reads the file with Node and hands its text to the engine through the tool `_load`, over the bridge when the app is connected. `get_document` returns the whole document. The app opens a document with a file input (`app.ts`, `open`) and keeps nothing on disk.
- **A reference body is made by a command** (`setBodyProperties` with `use: 'reference'` and a `mass`, D48). The design of 3a says of this package: "an imported mesh is made a reference body by the same batch that adds it".
- **Nobody has designed a placement.** The preparatory step took it out of its contract with requirements for the first package that needs one (`00-prep/contract.ts`: any orientation against a directed frame, every number a numeric field, a `RigidTransform` as the result), and 5a did not need one ("No placement of a link").

## The cheap variant

A binary or ASCII STL file is read into a closed, indexed mesh in millimetres. The mesh is stored inside the document, in a new section `meshes`, as two base64 texts. A new feature type `mesh` places one stored mesh as a body: its frame is a plane, a planar face or a sketch point, with three offsets and three turns, all numeric fields. The body has one face, of the role `mesh`, with an unknown surface. Two commands (`addMesh`, `removeMesh`); a tool of the server, `import_mesh`, that takes a path; an import in the app.

What an imported body is good for, by reader:

| Reader | Works | Note |
|---|---|---|
| The view, a picture | yes | one face, no edges |
| Interference, the smallest gap, posed queries | yes | the surface counts as round (below); a real collision with a large mesh is slow ("Measured", 5) |
| `measure` | to the face of the mesh | the smallest distance on the mesh; no exact part (the surface is unknown) |
| Body properties, mass, the mechanism, a pattern or a mirror of the body | yes | the mass of a bought part is its `mass`; a copy carries the face with its copy tag |
| The exports `stl` and `3mf` | yes, for a body the caller lists | a reference body is not in the list a print export makes by itself (D48) |
| The query `section` | yes | without a list it takes every body, a reference body too (`query/section.ts`); the cut of the mesh is a polyline |
| The outline as DXF or SVG | for a body the caller lists | without a list it takes the printed bodies only (`chosenBodies`, `export/outline.ts`), so a reference body is left out |
| The print query | **misleads** | only a planar face counts as lying on the bed (`query/print.ts`), so an imported body standing on a flat has no contact and its bottom is listed as overhang; see "Known limits" |
| A sketch on it, a projected edge | no | `nonPlanarFace`; it has no edges |
| An extrusion that adds to it or cuts it, a hole in it | no | the error `importedTarget` (below) |

**Deferred**, and why each can come later without a change of what is saved now:

- **3MF.** An entry of the catalog of import formats. A 3MF from a slicer or a CAD tool is deflated, so reading it needs an inflater, which the approval of `pako` (D2, for deflate) does not cover; see "Open", 3.
- **STEP.** A converter library (D2); none is chosen. Until then the conversion to STL is done outside.
- **Recognised flat faces, and with them a sketch on an imported body, its straight edges and features that change it.** An optional field of a stored mesh (a face group per triangle, computed once at the import and stored, so that the names never depend on the algorithm) and a second face role. See "A feature does not change an imported body".
- **Repair** beyond the two the importer makes now (leaving out the wall between two stacked solids, and turning over a shell that is inside out): a weld within a tolerance, parting two solids that share an edge, filling a hole, uniting shells that overlap. Each is work of the importer; the stored mesh keeps its shape. Of 23 real files tried, 5 are refused for want of it ("Measured", 9).
- **A search by place in the measure of a collision** (`nearestOnSurface` in `solid.ts`, `closest` in `mesh-distance.ts`). It is what makes a large mesh slow; it is work on the queries, not on the import. See "Open".
- **Fewer triangles** (a simplification of a mesh above the limit). Done outside.
- **Replacing a stored mesh in place, renaming one.** A command each; until then a new revision is added under another ID and the features are pointed at it in one batch.
- **A mesh kept as a file beside the document.** Another variant of an entry and a port that reads it; see "Rejected".
- **Colours and names from the file** (3MF has them), a scale as a field of the feature.

An entry of the section is validated strictly (it lists its fields), so a build without a later field refuses the document; no further upgrade step is needed for one.

## Where the code lives

```
packages/engine/src/
  types.ts                 Document.meshes, StoredMesh, MeshFeature, BodyPlacement, FrameRef, the role
                           `mesh` of FaceName (before the marker `porty`); Evaluation.meshes, MeshResult,
                           the error `importedTarget`, the two commands, the patch (after `přepočet`)
  mesh.ts                  the mesh as numbers: the base64 codec, the checks of a stored mesh (closed,
                           outwards, its shells, the limits), the weld, the walls between solids
  import/spec.ts           ImportFormatSpec, the map ImportFormats
  import/index.ts          IMPORT_FORMATS, importMesh
  import/stl.ts            the STL reader, binary and ASCII
  sections/meshes.ts       the section: validation, the two commands, the result
  features/mesh.ts         the feature type: validation, references, the step
  recompute/placement.ts   the frame of a FrameRef, the transform of a placement
  schema.ts                the step `3b-mesh-import`
  face-roles.ts            the role `mesh`
  solid.ts                 FaceInfo gets `{ planar: false; surface: 'mesh' }`, with its branch in
                           `surfaceOf` (published as `general`) and in `transformFace` (unchanged)
  recompute/services.ts    applyTool refuses a target with a face of an imported mesh; MESSAGE
  features/module.ts, recompute/state.ts, evaluate.ts
                           a module may name an object of the document its step reads (`input`)
  features/index.ts, validation.ts
                           one line of the registry; the text of `bodyProblem` (which features make a
                           body) names the mesh feature; the reference kind `mesh` (`RefKind`,
                           `requireRef`, `featureRefs`, `REF_LABEL`)
packages/mcp/src/          server.ts (the tool import_mesh), tools.ts (get_document, get_model,
                           changesDocument), api.ts (the part "Import formats")
packages/app/src/          features/mesh.ts (FEATURE_UI), panels/model.ts (the stored meshes)
```

The imports go one way, in the order of the table of `docs/architecture/repository.md`, which gets the new modules: `mesh.ts` with `validation` (it imports only `types.ts`, `util.ts` and `validation.ts`, for the error of a command); `recompute/placement.ts` with `recompute/*`; `sections/meshes.ts` with `sections/*`; `import/*` with `query/*` and `export/*` (it needs the checker of arguments). The module of the feature imports `mesh.ts` and `recompute/`, not the registry, `document.ts` or `evaluate.ts`. (`modules.test.ts` only finds cycles; the order is the table's.)

## The section `meshes`

```ts
meshes: Record<Id, StoredMesh>          // in Document, always present, {} when empty

interface StoredMesh {
  name?: string;        // for people: the file it came from; the rules of a body name
  positions: string;    // base64 of float32, little-endian: x y z per vertex, millimetres
  triangles: string;    // base64 of uint32, little-endian: three vertex numbers per triangle,
}                       // counter-clockwise seen from outside
```

- **Inside the document.** The document stays the only source of truth and one file: `save`, `load`, `open_document`, `save_document`, the app's "Open" and "Save", undo and a preview work unchanged, and the engine keeps having no input but its commands. The price is the size of the file, measured below: the stored mesh is 0.48 of the size of the binary STL it came from (2.5 MB of base64 for 105 000 triangles). See "Rejected" for the file beside the document, and "Open".
- **A section, and a feature that refers to it**, not the data inside the feature. The same mesh placed twice (two motors of one type) is stored once. A feature stays a few lines: everything that handles any feature (`differs` of the engine compares changed features as JSON, `fieldsOf` validates a feature again, `featureInput`, the forms of the app, `get_document` with `feature`) never touches megabytes. A change of the placement makes a new feature object and leaves the stored mesh the same object.
- **Keyed by an ID the caller chooses**, by the rules of every ID. The IDs of the meshes are their own namespace, like those of the links and the joints (D49): the mesh `nema17` may be placed by the feature `nema17`.
- **An entry does not change.** There is no command that edits one: `addMesh` refuses an ID the section has, `removeMesh` removes an entry. A new revision of a file is another entry.
- **Base64 of the two arrays**, not lists of numbers: a list of numbers is about three times the size and slow to parse, and nobody writes a mesh by hand either way. The engine has its own codec (a table of 64 characters; `atob` is not part of the language). It reads only the canonical form (the standard alphabet, padding, no white space), so one mesh has one spelling and two documents with the same mesh compare equal as text. Little-endian is stated, so the file does not depend on the machine.
- **The welded mesh is stored, not the file.** The original bytes are twice the size, would be read again at every load, and a document would then depend on the reader of a format. What the file was called is kept in `name`.
- **Strict entries**: `name`, `positions`, `triangles`, and nothing else, on a command and on a load.

### What a stored mesh has to be

One function (`meshProblem` in `mesh.ts`) judges a mesh, for the importer, for `addMesh` and for a load, and answers with a code, a text and the counts. Checks 1 to 5 are those of the kernel adapter (`inputProblem`), made by the engine so that the reason reaches the caller at the import and not as a `kernelFailure` later; 6 and 7 are what the adapter cannot see and the collisions depend on:

1. The decoded lengths are whole triples of 4-byte numbers; at least 4 triangles and at most `MESH_LIMITS.stored` (100 000; see below for why this is not the provisional limit of an import).
2. Every coordinate is finite and within the bound of a number of the document (±10⁹).
3. Every index names a position, every position is named by a triangle (so the bounds of the body are those of its surface), and no triangle names a vertex twice (which the 3MF export would refuse).
4. **Closed**: every edge is in exactly two triangles, once each way. The message counts what is wrong: edges with one triangle (a hole, or a seam that is not welded), edges with more than two (two solids that share an edge), edges whose two triangles run the same way (a part of the surface is turned over).
5. **Outwards**: the volume is positive.
6. **Every shell encloses something**: its mean thickness (twice its volume over its surface) is above a millionth of its own size, the largest side of its own bounds (`MESH_LIMITS.thinnest`). A shell is a piece of the surface joined through shared edges, as `pieces` of `solid.ts` and the library count them. The rule is a policy: no part is thinner than a millionth of its size (a foil of 0.01 mm over 100 mm is 10⁻⁴), and it depends neither on where the shell stands nor on the other shells. It does not guarantee that the library keeps the shell: the library drops a shell thinner than about 10⁻¹² of the largest coordinate of everything it is given at once (measured: a plate of 10 mm and 10⁻⁶ mm is dropped at x = 10⁶ and kept at x ≤ 10³, one of 10⁻⁷ mm is kept at the origin; a plate of 10⁻⁴ mm at the origin is kept beside a box at x = 10⁷ and dropped beside one at 10⁸, and one of 10⁻³ mm beside a box near x = 10⁹; "Measured", 11). That is the scale of the body as placed and of what it is combined with, which the import does not know; see "Known limits".
7. **Every shell is judged by the other shells around it** (`shellsOf`, the same operation for the importer, `addMesh` and a load). For each shell a test point is taken: the centroid of one of its triangles that is further than 10⁻⁶ of the size of the shell from every triangle of the other shells summed for it (a centroid on or next to another shell, where a hollow or a part touches it at a vertex, along an edge or face to face, is passed over and the next triangle's centroid is taken; a shell with no such centroid is `undecided`). At that point the winding of each other shell is the sum of the solid angles of its triangles seen from the point, over 4π: ±1 when the shell contains the point, 0 when not. The sum over the other shells, rounded, gives the kind: an outward shell with 0 is a `solid`, with 1 or more `nested` (in the material of others: a hollow written outwards or a part inside a part, read and reported); an inward shell with 1 or more is a `hollow`, with 0 `insideOut`; a negative sum is `undecided`. The check refuses `insideOut` and `undecided`. A shell that is inside out and stands beside the solid passes checks 1 to 5 and hides a collision: measured, a probe in the solid and a probe in that shell together share a volume of zero ("Measured", 6). (The importer turns such shells over before the checks, by groups: "The import".) The test point is chosen by distance and not by whether the value comes out whole, because a centroid on a flat face of another shell can give a whole number by the sign of a zero: an inside-out box resting on a box was judged a hollow in the base frame and inside out in a turned one ("Reviews", round 3).

Not checked, because it cannot be decided without a boolean of every pair of shells: that the surface does not cut through itself, and that two shells do not overlap. See "Several shells".

**The cost.** Checks 1 to 6 are passes over the triangles and the edges: 84 ms for 105 000 triangles, plus 27 ms of decoding ("Measured", 5). In check 7 only the shells whose bounds hold the test point count, because a closed shell winds 0 times around a point outside its bounds; they are found through a grid of the bounds of the shells (about one cell per shell). A mesh of one shell costs nothing more. Measured with the sum alone (the prototype of round 2): 31 ms for a hollow ball of 41 000 triangles; a box with 1 000 hollows 10 ms where the sum over every other triangle takes 641 ms; a box with 24 997 hollows (100 000 triangles) 134 ms ("Measured", 11). The cost is the triangles of the shells around each test point, so a dense shell around many others is what makes it grow (a shell of 50 000 triangles around 200 parts is 10⁷ solid angles), and so do shells whose bounds overlap in many cells of the grid. The work is counted, every entry of the grid, every bounds tested, every distance and every solid angle, in one fixed order, and bounded by `MESH_LIMITS.work` (10⁷, about 1.5 s at the measured 0.15 µs per solid angle; a measure, not a ceiling of time); above it the mesh is `tooLarge` ("too many shells around one another to check"). The count depends on the mesh alone, so a mesh gets the same answer on every path.

**Limits of size.** `MESH_LIMITS.triangles` (100 000) is the limit of an import and of `addMesh`, and it is provisional ("Open", 5): it may be lowered. `MESH_LIMITS.stored` (the triangles) and `MESH_LIMITS.work` are what a load checks, and they are never lowered, so that a document saved by an earlier build still loads; today `stored` is 100 000 too. Raising them needs no step (an older build refuses a larger mesh on load, loudly).

### Commands

- `addMesh { id, mesh }`: validates the entry in full (with the import limit `MESH_LIMITS.triangles`) and adds it. An ID the section already has is an invalid command.
- `removeMesh { id }`: removes the entry. Refused while a feature of the document names the mesh, suppressed or not; the message lists the features. (Removing megabytes that a feature still needs is almost never meant, and the batch that is meant is two commands: the feature, then the mesh. Within the section it is the rule of `removeLink`, D49.)

Both are ordinary commands (`execute`, `preview`, a batch, `after` of the tools `query` and `export`), and one undo step each, or together with the feature when they are in one batch. The undo stack holds documents that share the two texts, so a stored mesh is in memory once.

### The result

`evaluation.meshes[id]` (`MeshResult`): the name, the numbers of vertices and triangles, the bounds and the volume of the mesh in its own frame, the number of shells, and `usedBy`, the features that place it. It is what `get_model` and the app show of a stored mesh without decoding it; a mesh no feature uses is listed with an empty `usedBy`. The numbers of an entry are computed once per entry object.

## The feature type `mesh`

```ts
interface MeshFeature extends FeatureBase {
  type: 'mesh';
  mesh: Id;                    // a key of Document.meshes
  placement: BodyPlacement;    // where the origin and the axes of the mesh stand
}
```

- **A feature on the timeline**, because a body is the result of a feature, and because a placement on a face of another body has an order: the body has to be there first. The body has the ID of the feature (`createsBody` answers for no local name; `bodies: 'self'`).
- **`mesh`** is checked by a command that sets it (the section has the entry); a load checks its form only, and a mesh that is not there is the error `brokenReference` of the feature with `refs: [{ mesh: <id> }]`, as for every reference. It is a reference of a new kind (`mesh` in `RefKind`): `updateFeature` then checks it only when it is new, like the others, and `featureRefs` leaves it out, because it is no feature and takes no part in the order on the timeline.
- **`updateFeature`** changes `mesh` and `placement` (a patch merges the placement field by field; the frame is a reference and is replaced whole; `null` removes one of the six numbers, also one the feature does not have: `patch.removable` of the module answers for them).
- **What the entry of the registry says**: `namesFaces` is true (a plane or a sketch that names the face is then a valid command and an error of the recompute, `nonPlanarFace`); `refs` lists the references of the frame (a plane, a body with its face, or a sketch with its point) and the mesh; `producesTool` is false, so a pattern of features cannot repeat it, and a pattern of the body copies it like any body.
- **The step**: the stored mesh (handed over by the recompute, see below), the frame, the transform; the positions moved in double precision and rounded to float32; one new face number for every triangle; the body added to the state. No call of the kernel. The result publishes in `facts` where the origin and the three axes of the mesh ended up (`origin`, `axisX`, `axisY`, `axisZ`), so that a caller that cannot see the model can check a placement.
- **The decoded arrays are kept by the entry object** (a weak map), so a change of the placement decodes nothing.
- **The placed solid is kept as well**: by the entry object, the transform, the face number and the ID of the feature, the last few of them. The ID is part of the key because what the queries remember by a solid holds the names of its faces, which carry the feature (the description of the query `body` is kept by `[solid]`, `query/body.ts`): without it a feature `m2` that took the place of a removed `m1` with the same mesh and placement would get the solid of `m1` and be described with the face of `m1`. Two features of one state never share a face number, and a copy of a pattern is always a new solid. A step runs again whenever anything before it on the timeline changes, as every step does; without this each run would make a new `Solid` of the same numbers, and what is remembered by a solid would be lost with it: `analyzeBody` (156 ms at 105 000 triangles) and every collision and gap the queries remember by the two solids of a pair. With it an edit of an unrelated feature leaves the imported body the same object. (When the edit changes the number of faces before the feature, the face number and so the solid are new.)

### How the step gets the mesh

A step does not see the document, and should not: what a step reads decides when it has to run again. The registry of feature types gets one optional member:

```ts
input?(f: F, doc: Document): object | undefined;   // the object of the document, outside the feature, that the step reads
```

The module of the mesh answers with the entry of the section (`doc.meshes[f.mesh]`), or nothing when it is not there. The recompute hands the object to the step (`StepContext.input`) and uses a remembered step only when it was computed from the same object. So:

- a change of anything else in the document recomputes nothing here (the entry is the same object in every document that shares it);
- a mesh added under an ID that a loaded feature already named (the one way an entry can appear under a feature that stays the same object) recomputes the feature;
- a module still reads the document nowhere else, and 3c (an inserted document) gets the same member.

This is the one exception to "no step of a feature reads a section" (D48): the step of a mesh feature reads one entry of `meshes`, through `input`. The sentence in `docs/architecture/document.md`, the one in `docs/architecture/recompute.md` ("Nothing in the timeline is recomputed for a change of one") and the comment at `Evaluator.evaluate` get the exception; the rule that holds for every section stays true in its other half: a command of a section recomputes a feature only when it changes the entry that feature reads, which here is `addMesh` under an ID a loaded feature already names.

The numbers written back after a recompute make a new feature object (an offset with an expression); `rehang` re-hangs the step with its input, as it does today without one.

### The face

```ts
{ feature: Id; role: 'mesh' }      // one more member of FaceName, with `copy` like every face
```

One face for the whole surface, with a description of a new internal kind, `{ planar: false; surface: 'mesh' }`, published as `Surface` `{ kind: 'general' }`. What follows from the code as it is:

- a sketch or a plane on it ends in `nonPlanarFace`, as on any face that is not planar;
- the body has no edges, so nothing can be projected; after a pattern of the body the copies have the same face with their copy tag;
- the query `body` lists the one face with its area; `measure` takes that face as an entity and answers with the smallest distance on the mesh (a general surface has no exact part);
- `surfaceOf` and `transformFace` of `solid.ts` end in a branch that reads `axis` of a swept surface, so each gets a branch for the new kind (`general`; unchanged by a transform), without which a copy of an imported body would not compile;
- the internal kind is `mesh` and not `general`, because a general surface of a later package (the revolve of an arc) has no flat region, and this one may.

No valid reference can rest on this name (no plane, no projection), so a later package that splits the surface into recognised faces breaks no document.

## The placement

```ts
type FrameRef = PlaneRef | { kind: 'sketchPoint'; sketch: Id; point: Id };

interface BodyPlacement {
  frame: FrameRef;
  x?: number; y?: number; z?: number;      // mm, in the frame
  rx?: number; ry?: number; rz?: number;   // rad
}
```

The requirements of the preparatory step: any orientation against a directed frame, every number a numeric field, a `RigidTransform` as the result.

- **The frame** is directed, as a sketch plane is: a base plane (XY is +X, +Y, +Z; XZ is +X, +Z, −Y; YZ is +Y, +Z, +X), a plane feature, a planar face (the frame a sketch on that face has: the normal points out of the body), or **a sketch point**: the frame of the sketch moved to the point (an own point, `origin`, or a point of projected geometry). The last one is what a bought part wants: the bolt pattern of a motor is drawn in a sketch from the data sheet, and the motor is placed at the centre of that pattern, so the two cannot drift apart. It has the shape of the `sketchPoint` of an `AxisRef`, read as a frame.
- **The offsets** `x`, `y`, `z` are along the X axis, the Y axis and the normal of the frame. The frame of a face is the one a sketch on that face has, and its X may run against an axis of the model (the start cap of an extrusion on XY has X along −X and its normal along −Z); the facts of the feature say where the part ended up.
- **The turns** are about the axes of the frame, which stay where they are: first by `rx` about its X axis, then by `ry` about its Y axis, then by `rz` about its normal, each by the right-hand rule. That is the convention of roll, pitch and yaw of a robot description (`rpy` of URDF). The numbers are in the frame of the placement, so 5b takes the transform (the facts of the feature have it) into the frame of its link and reads the angles from there; they carry over as they are only when the two frames are one. A point `p` of the mesh ends at `O + B · (Rz(rz) · Ry(ry) · Rx(rx) · p + (x, y, z))`, with `O` the origin of the frame and `B` its three axes. Any orientation can be written this way; a frame of the engine is right-handed, so the result never mirrors.
- **Six optional numeric fields** (`placement/x` … `placement/rz`), each with the default 0 by the rule of an optional field of a feature (D44): absent means zero and is not stored, `setField` reaches a field the feature does not have yet, a patch removes one with `null`. A turn is within ±2π. A part that stands on a plane as its file has it is `placement: { frame: { kind: 'base', plane: 'XY' } }`.
- **Errors of the feature**: `brokenReference` and `nonPlanarFace` for the frame, with the frame in `refs`: the codes a sketch on that plane or an axis through that point would get.
- **For 3c.** `BodyPlacement`, `FrameRef` and the function that turns them into a `RigidTransform` (`recompute/placement.ts`) are not tied to a mesh; an inserted part takes them as they are.

The file has no unit; see "The import" for where a unit goes. There is no scale and no mirror in a placement: a bought part has one size and one handedness (a mirror image of a body is the pattern `mirror`).

## A feature does not change an imported body

An extrusion with the operation `add` or `cut`, a hole, and a pattern of them, end in the error `importedTarget` when one of their targets has a face of an imported mesh (the body of a mesh feature, or a copy of it); `refs` name those targets, and no target is changed. The check is one place, `applyTool`, which every tool goes through; a command is not refused for it (a command is checked structurally, and whether a copy of a pattern is an imported body is known only to the recompute).

Why. The kernel adapter makes flush faces safe by finding pairs of planar faces of the tool and of the body, and it knows a face as planar by its face number. The flat regions of an imported mesh are parts of one face that is not planar, so the adapter does not see them. Measured ("Measured", table 2): with the box in the base frame nothing goes wrong, because the library handles faces that coincide exactly. Turned by (30°, 20°, 10°), a boss flush on a flat of the imported box, a pocket whose top is flush with it and a slot flush with its side all come out closed, with the right volume to 5 · 10⁻⁴ mm³ and **with sheets**: 3 to 23 % more surface than the same operation on the box with its six designed faces. The checks of the adapter pass such a body (they look for folded triangles on planar faces only), so it would be a defect without a word, and flush is the usual case: a boss is added on a flat, a hole starts in the plane of a flat.

What it costs: an STL cannot be remixed here (a hole cut into a downloaded part). The uses of the backlog do not need it: a bought part is not machined. The way to lift the rule is the deferred "recognised flat faces", after which the adapter sees the flats; see "Open".

For 3d: a subtraction with the mesh as the tool has the same exposure when a flat of the mesh lies in the plane of a face of the target and the clearance is zero (measured: a plate minus the box, turned: 15 % more surface). With a clearance the moved surface is flush with a face only by coincidence.

## Several shells

A file of a bought part converted from an assembly holds several solids. What the import does with them, measured ("Measured", 3, 6, 8 and 11). Whether two solids that touch are read is decided by the edges they share after the weld and the walls:

| The file | The import | What the kernel then computes |
|---|---|---|
| Solids apart | reads it; `shells` in the report | right |
| Solids that touch face to face with different outlines, sharing no edge (a smaller footprint inside a larger face) | reads it: two closed shells | right: an intersection, a cut and a union across the seam all exact |
| Solids with the same outline whose common faces are cut differently (opposite diagonals of a square) | **refused**: every edge of the outline has four triangles (measured: 4 for a square) | |
| Solids stacked on one outline, the common face cut the same way (the end caps and the stack of a stepper motor) | reads it as **one solid**: the two layers of the common face are left out (`walls` in the report) | right: a probe across both seams shares 3 000.000 of 3 000 |
| Solids that share an edge and no face | **refused**: an edge with more than two triangles | |
| Solids that overlap, or an outward shell inside another | reads it: closed by its indices; a shell whose test point lies in the material of the others is counted in `nested`, with a note | **wrong**: the volume of the mesh counts the overlap twice, and so does an intersection with it (180 mm³ where 90 are shared) |
| A solid with a hollow (an inner shell turned inwards) | reads it; `cavities` in the report | right |
| A shell turned inwards that is not inside a solid (a part of the file inside out) | **turned over** (`turned` in the report); `addMesh` and a load refuse such a mesh (check 7) | it would hide a collision |
| A closed sheet that encloses nothing | **refused** (check 6) | the library would drop it without a word |

**The wall between two solids.** After the weld, and after the whole mesh is turned over when its volume is negative (the pairs cancel in that volume, so it is known before the walls), a pair of triangles on the same three vertices that face opposite ways is a candidate; a group of more than two triangles on the same three vertices is none. Candidates joined through shared edges make a wall. An edge of a wall is **a border** when a triangle that is not in the wall has it, and **inside** when only triangles of the wall have it (where two walls of a 2 × 2 block of solids meet). A wall is left out, both layers of it, and its pairs are counted, only when it has a border and **along every edge of its border there are exactly two other triangles, running the edge opposite ways, one on each side of the wall**: the one that continues the solid behind a triangle of the wall (it runs the edge as the partner of that triangle does) lies behind it or in its plane, the other in front of it or in its plane, and not both in the plane. "In the plane" is a distance from the plane of the wall triangle of at most 10⁻⁶ of the largest coordinate of the mesh (the precision of a coordinate the queries use, `coordinatePrecision`), so a common face cut in part only is found in any frame. Then the wall separates two solids that both face outwards, and leaving it out joins them into one. Otherwise the pairs stay, and the checks refuse the file for its edges with four triangles; a wall without a border (a closed double sheet) stays and check 6 refuses it. What is left is judged by the checks like any mesh.

Why the guard: without it, an inside-out shell with a face cut like a face of a solid, on the material side of that face, was joined to the solid and passed every check (two tetrahedra on one base, the second written inwards on the same side: one shell of volume 83.3, taken by the library, and a probe in the second shares nothing; found by a reviewer, "Reviews", round 2). With the guard its three edges keep four triangles each and it is refused; the same two tetrahedra on opposite sides of the base, both outwards, are one solid of the volume of both. Where two layers of a common face are cut the same way in part only, the border of the wall lies inside the face, both other triangles lie in the plane, and the file is refused for its edges, not for a sheet inside it. The guard is conservative: it tests sides by half-spaces, so it also refuses some valid files whose border is a reflex edge (a plug resting on the floor of a U-shaped slot) and two hollows stacked on one outline (measured by a reviewer: the plain rule gives the right solids). Four boxes in a 2 × 2 block whose common faces are cut alike are read as one solid (8 pairs, volume 4 000, the library `NoError`, measured by both reviewers of round 3). The kernel adapter drops the same pairs after every boolean (`clean.ts`), and the vertices of the seam are then ordinary vertices. Measured ("Measured", 8 and 11): three prisms on one outline are refused without the rule (10 edges with four triangles for a square outline, 250 for a round one of 64 sides) and are one closed solid of the right volume with it, in the base frame and turned; the guard leaves the same pairs out.

**Overlapping shells.** They cannot be told from the indices, and telling them in full by geometry is a boolean of every pair of shells with flush faces, which is the repair that is deferred. The importer finds the plain cases by the winding it already computes for check 7, now for every shell: an outward shell around whose test point the other shells wind once or more lies in material, either a hollow written facing outwards (an exporter that orients every shell outwards) or a part inside a part. It cannot tell which, so it reads the file, counts such shells in `nested` and says so in a note; a partial overlap is found only when the test point lies in the overlap. With more than one shell the report notes that shells that overlap are counted twice. What that spoils is the volume (a mass from a density; a bought part has the mass of its data sheet) and the volume and depth of a collision with the overlap (a hollow written outwards counts as material: a collision is reported where there is none, never hidden); whether there is a collision, and the smallest gap, stay right outside it.

## The import

```ts
importMesh(format, bytes, options?, name?): ImportOutcome     // a function of the engine, no state
IMPORT_FORMATS = { stl }                                       // the catalog
```

- **A function, not a method of `Engine`.** Reading a file needs no document: the function takes bytes and returns a stored mesh with a report, or a reason. The mesh then enters the document by `addMesh`, like everything else. (A method would need a tool and a row in the coverage table for something that reads no state; the catalog has its own typed tables instead, below.)
- **A catalog of formats**, like `EXPORT_FORMATS`: an entry has a title, a summary, the extensions of its files, the description of its options (`ArgSpecs`, so they are checked, described to the AI and shown by a form) and `read`, which turns bytes into triangles in millimetres. Everything after that is shared: the weld, the checks, the report. A second format is a module and a line.
- **STL.**
  - Binary when the length of the file is 84 + 50 · the count at byte 80; that rule first, because a binary file may begin with the word `solid`. Otherwise ASCII, when the text begins with `solid` and holds at least one `vertex`: every `vertex x y z` is a corner, three to a triangle; several `solid` blocks are read as one mesh. Anything else is `unreadable`, and the message says the length of the file and the length its count would need: a binary file that is cut short, or one that begins with `solid` and has a wrong length, lands here and not in "no triangles". So does a number that is not finite.
  - The count of a binary file, and the number of corners of a text, are compared with the limit before anything is welded (`tooLarge`).
  - The normals of the file are not read. A triangle faces the way its corners run.
  - The option `unit`: `mm` (the default), `cm`, `m` or `in`. An STL file has no unit; the stored mesh is always millimetres, and the report gives the bounds so that a motor 0.042 wide is noticed.
- **The weld.** Corners at the same float32 position (after the unit; −0 as 0) become one vertex. Triangles that lose a corner by it are left out and counted. No tolerance: two positions that differ in the last bit stay apart, and the mesh is then refused as open.
- **The walls**: see "Several shells".
- **Inside out.** In this order: a mesh whose volume is negative is turned over as a whole (a file written inside out), before the walls. After the walls, the shells are judged (`shellsOf`, check 7) and turned **by groups, outermost first**: a shell no other shell contains (no other winds ±1 around its test point) is outermost; when it faces inwards it was written inside out, and it is turned over together with every shell it contains (its hollows were inverted with it). Then the shells are judged again, and the report and the checks take that second judgement: `turned` counts the distinct shells turned in the second step, `nested` the outward shells in material. A shell turned alone would change the winding of the shells inside it: a cube beside an inverted box with its hollow written outwards gives 1072 mm³ that way, where the group gives the right 1056 ("Measured", 11). (Mirrored parts of an assembly often come out of an exporter inside out shell by shell; turning the whole mesh alone would leave a refusal that names a shell which was right in the file.)
- **The report** (`MeshReport`): triangles in the file and left out, the pairs of the walls left out, vertices, triangles, shells, cavities, whether the whole mesh was turned over, the shells turned over by groups, the shells nested in material, the volume, the bounds, and notes in words: several shells (an overlap is counted twice and is not detected in general); shells nested in material; shells turned over; more than 20 000 triangles (a real collision with this body takes seconds, and more the deeper it is: "Measured", 5); a largest side of the bounds below a millimetre or above ten metres (is the unit right? 10 of the 11 files of one public robot arm are in metres: "Measured", 9).
- **A refusal** has a code: `unreadable` (not a file of the format), `notASolid` (the checks of a stored mesh but its limits, with the counts of check 4 when the edges are the reason), `tooLarge` (more triangles than the limit of an import, or more work than `MESH_LIMITS.work`), `invalidArguments` (an option). The codes are those of `meshProblem`, so the importer does not sort texts.

## The schema

The step is `3b-mesh-import`: a document without the field `meshes` gets `{}`; a field that is there, whatever it holds, is left to the validation. It reads and changes only `meshes`, so it commutes with every other step. `master` after the merge saves version 7; the branch saves version 6 with `schemaSteps: ['3b-mesh-import']` and `SCHEMA_PENDING = 1`.

Why a step: the section. A build without it would load the document and drop the section without a word (probed). The feature type, the face role, the commands and the reference kind need none: a build without them refuses each by itself (probed).

| The document | The build that loads it | Result |
|---|---|---|
| saved by the branch (version 6, `schemaSteps: ['3b-mesh-import']`) | `master` before the merge, a branch of another package | refused: no step of that name (probed) |
| saved by `master` after the merge (version 7) | a build without the step | refused by the version (probed) |
| saved by a build without the package | a build with it | loads; the step adds `{}` |
| with a mesh that is not a closed solid, or a field of an entry the build does not know | a build with the package | refused: the entry is checked in full and is strict |
| with a mesh feature whose mesh is not in the section | a build with the package | loads; the feature is in error (`brokenReference`) |

`save` always writes the section, also when it is empty.

## MCP and the app

**By construction.** The two commands and the feature go through `execute`, `preview` and `after`. The types (the section, the feature, the placement, the face role, the result, the commands) are in the parts of `types.ts` that `describe_api` prints; the numeric fields of the feature come from the registry; the section is listed from `SECTION_INFO`. `get_model` summarises a feature by its updatable fields and its facts, so the mesh feature needs no branch.

**By hand**, each with a test:

- **The tool `import_mesh { path, format?, options?, id?, name? }`**, a tool of the server next to `open_document`. It reads the file, picks the format by the extension when none is given, calls `importMesh`, and on success sends `addMesh` through `execute` to the engine the other tools use (the app's, when connected). It answers with the ID of the mesh, the report, and the command that places it, written out: a batch of `addFeature` for the mesh feature and `setBodyProperties` with `use: 'reference'`; the text beside it says that the mass of the data sheet belongs there too (neither the file nor the tool knows it). The ID defaults to the name of the file reduced to letters, digits and underscores, and to `mesh` when that is not an ID by the rule of `newId` (`validation.ts`: empty, `origin`, or the name of a property every object has, such as `constructor` or `__proto__`), with `_2`, `_3` when the section has it; the tool reads the IDs of the stored meshes from `get_model` of the same engine first.
  - It brings in what cannot travel in a command and nothing else: placing the body is `execute`, like every change of the document.
  - The server parses (it has the engine's code, as it has `EXPORT_FORMATS`), so what crosses the bridge is the welded mesh, half the size of the file.
  - `packages/mcp/test/import-formats.test.ts` holds two typed tables over `IMPORT_FORMATS`, as for the export formats: a fixture of options per format and whether each option is optional, so a format without its rows does not compile, and the test runs every format through the tool.
- **`describe_api`** gets a generated part "Import formats" (the title, the summary, the extensions and the options of each entry), and one line of the conventions: an imported body has one face, no feature changes it, and it is made a reference part by `setBodyProperties`.
- **`get_document`** leaves the two texts of every stored mesh out and says how long they were; `save_document` writes them. Without this one stored mesh fills the context of the AI.
- **`changesDocument`** (the app asks it before a tool call while a form is open) writes everything of both documents but their features as JSON whenever a preview gives another document, the stored meshes with it. Measured: 2.7 ms for 2.5 MB of base64, so it works as it is; it gets the shortcut the engine has (`sectionsDiffer`: a section that is the same object is not compared).
- **`get_model`** lists the stored meshes when there are any: ID, name, triangles, the size of the bounds, `usedBy`.

**The app.**

- `FEATURE_UI` gets its entry `mesh` (without it the app does not compile): a button "Mesh"; the form of the feature with the stored mesh (a select), the frame (picked in the view: a plane or a planar face, as for a plane feature; a sketch point with the picker of an axis), and the six numeric fields with expressions; the lines of the model panel (the name of the mesh, its triangles).
- "Import a file…" in that form and on the button when the document has no stored mesh: a file input, `importMesh` in the browser, the report or the refusal in the status line, then `addMesh` and the draft of a feature that places it. The mesh is stored before the draft opens, on purpose: a preview of the draft needs it in the document, and storing megabytes again at every preview would be slow. A draft that is cancelled leaves the stored mesh (listed as unused, one undo step, removable). A new feature is confirmed as a batch with `setBodyProperties { use: 'reference' }` unless the box "A bought part" is cleared.
- The model panel lists the stored meshes with their triangles and what uses them, and removes one that nothing uses.
- The view draws the body as it draws any body; it has no edge lines.

## Issue codes

One: **`importedTarget`**, an error of a feature that applies a tool: a target is an imported body. The existing codes cover the rest: `brokenReference` (the mesh, the frame), `nonPlanarFace` (the frame).

## Measured

Spike scripts in the scratchpad of the session (`scratchpad/3b/`: `proto.ts` and `proto2.ts`, the prototype of the reader, the weld, the walls, the checks and the codec; `roundtrip.spike.ts`, `kernel.spike.ts`, `flush.spike.ts`, `size.spike.ts`, `shells.spike.ts`, `depth.spike.ts`, `stack.spike.ts`, `real.spike.ts`, `schema.spike.ts`), run with vitest against the sources of the worktree and the real Manifold adapter on 2026-11-17. They are not in the repository; the recipes are below.

**1. Bodies through STL and back.** Every body of three models (the arm of scenario 13, the box of scenario 12 with every step of `box.ts`, the joint of scenario 9 after `bodiesAndHoles`: 22 bodies, 20 to 5 310 triangles) written by `toStl` and read by the prototype: all closed, one shell, no triangle left out, the volume equal to `BodyResult.volume` to the last digit, and the library takes each (status `NoError`, the same volume). A sphere, a cylinder, a cube and a hollow cube of the library read the same as binary and as ASCII.

**2. A mesh with one face number against designed prisms** (`kernel.boolean`; the box 20 × 20 × 20 once with six planar faces and once through STL with one face number; the frame of the adapter's tests turned by 30°, 20°, 10° and moved off the origin). Twelve operations with the box as the body and one with it as the tool, in each frame. The volume is right to 5 · 10⁻⁴ mm³ in every case, nothing is refused, every result is closed. The surface:

| Operation, turned frame | Six designed faces | One face |
|---|---|---|
| union, a boss flush on top | 2 800.0 | 2 907.6 |
| union, a boss flush on top and at a side | 2 800.0 | 3 000.0 |
| cut, a pocket with its top flush | 2 800.0 | 2 892.4 |
| cut, a slot with a side flush | 2 600.0 | 2 690.9 |
| cut, the whole top slab, flush all round | 2 000.0 | 2 461.8 |
| a plate minus the box, flush at the bottom (the mesh as the tool) | 4 800.0 | 5 510.8 |
| union or cut that overlaps instead of lying flush; a hole through; every intersection | equal | equal |

In the base frame all thirteen cases give the same surface for both.

**3. Several shells**: the table of "Several shells". Two boxes of 10 mm; the probe a box across the seam; base and turned frame alike.

**4. An imported box on a designed plate** (`sharedBy`, `verdictOf` and `closest` of the engine; chord tolerance 0.01): flush, in the base frame and turned, is `nothing` with a gap of 0; 0.2 above is a gap of 0.2; 0.02 and 0.5 into the plate are collisions with the depth exact. **0.005 into the plate is a `fit`** for the imported box and a collision for the designed one: the face of an imported mesh counts as round, and an overlap of round faces shallower than the chord tolerance is a fit.

**5. Size and time.** A "motor" made with the library (a can with a shaft and a flattened sphere, round faces cut ever finer), through STL and the prototype, then placed turned and asked against a designed plate 60 × 60 × 5:

| Triangles | STL | Stored (base64) | Read and weld | Check (closed, volume) | `analyzeBody` | Interference, apart | Interference, 0.5 mm in | Gap, 1 mm apart |
|---|---|---|---|---|---|---|---|---|
| 4 606 | 0.23 MB | 0.11 MB | 13 ms | 3 ms | 10 ms | 22 ms | 0.17 s | 0.17 s |
| 17 406 | 0.87 MB | 0.42 MB | 60 ms | 12 ms | 24 ms | 85 ms | 1.0 s | 0.58 s |
| 38 398 | 1.92 MB | 0.92 MB | 76 ms | 29 ms | 41 ms | 185 ms | 4.8 s | 1.6 s |
| 67 582 | 3.38 MB | 1.62 MB | 133 ms | 55 ms | 59 ms | 228 ms | 11.4 s | 2.3 s |
| 104 958 | 5.25 MB | 2.52 MB | 151 ms | 84 ms | 156 ms | 373 ms | 23.2 s | 3.8 s |
| 150 526 | 7.53 MB | 3.61 MB | 200 ms | 99 ms | 137 ms | 420 ms | 35.1 s | 5.8 s |
| 266 238 | 13.3 MB | 6.39 MB | 363 ms | 290 ms | 365 ms | 770 ms | not run | 6.2 s |
| 595 966 | 29.8 MB | 14.3 MB | 951 ms | 670 ms | 810 ms | 1.9 s | not run | 16.0 s |

Reading, storing and loading are no limit: JSON with the two texts is written and parsed in milliseconds, base64 is decoded in 27 ms at 105 000 triangles, a placement moves the positions in 8 ms. (Drawing was not measured.) What is slow is a collision that is real: its depth is measured point by point against the triangles near what is shared (`penetration` and `nearestOnSurface` in `solid.ts`), and the gap is quadratic in the worst case (`closest`).

The time of a real collision grows with the depth as well, because what is shared grows. The same motor and plate (the first two columns measured in this session, 3.2 s and 9.5 s at 38 398; the others by the internal reviewer of round 1, on the same recipe):

| Triangles | 0.5 mm in | 2 mm in | 5 mm in |
|---|---|---|---|
| 38 398 | 3.1 s | 8.7 s | 18.9 s |
| 104 958 | 18.0 s | 54.7 s | not run |

Other cases at 104 958 triangles, by the same reviewer: the mesh in a designed pocket 0.3 mm too tight 4.5 to 8.7 s; a second copy of the mesh 0.5 mm into it 7.7 s; every gap at most 0.4 s. A report asks its pairs one after another, so the times add up.

So no number of triangles keeps a collision under a given time, and the limit is **provisional**: 100 000 triangles keeps a document, a load and a first look at a body within reason and stops a file that would make every query unusable; it does not keep a query under the 30 s the bridge waits for the app. The note of the report above 20 000 triangles says what is true: seconds per real collision, more the deeper it is. Whether the number stays, and whether the measure of a collision gets a search by place, is under "Open".

What a search by place might give, tried on one part of the work only: the nearest triangle of both bodies for every point `penetration` asks about, over the whole surfaces. A plain grid of cells gives the same distances to the last bit and takes 0.90 s where a pass over every triangle takes 8.7 s (38 398 triangles, 0.5 mm in; 27 622 points), and 2.2 s against 17.6 s at 2 mm in (90 006 points). That is a measure of that part, against a pass of the probe, not of today's code: today's query skips triangles by their boxes (`nearestOnSurface`), and the region it searches first is the box of the shared volume grown by its own diagonal, which for this motor holds nearly all of it. The whole query with a grid was not timed, so what it gains in the end is not known; nor is what a tree would gain. Not measured either: the path of a fit, where the search for sheets in `depthOf` grows with the square of the triangles of a piece (`interference.ts`) and which an imported body reaches more often, since its surface counts as round; and the second opinion of a refused pair (D50), bounded at 12 000 triangles of the intersection, which a dense mesh passes sooner, so such a pair stays failed more often. It is work on `solid.ts`, `mesh-distance.ts` and `interference.ts`, not on the import.

**6. Shells that face inwards, shells that enclose nothing** (`shells.spike.ts`). A cube of 20 mm and a cube of 10 mm inside out beside it, in one file: closed, volume 7 000, taken by the kernel; a probe in the first cube shares 8 mm³ with it, a probe in each of the two shares **0**. With check 7 the file is refused (the rest of the mesh winds 0 times around the shell); a cube with a hollow, a cube with a hollow and a core in it, and two cubes apart pass. A cube with a closed sheet 10⁻⁷ mm thick beside it is refused by check 6. The same in the turned frame, where the sheet is refused by check 4 already (the rounding to float32 joins its two layers along an edge).

**7.** The table of depths above (`depth.spike.ts`).

**8. Solids stacked on one outline** (`stack.spike.ts`, `engine-stack.spike.ts`): three prisms on one outline written into one file, base and turned frame: the numbers of "The wall between two solids" (4 pairs for the square outline, 124 for the round one; one shell; the volume of one prism to the last digit shown). Three cylinders of the engine (the helper of the arm, 404 triangles each) stacked the same way: 402 edges with four triangles, 200 pairs left out, then one closed shell with the volume of one cylinder to 13 digits, taken by the library. Two boxes that share one edge have no such pair and stay refused; a box under a larger box has none and reads as two shells, as before.

**9. Real files** (`real.spike.ts`; the files in a folder of their own, only read). 23 binary STL files of two open robot arms from their public repositories: 12 printed parts of one arm (360 to 64 816 triangles, in millimetres), and 11 files of another: a servo with and without its horn (19 080 and 17 316 triangles), four motors (about 3 000 each), five printed parts; 10 of the 11 are files of its simulation and are in **metres** (the servo is 0.045 units long), one is a print file in millimetres.

| | Read | Refused |
|---|---|---|
| Printed parts, the first arm | 10 of 12 | one with 6 open edges, one with 3 edges of more than two triangles |
| The servo, twice | 2 of 2 | |
| The motors | 3 of 4 | one with 52 open edges |
| Printed parts, the second arm | 3 of 5 | one with 4 open edges, one with 19 open edges and 39 of more than two triangles |

18 of 23 read: one shell each, no triangle left out, no wall, no hollow; the library takes each (`NoError`) with the volume of the mesh. Reading takes 1 to 254 ms. None of the 23 is above 100 000 triangles (the largest has 64 816); the same repositories also hold print plates of all parts in one file of 25 MB, about 500 000 triangles, which were not tried and would be refused as too large. None of these files is a stack of solids; that case rests on "Measured", 8. No ASCII file was among them.

**10. `master` and a document of this package** (`schema.spike.ts`): the probes cited under "What the backlog says" and "The schema".

**11. After the second round of reviews** (`round2.spike.ts`; the welded meshes of the prototype, the library through the adapter's test kit):

| Case | The rules of the second version | The rules of this version |
|---|---|---|
| Two tetrahedra on one base, the second written inwards on the same side | 1 pair left out; closed, volume 83.333, every check passes | the pair stays; 3 edges with four triangles: refused |
| The same two, both outwards, on opposite sides of the base | | 1 pair left out; one solid of volume 250.000, the library `NoError` |
| Three prisms on one outline (square; round of 64), base frame and turned | 4 and 124 pairs | the same pairs, in 2 walls; one shell; the volume of one prism; a probe across both seams 3 000.000 of 3 000 |
| Two equal boxes face to face, the common faces cut by opposite diagonals | | no pair; 4 edges with four triangles: refused |
| A cube of 10 mm with an inward tetrahedron at its corner, sharing the corner vertex (the library takes it: 2 parts, 999.333) | refused: the winding at the shared vertex is 0.125 | read: the centroid of a triangle of the tetrahedron gives 1.000 |
| A cube and a cube inside out beside it | refused (check 7) | the importer turns the second over; `addMesh` of the untouched mesh is refused |
| A cube with a hollow written outwards; two cubes that overlap (test point in the overlap) | read, no word | read; `nested` 1 and a note |
| A box with 1 000 hollows (4 012 triangles) | 641 ms (4 008 000 solid angles) | 10 ms (12 000) |
| A box with 5 000 hollows (20 012 triangles) | 15.3 s (10⁸ solid angles) | 29 ms |
| A box with 24 997 hollows (100 000 triangles) | not run (about 2.5 · 10⁹ solid angles) | 134 ms (299 964) |
| A plate of 10 mm, 0.125 mm thick, at x = 10⁶ (the library takes it) | refused by check 6 | read |
| The same plate 10⁻³ mm thick at x = 10³ | refused | read |
| Plates of 10 mm, 10⁻⁵ to 10⁻⁷ mm thick, at x = 0, 10³, 10⁶ | refused | refused |
| What the library does with a plate of 10 mm alone | | keeps 10⁻⁷ mm at x = 0 and 10³; drops 10⁻⁶ and 10⁻⁷ mm at x = 10⁶ (volume 0, no part; beside a box, only the box is left) |
| The 23 real files of "Measured", 9 | 18 read | the same 18 read, each one solid shell, no wall, nothing turned or nested; the same 5 refused for their edges; the walls and the shells take 1 to 194 ms |

After the third round (the same spike; the rules of this version: a test point away from other shells, the groups turned outermost first, the whole mesh turned before the walls), in the base frame and turned alike:

| Case | The rules of the third version | The rules of this version |
|---|---|---|
| A box 20 × 20 × 10 with a box of 10 mm inside out resting on its top face | judged by the sign of a zero: a hollow (passes check 7) in the base frame | the centroids on the common face are passed over; the box on top is outermost and inside out: turned; both solid, 5 000 mm³ |
| The same two boxes, both outwards | `nested` in the base frame, `solid` turned | solid, solid |
| A cube beside an inverted 4 mm box whose 2 mm hollow is written outwards | kinds solid, insideOut, and a winding of −1 that has no kind | the group (the box and its hollow) turned: solid, solid, hollow; 1 056.0 mm³, the right volume |
| Three prisms on one outline, all inside out | the guard keeps every pair (it assumes solids that face outwards): refused | turned first (−70 560), then 4 pairs left out: closed, 70 560 |
| Four boxes 2 × 2 whose common faces are cut differently | | no pair; 13 edges with four triangles: refused |

## Rejected

- **The mesh in a file beside the document** (the section holds a path). The document would no longer be one file: `save` and `load` take and return one text, the app has no file system, undo would not cover the file, and the engine would need a port to read it, asynchronous in the browser. What it would save is megabytes in a JSON file that is written and parsed in milliseconds. It stays possible later as another variant of an entry.
- **The data inside the feature.** No section and no upgrade step, and the recompute would need no `input`. But the same motor placed twice is stored twice, and every place that handles any feature would handle megabytes: `differs` writes a changed feature as JSON twice per command, `fieldsOf` validates a feature again (the closed-surface check with it), a form sends the whole feature back.
- **Lists of numbers instead of base64.** Three times the size, slower, and readable by nobody at 50 000 lines.
- **The bytes of the file as they came.** See "The welded mesh is stored".
- **An entry keyed by its content** (a digest as the ID). It would make "an entry does not change" true by construction, but an ID should be something a person can read in a feature, and the engine would need a digest. The rule is kept by the two commands instead.
- **A body without a feature** (the section places the mesh itself). A body is the result of a feature everywhere: a body ID is a feature ID, `at` and the marker cut the timeline, a placement on a face needs an order.
- **A feature may change an imported body, with the sheets as a known limit.** The limit would be met by the first boss on a flat of a turned part, without a word.
- **Splitting the surface into flat faces now.** It needs rules for what counts as flat on a finely cut cylinder, a store for the result so that names survive a change of the rules, and a face table that today holds tens of faces and would hold thousands. It is a package of its own with heuristics, and nothing saved now stands in its way.
- **Refusing a file with several shells.** Most files of bought parts would be refused; the cases that go wrong (overlap) are the rarer ones and are named in the report.
- **Refusing a shell nested in material.** It is either a hollow written outwards or a part inside a part, and both are read today by every tool that takes an STL; neither hides a collision. The report names it.
- **Leaving out every pair of opposite triangles without a guard** (the second version of this design). It joined an inside-out shell to a solid it was glued to, past every check ("Measured", 11).
- **Check 6 against the largest coordinate of the mesh** (the second version). It refused real thin parts far from the origin or beside a distant shell, and its reason (the precision of float32) is a matter of where a shell stands, not of what it is.
- **The provisional limit on a load.** Lowering it would make saved documents unreadable.
- **A weld within a tolerance.** A tolerance that closes a seam also closes a thin slot; it belongs to the deferred repair, where it can be asked for.
- **A check or a repair by the kernel at the import** (an addition to the port). The engine's own checks are the adapter's, and every mesh that passed them was taken by the library ("Measured", 1 and 9: 22 bodies of this app and 18 real files); what the library takes and should not (a shell inside out, a sheet without a volume) the port could not tell either, and checks 6 and 7 do. A repair inside the port would be new geometry in the adapter for the deferred cases.
- **A method `Engine.import`.** See "A function, not a method".
- **A tool that also places the body.** It would repeat the arguments of `addFeature` and `setBodyProperties` in a second place.
- **The engine makes a body of a mesh feature a reference part by itself.** The use of a body is a stated fact of the section with one default, `part` (D48). A default by feature type would be a second one (one more answer at the end of the chain a copy already follows), and it would be wrong for a mesh that is meant to be printed. It is the batch that says it, as 3a planned. See "Open".
- **A placement as a matrix, a quaternion or an axis with an angle.** Not numbers a person or an expression drives one at a time.
- **Turns about the axes of the part as it turns** (intrinsic). The same set of orientations; the fixed axes are what a robot description writes.
- **A frame from a plane only.** The centre of a bolt pattern is a sketch point; without it the offsets would repeat the expressions of the sketch.

## Known limits

- **One face.** No sketch on an imported body, no projected edge, no measuring to a part of it; `measure` takes the face of the mesh, which is its whole surface, and `gap` takes the body. A bolt pattern is drawn from the data sheet and checked against the body with the collisions and the gap.
- **No feature changes it** (`importedTarget`).
- **The surface counts as round.** An overlap with an imported body shallower than the chord tolerance of the document is listed under `fits`, not as a collision, also where two flats meet (measured: 0.005 mm). How far the triangles of the file are from the real part is not known to the engine, so `meshAccuracy` of the measuring queries counts the chord tolerance of the document for it, as for any round body.
- **The print query misleads for an imported body**: it finds no contact with the bed (only a planar face can lie on it) and lists the bottom as overhang. A reference part is not printed; a mesh that is (a use the package does not serve yet) needs the recognised flat faces.
- **Overlapping shells are detected only at one point of each shell** (`nested`) and are read; the volume and a collision volume count the overlap twice, and a hollow written outwards counts as material. A hollow is checked at one point: a shell turned inwards that starts inside a solid and passes through its wall is not found, and neither is an inside-out shell that a guarded wall joined to a solid when it crosses the solid's surface elsewhere.
- **Check 6 is a policy** (a millionth of the size of the shell), not a guarantee that the library keeps a thin shell: the library's precision follows the largest coordinate of all it is given at once, which depends on where the body is placed and what it meets. A thin shell of a mesh placed far from the origin, or combined with a body that is, can be dropped without a word (measured: a plate 10⁻⁴ mm thick at the origin, beside a box at x = 10⁸).
- **The guard of the walls is conservative**: a stack whose border is a reflex edge, and hollows stacked on one outline, are refused although they are valid.
- **The checks of a mesh are bounded in work** (`MESH_LIMITS.work`): a dense shell around a few hundred others, or many shells whose bounds overlap, is `tooLarge` although it is closed.
- **A file that is not closed is refused, not repaired** (beyond the walls and the shells turned over): a seam that differs in the last bit, two solids that share an edge and no face, two solids on one outline cut differently, solids that meet at an edge without sharing faces cut alike. Of 23 real files, 5. A body of this app that touches itself along an edge is such a file after an export (the adapter keeps its vertices doubled there, an STL does not); none of the 22 bodies tried is one.
- **A real collision with a large mesh is slow**, and slower the deeper it is: 3 to 19 s at 38 000 triangles, 18 to 55 s at 105 000. Over the bridge a query above 30 s is lost (`bridge.ts`), and the app keeps computing it on its main thread, so the page does not answer until it is done. The limit of 100 000 triangles does not prevent this. A fit and a refused pair with a dense mesh were not timed ("Measured", 5).
- **A change before the feature that changes the number of faces** makes a new solid for the imported body, and the collisions remembered for it are computed again.
- **The unit of an STL is the caller's word.**
- **STL only.**

## To verify before the implementation

- The rules of the walls and of the shells on a file of an assembly with stacked solids (on the real files of "Measured", 9 they change nothing: "Measured", 11).
- More real files: 23 were tried ("Measured", 9). Still to try: a stepper motor converted from the STEP of an assembly (does it come as a stack of solids, and does the rule of the walls take it?), and an ASCII file written by another program.
- The memory of the recompute with `input`: a preview, a state after `at`, the write-back of an offset with an expression (`rehang`), undo and redo across `addMesh`.
- `sectionsDiffer` of the engine compares a section as JSON only when it is another object: after `addMesh`, `removeMesh` and a load. Confirm in the code as built that no other command makes a new object of this section.
- The bridge with a command of megabytes (`execute` with `addMesh`, `_load` of a document with a mesh): the event to the app is one line.
- In a browser: a file of 5 MB through the file input, the form, a body of 100 000 triangles in the view without edges (how long it takes to draw), picking it.
- The snapshots of the app test: a mesh of four triangles, so that a record of the document stays readable.

## Shared vocabulary

**Taken**: the registry of sections and `SectionSpec` (3a), the optional numeric field of a feature (D44), `ArgSpecs` for the options of a format, `RigidTransform`, `frame` and `axis` of `recompute/services.ts`, `setBodyProperties` (3a), `UpgradeStep`.

**Added**, for other packages:

| Name | Where | Who uses it |
|---|---|---|
| `meshes` in `Document` and `Evaluation`, `StoredMesh` | `types.ts`, `sections/meshes.ts` | 3c may store an inserted document the same way |
| `BodyPlacement`, `FrameRef`, the transform of a placement | `types.ts`, `recompute/placement.ts` | 3c (an inserted part) |
| `input` of a feature module, `StepContext.input` | `features/module.ts`, `evaluate.ts` | 3c |
| `FaceInfo` `surface: 'mesh'`, the role `mesh`, the error `importedTarget` | `solid.ts`, `face-roles.ts`, `recompute/services.ts` | 3d decides what a boolean of bodies does with an imported body as its tool or its target; the measurement is above |
| `IMPORT_FORMATS`, `importMesh`, `meshProblem` | `import/`, `mesh.ts` | a later format |
| step `3b-mesh-import` | `UPGRADES` | |

Notes for the plan, which this session does not edit:

- The table of shared places has `FaceInfo` for 2b, 4a, 4b and 3d; this package adds a kind to it as well.
- The row of the feature types names 3b; it also adds to `RefKind` and to the registry member list of `FeatureModule`.
- 3d is designed at the same time: its subtraction with a clearance takes an imported body as the tool, which this design neither allows nor forbids (no feature of today takes a body as a tool).

## Open

**Decided by the owner on 2026-11-17: all six as recommended.** (1) The mesh is stored inside the document. (2) No feature changes an imported body in this package. (3) 3MF import waits. (4) The batch that places a mesh makes it a reference part. (5) Imports read up to 100 000 triangles, with a note above 20 000. (6) Repair beyond the walls and the shells turned over stays deferred. The questions as they were put:

For the owner:

1. **The mesh is stored inside the document** (the question the backlog left open). The file grows by about half the size of the STL; everything else stays as it is. *Yes* keeps the design; *no* means a file beside the document, a port to read it and a document that is no longer one file.
2. **No feature changes an imported body in this package** (a boss or a hole flush with one of its flats leaves sheets without a word once the part is turned, measured). *Yes* keeps the design and leaves "recognised flat faces" as a later package; *no* means that package comes first or with this one.
3. **3MF import waits, and needs an inflater.** A real 3MF is deflated. `pako` 2.1.0 is approved for deflate only (D2, D54: the adapter imports `pako/lib/deflate.js` alone); the same package has the inflater (`pako/lib/inflate.js`), and using it is a new use that needs the owner's word. The way without a library: Node's own `zlib` (`inflateRawSync`) in the server and the browser's `DecompressionStream('deflate-raw')` in the app; the latter is asynchronous, so the app would inflate the parts of the package before it calls the synchronous `importMesh`, and the same file would be read by two inflaters. With pako, and with Node's `zlib` in the server, the inflater is an argument of `importMesh` (it has no engine to take a port from), behind an `Inflater` port like `Deflater`; with the browser's inflater the app inflates before the call instead. The question: *pako* (its inflate, in `packages/deflate-pako`), *platform* (no library, two inflaters), or *wait* (STL only, as designed; the choice is made when 3MF import is taken up). This design implements none of them.
4. **Who makes an imported body a reference part.** As designed, the batch that places it says so (`setBodyProperties`), and the tool and the form write that batch; a body placed without it is a printed part. The alternative is a rule of the engine: a body of a mesh feature is a reference part unless its properties say otherwise. *Batch* keeps the design.
5. **Large meshes.** A real collision with an imported body takes 3 to 19 s at 38 000 triangles and up to a minute at 105 000, and the import cannot prevent that by a number (the checks of a load are bounded in work, measured at about 1.5 s for the bound; the collisions are what is slow). As designed: files up to 100 000 triangles are read, with a note above 20 000, and the slow collisions are a known limit. *Yes* keeps that. The alternatives: *a lower limit* (say which; it applies to imports, saved documents still load), or *a search by place in the measure of a collision first*, as a package of its own before this one is implemented (tried on the nearest-triangle part alone, against a pass over every triangle and not against today's query: 8 to 10 times faster with a plain grid, the same numbers; what the whole query gains over today was not measured).
6. **Repair stays deferred.** The importer leaves out the walls between solids stacked on one outline and turns over shells written inside out; everything else that is not a closed solid is refused. Of 23 real files of two robot arms, 5 are refused (open edges in four; edges with more than two triangles in two); both servo files and three of four motor files read. *Yes* keeps the design and leaves the repair to a later package; *no* means the repair is designed with this one, and the owner names which cases (a weld within a tolerance closes a seam that differs in the last bits; a missing triangle needs filling; an edge of four triangles needs parting).

STEP stays outside until a converter library is approved (D2); none is proposed here.

For the implementation:

- The wording of the report and of the notes; whether `get_model` prints the shells.

No third-party library is needed for what is designed.

## Reviews

Three reviewers per round, each read-only and each against the code of `master`: a subagent that did not write the design, codex (`gpt-6-astra`, high effort) and agy (`gemini-4-argon-high`). The models: the design and round 1 with its fixes were written on Claude Fable 5.2, and the subagent of round 1 was Fable 5.2 at high effort. The session stopped at a usage limit after codex had answered round 2; by the owner's decision of 2026-11-17 (designs continue on Opus while Fable is unavailable) the internal review of round 2, the fixes of round 2 and round 3 were done on Claude Opus 5.5, with an Opus subagent as the internal reviewer.

### Round 1 (2026-11-17, on the first version)

agy could not run: its account was out of quota (HTTP 429), tried once. Codex gave 11 findings (4 major), the subagent 16 (2 major); no blocker. Each was checked against the code or by a probe before it was accepted. Both found sound: the fit of the section into the registry, the identity of `input` as a dependency of a remembered step, the reference kind `mesh`, the optional numeric fields, the handedness of the frames and the order of the turns, `applyTool` as the one place of a union and a difference, the one schema step, the parsing on the server with the command over the bridge, the canonical base64 and the layout of an STL.

| # | Finding | Reviewer | Severity | Accepted | What changed |
|---|---|---|---|---|---|
| 1 | A positive total volume does not make a usable solid: a shell inside out beside a solid hides a collision; a closed sheet without a volume is dropped by the library without a word | codex | major | yes (probed: the shared volume is 0) | checks 6 and 7 of a stored mesh; the rows of "Several shells"; "Measured", 6; `MeshShell`, `MeshProblem` in the contract; a call |
| 2 | The print query counts only planar faces as contact with the bed: an imported body on a flat has no contact and its bottom is overhang | codex, subagent | major | yes | the table of readers, "Known limits" |
| 3 | `changesDocument` writes the whole document but its features as JSON at every preview that gives another document, not only after a change of the section | codex, subagent | major (codex), minor | yes; measured by the subagent at 2.7 ms for 2.5 MB | the statement corrected; the shortcut by identity proposed for it; "To verify" reworded |
| 4 | The limit of 100 000 triangles does not bound the time of a query: several pairs add up, and other pairs were not measured | codex | major | yes | the limit is called provisional; "Open", 5 |
| 5 | The time of a real collision grows steeply with its depth (38 000 triangles: 3 to 19 s; 105 000: 18 to 55 s), so no number of triangles keeps a query under 30 s | subagent | major | yes (the first two depths measured again: 3.2 s, 9.5 s) | "Measured", 5 with the table and a probe of a search by place; the note of the report; "Known limits"; "Open", 5 |
| 6 | Solids stacked on one outline (the caps and the stack of a stepper) are refused: 10 edges with four triangles for a square outline, 250 for a round one; real files were not tried before the approval | subagent | major | yes (probed, also with bodies of the engine) | the rule of the walls in the importer (`withoutWalls`, `MeshReport.walls`); "Measured", 8; 23 real files tried, "Measured", 9; "Open", 6 |
| 7 | `motorFile()` models the part again at every call (duplicate IDs in the second engine) | codex | minor | yes | the file is made once |
| 8 | The gap of the scenario is beyond the default search distance of 5 mm | codex, subagent | minor | yes | `within: 30` |
| 9 | `noToolOnIt` does not test what its comment says (a boss; a cut with two targets) | codex, subagent | minor | yes | the four cuts and the boss written out, with `upper` unchanged by the refused cut |
| 10 | `secondMotor`: the frame of the start cap has X along −X, so `x: 20` puts the motor into the base | subagent | minor | yes (`faceFrame`: X is Y × the outward normal) | `x: -60`, the origin asserted; the placement says that the X of a face frame may run against the model's |
| 11 | `surfaceOf` and `transformFace` need a branch for the new kind of `FaceInfo` | codex | minor | yes | stated in "The face", "Where the code lives" and the contract |
| 12 | The members of the registry entry are not stated: `patch.removable`, `namesFaces`, `refs`, `REF_LABEL` | subagent | minor | yes | "The feature type `mesh`", the contract |
| 13 | `measure` takes faces, edges and sketch points, not bodies | codex | factual | yes | the table of readers, "The face" |
| 14 | A section without a list takes every body, a reference body too | codex | factual | yes | the table of readers split |
| 15 | `FeatureAfter3b` lacks the plane feature with the wider face name; the query types keep the face name of master | codex | minor | yes | the union corrected; a note says where the draft stops |
| 16 | "5b writes the numbers as they are" is true only when the frame of the placement is the frame of the link | codex, subagent | factual | yes | reworded: 5b takes the transform |
| 17 | The command the tool suggests has no source for a mass | codex | minor | yes | the command has no mass; the text says to add it |
| 18 | An edit before the feature gives the imported body a new solid object: `analyzeBody` again, and the collisions remembered by solid are lost | subagent | minor | yes | the placed solid is kept by the entry, the transform and the face number; a call; a known limit for the rest |
| 19 | "A section recomputes no geometry, and this one still does not" is not true as a rule of the code: the step reads an entry | subagent | minor | yes | the exception stated with the two places to update |
| 20 | The reason against a default use by feature type does not hold as written (a copy resolves through a chain already) | subagent | minor | yes | the reason rewritten |
| 21 | STL edge cases: a binary file that begins with `solid` and has a wrong length; `tooLarge` before the weld; a number that is not finite; `meshProblem` returns a text, so the importer would sort texts | subagent | minor | yes | "The import"; `MeshProblem` with a code |
| 22 | The shells should be joined by a shared edge, as `pieces` of `solid.ts` and the library do | subagent | minor | yes | check 6, `shellsOf` |
| 23 | `mesh.ts` cannot throw `CommandError` and import only `types.ts` and `util.ts`; how the tool learns the taken IDs, a file named `origin.stl`; the mesh is stored before the draft opens | subagent | minor | yes | the imports; the default ID; the flow of the app stated as intended |
| 24 | "Open" lacks the questions on large meshes and on files that are not solids; an implementation note answers itself | codex, subagent | minor | yes | "Open", 5 and 6; the note removed |

Nothing was rejected. The fixes are large (two checks, a rule of the importer, a new member of the report), so a second round follows.

### Round 2 (2026-11-17, on the second version, looking mainly at the fixes of round 1)

agy could not run: out of quota again (HTTP 429), tried once. Codex gave 9 findings (4 major), the Opus subagent 14 (4 major); they share five. Each was checked against the code or by a probe ("Measured", 11) before it was accepted. Both found sound: the order of the walls, the turn of the whole mesh and the checks; nested hollows and a core in a hollow; `applyTool` able to refuse every target before it changes one (it works on a copy of the bodies); `stacked()` (one STL from `exportMesh` with a list; both caps of a prism from one triangulation; the counts); `secondMotor` (the frame of the start cap: origin 0, X along −X, the normal −Z); `order()` and `turned()`; the branches of `surfaceOf` and `transformFace`; the members of the registry entry; `changesDocument`; `within: 30`; the base of the schema (still five steps after the rebase).

| # | Finding | Reviewer | Severity | Accepted | What changed |
|---|---|---|---|---|---|
| 1 | Leaving out every opposite pair joins an inside-out shell to a solid it is glued to; the result passes every check, the library takes it, and a collision in the inverted part is hidden | codex | major | yes (probed: 83.333, every check passes) | the guarded rule of the walls (both other triangles at every border edge, one on each side); "Measured", 11; a call |
| 2 | The placed solid kept by entry, transform and face number can go to a feature with another ID; the query `body` then names the face of the old feature | subagent | major | yes (`query/body.ts` keeps the description by `[solid]`) | the ID of the feature is part of the key |
| 3 | Check 7 costs the inward shells times the triangles, on every load, `addMesh` and preview (24 997 hollows: about 2.5 · 10⁹ solid angles) | codex, subagent | major | yes (measured: 15.3 s for 5 000 hollows) | only shells whose bounds hold the point count, through a grid; a work bound (`MESH_LIMITS.windings`, `work` since round 3); the cost stated for many shells |
| 4 | Check 7 at one vertex: a vertex shared with another shell gives a fraction (0.125 at the corner of a box) and a valid hollow is refused | codex, subagent | major (codex), minor | yes (probed; the library takes the file) | the test at the centroids of the triangles, the first whole value |
| 5 | Check 6 against the largest coordinate of the mesh refuses real thin parts far from the origin or beside a distant shell | codex | major | yes (probed: 0.125 mm at x = 10⁶ refused, the library takes it) | thickness against the size of the shell itself; measured where the library drops a shell |
| 6 | The limit is called provisional but a load checks it: lowering it would make saved documents unreadable | subagent | major | yes | `MESH_LIMITS.stored` for a load, never lowered; `triangles` for an import and `addMesh` |
| 7 | An outward shell inside the material of others (a hollow written outwards, a part inside a part) passes, though the winding of check 7 sees it | subagent | major | in part: it is reported (`nested`, a note), not refused | "Several shells", the report, a rejected alternative |
| 8 | The importer could turn single shells that are inside out instead of refusing them | subagent | minor | yes | the importer turns each shell the winding says is inside out; `turned` in the report |
| 9 | The walls could hide an inside-out shell; a wall of part of a face leaves a sheet that check 6 refuses with a misleading reason | subagent | minor | yes: both are refused for their edges by the guarded rule | "The wall between two solids", "Known limits" |
| 10 | The rows of solids that touch contradict each other: equal outlines cut differently share the edges of the outline | codex, subagent | factual | yes (probed: 4 edges with four triangles) | the table split by shared edges |
| 11 | The speedup of a search by place is stated more strongly than measured; the region of `penetration` holds nearly the whole motor; the fit path and the bound of the second opinion were not timed; the app freezes while a long query runs | codex, subagent | factual | yes | "Measured", 5, "Known limits", "Open", 5 |
| 12 | `measure` takes the face, not the body, in "Known limits" | codex | factual | yes | reworded |
| 13 | The query `section` takes every body without a list; the DXF and SVG export takes the printed ones | subagent | factual | yes | the table of readers split |
| 14 | The default ID of `import_mesh` misses the rest of the rule of `newId` (`constructor`, `__proto__`) | codex, subagent | minor | yes | the fallback by the rule of `newId` |
| 15 | "Open", 6 promises a repair a weld cannot give; the walls are already a repair | codex, subagent | minor | yes | the question rewritten: repair stays deferred, with the cases named |
| 16 | "Open", 3 and the note on 2g are stale after the rebase: `pako` 2.1.0 is approved for deflate only; inflate is a new use; the platforms have inflaters | subagent | minor | yes | the question rewritten with three answers; the note removed; the state line |
| 17 | More places state the rules that change: `recompute.md` on the sections, the text of `bodyProblem`, the order of the modules in `repository.md` (`modules.test.ts` only finds cycles) | subagent | minor | yes | "Where the code lives", "How the step gets the mesh" |
| 18 | Stale text: the comment of `MeshReport.cavities`; the cost of a load named check 4 only | subagent | minor | yes | the contract and "The cost" |

The fixes are large again (a guarded rule of the walls, two checks restated, the shells judged one by one in the importer, two limits, the key of the kept solid), so a third round follows; it reads only the diff of these fixes.

### Round 3 (2026-11-17, on the third version, the diff of the fixes of round 2 only)

agy could not run (HTTP 429, tried once). Codex gave 4 findings (3 major), the Opus subagent 12 (1 major); they share four. Both probed the rules with their own code; each finding was checked by reading or by the spike ("Measured", 11, the second table). Both found sound: the orientation argument of the guarded walls for the ordinary seam (the subagent found no wrong configuration it accepts); the zero winding of a closed shell outside its bounds; `glued()`, `tetrahedron().kinds` and `readMotor`; the two limits on every path (preview and batch through `addMesh`, undo as a stack of documents, `_load` through `load`); the feature ID in the key of the kept solid (`query/body.ts`, `pose.ts`, the collisions and the gap all remember by solid with face names); the readers table, the fallback of `newId`, the places of the section rule, the order of the modules, "Open", 3 against D2 and `packages/deflate-pako`; reporting `nested` rather than refusing it.

| # | Finding | Reviewer | Severity | Accepted | What changed |
|---|---|---|---|---|---|
| 1 | A centroid on a flat face of another shell gives a whole number by the sign of a zero: an inside-out box resting on a box passes check 7 in the base frame, and two plain boxes get a false `nested` | subagent | major | yes (probed) | the test point is chosen by its distance from the other shells |
| 2 | Turning one shell changes the winding of those inside it; a winding of −1 has no kind; `turned` may count a shell twice | codex, subagent | major (codex), minor | yes (probed: 1 056 with groups) | groups turned outermost first, judged again after; a negative sum is `undecided`; `turned` counts distinct shells |
| 3 | Check 6 does not cover what the library drops: its precision follows the largest coordinate of all it is given, not where the shell stands | codex, subagent | major (codex), factual | yes (probed by both) | the claim removed; a known limit |
| 4 | The work bound does not bound the grid nor the judgement of the outward shells, is not the same operation on every path, and is lowered at the risk of loads; the claim that only deep nesting reaches it is false | codex, subagent | major (codex), minor | yes | one operation (`shellsOf`) on every path; all work counted; `MESH_LIMITS.work` never lowered; the claim and the time restated |
| 5 | The walls: what an inside edge is (2 × 2 blocks are read, not refused); a double sheet with no border is removed by the prototype though the design says check 6 refuses it | codex, subagent | minor | yes | border and inside edges defined; a wall without a border is no wall; "Known limits" corrected |
| 6 | The guard refuses valid stacks: a reflex border, two stacked hollows, and a whole file inside out (the guard assumes outward solids) | subagent | minor | yes: the whole mesh is turned before the walls; the other two are a known limit | "The import", "Known limits" |
| 7 | "In the plane" as an exact sign depends on the frame | subagent | minor | yes | a distance of 10⁻⁶ of the largest coordinate |
| 8 | "Open", 5 calls the part measured a speedup over today; "Open", 3 says the inflater is an argument also when the app inflates first | subagent | factual, minor | yes | both reworded |
| 9 | `meshProblem(mesh, limit?)` has no stated default | subagent | minor | yes | the default is `MESH_LIMITS.triangles` |
| 10 | The prototype pairs within a group of more than two triangles on one set of vertices, the design does not | subagent | none (the same outcome) | noted | nothing |

This was the last round the rule allows. What is still open is a known limit above: the conservative guard of the walls, the work bound, the scale of the library against check 6, overlaps found at one point only. The rules of the walls and of the shells after this round were run on built cases in the base frame and turned ("Measured", 11) and are to be tried on real files of assemblies ("To verify").

## As implemented

Implemented on the branch `d36/3b` on 2026-11-17, as designed but for what follows.

- **Where the code differs, in small things.**
  - `ImportFailure` (`import/spec.ts`), what `read` of a format throws, carries its code (`unreadable` or `tooLarge`), so a reader decides between the two (the count of a binary file above the limit is `tooLarge` before anything is welded) and the importer sorts no texts.
  - `MeshLimit` is an `Error` with its `problem` (`tooLarge`), thrown out of `judgeShells` when the work goes above `MESH_LIMITS.work`, and caught by `meshProblem` and the importer.
  - `meshProblem(mesh, limit?, shells?)` takes the shells already judged, so the importer judges them once after it turned groups over and the check does not judge them again.
  - `frameRef` and `frameRefs` (the validator of a `FrameRef` and the references it makes) live in `validation.ts` beside `planeRef` and `axisRef`, not in `recompute/placement.ts`, which has only the frame and the transform.
  - The placed solid is made by `transformSolid` of an unplaced solid kept per entry, not by moving the positions in the step: `transformSolid` records the copy (D57), so two bodies placed from one entry are one shape to the parts list, and the arithmetic is the same (double precision, rounded to float32).
  - The report has one more note, for triangles left out by the weld.
  - The step of the work bound (a box of 60 × 60 cells with 240 hollows, `tooLarge`) takes about 1.2 s in the test; replacing `Math.hypot` by `Math.sqrt` in the solid angle made it five times faster.
  - The memo of `Evaluator` keeps `{ step, input }` per resolved feature and state; `rehang` carries `input`.
  - `get_document` shows a stored mesh as `{ name, omitted: "positions and triangles: <n> characters of base64; …" }`. `changesDocument` compares every part of the two documents but the features only when it is another object, and then as JSON.
  - `import_mesh` names the feature it proposes after the mesh (`nema17`), or `nema17_2` when a feature has that ID; the name of the feature is the name of the file without its extension. The report it returns is rounded to six decimal places.
  - The app chooses a sketch point for the frame by two selects (the sketch, then its point, also the points of projected geometry), not by the picker of an axis: a frame needs only the point. `FeatureForm.command` gets the extra state of the form as a fourth argument (the box *A bought part*); the other forms ignore it. The harness of the app test records the stored meshes of the document by their names and the length of their data.
  - Pinned values of other tests moved with the branch: the schema step of the branch in `schema.test.ts` and in the parts of 3a and 5a of `scenario13.test.ts`, the registry and the list of messages in `review.test.ts`, the step index in `mechanism.test.ts`, the role in `face-roles.test.ts`, the narrowing of a surface in `pattern.test.ts`, and the comparison of a saved document in `tangent.test.ts` (it leaves the header and an empty section out).
- **The snapshots of the app** change in every file by the button *Mesh* on the toolbar and, where a document is loaded or saved, by the header (`schemaSteps`) and the empty section `meshes`; `mesh.txt` is new.
- **Measured on the real kernel** (`packages/scenarios/test/mesh-import.test.ts`): the eight bodies of the arm through STL and back keep their volume to the last digit and the kernel takes them; a cube inside out beside a solid is taken by the kernel and the intersection of a probe in it has a volume of −8 mm³ (the probe inside out), not a collision; three boxes on one outline with their walls left out share 720 of 720 mm³ with a probe across both seams.
- **Not done**, as designed: 3MF, STEP, repair, a search by place in the measure of a collision. Not tried yet in a browser with a large file ("To verify").

## Rows for the indexes

**`docs/d36/README.md`, the row of 3b** ("Design now"):

> full, designed 2026-11-17 ([3b-mesh-import/design.md](3b-mesh-import/design.md)), D55: the section `meshes` (a stored mesh as base64, inside the document), the feature type `mesh` with a placement (`BodyPlacement`: a frame from a plane, a planar face or a sketch point, three offsets, three turns), one face of the role `mesh`, the catalog `IMPORT_FORMATS` with `stl`, the tool `import_mesh`; no feature changes an imported body; schema step `3b-mesh-import`. 3c gets the placement and `input` of a feature module. Reviewed in three rounds (round 1 on Fable 5.2, rounds 2 and 3 on Opus 5.5). Open for the owner: six questions (where the mesh lives, no feature on an imported body, the inflater of a later 3MF import, who makes it a reference part, large meshes, repair deferred)

And in "Numbers": decisions D55 taken by 3b, next D56.

**`docs/decisions.md`, the row of D55**:

> | D55 | [3b Import of a mesh as a reference body](d36/3b-mesh-import/design.md) | designed 2026-11-17 | A binary or ASCII STL file is read into a closed mesh and stored inside the document (the section `meshes`); a feature type `mesh` places it as a body with one face by a frame, three offsets and three turns; the body serves the view, the collisions, the gap, the mass and the exports, and no feature changes it. A stored mesh is checked as the kernel adapter checks a solid, and further: every shell is thicker than a millionth of its size, and a shell that faces inwards is a hollow of a solid (the winding of the other shells, pruned by their bounds, bounded in work). The importer leaves out the wall between solids stacked on one outline, guarded so that it joins only two solids that face outwards, and turns over shells written inside out, by groups from the outermost; nothing else is repaired. Measured against the real kernel: flush tools leave sheets on a turned imported body, a shell inside out beside a solid hides a collision, overlapping shells are counted twice, and a real collision with a large mesh takes from seconds to a minute by its depth (3 to 19 s at 38 000 triangles), which the limit of 100 000 triangles (provisional, for imports; a load has a ceiling that is never lowered) does not prevent; 18 of 23 real files of two robot arms read, 5 are not closed and are refused |

**`docs/requirements.md`, scenario 13, the part of this package**:

> - *The motor as an imported mesh (3b, D55).* The file of the motor (a can with a shaft) is written as binary STL by a second engine and read by the import: one shell, the volume of the body it came from; the same triangles as ASCII give the same mesh. A file with a triangle missing and a file of two boxes that share an edge are refused with the count of the edges that are wrong, a mesh with a shell inside out beside its solid is refused by `addMesh` as no solid, and two tetrahedra glued on one base with the second inside out keep their common face and are refused; three boxes stacked on one outline in one file are read as one solid, the walls between them left out and counted; a file in metres is read with its unit. The mesh is stored once and the cylinder that stood for the motor is replaced, in one batch and one undo step, by a mesh feature under the same ID, placed at the sketch point of the motor with an offset along the normal: the body keeps its properties (a reference part of 280 g) and its place in its link, and the command says that the ID was taken over. It has one face and no edge; a sketch on it, a boss on it and a cut into it are errors of those features (`nonPlanarFace`, `importedTarget`) and change nothing, and a cut that has the link and the motor as its targets changes neither. An edit of the base leaves the body of the motor the same object. The sweep of the elbow finds the forearm in the motor from the same step as before, the gap at 1.2 is measured to the mesh, and the mass beyond the shoulder is unchanged. A turn of the placement is an expression in degrees; the facts of the feature say where the axes of the mesh point. A second motor placed from the same stored mesh, upside down on the bottom face of the link, adds a feature and no data. The print export without a list leaves the motor out and the 3MF of a list writes it. A stored mesh in use cannot be removed; unused, it is listed and removed. Save and load keep the section (version 7); a stored mesh edited to be open is refused on load, and a feature whose mesh is gone loads as a broken reference.
