// The tool of a modelled thread (D76, stage 2): the axial profile swept along the helix between two
// planes across the axis, cut flat at both while it is built. Moved from the spike
// (spikes/thread.spike.ts, `buildSwept`; spike.md A to I, L, N); the design is
// docs/d36/7a-thread/design.md, "The tool and the boolean".
// - The surface of the thread is a graph over the angle θ about the axis and the height z along it:
//   r(θ, z) = the radius of the profile at z − hand · lead · θ / 2π. In the plane (θ, z) the edges
//   of the profile are parallel straight lines (helices), and the mesh is made of axial sections at
//   a list of angles: between two neighbouring sections every strip of the profile is one quad,
//   cut by the planes of the two ends. The angles are those where a helix meets an end plane, with
//   each gap between them divided for the chord tolerance; a vertex within `snap` of an end plane
//   is the vertex of that plane, so no triangle is thinner than that.
// - Both hands are built by the same triangles (the surface is a graph over θ and z; spike.md, L).
// - The middle of the crest of the basic profile lies at z = 0 at the angle of `zero`, as the datum
//   of `ThreadResult` says.
import type { FaceInfo } from '../solid';
import type { FaceName, Solid, Vec3 } from '../types';
import { add3, cross3, mul3 } from '../util';
import type { ThreadProfile, ThreadWall } from './thread';

const TAU = 2 * Math.PI;

// The most triangles the tool of one feature may have (about three seconds of the boolean by the
// rate measured in the spike). A feature whose tools would have more is `invalidThread`.
export const MAX_THREAD_TRIANGLES = 200_000;
// A thread shallower than this many chord tolerances is not modelled (spike.md, H).
export const MIN_THREAD_DEPTH_TOLERANCES = 5;

type Role = 'flankA' | 'crest' | 'flankB' | 'root';
// The profile one tool is built from: the points of one pitch, `a` (along the axis) ascending; the
// segment that starts at a point has its `role`, the last one runs to the first point one pitch on.
// The ridge (`crest`) is centred at a = 0.
export interface ToolShape {
  pitch: number;
  lead: number;
  hand: 1 | -1;
  starts: number;
  points: { a: number; r: number; role: Role }[];
  rMin: number;
  rMax: number;
}

// The shape of the tool of a wall: the profile shifted by the clearance, run on to one lift beside
// the wall on its air side (a pin: the ridge of the groove tool at `wall + lift`; a bore: the root
// of the ring at `wall − lift`).
export function toolShape(profile: ThreadProfile, wall: Pick<ThreadWall, 'radius' | 'internal'>, clearance: number, lift: number): ToolShape {
  const shift = wall.internal ? clearance : -clearance;
  const major = profile.major + shift;
  const minor = profile.minor + shift;
  const tan = Math.tan(profile.halfAngle);
  const half = (r: number): number => profile.crestFlat / 2 + (major - r) * tan; // half the width of the ridge at r
  const sharp = major + profile.crestFlat / 2 / tan; // the flanks meet: no crest flat
  const vee = major - (profile.pitch / 2 - profile.crestFlat / 2) / tan; // the ridges meet: no root flat
  const rCrest = Math.min(wall.internal ? major : wall.radius + lift, sharp);
  const rRoot = Math.max(wall.internal ? wall.radius - lift : minor, vee);
  if (!(rCrest > rRoot && rRoot > 0)) throw new Error('the profile does not fit into one pitch');
  const [hc, hr] = [half(rCrest), half(rRoot)];
  let points: ToolShape['points'] = [
    { a: -hr, r: rRoot, role: 'flankA' },
    { a: -hc, r: rCrest, role: 'crest' },
    { a: hc, r: rCrest, role: 'flankB' },
    { a: hr, r: rRoot, role: 'root' },
  ];
  // a flat without a width is left out, so no segment is a point
  if (hc < 1e-9) points = points.filter((p) => p.role !== 'crest');
  if (profile.pitch - 2 * hr < 1e-9) points = points.filter((p) => p.role !== 'root');
  return { pitch: profile.pitch, lead: profile.lead, hand: profile.hand, starts: profile.starts, points, rMin: rRoot, rMax: rCrest };
}

const segmentsOf = (s: ToolShape) => s.points.map((p, i) => ({ from: p, to: i + 1 < s.points.length ? s.points[i + 1] : { ...s.points[0], a: s.points[0].a + s.pitch } }));
// The radius of the profile at `a`.
export function radiusAt(s: ToolShape, a: number): number {
  const base = s.points[0].a;
  const u = base + (a - base) - Math.floor((a - base) / s.pitch) * s.pitch;
  for (const { from, to } of segmentsOf(s)) if (u <= to.a) return from.r + ((to.r - from.r) * (u - from.a)) / (to.a - from.a);
  return s.points[0].r;
}
// The mean of r² over a pitch: the area of every cross-section is π times it, so the volume within
// the thread surface over a length l is exactly π · l · meanSquare.
export const meanSquare = (s: ToolShape): number => segmentsOf(s).reduce((sum, { from, to }) => sum + ((to.a - from.a) * (from.r * from.r + from.r * to.r + to.r * to.r)) / 3, 0) / s.pitch;

