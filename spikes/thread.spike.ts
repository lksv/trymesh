// Spike of modelled threads (D36 package 7a, docs/d36/7a-thread/spike.md; the question is in
// docs/backlog.md, "Helix and modelled threads"): is a thread built as a twisted extrusion of its
// planar cross-section feasible on the real kernel adapter, in time and in robustness?
// Runs over the sources of the packages: `buildPrism` of the engine for the bodies and the adapter
// of Manifold with its cleaning for every boolean. The builders of the tool live in this file; they
// are not engine code yet.
// Two builders of the same tool are measured:
// - `buildLayered`: the planned one. The cross-section r(θ) extruded in layers along the axis,
//   each layer turned by 2π · z / lead.
// - `buildSwept`: the axial profile (four points of a trapezoid) swept along the helix, cut flat at
//   both ends while it is built. The same solid with far fewer triangles.
// Run from the repository root: npx vitest run --config spikes/vitest.config.ts spikes/thread.spike.ts
// The default run is short (about 45 s: a chord tolerance of 0.05, one repeat, four random threads;
// 18 s of it are test 3b, the engine's check of collisions, added for the design of D75).
// THREAD_SPIKE_FULL=1 runs the sweeps over the chord tolerances 0.01, 0.05 and 0.1, both builds
// everywhere, a repeat for the warm times and 50 random threads (about six minutes).
// THREAD_SPIKE_COUNT, THREAD_SPIKE_SEED and THREAD_SPIKE_ONLY (a list of case numbers) steer the
// random threads of test 6. THREAD_SPIKE_PAST sets how far a tool runs past an open end in tests
// 2 and 6: millimetres (1 when absent), or `beside` for the distance it keeps from a shoulder.
// THREAD_SPIKE_TOLS (a list) sets the chord tolerances test 6 picks from (0.02, 0.05, 0.1 when absent).
// Test 7 holds what was measured for the review of the design (spike.md, L to P).
import { expect, test } from 'vitest';
import type { Solid } from '../packages/engine/src/index';
import type { Region } from '../packages/engine/src/sketch';
import { buildPrism } from '../packages/engine/src/recompute/tool-prism';
import { sharedBy, verdictOf } from '../packages/engine/src/interference';
import { type RigidTransform, compose, pieceSolids, rotation, shift, transformFrame, transformPoint, volumeOf } from '../packages/engine/src/solid';
import type { BodyResult } from '../packages/engine/src/types';
import { createManifoldKernel } from '../packages/kernel-manifold/src/index';

const kernel = await createManifoldKernel();
const FULL = process.env.THREAD_SPIKE_FULL === '1';
const TAU = 2 * Math.PI;
type P = [number, number];

// ---------------------------------------------------------------- the axial profile

// The basic profile of a thread in the axial plane, as radii: a trapezoid ridge per pitch with
// straight flanks. `alpha` is the half-angle of the flanks (between a flank and the perpendicular
// to the axis; 30° for the ISO metric profile). `crestFlat` is the width of the flat at the major
// radius; the flat at the minor radius follows.
interface Basic {
  pitch: number;
  starts: number;
  hand: 1 | -1; // 1 = right-handed
  major: number;
  minor: number;
  crestFlat: number;
  alpha: number;
}
// The basic profile of ISO 68-1 from its definition: H = √3/2 · P, the minor diameter
// D − 2 · 5/8 · H, the crest flat P/8 (the root flat comes out as P/4).
const iso = (diameter: number, pitch: number, more: Partial<Basic> = {}): Basic => ({ pitch, starts: 1, hand: 1, major: diameter / 2, minor: diameter / 2 - ((5 / 8) * Math.sqrt(3) * pitch) / 2, crestFlat: pitch / 8, alpha: Math.PI / 6, ...more });
// A thread for printing: a depth and a half-angle, the flats at the crest and at the root equal.
const printed = (diameter: number, pitch: number, depth: number, alphaDegrees: number, more: Partial<Basic> = {}): Basic => {
  const alpha = (alphaDegrees * Math.PI) / 180;
  return { pitch, starts: 1, hand: 1, major: diameter / 2, minor: diameter / 2 - depth, crestFlat: pitch / 2 - depth * Math.tan(alpha), alpha, ...more };
};

type Role = 'flankA' | 'crest' | 'flankB' | 'root';
// The profile a tool is built from: the points of one pitch, `a` (along the axis) ascending; the
// segment that starts at a point has its `role`, the last one runs to the first point one pitch on.
interface Shape {
  pitch: number;
  lead: number;
  hand: 1 | -1;
  starts: number;
  points: { a: number; r: number; role: Role }[];
  rMin: number;
  rMax: number;
}
// The surface of the thread is r(θ, z) = radiusAt(z − hand · lead · θ / 2π).
// `offset` moves the profile along its normal (positive: the screw shape grows; the clearance of
// a nut is an offset of the shape that is cut out of it). `crestTo` and `rootTo` run the flanks on
// to another radius: the tool of a cut must end beside the wall it cuts, never on it.
function shapeOf(b: Basic, o: { offset?: number; crestTo?: number; rootTo?: number } = {}): Shape {
  if (!(b.alpha > 0)) throw new Error('the spike takes flanks with an angle (a square thread is not built)');
  const offset = o.offset ?? 0;
  const [tan, cos] = [Math.tan(b.alpha), Math.cos(b.alpha)];
  const half = (r: number) => b.crestFlat / 2 + (b.major - r) * tan + offset / cos; // half the width of the ridge at r
  const sharp = b.major + (b.crestFlat / 2 + offset / cos) / tan; // the flanks meet: no crest flat
  const vee = b.major - (b.pitch / 2 - b.crestFlat / 2 - offset / cos) / tan; // the ridges meet: no root flat
  const rCrest = Math.min(o.crestTo ?? b.major + offset, sharp);
  const rRoot = Math.max(o.rootTo ?? b.minor + offset, vee);
  if (!(rCrest > rRoot && rRoot > 0)) throw new Error('the profile does not fit into one pitch');
  const [hc, hr, mid] = [half(rCrest), half(rRoot), b.pitch / 2];
  let points: Shape['points'] = [
    { a: mid - hr, r: rRoot, role: 'flankA' },
    { a: mid - hc, r: rCrest, role: 'crest' },
    { a: mid + hc, r: rCrest, role: 'flankB' },
    { a: mid + hr, r: rRoot, role: 'root' },
  ];
  // a flat without a width is left out, so no segment is a point
  if (hc < 1e-9) points = points.filter((p) => p.role !== 'crest');
  if (b.pitch - 2 * hr < 1e-9) points = points.filter((p) => p.role !== 'root');
  return { pitch: b.pitch, lead: b.pitch * b.starts, hand: b.hand, starts: b.starts, points, rMin: rRoot, rMax: rCrest };
}
// The segments of one pitch as pairs of ends.
const segmentsOf = (s: Shape) => s.points.map((p, i) => ({ from: p, to: i + 1 < s.points.length ? s.points[i + 1] : { ...s.points[0], a: s.points[0].a + s.pitch } }));
function radiusAt(s: Shape, a: number): number {
  const base = s.points[0].a;
  const u = base + (a - base) - Math.floor((a - base) / s.pitch) * s.pitch;
  for (const { from, to } of segmentsOf(s)) if (u <= to.a) return from.r + ((to.r - from.r) * (u - from.a)) / (to.a - from.a);
  return s.points[0].r;
}
// The mean of r² over a pitch: the area of every cross-section is π times it, so the volume of
// a screw shape of the length l is exactly π · l · meanSquare.
const meanSquare = (s: Shape): number => segmentsOf(s).reduce((sum, { from, to }) => sum + ((to.a - from.a) * (from.r * from.r + from.r * to.r + to.r * to.r)) / 3, 0) / s.pitch;
// The same of a function of the axial coordinate, numerically (for what two shapes share).
const meanOver = (pitch: number, f: (a: number) => number, steps = 40000): number => {
  let sum = 0;
  for (let i = 0; i < steps; i++) sum += f(((i + 0.5) * pitch) / steps);
  return sum / steps;
};
// The distance of a point of an axial plane from the profile.
function profileDistance(s: Shape, a: number, r: number): number {
  const base = s.points[0].a;
  const u = base + (a - base) - Math.floor((a - base) / s.pitch) * s.pitch;
  let best = Infinity;
  for (const shift of [-s.pitch, 0, s.pitch]) {
    for (const { from, to } of segmentsOf(s)) {
      const [dx, dy] = [to.a - from.a, to.r - from.r];
      const t = Math.max(0, Math.min(1, ((u - from.a - shift) * dx + (r - from.r) * dy) / (dx * dx + dy * dy)));
      best = Math.min(best, Math.hypot(u - from.a - shift - t * dx, r - from.r - t * dy));
    }
  }
  return best;
}

// ---------------------------------------------------------------- the tools

// The step of an arc for a chord tolerance, as `segments` of the engine's sketch.ts has it, without
// its cap of the count.
const arcStep = (radius: number, tol: number): number => Math.min(2 * Math.acos(1 - Math.min(tol / radius, 1)), Math.PI / 4);
const stepsOf = (sweep: number, radius: number, tol: number): number => Math.max(1, Math.ceil(sweep / arcStep(radius, tol) - 1e-9));

// What the tool is: the screw shape itself (all within the thread surface), a groove (between the
// thread surface and a cylinder outside it: the tool that cuts an external thread into a rod), or
// a ridge (between a cylinder inside it and the thread surface: what a union adds to a core).
type Kind = { kind: 'solid' } | { kind: 'groove'; outer: number } | { kind: 'ridge'; inner: number };
const FACES = ['start', 'end', 'flankA', 'crest', 'flankB', 'root', 'wall'] as const;
type FaceRole = (typeof FACES)[number];
interface Tool {
  solid: Solid;
  first: number; // the face `FACES[i]` has the number first + i
  build: string;
  perTurn: number; // lines of a full turn
  layers: number; // 0 for the swept build
  loop: number; // points of the cross-section, 0 for the swept build
}
const faceOf = (tool: Tool, role: FaceRole): number => tool.first + FACES.indexOf(role);
const tris = (s: Solid) => s.triangles.length / 3;

class Mesh {
  positions: number[] = [];
  plane: number[] = []; // x and y of every vertex before the pose
  triangles: number[] = [];
  faces: number[] = [];
  // `pose` places the tool as a frame of the engine would: applied to every vertex in float64
  constructor(
    readonly center: P,
    readonly first: number,
    readonly pose?: RigidTransform,
  ) {}
  vertex(r: number, theta: number, z: number): number {
    const p: [number, number, number] = [this.center[0] + r * Math.cos(theta), this.center[1] + r * Math.sin(theta), z];
    this.positions.push(...(this.pose ? transformPoint(this.pose, p) : p));
    this.plane.push(p[0], p[1]);
    return this.positions.length / 3 - 1;
  }
  // a triangle with a repeated vertex is left out; `flip` turns it over
  triangle(a: number, b: number, c: number, role: FaceRole, flip = false): void {
    if (a === b || b === c || a === c) return;
    if (flip) this.triangles.push(a, c, b);
    else this.triangles.push(a, b, c);
    this.faces.push(this.first + FACES.indexOf(role));
  }
  solid(): Solid {
    return { positions: Float32Array.from(this.positions), triangles: Uint32Array.from(this.triangles), faceIds: Uint32Array.from(this.faces) };
  }
}

