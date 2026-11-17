// Bodies: rigid transforms, faces and edges of a body, the plane on a face, the projection of an
// edge, measures of a mesh, STL. The meshes of tools are built in recompute/tool-*.ts.
// Pravidla jsou v docs/architecture.md, sekce Pojmenování a Extrude.
import type { BodyResult, EdgeKind, EdgeName, FaceName, Frame, IssueCode, Projected, ProjectionKind, RigidTransform, Solid, Surface, Vec2, Vec3 } from './types';
import { closestOnTriangle } from './mesh-distance';
import { circleBetween } from './surfaces';
import { ANGLE_TOLERANCE, LENGTH_TOLERANCE, add3, cross3, dot3, edgeKey, faceKey, len3, mul3, sub3, unit3 } from './util';

// Analytický popis stěny; plyne z definice feature, ne ze sítě.
export type FaceInfo =
  | { planar: true; origin: Vec3; y: Vec3; normal: Vec3 } // rovina bodem `origin`; `normal` bez znaménka směru ven
  | { planar: false; surface: 'cylinder'; center: Vec3; axis: Vec3; radius: number }
  // The side of an arc or a circle of a tapered extrusion. `axis` points from the apex towards the
  // face (a cone has two halves); `halfAngle` is between the axis and the surface.
  | { planar: false; surface: 'cone'; apex: Vec3; axis: Vec3; halfAngle: number }
  // A revolved arc or circle (D58): a sphere when its centre lies on the axis, otherwise a torus
  // whose major radius is signed as `Surface` says.
  | { planar: false; surface: 'sphere'; center: Vec3; radius: number }
  | { planar: false; surface: 'torus'; center: Vec3; axis: Vec3; majorRadius: number; minorRadius: number }
  // A general surface swept along `axis` (the side of gear teeth). It is not planar, so a sketch
  // cannot stand on it, and its edges have no analytic shape, so they cannot be projected.
  | { planar: false; surface: 'swept'; axis: Vec3 };
// The surface of a face as the evaluation publishes it. `FaceInfo` stays internal and keeps what only
// the engine needs: the `y` direction of a planar face, from which the frame of a sketch on the
// face is built.
export function surfaceOf(info: FaceInfo): Surface {
  if (info.planar) return { kind: 'plane', origin: info.origin, normal: info.normal };
  switch (info.surface) {
    case 'cylinder':
      return { kind: 'cylinder', origin: info.center, axis: info.axis, radius: info.radius };
    case 'cone':
      return { kind: 'cone', apex: info.apex, axis: info.axis, halfAngle: info.halfAngle };
    case 'sphere':
      return { kind: 'sphere', center: info.center, radius: info.radius };
    case 'torus':
      return { kind: 'torus', center: info.center, axis: info.axis, majorRadius: info.majorRadius, minorRadius: info.minorRadius };
    case 'swept':
      return { kind: 'swept', axis: info.axis };
  }
}

export const toWorld = (frame: Frame, u: number, v: number, w = 0): Vec3 => [
  frame.origin[0] + u * frame.x[0] + v * frame.y[0] + w * frame.normal[0],
  frame.origin[1] + u * frame.x[1] + v * frame.y[1] + w * frame.normal[1],
  frame.origin[2] + u * frame.x[2] + v * frame.y[2] + w * frame.normal[2],
];
export const toPlane = (frame: Frame, p: Vec3): Vec2 => [dot3(sub3(p, frame.origin), frame.x), dot3(sub3(p, frame.origin), frame.y)];

// ---------------------------------------------------------------- rigid transforms

