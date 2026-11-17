// A body moved outwards by a clearance (D56): every face along its own surface, the vertices where
// the moved surfaces of their faces meet, the planar faces triangulated again, and the checks that
// the shape of the body did not change. The design is docs/d36/3d-body-boolean/design.md, "The
// clearance" and "The moved tool".
import { closestOnTriangle } from '../mesh-distance';
import type { FaceInfo } from '../solid';
import type { FaceName, Solid, SolidKernel, Vec3 } from '../types';
import { add3, cross3, dot3, faceKey, len3, mul3, sub3, unit3 } from '../util';
import { precisionOf, triangleGrid } from './body-boolean';

// The share of the clearance a point of the moved surface may lack against the face it came from
// and the faces next to that one, when one of the two is round, on top of the chord tolerance.
// A vertex on an edge of a round face and another face moves to where the two moved surfaces meet,
// which is along the round face when the two meet at a slant; the sides of the polygon of the round
// face then span a wider angle than the chord tolerance gave them.
export const ROUND_ALLOWANCE = 0.15;
// A clearance under this many precisions of the coordinates cannot be told from none.
export const SMALLEST_CLEARANCE = 10;
// ... and, for a body with a face that is not planar, more than this many chord tolerances of the
// document (revision after the verification): the bound of a round face, c (1 − ROUND_ALLOWANCE)
// less the chord tolerance, is then more than 0.35 c; it is nothing below 1.18 chord tolerances.
export const CHORDS_PER_CLEARANCE = 2;
// Two surfaces cross where their normals are at least this far apart (the sine of 1°).
const CROSSING = Math.sin(Math.PI / 180);

// The body with every face moved: the vertices moved, less those the move passes over; the
// triangles of round faces as they were, the planar faces triangulated again. The face numbers are
// those of the body, but for a carried face without extent, whose triangles take the number of
// one of the two faces it lies on. `infos`: the moved description of every face that has
// triangles, by its number.
export interface MovedBody {
  solid: Solid;
  infos: ReadonlyMap<number, FaceInfo>;
}
// Why a body cannot be moved (design.md, the contract's `MoveProblem`).
export interface MoveProblem {
  reason: 'noSurface' | 'bothSides' | 'closes' | 'vertex' | 'outline' | 'turned' | 'crosses' | 'tooNear' | 'tooSmall';
  faces: FaceName[];
  detail: string;
}
export const isMoveProblem = (moved: MovedBody | MoveProblem): moved is MoveProblem => 'reason' in moved;

// Kept by the identity of the solid, the clearance and the chord tolerance (the face table does not
// change for numbers that exist, as `analyzeBody` relies on too); the last few of each solid only,
// so that a sweep of the clearance in previews does not keep a moved mesh per value.
const memo = new WeakMap<Solid, Map<string, MovedBody | MoveProblem>>();
const KEPT_PER_SOLID = 4;

export function movedOutwards(body: Solid, faceInfos: readonly FaceInfo[], faceNames: readonly FaceName[], clearance: number, chordTolerance: number, kernel: Pick<SolidKernel, 'triangulate'>): MovedBody | MoveProblem {
  const key = `${clearance}|${chordTolerance}`;
  let kept = memo.get(body);
  const known = kept?.get(key);
  if (known) return known;
  const moved = move(body, faceInfos, faceNames, clearance, chordTolerance, kernel);
  if (!kept) memo.set(body, (kept = new Map()));
  kept.set(key, moved);
  if (kept.size > KEPT_PER_SOLID) kept.delete(kept.keys().next().value as string);
  return moved;
}

type Triangle = [Vec3, Vec3, Vec3];
const normalOf = (v: Triangle): Vec3 => cross3(sub3(v[1], v[0]), sub3(v[2], v[0]));
// The width of a triangle: twice its area over its longest side.
const widthOf = (v: Triangle): number => len3(normalOf(v)) / Math.max(len3(sub3(v[1], v[0])), len3(sub3(v[2], v[1])), len3(sub3(v[0], v[2])), 1e-300);
const centroidOf = (v: Triangle): Vec3 => mul3(add3(add3(v[0], v[1]), v[2]), 1 / 3);

// The signed distance of a point from an exact surface, positive on the side `side` (+1 the side
// its normal or radius points to), and the unit normal on that side. Undefined on the axis of
// a cylinder or a cone, at the centre of a sphere, and for a swept face, which has no single
// surface. A sphere (D58): from its centre. A torus (D58): from the centre of its tube in the half
// plane of the point, at the signed major radius; a point on the axis (the tip of an ogive, within
// the precision of float32) has the same distance in every half plane and moves along the axis
// only, so its row is the derivative of the distance along the axis (not of unit length).
function surfaceAt(info: FaceInfo, side: number, p: Vec3): { distance: number; normal: Vec3 } | undefined {
  if (info.planar) {
    const n = unit3(info.normal);
    return { distance: side * dot3(sub3(p, info.origin), n), normal: mul3(n, side) };
  }
  if (info.surface === 'cylinder') {
    const a = unit3(info.axis);
    const rel = sub3(p, info.center);
    const radial = sub3(rel, mul3(a, dot3(rel, a)));
    const r = len3(radial);
    if (r < 1e-12) return undefined;
    return { distance: side * (r - info.radius), normal: mul3(radial, side / r) };
  }
  if (info.surface === 'cone') {
    const a = unit3(info.axis);
    const rel = sub3(p, info.apex);
    const h = dot3(rel, a);
    const radial = sub3(rel, mul3(a, h));
    const r = len3(radial);
    if (r < 1e-12) return undefined;
    const [cos, sin] = [Math.cos(info.halfAngle), Math.sin(info.halfAngle)];
    return { distance: side * (r * cos - h * sin), normal: mul3(sub3(mul3(radial, cos / r), mul3(a, sin)), side) };
  }
  if (info.surface === 'sphere') {
    const rel = sub3(p, info.center);
    const r = len3(rel);
    if (r < 1e-12) return undefined;
    return { distance: side * (r - info.radius), normal: mul3(rel, side / r) };
  }
  if (info.surface === 'torus') {
    const a = unit3(info.axis);
    const rel = sub3(p, info.center);
    const h = dot3(rel, a);
    const radial = sub3(rel, mul3(a, h));
    const rho = len3(radial);
    const R = info.majorRadius;
    if (rho <= 1e-5 * Math.max(1, len3(p))) {
      const reach = Math.hypot(R, h);
      if (reach < 1e-12) return undefined;
      return { distance: side * (reach - info.minorRadius), normal: mul3(a, (side * h) / reach) };
    }
    const w = sub3(rel, mul3(radial, R / rho)); // from the centre of the tube in this half plane
    const r = len3(w);
    if (r < 1e-12) return undefined;
    return { distance: side * (r - info.minorRadius), normal: mul3(w, side / r) };
  }
  return undefined;
}

