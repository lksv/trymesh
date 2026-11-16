// The query `gap` (D40): how close bodies are to each other, pair by pair, and where.
// - The distance of a pair is measured on the two meshes by the pass of D39 (`closest`), which
//   also says between which two points and faces it lies.
// - The pass sees surfaces only. Whether a pair shares a volume is asked of `interference`: for
//   a pair at distance zero it tells a collision from a fit and from bodies that only touch, and
//   for a pair whose surfaces do not meet it finds a body that lies wholly inside the material of
//   the other.
// The kernel port is not extended for it: `minGap` of the library was measured against this and
// is not noticeably faster (docs/d36/1c-gap/design.md, "The measurement").
import { INTERFERENCE_THRESHOLD } from '../interference';
import { closest, coordinatePrecision, meshAccuracy } from '../mesh-distance';
import type { BodyResult, FaceName, Id, Solid, Truncated, Vec3 } from '../types';
import type { ArgSpecs } from './args';
import { interference } from './interference';
import { framed } from './pose';
import { type QueryContext, QueryFailure, type QuerySpec } from './spec';
import { transformPoint } from '../solid';

// - `bodies`: only pairs among these; without it every pair of bodies of the state. One pair is
//   asked by naming its two bodies.
// - `within`: the search distance. Pairs further apart are counted, not measured. 5 mm by
//   default: the gaps a printed assembly is checked for are below that.
// - `maxPairs`: the most pairs the answer lists, the closest first; also the most pairs it lists
//   as not measured.
// The work is bounded by these arguments: every pair of the bodies is examined, each within the
// search distance. `maxPairs` limits the answer, not the work.
export const GAP_ARGS = {
  bodies: { kind: 'list', of: { kind: 'body' }, min: 2, title: 'Bodies', summary: 'Only pairs among these; without it all bodies. Two bodies ask about one pair.', optional: true },
  within: { kind: 'number', title: 'Search distance', summary: 'Pairs further apart than this are counted, not measured. A larger distance takes longer.', optional: true, spec: { title: 'Search distance', unit: 'mm', min: { value: 0, open: true }, default: 5 } },
  maxPairs: { kind: 'number', title: 'Most pairs', summary: 'The most pairs to list, the closest first.', optional: true, spec: { title: 'Most pairs to list', unit: 'count', integer: true, min: { value: 1 }, default: 50 } },
} as const satisfies ArgSpecs;

// A pair of bodies closer than `within`; `a` is the smaller ID in string order, as in the report
// of collisions. A pair has either `contact` (distance zero) or `between` and `accuracy`
// (distance above zero), always one of the two.
// - `distance`: of the two meshes. Zero for a pair that touches or shares a volume; a distance no
//   larger than the precision of the coordinates (`coordinatePrecision` over the two bodies, the
//   measure of the collisions) is zero, and such a pair is close whatever the search distance.
// - `contact`, for a distance of zero, from the query `interference` over the same pair:
//   `collision` (they share a volume above its threshold; also a body that lies wholly inside the
//   material of the other, whose surfaces do not meet), `fit` (round faces within the chord
//   tolerance of each other), `touching` (neither: flush faces, or less than that query reports),
//   `unknown` (the surfaces meet and the kernel could not compute what they share).
// - `between`, for a distance above zero: the two points the gap lies between, `a` on the body
//   `a`, and the face each lies on. Where a point lies on an edge or a corner, the face named is
//   the one that faces the other body most directly: the wall of a bore, not the cap it ends in.
// - `accuracy`, with `between`: an estimate of how far the distance of the meshes may be from that
//   of the exact shapes (`meshAccuracy`: one chord tolerance of the document for each of the two
//   bodies that has a face which is not planar, plus the precision of the coordinates). An
//   estimate, not a bound.
export type Gap = { a: Id; b: Id } & (
  | { distance: 0; contact: 'touching' | 'fit' | 'collision' | 'unknown' }
  | { distance: number; contact?: never; between: { a: Vec3; b: Vec3; faceA: FaceName; faceB: FaceName }; accuracy: number } // mm
);

