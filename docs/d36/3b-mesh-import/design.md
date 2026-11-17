# 3b Import of a mesh as a reference body (D55)

**State: design, first version, 2026-11-17, before its reviews (see "Reviews").** Written against the code of `master` at `633a6ca` (schema version 6; 3a and 5a merged). The types are in [contract.ts](contract.ts), the scenario as calls in [calls.ts](calls.ts); both are checked by `npx tsc -p docs/d36/tsconfig.json`. The package adds its part to validation scenario 13 (the arm): the motor as the mesh of a bought part.

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
| Interference, the smallest gap, posed queries | yes | the surface counts as round (below) |
| Body properties, mass, the mechanism, a pattern or a mirror of the body | yes | the mass of a bought part is its `mass`; a copy carries the face with its copy tag |
| Exports, the print query, the section | yes, for a body the caller lists | a reference body is in no list a reader makes by itself (D48) |
| A sketch on it, a projected edge | no | `nonPlanarFace`; it has no edges |
| An extrusion that adds to it or cuts it, a hole in it | no | the error `importedTarget` (below) |

**Deferred**, and why each can come later without a change of what is saved now:

- **3MF.** An entry of the catalog of import formats. A 3MF from a slicer or a CAD tool is deflated, so reading it needs a decompressor; see "Open".
- **STEP.** A converter library (D2); none is chosen. Until then the conversion to STL is done outside.
- **Recognised flat faces, and with them a sketch on an imported body, its straight edges and features that change it.** An optional field of a stored mesh (a face group per triangle, computed once at the import and stored, so that the names never depend on the algorithm) and a second face role. See "A feature does not change an imported body".
- **Repair**: a weld within a tolerance, parting two solids that share an edge, filling a hole, uniting shells that overlap. Each is work of the importer; the stored mesh keeps its shape.
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
                           outwards, the limits), the weld, the count of shells
  import/spec.ts           ImportFormatSpec, the map ImportFormats
  import/index.ts          IMPORT_FORMATS, importMesh
  import/stl.ts            the STL reader, binary and ASCII
  sections/meshes.ts       the section: validation, the two commands, the result
  features/mesh.ts         the feature type: validation, references, the step
  recompute/placement.ts   the frame of a FrameRef, the transform of a placement
  schema.ts                the step `3b-mesh-import`
  face-roles.ts            the role `mesh`
  solid.ts                 FaceInfo gets `{ planar: false; surface: 'mesh' }`
  recompute/services.ts    applyTool refuses a target with a face of an imported mesh; MESSAGE
  features/module.ts, recompute/state.ts, evaluate.ts
                           a module may name an object of the document its step reads (`input`)
  features/index.ts, validation.ts
                           one line of the registry; the reference kind `mesh`
packages/mcp/src/          server.ts (the tool import_mesh), tools.ts (get_document, get_model),
                           api.ts (the part "Import formats")
