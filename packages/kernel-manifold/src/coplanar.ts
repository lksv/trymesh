// Guarantee 3 of the port SolidKernel: a tolerance for faces in one plane (docs/architecture/ports.md).
// Faces of the tool and of the body in one plane must nowhere merely touch. Before the boolean every
// contact is turned into a real intersection by shifting the face of the tool (prepareTool), and after the
// boolean everything that was shifted is returned exactly to its place (restoreShifted).
import type { BooleanOp, Solid } from '@trymesh/engine';
import { clean } from './clean';
import {
  type FittedFace,
  type Tolerances,
  type V3,
  add,
  corners,
  cross,
  dot,
  fitFaces,
  len,
  mul,
  sub,
  triWidth,
  triangleCount,
  unit,
  vertex,
} from './geometry';

// The shift of a face of the tool: by how much along the normal, and from which original plane n·x = d.
export interface Shift {
  r: number;
  n: V3;
  d: number;
}

type Point2 = [number, number];

// Do two triangles in a plane overlap? (a separating axis test; a negative margin = a gap is enough too)
function trianglesOverlap2D(A: Point2[], B: Point2[], margin: number): boolean {
  for (const [S, T] of [
    [A, B],
    [B, A],
  ]) {
    for (let i = 0; i < 3; i++) {
      const p = S[i];
      const q = S[(i + 1) % 3];
      const axis: Point2 = [-(q[1] - p[1]), q[0] - p[0]];
      const l = Math.hypot(axis[0], axis[1]);
      if (l === 0) continue;
      const project = (points: Point2[]) => points.map((r) => (r[0] * axis[0] + r[1] * axis[1]) / l);
      const s = project(S);
      const t = project(T);
      if (Math.min(Math.max(...s), Math.max(...t)) - Math.max(Math.min(...s), Math.min(...t)) <= margin) return false;
    }
  }
  return true;
}

function facesOverlap(fa: FittedFace, fb: FittedFace, margin: number): boolean {
  const u = unit(Math.abs(fb.n[0]) < 0.9 ? cross(fb.n, [1, 0, 0]) : cross(fb.n, [0, 1, 0]));
  const v = cross(fb.n, u);
  const flatten = (face: FittedFace) => face.tris.map((tri) => tri.v.map((p): Point2 => [dot(p, u), dot(p, v)]));
  const A = flatten(fa);
  const B = flatten(fb);
  for (const ta of A) for (const tb of B) if (trianglesOverlap2D(ta, tb, margin)) return true;
  return false;
}

// The shortest shift d that meets the conditions n·d = r (in the least-squares sense).
// It is computed in an orthonormal basis of the space of the normals, so it is stable even for
// a single plane in a general position; nearly parallel normals are taken as one.
function minimalShift(list: { n: V3; r: number }[]): V3 {
  const basis: V3[] = [];
  for (const { n } of list) {
    let v = n;
    for (const e of basis) v = sub(v, mul(e, dot(v, e)));
    if (len(v) > 1e-3) basis.push(unit(v));
    if (basis.length === 3) break;
  }
  const k = basis.length;
  const G = Array.from({ length: k }, () => Array<number>(k + 1).fill(0)); // the augmented matrix of the normal equations
  for (const { n, r } of list) {
    const a = basis.map((e) => dot(n, e));
    for (let p = 0; p < k; p++) {
      G[p][k] += a[p] * r;
      for (let q = 0; q < k; q++) G[p][q] += a[p] * a[q];
    }
  }
  for (let c = 0; c < k; c++) {
    // Gaussian elimination with pivoting
    let pivot = c;
    for (let p = c + 1; p < k; p++) if (Math.abs(G[p][c]) > Math.abs(G[pivot][c])) pivot = p;
    [G[c], G[pivot]] = [G[pivot], G[c]];
    for (let p = 0; p < k; p++) {
      if (p === c) continue;
      const m = G[p][c] / G[c][c];
      for (let q = c; q <= k; q++) G[p][q] -= m * G[c][q];
    }
  }
  let d: V3 = [0, 0, 0];
  for (let c = 0; c < k; c++) d = add(d, mul(basis[c], G[c][k] / G[c][c]));
  return d;
}