// The description of a face moved by `c` to the side `side`.
function movedInfo(info: FaceInfo, side: number, c: number): FaceInfo {
  if (info.planar) return { ...info, origin: add3(info.origin, mul3(unit3(info.normal), side * c)) };
  if (info.surface === 'cylinder') return { ...info, radius: info.radius + side * c };
  if (info.surface === 'cone') return { ...info, apex: add3(info.apex, mul3(unit3(info.axis), (-side * c) / Math.sin(info.halfAngle))) };
  // D58: the radius of a sphere and the minor radius of a torus; the centre of the tube stays
  if (info.surface === 'sphere') return { ...info, radius: info.radius + side * c };
  if (info.surface === 'torus') return { ...info, minorRadius: info.minorRadius + side * c };
  return info;
}

// The shortest move d with n_i · d = r_i for every row, in an orthonormal basis of the normals (as
// `minimalShift` of the kernel adapter): up to three independent conditions are met exactly, and
// a condition that depends on others is met in the least squares.
function minimalShift(rows: { n: Vec3; r: number }[]): Vec3 {
  const basis: Vec3[] = [];
  for (const { n } of rows) {
    let v = n;
    for (const e of basis) v = sub3(v, mul3(e, dot3(v, e)));
    if (len3(v) > 1e-3) basis.push(unit3(v));
    if (basis.length === 3) break;
  }
  const k = basis.length;
  const g = Array.from({ length: k }, () => Array<number>(k + 1).fill(0));
  for (const { n, r } of rows) {
    const a = basis.map((e) => dot3(n, e));
    for (let p = 0; p < k; p++) {
      g[p][k] += a[p] * r;
      for (let q = 0; q < k; q++) g[p][q] += a[p] * a[q];
    }
  }
  for (let c = 0; c < k; c++) {
    let pivot = c;
    for (let p = c + 1; p < k; p++) if (Math.abs(g[p][c]) > Math.abs(g[pivot][c])) pivot = p;
    [g[c], g[pivot]] = [g[pivot], g[c]];
    for (let p = 0; p < k; p++) {
      if (p === c) continue;
      const m = g[p][c] / g[c][c];
      for (let q = c; q <= k; q++) g[p][q] -= m * g[c][q];
    }
  }
  let d: Vec3 = [0, 0, 0];
  for (let c = 0; c < k; c++) d = add3(d, mul3(basis[c], g[c][k] / g[c][c]));
  return d;
}

