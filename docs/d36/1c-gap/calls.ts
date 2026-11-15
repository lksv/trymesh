// Package 1c written out as calls: its part of validation scenario 11 (the gap between a planet
// and the carrier of the robot joint of scenario 9), the entry of the query over the context
// and the kernel port, and the view of the app. Only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). A step that cannot be written here is a hole in the
// contract. Lines marked `@ts-expect-error` are calls that must not compile.
//
// The numbers in the comments were measured on the model of scenario 9 with `minGap` of
// Manifold 3.5.5 and a prototype of the pass that finds the two points (chord tolerance
// 0.01 mm); they become the expectations of the test in packages/scenarios.

import type { Id, Vec3 } from '../../../packages/engine/src/index';
import { INTERFERENCE_THRESHOLD } from '../../../packages/engine/src/index';
import type { BodyResultAfter, CommandAfter, EngineAfter, QueryArgs, QueryContext, QueryOutcome, QueryToolInput } from '../00-prep/contract';
import { QUERIES, QueryFailure } from '../00-prep/contract';
import type { QueryView, SceneAdditions } from '../1b-measure/contract';
import { QUERY_VIEWS, closest, coordinatePrecision, meshAccuracy } from '../1b-measure/contract';
import type { Gap, GapReport, SolidKernelAfter } from './contract';
import { GAP_ARGS } from './contract';

declare const engine: EngineAfter; // with the joint of scenario 9, as packages/scenarios/test/scenario9.test.ts builds it
declare function fail(message: string): never;
const unwrap = <T>(outcome: QueryOutcome<T>): T => (outcome.ok ? outcome.result : fail(`${outcome.error.code}: ${outcome.error.message}`));

// ---------------------------------------------------------------- a. scenario 11: the gap between a planet and the carrier

// One pair is asked by naming its two bodies. The pin of the carrier (diameter 5) goes through
// the bore of the planet (5.3): 0.15 by design, 0.140453 on the meshes, between
// `planetHole/side/ph` at (17.610, 0, 34) and `carrierPin/side/pin` at (17.750, 0, 34), with an
// accuracy of 0.02 (two bodies with round faces; the precision of the coordinates adds 5e-5).
// The closest point lies on the rim of the bore; the face named is the wall of the bore, not the
// cap of the planet.
export function planetAndCarrier(): { gap: number; onPin: boolean; accuracy: number } {
  const report: GapReport = unwrap(engine.query('gap', { bodies: ['planet', 'carrier'] }));
  const pair: Gap = report.pairs[0] ?? fail('the planet is within 5 mm of the carrier');
  if (!('between' in pair)) return fail('a gap above zero says where it is'); // the type: a pair has `contact` or `between`
  // `a` is the smaller ID: the carrier
  return { gap: pair.distance, onPin: pair.between.faceA.feature === 'carrierPin', accuracy: pair.accuracy };
}

// The tight places of the whole joint in one call: every pair within the default 5 mm, the
// closest first. 28 pairs are checked; 15 are within 5 mm (`close`) and 13 are counted in `apart`.
// - distance 0 with contact `touching`: motor and plate, motor and sun, plate and housing
// - 0.0497: each planet and the ring gear in the housing; 0.0499: the sun and each planet (the
//   backlash is 0.05)
// - 0.1405: each planet and the carrier; 0.5: the sun and the carrier
// - 0.9900: the motor in its recess (1 by design); 1.5812: the housing and the carrier
export function tightPlaces(): { touching: number; smallestGap: number; apart: number } {
  const report = unwrap(engine.query('gap', {}));
  const touching = report.pairs.filter((pair) => !('between' in pair) && pair.contact === 'touching').length;
  const open = report.pairs.find((pair) => pair.distance > 0);
  return { touching, smallestGap: open?.distance ?? report.within, apart: report.apart };
}

// A pair further apart than the search distance is counted, not measured: the plate and the
// carrier are 34 mm apart. A larger search distance measures them (and takes longer: 5 ms at
// 10 mm against 339 ms at 100 mm for this pair).
export function farApart(): { counted: number; measured: number } {
  const near = unwrap(engine.query('gap', { bodies: ['plate', 'carrier'] }));
  const far = unwrap(engine.query('gap', { bodies: ['plate', 'carrier'], within: 50 }));
  return { counted: near.apart, measured: far.pairs[0]?.distance ?? fail('34 mm is within 50') };
}

