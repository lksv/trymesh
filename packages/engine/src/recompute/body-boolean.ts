// The boolean of two finished bodies of one state (D56): the port's boolean with the face numbers of
// the tool made its own for the call, whether the tool changed the target, and the checks of the
// engine on what the kernel returned. And the box on one side of a plane, of which a split is made.
// The design is docs/d36/3d-body-boolean/design.md, "The engine checks the result" and "Split".
import { INTERFERENCE_THRESHOLD } from '../interference';
import { closestOnTriangle } from '../mesh-distance';
import { areaOf, onSurface, pieceSolids, volumeOf } from '../solid';
import type { BooleanOp, Frame, Solid, SolidKernel, Vec3 } from '../types';
import { add3, cross3, dot3, len3, mul3, sub3 } from '../util';
import { reach } from './services';

export const VOLUME_TOLERANCE = 1e-6; // a share of the two volumes together
export const VOLUME_AREA_FACTOR = 0.1; // times p, per mm² of the two surfaces together
export const SHEET_TOLERANCE = 10; // in precisions of the coordinates (p over the two operands)
export const SHEET_CHORD_SHARE = 0.1; // the sheet tolerance is never more than this share of the chord tolerance
export const SHEET_FLOOR = 0.5; // ... and never less than this many precisions of the coordinates
export const SHEET_AREA_FLOOR = 0.001; // mm²: new sheet area a result may hold, over all face numbers together
// How far the five other faces of the box of a split are from the body: the larger of 1 mm and
// this share of the diagonal of the body.
export const SPLIT_MARGIN = 0.05;

// A check of the engine refused what the kernel returned (the volume, sheets, a piece of an
// intersection that is all sheet and holds material). The feature reports it as `kernelFailure`
// with the message as the detail, as it reports an exception of the port.
export class ResultCheckFailed extends Error {}

// The precision of the coordinates of solids (`coordinatePrecision` of mesh-distance.ts, over the
// meshes rather than their bounds): a millionth of the largest coordinate, a millionth of a
// millimetre at least.
export const precisionOf = (...solids: Solid[]): number => 1e-6 * Math.max(1, ...solids.map(reach));

// The band of guarantee 3 of the port: faces this near are one plane for a union and a difference.
// 1e-5 D, D the diagonal of the box of the solids, at least twice their largest coordinate.
export function bandOf(...solids: Solid[]): number {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const solid of solids) {
    for (let i = 0; i < solid.positions.length; i++) {
      min[i % 3] = Math.min(min[i % 3], solid.positions[i]);
      max[i % 3] = Math.max(max[i % 3], solid.positions[i]);
    }
  }
  if (min[0] === Infinity) return 0;
  return 1e-5 * Math.max(len3(sub3(max, min)), 2 * Math.max(...min.map(Math.abs), ...max.map(Math.abs)));
}

// The tolerance of the identity of the volumes: the largest of 0.001 mm³, a millionth of the
// volumes together and a tenth of p times the surfaces together (the rounding of new vertices
// grows with the surface they lie on and with their distance from the origin).
export function volumeSlack(volumes: number, areas: number, precision: number): number {
  return Math.max(INTERFERENCE_THRESHOLD, VOLUME_TOLERANCE * volumes, VOLUME_AREA_FACTOR * precision * areas);
}

// The sheet tolerance: ten precisions of the coordinates, at most a tenth of the chord tolerance
// (the gaps between two polygons of one circle are real), and at least half a precision, which
// wins where the two conflict.
export const sheetToleranceOf = (precision: number, chordTolerance: number): number => Math.max(SHEET_FLOOR * precision, Math.min(SHEET_TOLERANCE * precision, SHEET_CHORD_SHARE * chordTolerance));

// ---------------------------------------------------------------- sheets

// The cosine of the angle within which two normals count as opposite (2.6°).
const OPPOSITE = 0.999;

