// Contract of package 3b of D36 (decision D55): the import of a mesh as a reference body. A draft,
// only type-checked (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the engine
// of master and states what the package adds or changes. The design is design.md; the scenario
// written as calls is calls.ts.
//
// Where the types will live: what a caller of the engine or an AI reads goes to `types.ts`, into
// the parts `describe_api` prints: the section, the stored mesh, the feature, the placement and
// the face role before the marker `// --- porty`; the result, the issue code, the commands and
// the patch after the marker `// --- přepočet`. The catalog of import formats, `importMesh` and
// the checks of a mesh are values of the engine, exported from its index.
//
// In the code the feature is a member of `Feature`, the role a member of `FaceName`, the commands
// members of `Command`. The draft cannot add to those unions, so it states each of them as it is
// after the package (`FeatureAfter3b`, …), and the engine with them (`EngineAfter3b`).

import type {
  ArgPath,
  ArgSpecs,
  ArgsOf,
  Command,
  CommandResult,
  CopyTag,
  Document,
  Engine,
  ErrorCode,
  Evaluation,
  Exported,
  ExportFormat,
  ExportOptions,
  FaceName,
  Feature,
  FeatureBase,
  FieldSpec,
  Frame,
  Id,
  Input,
  Patch,
  PlaneFeature,
  PlaneRef,
  QueryArgs,
  QueryName,
  QueryOutcome,
  QueryResult,
  RigidTransform,
  RunArgsOf,
  SectionInfo,
  UpgradeStep,
  Vec3,
} from '../../../packages/engine/src/index';
import type { State } from '../../../packages/engine/src/recompute/state';

// ================================================================ the stored mesh

// A mesh as the document holds it: a closed, indexed triangle mesh in millimetres, in its own
// frame (the frame of the file it came from).
// - `name`: for people, usually the name of the file. The rules of a body name: not empty, no
//   leading or trailing space, at most 200 characters.
// - `positions`: base64 of 32-bit floats, little-endian: x, y, z of every vertex.
// - `triangles`: base64 of 32-bit unsigned integers, little-endian: three vertex numbers per
//   triangle, counter-clockwise seen from outside the solid.
// - Base64 in its canonical form: the alphabet of RFC 4648 section 4, padded with `=`, no white
//   space and no other character, the unused bits of the last character zero. One mesh has one
//   spelling.
// An entry lists its fields; any other field is refused, on a command and on a load. A later
// package adds a field (a face group per triangle) without an upgrade step: a build without it
// refuses the document.
export interface StoredMesh {
  name?: string;
  positions: string;
  triangles: string;
}

// The section of the document: stored meshes by ID. Always present, `{}` when there is none.
// - An ID follows the rules of every ID (not empty, no `/`, not `origin`) and is unique among the
//   meshes; the meshes are a namespace of their own (the mesh `nema17` may be placed by the
//   feature `nema17`).
// - An entry never changes: there is no command that edits one. A new revision of a file is
//   another entry, and the features are pointed at it.
// - Not part of the timeline. A feature of the type `mesh` places an entry as a body; an entry no
//   feature names is stored and does nothing (`MeshResult.usedBy` is empty).
export type Meshes = Record<Id, StoredMesh>;

// A mesh as code reads it.
export interface IndexedMesh {
  positions: Float32Array; // xyz per vertex
  triangles: Uint32Array; // three vertex numbers per triangle
}

