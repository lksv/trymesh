// Interference of bodies: the volume two bodies share, pair by pair (D35, point 5).
import { coordinatePrecision } from './mesh-distance';
import { type Reach, type RigidTransform, penetration, thickestPiece, transformPoint, transformVector, volumeOf, volumeOfPieces } from './solid';
import type { BodyResult, Id, InterferenceReport, Solid, SolidKernel, Threaded, ThreadResult, Vec3 } from './types';
import { ANGLE_TOLERANCE, LENGTH_TOLERANCE, add3, cross3, dot3, has, len3, mul3, sub3, unit3 } from './util';

// Volumes up to this are noise, not a collision. In the spike flush faces, a pin in the hole cut
// by the same circle and identical cylinders gave exactly zero, and gears with a negative backlash
// of 0.05 mm 0.5 to 1.7 mm³. The kernel has a floor of its own below that: an overlap thinner than
// about a millionth of the size of the two bodies is welded away and counts as touching. Their
// size is the larger of their diagonal and twice their largest coordinate, so for planar faces
// the floor is about two millionths of the largest coordinate of the pair.
// A pin in a hole of the same diameter whose polygon is turned differently shares far more than
// this (slivers at the corners); how deep the bodies reach into each other tells it apart, see
// `report`.
export const INTERFERENCE_THRESHOLD = 0.001; // mm³

