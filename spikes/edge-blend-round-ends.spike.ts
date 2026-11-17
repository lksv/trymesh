// The spike of package 4c (D67, docs/d36/4c-blend-round-ends/design.md, "Measured"), after the
// third round of reviews: a chamfer or fillet of an edge of D63 (straight between planes, circular
// between a plane and a cylinder about one axis) that ends at a cylinder, or (an arc) at a plane
// parallel to its axis, as a run-out: the tool runs on past the end until the corner of its profile
// (the wedge) lies beyond the end face C by the lift, and the air (or the material) beyond C does
// the rest. It is a prototype of the resolver of such an end, against the real kernel adapter, on
// bodies made by the engine. It does not run the step of D63 (one closure in edge-blend.ts that
// takes no other resolver); what it takes from the body and what it builds itself:
// - from the body: the pieces of the edge and their end vertices (its mesh segments, chained), the
//   corner of each piece (the directions into the faces, the angle between them, convex or
//   concave: from the faces' triangles along the edge, as D63's `along` and `signed`), the faces at
//   an end (the triangles at the end vertex), their exact surfaces;
// - the side the edge runs into from a point of the piece away from the end (its midpoint) and the
//   crossing angle at the exact root where the edge's line or circle leaves that side; the reach
//   solved exactly as intervals (a line against a cylinder of any axis; a circle against a cylinder
//   parallel to its axis or a plane parallel to it), for the outside of a cylinder with the whole
//   wedge polygon kept outside the cylinder grown by the lift;
// - the void check (round 3): the actual tool of the piece with the body (convex: what it takes;
//   concave: what it adds), cut from where its whole profile is clear of C going back from the end
//   (solved exactly) to past the reach, then to the region beyond C by the lift and the chord
//   tolerance (its polygon's sides from a sagitta budget of a quarter of the chord tolerance);
// - the tools as D63's profile swept along the piece and lengthened, united, applied, no fallback;
// - the checks: D63's overshoot sliver bound, the caps of run-outs on the blend's surface.
// Every outcome is counted and the expectations are asserted: `ok`; refusals by design with their
// code and the face in refs (`bridge`, `flat`, `stop`, `kind`, `several`, `fillet`, `radius`,
// `void`, `cap`); failures (`left`, `kernel`). "Reference" is the same blend made by the engine
// before the feature that made C, or an exact volume.
// Run from the root of the repository:
//   npx vitest run --config spikes/vitest.config.ts spikes/edge-blend-round-ends.spike.ts
// More random cases: ROUND_ENDS_COUNT (default 40), another seed: ROUND_ENDS_SEED; the least
// crossing angle in degrees: ROUND_ENDS_MIN (default 10, R2 then asserts nothing below it).
import { expect, test } from 'vitest';
import { createEngine, emptySketch } from '../packages/engine/src/index';
import type { Command, EdgeName, Engine, EngineState, FaceName, Id, PlaneRef, Solid, Surface } from '../packages/engine/src/index';
import { volumeOf } from '../packages/engine/src/solid';
import { bandOf } from '../packages/engine/src/recompute/body-boolean';
import { type BlendKind, type BlendProfile, type CornerPlace, blendProfile, liftOf, placed } from '../packages/engine/src/recompute/tool-edge';
import { segments } from '../packages/engine/src/sketch';
import { createManifoldKernel } from '../packages/kernel-manifold/src/index';
import { createPlanegcsSolver } from '../packages/solver-planegcs/src/index';

const kernel = await createManifoldKernel();
const solver = await createPlanegcsSolver();

type V2 = [number, number];
type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => mul(a, 1 / len(a));
const across = (v: V3, a: V3): V3 => sub(v, mul(a, dot(v, a))); // the part of v across the unit a
const anyAcross = (a: V3): V3 => unit(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]));
const dot2 = (a: V2, b: V2): number => a[0] * b[0] + a[1] * b[1];
const TWO_PI = 2 * Math.PI;
const norm = (x: number): number => ((x % TWO_PI) + TWO_PI) % TWO_PI;
const degrees = (x: number): number => (x * 180) / Math.PI;

// ---------------------------------------------------------------- the engine

const XY: PlaneRef = { kind: 'base', plane: 'XY' };
const side = (feature: Id, curve: Id): FaceName => ({ feature, role: 'side', curve });
const cap = (feature: Id): FaceName => ({ feature, role: 'endCap' });
const sketch = (id: Id, plane: PlaneRef): Command => ({ type: 'addFeature', feature: emptySketch(id, id, plane) });
const onTop = (body: Id, feature: Id): PlaneRef => ({ kind: 'face', body, face: cap(feature) });
const polygon = (s: Id, points: V2[], prefix = ''): Command => ({
  type: 'batch',
  commands: [
    ...points.map(([x, y], i): Command => ({ type: 'addPoint', sketch: s, id: `${prefix}p${i}`, x, y })),
    ...points.map((_, i): Command => ({ type: 'addCurve', sketch: s, id: `${prefix}l${i}`, curve: { type: 'line', a: `${prefix}p${i}`, b: `${prefix}p${(i + 1) % points.length}` } })),
  ],
});
const loop = (n: number, prefix = ''): Id[] => Array.from({ length: n }, (_, i) => `${prefix}l${i}`);
const circle = (s: Id, id: Id, x: number, y: number, radius: number): Command => ({ type: 'batch', commands: [{ type: 'addPoint', sketch: s, id: `${id}c`, x, y }, { type: 'addCurve', sketch: s, id, curve: { type: 'circle', center: `${id}c` }, radius }] });
type Extent = { type: 'distance'; start: number; distance: number; taper?: number } | { type: 'throughAll'; side: 'both' };
const extrude = (id: Id, s: Id, regions: Id[][], distance: number | Extent, operation: 'new' | 'add' | 'cut' = 'new', target = 'E'): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: s, regions: regions.map((outer) => ({ outerLoop: [...outer].sort() })) }, extent: typeof distance === 'number' ? { type: 'distance', start: 0, distance } : distance, operation, ...(operation === 'new' ? {} : { targets: [target] }) },
});
const blendFeature = (kind: BlendKind, id: Id, body: Id, edges: EdgeName[], size: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: kind, body, edges, ...(kind === 'chamfer' ? { distance: size } : { radius: size }) } as never });

