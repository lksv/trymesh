// The second opinion of the kernel for a pair it refuses (D50), with kernels written by hand: the
// answer about one pair (`sharedBy`), the report that reads it (`interferenceReport`), the volume
// of a mesh piece by piece, and the memory of the query. The engine package has no adapter; the
// real one is asked in packages/scenarios/test/second-opinion.test.ts.
import { describe, expect, it } from 'vitest';
import { emptyDocument } from '../src/document';
import { SECOND_OPINION_TRIANGLES, failedMessage, interferenceReport, sharedBy, verdictOf } from '../src/interference';
import { Memo, queryContext } from '../src/query/context';
import { QUERIES } from '../src/query/index';
import type { State } from '../src/recompute/state';
import { DOCUMENT_SECTIONS } from '../src/sections/index';
import { volumeOf, volumeOfPieces } from '../src/solid';
import type { BodyResult, Evaluation, InterferenceReport, Solid, SolidKernel, Vec3 } from '../src/types';

// A box as a closed mesh, outward; `faces` numbers its six sides: -z, +z, -y, +y, -x, +x.
function cuboid(min: Vec3, max: Vec3, faces: number[]): Solid {
  const corner = (i: number): number[] => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  return {
    positions: Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7].flatMap(corner)),
    triangles: Uint32Array.from(quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d])),
    faceIds: Uint32Array.from(faces.flatMap((face) => [face, face])),
  };
}
const inverted = (solid: Solid): Solid => ({ ...solid, triangles: Uint32Array.from(solid.triangles, (_, i) => solid.triangles[i - (i % 3) + [0, 2, 1][i % 3]]) });
function together(...solids: Solid[]): Solid {
  const positions: number[] = [];
  const triangles: number[] = [];
  const faceIds: number[] = [];
  for (const solid of solids) {
    const offset = positions.length / 3;
    positions.push(...solid.positions);
    triangles.push(...[...solid.triangles].map((vertex) => vertex + offset));
    faceIds.push(...solid.faceIds);
  }
  return { positions: Float32Array.from(positions), triangles: Uint32Array.from(triangles), faceIds: Uint32Array.from(faceIds) };
}
const EMPTY: Solid = { positions: new Float32Array(0), triangles: new Uint32Array(0), faceIds: new Uint32Array(0) };
const body = (min: Vec3, max: Vec3, faces: number[], round: number[] = []): BodyResult => {
  const solid = cuboid(min, max, faces);
  return { solid, faces: faces.map((id) => ({ id, planar: !round.includes(id) })), edges: [], volume: volumeOf(solid), bounds: { min, max } };
};

// A block A 10 × 10 × 10 (faces 0 to 5) and a block B beside it along X (faces 10 to 15) that
// enters it by `into`. With `round`, the faces of B count as round (a pin in its hole, say).
const A_FACES = [0, 1, 2, 3, 4, 5];
const B_FACES = [10, 11, 12, 13, 14, 15];
const blocks = (into: number, round = false) => ({
  a: body([0, 0, 0], [10, 10, 10], A_FACES),
  b: body([10 - into, 0, 0], [20 - into, 10, 10], B_FACES, round ? B_FACES : []),
  // what they share, as an adapter would compute it: the face at x = 10 is A's, the others B's
  common: cuboid([10 - into, 0, 0], [10, 10, 10], [10, 11, 12, 13, 14, 5]),
});

// A kernel that refuses every intersection and answers its intersection as computed by `computed`,
// counting the calls of each member.
function refusing(computed: () => Solid, answer?: Solid) {
  const calls = { boolean: 0, asComputed: 0 };
  const kernel: SolidKernel = {
    boolean: () => {
      calls.boolean++;
      if (answer) return answer;
      throw new Error('the kernel refused');
    },
    intersectionAsComputed: () => {
      calls.asComputed++;
      return { unverified: computed() };
    },
    triangulate: () => new Uint32Array(),
  };
  return { kernel, calls };
}
const TOLERANCE = 0.01;
const report = (kernel: SolidKernel, a: BodyResult, b: BodyResult, threshold = 0.001): InterferenceReport =>
  interferenceReport({ A: a, B: b }, undefined, threshold, TOLERANCE, () => ({ a, b }), (x, y) => sharedBy(kernel, x, y, TOLERANCE));

