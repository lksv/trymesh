// Contract of the preparatory step of D36, parts 1 (registry of queries) and 4 (shared vocabulary).
// A draft for review, not code that runs: it is only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the engine and states what
// is added or changed. Parts 2 and 3 (a module per feature type, panels of the app) change no
// public type and have no contract; their design is in part2-feature-modules.md and design.md.
//
// Third version, after two rounds of reviews (design.md, "Reviews").
//
// Where the types will live: what a caller of the engine or an AI reads goes to `types.ts`
// (`Surface`, `EntityRef`, `QueryOutcome`, the additions to `Evaluation` and `Engine`), because
// the description for the AI is cut out of the raw text of that file. The machinery (`ArgKind`,
// `ValueOf`, `ArgsOf`, `QuerySpec`, the registries) goes to modules of its own, so that it does
// not reach that description.

import type { AxisRef, BodyResult, Command, CommandResult, ConstraintExplanation, EdgeName, Engine, EngineState, Evaluation, FaceName, Frame, Id, InterferenceReport, NumberSpec, PlaneRef, SketchDiagnosis, SolidKernel, Unit, Vec3 } from '../../../packages/engine/src/index';
// Internal to the engine, not exported from its index: what the recompute keeps about a sketch.
import type { SketchState } from '../../../packages/engine/src/evaluate';

// ================================================================ shared vocabulary

// ---------------------------------------------------------------- units

// `Unit` in catalog.ts is `mm | rad | count | none`. A threshold of the interference query is
// a volume already, and density, mass and area follow. `Unit` grows to this; a numeric field of
// the document and an argument of a query use the same description.
export type QuantityUnit = Unit | 'mm2' | 'mm3' | 'g' | 'g/cm3';
export type QuantitySpec = Omit<NumberSpec, 'unit'> & { unit: QuantityUnit };

// ---------------------------------------------------------------- surfaces of faces

// What a face is, exactly. The engine has this as `FaceInfo` in solid.ts (a plane, a cylinder,
// a swept surface) and publishes only `planar`. `FaceInfo` stays internal and keeps what only the
// engine needs (the `y` direction of a planar face, from which the frame of a sketch on the face
// is built); it gets the two new kinds. `Surface` is what is published, derived from it.
//
// kind      | a sketch can stand on it | comes from
// plane     | yes                      | caps, sides from lines
// cylinder  | no                       | sides from arcs and circles
// cone      | no                       | taper of a circle, countersink, revolve of a line
// swept     | no                       | gear teeth, a spline side
// general   | no                       | revolve of an arc, twist, fillet of a circular edge
//
// A surface has no side: `normal` of a plane and `axis` of a cylinder carry no sign. Which side
// the material is on belongs to the face of a body (BodyFace). The one exception is `axis` of
// a cone, which points from the apex towards the face, because a cone has two halves.
// Directions that do have a sign are frames (`Frame`): the frame of a face has its normal
// pointing out of the body, and the base planes have fixed normals (XZ: -Y).
export type Surface =
  | { kind: 'plane'; origin: Vec3; normal: Vec3 }
  | { kind: 'cylinder'; origin: Vec3; axis: Vec3; radius: number } // origin: a point of the axis
  | { kind: 'cone'; apex: Vec3; axis: Vec3; halfAngle: number } // radians, between the axis and the surface
  | { kind: 'swept'; axis: Vec3 } // a planar curve moved along `axis`
  | { kind: 'general'; revolvedAbout?: { origin: Vec3; axis: Vec3 } }; // set when the surface is one of revolution

// The evaluation publishes the surfaces next to the names of the faces: the field is added to
// `Evaluation` itself, so every state the engine returns has it. The draft cannot change the real
// interface (the real engine is type-checked with it), so it writes the evaluation and the state
// after the step as types of their own, and `EngineAfter` below returns them.
export interface EvaluationAfter extends Evaluation {
  faceSurfaces: Surface[]; // index = number of the face, like `faceNames`
}
export interface StateAfter extends EngineState {
  evaluation: EvaluationAfter;
}
export type CommandResultAfter = { ok: true; state: StateAfter } | Extract<CommandResult, { ok: false }>;
// One place outside the engine builds an evaluation by hand: `stateBefore(0)` in the app, the
// state before the first feature (the current evaluation with `features`, `bodies` and
// `faceNames` emptied). It empties `faceSurfaces` as well. Such a state is not one the engine
// handed out, so `query` refuses it (QueryOptions); the app asks nothing in that mode today.

