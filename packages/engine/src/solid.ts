// Tělesa: stavba sítě extrude, stěny a hrany tělesa, rovina na stěně, promítnutí hrany.
// Pravidla jsou v docs/architecture.md, sekce Pojmenování a Extrude.
import type { Region } from './sketch';
import type { BodyResult, EdgeKind, EdgeName, FaceName, Frame, Id, IssueCode, Projected, ProjectionKind, Solid, SolidKernel, Vec2, Vec3 } from './types';
import { ANGLE_TOLERANCE, LENGTH_TOLERANCE, add3, cross3, dot3, edgeKey, faceKey, len3, mul3, sub3, unit3 } from './util';

// Analytický popis stěny; plyne z definice feature, ne ze sítě.
export type FaceInfo =
  | { planar: true; origin: Vec3; y: Vec3; normal: Vec3 } // rovina bodem `origin`; `normal` bez znaménka směru ven
  | { planar: false; surface: 'cylinder'; center: Vec3; axis: Vec3; radius: number }
  // A general surface swept along `axis` (the side of gear teeth). It is not planar, so a sketch
  // cannot stand on it, and its edges have no analytic shape, so they cannot be projected.
  | { planar: false; surface: 'swept'; axis: Vec3 };
type Cylinder = Extract<FaceInfo, { surface: 'cylinder' }>;
type Plane = Extract<FaceInfo, { planar: true }>;

// Křivka skici, ze které vzniká boční stěna. `general`: a side of a generated profile.
export type SideCurve = { type: 'line'; a: Vec2; b: Vec2 } | { type: 'round'; center: Vec2; radius: number } | { type: 'general' };

export const toWorld = (frame: Frame, u: number, v: number, w = 0): Vec3 => [
  frame.origin[0] + u * frame.x[0] + v * frame.y[0] + w * frame.normal[0],
  frame.origin[1] + u * frame.x[1] + v * frame.y[1] + w * frame.normal[1],
  frame.origin[2] + u * frame.x[2] + v * frame.y[2] + w * frame.normal[2],
];
export const toPlane = (frame: Frame, p: Vec3): Vec2 => [dot3(sub3(p, frame.origin), frame.x), dot3(sub3(p, frame.origin), frame.y)];

// ---------------------------------------------------------------- rigid transforms

// An isometry p' = M · p + t; `matrix` holds the rows of an orthogonal matrix. A pattern is a list
// of these. With a negative determinant (a mirror, later) the order of triangle vertices is
// reversed; a face description carries its normal without a sign, so it is only mapped.
export interface RigidTransform {
  matrix: [Vec3, Vec3, Vec3];
  translation: Vec3;
}
export const transformVector = (t: RigidTransform, v: Vec3): Vec3 => [dot3(t.matrix[0], v), dot3(t.matrix[1], v), dot3(t.matrix[2], v)];
export const transformPoint = (t: RigidTransform, p: Vec3): Vec3 => add3(transformVector(t, p), t.translation);
export const transformFrame = (t: RigidTransform, frame: Frame): Frame => ({ origin: transformPoint(t, frame.origin), x: transformVector(t, frame.x), y: transformVector(t, frame.y), normal: transformVector(t, frame.normal) });
const determinant = (t: RigidTransform): number => dot3(t.matrix[0], cross3(t.matrix[1], t.matrix[2]));

// Rotation by `angle` around the axis through `point` with the direction `axis` (right-handed).
export function rotation(point: Vec3, axis: Vec3, angle: number): RigidTransform {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  const [x, y, z] = mul3(axis, 1 / len3(axis));
  const matrix: [Vec3, Vec3, Vec3] = [
    [c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s],
    [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s],
    [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)],
  ];
  const turned: Vec3 = [dot3(matrix[0], point), dot3(matrix[1], point), dot3(matrix[2], point)];
  return { matrix, translation: sub3(point, turned) };
}

export function transformFace(t: RigidTransform, info: FaceInfo): FaceInfo {
  if (info.planar) return { planar: true, origin: transformPoint(t, info.origin), y: transformVector(t, info.y), normal: transformVector(t, info.normal) };
  if (info.surface === 'cylinder') return { ...info, center: transformPoint(t, info.center), axis: transformVector(t, info.axis) };
  return { ...info, axis: transformVector(t, info.axis) };
}

