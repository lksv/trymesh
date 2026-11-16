// Poses below the engine's ordering for the tests of the second opinion of the kernel (D50,
// docs/d36/5e-kernel-second/design.md, "Measured" and "Tests"): the models are built through the
// engine with the real adapters, so the polygons are those of the model, and a body is posed by
// hand as the spike of the design posed it (`movedBody`: the mesh moved in single precision, with
// the bounds of the moved mesh). Whether the adapter refuses a pair depends on which body it is
// given first, so the pair is asked in the order the test states.
import { type BodyResult, type Command, type InterferenceReport, type SolidKernel, createEngine } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { interferenceReport, sharedBy } from '../../engine/src/interference';
import { movedBody } from '../../engine/src/query/pose';
import { compose, rotation, shift, transformPoint, transformVector } from '../../engine/src/solid';
import type { RigidTransform, Vec3 } from '../../engine/src/types';
import { cylinder } from './arm';
import { run } from './kit';

export const kernel = await createManifoldKernel();
const solver = await createPlanegcsSolver();
export const TOLERANCE = 0.01; // the chord tolerance of a new document

// The bodies of a model built by `commands` through the engine.
export function built(...commands: Command[]): Record<string, BodyResult> {
  const engine = createEngine({ solver, kernel });
  run(engine, ...commands);
  return engine.getState().evaluation.bodies;
}

// The angles of the recipe of the spike, in degrees: k = 0 and k = -1 are the two ends of the
// range, k = 1, 2, … are `lower + (upper − lower) · frac(k · 0.6180339887)`.
export const angleOf = (k: number, lower: number, upper: number): number => (k === 0 ? lower : k === -1 ? upper : lower + (upper - lower) * ((k * 0.6180339887) % 1));
export const DEG = Math.PI / 180;

// Askew to the axes of the model: the turn of 0.7 rad about (1, 2, 3) through the origin, then the
// shift (37.3, −12.9, 55.1); `away` shifts it further along X (the flush model two metres away).
export const askew = (away = 0): RigidTransform => {
  const placed: RigidTransform = { ...rotation([0, 0, 0], [1, 2, 3], 0.7), translation: [37.3, -12.9, 55.1] };
  return away === 0 ? placed : compose(shift([1, 0, 0], away), placed);
};
// A body placed by `place` (rounded to single precision), then turned about the placed axis
// through `about` along `axis` (and rounded again).
export function turned(body: BodyResult, place: RigidTransform | undefined, about: Vec3, axis: Vec3, degrees: number): BodyResult {
  const placed = place ? movedBody(body, place) : body;
  return movedBody(placed, rotation(place ? transformPoint(place, about) : about, place ? transformVector(place, axis) : axis, degrees * DEG));
}
// A body placed by `place`, then slid along the placed X.
export function slid(body: BodyResult, place: RigidTransform, distance: number): BodyResult {
  return movedBody(movedBody(body, place), shift(transformVector(place, [1, 0, 0]), distance));
}
export const placed = (body: BodyResult, place: RigidTransform | undefined): BodyResult => (place ? movedBody(body, place) : body);

// The report about one pair, asked of `kernel` with the two bodies in the order given (the report
// names them `a` and `b`), with the default threshold.
export function judged(first: BodyResult, second: BodyResult, using: SolidKernel = kernel): InterferenceReport {
  return interferenceReport({ a: first, b: second }, undefined, 0.001, TOLERANCE, () => ({ a: first, b: second }), (x, y) => sharedBy(using, x, y, TOLERANCE));
}
// Whether the adapter refuses the intersection of the two, in that order.
export function refused(first: BodyResult, second: BodyResult): boolean {
  try {
    kernel.boolean('intersection', first.solid, second.solid);
    return false;
  } catch {
    return true;
  }
}

// The flush model of the design: `upper` (radius 70 about (60, 0), z from 0 to 8, a hole of radius
// 4 at (120, 0)), a plate (radius 70 about (180, 0), z from 8 to 16, or `sunk` lower) and a washer
// (radius 6 about (100, 20), z from 8 to 10, a hole of radius 3); no pin.
export const flushModel = (sunk = 0): Command[] => [
  ...cylinder('upper', 60, 0, 70, 0, 8),
  ...cylinder('hole', 120, 0, 4, -1, 9, 'cut', 'upper'),
  ...cylinder('plate', 180, 0, 70, 8 - sunk, 16),
  ...cylinder('washer', 100, 20, 6, 8, 10),
  ...cylinder('washerHole', 100, 20, 3, 7, 11, 'cut', 'washer'),
];
