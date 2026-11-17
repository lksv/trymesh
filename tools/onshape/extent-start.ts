// The start of an extrusion at a face (D66) and the end of `upTo` at a face (D47), for the
// converter: which trymesh face is the Onshape face an extent starts or ends at. Pure functions over
// what the query `body` answers, so that they can be tested without Onshape data.
import type { FaceName, Id, PlaneRef } from '../../packages/engine/src/index';
import { type V3, dot, sub } from './common';

// A planar face of a trymesh body as the query `body` describes it: a point and the normal of its
// plane, and its normal out of the body.
export interface FaceCandidate {
  body: Id;
  name: FaceName;
  origin: V3;
  normal: V3;
  meshNormal: V3;
}
// The Onshape face: a point of its plane and its normal out of its part (`evPlane` of the dump).
export interface OnshapeFace {
  origin: V3;
  normal: V3;
}

// The trymesh face that is the Onshape face, among the planar faces of the trymesh features made
// for the Onshape feature that created it (`made`):
// - a cap (`startCap`, `endCap`) of one of them;
// - in the plane of the Onshape face: the normals parallel within 1e-6, the point within 1e-3 mm;
// - with its normal out of the body along the Onshape face's normal out of its part. The two caps of
//   a very short extrusion lie within 1e-3 mm of one plane, but their outward normals are opposite:
//   so the normal also tells the cap role, the start or the end of the extrusion.
// One candidate is the face. Several, all of features made for the one Onshape extrusion (an
// extrusion split into groups shares its extent, so the faces move together): the first by the ID
// of its feature, with a note. None: why, for the report.
export function faceOf(candidates: readonly FaceCandidate[], face: OnshapeFace, made: readonly Id[]): { ref: PlaneRef; note?: string } | { reason: string } {
  const found = candidates.filter(
    (c) =>
      made.includes(c.name.feature) &&
      (c.name.role === 'startCap' || c.name.role === 'endCap') &&
      c.name.copy === undefined &&
      Math.abs(Math.abs(dot(c.normal, face.normal)) - 1) <= 1e-6 &&
      Math.abs(dot(sub(face.origin, c.origin), face.normal)) <= 1e-3 &&
      dot(c.meshNormal, face.normal) > 0,
  );
  if (!found.length) return { reason: 'no cap of the features made for it lies in its plane with its normal' };
  const sorted = [...found].sort((a, b) => (a.name.feature < b.name.feature ? -1 : a.name.feature > b.name.feature ? 1 : a.name.role < b.name.role ? -1 : 1));
  const ref: PlaneRef = { kind: 'face', body: sorted[0].body, face: sorted[0].name };
  return found.length === 1 ? { ref } : { ref, note: `${found.length} faces in its plane (${sorted.map((c) => `${c.name.feature}/${c.name.role}`).join(', ')}), the first taken` };
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