// The cross-section at z = 0 as a polar loop, θ ascending over one turn; `role[i]` is the role of
// the line from the point i to the next one. A flank is r linear in θ (a spiral of Archimedes).
function polarLoop(s: Shape, tol: number): { theta: number[]; r: number[]; role: Role[] } {
  const out = { theta: [] as number[], r: [] as number[], role: [] as Role[] };
  const segs = segmentsOf(s);
  // right-handed: θ = −2π a / lead, so θ ascends as `a` descends; left-handed the other way round
  const walk = s.hand === 1 ? [...segs].reverse().map(({ from, to }) => ({ from: to, to: from, role: from.role })) : segs.map(({ from, to }) => ({ from, to, role: from.role }));
  for (let q = 0; q < s.starts; q++) {
    for (const { from, to, role } of walk) {
      const [t0, t1] = [(-s.hand * TAU * from.a) / s.lead + (q * TAU) / s.starts, (-s.hand * TAU * to.a) / s.lead + (q * TAU) / s.starts];
      const n = stepsOf(t1 - t0, Math.max(from.r, to.r), tol);
      for (let i = 0; i < n; i++) {
        out.theta.push(t0 + ((t1 - t0) * i) / n);
        out.r.push(from.r + ((to.r - from.r) * i) / n);
        out.role.push(role);
      }
    }
  }
  return out;
}

interface Placed {
  center?: P;
  pose?: RigidTransform;
}
interface LayeredOptions extends Placed {
  layerFactor?: number; // layers = the count by the chord tolerance times this
  diagonal?: 'short' | 'ac' | 'bd';
}
// The planned build: the cross-section extruded in layers, each turned by hand · 2π · z / lead.
// The count of layers follows from the chord of a helix at the largest radius.
function buildLayered(s: Shape, kind: Kind, z0: number, z1: number, tol: number, first: number, o: LayeredOptions = {}): Tool {
  const mesh = new Mesh(o.center ?? [0, 0], first, o.pose);
  const loop = polarLoop(s, tol);
  const n = loop.theta.length;
  const twist = (TAU * (z1 - z0)) / s.lead;
  const layers = Math.max(1, Math.ceil(stepsOf(twist, s.rMax, tol) * (o.layerFactor ?? 1)));
  const at: number[][] = [];
  for (let k = 0; k <= layers; k++) {
    const z = k === layers ? z1 : z0 + ((z1 - z0) * k) / layers;
    const turn = (s.hand * TAU * z) / s.lead;
    at.push(loop.theta.map((theta, i) => mesh.vertex(loop.r[i], theta + turn, z)));
  }
  const inside = kind.kind === 'groove'; // the thread surface is the inner wall of a groove tool
  const distance = (i: number, j: number) => Math.hypot(mesh.positions[3 * i] - mesh.positions[3 * j], mesh.positions[3 * i + 1] - mesh.positions[3 * j + 1], mesh.positions[3 * i + 2] - mesh.positions[3 * j + 2]);
  for (let k = 0; k < layers; k++) {
    for (let i = 0; i < n; i++) {
      const [a, b, c, d] = [at[k][i], at[k][(i + 1) % n], at[k + 1][(i + 1) % n], at[k + 1][i]];
      const ac = o.diagonal === 'ac' || (o.diagonal !== 'bd' && distance(a, c) <= distance(b, d));
      if (ac) {
        mesh.triangle(a, b, c, loop.role[i], inside);
        mesh.triangle(a, c, d, loop.role[i], inside);
      } else {
        mesh.triangle(a, b, d, loop.role[i], inside);
        mesh.triangle(b, c, d, loop.role[i], inside);
      }
    }
  }
  if (kind.kind === 'solid') {
    // the cross-section is a star about the axis: a fan from the centre
    const [low, high] = [mesh.vertex(0, 0, z0), mesh.vertex(0, 0, z1)];
    for (let i = 0; i < n; i++) {
      mesh.triangle(low, at[0][(i + 1) % n], at[0][i], 'start');
      mesh.triangle(high, at[layers][i], at[layers][(i + 1) % n], 'end');
    }
  } else {
    // the other wall is a plain cylinder of two rings; the caps between it and the turned loops are
    // triangulated by the kernel
    const radius = kind.kind === 'groove' ? kind.outer : kind.inner;
    const m = stepsOf(TAU, radius, tol);
    const ring = (z: number) => Array.from({ length: m }, (_, i) => mesh.vertex(radius, (TAU * i) / m, z));
    const [low, high] = [ring(z0), ring(z1)];
    for (let i = 0; i < m; i++) {
      const [a, b, c, d] = [low[i], low[(i + 1) % m], high[(i + 1) % m], high[i]];
      mesh.triangle(a, b, c, 'wall', !inside);
      mesh.triangle(a, c, d, 'wall', !inside);
    }
    const cap = (thread: number[], wall: number[], role: FaceRole, up: boolean) => {
      const [outer, inner] = inside ? [wall, thread] : [thread, wall];
      const ids = [...outer, ...[...inner].reverse()];
      const xy = (list: number[]) => Float64Array.from(list.flatMap((i) => [mesh.plane[2 * i], mesh.plane[2 * i + 1]]));
      const flat = kernel.triangulate([xy(outer), xy([...inner].reverse())]);
      for (let t = 0; t < flat.length; t += 3) mesh.triangle(ids[flat[t]], ids[flat[t + 1]], ids[flat[t + 2]], role, !up);
    };
    cap(at[0], low, 'start', false);
    cap(at[layers], high, 'end', true);
  }
  return { solid: mesh.solid(), first, build: 'layered', perTurn: stepsOf(TAU, s.rMax, tol), layers, loop: n };
}

// The other build: the axial profile swept along the helix. The surface is a graph over (θ, z);
// in that plane the edges of the profile are parallel straight lines (helices), and the mesh is
// made of axial sections at a list of angles: between two neighbouring sections every strip of the
// profile (between two neighbouring helices) is one quad, cut by the planes of the two ends.
// The angles are those where a helix meets an end plane, with each gap between them divided for
// the chord tolerance. A vertex within `snap` of an end plane is the vertex of that plane, so no
// triangle is thinner than that.
function buildSwept(s: Shape, kind: Kind, z0: number, z1: number, tol: number, first: number, o: Placed = {}): Tool {
  const mesh = new Mesh(o.center ?? [0, 0], first, o.pose);
  const m = s.points.length;
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
  const n = angles.length;

  // the helix g: the profile point g mod m, shifted by whole pitches
  const offsetOf = (g: number) => s.points[((g % m) + m) % m].a + Math.floor(g / m) * s.pitch;
  const index = new Map<string, number>();
  const keyed = (key: string, make: () => number): number => {
    let i = index.get(key);
    if (i === undefined) index.set(key, (i = make()));
    return i;
  };
  const low = (j: number) => keyed(`lo:${j}`, () => mesh.vertex(radiusAt(s, z0 - (s.hand * s.lead * angles[j]) / TAU), angles[j], z0));
  const high = (j: number) => keyed(`hi:${j}`, () => mesh.vertex(radiusAt(s, z1 - (s.hand * s.lead * angles[j]) / TAU), angles[j], z1));
  const at = (j: number, g: number): number => {
    if (j === n) return at(0, g + s.hand * m * s.starts); // a full turn on: the helix one lead further
    const z = offsetOf(g) + (s.hand * s.lead * angles[j]) / TAU;
    if (z <= z0 + snap) return low(j);
    if (z >= z1 - snap) return high(j);
    return keyed(`${g}:${j}`, () => mesh.vertex(s.points[((g % m) + m) % m].r, angles[j], z));
  };
  const inside = kind.kind === 'groove';
  const [gLow, gHigh] = [m * (Math.floor((z0 - s.lead) / s.pitch) - 2), m * (Math.ceil((z1 + s.lead) / s.pitch) + 2)];
  for (let j = 0; j < n; j++) {
    for (let g = gLow; g < gHigh; g++) {
      const [a, b, a2, b2] = [at(j, g), at(j, g + 1), at(j + 1, g), at(j + 1, g + 1)];
      if (a === b && a2 === b2) continue; // the strip is beyond an end at both sections
      const role = s.points[((g % m) + m) % m].role;
      mesh.triangle(a, a2, b2, role, inside);
      mesh.triangle(a, b2, b, role, inside);
    }
  }
  if (kind.kind === 'solid') {
    const [c0, c1] = [mesh.vertex(0, 0, z0), mesh.vertex(0, 0, z1)];
    for (let j = 0; j < n; j++) {
      mesh.triangle(c0, low((j + 1) % n), low(j), 'start');
      mesh.triangle(c1, high(j), high((j + 1) % n), 'end');
    }
  } else {
    // the other wall has its vertices at the same angles, so the caps are strips of quads
    const radius = kind.kind === 'groove' ? kind.outer : kind.inner;
    const [w0, w1] = [angles.map((theta) => mesh.vertex(radius, theta, z0)), angles.map((theta) => mesh.vertex(radius, theta, z1))];
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      mesh.triangle(w0[j], w0[k], w1[k], 'wall', !inside);
      mesh.triangle(w0[j], w1[k], w1[j], 'wall', !inside);
      // seen from above the thread surface is inside the wall of a groove and outside that of a ridge
      mesh.triangle(low(j), w0[j], w0[k], 'start', inside);
      mesh.triangle(low(j), w0[k], low(k), 'start', inside);
      mesh.triangle(high(j), w1[k], w1[j], 'end', inside);
      mesh.triangle(high(j), high(k), w1[k], 'end', inside);
    }
  }
  return { solid: mesh.solid(), first, build: 'swept', perTurn: stepsOf(TAU, s.rMax, tol), layers: 0, loop: 0 };
}

type Build = 'layered' | 'swept';
const BUILDERS: Record<Build, (s: Shape, kind: Kind, z0: number, z1: number, tol: number, first: number, o?: Placed) => Tool> = { layered: buildLayered, swept: buildSwept };