// A text that can be a file name on every common file system and still tells one body ID from
// another: letters, digits, dot, dash and underscore stay, every other character is written as %XX
// per byte of its UTF-8 form (`planets/1` is `planets%2F1`). The percent sign is escaped too, so
// two IDs never give the same name. Names that differ only in the case of letters are still
// different names here; a file system that ignores case needs a check by the caller. So does the
// length of the name, and a system with reserved names (`CON`, `NUL` on Windows) is not covered.
export function bodyFileName(body: Id): string {
  let name = '';
  for (const byte of new TextEncoder().encode(body)) {
    const char = String.fromCharCode(byte);
    name += /[A-Za-z0-9._-]/.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return name;
}

// What was measured of what two bodies share.
export interface Measured {
  volume: number;
  depth: number; // see `depthOf`
  planar: number; // the part of the depth that planar faces reach into each other
  round: boolean; // what they share has a face that is not planar
  slack: number; // how precisely a depth is known
}
const NOTHING: Measured = { volume: 0, depth: 0, planar: 0, round: false, slack: 0 };

// Faces of the two bodies that coincide leave sheets without thickness in their intersection.
// Their two sides have the same coordinates, so they are looked for within a small part of the
// precision of a depth: a real sliver as thin as that precision must keep its surface, or its
// mean thickness comes out many times too large.
const SHEET = 1e-3;

// How deep what two bodies share is: the larger of two measures.
// - How far one body reaches into the other (`penetration`). It finds a real overlap whatever
//   else the pair shares, but it is zero where the two surfaces coincide all around a volume
//   (two identical bodies, an identical part of two bodies).
// - The mean thickness of the thickest connected piece of what they share, twice its volume over
//   its surface. It finds a volume enclosed by coincident surfaces. Sheets would thin a piece
//   out; they are left out of the surface, but only when the depth is at most `limit` without
//   that, since looking for them is the slow part and can only raise the result.
function depthOf(common: Solid, a: Solid, b: Solid, isPlanar: (face: number) => boolean, limit: number, slack: number): Reach {
  const reached = penetration(common, a, b, isPlanar, limit);
  const rough = Math.max(reached.depth, thickestPiece(common));
  return { depth: rough > limit ? rough : Math.max(reached.depth, thickestPiece(common, SHEET * slack)), planar: reached.planar };
}

// The measure of a mesh two bodies share, with its volume handed in (a verified mesh and a mesh
// as computed take it differently). It throws when the volume is not a number.
function measure(common: Solid, volume: number, a: BodyResult, b: BodyResult, tolerance: number): Measured {
  if (!Number.isFinite(volume)) throw new Error('the intersection has a volume that is not a number');
  const planar = new Map([...a.faces, ...b.faces].map((face) => [face.id, face.planar]));
  // coordinates are single precision: a depth is known to about a millionth of the largest coordinate
  const slack = coordinatePrecision(a, b);
  // a face the two lists do not have cannot be called planar
  const isPlanar = (face: number): boolean => planar.get(face) === true;
  const deep = volume > 0 ? depthOf(common, a.solid, b.solid, isPlanar, tolerance + slack, slack) : { depth: 0, planar: 0 };
  return { volume, ...deep, round: common.faceIds.some((id) => planar.get(id) === false), slack };
}

// The most triangles of an intersection as computed that the second opinion measures (D50). The
// measure is the slow part (the search for sheets in `depthOf` grows with the square of the
// triangles of a piece); above the bound the pair stays failed, which is always allowed. Measured
// (2026-11-16): the arm of scenario 13 gives 512 to 888 triangles with the axis of its joint along
// a coordinate axis (0.1 to 0.2 s) and 1,806 to 7,452 askew (0.7 to 2.4 s); the largest
// intersection of two parts of the joint of scenario 9 (the housing and itself turned a little)
// has 9,174 and takes 3.7 s, as much through the kernel's verified answer. A fit askew near the
// bound, where the search for sheets runs (a pin of radius 12 at a chord tolerance of 0.003 and
// 0.0015), took 5.0 s at 11,768 triangles and 7.5 s at 10,018. The bound lies above every mesh
// the tests pin and holds a refused pair to about five to eight seconds.
export const SECOND_OPINION_TRIANGLES = 12000;

const text = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// What two bodies share. The kernel gives no guarantee for an intersection with flush faces and may
// refuse one (its result is cleaned and verified); then the answer is the reason of the refusal,
// with a second opinion when the kernel's intersection as computed could be measured (D50).
// `tolerance` belongs to the meshes (a document with another chord tolerance has other meshes), so
// the answer for a pair of meshes does not depend on the call and can be kept by the two meshes.
// - The second opinion is asked only when `boolean` threw, with the two bodies in the same order:
//   a pair the kernel answers keeps its answer and its cost.
// - When `boolean` answered with a mesh that cannot be measured, the pair is failed and the second
//   opinion is not asked: a kernel that hands out such a mesh is not asked again.
// - When the second call throws, its mesh cannot be measured or is above the bound, the answer is
//   the reason of the refusal alone (with the bound named when that was the cause).
// - The volume of a verified mesh is the absolute value of the whole (a sliver the cleaning left
//   inside out must not hide as a negative volume); that of a mesh as computed is added piece by
//   piece.
export type SharedVolume = Measured | { message: string; asComputed?: Measured };
export function sharedBy(kernel: SolidKernel, a: BodyResult, b: BodyResult, tolerance: number): SharedVolume {
  let common: Solid;
  try {
    common = kernel.boolean('intersection', a.solid, b.solid);
  } catch (refusal) {
    const message = text(refusal);
    try {
      const mesh = kernel.intersectionAsComputed(a.solid, b.solid).unverified;
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

// What one pair is, by one measure: the rule of the report, for the answer of the kernel and for
// the second opinion alike.
// - `nothing`: a volume at most the threshold, or no deeper than the precision of the coordinates
//   (noise of flush faces, whatever its size: large flush faces of turned copies share
//   a fraction of a mm³).
// - `fit`: otherwise, when neither body reaches deeper into the other than `tolerance` (the chord
//   tolerance of the document), what they share has a round face and no planar face of one body
//   reaches into a planar face of the other further than the polygon of a round face next to it
//   explains.
// - `collision`: otherwise; see InterferenceReport.
export type Verdict = 'nothing' | 'fit' | 'collision';
export function verdictOf(measured: Measured, threshold: number, tolerance: number): Verdict {
  if (!(measured.volume > threshold && measured.depth > measured.slack)) return 'nothing';
  return measured.round && measured.planar <= measured.slack && measured.depth <= tolerance + measured.slack ? 'fit' : 'collision';
}

// Three significant digits, without an exponent for the sizes a model has.
const digits = (value: number): string => String(Number(value.toPrecision(3)));

// The message of a refused pair whose intersection as computed measures as a collision: the
// reason of the refusal as the kernel gave it, then what was measured, said as what it is.
export function failedMessage(reason: string, asComputed: Measured): string {
  return `${reason}; as computed the two share ${digits(asComputed.volume)} mm³, ${digits(asComputed.depth)} mm deep, which the kernel could not verify`;
}

// The arguments as the method `Engine.interference` takes them: a mistake of the caller throws.
export function checkInterferenceOptions(bodies: Record<Id, BodyResult>, chosen: unknown, threshold: unknown): void {
  if (threshold !== undefined && (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0)) throw new Error('interference: the threshold is a volume in mm³, zero or more');
  if (chosen !== undefined && (!Array.isArray(chosen) || chosen.some((id) => typeof id !== 'string'))) throw new Error('interference: bodies is a list of body IDs');
  for (const id of (chosen as Id[] | undefined) ?? []) if (!has(bodies, id)) throw new Error(`interference: the body "${id}" does not exist`);
}

// Boxes that do not overlap (touching counts as apart): the two bodies share no volume.
export const boxesApart = (a: BodyResult['bounds'], b: BodyResult['bounds']): boolean => [0, 1, 2].some((axis) => a.max[axis] <= b.min[axis] || b.max[axis] <= a.min[axis]);

// The report over the bodies of one state. `chosen`: the bodies to check, all without a list.
// `pair` hands out the two bodies a pair is computed from: with a mechanism (D49) the first one as
// modelled and the second in its frame, so that the boxes that reject a pair, the precision of the
// coordinates and the meshes do not depend on where the pair stands; or nothing for a pair it
// rejected already by boxes that hold the two bodies (it then builds no moved mesh). `shared` answers for one pair;
// the caller keeps its answers by the two meshes, so that after a change of the model only the
// pairs with a changed body go to the kernel again.
// - A pair is reported by `verdictOf`: a fit or a collision when the volume of its intersection is
//   above the threshold and deeper than the precision of the coordinates; `a` is the smaller ID
//   in string order. Pairs come in the order of the bodies in the model.
// - A pair the kernel refused is judged by its second opinion with the same rule: `nothing` or
//   a fit puts it in `cleared`; a collision, or no second opinion, leaves it in `failed`, neither
//   colliding nor clear. The second opinion never puts a pair in `pairs` or `fits`.
// - Boxes that do not overlap need no kernel: the volume is zero.
// - `threaded` (D76): for a pair with a thread, what the threads make of it, or undefined when they
//   change nothing. With `taken` the pair is judged by `shared` of the judgement (what the rests of
//   the bodies share) and is listed in `threaded` unless that is a collision (then it is in `pairs`
//   alone, with what is left; a refused pair stays in `threaded` beside `failed` or `cleared`); with
//   `mismatch` it is judged whole and its entry of `pairs` says what differs.
export interface ThreadJudgement {
  shared?: SharedVolume;
  taken?: { volume: number; threads: Threaded['threads'] };
  mismatch?: string;
}
export function interferenceReport(
  bodies: Readonly<Record<Id, unknown>>,
  chosen: readonly Id[] | undefined,
  threshold: number,
  tolerance: number,
  pair: (a: Id, b: Id) => { a: BodyResult; b: BodyResult } | undefined,
  shared: (a: BodyResult, b: BodyResult) => SharedVolume,
  threaded?: (a: Id, b: Id, computed: { a: BodyResult; b: BodyResult }) => ThreadJudgement | undefined,
): InterferenceReport {
  const wanted = chosen === undefined ? undefined : new Set(chosen);
  const ids = Object.keys(bodies).filter((id) => wanted === undefined || wanted.has(id));
  const report: InterferenceReport = { pairs: [], fits: [], failed: [], checked: 0 };
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
      report.checked++;
      const computed = pair(a, b);
      const apart = !computed || boxesApart(computed.a.bounds, computed.b.bounds);
      const judged = apart || !threaded ? undefined : threaded(a, b, computed);
      const result = apart ? NOTHING : (judged?.shared ?? shared(computed.a, computed.b));
      const mismatch = judged?.mismatch === undefined ? {} : { mismatch: judged.mismatch };
      const verdict = 'message' in result ? undefined : verdictOf(result, threshold, tolerance);
      if (judged?.taken && verdict !== 'collision') (report.threaded ??= []).push({ a, b, volume: judged.taken.volume, threads: judged.taken.threads });
      if (!('message' in result)) {
        // `pairs` and `fits` are written here only, from a mesh the kernel verified
        if (verdict === 'fit') report.fits.push({ a, b, volume: result.volume, depth: result.depth });
        else if (verdict === 'collision') report.pairs.push({ a, b, volume: result.volume, depth: result.depth, ...mismatch });
        continue;
      }
      const second = result.asComputed;
      if (!second) {
        report.failed.push({ a, b, message: result.message });
        continue;
      }
      const kind = verdictOf(second, threshold, tolerance);
      if (kind === 'collision') report.failed.push({ a, b, message: failedMessage(result.message, second) });
      else (report.cleared ??= []).push({ a, b, kind, volume: second.volume, depth: second.depth });
    }
  }
  return report;
}

// ---------------------------------------------------------------- threads (D76)

// A connected piece of what another body shares with the part of a body in the zone of a thread is
// judged when its volume is above this, mm³: the constant of the check of collisions, not the
// threshold a caller gives the query, which may be zero. A sheet comes out as pieces of 10⁻¹⁸ mm³,
// most of which do not go around. A zone is taken only when it has a piece above it.
export const THREAD_PIECE_VOLUME = INTERFERENCE_THRESHOLD;
// A piece goes around an axis when its centre of volume is nearer to the axis than this part of
// the root of its mean squared distance from it: where the centre of a third of a ring lies,
// sin 60° / (π / 3). A whole ring has 0, half of one 0.637, a straight wall pushed into an M8
// thread from one side at least 0.94 (question 57 of D76).
export const THREAD_AROUND = Math.sin(Math.PI / 3) / (Math.PI / 3);

// The zone of a published thread on one of its bodies, in the frame of that thread: between the
// wall and the root of the thread, along the axis over the span the body still has of the wall,
// longer by the run-out at an open end it still has. `threads`: the threads of the zone (several
// for a joined zone).
export interface ThreadZone {
  origin: Vec3;
  axis: Vec3; // unit
  internal: boolean;
  low: number; // radii
  high: number;
  from: number; // along the axis from `origin`, the run-outs included
  to: number;
  threads: ThreadResult[];
}
// `lift`: of the body (`threadLift`), the distance within which the stretch of a body still has an
// end of the wall as the thread was made on it. Undefined: the body has no part of the span.
export function threadZone(thread: ThreadResult, body: Id, lift: number): ThreadZone | undefined {
  const i = thread.bodies.indexOf(body);
  if (i < 0) return undefined;
  const wall = thread.walls[i];
  // an end of the thread at an end of the wall the body still has runs out there: the stretch of
  // the body ends within the lift of it (a stretch that goes on past the end, as the face of
  // another body or of a union does, has the end no more); elsewhere the zone is the span cut to
  // the stretch
  const startHad = thread.ends.start !== 'inside' && Math.abs(wall.from - thread.from) <= lift;
  const endHad = thread.ends.end !== 'inside' && Math.abs(wall.to - thread.to) <= lift;
  const from = startHad ? wall.from - thread.runOut.start : Math.max(thread.from, wall.from);
  const to = endHad ? wall.to + thread.runOut.end : Math.min(thread.to, wall.to);
  if (!(to > from)) return undefined;
  const [low, high] = thread.internal ? [thread.radius, thread.diameter / 2 + thread.clearance] : [thread.diameter / 2 - thread.depth - thread.clearance, thread.radius];
  return { origin: thread.origin, axis: unit3(thread.axis), internal: thread.internal, low, high, from, to, threads: [thread] };
}

// Do two threads have the same profile (the fields `threadsAgree` compares and the clearance)?
const sameThread = (a: ThreadResult, b: ThreadResult): boolean =>
  a.internal === b.internal && a.hand === b.hand && a.starts === b.starts && Math.abs(a.pitch - b.pitch) <= LENGTH_TOLERANCE && Math.abs(a.diameter - b.diameter) <= LENGTH_TOLERANCE && Math.abs(a.depth - b.depth) <= LENGTH_TOLERANCE && Math.abs(a.flankAngle - b.flankAngle) <= ANGLE_TOLERANCE && Math.abs(a.clearance - b.clearance) <= LENGTH_TOLERANCE;
// The span of zone `b` along the axis of zone `a`, from the origin of `a`.
function spanOn(a: Pick<ThreadZone, 'origin' | 'axis'>, b: Pick<ThreadZone, 'origin' | 'axis' | 'from' | 'to'>): [number, number] {
  const [x, y] = [b.from, b.to].map((s) => dot3(sub3(add3(b.origin, mul3(b.axis, s)), a.origin), a.axis));
  return x < y ? [x, y] : [y, x];
}
// Two axes on one line: parallel or opposite within the angle tolerance, and no further apart than
// `distance`; the second number is how far apart they are (the larger of the distances of the
// two origins from the other line), the third the angle between them.
function line(a: Pick<ThreadZone, 'origin' | 'axis'>, b: Pick<ThreadZone, 'origin' | 'axis'>, distance: number): { one: boolean; apart: number; angle: number } {
  const angle = Math.asin(Math.min(1, len3(cross3(a.axis, b.axis))));
  const off = (p: Vec3, z: Pick<ThreadZone, 'origin' | 'axis'>): number => {
    const d = sub3(p, z.origin);
    return len3(sub3(d, mul3(z.axis, dot3(d, z.axis))));
  };
  const apart = Math.max(off(b.origin, a), off(a.origin, b));
  return { one: angle <= ANGLE_TOLERANCE && apart <= distance, apart, angle };
}
// Are the axes of two zones, in one frame, on one line (as `threadsAgree` reads it)?
export const onOneLine = (a: Pick<ThreadZone, 'origin' | 'axis'>, b: Pick<ThreadZone, 'origin' | 'axis'>, chordTolerance: number): boolean => line(a, b, chordTolerance).one;
// Zones of one body about one axis with the same radii whose spans touch or overlap are one zone,
// when their threads are the same in every field `threadsAgree` compares and in their clearance:
// the axes to the angle tolerance, the lines and the radii to the length tolerance, the spans to
// the lift. Two different threads on one wall stay two zones.
export function joinedZones(zones: readonly ThreadZone[], lift: number): ThreadZone[] {
  const out: ThreadZone[] = [];
  for (const zone of zones) {
    const joined = out.findIndex(
      (other) => sameThread(other.threads[0], zone.threads[0]) && line(other, zone, LENGTH_TOLERANCE * Math.max(1, zone.high)).one && Math.abs(other.low - zone.low) <= LENGTH_TOLERANCE * Math.max(1, zone.high) && Math.abs(other.high - zone.high) <= LENGTH_TOLERANCE * Math.max(1, zone.high) && (([x, y]) => x <= other.to + lift && other.from <= y + lift)(spanOn(other, zone)),
    );
    if (joined < 0) {
      out.push(zone);
      continue;
    }
    const other = out[joined];
    const [x, y] = spanOn(other, zone);
    out[joined] = { ...other, from: Math.min(other.from, x), to: Math.max(other.to, y), threads: [...other.threads, ...zone.threads] };
  }
  return out;
}

// A zone moved by a rigid transform (the zone of the second body of a pair into the frame of the
// first).
export const movedZone = (zone: ThreadZone, t: RigidTransform | undefined): ThreadZone => (t ? { ...zone, origin: transformPoint(t, zone.origin), axis: unit3(transformVector(t, zone.axis)) } : zone);

// The ring of a zone: the zone grown by `slack` (the chord tolerance and the precision of the
// coordinates) at the root, into the material of its body, and by `lift` everywhere else: beside
// the wall, into the air, and at both ends. A closed mesh whose faces carry `face`; its outer
// polygon is circumscribed and its inner one inscribed, so no chord of it dips into the zone.
export function ringOf(zone: ThreadZone, slack: number, lift: number, tolerance: number, face: number): Solid {
  const [inner, outer] = zone.internal ? [zone.low - lift, zone.high + slack] : [zone.low - slack, zone.high + lift];
  const [z0, z1] = [zone.from - lift, zone.to + lift];
  const step = Math.min(2 * Math.acos(Math.max(-1, 1 - Math.min(tolerance / outer, 1))), Math.PI / 4);
  const n = Math.max(8, Math.ceil((2 * Math.PI) / step - 1e-9));
  const grow = 1 / Math.cos(Math.PI / n);
  const [e1, e2] = acrossAxis(zone.axis);
  const at = (radius: number, angle: number, z: number): Vec3 => add3(add3(zone.origin, mul3(zone.axis, z)), add3(mul3(e1, radius * Math.cos(angle)), mul3(e2, radius * Math.sin(angle))));
  const positions: number[] = [];
  const triangles: number[] = [];
  const push = (p: Vec3): number => (positions.push(...p), positions.length / 3 - 1);
  const ring = (radius: number, z: number): number[] => Array.from({ length: n }, (_, i) => push(at(radius, (2 * Math.PI * i) / n, z)));
  const [ob, ot] = [ring(outer * grow, z0), ring(outer * grow, z1)];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    triangles.push(ob[i], ob[j], ot[j], ob[i], ot[j], ot[i]);
  }
  if (inner > 1e-9) {
    const [ib, it] = [ring(inner, z0), ring(inner, z1)];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      triangles.push(ib[i], it[j], ib[j], ib[i], it[i], it[j]);
      triangles.push(ob[i], ib[i], ib[j], ob[i], ib[j], ob[j]); // the bottom
      triangles.push(ot[i], ot[j], it[j], ot[i], it[j], it[i]); // the top
    }
  } else {
    const [cb, ct] = [push(at(0, 0, z0)), push(at(0, 0, z1))];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      triangles.push(cb, ob[j], ob[i], ct, ot[i], ot[j]);
    }
  }
  return { positions: Float32Array.from(positions), triangles: Uint32Array.from(triangles), faceIds: new Uint32Array(triangles.length / 3).fill(face) };
}
function acrossAxis(axis: Vec3): [Vec3, Vec3] {
  const ref: Vec3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = unit3(sub3(ref, mul3(axis, dot3(ref, axis))));
  return [e1, cross3(axis, e1)];
}
// A box that holds the ring of a zone.
export function ringBox(zone: ThreadZone, slack: number, lift: number): BodyResult['bounds'] {
  const radius = (zone.internal ? zone.high + slack : zone.high + lift) / Math.cos(Math.PI / 8);
  const [p, q] = [add3(zone.origin, mul3(zone.axis, zone.from - lift)), add3(zone.origin, mul3(zone.axis, zone.to + lift))];
  const reach = [0, 1, 2].map((k) => radius * Math.sqrt(Math.max(0, 1 - zone.axis[k] * zone.axis[k])));
  return { min: [0, 1, 2].map((k) => Math.min(p[k], q[k]) - reach[k]) as Vec3, max: [0, 1, 2].map((k) => Math.max(p[k], q[k]) + reach[k]) as Vec3 };
}

