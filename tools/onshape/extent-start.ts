// The start of an extrusion at a face (D66) and the end of `upTo` at a face (D47), for the
// converter: which trymesh face is the Onshape face an extent starts or ends at. Pure functions over
// what the query `body` answers, so that they can be tested without Onshape data.
import type { FaceName, Id, PlaneRef } from '../../packages/engine/src/index';
import { type V3, dot, sub } from './common';

// A planar face of a trymesh body as the query `body` describes it: a point and the normal of its
// plane, its normal out of the body, and the edges that bound it (lines by their ends, circles by
// their centre and radius), for telling coplanar faces apart.
export type BoundaryEdge = { kind: 'line'; from: V3; to: V3 } | { kind: 'circle'; center: V3; radius: number };
export interface FaceCandidate {
  body: Id;
  name: FaceName;
  origin: V3;
  normal: V3;
  meshNormal: V3;
  boundary?: BoundaryEdge[];
}
// The Onshape face: a point of its plane, its normal out of its part (`evPlane` of the dump), and
// the midpoints of its boundary edges (`m` of the dump's edges).
export interface OnshapeFace {
  origin: V3;
  normal: V3;
  edges?: V3[];
}

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// Does a point lie on an edge (within 1e-3 mm)?
function onEdge(p: V3, e: BoundaryEdge): boolean {
  if (e.kind === 'circle') return Math.abs(Math.hypot(...sub(p, e.center)) - e.radius) <= 1e-3;
  const d = sub(e.to, e.from);
  const length = Math.hypot(...d);
  if (length === 0) return false;
  const t = dot(sub(p, e.from), d) / (length * length);
  return t >= -1e-6 && t <= 1 + 1e-6 && Math.hypot(...cross(sub(p, e.from), d)) / length <= 1e-3;
}

// The trymesh face that is the Onshape face, among the planar faces of trymesh extrusions:
// - a cap (`startCap`, `endCap`) of a feature of `made`;
// - in the plane of the Onshape face: the normals parallel within 1e-6 (|cross| ≤ 1e-6), the point
//   within 1e-3 mm;
// - with its normal out of the body along the Onshape face's normal out of its part. The two caps of
//   a very short extrusion lie within 1e-3 mm of one plane, but their outward normals are opposite:
//   so the normal also tells the cap role, the start or the end of the extrusion.
// One candidate is the face. Several:
// - `oneFeature` (the provenance is known: `made` are the extrusions made for the one Onshape
//   extrusion that created the face, which share its extent, so the faces move together): the first
//   by the ID of its feature, with a note;
// - otherwise (the face was consumed later, so the dump does not say which feature created it, and
//   `made` are the extrusions of the body that owned it): the one candidate on whose boundary the
//   most midpoints of the Onshape face's edges lie, when it is one and holds at least one; else
//   none, as ambiguous.
// None: why, for the report.
export function faceOf(candidates: readonly FaceCandidate[], face: OnshapeFace, made: readonly Id[], oneFeature = true): { ref: PlaneRef; note?: string } | { reason: string } {
  const found = candidates.filter(
    (c) =>
      made.includes(c.name.feature) &&
      (c.name.role === 'startCap' || c.name.role === 'endCap') &&
      c.name.copy === undefined &&
      Math.hypot(...cross(c.normal, face.normal)) <= 1e-6 &&
      Math.abs(dot(sub(face.origin, c.origin), face.normal)) <= 1e-3 &&
      dot(c.meshNormal, face.normal) > 0,
  );
  if (!found.length) return { reason: 'no cap of the features it may come from lies in its plane with its normal' };
  const refOf = (c: FaceCandidate): PlaneRef => ({ kind: 'face', body: c.body, face: c.name });
  if (found.length === 1) return { ref: refOf(found[0]) };
  const sorted = [...found].sort((a, b) => (a.name.feature < b.name.feature ? -1 : a.name.feature > b.name.feature ? 1 : a.name.role < b.name.role ? -1 : 1));
  const listed = sorted.map((c) => `${c.name.feature}/${c.name.role}`).join(', ');
  if (oneFeature) return { ref: refOf(sorted[0]), note: `${found.length} faces in its plane (${listed}), the first taken` };
  const scores = sorted.map((c) => (face.edges ?? []).filter((m) => (c.boundary ?? []).some((e) => onEdge(m, e))).length);
  const best = Math.max(...scores);
  if (best > 0 && scores.filter((score) => score === best).length === 1) return { ref: refOf(sorted[scores.indexOf(best)]), note: `${found.length} faces in its plane (${listed}); the one its boundary matches taken` };
  return { reason: `${found.length} faces in its plane (${listed}) and its boundary does not tell which` };
}

