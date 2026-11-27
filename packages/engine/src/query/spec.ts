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
import type { Unit } from '../catalog';
import type { ArgPath, AxisRef, BodyResult, Deflater, Document, Evaluation, FaceName, Frame, Id, PlaneRef, SolidKernel, Surface, ThreadResult, Vec3 } from '../types';
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
//   a sketch point or along a line of a sketch, a plane feature, a base plane or axis. They are
//   where the model has them. The axis of a round face (D60) belongs to its body and is posed.
// - An export is the opposite: its context always has the bodies as modelled.
export interface QueryContext {
  // The document and the evaluation as modelled, without the geometry of bodies (and without the
  // threads, which belong to bodies: `threads`).
  state: { document: Document; evaluation: Omit<Evaluation, 'bodies' | 'faceSurfaces' | 'threads'> };
  bodies: Readonly<Record<Id, BodyResult>>;
  surface(body: Id, face: FaceName): Surface | undefined; // undefined: the body has no such face
  // Directed: for a face the normal points out of the body. The problem is the code the recompute
  // gives for the same reference, so `run` can tell "not in this state" from "not a plane".
  frame(ref: PlaneRef): Frame | RefProblem;
  axis(ref: AxisRef): { origin: Vec3; direction: Vec3 } | RefProblem;
  // The number of a named face: the index into `faceNames`, and `id` of a face of a body.
  face(name: FaceName): number | undefined;
  // The threads on the faces of a body (D76), in the order of `Evaluation.threads`.
  // - `threads`: with their datum (`origin`, `axis`, `zero`) where the pose puts the body; the
  //   objects of the evaluation where it stands as modelled.
  // - `threadsAsModelled`: the published objects themselves, in the frame the mesh of the body is
  //   in. A published thread keeps its identity while nothing of it changes, so a query keeps what
  //   it computes of a thread by that object beside the mesh.
  threads(body: Id): ThreadResult[];
  threadsAsModelled(body: Id): readonly ThreadResult[];
  // What the recompute kept about a sketch (the input of the solver with the positions used, how
  // the solve ended, the analysis of freedom). Undefined: the sketch did not evaluate.
  sketch(sketch: Id): SketchState | undefined;
  // An exception of the kernel inside a query becomes the answer `failed` (the port says that
  // `boolean` throws when the result is not a closed body).
  kernel: SolidKernel;
  // The compressor the engine was created with (D54), absent without one. An export format hands it
  // to `zip` (`export/zip.ts`) and does not call it: `zip` decides which entry is deflated and turns
  // a failure of the compressor into the answer `failed`. A query has no use for it.
  deflater?: Deflater;
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
// `invalidAxis`: an axis of the kind `sketchLine` whose line has no length (D58), or of the kind
// `face` whose face has no axis (D60). `detail`: what the recompute says about it, when it says
// more than the code.
export interface RefProblem {
  problem: 'brokenReference' | 'nonPlanarFace' | 'invalidAxis';
  detail?: string;
}

// The unit of a number of a result: the units of a numeric field, and those only a result has.
export type ResultUnit = Unit | 'g·mm2';
export type ResultUnits = { readonly [key: string]: ResultUnit };

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
  // Keys of the result, at any depth, whose numbers have that unit: what `returns` says in words,
  // for a program. A generic form shows an angle in degrees and writes the unit after a number;
  // a number under a key that is not listed is shown bare.
  units?: ResultUnits;
  // What the query reads of the geometry of bodies (D49). Without it: the bodies in the pose of the
  // state asked about. `modelled`: it always computes from the model as modelled, whatever pose the
  // mechanism holds; its context is the one an export gets (the print query: a part is printed as
  // it is modelled). `none`: it reads no geometry of bodies (a catalog, a sketch, the mechanism
  // itself); it gets the context of the model as modelled too, and a tool says nothing of a pose
  // beside its answer.
  geometry?: 'modelled' | 'none';
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
  units?: ResultUnits;
  geometry?: 'modelled' | 'none';
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

// What `run` throws for what only the computation finds out.
// - `notAvailable`: something named is not in the state asked about in the form the query needs
//   (a sketch that did not evaluate, a face that is not planar where a plane is asked for).
// - `invalidArguments`: the arguments do not go together in a way their description cannot say
//   (a direction of length zero, a list that names one body twice).
// - `failed`: the computation gave up (a body that is empty, a limit, the kernel).
export class QueryFailure extends Error {
  constructor(
    readonly code: 'notAvailable' | 'invalidArguments' | 'failed',
    message: string,
    readonly arg?: ArgPath,
  ) {
    super(message);
  }
}