export const MESH_LIMITS = {
  // The most triangles of a mesh that an import reads and `addMesh` stores. A provisional number
  // (design.md, "Measured", 5, and "Open", 5) that may be lowered: it keeps a document, a load and
  // a first look at a body within reason. It does not keep a query under a given time: a real
  // collision with a mesh of 38 000 triangles takes 3 to 19 s by its depth, with 105 000
  // triangles 18 to 55 s.
  triangles: 100_000,
  // The most triangles of a stored mesh that a load accepts. Never lowered, so that a document
  // saved under a higher limit of an import still loads; at least `triangles`.
  stored: 100_000,
  // The fewest: a tetrahedron.
  fewest: 4,
  // An import adds a note to its report above this: seconds per real collision with the body, and
  // more the deeper the collision is.
  note: 20_000,
  // A shell encloses something when its mean thickness (twice its volume over its surface) is
  // above this part of its own size (the largest side of its own bounds). A policy, independent
  // of where the shell stands and of the other shells.
  thinnest: 1e-6,
  // The most work of `shellsOf` for one mesh: every entry of the grid of the bounds, every bounds
  // tested, every distance and every solid angle, counted in one fixed order (about 1.5 s at the
  // measured rate); above it the mesh is `tooLarge`. A dense shell around many others reaches it
  // (50 000 triangles around 200 shells). Never lowered: a load checks it.
  work: 10_000_000,
} as const;

// What is wrong with the edges of a mesh that is not closed.
export interface MeshDefects {
  open: number; // edges with one triangle: a hole, or a seam that is not welded
  overused: number; // edges with more than two triangles: two solids that share an edge
  misoriented: number; // edges whose two triangles run the same way: a part is turned over
}

// Why a mesh cannot be stored. The codes are those of a refused import, so the importer passes
// the answer on; `addMesh` and a load refuse the command or the document with the message.
export interface MeshProblem {
  code: 'tooLarge' | 'notASolid';
  message: string;
  defects?: MeshDefects; // when the edges are the reason (check 4)
}

// A piece of the surface: triangles joined through shared edges (as `pieces` of solid.ts and the
// library count them; two pieces that meet in a vertex only are two).
export interface MeshShell {
  triangles: number; // how many
  volume: number; // signed: negative when the shell faces inwards
  area: number;
  // By the winding of the other shells at its test point (check 7; each other shell winds ±1
  // when it contains the point, 0 when not; the kind is by the rounded sum): `solid` (outwards,
  // 0), `hollow` (inwards, 1 or more), `insideOut` (inwards, 0: refused by check 7; the importer
  // turns it over with the shells it contains when no shell contains it), `nested` (outwards, 1
  // or more: in the material of another shell, a hollow written outwards or a part inside a
  // part; read and reported), `undecided` (no test point away from the other shells, or a
  // negative sum: refused).
  kind: 'solid' | 'hollow' | 'insideOut' | 'nested' | 'undecided';
}