function move(solid: Solid, infos: readonly FaceInfo[], names: readonly FaceName[], c: number, chord: number, kernel: Pick<SolidKernel, 'triangulate'>): MovedBody | MoveProblem {
  const p = solid.positions;
  const tri = solid.triangles;
  const count = tri.length / 3;
  const vertexCount = p.length / 3;
  const precision = precisionOf(solid);
  const problem = (reason: MoveProblem['reason'], faces: Iterable<number>, detail: string): MoveProblem => ({ reason, faces: [...new Set(faces)].sort((a, b) => a - b).map((face) => names[face]), detail });
  const label = (face: number): string => {
    const name = names[face];
    return name ? faceKey(name) : `face ${face}`;
  };
  if (!(c >= SMALLEST_CLEARANCE * precision)) return problem('tooSmall', [], `a clearance of ${c} mm is under ten precisions of the coordinates (${(SMALLEST_CLEARANCE * precision).toPrecision(2)} mm), which cannot be told from none`);
  // On a round face the pocket may be nearer than the clearance by the chord tolerance and a share
  // of the clearance; at a clearance of twice the chord tolerance or less that leaves nothing.
  if (!(c > CHORDS_PER_CLEARANCE * chord) && [...new Set(solid.faceIds)].some((face) => infos[face] !== undefined && !infos[face].planar)) return problem('tooSmall', [], `a clearance of ${c} mm is not more than twice the chord tolerance of the document (${chord} mm), and the round faces of the body are polygons that coarse`);
  const corners = (pos: ArrayLike<number>, t: number): Triangle => [0, 1, 2].map((k): Vec3 => [pos[3 * tri[3 * t + k]], pos[3 * tri[3 * t + k] + 1], pos[3 * tri[3 * t + k] + 2]]) as Triangle;
  const faces = [...new Set(solid.faceIds)].sort((a, b) => a - b);
  const missing = faces.filter((face) => infos[face] === undefined);
  if (missing.length) return problem('noSurface', missing, 'a face has no exact surface to move along');
  const swept = (face: number): boolean => {
    const info = infos[face];
    return !info.planar && info.surface === 'swept';
  };

  // Narrow faces: every triangle narrower than the chord tolerance.
  const widest = new Map<number, number>();
  for (let t = 0; t < count; t++) widest.set(solid.faceIds[t], Math.max(widest.get(solid.faceIds[t]) ?? 0, widthOf(corners(p, t))));
  const narrow = new Set(faces.filter((face) => (widest.get(face) ?? 0) < chord));

  // 1. The side of its surface the material of a face is on, and a face whose triangles disagree.
  const sums = new Map<number, number>();
  const total = new Map<number, number>();
  const against = new Map<number, number>();
  const sideOfTriangle: number[] = [];
  for (let t = 0; t < count; t++) {
    const face = solid.faceIds[t];
    if (swept(face)) continue;
    const v = corners(p, t);
    const here = surfaceAt(infos[face], 1, centroidOf(v));
    if (!here) continue;
    const along = dot3(normalOf(v), here.normal);
    sums.set(face, (sums.get(face) ?? 0) + along);
    sideOfTriangle[t] = Math.sign(along);
  }
  const sides = new Map([...sums].map(([face, sum]) => [face, sum >= 0 ? 1 : -1]));
  for (let t = 0; t < count; t++) {
    const face = solid.faceIds[t];
    if (narrow.has(face) || !sides.has(face) || sideOfTriangle[t] === undefined) continue;
    const v = corners(p, t);
    if (widthOf(v) < chord * 1e-3) continue;
    const area = len3(normalOf(v)) / 2;
    total.set(face, (total.get(face) ?? 0) + area);
    if (sideOfTriangle[t] * (sides.get(face) as number) < 0) against.set(face, (against.get(face) ?? 0) + area);
  }
  const both = [...against].filter(([face, area]) => area > 1e-6 * (total.get(face) as number)).map(([face]) => face);
  if (both.length) return problem('bothSides', both, `material lies on both sides of ${both.map(label).join(', ')}, so the face has no single way outwards`);
  // a hole, a socket or a groove whose radius the clearance takes away; a ring whose hole it fills
  const closing = [...sides].filter(([face, side]) => {
    const info = infos[face];
    if (info.planar) return false;
    if (info.surface === 'cylinder' || info.surface === 'sphere') return side < 0 && info.radius <= c;
    if (info.surface === 'torus') return side < 0 ? info.minorRadius <= c : info.majorRadius > 0 && info.majorRadius - info.minorRadius - c <= 0;
    return false;
  });
  const radiusOf = (info: FaceInfo): number => (info.planar ? 0 : info.surface === 'cylinder' || info.surface === 'sphere' ? info.radius : info.surface === 'torus' ? info.minorRadius : 0);
  if (closing.length) return problem('closes', closing.map(([face]) => face), `a hole of radius ${closing.map(([face]) => radiusOf(infos[face])).join(', ')} mm closes at a clearance of ${c} mm`);

  // 2. The vertices: each to where the moved surfaces of its faces meet.
  const conditions = new Map<number, { face?: number; n: Vec3 }[]>();
  const push = (vertex: number, face: number | undefined, n: Vec3): void => {
    let list = conditions.get(vertex);
    if (!list) conditions.set(vertex, (list = []));
    if (face !== undefined ? !list.some((item) => item.face === face) : !list.some((item) => item.face === undefined && dot3(item.n, n) > 1 - 1e-9)) list.push({ face, n });
  };
  for (let t = 0; t < count; t++) {
    const face = solid.faceIds[t];
    const v = corners(p, t);
    const normal = normalOf(v);
    for (let k = 0; k < 3; k++) {
      if (sides.has(face)) push(tri[3 * t + k], face, [0, 0, 0]);
      // a triangle of a swept face moves along its own normal; a sliver's normal is noise
      else if (widthOf(v) >= chord * 1e-3 && len3(normal) > 0) push(tri[3 * t + k], undefined, unit3(normal));
    }
  }
  const positions = new Float32Array(p.length);
  const carried = new Set<number>();
  const failing = new Set<number>();
  let worst = 0;
  for (let i = 0; i < vertexCount; i++) {
    const from: Vec3 = [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
    const list = conditions.get(i);
    if (!list) {
      positions.set(from, 3 * i);
      continue;
    }
    let used = list;
    let q = from;
    const rowsAt = (point: Vec3): { n: Vec3; r: number }[] => {
      const rows: { n: Vec3; r: number }[] = [];
      for (const condition of used) {
        if (condition.face === undefined) rows.push({ n: condition.n, r: c - dot3(sub3(point, from), condition.n) });
        else {
          const here = surfaceAt(infos[condition.face], sides.get(condition.face) as number, point);
          if (here) rows.push({ n: here.normal, r: c - here.distance });
        }
      }
      return rows;
    };
    const solve = (): number => {
      q = from;
      for (let pass = 0; pass < 8; pass++) {
        const d = minimalShift(rowsAt(q));
        q = add3(q, d);
        if (len3(d) < 1e-10) break;
      }
      return Math.max(0, ...rowsAt(q).map((row) => Math.abs(row.r)));
    };
    let residual = solve();
    // A narrow face that has no extent in the exact shape (the crescent between two polygons of one
    // circle) gives a vertex a condition it cannot keep; dropped at such a vertex, the face is
    // carried along by its neighbours there.
    if (residual > 1e-4 && list.some((item) => item.face !== undefined && narrow.has(item.face))) {
      const dropped = list.filter((item) => item.face !== undefined && narrow.has(item.face));
      used = list.filter((item) => !dropped.includes(item));
      const again = solve();
      if (again <= 1e-4) {
        residual = again;
        for (const item of dropped) carried.add(item.face as number);
      } else {
        used = list;
        residual = solve();
      }
    }
    if (residual > 1e-4) {
      for (const item of list) if (item.face !== undefined) failing.add(item.face);
      worst = Math.max(worst, residual);
    }
    positions.set(q, 3 * i);
  }
  if (failing.size) return problem('vertex', failing, `a vertex cannot lie on all the moved surfaces of its faces (off by ${worst.toPrecision(2)} mm)`);
  const moved3 = (i: number): Vec3 => [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
  const at = (i: number): Vec3 => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];

  // Passed-over vertices. Where a round face meets another face at a slant, the vertex at the end
  // of their common edge slides along it by more than the clearance and may pass the next vertex of
  // the polygon of the round face: the edge between the two turns round. The vertex passed over
  // lies on faces that are all faces of the other one (it is on the curve the other one ends), so
  // the part of the polygon between them has no extent in the moved shape: the edge is collapsed
  // into the vertex with more faces; a flap the collapse folds flat (a triangle and its own copy
  // turned the other way) goes with it. At most one collapse in the neighbourhood of a vertex per
  // pass, repeated until no such edge is left. Whether the result is still one closed surface is
  // checked afterwards (step 4: every edge twice, one fan of triangles round every vertex), and a
  // face that loses every triangle is a change of the shape and refused.
  const facesOf = new Map<number, Set<number>>();
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      const vertex = tri[3 * t + k];
      let set = facesOf.get(vertex);
      if (!set) facesOf.set(vertex, (set = new Set()));
      set.add(solid.faceIds[t]);
    }
  }
  const within = (small: Set<number>, large: Set<number>): boolean => small.size < large.size && [...small].every((face) => large.has(face));
  let current = Uint32Array.from(tri);
  let currentFaces = Uint32Array.from(solid.faceIds);
  let reshaped = new Uint8Array(count); // the triangles whose vertices a collapse changed
  const droppedVertices = new Set<number>();
  for (let pass = 0; pass < vertexCount; pass++) {
    const triangleCount = current.length / 3;
    const across = new Map<number, number[]>(); // an undirected edge → its triangles
    const neighbours = new Map<number, Set<number>>();
    for (let t = 0; t < triangleCount; t++) {
      for (let k = 0; k < 3; k++) {
        const [u, w] = [current[3 * t + k], current[3 * t + ((k + 1) % 3)]];
        const key = Math.min(u, w) * vertexCount + Math.max(u, w);
        const list = across.get(key);
        if (list) list.push(t);
        else across.set(key, [t]);
        for (const [x, y] of [[u, w], [w, u]]) {
          let set = neighbours.get(x);
          if (!set) neighbours.set(x, (set = new Set()));
          set.add(y);
        }
      }
    }
    const alias = new Map<number, number>();
    const locked = new Set<number>();
    for (const [key, list] of across) {
      const [u, w] = [Math.floor(key / vertexCount), key % vertexCount];
      if (list.length !== 2 || locked.has(u) || locked.has(w)) continue;
      if (dot3(sub3(moved3(w), moved3(u)), sub3(at(w), at(u))) >= 0) continue;
      const [fu, fw] = [facesOf.get(u) as Set<number>, facesOf.get(w) as Set<number>];
      const [drop, keep] = within(fu, fw) ? [u, w] : within(fw, fu) ? [w, u] : [-1, -1];
      if (drop < 0) continue;
      alias.set(drop, keep);
      droppedVertices.add(drop);
      for (const vertex of [u, w, ...(neighbours.get(u) as Set<number>), ...(neighbours.get(w) as Set<number>)]) locked.add(vertex);
    }
    if (alias.size === 0) break;
    const kept: number[] = [];
    const keptFaces: number[] = [];
    const keptReshaped: number[] = [];
    const flaps = new Map<string, number>();
    for (let t = 0; t < triangleCount; t++) {
      const [i, j, l] = [0, 1, 2].map((k) => alias.get(current[3 * t + k]) ?? current[3 * t + k]);
      if (i === j || j === l || l === i) continue;
      // a triangle that meets its own copy turned the other way is a flap the collapse folded flat:
      // both go
      const key = [i, j, l].sort((x, y) => x - y).join(',');
      const twin = flaps.get(key);
      if (twin !== undefined && kept[3 * twin] !== -1) {
        kept[3 * twin] = -1;
        continue;
      }
      flaps.set(key, kept.length / 3);
      kept.push(i, j, l);
      keptFaces.push(currentFaces[t]);
      keptReshaped.push(reshaped[t] || [0, 1, 2].some((k) => alias.has(current[3 * t + k])) ? 1 : 0);
    }
    const alive = Array.from({ length: kept.length / 3 }, (_, t) => t).filter((t) => kept[3 * t] !== -1);
    current = Uint32Array.from(alive.flatMap((t) => kept.slice(3 * t, 3 * t + 3)));
    currentFaces = Uint32Array.from(alive.map((t) => keptFaces[t]));
    reshaped = Uint8Array.from(alive.map((t) => keptReshaped[t]));
  }
  // a collapse drops only the vertex passed over; one that went with a flap (a vertex of three
  // triangles next to both ends of the edge) is passed over too when a kept vertex within the
  // clearance of it lies on all its faces and more; any other changed the shape
  {
    const used = new Set(current);
    const passed = (vertex: number): boolean => {
      const own = facesOf.get(vertex) as Set<number>;
      return [...used].some((other) => within(own, facesOf.get(other) as Set<number>) && len3(sub3(moved3(other), moved3(vertex))) <= c);
    };
    const lost = [...new Set(tri)].find((vertex) => !used.has(vertex) && !droppedVertices.has(vertex) && !passed(vertex));
    if (lost !== undefined) return problem('vertex', [...(facesOf.get(lost) as Set<number>)], 'a vertex of the tool would vanish as the vertices of the moved faces pass each other');
  }
  const vanished = faces.filter((face) => !currentFaces.includes(face));
  if (vanished.length) return problem('vertex', vanished, `${vanished.map(label).join(', ')} would vanish as the vertices of the moved faces pass each other`);
  const live = current.length / 3;
  const cornersAt = (pos: ArrayLike<number>, t: number): Triangle => [0, 1, 2].map((k): Vec3 => [pos[3 * current[3 * t + k]], pos[3 * current[3 * t + k] + 1], pos[3 * current[3 * t + k] + 2]]) as Triangle;

  // A carried face lies on its moved surface within the chord tolerance at every one of its
  // vertices, but for a face without extent: every vertex of it lies, within the chord tolerance,
  // on its own surface and on those of two other faces that cross there (their normals at least 1°
  // apart), so the face is a polygon of the curve the three share (the crescent between the
  // polygons of a cone and of a bore that ends on its circle), or a real face narrower than the
  // chord tolerance, which the mesh cannot tell from one. Such a face is no face of the moved
  // shape: its triangles are given to the nearer of the two others and it has no moved
  // description. Two faces that do not cross (a riser between two parallel planes, a ring between
  // two coaxial cylinders) never exempt it.
  const onCurve = chord;
  const exempt = new Map<number, [number, number]>();
  for (const face of carried) {
    const vertices = new Set<number>();
    for (let t = 0; t < live; t++) if (currentFaces[t] === face) for (let k = 0; k < 3; k++) vertices.add(current[3 * t + k]);
    const others = new Set<number>();
    for (const vertex of vertices) for (const other of facesOf.get(vertex) ?? []) if (other !== face && !swept(other) && !carried.has(other)) others.add(other);
    const on = (which: number, vertex: number): Vec3 | undefined => {
      const here = surfaceAt(infos[which], 1, at(vertex));
      return here !== undefined && Math.abs(here.distance) <= onCurve ? here.normal : undefined;
    };
    const shared = (g: number, h: number): boolean =>
      [...vertices].every((vertex) => {
        const [own, ng, nh] = [on(face, vertex), on(g, vertex), on(h, vertex)];
        return own !== undefined && ng !== undefined && nh !== undefined && len3(cross3(ng, nh)) >= CROSSING;
      });
    const list = [...others];
    const pair = list.flatMap((g, i) => list.slice(i + 1).map((h): [number, number] => [g, h])).find(([g, h]) => shared(g, h));
    if (pair) {
      exempt.set(face, pair);
      continue;
    }
    for (const vertex of vertices) {
      const here = surfaceAt(infos[face], sides.get(face) as number, moved3(vertex));
      if (here && Math.abs(here.distance - c) > chord) return problem('vertex', [face], `the narrow face ${label(face)} ends ${Math.abs(here.distance - c).toPrecision(2)} mm off its moved surface, more than the chord tolerance`);
    }
  }
  const ownFaces = Uint32Array.from(currentFaces); // the face a triangle came from, before an exempt one is given away
  for (let t = 0; t < live; t++) {
    const pair = exempt.get(currentFaces[t]);
    if (!pair) continue;
    const centroid = centroidOf(cornersAt(positions, t));
    const off = (which: number): number => Math.abs((surfaceAt(infos[which], sides.get(which) as number, centroid)?.distance ?? Infinity) - c);
    currentFaces[t] = off(pair[0]) <= off(pair[1]) ? pair[0] : pair[1];
  }

  // 3. Planar faces triangulated again from their moved outline (but a carried face).
  const triangles: number[] = [];
  const faceIds: number[] = [];
  const source: number[] = []; // the triangle of before a triangle is; -1 for one made again
  const byFace = new Map<number, number[]>();
  for (let t = 0; t < live; t++) {
    const list = byFace.get(currentFaces[t]);
    if (list) list.push(t);
    else byFace.set(currentFaces[t], [t]);
  }
  for (const [face, list] of byFace) {
    const info = infos[face];
    if (!info.planar || carried.has(face)) {
      for (const t of list) {
        triangles.push(current[3 * t], current[3 * t + 1], current[3 * t + 2]);
        faceIds.push(face);
        source.push(t);
      }
      continue;
    }
    // the outline: the directed edges of the face that have no opposite in it, chained into loops
    const inFace = new Set<number>();
    for (const t of list) for (let k = 0; k < 3; k++) inFace.add(current[3 * t + k] * vertexCount + current[3 * t + ((k + 1) % 3)]);
    const next = new Map<number, number[]>();
    for (const t of list) {
      for (let k = 0; k < 3; k++) {
        const [a, b] = [current[3 * t + k], current[3 * t + ((k + 1) % 3)]];
        if (inFace.has(b * vertexCount + a)) continue;
        const out = next.get(a);
        if (out) out.push(b);
        else next.set(a, [b]);
      }
    }
    const loops: number[][] = [];
    let broken = false;
    while (next.size && !broken) {
      const start = next.keys().next().value as number;
      const loop: number[] = [];
      let vertex = start;
      for (;;) {
        loop.push(vertex);
        const out = next.get(vertex);
        if (!out || out.length === 0) {
          broken = true;
          break;
        }
        const to = out.shift() as number; // where the outline touches itself the first way out is taken
        if (out.length === 0) next.delete(vertex);
        vertex = to;
        if (vertex === start) break;
      }
      loops.push(loop);
    }
    if (broken) return problem('outline', [face], `the outline of ${label(face)} is not a set of closed loops`);
    const n = mul3(unit3(info.normal), sides.get(face) ?? 1);
    const x = unit3(Math.abs(n[0]) < 0.9 ? cross3(n, [1, 0, 0]) : cross3(n, [0, 1, 0]));
    const y = cross3(n, x);
    const flatten = (i: number): [number, number] => [dot3(moved3(i), x), dot3(moved3(i), y)];
    if (outlineCrosses(loops, flatten)) return problem('outline', [face], `the moved outline of ${label(face)} crosses itself`);
    let made: Uint32Array;
    try {
      made = kernel.triangulate(loops.map((loop) => Float64Array.from(loop.flatMap(flatten))));
    } catch (error) {
      return problem('outline', [face], `the moved outline of ${label(face)} cannot be triangulated (${error instanceof Error ? error.message : String(error)})`);
    }
    const index = loops.flat();
    for (let i = 0; i < made.length; i += 3) {
      triangles.push(index[made[i]], index[made[i + 1]], index[made[i + 2]]);
      faceIds.push(face);
      source.push(-1);
    }
  }
  const result: Solid = { positions, triangles: Uint32Array.from(triangles), faceIds: Uint32Array.from(faceIds) };

  // 4. The checks. The mesh is a closed surface: every edge twice, once each way, and the triangles
  // around every vertex one fan (a guard of step 3 and of the dropped vertices).
  {
    const directed = new Map<number, number>();
    for (let i = 0; i < triangles.length; i += 3) for (let k = 0; k < 3; k++) directed.set(triangles[i + k] * vertexCount + triangles[i + ((k + 1) % 3)], (directed.get(triangles[i + k] * vertexCount + triangles[i + ((k + 1) % 3)]) ?? 0) + 1);
    const open = new Set<number>();
    for (let i = 0; i < triangles.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const [a, b] = [triangles[i + k], triangles[i + ((k + 1) % 3)]];
        if (directed.get(a * vertexCount + b) !== 1 || directed.get(b * vertexCount + a) !== 1) open.add(faceIds[i / 3]);
      }
    }
    if (open.size) return problem('outline', open, 'the moved mesh is not a closed surface where these faces meet');
    const fans = new Map<number, Map<number, number>>(); // a vertex → (the next vertex of a triangle around it → the one after)
    const facesAt = new Map<number, number>();
    for (let i = 0; i < triangles.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const vertex = triangles[i + k];
        let fan = fans.get(vertex);
        if (!fan) fans.set(vertex, (fan = new Map()));
        fan.set(triangles[i + ((k + 1) % 3)], triangles[i + ((k + 2) % 3)]);
        facesAt.set(vertex, faceIds[i / 3]);
      }
    }
    for (const [vertex, fan] of fans) {
      const start = fan.keys().next().value as number;
      let [next, steps] = [start, 0];
      do {
        next = fan.get(next) as number;
        steps++;
      } while (next !== undefined && next !== start && steps <= fan.size);
      if (next !== start || steps !== fan.size) return problem('vertex', [facesAt.get(vertex) as number], 'the moved mesh is pinched at a vertex where the moved faces pass each other');
    }
  }
  // No triangle of a round, swept or carried face turned over (slivers aside): compared with the
  // same three vertices before the move, or, for a triangle a collapse changed (which had no such
  // vertices), with the normal of the moved surface of the face it came from at its centroid
  // (slivers narrower than the chord tolerance aside).
  const turned = new Set<number>();
  for (let i = 0; i < source.length; i++) {
    const t = source[i];
    if (t < 0) continue;
    const [before, after] = [cornersAt(p, t), cornersAt(positions, t)];
    const [face, own] = [currentFaces[t], ownFaces[t]];
    const bySurface = reshaped[t] === 1 && !swept(own);
    if (bySurface ? widthOf(after) < chord : widthOf(before) < chord * 1e-2 || widthOf(after) < chord * 1e-2) continue;
    const here = bySurface ? surfaceAt(infos[own], sides.get(own) as number, centroidOf(after)) : undefined;
    if (dot3(here ? here.normal : normalOf(before), normalOf(after)) <= 0) turned.add(face);
  }
  if (turned.size) return problem('turned', turned, `triangles of ${[...turned].map(label).join(', ')} turn over: a hole or a gap narrower than twice the clearance`);
  const crossing = edgeThroughTriangle(result);
  if (crossing) return problem('crosses', crossing, `the moved faces ${crossing.map(label).join(' and ')} cross each other`);
  // the face each triangle of the result is measured as: the one it came from (an exempt face
  // stays carried there), or the planar face it was made again for
  const sampleFaces = Uint32Array.from(faceIds.map((face, i) => (source[i] >= 0 ? ownFaces[source[i]] : face)));
  const ownDistance = (face: number, point: Vec3): number | undefined => (infos[face].planar || swept(face) || carried.has(face) ? undefined : surfaceAt(infos[face], sides.get(face) as number, point)?.distance);
  const near = tooNear(solid, result, sampleFaces, infos, c, chord, precision, carried, ownDistance);
  if (near) return problem('tooNear', [near.from, near.to], `the moved ${label(near.from)} comes within ${near.distance.toPrecision(3)} mm of ${label(near.to)}, nearer than the clearance of ${c} mm`);

  // 5. The moved descriptions.
  const moved = new Map<number, FaceInfo>();
  for (const face of faces) if (!exempt.has(face)) moved.set(face, movedInfo(infos[face], sides.get(face) ?? 1, c));
  if (result.faceIds.some((face) => !moved.has(face))) throw new Error('movedOutwards: a face of the moved tool has no moved description');
  return { solid: compact(result), infos: moved };
}

