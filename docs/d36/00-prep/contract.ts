// Contract of the preparatory step of D36, parts 1 (registry of queries) and 4 (shared vocabulary).
// A draft for review, not code that runs: it is only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the engine and states what
// is added or changed. Parts 2 and 3 (a module per feature type, panels of the app) change no
// public type and have no contract; their design is in design.md.

import type {
  AxisRef,
  ConstraintExplanation,
  EdgeKind,
  EdgeName,
  Engine,
  EngineState,
  FaceName,
  Id,
  InterferenceReport,
  NumberSpec,
  PlaneRef,
  SketchDiagnosis,
  SolidKernel,
  Vec3,
} from '../../../packages/engine/src/index';

// ================================================================ shared vocabulary

// ---------------------------------------------------------------- surfaces of faces

// What a face is, exactly. Today this is `FaceInfo` in `solid.ts`, internal to the engine, with
// three kinds (a plane, a cylinder, a swept surface); the evaluation publishes only `planar`.
// It becomes public, because queries and the callers of queries need it, and gets two kinds.
//
// kind      | a sketch can stand on it | its edge with a plane across the axis | comes from
// plane     | yes                      | a line, with another plane            | caps, sides from lines
// cylinder  | no                       | a circle                              | sides from arcs and circles
// cone      | no                       | a circle                              | taper of a circle, countersink, revolve of a line
// swept     | no                       | other                                 | gear teeth, a spline side
// general   | no                       | other                                 | revolve of an arc, twist, fillet of a circular edge
//
// `normal` of a plane and `axis` carry no sign, as today; which way is out of the body is a fact
// about the body and is given where a body is described (BodyFace.outward).
export type Surface =
  | { kind: 'plane'; origin: Vec3; normal: Vec3 }
  | { kind: 'cylinder'; origin: Vec3; axis: Vec3; radius: number } // origin: a point of the axis
  | { kind: 'cone'; apex: Vec3; axis: Vec3; halfAngle: number } // halfAngle in radians, between the axis and the surface
  | { kind: 'swept'; axis: Vec3 } // a planar curve moved along `axis`
  | { kind: 'general' };

// `EdgeKind` keeps its four values. The rule that decides `circle` widens from "a plane and
// a cylinder" to "a plane across the axis of a cylinder or of a cone".
export type EdgeKindRule = EdgeKind;

// ---------------------------------------------------------------- references to named entities

// One way to say "this thing of the model" in the arguments of a query. `PlaneRef` and `AxisRef`
// stay what features use; a query that takes a plane or an axis takes those.
export type EntityRef =
  | { kind: 'body'; body: Id }
  | { kind: 'face'; body: Id; face: FaceName }
  | { kind: 'edge'; body: Id; edge: EdgeName }
  | { kind: 'sketchPoint'; sketch: Id; point: Id } // `origin` is the origin of the sketch
  | { kind: 'plane'; plane: PlaneRef }
  | { kind: 'axis'; axis: AxisRef };

// ---------------------------------------------------------------- placement of a body (draft)

// Where an imported mesh, an inserted part or a link of a mechanism sits: a frame taken from
// a plane, offsets along its axes and a turn about its normal. The four numbers are numeric
// fields and take expressions. It resolves to a `RigidTransform` (the pattern has that type
// already). `Placement` in `evaluate.ts` is something else, the transform and the copy tag of
// a pattern copy; this type gets another name on purpose.
// No package of steps 1 and 2 uses it; it is here so that 3b, 3c and 5a start from one shape.
export interface FramePlacement {
  on: PlaneRef;
  x: number;
  y: number;
  z: number; // along the normal of the frame
  turn: number; // radians, about the normal
}

// ---------------------------------------------------------------- export