function newEngine(chordTolerance: number): Engine {
  const engine = createEngine({ solver, kernel });
  const state = engine.getState();
  const loaded = engine.load(JSON.stringify({ ...state.document, settings: { ...state.document.settings, chordTolerance } }));
  if (!loaded.ok) throw new Error(loaded.error.message);
  return engine;
}
function run(engine: Engine, ...commands: Command[]): EngineState {
  for (const command of commands) {
    const result = engine.execute(command);
    if (!result.ok) throw new Error(result.error.message);
  }
  const state = engine.getState();
  for (const f of state.document.features) if (state.evaluation.features[f.id].status !== 'ok') throw new Error(`${f.id}: ${state.evaluation.features[f.id].error?.message}`);
  return state;
}
// The volume of the body after the same blend made by the engine at another place of the timeline
// (the reference), or why the engine refused it.
function reference(make: () => Engine, body: Id): number | string {
  try {
    return make().getState().evaluation.bodies[body].volume;
  } catch (error) {
    return String(error).replace(/^Error: /, '').slice(0, 80);
  }
}
// What D63 says of a blend of the edge, in a preview.
function d63(engine: Engine, edge: EdgeName, kind: BlendKind = 'chamfer', size = 0.5): string {
  const result = engine.preview(blendFeature(kind, 'probe', 'E', [edge], size));
  if (!result.ok) return `invalid: ${result.error.message}`;
  const outcome = result.state.evaluation.features.probe;
  return outcome.status === 'ok' ? 'ok' : (outcome.error?.message.replace(/^[^(]*\(/, '(') ?? '');
}
const sameName = (x: FaceName, y: FaceName): boolean => JSON.stringify(x) === JSON.stringify(y);

// ---------------------------------------------------------------- the body: pieces, corners, ends

const keyOf = (p: ArrayLike<number>, i = 0): string => `${p[i]},${p[i + 1]},${p[i + 2]}`;
interface Mesh {
  state: EngineState;
  body: Id;
  solid: Solid;
  at: Map<string, number[]>; // the triangles at each place
  point: (i: number) => V3;
}
function meshOf(state: EngineState, body: Id): Mesh {
  const solid = state.evaluation.bodies[body].solid;
  const q = solid.positions;
  const at = new Map<string, number[]>();
  for (let t = 0; t < solid.faceIds.length; t++)
    for (let k = 0; k < 3; k++) {
      const key = keyOf(q, 3 * solid.triangles[3 * t + k]);
      at.set(key, [...(at.get(key) ?? []), t]);
    }
  return { state, body, solid, at, point: (i) => [q[3 * i], q[3 * i + 1], q[3 * i + 2]] };
}
const corners = (mesh: Mesh, t: number): V3[] => [0, 1, 2].map((k) => mesh.point(mesh.solid.triangles[3 * t + k]));
const triangleNormal = (c: V3[]): V3 => cross(sub(c[1], c[0]), sub(c[2], c[0]));
const centroid = (c: V3[]): V3 => mul(add(add(c[0], c[1]), c[2]), 1 / 3);
const faceNumber = (mesh: Mesh, name: FaceName): number => {
  const found = mesh.state.evaluation.bodies[mesh.body].faces.find((f) => sameName(mesh.state.evaluation.faceNames[f.id], name));
  if (!found) throw new Error(`no face ${JSON.stringify(name)}`);
  return found.id;
};
// The pieces of an edge: its mesh segments chained by their vertices.
function piecesOf(mesh: Mesh, edge: EdgeName): V3[][] {
  const found = mesh.state.evaluation.bodies[mesh.body].edges.find((e) => (sameName(e.name.a, edge.a) && sameName(e.name.b, edge.b)) || (sameName(e.name.a, edge.b) && sameName(e.name.b, edge.a)));
  if (!found) throw new Error('no such edge');
  const s = found.segments;
  const at = new Map<string, number[]>();
  const point = new Map<string, V3>();
  for (let k = 0; k < s.length / 6; k++)
    for (const end of [0, 3]) {
      const key = keyOf(s, 6 * k + end);
      at.set(key, [...(at.get(key) ?? []), k]);
      point.set(key, [s[6 * k + end], s[6 * k + end + 1], s[6 * k + end + 2]]);
    }
  const used = new Set<number>();
  const pieces: V3[][] = [];
  for (const [start, list] of at) {
    if (list.length !== 1 || used.has(list[0])) continue;
    const keys = [start];
    let [key, segment] = [start, list[0]];
    for (;;) {
      used.add(segment);
      const [k0, k1] = [keyOf(s, 6 * segment), keyOf(s, 6 * segment + 3)];
      key = k0 === key ? k1 : k0;
      keys.push(key);
      const next = (at.get(key) ?? []).find((x) => !used.has(x));
      if (next === undefined) break;
      segment = next;
    }
    pieces.push(keys.map((k) => point.get(k) as V3));
  }
  return pieces;
}
// The triangles of a face along the segments of a piece: area, outward normal, the direction into
// the face across the segment (from the segment's midpoint to the triangle's centroid).
function along(mesh: Mesh, face: number, piece: V3[]): { area: number; normal: V3; inward: V3; middle: V3 }[] {
  const out: { area: number; normal: V3; inward: V3; middle: V3 }[] = [];
  for (let k = 0; k + 1 < piece.length; k++) {
    const [p, q] = [piece[k], piece[k + 1]];
    const shared = (mesh.at.get(keyOf(p)) ?? []).filter((t) => mesh.solid.faceIds[t] === face && (mesh.at.get(keyOf(q)) ?? []).includes(t));
    for (const t of shared) {
      const c = corners(mesh, t);
      const n = triangleNormal(c);
      const middle = mul(add(p, q), 0.5);
      const d = unit(sub(q, p));
      out.push({ area: len(n) / 2, normal: unit(n), inward: unit(across(sub(centroid(c), middle), d)), middle });
    }
  }
  return out;
}
// The exact direction `exact` signed by the area-weighted triangles (D63's `signed`).
function signed(exact: V3, items: { area: number; v: V3 }[]): V3 {
  const sum = items.reduce((s, x) => add(s, mul(x.v, x.area)), [0, 0, 0] as V3);
  if (!(Math.abs(dot(sum, exact)) > 0.5 * len(sum))) throw new Error('unclear side');
  return dot(sum, exact) > 0 ? exact : mul(exact, -1);
}

// The corner of a straight piece between two planes, in the coordinates of D63's profile: X into
// face a, Y across X towards face b, the profile's (x, y) at x·X + y·Y.
interface LineCorner {
  kind: 'line';
  d: V3;
  X: V3;
  Y: V3;
  beta: number;
  convex: boolean;
}
// The corner of an arc between a plane across its axis (face a) and a cylinder about it (face b),
// in the half plane through the axis: (radius, height along the axis from the centre).
interface ArcCorner {
  kind: 'circle';
  center: V3;
  axis: V3;
  radius: number;
  e1: V3;
  e2: V3;
  place: CornerPlace;
  beta: number;
  convex: boolean;
}
function lineCorner(mesh: Mesh, edge: EdgeName, piece: V3[]): LineCorner {
  const [fa, fb] = [faceNumber(mesh, edge.a), faceNumber(mesh, edge.b)];
  const [sa, sb] = [mesh.state.evaluation.faceSurfaces[fa], mesh.state.evaluation.faceSurfaces[fb]];
  if (sa.kind !== 'plane' || sb.kind !== 'plane') throw new Error('not a straight edge between planes');
  const d = unit(cross(sa.normal, sb.normal));
  const [byA, byB] = [along(mesh, fa, piece), along(mesh, fb, piece)];
  const alongA = signed(unit(cross(d, sa.normal)), byA.map((x) => ({ area: x.area, v: x.inward })));
  const alongB = signed(unit(cross(d, sb.normal)), byB.map((x) => ({ area: x.area, v: x.inward })));
  const outA = signed(unit(sa.normal), byA.map((x) => ({ area: x.area, v: x.normal })));
  const beta = Math.acos(Math.max(-1, Math.min(1, dot(alongA, alongB))));
  return { kind: 'line', d, X: alongA, Y: unit(across(alongB, alongA)), beta, convex: dot(alongB, outA) < 0 };
}
function arcCorner(mesh: Mesh, edge: EdgeName, piece: V3[]): ArcCorner {
  const [fa, fb] = [faceNumber(mesh, edge.a), faceNumber(mesh, edge.b)];
  const [sa, sb] = [mesh.state.evaluation.faceSurfaces[fa], mesh.state.evaluation.faceSurfaces[fb]];
  if (sa.kind !== 'plane' || sb.kind !== 'cylinder') throw new Error('the spike takes arcs between a plane across the axis and a cylinder');
  const axis = unit(sb.axis);
  const p = piece[0];
  const center = add(sb.origin, mul(axis, dot(sub(p, sb.origin), axis)));
  const half = (v: V3, at: V3): V2 => [dot(v, unit(across(sub(at, center), axis))), dot(v, axis)];
  const [byA, byB] = [along(mesh, fa, piece), along(mesh, fb, piece)];
  const sum = (items: { area: number; v: V2 }[]): V2 => items.reduce((s, x): V2 => [s[0] + x.area * x.v[0], s[1] + x.area * x.v[1]], [0, 0]);
  const inA = sum(byA.map((x) => ({ area: x.area, v: half(x.inward, x.middle) })));
  const inB = sum(byB.map((x) => ({ area: x.area, v: half(x.inward, x.middle) })));
  const outA = sum(byA.map((x) => ({ area: x.area, v: half(x.normal, x.middle) })));
  const alongA: V2 = [Math.sign(inA[0]), 0];
  const alongB: V2 = [0, Math.sign(inB[1])];
  const acrossB: V2 = [-alongA[1], alongA[0]];
  const acrossTowardsB: V2 = dot2(acrossB, alongB) < 0 ? [-acrossB[0], -acrossB[1]] : acrossB;
  const e1 = anyAcross(axis);
  return { kind: 'circle', center, axis, radius: sb.radius, e1, e2: cross(axis, e1), place: { point: [sb.radius, 0], alongA, acrossTowardsB }, beta: Math.PI / 2, convex: dot2(alongB, outA) < 0 };
}
const angleOf = (c: ArcCorner, x: V3): number => Math.atan2(dot(sub(x, c.center), c.e2), dot(sub(x, c.center), c.e1));
// A point (radius, height) of the half plane at the angle θ.
const onArc = (c: ArcCorner, q: V2, theta: number): V3 => add(add(c.center, mul(c.axis, q[1])), add(mul(c.e1, q[0] * Math.cos(theta)), mul(c.e2, q[0] * Math.sin(theta))));

// The faces at an end vertex besides the two of the edge, with their area-weighted normals there.
function facesAt(mesh: Mesh, p: V3, edge: EdgeName): { face: number; normal: V3 }[] {
  const names = mesh.state.evaluation.faceNames;
  const out = new Map<number, V3>();
  for (const t of mesh.at.get(keyOf(p)) ?? []) {
    const face = mesh.solid.faceIds[t];
    if (sameName(names[face], edge.a) || sameName(names[face], edge.b)) continue;
    out.set(face, add(out.get(face) ?? [0, 0, 0], triangleNormal(corners(mesh, t))));
  }
  return [...out].map(([face, normal]) => ({ face, normal }));
}
// Faces on one cylinder: the same radius, parallel axes, one axis line (a cylinder's origin is any
// point of its axis, so it is not compared).
function sameCylinder(a: Surface, b: Surface, precision: number): boolean {
  if (a.kind !== 'cylinder' || b.kind !== 'cylinder') return false;
  const [ua, ub] = [unit(a.axis), unit(b.axis)];
  return len(cross(ua, ub)) <= 1e-6 && len(across(sub(b.origin, a.origin), ua)) <= 10 * precision && Math.abs(a.radius - b.radius) <= 10 * precision;
}

// ---------------------------------------------------------------- exact sets of the parameter

type Interval = [number, number];
// The least t in [0, limit] in every one of the sets (each a list of closed intervals).
function leastInAll(sets: Interval[][], limit: number): number | undefined {
  let current: Interval[] = [[0, limit]];
  for (const set of sets) {
    const next: Interval[] = [];
    for (const [a, b] of current) for (const [c, d] of set) if (Math.max(a, c) <= Math.min(b, d)) next.push([Math.max(a, c), Math.min(b, d)]);
    current = next;
    if (!current.length) return undefined;
  }
  return Math.min(...current.map(([a]) => a));
}
// The interval of the intersection of the sets that holds its least t, or undefined.
function firstInAll(sets: Interval[][], limit: number): Interval | undefined {
  let current: Interval[] = [[0, limit]];
  for (const set of sets) {
    const next: Interval[] = [];
    for (const [a, b] of current) for (const [c, d] of set) if (Math.max(a, c) <= Math.min(b, d)) next.push([Math.max(a, c), Math.min(b, d)]);
    current = next;
    if (!current.length) return undefined;
  }
  return current.reduce((x, y) => (y[0] < x[0] ? y : x));
}
const clip = (list: Interval[], limit: number): Interval[] => list.map(([x, y]): Interval => [Math.max(0, x), Math.min(limit, y)]).filter(([x, y]) => x <= y);
// The real roots of A t² + B t + C.
function roots(A: number, B: number, C: number): number[] {
  if (Math.abs(A) < 1e-15) return Math.abs(B) < 1e-15 ? [] : [-C / B];
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const s = Math.sqrt(disc);
  return [(-B - s) / (2 * A), (-B + s) / (2 * A)].sort((x, y) => x - y);
}
// t where p + t·u lies inside (`inside`) or outside a cylinder of radius r about the line (o, unit a).
function lineCylinder(p: V3, u: V3, o: V3, a: V3, r: number, inside: boolean, limit: number): Interval[] {
  const w = across(sub(p, o), a);
  const v = across(u, a);
  const [A, B, C] = [dot(v, v), 2 * dot(w, v), dot(w, w) - r * r];
  if (A < 1e-15) return (C <= 0) === inside ? [[0, limit]] : [];
  const t = roots(A, B, C);
  if (t.length < 2) return inside ? [] : [[0, limit]];
  return clip(inside ? [[t[0], t[1]]] : [[-Infinity, t[0]], [t[1], Infinity]], limit);
}
// The angles t (from `from`, in the sense `sense`) where a point at radius rho about the origin of
// the plane across the axis lies inside or outside a circle (centre c, radius r) of that plane.
function circleCircle(rho: number, from: number, sense: 1 | -1, c: V2, r: number, inside: boolean, limit: number): Interval[] {
  const d = Math.hypot(c[0], c[1]);
  const k = (d * d + rho * rho - r * r) / (2 * rho * d);
  if (k >= 1) return inside ? [] : [[0, limit]];
  if (k <= -1) return inside ? [[0, limit]] : [];
  const half = Math.acos(k);
  const lo = norm(sense * (Math.atan2(c[1], c[0]) - from) - half);
  const arcs: Interval[] = inside ? [[lo, lo + 2 * half]] : [[lo + 2 * half, lo + TWO_PI]];
  const out: Interval[] = [];
  for (const [x, y] of arcs) for (const shift of [-TWO_PI, 0]) out.push([x + shift, y + shift]);
  return clip(out, limit);
}
// The angles t where a point at radius rho lies on the side n·x ≥ h of a line of the plane across
// the axis (n unit), from `from` in the sense `sense`.
function circlePlane(rho: number, from: number, sense: 1 | -1, n: V2, h: number, limit: number): Interval[] {
  const k = h / rho;
  if (k >= 1) return [];
  if (k <= -1) return [[0, limit]];
  const half = Math.acos(k);
  const lo = norm(sense * (Math.atan2(n[1], n[0]) - from) - half);
  return clip([[lo - TWO_PI, lo + 2 * half - TWO_PI], [lo, lo + 2 * half]], limit);
}
// The distance of the origin from a segment of the plane.
function originToSegment(a: V2, b: V2): number {
  const ab: V2 = [b[0] - a[0], b[1] - a[1]];
  const l2 = dot2(ab, ab);
  const s = l2 > 0 ? Math.max(0, Math.min(1, -dot2(a, ab) / l2)) : 0;
  return Math.hypot(a[0] + s * ab[0], a[1] + s * ab[1]);
}
const containsOrigin = (polygon: V2[]): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [a, b] = [polygon[i], polygon[j]];
    if (a[1] > 0 !== b[1] > 0 && 0 < ((b[0] - a[0]) * -a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};
// Where a moving polygon of the plane across a cylinder's axis (the origin) stays clear of the disc
// of radius R: the parameters where its distance from the origin crosses R or 0 (exact roots, from
// `criticals`), the pieces between them tested at their middles. Exact: membership changes only
// at those roots.
function clearOf(at: (t: number) => V2[], criticals: number[], R: number, limit: number): Interval[] {
  const cuts = [0, ...criticals.filter((t) => t > 0 && t < limit).sort((x, y) => x - y), limit];
  const clear = (t: number): boolean => {
    const poly = at(t);
    return !containsOrigin(poly) && poly.every((p, i) => originToSegment(p, poly[(i + 1) % poly.length]) >= R);
  };
  const out: Interval[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    if (cuts[i + 1] - cuts[i] < 1e-12) continue;
    if (!clear((cuts[i] + cuts[i + 1]) / 2)) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - cuts[i]) < 1e-12) last[1] = cuts[i + 1];
    else out.push([cuts[i], cuts[i + 1]]);
  }
  return out;
}
// The critical parameters of a polygon translated by t·v: a vertex at distance R (a quadratic), a
// side's line at distance R or 0 (linear).
function translationCriticals(poly: V2[], v: V2, R: number): number[] {
  const out: number[] = [];
  for (const p of poly) out.push(...roots(dot2(v, v), 2 * dot2(p, v), dot2(p, p) - R * R));
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (!(l > 1e-12)) return;
    const n: V2 = [-(q[1] - p[1]) / l, (q[0] - p[0]) / l];
    const nv = dot2(n, v);
    if (Math.abs(nv) > 1e-15) for (const h of [R, -R, 0]) out.push((h - dot2(n, p)) / nv);
  });
  return out;
}
// The critical angles of a polygon turned by sense·t about the origin of the plane, against a disc
// of radius R about c: a vertex at distance R from c (two circles), a side's line at distance R or 0
// from c (a circle and a line), solved in the polygon's frame where c turns the other way.
function rotationCriticals(poly: V2[], c: V2, sense: 1 | -1, R: number): number[] {
  const rc = Math.hypot(c[0], c[1]);
  const phi = Math.atan2(c[1], c[0]);
  const angles: number[] = [];
  for (const p of poly) {
    // the circle of radius rc about the origin against the circle (p, R)
    const d = Math.hypot(p[0], p[1]);
    if (d < 1e-15) continue;
    const k = (rc * rc + d * d - R * R) / (2 * rc * d);
    if (Math.abs(k) <= 1) for (const s of [1, -1]) angles.push(Math.atan2(p[1], p[0]) + s * Math.acos(k));
  }
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (!(l > 1e-12)) return;
    const n: V2 = [-(q[1] - p[1]) / l, (q[0] - p[0]) / l];
    for (const h of [R, -R, 0]) {
      const k = (dot2(n, p) + h) / rc;
      if (Math.abs(k) <= 1) for (const s of [1, -1]) angles.push(Math.atan2(n[1], n[0]) + s * Math.acos(k));
    }
  });
  // c turned by −sense·t lies at the angle ψ: t = sense·(φ − ψ), taken in [0, 2π)
  return angles.map((psi) => norm(sense * (phi - psi)));
}

// ---------------------------------------------------------------- meshes

// A profile carried along a path, one ring per step; sides base + k, caps base + 100 and base + 101.
// The kernel triangulates a counter-clockwise loop well and a clockwise one into slivers that a
// boolean then refuses, so the cap is triangulated counter-clockwise and the indices mapped back.
function sweep(profile: V2[], rings: V3[][], base: number): Solid {
  const n = profile.length;
  const positions: number[] = [];
  for (const ring of rings) for (const x of ring) positions.push(...x);
  const triangles: number[] = [];
  const faceIds: number[] = [];
  const area = profile.reduce((sum, p, i) => sum + p[0] * profile[(i + 1) % n][1] - profile[(i + 1) % n][0] * p[1], 0);
  const ccw = area >= 0 ? profile : [...profile].reverse();
  const raw = Array.from(kernel.triangulate([Float64Array.from(ccw.flat())]), (i) => (area >= 0 ? i : n - 1 - i));
  const flat: number[] = [];
  for (let i = 0; i < raw.length; i += 3) flat.push(...(area >= 0 ? [raw[i], raw[i + 1], raw[i + 2]] : [raw[i], raw[i + 2], raw[i + 1]]));
  const last = (rings.length - 1) * n;
  for (let i = 0; i < flat.length; i += 3) {
    triangles.push(flat[i], flat[i + 2], flat[i + 1], last + flat[i], last + flat[i + 1], last + flat[i + 2]);
    faceIds.push(base + 100, base + 101);
  }
  for (let r = 0; r + 1 < rings.length; r++)
    for (let k = 0; k < n; k++) {
      const [i, j] = [r * n + k, r * n + ((k + 1) % n)];
      triangles.push(i, j, j + n, i, j + n, i + n);
      faceIds.push(base + k, base + k);
    }
  let solid: Solid = { positions: Float32Array.from(positions), triangles: Uint32Array.from(triangles), faceIds: Uint32Array.from(faceIds) };
  if (volumeOf(solid) < 0) {
    const flipped = Uint32Array.from(triangles);
    for (let t = 0; t < flipped.length; t += 3) [flipped[t + 1], flipped[t + 2]] = [flipped[t + 2], flipped[t + 1]];
    solid = { ...solid, triangles: flipped };
  }
  return solid;
}
const range = (from: number, to: number, count: number): number[] => Array.from({ length: count + 1 }, (_, i) => from + ((to - from) * i) / count);
const unite = (solids: Solid[]): Solid => solids.reduce((sum, part) => kernel.boolean('union', sum, part));
function boxOf(solid: Solid): { low: V3; high: V3 } {
  const low: V3 = [Infinity, Infinity, Infinity];
  const high: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < solid.positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      low[k] = Math.min(low[k], solid.positions[i + k]);
      high[k] = Math.max(high[k], solid.positions[i + k]);
    }
  return { low, high };
}
const f3 = (x: number): string => x.toFixed(3);

// ---------------------------------------------------------------- the end face and the region beyond it

// C as the run-out sees it, with the side beyond it: for a cylinder whether beyond is its inside.
type EndFace = { kind: 'cylinder'; o: V3; a: V3; r: number; beyondInside: boolean } | { kind: 'plane'; o: V3; n: V3 }; // n: unit, towards beyond
// The sides of the polygon of the region beyond a cylinder: its sagitta at most a quarter of the
// chord tolerance (the engine's division of a circle for tol / 4, at most 4 096 sides); undefined
// where the cap leaves it larger (a radius absurd for the chord tolerance: refused).
function regionSides(radius: number, tolerance: number): number | undefined {
  const n = segments(TWO_PI, radius, tolerance / 4);
  return radius * (1 - Math.cos(Math.PI / n)) <= tolerance / 4 + 1e-12 ? n : undefined;
}
// The region beyond C by `offset` within a box (centre, half size): inside a cylinder the prism of
// an inscribed polygon of radius r − offset; outside it the box less the prism of a circumscribed
// polygon of radius r + offset; past a plane the box beyond it by the offset. `sides` as above
// (VOID_SIDES_OLD for the comparison of R11).
function beyondRegion(face: EndFace, offset: number, middle: V3, size: number, sides: number): Solid {
  const boxAlong = (n: V3, from: number, to: number): Solid => {
    // numbered apart from the prism, which the box of the outside is less
    const f1 = anyAcross(n);
    const f2 = cross(n, f1);
    const square: V2[] = [[-size, -size], [size, -size], [size, size], [-size, size]];
    const ring = (h: number): V3[] => square.map(([x, y]) => add(add(middle, mul(n, h)), add(mul(f1, x), mul(f2, y))));
    return sweep(square, [ring(from), ring(to)], 75000);
  };
  if (face.kind === 'plane') {
    const h = dot(sub(face.o, middle), face.n) + offset;
    return boxAlong(face.n, h, Math.max(h, 0) + 2 * size);
  }
  const f1 = anyAcross(face.a);
  const f2 = cross(face.a, f1);
  const s0 = dot(sub(middle, face.o), face.a);
  const radius = face.beyondInside ? face.r - offset : (face.r + offset) / Math.cos(Math.PI / sides);
  const disc: V2[] = Array.from({ length: sides }, (_, i): V2 => [radius * Math.cos((TWO_PI * i) / sides), radius * Math.sin((TWO_PI * i) / sides)]);
  const ring = (s: number): V3[] => disc.map(([x, y]) => add(add(face.o, mul(face.a, s)), add(mul(f1, x), mul(f2, y))));
  const prism = sweep(disc, [ring(s0 - 2 * size), ring(s0 + 2 * size)], 70000);
  if (face.beyondInside) return prism;
  return kernel.boolean('difference', boxAlong(face.a, -size, size), prism);
}
const VOID_SIDES_OLD = 256;
const areaOf = (solid: Solid): number => {
  let total = 0;
  for (let t = 0; t < solid.triangles.length / 3; t++) {
    const c = [0, 1, 2].map((k): V3 => {
      const i = 3 * solid.triangles[3 * t + k];
      return [solid.positions[i], solid.positions[i + 1], solid.positions[i + 2]];
    });
    total += len(triangleNormal(c)) / 2;
  }
  return total;
};

