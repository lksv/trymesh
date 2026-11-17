// The plane feature: a plane of its own, offset from a base plane, another plane or a planar face;
// optionally the midplane of the base and a second plane, and tilted about an axis (D60). The parts
// are applied in the order base, midplane, tilt, offset (types.ts, `PlaneFeature`).
import type { NumberSpec } from '../catalog';
import { axis as axisOf, frame as frameOf } from '../recompute/services';
import type { Step, StepContext } from '../recompute/state';
import { toWorld } from '../solid';
import type { AxisRef, Facts, Frame, PlaneFeature, Vec3 } from '../types';
import { ANGLE_TOLERANCE, add3, cross3, dot3, len3, mul3, sub3, unit3 } from '../util';
import { type Dict, type ValidationContext, axisRef, axisRefs, base, object, onlyFields, planeRef, planeRefs } from '../validation';
import type { FeatureModule } from './module';

const OFFSET: NumberSpec = { title: 'Offset', unit: 'mm' };
// No default: a tilt is given whole, so `setField` cannot add one (D44).
export const TILT_ANGLE: NumberSpec = { title: 'Tilt angle', unit: 'rad', min: { value: -Math.PI }, max: { value: Math.PI } };

function planeFeature(o: Dict, what: string, context: ValidationContext): PlaneFeature {
  const feature: PlaneFeature = { ...base(o, what), type: 'plane', base: planeRef(context, o.base, `${what}.base`), offset: context.fields.number(o.offset, 'offset', OFFSET, `${what}.offset`) };
  if (o.midplaneWith !== undefined) feature.midplaneWith = planeRef(context, o.midplaneWith, `${what}.midplaneWith`);
  if (o.tilt !== undefined) {
    const tilt = object(o.tilt, `${what}.tilt`);
    onlyFields(tilt, ['axis', 'angle'], `${what}.tilt`, 'a tilt');
    feature.tilt = { axis: axisRef(context, tilt.axis, `${what}.tilt.axis`), angle: context.fields.number(tilt.angle, 'tilt/angle', TILT_ANGLE, `${what}.tilt.angle`) };
  }
  return feature;
}

// A vector turned by the rotation that takes the unit vector `from` to the unit vector `to`, the
// smallest one (about `from × to`). Stable for a small turn; `from · to` must be above −1.
function turnedOnto(v: Vec3, from: Vec3, to: Vec3): Vec3 {
  const k = cross3(from, to);
  const c = dot3(from, to);
  return add3(add3(mul3(v, c), cross3(k, v)), mul3(k, dot3(k, v) / (1 + c)));
}

// A vector turned by `angle` about the unit direction `d` (Rodrigues; the right-hand rule).
function turnedAbout(v: Vec3, d: Vec3, angle: number): Vec3 {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return add3(add3(mul3(v, c), mul3(cross3(d, v), s)), mul3(d, dot3(d, v) * (1 - c)));
}

const clean = (v: Vec3): Vec3 => [v[0] + 0, v[1] + 0, v[2] + 0]; // no negative zero

// The midplane of two frames (step 2). With n1, n2 the normals and s1, s2 the signed distances from
// the two planes: when n1 · n2 ≤ sin(ANGLE_TOLERANCE) (the normals look away from each other, or are at
// a right angle within the tolerance) the plane s1 = s2, normal
// n1 − n2; otherwise the plane s1 = −s2, normal n1 + n2. So the bisector nearer to the base (turned
// by at most 45° from it), and for parallel planes the plane in the middle with the normal of the
// base. The frame is that of `base` turned by the smallest rotation that takes its normal to the
// normal of the midplane, its origin moved along that normal into the midplane. Never fails: the
// sum or the difference is at least √2 long.
export function midplaneFrame(base: Frame, second: Frame): Frame {
  const [n1, n2] = [base.normal, second.normal];
  // planes at a right angle within the angle tolerance count as at a right angle: the product of
  // perpendicular normals turned by a rotation that is not about an axis of the model is noise of
  // either sign, and the bisector must not depend on it
  const apart = dot3(n1, n2) <= Math.sin(ANGLE_TOLERANCE);
  const m = apart ? sub3(n1, n2) : add3(n1, n2);
  const length = len3(m);
  const normal = mul3(m, 1 / length);
  const c = (dot3(n1, base.origin) + (apart ? -1 : 1) * dot3(n2, second.origin)) / length;
  const origin = add3(base.origin, mul3(normal, c - dot3(normal, base.origin)));
  return { origin: clean(origin), x: clean(unit3(turnedOnto(base.x, n1, normal))), y: clean(unit3(turnedOnto(base.y, n1, normal))), normal: clean(normal) };
}