// `Engine.exportMesh(format, bodies): Uint8Array` returns one file. A robot description is
// several, and an outline is not a mesh. A format becomes an entry of a registry and returns
// files; `exportMesh` goes away.
export interface ExportFile {
  name: string; // file name without a directory; a caller that writes to disk checks collisions
  mediaType: string;
  bytes: Uint8Array;
}
export interface ExportFormatSpec<Options> {
  title: string;
  summary: string;
  options: ArgSpecs<Options>;
  run(context: QueryContext, options: Options): ExportFile[];
}
// The first entry; 3MF, DXF, SVG, URDF and MJCF are added by their packages the same way.
export interface ExportFormats {
  stl: ExportFormatSpec<{ bodies?: Id[]; perBody?: boolean }>;
}
export type ExportFormat = keyof ExportFormats;
export type ExportOptions<F extends ExportFormat> = ExportFormats[F] extends ExportFormatSpec<infer O> ? O : never;

// ---------------------------------------------------------------- data catalogs

// A table of data the engine carries (hardware, materials, threads). The rule is decided in D36:
// a catalog fills fields, the document stores the numbers. A catalog is read through the query
// `catalog`, and the description for the AI lists the catalogs by name and summary only.
export interface DataCatalog<Row extends Record<string, number | string>> {
  title: string;
  summary: string;
  source: string; // the standard or the data sheet the rows come from; "typical values" when there is none
  columns: { [K in keyof Row]: { title: string; unit: NumberSpec['unit'] | 'text' } };
  rows: Record<string, Row>; // by key, such as "M3"
}

// ---------------------------------------------------------------- version of the document schema

// Today `SCHEMA_VERSION` is a constant and `upgrade` one function from version 1. It becomes
// a list with one step per version; the current version is the length of the list plus one.
// A branch of a package adds its step at the end; the version number is therefore assigned at
// the merge and two branches never claim the same one.
export type UpgradeStep = (document: Record<string, unknown>) => Record<string, unknown>;
export declare const UPGRADES: readonly UpgradeStep[];

// ================================================================ registry of queries

// ---------------------------------------------------------------- arguments

// Arguments of a query are flat and named, so that a catalog can describe them: the checks, the
// input schema of the MCP tool and a form in the app come from this description. (The sketch
// tools of D35 point 7 made the same choice.)
export type ArgSpec = { title: string; optional?: boolean } & (
  | { kind: 'number'; spec: NumberSpec } // unit and range as for a numeric field; `spec.default` when left out
  | { kind: 'flag' }
  | { kind: 'choice'; options: readonly string[] }
  | { kind: 'body'; list?: boolean } // an ID of a body that exists in the state the query runs on
  | { kind: 'feature' | 'sketch' }
  | { kind: 'constraint'; of: string } // a constraint of the sketch named by the argument `of`
  | { kind: 'entity'; accepts: readonly EntityRef['kind'][]; list?: boolean }
  | { kind: 'vector' } // three numbers
);
export type ArgSpecs<Args> = { [K in keyof Args]-?: ArgSpec };

// ---------------------------------------------------------------- an entry

export interface QueryContext {
  state: EngineState; // the document and the evaluation the query runs on
  kernel: SolidKernel;
  // Results kept for as long as `owner` lives (an evaluation, a body): the same question about
  // the same state is not computed twice. `interference` has a cache of its own today.
  memo<T>(owner: object, key: string, compute: () => T): T;
}

export interface QuerySpec<Args, Result> {
  title: string;
  summary: string; // goes to the description for the AI
  // Name of the MCP tool generated for the query. Without it the query has no tool of its own
  // and a hand-written tool presents it (`get_sketch` presents the diagnosis of a sketch).
  tool?: string;
  args: ArgSpecs<Args>;
  // Arguments arrive already checked against `args`. Throws `QueryFailure` for what only the
  // computation finds out.
  run(context: QueryContext, args: Args): Result;
}

