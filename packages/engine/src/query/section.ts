// The query `section` (D38): what a plane cuts out of the bodies. Closed loops with their areas
// and, for every piece of a loop, the face it lies on. One pass over the triangles of a body, no
// kernel, so the names of the faces are kept. The section view of the app and a picture of a cut
// model draw from the same answer (`completeRegions`, `takenAt`).
import { coordinatePrecision } from '../mesh-distance';
import type { FaceName, Frame, Id, Solid, Surface, Truncated, Vec2, Vec3 } from '../types';
import { ANGLE_TOLERANCE, add3, cross2, cross3, dist2, dot2, dot3, len2, len3, mul3, sub2, sub3, unit3 } from '../util';
import type { ArgSpecs } from './args';
import { QueryFailure, type QuerySpec } from './spec';

// - `plane`: a base plane, a plane feature or a planar face (`PlaneRef`, as features use it).
// - `offset`: the plane is moved by this along its normal. For a face the normal points out of
//   the body, so a negative offset cuts into it.
// - `flip`: the section is seen from the other side: the normal and the x axis of the frame are
//   reversed (after the offset). It decides which side the app cuts away. The section is taken
//   just below the plane (see `cut`), and "below" turns with the normal: a body that ends in the
//   plane shows its face as its section one way and is absent the other way. For a body the
//   plane goes through, the loops are those of a plane twice `below` away from the first, seen
//   from the other side. How much they differ depends on the body: `below` times the slope of
//   a wall, and near a wall that runs almost along the plane, or a feature that ends within
//   that distance, even the number of loops can change.
// - `bodies`: only these; without it all bodies of the state.
// - `outline`: how a loop is written. `spans` (the default) is for reading: lines and arcs
//   rebuilt from the surfaces, and what has no such form as a curve. `polylines` is for drawing:
//   every loop as the polygon the mesh gives.
// - `maxPoints`: the budget of the answer, counted in items: a span is one, a point of a curve
//   or of a polyline is one, a loop written as a polyline is one. What does not fit is left out
//   whole and counted (see `SectionResult`).
export const SECTION_ARGS = {
  plane: { kind: 'plane', title: 'Cutting plane', summary: 'A base plane, a plane feature or a planar face.' },
  offset: { kind: 'number', title: 'Offset', summary: 'Moves the plane along its normal.', optional: true, spec: { title: 'Offset along the normal', unit: 'mm', default: 0 } },
  flip: { kind: 'flag', title: 'From the other side', optional: true },
  bodies: { kind: 'list', of: { kind: 'body' }, min: 1, title: 'Bodies', summary: 'Without it all bodies.', optional: true },
  outline: { kind: 'choice', options: ['spans', 'polylines'], title: 'Form of a loop', summary: 'spans: lines, arcs and curves with the face each lies on (the default). polylines: the points of every loop, for drawing.', optional: true },
  maxPoints: { kind: 'number', title: 'Budget', summary: 'The budget of the answer: spans, loops of polylines and points together.', optional: true, spec: { title: 'Most spans, loops and points to return', unit: 'count', integer: true, min: { value: 0 }, default: 500 } },
} as const satisfies ArgSpecs;

// ---------------------------------------------------------------- the result

// A piece of a loop that lies on one face of the body, from `from` to `to` in the coordinates of
// the cutting plane. What it is follows from the surface of the face and from how the plane
// meets it, not from a fit:
//
// surface   | the plane meets it                | span
// plane     | any way                           | line
// cylinder  | across the axis                   | arc
// cylinder  | along the axis                    | line
// cone      | across the axis                   | arc
// swept     | along the direction of the sweep  | line
// anything  | otherwise                         | curve
//
// "Across" and "along" are within `ANGLE_TOLERANCE`.
// - `from` and `to` are corners of the polygon the mesh gives, so the spans of a loop join
//   exactly: each starts where the one before it ends.
// - `arc`: `center` and `radius` are those of the exact surface. The two ends are points of the
//   mesh: on the circle, within the precision of the coordinates, where the arc ends in a vertex
//   of its polygon; inside it by up to the sagitta of a side of the polygon where another face
//   cuts the round face between two vertices. That sagitta is within the chord tolerance of the
//   document except above the caps on the number of segments. `sweep` is the angle from `from`
//   to `to` about `center` along the loop, positive counter-clockwise; a whole circle has `from`
//   equal to `to` and a sweep of 2π or −2π.
// - `curve`: `count` points from `from` to `to`, both included. A curve that is a whole loop
//   has `from` equal to `to`; its points are the corners of the loop once, the first not
//   repeated (as in a polyline), and `count` is their number. `length` is the length of that
//   piece of the polygon the mesh gives, as the length of a loop is (see `cut`); for a whole
//   loop it is the length of the loop. `points` are there only while they fit the budget.
export type SectionSpan = { face: FaceName; from: Vec2; to: Vec2 } & ({ kind: 'line' } | { kind: 'arc'; center: Vec2; radius: number; sweep: number } | { kind: 'curve'; count: number; length: number; points?: Vec2[] });