// A copy of a solid in the transformed position, with its face numbers renumbered by `faceId`.
export function transformSolid(t: RigidTransform, solid: Solid, faceId: (old: number) => number): Solid {
  const positions = new Float32Array(solid.positions.length);
  for (let i = 0; i < positions.length; i += 3) positions.set(transformPoint(t, [solid.positions[i], solid.positions[i + 1], solid.positions[i + 2]]), i);
  const triangles = Uint32Array.from(solid.triangles);
  if (determinant(t) < 0) for (let i = 0; i < triangles.length; i += 3) [triangles[i + 1], triangles[i + 2]] = [triangles[i + 2], triangles[i + 1]];
  return { positions, triangles, faceIds: solid.faceIds.map(faceId) };
}

// ---------------------------------------------------------------- extrude

export interface Prism {
  solid: Solid;
  faces: { name: FaceName; info: FaceInfo }[]; // nové stěny; číslo stěny = firstFaceId + index
}

// Postaví uzavřenou síť nad vybranými oblastmi: dvě víka a boční stěny. Boční stěna vznikne jen
// z křivky na hranici právě jedné vybrané oblasti; křivka sdílená dvěma oblastmi se vyruší.
// `span` je rozsah podél normály roviny skici: [začátek, konec], měřeno od roviny skici. Víko
// startCap leží na začátku, endCap na konci.
// `triangulation`: a cache of the planar triangulation by region. A tool that is built again and
// again (for every copy of a pattern) passes the same map, so the profile is triangulated once.
export function buildPrism(feature: Id, regions: Region[], frame: Frame, span: [number, number], curveOf: (id: Id) => SideCurve, firstFaceId: number, kernel: SolidKernel, triangulation?: Map<Region, Uint32Array>): Prism {
  const [start, end] = span;
  // 2D síť sjednocení oblastí. Vrcholy se sdílejí podle klíče, takže sousední oblasti na sebe navazují.
  const index = new Map<string, number>();
  const xy: number[] = [];
  const triangles: number[] = [];
  const curveAt = new Map<string, Id>(); // hrana (neorientovaná dvojice vrcholů) → křivka
  const pair = (i: number, j: number) => (i < j ? `${i}_${j}` : `${j}_${i}`);
  for (const region of regions) {
    const loops = [region.outer, ...region.holes];
    const local: number[] = [];
    for (const loop of loops) {
      const count = loop.keys.length;
      const ids = loop.keys.map((key, k) => {
        let i = index.get(key);
        if (i === undefined) {
          i = xy.length / 2;
          index.set(key, i);
          xy.push(loop.xy[2 * k], loop.xy[2 * k + 1]);
        }
        return i;
      });
      ids.forEach((i, k) => curveAt.set(pair(i, ids[(k + 1) % count]), loop.curves[k]));
      local.push(...ids);
    }
    const flat = triangulation?.get(region) ?? kernel.triangulate(loops.map((loop) => Float64Array.from(loop.xy)));
    triangulation?.set(region, flat);
    for (const i of flat) triangles.push(local[i]);
  }

  // Kde se oblast dotýká sama sebe nebo jiné vybrané oblasti jen v bodě, by svislá hrana nesla čtyři
  // boční stěny. Vrchol se proto zdvojí: každý vějíř trojúhelníků kolem něj dostane vlastní.
  const original: number[] = Array.from({ length: xy.length / 2 }, (_, i) => i);
  const count = triangles.length / 3;
  const around = new Map<number, number[]>();
  for (let t = 0; t < count; t++) for (let k = 0; k < 3; k++) around.set(triangles[3 * t + k], [...(around.get(triangles[3 * t + k]) ?? []), t]);
  for (const [v, list] of around) {
    const group = new Map<number, number>(list.map((t) => [t, t]));
    const root = (t: number): number => {
      while (group.get(t) !== t) t = group.get(t) as number;
      return t;
    };
    const byNeighbour = new Map<number, number[]>(); // druhý vrchol hrany → trojúhelníky vějíře
    for (const t of list) for (let k = 0; k < 3; k++) if (triangles[3 * t + k] !== v) byNeighbour.set(triangles[3 * t + k], [...(byNeighbour.get(triangles[3 * t + k]) ?? []), t]);
    for (const shared of byNeighbour.values()) if (shared.length === 2) group.set(root(shared[0]), root(shared[1]));
    const fans = [...new Set(list.map(root))];
    for (const fan of fans.slice(1)) {
      const copy = xy.length / 2;
      xy.push(xy[2 * v], xy[2 * v + 1]);
      original.push(original[v]);
      for (const t of list) if (root(t) === fan) for (let k = 0; k < 3; k++) if (triangles[3 * t + k] === v) triangles[3 * t + k] = copy;
    }
  }

  // Stěny: víka a boky. Boční stěny podle křivek, v pořadí ID křivky.
  const directed = new Set<string>();
  for (let t = 0; t < count; t++) for (let k = 0; k < 3; k++) directed.add(`${triangles[3 * t + k]}>${triangles[3 * t + ((k + 1) % 3)]}`);
  const boundary: [number, number, Id][] = [];
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      const [i, j] = [triangles[3 * t + k], triangles[3 * t + ((k + 1) % 3)]];
      if (directed.has(`${j}>${i}`)) continue;
      const curve = curveAt.get(pair(original[i], original[j]));
      if (curve === undefined) throw new Error('extrude: hrana obrysu bez křivky');
      boundary.push([i, j, curve]);
    }
  }
  const faces: Prism['faces'] = [
    { name: { feature, role: 'startCap' }, info: { planar: true, origin: toWorld(frame, 0, 0, start), y: frame.y, normal: frame.normal } },
    { name: { feature, role: 'endCap' }, info: { planar: true, origin: toWorld(frame, 0, 0, end), y: frame.y, normal: frame.normal } },
  ];
  const sideId = new Map<Id, number>();
  for (const curve of [...new Set(boundary.map((edge) => edge[2]))].sort()) {
    sideId.set(curve, firstFaceId + faces.length);
    const shape = curveOf(curve);
    if (shape.type === 'line') {
      const direction = sub3(toWorld(frame, shape.b[0], shape.b[1]), toWorld(frame, shape.a[0], shape.a[1]));
      faces.push({ name: { feature, role: 'side', curve }, info: { planar: true, origin: toWorld(frame, shape.a[0], shape.a[1]), y: frame.normal, normal: unit3(cross3(direction, frame.normal)) } });
    } else if (shape.type === 'round') {
      faces.push({ name: { feature, role: 'side', curve }, info: { planar: false, surface: 'cylinder', center: toWorld(frame, shape.center[0], shape.center[1]), axis: frame.normal, radius: shape.radius } });
    } else {
      faces.push({ name: { feature, role: 'side', curve }, info: { planar: false, surface: 'swept', axis: frame.normal } });
    }
  }

  // 3D síť: spodní a horní hladina podle normály roviny skici; startCap je víko na začátku rozsahu.
  const n = xy.length / 2;
  const [low, high] = [Math.min(start, end), Math.max(start, end)];
  const positions = new Float32Array(6 * n);
  for (let i = 0; i < n; i++) {
    positions.set(toWorld(frame, xy[2 * i], xy[2 * i + 1], low), 3 * i);
    positions.set(toWorld(frame, xy[2 * i], xy[2 * i + 1], high), 3 * (n + i));
  }
  const [lowId, highId] = end > start ? [firstFaceId, firstFaceId + 1] : [firstFaceId + 1, firstFaceId];
  const out: number[] = [];
  const ids: number[] = [];
  for (let t = 0; t < count; t++) {
    const [a, b, c] = [triangles[3 * t], triangles[3 * t + 1], triangles[3 * t + 2]];
    out.push(a, c, b, n + a, n + b, n + c);
    ids.push(lowId, highId);
  }
  for (const [i, j, curve] of boundary) {
    out.push(i, j, n + j, i, n + j, n + i);
    ids.push(sideId.get(curve) as number, sideId.get(curve) as number);
  }
  return { solid: { positions, triangles: Uint32Array.from(out), faceIds: Uint32Array.from(ids) }, faces };
}