// The arguments and the result of every query by name. A query module adds its line by
// declaration merging, so adding a query does not edit a shared type:
//   declare module '.../00-prep/contract' { interface Queries { gap: { args: GapArgs; result: GapResult } } }
// (The first draft kept whole `QuerySpec`s here and read the result back with `infer`; writing
// calls.ts showed that the result then comes out as `never`.)
export interface Queries {
  interference: { args: { bodies?: Id[]; threshold?: number }; result: InterferenceReport };
  sketchDiagnosis: { args: { sketch: Id }; result: SketchDiagnosis };
  constraintExplanation: { args: { sketch: Id; constraint: Id }; result: ConstraintExplanation };
  body: { args: { body: Id }; result: BodyDescription };
  catalog: { args: { name: string; key?: string }; result: DataCatalog<Record<string, number | string>> };
}
export type QueryName = keyof Queries;
export type QueryArgs<N extends QueryName> = Queries[N]['args'];
export type QueryResult<N extends QueryName> = Queries[N]['result'];

// The catalog itself: an object with one entry per name, like `CONSTRAINTS` and `GENERATORS`.
export declare const QUERIES: { [N in QueryName]: QuerySpec<QueryArgs<N>, QueryResult<N>> };

// ---------------------------------------------------------------- the answer

// A query never throws to its caller. Like a command it answers with a result or with a reason;
// today the three query methods throw for a wrong argument.
export type QueryOutcome<Result> =
  | { ok: true; result: Result }
  | {
      ok: false;
      error: {
        // invalidArguments: an argument fails its description (`arg` names it)
        // notAvailable: the thing asked about is not there in this state (a body, a sketch that did not evaluate)
        // failed: the computation gave up (the kernel, a limit)
        code: 'invalidArguments' | 'notAvailable' | 'failed';
        message: string;
        arg?: string;
      };
    };
export declare class QueryFailure extends Error {
  constructor(code: 'notAvailable' | 'failed', message: string);
}

// ---------------------------------------------------------------- the engine

export interface QueryOptions {
  at?: Id; // the state after this feature, as for getState
  // A state returned by `preview` of this engine. The query then answers for the previewed
  // document without anything being written, so a parameter can be stepped and each step asked
  // about (the pose sweep of step 5). Not together with `at`.
  state?: EngineState;
}

// `diagnoseSketch`, `explainConstraint` and `interference` become entries of the catalog and
// `exportMesh` an entry of the formats; the rest of the interface stays.
export interface EngineAfter extends Omit<Engine, 'diagnoseSketch' | 'explainConstraint' | 'interference' | 'exportMesh'> {
  query<N extends QueryName>(name: N, args: QueryArgs<N>, options?: QueryOptions): QueryOutcome<QueryResult<N>>;
  export<F extends ExportFormat>(format: F, options: ExportOptions<F>, at?: Id): QueryOutcome<ExportFile[]>;
}

// ---------------------------------------------------------------- description of a body

// What `get_body` computes in `packages/mcp/src/tools.ts` today (`bodyDetail`, `edgeShape`),
// moved into the engine so that the app and other queries can use it. The centre and the radius
// of a circular edge are fitted to vertices there; here they come from the surfaces.
export interface BodyFace {
  name: FaceName;
  surface: Surface;
  area: number; // mm²
  outward?: Vec3; // unit normal pointing out of the body; planar faces only
}
export interface BodyEdge {
  name: EdgeName;
  kind: EdgeKind;
  length: number; // mm
  line?: { from: Vec3; to: Vec3; gaps: boolean }; // kind `line`; gaps: a cut interrupts the edge
  circle?: { center: Vec3; axis: Vec3; radius: number; full: boolean }; // kind `circle`
}
export interface BodyDescription {
  body: Id;
  volume: number; // mm³
  bounds: { min: Vec3; max: Vec3 };
  faces: BodyFace[];
  edges: BodyEdge[];
}

// ================================================================ MCP

// Tools generated from the catalog: one per query that names a `tool`. The input schema comes
// from `args` plus `at`; the answer is the result with numbers rounded to six significant
// digits, or the text of the error. `check_interference` is generated; `get_sketch`,
// `explain_constraint` and `get_body` stay hand-written and call `query` inside, because they
// add labels and advice for the AI.
export interface GeneratedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  query: QueryName;
}
export declare function queryTools(): GeneratedTool[];
// One tool for all formats; `export_stl` stays as the same tool with the format fixed.
export declare const EXPORT_TOOL: { name: 'export'; formats: readonly ExportFormat[] };