// For every triangle of a solid, whether it is a sheet: it has an area, and its centroid, its
// three vertices and the middles of its three edges each lie within `eps` of a triangle facing the
// other way (normals within 2.6° of opposite, more for narrow triangles that do not touch). The centroid alone is the rule of `areaOf` with a
// tolerance. The other points keep two walls that are thicker apart than `eps` somewhere in the
// triangle from counting: the crescent between two polygons of one circle meets the other polygon
// at the ends of a side and is thickest in its middle. Each point is measured to the nearest such
// triangle, not to the plane of one, whose normal may be noise across a narrow triangle. A grid
// over the boxes of the triangles keeps it from comparing every triangle with every other.
export function sheetTriangles(s: Solid, eps: number): Uint8Array {
  const p = s.positions;
  const count = s.triangles.length / 3;
  const sheet = new Uint8Array(count);
  if (count === 0) return sheet;
  const corner = (t: number, k: number): Vec3 => [p[3 * s.triangles[3 * t + k]], p[3 * s.triangles[3 * t + k] + 1], p[3 * s.triangles[3 * t + k] + 2]];
  const normals = new Float64Array(3 * count);
  const area = new Float64Array(count);
  const boxes = new Float64Array(6 * count);
  // how near to opposite the normals of two triangles have to be: 2.6°, or, for a triangle narrower
  // than twice `eps`, whose normal the rounding of its vertices can turn by much more, as far as
  // that rounding can turn it (up to 90°: facing the other way at all)
  const opposite = new Float64Array(count);
  for (let t = 0; t < count; t++) {
    const [a, b, c] = [corner(t, 0), corner(t, 1), corner(t, 2)];
    const n = cross3(sub3(b, a), sub3(c, a));
    const length = len3(n);
    area[t] = length / 2;
    if (length > 0) normals.set(mul3(n, 1 / length), 3 * t);
    const width = length / Math.max(len3(sub3(b, a)), len3(sub3(c, b)), len3(sub3(a, c)));
    opposite[t] = Math.min(OPPOSITE, Math.cos(Math.asin(Math.min(1, (2 * eps) / width))));
    for (let axis = 0; axis < 3; axis++) {
      boxes[6 * t + axis] = Math.min(a[axis], b[axis], c[axis]) - eps;
      boxes[6 * t + 3 + axis] = Math.max(a[axis], b[axis], c[axis]) + eps;
    }
  }
  const grid = triangleGrid(boxes, count);
  // is the point within `eps` of a triangle facing against the triangle t?
  const onOpposite = (t: number, point: Vec3): boolean => {
    let found = false;
    grid.near(point, (other) => {
      if (other === t || area[other] === 0) return false;
      // the wider allowance of a narrow triangle only for one that shares no vertex with t: two
      // faces that meet at a sharp edge are no sheet
      const touches = [0, 1, 2].some((k) => [0, 1, 2].some((l) => s.triangles[3 * t + k] === s.triangles[3 * other + l]));
      const limit = touches ? OPPOSITE : Math.min(opposite[t], opposite[other]);
      if (normals[3 * t] * normals[3 * other] + normals[3 * t + 1] * normals[3 * other + 1] + normals[3 * t + 2] * normals[3 * other + 2] > -limit) return false;
      for (let axis = 0; axis < 3; axis++) if (point[axis] < boxes[6 * other + axis] || point[axis] > boxes[6 * other + 3 + axis]) return false;
      found = len3(sub3(point, closestOnTriangle(point, corner(other, 0), corner(other, 1), corner(other, 2)))) <= eps;
      return found;
    });
    return found;
  };
  for (let t = 0; t < count; t++) {
    if (area[t] === 0) continue;
    const [a, b, c] = [corner(t, 0), corner(t, 1), corner(t, 2)];
    const samples: Vec3[] = [mul3(add3(add3(a, b), c), 1 / 3), a, b, c, mul3(add3(a, b), 0.5), mul3(add3(b, c), 0.5), mul3(add3(c, a), 0.5)];
    if (samples.every((point) => onOpposite(t, point))) sheet[t] = 1;
  }
  return sheet;
}