// `mesh.ts`: the mesh as numbers. It imports types.ts, util.ts and validation.ts (for
// `CommandError`), and nothing of the recompute, the kernel or the document.
// - `storedMesh` / `indexedMesh`: the two directions of the base64 codec. `indexedMesh` keeps its
//   result by the entry object (a weak map), so an entry is decoded once; it throws `CommandError`
//   for a text that is not canonical base64 of whole triples.
// - `meshDefects`: the count of the edges that are wrong.
// - `withoutWalls`: the wall between two solids written one after the other with the same cut.
//   The importer calls it after the weld and after turning the whole mesh over when its volume is
//   negative; a stored mesh is what is left. A candidate is a pair of triangles on the same three
//   vertices that face opposite ways (a group of more than two triangles on one set of vertices
//   is none); candidates joined through shared edges make a wall. An edge of a wall is a border
//   when a triangle not in the wall has it, inside when only triangles of the wall have it. A
//   wall is left out, with the positions nothing names afterwards, only when it has a border and
//   along every edge of its border there are exactly two other triangles, running the edge
//   opposite ways, one on each side of the wall: the one that runs the edge as the partner of the
//   wall triangle there does lies behind that triangle or in its plane, the other in front of it
//   or in its plane, not both in the plane ("in the plane": within 1e-6 of the largest coordinate
//   of the mesh). Otherwise its pairs stay and the checks refuse the mesh (for its edges; a wall
//   without a border, a closed double sheet, by check 6). `walls` is the number of pairs left out.
// - `meshProblem`: why a mesh cannot be stored; undefined when it can. `limit` is
//   `MESH_LIMITS.triangles` (the default) for an import and `addMesh`, `MESH_LIMITS.stored` for a
//   load. In this order:
//   1. more than `limit` triangles (`tooLarge`); everything below is `notASolid` but the bound
//      of work of check 7; fewer than `MESH_LIMITS.fewest`;
//   2. a coordinate that is not finite or is beyond ±1e9 (the bound of a number of the document);
//   3. an index without a position, a position no triangle names, a triangle that names a vertex
//      twice;
//   4. not closed: every edge has to be in exactly two triangles, once each way (the rule of
//      `isClosed` of the kernel adapter); `defects` has the three counts;
//   5. a volume that is not positive: the triangles face inwards;
//   6. a shell that encloses nothing: its mean thickness is not above `MESH_LIMITS.thinnest` of
//      its own size (a policy; it does not guarantee that the library keeps a thin shell);
//   7. a shell of the kind `insideOut` or `undecided` by `shellsOf` (more work than
//      `MESH_LIMITS.work` is `tooLarge`). Beside a solid an inside-out shell hides a collision.
//   Not checked: that the surface does not pass through itself, that two shells do not overlap.
// - `shellsOf`: the pieces of the surface, each with its kind (`MeshShell.kind`); the one
//   operation of check 7, for the importer, `addMesh` and a load alike. Per shell a test point:
//   the centroid of one of its triangles further than 1e-6 of the size of the shell from every
//   triangle of the other shells summed for it (none: `undecided`). Only the shells whose bounds
//   hold the point are summed (a closed shell winds 0 times outside its bounds), found through a
//   grid of the bounds. Throws a `MeshProblem` with `tooLarge` above `MESH_LIMITS.work`.
export declare function storedMesh(mesh: IndexedMesh, name?: string): StoredMesh;
export declare function indexedMesh(stored: StoredMesh): IndexedMesh;
export declare function meshDefects(mesh: IndexedMesh): MeshDefects;
export declare function withoutWalls(mesh: IndexedMesh): { mesh: IndexedMesh; walls: number };
export declare function meshProblem(mesh: IndexedMesh, limit?: number): MeshProblem | undefined;
export declare function shellsOf(mesh: IndexedMesh): MeshShell[];

// What the description for the AI and the forms read about the section (`SECTION_INFO.meshes`).
export const MESHES_INFO: SectionInfo = {
  title: 'Stored meshes',
  summary:
    'Triangle meshes read from files (the tool import_mesh, or "Import a file" in the app), stored inside the document by ID. A feature of the type `mesh` places one as a body; the same mesh may be placed several times. ' +
    'A stored mesh is a closed solid in millimetres and never changes; `removeMesh` is refused while a feature uses it.',
  commands: ['addMesh', 'removeMesh'],
  fields: [],
};

// ================================================================ the import

// A file as a format reads it: the corners of its triangles in millimetres, nine numbers per
// triangle, in the order of the file; and what the format has to say about the file.
export interface ReadTriangles {
  corners: Float32Array;
  about: Record<string, unknown>; // STL: `{ encoding: 'binary' | 'ascii', unit }`
}

// A file the format cannot read. `read` throws it; `importMesh` answers `unreadable` with its text.
export declare class ImportFailure extends Error {}

// An import format as an entry of the catalog `IMPORT_FORMATS` (import/index.ts), the counterpart
// of an export format: a module in `import/` and one line of the catalog.
export interface ImportFormatSpec<S> {
  title: string;
  summary: string; // what files it reads and what it takes from them; goes to the description for the AI
  extensions: readonly string[]; // without the dot, lower case: how a tool picks the format of a path
  options: S; // described like the options of an export format: checked, described, shown by a form
  read: (bytes: Uint8Array, options: RunArgsOf<S>) => ReadTriangles;
}

// `stl`. An STL file has no unit; the stored mesh is millimetres.
export const STL_IMPORT_OPTIONS = {
  unit: { kind: 'choice', options: ['mm', 'cm', 'm', 'in'], title: 'Unit of the file', summary: 'What one unit of the file is: mm (the default), cm, m or in (25.4 mm). An STL file does not say; the report of the import gives the bounds in millimetres.', optional: true },
} as const satisfies ArgSpecs;
export const UNIT_IN_MM = { mm: 1, cm: 10, m: 1000, in: 25.4 } as const;

