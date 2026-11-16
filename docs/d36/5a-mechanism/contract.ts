// Contract of package 5a (D49): the mechanism description and the posed queries.
// A draft for review, not code that runs: it is only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the engine, the shared
// types of the preparatory step and what package 3a put into the shared vocabulary, and states
// what the package adds. The design is design.md; the scenario written as calls is calls.ts.
//
// Third version, after three rounds of reviews (design.md, "Reviews"), checked against the code on
// 2026-11-16 (design.md, "Checked against the code"): the stand-in for the gap query is gone (1c
// is merged), and what the review over the whole set gave to this package is stated (the model as
// modelled for a query, the note about the pose, rows 18 and 19 of cross-review.md).
//
// Where the types will live: the section, its commands and its result in the evaluation go to
// `types.ts`, into the parts that `describe_api` prints (the document before the marker
// `// --- porty`, the result and the commands after `// --- přepočet`; what stands between the
// two is cut out of the description). `RigidTransform` moves there from solid.ts, because the
// evaluation now publishes one per link.

import type { AxisRef, Expr, ExpressionError, Id, Input, Vec3 } from '../../../packages/engine/src/index';
// Internal to the engine today; published with the result of the mechanism.
import type { RigidTransform } from '../../../packages/engine/src/solid';
import type { ArgSpecs, BodyResultAfter, EngineAfter, IssueAfter, QuantitySpec, QueryArgs, QueryName, QueryOptions, QueryOutcome, QueryResult, UpgradeStep } from '../00-prep/contract';

// ================================================================ the section of the document

// The mechanism: links, and joints between them. A document always has the section; without
// a link it says nothing and every query answers as modelled.
// - The model is modelled in one configuration, and that configuration is the zero of every
//   joint: a body stands where the timeline puts it when all values are 0.
// - Links and joints are records by ID. An ID follows the rules of every ID (not empty, no `/`,
//   not `origin`) and is unique among the links, or among the joints; a link may carry the ID of
//   a feature (the link `forearm` holds the body `forearm`).
// - A name of a link or of a joint is for people, by the rules of a body name in 3a: not empty,
//   no leading or trailing space, at most 200 characters. Without it the ID is shown.
export interface Mechanism {
  links: Record<Id, Link>;
  joints: Record<Id, Joint>;
}

// Bodies that move as one piece. A body is in at most one link; a body in no link stays where
// it is modelled, like the bodies of a link that is no joint's child (a root). A link may be
// empty (a carrier between two joints whose axes cross). A copy made by a pattern is a body of
// its own and is listed like any other; the result names the bodies that are in no link.
// The list is kept in the order it was given, which is the order it is shown in and nothing
// more.
export interface Link {
  name?: string;
  bodies: Id[];
}

// A joint moves its child link, and everything that hangs on it, against its parent link.
// - `revolute`: a turn about the axis by `value`, within `lower` and `upper`. `continuous`: the
//   same without limits. Radians; a positive value turns counter-clockwise seen against the
//   direction of the axis (the right-hand rule), as a pattern does.
// - `prismatic`: a shift along the direction of the axis by `value`, in millimetres.
// - `fixed`: the child keeps its place against the parent.
// - `axis` is given as modelled (the zero configuration) and is never posed by itself: the
//   joints nearer to the root carry it along with the parent link.
// - `value`, `lower` and `upper` are numeric fields: each holds the last valid number and takes
//   an expression over the parameters, kept in `expressions` of the joint under the name of the
//   field. A coupled motion is two values that follow one parameter (`q` and `-2 * q`).
interface JointBase {
  name?: string;
  parent: Id; // a link
  child: Id; // a link
  expressions?: { value?: Expr; lower?: Expr; upper?: Expr };
}
export type Joint = JointBase &
  (
    | { type: 'revolute'; axis: AxisRef; lower: number; upper: number; value: number }
    | { type: 'continuous'; axis: AxisRef; value: number }
    | { type: 'prismatic'; axis: AxisRef; lower: number; upper: number; value: number }
    | { type: 'fixed' }
  );