// - `pairs`: the pairs closer than `within`, the closest first, at most `maxPairs` of them. Pairs
//   at the same distance come in the order of the bodies in the model.
// - `close`: how many pairs are closer than `within` (all of them, also those not listed).
// - `apart`: how many pairs are further apart than `within` (not measured beyond that).
// - `failed`: pairs that could not be measured, with the reason, at most `maxPairs` of them; they
//   are neither close nor apart. It is a pair whose surfaces do not meet and whose boxes overlap,
//   for which the kernel could not tell whether one body lies inside the other. `refused`: how
//   many there are.
// - `checked`: the number of pairs examined: `close`, `apart` and `refused` together.
// - `truncated`: when either list was cut; `shown` and `total` count the two lists together.
export interface GapReport extends Truncated {
  within: number; // mm
  pairs: Gap[];
  close: number;
  apart: number;
  failed: { a: Id; b: Id; message: string }[];
  refused: number;
  checked: number;
}

declare module './spec' {
  interface Queries {
    gap: { spec: typeof GAP_ARGS; result: GapReport };
  }
}

// How far apart the boxes of two bodies are; zero when they overlap or touch.
function boxDistance(a: BodyResult, b: BodyResult): number {
  let squared = 0;
  for (let axis = 0; axis < 3; axis++) squared += Math.max(b.bounds.min[axis] - a.bounds.max[axis], a.bounds.min[axis] - b.bounds.max[axis], 0) ** 2;
  return Math.sqrt(squared);
}

// What `interference` says about one pair. It looks at the boxes itself: boxes that do not
// overlap share nothing and cost no call of the kernel. It reports a pair the kernel failed on
// in its answer, so nothing is caught here.
type Contact = Extract<Gap, { contact: string }>['contact'];
function sharedBy(context: QueryContext, a: Id, b: Id): { contact: Contact; message?: string } {
  const shared = interference.run(context, { bodies: [a, b], threshold: INTERFERENCE_THRESHOLD });
  if (shared.failed.length) return { contact: 'unknown', message: shared.failed[0].message };
  return { contact: shared.pairs.length ? 'collision' : shared.fits.length ? 'fit' : 'touching' };
}

// What was measured between two meshes, without the names of anything: an answer is remembered by
// the two meshes, and the IDs of the bodies and the names of the faces are read from the state
// that is asked about. `first` is the mesh the point `onFirst` lies on.
type Measured = 'apart' | { refused: string } | { contact: Contact } | { distance: number; onFirst: Vec3; onSecond: Vec3; faceFirst: number; faceSecond: number };
interface Remembered {
  first: Solid;
  measured: Measured;
}

// One pair, `a` the smaller ID. The answer is remembered by the two meshes, as the collisions
// are. The key has what the answer reads besides them: the search distance, and the chord
// tolerance (what `interference` calls a fit). Today a solid never outlives its tolerance
// (a document with other settings is replayed from its start), so the tolerance in the key is
// a guard.
type PairAnswer = Gap | 'apart' | { refused: string };
function gapOf(context: QueryContext, a: Id, b: Id, within: number): PairAnswer {
  // from the context, in the frame of the first body: the pair is measured where the two stand to
  // each other, and the two points are moved back into the pose
  const pair = framed(context.bodies, a, b);
  const [A, B] = [pair.a, pair.b];
  const precision = coordinatePrecision(A, B);
  // A distance within the precision of the coordinates is zero, and zero is closer than any
  // search distance: the pair is looked for at least that far.
  const reach = Math.max(within, precision);
  // Boxes that far apart hold no two points closer, and neither body can lie inside the other.
  const boxes = boxDistance(A, B);
  if (boxes >= within && boxes > precision) return 'apart';
  const { first, measured } = context.memo([A.solid, B.solid], `within:${within};tolerance:${context.state.document.settings.chordTolerance}`, (): Remembered => {
    const found = closest({ solid: A.solid }, { solid: B.solid }, reach);
    const answer = (value: Measured): Remembered => ({ first: A.solid, measured: value });
    if (found && found.distance <= precision) return answer({ contact: sharedBy(context, a, b).contact });
    // The surfaces do not meet. That leaves two cases the pass cannot tell apart: the bodies are
    // apart, or a piece of one lies wholly inside the material of the other, however far from its
    // surface. A shared volume says which.
    const inside = sharedBy(context, a, b);
    if (inside.message !== undefined) return answer({ refused: `the kernel could not tell whether one body lies inside the other: ${inside.message}` });
    if (inside.contact !== 'touching') return answer({ contact: inside.contact });
    // a pair exactly `within` apart is found by the pass and is not closer than `within`
    if (!found || found.distance >= within) return answer('apart');
    if (found.faceA === undefined || found.faceB === undefined) throw new Error('gap: a part with triangles names its faces');
    return answer({ distance: found.distance, onFirst: found.a, onSecond: found.b, faceFirst: found.faceA, faceSecond: found.faceB });
  });
  // The answer handed out is a new object every time: a caller that changes it does not change
  // what is remembered.
  if (measured === 'apart') return measured;
  if ('refused' in measured) return { refused: measured.refused };
  if ('contact' in measured) return { a, b, distance: 0, contact: measured.contact };
  const names = context.state.evaluation.faceNames;
  // remembered the other way round when the mesh of `a` was the second one then
  const [onA, onB, faceA, faceB] = first === A.solid ? [measured.onFirst, measured.onSecond, measured.faceFirst, measured.faceSecond] : [measured.onSecond, measured.onFirst, measured.faceSecond, measured.faceFirst];
  const back = (point: Vec3): Vec3 => (pair.back ? transformPoint(pair.back, point) : [...point]);
  return { a, b, distance: measured.distance, between: { a: back(onA), b: back(onB), faceA: names[faceA], faceB: names[faceB] }, accuracy: meshAccuracy({ bodies: { [a]: A, [b]: B }, state: context.state }, [a, b]) };
}