// The tilted frame (step 3), or why there is none: `frame` moved along its normal until it contains
// the point of the axis, then turned about the axis by `angle` (its origin about the point of the
// axis, its x, y and normal as directions). The axis has to be parallel to the plane within
// `ANGLE_TOLERANCE`; its direction is first made exactly parallel (the part along the normal
// removed), so that the tilted plane contains the line exactly and the angle is the one asked for.
export function tiltedFrame(frame: Frame, axis: { point: Vec3; direction: Vec3 }, angle: number): Frame | { code: 'invalidAxis'; detail: string } {
  const n = frame.normal;
  const length = len3(axis.direction);
  const across = dot3(n, axis.direction) / length; // the sine of the angle between the axis and the plane
  if (Math.abs(across) > Math.sin(ANGLE_TOLERANCE)) {
    const degrees = (Math.asin(Math.min(1, Math.abs(across))) * 180) / Math.PI;
    return { code: 'invalidAxis', detail: `the axis of the tilt is at ${Number(degrees.toPrecision(6))}° to the plane it tilts; it has to be parallel to it` };
  }
  const d = unit3(sub3(axis.direction, mul3(n, dot3(n, axis.direction))));
  const p = axis.point;
  const moved = add3(frame.origin, mul3(n, dot3(n, sub3(p, frame.origin))));
  const turn = (v: Vec3): Vec3 => clean(turnedAbout(v, d, angle));
  return { origin: clean(add3(p, turnedAbout(sub3(moved, p), d, angle))), x: turn(frame.x), y: turn(frame.y), normal: turn(n) };
}

function step(feature: PlaneFeature, { state, done, failed }: StepContext): Step {
  const base = frameOf(feature.base, state);
  if (typeof base === 'string') return failed(base, [feature.base]);
  let frame: Frame = base;
  let facts: Facts | undefined;
  if (feature.midplaneWith) {
    const second = frameOf(feature.midplaneWith, state);
    if (typeof second === 'string') return failed(second, [feature.midplaneWith]);
    frame = midplaneFrame(frame, second);
  }
  if (feature.tilt) {
    const line = axisOf(feature.tilt.axis, state);
    if ('code' in line) return failed(line.code, line.refs, line.detail);
    const tilted = tiltedFrame(frame, line, feature.tilt.angle);
    if ('code' in tilted) return failed(tilted.code, [feature.tilt.axis], tilted.detail);
    // the axis used: its point, and its direction made parallel to the plane (the turn keeps it)
    const along = unit3(sub3(line.direction, mul3(frame.normal, dot3(frame.normal, line.direction))));
    facts = { axisPoint: line.point, axisDirection: clean(along) };
    frame = tilted;
  }
  frame = { ...frame, origin: toWorld(frame, 0, 0, feature.offset) };
  return { state: done({ status: 'ok', warnings: [], plane: frame, ...(facts ? { facts } : {}) }, { planes: { ...state.planes, [feature.id]: frame } }) };
}

const axisRefsOf = (axis: AxisRef) => axisRefs(axis, 'tilt/axis');

export const plane: FeatureModule<PlaneFeature> = {
  info: {
    title: 'Rovina',
    summary:
      'A plane of its own: offset from a base plane, another plane feature or a planar face of a body; optionally the midplane of the base and a second plane (`midplaneWith`) and tilted about an axis (`tilt`: the plane through the axis turned by an angle), in the order base, midplane, tilt, offset.',
    fields: [
      { path: 'offset', spec: OFFSET },
      { path: 'tilt/angle', spec: TILT_ANGLE },
    ],
    bodies: 'none',
  },
  validate: planeFeature,
  refs: (f) => [...planeRefs(f.base, 'base'), ...(f.midplaneWith ? planeRefs(f.midplaneWith, 'midplaneWith') : []), ...(f.tilt ? axisRefsOf(f.tilt.axis) : [])],
  createsBody: () => false,
  namesFaces: false,
  producesTool: () => false,
  patch: { fields: ['base', 'offset', 'midplaneWith', 'tilt'], removable: (_f, path) => path.length === 1 && (path[0] === 'midplaneWith' || path[0] === 'tilt') },
  step,
};
