// The tool of a revolve (D58): a profile turned about an axis in the plane of its sketch. The setup
// is computed once per recompute step in the coordinates of the sketch (`revolveSetup`); a build
// places it in a frame (`buildRevolve`), the frame of the sketch or of a copy of a pattern. The
// rules are in docs/architecture/revolve.md.
import { type Loop, type OutlineCurve, type Region, segments } from '../sketch';
import { type FaceInfo, toWorld } from '../solid';
import type { AxisRef, FaceName, Frame, Id, RevolveFeature, SolidKernel, Vec2, Vec3 } from '../types';
import { ANGLE_TOLERANCE, LENGTH_TOLERANCE, add3, cross2, dot2, dot3, mul3, sub3 } from '../util';
import { type Move, nestingOf, outlineRegions, shown } from './outline';
import type { BuiltTool, ResolvedProfile } from './state';

type Extent = RevolveFeature['extent'];
const TAU = 2 * Math.PI;
const zeroless = (p: Vec3): Vec3 => [p[0] + 0, p[1] + 0, p[2] + 0];

// No tool of more triangles than this is built: `invalidProfile` (a tool of 1.7 million triangles
// took the kernel 27 s to cut, design of D58, "Measured").
export const MAX_REVOLVE_TRIANGLES = 1_000_000;

// The axis in the coordinates of the sketch: a point, a unit direction, and the side of it the
// profile lies on (+1 on the left of the direction, −1 on the right).
export interface RevolveAxis {
  point: Vec2;
  direction: Vec2;
  side: 1 | -1;
}
// The profile prepared for the turn:
// - `regions`: the exact outline of the profile divided again for half the chord tolerance;
// - `axis`: the axis projected into the plane of the sketch;
// - `steps`: the turn is divided into that many equal steps, by the rule of an arc at the largest
//   distance of a vertex of `regions` from the axis, for half the chord tolerance;
// - `triangles`: how many the tool has.
export interface RevolveSetup {
  regions: Region[];
  axis: RevolveAxis;
  steps: number;
  triangles: number;
}
export interface RevolveProblem {
  code: 'invalidAxis' | 'invalidProfile';
  refs: unknown[];
  // `detail` is appended to the general text of the code; `message` replaces it
  detail?: string;
  message?: string;
}

const turned = (degrees: number): string => `${shown(degrees)}°`;

