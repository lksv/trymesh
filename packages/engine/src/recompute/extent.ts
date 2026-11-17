// The extent of a tool along the normal of its sketch plane.
import type { Region } from '../sketch';
import { toWorld } from '../solid';
import type { ExtrudeFeature, Frame, HoleExtent, Solid, Vec3 } from '../types';
import { LENGTH_TOLERANCE, cross3, dot3, len3, sub3, unit3 } from '../util';

// The interval of a tool along the normal of the sketch plane, measured from the plane: [start,
// end] with one level for the whole end, or the end as a level per point of the profile (a plane
// tilted against the sketch, `TiltedSpan`).
export type ToolSpan = [number, number] | TiltedSpan;
export interface TiltedSpan {
  start: number;
  end(u: number, v: number): number; // the level of the end under the point (u, v) of the sketch
  cap: { origin: Vec3; y: Vec3; normal: Vec3 }; // the plane of the end cap, for its description
}

// The interval of the tool along the normal of the sketch plane, measured from the plane: [start,
// end]. "Through all" takes the extent of all targets together along the normal (their vertices
// projected onto it) and adds an overshoot, so that the cap of the tool does not lie in a face of
// a body. The overshoot follows the largest coordinate of the targets and of the sketch plane, so
// it normally stays far above the resolution of the kernel adapter (about 1e-4 of the largest
// coordinate of body and tool). Where it does not (a profile much larger than the targets), the
// adapter takes the cap as flush with the face, which it handles like any flush face.
// A side on which the targets do not reach gets just the overshoot: the tool then misses them and
// the feature reports `noEffect`. The extent `upTo` is measured by `upToSpan`.
// The extent is the resolved one (`resolveStart`): a distance carries its effective start in
// `start`; `start` here is where "through all" starts (the level of its plane `from`, D66; 0
// without one), passed explicitly by every caller.
export function toolSpan(extent: Exclude<ResolvedExtent, { type: 'upTo' }>, frame: Frame, targets: Solid[], start: number): [number, number] {
  if (extent.type === 'distance') return [extent.start, extent.start + extent.distance];
  return throughAll(extent.side, frame, targets, start).span;
}

// What "through all" measures (D46 asks for the parts a hole needs), from `start`, the level along
// the normal it starts at (the level of a plane `from`, D66; 0 for the sketch plane and always for
// `both`):
// - `span`: the interval of the tool, as `toolSpan` answers it;
// - `reach`: how far the targets go from the start on the side asked for, without the overshoot
//   (zero when no vertex of a target lies on that side; for `both` the larger of the two sides).
//   It is measured on float32 positions against a frame in doubles, so a target that ends in the
//   plane of the start has a reach of noise, not of zero;
// - `scale`: the largest coordinate of the targets, of the sketch plane and of the start, which the
//   overshoot and the resolution of the kernel adapter follow;
// - `overshoot`: what is added beyond the reach.
export interface ThroughAll {
  span: [number, number];
  reach: number;
  scale: number;
  overshoot: number;
}
export function throughAll(side: 'forward' | 'backward' | 'both', frame: Frame, targets: Solid[], start: number): ThroughAll {
  let [low, high, scale] = [start, start, Math.max(...frame.origin.map(Math.abs), ...toWorld(frame, 0, 0, start).map(Math.abs))];
  for (const solid of targets) {
    const p = solid.positions;
    for (let i = 0; i < p.length; i += 3) {
      const along = (p[i] - frame.origin[0]) * frame.normal[0] + (p[i + 1] - frame.origin[1]) * frame.normal[1] + (p[i + 2] - frame.origin[2]) * frame.normal[2];
      low = Math.min(low, along);
      high = Math.max(high, along);
      scale = Math.max(scale, Math.abs(p[i]), Math.abs(p[i + 1]), Math.abs(p[i + 2]));
    }
  }
  const overshoot = Math.max(1, 0.01 * scale);
  if (side === 'forward') return { span: [start, high + overshoot], reach: high - start, scale, overshoot };
  if (side === 'backward') return { span: [start, low - overshoot], reach: start - low, scale, overshoot };
  return { span: [low - overshoot, high + overshoot], reach: Math.max(high - start, start - low), scale, overshoot };
}

// ---------------------------------------------------------------- the start at a plane (D66)

// The outline of a profile at the start, by the exact curves the builds put their vertices on, in
// the coordinates of the sketch: a line by its two ends, a circle (also the circle of an arc) by
// its centre and radius, and a curve without an exact form by the points of its polyline.
export type ExactCurve = { type: 'line'; a: [number, number]; b: [number, number] } | { type: 'circle'; center: [number, number]; radius: number } | { type: 'points'; xy: readonly number[] };