// The step of an arc for a chord tolerance, as the segments of a circle of a sketch have it.
const arcStep = (radius: number, tol: number): number => Math.min(2 * Math.acos(1 - Math.min(tol / radius, 1)), Math.PI / 4);

// The angles of the sections of a tool from z0 to z1.
function anglesOf(s: ToolShape, z0: number, z1: number, tol: number): { angles: number[]; snap: number } {
  const step = arcStep(s.rMax, tol);
  const snap = Math.min((0.05 * s.lead * step) / TAU, tol / 2);
  const wrap = (theta: number) => theta - Math.floor(theta / TAU) * TAU;
  const special: number[] = [];
  for (const end of [z0, z1]) for (const p of s.points) for (let t = 0; t < s.starts; t++) special.push(wrap((s.hand * TAU * (end - p.a - t * s.pitch)) / s.lead));
  special.sort((x, y) => x - y);
  const kept: number[] = [];
  const near = (TAU * snap) / s.lead;
  for (const theta of special) if (kept.length === 0 || (theta - kept[kept.length - 1] > near && kept[0] + TAU - theta > near)) kept.push(theta);
  const angles: number[] = [];
  kept.forEach((theta, i) => {
    const gap = (i + 1 < kept.length ? kept[i + 1] : kept[0] + TAU) - theta;
    const n = Math.max(1, Math.ceil(gap / step - 1e-9));
    for (let k = 0; k < n; k++) angles.push(theta + (gap * k) / n);
  });
  return { angles, snap };
}

// The triangles of the tool of one wall, counted before it is built: two per strip of the profile
// per section, over the pitches the span crosses, the two ends and the cylinder beside the wall.
// An upper bound of what the build makes (the strips beyond an end are left out there).
export function threadTriangles(s: ToolShape, z0: number, z1: number, tol: number): number {
  const n = anglesOf(s, z0, z1, tol).angles.length;
  const strips = s.points.length * (Math.ceil((z1 - z0) / s.pitch) + 2 * s.starts + 2);
  return n * (2 * strips + 6);
}

// The faces of a tool, in the order of their numbers from `firstFaceId`.
export const THREAD_TOOL_FACES = ['flankStart', 'flankEnd', 'root', 'endStart', 'endEnd'] as const;
type ToolFace = (typeof THREAD_TOOL_FACES)[number] | 'guard';