// The same mesh with only the vertices its triangles use (a passed-over vertex is used by none).
function compact(solid: Solid): Solid {
  const index = new Int32Array(solid.positions.length / 3).fill(-1);
  const positions: number[] = [];
  const triangles = solid.triangles.map((vertex) => {
    if (index[vertex] < 0) {
      index[vertex] = positions.length / 3;
      positions.push(solid.positions[3 * vertex], solid.positions[3 * vertex + 1], solid.positions[3 * vertex + 2]);
    }
    return index[vertex];
  });
  return positions.length === solid.positions.length ? solid : { positions: Float32Array.from(positions), triangles, faceIds: solid.faceIds };
}

// Does any segment of the loops cross another (in the plane, properly; neighbours share a point)?
function outlineCrosses(loops: number[][], flat: (vertex: number) => [number, number]): boolean {
  const segments: { a: [number, number]; b: [number, number]; loop: number; at: number }[] = [];
  loops.forEach((loop, l) => loop.forEach((vertex, i) => segments.push({ a: flat(vertex), b: flat(loop[(i + 1) % loop.length]), loop: l, at: i })));
  // sorted by the lower x, so that a segment is compared only with those whose x ranges meet
  segments.sort((s, t) => Math.min(s.a[0], s.b[0]) - Math.min(t.a[0], t.b[0]));
  const orient = (p: [number, number], q: [number, number], r: [number, number]): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const right = Math.max(s.a[0], s.b[0]);
    for (let j = i + 1; j < segments.length; j++) {
      const t = segments[j];
      if (Math.min(t.a[0], t.b[0]) > right) break;
      if (Math.max(s.a[1], s.b[1]) < Math.min(t.a[1], t.b[1]) || Math.max(t.a[1], t.b[1]) < Math.min(s.a[1], s.b[1])) continue;
      if (s.loop === t.loop) {
        const size = loops[s.loop].length;
        if (Math.abs(s.at - t.at) === 1 || Math.abs(s.at - t.at) === size - 1) continue;
      }
      const [d1, d2, d3, d4] = [orient(t.a, t.b, s.a), orient(t.a, t.b, s.b), orient(s.a, s.b, t.a), orient(s.a, s.b, t.b)];
      if (d1 * d2 < 0 && d3 * d4 < 0) return true;
    }
  }
  return false;
}