// A closed loop. `area` and `length` are of the polygon the mesh gives (taken before the points
// that are not corners are dropped; those of the listed points may differ from them in the last
// digits), so a circle of radius r has a little less than πr² (the polygon is inscribed).
// - With `spans`: the spans in order.
// - With `polylines`: the corners of the polygon in order, the first not repeated; left out when
//   they do not fit the budget.
// Where a loop starts is fixed by the shape, not by the mesh (see `cut`).
export interface SectionLoop {
  area: number; // mm2, positive
  length: number; // mm
  spans?: SectionSpan[];
  points?: Vec2[];
}

// A piece of material in the section: an outer loop and the holes in it. The outer loop runs
// counter-clockwise in the x and y of the frame and a hole clockwise, so the material is on the
// left of every loop. The regions of a body, and the holes of a region, are in the order of
// the first points of their loops (by u, then v), not in the order the mesh gave them.
export interface SectionRegion {
  area: number; // mm2: the outer loop less the holes
  outer: SectionLoop;
  holes: SectionLoop[];
}
// - `loops`: how many closed loops the plane cuts out of the body. A loop left with fewer than
//   three corners (see `cut`) is not a loop: it counts neither here nor in `area`, and a body
//   left without loops is not listed.
// - `regions`: left out when the outline of the body does not fit the budget (its spans, or with
//   `polylines` its loops); the body then has its area and the number of its loops only.
export interface SectionOfBody {
  body: Id;
  area: number; // mm2, all regions
  loops: number;
  regions?: SectionRegion[];
}

// - `frame`: the cutting plane as it was asked for: after the offset and the flip. The points of
//   the loops are in its x and y; `origin + x·u + y·v` is the point in the model.
// - `below`: how far under that plane, against its normal, the section was really taken: the
//   precision of the coordinates over all bodies asked about (see `cut`). The loops are those
//   of the plane through `origin − below·normal`, laid into the frame. A body far from the
//   origin in the same call therefore moves the cut of every body by that much. Who draws the
//   cut clips at that plane, not at the one asked for (`takenAt`), so that the clipped mesh and
//   the loops are of one plane.
// - `bodies`: the bodies the plane cuts, in the order they were asked about (without `bodies`,
//   the order of the model). A body the plane misses is not listed.
// - `inPlane`: bodies with a planar face that lies in the cutting plane (parallel within
//   `ANGLE_TOLERANCE`, at its height within the precision of the coordinates), with the first
//   such face of each: at most one entry per body. Such a body shows that face as its section
//   when it lies below the plane and nothing when it lies above; with an entry here the offset
//   is better moved a little.
// - `truncated`: `total` items there were to list and `shown` of them listed, in the units of
//   `maxPoints`. The budget is spent in two rounds, each over the bodies in their order: first
//   the outlines (the spans of a body, or with `polylines` its loops), then the lists of points
//   (a curve, or a loop of a polyline). A list that does not fit is left out whole and a later,
//   smaller one may still fit. So the points of an early body never cost a later one its
//   outline.
// The size of the answer is therefore bounded by `maxPoints` and by the number of bodies asked
// about (a body has three numbers and at most one face in `inPlane`).
export interface SectionResult extends Truncated {
  frame: Frame;
  below: number; // mm
  bodies: SectionOfBody[];
  inPlane: { body: Id; face: FaceName }[];
}