export function volumeOf(s: Solid): number {
  let volume = 0;
  const p = s.positions;
  for (let t = 0; t < s.triangles.length; t += 3) {
    const [a, b, c] = [3 * s.triangles[t], 3 * s.triangles[t + 1], 3 * s.triangles[t + 2]];
    volume += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) + p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return volume / 6;
}

// Do the faces numbered from `first` on (the faces a tool brought into `result`) lie on the surface
// of `before`? Each of their triangles is tested by its centroid, which must lie within `eps` of
// a triangle of `before`. It tells a cut that changed nothing but the names of faces (its tool
// lies on what is cut already) from a cut that changed the shape: a new face of a real cut runs
// through what was the inside of the body. Vertices are no use for this, the kernel may add some
// on an edge without changing the shape.
export function onSurface(result: Solid, first: number, before: Solid, eps: number): boolean {
  const p = before.positions;
  const count = before.triangles.length / 3;
  // boxes of the triangles of `before`, to skip most of them
  const boxes = new Float32Array(6 * count);
  for (let t = 0; t < count; t++) {
    for (let axis = 0; axis < 3; axis++) {
      const [a, b, c] = [p[3 * before.triangles[3 * t] + axis], p[3 * before.triangles[3 * t + 1] + axis], p[3 * before.triangles[3 * t + 2] + axis]];
      boxes[6 * t + axis] = Math.min(a, b, c) - eps;
      boxes[6 * t + 3 + axis] = Math.max(a, b, c) + eps;
    }
  }
  const corner = (t: number, k: number): Vec3 => [p[3 * before.triangles[3 * t + k]], p[3 * before.triangles[3 * t + k] + 1], p[3 * before.triangles[3 * t + k] + 2]];
  const q = result.positions;
  for (let t = 0; t < result.faceIds.length; t++) {
    if (result.faceIds[t] < first) continue;
    const [a, b, c] = [3 * result.triangles[3 * t], 3 * result.triangles[3 * t + 1], 3 * result.triangles[3 * t + 2]];
    const centroid: Vec3 = [(q[a] + q[b] + q[c]) / 3, (q[a + 1] + q[b + 1] + q[c + 1]) / 3, (q[a + 2] + q[b + 2] + q[c + 2]) / 3];
    let found = false;
    for (let other = 0; other < count && !found; other++) {
      const box = 6 * other;
      if (centroid[0] < boxes[box] || centroid[1] < boxes[box + 1] || centroid[2] < boxes[box + 2] || centroid[0] > boxes[box + 3] || centroid[1] > boxes[box + 4] || centroid[2] > boxes[box + 5]) continue;
      found = len3(sub3(centroid, closestOnTriangle(centroid, corner(other, 0), corner(other, 1), corner(other, 2)))) <= eps;
    }
    if (!found) return false;
  }
  return true;
}

