// The recompute of a thread (D76, stage 1: cosmetic threads): the profile from the fields, the wall
// a thread is made on, how its ends end, where its helix lies, the records the state keeps, and
// what the evaluation publishes of them. The step of the feature is features/thread.ts; the design
// is docs/d36/7a-thread/design.md, the rules as implemented docs/architecture/thread.md.
import { type FaceInfo, type RigidTransform, compose, mirrors, transformPoint, transformVector } from '../solid';
import type { CopyTag, FaceName, Facts, Id, Solid, ThreadEnd, ThreadFeature, ThreadResult, Vec3 } from '../types';
import { ANGLE_TOLERANCE, LENGTH_TOLERANCE, add3, cross3, dot3, faceKey, len3, mul3, sub3, unit3 } from '../util';
import { bandOf } from './body-boolean';
import type { State } from './state';
import { MAX_THREAD_TRIANGLES, MIN_THREAD_DEPTH_TOLERANCES, THREAD_TOOL_FACES, type ToolVariant, buildThreadTool, threadToolFaces, threadTriangles, toolShape } from './tool-thread';

const TAU = 2 * Math.PI;

// ---------------------------------------------------------------- the profile

// The basic profile from the fields: radii and flats. With a clearance the thread made is this
// profile with `major` and `minor` smaller (a pin) or larger (a bore) by the clearance; the flats
// stay.
export interface ThreadProfile {
  major: number; // radii
  minor: number;
  depth: number;
  pitch: number;
  lead: number;
  starts: number;
  hand: 1 | -1; // 1: right
  halfAngle: number; // flankAngle / 2
  crestFlat: number; // at the major radius
  rootFlat: number; // at the minor radius
}
export const DEFAULT_FLANK_ANGLE = Math.PI / 3;
// The depth of the basic profile when the field is absent: 5/8 of the sharp V of the pitch and the
// angle, the ISO proportion at any angle (0.541266 · P at 60°, 0.3125 · P at 90°).
export const defaultDepth = (pitch: number, flankAngle: number): number => (5 * pitch) / (16 * Math.tan(flankAngle / 2));

type ProfileFields = Pick<ThreadFeature, 'diameter' | 'pitch' | 'depth' | 'flankAngle' | 'starts' | 'hand'>;
export function threadProfile(f: ProfileFields): ThreadProfile | { detail: string; refs: string[] } {
  const flankAngle = f.flankAngle ?? DEFAULT_FLANK_ANGLE;
  const halfAngle = flankAngle / 2;
  const depth = f.depth ?? defaultDepth(f.pitch, flankAngle);
  const left = f.pitch - 2 * depth * Math.tan(halfAngle);
  if (left < -LENGTH_TOLERANCE) {
    return { refs: ['depth', 'pitch', 'flankAngle'], detail: `the flanks of a profile ${digits(depth)} deep at ${digits((flankAngle * 180) / Math.PI)}° take ${digits(2 * depth * Math.tan(halfAngle))} mm of the pitch of ${digits(f.pitch)}: they would cross; the largest depth this pitch and angle take is ${digits(f.pitch / (2 * Math.tan(halfAngle)))}` };
  }
  const flats = Math.max(0, left);
  if (2 * depth >= f.diameter - LENGTH_TOLERANCE) return { refs: ['depth', 'diameter'], detail: `a profile ${digits(depth)} deep leaves no minor diameter of a thread of ${digits(f.diameter)}` };
  const starts = f.starts ?? 1;
  return { major: f.diameter / 2, minor: f.diameter / 2 - depth, depth, pitch: f.pitch, lead: f.pitch * starts, starts, hand: f.hand === 'left' ? -1 : 1, halfAngle, crestFlat: flats / 3, rootFlat: (2 * flats) / 3 };
}

// The flat the grooves leave on the wall between them: the flat of the shifted profile at its
// crest, wider by 2 · tan(halfAngle) per unit the wall truncates the thread and narrower per unit
// the wall stands proud of it. Zero or less: the grooves would take the whole wall.
export const wallFlat = (profile: ThreadProfile, wall: { radius: number; internal: boolean }, clearance: number): number =>
  wall.internal
    ? profile.rootFlat + 2 * (wall.radius - (profile.minor + clearance)) * Math.tan(profile.halfAngle)
    : profile.crestFlat + 2 * (profile.major - clearance - wall.radius) * Math.tan(profile.halfAngle);
// The window of the wall, radii: a bore from the minor radius of the basic thread to half of the
// depth of the shifted one; a pin from half of the depth of the shifted one to the major radius of
// the basic thread.
export const wallWindow = (profile: ThreadProfile, internal: boolean, clearance: number): { low: number; high: number } =>
  internal ? { low: profile.minor, high: profile.major + clearance - profile.depth / 2 } : { low: profile.major - clearance - profile.depth / 2, high: profile.major };

// How far a tool keeps from what it must not lie in, how near to an end of the wall an end of
// a thread is taken to be at it, and how far the ring of a zone in the check of collisions reaches
// into the air: above the sagitta of the polygons and above two bands of the kernel adapter
// (`bandOf` of the body), as the lift of a blend is (D63). Of the body alone.
export const threadLift = (chordTolerance: number, bandOfBody: number): number => Math.max(0.05, 2 * chordTolerance, 2 * bandOfBody);

// ---------------------------------------------------------------- the mesh of a body around a face

