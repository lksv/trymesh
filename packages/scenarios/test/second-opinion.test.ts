// The second opinion of the kernel for a pair it refuses (D50, docs/d36/5e-kernel-second/design.md,
// "Tests", 1, 6 and 7), against the real adapters and below the engine's ordering: the models are
// built through the engine, a body is posed by hand and the pair is asked in the order the test
// states (second-opinion-kit.ts). The fuzz over turned pins (test 5) is second-opinion-fuzz.test.ts.
//
// The poses pinned here were refused by the adapter before D51, which cleans such an intersection
// a second time (docs/d36/5f-adapter-repair/design.md, "What follows for 5e"). Each pose is asked
// of two kernels: `firstOnly`, the adapter with the first cleaning alone, which still refuses it
// and so keeps the second opinion tested; and the adapter, which answers it, and answers it as
// what it is. The last tests pin two poses both cleanings refuse. On the day the adapter answers
// one of them, keep what the test says of the pair and drop that it is refused.
import { describe, expect, it } from 'vitest';
import type { SolidKernel } from '@trymesh/engine';
import { type Measured, sharedBy, verdictOf } from '../../engine/src/interference';
import { volumeOf, volumeOfPieces } from '../../engine/src/solid';
import { isClosed } from '../../kernel-manifold/src/clean';
import { arm } from './arm';
import { TOLERANCE, angleOf, askew, built, firstOnly, flushModel, judged, kernel, placed, refused, turned } from './second-opinion-kit';

const ELBOW: [number, number, number] = [120, 0, 0];
const Z: [number, number, number] = [0, 0, 1];
const FAILED_PHRASE = /; as computed the two share [\d.e+-]+ mm³, [\d.e+-]+ mm deep, which the kernel could not verify$/;
const KERNELS: [string, SolidKernel][] = [
  ['the first cleaning alone', firstOnly],
  ['the adapter', kernel],
];
const ONLY_FIRST = KERNELS[0][1];