// Does a piece go around the axis of a zone? Sums over its triangles (its volume, its centre, its
// second moment about the axis), to which a sheet without thickness adds nothing.
export function goesAround(piece: Solid, zone: Pick<ThreadZone, 'origin' | 'axis'>): boolean {
  const [e1, e2] = acrossAxis(zone.axis);
  const p = piece.positions;
  const local = (i: number): Vec3 => {
    const d: Vec3 = [p[3 * i] - zone.origin[0], p[3 * i + 1] - zone.origin[1], p[3 * i + 2] - zone.origin[2]];
    return [dot3(d, e1), dot3(d, e2), dot3(d, zone.axis)];
  };
  let [v, cx, cy, rr] = [0, 0, 0, 0];
  for (let t = 0; t < piece.triangles.length; t += 3) {
    const [a, b, c] = [local(piece.triangles[t]), local(piece.triangles[t + 1]), local(piece.triangles[t + 2])];
    const d = dot3(a, cross3(b, c)) / 6;
    v += d;
    cx += (d * (a[0] + b[0] + c[0])) / 4;
    cy += (d * (a[1] + b[1] + c[1])) / 4;
    for (const k of [0, 1]) rr += (d / 10) * (a[k] ** 2 + b[k] ** 2 + c[k] ** 2 + a[k] * b[k] + a[k] * c[k] + b[k] * c[k]);
  }
  if (v === 0) return false;
  return Math.hypot(cx / v, cy / v) < THREAD_AROUND * Math.sqrt(Math.max(0, rr / v));
}