describe('the second opinion of the kernel (D50)', () => {
  it('a refused pair whose mesh as computed has no triangles is cleared as nothing', () => {
    const { a, b } = blocks(1);
    const { kernel } = refusing(() => EMPTY);
    expect(report(kernel, a, b)).toEqual({ pairs: [], fits: [], failed: [], cleared: [{ a: 'A', b: 'B', kind: 'nothing', volume: 0, depth: 0 }], checked: 1 });
  });

  it('a refused pair that measures as a collision stays failed, with what was measured in the message, and is never in `pairs`', () => {
    const { a, b, common } = blocks(1);
    const { kernel } = refusing(() => common);
    const answer = report(kernel, a, b);
    expect(answer).toEqual({ pairs: [], fits: [], failed: [{ a: 'A', b: 'B', message: 'the kernel refused; as computed the two share 100 mm³, 1 mm deep, which the kernel could not verify' }], checked: 1 });
    expect(answer.cleared).toBeUndefined();
    // three significant digits
    expect(failedMessage('no', { volume: 6.04381, depth: 0.0393871, planar: 0, round: true, slack: 0 })).toBe('no; as computed the two share 6.04 mm³, 0.0394 mm deep, which the kernel could not verify');
  });

  it('a refused pair of round faces within the tolerance is cleared as a fit, and not put among the fits', () => {
    const { a, b, common } = blocks(0.005, true);
    const { kernel } = refusing(() => common);
    const answer = report(kernel, a, b);
    expect(answer).toMatchObject({ pairs: [], fits: [], failed: [], cleared: [{ a: 'A', b: 'B', kind: 'fit', volume: expect.closeTo(0.5, 4), depth: expect.closeTo(0.005, 5) }] });
    // the same mesh verified by the kernel is a fit
    expect(report(refusing(() => EMPTY, common).kernel, a, b)).toMatchObject({ fits: [{ a: 'A', b: 'B' }], failed: [] });
  });

  it('without a second opinion the pair is failed with the reason of the refusal alone', () => {
    const { a, b } = blocks(1);
    const thrown: SolidKernel = { ...refusing(() => EMPTY).kernel, intersectionAsComputed: () => { throw new Error('the kernel gave up again'); } };
    expect(report(thrown, a, b).failed).toEqual([{ a: 'A', b: 'B', message: 'the kernel refused' }]);
    // a coordinate that is not a number: the volume is not a number
    const broken = cuboid([9, 0, 0], [10, 10, 10], [10, 11, 12, 13, 14, 5]);
    broken.positions[0] = Number.NaN;
    expect(report(refusing(() => broken).kernel, a, b).failed).toEqual([{ a: 'A', b: 'B', message: 'the kernel refused' }]);
    // a mesh above the bound of the work is not measured, and the message says so
    const large = together(...Array.from({ length: Math.ceil(SECOND_OPINION_TRIANGLES / 12) + 1 }, (_, i) => cuboid([9.5, 0, i * 1e-3], [9.5005, 1e-3, (i + 1) * 1e-3], [10, 11, 12, 13, 14, 5])));
    expect(large.triangles.length / 3).toBeGreaterThan(SECOND_OPINION_TRIANGLES);
    const { kernel, calls } = refusing(() => large);
    expect(report(kernel, a, b)).toMatchObject({ pairs: [], fits: [], failed: [{ a: 'A', b: 'B', message: `the kernel refused; the intersection as computed has more than ${SECOND_OPINION_TRIANGLES} triangles and was not measured` }] });
    expect(calls.asComputed).toBe(1);
  });

  it('the volume of a mesh as computed is added piece by piece: a piece inside out does not subtract', () => {
    const lump = cuboid([0, 0, 0], [1, 1, 1], [0, 0, 0, 0, 0, 0]);
    const noise = inverted(cuboid([5, 5, 5], [5.5, 5.5, 5.5], [1, 1, 1, 1, 1, 0]));
    const mesh = together(lump, noise);
    expect(volumeOf(mesh)).toBeCloseTo(0.875, 9);
    expect(volumeOfPieces(mesh)).toBeCloseTo(1.125, 9);
    // a verified mesh keeps the measure of the whole
    expect(volumeOfPieces(lump)).toBeCloseTo(volumeOf(lump), 9);
    expect(volumeOfPieces(EMPTY)).toBe(0);
    const { a, b } = blocks(1);
    const second = sharedBy(refusing(() => mesh).kernel, a, b, TOLERANCE);
    expect('message' in second && second.asComputed?.volume).toBeCloseTo(1.125, 9);
  });

  it('a pair the kernel answers keeps its answer: the second opinion is not asked, also for a mesh that cannot be measured', () => {
    const { a, b, common } = blocks(1);
    const answered = refusing(() => EMPTY, common);
    expect(report(answered.kernel, a, b)).toMatchObject({ pairs: [{ a: 'A', b: 'B', volume: expect.closeTo(100, 6), depth: expect.closeTo(1, 6) }], failed: [] });
    const broken = cuboid([9, 0, 0], [10, 10, 10], [10, 11, 12, 13, 14, 5]);
    broken.positions[0] = Number.NaN;
    const unmeasurable = refusing(() => EMPTY, broken);
    expect(report(unmeasurable.kernel, a, b).failed).toEqual([{ a: 'A', b: 'B', message: 'the intersection has a volume that is not a number' }]);
    expect([answered.calls.asComputed, unmeasurable.calls.asComputed]).toEqual([0, 0]);
  });

  it('the second opinion never writes `pairs` or `fits`, whatever it measures', () => {
    for (const into of [0.0001, 0.005, 0.02, 1, 5]) {
      for (const round of [false, true]) {
        const { a, b, common } = blocks(into, round);
        for (const threshold of [0, 0.001, 1]) {
          const answer = report(refusing(() => common).kernel, a, b, threshold);
          expect([answer.pairs, answer.fits]).toEqual([[], []]);
          expect(answer.failed.length + (answer.cleared?.length ?? 0)).toBe(1);
        }
      }
    }
  });

  it('`verdictOf` is the rule of the report: nothing, a fit, a collision', () => {
    const measured = { volume: 1, depth: 0.005, planar: 0, round: true, slack: 1e-5 };
    expect(verdictOf(measured, 0.001, 0.01)).toBe('fit');
    expect(verdictOf(measured, 1, 0.01)).toBe('nothing'); // the volume is at most the threshold
    expect(verdictOf({ ...measured, depth: 1e-5 }, 0.001, 0.01)).toBe('nothing'); // no deeper than the precision
    expect(verdictOf({ ...measured, round: false }, 0.001, 0.01)).toBe('collision');
    expect(verdictOf({ ...measured, planar: 2e-5 }, 0.001, 0.01)).toBe('collision');
    expect(verdictOf({ ...measured, depth: 0.010005 }, 0.001, 0.01)).toBe('fit'); // within the tolerance and the precision
    expect(verdictOf({ ...measured, depth: 0.01002 }, 0.001, 0.01)).toBe('collision');
  });

  it('through the query: one call of each member for two thresholds, and the pair moves between `cleared` and `failed` with the threshold', () => {
    const { a, b, common } = blocks(1);
    const { kernel, calls } = refusing(() => common);
    const bodies = { A: a, B: b };
    const document = emptyDocument();
    const mechanism = DOCUMENT_SECTIONS.mechanism.evaluate(document.mechanism, document, bodies, {}, { sketches: {} } as unknown as State).result;
    const evaluation = { bodies, faceSurfaces: [], faceNames: [], features: {}, parameters: {}, checks: {}, bodyProperties: {}, mechanism } as unknown as Evaluation;
    const internals = { document, state: { faceIds: new Map(), sketches: {} } as unknown as State };
    const memo = new Memo();
    const ask = (threshold: number): InterferenceReport => QUERIES.interference.run(queryContext('interference', evaluation, internals, { kernel, memo }), { threshold } as never) as InterferenceReport;
    expect(ask(0.001)).toMatchObject({ failed: [{ a: 'A', b: 'B' }], pairs: [], fits: [] });
    expect(ask(200)).toEqual({ pairs: [], fits: [], failed: [], cleared: [{ a: 'A', b: 'B', kind: 'nothing', volume: expect.closeTo(100, 6), depth: expect.closeTo(1, 6) }], checked: 1 });
    expect(calls).toEqual({ boolean: 1, asComputed: 1 });
    // a report of a pair the kernel answers has no field `cleared`: review.test.ts, the review of D50
  });
});