// How far the faces of the thread surface are from the exact surface: the largest distance, in the
// axial plane, of the centroid and of the middles of the edges of their triangles from the profile.
// (The vertices lie on the surface; the distance in the axial plane is an upper bound of the
// distance in space.)
function deviation(tool: Tool, s: Shape, center: P = [0, 0]): number {
  const { positions: p, triangles, faceIds } = tool.solid;
  const thread = new Set((['flankA', 'crest', 'flankB', 'root'] as const).map((role) => faceOf(tool, role)));
  let worst = 0;
  const probe = (x: number, y: number, z: number) => {
    const [dx, dy] = [x - center[0], y - center[1]];
    worst = Math.max(worst, profileDistance(s, z - (s.hand * s.lead * Math.atan2(dy, dx)) / TAU, Math.hypot(dx, dy)));
  };
  for (let t = 0; t < faceIds.length; t++) {
    if (!thread.has(faceIds[t])) continue;
    const v = [0, 1, 2].map((k) => [p[3 * triangles[3 * t + k]], p[3 * triangles[3 * t + k] + 1], p[3 * triangles[3 * t + k] + 2]]);
    probe((v[0][0] + v[1][0] + v[2][0]) / 3, (v[0][1] + v[1][1] + v[2][1]) / 3, (v[0][2] + v[1][2] + v[2][2]) / 3);
    for (let k = 0; k < 3; k++) probe((v[k][0] + v[(k + 1) % 3][0]) / 2, (v[k][1] + v[(k + 1) % 3][1]) / 2, (v[k][2] + v[(k + 1) % 3][2]) / 2);
  }
  return worst;
}
// The narrowest triangle with an area (its height over its longest side) and the count of those
// without one.
function narrowest(solid: Solid): { width: number; flat: number } {
  const p = solid.positions;
  let [width, flat] = [Infinity, 0];
  for (let t = 0; t < solid.triangles.length; t += 3) {
    const v = [0, 1, 2].map((k) => [p[3 * solid.triangles[t + k]], p[3 * solid.triangles[t + k] + 1], p[3 * solid.triangles[t + k] + 2]]);
    const e = [0, 1, 2].map((k) => [v[(k + 1) % 3][0] - v[k][0], v[(k + 1) % 3][1] - v[k][1], v[(k + 1) % 3][2] - v[k][2]]);
    const area = Math.hypot(e[0][1] * e[1][2] - e[0][2] * e[1][1], e[0][2] * e[1][0] - e[0][0] * e[1][2], e[0][0] * e[1][1] - e[0][1] * e[1][0]);
    const longest = Math.max(...e.map((x) => Math.hypot(x[0], x[1], x[2])));
    if (area === 0) flat++;
    else width = Math.min(width, area / longest);
  }
  return { width, flat };
}

// ---------------------------------------------------------------- bodies through the real adapter