// The point of the triangle abc closest to p (Ericson, Real-Time Collision Detection, 5.1.5).
function closestOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const [ab, ac, ap] = [sub3(b, a), sub3(c, a), sub3(p, a)];
  const [d1, d2] = [dot3(ab, ap), dot3(ac, ap)];
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub3(p, b);
  const [d3, d4] = [dot3(ab, bp), dot3(ac, bp)];
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add3(a, mul3(ab, d1 / (d1 - d3)));
  const cp = sub3(p, c);
  const [d5, d6] = [dot3(ab, cp), dot3(ac, cp)];
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add3(a, mul3(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add3(b, mul3(sub3(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6))));
  const sum = va + vb + vc;
  return add3(a, add3(mul3(ab, vb / sum), mul3(ac, vc / sum)));
}

// The area of the surface of a solid. With `eps` the sheets are left out: triangles that lie back
// to back on another triangle of the solid within `eps` and enclose nothing. The kernel leaves
// such sheets in an intersection where faces of the two bodies coincide.
export function areaOf(s: Solid, eps?: number): number {
  const p = s.positions;
  const count = s.triangles.length / 3;
  const corner = (t: number, k: number): Vec3 => [p[3 * s.triangles[3 * t + k]], p[3 * s.triangles[3 * t + k] + 1], p[3 * s.triangles[3 * t + k] + 2]];
  const normals: Vec3[] = [];
  const areas = new Float64Array(count);
  for (let t = 0; t < count; t++) {
    const [a, b, c] = [corner(t, 0), corner(t, 1), corner(t, 2)];
    const normal = cross3(sub3(b, a), sub3(c, a));
    areas[t] = len3(normal) / 2;
    normals.push(areas[t] > 0 ? mul3(normal, 1 / (2 * areas[t])) : [0, 0, 0]);
  }
  let area = 0;
  for (let t = 0; t < count; t++) {
    if (areas[t] === 0) continue;
    let sheet = false;
    if (eps !== undefined) {
      const [a, b, c] = [corner(t, 0), corner(t, 1), corner(t, 2)];
      const centroid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      for (let other = 0; other < count && !sheet; other++) {
        if (other === t || areas[other] === 0 || dot3(normals[t], normals[other]) > -0.999) continue;
        const [d, e, f] = [corner(other, 0), corner(other, 1), corner(other, 2)];
        let outside = false;
        for (let axis = 0; axis < 3 && !outside; axis++) outside = centroid[axis] < Math.min(d[axis], e[axis], f[axis]) - eps || centroid[axis] > Math.max(d[axis], e[axis], f[axis]) + eps;
        if (!outside) sheet = len3(sub3(centroid, closestOnTriangle(centroid, d, e, f))) <= eps;
      }
    }
    if (!sheet) area += areas[t];
  }
  return area;
}

