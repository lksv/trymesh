// Contract of package 5a (D49): the mechanism description and the posed queries.
// A draft for review, not code that runs: it is only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the engine, the shared
// types of the preparatory step and what package 3a put into the shared vocabulary, and states
// what the package adds. The design is design.md; the scenario written as calls is calls.ts.
//
// Where the types will live: the section, its commands and its result in the evaluation go to
// `types.ts`, between the two markers, so that `describe_api` shows them. `RigidTransform` moves
// there from solid.ts, because the evaluation now publishes one per link.

import type { AxisRef, Expr, ExpressionError, Id, Input, Solid, Vec3 } from '../../../packages/engine/src/index';
// Internal to the engine today; published with the result of the mechanism.
import type { RigidTransform } from '../../../packages/engine/src/solid';
import type { ArgSpecs, IssueAfter, QuantitySpec, UpgradeStep } from '../00-prep/contract';

// ================================================================ the section of the document

// The mechanism: links, and joints between them. A document always has the section; without
// a link it says nothing and every query answers as modelled.
// - The model is modelled in one configuration, and that configuration is the zero of every joint:
//   a body stands where the timeline puts it when all values are 0.
// - Links and joints are records by ID. An ID follows the rules of every ID (not empty, no `/`,
//   not `origin`) and is unique among the links, or among the joints; a link may carry the ID of
//   a feature (the link `forearm` holds the body `forearm`).
export interface Mechanism {
  links: Record<Id, Link>;
  joints: Record<Id, Joint>;
}

// Bodies that move as one piece. A body is in at most one link; a body in no link stays where
// it is modelled, like the bodies of a link that is no joint's child (a root). A link may be
// empty (a carrier between two joints whose axes cross). A copy made by a pattern is a body of
// its own and is listed like any other; the result names the bodies that are in no link.
export interface Link {
  name?: string; // for people; without it the ID is shown
  bodies: Id[];
}

// A joint moves its child link, and everything that hangs on it, against its parent link.
// - `revolute`: a turn about the axis by `value`, within `lower` and `upper`. `continuous`: the
//   same without limits. Radians; a positive value turns counter-clockwise seen against the
//   direction of the axis (the right-hand rule), as a pattern does.
// - `prismatic`: a shift along the direction of the axis by `value`, in millimetres.
// - `fixed`: the child keeps its place against the parent.
// - `axis` is given as modelled (the zero configuration) and is never posed by
//   itself: the joints nearer to the root carry it along with the parent link.
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
//   `jointOutOfLimits`).
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
// the parameters. Computed after the timeline, like the parameters and the checks; no step of
// a feature reads it, and the bodies of the evaluation stay where they are modelled.
export interface MechanismResult {
  links: Record<Id, LinkResult>;
  joints: Record<Id, JointResult>;
  roots: Id[]; // the links that are no joint's child
  unassigned: Id[]; // bodies of the state that are in no link; empty while there is no link
}
export interface LinkResult {
  bodies: Id[]; // the bodies of the link that the state has
  missing: Id[]; // the bodies it lists that the state does not have
  // Takes the link from where it is modelled to the pose; the identity for a root. A joint in
  // error on the way to the root counts as standing at zero here, and `blockedBy` names the
  // nearest such joint: the pose of the link is then not known, and a query that reads a body
  // of the link fails (see `poseOfBody`).
  transform: RigidTransform;
  blockedBy?: Id;
}
export interface JointResult {
  // error: the pose of the child cannot be computed, or it is not one the joint allows.
  // - brokenReference: the sketch or the point of the axis is not in the state;
  // - invalidExpression: a numeric field has an expression in error (`fieldErrors`);
  // - jointLimits: `lower` is above `upper` (after a change of a parameter);
  // - jointOutOfLimits: `value` is outside the limits (after a change of a parameter).
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
  carries: Id[]; // the bodies of the child link and of every link beyond it that the state has
}

// How the context of a query poses a body: the transform of its link, nothing for a body in no
// link, or the joint that blocks it. The context applies it lazily, body by body, to
// `bodies[id]`, `surface(id, face)` and the frame of a face; reading a blocked body throws
// `QueryFailure('failed', …)` with the joint in the message. Posed solids are remembered by the
// modelled solid and the transform, so a body that did not move between two poses is the same
// object in both and what `memo` keeps for it is found again.
export declare function poseOfBody(mechanism: MechanismResult, body: Id): RigidTransform | { blockedBy: Id } | undefined;

// For a query of the engine that answers about a pair of bodies (the collisions, the gap): two
// posed solids that were moved by the same transform stand to each other as their modelled
// solids do. The function returns those two, and the query answers from them: the bodies of one
// link give at every pose the answer they give as modelled, bit for bit, and it is computed
// once. Nothing is returned for a pair that moved differently or did not move at all.
export declare function movedTogether(a: Solid, b: Solid): { a: Solid; b: Solid } | undefined;

// ================================================================ the query

// The mechanism of the state asked about, as the evaluation has it. With `after` it answers for
// a pose that is not written: where the links stand, which joint is in error, what hangs beyond
// a joint.
export const MECHANISM_ARGS = {} as const satisfies ArgSpecs;

// ================================================================ the upgrade step

// As in 3a: the section is new, a build without the package would drop it without a word, and
// the step has nothing to convert.
export const MECHANISM_STEP: UpgradeStep = {
  name: '5a-mechanism',
  run: (document) => ({ ...document, mechanism: document.mechanism ?? { links: {}, joints: {} } }),
};

// ================================================================ a stand-in for the gap query of 1c

// Package 1c (track A) designs the smallest gap on another branch. What 5a assumes of it: it
// reads the two bodies from its context, so it answers in the pose asked about, and it tells
// "farther apart than the search distance" from a number.
export const STAND_IN_GAP_ARGS = {
  a: { kind: 'body', title: 'First body' },
  b: { kind: 'body', title: 'Second body' },
  within: { kind: 'number', title: 'Search distance', optional: true, spec: { title: 'Search distance', unit: 'mm', min: { value: 0, open: true }, default: 10 } },
} as const satisfies ArgSpecs;
export interface StandInGapResult {
  distance: number | null; // mm; null: farther apart than `within`
  between?: { a: Vec3; b: Vec3 };
}

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
    mechanism: { spec: typeof MECHANISM_ARGS; result: MechanismResult };
    standInGap: { spec: typeof STAND_IN_GAP_ARGS; result: StandInGapResult };
  }
}