// The setup of a revolve, or why it cannot be built. `line` is the axis as `axis` of
// recompute/services.ts resolved it, in model coordinates; `ref` the reference, for `refs`.
export function revolveSetup(profile: ResolvedProfile, line: { point: Vec3; direction: Vec3 }, ref: AxisRef, extent: Extent, chordTolerance: number): RevolveSetup | RevolveProblem {
  const { frame } = profile;
  const outline = profile.outline?.();
  if (!outline) return { code: 'invalidProfile', refs: [], message: 'A revolve needs a profile with exact curves.' };
  if ('code' in outline) return { code: 'invalidProfile', refs: outline.refs, ...(outline.message ? { message: outline.message } : {}) };
  const curves = outline.regions.flatMap((region) => [region.outer, ...region.holes]).flat();
  const named = (key: string): Id => profile.curveOf?.(key) ?? key;

  // 1. In the plane: the direction within ANGLE_TOLERANCE of it, the point of the reference within
  // LENGTH_TOLERANCE of it. The axis used is the projection into the plane.
  const local = (v: Vec3): Vec3 => [dot3(v, frame.x), dot3(v, frame.y), dot3(v, frame.normal)];
  const d3 = local(line.direction);
  const tilt = Math.asin(Math.min(1, Math.abs(d3[2]) / Math.hypot(...d3)));
  if (tilt > ANGLE_TOLERANCE) return { code: 'invalidAxis', refs: [ref], detail: `the axis is at ${turned((tilt * 180) / Math.PI)} to the plane of the sketch` };
  const p3 = local(sub3(line.point, frame.origin));
  if (Math.abs(p3[2]) > LENGTH_TOLERANCE) return { code: 'invalidAxis', refs: [ref], detail: `the axis lies ${shown(Math.abs(p3[2]))} mm off the plane of the sketch` };
  const direction: Vec2 = [d3[0] / Math.hypot(d3[0], d3[1]), d3[1] / Math.hypot(d3[0], d3[1])];
  const point: Vec2 = [p3[0], p3[1]];

  // 2. One side: the extreme signed distances of every curve from the axis (positive on its left).
  const signed = (p: Vec2): number => cross2(direction, [p[0] - point[0], p[1] - point[1]]);
  const reaches = (curve: OutlineCurve): number[] => {
    if (curve.type === 'circle') return [signed(curve.center) + curve.radius, signed(curve.center) - curve.radius];
    const values = [signed(curve.from), signed(curve.to)];
    if (curve.type === 'arc') {
      // the points of the sweep that lie straight across the axis from the centre
      const left = Math.atan2(direction[0], -direction[1]);
      for (const angle of [left, left + Math.PI]) {
        const offset = (((curve.sweep > 0 ? angle - curve.start : curve.start - angle) % TAU) + TAU) % TAU;
        if (offset < Math.abs(curve.sweep)) values.push(signed([curve.center[0] + curve.radius * Math.cos(angle), curve.center[1] + curve.radius * Math.sin(angle)]));
      }
    }
    return values;
  };
  let [left, right] = [{ by: 0, key: '' }, { by: 0, key: '' }];
  for (const curve of curves) {
    for (const value of reaches(curve)) {
      if (value > left.by) left = { by: value, key: curve.key };
      if (-value > right.by) right = { by: -value, key: curve.key };
    }
  }
  if (left.by > LENGTH_TOLERANCE && right.by > LENGTH_TOLERANCE) {
    return { code: 'invalidAxis', refs: [ref, named(left.key), named(right.key)], detail: `the profile lies on both sides of the axis: "${named(left.key)}" reaches ${shown(left.by)} mm to one side and "${named(right.key)}" ${shown(right.by)} mm to the other` };
  }
  if (left.by <= LENGTH_TOLERANCE && right.by <= LENGTH_TOLERANCE) return { code: 'invalidAxis', refs: [ref], detail: 'the profile lies on the axis' };
  const side: 1 | -1 = left.by > LENGTH_TOLERANCE ? 1 : -1;

  // 3. The polylines, divided for half the chord tolerance.
  const move: Move = {
    subject: 'Divided for half the chord tolerance, which a revolve needs, the profile',
    cure: 'Make the profile thicker where its curves come close, or raise the chord tolerance of the document.',
  };
  const regions = outlineRegions(outline, nestingOf(outline), chordTolerance / 2, move, profile.curveOf);
  if ('code' in regions) return { code: 'invalidProfile', refs: regions.refs, ...(regions.message ? { message: regions.message } : {}) };

  // 4. The steps of the turn, at the largest distance of a vertex from the axis.
  const axis: RevolveAxis = { point, direction, side };
  const loops = regions.flatMap((region) => [region.outer, ...region.holes]);
  const { rho } = coordinates(axis);
  let largest = 0;
  for (const loop of loops) for (let k = 0; k < loop.xy.length; k += 2) largest = Math.max(largest, rho(loop.xy[k], loop.xy[k + 1]));
  const sweep = extent.type === 'full' ? TAU : Math.abs(extent.angle);
  const steps = segments(sweep, largest, chordTolerance / 2);

  // 5. The size.
  let triangles = 0;
  for (const loop of loops) {
    const count = loop.xy.length / 2;
    for (let k = 0; k < count; k++) {
      const poles = [k, (k + 1) % count].filter((i) => rho(loop.xy[2 * i], loop.xy[2 * i + 1]) <= LENGTH_TOLERANCE).length;
      triangles += (2 - poles) * steps;
    }
  }
  if (extent.type === 'angle') for (const region of regions) triangles += 2 * ([region.outer, ...region.holes].reduce((sum, loop) => sum + loop.xy.length / 2, 0) + 2 * region.holes.length - 2);
  if (triangles > MAX_REVOLVE_TRIANGLES) {
    return {
      code: 'invalidProfile',
      refs: [],
      message: `The revolved tool would have ${triangles} triangles, more than ${MAX_REVOLVE_TRIANGLES}. Raise the chord tolerance of the document, or divide the part into smaller revolves.`,
    };
  }
  return { regions, axis, steps, triangles };
}