// The nearest triangle of the surface of a solid to a point, as a function prepared once for many
// points: the distance and the face the triangle belongs to (-1 and Infinity without triangles).
// With `region` only the triangles whose box touches it are used: the answer is then right for
// points whose nearest triangle is one of them. With `only` the surface is just the faces it
// accepts. `all` says that no triangle was left out for the region.
interface Nearest {
  distance: number;
  face: number;
}
function nearestOnSurface(solid: Solid, region?: { min: Vec3; max: Vec3 }, only?: (face: number) => boolean): { all: boolean; nearest: (point: Vec3) => Nearest } {
  const p = solid.positions;
  const corners: number[] = []; // 9 numbers a triangle
  const boxes: number[] = []; // 6 numbers a triangle
  const faces: number[] = [];
  let all = true;
  for (let t = 0; t < solid.triangles.length; t += 3) {
    if (only && !only(solid.faceIds[t / 3])) continue;
    const [a, b, c] = [3 * solid.triangles[t], 3 * solid.triangles[t + 1], 3 * solid.triangles[t + 2]];
    const box = [0, 0, 0, 0, 0, 0];
    let outside = false;
    for (let axis = 0; axis < 3; axis++) {
      box[axis] = Math.min(p[a + axis], p[b + axis], p[c + axis]);
      box[3 + axis] = Math.max(p[a + axis], p[b + axis], p[c + axis]);
      if (region && (box[axis] > region.max[axis] || box[3 + axis] < region.min[axis])) outside = true;
    }
    if (outside) {
      all = false;
      continue;
    }
    boxes.push(...box);
    corners.push(p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]);
    faces.push(solid.faceIds[t / 3]);
  }
  const count = faces.length;
  const nearest = (point: Vec3): Nearest => {
    let best = Infinity; // squared
    let face = -1;
    for (let t = 0; t < count && best > 0; t++) {
      let far = 0;
      for (let axis = 0; axis < 3; axis++) {
        const gap = Math.max(boxes[6 * t + axis] - point[axis], point[axis] - boxes[6 * t + 3 + axis], 0);
        far += gap * gap;
      }
      if (far >= best) continue;
      const k = 9 * t;
      const away = sub3(point, closestOnTriangle(point, [corners[k], corners[k + 1], corners[k + 2]], [corners[k + 3], corners[k + 4], corners[k + 5]], [corners[k + 6], corners[k + 7], corners[k + 8]]));
      const squared = dot3(away, away);
      // a degenerate triangle may give NaN: it is skipped
      if (squared < best) [best, face] = [squared, faces[t]];
    }
    return { distance: Math.sqrt(best), face };
  };
  return { all, nearest };
}

// The triangles of a mesh by connected piece. Triangles are connected through a shared edge:
// pieces that only touch at a vertex stay apart, each of them closed.
function pieces(solid: Solid): number[][] {
  const count = solid.triangles.length / 3;
  const vertices = solid.positions.length / 3;
  const parent = new Int32Array(count).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const byEdge = new Map<number, number>(); // the first triangle seen at an edge
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      const [a, b] = [solid.triangles[3 * t + k], solid.triangles[3 * t + ((k + 1) % 3)]];
      const edge = Math.min(a, b) * vertices + Math.max(a, b);
      const other = byEdge.get(edge);
      if (other === undefined) byEdge.set(edge, t);
      else parent[find(t)] = find(other);
    }
  }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < count; t++) {
    const root = find(t);
    const group = groups.get(root);
    if (group) group.push(t);
    else groups.set(root, [t]);
  }
  return [...groups.values()];
}

// The largest mean thickness of a connected piece of a mesh: twice the volume of the piece over
// its surface. Piece by piece, so that a lump is not thinned out by slivers elsewhere in the mesh.
// With `eps` the sheets are left out of the surface (see `areaOf`).
export function thickestPiece(solid: Solid, eps?: number): number {
  let thickest = 0;
  for (const triangles of pieces(solid)) {
    const piece: Solid = {
      positions: solid.positions,
      triangles: Uint32Array.from(triangles.flatMap((t) => [solid.triangles[3 * t], solid.triangles[3 * t + 1], solid.triangles[3 * t + 2]])),
      faceIds: Uint32Array.from(triangles.map((t) => solid.faceIds[t])),
    };
    const volume = Math.abs(volumeOf(piece));
    if (!(volume > 0)) continue;
    const area = areaOf(piece, eps);
    if (area > 0) thickest = Math.max(thickest, (2 * volume) / area);
  }
  return thickest;
}

