// A query as an entry of the catalog `QUERIES` (query/index.ts): what it is given and what it must
// not do. A query module holds the description of its arguments, its result type and its entry, and
// adds its line to the map `Queries` by declaration merging:
//
//   declare module './spec' {
//     interface Queries { gap: { spec: typeof GAP_ARGS; result: GapResult } }
//   }
//
// so adding a query edits no shared type; the registry gets one line.
import type { SketchState } from '../recompute/state';
import type { ArgPath, AxisRef, BodyResult, Document, Evaluation, FaceName, Frame, Id, PlaneRef, SolidKernel, Surface, Vec3 } from '../types';
import type { ArgSpecs, ArgsOf, RunArgsOf } from './args';

// What a query computes from. It answers for one state: the document and the evaluation in
// `state`, and what the recompute knew beyond them. The engine keeps, for every evaluation it
// hands out (execute, preview, getState), the internal state and the document it came from, so
// a query never recomputes the document. A drag preview is therefore diagnosed as dragged.
//
// The pose. With a mechanism a query is asked about bodies moved to a pose, while the evaluation
// keeps them where they were modelled.
// - What belongs to a body is in the pose asked about: `bodies`, `surface`, the frame of a face.
//   A query reads the geometry of bodies nowhere else (the state of the context has neither the
//   bodies nor the surfaces), and then it answers for a pose without a change.
// - What does not belong to a body is never posed: a sketch and its points, an axis through
//   a sketch point, a plane feature, a base plane or axis. They are where the model has them.
// - An export is the opposite: its context always has the bodies as modelled.
export interface QueryContext {
  // The document and the evaluation as modelled, without the geometry of bodies.
  state: { document: Document; evaluation: Omit<Evaluation, 'bodies' | 'faceSurfaces'> };
  bodies: Readonly<Record<Id, BodyResult>>;
  surface(body: Id, face: FaceName): Surface | undefined; // undefined: the body has no such face
  // Directed: for a face the normal points out of the body. The problem is the code the recompute
  // gives for the same reference, so `run` can tell "not in this state" from "not a plane".
  frame(ref: PlaneRef): Frame | RefProblem;
  axis(ref: AxisRef): { origin: Vec3; direction: Vec3 } | RefProblem;
  // The number of a named face: the index into `faceNames`, and `id` of a face of a body.
  face(name: FaceName): number | undefined;
  // What the recompute kept about a sketch (the input of the solver with the positions used, how
  // the solve ended, the analysis of freedom). Undefined: the sketch did not evaluate.
  sketch(sketch: Id): SketchState | undefined;
  // An exception of the kernel inside a query becomes the answer `failed` (the port says that
  // `boolean` throws when the result is not a closed body).
  kernel: SolidKernel;
  // Results kept for as long as all `owners` live: the same question about the same things is not
  // computed twice.
  // - Name every object the answer depends on: both solids for a pair of bodies, the object of
  //   a section of the document for an answer that reads it. A body ID in `key` is not enough:
  //   the body behind an ID changes.
  // - Owners that live across recomputes: a `Solid`, a solved sketch, the document, a section or
  //   a feature of it. The state, its evaluation and the map of bodies are new objects on every
  //   recompute and never hit.
  // - At least one owner; their order does not matter. Keys of different queries do not meet: the
  //   engine keeps them apart.
  memo<T>(owners: readonly [object, ...object[]], key: string, compute: () => T): T;
}
export interface RefProblem {
  problem: 'brokenReference' | 'nonPlanarFace';
}

// `Result` is plain JSON (numbers, texts, lists, objects): it goes through the tool `query`, the
// bridge to the app and a generic form as it is. A query that has bytes is an export.
export interface QuerySpec<S, Result> {
  title: string;
  summary: string; // what it is for; goes to the description for the AI
  returns: string; // what the answer holds and in which units; goes there as well
  args: S;
  // Keys of the result, at any depth, whose numbers a tool prints rounded to that many significant
  // digits instead of six decimal places: values that are small on purpose, such as a volume
  // compared with a small threshold.
  significant?: { readonly [key: string]: number };
  // A property, not a method, so that its parameter is checked strictly against the map below.
  // A query that builds on another calls its `run` with the same context.
  // - It does not throw for what its caller can cause. For what only the computation finds out it
  //   throws `QueryFailure`, with the path of the argument when there is one.
  // - An exception of another kind is a defect and passes through.
  run: (context: QueryContext, args: RunArgsOf<S>) => Result;
}

// An entry as code that handles any query reads it (the runner, the description for the AI,
// a generated form): the arguments are checked values of a type only the entry knows.
export interface AnyQuery {
  title: string;
  summary: string;
  returns: string;
  args: ArgSpecs;
  significant?: { readonly [key: string]: number };
  run: (context: QueryContext, args: never) => unknown;
}

// The description of the arguments and the result of every query, by name.
export interface Queries {}
export type QueryName = keyof Queries;
export type QueryArgs<N extends QueryName> = ArgsOf<Queries[N]['spec']>;
export type QueryResult<N extends QueryName> = Queries[N]['result'];
// The type of the catalog: an entry per name, typed by the map.
export type QueryCatalog = { [N in QueryName]: QuerySpec<Queries[N]['spec'], QueryResult<N>> };

// A description in the map that is not a valid `ArgSpecs` (a kind that does not exist) stops the
// type check here; the message lists the names. The catalog itself is not constrained this way:
// with a constraint on its entries the engine could not call `run` of an entry picked by name.
type InvalidSpecs = { [N in keyof Queries]: Queries[N]['spec'] extends ArgSpecs ? never : N }[keyof Queries];
export const SPECS_ARE_VALID: [InvalidSpecs] extends [never] ? true : { [N in InvalidSpecs]: 'is not a valid description' } = true;

// What `run` throws for what only the computation finds out: a face that is not planar where
// a plane is asked for, a body that is empty, a limit.
export class QueryFailure extends Error {
  constructor(
    readonly code: 'notAvailable' | 'failed',
    message: string,
    readonly arg?: ArgPath,
  ) {
    super(message);
  }
}