// ---------------------------------------------------------------- one blend with run-outs

type Outcome = 'ok' | 'bridge' | 'flat' | 'stop' | 'kind' | 'several' | 'fillet' | 'smooth' | 'radius' | 'void' | 'cap' | 'left' | 'kernel';
const CODE: Record<Outcome, string> = { ok: '', bridge: 'unsupportedEdge', flat: 'unsupportedEdge', stop: 'unsupportedEdge', kind: 'unsupportedEdge', several: 'unsupportedEdge', fillet: 'unsupportedEdge', smooth: 'unsupportedEdge', radius: 'blendDoesNotFit', void: 'blendDoesNotFit', cap: 'blendDoesNotFit', left: 'failure', kernel: 'failure' };
interface Result {
  outcome: Outcome;
  code: string;
  refs: FaceName[]; // the faces named besides the edge
  detail?: string;
  taken?: number; // mm³, cut (positive) or added (negative)
  reach?: number; // the largest reach, mm along the edge (at the largest radius of the profile for an arc)
  crossing?: number; // the smallest crossing angle, degrees
  beyond?: number; // the largest volume the void check found (mm³)
  meshCrossing?: number; // the smallest crossing angle read at the mesh vertex instead, degrees
  voidTime?: number; // ms in the void check
  blendTime?: number; // ms in the union of the tools, the boolean and the checks
}
const refusal = (outcome: Outcome, refs: FaceName[], detail?: string, extra: Partial<Result> = {}): Result => ({ outcome, code: CODE[outcome], refs, detail, ...extra });
const MIN_DEGREES = Number(process.env.ROUND_ENDS_MIN ?? 10);
const MIN_CROSSING = (MIN_DEGREES * Math.PI) / 180;
// The bound of the void check (mm³), shared with the contract (BLEND_RUN_OUT_VOID): every accepted
// case measured exactly 0 (an empty result); the least volume a regression had to be refused at was
// 1.9 × 10⁻⁴ mm³, 19 times the bound. A non-empty result under the bound is accepted only where
// the kernel's uncertainty for it (its band times the result's area) is under the bound too.
const VOID_BOUND = 1e-5;
// ROUND_ENDS_WHOLE=1 checks the whole tool of a piece against the unbounded region beyond C (the
// coordinator's first proposal of round 3), for the comparison in R5.
const WHOLE = process.env.ROUND_ENDS_WHOLE === '1';
const ANGLE_TOLERANCE = 1e-3;

interface EndOf {
  face: number;
  runOut?: { surface: EndFace; reach: number; crossing: number; meshCrossing: number; cut: number; sides: number };
  plane?: { o: V3; n: V3 }; // D63's planar end
}