packages/app/src/          features/mesh.ts (FEATURE_UI), panels/model.ts (the stored meshes)
```

The imports go one way, as `modules.test.ts` holds them: `mesh.ts` imports only `types.ts` and `util.ts`; the module of the feature imports `mesh.ts` and `recompute/`, not the registry, `document.ts` or `evaluate.ts`.

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

One function (`meshProblem` in `mesh.ts`) judges a mesh, for the importer, for `addMesh` and for a load. These are the checks of the kernel adapter (`inputProblem`), made by the engine so that the reason reaches the caller at the import and not as a `kernelFailure` later:

1. The decoded lengths are whole triples of 4-byte numbers; at least 4 triangles and at most `MAX_MESH_TRIANGLES` (100 000, see "Measured").
2. Every coordinate is finite and within the bound of a number of the document (±10⁹).
3. Every index names a position, every position is named by a triangle (so the bounds of the body are those of its surface), and no triangle names a vertex twice (which the 3MF export would refuse).
4. **Closed**: every edge is in exactly two triangles, once each way. The message counts what is wrong: edges with one triangle (a hole, or a seam that is not welded), edges with more than two (two solids that share an edge), edges whose two triangles run the same way (a part of the surface is turned over).
5. **Outwards**: the volume is positive.

Not checked, because it cannot be decided from the indices: that the surface does not cut through itself, and that two shells do not overlap. See "Several shells".

The cost on a load is that of step 4, a pass over the edges: 84 ms for 105 000 triangles, plus 27 ms of decoding ("Measured").

### Commands

- `addMesh { id, mesh }`: validates the entry in full and adds it. An ID the section already has is an invalid command.
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
- **`updateFeature`** changes `mesh` and `placement` (a patch merges the placement field by field; the frame is a reference and is replaced whole).
- **It leaves no tool** (`producesTool` is false): a pattern of features cannot repeat it; a pattern of the body copies it like any body.
- **The step**: the stored mesh (handed over by the recompute, see below), the frame, the transform; the positions moved in double precision and rounded to float32; one new face number for every triangle; the body added to the state. No call of the kernel. The result publishes in `facts` where the origin and the three axes of the mesh ended up (`origin`, `axisX`, `axisY`, `axisZ`), so that a caller that cannot see the model can check a placement.
- **The decoded arrays are kept by the entry object** (a weak map), so a change of the placement decodes nothing.

### How the step gets the mesh

A step does not see the document, and should not: what a step reads decides when it has to run again. The registry of feature types gets one optional member:

```ts
input?(f: F, doc: Document): object | undefined;   // the object of the document, outside the feature, that the step reads
```

The module of the mesh answers with the entry of the section (`doc.meshes[f.mesh]`), or nothing when it is not there. The recompute hands the object to the step (`StepContext.input`) and uses a remembered step only when it was computed from the same object. So:

- a change of anything else in the document recomputes nothing here (the entry is the same object in every document that shares it);
- a mesh added under an ID that a loaded feature already named (the one way an entry can appear under a feature that stays the same object) recomputes the feature;
- a module still reads the document nowhere else, and 3c (an inserted document) gets the same member.

The numbers written back after a recompute make a new feature object (an offset with an expression); `rehang` re-hangs the step with its input, as it does today without one.

### The face

```ts
{ feature: Id; role: 'mesh' }      // one more member of FaceName, with `copy` like every face
```

One face for the whole surface, with a description of a new internal kind, `{ planar: false; surface: 'mesh' }`, published as `Surface` `{ kind: 'general' }`. What follows from the code as it is:

- a sketch or a plane on it ends in `nonPlanarFace`, as on any face that is not planar;
- the body has no edges, so nothing can be projected; after a pattern of the body the copies have the same face with their copy tag;
- the query `body` lists the one face with its area; `measure` takes the body, not a part of it;
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
- **The offsets** `x`, `y`, `z` are along the X axis, the Y axis and the normal of the frame.
- **The turns** are about the axes of the frame, which stay where they are: first by `rx` about its X axis, then by `ry` about its Y axis, then by `rz` about its normal, each by the right-hand rule. That is the roll, pitch and yaw of a robot description (`rpy` of URDF), so 5b writes the numbers as they are. A point `p` of the mesh ends at `O + B · (Rz(rz) · Ry(ry) · Rx(rx) · p + (x, y, z))`, with `O` the origin of the frame and `B` its three axes. Any orientation can be written this way; a frame of the engine is right-handed, so the result never mirrors.
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

A file of a bought part converted from an assembly holds several solids. What the import does with them, measured (table 3):

| The file | The import | What the kernel then computes |
|---|---|---|
| Solids apart | reads it; `shells` in the report | right |
| Solids that touch face to face, the faces cut differently | reads it (they share vertices, no edge) | right: an intersection, a cut and a union across the seam all exact |
| Solids that share an edge, or a whole face cut the same way | **refused**: edges with more than two triangles | |
| Solids that overlap, or one inside another | reads it: closed by its indices | **wrong**: the volume of the mesh counts the overlap twice, and so does an intersection with it (180 mm³ where 90 are shared) |
| A solid with a cavity (an inner shell turned inwards) | reads it; `cavities` in the report | right |

Overlapping shells cannot be told from the indices, and telling them by geometry is a boolean of every pair of shells with flush faces, which is the repair that is deferred. So the import reads such a file, says in its report how many shells it has, and adds a note when there is more than one: shells that overlap are counted twice. What that spoils is the volume (a mass from a density; a bought part has the mass of its data sheet) and the volume and depth of a collision with the overlap; whether there is a collision, and the smallest gap, stay right.

## The import

```ts
importMesh(format, bytes, options?, name?): ImportOutcome     // a function of the engine, no state
IMPORT_FORMATS = { stl }                                       // the catalog
```

- **A function, not a method of `Engine`.** Reading a file needs no document: the function takes bytes and returns a stored mesh with a report, or a reason. The mesh then enters the document by `addMesh`, like everything else. (A method would need a tool and a row in the coverage table for something that reads no state; the catalog has its own typed tables instead, below.)
- **A catalog of formats**, like `EXPORT_FORMATS`: an entry has a title, a summary, the extensions of its files, the description of its options (`ArgSpecs`, so they are checked, described to the AI and shown by a form) and `read`, which turns bytes into triangles in millimetres. Everything after that is shared: the weld, the checks, the report. A second format is a module and a line.
- **STL.**
  - Binary when the length of the file is 84 + 50 · the count at byte 80; that rule first, because a binary file may begin with the word `solid`. Otherwise ASCII, when the text begins with `solid`: every `vertex x y z` is a corner, three to a triangle; several `solid` blocks are read as one mesh. Anything else is not an STL file, and the message says both lengths.
  - The normals of the file are not read. A triangle faces the way its corners run.
  - The option `unit`: `mm` (the default), `cm`, `m` or `in`. An STL file has no unit; the stored mesh is always millimetres, and the report gives the bounds so that a motor 0.042 wide is noticed.
- **The weld.** Corners at the same float32 position (after the unit; −0 as 0) become one vertex. Triangles that lose a corner by it are left out and counted. No tolerance: two positions that differ in the last bit stay apart, and the mesh is then refused as open.
- **Inside out.** A closed mesh whose volume is negative is turned over as a whole, and the report says so.
- **The report** (`MeshReport`): triangles in the file and left out, vertices, triangles, shells, cavities, whether it was turned over, the volume, the bounds, and notes in words (several shells; more than 20 000 triangles: the collisions and the gap slow down with them, see "Measured").
- **A refusal** has a code: `unreadable` (not a file of the format), `notASolid` (with the counts of check 4, or a volume of zero), `tooLarge`, `invalidArguments` (an option).

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

- **The tool `import_mesh { path, format?, options?, id?, name? }`**, a tool of the server next to `open_document`. It reads the file, picks the format by the extension when none is given, calls `importMesh`, and on success sends `addMesh` through `execute` to the engine the other tools use (the app's, when connected). It answers with the ID of the mesh, the report, and the command that places it, written out: a batch of `addFeature` for the mesh feature and `setBodyProperties` with `use: 'reference'` and a `mass`. The ID defaults to the name of the file reduced to the characters of an ID, with a number when it is taken.
  - It brings in what cannot travel in a command and nothing else: placing the body is `execute`, like every change of the document.
  - The server parses (it has the engine's code, as it has `EXPORT_FORMATS`), so what crosses the bridge is the welded mesh, half the size of the file.
  - `packages/mcp/test/import-formats.test.ts` holds two typed tables over `IMPORT_FORMATS`, as for the export formats: a fixture of options per format and whether each option is optional, so a format without its rows does not compile, and the test runs every format through the tool.
- **`describe_api`** gets a generated part "Import formats" (the title, the summary, the extensions and the options of each entry), and one line of the conventions: an imported body has one face, no feature changes it, and it is made a reference part by `setBodyProperties`.
- **`get_document`** leaves the two texts of every stored mesh out and says how long they were; `save_document` writes them. Without this one stored mesh fills the context of the AI.
- **`get_model`** lists the stored meshes when there are any: ID, name, triangles, the size of the bounds, `usedBy`.

**The app.**

- `FEATURE_UI` gets its entry `mesh` (without it the app does not compile): a button "Mesh"; the form of the feature with the stored mesh (a select), the frame (picked in the view: a plane or a planar face, as for a plane feature; a sketch point with the picker of an axis), and the six numeric fields with expressions; the lines of the model panel (the name of the mesh, its triangles).
- "Import a file…" in that form and on the button when the document has no stored mesh: a file input, `importMesh` in the browser, the report or the refusal in the status line, then `addMesh` and the draft of a feature that places it. A new feature is confirmed as a batch with `setBodyProperties { use: 'reference' }` unless the box "A bought part" is cleared.
- The model panel lists the stored meshes with their triangles and what uses them, and removes one that nothing uses.
- The view draws the body as it draws any body; it has no edge lines.

## Issue codes

One: **`importedTarget`**, an error of a feature that applies a tool: a target is an imported body. The existing codes cover the rest: `brokenReference` (the mesh, the frame), `nonPlanarFace` (the frame).

## Measured

Spike scripts in the scratchpad of the session (`scratchpad/3b/`: `proto.ts`, the prototype of the reader, the weld, the checks and the codec; `roundtrip.spike.ts`, `kernel.spike.ts`, `flush.spike.ts`, `size.spike.ts`, `schema.spike.ts`), run with vitest against the sources of the worktree and the real Manifold adapter on 2026-11-17. They are not in the repository; the recipes are below.

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

Reading, storing, loading and drawing are no limit: JSON with the two texts is written and parsed in milliseconds, base64 is decoded in 27 ms at 105 000 triangles, a placement moves the positions in 8 ms. The limit is a collision that is real: its depth is measured point by point against the triangles near what is shared (`penetration` in `solid.ts`), and the gap is quadratic in the worst case (`closest`). Hence the two numbers of the design: a mesh above **100 000 triangles is refused** (a real collision with it would take longer than the 30 s the bridge waits for the app), and the report of an import adds a note **above 20 000** (a second per collision). A search by place in those two functions would lift both; it is not work of this package.

**6. `master` and a document of this package** (`schema.spike.ts`): the probes cited under "What the backlog says" and "The schema".

## Rejected

- **The mesh in a file beside the document** (the section holds a path). The document would no longer be one file: `save` and `load` take and return one text, the app has no file system, undo would not cover the file, and the engine would need a port to read it, asynchronous in the browser. What it would save is megabytes in a JSON file that is written and parsed in milliseconds. It stays possible later as another variant of an entry.
- **The data inside the feature.** No section and no upgrade step, and the recompute would need no `input`. But the same motor placed twice is stored twice, and every place that handles any feature would handle megabytes: `differs` writes a changed feature as JSON twice per command, `fieldsOf` validates a feature again (the closed-surface check with it), a form sends the whole feature back.
- **Lists of numbers instead of base64.** Three times the size, slower, and readable by nobody at 50 000 lines.
- **The bytes of the file as they came.** See "The welded mesh is stored".
- **An entry keyed by its content** (a digest as the ID). It would make "an entry does not change" true by construction, but an ID should be something a person can read in a feature, and the engine would need a digest. The rule is kept by the two commands instead.
- **A body without a feature** (the section places the mesh itself). A body is the result of a feature everywhere: a body ID is a feature ID, `at` and the marker cut the timeline, a placement on a face needs an order. A section "recomputes no geometry" (D48), and this one still does not: the feature does.
- **A feature may change an imported body, with the sheets as a known limit.** The limit would be met by the first boss on a flat of a turned part, without a word.
- **Splitting the surface into flat faces now.** It needs rules for what counts as flat on a finely cut cylinder, a store for the result so that names survive a change of the rules, and a face table that today holds tens of faces and would hold thousands. It is a package of its own with heuristics, and nothing saved now stands in its way.
- **Refusing a file with several shells.** Most files of bought parts would be refused; the cases that go wrong (overlap) are the rarer ones and are named in the report.
- **A weld within a tolerance.** A tolerance that closes a seam also closes a thin slot; it belongs to the deferred repair, where it can be asked for.
- **A check or a repair by the kernel at the import** (an addition to the port). The engine's own checks are the adapter's, and every mesh that passed them was taken by the library ("Measured", 1); a repair inside the port would be new geometry in the adapter for the deferred cases.
- **A method `Engine.import`.** See "A function, not a method".
- **A tool that also places the body.** It would repeat the arguments of `addFeature` and `setBodyProperties` in a second place.
- **The engine makes a body of a mesh feature a reference part by itself.** The use of a body is a stated fact of the section with one default (D48); a second default that depends on the feature type would have to be carried through the copies of a pattern as well. It is the batch that says it, as 3a planned. See "Open".
- **A placement as a matrix, a quaternion or an axis with an angle.** Not numbers a person or an expression drives one at a time.
- **Turns about the axes of the part as it turns** (intrinsic). The same set of orientations; the fixed axes are what a robot description writes.
- **A frame from a plane only.** The centre of a bolt pattern is a sketch point; without it the offsets would repeat the expressions of the sketch.

## Known limits

- **One face.** No sketch on an imported body, no projected edge, no measuring to a part of it; `measure` and `gap` take the whole body. A bolt pattern is drawn from the data sheet and checked against the body with the collisions and the gap.
- **No feature changes it** (`importedTarget`).
- **The surface counts as round.** An overlap with an imported body shallower than the chord tolerance of the document is listed under `fits`, not as a collision, also where two flats meet (measured: 0.005 mm). How far the triangles of the file are from the real part is not known to the engine, so `meshAccuracy` of the measuring queries counts the chord tolerance of the document for it, as for any round body.
- **Overlapping shells are not detected**; the volume and a collision volume count the overlap twice.
- **A file that is not closed is refused, not repaired**: a seam that differs in the last bit, two solids that share an edge. A body of this app that touches itself along an edge is such a file after an export (the adapter keeps its vertices doubled there, an STL does not); none of the 22 bodies tried is one.
- **A turned-over shell that is not a cavity** (a part of the file inside out) reads as a cavity.
- **100 000 triangles at most**, and slow collisions well below that.
- **The unit of an STL is the caller's word.**
- **STL only.**

## To verify before the implementation

- Real files: a stepper motor and a servo as STL from a maker's site or converted from STEP by FreeCAD (binary), and an ASCII file from OpenSCAD or Blender. How many are refused, and why; whether 100 000 triangles is where real files are.
- The memory of the recompute with `input`: a preview, a state after `at`, the write-back of an offset with an expression (`rehang`), undo and redo across `addMesh`.
- `sectionsDiffer` and `changesDocument` of MCP compare a section as JSON when it is another object: only after `addMesh`, `removeMesh` and a load; confirm that no command in between makes a new section object.
- The bridge with a command of megabytes (`execute` with `addMesh`, `_load` of a document with a mesh): the event to the app is one line.
- In a browser: a file of 5 MB through the file input, the form, a body of 100 000 triangles in the view without edges, picking it.
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

For the owner:

1. **The mesh is stored inside the document** (the question the backlog left open). The file grows by about half the size of the STL; everything else stays as it is. *Yes* keeps the design; *no* means a file beside the document, a port to read it and a document that is no longer one file.
2. **No feature changes an imported body in this package** (a boss or a hole flush with one of its flats leaves sheets without a word once the part is turned, measured). *Yes* keeps the design and leaves "recognised flat faces" as a later package; *no* means that package comes first or with this one.
3. **3MF import waits.** A real 3MF is deflated. The owner decided on 2026-11-17 (D54) that the 3MF export gets a compression library, chosen by the session of that addition and approved once named; if that library also decompresses, reading 3MF is an entry of the catalog here with no further library. *Yes*: STL now, 3MF once that library is approved. *No*: say whether 3MF import should be designed now around that library.
4. **Who makes an imported body a reference part.** As designed, the batch that places it says so (`setBodyProperties`), and the tool and the form write that batch; a body placed without it is a printed part. The alternative is a rule of the engine: a body of a mesh feature is a reference part unless its properties say otherwise. *Batch* keeps the design.

STEP stays outside until a converter library is approved (D2); none is proposed here.

For the implementation:

- The wording of the report and of the notes; whether `get_model` prints the shells.
- Whether the form of the app offers the unit again for a stored mesh (it cannot: the unit is applied at the import; the form says which unit was used only if `name` carries it).

No third-party library is needed for what is designed.

## Reviews

Not reviewed yet.

## Rows for the indexes

**`docs/d36/README.md`, the row of 3b** ("Design now"):

> full, designed 2026-11-17 ([3b-mesh-import/design.md](3b-mesh-import/design.md)), D55: the section `meshes` (a stored mesh as base64, inside the document), the feature type `mesh` with a placement (`BodyPlacement`: a frame from a plane, a planar face or a sketch point, three offsets, three turns), one face of the role `mesh`, the catalog `IMPORT_FORMATS` with `stl`, the tool `import_mesh`; no feature changes an imported body; schema step `3b-mesh-import`. 3c gets the placement and `input` of a feature module

And in "Numbers": decisions D55 taken by 3b, next D56.

**`docs/decisions.md`, the row of D55**:

> | D55 | [3b Import of a mesh as a reference body](d36/3b-mesh-import/design.md) | designed 2026-11-17 | A binary or ASCII STL file is read into a closed mesh and stored inside the document (the section `meshes`); a feature type `mesh` places it as a body with one face by a frame, three offsets and three turns; the body serves the view, the collisions, the gap, the mass and the exports, and no feature changes it. Measured against the real kernel: flush tools leave sheets on a turned imported body, overlapping shells are counted twice, and a real collision with a mesh of 100 000 triangles takes 23 s, which sets the limit |

**`docs/requirements.md`, scenario 13, the part of this package**:

> - *The motor as an imported mesh (3b, D55).* The file of the motor (a can with a shaft) is written as binary STL by a second engine and read by the import: one shell, the volume of the body it came from; the same triangles as ASCII give the same mesh. A file with a triangle missing and a file of two boxes that share an edge are refused with the count of the edges that are wrong; a file in metres is read with its unit. The mesh is stored once and the cylinder that stood for the motor is replaced, in one batch and one undo step, by a mesh feature under the same ID, placed at the sketch point of the motor with an offset along the normal: the body keeps its properties (a reference part of 280 g) and its place in its link, and the command says that the ID was taken over. It has one face and no edge; a sketch on it and a cut into it are errors of those features (`nonPlanarFace`, `importedTarget`) and change nothing. The sweep of the elbow finds the forearm in the motor from the same step as before, the gap at 1.2 is measured to the mesh, and the mass beyond the shoulder is unchanged. A turn of the placement is an expression in degrees; the facts of the feature say where the axes of the mesh point. A second motor placed from the same stored mesh adds a feature and no data. The print export without a list leaves the motor out and the 3MF of a list writes it. A stored mesh in use cannot be removed; unused, it is listed and removed. Save and load keep the section (version 7); a stored mesh edited to be open is refused on load, and a feature whose mesh is gone loads as a broken reference.