// The coordinates of a point of the sketch about the axis: `t` along it, `rho` from it towards the
// side of the profile (never below zero), and `e`, the unit vector of the plane across the axis
// towards the profile.
function coordinates(axis: RevolveAxis): { t: (x: number, y: number) => number; rho: (x: number, y: number) => number; e: Vec2 } {
  const { point, direction, side } = axis;
  const e: Vec2 = [-side * direction[1], side * direction[0]];
  return {
    t: (x, y) => (x - point[0]) * direction[0] + (y - point[1]) * direction[1],
    rho: (x, y) => Math.max(0, (x - point[0]) * e[0] + (y - point[1]) * e[1]),
    e,
  };
}

// The angle of the step `j` of a turn of `steps` steps.
const angleAt = (extent: Extent, steps: number, j: number): number => (extent.type === 'full' ? (TAU * j) / steps : extent.start + (extent.angle * j) / steps);

// Builds the closed mesh of the profile turned about the axis, placed by `frame` (D58). Every vertex
// is placed through `toWorld(frame, u, v, w)` from coordinates of the sketch, so in the left-handed
// frame of a mirrored copy the mesh is the mirror image facing inwards and `applyTool` turns it over
// (D53); the build does not correct it.
// - A vertex of the polylines on the axis (within `LENGTH_TOLERANCE`) is one vertex of the mesh;
//   every other one is placed at `steps` angles of a whole turn, or at `steps + 1` of a partial one.
// - Every edge of a loop between two neighbouring angles gives two triangles, one where an end lies
//   on the axis, none where both do (a curve along the axis makes no face). They are turned over
//   when the profile lies on the right of the axis or the angle is negative, not when both.
// - A partial turn has the two caps: the regions triangulated by the kernel once (`triangulation`,
//   shared by the builds of copies), placed at the start and at the end.
// - The faces: `startCap`, `endCap` (a partial turn only), then the sides in the order of their
//   keys, named by `sideOf`; a key whose edges all lie on the axis has no face.
export function buildRevolve(feature: Id, setup: RevolveSetup, extent: Extent, frame: Frame, sideOf: ResolvedProfile['sideOf'], firstFaceId: number, kernel: SolidKernel, triangulation?: Map<Region, Uint32Array>): BuiltTool {
  const { regions, axis, steps } = setup;
  const { point: o, direction: d, side } = axis;
  const { t: tOf, rho: rhoOf, e } = coordinates(axis);
  const full = extent.type === 'full';
  const rings = full ? steps : steps + 1;
  // a point of the half plane at `t` along the axis and `rho` from it, turned by `phi`, in the
  // coordinates of the sketch; a direction of the sketch turned likewise
  const at = (t: number, rho: number, phi: number): Vec3 => [o[0] + t * d[0] + rho * Math.cos(phi) * e[0], o[1] + t * d[1] + rho * Math.cos(phi) * e[1], rho * Math.sin(phi) * side];
  const turn = (v: Vec3, phi: number): Vec3 => {
    // v = a·d + b·e + c·ŵ; e turns towards side·ŵ, ŵ towards −side·e
    const [a, b, c] = [v[0] * d[0] + v[1] * d[1], v[0] * e[0] + v[1] * e[1], v[2]];
    const [b2, c2] = [b * Math.cos(phi) - side * c * Math.sin(phi), c * Math.cos(phi) + side * b * Math.sin(phi)];
    return [a * d[0] + b2 * e[0], a * d[1] + b2 * e[1], c2];
  };
  // without a negative zero, so that a published surface reads as it is written
  const world = (p: Vec3): Vec3 => zeroless(toWorld(frame, p[0], p[1], p[2]));
  const vector = (v: Vec3): Vec3 => zeroless(sub3(toWorld(frame, v[0], v[1], v[2]), frame.origin));

  // the vertices: a pole once, every other vertex once per angle
  const positions: number[] = [];
  const ringOf: number[][] = []; // by vertex of the loops in order: its mesh vertices by angle
  const loops = regions.flatMap((region) => [region.outer, ...region.holes]);
  for (const loop of loops) {
    for (let k = 0; k < loop.xy.length; k += 2) {
      const [t, rho] = [tOf(loop.xy[k], loop.xy[k + 1]), rhoOf(loop.xy[k], loop.xy[k + 1])];
      const first = positions.length / 3;
      if (rho <= LENGTH_TOLERANCE) {
        positions.push(...world(at(t, 0, 0)));
        ringOf.push([first]);
        continue;
      }
      for (let j = 0; j < rings; j++) positions.push(...world(at(t, rho, angleAt(extent, steps, j))));
      ringOf.push(Array.from({ length: rings }, (_, j) => first + j));
    }
  }
  const vertex = (index: number, j: number): number => {
    const ring = ringOf[index];
    return ring.length === 1 ? ring[0] : ring[full ? j % steps : j];
  };

  // the faces: the caps of a partial turn, then the sides by key
  const faces: BuiltTool['faces'] = [];
  const start = full ? 0 : extent.start;
  if (!full) {
    for (const [role, phi] of [['startCap', extent.start], ['endCap', extent.start + extent.angle]] as const) {
      faces.push({ name: { feature, role }, info: { planar: true, origin: world(add3([o[0], o[1], 0], turn([-o[0], -o[1], 0], phi))), y: vector(turn([0, 1, 0], phi)), normal: vector(turn([0, 0, 1], phi)) } });
    }
  }
  const out: number[] = [];
  const ids: number[] = [];
  const flip = side < 0 !== (!full && extent.angle < 0);
  const triangle = (a: number, b: number, c: number, face: number, over: boolean): void => {
    out.push(...(over ? [a, c, b] : [a, b, c]));
    ids.push(face);
  };
  // the keys that have a side: an edge with an end off the axis
  const isPole = (index: number): boolean => ringOf[index].length === 1;
  const keys = new Set<string>();
  let base = 0;
  for (const loop of loops) {
    const count = loop.xy.length / 2;
    for (let k = 0; k < count; k++) if (!isPole(base + k) || !isPole(base + ((k + 1) % count))) keys.add(loop.curves[k]);
    base += count;
  }
  const sideId = new Map<string, number>();
  for (const key of [...keys].sort()) {
    sideId.set(key, firstFaceId + faces.length);
    const { name, shape } = sideOf(key);
    faces.push({ name: { feature, ...name } as FaceName, info: sideInfo(shape, axis, start, world, vector) });
  }

  // the sides
  base = 0;
  for (const loop of loops) {
    const count = loop.xy.length / 2;
    for (let k = 0; k < count; k++) {
      const [p, q] = [base + k, base + ((k + 1) % count)];
      if (isPole(p) && isPole(q)) continue;
      const face = sideId.get(loop.curves[k]) as number;
      for (let j = 0; j < steps; j++) {
        if (isPole(p)) triangle(vertex(p, 0), vertex(q, j), vertex(q, j + 1), face, flip);
        else if (isPole(q)) triangle(vertex(p, j), vertex(q, 0), vertex(p, j + 1), face, flip);
        else {
          triangle(vertex(p, j), vertex(q, j), vertex(q, j + 1), face, flip);
          triangle(vertex(p, j), vertex(q, j + 1), vertex(p, j + 1), face, flip);
        }
      }
    }
    base += count;
  }

  // the caps of a partial turn: the start cap keeps the winding of the triangulation when the
  // profile lies on the right of the axis and the angle is positive, or on the left and negative
  if (!full) {
    const keep = side === -Math.sign(extent.angle);
    base = 0;
    for (const region of regions) {
      const regionLoops = [region.outer, ...region.holes];
      const flat = triangulation?.get(region) ?? kernel.triangulate(regionLoops.map((loop) => Float64Array.from(loop.xy)));
      triangulation?.set(region, flat);
      for (let i = 0; i < flat.length; i += 3) {
        const [a, b, c] = [base + flat[i], base + flat[i + 1], base + flat[i + 2]];
        triangle(vertex(a, 0), vertex(b, 0), vertex(c, 0), firstFaceId, !keep);
        triangle(vertex(a, steps), vertex(b, steps), vertex(c, steps), firstFaceId + 1, keep);
      }
      base += regionLoops.reduce((sum: number, loop: Loop) => sum + loop.xy.length / 2, 0);
    }
  }
  return { solid: { positions: Float32Array.from(positions), triangles: Uint32Array.from(out), faceIds: Uint32Array.from(ids) }, faces };
}