// The blend of an edge with run-outs: straight between two planes, or an arc between a plane across
// its axis and a cylinder about it.
function blendWithRunOuts(state: EngineState, body: Id, edge: EdgeName, kind: BlendKind, size: number, tolerance: number): Result {
  const mesh = meshOf(state, body);
  const solid = mesh.solid;
  let largestCoordinate = 1;
  for (const x of solid.positions) largestCoordinate = Math.max(largestCoordinate, Math.abs(x));
  const precision = 1e-6 * largestCoordinate;
  const lift = liftOf(tolerance, bandOf(solid));
  const pieces = piecesOf(mesh, edge);
  const [fa, fb] = [faceNumber(mesh, edge.a), faceNumber(mesh, edge.b)];
  const straight = state.evaluation.faceSurfaces[fb].kind === 'plane';
  const names = state.evaluation.faceNames;
  const surfaces = state.evaluation.faceSurfaces;
  const extent = boxOf(solid);
  const diagonal = len(sub(extent.high, extent.low));
  // the corner of every piece; one profile for the edge (D63: the pieces agree)
  const cornersOf = pieces.map((piece) => (straight ? lineCorner(mesh, edge, piece) : arcCorner(mesh, edge, piece)));
  const corner = cornersOf[0];
  const profile: BlendProfile = blendProfile(kind, size, { beta: corner.beta, convex: corner.convex, round: [false, !straight] }, tolerance, { lift });
  const blendSides = profile.keys.filter((k) => k === 'blend').length;
  // the profile's points in 3D at a parameter: mm along a straight piece from its first vertex,
  // radians about the axis for an arc
  const lineAt = (c: LineCorner, origin: V3, q: V2, t: number): V3 => add(add(origin, mul(c.d, t)), add(mul(c.X, q[0]), mul(c.Y, q[1])));
  const half = (c: ArcCorner, q: V2): V2 => placed(c.place, q);
  // pieces as parameter ranges: [t0, t1] along d (straight) or [θ0, θ0 + sweep] (arcs, turned to a
  // positive sweep about the axis)
  const ranges = pieces.map((piece, i) => {
    const c = cornersOf[i];
    if (c.kind === 'line') {
      const t = piece.map((p) => dot(sub(p, pieces[0][0]), c.d));
      return { from: Math.min(...t), to: Math.max(...t), first: t[0] <= t[t.length - 1] ? piece[0] : piece[piece.length - 1], last: t[0] <= t[t.length - 1] ? piece[piece.length - 1] : piece[0] };
    }
    const a = piece.map((p) => angleOf(corner as ArcCorner, p));
    let total = 0;
    for (let k = 0; k + 1 < a.length; k++) total += Math.atan2(Math.sin(a[k + 1] - a[k]), Math.cos(a[k + 1] - a[k]));
    return total >= 0 ? { from: a[0], to: a[0] + total, first: piece[0], last: piece[piece.length - 1] } : { from: a[a.length - 1], to: a[a.length - 1] - total, first: piece[piece.length - 1], last: piece[0] };
  });
  const origin = pieces[0][0];
  const ends: EndOf[][] = [];
  let [largest, flattest, meshFlattest] = [0, 90, 90];
  const gapsFor: { index: number; end: 0 | 1; other: number; otherEnd: 0 | 1; gap: number }[] = [];

  for (const [index, piece] of pieces.entries()) {
    const c = cornersOf[index];
    const r = ranges[index];
    // a point of the piece away from its ends: the middle of a straight piece, the middle angle of an arc
    const middle = c.kind === 'line' ? mul(add(r.first, r.last), 0.5) : onArc(c, [c.radius, dot(sub(r.first, c.center), c.axis)], (r.from + r.to) / 2);
    const pieceEnds: EndOf[] = [];
    for (const end of [0, 1] as const) {
      const vertex = end === 0 ? r.first : r.last;
      const sense: 1 | -1 = end === 0 ? -1 : 1;
      const faces = facesAt(mesh, vertex, edge);
      // faces on one surface are one end face: flush planes, or faces of one cylinder
      const one = faces.length === 1 || (faces.length > 1 && faces.every((f) => sameCylinder(surfaces[faces[0].face], surfaces[f.face], precision)));
      if (!one) return refusal('several', faces.map((f) => names[f.face]), `${faces.length} faces at an end`);
      const C = faces[0].face;
      const s = surfaces[C];
      const meshNormal = faces.reduce((sum, f) => add(sum, f.normal), [0, 0, 0] as V3);
      // the smooth rule of D63: C continues face a or b at the vertex; the continuing edge has to be
      // of a kind the feature takes, else the end at an earlier blend is refused, named, deferred
      const normalOf = (surface: Surface, x: V3): V3 | undefined => (surface.kind === 'plane' ? unit(surface.normal) : surface.kind === 'cylinder' ? unit(across(sub(x, surface.origin), unit(surface.axis))) : undefined);
      const nC = normalOf(s, vertex);
      for (const [own, other] of [[fa, fb], [fb, fa]]) {
        const nOwn = normalOf(surfaces[own], vertex);
        if (nC && nOwn && len(cross(nC, nOwn)) <= 5 * ANGLE_TOLERANCE) {
          const continuing = state.evaluation.bodies[body].edges.find((e) => (sameName(e.name.a, names[C]) && sameName(e.name.b, names[other])) || (sameName(e.name.b, names[C]) && sameName(e.name.a, names[other])));
          if (continuing && (continuing.kind === 'line' || continuing.kind === 'circle')) return refusal('smooth', [names[C]], 'a smooth end of D63');
          return refusal('fillet', [names[C]], `the edge runs on smoothly into the face in refs, along an edge of the kind ${continuing?.kind ?? 'none'} this feature cannot take: the end is deferred`);
        }
      }
      // D63's planar end of a straight piece
      if (c.kind === 'line' && s.kind === 'plane' && faces.length === 1) {
        pieceEnds[end] = { face: C, plane: { o: s.origin, n: unit(s.normal) } };
        continue;
      }
      // a run-out: the kinds taken
      let face: EndFace;
      if (s.kind === 'cylinder') {
        const a = unit(s.axis);
        if (c.kind === 'circle' && len(cross(a, c.axis)) > ANGLE_TOLERANCE) return refusal('kind', [names[C]], 'a cylinder not parallel to the arc\'s axis');
        face = { kind: 'cylinder', o: s.origin, a, r: s.radius, beyondInside: false };
      } else if (s.kind === 'plane' && c.kind === 'circle') {
        const n = unit(s.normal);
        if (Math.abs(dot(n, c.axis)) > Math.sin(ANGLE_TOLERANCE)) return refusal('kind', [names[C]], 'a plane not parallel to the arc\'s axis');
        face = { kind: 'plane', o: s.origin, n };
      } else return refusal('kind', [names[C]], `the edge ends at a ${s.kind}`);
      // F > 0 outside a cylinder, on the side of the normal of a plane
      const F = (x: V3): number => (face.kind === 'cylinder' ? len(across(sub(x, face.o), face.a)) ** 2 - face.r ** 2 : dot(sub(x, face.o), face.n));
      // the exact curve of the piece from its middle on through this end: a parameter s ≥ 0 (mm
      // along a line, radians about an arc's axis), the end vertex at sEnd, the roots of F
      let pointAt: (s: number) => V3;
      let sEnd: number;
      let found: number[];
      let band = (tolerance + lift) / Math.sin(Math.max(MIN_CROSSING, Math.PI / 180));
      if (c.kind === 'line') {
        const u = mul(c.d, sense);
        pointAt = (x) => add(middle, mul(u, x));
        sEnd = dot(sub(vertex, middle), u);
        if (face.kind === 'cylinder') {
          const w = across(sub(middle, face.o), face.a);
          const v = across(u, face.a);
          found = roots(dot(v, v), 2 * dot(w, v), dot(w, w) - face.r ** 2);
        } else found = Math.abs(dot(u, face.n)) < 1e-15 ? [] : [dot(sub(face.o, middle), face.n) / dot(u, face.n)];
      } else {
        const thetaMiddle = angleOf(c, middle);
        const rho = c.radius;
        const height = dot(sub(vertex, c.center), c.axis);
        pointAt = (x) => onArc(c, [rho, height], thetaMiddle + sense * x);
        sEnd = norm(sense * (angleOf(c, vertex) - thetaMiddle));
        band /= rho;
        const c2 = (x: V3): V2 => [dot(sub(x, c.center), c.e1), dot(sub(x, c.center), c.e2)];
        let psis: number[] = [];
        if (face.kind === 'cylinder') {
          const cc = c2(face.o);
          const d = Math.hypot(cc[0], cc[1]);
          const k = (d * d + rho * rho - face.r ** 2) / (2 * rho * d);
          if (Math.abs(k) <= 1) psis = [1, -1].map((g) => Math.atan2(cc[1], cc[0]) + g * Math.acos(k));
        } else {
          const n2: V2 = [dot(face.n, c.e1), dot(face.n, c.e2)];
          const k = dot(sub(face.o, c.center), face.n) / Math.hypot(n2[0], n2[1]) / rho;
          if (Math.abs(k) <= 1) psis = [1, -1].map((g) => Math.atan2(n2[1], n2[0]) + g * Math.acos(k));
        }
        found = psis.map((psi) => norm(sense * (psi - thetaMiddle)));
      }
      found = found.filter((x) => x > 0).sort((x, y) => x - y);
      // the root at the end: the one within the band of the end vertex (the mesh vertex lies within
      // the chord tolerance of C, which along a curve crossing at the least angle is the band); none
      // or two there (the curve only grazes C) are refused
      const near = found.filter((x) => Math.abs(x - sEnd) <= band);
      if (near.length !== 1) return refusal('flat', [names[C]], near.length ? 'the edge only grazes the end face' : 'the edge does not meet the end face at its end');
      const chosen = near[0];
      const previous = Math.max(0, ...found.filter((x) => x < chosen));
      // the side the curve leaves at that root: F between the previous root (or the middle) and it
      const own = Math.sign(F(pointAt((previous + chosen) / 2)));
      const root = pointAt(chosen);
      const way = c.kind === 'line' ? mul(c.d, sense) : mul(unit(cross(c.axis, across(sub(root, c.center), c.axis))), sense);
      const gradient = face.kind === 'cylinder' ? unit(across(sub(root, face.o), face.a)) : face.n;
      const sine = Math.abs(dot(way, gradient));
      const meshSine = Math.abs(dot(c.kind === 'line' ? way : mul(unit(cross(c.axis, across(sub(vertex, c.center), c.axis))), sense), face.kind === 'cylinder' ? unit(across(sub(vertex, face.o), face.a)) : face.n));
      flattest = Math.min(flattest, degrees(Math.asin(Math.min(1, sine))));
      meshFlattest = Math.min(meshFlattest, degrees(Math.asin(Math.min(1, meshSine))));
      if (sine < Math.sin(MIN_CROSSING)) return refusal('flat', [names[C]], `the edge meets the end face at ${degrees(Math.asin(sine)).toFixed(1)}°, less than ${MIN_DEGREES}°`, { crossing: flattest, meshCrossing: meshFlattest });
      // into C's air: the side past the root is −own; the air is where C's outward normal points
      const airPositive = dot(gradient, meshNormal) > 0;
      const intoAir = -own > 0 === airPositive;
      if (intoAir !== c.convex) return refusal('stop', [names[C]], c.convex ? 'the edge runs into the material of the end face' : 'the edge runs past the end face into the air beyond it');
      if (face.kind === 'cylinder') face.beyondInside = own > 0;
      else face.n = mul(face.n, -own); // towards beyond
      if (face.kind === 'cylinder' && face.beyondInside && face.r - lift <= 0) return refusal('radius', [names[C]], `the end face's radius ${face.r} is within the lift ${f3(lift)} of the chord tolerance`);
      // the limit: the next piece on the way, else the body's extent (an arc: the rest of the turn)
      let limit: number;
      let neighbour: { other: number; otherEnd: 0 | 1 } | undefined;
      if (c.kind === 'line') {
        limit = diagonal;
        for (const [j, o] of ranges.entries()) {
          if (j === index) continue;
          for (const [oe, x] of [[0, o.first], [1, o.last]] as [0 | 1, V3][]) {
            const g = sense * dot(sub(x, vertex), c.d);
            if (g > 1e-9 && g < limit) [limit, neighbour] = [g, { other: j, otherEnd: oe }];
          }
        }
      } else {
        limit = TWO_PI - (r.to - r.from);
        const theta = end === 0 ? r.from : r.to;
        for (const [j, o] of ranges.entries()) {
          if (j === index) continue;
          for (const [oe, x] of [[0, o.from], [1, o.to]] as [0 | 1, number][]) {
            const g = norm(sense * (x - theta));
            if (g > 1e-9 && g < limit) [limit, neighbour] = [g, { other: j, otherEnd: oe }];
          }
        }
      }
      // the reach: the least t at which every point of the wedge lies beyond C by the lift (and,
      // outside a cylinder, the whole wedge polygon clear of the cylinder grown by the lift)
      const sets: Interval[][] = [];
      if (c.kind === 'line') {
        const t0 = dot(sub(vertex, origin), c.d);
        const u = mul(c.d, sense);
        const start = profile.wedge.map((q) => lineAt(c, origin, q as V2, t0));
        if (face.kind === 'cylinder') {
          const R = face.beyondInside ? face.r - lift : face.r + lift;
          for (const p of start) sets.push(lineCylinder(p, u, face.o, face.a, R, face.beyondInside, limit));
          if (!face.beyondInside) {
            const f1 = anyAcross(face.a);
            const f2 = cross(face.a, f1);
            const to2 = (x: V3): V2 => [dot(sub(x, face.o), f1), dot(sub(x, face.o), f2)];
            const poly = start.map(to2);
            const v: V2 = [dot(u, f1), dot(u, f2)];
            sets.push(clearOf((t) => poly.map((p): V2 => [p[0] + t * v[0], p[1] + t * v[1]]), translationCriticals(poly, v, R), R, limit));
          }
        } else return refusal('kind', [names[C]], 'a straight piece at a plane is D63\'s');
      } else {
        const theta = end === 0 ? r.from : r.to;
        const wedge = profile.wedge.map((q) => half(c, q as V2));
        const c2 = (x: V3): V2 => [dot(sub(x, c.center), c.e1), dot(sub(x, c.center), c.e2)];
        if (face.kind === 'cylinder') {
          const R = face.beyondInside ? face.r - lift : face.r + lift;
          const cc = c2(face.o);
          for (const q of wedge) sets.push(circleCircle(q[0], theta, sense, cc, R, face.beyondInside, limit));
          if (!face.beyondInside) {
            // the wedge turned about the arc's axis, in the plane across it, against the disc of C
            const poly = wedge.map((q): V2 => [q[0] * Math.cos(theta), q[0] * Math.sin(theta)]);
            const turned = (t: number): V2[] => poly.map((p): V2 => {
              const [cs, sn] = [Math.cos(sense * t), Math.sin(sense * t)];
              return [p[0] * cs - p[1] * sn - cc[0], p[0] * sn + p[1] * cs - cc[1]];
            });
            const criticals = rotationCriticals(poly, cc, sense, R);
            sets.push(clearOf(turned, criticals, R, limit));
          }
        } else {
          const n2: V2 = [dot(face.n, c.e1), dot(face.n, c.e2)];
          const m = Math.hypot(n2[0], n2[1]);
          const h = dot(sub(face.o, c.center), face.n) / m + lift;
          for (const q of wedge) sets.push(circlePlane(q[0], theta, sense, [n2[0] / m, n2[1] / m], h, limit));
        }
      }
      const reach = leastInAll(sets, limit);
      if (reach === undefined) return refusal('bridge', [names[C]], 'the corner passes behind the end face before it crosses it');
      if (neighbour) gapsFor.push({ index, end, other: neighbour.other, otherEnd: neighbour.otherEnd, gap: limit });
      largest = Math.max(largest, c.kind === 'line' ? reach : reach * Math.max(...profile.points.map((q) => half(c, q as V2)[0])));
      // the region beyond C checked by the void check: past C's mesh by lift + tol; its polygon's
      // sides from the error budget
      const offset = lift + tolerance;
      const regionRadius = face.kind === 'cylinder' ? (face.beyondInside ? face.r - offset : face.r + offset) : 0;
      const sides = face.kind === 'cylinder' ? regionSides(regionRadius, tolerance) : 4;
      if (sides === undefined) return refusal('radius', [names[C]], `the end face's radius ${face.kind === 'cylinder' ? face.r : 0} is too large for the chord tolerance`);
      if (face.kind === 'cylinder' && face.beyondInside && regionRadius <= 0) return refusal('radius', [names[C]], `the end face's radius is within lift + tol of the chord tolerance`);
      // where the checked part of the actual tool starts: going back from the end vertex, the first
      // parameter at which the whole profile (every point; the polygon where the own side is not
      // convex) lies on the own side of the region: exact, as the reach
      const pieceSpan = r.to - r.from;
      const ownSets: Interval[][] = [];
      if (c.kind === 'line') {
        const t0 = dot(sub(vertex, origin), c.d);
        const back = mul(c.d, -sense);
        const start = profile.points.map((q) => lineAt(c, origin, q as V2, t0));
        if (face.kind !== 'cylinder') return refusal('kind', [names[C]], 'a straight piece at a plane is D63\'s');
        for (const p of start) ownSets.push(lineCylinder(p, back, face.o, face.a, regionRadius, !face.beyondInside, pieceSpan));
        if (face.beyondInside) {
          const f1 = anyAcross(face.a);
          const f2 = cross(face.a, f1);
          const poly = start.map((x): V2 => [dot(sub(x, face.o), f1), dot(sub(x, face.o), f2)]);
          const v: V2 = [dot(back, f1), dot(back, f2)];
          ownSets.push(clearOf((t) => poly.map((p): V2 => [p[0] + t * v[0], p[1] + t * v[1]]), translationCriticals(poly, v, regionRadius), regionRadius, pieceSpan));
        }
      } else {
        const theta = end === 0 ? r.from : r.to;
        const points = profile.points.map((q) => half(c, q as V2));
        const c2 = (x: V3): V2 => [dot(sub(x, c.center), c.e1), dot(sub(x, c.center), c.e2)];
        const backSense = -sense as 1 | -1;
        if (face.kind === 'cylinder') {
          const cc = c2(face.o);
          for (const q of points) ownSets.push(circleCircle(q[0], theta, backSense, cc, regionRadius, !face.beyondInside, pieceSpan));
          if (face.beyondInside) {
            const poly = points.map((q): V2 => [q[0] * Math.cos(theta), q[0] * Math.sin(theta)]);
            const turned = (t: number): V2[] => poly.map((p): V2 => {
              const [cs, sn] = [Math.cos(backSense * t), Math.sin(backSense * t)];
              return [p[0] * cs - p[1] * sn - cc[0], p[0] * sn + p[1] * cs - cc[1]];
            });
            ownSets.push(clearOf(turned, rotationCriticals(poly, cc, backSense, regionRadius), regionRadius, pieceSpan));
          }
        } else {
          const n2: V2 = [dot(face.n, c.e1), dot(face.n, c.e2)];
          const m = Math.hypot(n2[0], n2[1]);
          const h = -dot(sub(face.o, c.center), face.n) / m - offset;
          for (const q of points) ownSets.push(circlePlane(q[0], theta, backSense, [-n2[0] / m, -n2[1] / m], h, pieceSpan));
        }
      }
      const clear = firstInAll(ownSets, pieceSpan);
      if (!clear) return refusal('void', [names[C]], 'the piece is shorter than its blend reaches into the end face');
      // cut a little further back, within the stretch where the profile is clear
      const margin = (size + profile.overshoot) / (c.kind === 'line' ? 1 : c.radius);
      const cut = WHOLE ? pieceSpan : Math.min(clear[0] + margin, (clear[0] + clear[1]) / 2);
      pieceEnds[end] = { face: C, runOut: { surface: face, reach, crossing: degrees(Math.asin(sine)), meshCrossing: degrees(Math.asin(meshSine)), cut, sides } };
    }
    ends.push(pieceEnds);
  }
  // two run-outs into one gap that together reach across it: a bridge
  for (const g of gapsFor) {
    const mine = ends[g.index][g.end].runOut?.reach ?? 0;
    const theirs = ends[g.other][g.otherEnd].runOut?.reach ?? 0;
    if (mine + theirs >= g.gap) return refusal('bridge', [names[ends[g.index][g.end].face]], 'the run-outs of two pieces meet across the gap');
  }

  // the tools, lengthened (the same meshes the boolean uses and the void check cuts)
  const tools: Solid[] = [];
  const stations: number[][] = []; // the angles of the rings of an arc's tool
  const runOutCaps = new Set<number>();
  for (const [index] of pieces.entries()) {
    const c = cornersOf[index];
    const r = ranges[index];
    const base = 1000 + 200 * index;
    const [e0, e1] = ends[index];
    if (c.kind === 'line') {
      const ringAt = (t: number): V3[] => profile.points.map((q) => lineAt(c, origin, q as V2, t));
      const planeRing = (plane: { o: V3; n: V3 }, t: number): V3[] =>
        profile.points.map((q) => {
          const x = lineAt(c, origin, q as V2, t);
          return add(x, mul(c.d, dot(plane.n, sub(plane.o, x)) / dot(plane.n, c.d)));
        });
      const [ta, tb] = [r.from - (e0.runOut?.reach ?? 0), r.to + (e1.runOut?.reach ?? 0)];
      tools.push(sweep(profile.points as V2[], [e0.plane ? planeRing(e0.plane, r.from) : ringAt(ta), e1.plane ? planeRing(e1.plane, r.to) : ringAt(tb)], base));
      stations.push([]);
      for (const [k, e] of [[0, e0], [1, e1]] as [0 | 1, EndOf][]) if (e.runOut) runOutCaps.add(base + 100 + k);
    } else {
      if (!e0.runOut || !e1.runOut) return refusal('kind', [], 'the spike takes arcs with run-outs at both ends');
      const halfPoints = profile.points.map((q) => half(c, q as V2));
      const big = Math.max(...halfPoints.map((q) => q[0]));
      const [from, to] = [r.from - e0.runOut.reach, r.to + e1.runOut.reach];
      const at = range(from, to, segments(to - from, big, tolerance / 2));
      tools.push(sweep(profile.points as V2[], at.map((theta) => halfPoints.map((q) => onArc(c, q, theta))), base));
      stations.push(at);
      runOutCaps.add(base + 100);
      runOutCaps.add(base + 101);
    }
  }
  let stage = 'the void check';
  try {
    // the void check: the actual tool of each piece with the body (what it takes, convex; what it
    // adds, concave), cut at the station where its profile is clear of the region going back from
    // the end, then to the region beyond C by lift + tol
    let beyond = 0;
    const started = performance.now();
    const chips: (Solid | undefined)[] = [];
    for (const [index] of pieces.entries()) {
      const c = cornersOf[index];
      const r = ranges[index];
      for (const end of [0, 1] as const) {
        const e = ends[index][end];
        if (!e.runOut) continue;
        stage = 'the void check, the tool with the body';
        const chip = (chips[index] ??= corner.convex ? kernel.boolean('intersection', tools[index], solid) : kernel.boolean('difference', tools[index], solid));
        if (!chip.triangles.length) continue;
        const sense: 1 | -1 = end === 0 ? -1 : 1;
        const { low, high } = boxOf(chip);
        const middle = mul(add(low, high), 0.5);
        const size = len(sub(high, low)) + 2;
        stage = 'the void check, the region';
        let region = beyondRegion(e.runOut.surface, lift + tolerance, middle, size, e.runOut.sides);
        if (!WHOLE) {
          // the part of the piece on the end's side of the cut
          let cutter: Solid;
          if (c.kind === 'line') {
            const u = mul(c.d, sense);
            const vertex = end === 0 ? r.first : r.last;
            const q = sub(vertex, mul(u, e.runOut.cut));
            const f1 = anyAcross(u);
            const f2 = cross(u, f1);
            const square: V2[] = [[-size, -size], [size, -size], [size, size], [-size, size]];
            const ring = (h: number): V3[] => square.map(([x, y]) => add(add(q, mul(u, h)), add(mul(f1, x), mul(f2, y))));
            cutter = sweep(square, [ring(0), ring(2 * size)], 80000);
          } else {
            // a sector about the arc's axis from the cut (moved to the middle between two rings of
            // the tool) to well past the reach
            const at = stations[index];
            const step = (at[at.length - 1] - at[0]) / (at.length - 1);
            const theta = end === 0 ? r.from : r.to;
            const raw = theta - sense * e.runOut.cut;
            const snapped = at[0] + (Math.round((raw - at[0]) / step - 0.5) + 0.5) * step;
            // past the reach by at most half the gap the tool leaves of the turn: a longer sector
            // reached the tool's other end (the keyway: the piece spans all but 17° of the turn)
            const gap = TWO_PI - (at[at.length - 1] - at[0]);
            const span = sense * (theta - snapped) + e.runOut.reach + Math.min(0.3, gap / 2);
            const Rb = Math.max(...profile.points.map((q) => half(c, q as V2)[0])) + 1;
            const n = Math.max(8, Math.ceil(span / 0.05));
            const sector: V2[] = [[0, 0], ...range(0, span, n).map((x): V2 => [Rb * Math.cos(snapped + sense * x), Rb * Math.sin(snapped + sense * x)])];
            const h0 = dot(sub(low, c.center), c.axis);
            const h1 = dot(sub(high, c.center), c.axis);
            const [lo, hi] = [Math.min(h0, h1) - size, Math.max(h0, h1) + size];
            const ring = (h: number): V3[] => sector.map(([x, y]) => add(add(c.center, mul(c.axis, h)), add(mul(c.e1, x), mul(c.e2, y))));
            cutter = sweep(sector, [ring(lo), ring(hi)], 80000);
          }
          region = kernel.boolean('intersection', region, cutter);
        }
        stage = 'the void check, the chip in the region';
        const part = kernel.boolean('intersection', chip, region);
        const v = part.triangles.length ? volumeOf(part) : 0;
        beyond = Math.max(beyond, v);
        if (v > VOID_BOUND) return refusal('void', [names[e.face]], `material beyond the end face within the run-out (${v.toExponential(2)} mm³)`, { beyond: v });
        if (part.triangles.length && bandOf(solid) * areaOf(part) > VOID_BOUND) return refusal('void', [names[e.face]], `${v.toExponential(2)} mm³ beyond the end face, within the kernel's uncertainty`, { beyond: v });
      }
    }
    const voidTime = performance.now() - started;
    const blendStarted = performance.now();
    stage = 'the union of the tools';
    const united = unite(tools);
    stage = 'the boolean with the body';
    const result = corner.convex ? kernel.boolean('difference', solid, united) : kernel.boolean('union', solid, united);
    const taken = volumeOf(solid) - volumeOf(result);
    // the overshoot of D63 (its sliver bound) and the caps of run-outs: each vertex on the blend's
    // surface within D63's allowance, else refused
    const allowance = lift + tolerance + 10 * precision;
    let [overshoot, capOff] = [0, 0];
    const blendOff = (x: V3): number => {
      let q: V2;
      if (corner.kind === 'line') q = [dot(sub(x, origin), corner.X), dot(sub(x, origin), corner.Y)];
      else {
        const rr = sub(x, corner.center);
        q = [len(across(rr, corner.axis)), dot(rr, corner.axis)];
      }
      const blend = profile.blend;
      if (blend.type === 'line') {
        const [a, b] = corner.kind === 'line' ? [blend.a, blend.b] : [half(corner, blend.a as V2), half(corner, blend.b as V2)];
        const dd: V2 = [b[0] - a[0], b[1] - a[1]];
        return Math.abs((q[0] - a[0]) * dd[1] - (q[1] - a[1]) * dd[0]) / Math.hypot(dd[0], dd[1]);
      }
      const centre = corner.kind === 'line' ? blend.center : half(corner, blend.center as V2);
      return Math.abs(Math.hypot(q[0] - centre[0], q[1] - centre[1]) - blend.radius);
    };
    let length = 0;
    for (const [i, rg] of ranges.entries()) length += cornersOf[i].kind === 'line' ? rg.to - rg.from : (rg.to - rg.from) * (corner as ArcCorner).radius;
    for (let t = 0; t < result.faceIds.length; t++) {
      const f = result.faceIds[t];
      if (f < 1000) continue;
      const local = f % 200;
      const c = [0, 1, 2].map((k): V3 => {
        const i = 3 * result.triangles[3 * t + k];
        return [result.positions[i], result.positions[i + 1], result.positions[i + 2]];
      });
      if (local >= 100) {
        if (runOutCaps.has(f)) capOff = Math.max(capOff, ...c.map(blendOff));
      } else if (local >= blendSides) overshoot += len(triangleNormal(c)) / 2;
    }
    if (capOff > allowance) return refusal('cap', [], `a cap of a run-out left ${f3(capOff)} mm off the blend's surface`, { taken, beyond });
    if (overshoot > 1e-4 * length) return refusal('left', [], `overshoot ${overshoot.toExponential(2)} mm² left`, { taken, beyond });
    return { outcome: 'ok', code: '', refs: [], taken, reach: largest, crossing: flattest, meshCrossing: meshFlattest, beyond, voidTime, blendTime: performance.now() - blendStarted };
  } catch (error) {
    return refusal('kernel', [], `${stage}: ${String(error).slice(7, 90)}`);
  }
}

