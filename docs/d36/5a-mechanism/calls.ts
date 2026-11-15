// Package 5a written out as calls: its part of validation scenario 13, a link of an arm between
// two joints. Two revolute joints; the pose stepped through the range of one joint with the
// collisions asked at each step; the mass of what hangs beyond the first joint. Only
// type-checked (`npx tsc -p docs/d36/tsconfig.json`). Lines marked `@ts-expect-error` are calls
// that must not compile. After the implementation it becomes a test in packages/scenarios.
//
// The model is built and given its properties in 3a-body-properties/calls.ts (`build`): the
// bodies `base`, `upper` (the link of the arm), `forearm`, `motor` (a reference part of 280 g
// that sits in `upper`) and the screws `screw`, `screws/1` to `screws/3`. The sketch `layout` on
// the base plane XY has the points `shoulder` and `elbow`; the two axes are the normal of that
// sketch through them. The arm is modelled stretched out: that is the zero of both joints.

import type { Id, InterferenceReport, Vec3 } from '../../../packages/engine/src/index';
import type { RigidTransform } from '../../../packages/engine/src/solid';
import type { BodyResultAfter, CommandAfter, EngineAfter, QueryContext, QueryOutcome, QueryToolInput, StateAfter } from '../00-prep/contract';
import { QUERIES, QueryFailure, SCHEMA_PENDING, UPGRADES } from '../00-prep/contract';
import { SECTION_INFO } from '../3a-body-properties/contract';
import type { Carried, Joint, JointResult, MechanismResult, StandInGapResult } from './contract';
import { MECHANISM_ARGS, MECHANISM_STEP, carriedBy, pairInFrame, poseOfBody } from './contract';

declare const engine: EngineAfter;
declare function fail(message: string): never;
const unwrap = <T>(outcome: QueryOutcome<T>): T => (outcome.ok ? outcome.result : fail(`${outcome.error.code}: ${outcome.error.message}`));
function run(...commands: CommandAfter[]): StateAfter {
  const result = engine.execute(commands.length === 1 ? commands[0] : { type: 'batch', commands });
  return result.ok ? result.state : fail(result.error.message);
}
const refusal = (command: CommandAfter): string => {
  const result = engine.execute(command);
  return result.ok ? fail('expected an invalid command') : result.error.message;
};

// ---------------------------------------------------------------- a. the description

// Three links and two joints, in one batch and one undo step. The limits are given in degrees
// by the function of the expressions; the fields then hold radians and keep the expression.
export function describe(): MechanismResult {
  const state = run(
    { type: 'setLink', id: 'base', bodies: ['base'] },
    { type: 'setLink', id: 'upper', name: 'Upper arm', bodies: ['upper', 'motor', 'screw', 'screws/1', 'screws/2', 'screws/3'] },
    { type: 'setLink', id: 'forearm', bodies: ['forearm'] },
    { type: 'setJoint', id: 'shoulder', joint: { type: 'revolute', parent: 'base', child: 'upper', axis: { kind: 'sketchPoint', sketch: 'layout', point: 'shoulder' }, lower: 'deg(-90)', upper: 'deg(90)', value: 0 } },
    { type: 'setJoint', id: 'elbow', joint: { type: 'revolute', parent: 'upper', child: 'forearm', axis: { kind: 'sketchPoint', sketch: 'layout', point: 'elbow' }, lower: 'deg(-135)', upper: 'deg(135)', value: 0 } },
  );
  return state.evaluation.mechanism; // roots: ['base'], unassigned: [], every joint 'ok'
}

// What the document holds: numbers in the fields, the expressions beside them.
export function stored(): { lower: number; expression: string | undefined } {
  const joint: Joint = engine.getState().document.mechanism.joints['elbow'];
  return joint.type === 'revolute' ? { lower: joint.lower, expression: joint.expressions?.lower } : fail('expected a revolute joint'); // -2.356…, 'deg(-135)'
}

// A link built one command at a time is a root until its joint comes; the result says so, and
// names the bodies that are in no link (a forgotten copy of a pattern shows here).
export function halfBuilt(): { roots: Id[]; unassigned: Id[] } {
  const preview = engine.preview({ type: 'setLink', id: 'gripper', bodies: [] });
  if (!preview.ok) return fail(preview.error.message);
  const { roots, unassigned } = preview.state.evaluation.mechanism;
  return { roots, unassigned }; // ['base', 'gripper'], []
}