// The exact surface of the side a curve of the profile makes, in model coordinates.
// - A line: whose ends differ by at most `LENGTH_TOLERANCE` in their distance from the axis,
//   a cylinder; in their place along it, a plane across the axis (its origin the start `a` of the
//   line turned to the start of the turn, Y the direction the angle grows there); otherwise a cone
//   whose apex is where the line meets the axis and whose axis points from the apex to the face.
// - An arc or a circle: a sphere when its centre is within `LENGTH_TOLERANCE` of the axis,
//   otherwise a torus about the axis whose major radius is signed: positive when the centre lies on
//   the side of the profile, negative across the axis.
function sideInfo(shape: ReturnType<ResolvedProfile['sideOf']>['shape'], axis: RevolveAxis, start: number, world: (p: Vec3) => Vec3, vector: (v: Vec3) => Vec3): FaceInfo {
  const { point: o, direction: d, side } = axis;
  const e: Vec2 = [-side * d[1], side * d[0]];
  const tOf = (p: Vec2): number => dot2([p[0] - o[0], p[1] - o[1]], d);
  const rOf = (p: Vec2): number => dot2([p[0] - o[0], p[1] - o[1]], e);
  const onAxis = (t: number): Vec3 => [o[0] + t * d[0], o[1] + t * d[1], 0];
  const along = vector([d[0], d[1], 0]);
  if (shape.type === 'round') {
    const [t, r] = [tOf(shape.center), rOf(shape.center)];
    if (Math.abs(r) <= LENGTH_TOLERANCE) return { planar: false, surface: 'sphere', center: world(onAxis(t)), radius: shape.radius };
    return { planar: false, surface: 'torus', center: world(onAxis(t)), axis: along, majorRadius: r, minorRadius: shape.radius, along };
  }
  if (shape.type !== 'line') throw new Error('revolve: a side without an exact curve');
  const [ta, tb, ra, rb] = [tOf(shape.a), tOf(shape.b), rOf(shape.a), rOf(shape.b)];
  if (Math.abs(ra - rb) <= LENGTH_TOLERANCE) return { planar: false, surface: 'cylinder', center: world(onAxis(0)), axis: along, radius: (ra + rb) / 2, along };
  if (Math.abs(ta - tb) <= LENGTH_TOLERANCE) {
    const r = Math.max(0, ra);
    const origin: Vec3 = [o[0] + ta * d[0] + r * Math.cos(start) * e[0], o[1] + ta * d[1] + r * Math.cos(start) * e[1], r * Math.sin(start) * side];
    const y: Vec3 = [-Math.sin(start) * e[0], -Math.sin(start) * e[1], Math.cos(start) * side];
    return { planar: true, origin: world(origin), y: vector(y), normal: along };
  }
  const apex = ta + ((tb - ta) * (0 - ra)) / (rb - ra);
  const middle = (ta + tb) / 2;
  return { planar: false, surface: 'cone', apex: world(onAxis(apex)), axis: zeroless(mul3(along, Math.sign(middle - apex))), halfAngle: Math.atan2(Math.abs(rb - ra), Math.abs(tb - ta)), along };
}