// A uniform grid over boxes (6 numbers each: min, max), keyed by numbers. `near(point, visit)`
// offers every box whose cells hold the point, until `visit` answers true. A box that would take
// more than a few thousand cells goes to a list every query sees.
export interface TriangleGrid {
  near(point: Vec3, visit: (index: number) => boolean): void;
  // every box whose cells meet the box `lo`–`hi` (each at most once), until `visit` answers true
  inBox(lo: Vec3, hi: Vec3, visit: (index: number) => boolean): void;
}
export function triangleGrid(boxes: Float64Array, count: number, cellSize?: number): TriangleGrid {
  let mean = 0;
  for (let t = 0; t < count; t++) mean += Math.max(boxes[6 * t + 3] - boxes[6 * t], boxes[6 * t + 4] - boxes[6 * t + 1], boxes[6 * t + 5] - boxes[6 * t + 2]);
  const cell = cellSize ?? Math.max(mean / Math.max(1, count), 1e-9);
  const cells = new Map<number, number[]>();
  const large: number[] = [];
  const key = (i: number, j: number, k: number): number => ((i * 73856093) ^ (j * 19349663) ^ (k * 83492791)) | 0;
  for (let t = 0; t < count; t++) {
    const lo = [0, 1, 2].map((axis) => Math.floor(boxes[6 * t + axis] / cell));
    const hi = [0, 1, 2].map((axis) => Math.floor(boxes[6 * t + 3 + axis] / cell));
    if ((hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1) > 4096) {
      large.push(t);
      continue;
    }
    for (let i = lo[0]; i <= hi[0]; i++)
      for (let j = lo[1]; j <= hi[1]; j++)
        for (let k = lo[2]; k <= hi[2]; k++) {
          const at = key(i, j, k);
          const list = cells.get(at);
          if (list) list.push(t);
          else cells.set(at, [t]);
        }
  }
  return {
    near(point, visit) {
      const list = cells.get(key(Math.floor(point[0] / cell), Math.floor(point[1] / cell), Math.floor(point[2] / cell)));
      if (list) for (const t of list) if (visit(t)) return;
      for (const t of large) if (visit(t)) return;
    },
    inBox(lo, hi, visit) {
      const from = lo.map((value) => Math.floor(value / cell));
      const to = hi.map((value) => Math.floor(value / cell));
      const seen = new Set<number>();
      const offer = (t: number): boolean => {
        if (seen.has(t)) return false;
        seen.add(t);
        return visit(t);
      };
      if ((to[0] - from[0] + 1) * (to[1] - from[1] + 1) * (to[2] - from[2] + 1) > 4096) {
        for (let t = 0; t < count; t++) if (offer(t)) return;
        return;
      }
      for (let i = from[0]; i <= to[0]; i++)
        for (let j = from[1]; j <= to[1]; j++)
          for (let k = from[2]; k <= to[2]; k++) for (const t of cells.get(key(i, j, k)) ?? []) if (offer(t)) return;
      for (const t of large) if (offer(t)) return;
    },
  };
}

// The area of sheets in a solid, by face number.
export function sheetAreaByFace(s: Solid, eps: number): Map<number, number> {
  const sheet = sheetTriangles(s, eps);
  const out = new Map<number, number>();
  const p = s.positions;
  for (let t = 0; t < sheet.length; t++) {
    if (!sheet[t]) continue;
    const at = (k: number): Vec3 => [p[3 * s.triangles[3 * t + k]], p[3 * s.triangles[3 * t + k] + 1], p[3 * s.triangles[3 * t + k] + 2]];
    const area = len3(cross3(sub3(at(1), at(0)), sub3(at(2), at(0)))) / 2;
    out.set(s.faceIds[t], (out.get(s.faceIds[t]) ?? 0) + area);
  }
  return out;
}

// ---------------------------------------------------------------- the boolean of two bodies

export interface BodyBoolean {
  solid: Solid;
  changed: boolean;
}

// A boolean of two solids of one face table through the port (design.md, "Recompute"):
// - Every face number of `tool` is replaced by a number from `firstFree` on for the call and put
//   back in the result, so the operands share no number (the precondition of the port for a union
//   and a difference; two bodies of a model may share numbers).
// - `changed`: false when the tool had no effect: the volume is what it was (the tolerance of
//   `applyTool`) and, for a difference and an intersection, every face of the tool in the result
//   lies on the surface the target had. Decided on the temporary numbers.
// - The checks (each a `ResultCheckFailed`): the volume against the identity with the port's
//   intersection, for a union and a difference, whether changed or not; sheets, when changed.
//   For an intersection, a connected piece of the result that is all sheet is dropped when it holds
//   under 0.001 mm³ and refused when it holds more.
// - A result without a triangle is returned as it is (changed) and not checked: the caller calls
//   it `emptyResult`.
// It throws what the port throws.
export function booleanOfBodies(kernel: SolidKernel, op: BooleanOp, target: Solid, tool: Solid, firstFree: number, chordTolerance: number): BodyBoolean {
  const numbers = [...new Set(tool.faceIds)].sort((a, b) => a - b);
  const temporary = new Map(numbers.map((face, i) => [face, firstFree + i]));
  const back = new Map(numbers.map((face, i) => [firstFree + i, face]));
  const own: Solid = { ...tool, faceIds: tool.faceIds.map((face) => temporary.get(face) as number) };
  const precision = precisionOf(target, own);
  const eps = sheetToleranceOf(precision, chordTolerance);
  let result = kernel.boolean(op, target, own);
  if (op === 'intersection') result = withoutSheetPieces(result, eps);
  const restored = (): Solid => ({ ...result, faceIds: result.faceIds.map((face) => back.get(face) ?? face) });
  if (result.triangles.length === 0) return { solid: restored(), changed: true };

  const before = volumeOf(target);
  const scale = Math.min(Math.abs(before), Math.abs(volumeOf(own)));
  const sameVolume = Math.abs(volumeOf(result) - before) <= 1e-6 * Math.max(1, scale);
  const changed = !(sameVolume && (op === 'union' || onSurface(result, firstFree, target, 1e-5 * Math.max(1, reach(target)))));

  if (op !== 'intersection') checkVolume(kernel, op, target, own, result, precision);
  if (changed) checkSheets(target, own, result, eps);
  return { solid: changed ? restored() : target, changed };
}

