// Package 5e written out as calls: the member of the kernel port in the adapter, the answer about
// one pair with a second opinion, the report that reads it, the fakes of the tests, and its part
// of validation scenario 13 (the elbow of the arm at the three poses the kernel refuses). Only
// type-checked (`npx tsc -p docs/d36/tsconfig.json`). A step that cannot be written here is
// a hole in the contract. Lines marked `@ts-expect-error` are calls that must not compile.
//
// The numbers in the comments were measured on 2026-11-16 through the real kernel on the arm of
// `packages/scenarios/test/scenario13.test.ts` (chord tolerance 0.01 mm), posed as the design of
// 5a says the context will pose it; design.md, "Measured". They become the expectations of the
// tests.

import type { BodyResult, BooleanOp, Id, InterferenceReport, Solid, SolidKernel } from '../../../packages/engine/src/index';
import type { QueryOutcome } from '../00-prep/contract';
import type { EngineWithPose } from '../5a-mechanism/contract';
import type { ComputedMesh, Measured, SharedVolumeAfter } from './contract';
import { failedMessage, verdictOf } from './contract';

declare function fail(message: string): never;
const unwrap = <T>(outcome: QueryOutcome<T>): T => (outcome.ok ? outcome.result : fail(`${outcome.error.code}: ${outcome.error.message}`));
const text = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// ---------------------------------------------------------------- a. the adapter of Manifold

// `rawBoolean` of packages/kernel-manifold/src/index.ts, as it is: it checks both inputs
// (`inputProblem`), calls the library, throws when the library reports an error, copies the
// arrays out of the memory of the library and frees its objects. The member is that call for an
// intersection and nothing else: no `clean`, no `isClosed`, no `isFolded`.
declare function rawBoolean(op: BooleanOp, a: Solid, b: Solid): Solid;
export const intersectionAsComputed: SolidKernel['intersectionAsComputed'] = (a, b) => ({ unverified: rawBoolean('intersection', a, b) });

// ---------------------------------------------------------------- b. one pair

// The measure of a mesh two bodies share: the body of `sharedBy` of today between its `try` and
// its `return` (the volume, `depthOf`, `round`, the slack). It throws when the volume is not
// a number.
declare function measure(common: Solid, a: BodyResult, b: BodyResult, tolerance: number): Measured;

// `sharedBy` with the second opinion.
// - The second opinion is asked only when `boolean` threw. Where the adapter answers, its answer
//   stands and the member is not called: no pair that is answered today gets another answer or
//   costs more.
// - When the adapter answered and its mesh cannot be measured (a volume that is not a number),
//   the pair is failed as today and the second opinion is not asked: a kernel that answers with
//   such a mesh is not asked again.
// - When the second call throws, or its mesh cannot be measured, the pair keeps the reason of the
//   first refusal and has no second opinion.
export function sharedByAfter(kernel: SolidKernel, a: BodyResult, b: BodyResult, tolerance: number): SharedVolumeAfter {
  let common: Solid;
  try {
    common = kernel.boolean('intersection', a.solid, b.solid);
  } catch (refusal) {
    const message = text(refusal);
    try {
      const computed: ComputedMesh = kernel.intersectionAsComputed(a.solid, b.solid);
      return { message, asComputed: measure(computed.unverified, a, b, tolerance) };
    } catch {
      return { message };
    }
  }
  try {
    return measure(common, a, b, tolerance);
  } catch (error) {
    return { message: text(error) };
  }
}

// ---------------------------------------------------------------- c. the report

// One pair of `interferenceReport`, after the boxes: where it goes. The threshold is that of the
// call, the tolerance the chord tolerance of the document; the second opinion is judged by the
// same function and the same numbers as an answer of the adapter.
// - `pairs` is written in one place, from an answer of the adapter.
// - A second opinion that says `collision` changes nothing: the pair is failed, and the message
//   says what was measured.
export function place(report: InterferenceReport, a: Id, b: Id, result: SharedVolumeAfter, threshold: number, tolerance: number): void {
  if (!('message' in result)) {
    const verdict = verdictOf(result, threshold, tolerance);
    if (verdict !== 'nothing') (verdict === 'fit' ? report.fits : report.pairs).push({ a, b, volume: result.volume, depth: result.depth });
    return;
  }
  const second = result.asComputed;
  const verdict = second === undefined ? 'collision' : verdictOf(second, threshold, tolerance);
  if (second === undefined || verdict === 'collision') {
    report.failed.push({ a, b, message: second === undefined ? result.message : failedMessage(result.message, second) });
    return;
  }
  if (verdict === 'fit') report.fits.push({ a, b, volume: second.volume, depth: second.depth });
  (report.cleared ??= []).push({ a, b });
}

// The mesh as computed is not a solid, and the type says so.
export function notASolid(kernel: SolidKernel, a: Solid, b: Solid, body: BodyResult): void {
  const computed = kernel.intersectionAsComputed(a, b);
  // @ts-expect-error a mesh as computed is not the input of another operation
  kernel.boolean('union', a, computed);
  // @ts-expect-error nor the solid of a body
  const posed: BodyResult = { ...body, solid: computed };
  void posed;
}