// The ranges of the numeric fields. The limits of a revolute joint stay within a full turn each
// way, so a limit typed in degrees does not pass; its value is held by the limits. The value of
// a continuous joint may be many turns (a planet gear that follows its carrier).
const TURN = 2 * Math.PI;
export const JOINT_FIELDS = {
  revolute: {
    lower: { title: 'Lower limit', unit: 'rad', min: { value: -TURN }, max: { value: TURN } },
    upper: { title: 'Upper limit', unit: 'rad', min: { value: -TURN }, max: { value: TURN } },
    value: { title: 'Angle', unit: 'rad' },
  },
  continuous: { value: { title: 'Angle', unit: 'rad' } },
  prismatic: {
    lower: { title: 'Lower limit', unit: 'mm' },
    upper: { title: 'Upper limit', unit: 'mm' },
    value: { title: 'Travel', unit: 'mm' },
  },
  fixed: {},
} as const satisfies { [T in Joint['type']]: { readonly [field: string]: QuantitySpec } };

// "Within the limits" has a tolerance: the tolerances of the engine (util.ts), an angle to
// `ANGLE_TOLERANCE`, a length to `LENGTH_TOLERANCE`. A value that is outside by no more than
// that is the limit, and is used and stored as the limit. Without it the last step of a sweep
// computed as `lower + (upper − lower) · i / (steps − 1)` would be refused whenever it rounds to
// one unit in the last place above `upper`, and so would a limit read from a tool, which prints
// six decimal places.
export const LIMIT_TOLERANCE = { rad: 1e-4, mm: 1e-6 } as const;

// ================================================================ commands

// In the code these are members of `Command`. What every one of them keeps true, on a command
// and on a load alike (the section is small and is checked whole, without a recompute):
// - a body is listed in at most one link, and once in it;
// - the parent and the child of a joint are links of the section and differ;
// - a link is the child of at most one joint, and no link hangs on itself through a chain of
//   joints. Together: the joints form a forest. More than one root is allowed (a mechanism that
//   is being built, two arms on one table); the result lists the roots.
// What a command checks only when it sets it, and what may break later (the result reports it):
// - a body named by a link is one a feature of the document can create (as in 3a);
// - the sketch and the point of an axis exist;
// - `lower` is not above `upper`, and `value` lies within them. These hold between numbers that
//   expressions may move, so a load does not ask them and the recompute does (`jointLimits`,
//   `jointOutOfLimits`). A command compares the numbers as they are for the document it is
//   applied to: a field with an expression is evaluated against the parameters of that
//   document, also a field the command does not name, so an earlier command of the same batch
//   that changed a parameter is seen. A field whose expression does not evaluate takes no part
//   in the comparison; the recompute reports it.
export interface MechanismCommands {
  // Creates the link `id`, or changes the fields named. `bodies` replaces the list; `name: null`
  // removes the name. A body that is in another link is an invalid command: take it out there
  // first, in the same batch.
  setLink: { type: 'setLink'; id: Id; name?: string | null; bodies?: Id[] };
  // Refused while a joint names the link.
  removeLink: { type: 'removeLink'; id: Id };
  // Creates the joint `id` or replaces it, whole, in the input form: a numeric field takes
  // a number or an expression, which has to evaluate now. A string equal to the expression the
  // field already has counts as unchanged and is kept without evaluation, as in `updateFeature`.
  setJoint: { type: 'setJoint'; id: Id; joint: Input<Joint> };
  removeJoint: { type: 'removeJoint'; id: Id };
  // The pose: the values of the joints named; the others keep theirs. A number removes the
  // expression of the value, a string sets one. A fixed joint has no value to set. This is the
  // command a sweep previews at every step, and the one that goes into `after` of the tool
  // `query`.
  setPose: { type: 'setPose'; values: Record<Id, number | Expr> };
}

// ================================================================ the result of the recompute

