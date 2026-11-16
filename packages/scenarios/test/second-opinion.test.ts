// The second opinion of the kernel for a pair it refuses (D50, docs/d36/5e-kernel-second/design.md,
// "Tests", 1, 6 and 7), against the real adapters and below the engine's ordering: the models are
// built through the engine, a body is posed by hand and the pair is asked in the order the test
// states (second-opinion-kit.ts). The fuzz over turned pins (test 5) is second-opinion-fuzz.test.ts.
//
// The poses pinned here as refused are the first cases of the repair of the adapter (`clean`,
// `restoreShifted`), the package after D50. When the adapter answers one of them, its first
// expectation flips: keep what the test says of the pair (no collision cleared, nothing in `pairs`)
// and drop that it is refused.
import { describe, expect, it } from 'vitest';
import { sharedBy, verdictOf } from '../../engine/src/interference';
import { volumeOf, volumeOfPieces } from '../../engine/src/solid';
import { isClosed } from '../../kernel-manifold/src/clean';
import { arm } from './arm';
import { TOLERANCE, angleOf, askew, built, flushModel, judged, kernel, placed, refused, turned } from './second-opinion-kit';

const ELBOW: [number, number, number] = [120, 0, 0];
const Z: [number, number, number] = [0, 0, 1];
const FAILED_PHRASE = /; as computed the two share [\d.e+-]+ mm³, [\d.e+-]+ mm deep, which the kernel could not verify$/;

describe('the second opinion of the kernel (D50), below the engine ordering', () => {
  const pins = built(arm());

  it('1. the three poses of the backlog: the adapter refuses (upper, forearm turned), the mesh as computed is closed and a fit', () => {
    // k = 57, 23 and 24 of the recipe over ±88°: the elbow at −47.883°, −50.198° and 58.576°
    for (const k of [57, 23, 24]) {
      const child = turned(pins.forearm, undefined, ELBOW, Z, angleOf(k, -88, 88));
      const label = `k = ${k}, ${angleOf(k, -88, 88).toFixed(3)}°`;
      // the parent first: refused ("not a closed surface" at k = 57, "a folded triangle" at 23 and 24)
      expect(refused(pins.upper, child), label).toBe(true);
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
      // the answer about the pair: refused, with a second opinion that is a fit
      const answer = sharedBy(kernel, pins.upper, child, TOLERANCE);
      expect('message' in answer && answer.asComputed && verdictOf(answer.asComputed, 0.001, TOLERANCE), label).toBe('fit');
      expect(judged(pins.upper, child), label).toMatchObject({ pairs: [], fits: [], failed: [], cleared: [{ kind: 'fit' }] });
      // the same two meshes the other way round are answered by the adapter, and are a fit there
      expect(judged(child, pins.upper), label).toMatchObject({ pairs: [], fits: [{ a: 'a', b: 'b' }], failed: [] });
      expect(judged(child, pins.upper).cleared).toBeUndefined();
    }
  });

  // 6. Flush faces askew make no collision: nothing in `pairs` or `fits`. One test per pose, so
  // that none of them comes near the time limit under load (review of D50, finding 2).
  // k = 0 and 2 at the origin and k = 2 two metres away are refused and cleared as nothing; the
  // plate two metres away at ±88° stays failed: the limit of the design ("1 of 189"), noise of
  // flush faces with a point that seems deep.
  const flush = built(...flushModel());
  it.each([
    ['plate', 0, 0, 'cleared'],
    ['plate', 0, 2, 'cleared'],
    ['washer', 2000, 2, 'cleared'],
    ['plate', 2000, 0, 'failed'],
    ['plate', 2000, -1, 'failed'],
  ] as const)('6. flush faces askew: the %s, %i mm away, turned to k = %i, is %s and no collision', (child, away, k, where) => {
    const place = askew(away);
    const label = `${child}, ${away} mm away, turned to k = ${k} (${angleOf(k, -88, 88).toFixed(3)}°)`;
    const parent = placed(flush.upper, place);
    const moved = turned(flush[child], place, ELBOW, Z, angleOf(k, -88, 88));
    expect(refused(parent, moved), label).toBe(true);
    const report = judged(parent, moved);
    expect([report.pairs, report.fits], label).toEqual([[], []]);
    if (where === 'cleared') expect(report, label).toMatchObject({ failed: [], cleared: [{ kind: 'nothing' }] });
    else {
      expect(report.cleared, label).toBeUndefined();
      expect(report.failed[0]?.message, label).toMatch(FAILED_PHRASE);
    }
  });

  it('6. the pin askew at k = 52 (−63.753°) stays failed: 0.06 mm³ of noise with a point 0.4 mm deep', () => {
    const place = askew();
    const child = turned(pins.forearm, place, ELBOW, Z, angleOf(52, -88, 88));
    const parent = placed(pins.upper, place);
    expect(refused(parent, child)).toBe(true);
    const report = judged(parent, child);
    expect([report.pairs, report.fits, report.cleared]).toEqual([[], [], undefined]);
    expect(report.failed[0].message).toMatch(FAILED_PHRASE);
  });

  it('7. real collisions the adapter refuses askew are failed, never cleared', () => {
    const place = askew();
    const pose = (model: Record<string, ReturnType<typeof placed>>, child: string, k: number) => ({ parent: placed(model.upper, place), child: turned(model[child], place, ELBOW, Z, angleOf(k, -88, 88)) });
    const collides = (label: string, first: ReturnType<typeof placed>, second: ReturnType<typeof placed>) => {
      expect(refused(first, second), label).toBe(true);
      const report = judged(first, second);
      expect([report.pairs, report.fits, report.cleared], label).toEqual([[], [], undefined]);
      expect(report.failed[0].message, label).toMatch(FAILED_PHRASE);
    };
    // a pin 0.03 larger than its hole: at −88° (about 6.04 mm³ as computed), and at k = 1 in both orders
    const large = built(arm({ pin: 4.03, hole: 4 }));
    let { parent, child } = pose(large, 'forearm', 0);
    collides('pin 0.03 larger, −88°', parent, child);
    ({ parent, child } = pose(large, 'forearm', 1));
    collides('pin 0.03 larger, k = 1, parent first', parent, child);
    collides('pin 0.03 larger, k = 1, child first', child, parent);
    // a pin 0.011 larger, just beyond the limit of a fit (0.01), at k = 2
    ({ parent, child } = pose(built(arm({ pin: 4.011, hole: 4 })), 'forearm', 2));
    collides('pin 0.011 larger, k = 2', parent, child);
    // the plate of the flush model sunk into `upper` by 0.0006 mm (2.6 times the precision of the coordinates), at k = 1
    ({ parent, child } = pose(built(...flushModel(0.0006)), 'plate', 1));
    collides('plate sunk by 0.0006, k = 1', parent, child);
  });
});