declare module './spec' {
  interface Queries {
    section: { spec: typeof SECTION_ARGS; result: SectionResult };
  }
}

// ---------------------------------------------------------------- the pass over triangles

// The loops a plane cuts out of one closed mesh, as the mesh gives them: points in the x and y
// of the frame, and for every segment the number of the face its triangle belongs to.
// - The cut is taken `below` under the plane: the heights of the vertices are measured from the
//   plane moved by `below` against its normal, and a vertex at height zero or more counts as
//   above. `below` is the precision of the coordinates (`coordinatePrecision` over the bodies
//   asked about). Comparing a height in float32 with the plane itself would split the vertices
//   of a face that lies in the plane at random, as soon as the body is not aligned with the
//   axes of the model.
// - Every vertex is above or below, never neither. Every crossed triangle then gives exactly one
//   segment, between the two of its edges that cross, and the point on an edge is computed from
//   its two vertices in a fixed order, so both triangles of the edge get the same numbers. The
//   segments are chained by the edges they end on, not by comparing coordinates.
// - The mesh of a body is a closed surface (every edge in exactly two triangles, once each way:
//   guarantee 1 of the kernel port and the check of its adapter), so every chain closes. A mesh
//   that is not closed is answered as `failed`.
// - After the chains are closed, the points that are not corners are dropped, so that the
//   points of a loop do not depend on how a face is divided into triangles. `precision` is the
//   precision of the coordinates of this body (`coordinatePrecision` over the body alone, so
//   that the corners of a body do not depend on which other bodies were asked about); it is not
//   a fixed length, because on a body that is not aligned with the axes the point on the
//   diagonal of a side quad is off the line by the noise of float32. The rule, in this order:
//   1. A segment shorter than `precision` goes: walking the chain, a point nearer than that to
//      the last point kept is dropped, and the segment after it starts at the point kept. (At
//      the end of the walk a point that near to the first one is dropped the same way.)
//   2. The points where the face changes are kept. A loop on one face keeps the point furthest
//      from the mean of its points (a corner of its hull, wherever the mesh starts the chain);
//      of several that far within `precision`, the first in the order of (u, v).
//   3. From each kept point the walk goes on along the run on one face: the next point kept is
//      the furthest one such that every point of the mesh between lies within `precision` of
//      the straight segment to it. A dropped point is thus judged against the segment that
//      replaces it, never against a line that later drops have moved: the polygon of the
//      corners stays within `precision` of the polygon of the mesh, whatever the curve.
//   4. A loop left with fewer than three corners is dropped (a sliver thinner than the
//      precision: what a plane cuts just under an edge or a tip that lies in it).
//   The loop is listed from the corner of step 2 (of several face changes, the first in the
//   order of (u, v)), so the list does not depend on where the mesh starts the chain either.
//   The order of (u, v) is by u, and by v among the points whose u is the smallest within
//   `precision`: two corners above each other have the same u only up to the noise of the
//   coordinates.
// - `area` is of the loop before points are dropped. `lengths[i]` is the length along the mesh
//   polygon from `points[i]` to the next corner; their sum is the length of the loop.
// - The material is on the left of a loop seen against the normal of the plane.
// - The loops are in the order of their first points, by (u, v) in the same sense.
export interface CutLoop {
  points: Vec2[];
  faces: number[]; // faces[i]: the face of the segment from points[i] to the next point
  lengths: number[];
  area: number; // signed: positive for a loop that runs counter-clockwise
}

// The order of (u, v): by u, and by v where the two u are the same within `precision`. Two corners
// above each other (the two ends of a wall along v) have the same u only up to the noise of the
// coordinates, and which of them comes first must not depend on that noise.
const before = (a: Vec2, b: Vec2, precision: number): boolean => a[0] < b[0] - precision || (a[0] <= b[0] + precision && a[1] < b[1]);
// The first of the listed points in that order: of those whose u is the smallest within
// `precision`, the one with the smallest v.
function first(points: Vec2[], listed: number[], precision: number): number {
  const least = Math.min(...listed.map((i) => points[i][0]));
  let found = -1;
  for (const i of listed) if (points[i][0] <= least + precision && (found < 0 || points[i][1] < points[found][1])) found = i;
  return found;
}