// An isometry p' = M · p + t (`RigidTransform` of types.ts: the mechanism publishes one per link).
// A pattern is a list of these. A mirror (a negative determinant: the pattern of the kind
// `mirror`) reverses the order of triangle vertices; a face description carries its normal without
// a sign, so it is only mapped. The pose of a link is composed of turns and shifts and never
// mirrors.
export type { RigidTransform };
export const transformVector = (t: RigidTransform, v: Vec3): Vec3 => [dot3(t.matrix[0], v), dot3(t.matrix[1], v), dot3(t.matrix[2], v)];
export const transformPoint = (t: RigidTransform, p: Vec3): Vec3 => add3(transformVector(t, p), t.translation);
export const transformFrame = (t: RigidTransform, frame: Frame): Frame => ({ origin: transformPoint(t, frame.origin), x: transformVector(t, frame.x), y: transformVector(t, frame.y), normal: transformVector(t, frame.normal) });
const determinant = (t: RigidTransform): number => dot3(t.matrix[0], cross3(t.matrix[1], t.matrix[2]));
// Does the transform mirror (is its determinant negative)? A solid built or moved by it faces
// inwards until its triangles are turned over (`turnedOver`).
export const mirrors = (t: RigidTransform): boolean => determinant(t) < 0;
// The reflection in the plane through `point` with the normal `normal` (any length, either sense):
// the matrix I − 2 n nᵀ and the translation 2 (n · p) n. An isometry with the determinant −1;
// applied twice it is the identity.
export function reflection(point: Vec3, normal: Vec3): RigidTransform {
  const n = mul3(normal, 1 / len3(normal));
  const matrix = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? 1 : 0) - 2 * n[i] * n[j])) as [Vec3, Vec3, Vec3];
  return { matrix, translation: mul3(n, 2 * dot3(n, point)) };
}
// The same solid with every triangle turned over (two of its vertices swapped): inwards becomes
// outwards. The face of each triangle stays.
export function turnedOver(solid: Solid): Solid {
  const triangles = Uint32Array.from(solid.triangles);
  for (let i = 0; i < triangles.length; i += 3) [triangles[i + 1], triangles[i + 2]] = [triangles[i + 2], triangles[i + 1]];
  return { ...solid, triangles };
}

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

// What a pose composes (D49): the identity, the product, the inverse, a shift along a direction.
// Frozen to the last number: every root link shares it as its transform, and the app gets it by
// reference.
export const IDENTITY: RigidTransform = Object.freeze({
  matrix: Object.freeze([Object.freeze([1, 0, 0]), Object.freeze([0, 1, 0]), Object.freeze([0, 0, 1])]),
  translation: Object.freeze([0, 0, 0]),
}) as unknown as RigidTransform;
// Exactly the identity, number by number (a turn by zero is exactly the identity).
export const isIdentity = (t: RigidTransform): boolean =>
  t === IDENTITY || (t.translation.every((x) => x === 0) && t.matrix.every((row, i) => row.every((x, j) => x === (i === j ? 1 : 0))));
