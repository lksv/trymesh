// Package 5e written out as calls: the member of the kernel port in the adapter, the answer about
// one pair with a second opinion, the report that reads it, the gap that follows, the fakes of
// the tests, and its part of validation scenario 13 (the elbow of the arm stepped through poses
// of which the kernel refuses some). Only type-checked (`npx tsc -p docs/d36/tsconfig.json`).
// A step that cannot be written here is a hole in the contract. Lines marked `@ts-expect-error`
// are calls that must not compile.
//
// Second version, after the first round of review (design.md, "Reviews").
//
// The numbers in the comments were measured on 2026-11-16 through the real kernel on the arm of
// `packages/scenarios/test/scenario13.test.ts` (chord tolerance 0.01 mm); design.md, "Measured".
// Whether the adapter refuses a pair depends on which of the two bodies it is given first, so
// every number says the order it was measured in.

import type { BodyResult, BooleanOp, Id, InterferenceReport, Solid, SolidKernel } from '../../../packages/engine/src/index';
import type { QueryOutcome } from '../00-prep/contract';
import type { GapReport } from '../1c-gap/contract';
import type { EngineWithPose } from '../5a-mechanism/contract';
import type { ComputedMesh, Measured, SharedVolumeAfter } from './contract';
import { SECOND_OPINION_TRIANGLES, failedMessage, verdictOf, volumeOfPieces } from './contract';

declare function fail(message: string): never;
const unwrap = <T>(outcome: QueryOutcome<T>): T => (outcome.ok ? outcome.result : fail(`${outcome.error.code}: ${outcome.error.message}`));
const text = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// ---------------------------------------------------------------- a. the adapter of Manifold

// `rawBoolean` of packages/kernel-manifold/src/index.ts, as it is: it checks both inputs
// (`inputProblem`), calls the library, throws when the library reports an error, copies the
// arrays out of the memory of the library and frees its objects. `isClosed` of `clean.ts`: every
// edge in two triangles, once each way. The member is those two and nothing else: no `clean`, no
// `isFolded`, no tolerances.
declare function rawBoolean(op: BooleanOp, a: Solid, b: Solid): Solid;
declare function isClosed(solid: Solid): boolean;
export const intersectionAsComputed: SolidKernel['intersectionAsComputed'] = (a, b) => {
  const mesh = rawBoolean('intersection', a, b);
  if (!isClosed(mesh)) throw new Error('the intersection as computed is not closed by its indices');
  return { unverified: mesh };
};

// ---------------------------------------------------------------- b. one pair

// The measure of a mesh two bodies share: the body of `sharedBy` of today between its `try` and
// its `return` (`depthOf`, `round`, the slack), with the volume handed in. It throws when the
// volume is not a number.
declare function measure(common: Solid, volume: number, a: BodyResult, b: BodyResult, tolerance: number): Measured;
declare function volumeOf(solid: Solid): number; // solid.ts

// `sharedBy` with the second opinion.
// - The second opinion is asked only when `boolean` threw, with the two bodies in the same order.
//   Where the adapter answers, its answer stands and the member is not called: no pair that is
//   answered today gets another answer or costs more.
// - When the adapter answered and its mesh cannot be measured (a volume that is not a number),
//   the pair is failed as today and the second opinion is not asked: a kernel that answers with
//   such a mesh is not asked again.
// - When the second call throws, or its mesh cannot be measured or is larger than the measure
//   takes on, the pair keeps the reason of the first refusal and has no second opinion.
// - The volume of a verified mesh is the absolute value of the whole, as today; that of a mesh as
//   computed is added piece by piece.
export function sharedByAfter(kernel: SolidKernel, a: BodyResult, b: BodyResult, tolerance: number): SharedVolumeAfter {
  let common: Solid;
  try {
    common = kernel.boolean('intersection', a.solid, b.solid);
  } catch (refusal) {
    const message = text(refusal);
    try {
      const computed: ComputedMesh = kernel.intersectionAsComputed(a.solid, b.solid);
      const mesh = computed.unverified;
      if (mesh.triangles.length / 3 > SECOND_OPINION_TRIANGLES) return { message: `${message}; the intersection as computed has more than ${SECOND_OPINION_TRIANGLES} triangles and was not measured` };
      return { message, asComputed: measure(mesh, volumeOfPieces(mesh), a, b, tolerance) };
    } catch {
      return { message };
    }
  }
  try {
    return measure(common, Math.abs(volumeOf(common)), a, b, tolerance);
  } catch (error) {
    return { message: text(error) };
  }
}

// ---------------------------------------------------------------- c. the report

