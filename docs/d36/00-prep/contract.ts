// Contract of the preparatory step of D36, parts 1 (registry of queries) and 4 (shared vocabulary).
// A draft for review, not code that runs: it is only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the engine and states what
// is added or changed. Parts 2 and 3 (a module per feature type, panels of the app) change no
// public type and have no contract; their design is in part2-feature-modules.md and design.md.
//
// Second version, after the first round of reviews (design.md, "Reviews").

import type {
  AxisRef,
  Command,
  ConstraintExplanation,
  EdgeName,
  Engine,
  EngineState,
  Evaluation,
  FaceName,
  Frame,
  Id,
  InterferenceReport,
  NumberSpec,
  PlaneRef,
  SketchDiagnosis,
  SolidKernel,
  Unit,
  Vec3,
} from '../../../packages/engine/src/index';

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
  | { kind: 'general' };

// The evaluation publishes the surfaces next to the names of the faces.
export interface EvaluationAfter extends Evaluation {
  faceSurfaces: Surface[]; // index = number of the face, like `faceNames`
}
export type StateAfter = Omit<EngineState, 'evaluation'> & { evaluation: EvaluationAfter };

// Kinds of edges (`EdgeKind` keeps its four values). The rule for `circle` today is "a plane and
// a cylinder". It becomes: both faces are surfaces of revolution about the same axis, where
// a plane across the axis counts as one, and the edge is not at the apex of a cone. That covers
// the mouth of a countersink (plane and cone) and its lower rim (cone and cylinder).
// `projectEdge` in solid.ts assumes a plane and a cylinder and changes with the rule.
export type RevolvedAbout = { origin: Vec3; axis: Vec3 };

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
// package that needs a placement first (3b, import of a mesh) designs it, with these
// requirements: any orientation relative to a directed frame (three rotations in a stated order,
// or an equivalent), every number a numeric field with an expression, and a result that is
// a `RigidTransform`. `Placement` in evaluate.ts is the name of something else already.

// ---------------------------------------------------------------- data catalogs

// A table of data the engine carries (hardware, materials, threads). The rule is decided in D36:
// a catalog fills fields, the document stores the numbers.
// - Every catalog has its own columns; a kind of part with other columns is another catalog.
// - Code reads `DATA_CATALOGS` directly and gets the row type of the catalog it names.
// - An untyped caller (MCP) uses the query `catalog`. The description for the AI lists the
//   catalogs by name and summary only, so it does not grow with the tables.
export interface DataCatalog<Row extends Record<string, number | string>> {
  title: string;
  summary: string;
  source: string; // the standard or the data sheet the rows come from; "typical values" when there is none
  columns: { [K in keyof Row]: { title: string; unit: QuantityUnit | 'text' } };
  rows: Record<string, Row>; // by key, such as "M3"
}
// The row type of every catalog by name; a package adds its catalog by declaration merging.
export interface Catalogs {}
export declare const DATA_CATALOGS: { [N in keyof Catalogs]: DataCatalog<Catalogs[N]> };

// ---------------------------------------------------------------- version of the document schema

// Today `SCHEMA_VERSION` is a constant and `upgrade` one function from version 1. It becomes
// a list with one step per version; the current version is the length of the list plus one.
// - A branch of a package appends its step. Version numbers exist only on `master`: the number
//   of a step is fixed when its branch is merged, and a document saved by a build of a branch is
//   not portable (two branches both call their document "version 3").
// - The runner checks the version of the document it gets, applies the steps from there, stamps
//   the result and refuses a version it does not know, a newer one included.
export type UpgradeStep = (document: Record<string, unknown>) => Record<string, unknown>;
export declare const UPGRADES: readonly UpgradeStep[];

// ================================================================ registry of queries

// ---------------------------------------------------------------- arguments

// The arguments of a query are named, and each is described: the checks, the input schema of the
// MCP tool and a form in the app come from the description. A value may have structure (a list,
// one of several alternatives, a record by ID); the description is still data.
// - `oneOf`: exactly one of the named alternatives, written as an object with that one key:
//   `{ direction: [0, 0, 1] }` or `{ face: { kind: 'face', ... } }`.
// - `record`: values by ID or name, such as joint values of a pose.
export type ArgKind =
  | { kind: 'number'; spec: QuantitySpec } // unit and range as for a numeric field; `spec.default` when left out
  | { kind: 'flag' }
  | { kind: 'text' }
  | { kind: 'choice'; options: readonly string[] }
  | { kind: 'body' | 'feature' | 'sketch' } // an ID of that kind
  | { kind: 'constraint'; of: string } // a constraint of the sketch named by the argument `of`
  | { kind: 'entity'; accepts: readonly EntityRef['kind'][] }
  | { kind: 'plane' } // PlaneRef
  | { kind: 'axis' } // AxisRef
  | { kind: 'vector' } // three numbers
  | { kind: 'list'; of: ArgKind; min?: number }
  | { kind: 'oneOf'; options: { readonly [name: string]: ArgKind } }
  | { kind: 'record'; of: ArgKind };