export const gap: QuerySpec<typeof GAP_ARGS, GapReport> = {
  title: 'Smallest gap',
  summary:
    'How close bodies are to each other: for every pair within the search distance the smallest distance between their surfaces and where it is. Two bodies ask about one pair. Bodies that touch or collide have the distance zero. ' +
    'Every pair of the bodies asked about is examined, so the time grows with the number of bodies, with their triangles and with the search distance.',
  returns:
    '`pairs`: the pairs closer than `within`, the closest first, at most `maxPairs`, each with `a`, `b` (`a` is the smaller ID) and `distance` (mm, measured on the meshes). ' +
    'A distance above zero comes with `between` (the two points `a` and `b` and the face each lies on, `faceA` and `faceB`: the feature to change) and `accuracy` (mm: an estimate of how far the meshes may be from the exact shapes). ' +
    'A distance of zero comes with `contact`: `touching` (flush faces), `fit` (round faces within the chord tolerance), `collision` (a shared volume, also a body wholly inside another) or `unknown` (the kernel could not compute what they share). ' +
    '`close`: how many pairs are closer than `within`. `apart`: how many are further apart (not measured). `failed`: pairs that could not be measured, with the reason, at most `maxPairs`; `refused`: how many. `checked`: pairs examined. `truncated` when either list was cut.',
  args: GAP_ARGS,
  significant: { distance: 6, accuracy: 3 },
  units: { distance: 'mm', accuracy: 'mm', within: 'mm' },
  run(context, args) {
    // in the order of the bodies in the model, whatever the order of the list, each body once
    const wanted = args.bodies ? new Set(args.bodies) : undefined;
    const ids = Object.keys(context.bodies).filter((id) => !wanted || wanted.has(id));
    if (args.bodies && ids.length < 2) throw new QueryFailure('invalidArguments', 'bodies: two different bodies are needed for a pair', ['bodies']);
    const pairs: Gap[] = [];
    const failed: GapReport['failed'] = [];
    let apart = 0;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        const found = gapOf(context, a, b, args.within);
        if (found === 'apart') apart++;
        else if ('refused' in found) failed.push({ a, b, message: found.refused }); // one pair that cannot be measured does not take the others with it
        else pairs.push(found);
      }
    }
    pairs.sort((x, y) => x.distance - y.distance); // stable: pairs at one distance keep the order of the bodies
    const [close, refused] = [pairs.length, failed.length];
    const report: GapReport = { within: args.within, pairs: pairs.slice(0, args.maxPairs), close, apart, failed: failed.slice(0, args.maxPairs), refused, checked: close + apart + refused };
    const shown = report.pairs.length + report.failed.length;
    return shown < close + refused ? { ...report, truncated: { shown, total: close + refused } } : report;
  },
};