// The exact curves of the start of an extrusion: the `exact` curves of the loops of its regions
// (`Loop.exact`, the curves the polylines were divided from, as the taper reads them; for unoffset
// regions their ends are where the profile joined coincident ends, which may differ from the solved
// sketch by the join tolerance), each line by its ends, each arc by its whole circle and its two
// ends as points, each circle by itself; a loop without `exact` (a generated profile) by its
// vertices. Every vertex a build makes at the start lies on these curves: the prism, the rings of
// a taper however they resample the outline.
export function exactStart(regions: readonly Region[]): ExactCurve[] {
  const out: ExactCurve[] = [];
  for (const region of regions) {
    for (const loop of [region.outer, ...region.holes]) {
      if (!loop.exact) {
        out.push({ type: 'points', xy: loop.xy });
        continue;
      }
      for (const curve of loop.exact) {
        if (curve.type === 'line') out.push({ type: 'line', a: [curve.from[0], curve.from[1]], b: [curve.to[0], curve.to[1]] });
        else {
          out.push({ type: 'circle', center: [curve.center[0], curve.center[1]], radius: curve.radius });
          if (curve.type === 'arc') out.push({ type: 'points', xy: [curve.from[0], curve.from[1], curve.to[0], curve.to[1]] });
        }
      }
    }
  }
  return out;
}

// The level of the plane `from` in the frame a tool is built in: where the plane crosses the line
// along the normal of the sketch through a point of the outline, measured from the sketch plane,
// as the middle of its extremes over the exact outline at the start; or why the plane cannot be
// a start (`detail`).
// - A plane within `UP_TO_MIN_ANGLE` of the direction has no level worth the name (as for `upTo`).
// - The level is linear in (u, v), so a line is tested at its ends and a circle analytically (its
//   extremes are the level at the centre ± r · |gradient|); points one by one. A spread of more
//   than `LENGTH_TOLERANCE` is a plane tilted against the sketch: refused, not built.
// `what`: the feature the detail speaks of.
export function planeLevel(plane: EndPlane, frame: Frame, outline: readonly ExactCurve[], what: 'extrusion' | 'hole' = 'extrusion'): { level: number } | { detail: string } {
  const normal = unit3(plane.normal);
  const across = dot3(normal, frame.normal);
  if (Math.abs(across) <= Math.sin(UP_TO_MIN_ANGLE)) return { detail: `the start plane is parallel to the direction of the ${what}, or within 0.01 rad of it` };
  // level(u, v) = at + gu · u + gv · v
  const at = dot3(normal, sub3(plane.point, frame.origin)) / across;
  const [gu, gv] = [-dot3(normal, frame.x) / across, -dot3(normal, frame.y) / across];
  const gradient = Math.hypot(gu, gv);
  let [low, high] = [Infinity, -Infinity];
  const take = (value: number): void => {
    low = Math.min(low, value);
    high = Math.max(high, value);
  };
  const level = (u: number, v: number): number => at + gu * u + gv * v;
  for (const curve of outline) {
    if (curve.type === 'line') {
      take(level(curve.a[0], curve.a[1]));
      take(level(curve.b[0], curve.b[1]));
    } else if (curve.type === 'circle') {
      const centre = level(curve.center[0], curve.center[1]);
      take(centre - curve.radius * gradient);
      take(centre + curve.radius * gradient);
    } else for (let k = 0; k + 1 < curve.xy.length; k += 2) take(level(curve.xy[k], curve.xy[k + 1]));
  }
  // an empty outline (no profile reaches this point): the level at the origin of the sketch
  if (low > high) return { level: at };
  const spread = high - low;
  if (spread > LENGTH_TOLERANCE) {
    const tilt = Math.atan2(len3(cross3(normal, frame.normal)), Math.abs(across));
    // three digits, small numbers as powers of ten
    const shown = (value: number): string => {
      const short = Number(value.toPrecision(3));
      return short !== 0 && Math.abs(short) < 1e-3 ? short.toExponential() : String(short);
    };
    return {
      detail: `the start plane is tilted against the sketch plane by ${shown(tilt)} rad: its level differs by ${shown(spread)} mm over the profile, more than ${shown(LENGTH_TOLERANCE)} mm; put the sketch on that face, or start from a plane parallel to the sketch`,
    };
  }
  return { level: (low + high) / 2 };
}