export type ArgSpec = ArgKind & { title: string; summary?: string; optional?: boolean };
export type ArgSpecs = { readonly [name: string]: ArgSpec };

// The type of the arguments follows from their description, so the two cannot disagree. (The
// first draft wrote both by hand and tied only the names; a list of bodies described as a flag
// compiled.)
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
                      ? { [P in keyof O]: { [Q in P]: ValueOf<O[P]> } }[keyof O]
                      : K extends { kind: 'record'; of: infer E }
                        ? Record<string, ValueOf<E>>
                        : never;
type OptionalKeys<S> = { [K in keyof S]: S[K] extends { optional: true } ? K : never }[keyof S];
export type ArgsOf<S> = { -readonly [K in Exclude<keyof S, OptionalKeys<S>>]: ValueOf<S[K]> } & { -readonly [K in OptionalKeys<S>]?: ValueOf<S[K]> };

// ---------------------------------------------------------------- an entry

// What a query computes from. It answers for one state: the document and the evaluation in
// `state`, and what the recompute knew beyond them. The engine keeps, for every state it hands
// out (execute, preview, getState), the internal state it came from, by the identity of the
// evaluation; a query never recomputes the document. A drag preview is therefore diagnosed as
// dragged, and expressions and failed projections are as the recompute saw them.
export interface QueryContext {
  state: StateAfter;
  frame(ref: PlaneRef): Frame | undefined; // directed: for a face the normal points out of the body
  axis(ref: AxisRef): { origin: Vec3; direction: Vec3 } | undefined;
  sketch(sketch: Id): SolvedSketch | undefined; // undefined: the sketch did not evaluate
  kernel: SolidKernel;
  // Results kept for as long as all `owners` live: the same question about the same things is
  // not computed twice. Name every object the answer depends on: both solids for a pair of
  // bodies (as the cache of `interference` does today), the object of a section of the document
  // for an answer that reads it. A body ID in `key` is not enough: the body behind an ID changes.
  memo<T>(owners: readonly object[], key: string, compute: () => T): T;
}
// Stands for `SketchState` of evaluate.ts (solver input, how the solve ended, the analysis of
// freedom), which the diagnosis reads. Internal to the engine.
export interface SolvedSketch {
  readonly feature: Id;
}

