// The query `interference`: which bodies share a volume (D35, point 5), and which pairs share what
// a thread accounts for (D76).
import { INTERFERENCE_THRESHOLD, THREAD_PIECE_VOLUME, type SharedVolume, type ThreadJudgement, type ThreadZone, boxesApart, endsHad, goesAround, interferenceReport, joinedZones, movedZone, onOneLine, ringBox, ringOf, sharedBy, threadZone, threadsAgree } from '../interference';
import { bandOf } from '../recompute/body-boolean';
import { phaseSense, precisionOf, threadLift } from '../recompute/thread';
import { type RigidTransform, inverse, pieceSolids, transformPoint, transformVector, volumeOf } from '../solid';
import type { BodyResult, Id, InterferenceReport, Seat, ShortOfShoulder, Solid, Threaded, ThreadResult, Vec3 } from '../types';
import { ANGLE_TOLERANCE, add3, cross3, dot3, mul3, sub3, unit3 } from '../util';
import type { ArgSpecs } from './args';
import { boxOf, framed, keepOf, movedBody, movedBox } from './pose';
import type { QueryContext, QuerySpec } from './spec';

export const INTERFERENCE_ARGS = {
  bodies: { kind: 'list', of: { kind: 'body' }, title: 'Bodies', summary: 'The bodies to check against each other; without it all bodies.', optional: true },
  threshold: { kind: 'number', title: 'Threshold', summary: 'The smallest shared volume that counts.', optional: true, spec: { title: 'Threshold', unit: 'mm3', min: { value: 0 }, default: INTERFERENCE_THRESHOLD } },
} as const satisfies ArgSpecs;

declare module './spec' {
  interface Queries {
    interference: { spec: typeof INTERFERENCE_ARGS; result: InterferenceReport };
  }
}

// The number the faces of a ring carry, and below it those of further rings cut out of one body:
// no face of the model has one (a model would need two thousand million faces), and the kernel
// takes numbers below 2³¹.
const RING_FACE = 0x7ffffffe;

// What the thread of a zone took of a pair: the volume of the pieces the other body shares with the
// part of the body in the zone, when every piece above `THREAD_PIECE_VOLUME` goes around the axis
// and there is one; undefined when the zone is not taken (also when the kernel refused a boolean).
type ZoneTake = { volume: number } | undefined;
// The zones of a body with the numbers of their rings.
interface Zones {
  zones: ThreadZone[];
  lift: number;
  slack: number;
}