// Kinds of edges (`EdgeKind` keeps its four values). The rule for `circle` today is "a plane and
// a cylinder". It becomes: the two faces are two different surfaces of revolution about the same
// axis, where a plane across the axis counts as one, and the edge is not at the apex of a cone.
// - That covers the mouth of a countersink (a plane and the cone) and its lower rim (the cone
//   and the cylinder of the hole).
// - Two faces of the same surface are not a circle: a circle drawn as two arcs gives two
//   cylindrical faces with one axis and one radius, and their seam is straight (`other`, as today).
// - A general surface takes part only when it says what it is revolved about.
// `projectEdge` in solid.ts assumes a plane and a cylinder and changes with the rule.

// ---------------------------------------------------------------- roles of faces

// A face is named by the feature that made it and its role there. The roles are a closed union in
// types.ts (`side` with the curve it came from, `startCap`, `endCap`), and five more places spell
// them out: the validator `faceName` (document.ts), `faceKey` (util.ts, and a copy of it in the
// app), `faceLabel` of the MCP tools and the texts `ROLES` of the app. A hole, a revolve,
// a chamfer, a fillet and a split all name faces in new roles.
// - The union stays in types.ts, one member per role, because it is what an AI reads.
// - The rest reads a catalog. An entry says how the role is called and which field of the name
//   tells apart the faces of that role within one feature (`curve` for `side`; none for a cap).
//   The validator, the key and the labels are built from it, so a package adds one member to the
//   union and one entry here. The compiler ties the two: a role without an entry, or an entry
//   that names a field the member does not have, does not compile.
// - The key of a face (`<feature>/<role>[/<part>]`) is used in fingerprints of solved sketches
//   and in the face table; it keeps its form for the three roles of today.
type FacePart<R extends FaceName['role']> = Exclude<keyof Extract<FaceName, { role: R }>, 'feature' | 'role' | 'copy'>;
export type FaceRoleSpec<R extends FaceName['role']> = { title: string } & ([FacePart<R>] extends [never] ? { part?: never } : { part: FacePart<R> });
export declare const FACE_ROLES: { [R in FaceName['role']]: FaceRoleSpec<R> };

// ---------------------------------------------------------------- references to named entities

// One way to say "this thing of the model" in the arguments of a query. A query that takes
// a plane or an axis takes `PlaneRef` or `AxisRef` as they are (the argument kinds `plane` and
// `axis`), not wrapped.
export type EntityRef =
  | { kind: 'body'; body: Id }
  | { kind: 'face'; body: Id; face: FaceName }
  | { kind: 'edge'; body: Id; edge: EdgeName }
  | { kind: 'sketchPoint'; sketch: Id; point: Id }; // `origin` is the origin of the sketch

// ---------------------------------------------------------------- placement of a body

// Not in this contract. The first draft had a frame taken from a plane, three offsets and a turn
// about its normal; the reviews showed that it cannot turn a part upside down or tilt it. The
// package that needs a placement first (3b, import of a mesh, or 5a if the links of a mechanism
// need one) designs it, with these requirements: any orientation relative to a directed frame
// (three rotations in a stated order, or an equivalent), every number a numeric field with an
// expression, and a result that is a `RigidTransform`. `Placement` in evaluate.ts is the name
// of something else already.

// ---------------------------------------------------------------- data catalogs

// A table of data the engine carries (hardware, materials, threads). The rule is decided in D36:
// a catalog fills fields, the document stores the numbers.
// - Every catalog has its own columns; a kind of part with other columns is another catalog.
// - Code reads `DATA_CATALOGS` directly and gets the row type of the catalog it names; a column
//   that does not exist does not compile.
// - An untyped caller (MCP) uses the query `catalog`. The description for the AI lists the
//   catalogs by name and summary only, so it does not grow with the tables.
export interface DataCatalog<Row extends { [K in keyof Row]: number | string }> {
  title: string;
  summary: string;
  source: string; // the standard or the data sheet the rows come from; "typical values" when there is none
  columns: { [K in keyof Row]: { title: string; unit: QuantityUnit | 'text' } };
  rows: Record<string, Row>; // by key, such as "M3"
}
// The row type of every catalog by name; a package adds its catalog by declaration merging.
export interface Catalogs {}
export declare const DATA_CATALOGS: { [N in keyof Catalogs]: Catalogs[N] extends { [K in keyof Catalogs[N]]: number | string } ? DataCatalog<Catalogs[N]> : never };