// A body goes from one link to another in one batch: out of the first, into the second.
export const motorToTheBase = (): StateAfter =>
  run({ type: 'setLink', id: 'upper', bodies: ['upper', 'screw', 'screws/1', 'screws/2', 'screws/3'] }, { type: 'setLink', id: 'base', bodies: ['base', 'motor'] });

// What the commands refuse (each compiles: the engine validates them).
export const refused = (): string[] => [
  refusal({ type: 'setLink', id: 'forearm', bodies: ['forearm', 'motor'] }), // the motor is in the link `upper`
  refusal({ type: 'setLink', id: 'tool', bodies: ['nope'] }), // no feature creates such a body
  refusal({ type: 'removeLink', id: 'upper' }), // two joints name it
  refusal({ type: 'setJoint', id: 'loop', joint: { type: 'fixed', parent: 'forearm', child: 'base' } }), // the base would hang on itself
  refusal({ type: 'setJoint', id: 'second', joint: { type: 'fixed', parent: 'base', child: 'forearm' } }), // the forearm is the child of `elbow` already
  refusal({ type: 'setJoint', id: 'wrist', joint: { type: 'revolute', parent: 'forearm', child: 'nope', axis: { kind: 'base', axis: 'Z' }, lower: -1, upper: 1, value: 0 } }), // no such link
  refusal({ type: 'setJoint', id: 'shoulder', joint: { type: 'revolute', parent: 'base', child: 'upper', axis: { kind: 'base', axis: 'Z' }, lower: -90, upper: 90, value: 0 } }), // degrees: outside a full turn
  refusal({ type: 'setJoint', id: 'shoulder', joint: { type: 'revolute', parent: 'base', child: 'upper', axis: { kind: 'base', axis: 'Z' }, lower: 1, upper: -1, value: 0 } }), // the lower limit above the upper
  refusal({ type: 'setPose', values: { elbow: 3 } }), // outside the limits of the joint
  refusal({ type: 'setPose', values: { nope: 0 } }), // no such joint
];
// @ts-expect-error a kind of joint that does not exist
engine.execute({ type: 'setJoint', id: 'j', joint: { type: 'spherical', parent: 'base', child: 'upper' } });
// @ts-expect-error a revolute joint has limits
engine.execute({ type: 'setJoint', id: 'j', joint: { type: 'revolute', parent: 'base', child: 'upper', axis: { kind: 'base', axis: 'Z' }, value: 0 } });
// @ts-expect-error a fixed joint has no axis
engine.execute({ type: 'setJoint', id: 'j', joint: { type: 'fixed', parent: 'base', child: 'upper', axis: { kind: 'base', axis: 'Z' } } });
// @ts-expect-error a value is a number or an expression
engine.execute({ type: 'setPose', values: { elbow: true } });

// ---------------------------------------------------------------- b. the pose stepped through the range of one joint

// The elbow goes from its lower to its upper limit in `steps` steps (two or more); at each the
// collisions are asked over the previewed state. Nothing is written and the undo history is not
// touched.
// - The last value may round to a hair above the upper limit; it is within the tolerance of the
//   limits and is taken as the limit.
// - A step is clear only when it has no colliding pair and no pair the kernel failed on, so
//   `failed` is kept. The pin of the elbow in its hole is expected among the fits at every step.
interface Step {
  value: number;
  pairs: [Id, Id][];
  fits: [Id, Id][];
  failed: [Id, Id][];
}
const stepOf = (value: number, report: InterferenceReport): Step => {
  const ids = (list: { a: Id; b: Id }[]) => list.map((pair): [Id, Id] => [pair.a, pair.b]);
  return { value, pairs: ids(report.pairs), fits: ids(report.fits), failed: ids(report.failed) };
};
export function sweepElbow(steps: number): Step[] {
  const elbow: JointResult = engine.getState().evaluation.mechanism.joints['elbow'];
  if (elbow.lower === undefined || elbow.upper === undefined) return fail('the elbow has no limits');
  const out: Step[] = [];
  for (let i = 0; i < steps; i++) {
    const value = elbow.lower + ((elbow.upper - elbow.lower) * i) / (steps - 1);
    const preview = engine.preview({ type: 'setPose', values: { elbow: value } });
    if (!preview.ok) return fail(preview.error.message);
    out.push(stepOf(value, unwrap(engine.query('interference', {}, { state: preview.state }))));
  }
  return out;
}
export const clearSteps = (sweep: Step[]): number[] => sweep.filter((step) => step.pairs.length === 0 && step.failed.length === 0).map((step) => step.value);