// The description of the options of every format, by name. In the code a format adds its line by
// declaration merging in its own module, as an export format does.
export interface ImportFormats {
  stl: typeof STL_IMPORT_OPTIONS;
}
export type ImportFormat = keyof ImportFormats;
export type ImportOptions<F extends ImportFormat> = ArgsOf<ImportFormats[F]>;
export declare const IMPORT_FORMATS: { [F in ImportFormat]: ImportFormatSpec<ImportFormats[F]> };

// The entry `stl` (import/stl.ts).
// - Binary: 80 bytes of header, the number of triangles as a 32-bit unsigned integer, then 50
//   bytes per triangle (a normal, three corners as 32-bit floats, two bytes of attributes), all
//   little-endian. A file is binary when its length is exactly 84 + 50 · that number; the rule
//   comes first, because a binary file may begin with the word `solid`.
// - ASCII: otherwise, when the text begins with `solid` after white space and holds a `vertex`.
//   Every `vertex x y z` is a corner, three to a triangle; several `solid` blocks are read as one
//   mesh. A number that is not finite, or corners that are not whole triangles, are a failure.
// - Anything else is not an STL file (`ImportFailure`; the message gives the length of the file
//   and the length the count would need): a binary file cut short, or one that begins with
//   `solid` and has another length than its count says, ends here.
// - A count above `MESH_LIMITS.triangles` (binary: the number at byte 80; ASCII: the corners
//   read so far) stops the reading: `importMesh` answers `tooLarge` before anything is welded.
// - The normals and the attributes are not read: a triangle faces the way its corners run.
export const STL_TEXTS = {
  title: 'STL',
  summary:
    'A triangle mesh as binary or ASCII STL (told apart by the file itself). The file has to hold a closed solid: every edge shared by exactly two triangles. Its normals are not read, and it has no unit: `unit` says what one unit of the file is (mm by default).',
  extensions: ['stl'],
} as const;

// What an import says about the mesh it read.
export interface MeshReport {
  format: ImportFormat;
  about: Record<string, unknown>; // what the format said about the file
  facets: number; // triangles in the file
  dropped: number; // triangles left out: two of their corners are at one position
  walls: number; // pairs of triangles left out: the same three vertices, facing opposite ways (the wall between two solids of the file)
  vertices: number;
  triangles: number;
  shells: number; // connected pieces of the surface
  cavities: number; // of them, hollows: pieces that face inwards inside another piece
  insideOut: boolean; // the whole mesh was inside out and was turned over first (step 3 of importMesh)
  turned: number; // distinct shells turned over by groups after that (step 4)
  nested: number; // outward shells in the material of others (a hollow written outwards, or an overlap); read
  volume: number; // mm³; an overlap of two shells counts twice
  bounds: { min: Vec3; max: Vec3 }; // mm, in the frame of the file
  // In words, for the caller to read: more than one shell (shells that overlap are counted twice
  // in the volume and in a collision with them, and are found only at one point of each); shells
  // nested in material; shells turned over; more than
  // `MESH_LIMITS.note` triangles (a real collision with the body takes seconds, more the deeper
  // it is); bounds below 1 mm or above 10 m (is `unit` right?).
  notes: string[];
}

// - `invalidArguments`: no such format, or an option of the wrong shape (`arg` names it).
// - `unreadable`: the bytes are not a file of the format.
// - `notASolid`: the triangles do not close a solid (`meshProblem`, checks 1 to 7); `defects` has
//   the counts when the edges are the reason.
// - `tooLarge`: more than `MESH_LIMITS.triangles` triangles (the message says how many; decided
//   from the count of the file, before the weld), or more work than the bound of check 7.
export type ImportOutcome =
  | { ok: true; mesh: StoredMesh; report: MeshReport }
  | { ok: false; error: { code: 'invalidArguments' | 'unreadable' | 'notASolid' | 'tooLarge'; message: string; arg?: ArgPath; defects?: MeshDefects } };