// ---------------------------------------------------------------- version of the document schema

// Today `SCHEMA_VERSION` is a constant and `upgrade` one function from version 1. It becomes
// a list with one step per version; the current version is the length of the list plus one.
// - A branch of a package appends its step. Version numbers exist only on `master`: the number
//   of a step is fixed when its branch is merged.
// - Until then a build of the branch marks what it saves: the document carries the name of the
//   branch (`schemaBranch`), and a build with another name, `master` included, refuses it. The
//   merge removes the mark. Without it two branches would both write "version 3" and `master`
//   would load either as its own.
// - The runner checks the version of the document it gets, applies the steps from there, stamps
//   the result and refuses a version it does not know, a newer one included.
// - A new feature type needs no step: a step is for a change of the shape of what older
//   documents hold.
export type UpgradeStep = (document: Record<string, unknown>) => Record<string, unknown>;
export declare const UPGRADES: readonly UpgradeStep[];
export declare const SCHEMA_BRANCH: string | undefined; // set on a branch that appended a step

// ================================================================ registry of queries

// ---------------------------------------------------------------- arguments

// The arguments of a query are named, and each is described: the checks, the input schema of the
// MCP tool and a form in the app come from the description. A value may have structure; the
// description is still data.
// - `list`: values of one kind, with an optional least and greatest count.
// - `oneOf`: exactly one of the named alternatives, written as an object with that one key:
//   `{ up: [0, 0, 1] }` or `{ onBed: { kind: 'face', ... } }`.
// - `record`: values by ID or name, such as joint values of a pose.
// - `fields`: named values of different kinds, for an element of a list or an alternative that
//   is more than one value (an orientation with a spin, a pair to measure).
// A description is written `as const satisfies ArgSpecs`; without `as const` the options of
// a choice and the accepted kinds of an entity widen to `string` and the derived type with them.
export type ArgKind =
  | { kind: 'number'; spec: QuantitySpec } // unit and range as for a numeric field
  | { kind: 'flag' }
  | { kind: 'text' }
  | { kind: 'choice'; options: readonly string[] }
  | { kind: 'body' | 'feature' | 'sketch' } // an ID of that kind
  | { kind: 'constraint'; of: string } // a constraint of the sketch named by the argument `of`
  | { kind: 'entity'; accepts: readonly EntityRef['kind'][] }
  | { kind: 'plane' } // PlaneRef
  | { kind: 'axis' } // AxisRef
  | { kind: 'vector' } // three numbers
  | { kind: 'list'; of: ArgKind; min?: number; max?: number }
  | { kind: 'oneOf'; options: { readonly [name: string]: ArgKind } }
  | { kind: 'record'; of: ArgKind }
  | { kind: 'fields'; fields: { readonly [name: string]: ArgKind & { optional?: boolean } } };
export type ArgSpec = ArgKind & { title: string; summary?: string; optional?: boolean };
export type ArgSpecs = { readonly [name: string]: ArgSpec };

// The type of the arguments follows from their description, so the two cannot disagree. (The
// first draft wrote both by hand and tied only the names; a list of bodies described as a flag
// compiled.) `ValueOf` works on an exact description; applied to `ArgKind` itself it does not
// terminate, so code that handles any description (the checker, a generated form) treats values
// as unknown.
export type ValueOf<K> = K extends { kind: 'number' }
  ? number
  : K extends { kind: 'flag' }
    ? boolean
    : K extends { kind: 'text' }
      ? string
      : K extends { kind: 'choice'; options: readonly (infer O)[] }
        ? O
        : K extends { kind: 'body' | 'feature' | 'sketch' | 'constraint' }
          ? Id
          : K extends { kind: 'entity'; accepts: readonly (infer A)[] }
            ? Extract<EntityRef, { kind: A }>
            : K extends { kind: 'plane' }
              ? PlaneRef
              : K extends { kind: 'axis' }
                ? AxisRef
                : K extends { kind: 'vector' }
                  ? Vec3
                  : K extends { kind: 'list'; of: infer E }
                    ? ValueOf<E>[]
                    : K extends { kind: 'oneOf'; options: infer O }
                      ? { [P in keyof O]: { -readonly [Q in P]: ValueOf<O[P]> } & { [Q in Exclude<keyof O, P>]?: never } }[keyof O]
                      : K extends { kind: 'record'; of: infer E }
                        ? Record<string, ValueOf<E>>
                        : K extends { kind: 'fields'; fields: infer F }
                          ? ArgsOf<F>
                          : never;