// The pair judged with its threads (design.md of D76, "The check of collisions"). The pair is in the
// frame of its first body (`framed`): `a` as modelled, `b` moved by `relative` (absent: not moved).
// Undefined when no thread changes anything: the pair is judged as every pair is.
function judgeThreaded(context: QueryContext, a: Id, b: Id, pair: { a: BodyResult; b: BodyResult; relative?: RigidTransform; bModelled?: BodyResult }, tolerance: number): ThreadJudgement | undefined {
  const [threadsA, threadsB] = [context.threadsAsModelled(a), context.threadsAsModelled(b)];
  if (threadsA.length === 0 && threadsB.length === 0) return undefined;
  const A = pair.a;
  const B = pair.bModelled ?? pair.b; // the second body as modelled
  const relative = pair.relative;
  const zonesOf = (id: Id, body: BodyResult, threads: readonly ThreadResult[]): Zones => {
    const lift = threadLift(tolerance, bandOf(body.solid));
    const slack = tolerance + precisionOf(body.solid);
    const zones = threads.map((thread) => threadZone(thread, id, lift)).filter((zone): zone is ThreadZone => zone !== undefined);
    return { zones: joinedZones(zones, lift), lift, slack };
  };
  const za = zonesOf(a, A, threadsA);
  const zb = zonesOf(b, B, threadsB);
  if (za.zones.length === 0 && zb.zones.length === 0) return undefined;
  // the zones of the second body in the frame of the first, for comparing the threads
  const zbInA = zb.zones.map((zone) => movedZone(zone, relative));
  // the threads of the two bodies that meet have to agree
  const agreeing: [number, number][] = [];
  const mismatches: { i: number; j: number; offLine: boolean; mismatch: string }[] = [];
  for (const [i, zoneA] of za.zones.entries()) {
    for (const [j, zoneB] of zbInA.entries()) {
      const verdict = threadsAgree(zoneA, zoneB, tolerance, () => ringsMeet(context, zoneA, za, zoneB, zb, tolerance));
      if (verdict === 'apart') continue;
      if (verdict === 'agree') agreeing.push([i, j]);
      else mismatches.push({ i, j, offLine: !onOneLine(zoneA, zoneB, tolerance), mismatch: verdict.mismatch });
    }
  }
  // a thread off the line of a mate that agrees is a third thread that does not concern it (a bolt
  // in one of two tapped holes that cross): left out, and its zone judged on its own; any other
  // mismatch judges the pair whole
  const mated = (i: number, j: number): boolean => agreeing.some(([x, y]) => (x === i && y !== j) || (y === j && x !== i));
  const mismatch = mismatches.find((m) => !(m.offLine && mated(m.i, m.j)));
  if (mismatch) return { mismatch: mismatch.mismatch };
  // two modelled threads that agree: their meshes are the truth, neither zone is taken; should the
  // pair collide, its entry says how to seat them (`seat`, of the first such two) and names the
  // rings under a shoulder the wall of the mate stands in (`shortOfShoulder`, of every such two)
  const notTaken = { a: new Set<number>(), b: new Set<number>() };
  let seat: Seat[] | undefined;
  const rings = new Map<string, ShortOfShoulder>();
  // the precision of the coordinates of the pair, as it stands in the frame of the first body
  let precision: number | undefined;
  for (const [i, j] of agreeing) {
    if (za.zones[i].threads.every((t) => t.modelled) && zb.zones[j].threads.every((t) => t.modelled)) {
      notTaken.a.add(i);
      notTaken.b.add(j);
      seat ??= seatOf(za.zones[i].threads[0], zb.zones[j].threads[0], relative);
      for (const t of za.zones[i].threads) {
        for (const u of zb.zones[j].threads) {
          precision ??= Math.max(precisionOf(A.solid), precisionOf(pair.b.solid));
          for (const entry of shortOfShoulderOf({ thread: t, body: a, lift: za.lift }, { thread: u, body: b, lift: zb.lift }, relative, { across: tolerance, along: precision })) {
            const key = JSON.stringify([entry.feature, entry.face, entry.end]);
            if (!rings.has(key)) rings.set(key, entry); // the first mate of a ring names it
          }
        }
      }
    }
  }
  const shortOfShoulder = [...rings.values()].filter((entry) => !entry.inserted).concat([...rings.values()].filter((entry) => entry.inserted));
  const modelledPair = { ...(seat ? { seat } : {}), ...(shortOfShoulder.length ? { shortOfShoulder } : {}) };
  // the zones whose ring meets the box of the other body, each judged with its body first
  const keep = keepOf(context.bodies[a], context.bodies[b]);
  const inverseRelative = relative ? inverse(relative) : undefined;
  const aInB = inverseRelative ? movedBody(A, inverseRelative, keep) : A;
  const takeA = za.zones.map((zone, i): ZoneTake => (notTaken.a.has(i) || boxesApart(ringBox(zone, za.slack, za.lift), pair.b.bounds) ? undefined : zoneTake(context, A.solid, zone, pair.b.solid, za, tolerance)));
  const takeB = zb.zones.map((zone, j): ZoneTake => (notTaken.b.has(j) || boxesApart(ringBox(zone, zb.slack, zb.lift), movedBox(A.bounds, inverseRelative)) ? undefined : zoneTake(context, B.solid, zone, aInB.solid, zb, tolerance)));
  if (!takeA.some(Boolean) && !takeB.some(Boolean)) return seat ? modelledPair : undefined;
  // the volume excused: the larger of two agreeing zones about one line, the others added
  let volume = 0;
  const counted = { a: new Set<number>(), b: new Set<number>() };
  for (const [i, j] of agreeing) {
    const [x, y] = [takeA[i], takeB[j]];
    if (!x || !y || counted.a.has(i) || counted.b.has(j)) continue;
    volume += Math.max(x.volume, y.volume);
    counted.a.add(i);
    counted.b.add(j);
  }
  takeA.forEach((take, i) => {
    if (take && !counted.a.has(i)) volume += take.volume;
  });
  takeB.forEach((take, j) => {
    if (take && !counted.b.has(j)) volume += take.volume;
  });
  const threads: Threaded['threads'] = [
    ...za.zones.flatMap((zone, i) => (takeA[i] ? zone.threads.map((t) => ({ feature: t.feature, face: t.face, body: a })) : [])),
    ...zb.zones.flatMap((zone, j) => (takeB[j] ? zone.threads.map((t) => ({ feature: t.feature, face: t.face, body: b })) : [])),
  ];
  // the rests stand in for the bodies, and the pair is judged as every pair is
  const restA = restOf(context, A, za.zones.filter((_, i) => takeA[i]), za, tolerance);
  const restBModelled = restOf(context, B, zb.zones.filter((_, j) => takeB[j]), zb, tolerance);
  const restB = relative ? movedBody(restBModelled, relative, keep) : restBModelled;
  const shared = context.memo([restA.solid, restB.solid], 'shared', (): SharedVolume => sharedBy(context.kernel, restA, restB, tolerance));
  return { shared, taken: { volume, threads }, ...modelledPair };
}