// The tool of one wall: a pin gets a groove (between the thread surface and a cylinder two lifts
// outside the wall), a bore a ring (between a cylinder two lifts inside the wall and the thread
// surface). `datum`: `origin`, `axis` (the direction the thread runs in) and `zero` of the record;
// `z0`, `z1` the planes of its ends along `axis` from `origin`. Faces: `THREAD_TOOL_FACES` from
// `firstFaceId`; the hidden faces (the cylinder beside the wall, the strips between the grooves)
// carry `guardFaceId`. The flanks are named by their normals out of the body: on a pin the flank on
// the side of the end of its ridge faces the end, in a bore the other one.
export function buildThreadTool(s: ToolShape, internal: boolean, datum: { origin: Vec3; axis: Vec3; zero: Vec3 }, z0: number, z1: number, tol: number, beside: number, firstFaceId: number, guardFaceId: number): Solid {
  const y = cross3(datum.axis, datum.zero);
  const positions: number[] = [];
  const triangles: number[] = [];
  const faceIds: number[] = [];
  const vertex = (r: number, theta: number, z: number): number => {
    const p = add3(add3(datum.origin, mul3(datum.zero, r * Math.cos(theta))), add3(mul3(y, r * Math.sin(theta)), mul3(datum.axis, z)));
    positions.push(p[0], p[1], p[2]);
    return positions.length / 3 - 1;
  };
  const number = (face: ToolFace): number => (face === 'guard' ? guardFaceId : firstFaceId + THREAD_TOOL_FACES.indexOf(face));
  // the role of a strip of the profile as a face of the tool
  const faceOfRole = (role: Role): ToolFace => {
    if (role === 'flankA') return internal ? 'flankEnd' : 'flankStart';
    if (role === 'flankB') return internal ? 'flankStart' : 'flankEnd';
    if (role === 'crest') return internal ? 'root' : 'guard';
    return internal ? 'guard' : 'root';
  };
  const triangle = (a: number, b: number, c: number, face: ToolFace, flip = false): void => {
    if (a === b || b === c || a === c) return;
    if (flip) triangles.push(a, c, b);
    else triangles.push(a, b, c);
    faceIds.push(number(face));
  };

  const m = s.points.length;
  const { angles, snap } = anglesOf(s, z0, z1, tol);
  const n = angles.length;
  // the helix g: the profile point g mod m, shifted by whole pitches
  const offsetOf = (g: number) => s.points[((g % m) + m) % m].a + Math.floor(g / m) * s.pitch;
  const index = new Map<string, number>();
  const keyed = (key: string, make: () => number): number => {
    let i = index.get(key);
    if (i === undefined) index.set(key, (i = make()));
    return i;
  };
  const low = (j: number) => keyed(`lo:${j}`, () => vertex(radiusAt(s, z0 - (s.hand * s.lead * angles[j]) / TAU), angles[j], z0));
  const high = (j: number) => keyed(`hi:${j}`, () => vertex(radiusAt(s, z1 - (s.hand * s.lead * angles[j]) / TAU), angles[j], z1));
  const at = (j: number, g: number): number => {
    if (j === n) return at(0, g + s.hand * m * s.starts); // a full turn on: the helix one lead further
    const z = offsetOf(g) + (s.hand * s.lead * angles[j]) / TAU;
    if (z <= z0 + snap) return low(j);
    if (z >= z1 - snap) return high(j);
    return keyed(`${g}:${j}`, () => vertex(s.points[((g % m) + m) % m].r, angles[j], z));
  };
  // the thread surface is the inner wall of a groove and the outer one of a ring
  const inside = !internal;
  const [gLow, gHigh] = [m * (Math.floor((z0 - s.lead) / s.pitch) - 2), m * (Math.ceil((z1 + s.lead) / s.pitch) + 2)];
  for (let j = 0; j < n; j++) {
    for (let g = gLow; g < gHigh; g++) {
      const [a, b, a2, b2] = [at(j, g), at(j, g + 1), at(j + 1, g), at(j + 1, g + 1)];
      if (a === b && a2 === b2) continue; // the strip is beyond an end at both sections
      const face = faceOfRole(s.points[((g % m) + m) % m].role);
      triangle(a, a2, b2, face, inside);
      triangle(a, b2, b, face, inside);
    }
  }
  // the cylinder beside the wall has its vertices at the same angles, so the ends are strips of quads
  const radius = internal ? s.rMin - beside : s.rMax + beside;
  const [w0, w1] = [angles.map((theta) => vertex(radius, theta, z0)), angles.map((theta) => vertex(radius, theta, z1))];
  for (let j = 0; j < n; j++) {
    const k = (j + 1) % n;
    triangle(w0[j], w0[k], w1[k], 'guard', !inside);
    triangle(w0[j], w1[k], w1[j], 'guard', !inside);
    triangle(low(j), w0[j], w0[k], 'endStart', inside);
    triangle(low(j), w0[k], low(k), 'endStart', inside);
    triangle(high(j), w1[k], w1[j], 'endEnd', inside);
    triangle(high(j), high(k), w1[k], 'endEnd', inside);
  }
  return { positions: Float32Array.from(positions), triangles: Uint32Array.from(triangles), faceIds: Uint32Array.from(faceIds) };
}

// The faces of the tool of the wall at `face` in `faces` of a feature (with the further copy tags of
// a copy), with their descriptions: the flanks general, the root the cylinder of the root about the
// axis of the wall, the ends planes across it.
export function threadToolFaces(feature: string, face: number, copy: FaceName['copy'], s: ToolShape, internal: boolean, datum: { origin: Vec3; axis: Vec3; zero: Vec3 }, z0: number, z1: number, wallAxis: Vec3): { name: FaceName; info: FaceInfo }[] {
  const tags = copy && copy.length ? { copy } : {};
  const general: FaceInfo = { planar: false, surface: 'general' };
  const plane = (z: number): FaceInfo => ({ planar: true, origin: add3(datum.origin, mul3(datum.axis, z)), y: cross3(datum.axis, datum.zero), normal: datum.axis });
  const root = internal ? s.rMax : s.rMin;
  return [
    { name: { feature, role: 'threadFlank', face, side: 'start', ...tags }, info: general },
    { name: { feature, role: 'threadFlank', face, side: 'end', ...tags }, info: general },
    { name: { feature, role: 'threadRoot', face, ...tags }, info: { planar: false, surface: 'cylinder', center: datum.origin, axis: datum.axis, radius: root, along: wallAxis } },
    { name: { feature, role: 'threadEnd', face, end: 'start', ...tags }, info: plane(z0) },
    { name: { feature, role: 'threadEnd', face, end: 'end', ...tags }, info: plane(z1) },
  ];
}