// The same step over MCP: the command that sets the pose goes into `after` of the tool `query`.
// The existing query answers in the pose with no change of its own.
export const stepOverMcp: QueryToolInput = { query: 'interference', after: { type: 'setPose', values: { elbow: 1.2 } } };
export const twoJointsOverMcp: QueryToolInput = { query: 'interference', args: { bodies: ['base', 'forearm'] }, after: { type: 'setPose', values: { shoulder: 0.5, elbow: -1.2 } } };

// The smallest gap in a pose (1c, here its stand-in): how near the forearm comes to the base
// when the elbow is folded.
export function clearanceFolded(): number | null {
  const preview = engine.preview({ type: 'setPose', values: { elbow: 2.2 } });
  if (!preview.ok) return fail(preview.error.message);
  return unwrap(engine.query('standInGap', { a: 'forearm', b: 'base', within: 50 }, { state: preview.state })).distance;
}

// A pose that is written: one command, one undo step; undo brings the arm back.
export function pose(): [number | undefined, number | undefined] {
  const bent = run({ type: 'setPose', values: { shoulder: 0.3, elbow: 0.8 } }).evaluation.mechanism.joints['elbow'].value;
  engine.undo();
  return [bent, engine.getState().evaluation.mechanism.joints['elbow'].value]; // [0.8, 0]
}

// A coupled motion: both values follow one parameter, and the sweep steps the parameter. The
// values in the document are rewritten by the recompute, as every numeric field is.
export function coupled(values: number[]): Step[] {
  run({ type: 'setParameter', name: 'q', expr: '0' }, { type: 'setPose', values: { shoulder: 'q', elbow: '-2 * q' } });
  return values.map((value) => {
    const preview = engine.preview({ type: 'setParameter', name: 'q', expr: String(value) });
    if (!preview.ok) return fail(preview.error.message);
    return stepOf(value, unwrap(engine.query('interference', {}, { state: preview.state })));
  });
}

// A limit that follows a parameter, widened and used in one batch. The pose is compared with
// the limit as it is for the document the command is applied to (the parameter is 2.6 by then),
// not with the number the field still holds from before the batch.
export function widenAndPose(): boolean {
  run({ type: 'setParameter', name: 'reach', expr: '2.2' });
  run({ type: 'setJoint', id: 'elbow', joint: { type: 'revolute', parent: 'upper', child: 'forearm', axis: { kind: 'sketchPoint', sketch: 'layout', point: 'elbow' }, lower: '-reach', upper: 'reach', value: 0 } });
  return engine.execute({ type: 'batch', commands: [{ type: 'setParameter', name: 'reach', expr: '2.6' }, { type: 'setPose', values: { elbow: 2.5 } }] }).ok; // true
}

// ---------------------------------------------------------------- c. the mass of what hangs beyond the first joint

// The query `mechanism` with `beyond` says what the shoulder carries and where its axis is in
// the pose; the mass query (1d, the stand-in of 3a) takes those bodies as one piece in the same
// pose. The motor counts with the mass of its data sheet. A body that a link lists and the
// model does not have would be missing from the sum, so the answer is refused when there is one.
// The torque the shoulder has to hold against gravity is the part of r × F along its axis, with
// r from the axis to the centre of mass: for gravity along the axis it is zero whatever r is.
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function beyondShoulder(elbow: number, gravity: Vec3 = [0, -9.81, 0]): { bodies: Id[]; mass: number; torque: number } {
  const preview = engine.preview({ type: 'setPose', values: { elbow } });
  if (!preview.ok) return fail(preview.error.message);
  const options = { state: preview.state };
  const mechanism = unwrap(engine.query('mechanism', { beyond: 'shoulder' }, options));
  const carried: Carried = mechanism.beyond ?? fail('expected what the shoulder carries');
  if (carried.missing.length > 0) return fail(`the model does not have ${carried.missing.join(', ')}`);
  const axis = mechanism.joints['shoulder'].axisInPose ?? fail('the shoulder has no axis in this pose');
  const load = unwrap(engine.query('standInMass', { bodies: carried.bodies }, options));
  // g · mm · m/s² along the axis; ·10⁻⁶ gives N·m
  const torque = dot(axis.direction, cross(sub(load.centerOfMass, axis.origin), gravity)) * load.mass * 1e-6;
  return { bodies: carried.bodies, mass: load.mass, torque }; // upper, motor, the four screws and forearm; folded, the torque is smaller
}
// Over MCP it is two calls with the same `after`: what the shoulder carries, then its mass.
export const carriedOverMcp: QueryToolInput = { query: 'mechanism', args: { beyond: 'shoulder' }, after: { type: 'setPose', values: { elbow: 1.2 } } };
export const massOverMcp: QueryToolInput = { query: 'standInMass', args: { bodies: ['upper', 'motor', 'screw', 'screws/1', 'screws/2', 'screws/3', 'forearm'] }, after: { type: 'setPose', values: { elbow: 1.2 } } };