export function cut(solid: Solid, frame: Frame, below: number, precision: number): CutLoop[] {
  const { positions, triangles, faceIds } = solid;
  const count = positions.length / 3;
  const { origin, x, y, normal } = frame;
  const height = new Float64Array(count);
  for (let i = 0; i < count; i++) height[i] = (positions[3 * i] - origin[0]) * normal[0] + (positions[3 * i + 1] - origin[1]) * normal[1] + (positions[3 * i + 2] - origin[2]) * normal[2] + below;
  // The point where an edge crosses the plane, in the frame: one point per edge, computed from
  // the vertex with the smaller number, so the two triangles of the edge share it.
  const crossings = new Map<number, Vec2>();
  const crossing = (a: number, b: number): number => {
    const [low, high] = a < b ? [a, b] : [b, a];
    const key = low * count + high;
    if (!crossings.has(key)) {
      const t = height[low] / (height[low] - height[high]);
      const at = [0, 1, 2].map((k) => positions[3 * low + k] + t * (positions[3 * high + k] - positions[3 * low + k]) - origin[k]) as Vec3;
      crossings.set(key, [dot3(at, x), dot3(at, y)]);
    }
    return key;
  };
  // One segment per crossed triangle, directed so that the material is on its left: with the
  // corners a, b, c counter-clockwise seen from outside and a alone on its side, from the edge
  // ab to the edge ca when a is above, the other way when a is below.
  const starts: number[] = [];
  const ends: number[] = [];
  const faces: number[] = [];
  const startingAt = new Map<number, number>(); // the edge a segment starts on -> the segment
  const open = (): never => {
    throw new QueryFailure('failed', 'the mesh of a body is not a closed surface, so its section does not close');
  };
  for (let t = 0; t < triangles.length; t += 3) {
    const corners = [triangles[t], triangles[t + 1], triangles[t + 2]];
    const above = corners.map((corner) => height[corner] >= 0);
    const lone = above[0] === above[1] ? (above[1] === above[2] ? -1 : 2) : above[1] === above[2] ? 0 : 1;
    if (lone < 0) continue;
    const [a, b, c] = [corners[lone], corners[(lone + 1) % 3], corners[(lone + 2) % 3]];
    const [ab, ca] = [crossing(a, b), crossing(c, a)];
    const [start, end] = above[lone] ? [ab, ca] : [ca, ab];
    if (startingAt.has(start)) open();
    startingAt.set(start, starts.length);
    starts.push(start);
    ends.push(end);
    faces.push(faceIds[t / 3]);
  }
  const loops: CutLoop[] = [];
  const visited = new Uint8Array(starts.length);
  for (let first = 0; first < starts.length; first++) {
    if (visited[first]) continue;
    const points: Vec2[] = [];
    const onFaces: number[] = [];
    for (let segment = first; ; ) {
      visited[segment] = 1;
      points.push(crossings.get(starts[segment]) as Vec2);
      onFaces.push(faces[segment]);
      const next = startingAt.get(ends[segment]);
      if (next === undefined || (visited[next] && next !== first)) return open();
      if (next === first) break;
      segment = next;
    }
    const loop = corners(points, onFaces, precision);
    if (loop) loops.push(loop);
  }
  return loops.sort((a, b) => (before(a.points[0], b.points[0], precision) ? -1 : before(b.points[0], a.points[0], precision) ? 1 : 0));
}

// The distance of `p` from the straight segment between `a` and `b`.
function fromSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const [along, to] = [sub2(b, a), sub2(p, a)];
  const length2 = dot2(along, along);
  const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, dot2(to, along) / length2));
  return Math.hypot(to[0] - t * along[0], to[1] - t * along[1]);
}