const line = (result: Result): string => `${result.outcome}${result.detail ? ` (${result.detail})` : ''}`;
const relative = (taken: number | undefined, ref: number): number => (taken === undefined ? Infinity : Math.abs(taken - ref) / Math.max(Math.abs(ref), 1e-9));
// The bound against the reference: the tools are divided from other starts (an arc of each piece
// against a whole circle) and the polygons of the faces differ within the chord tolerance.
const REFERENCE_BOUND = 0.025;
let largestBeyond = 0;
const note = (result: Result): void => {
  if (result.outcome === 'ok') largestBeyond = Math.max(largestBeyond, result.beyond ?? 0);
};

// ---------------------------------------------------------------- R1: the rim of a bore broken by pockets

// The housing of the actuator: a plate 80 × 80 × 8, a bore R 29.5 through, `count` pockets of radius
// r on the circle `at`, `depth` deep; optionally a pin of radius `pin` in the middle of each pocket.
function housing(tolerance: number, count: number, r: number, at: number, options: { before?: Command[]; depth?: number; pin?: number } = {}): Engine {
  const engine = newEngine(tolerance);
  run(engine, sketch('s', XY), polygon('s', [[-40, -40], [40, -40], [40, 40], [-40, 40]]), extrude('E', 's', [loop(4)], 8), sketch('b', onTop('E', 'E')), circle('b', 'h', 0, 0, 29.5), extrude('H', 'b', [['h']], -10, 'cut'));
  if (options.before) run(engine, ...options.before);
  const pockets: Command[] = [];
  for (let k = 0; k < count; k++) pockets.push(circle('p', `k${k}`, at * Math.cos((TWO_PI * k) / count), at * Math.sin((TWO_PI * k) / count), r));
  run(engine, sketch('p', onTop('E', 'E')), ...pockets, extrude('P', 'p', Array.from({ length: count }, (_, k) => [`k${k}`]), -(options.depth ?? 4), 'cut'));
  return engine;
}
const RIM: EdgeName = { a: cap('E'), b: side('H', 'h') };

test('R1: the rim of a bore broken by 16 pin pockets (arcs running out into cylinders)', () => {
  console.log('\nR1: rim of a bore R 29.5 broken by 16 pockets r 2.5 on the circle 29 (the housing of the actuator)');
  console.log('tol | blend | outcome | taken: run-out, reference | reach (mm) | crossing (°) | time: the void check, the tools and the boolean | D63');
  for (const tolerance of [0.01, 0.05, 0.001]) {
    for (const [kind, size] of [['chamfer', 0.5], ['chamfer', 1.5], ['fillet', 0.5], ['fillet', 1]] as [BlendKind, number][]) {
      if (tolerance === 0.001 && size > 0.5) continue;
      const engine = housing(tolerance, 16, 2.5, 29);
      const result = blendWithRunOuts(engine.getState(), 'E', RIM, kind, size, tolerance);
      note(result);
      const before = engine.getState().evaluation.bodies.E.volume;
      const ref = reference(() => housing(tolerance, 16, 2.5, 29, { before: [blendFeature(kind, 'C', 'E', [RIM], size)] }), 'E');
      console.log(`${tolerance} | ${kind} ${size} | ${line(result)} | ${result.taken === undefined ? '-' : f3(result.taken)}, ${typeof ref === 'number' ? f3(before - ref) : `refused: ${ref}`} | ${f3(result.reach ?? 0)} | ${(result.crossing ?? 0).toFixed(1)} | ${(result.voidTime ?? 0).toFixed(0)} ms, ${(result.blendTime ?? 0).toFixed(0)} ms | ${tolerance === 0.01 && size === 0.5 && kind === 'chamfer' ? d63(engine, RIM) : ''}`);
      expect(result.outcome).toBe('ok');
      if (typeof ref === 'number') expect(relative(result.taken, before - ref)).toBeLessThan(REFERENCE_BOUND);
    }
  }
});

// ---------------------------------------------------------------- R2: a straight edge into a hole, by the angle

// A box 60 × 40 × h with a vertical hole of radius r through it at (30, yc): the top-front edge in
// two pieces, each ending at the hole, crossing it at φ where yc = r cos φ (the centre behind the
// front face for yc > 0). `pin`: pins of radius pin.r standing in the hole (disjoint pieces of the
// body); `post`: a square post of side post.s in the hole.
function holedBox(tolerance: number, r: number, yc: number, options: { h?: number; before?: Command[]; pins?: { x: number; y: number; r: number }[]; post?: { x: number; y: number; s: number } } = {}): Engine {
  const h = options.h ?? 20;
  const engine = newEngine(tolerance);
  run(engine, sketch('s', XY), polygon('s', [[0, 0], [60, 0], [60, 40], [0, 40]]), extrude('E', 's', [loop(4)], h));
  if (options.before) run(engine, ...options.before);
  run(engine, sketch('h', onTop('E', 'E')), circle('h', 'c', 30, yc, r), extrude('H', 'h', [['c']], -h - 5, 'cut'));
  if (options.pins?.length) run(engine, sketch('q', XY), ...options.pins.map((p, i) => circle('q', `n${i}`, p.x, p.y, p.r)), extrude('N', 'q', options.pins.map((_, i) => [`n${i}`]), h, 'add'));
  if (options.post) {
    const { x, y, s } = options.post;
    run(engine, sketch('t', XY), polygon('t', [[x, y], [x + s, y], [x + s, y + s], [x, y + s]], 't'), extrude('T', 't', [loop(4, 't')], h, 'add'));
  }
  return engine;
}
const TOP_FRONT: EdgeName = { a: cap('E'), b: side('E', 'l0') };

test('R2: a straight edge broken by a hole, at falling angles (the least crossing angle)', () => {
  console.log('\nR2: the top-front edge of a box 60 × 40 × 20 broken by a hole r 4 through it, crossing at φ');
  console.log('tol | φ (°) | centre | blend | outcome | taken: run-out, reference | reach (mm) | crossing exact, at the mesh vertex');
  const tally = new Map<string, number>();
  for (const tolerance of [0.01, 0.05]) {
    for (const phi of [90, 45, 25, 15, 12, 10.5, 9.5, 7, 5, 3]) {
      for (const sign of [1, -1]) {
        if (phi === 90 && sign === -1) continue;
        const yc = sign * 4 * Math.cos((phi * Math.PI) / 180);
        for (const [kind, size] of [['chamfer', 1], ['fillet', 1], ['chamfer', 2]] as [BlendKind, number][]) {
          const engine = holedBox(tolerance, 4, yc);
          const result = blendWithRunOuts(engine.getState(), 'E', TOP_FRONT, kind, size, tolerance);
          note(result);
          const before = engine.getState().evaluation.bodies.E.volume;
          const ref = reference(() => holedBox(tolerance, 4, yc, { before: [blendFeature(kind, 'C', 'E', [TOP_FRONT], size)] }), 'E');
          const refTaken = typeof ref === 'number' ? before - ref : NaN;
          const below = phi < MIN_DEGREES;
          tally.set(`${result.outcome}${below ? ' (below)' : ''}`, (tally.get(`${result.outcome}${below ? ' (below)' : ''}`) ?? 0) + 1);
          console.log(`${tolerance} | ${phi} | ${sign > 0 ? 'behind' : 'in front'} | ${kind} ${size} | ${line(result)} | ${result.taken === undefined ? '-' : f3(result.taken)}, ${f3(refTaken)} | ${result.reach === undefined ? '-' : f3(result.reach)} | ${result.crossing?.toFixed(2) ?? '-'}, ${result.meshCrossing?.toFixed(2) ?? '-'}`);
          if (below) expect(result.outcome).toBe('flat');
          else expect(['ok', 'bridge']).toContain(result.outcome);
          if (result.outcome === 'ok') expect(Math.abs((result.taken as number) - refTaken)).toBeLessThan(2e-3);
          if (result.outcome !== 'ok') expect(result.refs).toEqual([side('H', 'c')]);
        }
      }
    }
  }
  console.log('R2 outcomes:', JSON.stringify(Object.fromEntries(tally)));
  expect(tally.get('ok') ?? 0).toBeGreaterThanOrEqual(30);
});

test('R2b: small holes at the chord tolerance 0.05 (the lift against the radius)', () => {
  console.log('\nR2b: the top-front edge broken by a small hole (crossing 60°, centre behind), chord tolerance 0.05, lift 0.075');
  console.log('r | blend | outcome | taken: run-out, reference');
  for (const r of [0.07, 0.1, 0.2, 0.5, 1]) {
    for (const [kind, size] of [['chamfer', 0.3], ['fillet', 0.3]] as [BlendKind, number][]) {
      const yc = r * Math.cos(Math.PI / 3);
      let result: Result;
      let refTaken = NaN;
      try {
        const engine = holedBox(0.05, r, yc);
        result = blendWithRunOuts(engine.getState(), 'E', TOP_FRONT, kind, size, 0.05);
        const ref = reference(() => holedBox(0.05, r, yc, { before: [blendFeature(kind, 'C', 'E', [TOP_FRONT], size)] }), 'E');
        refTaken = typeof ref === 'number' ? engine.getState().evaluation.bodies.E.volume - ref : NaN;
      } catch (error) {
        console.log(`${r} | ${kind} ${size} | the model: ${String(error).slice(7, 80)}`);
        continue;
      }
      note(result);
      console.log(`${r} | ${kind} ${size} | ${line(result)} | ${result.taken === undefined ? '-' : f3(result.taken)}, ${f3(refTaken)}`);
      expect(['ok', 'bridge', 'flat', 'radius', 'void']).toContain(result.outcome);
      if (r - 0.075 <= 0) expect(['radius', 'flat']).toContain(result.outcome);
      if (result.outcome === 'ok' && Number.isFinite(refTaken)) expect(Math.abs((result.taken as number) - refTaken)).toBeLessThan(2e-3);
    }
  }
});

// ---------------------------------------------------------------- R3: a concave foot into a boss

// A plate 60 × 40 × 5, a rib (x 5 to 36, y 19 to 21, 10 high) running into a boss r 6 at (36, 20),
// 15 high: the concave foot of the rib runs out inside the boss (into material).
function ribbed(tolerance: number, between?: Command[], boss = 6): Engine {
  const engine = newEngine(tolerance);
  run(engine, sketch('s', XY), polygon('s', [[0, 0], [60, 0], [60, 40], [0, 40]]), extrude('E', 's', [loop(4)], 5), sketch('r', onTop('E', 'E')), polygon('r', [[5, 19], [36, 19], [36, 21], [5, 21]], 'r'), extrude('R', 'r', [loop(4, 'r')], 10, 'add'));
  if (between) run(engine, ...between);
  run(engine, sketch('b', onTop('E', 'E')), circle('b', 'o', 36, 20, boss), extrude('B', 'b', [['o']], 15, 'add'));
  return engine;
}
const FOOT: EdgeName = { a: cap('E'), b: side('R', 'rl0') };

test('R3: the concave foot of a rib running into a boss (a run-out into material)', () => {
  console.log('\nR3: concave foot of a rib (plate top × rib side y 19) running into a boss r 6');
  console.log('tol | blend | outcome | added: run-out, reference | reach | crossing');
  for (const tolerance of [0.01, 0.05]) {
    for (const [kind, size] of [['chamfer', 1.5], ['fillet', 1.5], ['fillet', 3]] as [BlendKind, number][]) {
      const engine = ribbed(tolerance);
      const result = blendWithRunOuts(engine.getState(), 'E', FOOT, kind, size, tolerance);
      note(result);
      const before = engine.getState().evaluation.bodies.E.volume;
      const ref = reference(() => ribbed(tolerance, [blendFeature(kind, 'C', 'E', [FOOT], size)]), 'E');
      console.log(`${tolerance} | ${kind} ${size} | ${line(result)} | ${result.taken === undefined ? '-' : f3(-result.taken)}, ${typeof ref === 'number' ? f3(ref - before) : ref} | ${f3(result.reach ?? 0)} | ${(result.crossing ?? 0).toFixed(1)}`);
      expect(result.outcome).toBe('ok');
      expect(typeof ref).toBe('number');
      expect(Math.abs(-(result.taken as number) - ((ref as number) - before))).toBeLessThan(2e-3);
    }
  }
});

// ---------------------------------------------------------------- R4: out through the cylinder of a shaft