// Two threads off one line whose directions make a larger angle than this cross each other, and
// do not concern each other: each zone is judged on its own (a set-screw hole tapped across a
// threaded bore). Below it, rings that meet are a mate off its line, a mismatch (D76, the review of
// stage 1; measured: a stud leaning by 1° to 60° in its tapped hole still collides).
export const CROSSING_ANGLE = Math.PI / 4;

// Whether two zones of threads, in one frame, concern each other, and what differs between their
// threads when they do. "On one line": the directions parallel or opposite within the angle
// tolerance and the lines no further apart than the chord tolerance.
// - `apart`: the rings of the two zones do not meet. On one line: the zones do not overlap along
//   the axis or in their radii. Off one line: the directions make an angle above `CROSSING_ANGLE`,
//   or the two rings share no volume (`meet`, which builds them and asks the kernel).
// - `agree`: on one line, one internal and the other external, and the pitch, the number of starts,
//   the hand as each lies, the nominal diameter, the flank angle and the depth the same.
// - Else `mismatch`, in words.
export function threadsAgree(a: ThreadZone, b: ThreadZone, chordTolerance: number, meet: () => boolean): 'apart' | 'agree' | { mismatch: string } {
  const on = line(a, b, chordTolerance);
  if (!on.one) {
    // threads that cross (a tapped hole across a threaded bore) are no mates of each other
    if (on.angle > CROSSING_ANGLE) return 'apart';
    if (!meet()) return 'apart';
    return { mismatch: on.angle > ANGLE_TOLERANCE ? `the axes meet at ${round((on.angle * 180) / Math.PI)}°` : `the axes are ${round(on.apart)} apart` };
  }
  const [x, y] = spanOn(a, b);
  if (y <= a.from || a.to <= x || b.high <= a.low || a.high <= b.low) return 'apart';
  const [s, t] = [a.threads[0], b.threads[0]];
  const differs: string[] = [];
  if (s.internal === t.internal) differs.push(`two ${s.internal ? 'internal' : 'external'} threads`);
  if (s.hand !== t.hand) differs.push(`a ${t.hand}-hand thread in a ${s.hand}-hand one`);
  if (Math.abs(s.diameter - t.diameter) > LENGTH_TOLERANCE) differs.push(`diameter ${round(s.diameter)} against ${round(t.diameter)}`);
  if (Math.abs(s.pitch - t.pitch) > LENGTH_TOLERANCE) differs.push(`pitch ${round(s.pitch)} against ${round(t.pitch)}`);
  if (s.starts !== t.starts) differs.push(`${s.starts} starts against ${t.starts}`);
  if (Math.abs(s.flankAngle - t.flankAngle) > ANGLE_TOLERANCE) differs.push(`flanks at ${round((s.flankAngle * 180) / Math.PI)}° against ${round((t.flankAngle * 180) / Math.PI)}°`);
  else if (Math.abs(s.depth - t.depth) > LENGTH_TOLERANCE) differs.push(`depth ${round(s.depth)} against ${round(t.depth)}`);
  return differs.length ? { mismatch: differs.join(', ') } : 'agree';
}
const round = (value: number): string => String(Number(value.toPrecision(3)));