// `a ∘ b`: first `b`, then `a`.
export function compose(a: RigidTransform, b: RigidTransform): RigidTransform {
  if (isIdentity(a)) return b;
  if (isIdentity(b)) return a;
  const column = (j: number): Vec3 => [b.matrix[0][j], b.matrix[1][j], b.matrix[2][j]];
  const matrix = a.matrix.map((row) => [dot3(row, column(0)), dot3(row, column(1)), dot3(row, column(2))]) as [Vec3, Vec3, Vec3];
  return { matrix, translation: transformPoint(a, b.translation) };
}
export function inverse(t: RigidTransform): RigidTransform {
  if (isIdentity(t)) return t;
  const m = t.matrix;
  const matrix: [Vec3, Vec3, Vec3] = [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
  const back = transformVector({ matrix, translation: [0, 0, 0] }, t.translation);
  return { matrix, translation: [-back[0], -back[1], -back[2]] };
}
// A shift by `distance` along the direction `axis`.
export function shift(axis: Vec3, distance: number): RigidTransform {
  const [x, y, z] = mul3(axis, distance / len3(axis));
  return { matrix: IDENTITY.matrix.map((row) => [...row]) as [Vec3, Vec3, Vec3], translation: [x, y, z] };
}
// A published surface moved by a transform. Exhaustive: a kind forgotten here does not compile.
export function transformSurface(t: RigidTransform, surface: Surface): Surface {
  switch (surface.kind) {
    case 'plane':
      return { ...surface, origin: transformPoint(t, surface.origin), normal: transformVector(t, surface.normal) };
    case 'cylinder':
      return { ...surface, origin: transformPoint(t, surface.origin), axis: transformVector(t, surface.axis) };
    case 'cone':
      return { ...surface, apex: transformPoint(t, surface.apex), axis: transformVector(t, surface.axis) };
    case 'sphere':
      return { ...surface, center: transformPoint(t, surface.center) };
    case 'torus':
      return { ...surface, center: transformPoint(t, surface.center), axis: transformVector(t, surface.axis) };
    case 'swept':
      return { ...surface, axis: transformVector(t, surface.axis) };
    case 'general':
      return surface;
  }
}

// A face description moved by a transform. Exhaustive, as `transformSurface`.
export function transformFace(t: RigidTransform, info: FaceInfo): FaceInfo {
  if (info.planar) return { planar: true, origin: transformPoint(t, info.origin), y: transformVector(t, info.y), normal: transformVector(t, info.normal) };
  switch (info.surface) {
    case 'cylinder':
      return { ...info, center: transformPoint(t, info.center), axis: transformVector(t, info.axis) };
    case 'cone':
      return { ...info, apex: transformPoint(t, info.apex), axis: transformVector(t, info.axis) };
    case 'sphere':
      return { ...info, center: transformPoint(t, info.center) };
    case 'torus':
      return { ...info, center: transformPoint(t, info.center), axis: transformVector(t, info.axis) };
    case 'swept':
      return { ...info, axis: transformVector(t, info.axis) };
  }
}

// A copy of a solid in the transformed position, with its face numbers renumbered by `faceId`.
// It remembers which solid the copy was made from and whether `t` mirrors (`shapeOrigin`, D57).
export function transformSolid(t: RigidTransform, solid: Solid, faceId: (old: number) => number): Solid {
  const positions = new Float32Array(solid.positions.length);
  for (let i = 0; i < positions.length; i += 3) positions.set(transformPoint(t, [solid.positions[i], solid.positions[i + 1], solid.positions[i + 2]]), i);
  const moved: Solid = { positions, triangles: Uint32Array.from(solid.triangles), faceIds: solid.faceIds.map(faceId) };
  const copy = mirrors(t) ? turnedOver(moved) : moved;
  COPIES.set(copy, { of: solid, mirrored: mirrors(t) });
  return copy;
}

// The mesh a solid is a copy of (D57, the parts list). `transformSolid` records every copy it
// makes, by the identity of the copy and weakly, as `analyzeBody` keeps its result by the identity
// of a mesh: two engines cannot meet in it, and it keeps alive no solid the states do not.
// What it rests on, and what every step of the recompute keeps to: a body keeps its `Solid` object
// for as long as no feature changes it (`applyTool` leaves the object of a target it did not
// change, a pattern of a body leaves its source, every step carries the other bodies over), no
// step changes a solid in place, and a feature that changes a body gives it a new object, which is
// a copy of nothing. So two bodies with one origin are one mesh, moved; bodies changed after the
// copy are never called the same, also when they were changed alike.
// It says what the recompute did, not what float32 holds: a copy moved so far that its shape is
// lost is still a copy by the record (the parts list takes a body without a volume for no copy).
const COPIES = new WeakMap<Solid, { of: Solid; mirrored: boolean }>();
export interface MeshOrigin {
  solid: Solid; // the mesh the chain of copies starts at
  mirrored: boolean; // the solid asked about is its mirror image (an odd number of mirrors on the way)
}
// The origin of a solid: the solid the chain of copies starts at, the solid itself when it is no copy.
export function shapeOrigin(solid: Solid): MeshOrigin {
  let mirrored = false;
  let origin = solid;
  for (let copy = COPIES.get(origin); copy; copy = COPIES.get(origin)) {
    mirrored = mirrored !== copy.mirrored;
    origin = copy.of;
  }
  return { solid: origin, mirrored };
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

// The connected pieces of a mesh, each a mesh over the same positions.
const pieceSolids = (solid: Solid): Solid[] =>
  pieces(solid).map((triangles) => ({
    positions: solid.positions,
    triangles: Uint32Array.from(triangles.flatMap((t) => [solid.triangles[3 * t], solid.triangles[3 * t + 1], solid.triangles[3 * t + 2]])),
    faceIds: Uint32Array.from(triangles.map((t) => solid.faceIds[t])),
  }));

// The largest mean thickness of a connected piece of a mesh: twice the volume of the piece over
// its surface. Piece by piece, so that a lump is not thinned out by slivers elsewhere in the mesh.
// With `eps` the sheets are left out of the surface (see `areaOf`).
export function thickestPiece(solid: Solid, eps?: number): number {
  let thickest = 0;
  for (const piece of pieceSolids(solid)) {
    const volume = Math.abs(volumeOf(piece));
    if (!(volume > 0)) continue;
    const area = areaOf(piece, eps);
    if (area > 0) thickest = Math.max(thickest, (2 * volume) / area);
  }
  return thickest;
}

// The volume of a mesh piece by piece: the sum of the volumes of its connected pieces, each
// without its sign (D50). A mesh the kernel did not verify may hold pieces of noise that are
// inside out; taken whole, their volume would subtract from what is shared, piece by piece it
// adds. (A lobe joined to a real piece through an edge is in that piece and still subtracts.)
export function volumeOfPieces(solid: Solid): number {
  let volume = 0;
  for (const piece of pieceSolids(solid)) volume += Math.abs(volumeOf(piece));
  return volume;
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

const cache = new WeakMap<Solid, { tolerance: number; data: BodyData }>();

// Stěny a hrany tělesa. Výsledek závisí jen na síti a na tabulce stěn, která se pro existující
// čísla nemění, takže se pamatuje podle identity sítě.
// `chordTolerance`: the chord tolerance of the document, by which the kind of an edge between two
// surfaces that meet in two circles is decided (`circleBetween` with the points of the edge, D58).
// A change of the setting recomputes every feature, so a solid meets one tolerance; the memo keeps
// it and analyses again for another.
export function analyzeBody(solid: Solid, faceNames: FaceName[], faceInfos: FaceInfo[], chordTolerance: number): BodyData {
  const cached = cache.get(solid);
  if (cached && cached.tolerance === chordTolerance) return cached.data;
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
    if (!edge) edges.set(edgeKey(name), (edge = { a, b, name, kind: 'other', segments: [] }));
    edge.segments.push(...at(i), ...at(j));
  }
  // the kind once the segments are collected: of two circles, the points of the edge choose
  for (const edge of edges.values()) edge.kind = edgeKind(faceInfos[edge.a], faceInfos[edge.b], edge.segments, chordTolerance);
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
  cache.set(solid, { tolerance: chordTolerance, data });
  return data;
}

// The kind of the edge between two faces by their surfaces: two planes meet in a line (or are one
// plane), surfaces that meet in a circle (`circleBetween`; of two circles the one the points of the
// edge say) in a circle, anything else in a general curve (the edge of a cap with a swept side, two
// cylinders).
function edgeKind(a: FaceInfo, b: FaceInfo, points: ArrayLike<number>, chordTolerance: number): EdgeKind {
  if (a.planar && b.planar) return len3(cross3(a.normal, b.normal)) <= Math.sin(ANGLE_TOLERANCE) ? 'coplanar' : 'line';
  return circleBetween(surfaceOf(a), surfaceOf(b), points, chordTolerance) ? 'circle' : 'other';
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
// `chordTolerance`: as for `analyzeBody`, to choose among two circles by the points of the edge.
export function projectEdge(body: BodyData, name: EdgeName, kind: ProjectionKind, frame: Frame, faceInfos: FaceInfo[], chordTolerance: number): Projected | IssueCode {
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
    const circle = circleBetween(surfaceOf(a), surfaceOf(b), edge.segments, chordTolerance);
    if (!circle) return 'brokenProjection'; // the kind `circle` was given by this function
    if (len3(cross3(circle.axis, frame.normal)) > Math.sin(ANGLE_TOLERANCE)) return 'unsupportedProjection'; // elipsa nebo úsečka
    return { kind: 'circle', center: toPlane(frame, circle.center), radius: circle.radius };
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