// How deep two bodies reach into each other, measured on what they share (`common`, their
// intersection as the kernel returns it).
// - Every point of the surface of the shared volume lies on the surface of `a` or of `b`; its
//   distance to the other surface says how deep in the other body it is. The points looked at are
//   the vertices of `common`, the middles of its edges and the centroids of its triangles (the
//   corners of a thin overlap along an edge often lie on both surfaces; the middle does not).
// - A sheet without thickness that the kernel leaves where faces of the two bodies coincide lies
//   on both surfaces and gives zero, so it cannot hide a real overlap next to it.
// - `depth` is the largest such distance. `planar` is the largest one among the points of
//   a planar face of one body measured against a planar face of the other: an overlap that no
//   polygon of a round face explains.
// - A polygon of a round face does explain such a point when a round face of the body the point
//   is in lies within `excuse` of it (the chord tolerance): the end of a sliver between a pin and
//   its hole is a point of the cap of the pin, in the plate, and as near to the floor or the top
//   of the plate as to the wall of the hole. Those points do not count for `planar`.
// - A point with a distance that is not a number (a degenerate triangle) is left out.
export interface Reach {
  depth: number;
  planar: number;
}
export function penetration(common: Solid, a: Solid, b: Solid, isPlanar: (face: number) => boolean, excuse: number): Reach {
  const q = common.positions;
  const reach: Reach = { depth: 0, planar: 0 };
  if (common.triangles.length === 0) return reach;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < common.triangles.length; t++) {
    for (let axis = 0; axis < 3; axis++) {
      const value = q[3 * common.triangles[t] + axis];
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  // Triangles near what is shared answer for nearly every point. A point whose nearest triangle
  // may lie further (a body wholly inside the other has none of the other surface nearby) is
  // asked again over the whole surface.
  const size = len3(sub3(max, min));
  const region = { min: min.map((value) => value - size) as Vec3, max: max.map((value) => value + size) as Vec3 };
  const measure = (solid: Solid, only?: (face: number) => boolean): ((point: Vec3) => Nearest) => {
    let near: ReturnType<typeof nearestOnSurface> | undefined;
    let whole: ((point: Vec3) => Nearest) | undefined;
    return (point) => {
      near ??= nearestOnSurface(solid, region, only);
      const found = near.nearest(point);
      if (found.distance <= size || near.all) return found;
      whole ??= nearestOnSurface(solid, undefined, only).nearest;
      return whole(point);
    };
  };
  const isRound = (face: number): boolean => !isPlanar(face);
  const bodies = [a, b].map((solid) => ({ to: measure(solid), toRound: measure(solid, isRound) }));
  // the deeper of the two distances of a point and the body it is in, remembered by vertex and by
  // edge (a pair of vertices)
  const known = new Map<number, Nearest & { body: number }>();
  const vertices = q.length / 3;
  const look = (key: number | undefined, at: Vec3, face: number): void => {
    let deep = key === undefined ? undefined : known.get(key);
    if (!deep) {
      const [inA, inB] = [bodies[0].to(at), bodies[1].to(at)];
      deep = inA.distance >= inB.distance ? { ...inA, body: 0 } : { ...inB, body: 1 };
      if (key !== undefined) known.set(key, deep);
    }
    if (!Number.isFinite(deep.distance)) return;
    reach.depth = Math.max(reach.depth, deep.distance);
    // the distance to the round faces is asked only where it can change the answer
    if (deep.distance > reach.planar && isPlanar(face) && isPlanar(deep.face) && !(bodies[deep.body].toRound(at).distance <= excuse)) reach.planar = deep.distance;
  };
  for (let t = 0; t < common.triangles.length; t += 3) {
    const face = common.faceIds[t / 3];
    const index = [common.triangles[t], common.triangles[t + 1], common.triangles[t + 2]];
    const corners = index.map((vertex): Vec3 => [q[3 * vertex], q[3 * vertex + 1], q[3 * vertex + 2]]);
    for (let k = 0; k < 3; k++) {
      const next = (k + 1) % 3;
      look(index[k], corners[k], face);
      look(vertices * (Math.min(index[k], index[next]) + 1) + Math.max(index[k], index[next]), mul3(add3(corners[k], corners[next]), 0.5), face);
    }
    look(undefined, mul3(add3(add3(corners[0], corners[1]), corners[2]), 1 / 3), face);
  }
  return reach;
}

// ---------------------------------------------------------------- stěny a hrany tělesa

interface EdgeData {
  a: number; // čísla stěn v kanonickém pořadí jmen
  b: number;
  name: EdgeName;
  kind: EdgeKind;
  segments: number[];
}
export interface BodyData {
  result: BodyResult;
  normalSum: Map<number, Vec3>; // součet normál trojúhelníků stěny vážený plochou: směr ven z tělesa
  edges: Map<string, EdgeData>;
}

const cache = new WeakMap<Solid, BodyData>();

// Stěny a hrany tělesa. Výsledek závisí jen na síti a na tabulce stěn, která se pro existující
// čísla nemění, takže se pamatuje podle identity sítě.
export function analyzeBody(solid: Solid, faceNames: FaceName[], faceInfos: FaceInfo[]): BodyData {
  const cached = cache.get(solid);
  if (cached) return cached;
  const p = solid.positions;
  const at = (i: number): Vec3 => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
  const normalSum = new Map<number, Vec3>();
  const byEdge = new Map<number, number>(); // orientovaná hrana → číslo stěny trojúhelníku
  const vertexCount = p.length / 3;
  for (let t = 0; t < solid.triangles.length / 3; t++) {
    const [i, j, k] = [solid.triangles[3 * t], solid.triangles[3 * t + 1], solid.triangles[3 * t + 2]];
    const id = solid.faceIds[t];
    normalSum.set(id, add3(normalSum.get(id) ?? [0, 0, 0], cross3(sub3(at(j), at(i)), sub3(at(k), at(i)))));
    byEdge.set(i * vertexCount + j, id).set(j * vertexCount + k, id).set(k * vertexCount + i, id);
  }
  const edges = new Map<string, EdgeData>();
  for (const [key, id] of byEdge) {
    const [i, j] = [Math.floor(key / vertexCount), key % vertexCount];
    if (i > j) continue; // každou hranu jednou
    const other = byEdge.get(j * vertexCount + i);
    if (other === undefined || other === id) continue;
    const [a, b] = faceKey(faceNames[id]) <= faceKey(faceNames[other]) ? [id, other] : [other, id];
    const name: EdgeName = { a: faceNames[a], b: faceNames[b] };
    let edge = edges.get(edgeKey(name));
    if (!edge) edges.set(edgeKey(name), (edge = { a, b, name, kind: edgeKind(faceInfos[a], faceInfos[b]), segments: [] }));
    edge.segments.push(...at(i), ...at(j));
  }
  const sorted = [...edges.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1));
  const bounds: BodyResult['bounds'] = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < p.length; i++) {
    bounds.min[i % 3] = Math.min(bounds.min[i % 3], p[i]);
    bounds.max[i % 3] = Math.max(bounds.max[i % 3], p[i]);
  }
  const data: BodyData = {
    result: {
      solid,
      volume: volumeOf(solid),
      bounds,
      faces: [...normalSum.keys()].sort((x, y) => x - y).map((id) => ({ id, planar: faceInfos[id].planar })),
      edges: sorted.map(([, e]) => ({ name: e.name, kind: e.kind, segments: Float64Array.from(e.segments) })),
    },
    normalSum,
    edges: new Map(sorted),
  };
  cache.set(solid, data);
  return data;
}