// The extent the builds see, made once by the step of the feature: `from` dropped, and for
// `distance` and `upTo` `start` raised by the level of the plane (the effective start). "Through
// all" keeps its variant; the level goes to `toolSpan` and `throughAll` as their `start`. The same
// for the extrusion and the hole.
export type WithoutFrom<E> = E extends unknown ? Omit<E, 'from'> : never;
export type ResolvedExtent = WithoutFrom<ExtrudeFeature['extent']>;
export function resolveStart<E extends ExtrudeFeature['extent'] | HoleExtent>(extent: E, level: number): WithoutFrom<E> {
  const { from: _from, ...rest } = extent as ExtrudeFeature['extent'];
  return (rest.type === 'throughAll' ? rest : { ...rest, start: rest.start + level }) as WithoutFrom<E>;
}

// ---------------------------------------------------------------- up to a plane (D47)

// The plane an extent `upTo` ends in, in model coordinates: resolved once per recompute of the
// feature, in the state before it, and kept by the recipe of the tool.
export interface EndPlane {
  point: Vec3;
  normal: Vec3; // unit
}
// The smallest angle between the plane and the direction of the extrusion. It bounds every length
// by a hundred times the distance of the start from the plane (1 / sin 0.01 = 100.002), which is of
// the size of the model; a plane nearer to parallel is refused.
export const UP_TO_MIN_ANGLE = 0.01;
// What an extent `upTo` gives for a profile in a frame: the span of the tool and the lengths it got
// (positive, along the normal of the sketch plane; `forward` when along it).
export interface UpTo {
  span: ToolSpan;
  lengthMin: number;
  lengthMax: number;
  forward: boolean;
}

// The span of a tool that runs from `start` to the plane, for the points of the profile (the
// vertices of its polylines, which are the tool: the length is linear, so they test all of it).
// - The direction comes from the plane: the side of the start it lies on.
// - Refused (`detail` says why): a plane within `UP_TO_MIN_ANGLE` of the direction; a plane that
//   passes through the start or touches it (lengths of both signs, or one not beyond the length
//   tolerance); a gap that reaches the start.
// - The gap moves the plane along its own normal towards the side of the start.
// - When the lengths differ by no more than the length tolerance (a plane parallel to the sketch),
//   the tool gets one length, the middle of the extremes, and is the prism of a distance extent.
export function upToSpan(extent: Extract<ResolvedExtent, { type: 'upTo' }>, plane: EndPlane, frame: Frame, regions: Region[]): UpTo | { detail: string } {
  const normal = unit3(plane.normal);
  const across = dot3(normal, frame.normal);
  if (Math.abs(across) <= Math.sin(UP_TO_MIN_ANGLE)) return { detail: 'the plane is parallel to the direction of the extrusion, or within 0.01 rad of it' };
  const points: [number, number][] = [];
  for (const region of regions) for (const loop of [region.outer, ...region.holes]) for (let k = 0; k < loop.xy.length; k += 2) points.push([loop.xy[k], loop.xy[k + 1]]);
  // the length from the start under (u, v) to the plane through `at`
  const lengthTo = (at: Vec3, u: number, v: number): number => dot3(normal, sub3(at, toWorld(frame, u, v, extent.start))) / across;
  const lengths = points.map(([u, v]) => lengthTo(plane.point, u, v));
  const forward = lengths[0] > 0;
  if (!lengths.every((length) => (forward ? length > LENGTH_TOLERANCE : length < -LENGTH_TOLERANCE))) return { detail: 'the plane passes through the start of the extrusion or touches it' };
  // the side of the plane the start lies on, and the plane moved towards it by the gap
  const side = Math.sign(dot3(normal, sub3(toWorld(frame, points[0][0], points[0][1], extent.start), plane.point)));
  const gap = extent.gap ?? 0;
  const moved: Vec3 = [plane.point[0] + normal[0] * side * gap, plane.point[1] + normal[1] * side * gap, plane.point[2] + normal[2] * side * gap];
  const ends = points.map(([u, v]) => lengthTo(moved, u, v));
  if (!ends.every((length) => (forward ? length > LENGTH_TOLERANCE : length < -LENGTH_TOLERANCE))) return { detail: `the gap of ${gap} mm is as large as the way to the plane` };
  const [low, high] = [Math.min(...ends), Math.max(...ends)];
  const [lengthMin, lengthMax] = forward ? [low, high] : [-high, -low];
  if (high - low <= LENGTH_TOLERANCE) {
    const length = (low + high) / 2;
    return { span: [extent.start, extent.start + length], lengthMin: Math.abs(length), lengthMax: Math.abs(length), forward };
  }
  const end = (u: number, v: number): number => extent.start + lengthTo(moved, u, v);
  const origin = toWorld(frame, 0, 0, end(0, 0));
  const y = unit3(sub3(toWorld(frame, 0, 1, end(0, 1)), origin));
  return { span: { start: extent.start, end, cap: { origin, y, normal } }, lengthMin, lengthMax, forward };
}