// Moves the vertices so that the face with the number id gets the shift shiftOf(id) along its
// normal and the other faces stay in their plane (a vertex moves along the intersection line of the
// neighbouring faces). A planar face enters with its fitted normal. For a curved face the normal of
// the triangle is taken. Triangles and faces narrower than `sliver` are left out: their normal is noise.
function moveVertices(b: Solid, faces: Map<number, FittedFace>, sliver: number, shiftOf: (id: number) => number): Float32Array {
  const constraints = new Map<number, { n: V3; r: number }[]>(); // vertex → conditions
  const push = (i: number, n: V3, r: number) => {
    let list = constraints.get(i);
    if (!list) constraints.set(i, (list = []));
    if (!list.some((c) => Math.abs(dot(c.n, n)) > 1 - 1e-9 && c.r === r * Math.sign(dot(c.n, n)))) list.push({ n, r });
  };
  for (let t = 0; t < triangleCount(b); t++) {
    const face = faces.get(b.faceIds[t]);
    let n: V3;
    if (face?.planar) {
      if (face.width < sliver) continue;
      n = face.n;
    } else {
      const v = corners(b, t);
      const normal = cross(sub(v[1], v[0]), sub(v[2], v[0]));
      if (triWidth(v, normal) < sliver) continue;
      n = unit(normal);
    }
    const r = shiftOf(b.faceIds[t]);
    for (let k = 0; k < 3; k++) push(b.triangles[3 * t + k], n, r);
  }
  const positions = Float32Array.from(b.positions);
  for (const [i, list] of constraints) {
    if (!list.some((c) => c.r !== 0)) continue;
    const d = minimalShift(list);
    for (let k = 0; k < 3; k++) positions[3 * i + k] = b.positions[3 * i + k] + d[k];
  }
  return positions;
}

// Returns a copy of the tool `b` in which the faces lying in the plane of faces of the body `a` are
// shifted by the overlap.
//   difference:  flush (same orientation) → the tool grows;  rests on it from outside → the tool shrinks
//   union:       flush or resting → the tool grows
// An intersection is not adjusted.
export function prepareTool(op: BooleanOp, a: Solid, b: Solid, t: Tolerances): { tool: Solid; shifts: Map<number, Shift> } {
  const shifts = new Map<number, Shift>(); // face number of the tool → shift
  if (op === 'intersection') return { tool: b, shifts };
  const bodyFaces = [...fitFaces(a, t.tol).values()].filter((f) => f.planar && f.width >= t.sliver);
  const toolFaces = fitFaces(b, t.tol);
  for (const B of toolFaces.values()) {
    if (!B.planar || B.width < t.sliver) continue;
    let chosen: number | null = null;
    let behind = Infinity; // distance of the nearest parallel face of the body just behind the face of the tool (towards the inside of the tool)
    for (const A of bodyFaces) {
      const c = dot(A.n, B.n);
      if (Math.abs(c) < 1 - 1e-6) continue; // not parallel
      const offset = c * A.d - B.d; // position of the face of the body relative to the face of the tool along its normal
      if (Math.abs(offset) > t.tol) {
        // not in one plane, but a shrunk tool could jump over it
        if (offset < 0 && -offset <= t.overlap + t.tol && facesOverlap(A, B, -2 * t.overlap)) behind = Math.min(behind, -offset);
        continue;
      }
      const shift = op === 'difference' && c < 0 ? -t.overlap : t.overlap;
      // In one plane, but somewhere else? A touch or a gap of up to two overlaps is enough: the side
      // of a boss touches the side of the body only at an edge, and a face that is not shifted itself
      // is stretched by the overlap when its neighbouring faces are shifted, and would touch only then.
      if (!facesOverlap(A, B, -2 * t.overlap)) continue;
      // A face of the tool can meet two oppositely oriented faces of the body in the same plane (a top
      // face and the underside of an overhang). Growing takes precedence: shrinking would leave
      // a membrane on the flush part.
      if (shift > 0) {
        chosen = shift;
        break;
      }
      chosen ??= shift;
    }
    if (chosen === null) continue;
    // A shrunk tool must not jump over a face of the body that lies just behind its face: the material
    // between them would remain as a membrane. It is shifted only to half of the gap.
    if (chosen < 0 && behind < Infinity) chosen = -Math.min(t.overlap, behind / 2);
    shifts.set(B.id, { r: chosen, n: B.n, d: B.d });
  }
  if (shifts.size === 0) return { tool: b, shifts };
  return { tool: { ...b, positions: moveVertices(b, toolFaces, t.sliver, (id) => shifts.get(id)?.r ?? 0) }, shifts };
}

interface Plane {
  v: [V3, V3, V3];
  n: V3;
  d: number;
}