// ---------------------------------------------------------------- d. what is posed and what stays as modelled

// An export never sees the pose: the files of a bent arm are those of the arm as modelled.
export function exportedAsModelled(): number {
  run({ type: 'setPose', values: { elbow: 1 } });
  return unwrap(engine.export('stl', { bodies: ['forearm'] })).files[0].bytes.length;
}
// The bodies of the evaluation stay where they are modelled; the pose is in `mechanism`.
export function whereTheForearmIs(): { modelled: Vec3; moved: boolean } {
  const { bodies, mechanism } = engine.getState().evaluation;
  const transform = mechanism.links['forearm'].transform;
  return { modelled: bodies['forearm'].bounds.min, moved: transform.translation.some((part) => part !== 0) };
}
// A query reads the posed body: its description has the bounds in the pose.
export const posedBounds = (): Vec3 => unwrap(engine.query('body', { body: 'forearm' })).bounds.min;
// A state asked for with `at` is a point of the construction of the model and is not posed: the
// collisions after the feature `forearm` are those of the model as modelled, as they are today.
export const duringConstruction = (): InterferenceReport => unwrap(engine.query('interference', {}, { at: 'forearm' }));

// The entry of the query `mechanism`: the result of the recompute for the state asked about,
// and on request what hangs on one joint. A joint the section does not have is the caller's to
// fix; a text argument is not looked up by the engine before `run`.
export const mechanismQuery: (typeof QUERIES)['mechanism'] = {
  title: 'Mechanism',
  summary: 'The links and joints of the model as resolved for the state asked about: where each link stands in the pose, the numbers and the axis of each joint, and what is in error. With `beyond`, what hangs on that joint.',
  returns: 'links (bodies, missing, transform, blockedBy), joints (status, error, value, lower, upper, axis, axisInPose), roots and unassigned; with `beyond` the links, bodies and missing bodies beyond that joint. Lengths in mm, angles in rad.',
  args: MECHANISM_ARGS,
  run(context, args) {
    const { document, evaluation } = context.state;
    if (args.beyond === undefined) return evaluation.mechanism;
    if (!Object.prototype.hasOwnProperty.call(document.mechanism.joints, args.beyond)) throw new QueryFailure('notAvailable', `the mechanism has no joint "${args.beyond}"`, ['beyond']);
    return { ...evaluation.mechanism, beyond: carriedBy(document.mechanism, evaluation.mechanism, args.beyond) };
  },
};

// How the context of a query hands out a body (inside the engine; `posed` stands for the code
// that moves a body and remembers the result). A body in no link is the one of the evaluation;
// a blocked one is not handed out at all.
declare function posed(body: BodyResultAfter, transform: RigidTransform): BodyResultAfter;
export function bodyInPose(state: StateAfter, id: Id): BodyResultAfter {
  const pose = poseOfBody(state.evaluation.mechanism, id);
  if (pose === undefined) return state.evaluation.bodies[id];
  if ('blockedBy' in pose) throw new QueryFailure('failed', `the pose of the body "${id}" is not known: the joint "${pose.blockedBy}" has no motion`);
  return posed(state.evaluation.bodies[id], pose);
}

// How a query about a pair computes: in the frame of its first body. What it remembers by the
// two solids is then found again at every pose in which the two stand to each other the same
// way, and a coordinate of the answer is moved back into the pose.
const move = (t: RigidTransform, p: Vec3): Vec3 => [dot(t.matrix[0], p) + t.translation[0], dot(t.matrix[1], p) + t.translation[1], dot(t.matrix[2], p) + t.translation[2]];
declare function gapOf(a: BodyResultAfter, b: BodyResultAfter, within: number): StandInGapResult; // the computation of 1c, over two bodies
export function gapInPose(context: QueryContext, a: Id, b: Id, within: number): StandInGapResult {
  const [first, second] = [context.bodies[a], context.bodies[b]];
  const pair = pairInFrame(first, second);
  if (!pair) return gapOf(first, second, within);
  const found = context.memo([pair.a.solid, pair.b.solid], `within:${within}`, () => gapOf(pair.a, pair.b, within));
  return found.between ? { distance: found.distance, between: { a: move(pair.back, found.between.a), b: move(pair.back, found.between.b) } } : found;
}