// The corners of a closed chain of the mesh: steps 1 to 4 of `cut`. Undefined for a chain that
// is left with fewer than three.
export function corners(chain: Vec2[], chainFaces: number[], precision: number): CutLoop | undefined {
  const raw = chain.length;
  let area = 0;
  for (let i = 0; i < raw; i++) area += cross2(chain[i], chain[(i + 1) % raw]) / 2;
  // 1. no segment shorter than the precision: a point that near to the last one kept goes, and
  // its segment starts at the point kept
  const points: Vec2[] = [];
  const faces: number[] = [];
  const lengths: number[] = [];
  for (let i = 0; i < raw; i++) {
    const length = dist2(chain[i], chain[(i + 1) % raw]);
    const last = points.length - 1;
    if (last >= 0 && dist2(chain[i], points[last]) < precision) {
      faces[last] = chainFaces[i];
      lengths[last] += length;
    } else {
      points.push(chain[i]);
      faces.push(chainFaces[i]);
      lengths.push(length);
    }
  }
  while (points.length > 1 && dist2(points[points.length - 1], points[0]) < precision) {
    // its short segment to the first point goes; the segment before it now ends at the first point
    const short = lengths.pop() as number;
    points.pop();
    faces.pop();
    lengths[lengths.length - 1] += short;
  }
  const size = points.length;
  if (size < 3) return undefined;
  // 2. where the list starts: the change of face that is first in the order of (u, v); on one
  // face the point furthest from the mean of the points
  let anchors = points.flatMap((_, i) => (faces[(i + size - 1) % size] !== faces[i] ? [i] : []));
  if (anchors.length === 0) {
    const mean: Vec2 = [points.reduce((sum, point) => sum + point[0], 0) / size, points.reduce((sum, point) => sum + point[1], 0) / size];
    const away = points.map((point) => dist2(point, mean));
    const most = Math.max(...away);
    anchors = away.flatMap((distance, i) => (distance >= most - precision ? [i] : []));
  }
  const start = first(points, anchors, precision);
  const at = (i: number): Vec2 => points[(start + i) % size];
  const faceAt = (i: number): number => faces[(start + i) % size];
  // 3. from each kept point, the furthest point such that every point between lies within the
  // precision of the straight segment to it; a change of face is always kept
  const kept: CutLoop = { points: [], faces: [], lengths: [], area };
  for (let from = 0; from < size; ) {
    let end = from + 1; // the end of the run on one face
    while (end < size && faceAt(end) === faceAt(from)) end++;
    const to = furthest(at, from, end, precision);
    let length = 0;
    for (let i = from; i < to; i++) length += lengths[(start + i) % size];
    kept.points.push(at(from));
    kept.faces.push(faceAt(from));
    kept.lengths.push(length);
    from = to;
  }
  // 4. a sliver thinner than the precision is not a loop
  return kept.points.length < 3 ? undefined : kept;
}

// The furthest point `to` of the run from `from` to `end` (both corners of the run) such that
// every point between lies within `precision` of the straight segment from `from` to `to`.
// The points between narrow the directions a segment may still take; once none is left, no
// point further on can do, and the search stops there. That only saves time: which point is
// taken is decided by the distances alone.
function furthest(at: (i: number) => Vec2, from: number, end: number, precision: number): number {
  const SLACK = 1e-9; // rad, so that rounding never rules out a point the distances would accept
  const origin = at(from);
  let best = from + 1;
  let reference: Vec2 | undefined;
  let [low, high] = [-Infinity, Infinity];
  const angle = (direction: Vec2): number => (reference ? Math.atan2(cross2(reference, direction), dot2(reference, direction)) : 0);
  for (let to = from + 2; to <= end; to++) {
    // the point before `to` is between now: a segment has to pass within the precision of it
    const between = sub2(at(to - 1), origin);
    const distance = len2(between);
    if (distance > precision) {
      reference ??= between;
      const [middle, half] = [angle(between), Math.asin(precision / distance) + SLACK];
      [low, high] = [Math.max(low, middle - half), Math.min(high, middle + half)];
      if (low > high) break;
    }
    const direction = sub2(at(to), origin);
    if (reference && len2(direction) > 0 && (angle(direction) < low || angle(direction) > high)) continue;
    let within = true;
    for (let i = from + 1; i < to && within; i++) within = fromSegment(at(i), origin, at(to)) <= precision;
    if (within) best = to;
  }
  return best;
}

// ---------------------------------------------------------------- regions and spans