type OptionalKeys<S> = { [K in keyof S]: S[K] extends { optional: true } ? K : never }[keyof S];
// What a caller passes: an optional argument may be left out.
export type ArgsOf<S> = { -readonly [K in Exclude<keyof S, OptionalKeys<S>>]: ValueOf<S[K]> } & { -readonly [K in OptionalKeys<S>]?: ValueOf<S[K]> };
// What `run` receives: the engine has filled in the default of an optional number that has one.
type DefaultedKeys<S> = { [K in keyof S]: S[K] extends { optional: true; spec: { default: number } } ? K : never }[keyof S];
export type RunArgsOf<S> = { -readonly [K in Exclude<keyof S, OptionalKeys<S>> | DefaultedKeys<S>]: ValueOf<S[K]> } & { -readonly [K in Exclude<OptionalKeys<S>, DefaultedKeys<S>>]?: ValueOf<S[K]> };

// ---------------------------------------------------------------- an entry

// What a query computes from. It answers for one state: the document and the evaluation in
// `state`, and what the recompute knew beyond them. The engine keeps, for every state it hands
// out (execute, preview, getState), the internal state it came from, by the identity of the
// evaluation; a query never recomputes the document. A drag preview is therefore diagnosed as
// dragged, and expressions and failed projections are as the recompute saw them.
export interface QueryContext {
  state: StateAfter;
  // The bodies the query answers about. A query reads bodies here and never from
  // `state.evaluation.bodies`: with a mechanism (step 5) these are the bodies in the asked pose,
  // while the evaluation keeps them where they were modelled.
  bodies: Readonly<Record<Id, BodyResult>>;
  frame(ref: PlaneRef): Frame | undefined; // directed: for a face the normal points out of the body
  axis(ref: AxisRef): { origin: Vec3; direction: Vec3 } | undefined;
  // The number of a named face, the index into `faceNames` and `faceSurfaces` and the number the
  // edges of a body carry. The recompute has the table (`State.faceIds`); without it a query
  // would scan `faceNames`.
  face(name: FaceName): number | undefined;
  // What the recompute kept about a sketch (solver input with the positions used, how the solve
  // ended, the analysis of freedom). Undefined: the sketch did not evaluate. `SketchState` stays
  // internal to the engine: query modules are engine modules, and no caller of the engine sees
  // a context.
  sketch(sketch: Id): SketchState | undefined;
  // An exception of the kernel inside a query becomes the answer `failed` (the port says that
  // `boolean` throws when the result is not a closed body).
  kernel: SolidKernel;
  // Results kept for as long as all `owners` live: the same question about the same things is
  // not computed twice.
  // - Name every object the answer depends on: both solids for a pair of bodies (as the cache of
  //   `interference` does today), the object of a section of the document for an answer that
  //   reads it. A body ID in `key` is not enough: the body behind an ID changes.
  // - Owners that live across recomputes: a `Solid`, a solved sketch, the document, a section or
  //   a feature of it. `state`, `state.evaluation` and the map of bodies are new objects on every
  //   recompute and never hit.
  // - At least one owner. Keys of different queries do not meet: the engine keeps them apart.
  memo<T>(owners: readonly [object, ...object[]], key: string, compute: () => T): T;
}
export interface QuerySpec<S, Result> {
  title: string;
  summary: string; // what it is for; goes to the description for the AI
  returns: string; // what the answer holds and in which units; goes there as well
  args: S;
  // A property, not a method, so that its parameter is checked strictly against the map below.
  // A query that builds on another calls its `run` with the same context.
  run: (context: QueryContext, args: RunArgsOf<S>) => Result;
}