// How to seat two modelled threads that agree (design.md of D76, "The check of collisions"; owner,
// 2026-11-27): the helix of the first, followed along the line to the origin of the second, crosses
// there at the angle Δ from the `zero` of the second, about the direction of the second, taken to
// the nearest of the `starts` positions. The `zero` of the second has to turn by Δ, that of the
// first by −Δ when the two run the same way and by Δ when they run opposite ways. Adding x to the
// `phase` of a feature turns the `zero` of a record by `sense · x` (`phaseSense`: −1 for a record
// that went through a mirror; the review of stage 2), so each entry is its turn times its sense.
// The second is in the frame of the first by `relative`. Exact from the records: the middle of the
// crest of a pin and of the groove of a bore are one curve whatever the clearances. An entry whose
// feature is of an inserted document (a prefixed ID) is marked `inserted` and comes last.
export function seatOf(first: ThreadResult, second: ThreadResult, relative: RigidTransform | undefined, senseOf: (thread: ThreadResult) => 1 | -1 = phaseSense): Seat[] {
  const [o2, a2, z2] = relative ? [transformPoint(relative, second.origin), transformVector(relative, second.axis), transformVector(relative, second.zero)] : [second.origin, second.axis, second.zero];
  const [o1, a1, z1] = [first.origin, first.axis, first.zero];
  const turn = first.hand === 'left' ? -1 : 1;
  const lead = first.pitch * first.starts;
  const g = dot3(sub3(o2, o1), a1);
  const theta = (2 * Math.PI * g) / (turn * lead);
  const across: Vec3 = cross3(a1, z1);
  const d: Vec3 = [Math.cos(theta) * z1[0] + Math.sin(theta) * across[0], Math.cos(theta) * z1[1] + Math.sin(theta) * across[1], Math.cos(theta) * z1[2] + Math.sin(theta) * across[2]];
  const raw = Math.atan2(dot3(d, cross3(a2, z2)), dot3(d, z2));
  const period = (2 * Math.PI) / first.starts;
  let delta = raw - period * Math.round(raw / period);
  if (Math.abs(delta) <= ANGLE_TOLERANCE) delta = 0;
  const sameWay = dot3(a1, a2) > 0;
  const entry = (thread: ThreadResult, turnBy: number): Seat => ({ feature: thread.feature, face: thread.face, addToPhase: turnBy === 0 ? 0 : senseOf(thread) * turnBy, ...(thread.feature.includes('/') ? { inserted: true as const } : {}) });
  const entries = [entry(first, sameWay ? -delta : delta), entry(second, delta)];
  return [...entries.filter((e) => !e.inserted), ...entries.filter((e) => e.inserted)];
}