let nextFace = 0;
const take = (count: number): number => {
  nextFace += count;
  return nextFace - count;
};
const FRAME = { x: [1, 0, 0] as [number, number, number], y: [0, 1, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
// A prism over a loop with holes; its faces are numbered from `first`: the caps, then `side`, then
// a face per hole.
function prism(loop: P[], z0: number, z1: number, holes: P[][] = [], pose?: RigidTransform): { solid: Solid; first: number; count: number } {
  const first = nextFace;
  const tag = `f${first}`;
  const toLoop = (points: P[], name: string) => ({ xy: points.flat(), keys: points.map((_, i) => `${tag}/${name}/${i}`), curves: points.map(() => name) });
  const region: Region = { ref: { outerLoop: ['side'] }, outer: toLoop(loop, 'side'), holes: holes.map((h, i) => toLoop([...h].reverse(), `hole${String(i).padStart(3, '0')}`)) };
  const frame = { ...FRAME, origin: [0, 0, z0] as [number, number, number] };
  const built = buildPrism(tag, [region], pose ? transformFrame(pose, frame) : frame, [0, z1 - z0], (curve) => ({ name: { role: 'side', curve }, shape: { type: 'round', center: [0, 0], radius: 1 } }), first, kernel);
  take(built.faces.length);
  return { solid: built.solid, first, count: built.faces.length };
}
const circle = (cx: number, cy: number, radius: number, tol: number): P[] => {
  const n = stepsOf(TAU, radius, tol);
  return Array.from({ length: n }, (_, i): P => [cx + radius * Math.cos((TAU * i) / n), cy + radius * Math.sin((TAU * i) / n)]);
};
const square = (half: number): P[] => [
  [-half, -half],
  [half, -half],
  [half, half],
  [-half, half],
];
const rect = (w: number, h: number): P[] => [
  [-w / 2, -h / 2],
  [w / 2, -h / 2],
  [w / 2, h / 2],
  [-w / 2, h / 2],
];
function joined(solids: Solid[]): Solid {
  const positions: number[] = [];
  const triangles: number[] = [];
  const faceIds: number[] = [];
  for (const s of solids) {
    const base = positions.length / 3;
    positions.push(...s.positions);
    for (const i of s.triangles) triangles.push(base + i);
    faceIds.push(...s.faceIds);
  }
  return { positions: Float32Array.from(positions), triangles: Uint32Array.from(triangles), faceIds: Uint32Array.from(faceIds) };
}
function timed<T>(run: () => T): { value?: T; ms: number; error?: string } {
  const start = performance.now();
  try {
    const value = run();
    return { value, ms: performance.now() - start };
  } catch (error) {
    return { ms: performance.now() - start, error: error instanceof Error ? error.message : String(error) };
  }
}
// A boolean through the adapter: the first time, the best of the repeats, and the time of the
// library alone (the adapter with nothing moved before and nothing cleaned or checked after).
function measured(op: 'union' | 'difference' | 'intersection', a: Solid, b: Solid, repeats = FULL ? 2 : 1): { value?: Solid; first: number; warm: number; library: number; error?: string } {
  const runs = Array.from({ length: repeats }, () => timed(() => kernel.boolean(op, a, b)));
  const library = timed(() => kernel.boolean(op, a, b, { prepare: false }));
  return { value: runs[0].value, first: runs[0].ms, warm: repeats > 1 ? Math.min(...runs.slice(1).map((r) => r.ms)) : NaN, library: library.ms, error: runs[0].error };
}
const fmt = (x: number, digits = 0) => (Number.isFinite(x) ? x.toFixed(digits) : '-');
const pct = (x: number) => (Number.isFinite(x) ? `${(100 * x).toFixed(3)} %` : '-');
function table(title: string, head: string[], rows: string[][]): void {
  const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) => `| ${cells.map((c, i) => c.padEnd(width[i])).join(' | ')} |`;
  console.log(['', `== ${title} ==`, line(head), line(width.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n'));
}
const faceCounts = (s: Solid): Map<number, number> => {
  const counts = new Map<number, number>();
  for (const id of s.faceIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
};
// Which faces of a tool are in a result, as a list of roles.
const survivors = (result: Solid, tool: Tool): string => {
  const counts = faceCounts(result);
  return FACES.filter((role) => counts.has(faceOf(tool, role))).join(' ');
};
const TOLERANCES = FULL ? [0.01, 0.05, 0.1] : [0.05];
// How far a tool ends beside the wall it cuts: more than the sagitta of the wall's polygon.
const besideOf = (tol: number) => Math.max(0.05, 2 * tol);
// How far a tool runs past an open end of the wall: 1 mm in the measurements of spike.md;
// THREAD_SPIKE_PAST=beside takes the distance a tool keeps from a shoulder instead (the design of
// D75 runs a tool past an end by no more than that), or a number of millimetres.
const pastOf = (tol: number): number => (process.env.THREAD_SPIKE_PAST === 'beside' ? besideOf(tol) : Number(process.env.THREAD_SPIKE_PAST ?? 1));

// ---------------------------------------------------------------- 1. the tools alone

interface Case {
  name: string;
  basic: Basic;
  length: number;
}
const M10: Case = { name: 'M10x1.5, 20 mm', basic: iso(10, 1.5), length: 20 };
const M20: Case = { name: 'M20x2.5, 30 mm', basic: iso(20, 2.5), length: 30 };
const M8: Case = { name: 'M8x1.25, 10 mm', basic: iso(8, 1.25), length: 10 };
const LID45: Case = { name: 'lid 40x4, 15 mm, 45°', basic: printed(40, 4, 1.2, 45), length: 15 };
const LID30: Case = { name: 'lid 40x4, 15 mm, 30°', basic: printed(40, 4, 1.2, 30), length: 15 };

test('1 tools: triangles, deviation from the exact surface, volume', () => {
  const rows: string[][] = [];
  for (const c of [M10, M20, M8, LID45, LID30]) {
    const shape = shapeOf(c.basic);
    const exact = Math.PI * c.length * meanSquare(shape);
    for (const tol of [0.01, 0.05, 0.1]) {
      for (const build of ['layered', 'swept'] as Build[]) {
        const made = timed(() => BUILDERS[build](shape, { kind: 'solid' }, 0, c.length, tol, 0));
        const tool = made.value as Tool;
        const dev = deviation(tool, shape);
        const thin = narrowest(tool.solid);
        const volume = volumeOf(tool.solid);
        rows.push([c.name, String(tol), build, String(tool.perTurn), tool.layers ? String(tool.layers) : '-', String(tris(tool.solid)), fmt(made.ms), fmt(dev, 4), fmt(thin.width, 4), String(thin.flat), pct(volume / exact - 1)]);
        // the mesh is inscribed: within the chord tolerance of the surface, and a little less volume
        expect(dev, `${c.name} ${build} ${tol}`).toBeLessThan(1.05 * tol);
        expect(Math.abs(volume / exact - 1)).toBeLessThan((4 * tol) / shape.rMin);
      }
    }
  }
  table('1. Screw-shaped tool alone (float64 build, float32 mesh)', ['case', 'chord tol', 'build', 'lines/turn', 'layers', 'triangles', 'build ms', 'deviation', 'narrowest', 'flat', 'volume vs exact'], rows);

  // the layered build: fewer layers than the chord of the helix asks for, and the diagonal of a quad
  const shape = shapeOf(M10.basic);
  const sweep: string[][] = [];
  for (const layerFactor of [1, 0.5, 0.25, 0.125]) {
    for (const diagonal of ['short', 'ac', 'bd'] as const) {
      const tool = buildLayered(shape, { kind: 'solid' }, 0, M10.length, 0.01, 0, { layerFactor, diagonal });
      sweep.push([String(layerFactor), diagonal, String(tool.layers), String(tris(tool.solid)), fmt(deviation(tool, shape), 4), fmt(narrowest(tool.solid).width, 4)]);
    }
  }
  table('1b. Layered M10x1.5 at 0.01: layers against the deviation', ['layers x', 'diagonal', 'layers', 'triangles', 'deviation', 'narrowest'], sweep);
});

// ---------------------------------------------------------------- 2. the booleans

// Where the tool ends against the body: `z0` to `z1` is the tool, `from` to `to` the part of the
// body that gets the thread.
interface Ends {
  name: string;
  flush: boolean; // an end of the tool lies in a face of the body
  z0: number;
  z1: number;
  from: number;
  to: number;
}
interface Job {
  name: string;
  op: 'union' | 'difference';
  // built once per tolerance; `wall` is the number of the cylindrical face that gets the thread
  body: () => { solid: Solid; wall: number };
  ends: Ends[];
  tool: (build: Build, first: number, ends: Ends) => Tool;
  // the flanks of the tool meet before it is `beside` clear of the wall it must not lie on
  tight: boolean;
  change: number; // of the volume per millimetre of thread, by the exact surface
  radius: number; // for the bound of the volume
}
// The bodies and tools of one case. A cut may run past an open end of the wall into the air and
// a union past a shoulder into the material; at the other kind of end the tool lies in the face or
// stops short of it.
function jobs(c: Case, tol: number, clearance = 0, pose?: RigidTransform): Job[] {
  const b = c.basic;
  const l = c.length;
  const beside = besideOf(tol);
  const past = pastOf(tol);
  const side = 2 * b.major + 10;
  const basic = shapeOf(b);
  const out: Job[] = [];
  // Internal: a block with a hole at the minor diameter, cut by the screw shape whose root lies
  // inside the hole.
  const hole = b.minor + clearance;
  const nut = shapeOf(b, { offset: clearance, rootTo: hole - beside });
  out.push({
    name: 'internal, cut',
    op: 'difference',
    body: () => {
      const block = prism(square(side / 2), 0, l, [circle(0, 0, hole, tol)], pose);
      return { solid: block.solid, wall: block.first + 2 }; // the caps, then the hole, then the outer side
    },
    ends: [
      { name: 'in both faces', flush: true, z0: 0, z1: l, from: 0, to: l },
      { name: `${past} mm past both faces`, flush: false, z0: -past, z1: l + past, from: 0, to: l },
    ],
    tool: (build, first, e) => BUILDERS[build](nut, { kind: 'solid' }, e.z0, e.z1, tol, first, { pose }),
    tight: nut.rMin > hole - beside + 1e-9,
    change: -Math.PI * meanOver(b.pitch, (a) => Math.max(radiusAt(nut, a), hole) ** 2 - hole ** 2),
    radius: b.minor,
  });
  // Internal and blind (added for the review of D75): the hole stands on a bottom 3 mm thick; the
  // tool stops `beside` short of the bottom and runs past the open face.
  out.push({
    name: 'internal blind, cut',
    op: 'difference',
    body: () => {
      const block = prism(square(side / 2), 0, l, [circle(0, 0, hole, tol)], pose);
      return { solid: kernel.boolean('union', prism(square(side / 2), -3, 0, [], pose).solid, block.solid), wall: block.first + 2 };
    },
    ends: [
      { name: 'in the bottom, in the open face', flush: true, z0: 0, z1: l, from: 0, to: l },
      { name: `${beside} short of the bottom, ${past} mm past the open face`, flush: false, z0: beside, z1: l + past, from: beside, to: l },
    ],
    tool: (build, first, e) => BUILDERS[build](nut, { kind: 'solid' }, e.z0, e.z1, tol, first, { pose }),
    tight: nut.rMin > hole - beside + 1e-9,
    change: -Math.PI * meanOver(b.pitch, (a) => Math.max(radiusAt(nut, a), hole) ** 2 - hole ** 2),
    radius: b.minor,
  });
  // External by a cut: a rod at the major diameter on a plate, cut by a groove tool whose crest
  // lies outside the rod.
  const groove = shapeOf(b, { crestTo: b.major + beside });
  const plate = () => prism(square(side / 2), -5, 0, [], pose).solid;
  out.push({
    name: 'external, cut of a rod',
    op: 'difference',
    body: () => {
      const rod = prism(circle(0, 0, b.major, tol), 0, l, [], pose);
      return { solid: kernel.boolean('union', plate(), rod.solid), wall: rod.first + 2 };
    },
    ends: [
      { name: 'in the shoulder, in the free end', flush: true, z0: 0, z1: l, from: 0, to: l },
      { name: 'in the shoulder, 1 mm past the free end', flush: true, z0: 0, z1: l + 1, from: 0, to: l },
      { name: `${beside} short of the shoulder, in the free end`, flush: true, z0: beside, z1: l, from: beside, to: l },
      { name: `${beside} short of the shoulder, ${past} mm past the free end`, flush: false, z0: beside, z1: l + past, from: beside, to: l },
    ],
    tool: (build, first, e) => BUILDERS[build](groove, { kind: 'groove', outer: b.major + 2 * beside }, e.z0, e.z1, tol, first, { pose }),
    tight: groove.rMax < b.major + beside - 1e-9,
    change: -Math.PI * meanOver(b.pitch, (a) => b.major ** 2 - Math.min(radiusAt(groove, a), b.major) ** 2),
    radius: b.major,
  });
  // External by a union: a core at the minor diameter on a plate, joined with a ridge tool whose
  // root lies inside the core.
  const ridge = shapeOf(b, { rootTo: b.minor - beside });
  out.push({
    name: 'external, union on a core',
    op: 'union',
    body: () => {
      const core = prism(circle(0, 0, b.minor, tol), 0, l, [], pose);
      return { solid: kernel.boolean('union', plate(), core.solid), wall: core.first + 2 };
    },
    ends: [
      { name: 'in the shoulder, in the free end', flush: true, z0: 0, z1: l, from: 0, to: l },
      { name: '1 mm into the shoulder, in the free end', flush: true, z0: -1, z1: l, from: 0, to: l },
      { name: `1 mm into the shoulder, ${beside} short of the free end`, flush: false, z0: -1, z1: l - beside, from: 0, to: l - beside },
    ],
    tool: (build, first, e) => BUILDERS[build](ridge, { kind: 'ridge', inner: b.minor - 2 * beside }, e.z0, e.z1, tol, first, { pose }),
    tight: ridge.rMin > b.minor - beside + 1e-9,
    change: Math.PI * meanOver(b.pitch, (a) => Math.max(radiusAt(basic, a), b.minor) ** 2 - b.minor ** 2),
    radius: b.minor,
  });
  return out;
}

test('2 booleans: one thread on a pin and in a hole', () => {
  const rows: string[][] = [];
  const refused: { flush: boolean; text: string }[] = [];
  // the first boolean of the process, with everything of the library still cold
  const coldBody = prism(square(10), 0, 20, [circle(0, 0, 4, 0.05)]).solid;
  const cold = timed(() => kernel.boolean('difference', coldBody, prism(circle(0, 0, 5, 0.05), 5, 25).solid));
  console.log(`\nthe first boolean of the process (a cylinder out of a block with a hole): ${fmt(cold.ms)} ms`);
  const both: Build[] = ['layered', 'swept'];
  const matrix: { c: Case; tols: number[]; builds: Build[]; clearance: number }[] = FULL
    ? [
        { c: M10, tols: [0.01, 0.05, 0.1], builds: both, clearance: 0 },
        { c: M20, tols: [0.01, 0.05], builds: both, clearance: 0 },
        { c: LID45, tols: [0.01, 0.05, 0.1], builds: both, clearance: 0.3 },
        { c: LID30, tols: [0.05], builds: both, clearance: 0.3 },
      ]
    : [
        { c: M10, tols: [0.05], builds: both, clearance: 0 },
        { c: M20, tols: [0.05], builds: ['swept'], clearance: 0 },
        { c: LID45, tols: [0.05], builds: ['swept'], clearance: 0.3 },
        { c: LID30, tols: [0.05], builds: ['swept'], clearance: 0.3 },
      ];
  for (const { c, tols, builds, clearance } of matrix) {
    for (const tol of tols) {
      for (const job of jobs(c, tol, clearance)) {
        const { solid: body, wall } = job.body();
        const bodyVolume = volumeOf(body);
        for (const ends of job.ends) {
          for (const build of builds) {
            // the slowest rows (seconds each, see spike.md) are measured for M10 only
            if (build === 'layered' && tol === 0.01 && ends.flush && c !== M10) continue;
            const made = timed(() => job.tool(build, take(FACES.length), ends));
            const tool = made.value as Tool;
            const result = measured(job.op, body, tool.solid);
            const expected = bodyVolume + job.change * (ends.to - ends.from);
            const volume = result.value ? volumeOf(result.value) : NaN;
            rows.push([
              `${c.name}${clearance ? `, clearance ${clearance}` : ''}`,
              job.name,
              ends.name,
              String(tol),
              build,
              String(tris(tool.solid)),
              fmt(made.ms),
              fmt(result.first),
              fmt(result.warm),
              fmt(result.library),
              result.value ? String(tris(result.value)) : '-',
              pct(volume / expected - 1),
              result.value ? survivors(result.value, tool) : '',
              result.value ? (faceCounts(result.value).has(wall) ? 'yes' : 'no') : '',
              result.error ?? '',
            ]);
            if (result.error) {
              refused.push({ flush: ends.flush, text: `${c.name} / ${job.name} / ${ends.name} / ${build} / ${tol}: ${result.error}` });
              continue;
            }
            // The thread surface is inscribed, the walls of the body too: the change of the volume is
            // right within what the chords take.
            expect(Math.abs(volume - expected), `${c.name} ${job.name} ${ends.name} ${build} ${tol}: volume`).toBeLessThan(((6 * tol) / job.radius) * Math.PI * job.radius ** 2 * c.length);
          }
        }
      }
    }
  }
  table('2. One thread: the tool and the boolean through the adapter', ['case', 'operation', 'ends of the tool', 'chord tol', 'build', 'tool tris', 'build ms', 'boolean ms', 'warm ms', 'library ms', 'result tris', 'volume vs exact', 'tool faces left', 'wall left', 'error'], rows);
  console.log(['', `refused by the adapter: ${refused.length} of ${rows.length}`, ...refused.map((r) => r.text)].join('\n'));
  // a tool with no end in a face of the body is never refused
  expect(refused.filter((r) => !r.flush).map((r) => r.text)).toEqual([]);
});

// ---------------------------------------------------------------- 3. a screw in a nut

test('3 a modelled screw in a modelled nut: the clearance decides', () => {
  const rows: string[][] = [];
  const c = M10;
  const b = c.basic;
  const cases: { tol: number; clearance: number; builds: [Build, Build] }[] = [];
  for (const tol of TOLERANCES) {
    for (const clearance of FULL ? [0.2, 0.1, 0.05, 0.02, 0.01, 0, -0.05] : [0.1, 0.05, 0.02, 0, -0.05]) cases.push({ tol, clearance, builds: ['swept', 'swept'] });
    cases.push({ tol, clearance: 0.1, builds: ['layered', 'swept'] });
    if (FULL) cases.push({ tol, clearance: 0.1, builds: ['layered', 'layered'] });
    // at 0.01 this intersection of two coincident surfaces took the adapter 26 s
    if (FULL && tol > 0.01) cases.push({ tol, clearance: 0, builds: ['layered', 'swept'] });
  }
  for (const { tol, clearance, builds } of cases) {
    const beside = besideOf(tol);
    // the screw: a rod cut by the groove tool (the basic profile, no allowance); the tool runs past
    // both ends of the rod
    const groove = shapeOf(b, { crestTo: b.major + beside });
    const rod = prism(circle(0, 0, b.major, tol), -2, c.length + 2).solid;
    const screw = kernel.boolean('difference', rod, BUILDERS[builds[0]](groove, { kind: 'groove', outer: b.major + 2 * beside }, -3, c.length + 3, tol, take(FACES.length)).solid);
    // the nut: a block with a hole, cut by the screw shape grown by the clearance
    const hole = b.minor + clearance;
    const shape = shapeOf(b, { offset: clearance, rootTo: hole - beside });
    const block = prism(square(10), 0, c.length, [circle(0, 0, hole, tol)]).solid;
    const nut = kernel.boolean('difference', block, BUILDERS[builds[1]](shape, { kind: 'solid' }, -1, c.length + 1, tol, take(FACES.length)).solid);
    const common = timed(() => kernel.boolean('intersection', screw, nut));
    const raw = timed(() => kernel.intersectionAsComputed(screw, nut).unverified);
    // what the exact shapes share: the screw is within min(f, major), the nut beyond max(g, hole)
    const exact = Math.PI * c.length * meanOver(b.pitch, (a) => Math.max(0, Math.min(radiusAt(groove, a), b.major) ** 2 - Math.max(radiusAt(shape, a), hole) ** 2));
    const volume = common.value ? volumeOf(common.value) : NaN;
    const computed = raw.value ? volumeOf(raw.value) : NaN;
    rows.push([String(tol), String(clearance), builds.join(' / '), fmt(exact, 3), fmt(volume, 4), fmt(common.ms), fmt(computed, 4), fmt(raw.ms), common.error ?? raw.error ?? '']);
    if (clearance > tol) expect(Math.max(volume || 0, computed || 0), `clearance ${clearance} at ${tol}`).toBeLessThan(0.001);
    if (clearance < 0) expect(computed, `clearance ${clearance} at ${tol}`).toBeGreaterThan(0.5 * exact);
  }
  table('3. M10x1.5 screw (basic profile) in a nut cut with a clearance: what they share (mm³)', ['chord tol', 'clearance', 'builds screw / nut', 'exact shapes', 'boolean', 'ms', 'as computed', 'ms', 'error'], rows);
});

// ---------------------------------------------------------------- 3b. the engine's check of collisions

// A body as the check of collisions takes it, made here from the mesh alone: a face is planar
// when all its triangles have one normal.
function bodyOf(solid: Solid): BodyResult {
  const normals = new Map<number, [number, number, number]>();
  const flat = new Map<number, boolean>();
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const p = solid.positions;
  for (let v = 0; v < p.length; v += 3) for (let k = 0; k < 3; k++) [min[k], max[k]] = [Math.min(min[k], p[v + k]), Math.max(max[k], p[v + k])];
  for (let t = 0; t < solid.triangles.length; t += 3) {
    const [a, b, c] = [solid.triangles[t] * 3, solid.triangles[t + 1] * 3, solid.triangles[t + 2] * 3];
    const [u, w] = [[p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]];
    const n: [number, number, number] = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const length = Math.hypot(...n);
    if (!(length > 0)) continue;
    const unit: [number, number, number] = [n[0] / length, n[1] / length, n[2] / length];
    const face = solid.faceIds[t / 3];
    const first = normals.get(face);
    if (!first) normals.set(face, unit);
    flat.set(face, (flat.get(face) ?? true) && (!first || first[0] * unit[0] + first[1] * unit[1] + first[2] * unit[2] > 1 - 1e-6));
  }
  return { solid, faces: [...flat].map(([id, planar]) => ({ id, planar })), edges: [], volume: volumeOf(solid), bounds: { min, max } };
}

// What the spike left open: the engine's own check of collisions (`sharedBy` and `verdictOf` of
// interference.ts, D50) on a screw and a nut, and on the pairs that overlap by design: a plain rod
// at the major diameter (a bought screw, or a pin with a cosmetic thread) in a modelled nut and in
// a plain hole at the minor diameter (a cosmetic thread). For the last two: do all vertices of what
// the two share lie between the wall of the hole and the major cylinder of the thread, within the
// chord tolerance? That is the test the design of D75 excuses such a pair by.
test('3b the check of collisions on a screw in a nut, and on the pairs that overlap by design', () => {
  const rows: string[][] = [];
  const c = M10;
  const b = c.basic;
  // one tolerance also in the full run: below the tolerance the measure of the depth takes
  // seconds at 0.05 and grows with the square of the triangles
  for (const tol of [0.05]) {
    const beside = besideOf(tol);
    const groove = shapeOf(b, { crestTo: b.major + beside });
    const rodOf = () => prism(circle(0, 0, b.major, tol), -2, c.length + 2).solid;
    const screw = kernel.boolean('difference', rodOf(), buildSwept(groove, { kind: 'groove', outer: b.major + 2 * beside }, -3, c.length + 3, tol, take(FACES.length)).solid);
    const nutOf = (clearance: number, modelled: boolean): Solid => {
      const hole = b.minor + clearance;
      const block = prism(square(10), 0, c.length, [circle(0, 0, hole, tol)]).solid;
      if (!modelled) return block;
      return kernel.boolean('difference', block, buildSwept(shapeOf(b, { offset: clearance, rootTo: hole - beside }), { kind: 'solid' }, -beside, c.length + beside, tol, take(FACES.length)).solid);
    };
    const pairs: { name: string; a: Solid; b: Solid; clearance: number }[] = [
      ...[0.1, 0.05, 0.02, 0].map((clearance) => ({ name: 'modelled screw in a modelled nut', a: screw, b: nutOf(clearance, true), clearance })),
      { name: 'plain rod at the major diameter in a modelled nut', a: rodOf(), b: nutOf(0.1, true), clearance: 0.1 },
      { name: 'plain rod at the major diameter in a plain hole at the minor diameter', a: rodOf(), b: nutOf(0, false), clearance: 0 },
      { name: 'modelled screw in a plain hole at the minor diameter', a: screw, b: nutOf(0, false), clearance: 0 },
    ];
    for (const pair of pairs) {
      const [bodyA, bodyB] = [bodyOf(pair.a), bodyOf(pair.b)];
      const shared = timed(() => sharedBy(kernel, bodyA, bodyB, tol));
      const measured = shared.value;
      if (!measured || 'message' in measured) {
        rows.push([String(tol), pair.name, String(pair.clearance), '-', '-', '-', fmt(shared.ms), measured && 'message' in measured ? measured.message : (shared.error ?? '')]);
        continue;
      }
      // the zone of the thread: between the wall of the hole and the major cylinder grown by the clearance
      let outside = 0;
      let worst = 0;
      if (measured.volume > 0) {
        const common = kernel.boolean('intersection', pair.a, pair.b);
        const [low, high] = [b.minor + pair.clearance, b.major + pair.clearance];
        for (let v = 0; v < common.positions.length; v += 3) {
          const r = Math.hypot(common.positions[v], common.positions[v + 1]);
          const off = Math.max(low - r, r - high, -common.positions[v + 2], common.positions[v + 2] - c.length, 0);
          worst = Math.max(worst, off);
          if (off > tol + 1e-4) outside++;
        }
      }
      rows.push([String(tol), pair.name, String(pair.clearance), fmt(measured.volume, 3), fmt(measured.depth, 4), verdictOf(measured, 0.001, tol), fmt(shared.ms), `vertices outside the zone by more than the tolerance: ${outside}; the farthest ${fmt(worst, 4)}`]);
    }
  }
  table('3b. The check of collisions (sharedBy, verdictOf) on M10x1.5, 20 mm', ['chord tol', 'pair', 'clearance', 'volume mm³', 'depth mm', 'verdict', 'ms', 'the zone of the thread'], rows);
  for (const row of rows) {
    // a clearance above the chord tolerance: nothing; a pair that overlaps by design: a collision whose volume lies in the zone
    if (row[1].startsWith('modelled screw in a modelled nut') && Number(row[2]) > Number(row[0])) expect(row[5], row.join(' | ')).toBe('nothing');
    if (row[1].includes('plain')) expect(row[7], row.join(' | ')).toContain('more than the tolerance: 0;');
  }
});

// ---------------------------------------------------------------- 4. a pattern of threads

test('4 a pattern: 8 internal M8x1.25 threads through a 10 mm plate', () => {
  const rows: string[][] = [];
  const b = M8.basic;
  const centers = Array.from({ length: 8 }, (_, i): P => [-37.5 + 25 * (i % 4), i < 4 ? -12.5 : 12.5]);
  const runs: { tol: number; build: Build }[] = FULL
    ? [
        { tol: 0.01, build: 'swept' },
        { tol: 0.01, build: 'layered' },
        { tol: 0.05, build: 'swept' },
        { tol: 0.05, build: 'layered' },
      ]
    : [{ tol: 0.05, build: 'swept' }];
  for (const { tol, build } of runs) {
    const beside = besideOf(tol);
    const hole = b.minor;
    const shape = shapeOf(b, { rootTo: hole - beside });
    const plate = prism(
      rect(110, 60),
      0,
      10,
      centers.map(([x, y]) => circle(x, y, hole, tol)),
    ).solid;
    const expected = volumeOf(plate) - 8 * Math.PI * 10 * meanOver(b.pitch, (a) => Math.max(radiusAt(shape, a), hole) ** 2 - hole ** 2);
    for (const reach of [0, 1]) {
      // `reach`: the tool ends in the faces of the plate, or runs 1 mm past them
      // (layered at 0.01 in the faces: 52 s in one boolean and 19 s in turn, measured once)
      if (build === 'layered' && tol === 0.01 && reach === 0) continue;
      const made = timed(() => centers.map((center) => BUILDERS[build](shape, { kind: 'solid' }, -reach, 10 + reach, tol, take(FACES.length), { center })));
      const tools = made.value as Tool[];
      const one = measured('difference', plate, joined(tools.map((t) => t.solid)), FULL && reach ? 2 : 1);
      const each = timed(() => tools.reduce((body, t) => kernel.boolean('difference', body, t.solid), plate));
      for (const [how, result, ms, warm, library, error] of [
        ['one boolean, a tool of 8 pieces', one.value, one.first, one.warm, one.library, one.error],
        ['8 booleans in turn', each.value, each.ms, NaN, NaN, each.error],
      ] as [string, Solid | undefined, number, number, number, string | undefined][]) {
        const volume = result ? volumeOf(result) : NaN;
        rows.push([String(tol), build, reach ? '1 mm past the faces' : 'in the faces', how, String(tools.reduce((sum, t) => sum + tris(t.solid), 0)), fmt(made.ms), fmt(ms), fmt(warm), fmt(library), result ? String(tris(result)) : '-', pct(volume / expected - 1), result ? survivors(result, tools[0]) : '', error ?? '']);
        if (reach) {
          expect(error, `${how} ${build} ${tol}`).toBeUndefined();
          expect(Math.abs(volume / expected - 1)).toBeLessThan(0.002);
        }
      }
    }
  }
  table('4. Eight M8x1.25 threads through a plate 110 x 60 x 10', ['chord tol', 'build', 'ends of the tool', 'how', 'tool tris', 'build ms', 'boolean ms', 'warm ms', 'library ms', 'result tris', 'volume vs exact', 'tool faces left', 'error'], rows);
});

// ---------------------------------------------------------------- 5. variants and face numbers

test('5 two starts, left-handed, a blind end: closed, the volume, the faces', () => {
  const rows: string[][] = [];
  const tol = 0.05;
  const beside = besideOf(tol);
  const variants: { name: string; basic: Basic }[] = [
    { name: 'M10x1.5', basic: iso(10, 1.5) },
    { name: 'M10x1.5 left-handed', basic: iso(10, 1.5, { hand: -1 }) },
    { name: 'M10x1.5, 2 starts (lead 3)', basic: iso(10, 1.5, { starts: 2 }) },
    { name: 'M10x1.5, 2 starts, left-handed', basic: iso(10, 1.5, { starts: 2, hand: -1 }) },
    { name: 'lid 40x4, 45°, 3 starts', basic: printed(40, 4, 1.2, 45, { starts: 3 }) },
    { name: 'sharp V: no flats (pitch 2, 45°, depth 1)', basic: printed(12, 2, 1, 45) },
  ];
  for (const { name, basic } of variants) {
    const length = 12;
    const shape = shapeOf(basic);
    const exact = Math.PI * length * meanSquare(shape);
    const tools = (['layered', 'swept'] as Build[]).map((build) => BUILDERS[build](shape, { kind: 'solid' }, 1, 1 + length, tol, take(FACES.length)));
    // the two builds make the same solid: what they share is all of either
    const common = timed(() => volumeOf(kernel.intersectionAsComputed(tools[0].solid, tools[1].solid).unverified));
    // a right-handed and a left-handed thread are mirror images: a point of the mesh mirrored in
    // the plane y = 0 lies on the surface of the other hand
    const mirrored = shapeOf({ ...basic, hand: basic.hand === 1 ? -1 : 1 });
    const flipped: Tool = { ...tools[1], solid: { ...tools[1].solid, positions: tools[1].solid.positions.map((x, i) => (i % 3 === 1 ? -x : x)) } };
    // a blind hole: the thread ends inside the material, 2 mm above the bottom of the hole, and the
    // tool runs 1 mm past the open face
    const hole = basic.minor;
    const nutShape = shapeOf(basic, { rootTo: hole - beside });
    const bottom = prism(square(basic.major + 5), -3, 0).solid;
    const drilled = prism(square(basic.major + 5), 0, 14, [circle(0, 0, hole, tol)]);
    const block = kernel.boolean('union', bottom, drilled.solid);
    for (const build of ['layered', 'swept'] as Build[]) {
      const tool = BUILDERS[build](nutShape, { kind: 'solid' }, 2, 15, tol, take(FACES.length));
      const cut = timed(() => kernel.boolean('difference', block, tool.solid));
      const expected = volumeOf(block) - Math.PI * 12 * meanOver(basic.pitch, (a) => Math.max(radiusAt(nutShape, a), hole) ** 2 - hole ** 2);
      const made = build === 'layered' ? tools[0] : tools[1];
      rows.push([
        name,
        build,
        String(tris(made.solid)),
        pct(volumeOf(made.solid) / exact - 1),
        fmt(deviation(made, shape), 4),
        build === 'swept' ? pct((common.value ?? NaN) / volumeOf(made.solid) - 1) : '',
        build === 'swept' ? fmt(deviation(flipped, mirrored), 4) : '',
        fmt(cut.ms),
        cut.value ? pct(volumeOf(cut.value) / expected - 1) : '-',
        cut.value ? survivors(cut.value, tool) : '',
        cut.value ? String(faceCounts(cut.value).get(drilled.first + 2) ?? 0) : '',
        cut.error ?? common.error ?? '',
      ]);
      expect(cut.error, `${name} ${build}`).toBeUndefined();
      expect(Math.abs(volumeOf(made.solid) / exact - 1)).toBeLessThan(0.03);
      // The blind end: the flanks, the root of the nut's thread (the crest of the tool) and the
      // flat end at the bottom survive; the root of the tool lies in the hole and its upper end
      // beyond the open face, so both are gone.
      const left = survivors(cut.value as Solid, tool).split(' ');
      expect(left).toEqual(expect.arrayContaining(['start', 'flankA', 'flankB']));
      expect(left).not.toContain('end');
      if (nutShape.points.some((p) => p.role === 'root')) expect(left).not.toContain('root');
    }
    expect(Math.abs((common.value ?? NaN) / volumeOf(tools[1].solid) - 1), `${name}: the two builds`).toBeLessThan(0.02);
    expect(deviation(flipped, mirrored)).toBeLessThan(1.05 * tol);
  }
  table('5. Variants at a chord tolerance of 0.05, 12 mm long: the tool, and a blind hole cut by it', ['variant', 'build', 'tool tris', 'volume vs exact', 'deviation', 'shared with layered', 'mirrored on the other hand', 'cut ms', 'cut volume vs exact', 'tool faces left', 'triangles of the wall left', 'error'], rows);
});

// ---------------------------------------------------------------- 6. random threads in random poses

// ---------------------------------------------------------------- 7. measured for the review of D75

// A frustum about Z between two radii (a countersink, as a tool): a closed mesh with one face number.
function frustum(r0: number, z0: number, r1: number, z1: number, tol: number): Solid {
  const n = stepsOf(TAU, Math.max(r0, r1), tol);
  const face = take(1);
  const positions: number[] = [0, 0, z0, 0, 0, z1];
  for (let i = 0; i < n; i++) {
    const [c, sn] = [Math.cos((TAU * i) / n), Math.sin((TAU * i) / n)];
    positions.push(r0 * c, r0 * sn, z0, r1 * c, r1 * sn, z1);
  }
  const triangles: number[] = [];
  for (let i = 0; i < n; i++) {
    const [a0, a1, b0, b1] = [2 + 2 * i, 3 + 2 * i, 2 + 2 * ((i + 1) % n), 3 + 2 * ((i + 1) % n)];
    triangles.push(0, b0, a0, 1, a1, b1, a0, b0, b1, a0, b1, a1);
  }
  return { positions: Float32Array.from(positions), triangles: Uint32Array.from(triangles), faceIds: new Uint32Array(triangles.length / 3).fill(face) };
}

// The zone of a thread about Z: between two radii and two heights.
interface Zone {
  low: number;
  high: number;
  from: number;
  to: number;
}
// The distance of the origin from a triangle in the plane: 0 inside it.
function originToTriangle(a: P, b: P, c: P): number {
  const cross = (p: P, q: P) => p[0] * q[1] - p[1] * q[0];
  const signs = [cross(a, b), cross(b, c), cross(c, a)];
  if (signs.every((x) => x >= 0) || signs.every((x) => x <= 0)) return 0;
  const toSegment = (p: P, q: P): number => {
    const d: P = [q[0] - p[0], q[1] - p[1]];
    const t = Math.max(0, Math.min(1, -(p[0] * d[0] + p[1] * d[1]) / (d[0] * d[0] + d[1] * d[1] || 1)));
    return Math.hypot(p[0] + t * d[0], p[1] + t * d[1]);
  };
  return Math.min(toSegment(a, b), toSegment(b, c), toSegment(c, a));
}
// What the design of D75 judges of what two bodies share, piece by connected piece:
// - `byVertices`: every vertex within the radii and the heights (the rule of the first version);
// - `inner`: no triangle comes nearer to the axis than the lower radius (a vertex cannot tell: a
//   shared volume has vertices only on its rim);
// - `around`: the vertices leave no gap of half a turn or more about the axis (a body pushed into
//   the thread from one side is no mate).
function zoneOf(common: Solid, zone: Zone, slack: number): { pieces: number; byVertices: boolean; inner: boolean; around: boolean; nearest: number; widestGap: number } {
  const p = common.positions;
  const out = { pieces: 0, byVertices: true, inner: true, around: true, nearest: Infinity, widestGap: 0 };
  for (const piece of pieceSolids(common)) {
    out.pieces++;
    const angles: number[] = [];
    const seen = new Set<number>();
    for (let t = 0; t < piece.triangles.length; t += 3) {
      const corners = [piece.triangles[t], piece.triangles[t + 1], piece.triangles[t + 2]];
      for (const v of corners) {
        if (seen.has(v)) continue;
        seen.add(v);
        const r = Math.hypot(p[3 * v], p[3 * v + 1]);
        if (r < zone.low - slack || r > zone.high + slack || p[3 * v + 2] < zone.from - slack || p[3 * v + 2] > zone.to + slack) out.byVertices = false;
        angles.push(Math.atan2(p[3 * v + 1], p[3 * v]));
      }
      const [a, b, c] = corners.map((v): P => [p[3 * v], p[3 * v + 1]]);
      const near = originToTriangle(a, b, c);
      out.nearest = Math.min(out.nearest, near);
      if (near < zone.low - slack) out.inner = false;
    }
    angles.sort((x, y) => x - y);
    let gap = angles.length ? angles[0] + TAU - angles[angles.length - 1] : TAU;
    for (let i = 1; i < angles.length; i++) gap = Math.max(gap, angles[i] - angles[i - 1]);
    out.widestGap = Math.max(out.widestGap, gap);
    if (gap >= Math.PI) out.around = false;
  }
  return out;
}

// The profile of a thread moved radially by a clearance (the model the review of D75 led to): the
// basic profile of a diameter smaller (external, `shift` below zero) or larger (internal) by twice
// the clearance. The flanks move along their normal by clearance · sin(half-angle).
const shifted = (b: Basic, shift: number): Basic => ({ ...b, major: b.major + shift, minor: b.minor + shift });

test('7 for the review of D75: the hands, a radial clearance, a ring tool for a bore, what stands in the way, the zone', () => {
  const tol = 0.05;
  const beside = besideOf(tol);
  const b = M10.basic;
  const l = 20;

  // ---- a. the hands and the kinds: every tool faces outwards (a signed volume above zero, that of the exact shape)
  const hands: string[][] = [];
  for (const hand of [1, -1] as const) {
    for (const starts of [1, 2]) {
      const basic = iso(10, 1.5, { hand, starts });
      const kinds: { name: string; shape: Shape; kind: Kind; exact: number }[] = [
        { name: 'solid', shape: shapeOf(basic), kind: { kind: 'solid' }, exact: Math.PI * l * meanSquare(shapeOf(basic)) },
        { name: 'groove', shape: shapeOf(basic, { crestTo: basic.major + beside }), kind: { kind: 'groove', outer: basic.major + 2 * beside }, exact: Math.PI * l * ((basic.major + 2 * beside) ** 2 - meanSquare(shapeOf(basic, { crestTo: basic.major + beside }))) },
        { name: 'ridge', shape: shapeOf(basic, { rootTo: basic.minor - beside }), kind: { kind: 'ridge', inner: basic.minor - 2 * beside }, exact: Math.PI * l * (meanSquare(shapeOf(basic, { rootTo: basic.minor - beside })) - (basic.minor - 2 * beside) ** 2) },
      ];
      for (const k of kinds) {
        const tool = buildSwept(k.shape, k.kind, 0, l, tol, take(FACES.length));
        const volume = volumeOf(tool.solid);
        hands.push([hand === 1 ? 'right' : 'left', String(starts), k.name, fmt(volume, 2), fmt(k.exact, 2), pct(volume / k.exact - 1)]);
        expect(volume, `${k.name} hand ${hand}`).toBeGreaterThan(0);
        expect(Math.abs(volume / k.exact - 1), `${k.name} hand ${hand}`).toBeLessThan(0.05);
      }
    }
  }
  table('7a. The signed volume of the swept tools, M10x1.5, 20 mm, at 0.05', ['hand', 'starts', 'kind', 'signed volume', 'exact', 'difference'], hands);

  // ---- b. a radial clearance on a pin: what is left of its wall
  const pins: string[][] = [];
  const pinCases: { name: string; basic: Basic; wall: number; clearance: number; tol: number }[] = [
    { name: 'M10x1.5', basic: b, wall: 5, clearance: 0, tol: 0.05 },
    { name: 'M10x1.5', basic: b, wall: 5, clearance: 0.1, tol: 0.05 },
    { name: 'M10x1.5', basic: b, wall: 5, clearance: 0.2, tol: 0.05 },
    { name: 'M10x1.5', basic: b, wall: 4.8, clearance: 0.2, tol: 0.05 },
    { name: 'M10x1.5', basic: b, wall: 4.6, clearance: 0.4, tol: 0.05 },
    { name: 'M10x1.5', basic: b, wall: 4.8, clearance: 0.2, tol: 0.01 },
    { name: 'lid 40x4, 45°', basic: LID45.basic, wall: 20, clearance: 0.2, tol: 0.05 },
    { name: 'lid 40x4, 45°', basic: LID45.basic, wall: 19.7, clearance: 0.3, tol: 0.05 },
  ];
  for (const c of pinCases) {
    const lift = besideOf(c.tol);
    const moved = shifted(c.basic, -c.clearance);
    const t = Math.tan(c.basic.alpha);
    // the flat the grooves leave on the wall, by the profile (none: the grooves take the whole wall)
    const flat = c.basic.crestFlat + 2 * (moved.major - c.wall) * t;
    const groove = shapeOf(moved, { crestTo: c.wall + lift });
    const rod = prism(circle(0, 0, c.wall, c.tol), 0, l);
    const plate = prism(square(c.wall + 5), -5, 0).solid;
    const body = kernel.boolean('union', plate, rod.solid);
    const tool = buildSwept(groove, { kind: 'groove', outer: c.wall + 2 * lift }, lift, l + lift, c.tol, take(FACES.length));
    const cut = timed(() => kernel.boolean('difference', body, tool.solid));
    // the area of the wall that is left above z = 1 (below the tool, short of the shoulder, a strip of it always stays)
    let wallLeft = 0;
    if (cut.value) {
      const q = cut.value.positions;
      for (let k = 0; k < cut.value.faceIds.length; k++) {
        if (cut.value.faceIds[k] !== rod.first + 2) continue;
        const [i0, i1, i2] = [3 * cut.value.triangles[3 * k], 3 * cut.value.triangles[3 * k + 1], 3 * cut.value.triangles[3 * k + 2]];
        if (Math.min(q[i0 + 2], q[i1 + 2], q[i2 + 2]) < 1) continue;
        const [u, w] = [[q[i1] - q[i0], q[i1 + 1] - q[i0 + 1], q[i1 + 2] - q[i0 + 2]], [q[i2] - q[i0], q[i2 + 1] - q[i0 + 1], q[i2 + 2] - q[i0 + 2]]];
        wallLeft += Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
      }
    }
    // what the profile says of it: the flat, along the helix, over the turns above z = 1
    const wallExpected = Math.max(0, flat) * ((l - 1) / c.basic.pitch) * TAU * c.wall;
    const expected = volumeOf(body) - Math.PI * (l - lift) * meanOver(c.basic.pitch, (a) => c.wall ** 2 - Math.min(radiusAt(groove, a), c.wall) ** 2);
    pins.push([c.name, String(c.tol), String(c.wall), String(c.clearance), fmt(flat, 4), fmt(cut.ms), cut.value ? pct(volumeOf(cut.value) / expected - 1) : '-', cut.value ? survivors(cut.value, tool) : '', fmt(wallLeft, 1), fmt(wallExpected, 1), cut.error ?? '']);
    // a flat left by the profile: the wall is still a face; none left: the wall is gone
    if (flat > 0) {
      expect(cut.error, pins[pins.length - 1].join(' | ')).toBeUndefined();
      expect(wallLeft, pins[pins.length - 1].join(' | ')).toBeGreaterThan(0);
      expect(survivors(cut.value as Solid, tool).split(' ')).not.toContain('wall');
    } else if (cut.value) expect(wallLeft, pins[pins.length - 1].join(' | ')).toBeLessThan(0.5);
  }
  table('7b. An external thread with a radial clearance: the groove tool on a pin', ['thread', 'chord tol', 'radius of the pin', 'clearance', 'flat left on the wall', 'ms', 'volume against exact', 'faces of the tool left', 'area of the wall left above z = 1, mm²', 'by the flat', 'error'], pins);

  // ---- b2. a screw in a nut with radial clearances: when the check finds nothing
  const mates: string[][] = [];
  for (const clearance of [0.2, 0.1, 0.06, 0.02]) {
    const rod = prism(circle(0, 0, b.major, tol), -2, l + 2).solid;
    const screw = kernel.boolean('difference', rod, buildSwept(shapeOf(b, { crestTo: b.major + beside }), { kind: 'groove', outer: b.major + 2 * beside }, -3, l + 3, tol, take(FACES.length)).solid);
    const hole = b.minor + clearance;
    const nutBasic = shifted(b, clearance);
    const block = prism(square(10), 0, l, [circle(0, 0, hole, tol)]).solid;
    const nut = kernel.boolean('difference', block, buildSwept(shapeOf(nutBasic, { rootTo: hole - beside }), { kind: 'ridge', inner: hole - 2 * beside }, -beside, l + beside, tol, take(FACES.length)).solid);
    const shared = timed(() => sharedBy(kernel, bodyOf(screw), bodyOf(nut), tol));
    const m = shared.value;
    const verdict = m && !('message' in m) ? verdictOf(m, 0.001, tol) : 'refused';
    mates.push([String(clearance), fmt(clearance * Math.sin(b.alpha), 3), m && !('message' in m) ? fmt(m.volume, 4) : '-', verdict, fmt(shared.ms)]);
    if (clearance * Math.sin(b.alpha) >= tol) expect(verdict, `radial clearance ${clearance}`).toBe('nothing');
  }
  table('7b2. M10x1.5 screw (no clearance) in a nut with a radial clearance, at 0.05', ['radial clearance', 'between the flanks', 'shared mm³', 'verdict', 'ms'], mates);

  // ---- c. the tool of a bore as a ring, and what stands in the way of a tool
  const rings: string[][] = [];
  const hole = b.minor;
  const nutShape = shapeOf(b, { rootTo: hole - beside });
  const drilled = () => prism(square(10), 0, l, [circle(0, 0, hole, tol)]);
  const bottom = () => prism(square(10), -3, 0).solid;
  const post = () => prism(circle(0, 0, 2, tol), 0, l).solid;
  const key = () => prism(rect(2, 2), 5, 10, [], shift([1, 0, 0], hole)).solid; // a key 2 x 2 across the wall of the bore
  const bores: { name: string; body: () => { solid: Solid; wall: number } }[] = [
    { name: 'a through hole', body: () => ((d) => ({ solid: d.solid, wall: d.first + 2 }))(drilled()) },
    { name: 'a blind hole with a post of 4 in its middle', body: () => ((d) => ({ solid: kernel.boolean('union', kernel.boolean('union', bottom(), d.solid), post()), wall: d.first + 2 }))(drilled()) },
    { name: 'a through hole with a key 2 x 2 standing into it', body: () => ((d) => ({ solid: kernel.boolean('union', d.solid, key()), wall: d.first + 2 }))(drilled()) },
  ];
  for (const bore of bores) {
    for (const kind of ['solid', 'ring'] as const) {
      const body = bore.body();
      const blind = bore.name.includes('blind');
      const [z0, z1] = [blind ? beside : -beside, l + beside];
      const tool = buildSwept(nutShape, kind === 'solid' ? { kind: 'solid' } : { kind: 'ridge', inner: hole - 2 * beside }, z0, z1, tol, take(FACES.length));
      const cut = timed(() => kernel.boolean('difference', body.solid, tool.solid));
      const groove = Math.PI * (l - Math.max(z0, 0)) * meanOver(b.pitch, (a) => Math.max(radiusAt(nutShape, a), hole) ** 2 - hole ** 2);
      const taken = cut.value ? volumeOf(body.solid) - volumeOf(cut.value) : NaN;
      const left = cut.value ? survivors(cut.value, tool) : '';
      // the faces of the tool that lie in the air: its root (inside the hole) and, of a ring, its inner cylinder
      const guard = left.split(' ').filter((role) => role === 'root' || role === 'wall');
      rings.push([bore.name, kind, String(tris(tool.solid)), fmt(cut.ms), fmt(taken, 2), fmt(groove, 2), left, guard.join(' ') || 'none', cut.error ?? '']);
      expect(cut.error, rings[rings.length - 1].join(' | ')).toBeUndefined();
      if (bore.name === 'a through hole') expect(guard).toEqual([]);
      // the post: a solid tool takes it without a trace; a ring leaves it and takes the grooves alone
      if (bore.name.includes('post')) {
        if (kind === 'solid') expect(taken).toBeGreaterThan(groove + 100);
        else expect(Math.abs(taken - groove)).toBeLessThan(0.02 * groove);
        expect(guard).toEqual([]);
      }
      // the key crosses the hidden faces of either tool: they are left in the body, which tells
      if (bore.name.includes('key')) expect(guard.length).toBeGreaterThan(0);
    }
  }
  // the same for a pin: a rib on its wall crosses the outer cylinder of the groove tool
  {
    const rod = prism(circle(0, 0, b.major, tol), 0, l);
    const rib = prism(rect(4, 2), 5, 10, [], shift([1, 0, 0], b.major)).solid;
    const body = kernel.boolean('union', rod.solid, rib);
    const tool = buildSwept(shapeOf(b, { crestTo: b.major + beside }), { kind: 'groove', outer: b.major + 2 * beside }, -beside, l + beside, tol, take(FACES.length));
    const cut = timed(() => kernel.boolean('difference', body, tool.solid));
    const left = cut.value ? survivors(cut.value, tool) : '';
    const guard = left.split(' ').filter((role) => role === 'crest' || role === 'wall');
    rings.push(['a pin with a rib 4 x 2 on its wall', 'groove', String(tris(tool.solid)), fmt(cut.ms), '', '', left, guard.join(' ') || 'none', cut.error ?? '']);
    if (cut.value) expect(guard.length).toBeGreaterThan(0);
  }
  table('7c. The tool of a bore, solid or a ring, and what stands in the way (M10x1.5, 20 mm, at 0.05)', ['body', 'tool', 'tool tris', 'ms', 'volume taken', 'the grooves alone', 'faces of the tool left', 'hidden faces left', 'error'], rings);

  // ---- d. the zone of a thread, judged on what two bodies share
  const zones: string[][] = [];
  const m8 = iso(8, 1.25);
  const pinZone: Zone = { low: m8.minor, high: m8.major, from: 0, to: 20 };
  const pin = () => prism(circle(0, 0, m8.major, tol), 0, 20).solid;
  const box = (x0: number, x1: number, y: number, z0: number, z1: number): Solid => prism(rect(x1 - x0, 2 * y), z0, z1, [], shift([1, 0, 0], (x0 + x1) / 2)).solid;
  const holed = (radius: number, z0: number, z1: number): Solid => prism(square(10), z0, z1, [circle(0, 0, radius, tol)]).solid;
  // a bore 10 deep with a countersink of 45° from z = 8 up: the cone reaches the major radius at z = 8 + (major − minor)
  const sunk = (): Solid => kernel.boolean('difference', holed(m8.minor, 0, 10), frustum(m8.minor - 0.5, 7.5, m8.minor + 2.0001, 10.0001, tol));
  // a wedge of 160° about the +X axis, to open a clamp
  const wedge = (): Solid => prism([[0, 0], [12 * Math.cos(-1.396), 12 * Math.sin(-1.396)], [12, -12], [12, 12], [12 * Math.cos(1.396), 12 * Math.sin(1.396)]] as P[], 4, 16).solid;
  const modelledNut = (): Solid => kernel.boolean('difference', prism(square(10), 0, l, [circle(0, 0, b.minor + 0.1, tol)]).solid, buildSwept(shapeOf(shifted(b, 0.1), { rootTo: b.minor + 0.1 - beside }), { kind: 'ridge', inner: b.minor + 0.1 - 2 * beside }, -beside, l + beside, tol, take(FACES.length)).solid);
  const zoneCases: { name: string; a: Solid; b: Solid; zone: Zone; mate: boolean }[] = [
    { name: 'M8 pin (cosmetic) in a plain hole at its minor diameter', a: pin(), b: holed(m8.minor, 5, 15), zone: pinZone, mate: true },
    { name: 'M8 pin pushed through a solid block (no hole)', a: pin(), b: box(-10, 10, 10, 5, 15), zone: pinZone, mate: false },
    { name: 'a plate 1 mm thick through the M8 pin', a: pin(), b: box(-10, 10, 10, 9.5, 10.5), zone: pinZone, mate: false },
    { name: 'a bar 2 x 2 through the axis of the M8 pin', a: pin(), b: box(-10, 10, 1, 9, 11), zone: pinZone, mate: false },
    { name: 'a wall pushed 0.5 mm into the M8 pin from one side', a: pin(), b: box(3.5, 10, 10, 5, 15), zone: pinZone, mate: false },
    { name: 'a clamp around 200° of the M8 pin, 0.4 mm into it', a: pin(), b: kernel.boolean('difference', holed(m8.major - 0.4, 5, 15), wedge()), zone: pinZone, mate: true },
    { name: 'a rod 8 in an M8 bore (cosmetic, at the minor diameter) with a countersink: the zone of the wall alone', a: prism(circle(0, 0, m8.major, tol), -2, 12).solid, b: sunk(), zone: { low: m8.minor, high: m8.major, from: 0, to: 8 }, mate: false },
    { name: 'the same, the zone run out through the countersink', a: prism(circle(0, 0, m8.major, tol), -2, 12).solid, b: sunk(), zone: { low: m8.minor, high: m8.major, from: 0, to: 8 + (m8.major - m8.minor) }, mate: true },
    { name: 'a rod 8 too long for a blind M8 bore: 2 mm into its bottom', a: prism(circle(0, 0, m8.major, tol), -2, 12).solid, b: kernel.boolean('union', prism(square(10), -5, 0).solid, holed(m8.minor, 0, 10)), zone: { low: m8.minor, high: m8.major, from: 0, to: 10 }, mate: false },
    { name: 'a plain rod 10 in a modelled M10 nut (clearance 0.1)', a: prism(circle(0, 0, b.major, tol), -2, l + 2).solid, b: modelledNut(), zone: { low: b.minor + 0.1, high: b.major + 0.1, from: 0, to: l }, mate: true },
  ];
  for (const c of zoneCases) {
    const common = kernel.boolean('intersection', c.a, c.b);
    const z = zoneOf(common, c.zone, tol + 1e-4);
    const excused = z.byVertices && z.inner && z.around;
    zones.push([c.name, fmt(volumeOf(common), 1), String(z.pieces), z.byVertices ? 'yes' : 'no', `${z.inner ? 'yes' : 'no'} (${fmt(z.nearest, 3)})`, `${z.around ? 'yes' : 'no'} (${fmt((z.widestGap * 180) / Math.PI, 0)}°)`, excused ? 'excused' : 'judged as every pair', c.mate ? 'a mate' : 'no mate']);
    expect(excused, zones[zones.length - 1].join(' | ')).toBe(c.mate);
  }
  table('7d. What two bodies share against the zone of a thread (at 0.05)', ['pair', 'shared mm³', 'pieces', 'every vertex in the zone', 'no triangle inside the lower radius (nearest to the axis)', 'around the axis (widest gap)', 'by the three rules', 'what it is'], zones);
});

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('6 random threads in random poses: what the adapter refuses', () => {
  const count = Number(process.env.THREAD_SPIKE_COUNT ?? (FULL ? 50 : 4));
  // THREAD_SPIKE_ONLY=107,115: only these cases of the sequence
  const only = process.env.THREAD_SPIKE_ONLY?.split(',').map(Number);
  const random = mulberry(Number(process.env.THREAD_SPIKE_SEED ?? 1));
  const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)];
  interface Tally {
    runs: number;
    refused: number;
    ms: number;
    volume: number; // the worst, as a share of the bound
    cases: string[];
  }
  const tallies = new Map<string, Tally>();
  for (let i = 0; i < count; i++) {
    const diameter = 6 + 42 * random();
    const pitch = diameter * (0.06 + 0.1 * random());
    const more = { starts: pick([1, 1, 1, 2, 3]), hand: pick([1, -1] as const) };
    const metric = random() < 0.5;
    const [depth, angle] = [pitch * (0.3 + 0.15 * random()), pick([30, 45])];
    const basic = metric ? iso(diameter, pitch, more) : printed(diameter, pitch, depth, angle, more);
    const length = Math.min(40, basic.pitch * basic.starts * (0.4 + 7 * random()));
    // a thread shallower than five chord tolerances is not a thread of that tolerance
    // THREAD_SPIKE_TOLS=0.01: the chord tolerances to pick from (the default of a document is 0.01)
    const tols = (process.env.THREAD_SPIKE_TOLS?.split(',').map(Number) ?? [0.02, 0.05, 0.1]).filter((t) => basic.major - basic.minor >= 5 * t);
    if (tols.length === 0) continue; // too shallow for every tolerance asked for
    const tol = pick(tols);
    const far = random() < 0.7;
    const axis: [number, number, number] = [random() - 0.5, random() - 0.5, random() - 0.5];
    const direction: [number, number, number] | undefined = far ? [random() - 0.5, random() - 0.5, random() - 0.5] : undefined;
    const distance = far ? 250 * random() : 0;
    const pose = direction ? compose(shift(direction, distance), rotation([0, 0, 0], axis, TAU * random())) : undefined;
    if (only && !only.includes(i)) continue;
    const c: Case = { name: `${metric ? 'metric' : `printed ${angle}°`} ${diameter.toFixed(2)}x${pitch.toFixed(3)}, ${more.starts} start(s), hand ${more.hand}, ${length.toFixed(2)} mm, tol ${tol}${far ? `, turned and ${distance.toFixed(0)} mm from the origin` : ''}`, basic, length };
    const atOrigin = jobs(c, tol, 0);
    jobs(c, tol, 0, pose).forEach((job, jobIndex) => {
      const body = job.body().solid;
      const bodyVolume = volumeOf(body);
      job.ends.forEach((ends, endsIndex) => {
        for (const build of (FULL && i % 5 === 0 ? ['swept', 'layered'] : ['swept']) as Build[]) {
          const key = `${job.name} | ${ends.flush ? 'an end in a face' : 'no end in a face'} | ${job.tight ? 'flanks meet beside the wall' : 'clear of the wall'} | ${build}`;
          const tally = tallies.get(key) ?? { runs: 0, refused: 0, ms: 0, volume: 0, cases: [] };
          tallies.set(key, tally);
          const tool = job.tool(build, take(FACES.length), ends);
          const result = timed(() => kernel.boolean(job.op, body, tool.solid));
          tally.runs++;
          tally.ms += result.ms;
          if (!result.value) {
            tally.refused++;
            // what is refused with no end in a face: is it the place? The same at the origin, unturned
            let there = '';
            if (!ends.flush && pose) {
              const same = atOrigin[jobIndex];
              const again = timed(() => kernel.boolean(same.op, same.body().solid, same.tool(build, take(FACES.length), same.ends[endsIndex]).solid));
              there = again.value ? ' (accepted at the origin, unturned)' : ` (refused at the origin too: ${again.error})`;
            }
            tally.cases.push(`#${i} ${c.name} / ${ends.name}: ${result.error}${there}`);
            continue;
          }
          const expected = bodyVolume + job.change * (ends.to - ends.from);
          const share = Math.abs(volumeOf(result.value) - expected) / (((6 * tol) / job.radius) * Math.PI * job.radius ** 2 * c.length);
          tally.volume = Math.max(tally.volume, share);
          if (share >= 1) tally.cases.push(`#${i} ${c.name} / ${ends.name}: the volume is off by ${share.toFixed(2)} of its bound`);
        }
      });
    });
  }
  const keys = [...tallies.keys()].sort();
  table(
    `6. ${count} random threads, most of them turned and up to 250 mm from the origin`,
    ['operation', 'ends of the tool', 'root or crest of the tool', 'build', 'booleans', 'refused', 'mean ms', 'worst volume error / bound'],
    keys.map((key) => {
      const t = tallies.get(key) as Tally;
      return [...key.split(' | '), String(t.runs), String(t.refused), fmt(t.ms / t.runs), fmt(t.volume, 2)];
    }),
  );
  console.log(['', ...keys.flatMap((key) => (tallies.get(key) as Tally).cases.map((text) => `${key}: ${text}`))].join('\n'));
  // A tool with no end in a face of the body is refused rarely (3 of 540 in the run of 150 cases
  // recorded in docs/d36/7a-thread/spike.md, all three far from the origin), and what is accepted
  // changes the volume as the exact surface says.
  for (const key of keys) {
    const t = tallies.get(key) as Tally;
    expect(t.volume, key).toBeLessThan(1);
    if (key.includes('no end in a face') && !only) expect(t.refused, key).toBeLessThanOrEqual(Math.ceil(0.02 * t.runs));
  }
});