// The description of the arguments and the result of every query, by name. A query module adds
// its line by declaration merging, so adding a query does not edit a shared type:
//   declare module '.../00-prep/contract' { interface Queries { gap: { spec: typeof gapArgs; result: GapResult } } }
export interface Queries {
  interference: {
    spec: {
      bodies: { kind: 'list'; of: { kind: 'body' }; title: string; optional: true };
      threshold: { kind: 'number'; spec: QuantitySpec; title: string; optional: true }; // mm3
    };
    result: InterferenceReport;
  };
  sketchDiagnosis: { spec: { sketch: { kind: 'sketch'; title: string } }; result: SketchDiagnosis };
  constraintExplanation: { spec: { sketch: { kind: 'sketch'; title: string }; constraint: { kind: 'constraint'; of: 'sketch'; title: string } }; result: ConstraintExplanation };
  body: { spec: { body: { kind: 'body'; title: string } }; result: BodyDescription };
  catalog: { spec: { name: { kind: 'text'; title: string }; key: { kind: 'text'; title: string; optional: true } }; result: DataCatalog<Record<string, number | string>> };
}
export type QueryName = keyof Queries;
export type QueryArgs<N extends QueryName> = ArgsOf<Queries[N]['spec']>;
export type QueryResult<N extends QueryName> = Queries[N]['result'];

// The catalog itself: an object with one entry per name, like `CONSTRAINTS` and `GENERATORS`.
// A test checks what types cannot: that every description is a valid `ArgSpecs` and that `of`
// of a constraint names an argument of the kind `sketch`.
export declare const QUERIES: { [N in QueryName]: QuerySpec<Queries[N]['spec'], QueryResult<N>> };

// ---------------------------------------------------------------- the answer

// A query does not throw for anything its caller can cause; it answers with a result or with
// a reason, like a command.
// - Before `run`, the engine checks every argument against its description: shape, range, and
//   that what is named exists. The engine fills in defaults. An error from here names the
//   argument.
//   - A body, or the body, face, edge or point of an entity, is looked up in the state asked
//     about (`context.bodies`, the sketch as evaluated).
//   - A sketch, a feature or a constraint is looked up in the document, so a sketch that did not
//     evaluate is still a valid argument. One that the document has but that comes after `at` is
//     `notAvailable`; one the document does not have is `invalidArguments`.
//   - A plane or an axis is checked for shape only: whether it resolves is known to
//     `context.frame` and `context.axis`, and `run` reports it with `QueryFailure` and the name
//     of the argument.
// - `run` throws `QueryFailure` for what only the computation finds out.
// - An exception of another kind inside `run` is a defect and passes through, as it does for
//   commands (`invalid` in engine.ts).
// What was a successful answer stays one: a sketch that did not evaluate has the diagnosis
// `status: 'unavailable'`, a list of fewer than two bodies has no collisions (`checked: 0`).
export type QueryOutcome<Result> =
  | { ok: true; result: Result }
  | {
      ok: false;
      error: {
        // invalidArguments: an argument fails its description; `at` names no feature; `state` is not a state of this engine
        // notAvailable: the thing asked about does not exist in this state: a body, or a sketch that comes after `at`
        // failed: the computation gave up (the kernel, a limit)
        code: 'invalidArguments' | 'notAvailable' | 'failed';
        message: string;
        arg?: string; // the argument concerned; `at` and `state` for the options
      };
    };
export declare class QueryFailure extends Error {
  constructor(code: 'notAvailable' | 'failed', message: string, arg?: string);
}

// An answer that can be large says so. A query with such an answer has an argument that limits
// it and returns how much there was; it never returns an unbounded list. The engine is
// synchronous and has no cancellation: a query that can be slow bounds its work by its
// arguments and says so in its summary.
export interface Truncated {
  truncated?: { shown: number; total: number };
}

// ---------------------------------------------------------------- the engine

// The state a query answers for: the current one, the one after a feature, or one that `preview`
// of this engine returned. With a previewed state nothing is written, so a parameter can be
// stepped and each step asked about (the pose sweep of step 5).
// A state this engine did not hand out (one put together by a caller, one of another engine) is
// refused with `invalidArguments`.
export type QueryOptions = { at?: Id; state?: never } | { state: EngineState; at?: never };

// `query` and `export` are added. The four methods they cover (`diagnoseSketch`,
// `explainConstraint`, `interference`, `exportMesh`) stay as they are and become thin callers of
// the two: they throw for a wrong argument, as D35 decided and as about two hundred calls in the
// tests expect. No further method of this kind is added to `Engine`.
export interface EngineAfter extends Engine {
  // As today, with the surfaces in the evaluation.
  getState(at?: Id): StateAfter;
  execute(cmd: Command): CommandResultAfter;
  preview(cmd: Command, at?: Id): CommandResultAfter;
  load(json: string): CommandResultAfter;
  subscribe(listener: (state: StateAfter) => void): () => void;
  query<N extends QueryName>(name: N, args: QueryArgs<N>, options?: QueryOptions): QueryOutcome<QueryResult<N>>;
  export<F extends ExportFormat>(format: F, options: ExportOptions<F>, queryOptions?: QueryOptions): QueryOutcome<Exported>;
}