// Reads a file into a stored mesh. A function of the engine without a state: it needs no document,
// and the mesh enters one by the command `addMesh`.
// 1. The options are checked against the description of the format and the format reads the bytes.
// 2. The weld: corners at the same float32 position (−0 taken as 0) become one vertex. Triangles
//    that lose a corner by it are left out and counted (`dropped`). No tolerance.
// 3. A negative volume turns the whole mesh over (the pairs of the walls cancel in it), then
//    `withoutWalls` (`walls`).
// 4. When the mesh is closed: `shellsOf`; every outermost shell (no other contains its test
//    point) of the kind `insideOut` is turned over together with the shells it contains
//    (`turned` counts the distinct shells); then `shellsOf` again, whose kinds the report
//    (`cavities`, `nested`) and the checks take.
// 5. `meshProblem` with `MESH_LIMITS.triangles`, whose code and message are the refusal.
// 6. The report, and the mesh in its stored form with `name`.
// The same bytes and options give the same mesh.
export declare function importMesh<F extends ImportFormat>(format: F, bytes: Uint8Array, options?: ImportOptions<F>, name?: string): ImportOutcome;

// ================================================================ the placement

// A directed frame of the model: a plane as a sketch refers to one, or a point of a sketch.
// - a base plane: XY is (+X, +Y, +Z), XZ is (+X, +Z, −Y), YZ is (+Y, +Z, +X);
// - a plane feature: its frame;
// - a planar face of a body: the frame a sketch on that face has (the normal points out of the
//   body);
// - `sketchPoint`: the frame of the sketch, moved to the point: an own point, `origin`, or a point
//   of projected geometry, as for an axis (`AxisRef`). Its normal is that of the sketch plane.
// (In the code a `PlaneRef` names any face, the one of an imported mesh included; the draft says
// so with `PlaneRefAfter3b`, declared with the document after the package. A frame on such a face
// is `nonPlanarFace`.)
export type FrameRef = PlaneRefAfter3b | { kind: 'sketchPoint'; sketch: Id; point: Id };

// Where a part that has a frame of its own (an imported mesh; an inserted part of 3c) stands:
// its origin and axes laid on `frame`, then turned and shifted in that frame.
// - `x`, `y`, `z` (mm): the offset of the origin of the part along the X axis, the Y axis and the
//   normal of the frame.
// - `rx`, `ry`, `rz` (rad, each within ±2π): turns about the X axis, the Y axis and the normal of
//   the frame, in this order, the axes staying where they are, by the right-hand rule. (The roll,
//   pitch and yaw of a robot description, `rpy` of URDF.)
// - A point p of the part ends at  O + B · (Rz(rz) · Ry(ry) · Rx(rx) · p + (x, y, z)),  with O the
//   origin of the frame and B its axes (X, Y, normal) as columns.
// - The six numbers are numeric fields (`placement/x` … `placement/rz`) and optional: absent
//   means 0 and is not stored; `setField` reaches one the feature does not have, a patch removes
//   one with `null`.
// - The frame is right-handed, so a placement never mirrors, and it has no scale.
export interface BodyPlacement {
  frame: FrameRef;
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
}
const OFFSET = { unit: 'mm', default: 0 } as const;
const TURN = { unit: 'rad', min: { value: -2 * Math.PI }, max: { value: 2 * Math.PI }, default: 0 } as const;
export const PLACEMENT_FIELDS = [
  { path: 'placement/x', spec: { title: 'Offset along X', ...OFFSET } },
  { path: 'placement/y', spec: { title: 'Offset along Y', ...OFFSET } },
  { path: 'placement/z', spec: { title: 'Offset along the normal', ...OFFSET } },
  { path: 'placement/rx', spec: { title: 'Turn about X', ...TURN } },
  { path: 'placement/ry', spec: { title: 'Turn about Y', ...TURN } },
  { path: 'placement/rz', spec: { title: 'Turn about the normal', ...TURN } },
] as const satisfies readonly FieldSpec[];