// What the reading of walls and ends needs of a mesh, kept by the mesh: the canonical vertex of
// every vertex (vertices at one place are one), the triangles at every edge, the triangles and the
// vertices of every face.
interface Topology {
  canonical: Int32Array;
  byEdge: Map<number, number[]>; // canonical edge key → triangles
  trianglesOf: Map<number, number[]>; // face → triangles
}
const TOPOLOGY = new WeakMap<Solid, Topology>();
function topologyOf(solid: Solid): Topology {
  let found = TOPOLOGY.get(solid);
  if (found) return found;
  const p = solid.positions;
  const count = p.length / 3;
  const canonical = new Int32Array(count);
  const seen = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const key = `${p[3 * i]},${p[3 * i + 1]},${p[3 * i + 2]}`;
    const known = seen.get(key);
    canonical[i] = known ?? i;
    if (known === undefined) seen.set(key, i);
  }
  const byEdge = new Map<number, number[]>();
  const trianglesOf = new Map<number, number[]>();
  const t3 = solid.triangles;
  for (let t = 0; t < solid.faceIds.length; t++) {
    const face = solid.faceIds[t];
    let list = trianglesOf.get(face);
    if (!list) trianglesOf.set(face, (list = []));
    list.push(t);
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(canonical[t3[3 * t + k]], canonical[t3[3 * t + ((k + 1) % 3)]], count);
      const at = byEdge.get(key);
      if (at) at.push(t);
      else byEdge.set(key, [t]);
    }
  }
  found = { canonical, byEdge, trianglesOf };
  TOPOLOGY.set(solid, found);
  return found;
}
const edgeKey = (a: number, b: number, count: number): number => (a < b ? a * count + b : b * count + a);
const vertex = (solid: Solid, i: number): Vec3 => [solid.positions[3 * i], solid.positions[3 * i + 1], solid.positions[3 * i + 2]];
// The precision of the coordinates of a mesh: a millionth of its largest coordinate (D50).
export const precisionOf = (solid: Solid): number => 1e-6 * Math.max(1, solid.positions.reduce((max, value) => Math.max(max, Math.abs(value)), 0));

// Two unit vectors across an axis.
export function across(axis: Vec3): [Vec3, Vec3] {
  const ref: Vec3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = unit3(sub3(ref, mul3(axis, dot3(ref, axis))));
  return [e1, cross3(axis, e1)];
}

// ---------------------------------------------------------------- the wall

// The wall a thread is made on: the cylinder of the face, the side of its material, and its two
// ends along the axis (`along` of the face), read from the triangles of the face in the body.
export interface ThreadWall {
  face: number;
  center: Vec3; // a point of the axis
  axis: Vec3; // unit, in the sense of the face (`along`)
  radius: number;
  internal: boolean;
  low: number; // the ends of the face along `axis`, from `center`
  high: number;
}
// Refused with the reason: a face that is no cylinder, one whose triangles leave a gap of angle
// about the axis (a part of a cylinder), and one the body has both as a bore and as a pin.
export function threadWall(solid: Solid, face: number, info: FaceInfo): ThreadWall | { detail: string } {
  if (info.planar || info.surface !== 'cylinder') return { detail: `the face is ${info.planar ? 'a plane' : `a surface of the kind ${info.surface === 'mesh' ? 'general' : info.surface}`}, not a cylinder` };
  const axis = unit3(info.along);
  const center = info.center;
  const [e1, e2] = across(axis);
  const triangles = topologyOf(solid).trianglesOf.get(face) ?? [];
  if (triangles.length === 0) return { detail: 'the body has no triangle of the face' };
  const intervals: [number, number][] = [];
  let [outward, inward] = [0, 0];
  let [low, high] = [Infinity, -Infinity];
  const angleOf = (q: Vec3): number => {
    const d = sub3(q, center);
    return Math.atan2(dot3(d, e2), dot3(d, e1));
  };
  for (const t of triangles) {
    const [a, b, c] = [0, 1, 2].map((k) => vertex(solid, solid.triangles[3 * t + k]));
    for (const q of [a, b, c]) {
      const s = dot3(sub3(q, center), axis);
      low = Math.min(low, s);
      high = Math.max(high, s);
    }
    // the side of the material: the normal against the direction away from the axis
    const n = cross3(sub3(b, a), sub3(c, a));
    const centroid = mul3(add3(add3(a, b), c), 1 / 3);
    const rel = sub3(centroid, center);
    const away = sub3(rel, mul3(axis, dot3(rel, axis)));
    const side = dot3(n, away);
    if (side > 0) outward += side;
    else inward -= side;
    // the angles the triangle spans about the axis (a chord spans less than half a turn)
    const a0 = angleOf(a);
    const wrap = (x: number): number => x - TAU * Math.round(x / TAU);
    const [d1, d2] = [wrap(angleOf(b) - a0), wrap(angleOf(c) - a0)];
    const [from, to] = [a0 + Math.min(0, d1, d2), a0 + Math.max(0, d1, d2)];
    const start = ((from % TAU) + TAU) % TAU;
    const end = start + (to - from);
    if (end <= TAU) intervals.push([start, end]);
    else intervals.push([start, TAU], [0, end - TAU]);
  }
  const total = outward + inward;
  if (total <= 0) return { detail: 'the face has no area in the body' };
  if (Math.min(outward, inward) > 0.01 * total) return { detail: 'the body has the face both as a bore and as a pin (a cylinder left both ways by a combine)' };
  // a whole cylinder: the angles of its triangles leave no gap about the axis
  intervals.sort((x, y) => x[0] - y[0]);
  let reached = 0;
  let gap = 0;
  for (const [from, to] of intervals) {
    gap = Math.max(gap, from - reached);
    reached = Math.max(reached, to);
  }
  gap = Math.max(gap, TAU - reached);
  if (gap > 1e-6) return { detail: `the face is only a part of a cylinder (a gap of ${digits((gap * 180) / Math.PI)}° about its axis: a rounded corner, the end of a slot, a bore slit along its length); a thread needs a whole cylinder: cut a slit after the thread` };
  return { face, center, axis, radius: info.radius, internal: inward > outward, low, high };
}

// ---------------------------------------------------------------- the ends