// Bodies that collide have no gap: the distance is zero and `contact` says what kind of zero.
// The planet made too large on purpose, as in part i of scenario 9, without writing it down.
export function collidingPair(): string {
  const tooLarge: CommandAfter = { type: 'setField', feature: 'skGears', path: 'constraints/dp/value', value: 'module * Zp + 1' };
  const preview = engine.preview(tooLarge);
  if (!preview.ok) return fail(preview.error.message);
  const pair = unwrap(engine.query('gap', { bodies: ['housing', 'planet'] }, { state: preview.state })).pairs[0];
  return pair && !('between' in pair) ? pair.contact : fail('the two collide'); // collision
}

// Through MCP, stepping a parameter: the gap of the sun and the planet follows the backlash.
export const steppedOverMcp: QueryToolInput = { query: 'gap', args: { bodies: ['sun', 'planet'] }, after: { type: 'setParameter', name: 'backlash', expr: '0.2' } };

// One body twice is not a pair; the list needs two bodies, and the description says so.
export function oneBody(): string {
  const outcome = engine.query('gap', { bodies: ['planet', 'planet'] });
  return outcome.ok ? fail('expected an error') : outcome.error.code; // failed, with the path ['bodies'] (see "Needs from the preparatory step" of 1b)
}

// @ts-expect-error bodies is a list
engine.query('gap', { bodies: 'planet' });
// @ts-expect-error the search distance is a number
engine.query('gap', { within: '5' });
// @ts-expect-error a gap above zero cannot be written without where it is
export const withoutPoints: Gap = { a: 'carrier', b: 'planet', distance: 0.14 };

// ---------------------------------------------------------------- b. the entry, over the context and the port

// The boxes of two bodies further apart than `within`: the pair is apart without asking the kernel.
function boxesApart(a: BodyResultAfter, b: BodyResultAfter, within: number): boolean {
  let squared = 0;
  for (let axis = 0; axis < 3; axis++) squared += Math.max(b.bounds.min[axis] - a.bounds.max[axis], a.bounds.min[axis] - b.bounds.max[axis], 0) ** 2;
  return squared >= within * within;
}

// One pair. The answer is remembered by the two meshes, as the collisions are.
// - Only the call of the kernel is guarded: what it throws is a pair it refused. Anything else
//   that goes wrong in here is a defect and passes through, as the shared contract asks.
// - `interference` reports its own refused pairs in its answer, so it needs no guard.
type PairAnswer = Gap | 'apart' | { refused: string };
function gapOf(context: QueryContext, a: Id, b: Id, within: number): PairAnswer {
  const [A, B] = [context.bodies[a], context.bodies[b]]; // from the context: the same code answers for a pose
  if (boxesApart(A, B, within)) return 'apart';
  return context.memo([A.solid, B.solid], `within:${within}`, (): PairAnswer => {
    const kernel = context.kernel as SolidKernelAfter; // the port after this package
    let measured: number;
    try {
      measured = kernel.minGap(A.solid, B.solid, within);
    } catch (error) {
      return { refused: error instanceof Error ? error.message : String(error) };
    }
    if (measured >= within) return 'apart';
    const precision = coordinatePrecision(A, B);
    if (measured <= precision) {
      // a query that builds on another calls its `run` with the same context
      const shared = QUERIES.interference.run(context, { bodies: [a, b], threshold: INTERFERENCE_THRESHOLD });
      const contact = shared.failed.length ? 'unknown' : shared.pairs.length ? 'collision' : shared.fits.length ? 'fit' : 'touching';
      return { a, b, distance: 0, contact };
    }
    // Where the gap is: the pass of 1b over the two meshes, told the distance to look within.
    // Should the pass find nothing that close (it works in double precision, the kernel in its
    // own), it is run again without a limit: two meshes that are not empty always have a closest
    // pair of points, so a gap above zero always says where it is.
    const [partA, partB] = [{ solid: A.solid }, { solid: B.solid }];
    const found = closest(partA, partB, measured + precision) ?? closest(partA, partB) ?? fail('two meshes that are not empty have a closest pair of points');
    if (found.faceA === undefined || found.faceB === undefined) return fail('a part with triangles names its faces');
    const names = context.state.evaluation.faceNames;
    return { a, b, distance: measured, between: { a: found.a, b: found.b, faceA: names[found.faceA], faceB: names[found.faceB] }, accuracy: meshAccuracy(context, [a, b]) };
  });
}