export interface QuerySpec<S extends ArgSpecs, Result> {
  title: string;
  summary: string; // what it is for; goes to the description for the AI
  returns: string; // what the answer holds and in which units; goes there as well
  // Name of the MCP tool generated for the query. Without it the query has no tool of its own
  // and a hand-written tool presents it (`get_sketch` presents the diagnosis of a sketch).
  tool?: string;
  args: S;
  // Arguments arrive already checked against `args`. Throws `QueryFailure` for what only the
  // computation finds out.
  run(context: QueryContext, args: ArgsOf<S>): Result;
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
export declare const QUERIES: { [N in QueryName]: QuerySpec<Queries[N]['spec'] & ArgSpecs, QueryResult<N>> };

// ---------------------------------------------------------------- the answer

// A query does not throw for anything its caller can cause; it answers with a result or with
// a reason, like a command. An exception of another kind inside `run` is a defect and passes
// through, as it does for commands (`invalid` in engine.ts).
// What was a successful answer stays one: a sketch that did not evaluate has the diagnosis
// `status: 'unavailable'`, a list of fewer than two bodies has no collisions (`checked: 0`).
export type QueryOutcome<Result> =
  | { ok: true; result: Result }
  | {
      ok: false;
      error: {
        // invalidArguments: an argument fails its description, or `state` is not a state of this engine
        // notAvailable: the thing asked about does not exist in this state (a body, a sketch, a feature)
        // failed: the computation gave up (the kernel, a limit)
        code: 'invalidArguments' | 'notAvailable' | 'failed';
        message: string;
        arg?: string;
      };
    };
export declare class QueryFailure extends Error {
  constructor(code: 'notAvailable' | 'failed', message: string);
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
export type QueryOptions = { at?: Id; state?: never } | { state: EngineState; at?: never };

// `diagnoseSketch`, `explainConstraint` and `interference` become entries of the catalog and
// `exportMesh` an entry of the formats; the rest of the interface stays.
export interface EngineAfter extends Omit<Engine, 'diagnoseSketch' | 'explainConstraint' | 'interference' | 'exportMesh'> {
  query<N extends QueryName>(name: N, args: QueryArgs<N>, options?: QueryOptions): QueryOutcome<QueryResult<N>>;
  export<F extends ExportFormat>(format: F, options: ExportOptions<F>, queryOptions?: QueryOptions): QueryOutcome<Exported>;
}

// ---------------------------------------------------------------- description of a body

// What `get_body` computes in packages/mcp/src/tools.ts today (`bodyDetail`, `edgeShape`), moved
// into the engine as it is, so that the app and other queries can use it. The preparatory step
// adds only what it gets for free from the surfaces (`surface`, `convex`); the centre and the
// radius of a circular edge stay fitted to its vertices, as today, and may be missing. Reading
// them from the surfaces instead is a change of numbers and belongs to package 1b.
export interface BodyFace {
  name: FaceName;
  surface: Surface;
  area: number; // mm2
  outward?: Vec3; // plane: the unit normal pointing out of the body
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
// a registry and returns files; `exportMesh` goes away.
export interface ExportFile {
  path: string; // relative, with forward slashes, no `..` and no leading slash: `meshes/arm.stl`
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
export interface ExportFormatSpec<S extends ArgSpecs> {
  title: string;
  summary: string;
  options: S;
  run(context: QueryContext, options: ArgsOf<S>): Exported;
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
export declare const EXPORT_FORMATS: { [F in ExportFormat]: ExportFormatSpec<ExportFormats[F] & ArgSpecs> };

// ================================================================ MCP and the app as hosts

// ---------------------------------------------------------------- generated tools

// One tool per query that names a `tool`. The input schema is `args` plus the two ways to choose
// the state: `at` (after this feature) and `after` (as the document would be after this command,
// which is how an AI steps a parameter or a pose; the server previews the command and asks the
// query about the previewed state). The answer is the result with numbers rounded to six
// significant digits, or the text of the error.
//
// No existing tool is replaced in the preparatory step. `check_interference`, `get_sketch`,
// `explain_constraint` and `get_body` stay hand-written with their present names, schemas and
// answers, and call `query` inside. Generated tools start with the queries of step 1.
export interface GeneratedTool {
  name: string;
  description: string; // title, summary and `returns` of the query
  inputSchema: Record<string, unknown>;
  query: QueryName;
}
export declare function queryTools(): GeneratedTool[];
export interface GeneratedToolInput {
  at?: Id;
  after?: Command;
  [argument: string]: unknown;
}

// ---------------------------------------------------------------- what a tool may answer

// Today a tool returns JSON and the server prints it as text; a `Uint8Array` does not survive
// (`callTool` passes the result through JSON, and so does the bridge to the app). STL has its own
// base64 envelope in a hidden tool. That envelope becomes the general one.
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

// One export tool: `{ format, path, options, overwrite }`; `options` are checked against the
// description of the chosen format. The server writes the files with the guarantees `export_stl`
// has today for a file per body (nothing is written unless every file can be, no file is
// replaced without `overwrite`, names that differ only in case are refused). `export_stl` stays
// as it is and uses the same writer.
export declare const EXPORT_TOOL: { name: 'export'; formats: readonly ExportFormat[] };

// ---------------------------------------------------------------- operations of the app

// Something only a running app can do, such as a picture of the viewport. It is not a query: the
// engine has no renderer, and it is asynchronous. It is an operation of the host, described like
// a query and offered as a tool; over a document from a file it answers `notAvailable`.
// The path of a tool call becomes awaitable for these (`callTool` is synchronous today; the
// bridge and the server already await).
export interface AppHost {}
export interface HostOperation<S extends ArgSpecs> {
  tool: string;
  title: string;
  summary: string;
  returns: string;
  args: S;
  run(host: AppHost & { engine: EngineAfter }, args: ArgsOf<S>): Promise<ToolAnswer>;
}

// Data going the other way (a mesh to import) does not fit into a tool call. A tool takes a path
// and the server reads the file; how the content reaches the engine of a connected app is
// designed by package 3b.

// ---------------------------------------------------------------- description for the AI

// `describe_api` cuts its types out of the raw text of types.ts, so types in query modules do
// not reach it by themselves. It gets three generated sections instead, like the one for
// constraints: the queries (name, tool, summary, each argument from its description, `returns`),
// the catalogs (name and summary) and the export formats (name, summary, options).
export declare function describedQueries(): { name: QueryName; tool?: string; summary: string; args: string[]; returns: string }[];
