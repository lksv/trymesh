// A fuzz over turned pins (D50, docs/d36/5e-kernel-second/design.md, "Tests", 5): the arm of
// scenario 13 with pins of radius 1.5, 2.5, 4 and 12 in holes of the same circle, the forearm turned
// about the elbow to the angles of the recipe over ±88°, the pair asked in both orders below the
// engine's ordering (second-opinion-kit.ts).
// - Over the adapter (D51, docs/d36/5f-adapter-repair/design.md, "Tests the implementation owes",
//   10): nothing is a collision and nothing fails, along an axis and askew; a pose the adapter
//   still refuses and the second opinion clears is counted and held to 1 + 2 % of the poses asked
//   (none of 480 in the run of the design).
// - With SECOND_OPINION_KERNEL=first, over the first cleaning alone (the adapter before D51): along
//   an axis nothing is a collision and nothing fails; askew nothing is a collision, and the poses
//   that stay failed are counted and held below a bound from the measurement of 5e (1 of 80).
// More poses, from another start:
//   SECOND_OPINION_POSES=200 SECOND_OPINION_ASKEW=40 SECOND_OPINION_FIRST=1 npx vitest run packages/scenarios/test/second-opinion-fuzz.test.ts
import { describe, expect, it } from 'vitest';
import type { InterferenceReport } from '@trymesh/engine';
import { arm } from './arm';
import { angleOf, askew, built, firstOnly, judged, kernel, placed, turned } from './second-opinion-kit';

const POSES = Number(process.env.SECOND_OPINION_POSES ?? 12); // along an axis
const ASKEW = Number(process.env.SECOND_OPINION_ASKEW ?? 2);
const FIRST = Number(process.env.SECOND_OPINION_FIRST ?? 1);
const FIRST_ONLY = process.env.SECOND_OPINION_KERNEL === 'first';
const USING = FIRST_ONLY ? firstOnly : kernel;
const RADII = [1.5, 2.5, 4, 12];
// Poses along an axis that failed once, pinned by the radius and their k (none so far).
const PINNED: [number, number][] = [];

const ELBOW: [number, number, number] = [120, 0, 0];
const Z: [number, number, number] = [0, 0, 1];
const models = new Map(RADII.map((radius) => [radius, built(arm({ pin: radius }))]));
// The i-th pose: the radii in turn, k counting up from FIRST.
const poses = (count: number): [number, number][] => Array.from({ length: count }, (_, i) => [RADII[i % RADII.length], FIRST + i]);
const KERNEL = FIRST_ONLY ? 'the first cleaning alone' : 'the adapter';

describe(`a fuzz over turned pins in holes of the same circle (D50, D51), over ${KERNEL}`, () => {
  // Over the adapter a pose both cleanings refuse goes to the second opinion: rare.
  const fewCleared = (reports: InterferenceReport[]) => {
    console.log(`turned pins over ${KERNEL}: ${reports.length} poses asked, ${reports.flatMap((report) => report.cleared ?? []).length} cleared, ${reports.flatMap((report) => report.failed).length} failed`);
    if (!FIRST_ONLY) expect(reports.flatMap((report) => report.cleared ?? []).length).toBeLessThanOrEqual(1 + Math.floor(reports.length / 50));
  };

  it(`along a coordinate axis: no collision and nothing failed (${POSES} poses from k = ${FIRST}, both orders)`, { timeout: 60_000 + POSES * 2000 }, () => {
    const reports: InterferenceReport[] = [];
    for (const [radius, k] of [...PINNED, ...poses(POSES)]) {
      const { upper, forearm } = models.get(radius)!;
      const child = turned(forearm, undefined, ELBOW, Z, angleOf(k, -88, 88));
      for (const [label, report] of [['parent first', judged(upper, child, USING)], ['child first', judged(child, upper, USING)]] as const) {
        const pose = `radius ${radius}, k = ${k} (${angleOf(k, -88, 88).toFixed(3)}°), ${label}`;
        expect(report.pairs, pose).toEqual([]);
        expect(report.failed, pose).toEqual([]);
        reports.push(report);
      }
    }
    fewCleared(reports);
  });

  it(`askew: no collision, and ${FIRST_ONLY ? 'few poses failed' : 'nothing failed'} (${ASKEW} poses from k = ${FIRST}, both orders)`, { timeout: 60_000 + ASKEW * 15_000 }, () => {
    const place = askew();
    const reports: InterferenceReport[] = [];
    for (const [radius, k] of poses(ASKEW)) {
      const { upper, forearm } = models.get(radius)!;
      const [parent, child] = [placed(upper, place), turned(forearm, place, ELBOW, Z, angleOf(k, -88, 88))];
      for (const [label, report] of [['parent first', judged(parent, child, USING)], ['child first', judged(child, parent, USING)]] as const) {
        expect(report.pairs, `radius ${radius}, k = ${k}, ${label}`).toEqual([]);
        reports.push(report);
      }
    }
    const failed = reports.flatMap((report) => report.failed).length;
    // 5e measured 1 failed of 80 askew poses of the pin of radius 4; held with room
    if (FIRST_ONLY) expect(failed).toBeLessThanOrEqual(1 + Math.floor(reports.length / 20));
    else expect(failed).toBe(0);
    fewCleared(reports);
  });
});