// Is the point inside the polygon? (Crossings of a ray along u.)
function inside(point: Vec2, polygon: Vec2[]): boolean {
  let odd = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [a, b] = [polygon[i], polygon[j]];
    if (a[1] > point[1] !== b[1] > point[1] && point[0] < a[0] + ((point[1] - a[1]) / (b[1] - a[1])) * (b[0] - a[0])) odd = !odd;
  }
  return odd;
}

// Outer loops with the holes that lie in them: a hole belongs to the smallest outer loop that
// holds one of its points.
export function nested(loops: CutLoop[]): { outer: CutLoop; holes: CutLoop[] }[] {
  const regions = loops.filter((loop) => loop.area > 0).map((outer) => ({ outer, holes: [] as CutLoop[] }));
  for (const hole of loops) {
    if (hole.area > 0) continue;
    let home: (typeof regions)[number] | undefined;
    for (const point of hole.points) {
      for (const region of regions) if (inside(point, region.outer.points) && (!home || region.outer.area < home.outer.area)) home = region;
      if (home) break; // the first point lies on the outer loop only where the two touch
    }
    if (!home) throw new QueryFailure('failed', 'a hole of the section lies in no outer loop');
    home.holes.push(hole);
  }
  return regions;
}

const SINE = Math.sin(ANGLE_TOLERANCE);
const parallel = (a: Vec3, b: Vec3): boolean => len3(cross3(unit3(a), unit3(b))) <= SINE;
const perpendicular = (a: Vec3, b: Vec3): boolean => Math.abs(dot3(unit3(a), unit3(b))) <= SINE;

// The circle a round surface is cut in by a plane across its axis, in the frame of the plane;
// undefined for any other surface and any other way the plane meets it. `frame` is the plane the
// section was taken at.
function circleIn(surface: Surface | undefined, frame: Frame): { center: Vec2; radius: number } | undefined {
  if (!surface || (surface.kind !== 'cylinder' && surface.kind !== 'cone') || !parallel(surface.axis, frame.normal)) return undefined;
  const point = surface.kind === 'cylinder' ? surface.origin : surface.apex;
  // where the axis meets the plane
  const axis = unit3(surface.axis);
  const along = dot3(sub3(frame.origin, point), frame.normal) / dot3(axis, frame.normal);
  const meets = sub3(add3(point, mul3(axis, along)), frame.origin);
  return { center: [dot3(meets, frame.x), dot3(meets, frame.y)], radius: surface.kind === 'cylinder' ? surface.radius : Math.abs(along) * Math.tan(surface.halfAngle) };
}
// Is what the plane cuts out of the surface straight?
function straightIn(surface: Surface | undefined, frame: Frame): boolean {
  if (!surface) return false;
  if (surface.kind === 'plane') return true;
  return (surface.kind === 'cylinder' || surface.kind === 'swept') && perpendicular(surface.axis, frame.normal);
}

// The runs of segments of one face of a loop as spans, by the table at `SectionSpan`. A curve
// comes with its points, and with its length summed from `lengths` of the loop (the length along
// the mesh polygon, as the length of the loop is). `frame` is the plane the section was taken at.
export function spansOf(loop: CutLoop, surfaceOf: (face: number) => Surface | undefined, nameOf: (face: number) => FaceName, frame: Frame): SectionSpan[] {
  const size = loop.points.length;
  const spans: SectionSpan[] = [];
  for (let first = 0; first < size; ) {
    let end = first + 1;
    while (end < size && loop.faces[end] === loop.faces[first]) end++;
    const points = loop.points.slice(first, end);
    const whole = first === 0 && end === size; // a loop on one face: it ends where it starts
    const [from, to] = [loop.points[first], loop.points[end % size]];
    const head = { face: nameOf(loop.faces[first]), from, to };
    const surface = surfaceOf(loop.faces[first]);
    const circle = circleIn(surface, frame);
    if (circle) {
      // the angle the run turns by about the centre, summed along its corners
      const run = [...points, to];
      let sweep = 0;
      for (let i = 0; i + 1 < run.length; i++) {
        const [a, b] = [sub2(run[i], circle.center), sub2(run[i + 1], circle.center)];
        sweep += Math.atan2(cross2(a, b), dot2(a, b));
      }
      spans.push({ ...head, kind: 'arc', center: circle.center, radius: circle.radius, sweep: whole ? Math.sign(sweep) * 2 * Math.PI : sweep });
    } else if (straightIn(surface, frame) && !whole) spans.push({ ...head, kind: 'line' });
    else {
      let length = 0;
      for (let i = first; i < end; i++) length += loop.lengths[i];
      spans.push({ ...head, kind: 'curve', count: whole ? size : points.length + 1, length, points: whole ? points : [...points, to] });
    }
    first = end;
  }
  return spans;
}