describe('the second opinion of the kernel (D50), below the engine ordering', () => {
  const pins = built(arm());

  // 1. The three poses of the backlog, k = 57, 23 and 24 of the recipe over ±88° (the elbow at
  // −47.883°, −50.198° and 58.576°), the parent first.
  it.each([57, 23, 24].flatMap((k) => KERNELS.map(([name, using]) => [k, name, using] as const)))(
    '1. the poses of the backlog, (upper, forearm turned) at k = %i, %s',
    (k, _name, using) => {
      const child = turned(pins.forearm, undefined, ELBOW, Z, angleOf(k, -88, 88));
      const label = `k = ${k}, ${angleOf(k, -88, 88).toFixed(3)}°`;
      const mesh = kernel.intersectionAsComputed(pins.upper.solid, child.solid).unverified;
      expect(isClosed(mesh), label).toBe(true);
      const pieces = volumeOfPieces(mesh);
      expect(pieces, label).toBeGreaterThan(0);
      expect(pieces, label).toBeLessThan(1);
      // the pieces that are inside out: the sum without signs less the signed sum is twice their volume
      expect((pieces - volumeOf(mesh)) / 2, label).toBeLessThan(1e-4);
      const faces = new Set(mesh.faceIds);
      expect(pins.upper.faces.some((face) => faces.has(face.id)), label).toBe(true);
      expect(pins.forearm.faces.some((face) => faces.has(face.id)), label).toBe(true);
      const asComputed = sharedBy(ONLY_FIRST, pins.upper, child, TOLERANCE);
      expect('message' in asComputed && asComputed.asComputed && verdictOf(asComputed.asComputed, 0.001, TOLERANCE), label).toBe('fit');
      if (using === ONLY_FIRST) {
        // refused ("not a closed surface" at k = 57, "a folded triangle" at 23 and 24); the second opinion is a fit
        expect(refused(pins.upper, child, using), label).toBe(true);
        expect(judged(pins.upper, child, using), label).toMatchObject({ pairs: [], fits: [], failed: [], cleared: [{ kind: 'fit' }] });
      } else {
        // answered by the second cleaning: a verified fit, with the volume of the mesh as computed
        expect(refused(pins.upper, child, using), label).toBe(false);
        const report = judged(pins.upper, child, using);
        expect(report, label).toMatchObject({ pairs: [], fits: [{ a: 'a', b: 'b' }], failed: [] });
        expect(report.cleared, label).toBeUndefined();
        const computed = (asComputed as { asComputed: Measured }).asComputed.volume;
        expect(Math.abs(report.fits[0].volume - computed) / computed, label).toBeLessThan(2e-3);
      }
      // the same two meshes the other way round are answered by the first cleaning, and are a fit there
      expect(judged(child, pins.upper, using), label).toMatchObject({ pairs: [], fits: [{ a: 'a', b: 'b' }], failed: [] });
      expect(judged(child, pins.upper, using).cleared).toBeUndefined();
    },
  );

  // 6. Flush faces askew make no collision: nothing in `pairs` or `fits`. One test per pose and
  // kernel, so that none of them comes near the time limit under load (review of D50, finding 2).
  // With the first cleaning alone, k = 0 and 2 at the origin and k = 2 two metres away are refused
  // and cleared as nothing; the plate two metres away at ±88° stays failed, the limit of 5e ("1 of
  // 189"), noise of flush faces with a point that seems deep. The adapter answers all five as
  // nothing: the weld closes the noise.
  const flush = built(...flushModel());
  it.each(
    (
      [
        ['plate', 0, 0, 'cleared'],
        ['plate', 0, 2, 'cleared'],
        ['washer', 2000, 2, 'cleared'],
        ['plate', 2000, 0, 'failed'],
        ['plate', 2000, -1, 'failed'],
      ] as const
    ).flatMap((pose) => KERNELS.map(([name, using]) => [...pose, name, using] as const)),
  )('6. flush faces askew: the %s, %i mm away, turned to k = %i (%s before D51), %s: no collision', (child, away, k, where, _name, using) => {
    const place = askew(away);
    const label = `${child}, ${away} mm away, turned to k = ${k} (${angleOf(k, -88, 88).toFixed(3)}°)`;
    const parent = placed(flush.upper, place);
    const moved = turned(flush[child], place, ELBOW, Z, angleOf(k, -88, 88));
    const report = judged(parent, moved, using);
    expect([report.pairs, report.fits], label).toEqual([[], []]);
    if (using !== ONLY_FIRST) {
      expect(refused(parent, moved, using), label).toBe(false);
      expect([report.failed, report.cleared], label).toEqual([[], undefined]);
      return;
    }
    expect(refused(parent, moved, using), label).toBe(true);
    if (where === 'cleared') expect(report, label).toMatchObject({ failed: [], cleared: [{ kind: 'nothing' }] });
    else {
      expect(report.cleared, label).toBeUndefined();
      expect(report.failed[0]?.message, label).toMatch(FAILED_PHRASE);
    }
  });

  it.each(KERNELS)('6. the pin askew at k = 52 (−63.753°), %s: failed by the noise as computed, a fit when verified', (_name, using) => {
    const place = askew();
    const child = turned(pins.forearm, place, ELBOW, Z, angleOf(52, -88, 88));
    const parent = placed(pins.upper, place);
    const report = judged(parent, child, using);
    if (using === ONLY_FIRST) {
      // 0.06 mm³ of noise as computed, with a point 0.4 mm deep
      expect(refused(parent, child, using)).toBe(true);
      expect([report.pairs, report.fits, report.cleared]).toEqual([[], [], undefined]);
      expect(report.failed[0].message).toMatch(FAILED_PHRASE);
    } else {
      expect(refused(parent, child, using)).toBe(false);
      expect(report).toMatchObject({ pairs: [], fits: [{ a: 'a', b: 'b' }], failed: [] });
      expect(report.cleared).toBeUndefined();
    }
  });

  // 7. Real collisions askew: failed and never cleared by the first cleaning alone, in `pairs`
  // when the adapter verifies them.
  const collisions = () => {
    const place = askew();
    const pose = (model: Record<string, ReturnType<typeof placed>>, child: string, k: number) => ({ parent: placed(model.upper, place), child: turned(model[child], place, ELBOW, Z, angleOf(k, -88, 88)) });
    const large = built(arm({ pin: 4.03, hole: 4 }));
    const atStart = pose(large, 'forearm', 0);
    const atOne = pose(large, 'forearm', 1);
    const just = pose(built(arm({ pin: 4.011, hole: 4 })), 'forearm', 2);
    const sunk = pose(built(...flushModel(0.0006)), 'plate', 1);
    return {
      // a pin 0.03 larger than its hole: at −88° (about 6.04 mm³), and at k = 1 in both orders
      'pin 0.03 larger, −88°': [atStart.parent, atStart.child],
      'pin 0.03 larger, k = 1, parent first': [atOne.parent, atOne.child],
      'pin 0.03 larger, k = 1, child first': [atOne.child, atOne.parent],
      // a pin 0.011 larger, just beyond the limit of a fit (0.01), at k = 2
      'pin 0.011 larger, k = 2': [just.parent, just.child],
      // the plate of the flush model sunk into `upper` by 0.0006 mm (2.6 times the precision of the coordinates), at k = 1
      'plate sunk by 0.0006, k = 1': [sunk.parent, sunk.child],
    } as Record<string, [ReturnType<typeof placed>, ReturnType<typeof placed>]>;
  };
  let poses: ReturnType<typeof collisions> | undefined;
  it.each(['pin 0.03 larger, −88°', 'pin 0.03 larger, k = 1, parent first', 'pin 0.03 larger, k = 1, child first', 'pin 0.011 larger, k = 2', 'plate sunk by 0.0006, k = 1'].flatMap((pose) => KERNELS.map(([name, using]) => [pose, name, using] as const)))(
    '7. a real collision askew, %s, %s',
    (pose, _name, using) => {
      poses ??= collisions();
      const [first, second] = poses[pose];
      const report = judged(first, second, using);
      if (using === ONLY_FIRST) {
        expect(refused(first, second, using)).toBe(true);
        expect([report.pairs, report.fits, report.cleared]).toEqual([[], [], undefined]);
        expect(report.failed[0].message).toMatch(FAILED_PHRASE);
      } else {
        expect(refused(first, second, using)).toBe(false);
        expect([report.fits, report.failed, report.cleared]).toEqual([[], [], undefined]);
        expect(report.pairs).toHaveLength(1);
        // a pin reaches deeper than the limit of a fit; the plate lies 0.0006 deep in `upper`, a
        // collision by its planar faces
        if (pose.startsWith('plate')) expect(report.pairs[0].depth).toBeCloseTo(0.0006, 4);
        else expect(report.pairs[0].depth).toBeGreaterThan(TOLERANCE);
      }
    },
  );

  // What is left for the second opinion over the adapter itself: poses both cleanings refuse (D51,
  // "Known limits"). On the day the adapter answers one, keep what the test says of the pair and
  // drop that it is refused.
  it('9. the pin 0.03 larger askew at k = 27 (32.898°), the parent first: refused by both cleanings, failed with its measure', () => {
    const place = askew();
    const large = built(arm({ pin: 4.03, hole: 4 }));
    const parent = placed(large.upper, place);
    const child = turned(large.forearm, place, ELBOW, Z, angleOf(27, -88, 88));
    expect(refused(parent, child, kernel)).toBe(true);
    const report = judged(parent, child, kernel);
    expect([report.pairs, report.fits, report.cleared]).toEqual([[], [], undefined]);
    expect(report.failed[0].message).toMatch(FAILED_PHRASE);
    expect(report.failed[0].message).toMatch(/as computed the two share 6\.0\d mm³/);
  });

  it('9. the plate sunk by 0.0006 two metres away, turned to −88°: refused by both cleanings, cleared as nothing', () => {
    const place = askew(2000);
    const sunk = built(...flushModel(0.0006));
    const parent = placed(sunk.upper, place);
    const child = turned(sunk.plate, place, ELBOW, Z, angleOf(0, -88, 88));
    expect(refused(parent, child, kernel)).toBe(true);
    expect(judged(parent, child, kernel)).toMatchObject({ pairs: [], fits: [], failed: [], cleared: [{ kind: 'nothing' }] });
  });
});