// An end of a thread at an end of its wall, read from the mesh of the body and the descriptions of
// its faces (design.md, "The ends"). `band`: the radius that bounds the band of the thread (a bore:
// `major + clearance`, everything within it; a pin: `minor − clearance`, everything beyond it).
export function threadEndAt(solid: Solid, faceInfos: readonly FaceInfo[], wall: ThreadWall, end: 'low' | 'high', band: number): { kind: 'shoulder' | 'inside' } | { kind: 'open'; runOut: number } {
  const { canonical, byEdge, trianglesOf } = topologyOf(solid);
  const count = canonical.length;
  const eps = precisionOf(solid);
  const sign = end === 'high' ? 1 : -1;
  const wallEnd = end === 'high' ? wall.high : wall.low;
  const [e1, e2] = across(wall.axis);
  const along = (q: Vec3): number => dot3(sub3(q, wall.center), wall.axis);
  const radial = (q: Vec3): number => {
    const d = sub3(q, wall.center);
    return len3(sub3(d, mul3(wall.axis, dot3(d, wall.axis))));
  };
  const angle = (q: Vec3): number => {
    const d = sub3(q, wall.center);
    return Math.atan2(dot3(d, e2), dot3(d, e1));
  };
  const corner = (t: number, k: number): number => canonical[solid.triangles[3 * t + (k % 3)]];
  // the rim: the edges of the wall with a triangle of another face across
  const rim: { a: number; b: number; others: number[] }[] = [];
  for (const t of trianglesOf.get(wall.face) ?? []) {
    for (let k = 0; k < 3; k++) {
      const [a, b] = [corner(t, k), corner(t, k + 1)];
      const others = (byEdge.get(edgeKey(a, b, count)) ?? []).filter((o) => solid.faceIds[o] !== wall.face);
      if (others.length) rim.push({ a, b, others });
    }
  }
  // its loops, and those that go around the axis
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r) as number;
    parent.set(x, r);
    return r;
  };
  for (const e of rim) {
    const [ra, rb] = [find(e.a), find(e.b)];
    if (ra !== rb) parent.set(ra, rb);
  }
  const loops = new Map<number, typeof rim>();
  for (const e of rim) {
    const root = find(e.a);
    const loop = loops.get(root);
    if (loop) loop.push(e);
    else loops.set(root, [e]);
  }
  const around = [...loops.values()].filter((loop) => {
    const angles = loop.map((e) => angle(vertex(solid, e.a))).sort((x, y) => x - y);
    let gap = angles[0] + TAU - angles[angles.length - 1];
    for (let i = 1; i < angles.length; i++) gap = Math.max(gap, angles[i] - angles[i - 1]);
    return gap < Math.PI;
  });
  if (around.length === 0) return { kind: 'open', runOut: 0 };
  const reach = (loop: typeof rim): number => Math.max(...loop.map((e) => sign * along(vertex(solid, e.a))));
  const loop = around.reduce((best, candidate) => (reach(candidate) > reach(best) ? candidate : best));
  // the triangles across the rim
  let [shoulder, goesOn] = [false, false];
  const open = new Set<number>(); // the faces on the material side
  const start: number[] = [];
  for (const e of loop) {
    for (const other of e.others) {
      const face = solid.faceIds[other];
      if (sameWall(faceInfos[face], wall)) {
        goesOn = true;
        continue;
      }
      const third = [0, 1, 2].map((k) => corner(other, k)).find((v) => v !== e.a && v !== e.b);
      const inside = third === undefined || radial(vertex(solid, third)) <= wall.radius + eps;
      // inside the cylinder is the air of a bore and the material of a pin
      if (inside === wall.internal) shoulder = true;
      else {
        open.add(face);
        start.push(other);
      }
    }
  }
  if (shoulder) return { kind: 'shoulder' };
  if (goesOn && open.size === 0) return { kind: 'inside' };
  // the run-out: from the rim across the edges of the faces next to it, only through triangles
  // with a part in the band beyond the end
  const beyond = (q: Vec3): number => sign * (along(q) - wallEnd);
  let runOut = 0;
  const seen = new Set<number>();
  const queue = [...start];
  while (queue.length) {
    const t = queue.pop() as number;
    if (seen.has(t)) continue;
    seen.add(t);
    const corners = [0, 1, 2].map((k) => vertex(solid, solid.triangles[3 * t + k])) as [Vec3, Vec3, Vec3];
    const most = furthestInBand(corners, wall, band, beyond, eps);
    if (most === undefined || most < -eps) continue;
    runOut = Math.max(runOut, most);
    for (let k = 0; k < 3; k++) for (const next of byEdge.get(edgeKey(corner(t, k), corner(t, k + 1), count)) ?? []) if (!seen.has(next) && open.has(solid.faceIds[next])) queue.push(next);
  }
  return { kind: 'open', runOut };
}

// Is the face a cylinder about the same axis with the same radius (the wall going on under another
// name)? The directions to the angle tolerance, the lines and the radii to the length tolerance.
function sameWall(info: FaceInfo | undefined, wall: ThreadWall): boolean {
  if (!info || info.planar || info.surface !== 'cylinder') return false;
  const axis = unit3(info.axis);
  if (len3(cross3(axis, wall.axis)) > ANGLE_TOLERANCE) return false;
  const d = sub3(info.center, wall.center);
  return len3(sub3(d, mul3(wall.axis, dot3(d, wall.axis)))) <= LENGTH_TOLERANCE * Math.max(1, wall.radius) && Math.abs(info.radius - wall.radius) <= LENGTH_TOLERANCE * Math.max(1, wall.radius);
}