// ---------------------------------------------------------------- description of a body

// What `get_body` computes in packages/mcp/src/tools.ts today (`bodyDetail`, `edgeShape`), moved
// into the engine as it is, so that the app and other queries can use it.
// - `meshNormal` is what `get_body` prints as the normal of a planar face: the sum of the
//   normals of its triangles, weighted by area.
// - The centre and the radius of a circular edge stay fitted to its vertices and may be missing.
//   Reading them from the surfaces instead is a change of numbers and belongs to package 1b.
// - New here are `surface` and `convex`. `convex` is one more pass over the triangles of the
//   face (the normals of a full cylinder sum to zero, so the sum does not tell).
export interface BodyFace {
  name: FaceName;
  surface: Surface;
  area: number; // mm2
  meshNormal?: Vec3; // planar faces: unit, pointing out of the body
  convex?: boolean; // cylinder and cone: true when the material is on the side of the axis (a pin), false for a hole
}
export type BodyEdge = { name: EdgeName; length: number; segments: number } & (
  | { kind: 'line'; from: Vec3; to: Vec3; gaps: boolean } // gaps: a cut interrupts the edge
  | { kind: 'circle'; circle?: { center: Vec3; radius: number } }
  | { kind: 'coplanar' | 'other' }
);
export interface BodyDescription {
  body: Id;
  volume: number; // mm3
  bounds: { min: Vec3; max: Vec3 };
  faces: BodyFace[];
  edges: BodyEdge[];
}

// ================================================================ export

// `Engine.exportMesh(format, bodies): Uint8Array` returns one file. A robot description is
// several files in folders, and an outline is not a mesh. A format becomes an entry of
// a registry and returns files.
export interface ExportFile {
  // Relative, with forward slashes: `meshes/arm.stl`. The engine guarantees, and the writer
  // checks again, that every segment is non-empty, is not `.` or `..`, has no backslash and is at
  // most 255 bytes, that no two paths of one export differ only in the case of letters, and that
  // no path is a folder of another.
  path: string;
  mediaType: string;
  bytes: Uint8Array;
  about?: Record<string, unknown>; // what the file holds, for the answer of a tool (STL: `bodies`, `triangles`)
}
// `file`: one file; the caller's path names the file. `directory`: the caller's path names
// a folder and `path` of each file is relative to it.
export interface Exported {
  layout: 'file' | 'directory';
  files: ExportFile[];
}
export interface ExportFormatSpec<S> {
  title: string;
  summary: string;
  options: S;
  run: (context: QueryContext, options: RunArgsOf<S>) => Exported;
}
// The options of every format by name; 3MF, DXF, SVG, URDF and MJCF are added by their packages
// by declaration merging.
export interface ExportFormats {
  stl: {
    bodies: { kind: 'list'; of: { kind: 'body' }; title: string; optional: true };
    perBody: { kind: 'flag'; title: string; optional: true }; // layout `directory`, a file per body
  };
}
export type ExportFormat = keyof ExportFormats;
export type ExportOptions<F extends ExportFormat> = ArgsOf<ExportFormats[F]>;
export declare const EXPORT_FORMATS: { [F in ExportFormat]: ExportFormatSpec<ExportFormats[F]> };

// ================================================================ MCP and the app as hosts

// ---------------------------------------------------------------- the query tool

// One general tool `query` reaches every entry of the catalog, the way `execute` reaches every
// command and `sketch_tool` every sketch tool (D33: few general tools, not a tool per
// operation). Its description lists the queries from the catalog.
// - `at`: the state after this feature.
// - `after`: the state the document would have after this command. The preview and the query run
//   together where the engine is (in the app when one is connected); nothing is written. This is
//   how an AI steps a parameter or a pose and asks at each step, for every query, the existing
//   ones included.
// - Both: `engine.preview(after, at)`, the previewed document evaluated up to `at`, and the query
//   over that state. A command that does not apply answers with the error of the preview.
// - The answer is the result with numbers rounded to six decimal places, as the tools round
//   geometry today, or the text of the error. A query whose numbers need another rounding says so
//   per field in its entry.
//
// No existing tool changes its name, its schema or its answers. `check_interference`,
// `get_sketch`, `explain_constraint` and `get_body` stay hand-written and call `query` inside.
// One answer does change: `check_interference` with an unknown `at` and no `bodies` answers
// today with the text of an exception of the engine and will answer like the same call with
// `bodies`.
export interface QueryToolInput {
  query: QueryName;
  args?: Record<string, unknown>; // checked by the engine against the description of the query
  at?: Id;
  after?: Command;
}
export declare const QUERY_TOOL: { name: 'query' };