// A shaft of radius 6, 20 long, with a hexagonal socket (circumradius 2√3, vertices at ±30°), 5
// deep, and a slot from the socket's corners (3, ±√3) out through the shaft (x to 7), 2 deep: the
// slot's two top edges run from a face of the socket out into the air outside the shaft's cylinder.
function shaft(tolerance: number): Engine {
  const engine = newEngine(tolerance);
  const h = 2 * Math.sqrt(3);
  run(
    engine,
    sketch('s', XY),
    circle('s', 'c', 0, 0, 6),
    extrude('E', 's', [['c']], 20),
    sketch('x', onTop('E', 'E')),
    polygon('x', Array.from({ length: 6 }, (_, k): V2 => [h * Math.cos(Math.PI / 6 + (k * Math.PI) / 3), h * Math.sin(Math.PI / 6 + (k * Math.PI) / 3)]), 'x'),
    extrude('X', 'x', [loop(6, 'x')], -5, 'cut'),
    sketch('t', onTop('E', 'E')),
    polygon('t', [[3, -Math.sqrt(3)], [7, -Math.sqrt(3)], [7, Math.sqrt(3)], [3, Math.sqrt(3)]], 't'),
    extrude('S', 't', [loop(4, 't')], -2, 'cut'),
  );
  return engine;
}
// A shaft of radius 6 with a slot y −3 to −1 across it (x ±7), 2 deep: the top edge of its wall
// y = −1 runs out through the cylinder at both ends.
function slotted(tolerance: number): Engine {
  const engine = newEngine(tolerance);
  run(engine, sketch('s', XY), circle('s', 'c', 0, 0, 6), extrude('E', 's', [['c']], 20), sketch('t', onTop('E', 'E')), polygon('t', [[-7, -3], [7, -3], [7, -1], [-7, -1]], 't'), extrude('S', 't', [loop(4, 't')], -2, 'cut'));
  return engine;
}
// The exact chamfer of a straight edge along x at the wall y = w (into y > w) on the top of a shaft of
// radius 6, from x = from(y) to the cylinder: ∫∫ (√(36 − y²) − from(y)) over the triangle.
function exactChamfer(size: number, w: number, from: (y: number, u: number) => number): number {
  let total = 0;
  const n = 400;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const [u, v] = [((i + 0.5) * size) / n, ((j + 0.5) * size) / n];
      if (u + v > size) continue;
      const y = w + u;
      total += (Math.sqrt(36 - y * y) - from(y, u)) * (size / n) ** 2;
    }
  return total;
}

test('R4: the slot of a shaft running out through its cylinder (a run-out into the air outside a cylinder)', () => {
  console.log('\nR4: the top edges of a slot out through a shaft r 6 (the motor shaft of the actuator), and a slot across it');
  console.log('tol | edge | blend | D63 | outcome | taken (exact) | reach');
  const y = Math.sqrt(3);
  for (const tolerance of [0.01, 0.05]) {
    for (const [wall, sign] of [['tl0', -1], ['tl2', 1]] as [Id, 1 | -1][]) {
      const edge: EdgeName = { a: cap('E'), b: side('S', wall) };
      for (const [kind, size] of [['chamfer', 0.5], ['fillet', 0.5]] as [BlendKind, number][]) {
        const engine = shaft(tolerance);
        const result = blendWithRunOuts(engine.getState(), 'E', edge, kind, size, tolerance);
        note(result);
        // between the socket's side through (3, √3) towards (0, 2√3) and the exact cylinder
        const exact = kind === 'chamfer' ? exactChamfer(size, y, (_, u) => 3 - u * Math.sqrt(3)) : NaN;
        console.log(`${tolerance} | ${wall} | ${kind} ${size} | ${tolerance === 0.01 && kind === 'chamfer' ? d63(engine, edge) : ''} | ${line(result)} | ${result.taken === undefined ? '-' : f3(result.taken)} (${f3(exact)}) | ${f3(result.reach ?? 0)}`);
        expect(result.outcome).toBe('ok');
        if (kind === 'chamfer') expect(Math.abs((result.taken as number) - exact)).toBeLessThan(0.02);
        void sign;
      }
    }
    // the slot across: chamfer 2 of its wall y = −1 towards +y, both ends out through the cylinder
    // (round 2: the earliest parameter where the points clear was refused as a bridge at x 5.93)
    for (const [kind, size] of [['chamfer', 2], ['chamfer', 0.5], ['fillet', 2]] as [BlendKind, number][]) {
      const engine = slotted(tolerance);
      const edge: EdgeName = { a: cap('E'), b: side('S', 'tl2') };
      const result = blendWithRunOuts(engine.getState(), 'E', edge, kind, size, tolerance);
      note(result);
      const exact = kind === 'chamfer' ? 2 * exactChamfer(size, -1, () => 0) : NaN;
      console.log(`${tolerance} | across, tl2 | ${kind} ${size} | | ${line(result)} | ${result.taken === undefined ? '-' : f3(result.taken)} (${f3(exact)}) | ${f3(result.reach ?? 0)}`);
      expect(result.outcome).toBe('ok');
      if (kind === 'chamfer') expect(relative(result.taken, exact)).toBeLessThan(0.01);
    }
  }
});

// ---------------------------------------------------------------- R5: an arc past planes off its axis

// A plate with a bore R 10 and a notch from the top: x from −w to w (or 0 to 13), y from `low` to
// `high`, 4 deep. A keyway (y ±1.5) crosses the rim at 81°; a notch whose floor is y = 10 cos φ is
// crossed by the rim at φ (the rim meets it at x = ±10 sin φ).
function keyed(tolerance: number, slot: V2[], before?: Command[]): Engine {
  const engine = newEngine(tolerance);
  run(engine, sketch('s', XY), polygon('s', [[-20, -20], [20, -20], [20, 20], [-20, 20]]), extrude('E', 's', [loop(4)], 8), sketch('b', onTop('E', 'E')), circle('b', 'h', 0, 0, 10), extrude('H', 'b', [['h']], -10, 'cut'));
  if (before) run(engine, ...before);
  run(engine, sketch('k', onTop('E', 'E')), polygon('k', slot, 'k'), extrude('K', 'k', [loop(4, 'k')], -4, 'cut'));
  return engine;
}
const KEYWAY: V2[] = [[0, -1.5], [13, -1.5], [13, 1.5], [0, 1.5]];
const notch = (phi: number): V2[] => {
  const low = 10 * Math.cos((phi * Math.PI) / 180);
  return [[-6, low], [6, low], [6, 13], [-6, 13]];
};

test('R5: the rim of a bore broken by a keyway and by notches crossing it near 10° (an arc running out past planes)', () => {
  console.log('\nR5: the rim of a bore R 10 broken by a keyway 3 wide, and by a notch whose floor it crosses at φ');
  console.log('tol | case | blend | outcome | taken: run-out, reference | reach | crossing exact, at the mesh vertex | D63');
  for (const tolerance of [0.01, 0.05]) {
    const cases: [string, V2[], number][] = [['keyway', KEYWAY, 81], ...[15, 12, 10.5, 9.5, 8].map((phi): [string, V2[], number] => [`notch ${phi}°`, notch(phi), phi])];
    for (const [name, slot, phi] of cases) {
      for (const [kind, size] of [['chamfer', 0.5], ['chamfer', 1], ['fillet', 0.5]] as [BlendKind, number][]) {
        const engine = keyed(tolerance, slot);
        const result = blendWithRunOuts(engine.getState(), 'E', RIM, kind, size, tolerance);
        note(result);
        const before = engine.getState().evaluation.bodies.E.volume;
        const ref = reference(() => keyed(tolerance, slot, [blendFeature(kind, 'C', 'E', [RIM], size)]), 'E');
        console.log(`${tolerance} | ${name} | ${kind} ${size} | ${line(result)} | ${result.taken === undefined ? '-' : f3(result.taken)}, ${typeof ref === 'number' ? f3(before - ref) : ref} | ${f3(result.reach ?? 0)} | ${result.crossing?.toFixed(2) ?? '-'}, ${result.meshCrossing?.toFixed(2) ?? '-'} | ${tolerance === 0.01 && kind === 'chamfer' && size === 0.5 ? d63(engine, RIM) : ''}`);
        if (phi < MIN_DEGREES) expect(result.outcome).toBe('flat');
        else expect(['ok', 'bridge']).toContain(result.outcome);
        if (name === 'keyway') expect(result.outcome).toBe('ok');
        if (result.outcome === 'ok' && typeof ref === 'number') expect(Math.abs((result.taken as number) - (before - ref))).toBeLessThan(Math.max(5e-3, 0.01 * (before - ref)));
      }
    }
  }
});

// ---------------------------------------------------------------- R6: other corners and axes

// An arc running out into the air outside a cylinder: a disc r 10, 8 high, with a hole r 4 at
// (8, 0) breaking out through its side: the hole's top rim runs out through the disc's cylinder.
// The reference: a disc r 20, the hole, the blend, then the ring outside r 10 cut away.
function brokenOut(tolerance: number, before?: Command[]): Engine {
  const engine = newEngine(tolerance);
  run(engine, sketch('s', XY), circle('s', 'c', 0, 0, before ? 20 : 10), extrude('E', 's', [['c']], 8), sketch('b', onTop('E', 'E')), circle('b', 'h', 8, 0, 4), extrude('H', 'b', [['h']], -10, 'cut'));
  if (before) run(engine, ...before, sketch('o', XY), circle('o', 'i', 0, 0, 10), circle('o', 'j', 0, 0, 30), extrude('O', 'o', [['j']], { type: 'throughAll', side: 'both' }, 'cut'));
  return engine;
}
// The exact chamfer of that rim: ∫∫ ρ · (the angle of the circle ρ about (8, 0) inside the disc).
function exactBrokenOut(size: number): number {
  let total = 0;
  const n = 600;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const [u, v] = [((i + 0.5) * size) / n, ((j + 0.5) * size) / n];
      if (u + v > size) continue;
      const rho = 4 + u;
      const k = (36 - rho * rho) / (16 * rho); // cos θ ≤ k inside the disc
      const inside = k >= 1 ? TWO_PI : k <= -1 ? 0 : TWO_PI - 2 * Math.acos(k);
      total += rho * inside * (size / n) ** 2;
    }
  return total;
}
// A box whose front face leans (its section in YZ: (0, 0), (40, 0), (40, 20), (5, 20)), extruded
// along X 60, with a vertical hole r 4 at (30, 5 + yc) through the top-front edge.
function leaning(tolerance: number, yc: number, before?: Command[]): Engine {
  const engine = newEngine(tolerance);
  run(engine, sketch('s', { kind: 'base', plane: 'YZ' }), polygon('s', [[0, 0], [40, 0], [40, 20], [5, 20]]), extrude('E', 's', [loop(4)], 60));
  if (before) run(engine, ...before);
  run(engine, sketch('h', XY), circle('h', 'c', 30, 5 + yc, 4), extrude('H', 'h', [['c']], { type: 'throughAll', side: 'both' }, 'cut'));
  return engine;
}
// A box with a hole r 4 drilled along an axis tilted 25° about Y, through its top-front edge.
function oblique(tolerance: number, yc: number, before?: Command[]): Engine {
  const engine = newEngine(tolerance);
  run(engine, sketch('s', XY), polygon('s', [[0, 0], [60, 0], [60, 40], [0, 40]]), extrude('E', 's', [loop(4)], 20));
  if (before) run(engine, ...before);
  run(
    engine,
    { type: 'addFeature', feature: { id: 'Q', name: 'Q', suppressed: false, type: 'plane', base: XY, offset: 20, tilt: { axis: { kind: 'base', axis: 'Y' }, angle: (25 * Math.PI) / 180 } } as never },
    sketch('h', { kind: 'plane', feature: 'Q' }),
    circle('h', 'c', 30, yc, 4),
    extrude('H', 'h', [['c']], { type: 'throughAll', side: 'both' }, 'cut'),
  );
  return engine;
}

// A concave arc: a plate 60 × 60 × 5 with a boss r 8 at (25, 30), 10 high, and a boss r 6 at
// (36, 30), 12 high, overlapping it: the foot of the first runs into the second (into material).
function twoBosses(tolerance: number, before?: Command[]): Engine {
  const engine = newEngine(tolerance);
  run(engine, sketch('s', XY), polygon('s', [[0, 0], [60, 0], [60, 60], [0, 60]]), extrude('E', 's', [loop(4)], 5), sketch('sa', onTop('E', 'E')), circle('sa', 'a', 25, 30, 8), extrude('A', 'sa', [['a']], 10, 'add'));
  if (before) run(engine, ...before);
  run(engine, sketch('sb', onTop('E', 'E')), circle('sb', 'b', 36, 30, 6), extrude('B', 'sb', [['b']], 12, 'add'));
  return engine;
}

test('R6: an arc out through a cylinder, a concave arc into a boss, a leaning face, an oblique hole', () => {
  console.log('\nR6: the rim of a hole breaking out through a disc; the foot of a boss into another; a box with a leaning front face; a hole along a tilted axis');
  console.log('tol | case | blend | outcome | taken: run-out, reference or exact | reach | crossing');
  for (const tolerance of [0.01, 0.05]) {
    for (const [kind, size] of [['chamfer', 1], ['fillet', 1], ['fillet', 2]] as [BlendKind, number][]) {
      const foot: EdgeName = { a: cap('E'), b: side('A', 'a') };
      const engine = twoBosses(tolerance);
      const result = blendWithRunOuts(engine.getState(), 'E', foot, kind, size, tolerance);
      note(result);
      const before = engine.getState().evaluation.bodies.E.volume;
      const ref = reference(() => twoBosses(tolerance, [blendFeature(kind, 'C', 'E', [foot], size)]), 'E');
      console.log(`${tolerance} | concave arc | ${kind} ${size} | ${line(result)} | ${result.taken === undefined ? '-' : f3(-result.taken)}, ${typeof ref === 'number' ? f3(ref - before) : ref} | ${f3(result.reach ?? 0)} | ${result.crossing?.toFixed(1)}`);
      expect(result.outcome).toBe('ok');
      expect(typeof ref).toBe('number');
      expect(relative(-(result.taken as number), (ref as number) - before)).toBeLessThan(REFERENCE_BOUND);
    }
    for (const [kind, size] of [['chamfer', 0.5], ['chamfer', 1], ['fillet', 0.5]] as [BlendKind, number][]) {
      const engine = brokenOut(tolerance);
      const result = blendWithRunOuts(engine.getState(), 'E', RIM, kind, size, tolerance);
      note(result);
      const exact = kind === 'chamfer' ? exactBrokenOut(size) : NaN;
      const before = engine.getState().evaluation.bodies.E.volume;
      const ref = reference(() => brokenOut(tolerance, [blendFeature(kind, 'C', 'E', [RIM], size)]), 'E');
      console.log(`${tolerance} | broken out | ${kind} ${size} | ${line(result)} | ${result.taken === undefined ? '-' : f3(result.taken)}, ${typeof ref === 'number' ? f3(before - ref) : ref} (exact ${f3(exact)}) | ${f3(result.reach ?? 0)} | ${result.crossing?.toFixed(1)}`);
      expect(result.outcome).toBe('ok');
      expect(typeof ref).toBe('number');
      expect(relative(result.taken, before - (ref as number))).toBeLessThan(REFERENCE_BOUND);
    }
    for (const yc of [2, -1]) {
      for (const [kind, size] of [['chamfer', 1], ['fillet', 1]] as [BlendKind, number][]) {
        for (const [name, make, edge] of [
          ['leaning', leaning, { a: side('E', 'l2'), b: side('E', 'l3') }],
          ['oblique', oblique, TOP_FRONT],
        ] as [string, (t: number, y: number, b?: Command[]) => Engine, EdgeName][]) {
          const engine = make(tolerance, yc);
          const result = blendWithRunOuts(engine.getState(), 'E', edge, kind, size, tolerance);
          note(result);
          const before = engine.getState().evaluation.bodies.E.volume;
          const ref = reference(() => make(tolerance, yc, [blendFeature(kind, 'C', 'E', [edge], size)]), 'E');
          console.log(`${tolerance} | ${name} yc ${yc} | ${kind} ${size} | ${line(result)} | ${result.taken === undefined ? '-' : f3(result.taken)}, ${typeof ref === 'number' ? f3(before - ref) : ref} | ${f3(result.reach ?? 0)} | ${result.crossing?.toFixed(1)}`);
          expect(['ok', 'bridge']).toContain(result.outcome);
          if (result.outcome === 'ok' && typeof ref === 'number') expect(Math.abs((result.taken as number) - (before - ref))).toBeLessThan(Math.max(2e-3, 0.01 * (before - ref)));
        }
      }
    }
  }
});