// The volume of a union or a difference against vol(A) + vol(B) − vol(A ∩ B), respectively
// vol(A) − vol(A ∩ B). The intersection of the port keeps no band for flush faces, so a piece of it
// no thicker than the band on average (twice its volume over its area) may count or not: the
// shared volume is a range. When the port refuses the intersection the volume is not checked.
function checkVolume(kernel: SolidKernel, op: 'union' | 'difference', target: Solid, tool: Solid, result: Solid, precision: number): void {
  let shared: Solid;
  try {
    shared = kernel.boolean('intersection', target, tool);
  } catch {
    return;
  }
  const band = bandOf(target, tool);
  let [low, high] = [0, 0];
  for (const piece of pieceSolids(shared)) {
    const volume = volumeOf(piece);
    const area = areaOf(piece);
    if (area > 0 && (2 * Math.abs(volume)) / area <= band) {
      low += Math.min(0, volume);
      high += Math.max(0, volume);
    } else {
      low += volume;
      high += volume;
    }
  }
  const [a, b] = [volumeOf(target), volumeOf(tool)];
  const [expectedLow, expectedHigh] = op === 'union' ? [a + b - high, a + b - low] : [a - high, a - low];
  const slack = volumeSlack(Math.abs(a) + Math.abs(b), areaOf(target) + areaOf(tool), precision);
  const volume = volumeOf(result);
  const off = volume < expectedLow ? expectedLow - volume : volume > expectedHigh ? volume - expectedHigh : 0;
  if (off > slack) throw new ResultCheckFailed(`the volume of the result of the ${op} is off by ${off.toPrecision(3)} mm³ from what the volumes of the two bodies and of what they share give (tolerance ${slack.toPrecision(3)} mm³)`);
}

// New sheet area: by face number, what the result holds beyond what the operands held under that
// number, summed, at most `SHEET_AREA_FLOOR`. A wall of the tool left inside the result, a face
// that should be gone.
function checkSheets(target: Solid, tool: Solid, result: Solid, eps: number): void {
  const had = new Map<number, number>();
  for (const operand of [target, tool]) for (const [face, area] of sheetAreaByFace(operand, eps)) had.set(face, (had.get(face) ?? 0) + area);
  let excess = 0;
  for (const [face, area] of sheetAreaByFace(result, eps)) excess += Math.max(0, area - (had.get(face) ?? 0));
  if (excess > SHEET_AREA_FLOOR) throw new ResultCheckFailed(`the result holds ${excess.toPrecision(3)} mm² of faces lying back to back (a wall left inside, a face that should be gone)`);
}

// An intersection without its pieces that are all sheet: such a piece is dropped when it holds
// under 0.001 mm³ (two bodies that only touch) and refused when it holds more (material the
// coordinates cannot tell from a sheet). A piece with any other surface stays, however small.
function withoutSheetPieces(result: Solid, eps: number): Solid {
  if (result.triangles.length === 0) return result;
  const sheet = sheetTriangles(result, eps);
  const p = result.positions;
  const keep: number[] = [];
  for (const piece of pieceTriangles(result)) {
    const all = piece.every((t) => {
      if (sheet[t]) return true;
      const at = (k: number): Vec3 => [p[3 * result.triangles[3 * t + k]], p[3 * result.triangles[3 * t + k] + 1], p[3 * result.triangles[3 * t + k] + 2]];
      return len3(cross3(sub3(at(1), at(0)), sub3(at(2), at(0)))) === 0;
    });
    if (!all) {
      keep.push(...piece);
      continue;
    }
    const volume = Math.abs(volumeOf(subset(result, piece)));
    if (volume >= INTERFERENCE_THRESHOLD) throw new ResultCheckFailed(`a piece of the intersection of ${volume.toPrecision(3)} mm³ is thinner than the kernel can tell from two faces that only touch`);
  }
  return keep.length === result.triangles.length / 3 ? result : compact(subset(result, keep.sort((a, b) => a - b)));
}