// `recompute/placement.ts`. Not tied to a mesh; 3c uses both.
// - `frameOf`: the frame of a reference in a state, or the code the recompute gives for it
//   (`brokenReference`: the plane, the body, the face, the sketch or the point is not in the
//   state; `nonPlanarFace`).
// - `placementTransform`: takes the part from its own frame into the model.
export declare function frameOf(ref: FrameRef, state: State): Frame | 'brokenReference' | 'nonPlanarFace';
export declare function placementTransform(placement: BodyPlacement, frame: Frame): RigidTransform;

// ================================================================ the feature

// A stored mesh placed as a body.
// - `mesh`: a key of the section `meshes`. A command that sets it checks that the section has it
//   (`addFeature`; `updateFeature` only when it is another one than before); a load checks its
//   form only, and a mesh that is not there is the error `brokenReference` of the feature, with
//   `refs: [{ mesh: <id> }]`.
// - The body has the ID of the feature and one face, `{ feature, role: 'mesh' }` (see
//   `MeshFaceName`). It is not a reference part by itself: the batch that adds the feature also
//   sets `use: 'reference'` (and a `mass`) with setBodyProperties, for a bought part.
// - The entry of the registry: `createsBody` and `namesFaces` are true, `producesTool` is false;
//   `refs` are those of the frame (a plane; a body and its face; a sketch and its point) and the
//   mesh (the kind `mesh`); `patch.fields` are `mesh` and `placement`, and `patch.removable`
//   answers for the six numbers of the placement.
// - `facts` of the result: `origin`, `axisX`, `axisY`, `axisZ`: where the origin of the mesh is in
//   the model and where its three axes point (unit vectors).
// - Errors: `brokenReference` (the mesh; the frame), `nonPlanarFace` (the frame is a face that is
//   not planar), `invalidExpression` (a field of the placement).
// - No feature changes the body: see `importedTarget`.
export interface MeshFeature extends FeatureBase {
  type: 'mesh';
  mesh: Id;
  placement: BodyPlacement;
}
// What `updateFeature` takes for it: `mesh` replaces the reference; `placement` merges field by
// field, its `frame` is a reference and is replaced whole.
export type MeshPatch = Patch<Pick<MeshFeature, 'mesh' | 'placement'>>;

export const MESH_FEATURE_TEXTS = {
  title: 'Mesh',
  summary:
    'A stored mesh (the section `meshes`) placed as a body: a bought or given part to design around. `placement` lays the origin and the axes of the mesh on a frame (a base plane, a plane feature, a planar face, or a sketch point: the frame of its sketch moved to the point), turned by rx, ry, rz about the X axis, the Y axis and the normal of the frame and shifted by x, y, z in it. ' +
    'The body has the ID of the feature and one face without edges: no sketch stands on it, nothing of it is projected, and no extrusion or hole may have it as a target. It takes part in the collisions, the gap, the mass and the exports like any body.',
} as const;

// The face of an imported body: one for the whole surface. One more member of `FaceName`, with
// the copy tags of a pattern like every face; the catalog `FACE_ROLES` gets
// `mesh: { title: 'surface of an imported mesh', parts: {} }`.
// - Its surface is published as `{ kind: 'general' }`. Internally (`FaceInfo` in solid.ts) it is
//   a kind of its own, `{ planar: false; surface: 'mesh' }`: a surface about which nothing is
//   known, flat regions included. `surfaceOf` and `transformFace` of solid.ts get a branch for it
//   (`general`; unchanged by a transform, a mirror included).
// - `measure` takes it as an entity and answers with the smallest distance on the mesh.
// - A sketch or a plane on it is `nonPlanarFace`; the body has no edges.
export type MeshFaceName = { feature: Id; role: 'mesh'; copy?: CopyTag[] };
export type FaceNameAfter3b = FaceName | MeshFaceName;

