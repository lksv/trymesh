// A fuzz over turned pins (D50, docs/d36/5e-kernel-second/design.md, "Tests", 5): the arm of
// scenario 13 with pins of radius 1.5, 2.5, 4 and 12 in holes of the same circle, the forearm turned
// about the elbow to the angles of the recipe over ±88°, the pair asked in both orders below the
// engine's ordering (second-opinion-kit.ts). With the axis of the joint along a coordinate axis
// nothing is a collision and nothing fails; askew nothing is a collision, and the poses that stay
// failed are counted and held below a bound from the measurement of the design (1 of 80).
// More poses, from another start:
//   SECOND_OPINION_POSES=200 SECOND_OPINION_ASKEW=40 SECOND_OPINION_FIRST=1 npx vitest run packages/scenarios/test/second-opinion-fuzz.test.ts
import { describe, expect, it } from 'vitest';
import { arm } from './arm';
import { angleOf, askew, built, judged, placed, turned } from './second-opinion-kit';

const POSES = Number(process.env.SECOND_OPINION_POSES ?? 12); // along an axis
const ASKEW = Number(process.env.SECOND_OPINION_ASKEW ?? 2);
const FIRST = Number(process.env.SECOND_OPINION_FIRST ?? 1);
const RADII = [1.5, 2.5, 4, 12];
// Poses along an axis that failed once, pinned by the radius and their k (none so far).
const PINNED: [number, number][] = [];

const ELBOW: [number, number, number] = [120, 0, 0];
const Z: [number, number, number] = [0, 0, 1];
const models = new Map(RADII.map((radius) => [radius, built(arm({ pin: radius }))]));
// The i-th pose: the radii in turn, k counting up from FIRST.
const poses = (count: number): [number, number][] => Array.from({ length: count }, (_, i) => [RADII[i % RADII.length], FIRST + i]);

describe('a fuzz over turned pins in holes of the same circle (D50)', () => {
  it(`along a coordinate axis: no collision and nothing failed (${POSES} poses from k = ${FIRST}, both orders)`, () => {
    for (const [radius, k] of [...PINNED, ...poses(POSES)]) {
      const { upper, forearm } = models.get(radius)!;
      const child = turned(forearm, undefined, ELBOW, Z, angleOf(k, -88, 88));
      for (const [label, report] of [['parent first', judged(upper, child)], ['child first', judged(child, upper)]] as const) {
        const pose = `radius ${radius}, k = ${k} (${angleOf(k, -88, 88).toFixed(3)}°), ${label}`;
        expect(report.pairs, pose).toEqual([]);
        expect(report.failed, pose).toEqual([]);
      }
    }
  });

  it(`askew: no collision, and few poses failed (${ASKEW} poses from k = ${FIRST}, both orders)`, () => {
    const place = askew();
    let failed = 0;
    let asked = 0;
    for (const [radius, k] of poses(ASKEW)) {
      const { upper, forearm } = models.get(radius)!;
      const [parent, child] = [placed(upper, place), turned(forearm, place, ELBOW, Z, angleOf(k, -88, 88))];
      for (const [label, report] of [['parent first', judged(parent, child)], ['child first', judged(child, parent)]] as const) {
        expect(report.pairs, `radius ${radius}, k = ${k}, ${label}`).toEqual([]);
        failed += report.failed.length;
        asked++;
      }
    }
    // the design measured 1 failed of 80 askew poses of the pin of radius 4; held with room
    expect(failed).toBeLessThanOrEqual(1 + Math.floor(asked / 20));
  });
});