// The triangles of a mesh by connected piece (through shared edges), as `pieceSolids` makes them.
function pieceTriangles(solid: Solid): number[][] {
  const count = solid.triangles.length / 3;
  return pieceSolids({ ...solid, faceIds: Uint32Array.from({ length: count }, (_, t) => t) }).map((piece) => Array.from(piece.faceIds));
}

const subset = (solid: Solid, triangles: number[]): Solid => ({
  positions: solid.positions,
  triangles: Uint32Array.from(triangles.flatMap((t) => [solid.triangles[3 * t], solid.triangles[3 * t + 1], solid.triangles[3 * t + 2]])),
  faceIds: Uint32Array.from(triangles.map((t) => solid.faceIds[t])),
});

// The same mesh with only the vertices its triangles use.
function compact(solid: Solid): Solid {
  const index = new Map<number, number>();
  const positions: number[] = [];
  const triangles = solid.triangles.map((vertex) => {
    let at = index.get(vertex);
    if (at === undefined) {
      index.set(vertex, (at = index.size));
      positions.push(solid.positions[3 * vertex], solid.positions[3 * vertex + 1], solid.positions[3 * vertex + 2]);
    }
    return at;
  });
  return { positions: Float32Array.from(positions), triangles, faceIds: solid.faceIds };
}

// ---------------------------------------------------------------- the box of a split

// The box on one side of a plane that holds everything of `body` on that side: one face in the
// plane, numbered `first`, and five faces outside the body by the margin, numbered `first + 1` to
// `first + 5`, which no result may hold. Undefined when the body has nothing on that side.
// `forward` is the side the normal of the plane points to.
export function halfSpaceBox(body: Solid, plane: Pick<Frame, 'origin' | 'x' | 'y' | 'normal'>, side: 'forward' | 'backward', first: number): Solid | undefined {
  const { origin, x, y, normal: n } = plane;
  let [u0, u1, v0, v1, w0, w1] = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < body.positions.length; i += 3) {
    const q = sub3([body.positions[i], body.positions[i + 1], body.positions[i + 2]], origin);
    const [u, v, w] = [dot3(q, x), dot3(q, y), dot3(q, n)];
    [u0, u1, v0, v1, w0, w1] = [Math.min(u0, u), Math.max(u1, u), Math.min(v0, v), Math.max(v1, v), Math.min(w0, w), Math.max(w1, w)];
  }
  const forward = side === 'forward';
  if (u0 === Infinity || (forward ? w1 <= 0 : w0 >= 0)) return undefined;
  const margin = Math.max(1, SPLIT_MARGIN * Math.hypot(u1 - u0, v1 - v0, w1 - w0));
  const [low, high] = forward ? [0, w1 + margin] : [w0 - margin, 0];
  const corner = (u: number, v: number, w: number): Vec3 => add3(origin, add3(add3(mul3(x, u), mul3(y, v)), mul3(n, w)));
  const [a0, a1, b0, b1] = [u0 - margin, u1 + margin, v0 - margin, v1 + margin];
  const points = [corner(a0, b0, low), corner(a1, b0, low), corner(a1, b1, low), corner(a0, b1, low), corner(a0, b0, high), corner(a1, b0, high), corner(a1, b1, high), corner(a0, b1, high)];
  // outwards for a right-handed frame (x × y = normal): the bottom faces −normal, the top +normal
  const quads: [number, number, number, number][] = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ];
  const inPlane = forward ? 0 : 1;
  let other = first;
  const triangles: number[] = [];
  const faceIds: number[] = [];
  quads.forEach(([a, b, c, d], i) => {
    const number = i === inPlane ? first : ++other;
    triangles.push(a, b, c, a, c, d);
    faceIds.push(number, number);
  });
  return { positions: Float32Array.from(points.flat()), triangles: Uint32Array.from(triangles), faceIds: Uint32Array.from(faceIds) };
}