// ---------------------------------------------------------------- e. a joint in error

// The sketch of the axes is suppressed while the pose is zero: both joints are in error, and
// nothing is blocked, because a joint at zero moves nothing whatever its axis is. Every query
// still answers, so the model can be read while the sketch is repaired.
export function brokenAxisAtZero(): { status: string; code: string | undefined; blocked: Id | undefined; answers: boolean } {
  run({ type: 'setPose', values: { shoulder: 0, elbow: 0 } });
  const state = run({ type: 'setSuppressed', id: 'layout', suppressed: true });
  const { joints, links } = state.evaluation.mechanism;
  return {
    status: joints['elbow'].status, // 'error'
    code: joints['elbow'].error?.code, // 'brokenReference'
    blocked: links['forearm'].blockedBy, // undefined
    answers: engine.query('interference', {}).ok, // true
  };
}
// The same with the elbow bent: its motion cannot be computed. A query that needs a body beyond
// it fails and names the joint; one that does not still answers. No query answers for a pose
// that could not be computed.
export function brokenAxisBent(): { blocked: Id | undefined; forearm: string; base: boolean } {
  run({ type: 'setPose', values: { elbow: 1 } });
  const state = run({ type: 'setSuppressed', id: 'layout', suppressed: true });
  const forearm = engine.query('interference', { bodies: ['base', 'forearm'] });
  const base = engine.query('body', { body: 'base' });
  return {
    blocked: state.evaluation.mechanism.links['forearm'].blockedBy, // 'elbow'
    forearm: forearm.ok ? fail('expected an error') : forearm.error.code, // 'failed'
    base: base.ok, // true: the base hangs on no joint
  };
}

// A parameter that takes a value out of the limits of its joint: the command is accepted, the
// joint is in error with the code of this package, and the field keeps its last valid number.
export function outOfLimits(): string | undefined {
  run({ type: 'setParameter', name: 'q', expr: '0' }, { type: 'setPose', values: { elbow: 'q' } });
  const state = run({ type: 'setParameter', name: 'q', expr: '4' });
  const error = state.evaluation.mechanism.joints['elbow'].error;
  return error?.code === 'jointOutOfLimits' ? error.message : fail('expected the joint to be out of its limits');
}

// A body the link lists and the model no longer has: the link poses the others and says which
// one is missing; what hangs on the shoulder says so as well.
export function missingBody(): { link: Id[]; beyondShoulder: Id[] } {
  const state = run({ type: 'setSuppressed', id: 'motor', suppressed: true });
  return { link: state.evaluation.mechanism.links['upper'].missing, beyondShoulder: carriedBy(state.document.mechanism, state.evaluation.mechanism, 'shoulder').missing }; // ['motor'], ['motor']
}

// ---------------------------------------------------------------- f. save, load and the description for the AI

export const stepIsPending = (): boolean => SCHEMA_PENDING >= 1 && UPGRADES.some((step) => step.name === MECHANISM_STEP.name);
// A document without the section gets an empty mechanism.
export const upgraded = MECHANISM_STEP.run({ schemaVersion: 3, settings: { chordTolerance: 0.01 }, parameters: [], checks: [], features: [], bodyProperties: {} });
// A field of a joint that this build does not know (the effort limit that 5b adds) is refused,
// not dropped: the validators of a link and of a joint list the fields they allow.
export function unknownField(): boolean {
  const saved = JSON.parse(engine.save()) as { mechanism: { joints: Record<Id, object> } };
  saved.mechanism.joints['elbow'] = { ...saved.mechanism.joints['elbow'], effort: 2.5 };
  return !engine.load(JSON.stringify(saved)).ok; // true: invalidDocument
}
// A document whose axis sketch was removed loads: the reference is checked by a command that
// sets it, not by a load, and the joint is in error in the result.
export function loadsWithoutItsAxis(): boolean {
  run({ type: 'removeFeature', id: 'layout' });
  const loaded = engine.load(engine.save());
  return loaded.ok && loaded.state.evaluation.mechanism.joints['elbow'].error?.code === 'brokenReference';
}
// The numeric fields of a joint, by kind, as `describe_api` lists them.
export const numericFields = (): string[] => SECTION_INFO.mechanism.fields.map((field) => `${field.owner}: ${field.path} (${field.spec.unit}${field.when ? `, when ${field.when.path} is ${field.when.equals}` : ''})`);