// The largest value of `beyond` over the part of a triangle in the band of a wall (within `band` of
// the axis for a bore, beyond it for a pin), exactly: the largest value of a linear function over
// that part lies at a vertex in the band, where an edge crosses the cylinder of the band, or at an
// extreme of the ellipse the plane of the triangle cuts from that cylinder. Undefined: no part.
function furthestInBand(t: [Vec3, Vec3, Vec3], wall: ThreadWall, band: number, beyond: (q: Vec3) => number, eps: number): number | undefined {
  const a = wall.axis;
  const flat = (q: Vec3): Vec3 => {
    const d = sub3(q, wall.center);
    return sub3(d, mul3(a, dot3(d, a)));
  };
  const inBand = (q: Vec3): boolean => {
    const r = len3(flat(q));
    return wall.internal ? r <= band + eps : r >= band - eps;
  };
  let best: number | undefined;
  const take = (q: Vec3): void => {
    const value = beyond(q);
    if (best === undefined || value > best) best = value;
  };
  for (const q of t) if (inBand(q)) take(q);
  // the edges across the cylinder of the band
  for (let k = 0; k < 3; k++) {
    const [p, q] = [t[k], t[(k + 1) % 3]];
    const [fp, fd] = [flat(p), sub3(flat(q), flat(p))];
    const A = dot3(fd, fd);
    if (A < 1e-24) continue;
    const B = 2 * dot3(fp, fd);
    const C = dot3(fp, fp) - band * band;
    const disc = B * B - 4 * A * C;
    if (disc < 0) continue;
    for (const s of [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)]) if (s >= 0 && s <= 1) take(add3(p, mul3(sub3(q, p), s)));
  }
  // the extremes of the ellipse of the plane of the triangle on the cylinder of the band
  const n = cross3(sub3(t[1], t[0]), sub3(t[2], t[0]));
  const nn = len3(n);
  const na = dot3(n, a);
  if (nn > 0 && Math.abs(na) > 1e-9 * nn) {
    const [e1, e2] = across(a);
    const d = dot3(n, sub3(t[0], wall.center));
    const [n1, n2] = [dot3(n, e1), dot3(n, e2)];
    const phi = Math.atan2(n2, n1);
    for (const angle of [phi, phi + Math.PI]) {
      const radial = add3(mul3(e1, band * Math.cos(angle)), mul3(e2, band * Math.sin(angle)));
      const s = (d - dot3(n, radial)) / na;
      const q = add3(add3(wall.center, mul3(a, s)), radial);
      if (insideTriangle(q, t, n)) take(q);
    }
  }
  return best;
}
function insideTriangle(q: Vec3, t: [Vec3, Vec3, Vec3], n: Vec3): boolean {
  for (let k = 0; k < 3; k++) {
    const [p, r] = [t[k], t[(k + 1) % 3]];
    if (dot3(cross3(sub3(r, p), sub3(q, p)), n) < -1e-12 * dot3(n, n)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- the datum

// The base direction of the helix of a listed face: the model's X axis made perpendicular to the
// axis (the Y axis when the axis is within about 26° of X: its component along X above 0.9).
export function baseZero(axis: Vec3): Vec3 {
  const ref: Vec3 = Math.abs(axis[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  return unit3(sub3(ref, mul3(axis, dot3(ref, axis))));
}
// `v` turned by `angle` about the unit `axis`, by the right-hand rule.
export function turned(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return add3(add3(mul3(v, c), mul3(cross3(axis, v), s)), mul3(axis, dot3(axis, v) * (1 - c)));
}

// ---------------------------------------------------------------- the records

// What the state keeps of a thread: the published thread without `bodies` and `walls`, with the
// number of its face, `stated`, the hand its feature states (a mirror of a body turns `hand` and
// the warning `mirroredThread` compares the two), and `sense`, how the `phase` of its feature turns
// its `zero` about its axis: +1 on a listed face, times −1 for every reflection on the way to it
// (a copy through a mirror pattern of features, a mirrored copy of the body, an insertion placed
// with a mirror). Adding x to the phase turns this helix by `sense · x` (the review of stage 2:
// `seat` reads it).
export interface ThreadRecord extends Omit<ThreadResult, 'bodies' | 'face' | 'walls'> {
  face: number;
  stated: 'right' | 'left';
  sense: 1 | -1;
}

// A record moved with its body (a copy of a pattern of a body, the placement of an insertion, the
// pose of a query): `origin` as a point, `axis` and `zero` as directions; a transform that mirrors
// turns `hand` over, and the curve the record then describes is the mirror image of the source's.
// `prefix`: of an insertion, put before `feature` as it is put before the feature of a face name.
export function movedThread(record: ThreadRecord, transform: RigidTransform, face: number, prefix?: string): ThreadRecord {
  const flipped = mirrors(transform);
  return {
    ...record,
    feature: prefix === undefined ? record.feature : `${prefix}${record.feature}`,
    face,
    origin: transformPoint(transform, record.origin),
    axis: unit3(transformVector(transform, record.axis)),
    zero: unit3(transformVector(transform, record.zero)),
    hand: flipped ? (record.hand === 'right' ? 'left' : 'right') : record.hand,
    sense: flipped ? (record.sense === 1 ? -1 : 1) : record.sense,
  };
}

// ---------------------------------------------------------------- the step

// `walls`: for every record its wall, the name of its face, the place of its listed face in `faces`
// and the further copy tags of a copy (what the tool of a modelled thread is named by).
export interface ThreadPlaced {
  name: FaceName;
  wall: ThreadWall;
  listed: number;
  tags: CopyTag[];
}
export type ThreadStepResult = { records: ThreadRecord[]; walls: ThreadPlaced[]; profile: ThreadProfile; facts: Facts; copies: number } | { code: 'brokenReference' | 'invalidThread'; refs: unknown[]; detail?: string };

// The walls, the profile, the checks, the spans, the datums and the ends: the records of a thread
// feature in a state, or why there are none (design.md, "Recompute", steps 2 to 5).
export function threadRecords(feature: ThreadFeature, state: State, solid: Solid): ThreadStepResult {
  const profile = threadProfile(feature);
  if ('detail' in profile) return { code: 'invalidThread', refs: profile.refs, detail: profile.detail };
  const clearance = feature.clearance ?? 0;
  const lift = threadLift(state.chordTolerance, bandOf(solid));
  const precision = Math.max(LENGTH_TOLERANCE, precisionOf(solid));
  const onBody = new Set(solid.faceIds);

  // the listed faces
  const listed: { name: FaceName; face: number }[] = [];
  for (const name of feature.faces) {
    const face = state.faceIds.get(faceKey(name));
    if (face === undefined || !onBody.has(face) || faceKey(state.faceNames[face]) !== faceKey(name)) return { code: 'brokenReference', refs: [name], detail: `the body "${feature.body}" has no face ${faceKey(name)}` };
    listed.push({ name, face });
  }
  // the copies of the listed faces a pattern of this document made (`copies`)
  const copies: { name: FaceName; face: number; of: number; tags: CopyTag[] }[] = [];
  if (feature.copies) {
    const listedFaces = new Set(listed.map((entry) => entry.face));
    const keys = listed.map((entry) => faceKey(entry.name));
    for (const face of [...onBody].sort((x, y) => x - y)) {
      if (listedFaces.has(face)) continue;
      const name = state.faceNames[face];
      const tags = name.copy ?? [];
      let best: { of: number; common: number } | undefined;
      listed.forEach((entry, i) => {
        const common = entry.name.copy?.length ?? 0;
        if (tags.length <= common) return;
        const stripped: FaceName = common ? { ...name, copy: tags.slice(0, common) } : (({ copy: _, ...rest }) => rest as FaceName)(name);
        if (faceKey(stripped) !== keys[i]) return;
        if (!tags.slice(common).every((tag) => state.copyTransforms.has(copyKey(tag)))) return;
        if (!best || common > best.common) best = { of: i, common };
      });
      if (best) copies.push({ name, face, of: best.of, tags: tags.slice(best.common) });
    }
    copies.sort((x, y) => x.of - y.of || (faceKey(x.name) < faceKey(y.name) ? -1 : 1));
  }

  // every wall, checked against the thread
  const walls: ThreadPlaced[] = [];
  for (const [i, entry] of [...listed, ...copies].entries()) {
    const wall = threadWall(solid, entry.face, state.faceInfos[entry.face]);
    if ('detail' in wall) return { code: 'invalidThread', refs: [entry.name], detail: wall.detail };
    const problem = fitProblem(profile, wall, clearance);
    if (problem) return { code: 'invalidThread', refs: [entry.name], detail: problem };
    const copy = i < listed.length ? undefined : copies[i - listed.length];
    walls.push({ name: entry.name, wall, listed: copy ? copy.of : i, tags: copy ? copy.tags : [] });
  }

  // the span, the datum and the ends of every wall
  const turn = profile.hand;
  const records: ThreadRecord[] = [];
  const datums: { origin: Vec3; axis: Vec3; zero: Vec3 }[] = [];
  for (const [i, { name, wall }] of walls.entries()) {
    const forward = feature.direction === 'forward';
    const axis = forward ? wall.axis : mul3(wall.axis, -1);
    const startAt = forward ? wall.low : wall.high;
    const origin = add3(wall.center, mul3(wall.axis, startAt));
    const length = wall.high - wall.low;
    const from = feature.offset ?? 0;
    const to = feature.length === undefined ? length : from + feature.length;
    if (from >= length - precision) return { code: 'invalidThread', refs: [name, 'offset'], detail: `the offset of ${digits(from)} reaches the far end of the face, which is ${digits(length)} long: the thread has no length` };
    if (to > length + precision) return { code: 'invalidThread', refs: [name, 'length'], detail: `the thread would end ${digits(to)} from the start of the face, which is ${digits(length)} long: it would pass the far end by ${digits(to - length)}` };
    // a span no longer than the lift would apply to no body (`stretchOf`)
    if (to - from <= lift) return { code: 'invalidThread', refs: [name, 'length'], detail: `a thread ${digits(to - from)} long is no longer than the lift of ${digits(lift)} (twice the chord tolerance, at least 0.05): it would be on no body` };
    // an end within the lift of an end of the wall is at that end
    const [atStart, atEnd] = [from < lift, to > length - lift];
    const band = wall.internal ? profile.major + clearance : profile.minor - clearance;
    const [startEnd, farEnd] = forward ? (['low', 'high'] as const) : (['high', 'low'] as const);
    const startRead = atStart ? threadEndAt(solid, state.faceInfos, wall, startEnd, band) : { kind: 'inside' as const };
    const endRead = atEnd ? threadEndAt(solid, state.faceInfos, wall, farEnd, band) : { kind: 'inside' as const };
    // the datum: of a listed face the model's axis turned by the phase; of a copy that of its listed
    // face carried by the transforms of its further tags, turned for where its own wall starts
    let zero: Vec3;
    let sense: 1 | -1 = 1;
    if (i < listed.length) zero = turned(baseZero(axis), axis, feature.phase ?? 0);
    else {
      const copy = copies[i - listed.length];
      const source = datums[copy.of];
      const transform = copy.tags.reduce<RigidTransform | undefined>((sum, tag) => {
        const t = state.copyTransforms.get(copyKey(tag)) as RigidTransform;
        return sum ? compose(t, sum) : t;
      }, undefined) as RigidTransform;
      if (mirrors(transform)) sense = -1; // the phase turns the carried datum the other way
      const carriedOrigin = transformPoint(transform, source.origin);
      const carriedZero = transformVector(transform, source.zero);
      const delta = dot3(sub3(origin, carriedOrigin), axis);
      const flat = sub3(carriedZero, mul3(axis, dot3(carriedZero, axis)));
      zero = turned(len3(flat) > 1e-9 ? unit3(flat) : baseZero(axis), axis, (turn * TAU * delta) / profile.lead);
    }
    datums.push({ origin, axis, zero });
    records.push({
      feature: feature.id,
      face: wall.face,
      internal: wall.internal,
      modelled: feature.modelled,
      diameter: feature.diameter,
      pitch: feature.pitch,
      depth: profile.depth,
      flankAngle: feature.flankAngle ?? DEFAULT_FLANK_ANGLE,
      clearance,
      starts: profile.starts,
      hand: feature.hand,
      stated: feature.hand,
      sense,
      ...(feature.label !== undefined ? { label: feature.label } : {}),
      radius: wall.radius,
      origin,
      axis,
      zero,
      from,
      to,
      ends: { start: startRead.kind, end: endRead.kind },
      runOut: { start: startRead.kind === 'open' ? startRead.runOut : 0, end: endRead.kind === 'open' ? endRead.runOut : 0 },
    });
  }

  // an earlier thread on a wall of this body over a part of the same length: only one that
  // applies to the body (the same sense of the face, a stretch of it here; a difference turns the
  // pin of a threaded tool into a bore its record does not apply to)
  for (const [i, record] of records.entries()) {
    const span = spanAlong(record, walls[i].wall);
    for (const earlier of state.threads) {
      if (earlier.face !== record.face || !stretchOf(earlier, solid, state.faceInfos[record.face], state.chordTolerance)) continue;
      const other = spanAlong(earlier, walls[i].wall);
      if (Math.min(span[1], other[1]) - Math.max(span[0], other[0]) > LENGTH_TOLERANCE) {
        return { code: 'invalidThread', refs: [walls[i].name, { feature: earlier.feature }], detail: `the face has a thread of "${earlier.feature}" over a part of this length already` };
      }
    }
  }

  const facts: Facts = {
    depth: profile.depth,
    minorDiameter: 2 * profile.minor,
    lead: profile.lead,
    crestFlat: profile.crestFlat,
    rootFlat: profile.rootFlat,
    threads: records.length,
    ...(feature.copies ? { copies: copies.length } : {}),
  };
  return { records, walls, profile, facts, copies: copies.length };
}

// ---------------------------------------------------------------- the tool of a modelled thread

// The tool of a modelled thread (stage 2): one tool per wall, all in one solid, cut from the body by
// one boolean. `build(first)` makes the solid and the faces, the faces of the wall at the place `i`
// numbered from `first + 5 · i` and its hidden faces `first + 5 · walls + i` (no face of the
// model); `guards` is that count of numbers. Refused before the build by the checks that exist
// because of the mesh (design.md, "The tool and the boolean").
export interface ThreadToolPlan {
  build(first: number, variant?: ToolVariant): { solid: Solid; faces: { name: FaceName; info: FaceInfo }[] };
  walls: number;
  triangles: number;
  trianglesOf(variant: ToolVariant): number; // the count of a variant, for the cap
}
export function threadToolPlan(feature: ThreadFeature, made: Extract<ThreadStepResult, { records: unknown }>, state: Pick<State, 'chordTolerance'>, solid: Solid): ThreadToolPlan | { refs: unknown[]; detail: string } {
  const tol = state.chordTolerance;
  const lift = threadLift(tol, bandOf(solid));
  const { profile } = made;
  const clearance = feature.clearance ?? 0;
  const tan = Math.tan(profile.halfAngle);
  const placed = made.records.map((record, i) => {
    const { wall, name, listed, tags } = made.walls[i];
    const length = wall.high - wall.low;
    const [atStart, atEnd] = [record.from < lift, record.to > length - lift];
    const z0 = record.ends.start === 'open' ? -record.runOut.start - lift : record.ends.start === 'shoulder' ? lift : atStart ? 0 : record.from;
    const z1 = record.ends.end === 'open' ? length + record.runOut.end + lift : record.ends.end === 'shoulder' ? length - lift : atEnd ? length : record.to;
    return { record, wall, name, listed, tags, z0, z1, shape: toolShape(profile, wall, clearance, lift) };
  });
  // the checks of one wall
  let triangles = 0;
  for (const { wall, name, z0, z1, shape } of placed) {
    const depth = wall.internal ? shape.rMax - wall.radius : wall.radius - shape.rMin;
    if (depth < MIN_THREAD_DEPTH_TOLERANCES * tol) return { refs: [name], detail: `the thread is ${digits(depth)} deep on this face, less than ${MIN_THREAD_DEPTH_TOLERANCES} chord tolerances of the document (${digits(tol)}): it cannot be modelled at that tolerance; make it cosmetic` };
    if (wall.internal && wall.radius <= 2 * lift) return { refs: [name], detail: `a bore of ${digits(2 * wall.radius)} is no wider than four lifts (${digits(4 * lift)}): the tool of its thread would have no hole; make it cosmetic` };
    if (wallFlat(profile, wall, clearance) < 2 * tol * tan) return { refs: [name], detail: `the flat the grooves leave on the wall (${digits(Math.max(0, wallFlat(profile, wall, clearance)))}) is too narrow for the chord tolerance ${digits(tol)}: the flanks of the tool would meet within one chord tolerance of the wall; take a smaller clearance or make the wall for it` };
    if (z1 - z0 <= tol) return { refs: [name, 'length'], detail: `nothing is left of the thread once it stops ${digits(lift)} short of the shoulder: make it longer` };
    triangles += threadTriangles(shape, z0, z1, tol);
  }
  if (triangles > MAX_THREAD_TRIANGLES) return { refs: [placed[0].name], detail: `the tools of the thread would have about ${triangles} triangles, more than ${MAX_THREAD_TRIANGLES}: make it shorter, put the faces into several features, or make it cosmetic` };
  // two tools that would cross: the cylinders that hold them meet
  const holder = (p: (typeof placed)[number]) => ({ low: p.wall.internal ? p.wall.radius - 2 * lift : p.shape.rMin, high: p.wall.internal ? p.shape.rMax : p.wall.radius + 2 * lift, a: add3(p.record.origin, mul3(p.record.axis, p.z0)), b: add3(p.record.origin, mul3(p.record.axis, p.z1)), axis: p.record.axis });
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const [h, k] = [holder(placed[i]), holder(placed[j])];
      const parallel = len3(cross3(h.axis, k.axis)) <= ANGLE_TOLERANCE;
      const off = len3(sub3(sub3(k.a, h.a), mul3(h.axis, dot3(sub3(k.a, h.a), h.axis))));
      let meet: boolean;
      if (parallel && off <= tol) {
        const [ka, kb] = [dot3(sub3(k.a, h.a), h.axis), dot3(sub3(k.b, h.a), h.axis)];
        const [hb] = [dot3(sub3(h.b, h.a), h.axis)];
        meet = Math.min(hb, Math.max(ka, kb)) > Math.max(0, Math.min(ka, kb)) && Math.min(h.high, k.high) > Math.max(h.low, k.low);
      } else meet = segmentDistance(h.a, h.b, k.a, k.b) < h.high + k.high;
      if (meet) return { refs: [placed[i].name, placed[j].name], detail: 'the tools of these two threads would cross: put them into two features' };
    }
  }
  return {
    walls: placed.length,
    triangles,
    trianglesOf: (variant) => placed.reduce((sum, p) => sum + threadTriangles(p.shape, p.z0, p.z1, tol, variant), 0),
    build: (first, variant = {}) => {
      const solids: Solid[] = [];
      const faces: { name: FaceName; info: FaceInfo }[] = [];
      for (const [i, p] of placed.entries()) {
        const datum = { origin: p.record.origin, axis: p.record.axis, zero: p.record.zero };
        solids.push(buildThreadTool(p.shape, p.wall.internal, datum, p.z0, p.z1, tol, lift, first + THREAD_TOOL_FACES.length * i, first + THREAD_TOOL_FACES.length * placed.length + i, variant));
        faces.push(...threadToolFaces(feature.id, p.listed, p.tags, p.shape, p.wall.internal, datum, p.z0, p.z1, p.wall.axis));
      }
      return { solid: joinedSolids(solids), faces };
    },
  };
}

// The solids one after another in one mesh.
function joinedSolids(solids: Solid[]): Solid {
  const vertices = solids.reduce((sum, x) => sum + x.positions.length, 0);
  const count = solids.reduce((sum, x) => sum + x.triangles.length, 0);
  const positions = new Float32Array(vertices);
  const triangles = new Uint32Array(count);
  const faceIds = new Uint32Array(count / 3);
  let [v, t] = [0, 0];
  for (const x of solids) {
    positions.set(x.positions, v);
    for (let k = 0; k < x.triangles.length; k++) triangles[t + k] = x.triangles[k] + v / 3;
    faceIds.set(x.faceIds, t / 3);
    v += x.positions.length;
    t += x.triangles.length;
  }
  return { positions, triangles, faceIds };
}

// The smallest distance of two segments.
function segmentDistance(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  const [d1, d2, r] = [sub3(q1, p1), sub3(q2, p2), sub3(p1, p2)];
  const [a, e, f] = [dot3(d1, d1), dot3(d2, d2), dot3(d2, r)];
  const c = dot3(d1, r);
  const b = dot3(d1, d2);
  const denom = a * e - b * b;
  let sParam = denom > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
  let tParam = (b * sParam + f) / e;
  if (tParam < 0) [tParam, sParam] = [0, Math.min(1, Math.max(0, -c / a))];
  else if (tParam > 1) [tParam, sParam] = [1, Math.min(1, Math.max(0, (b - c) / a))];
  return len3(sub3(add3(p1, mul3(d1, sParam)), add3(p2, mul3(d2, tParam))));
}

// The key of a copy tag in `State.copyTransforms`: as in the key of a face name.
export const copyKey = (tag: CopyTag): string => `${tag.pattern}:${tag.index}`;

// The span of a record along the axis of a wall, from its centre.
function spanAlong(record: Pick<ThreadRecord, 'origin' | 'axis' | 'from' | 'to'>, wall: ThreadWall): [number, number] {
  const [a, b] = [record.from, record.to].map((s) => dot3(sub3(add3(record.origin, mul3(record.axis, s)), wall.center), wall.axis));
  return a < b ? [a, b] : [b, a];
}

// Why a wall does not take the thread: the window of its radius and the flat on the wall.
function fitProblem(profile: ThreadProfile, wall: ThreadWall, clearance: number): string | undefined {
  const window = wallWindow(profile, wall.internal, clearance);
  const d = (r: number): string => digits(2 * r);
  const tolerance = LENGTH_TOLERANCE * Math.max(1, wall.radius);
  if (wall.internal) {
    if (wall.radius < window.low - tolerance) return `a bore of ${d(wall.radius)} is narrower than the minor diameter ${d(profile.minor)} of the thread: drill it at the tap-drill size, ${d(profile.minor)} or more`;
    if (wall.radius > window.high + tolerance) return `a bore of ${d(wall.radius)} is so wide that less than half of the depth of the thread is left: at most ${d(window.high)}${clearance ? ` with the clearance ${digits(clearance)}` : ''}`;
  } else {
    if (wall.radius > window.high + tolerance) return `a pin of ${d(wall.radius)} is wider than the major diameter ${d(profile.major)} of the thread`;
    if (wall.radius < window.low - tolerance) return `a pin of ${d(wall.radius)} is so narrow that less than half of the depth of the thread is left: at least ${d(window.low)}${clearance ? ` with the clearance ${digits(clearance)}` : ''}`;
  }
  if (wallFlat(profile, wall, clearance) <= LENGTH_TOLERANCE) {
    const t = 2 * Math.tan(profile.halfAngle);
    const largest = wall.internal ? profile.rootFlat / t + wall.radius - profile.minor : profile.crestFlat / t + profile.major - wall.radius;
    const made = wall.internal ? `a bore of ${d(profile.minor + clearance)}` : `a pin of ${d(profile.major - clearance)}`;
    return `the clearance ${digits(clearance)} leaves no crest on a ${wall.internal ? 'bore' : 'pin'} of ${d(wall.radius)}: the grooves would take the whole wall; make it ${made} (the diameter ${wall.internal ? 'plus' : 'less'} twice the clearance), or take a clearance below ${digits(Math.max(0, largest))}`;
  }
  return undefined;
}

// ---------------------------------------------------------------- what the evaluation publishes

// The label of a published thread for people (D76, the notes of an export and the rows of the
// parts list): its own label, else `diameter x pitch`.
export const threadLabel = (thread: Pick<ThreadResult, 'label' | 'diameter' | 'pitch'>): string => thread.label ?? `${Number(thread.diameter.toPrecision(6))} x ${Number(thread.pitch.toPrecision(6))}`;

// The side of the material of a face in a body and its vertices, kept by the mesh: +1 for a pin
// (the normals point away from the axis), −1 for a bore, 0 for neither.
interface FaceSide {
  side: number;
  vertices: number[];
}
const SIDES = new WeakMap<Solid, Map<number, FaceSide>>();
function faceSide(solid: Solid, face: number, info: FaceInfo | undefined): FaceSide {
  let kept = SIDES.get(solid);
  if (!kept) SIDES.set(solid, (kept = new Map()));
  let found = kept.get(face);
  if (found) return found;
  const triangles = topologyOf(solid).trianglesOf.get(face) ?? [];
  const vertices = new Set<number>();
  let sum = 0;
  for (const t of triangles) {
    const [a, b, c] = [0, 1, 2].map((k) => solid.triangles[3 * t + k]);
    vertices.add(a).add(b).add(c);
    if (info && !info.planar && info.surface === 'cylinder') {
      const [pa, pb, pc] = [vertex(solid, a), vertex(solid, b), vertex(solid, c)];
      const n = cross3(sub3(pb, pa), sub3(pc, pa));
      const rel = sub3(mul3(add3(add3(pa, pb), pc), 1 / 3), info.center);
      const axis = unit3(info.axis);
      sum += dot3(n, sub3(rel, mul3(axis, dot3(rel, axis))));
    }
  }
  found = { side: sum > 0 ? 1 : sum < 0 ? -1 : 0, vertices: [...vertices] };
  kept.set(face, found);
  return found;
}

// The stretch of the axis of a record (from its origin along its axis) that a body has of its
// face, when the record applies to the body: the body has the face with the material on the side
// `internal` says, and that stretch overlaps the span `from`–`to` of the thread by more than the
// lift of the body. A face two bodies share when the thread is made (a hole through a stack, a
// split before the thread) is threaded only on the body whose stretch the span lies on.
export function stretchOf(record: ThreadRecord, solid: Solid, info: FaceInfo | undefined, chordTolerance: number): { from: number; to: number } | undefined {
  const side = faceSide(solid, record.face, info);
  if (side.side !== (record.internal ? -1 : 1)) return undefined;
  let [from, to] = [Infinity, -Infinity];
  for (const v of side.vertices) {
    const s = dot3(sub3(vertex(solid, v), record.origin), record.axis);
    from = Math.min(from, s);
    to = Math.max(to, s);
  }
  const overlap = Math.min(to, record.to) - Math.max(from, record.from);
  return overlap > threadLift(chordTolerance, bandOf(solid)) ? { from, to } : undefined;
}

// The records of a state that apply to a body (`stretchOf`): what a pattern of the body carries to
// its copies.
export function threadsOn(state: Pick<State, 'threads' | 'faceInfos' | 'chordTolerance'>, solid: Solid): ThreadRecord[] {
  if (state.threads.length === 0) return [];
  const faces = new Set(solid.faceIds);
  return state.threads.filter((record) => faces.has(record.face) && stretchOf(record, solid, state.faceInfos[record.face], state.chordTolerance) !== undefined);
}

// The published list: for every record, the bodies of the state it applies to (`stretchOf`), and
// the stretch of the axis the face covers in each; a record with no such body is left out. The
// object published for a record is the same from one evaluation to the next for as long as its
// face name, its bodies and their stretches are the same.
const PUBLISHED = new WeakMap<ThreadRecord, { key: string; result: ThreadResult }>();
// `sense` of the record of a published thread (not published itself: the check of collisions reads
// it for `seat`); 1 for an object this module did not publish.
const SENSES = new WeakMap<ThreadResult, 1 | -1>();
export const phaseSense = (thread: ThreadResult): 1 | -1 => SENSES.get(thread) ?? 1;
export function threadResults(state: Pick<State, 'threads' | 'bodies' | 'faceNames' | 'faceInfos' | 'chordTolerance'>): ThreadResult[] {
  if (state.threads.length === 0) return [];
  const results: ThreadResult[] = [];
  const bodyIds = Object.keys(state.bodies);
  const faceSets = new Map<Id, Set<number>>();
  const facesOf = (id: Id): Set<number> => {
    let set = faceSets.get(id);
    if (!set) faceSets.set(id, (set = new Set(state.bodies[id].faceIds)));
    return set;
  };
  for (const record of state.threads) {
    const bodies: Id[] = [];
    const walls: { from: number; to: number }[] = [];
    for (const id of bodyIds) {
      if (!facesOf(id).has(record.face)) continue;
      const stretch = stretchOf(record, state.bodies[id], state.faceInfos[record.face], state.chordTolerance);
      if (!stretch) continue;
      bodies.push(id);
      walls.push(stretch);
    }
    if (bodies.length === 0) continue;
    const face = state.faceNames[record.face];
    const key = JSON.stringify([faceKey(face), bodies, walls]);
    const kept = PUBLISHED.get(record);
    if (kept && kept.key === key) {
      results.push(kept.result);
      continue;
    }
    const { feature, face: _face, stated: _stated, sense, ...rest } = record;
    const result: ThreadResult = { feature, face, bodies, ...rest, walls };
    PUBLISHED.set(record, { key, result });
    SENSES.set(result, sense);
    results.push(result);
  }
  return results;
}

// A number for a message: up to four decimal places, without trailing zeros.
const digits = (value: number): string => String(Number(value.toFixed(4)));