// After the boolean, returns everything left in the result from the shift of the faces of the tool,
// and cleans the mesh. The positions are not estimated from the neighbourhood but computed exactly
// from the original, unshifted geometry. Every vertex of the result is either a vertex of one of the
// bodies or an intersection of an edge of one body with a face of the other:
//  - a shifted vertex of the tool → the original vertex of the tool,
//  - an intersection of an edge of the tool whose end was shifted (diagonals of the triangulation
//    included) with a face of the body → the intersection of the original edge with the plane of
//    that face,
//  - an intersection of an edge of the body with a shifted face of the tool, or another vertex in
//    the band between the original and the shifted plane → the intersection of that edge of the
//    body with the original plane.
// An intersection that would lie outside the ends of the original edge does not exist in the exact
// geometry; it is pulled to the nearer end and the cleaning of the mesh then welds it.
// `original` is the tool before the shift, `shifted` after it, `body` the body, `out` the result of the boolean.
export function restoreShifted(out: Solid, shifts: Map<number, Shift>, original: Solid, shifted: Solid, body: Solid, t: Tolerances): Solid {
  const toolIds = new Set(original.faceIds);
  const param = (p: V3, a: V3, b: V3): number => {
    const ab = sub(b, a);
    const l2 = dot(ab, ab);
    return l2 === 0 ? 0 : dot(sub(p, a), ab) / l2;
  };
  const clamp = (s: number) => Math.min(1, Math.max(0, s));
  const pointAt = (a: V3, b: V3, s: number): V3 => add(a, mul(sub(b, a), s));
  const eachEdge = (mesh: Solid, each: (i: number, j: number) => void) => {
    const seen = new Set<number>();
    for (let k = 0; k < triangleCount(mesh); k++) {
      for (let q = 0; q < 3; q++) {
        const i = mesh.triangles[3 * k + q];
        const j = mesh.triangles[3 * k + ((q + 1) % 3)];
        const key = i < j ? i * 4294967296 + j : j * 4294967296 + i;
        if (seen.has(key)) continue;
        seen.add(key);
        each(i, j);
      }
    }
  };
  // A point right next to an end of the edge is taken as that end: for an edge that crosses the plane
  // at a small angle, the position along the edge has an error much larger than the precision of the
  // coordinates, and beside the real vertex a second one would appear, too far to be welded and too
  // close for the mesh to stay unfolded.
  const snapToEnd = (p: V3, a: V3, b: V3): V3 => (len(sub(p, a)) <= t.onPlane ? a : len(sub(p, b)) <= t.onPlane ? b : p);
  // intersection of the segment a–b with the plane n·x = d; outside the segment the nearer end is taken
  const hit = (a: V3, b: V3, n: V3, d: number): V3 | null => {
    const dir = sub(b, a);
    const den = dot(n, dir);
    if (Math.abs(den) < 1e-4 * len(dir)) return null; // the edge lies in the plane (or nearly): the intersection is not determined
    return snapToEnd(pointAt(a, b, clamp((d - dot(n, a)) / den)), a, b);
  };

  const movedVertices: { now: V3; was: V3 }[] = [];
  for (let i = 0; i < original.positions.length / 3; i++) {
    const was = vertex(original, i);
    const now = vertex(shifted, i);
    if (len(sub(now, was)) > 0) movedVertices.push({ now, was });
  }
  const movedEdges: { a0: V3; b0: V3; a1: V3; b1: V3 }[] = [];
  eachEdge(original, (i, j) => {
    const a0 = vertex(original, i);
    const b0 = vertex(original, j);
    const a1 = vertex(shifted, i);
    const b1 = vertex(shifted, j);
    if (len(sub(a1, a0)) > 0 || len(sub(b1, b0)) > 0) movedEdges.push({ a0, b0, a1, b1 });
  });

  let bodyEdges: [V3, V3][] | null = null;
  let bodyPlanes: Map<number, Plane[]> | null = null;
  // triangles of the body (with a face from ids) in which the point p lies
  const bodyPlanesAt = (p: V3, ids: number[]): Plane[] => {
    if (!bodyPlanes) {
      bodyPlanes = new Map();
      for (let k = 0; k < triangleCount(body); k++) {
        const v = corners(body, k);
        const normal = cross(sub(v[1], v[0]), sub(v[2], v[0]));
        if (triWidth(v, normal) < t.weld) continue;
        const n = unit(normal);
        const id = body.faceIds[k];
        const list = bodyPlanes.get(id);
        if (list) list.push({ v, n, d: dot(n, v[0]) });
        else bodyPlanes.set(id, [{ v, n, d: dot(n, v[0]) }]);
      }
    }
    const found: Plane[] = [];
    for (const id of ids) {
      for (const tri of bodyPlanes.get(id) ?? []) {
        if (Math.abs(dot(tri.n, p) - tri.d) > t.onPlane) continue;
        let inside = true; // inside the triangle (with a margin)?
        for (let q = 0; q < 3 && inside; q++) {
          const e = sub(tri.v[(q + 1) % 3], tri.v[q]);
          if (dot(cross(e, sub(p, tri.v[q])), tri.n) < -t.onPlane * len(e)) inside = false;
        }
        if (inside) found.push(tri);
      }
    }
    return found;
  };

  const incident = new Map<number, Set<number>>(); // vertex → numbers of the faces it touches
  for (let k = 0; k < triangleCount(out); k++) {
    for (let q = 0; q < 3; q++) {
      const i = out.triangles[3 * k + q];
      const set = incident.get(i);
      if (set) set.add(out.faceIds[k]);
      else incident.set(i, new Set([out.faceIds[k]]));
    }
  }
  const positions = Float32Array.from(out.positions);
  for (const [i, ids] of incident) {
    if (![...ids].some((id) => toolIds.has(id))) continue;
    const p = vertex(out, i);
    let target: V3 | null = null;
    const moved = movedVertices.find((v) => len(sub(p, v.now)) <= t.onPlane);
    if (moved) target = moved.was;
    else {
      // The edge of the tool the vertex lies on. It counts only where the edge really moved: next to
      // its unshifted end lie vertices of other edges too, which are not returned.
      let edge: (typeof movedEdges)[number] | null = null;
      let nearest = Infinity;
      for (const e of movedEdges) {
        const s = clamp(param(p, e.a1, e.b1));
        const off = len(sub(p, pointAt(e.a1, e.b1, s)));
        if (off > t.onPlane || off >= nearest) continue;
        if (len(sub(pointAt(e.a1, e.b1, s), pointAt(e.a0, e.b0, s))) > t.onPlane) {
          edge = e;
          nearest = off;
        }
      }
      if (edge) {
        // The plane of the face of the body that the edge crosses. The vertex can lie on several faces
        // of the body, and the edge can lie wholly in one of them (a vertical edge of a cylinder in the
        // plane of a side); the most transverse one is taken.
        const dir = unit(sub(edge.b0, edge.a0));
        let plane: Plane | null = null;
        for (const c of bodyPlanesAt(p, [...ids].filter((id) => !toolIds.has(id)))) {
          if (!plane || Math.abs(dot(c.n, dir)) > Math.abs(dot(plane.n, dir))) plane = c;
        }
        // When the edge crosses no face of the body transversely: the nearest point of the original edge.
        target =
          (plane && hit(edge.a0, edge.b0, plane.n, plane.d)) ??
          snapToEnd(pointAt(edge.a0, edge.b0, clamp(param(p, edge.a0, edge.b0))), edge.a0, edge.b0);
      } else {
        const bands = [...shifts.values()].filter((shift) => {
          const along = (dot(shift.n, p) - shift.d) * Math.sign(shift.r);
          return along > t.onPlane && along <= Math.abs(shift.r) + t.onPlane;
        });
        if (bands.length === 0) continue;
        if (!bodyEdges) {
          const edges: [V3, V3][] = [];
          eachEdge(body, (a, b) => edges.push([vertex(body, a), vertex(body, b)]));
          bodyEdges = edges;
        }
        let bodyEdge: [V3, V3] | null = null;
        let bodyEdgeOff = Infinity;
        for (const e of bodyEdges) {
          const off = len(sub(p, pointAt(e[0], e[1], clamp(param(p, e[0], e[1])))));
          if (off <= t.onPlane && off < bodyEdgeOff) {
            bodyEdge = e;
            bodyEdgeOff = off;
          }
        }
        target = bodyEdge ? hit(bodyEdge[0], bodyEdge[1], bands[0].n, bands[0].d) : null;
        if (!target) {
          // perpendicularly into the original planes
          target = p;
          for (const shift of bands) target = sub(target, mul(shift.n, dot(shift.n, target) - shift.d));
        }
      }
    }
    for (let k = 0; k < 3; k++) positions[3 * i + k] = target[k];
  }
  return clean({ ...out, positions }, t.weld);
}