// The mechanism of a state: what the section says, resolved against the model of that state and
// the parameters. Computed after the timeline, like the checks; no step of a feature reads it,
// and the bodies of the evaluation stay where they are modelled.
export interface MechanismResult {
  links: Record<Id, LinkResult>;
  joints: Record<Id, JointResult>;
  roots: Id[]; // the links that are no joint's child
  unassigned: Id[]; // bodies of the state that are in no link; empty while there is no link
}
export interface LinkResult {
  bodies: Id[]; // the bodies of the link that the state has
  missing: Id[]; // the bodies it lists that the state does not have
  // Takes the link from where it is modelled to the pose; the identity for a root. A joint
  // without a motion on the way to the root counts as standing at zero here, and `blockedBy`
  // names the nearest such joint: the pose of the link is then not known, and a query that
  // reads a body of the link fails (see `poseOfBody`).
  transform: RigidTransform;
  blockedBy?: Id;
}
export interface JointResult {
  // error: something about the joint is wrong.
  // - brokenReference: the sketch or the point of the axis is not in the state;
  // - invalidExpression: a numeric field has an expression in error (`fieldErrors`);
  // - jointLimits: `lower` is above `upper` (after a change of a parameter);
  // - jointOutOfLimits: `value` is outside the limits (after a change of a parameter).
  // A joint in error has no motion and blocks what hangs on it, with one exception: a joint
  // whose only fault is its axis and whose value is 0 moves nothing whatever the axis is, so it
  // is in error and blocks nothing. A model whose pose is zero stays readable while a sketch of
  // an axis is being repaired.
  status: 'ok' | 'error';
  error?: IssueAfter;
  fieldErrors?: { value?: ExpressionError; lower?: ExpressionError; upper?: ExpressionError };
  // The numbers used; a field in error is left out.
  value?: number;
  lower?: number;
  upper?: number;
  // The axis as modelled, and where the parent link carries it in the pose. `origin` is the
  // point the axis was given by (the sketch point; the origin of the model for a base axis),
  // `direction` a unit vector. A fixed joint has none.
  axis?: { origin: Vec3; direction: Vec3 };
  axisInPose?: { origin: Vec3; direction: Vec3 }; // absent while the parent link is blocked
}

// What hangs on a joint: its child link and every link beyond it, their bodies that the state
// has, and the bodies those links list that the state does not have. A caller that adds up
// a mass over `bodies` has to look at `missing`: a suppressed motor is not in the sum.
export interface Carried {
  joint: Id;
  links: Id[];
  bodies: Id[];
  missing: Id[];
}
export declare function carriedBy(section: Mechanism, mechanism: MechanismResult, joint: Id): Carried;

// How the context of a query poses a body: the transform of its link, nothing for a body in no
// link, or the joint that blocks it. The context applies it lazily, body by body, to
// `bodies[id]`, `surface(id, face)` and the frame of a face; reading a blocked body throws
// `QueryFailure('failed', …)` with the joint in the message. Posed bodies are remembered by the
// modelled solid and the transform, so a body that did not move between two poses is the same
// object in both and what `memo` keeps for it is found again.
// A state asked for with `at` is posed by the mechanism as it resolves against that state: an
// axis whose sketch comes later is not there yet, so its joint has no motion and blocks, unless
// its value is 0. A document whose pose is zero and whose joints have no fault other than an
// axis answers at every point of its timeline as it answers today. (A fault of a limit or of
// an expression comes from the parameters, which are the same at every point: such a joint
// blocks at the end of the timeline as well, so `at` adds no case of its own.)
// The message of the failure for a blocked body names the joint and its fault, and says that
// the bodies beyond it can be read with the joint at zero when its only fault is its axis:
// `after: { type: 'setPose', values: { <joint>: 0 } }`, which writes nothing.
export declare function poseOfBody(mechanism: MechanismResult, body: Id): RigidTransform | { blockedBy: Id } | undefined;

// For a query of the engine that answers about a pair of bodies (the collisions, the gap): the
// pair in the frame of its first body. `a` is the first body as modelled, `b` the second one
// moved by the motions of the joints on the way from the link of `a` to the link of `b`, and
// `back` takes that frame to the pose. The query computes from `a` and `b` (their solids, their
// bounds, their faces) and moves any coordinate of its answer by `back`; volumes, depths and
// distances need no change.
// - What the pair shares depends only on how the two stand to each other. Two bodies of one link
//   are computed as modelled, once, whatever the pose; two bodies on both sides of the joint
//   that is being swept are computed at every step; two bodies beyond it are computed once.
// - The motion between the two links is composed from the motions of the joints between them,
//   not from the two transforms to the pose, so it is the same numbers whenever those joints
//   have the same values, and `b` is then the same object (remembered by the modelled solid and
//   the motion).
// - It is also what keeps a pair across one joint exact in single precision: the second body is
//   turned about the axis of that joint only, so faces that are flush across a joint along
//   a coordinate axis stay in one plane bit for bit. Two bodies posed to the world separately are
//   rounded apart, and the kernel then refuses most poses of such a pair (design.md, "Verified
//   before the implementation"). A query about a pair computes from this pair, not from two
//   entries of `context.bodies`.
// - Both arguments are bodies a context handed out. Nothing is returned when neither was moved:
//   they are the modelled bodies already.
// - The pair is ordered: the frame is that of the first body. An answer that tells the two bodies
//   apart (the nearest point on each) is the answer for that order only. The owners of `memo`
//   have no order, so a query that remembers such an answer by the two solids puts the order
//   into its key, or computes in one fixed order and swaps the sides of what it returns, as the
//   collisions sort the two IDs before they compute.
// - The engine keeps, for every body a context handed out, the modelled body and the link it
//   came from (a `BodyResult` carries no ID); that is what this function looks up.
export declare function pairInFrame(a: BodyResultAfter, b: BodyResultAfter): { a: BodyResultAfter; b: BodyResultAfter; back: RigidTransform } | undefined;