// One pair of `interferenceReport`, after the boxes: where it goes. The threshold is that of the
// call, the tolerance the chord tolerance of the document; the second opinion is judged by the
// same function and the same numbers as an answer of the adapter.
// - `pairs` and `fits` are written in one place, from an answer of the adapter.
// - A second opinion that says `collision` changes nothing: the pair is failed, and the message
//   says what was measured.
// - A second opinion that clears the pair puts it into `cleared`, and nowhere else.
export function place(report: InterferenceReport, a: Id, b: Id, result: SharedVolumeAfter, threshold: number, tolerance: number): void {
  if (!('message' in result)) {
    const verdict = verdictOf(result, threshold, tolerance);
    if (verdict !== 'nothing') (verdict === 'fit' ? report.fits : report.pairs).push({ a, b, volume: result.volume, depth: result.depth });
    return;
  }
  const second = result.asComputed;
  const kind = second === undefined ? undefined : verdictOf(second, threshold, tolerance);
  if (second === undefined || kind === undefined) report.failed.push({ a, b, message: result.message });
  else if (kind === 'collision') report.failed.push({ a, b, message: failedMessage(result.message, second) });
  else (report.cleared ??= []).push({ a, b, kind, volume: second.volume, depth: second.depth });
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

// ---------------------------------------------------------------- d. the gap follows

// `sharedBy` of `query/gap.ts` after its edit: what the collisions say about one pair, for the
// kind of a zero and for the question whether one body lies inside the other. The report is that
// of the entry `interference` asked about the two bodies with the default threshold.
// - A pair cleared as a fit is a fit; a pair cleared as nothing touches (and, where the surfaces
//   do not meet, the gap goes on to its distance).
// - `cleared` travels with the answer, into what is remembered for the pair of meshes and from
//   there into `cleared` of the report of the gap.
type Contact = 'touching' | 'fit' | 'collision' | 'unknown';
export function contactOf(shared: InterferenceReport): { contact: Contact; message?: string; cleared: boolean } {
  if (shared.failed.length) return { contact: 'unknown', message: shared.failed[0].message, cleared: false };
  const cleared = shared.cleared?.[0];
  if (cleared) return { contact: cleared.kind === 'fit' ? 'fit' : 'touching', cleared: true };
  return { contact: shared.pairs.length ? 'collision' : shared.fits.length ? 'fit' : 'touching', cleared: false };
}

// ---------------------------------------------------------------- e. the fakes of the tests

// A kernel that refuses every intersection and answers the rest: with it the second opinion
// decides every pair that reaches the kernel, so the models of
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
// A kernel that passes everything on and notes what happened: how often the member was asked
// (never where `boolean` answers), and which intersections the adapter refused, by the two
// meshes in the order they were given.
export function watching(real: SolidKernel): { kernel: SolidKernel; asked: () => number; refused: () => [Solid, Solid][] } {
  let asked = 0;
  const refused: [Solid, Solid][] = [];
  const kernel: SolidKernel = {
    ...real,
    boolean: (op, a, b) => {
      try {
        return real.boolean(op, a, b);
      } catch (error) {
        if (op === 'intersection') refused.push([a, b]);
        throw error;
      }
    },
    intersectionAsComputed: (a, b) => (asked++, real.intersectionAsComputed(a, b)),
  };
  return { kernel, asked: () => asked, refused: () => refused };
}

// What the test holds for every model of `bodies.test.ts`, asked once of the real kernel
// (`verified`) and once of `refusing(real)` (`second`), with the same threshold:
// - nothing is a collision or a fit by the second opinion (`onlyCleared`);
// - a pair the kernel verified as a collision is failed, never cleared (`noCollisionCleared`);
// - a pair the second opinion did not clear although the kernel verified it clear is allowed
//   (the mesh as computed errs towards a collision on flush faces); the test counts them
//   (`notCleared`);
// - a cleared pair whose kind is not the verified one (a fit where the kernel verified nothing,
//   or the reverse) is listed (`otherKind`). On the models of that file there is none, and the
//   test asserts that for them; it is not a property of the rule.
export function holds(verified: InterferenceReport, second: InterferenceReport): { onlyCleared: boolean; noCollisionCleared: boolean; notCleared: number; otherKind: [Id, Id][] } {
  const key = (pair: { a: Id; b: Id }) => `${pair.a}\u0000${pair.b}`;
  const cleared = new Map((second.cleared ?? []).map((pair) => [key(pair), pair.kind]));
  const failed = new Set(second.failed.map(key));
  const notClear = new Set([...verified.pairs, ...verified.failed].map(key));
  const fits = new Set(verified.fits.map(key));
  return {
    onlyCleared: second.pairs.length === 0 && second.fits.length === 0,
    noCollisionCleared: verified.pairs.every((pair) => !cleared.has(key(pair)) && failed.has(key(pair))),
    notCleared: second.failed.filter((pair) => !notClear.has(key(pair))).length,
    otherKind: (second.cleared ?? []).filter((pair) => (pair.kind === 'fit') !== fits.has(key(pair))).map((pair): [Id, Id] => [pair.a, pair.b]),
  };
}

// ---------------------------------------------------------------- f. below the engine's ordering: the three poses of the backlog

// The pin of the forearm, radius 4, in the hole of `upper`: the angles of the recipe over ±88°,
// `lower + (upper − lower) · frac(k · 0.6180339887)`. At k = 57, 23 and 24 (−47.883°, −50.198°
// and 58.576°) the adapter refuses the pair `(upper, forearm turned)` ("not a closed surface" at
// the first, "a folded triangle" at the other two) and answers the same two meshes given the
// other way round. The mesh as computed is 888, 854 and 880 triangles and measures 0.028, 0.390
// and 0.427 mm³ at a depth of 0.0006, 0.0078 and 0.0085 mm, with a round face and no planar
// reach: a fit each time.
const angleOf = (k: number, lower: number, upper: number): number => lower + (upper - lower) * ((k * 0.6180339887) % 1);
export const REFUSED_PARENT_FIRST = [57, 23, 24].map((k) => (angleOf(k, -88, 88) * Math.PI) / 180);
// The bodies as modelled come from the engine; the pose is made by hand, as the spike made it.
declare function turned(body: BodyResult, about: [number, number, number], axis: [number, number, number], angle: number): BodyResult; // `transformSolid` with the bounds of the moved mesh
export function backlogPose(kernel: SolidKernel, upper: BodyResult, forearm: BodyResult, angle: number, tolerance: number): { refused: boolean; kind: string } {
  const child = turned(forearm, [120, 0, 0], [0, 0, 1], angle);
  const answer = sharedByAfter(kernel, upper, child, tolerance); // the parent first: the order is the test's
  if (!('message' in answer)) return { refused: false, kind: verdictOf(answer, 0.001, tolerance) };
  return { refused: true, kind: answer.asComputed ? verdictOf(answer.asComputed, 0.001, tolerance) : 'none' }; // { refused: true, kind: 'fit' } at each
}

// ---------------------------------------------------------------- g. scenario 13: the elbow stepped, through the engine

// The arm of 5a (`describe` of 5a-mechanism/calls.ts), the engine built over `watching(real)`.
// The engine orders the pair by its IDs and 5a computes it in the frame of its first body, so
// the kernel is asked `(forearm, upper turned back)`, and the refused steps are other steps than
// those of the backlog. The test does not name them beforehand: it steps the first 40 angles of
// the recipe and reads from the watching kernel at which the adapter refused. (Measured in that
// order: one of the 40, k = 5, −72.130°, where the mesh as computed is a fit of 0.031 mm³.)
declare const engine: EngineWithPose;
declare const watch: ReturnType<typeof watching>;
interface Step {
  value: number;
  refused: boolean; // the adapter refused an intersection at this step
  pairs: number;
  fits: [Id, Id][];
  failed: [Id, Id][];
  cleared: [Id, Id, string][];
}
const ids = (list: { a: Id; b: Id }[]) => list.map((pair): [Id, Id] => [pair.a, pair.b]);
export function elbowAt(value: number): Step {
  const preview = engine.preview({ type: 'setPose', values: { elbow: value } });
  if (!preview.ok) return fail(preview.error.message);
  const before = watch.refused().length;
  const report = unwrap(engine.query('interference', {}, { state: preview.state }));
  return { value, refused: watch.refused().length > before, pairs: report.pairs.length, fits: ids(report.fits), failed: ids(report.failed), cleared: (report.cleared ?? []).map((pair): [Id, Id, string] => [pair.a, pair.b, pair.kind]) };
}
export const sweep = (): Step[] => Array.from({ length: 40 }, (_, i) => elbowAt((angleOf(i + 1, -88, 88) * Math.PI) / 180));
// What the test holds of the sweep:
// - at least one step is refused (otherwise the test tests nothing, and says so);
// - at a refused step: { pairs: 0, failed: [], cleared: [['forearm', 'upper', 'fit']] }, and
//   `fits` without that pair. With 5a alone the same step has failed: [['forearm', 'upper']];
// - at every step: nothing in `failed` and nothing in `pairs` (the range ends below the quarter
//   turn at which the forearm reaches the screws).
export const refusedSteps = (steps: Step[]): Step[] => steps.filter((step) => step.refused);

// A step of a sweep is clear by the rule of 5a, which does not change: no colliding pair and no
// failed pair. A step whose pin was cleared is clear, and says by `cleared` how it is known.
export const clear = (step: Step): boolean => step.pairs === 0 && step.failed.length === 0;

// The gap at a refused step: `contact` of the pin and its hole is 'fit', where 5a alone answers
// 'unknown', and the report of the gap names the pair in its own `cleared`.
export function gapAt(value: number): { contact: string; cleared: [Id, Id][] } {
  const preview = engine.preview({ type: 'setPose', values: { elbow: value } });
  if (!preview.ok) return fail(preview.error.message);
  const report: GapReport = unwrap(engine.query('gap', { bodies: ['forearm', 'upper'] }, { state: preview.state }));
  const pair = report.pairs[0] ?? fail('the pin is in its hole');
  return { contact: pair.contact ?? fail('a pin in its hole has no gap'), cleared: ids(report.cleared ?? []) }; // { contact: 'fit', cleared: [['forearm', 'upper']] }
}