// ---------------------------------------------------------------- what a tool may answer

// Today a tool returns JSON and the server prints it as text; a `Uint8Array` does not survive
// (`callTool` passes the result through JSON, and so does the bridge to the app). STL has its own
// base64 envelope in a hidden tool. That envelope becomes the general one. `ToolOutcome.result`
// stays JSON: a `ToolAnswer` is JSON, and the server acts on its `kind`.
export interface FileEnvelope {
  path: string; // as in ExportFile
  mediaType: string;
  base64: string;
  about?: Record<string, unknown>;
}
export type ToolAnswer =
  | { kind: 'data'; data: unknown } // printed as text, as today
  | { kind: 'files'; layout: Exported['layout']; files: FileEnvelope[] } // the server writes them where the caller said
  | { kind: 'image'; mediaType: 'image/png'; base64: string }; // returned to the client as image content

// One export tool; `options` are checked against the description of the chosen format, and `at`
// and `after` mean what they mean for `query`. The server writes the files with the guarantees
// `export_stl` has today for a file per body (nothing is written unless every file can be, no
// file is replaced without `overwrite`, names that differ only in case are refused).
// `export_stl` stays as it is and uses the same writer.
//
// The writer of today knows only files directly in the target folder. For paths with folders it
// also creates the folders in its staging directory and in the target, refuses a path whose
// folder exists as something else than a folder, and on a failure removes the folders it
// created. That is work of the package that adds the first format with folders (5b), stated here
// so that `ExportFile.path` does not promise what the writer cannot do.
export interface ExportToolInput {
  format: ExportFormat;
  path: string; // a file for the layout `file`, a folder for `directory`
  options?: Record<string, unknown>;
  overwrite?: boolean;
  at?: Id;
  after?: Command;
}
export declare const EXPORT_TOOL: { name: 'export' };

// ---------------------------------------------------------------- operations of the app

// Something only a running app can do, such as a picture of the viewport. It is not a query: the
// engine has no renderer, and it is asynchronous. It is an operation of the host, described like
// a query and offered as a tool of its own; over a document from a file it answers
// `notAvailable`.
// - The operations are a registry in the module the server and the app share (packages/mcp),
//   by tool name; a package adds one by declaration merging and one entry. The description for
//   the AI and a guard like the one for queries read the registry.
// - Today `Tool.run(engine, args)`, `callTool(engine, ...)` and `connectBridge(engine, ...)`
//   carry only the engine. They carry the host, of which the engine is a part; the path of
//   a tool call becomes awaitable (the bridge and the server await already).
// - An exception inside an operation or a query is reported over the bridge as a failed
//   question, not with today's text for commands ("the change may have been made").
export interface AppHost {}
export interface HostOperation<S> {
  title: string;
  summary: string;
  returns: string;
  args: S;
  run: (host: AppHost & { engine: EngineAfter }, args: RunArgsOf<S>) => Promise<QueryOutcome<ToolAnswer>>;
}
export interface HostOperations {}
export declare const HOST_OPERATIONS: { [N in keyof HostOperations]: HostOperation<HostOperations[N]> };

// Data going the other way (a mesh to import) does not fit into a tool call. A tool takes a path
// and the server reads the file; how the content reaches the engine of a connected app is
// designed by package 3b.

// ---------------------------------------------------------------- description for the AI

// `describe_api` cuts its types out of the raw text of types.ts, so types in query modules do
// not reach it by themselves. It gets four generated sections instead, like the one for
// constraints: the queries (name, summary, each argument from its description, `returns`), the
// operations of the app, the catalogs (name and summary) and the export formats (name, summary,
// options).
export declare function describedQueries(): { name: QueryName; summary: string; args: string[]; returns: string }[];