// ---------------------------------------------------------------- R7: refusals, the void check

// A disc r 25 with a radial fin from its centre to the radius `end` (an arc about the centre), 1
// either side of y 200 - 200 = 0 (the motor shell): at `end` = 25 the fin's end is flush with the
// disc's side; past 25 it overhangs.
function finned(tolerance: number, end: number): Engine {
  const engine = newEngine(tolerance);
  const x = Math.sqrt(end * end - 1);
  run(
    engine,
    sketch('s', XY),
    circle('s', 'w', 0, 0, 25),
    extrude('E', 's', [['w']], 5),
    sketch('f', onTop('E', 'E')),
    { type: 'batch', commands: [['fa', 0, -1], ['fb', x, -1], ['fc', x, 1], ['fd', 0, 1], ['fo', 0, 0]].map(([id, px, py]): Command => ({ type: 'addPoint', sketch: 'f', id: id as Id, x: px as number, y: py as number })) },
    { type: 'addCurve', sketch: 'f', id: 'f0', curve: { type: 'line', a: 'fa', b: 'fb' } },
    { type: 'addCurve', sketch: 'f', id: 'f1', curve: { type: 'arc', center: 'fo', start: 'fb', end: 'fc' } },
    { type: 'addCurve', sketch: 'f', id: 'f2', curve: { type: 'line', a: 'fc', b: 'fd' } },
    { type: 'addCurve', sketch: 'f', id: 'f3', curve: { type: 'line', a: 'fd', b: 'fa' } },
    extrude('F', 'f', [['f0', 'f1', 'f2', 'f3']], 8, 'add'),
  );
  return engine;
}
// Two eccentric lobes stacked (the input shaft): the rim of the lower runs under the upper.
function lobes(tolerance: number): Engine {
  const engine = newEngine(tolerance);
  run(engine, sketch('s', XY), circle('s', 'l', 1.5, 0, 10), extrude('E', 's', [['l']], 5), sketch('u', onTop('E', 'E')), circle('u', 'm', -1.5, 0, 10), extrude('U', 'u', [['m']], 5, 'add'));
  return engine;
}
// A box with a leaning top (section in XZ ... built in YZ and turned: the top falls 4 over 40 in y)
// and the vertical front-right edge filleted r 5: the top-front edge ends where the front face runs
// on into the fillet, along an edge of the kind other (the leaning top against the fillet).
function filletedCorner(tolerance: number): Engine {
  const engine = newEngine(tolerance);
  run(engine, sketch('s', { kind: 'base', plane: 'YZ' }), polygon('s', [[0, 0], [40, 0], [40, 16], [0, 20]]), extrude('E', 's', [loop(4)], 60));
  run(engine, blendFeature('fillet', 'G', 'E', [{ a: side('E', 'l3'), b: cap('E') }], 5));
  return engine;
}

test('R7: refusals with their code and refs; the void check (pins, a post, shallow pockets); the noise bound', () => {
  console.log('\nR7: refusals and the void check');
  const show = (what: string, result: Result, refTaken?: number): void => console.log(`${what} | ${line(result)} | ${result.code} | refs ${JSON.stringify(result.refs)}${result.taken !== undefined ? ` | taken ${f3(result.taken)}${refTaken !== undefined ? `, reference ${f3(refTaken)}` : ''}` : ''}`);
  // stops
  {
    const engine = ribbed(0.01);
    const result = blendWithRunOuts(engine.getState(), 'E', { a: cap('R'), b: side('R', 'rl0') }, 'chamfer', 1, 0.01);
    show('stop: a rib\'s top edge into a boss', result);
    expect([result.outcome, result.code, result.refs]).toEqual(['stop', 'unsupportedEdge', [side('B', 'o')]]);
  }
  {
    const engine = finned(0.01, 25);
    const foot: EdgeName = { a: cap('E'), b: side('F', 'f2') };
    const result = blendWithRunOuts(engine.getState(), 'E', foot, 'chamfer', 2, 0.01);
    const m = meshOf(engine.getState(), 'E');
    const faces = piecesOf(m, foot).flatMap((p) => [p[0], p[p.length - 1]]).map((x) => facesAt(m, x, foot).map((f) => engine.getState().evaluation.faceNames[f.face]));
    show(`stop: a fin's foot past the rim of a disc, flush (faces at the end ${JSON.stringify(faces)}); D63: ${d63(engine, foot, 'chamfer', 2)}`, result);
    expect([result.outcome, result.code]).toEqual(['stop', 'unsupportedEdge']);
  }
  {
    const engine = finned(0.01, 25.5);
    const foot: EdgeName = { a: cap('E'), b: side('F', 'f2') };
    const result = blendWithRunOuts(engine.getState(), 'E', foot, 'chamfer', 2, 0.01);
    show('several: a fin overhanging the rim (the disc\'s side and the fin\'s underside at the end)', result);
    expect([result.outcome, result.code]).toEqual(['several', 'unsupportedEdge']);
  }
  {
    const engine = lobes(0.01);
    const rim: EdgeName = { a: cap('E'), b: side('E', 'l') };
    const result = blendWithRunOuts(engine.getState(), 'E', rim, 'chamfer', 0.5, 0.01);
    show(`several: the rim of a lobe under another (the upper lobe's side and its underside where it overhangs); D63: ${d63(engine, rim)}`, result);
    expect([result.outcome, result.code]).toEqual(['several', 'unsupportedEdge']);
    expect(result.refs).toContainEqual(side('U', 'm'));
  }
  // pockets cut by two flush extrusions (4 and 2 deep): accepted, equal to the reference
  {
    const twice = (tolerance: number, before?: Command[]): Engine => {
      const engine = housing(tolerance, 16, 2.5, 29, { before });
      const again = Array.from({ length: 16 }, (_, k) => circle('second', `m${k}`, 29 * Math.cos((TWO_PI * k) / 16), 29 * Math.sin((TWO_PI * k) / 16), 2.5));
      run(engine, sketch('second', onTop('E', 'E')), ...again, extrude('P2', 'second', Array.from({ length: 16 }, (_, k) => [`m${k}`]), -2, 'cut'));
      return engine;
    };
    for (const tolerance of [0.01, 0.05]) {
      const engine = twice(tolerance);
      const m = meshOf(engine.getState(), 'E');
      const atEnds = piecesOf(m, RIM).flatMap((p) => [p[0], p[p.length - 1]]).map((x) => facesAt(m, x, RIM).length);
      const result = blendWithRunOuts(engine.getState(), 'E', RIM, 'chamfer', 0.5, tolerance);
      note(result);
      const before = engine.getState().evaluation.bodies.E.volume;
      const ref = reference(() => twice(tolerance, [blendFeature('chamfer', 'C', 'E', [RIM], 0.5)]), 'E');
      show(`grouped: pockets cut by two flush extrusions, tol ${tolerance} (faces at the 32 ends: ${JSON.stringify(Object.fromEntries(atEnds.reduce((mm, n) => mm.set(n, (mm.get(n) ?? 0) + 1), new Map<number, number>())))})`, result, typeof ref === 'number' ? before - ref : NaN);
      expect(result.outcome).toBe('ok');
      expect(relative(result.taken, before - (ref as number))).toBeLessThan(REFERENCE_BOUND);
    }
  }
  // an end at a cone (a tapered hole)
  {
    const engine = newEngine(0.01);
    run(engine, sketch('s', XY), polygon('s', [[0, 0], [60, 0], [60, 40], [0, 40]]), extrude('E', 's', [loop(4)], 20), sketch('h', onTop('E', 'E')), circle('h', 'c', 30, 0, 4), extrude('H', 'h', [['c']], { type: 'distance', start: 0, distance: -25, taper: -0.1 }, 'cut'));
    const result = blendWithRunOuts(engine.getState(), 'E', TOP_FRONT, 'chamfer', 1, 0.01);
    show('kind: an end at the cone of a tapered hole', result);
    expect([result.outcome, result.code, result.refs]).toEqual(['kind', 'unsupportedEdge', [side('H', 'c')]]);
  }
  // an end at an earlier fillet, tangent to a face of the edge, along an edge of the kind other
  {
    const engine = filletedCorner(0.01);
    const state = engine.getState();
    const edge: EdgeName = { a: side('E', 'l2'), b: side('E', 'l3') };
    const result = blendWithRunOuts(state, 'E', edge, 'chamfer', 1, 0.01);
    const kinds = state.evaluation.bodies.E.edges.filter((e) => [e.name.a, e.name.b].some((n) => sameName(n, { feature: 'G', role: 'fillet', edge: 0 } as FaceName))).map((e) => `${JSON.stringify(e.name.a.feature === 'G' ? e.name.b : e.name.a)}: ${e.kind}`);
    show(`fillet: the leaning top-front edge ending at an earlier fillet (its edges: ${kinds.join('; ')}); D63: ${d63(engine, edge, 'chamfer', 1)}`, result);
    expect([result.outcome, result.code, result.refs]).toEqual(['fillet', 'unsupportedEdge', [{ feature: 'G', role: 'fillet', edge: 0 }]]);
  }
  // a crossing under the least angle
  {
    const engine = holedBox(0.01, 4, 4 * Math.cos((8 * Math.PI) / 180));
    const result = blendWithRunOuts(engine.getState(), 'E', TOP_FRONT, 'chamfer', 1, 0.01);
    show('flat: a hole crossing the edge at 8°', result);
    expect([result.outcome, result.code, result.refs]).toEqual(['flat', 'unsupportedEdge', [side('H', 'c')]]);
  }
  // the void check: shallow pockets (round 2: a floor 0.2 above the foot, a hole 0.8 deep)
  console.log('the void check: pockets shallower than the blend');
  for (const [depth, kind, size] of [[0.1, 'chamfer', 0.5], [0.2, 'chamfer', 0.5], [0.3, 'fillet', 0.5], [0.8, 'chamfer', 1], [1.2, 'chamfer', 1]] as [number, BlendKind, number][]) {
    for (const tolerance of [0.01, 0.05]) {
      const engine = housing(tolerance, 16, 2.5, 29, { depth });
      const result = blendWithRunOuts(engine.getState(), 'E', RIM, kind, size, tolerance);
      if (depth > size) {
        // deep enough: accepted, equal to the reference
        const before = engine.getState().evaluation.bodies.E.volume;
        const ref = reference(() => housing(tolerance, 16, 2.5, 29, { depth, before: [blendFeature(kind, 'C', 'E', [RIM], size)] }), 'E');
        show(`pockets ${depth} deep, ${kind} ${size}, tol ${tolerance}`, result, typeof ref === 'number' ? before - ref : NaN);
        expect(result.outcome).toBe('ok');
        expect(relative(result.taken, before - (ref as number))).toBeLessThan(REFERENCE_BOUND);
        continue;
      }
      show(`pockets ${depth} deep, ${kind} ${size}, tol ${tolerance}`, result);
      expect([result.outcome, result.code, result.refs[0]?.feature]).toEqual(['void', 'blendDoesNotFit', 'P']);
    }
  }
  // the void check: pins and a post standing in the hole where the tool runs on (round 2: 8 of 12
  // pins accepted with 0.04 to 0.13 mm³ too much taken; a separate piece of 9 mm³ taken)
  console.log('the void check: pins and posts in the hole within the run-out');
  const tally = new Map<string, number>();
  for (const tolerance of [0.01, 0.05]) {
    for (const [kind, size] of [['chamfer', 1], ['fillet', 1]] as [BlendKind, number][]) {
      const yc = -2; // the centre in front: the corner crosses the wall later, the run-out is long
      const xEnd = 30 - Math.sqrt(16 - yc * yc);
      for (const pinR of [0.2, 0.3]) {
        for (const [dx, y] of [0, 0.25, 0.5, 0.75, 1].flatMap((x) => [0.25, 0.5, 0.75].map((yy): V2 => [x, yy]))) {
          const pin = { x: xEnd + dx, y, r: pinR };
          // the pin a piece of its own, clear of the hole's wall
          if (4 - Math.hypot(pin.x - 30, pin.y - yc) < pinR + 0.03) continue;
          const engine = holedBox(tolerance, 4, yc, { pins: [pin, { x: 60 - pin.x, y, r: pinR }] });
          const result = blendWithRunOuts(engine.getState(), 'E', TOP_FRONT, kind, size, tolerance);
          const before = engine.getState().evaluation.bodies.E.volume;
          const ref = reference(() => holedBox(tolerance, 4, yc, { before: [blendFeature(kind, 'C', 'E', [TOP_FRONT], size)], pins: [pin, { x: 60 - pin.x, y, r: pinR }] }), 'E');
          const refTaken = typeof ref === 'number' ? before - ref : NaN;
          show(`pin r ${pinR} at (${f3(pin.x)}, ${y}), ${kind} ${size}, tol ${tolerance}`, result, refTaken);
          tally.set(result.outcome, (tally.get(result.outcome) ?? 0) + 1);
          // refused, or accepted only where the reference agrees (the pin out of the tool's way)
          expect(['void', 'ok']).toContain(result.outcome);
          if (result.outcome === 'ok') expect(Math.abs((result.taken as number) - refTaken)).toBeLessThan(2e-3);
          if (result.outcome === 'void') expect(result.refs).toEqual([side('H', 'c')]);
        }
      }
    }
  }
  // a chamfer of 5 into a hole r 6 with a separate post 1 × 1 in its way
  for (const tolerance of [0.01, 0.05]) {
    const post = { x: 30 - Math.sqrt(36 - 4) + 0.3, y: 0.5, s: 1 };
    const engine = holedBox(tolerance, 6, 2, { post });
    const result = blendWithRunOuts(engine.getState(), 'E', TOP_FRONT, 'chamfer', 5, tolerance);
    show(`a separate post in a hole r 6, chamfer 5, tol ${tolerance}`, result);
    tally.set(`post ${result.outcome}`, (tally.get(`post ${result.outcome}`) ?? 0) + 1);
    expect([result.outcome, result.refs]).toEqual(['void', [side('H', 'c')]]);
  }
  console.log('pins and posts:', JSON.stringify(Object.fromEntries(tally)));
});

// ---------------------------------------------------------------- R8: random cases