// ================================================================ the query

// The mechanism of the state asked about, as the evaluation has it. With `after` it answers for
// a pose that is not written: where the links stand, which joint is in error. With `beyond` it
// adds what hangs on that joint. The answer grows with the section, which the caller wrote, as
// the answer of `get_document` does; `beyond` is one joint at a time so that it does not grow
// with the square of it.
export const MECHANISM_ARGS = {
  beyond: { kind: 'text', title: 'Joint', summary: 'The ID of a joint: the answer adds what hangs on it.', optional: true },
} as const satisfies ArgSpecs;
export type MechanismAnswer = MechanismResult & { beyond?: Carried };

// ================================================================ the upgrade step

// As in 3a: the section is new, a build without the package would drop it without a word, and
// the step has nothing to convert. A field that is there is left for the validation.
export const MECHANISM_STEP: UpgradeStep = {
  name: '5a-mechanism',
  run: (document) => ('mechanism' in document ? document : { ...document, mechanism: { links: {}, joints: {} } }),
};

// ================================================================ the model as modelled, and the note about the pose

// Rows 18 and 19 of cross-review.md: additions to shared types that this package makes, because
// a pose appears with it.
// - An entry of the catalog of queries may say that it always computes from the model as modelled:
//   `geometry: 'modelled'` on `QuerySpec`. Its context is the one an export gets. The print query
//   of 1e is marked: a part is printed as it is modelled, whatever pose the document holds.
// - A caller may ask any query about the model as modelled: `geometry: 'modelled'` in the options
//   of `Engine.query` and as an argument of the tool `query`, next to `at`, `state` and `after`.
//   It is the way to a body beyond a joint that cannot stand at zero or is at fault for more than
//   its axis, and it is what a caller writes who wants the answer of before this package whatever
//   the document holds.
// Without either a query answers in the pose of the state asked about.
export interface GeometryOption {
  geometry?: 'modelled';
}
export type PosedQueryOptions = QueryOptions & GeometryOption;
// `Engine.query` with the option; the draft cannot widen the type alias `QueryOptions` itself.
export interface EngineWithPose extends Omit<EngineAfter, 'query'> {
  query<N extends QueryName>(name: N, args: QueryArgs<N>, options?: PosedQueryOptions): QueryOutcome<QueryResult<N>>;
}

// What a tool says beside its result when the answer is for a pose that moves a link: the joints
// whose value is not zero, with their values (rad or mm). Absent when every link stands as
// modelled, when the query was answered as modelled, and for a document without a mechanism, so
// the answers of today do not change. The tool `query` and the tools `check_interference` and
// `get_body` carry it in one place: an optional `about` beside `result` in the outcome of a tool,
// which the server prints as a second text, as it prints `about` of a picture since 1f.
export interface PoseNote {
  pose: Record<Id, number>;
}
export declare function poseNote(mechanism: MechanismResult): PoseNote | undefined;

// ================================================================ additions to the shared maps

declare module '../00-prep/contract' {
  interface DocumentSections {
    mechanism: Mechanism;
  }
  interface Commands extends MechanismCommands {}
  interface EvaluationAfter {
    mechanism: MechanismResult;
  }
  interface IssueCodes {
    jointLimits: true;
    jointOutOfLimits: true;
  }
  interface Queries {
    mechanism: { spec: typeof MECHANISM_ARGS; result: MechanismAnswer };
  }
  // the type parameters repeat those of the interface that is widened
  interface QuerySpec<S, Result> extends GeometryOption {}
  interface QueryToolInput extends GeometryOption {}
}