// What the extent of a converted extrusion is made of: the Onshape end (`BLIND`, `THROUGH_ALL` or
// an end at a face), `symmetric`, the direction (`dir`, ±1, and `s`, the sign of the Onshape normal
// against the trymesh one), the start along the Onshape normal from the sketch (`start`, for a face
// its offset), the depth, the face the extent starts at when one was found (`from`), the end at
// a face (`end`: its plane when one was found, and its offset from the sketch less the gap), and how
// to get a plane feature at the level of a numeric start.
export interface ExtentInput {
  endBound: 'BLIND' | 'THROUGH_ALL' | 'UP_TO';
  symmetric: boolean;
  dir: number;
  s: number;
  start: number;
  depth?: number | string;
  from?: PlaneRef;
  end?: { plane?: PlaneRef; level: number };
  startPlane: () => PlaneRef;
}
// The trymesh extent. A symmetric "through all" goes to both sides of any start, which are all of
// the targets: `{ type: 'throughAll', side: 'both' }` whatever its start (both sides from a plane
// are refused, one side would lose half of the cut). One-sided "through all" from a face starts
// from it, from a numeric offset from a plane feature at that offset.
export function extentFor(x: ExtentInput): any {
  const neg = (v: number | string) => (typeof v === 'number' ? -v : `-(${v})`);
  const numeric = x.s * x.start;
  const along = (forward: boolean) => (forward ? x.depth : neg(x.depth!));
  switch (x.endBound) {
    case 'BLIND':
      if (x.from) return { type: 'distance', from: x.from, start: startFromFace(x.symmetric, x.depth!, x.s), distance: along(x.symmetric ? x.s > 0 : x.dir * x.s > 0) };
      if (x.symmetric) return { type: 'distance', start: typeof x.depth === 'number' ? x.s * (x.start - x.depth / 2) : `${numeric} ${x.s > 0 ? '-' : '+'} (${x.depth}) / 2`, distance: along(x.s > 0) };
      return { type: 'distance', start: numeric, distance: along(x.dir * x.s > 0) };
    case 'THROUGH_ALL': {
      if (x.symmetric) return { type: 'throughAll', side: 'both' };
      const side = x.dir * x.s > 0 ? 'forward' : 'backward';
      if (x.from) return { type: 'throughAll', side, from: x.from };
      if (x.start === 0) return { type: 'throughAll', side };
      return { type: 'throughAll', side, from: x.startPlane() };
    }
    default: {
      const end = x.end as NonNullable<ExtentInput['end']>;
      if (end.plane) return { type: 'upTo', ...(x.from ? { from: x.from } : {}), start: x.from ? 0 : numeric, plane: end.plane };
      return { type: 'distance', ...(x.from ? { from: x.from, start: 0 } : { start: numeric }), distance: x.s * (end.level - x.start) };
    }
  }
}

// The start offset of an extent `from` a face, along the normal of the trymesh sketch: 0 for a blind
// extrusion; for a symmetric one the half of the depth on the other side (`s` the sign of the
// Onshape normal against the trymesh one), with the expression of the depth when it has one.
export function startFromFace(symmetric: boolean, depth: number | string, s: number): number | string {
  if (!symmetric) return 0;
  if (typeof depth === 'number') return (-s * depth) / 2;
  return s > 0 ? `-(${depth}) / 2` : `(${depth}) / 2`;
}