function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('R8: random holes through edges and pockets around bores', () => {
  const rnd = random(Number(process.env.ROUND_ENDS_SEED ?? 1));
  const count = Number(process.env.ROUND_ENDS_COUNT ?? 40);
  const tolerances = [0.01, 0.05, 0.001];
  const tally = new Map<string, number>();
  let worst = 0;
  const notes: string[] = [];
  const count1 = (key: string) => tally.set(key, (tally.get(key) ?? 0) + 1);
  for (let i = 0; i < count; i++) {
    const tolerance = tolerances[i % 3];
    // a hole through the top-front edge of a box, crossing it at 12° or more
    {
      const r = 1 + 5 * rnd();
      const phi = ((12 + 78 * rnd()) * Math.PI) / 180;
      const yc = (rnd() < 0.5 ? 1 : -1) * r * Math.cos(phi);
      const h = 8 + 20 * rnd();
      const kind: BlendKind = rnd() < 0.5 ? 'chamfer' : 'fillet';
      const size = Number((0.2 + 2.3 * rnd()).toFixed(3));
      const engine = holedBox(tolerance, r, yc, { h });
      const result = blendWithRunOuts(engine.getState(), 'E', TOP_FRONT, kind, size, tolerance);
      note(result);
      count1(`hole ${result.outcome}`);
      if (result.outcome === 'ok') {
        const ref = reference(() => holedBox(tolerance, r, yc, { h, before: [blendFeature(kind, 'C', 'E', [TOP_FRONT], size)] }), 'E');
        if (typeof ref === 'number') worst = Math.max(worst, relative(result.taken, engine.getState().evaluation.bodies.E.volume - ref));
        else count1('hole reference refused');
      } else if (result.outcome !== 'bridge') notes.push(`hole r ${r.toFixed(2)} φ ${degrees(phi).toFixed(1)} ${kind} ${size} tol ${tolerance}: ${line(result)}`);
    }
    // pockets around a bore (3 to 20 of radius 1 to 4, their centres within ±1 of the bore's circle)
    {
      const n = 3 + Math.floor(17 * rnd());
      const at = 29.5 + (rnd() * 2 - 1);
      const r = Math.min(1 + 3 * rnd(), 0.45 * ((TWO_PI * at) / n));
      if (Math.abs(at - 29.5) >= r - 0.2) continue;
      const kind: BlendKind = rnd() < 0.5 ? 'chamfer' : 'fillet';
      const size = Number((0.2 + 1.3 * rnd()).toFixed(3));
      const engine = housing(tolerance, n, r, at);
      const result = blendWithRunOuts(engine.getState(), 'E', RIM, kind, size, tolerance);
      note(result);
      count1(`pockets ${result.outcome}`);
      if (result.outcome === 'ok') {
        const ref = reference(() => housing(tolerance, n, r, at, { before: [blendFeature(kind, 'C', 'E', [RIM], size)] }), 'E');
        if (typeof ref === 'number') worst = Math.max(worst, relative(result.taken, engine.getState().evaluation.bodies.E.volume - ref));
        else count1('pockets reference refused');
      } else if (result.outcome !== 'bridge') notes.push(`pockets ${n} r ${r.toFixed(2)} at ${at.toFixed(2)} ${kind} ${size} tol ${tolerance}: ${line(result)}`);
    }
  }
  console.log('\nR8:', JSON.stringify(Object.fromEntries(tally)), 'worst against the reference', worst.toExponential(2));
  for (const n of notes.slice(0, 20)) console.log('  ', n);
  console.log('the largest volume the void check found in an accepted case (all tests so far):', largestBeyond.toExponential(2));
  expect([...tally.keys()].filter((k) => !/ (ok|bridge)$|reference refused/.test(k))).toEqual([]);
  expect((tally.get('hole ok') ?? 0) + (tally.get('pockets ok') ?? 0)).toBeGreaterThanOrEqual(count);
  expect(worst).toBeLessThan(REFERENCE_BOUND);
  expect(largestBeyond).toBeLessThanOrEqual(VOID_BOUND);
});

// ---------------------------------------------------------------- R10: acute corners

// A wedge 60 long (along X) whose section in YZ is (0, 0), (60, 0), (60, 60 tan 10°): its edge at
// y 0, z 0 has faces meeting at 10°, so a fillet's setback is r / tan 5° (11.4 for r 1). A hole
// r 25 at (30, 17.7) crosses that edge at 45°; `pin`: pins standing in it (z −1 to 3) where the
// profile reaches into the hole before the end vertex (a pin 5.0 mm before it for the fillet of 1, where
// the part checked in round 2, (size + overshoot)(1 / tan 45° + 1) + lift = 4.0 mm, ended).
const WEDGE_HOLE = 25;
function acuteWedge(tolerance: number, options: { before?: Command[]; pins?: V2[] } = {}): Engine {
  const engine = newEngine(tolerance);
  run(engine, sketch('s', { kind: 'base', plane: 'YZ' }), polygon('s', [[0, 0], [60, 0], [60, 60 * Math.tan((10 * Math.PI) / 180)]]), extrude('E', 's', [loop(3)], 60));
  if (options.before) run(engine, ...options.before);
  run(engine, sketch('h', XY), circle('h', 'c', 30, WEDGE_HOLE * Math.cos(Math.PI / 4), WEDGE_HOLE), extrude('H', 'h', [['c']], { type: 'throughAll', side: 'both' }, 'cut'));
  if (options.pins?.length) run(engine, sketch('q', XY), ...options.pins.map(([x, y], i) => circle('q', `n${i}`, x, y, 0.2)), extrude('N', 'q', options.pins.map((_, i) => [`n${i}`]), { type: 'distance', start: -1, distance: 4 }, 'add'));
  return engine;
}
const ACUTE: EdgeName = { a: side('E', 'l0'), b: side('E', 'l2') };
// A box 60 × 40 × 20 with a groove across its front face along X, its walls meeting at 10° along the
// line y 8, z 10; a boss r 10 at (30, 0.93) fills the groove inside its circle, so the groove's
// bottom (concave) runs into the boss at 45°. `hole`: a hole r 0.25 drilled into the boss where the
// fillet's profile reaches into it before the end vertex.
function acuteGroove(tolerance: number, options: { before?: Command[]; holes?: V2[] } = {}): Engine {
  const engine = newEngine(tolerance);
  const w = 9 * Math.tan((5 * Math.PI) / 180);
  run(engine, sketch('s', XY), polygon('s', [[0, 0], [60, 0], [60, 40], [0, 40]]), extrude('E', 's', [loop(4)], 20), sketch('g', { kind: 'base', plane: 'YZ' }), polygon('g', [[-1, 10 + w], [-1, 10 - w], [8, 10]], 'g'), extrude('G', 'g', [loop(3, 'g')], { type: 'throughAll', side: 'both' }, 'cut'));
  if (options.before) run(engine, ...options.before);
  run(engine, sketch('b', XY), circle('b', 'o', 30, 8 - 10 * Math.cos(Math.PI / 4), 10), extrude('B', 'b', [['o']], 20, 'add'));
  if (options.holes?.length) run(engine, sketch('q', XY), ...options.holes.map(([x, y], i) => circle('q', `n${i}`, x, y, 0.25)), extrude('N', 'q', options.holes.map((_, i) => [`n${i}`]), { type: 'throughAll', side: 'both' }, 'cut'));
  return engine;
}
const GROOVE: EdgeName = { a: side('G', 'gl1'), b: side('G', 'gl2') };

test('R10: acute corners: the profile reaches into C long before the end vertex', () => {
  console.log('\nR10: a wedge edge of 10° into a hole, a groove of 10° into a boss (crossing 45°); obstacles where the profile reaches C early');
  console.log('tol | case | blend | outcome | taken or added: run-out, reference | refs');
  for (const tolerance of [0.01, 0.05]) {
    for (const [kind, size] of [['fillet', 1], ['fillet', 0.5], ['chamfer', 1]] as [BlendKind, number][]) {
      const setback = kind === 'fillet' ? size / Math.tan((5 * Math.PI) / 180) : size;
      // convex: the wedge alone, then with pins where the hole begins at 0.7 of the setback
      const yc = WEDGE_HOLE * Math.cos(Math.PI / 4);
      const yp = 0.7 * setback;
      const xs = 30 - Math.sqrt(WEDGE_HOLE ** 2 - (yp - yc) ** 2);
      const pins: V2[] = [[xs + 0.4, yp], [60 - xs - 0.4, yp]];
      expect(WEDGE_HOLE - Math.hypot(pins[0][0] - 30, yp - yc)).toBeGreaterThan(0.25);
      const before4 = 30 - WEDGE_HOLE * Math.sin(Math.PI / 4) - pins[0][0]; // how far before the end vertex the pin stands
      for (const withPins of [false, true]) {
        const engine = acuteWedge(tolerance, { pins: withPins ? pins : [] });
        const result = blendWithRunOuts(engine.getState(), 'E', ACUTE, kind, size, tolerance);
        note(result);
        const before = engine.getState().evaluation.bodies.E.volume;
        const ref = reference(() => acuteWedge(tolerance, { before: [blendFeature(kind, 'C', 'E', [ACUTE], size)], pins: withPins ? pins : [] }), 'E');
        console.log(`${tolerance} | wedge${withPins ? ` + pins ${f3(before4)} before the end` : ''} | ${kind} ${size} | ${line(result)} | ${result.taken === undefined ? '-' : f3(result.taken)}, ${typeof ref === 'number' ? f3(before - ref) : ref} | ${JSON.stringify(result.refs)}`);
        if (withPins && kind === 'fillet') expect([result.outcome, result.refs]).toEqual(['void', [side('H', 'c')]]);
        else if (!withPins) {
          expect(result.outcome).toBe('ok');
          expect(relative(result.taken, before - (ref as number))).toBeLessThan(REFERENCE_BOUND);
        } else expect(['ok', 'void']).toContain(result.outcome);
      }
      if (kind === 'chamfer') continue;
      // concave: the groove alone, then with holes drilled into the boss
      const grooveSize = size * 0.3;
      const yh = 8 - 0.7 * (grooveSize / Math.tan((5 * Math.PI) / 180)) * Math.cos((5 * Math.PI) / 180);
      const yb = 8 - 10 * Math.cos(Math.PI / 4);
      const xb = 30 - Math.sqrt(100 - (yh - yb) ** 2);
      const holes: V2[] = [[xb + 0.45, yh], [60 - xb - 0.45, yh]];
      expect(10 - Math.hypot(holes[0][0] - 30, yh - yb)).toBeGreaterThan(0.3);
      for (const withHoles of [false, true]) {
        const engine = acuteGroove(tolerance, { holes: withHoles ? holes : [] });
        const result = blendWithRunOuts(engine.getState(), 'E', GROOVE, kind, grooveSize, tolerance);
        note(result);
        const before = engine.getState().evaluation.bodies.E.volume;
        const ref = reference(() => acuteGroove(tolerance, { before: [blendFeature(kind, 'C', 'E', [GROOVE], grooveSize)], holes: withHoles ? holes : [] }), 'E');
        console.log(`${tolerance} | groove${withHoles ? ' + holes' : ''} | ${kind} ${grooveSize} | ${line(result)} | ${result.taken === undefined ? '-' : f3(-result.taken)}, ${typeof ref === 'number' ? f3(ref - before) : ref} | ${JSON.stringify(result.refs)}`);
        if (withHoles) expect([result.outcome, result.refs]).toEqual(['void', [side('B', 'o')]]);
        else {
          expect(result.outcome).toBe('ok');
          expect(relative(-(result.taken as number), (ref as number) - before)).toBeLessThan(REFERENCE_BOUND);
        }
      }
    }
  }
});

// ---------------------------------------------------------------- R11: the polygon of the region

test('R11: the region beyond a large cylinder: an obstacle between the old 256-gon and the offset cylinder', () => {
  // a cylinder r 500 about Z, beyond its inside, at the chord tolerance 0.01: the offset cylinder
  // r 500 − 0.025; a cube 0.02 thick at the middle of a side of the 256-gon, between its chord
  // (at 499.937) and r 499.96, so 0.015 inside the offset cylinder
  const tolerance = 0.01;
  const face: EndFace = { kind: 'cylinder', o: [0, 0, 0], a: [0, 0, 1], r: 500, beyondInside: true };
  const offset = 0.025;
  const f1 = anyAcross(face.a);
  const f2 = cross(face.a, f1);
  const phi = Math.PI / VOID_SIDES_OLD;
  const radial = add(mul(f1, Math.cos(phi)), mul(f2, Math.sin(phi)));
  const tangent = add(mul(f1, -Math.sin(phi)), mul(f2, Math.cos(phi)));
  const square: V2[] = [[499.94, -0.01], [499.96, -0.01], [499.96, 0.01], [499.94, 0.01]];
  const ring = (z: number): V3[] => square.map(([u, v]) => add(add(mul(radial, u), mul(tangent, v)), [0, 0, z]));
  const cube = sweep(square, [ring(-0.5), ring(0.5)], 90000);
  const middle = mul(radial, 499.95);
  const sides = regionSides(500 - offset, tolerance) as number;
  const found = (n: number): number => {
    const part = kernel.boolean('intersection', cube, beyondRegion(face, offset, middle, 2, n));
    return part.triangles.length ? volumeOf(part) : 0;
  };
  const [budgeted, old] = [found(sides), found(VOID_SIDES_OLD)];
  const sagitta = (n: number): number => (500 - offset) * (1 - Math.cos(Math.PI / n));
  console.log(`\nR11: the polygon of the region at r 500, tol 0.01: ${sides} sides (sagitta ${sagitta(sides).toExponential(2)} mm) finds ${budgeted.toExponential(2)} mm³; 256 sides (sagitta ${sagitta(VOID_SIDES_OLD).toExponential(2)} mm) find ${old.toExponential(2)} mm³; at r 100 000 and tol 0.001 the budget needs more than 4 096 sides: ${regionSides(1e5, 0.001) === undefined ? 'refused' : 'taken'}`);
  expect(sagitta(sides)).toBeLessThanOrEqual(tolerance / 4);
  expect(budgeted).toBeGreaterThan(5e-5);
  expect(old).toBe(0);
  expect(regionSides(1e5, 0.001)).toBeUndefined();
});

// The pocket cases of R8 for a seed, replayed without building the others.
function pocketCases(seed: number, count: number): { i: number; n: number; at: number; r: number; kind: BlendKind; size: number; tolerance: number }[] {
  const rnd = random(seed);
  const tolerances = [0.01, 0.05, 0.001];
  const out: { i: number; n: number; at: number; r: number; kind: BlendKind; size: number; tolerance: number }[] = [];
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 6; k++) rnd();
    const n = 3 + Math.floor(17 * rnd());
    const at = 29.5 + (rnd() * 2 - 1);
    const r = Math.min(1 + 3 * rnd(), 0.45 * ((TWO_PI * at) / n));
    if (Math.abs(at - 29.5) >= r - 0.2) continue;
    const kind: BlendKind = rnd() < 0.5 ? 'chamfer' : 'fillet';
    out.push({ i, n, at, r, kind, size: Number((0.2 + 1.3 * rnd()).toFixed(3)), tolerance: tolerances[i % 3] });
  }
  return out;
}

test('R9: pinned: the cases of R8 where the kernel refused a boolean of the void check', () => {
  // seed 1: a fillet of 1.413 at 0.001 (the extension cut to the region first: a folded triangle);
  // seed 7: chamfers of 0.54 and 0.828 at 0.05 (the part past the end starting where the profile
  // first reaches C, too near C's polygon: a folded triangle)
  const cases = [
    ...pocketCases(1, 40).filter((c) => c.n === 9 && c.size === 1.413),
    ...pocketCases(7, 60).filter((c) => (c.n === 15 && c.size === 0.54) || (c.n === 11 && c.size === 0.828)),
  ];
  expect(cases.length).toBe(3);
  for (const c of cases) {
    const engine = housing(c.tolerance, c.n, c.r, c.at);
    const result = blendWithRunOuts(engine.getState(), 'E', RIM, c.kind, c.size, c.tolerance);
    const ref = reference(() => housing(c.tolerance, c.n, c.r, c.at, { before: [blendFeature(c.kind, 'C', 'E', [RIM], c.size)] }), 'E');
    console.log('R9:', JSON.stringify(c), line(result), result.taken, typeof ref === 'number' ? engine.getState().evaluation.bodies.E.volume - ref : ref);
    expect(result.outcome).toBe('ok');
    if (typeof ref === 'number') expect(relative(result.taken, engine.getState().evaluation.bodies.E.volume - ref)).toBeLessThan(REFERENCE_BOUND);
  }
});