// ---------------------------------------------------------------- for whoever draws a cut

// The plane a section was really taken at: the frame of the answer moved `below` against its
// normal. Whoever draws the cut (the section view of the app, a picture of a cut model) clips
// the model at this plane and lays the fills into it, so the edge of the clipped mesh and the
// loops belong to one plane and meet. Clipping at the plane asked for would leave the two
// `below` apart, and on a wall that leans the outlines would differ by `below` times its slope.
export function takenAt(result: Pick<SectionResult, 'frame' | 'below'>): Frame {
  const { frame, below } = result;
  return { ...frame, origin: sub3(frame.origin, mul3(frame.normal, below)) };
}

// The regions of a complete answer, each with its body; undefined when anything was left out.
// A caller that fills a cut fills only from this: a region filled without one of its holes
// would show material across a cavity.
export function completeRegions(result: SectionResult): { body: Id; region: SectionRegion }[] | undefined {
  if (result.truncated) return undefined;
  return result.bodies.flatMap((body) => (body.regions ?? []).map((region) => ({ body: body.body, region })));
}

// ---------------------------------------------------------------- the entry

// The cutting plane as it is used: moved by the offset along its normal, then turned round.
function placed(frame: Frame, offset: number, flip: boolean): Frame {
  const moved = { ...frame, origin: add3(frame.origin, mul3(frame.normal, offset)) };
  return flip ? { ...moved, x: mul3(moved.x, -1), normal: mul3(moved.normal, -1) } : moved;
}
// Does a planar surface lie in the cutting plane: parallel within `ANGLE_TOLERANCE` and at its
// height within `precision`?
const liesIn = (surface: Extract<Surface, { kind: 'plane' }>, frame: Frame, precision: number): boolean => parallel(surface.normal, frame.normal) && Math.abs(dot3(sub3(surface.origin, frame.origin), frame.normal)) <= precision;