// One member is added to the registry entry of a feature type (`FeatureModule` in
// features/module.ts) and one to what a step gets (`StepContext` in recompute/state.ts).
// - `input`: the object of the document, outside the feature, that the step of the feature reads:
//   for a mesh feature the entry of the section (`doc.meshes[f.mesh]`), undefined when it is not
//   there. A module reads the document nowhere else.
// - The recompute hands that object to the step as `StepContext.input` and uses a remembered step
//   only when it was computed from the same object (by identity), besides the feature and the
//   state before it. `rehang` keeps the input with the step it re-hangs.
export interface FeatureModuleAddition<F extends FeatureBase> {
  input?(f: F, doc: DocumentAfter3b): object | undefined;
}
export interface StepContextAddition {
  input?: object;
}

// One kind is added to the references of a feature (`RefKind` in validation.ts): `mesh`, a stored
// mesh of the section. `requireRef` checks that the section has the entry; `featureRefs` leaves
// the kind out, because it names no feature and takes no part in the order on the timeline;
// `REF_LABEL` gets its words ("stored mesh").
export type RefKindAddition = 'mesh';

// ================================================================ the issue code

// `importedTarget`, an error of a feature that applies a tool (an extrusion with the operation
// add or cut, a hole, a pattern of them): one of its targets is an imported body, that is, has
// a face of an imported mesh (the body of a mesh feature, or a copy of it made by a pattern).
// `refs` name those targets. No target is changed. The check is in `applyTool`.
// Why: the kernel keeps its guarantee for flush faces only for faces it knows as planar, and
// a flat region of an imported mesh is not one (design.md, "A feature does not change an imported
// body").
export type ErrorCodeAfter3b = ErrorCode | 'importedTarget';

// ================================================================ the commands

// - addMesh: adds a stored mesh under `id`. The mesh is checked in full (`meshProblem` with
//   `MESH_LIMITS.triangles`; a load checks with `MESH_LIMITS.stored`); an ID the section already
//   has is an invalid command.
// - removeMesh: removes the entry. Refused while a feature of the document names the mesh
//   (suppressed or not; the message lists the features): remove or re-point them first, in the
//   same batch.
export type MeshCommand = { type: 'addMesh'; id: Id; mesh: StoredMesh } | { type: 'removeMesh'; id: Id };

// ================================================================ the result

// What the recompute says about a stored mesh, without its data: `evaluation.meshes[id]`. Computed
// once per entry object, except `usedBy`.
export interface MeshResult {
  name?: string;
  vertices: number;
  triangles: number;
  bounds: { min: Vec3; max: Vec3 }; // mm, in the frame of the mesh
  volume: number; // mm³; an overlap of two shells counts twice
  shells: number;
  usedBy: Id[]; // the features that place it, in the order of the timeline; suppressed ones included
}

// ================================================================ the schema

// The upgrade step of the section. It reads and changes only `meshes`: a document without the
// field gets the empty section; a field that is there, whatever it holds, is left to the
// validation. A build without the step would drop the section on load without a word.
export const MESH_IMPORT_STEP: UpgradeStep = { name: '3b-mesh-import', run: (o) => ('meshes' in o ? o : { ...o, meshes: {} }) };

// ================================================================ the document and the engine after the package

// A plane or a sketch may name the face of an imported body; it then ends in `nonPlanarFace`.
export type PlaneRefAfter3b = Exclude<PlaneRef, { kind: 'face' }> | { kind: 'face'; body: Id; face: FaceNameAfter3b };
export type PlaneFeatureAfter3b = Omit<PlaneFeature, 'base'> & { base: PlaneRefAfter3b };