// A modelled thread on one body of a pair: its published record, the body and the lift of that
// body (`threadLift`, as `judgeThreaded` reads it for the zones of the body).
export interface ThreadOnBody {
  thread: ThreadResult;
  body: Id;
  lift: number;
}
// The rings two modelled threads that agree leave under a shoulder the wall of the other stands in
// (design.md of D76, "The cause named in the report" and its review; owner, 2026-11-28). The tool of
// a modelled thread stops the lift short of an end of the kind `shoulder` (`threadToolPlan`), so
// the wall keeps a ring that high there. For an end the body still has (`endsHad`, as `threadZone`
// reads it), the ring is, along the axis of the thread, at the start from the origin of the record
// (the end of the wall the tool saw) one lift into the wall, at the end from the end of the span or
// of the stretch, whichever is further, one lift back; each cut to the stretch the body still has
// (`walls`). A thread R gets an entry for such an end when the stretch of the wall of the other
// thread M on its body, longer by the run-out at an open end it still has (what follows that end
// reaches into the wall of R until it is as wide as the major diameter), mapped onto the axis of R
// (the second by `relative` into the frame of the first, as `seatOf` poses it), overlaps the ring
// by more than `tolerance.along` (the precision of the coordinates), and M's wall reaches past
// R's across the axis by more than `tolerance.across` (the chord tolerance: round faces within it
// are a fit; R internal: M's radius the larger, external: the smaller). The two have to agree (on
// one line, one internal and one external). `height` is the lift of R's body. From the records
// with no boolean; no phase or hand is read, so a copy moved by a pose or a mirror is judged as its
// source is. An entry of an inserted document (a prefixed ID) is marked and comes last; the entries
// of the first come before those of the second.
export function shortOfShoulderOf(first: ThreadOnBody, second: ThreadOnBody, relative: RigidTransform | undefined, tolerance: { across: number; along: number }): ShortOfShoulder[] {
  const placed = (side: ThreadOnBody, moved: boolean) => {
    const { thread } = side;
    const i = thread.bodies.indexOf(side.body);
    const [origin, axis] = moved && relative ? [transformPoint(relative, thread.origin), unit3(transformVector(relative, thread.axis))] : [thread.origin, thread.axis];
    return { ...side, origin, axis, wall: i < 0 ? undefined : thread.walls[i] };
  };
  const [one, two] = [placed(first, false), placed(second, true)];
  const entries: ShortOfShoulder[] = [];
  for (const [r, m] of [[one, two], [two, one]]) {
    const [rt, mt] = [r.thread, m.thread];
    if (!r.wall || !m.wall || !rt.modelled || rt.internal === mt.internal) continue;
    if ((rt.internal ? mt.radius - rt.radius : rt.radius - mt.radius) <= tolerance.across) continue;
    // the wall of M on its body with its run-outs, along the axis of R
    const mHad = endsHad(mt, m.wall, m.lift);
    const [from, to] = [m.wall.from - (mHad.start ? mt.runOut.start : 0), m.wall.to + (mHad.end ? mt.runOut.end : 0)];
    const [x, y] = [from, to].map((s) => dot3(sub3(add3(m.origin, mul3(m.axis, s)), r.origin), r.axis));
    const [low, high] = x < y ? [x, y] : [y, x];
    const rHad = endsHad(rt, r.wall, r.lift);
    for (const end of ['start', 'end'] as const) {
      if (rt.ends[end] !== 'shoulder' || !rHad[end]) continue;
      const [ringLow, ringHigh] = end === 'start' ? [Math.max(0, r.wall.from), Math.min(r.lift, r.wall.to)] : [Math.max(rt.to, r.wall.to) - r.lift, r.wall.to];
      if (Math.min(high, ringHigh) - Math.max(low, ringLow) <= tolerance.along) continue;
      entries.push({ feature: rt.feature, face: rt.face, end, height: r.lift, mate: { feature: mt.feature, face: mt.face }, ...(rt.feature.includes('/') ? { inserted: true as const } : {}) });
    }
  }
  return [...entries.filter((e) => !e.inserted), ...entries.filter((e) => e.inserted)];
}