export const section: QuerySpec<typeof SECTION_ARGS, SectionResult> = {
  title: 'Section',
  summary: 'What a plane cuts out of the bodies: closed loops with their areas and, for every piece of a loop, the face it lies on.',
  returns:
    '`frame`: the cutting plane (`origin`, `x`, `y`, `normal`); points are [u, v] in its x and y. `below`: how far under the plane, against its normal, the section was taken (mm; the precision of the coordinates of the bodies asked about). ' +
    '`bodies`: for every body the plane cuts, `area` (mm²), `loops` (how many) and `regions`, each with `area`, an `outer` loop and `holes`. The points of a loop are the corners of the polygon the mesh gives (points in line with their neighbours are left out, within the precision of the coordinates of the body); `area` and `length` are of that polygon before points are left out. ' +
    'A loop has `area`, `length` and `spans`: `line`, `arc` (`center` and `radius` of the exact surface, `sweep` in rad, positive counter-clockwise; a whole circle has `from` equal to `to`) or `curve` (`count`, `length`, and `points` while they fit; a curve that is a whole loop lists its corners once), each with the `face` it lies on and `from` and `to` (points of the mesh; an end of an arc where another face cuts it lies inside its circle, by no more than the chord tolerance on a model of ordinary size). With `outline: "polylines"` a loop has `points` instead of `spans`. ' +
    '`inPlane`: bodies with a face that lies in the cutting plane, one face each (such a body shows that face or nothing: move the offset). ' +
    '`maxPoints` is the budget of the answer: a span is one, a point is one, a loop written as a polyline is one; the outlines of all bodies are taken first, then the lists of points; what does not fit is left out whole (a body keeps `area` and `loops`, a curve `count` and `length`), and `truncated` says how much was listed of how much.',
  args: SECTION_ARGS,
  units: { area: 'mm2', length: 'mm', radius: 'mm', sweep: 'rad', below: 'mm' },
  run(context, args) {
    const base = context.frame(args.plane);
    if ('problem' in base) throw new QueryFailure('notAvailable', base.problem === 'nonPlanarFace' ? 'the face is not planar, so it gives no cutting plane' : 'the plane is not in the state asked about', ['plane']);
    const frame = placed(base, args.offset, args.flip === true);
    const ids = [...new Set(args.bodies ?? Object.keys(context.bodies))];
    const names = context.state.evaluation.faceNames;
    // How far under the plane the cut is taken: one number for the call, over all bodies asked
    // about. (Geometry only from the context: the same code answers for a pose.)
    const below = coordinatePrecision(...ids.map((id) => context.bodies[id]));
    const taken = takenAt({ frame, below });
    const polylines = args.outline === 'polylines';
    const budget = { left: args.maxPoints, shown: 0, total: 0 };
    // `count` items of the answer, when they still fit the budget
    const fits = (count: number): boolean => {
      budget.total += count;
      if (count > budget.left) return false;
      budget.left -= count;
      budget.shown += count;
      return true;
    };
    const result: SectionResult = { frame, below, bodies: [], inPlane: [] };
    // The first round, over the bodies in their order: the cut of each, and its outline (its
    // spans, or with polylines its loops) against the budget.
    const outlined: { entry: SectionOfBody; loops: CutLoop[]; spansIn: (loop: CutLoop) => SectionSpan[] }[] = [];
    for (const id of ids) {
      const body = context.bodies[id];
      const flush = body.faces.find((face) => {
        const surface = context.surface(id, names[face.id]);
        return surface?.kind === 'plane' && liesIn(surface, frame, below);
      });
      if (flush) result.inPlane.push({ body: id, face: names[flush.id] }); // at most one per body
      // the corners of a body are decided by its own precision, whatever else was asked about
      const loops = cut(body.solid, frame, below, coordinatePrecision(body));
      if (loops.length === 0) continue; // also a body of which only slivers under three corners were left
      const entry: SectionOfBody = { body: id, area: loops.reduce((sum, loop) => sum + loop.area, 0), loops: loops.length }; // holes are negative
      result.bodies.push(entry);
      const spans = new Map(loops.map((loop) => [loop, polylines ? [] : spansOf(loop, (face) => context.surface(id, names[face]), (face) => names[face], taken)]));
      const spansIn = (loop: CutLoop): SectionSpan[] => spans.get(loop) ?? [];
      const pointsOf = (loop: CutLoop): number => (polylines ? loop.points.length : spansIn(loop).reduce((points, span) => points + (span.kind === 'curve' ? span.count : 0), 0));
      if (fits(polylines ? loops.length : loops.reduce((sum, loop) => sum + spansIn(loop).length, 0))) outlined.push({ entry, loops, spansIn });
      // a body without its outline lists no points either; they are still counted
      else budget.total += loops.reduce((sum, loop) => sum + pointsOf(loop), 0);
    }
    // The second round, in the same order: the lists of points, each whole or not at all. The
    // points of an early body can no longer cost a later body its outline.
    for (const { entry, loops, spansIn } of outlined) {
      const write = (loop: CutLoop): SectionLoop => {
        const head = { area: Math.abs(loop.area), length: loop.lengths.reduce((sum, length) => sum + length, 0) };
        if (polylines) return fits(loop.points.length) ? { ...head, points: loop.points } : head;
        const spans = spansIn(loop).map((span): SectionSpan => {
          if (span.kind !== 'curve' || fits(span.count)) return span;
          const { points: _, ...counted } = span;
          return counted;
        });
        return { ...head, spans };
      };
      // the outer loop of a region is written before its holes, a region before the next
      entry.regions = nested(loops).map(({ outer, holes }) => ({ area: outer.area + holes.reduce((sum, hole) => sum + hole.area, 0), outer: write(outer), holes: holes.map(write) }));
    }
    return budget.shown < budget.total ? { ...result, truncated: { shown: budget.shown, total: budget.total } } : result;
  },
};