// An edge of the mesh that goes through a triangle of it (one that shares no vertex with the edge):
// the faces of the two, or undefined. Exact for two faces that cross.
function edgeThroughTriangle(s: Solid): [number, number] | undefined {
  const p = s.positions;
  const count = s.triangles.length / 3;
  const vertexCount = p.length / 3;
  const at = (i: number): Vec3 => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
  const boxes = new Float64Array(6 * count);
  for (let t = 0; t < count; t++) {
    for (let axis = 0; axis < 3; axis++) {
      const values = [0, 1, 2].map((k) => p[3 * s.triangles[3 * t + k] + axis]);
      boxes[6 * t + axis] = Math.min(...values);
      boxes[6 * t + 3 + axis] = Math.max(...values);
    }
  }
  const grid = triangleGrid(boxes, count);
  const seen = new Set<number>();
  let found: [number, number] | undefined;
  for (let t = 0; t < count && !found; t++) {
    for (let k = 0; k < 3 && !found; k++) {
      const [a, b] = [s.triangles[3 * t + k], s.triangles[3 * t + ((k + 1) % 3)]];
      const key = Math.min(a, b) * vertexCount + Math.max(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      const [pa, pb] = [at(a), at(b)];
      const lo: Vec3 = [Math.min(pa[0], pb[0]), Math.min(pa[1], pb[1]), Math.min(pa[2], pb[2])];
      const hi: Vec3 = [Math.max(pa[0], pb[0]), Math.max(pa[1], pb[1]), Math.max(pa[2], pb[2])];
      grid.inBox(lo, hi, (other) => {
        const [i, j, l] = [s.triangles[3 * other], s.triangles[3 * other + 1], s.triangles[3 * other + 2]];
        if (i === a || i === b || j === a || j === b || l === a || l === b) return false;
        for (let axis = 0; axis < 3; axis++) if (hi[axis] < boxes[6 * other + axis] || lo[axis] > boxes[6 * other + 3 + axis]) return false;
        if (!segmentThrough(pa, pb, at(i), at(j), at(l))) return false;
        found = [s.faceIds[t], s.faceIds[other]];
        return true;
      });
    }
  }
  return found;
}

// Does the segment pq pass through the inside of the triangle abc (not along its plane, not
// through its boundary)?
function segmentThrough(pa: Vec3, pb: Vec3, a: Vec3, b: Vec3, c: Vec3): boolean {
  const n = cross3(sub3(b, a), sub3(c, a));
  const [da, db] = [dot3(sub3(pa, a), n), dot3(sub3(pb, a), n)];
  if (!(da * db < 0)) return false;
  const point = add3(pa, mul3(sub3(pb, pa), da / (da - db)));
  const [u, v, w] = [dot3(cross3(sub3(b, a), sub3(point, a)), n), dot3(cross3(sub3(c, b), sub3(point, b)), n), dot3(cross3(sub3(a, c), sub3(point, c)), n)];
  const scale = 1e-9 * dot3(n, n);
  return u > scale && v > scale && w > scale;
}

// A point of the moved surface nearer to the body than the clearance allows (design.md, "The checks
// of the moved tool"): every vertex, the middle of every edge and the centroid of every triangle of
// the moved mesh, against every triangle of the body that shares no vertex with the place the point
// came from. The bound by the pair of faces: c less p; with a round face, the same face or
// neighbours, c (1 − ROUND_ALLOWANCE) less the chord tolerance; with a carried face, c less the
// chord tolerance.
function tooNear(
  body: Solid,
  moved: Solid,
  sampleFaces: Uint32Array,
  infos: readonly FaceInfo[],
  c: number,
  chord: number,
  precision: number,
  carried: ReadonlySet<number>,
  ownDistance: (face: number, point: Vec3) => number | undefined,
): { from: number; to: number; distance: number } | undefined {
  const p = body.positions;
  const tri = body.triangles;
  const count = tri.length / 3;
  const vertexCount = p.length / 3;
  const corner = (t: number, k: number): Vec3 => [p[3 * tri[3 * t + k]], p[3 * tri[3 * t + k] + 1], p[3 * tri[3 * t + k] + 2]];
  const neighbours = new Set<number>();
  const faceCount = body.faceIds.reduce((largest, face) => Math.max(largest, face), 0) + 1;
  {
    const faceOf = new Map<number, number>();
    for (let t = 0; t < count; t++) for (let k = 0; k < 3; k++) faceOf.set(tri[3 * t + k] * vertexCount + tri[3 * t + ((k + 1) % 3)], body.faceIds[t]);
    for (const [edge, face] of faceOf) {
      const other = faceOf.get((edge % vertexCount) * vertexCount + Math.floor(edge / vertexCount));
      if (other !== undefined && other !== face) neighbours.add(Math.min(face, other) * faceCount + Math.max(face, other));
    }
  }
  const round = (face: number): boolean => !infos[face].planar;
  const least = (a: number, b: number): number => {
    let bound = c - precision;
    if ((a === b || neighbours.has(Math.min(a, b) * faceCount + Math.max(a, b))) && (round(a) || round(b))) bound = Math.min(bound, c * (1 - ROUND_ALLOWANCE) - chord);
    if (carried.has(a) || carried.has(b)) bound = Math.min(bound, c - chord);
    return bound;
  };
  const boxes = new Float64Array(6 * count);
  for (let t = 0; t < count; t++) {
    const v = [corner(t, 0), corner(t, 1), corner(t, 2)];
    for (let axis = 0; axis < 3; axis++) {
      boxes[6 * t + axis] = Math.min(v[0][axis], v[1][axis], v[2][axis]) - c;
      boxes[6 * t + 3 + axis] = Math.max(v[0][axis], v[1][axis], v[2][axis]) + c;
    }
  }
  const grid = triangleGrid(boxes, count);
  const q = moved.positions;
  const mt = moved.triangles;
  const done = new Set<number>();
  let found: { from: number; to: number; distance: number } | undefined;
  const sample = (key: number | undefined, point: Vec3, face: number, around: number[]): void => {
    if (key !== undefined) {
      if (done.has(key)) return;
      done.add(key);
    }
    // a point of a round face against the exact surface of that face itself, which the triangles
    // round the point (left out below) would otherwise hide
    const own = ownDistance(face, point);
    if (own !== undefined && own < c * (1 - ROUND_ALLOWANCE) - chord) {
      found = { from: face, to: face, distance: own };
      return;
    }
    grid.near(point, (t) => {
      for (let axis = 0; axis < 3; axis++) if (point[axis] < boxes[6 * t + axis] || point[axis] > boxes[6 * t + 3 + axis]) return false;
      for (let k = 0; k < 3; k++) if (around.includes(tri[3 * t + k])) return false;
      const distance = len3(sub3(point, closestOnTriangle(point, corner(t, 0), corner(t, 1), corner(t, 2))));
      if (distance < least(face, body.faceIds[t])) {
        found = { from: face, to: body.faceIds[t], distance };
        return true;
      }
      return false;
    });
  };
  const at = (i: number): Vec3 => [q[3 * i], q[3 * i + 1], q[3 * i + 2]];
  for (let i = 0; i < mt.length && !found; i += 3) {
    const index = [mt[i], mt[i + 1], mt[i + 2]];
    const v = index.map(at);
    const face = sampleFaces[i / 3];
    for (let k = 0; k < 3 && !found; k++) {
      const next = (k + 1) % 3;
      // a vertex is sampled once per face it is on (the bound depends on the face)
      sample(index[k] * faceCount + face, v[k], face, [index[k]]);
      sample(-(vertexCount * (Math.min(index[k], index[next]) + 1) + Math.max(index[k], index[next])) * faceCount - face - 1, mul3(add3(v[k], v[next]), 0.5), face, [index[k], index[next]]);
    }
    if (!found) sample(undefined, mul3(add3(add3(v[0], v[1]), v[2]), 1 / 3), face, index);
  }
  return found;
}