// The ring of a zone with the numbers of its body; the `index`-th ring cut out of one body carries
// a number of its own (a difference takes operands whose face numbers differ).
const ringOfZone = (zone: ThreadZone, of: Zones, tolerance: number, index = 0): Solid => ringOf(zone, of.slack, of.lift, tolerance, RING_FACE - index);
const zoneKey = (zone: ThreadZone, of: Zones): string => JSON.stringify([zone.origin, zone.axis, zone.internal, zone.low, zone.high, zone.from, zone.to, of.slack, of.lift]);

// Step 1 and 2 of the rule for one zone: the body with the thread cut by the ring (the part in the
// zone kept by the mesh and the threads of the zone), and what the other body shares with that
// part, by pieces (kept by the two meshes).
function zoneTake(context: QueryContext, solid: Solid, zone: ThreadZone, other: Solid, of: Zones, tolerance: number): ZoneTake {
  const key = zoneKey(zone, of);
  const inZone = context.memo([solid, ...zone.threads], `zone:${key}`, (): Solid | undefined => {
    try {
      return context.kernel.boolean('intersection', solid, ringOfZone(zone, of, tolerance));
    } catch {
      return undefined;
    }
  });
  if (!inZone) return undefined;
  return context.memo([inZone, other], `take:${key}`, (): ZoneTake => {
    let common: Solid;
    try {
      common = context.kernel.boolean('intersection', inZone, other);
    } catch {
      return undefined;
    }
    const pieces = pieceSolids(common)
      .map((piece) => ({ piece, volume: Math.abs(volumeOf(piece)) }))
      .filter((entry) => entry.volume > THREAD_PIECE_VOLUME);
    if (pieces.length === 0 || !pieces.every((entry) => goesAround(entry.piece, zone))) return undefined;
    return { volume: pieces.reduce((sum, entry) => sum + entry.volume, 0) };
  });
}

// The body without the rings of its taken zones, as a body of a pair: its faces and its box stay,
// the cuts carry a number of no face. The body itself when no zone is taken or the kernel refuses.
function restOf(context: QueryContext, body: BodyResult, zones: readonly ThreadZone[], of: Zones, tolerance: number): BodyResult {
  if (zones.length === 0) return body;
  const solid = context.memo([body.solid, ...zones.flatMap((zone) => zone.threads)], `rest:${JSON.stringify(zones.map((zone) => zoneKey(zone, of)))}`, (): Solid => {
    try {
      return zones.reduce((rest, zone, index) => context.kernel.boolean('difference', rest, ringOfZone(zone, of, tolerance, index)), body.solid);
    } catch {
      return body.solid;
    }
  });
  return solid === body.solid ? body : { ...body, solid };
}

// Do the rings of two zones off one line share a volume (their boxes first, then the kernel)?
function ringsMeet(context: QueryContext, a: ThreadZone, ofA: Zones, b: ThreadZone, ofB: Zones, tolerance: number): boolean {
  if (boxesApart(ringBox(a, ofA.slack, ofA.lift), ringBox(b, ofB.slack, ofB.lift))) return false;
  try {
    return Math.abs(volumeOf(context.kernel.boolean('intersection', ringOfZone(a, ofA, tolerance), ringOfZone(b, ofB, tolerance)))) > THREAD_PIECE_VOLUME;
  } catch {
    return true; // the kernel cannot tell: the two are taken to meet, and the pair is judged whole
  }
}