// ---------------------------------------------------------------- d. the fakes of the tests

// A kernel that refuses every intersection and answers the rest: with it the second opinion
// decides every pair that reaches the kernel, so the whole table of cases of
// `packages/scenarios/test/bodies.test.ts` can be asked of it. (The switch `watch.fail` that the
// fakes of that file and of `gap.test.ts` have today becomes `refusingBoth` below, so the tests
// that expect a failed pair keep their expectations; this one is a second switch.)
export const refusing = (real: SolidKernel): SolidKernel => ({
  ...real,
  boolean: (op, a, b) => (op === 'intersection' ? fail('the kernel gave up') : real.boolean(op, a, b)),
});
// A kernel that refuses both ways: the pair is failed with the reason of the first refusal, as
// every refused pair is today.
export const refusingBoth = (real: SolidKernel): SolidKernel => ({ ...refusing(real), intersectionAsComputed: () => fail('the kernel gave up again') });
// A kernel that counts: where `boolean` answers, the member is never called.
export function counting(real: SolidKernel): { kernel: SolidKernel; asked: () => number } {
  let asked = 0;
  return { kernel: { ...real, intersectionAsComputed: (a, b) => (asked++, real.intersectionAsComputed(a, b)) }, asked: () => asked };
}

// What the test holds for every case of the table, asked once of the real kernel (`verified`)
// and once of `refusing(real)` (`second`), with the same threshold:
// - nothing is a collision by the second opinion;
// - a pair the kernel verified as a collision is failed, never cleared;
// - a pair that is cleared has the verdict the kernel verified: a fit is a fit, nothing is
//   nothing;
// - a pair the second opinion did not clear although the kernel verified it clear is allowed
//   (the mesh as computed errs towards a collision on flush faces); the test counts them.
export function holds(verified: InterferenceReport, second: InterferenceReport): { neverACollision: boolean; noCollisionCleared: boolean; notCleared: number } {
  const key = (pair: { a: Id; b: Id }) => `${pair.a}\u0000${pair.b}`;
  const cleared = new Set((second.cleared ?? []).map(key));
  const failed = new Set(second.failed.map(key));
  const notClear = new Set([...verified.pairs, ...verified.failed].map(key));
  return {
    neverACollision: second.pairs.length === 0,
    noCollisionCleared: verified.pairs.every((pair) => !cleared.has(key(pair)) && failed.has(key(pair))),
    notCleared: second.failed.filter((pair) => !notClear.has(key(pair))).length,
  };
}

// ---------------------------------------------------------------- e. scenario 13: the elbow where the kernel refuses its pin

// The arm of 5a (`describe` of 5a-mechanism/calls.ts): the pin of the forearm, radius 4, in the
// hole of `upper`. At these three values of the elbow the adapter refuses the intersection of
// the two ("not a closed surface" at the first, "a folded triangle" at the other two). The mesh
// as computed is 888, 854 and 880 triangles and measures 0.028, 0.390 and 0.427 mm³ at a depth
// of 0.0006, 0.0078 and 0.0085 mm, with a round face and no planar reach: a fit each time.
export const REFUSED_ELBOW = [-47.883, -50.198, 58.576].map((degrees) => (degrees * Math.PI) / 180);

declare const engine: EngineWithPose;
interface Step {
  pairs: number;
  fits: [Id, Id][];
  failed: [Id, Id][];
  cleared: [Id, Id][];
}
const ids = (list: { a: Id; b: Id }[] | undefined) => (list ?? []).map((pair): [Id, Id] => [pair.a, pair.b]);
export function elbowAt(value: number): Step {
  const preview = engine.preview({ type: 'setPose', values: { elbow: value } });
  if (!preview.ok) return fail(preview.error.message);
  const report = unwrap(engine.query('interference', {}, { state: preview.state }));
  return { pairs: report.pairs.length, fits: ids(report.fits), failed: ids(report.failed), cleared: ids(report.cleared) };
}
// With 5a alone: { pairs: 0, fits: [], failed: [['forearm', 'upper']], cleared: [] } at each.
// With this package: { pairs: 0, fits: [['forearm', 'upper']], failed: [], cleared: [['forearm', 'upper']] }.
export const refusedSteps = (): Step[] => REFUSED_ELBOW.map(elbowAt);

// A step of a sweep is clear by the rule of 5a, which does not change: no colliding pair and no
// failed pair. A step whose pin was cleared is clear, and says by `cleared` how it is known.
export const clear = (step: Step): boolean => step.pairs === 0 && step.failed.length === 0;

// The gap of 1c asks the collisions about a pair whose surfaces meet, so it follows without
// a change of its own: `contact` of the pin and its hole at these poses is 'fit', where 5a alone
// answers 'unknown'.
export function contactAt(value: number): string {
  const preview = engine.preview({ type: 'setPose', values: { elbow: value } });
  if (!preview.ok) return fail(preview.error.message);
  const pair = unwrap(engine.query('gap', { bodies: ['forearm', 'upper'] }, { state: preview.state })).pairs[0] ?? fail('the pin is in its hole');
  return pair.contact ?? fail('a pin in its hole has no gap'); // 'fit'
}
