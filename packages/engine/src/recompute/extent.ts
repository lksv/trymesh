// The extent of a tool along the normal of its sketch plane.
import type { Region } from '../sketch';
import { toWorld } from '../solid';
import type { ExtrudeFeature, Frame, Solid, Vec3 } from '../types';
import { LENGTH_TOLERANCE, dot3, sub3, unit3 } from '../util';

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
export function toolSpan(extent: Exclude<ExtrudeFeature['extent'], { type: 'upTo' }>, frame: Frame, targets: Solid[]): [number, number] {
  if (extent.type === 'distance') return [extent.start, extent.start + extent.distance];
  let [low, high, reach] = [0, 0, Math.max(...frame.origin.map(Math.abs))];
  for (const solid of targets) {
    const p = solid.positions;
    for (let i = 0; i < p.length; i += 3) {
      const along = (p[i] - frame.origin[0]) * frame.normal[0] + (p[i + 1] - frame.origin[1]) * frame.normal[1] + (p[i + 2] - frame.origin[2]) * frame.normal[2];
      low = Math.min(low, along);
      high = Math.max(high, along);
      reach = Math.max(reach, Math.abs(p[i]), Math.abs(p[i + 1]), Math.abs(p[i + 2]));
    }
  }
  const overshoot = Math.max(1, 0.01 * reach);
  if (extent.side === 'forward') return [0, high + overshoot];
  if (extent.side === 'backward') return [0, low - overshoot];
  return [low - overshoot, high + overshoot];
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
export function upToSpan(extent: Extract<ExtrudeFeature['extent'], { type: 'upTo' }>, plane: EndPlane, frame: Frame, regions: Region[]): UpTo | { detail: string } {
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