export const gap: (typeof QUERIES)['gap'] = {
  title: 'Smallest gap',
  summary:
    'How close bodies are to each other: for every pair within the search distance the smallest distance between their surfaces and where it is. Names of two bodies ask about one pair. Bodies that touch or collide have the distance zero. Every pair of the bodies asked about is examined, so the time grows with the number of bodies and with the search distance.',
  returns:
    'pairs: the pairs closer than `within`, the closest first, at most maxPairs, each with a, b and distance (mm, measured on the meshes). A distance above zero comes with between (the two points and the face each lies on) and accuracy (mm: an estimate of how far the meshes may be from the exact shapes); a distance of zero with contact: touching, fit, collision or unknown. close: how many pairs are closer than `within`. apart: how many are further apart (not measured). failed: pairs the kernel refused, with the reason, at most maxPairs; refused: how many. checked: pairs examined. truncated when either list was cut.',
  args: GAP_ARGS,
  significant: { distance: 6, accuracy: 3 },
  run(context, args) {
    const ids = [...new Set(args.bodies ?? Object.keys(context.bodies))];
    if (args.bodies && ids.length < 2) throw new QueryFailure('failed', 'two different bodies are needed for a pair', ['bodies']);
    const pairs: Gap[] = [];
    const failed: GapReport['failed'] = [];
    let apart = 0;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        const found = gapOf(context, a, b, args.within);
        if (found === 'apart') apart++;
        else if ('refused' in found) failed.push({ a, b, message: found.refused }); // one pair the kernel refuses does not take the others with it
        else pairs.push(found);
      }
    }
    pairs.sort((x, y) => x.distance - y.distance);
    const [close, refused] = [pairs.length, failed.length];
    const report: GapReport = { within: args.within, pairs: pairs.slice(0, args.maxPairs), close, apart, failed: failed.slice(0, args.maxPairs), refused, checked: close + apart + refused };
    const shown = report.pairs.length + report.failed.length;
    return shown < close + refused ? { ...report, truncated: { shown, total: close + refused } } : report;
  },
};
export const registered: Pick<typeof QUERIES, 'gap'> = { gap };
export const FIXTURE: { args: QueryArgs<'gap'> } = { args: {} };

// ---------------------------------------------------------------- c. the view of the app

// The pairs as rows, the closest first; a picked row draws its two bodies in two colours and
// joins the two points of the gap by a line with its length. The pairs the kernel refused follow
// with the reason, and a line says when a list was cut: the view replaces the tree, so nothing
// else would show them. The same shape as the view of the collisions (1b), with its colours.
const [SELECT, CLASH, GAP] = [0xf97316, 0xdc2626, 0xffa000];
const middle = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const line = (className: string, textContent: string): HTMLElement => Object.assign(document.createElement('div'), { className, textContent });
export const gapView: QueryView<'gap'> = {
  answer(result, _args, panel) {
    const rows = result.pairs.map((pair, index) => {
      const what = 'between' in pair ? `${panel.number(pair.distance, 'mm')} ± ${panel.number(pair.accuracy, 'mm')}` : pair.contact;
      const row = line(`row ${panel.picked === index ? 'selected' : ''}`, `${panel.bodyName(pair.a)} × ${panel.bodyName(pair.b)}: ${what}`);
      row.onclick = () => panel.pick(panel.picked === index ? undefined : index);
      return row;
    });
    const failed = result.failed.map((pair) => line('row', `${panel.bodyName(pair.a)} × ${panel.bodyName(pair.b)}: could not be measured (${pair.message})`));
    const cut = result.truncated ? [line('hint', `${result.pairs.length} of ${result.close} close pairs and ${result.failed.length} of ${result.refused} refused pairs are listed.`)] : [];
    return [...rows, ...failed, ...cut];
  },
  scene(result, _args, panel): Partial<SceneAdditions> {
    const pair = panel.picked === undefined ? undefined : result.pairs[panel.picked];
    if (!pair) return {};
    const bodies = [
      { body: pair.a, color: SELECT },
      { body: pair.b, color: CLASH },
    ];
    if (!('between' in pair)) return { bodies };
    const between = pair.between;
    return {
      bodies,
      lines: [{ segments: [...between.a, ...between.b], color: GAP, width: 2, onTop: true }],
      points: [{ positions: [...between.a, ...between.b], color: GAP, size: 6 }],
      labels: [{ at: middle(between.a, between.b), text: panel.number(pair.distance, 'mm'), tone: 'reference' }],
    };
  },
  note: (result) => ({
    text: `${result.close} pair(s) of bodies within ${result.within} mm of each other, ${result.apart} further apart${result.refused ? `, ${result.refused} could not be measured` : ''}.`,
    error: result.refused > 0,
  }),
};
export const views: Pick<typeof QUERY_VIEWS, 'gap'> = { gap: gapView };