// The draft widens the face name where calls.ts needs it: in a frame, in the base of a plane
// feature, in the names of the result. In the code `FaceName` is one union, so every place that
// takes or gives a face name has the new member: the plane of a sketch, an extent up to a face,
// the arguments and the answers of the queries (`QueryArgs` and `QueryResult` here are those of
// master and still say `FaceName`).
export type FeatureAfter3b = Exclude<Feature, PlaneFeature> | PlaneFeatureAfter3b | MeshFeature;
export interface DocumentAfter3b extends Omit<Document, 'features'> {
  features: FeatureAfter3b[];
  meshes: Meshes;
}
export interface EvaluationAfter3b extends Omit<Evaluation, 'faceNames'> {
  faceNames: FaceNameAfter3b[];
  meshes: Record<Id, MeshResult>;
}
export interface EngineStateAfter3b {
  document: DocumentAfter3b;
  evaluation: EvaluationAfter3b;
  canUndo: boolean;
  canRedo: boolean;
}
export type CommandAfter3b =
  | Exclude<Command, { type: 'batch' }>
  | MeshCommand
  | { type: 'addFeature'; feature: Input<MeshFeature> | Input<PlaneFeatureAfter3b>; index?: number }
  | { type: 'updateFeature'; id: Id; patch: MeshPatch }
  | { type: 'batch'; commands: CommandAfter3b[] };
export type CommandResultAfter3b = { ok: true; state: EngineStateAfter3b } | Extract<CommandResult, { ok: false }>;
export type QueryOptionsAfter3b = ({ at?: Id; state?: never } | { state: EngineStateAfter3b; at?: never }) & { geometry?: 'modelled' };

// `Engine` of master with the document of this package. No method is added: the import is the
// function `importMesh`, and the mesh enters the document by a command.
export interface EngineAfter3b extends Omit<Engine, 'execute' | 'preview' | 'getState' | 'load' | 'query' | 'export'> {
  execute(cmd: CommandAfter3b): CommandResultAfter3b;
  preview(cmd: CommandAfter3b, at?: Id): CommandResultAfter3b;
  getState(at?: Id): EngineStateAfter3b;
  load(json: string): CommandResultAfter3b;
  query<N extends QueryName>(name: N, args: QueryArgs<N>, options?: QueryOptionsAfter3b): QueryOutcome<QueryResult<N>>;
  export<F extends ExportFormat>(format: F, options: ExportOptions<F>, queryOptions?: QueryOptionsAfter3b): QueryOutcome<Exported>;
}

// ================================================================ MCP

// The tool `import_mesh` of the server (server.ts, next to `open_document`): it reads the file,
// calls `importMesh` and sends `addMesh` through `execute` to the engine the other tools use.
// - `path`: the file. `format`: a key of `IMPORT_FORMATS`; without it the extension of the path
//   decides. `options`: those of the format.
// - `id`: the ID of the stored mesh; without it the name of the file without its extension,
//   reduced to letters, digits and underscores (`mesh` when that is no ID by the rule of `newId`
//   of validation.ts: empty, `origin`, or a property every object has, such as `constructor` or
//   `__proto__`), with `_2`, `_3`, … when the section has it: the tool reads the stored meshes of
//   the engine the other tools use (`get_model`) before it sends the command.
// - `name`: the name of the stored mesh; without it the name of the file.
export interface ImportMeshArgs {
  path: string;
  format?: ImportFormat;
  options?: Record<string, unknown>;
  id?: Id;
  name?: string;
}
// The answer: the mesh that was stored, the report of the import, and the command that places it
// written out for the caller to change and send (`execute`): a batch of `addFeature` with a mesh
// feature on the base plane XY and `setBodyProperties` with `use: 'reference'`. The command has
// no `mass` (neither the file nor the tool knows it); `say` tells the caller to add the mass of
// the data sheet.
// A refusal of the import is the error of the tool: the message, with the counts of `defects`.
export interface ImportMeshAnswer {
  mesh: Id;
  file: string;
  report: MeshReport;
  next: { say: string; command: CommandAfter3b };
}

// `get_document` prints a stored mesh without its two texts.
export type StoredMeshShown = Omit<StoredMesh, 'positions' | 'triangles'> & { omitted: string }; // "positions and triangles: 2 519 004 characters of base64; save_document writes them"

// What `get_model` adds when the section has entries.
export interface MeshSummary {
  id: Id;
  name?: string;
  triangles: number;
  size: Vec3; // of the bounds, mm
  usedBy: Id[];
}