function edgeKind(a: FaceInfo, b: FaceInfo): EdgeKind {
  if (a.planar && b.planar) return len3(cross3(a.normal, b.normal)) <= Math.sin(ANGLE_TOLERANCE) ? 'coplanar' : 'line';
  if (a.planar === b.planar) return 'other';
  const [plane, round] = a.planar ? [a, b as Exclude<FaceInfo, Plane>] : [b as Plane, a as Exclude<FaceInfo, Plane>];
  // only a plane across a cylinder gives a circle; the edge of a cap with a swept side is a general curve
  return round.surface === 'cylinder' && len3(cross3(plane.normal, round.axis)) <= Math.sin(ANGLE_TOLERANCE) ? 'circle' : 'other';
}

// Normála rovinné stěny ven z tělesa: analytický směr, znaménko ze sítě. undefined = stěna v tělese není.
function outward(body: BodyData, id: number, info: Extract<FaceInfo, { planar: true }>): Vec3 | undefined {
  const sum = body.normalSum.get(id);
  if (!sum) return undefined;
  const side = dot3(sum, info.normal);
  if (side === 0) return undefined;
  const flipped = mul3(info.normal, Math.sign(side));
  return [flipped[0] + 0, flipped[1] + 0, flipped[2] + 0]; // bez záporné nuly
}