export const interference: QuerySpec<typeof INTERFERENCE_ARGS, InterferenceReport> = {
  title: 'Interference',
  summary: 'Which bodies share a volume, pair by pair. Bodies that only touch are not reported. A screw in a bore with a thread (D76) overlaps it by design: such a pair is listed under `threaded`, not as a collision.',
  returns:
    '`pairs`: the collisions, each `{ a, b, volume, depth }` (mm³, mm; `a` is the smaller ID). `fits`: pairs that overlap no deeper than the chord tolerance where round faces meet (a pin in a hole of the same diameter), not collisions of the design. ' +
    '`pairs` and `fits` rest only on an intersection the kernel verified. `cleared` (only when it has an entry): pairs the kernel refused to verify and whose intersection as the kernel computed it measures as no collision, each `{ a, b, kind, volume, depth }` with `kind` `nothing` or `fit`; such a pair is clear, by a mesh nobody verified. ' +
    '`failed`: pairs that are neither colliding nor clear: the kernel refused them and what it computed measures as a collision or could not be measured; the message gives the reason and, when it was measured, the volume and depth as computed, not verified. `checked`: the number of pairs looked at. ' +
    '`threaded` (only when it has an entry): pairs of which a part of what they share is what a thread accounts for (a screw in a tapped hole, a plain rod of the nominal diameter in it), each `{ a, b, volume, threads }` with the volume excused (mm³) and the thread of every zone taken (`{ feature, face, body }`). ' +
    'What is left of such a pair is judged as every pair: a fit left (a head in its counterbore) puts it in `fits` as well, a collision left (a screw too long for a blind bore) in `pairs` alone, with the volume and depth of what is left; a thread excuses only what goes around its axis within its zone (a body pushed in from one side, a pin through a solid block, a rod thicker than the major diameter still collide). ' +
    'Two threads that meet and do not agree (another pitch, hand, diameter, flank angle or depth, two bores or two pins, axes off one line) make the pair a collision judged whole, its entry of `pairs` with `mismatch` saying what differs. ' +
    'Two modelled threads are judged by their meshes (nothing is excused); an entry of `pairs` between two that agree carries `seat`: for each of the two threads (`feature`, `face`) `addToPhase`, the angle in radians to add to the `phase` of its feature so that the two are one helix (either one seats the pair, for the pose asked about; a phase turns every face and copy of its feature; an entry marked `inserted` belongs to an inserted document and comes last; zero for both when the helices are one curve already and the collision has another cause). ' +
    'Such an entry carries `shortOfShoulder` (only when it has an entry) when a modelled thread of the pair ends at a shoulder and the wall of the other thread stands in the ring its groove leaves there, one lift high (`height`, mm): `{ feature, face, end, height, mate }`; a pair about that deep with a `seat` of 0 collides by the ring alone, which a chamfer of the end of the mate deeper than the profile (placed before its thread) frees, or a mate that stops more than the lift short of the shoulder (a deeper socket, a mate seated higher).',
  args: INTERFERENCE_ARGS,
  significant: { volume: 6, depth: 4, height: 4 },
  units: { volume: 'mm3', depth: 'mm' },
  // What a pair shares is kept by its two meshes: after a change of the model only the pairs with
  // a changed body go to the kernel again. In a pose a pair is computed in the frame of its first
  // body (the smaller ID), so the pairs a step of a sweep did not move are found again. What a
  // thread makes of a pair is kept by the meshes and the published threads (D76).
  run: (context, { bodies, threshold }) => {
    const tolerance = context.state.document.settings.chordTolerance;
    const pairs = new Map<string, ReturnType<typeof framed>>();
    const pairOf = (a: Id, b: Id): ReturnType<typeof framed> => {
      const key = JSON.stringify([a, b]);
      let found = pairs.get(key);
      if (!found) pairs.set(key, (found = framed(context.bodies, a, b)));
      return found;
    };
    return interferenceReport(
      context.bodies,
      bodies,
      threshold,
      tolerance,
      // boxes that hold the two posed bodies and do not meet: no moved mesh is built for the pair
      (a, b) => (boxesApart(boxOf(context.bodies, a), boxOf(context.bodies, b)) ? undefined : pairOf(a, b)),
      (a, b) => context.memo([a.solid, b.solid], 'shared', () => sharedBy(context.kernel, a, b, tolerance)),
      (a, b) => judgeThreaded(context, a, b, pairOf(a, b), tolerance),
    );
  },
};