// Souřadný systém skici na stěně: počátek a osa Y analyticky, normála ven z tělesa, X = Y × N.
export function faceFrame(body: BodyData, id: number, info: FaceInfo): Frame | IssueCode {
  if (!body.normalSum.has(id)) return 'brokenReference';
  if (!info.planar) return 'nonPlanarFace';
  const normal = outward(body, id, info);
  if (!normal) return 'brokenReference';
  return { origin: info.origin, x: cross3(info.y, normal), y: info.y, normal };
}

// Promítne hranu tělesa do roviny skici. Přímka hrany se počítá analyticky z rovin obou stěn,
// ze sítě se bere jen rozsah; kružnice celá analyticky.
export function projectEdge(body: BodyData, name: EdgeName, kind: ProjectionKind, frame: Frame, faceInfos: FaceInfo[]): Projected | IssueCode {
  const edge = body.edges.get(edgeKey(name));
  if (!edge) return 'brokenProjection';
  if (edge.kind !== kind) return 'unsupportedProjection'; // coplanar, other, nebo jiný druh, než se uložilo
  const [a, b] = [faceInfos[edge.a], faceInfos[edge.b]];
  if (edge.kind === 'line' && a.planar && b.planar) {
    const [na, nb] = [outward(body, edge.a, a), outward(body, edge.b, b)];
    if (!na || !nb) return 'brokenProjection';
    // Orientace n_a × n_b; bod `<id>/a` je konec s menším parametrem v tomto směru.
    const d = cross3(na, nb);
    const [da, db] = [dot3(na, a.origin), dot3(nb, b.origin)];
    const point = mul3(add3(mul3(cross3(nb, d), da), mul3(cross3(d, na), db)), 1 / dot3(d, d));
    const direction = unit3(d);
    let [low, high] = [Infinity, -Infinity];
    for (let i = 0; i < edge.segments.length; i += 3) {
      const t = dot3(sub3([edge.segments[i], edge.segments[i + 1], edge.segments[i + 2]], point), direction);
      low = Math.min(low, t);
      high = Math.max(high, t);
    }
    const [start, end] = [toPlane(frame, add3(point, mul3(direction, low))), toPlane(frame, add3(point, mul3(direction, high)))];
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) <= LENGTH_TOLERANCE) return 'degenerateProjection'; // hrana kolmá na rovinu
    return { kind: 'line', a: start, b: end };
  }
  if (edge.kind === 'circle') {
    const [plane, cylinder] = a.planar ? [a, b as Cylinder] : [b as Plane, a as Cylinder]; // the kind `circle` guarantees a cylinder
    if (len3(cross3(cylinder.axis, frame.normal)) > Math.sin(ANGLE_TOLERANCE)) return 'unsupportedProjection'; // elipsa nebo úsečka
    const t = dot3(plane.normal, sub3(plane.origin, cylinder.center)) / dot3(plane.normal, cylinder.axis);
    return { kind: 'circle', center: toPlane(frame, add3(cylinder.center, mul3(cylinder.axis, t))), radius: cylinder.radius };
  }
  return 'unsupportedProjection';
}

// ---------------------------------------------------------------- export

// Binární STL všech těles.
export function toStl(solids: Solid[]): Uint8Array {
  const count = solids.reduce((sum, s) => sum + s.triangles.length / 3, 0);
  const bytes = new Uint8Array(84 + 50 * count);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, count, true);
  let offset = 84;
  for (const s of solids) {
    const at = (i: number): Vec3 => [s.positions[3 * i], s.positions[3 * i + 1], s.positions[3 * i + 2]];
    for (let t = 0; t < s.triangles.length; t += 3) {
      const v = [at(s.triangles[t]), at(s.triangles[t + 1]), at(s.triangles[t + 2])];
      const raw = cross3(sub3(v[1], v[0]), sub3(v[2], v[0]));
      const normal = len3(raw) > 0 ? unit3(raw) : raw;
      for (const vector of [normal, ...v]) for (const value of vector) {
        view.setFloat32(offset, value, true);
        offset += 4;
      }
      offset += 2;
    }
  }
  return bytes;
}
