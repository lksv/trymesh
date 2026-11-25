// A prototype of 6f (D72) for the probes of its design: the stored outline, the kind `outline` of
// `external`, the reader of DXF and the weld. Not the implementation: it validates little, its
// texts are short, and it is put into the registry of kinds at run time (`installOutlineKind`).
// What the probes measure with it is recorded in design.md, "Measured".
import type { EntityKind } from '../../../../packages/engine/src/catalog';
import { REFERENCE_KINDS } from '../../../../packages/engine/src/references/index';
import type { EntryGeometry } from '../../../../packages/engine/src/references/spec';
import { splineBox } from '../../../../packages/engine/src/spline';
import type { CurveShape, Id, Point2 } from '../../../../packages/engine/src/types';
import { fingerprint, stableStringify } from '../../../../packages/engine/src/util';
import { type Dict, type ValidationContext, boolean, fail, finite, object, oneOf, onlyFields } from '../../../../packages/engine/src/validation';

export type Vec2 = [number, number];

// ---------------------------------------------------------------- the stored outline

// A curve of a stored outline, in the coordinates of its file, in millimetres.
export type ImportedCurve =
  | { type: 'line'; a: Vec2; b: Vec2 }
  | { type: 'circle'; center: Vec2; radius: number }
  | { type: 'arc'; center: Vec2; start: Vec2; end: Vec2 } // counter-clockwise from start to end
  | { type: 'spline'; points: Vec2[] }; // the control points of a spline of 6d (3 to 64)

export interface SketchOutline {
  type: 'outline';
  name?: string;
  curves: Record<string, ImportedCurve>;
  x: number;
  y: number;
  turn: number;
  anchor: 'origin' | 'center';
  regions: boolean;
}

// The stored value of an outline: where the origin of the file lands, the turn, and the fingerprint
// of the curves. No positions.
export interface PlacedOutline {
  kind: 'outline';
  at: Vec2;
  turn: number;
  data: string;
}

const TAU = 2 * Math.PI;
const positive = (angle: number): number => ((angle % TAU) + TAU) % TAU;
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

// The box of a list of curves: the ends of lines, a circle whole, an arc with the points of its
// circle furthest along x and y that it passes, a spline by the box of its curve.
export function outlineBox(curves: Iterable<ImportedCurve>): { min: Vec2; max: Vec2 } | undefined {
  const min: Vec2 = [Infinity, Infinity];
  const max: Vec2 = [-Infinity, -Infinity];
  const reach = (p: Vec2): void => {
    for (const k of [0, 1]) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  };
  for (const curve of curves) {
    switch (curve.type) {
      case 'line':
        reach(curve.a);
        reach(curve.b);
        break;
      case 'circle':
        reach([curve.center[0] - curve.radius, curve.center[1] - curve.radius]);
        reach([curve.center[0] + curve.radius, curve.center[1] + curve.radius]);
        break;
      case 'arc': {
        reach(curve.start);
        reach(curve.end);
        const r = dist(curve.start, curve.center);
        const from = Math.atan2(curve.start[1] - curve.center[1], curve.start[0] - curve.center[0]);
        const sweep = positive(Math.atan2(curve.end[1] - curve.center[1], curve.end[0] - curve.center[0]) - from) || TAU;
        for (let quarter = 0; quarter < 4; quarter++) if (positive((quarter * Math.PI) / 2 - from) <= sweep) reach([curve.center[0] + r * Math.cos((quarter * Math.PI) / 2), curve.center[1] + r * Math.sin((quarter * Math.PI) / 2)]);
        break;
      }
      case 'spline': {
        const [x0, y0, x1, y1] = splineBox(curve.points);
        reach([x0, y0]);
        reach([x1, y1]);
        break;
      }
    }
  }
  return Number.isFinite(min[0]) ? { min, max } : undefined;
}

// What is computed once per stored list of curves (the document is immutable, so the object of
// `curves` never changes): its fingerprint and the centre of its box.
const DESCRIBED = new WeakMap<object, { data: string; center: Vec2 }>();
function described(curves: Record<string, ImportedCurve>): { data: string; center: Vec2 } {
  let found = DESCRIBED.get(curves);
  if (!found) {
    const box = outlineBox(Object.values(curves));
    found = { data: fingerprint(stableStringify(curves)), center: box ? [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2] : [0, 0] };
    DESCRIBED.set(curves, found);
  }
  return found;
}

// The points of a curve of an outline by the names its shape has; a spline numbers its control
// points from 0.
const pointNames = (curve: ImportedCurve): string[] => (curve.type === 'line' ? ['a', 'b'] : curve.type === 'circle' ? ['center'] : curve.type === 'arc' ? ['center', 'start', 'end'] : curve.points.map((_, i) => String(i)));

export function outlineEntities(id: Id, ref: SketchOutline): Record<Id, EntityKind> {
  const out: Record<Id, EntityKind> = {};
  for (const [local, curve] of Object.entries(ref.curves)) {
    out[`${id}/${local}`] = curve.type;
    const names = pointNames(curve);
    const closed = curve.type === 'spline' && dist(curve.points[0], curve.points[curve.points.length - 1]) === 0;
    for (const name of closed ? names.slice(0, -1) : names) out[`${id}/${local}/${name}`] = 'point';
  }
  return out;
}

// The value of an outline: `at` is where the origin of the file lands, so a point p of the file is
// at `at + R(turn) · p`; with the anchor `center` the centre of the box of the curves lands at
// (x, y), and the outline turns about it.
export function placeOutline(ref: SketchOutline): PlacedOutline {
  const { data, center } = described(ref.curves);
  const anchor: Vec2 = ref.anchor === 'center' ? center : [0, 0];
  const [c, s] = [Math.cos(ref.turn), Math.sin(ref.turn)];
  return { kind: 'outline', at: [ref.x - (c * anchor[0] - s * anchor[1]), ref.y - (s * anchor[0] + c * anchor[1])], turn: ref.turn, data };
}

// kept per entry object (two entries that share one object of curves do not push each other out)
const GEOMETRIES = new WeakMap<object, { key: string; geometry: EntryGeometry }>();
export function outlineGeometry(id: Id, ref: SketchOutline, value: PlacedOutline): EntryGeometry {
  const key = `${id}|${value.at[0]}|${value.at[1]}|${value.turn}|${ref.regions}`;
  const kept = GEOMETRIES.get(ref);
  if (kept?.key === key) return kept.geometry;
  // a turn of zero is the identity, so an outline that is not turned keeps the digits of its file
  const [c, s] = value.turn === 0 ? [1, 0] : [Math.cos(value.turn), Math.sin(value.turn)];
  const at = (p: Vec2): Point2 => ({ x: value.at[0] + c * p[0] - s * p[1], y: value.at[1] + s * p[0] + c * p[1] });
  const points: Record<Id, Point2> = {};
  const curves: Record<Id, CurveShape> = {};
  const radii: Record<Id, number> = {};
  for (const [local, curve] of Object.entries(ref.curves)) {
    const k = `${id}/${local}`;
    switch (curve.type) {
      case 'line':
        points[`${k}/a`] = at(curve.a);
        points[`${k}/b`] = at(curve.b);
        curves[k] = { type: 'line', a: `${k}/a`, b: `${k}/b` };
        break;
      case 'circle':
        points[`${k}/center`] = at(curve.center);
        curves[k] = { type: 'circle', center: `${k}/center` };
        radii[k] = curve.radius;
        break;
      case 'arc': {
        const [center, start, end] = [at(curve.center), at(curve.start), at(curve.end)];
        // the end put on the circle of the start (6b's `exactArc`)
        const [rs, re] = [Math.hypot(start.x - center.x, start.y - center.y), Math.hypot(end.x - center.x, end.y - center.y)];
        points[`${k}/center`] = center;
        points[`${k}/start`] = start;
        points[`${k}/end`] = { x: center.x + (rs * (end.x - center.x)) / re, y: center.y + (rs * (end.y - center.y)) / re };
        curves[k] = { type: 'arc', center: `${k}/center`, start: `${k}/start`, end: `${k}/end` };
        break;
      }
      case 'spline': {
        const n = curve.points.length;
        const closed = dist(curve.points[0], curve.points[n - 1]) === 0;
        const ids = curve.points.map((_, i) => `${k}/${closed && i === n - 1 ? 0 : i}`);
        curve.points.forEach((p, i) => {
          points[ids[i]] = at(p);
        });
        curves[k] = { type: 'spline', points: ids };
        break;
      }
    }
  }
  const geometry: EntryGeometry = { points, curves, radii, regions: ref.regions ? Object.keys(curves) : [] };
  GEOMETRIES.set(ref, { key, geometry });
  return geometry;
}

const PLACE = { title: 'Place', unit: 'mm' } as const;
const TURN = { title: 'Turn', unit: 'rad', min: { value: -TAU }, max: { value: TAU } } as const;
export const MAX_OUTLINE_CURVES = 2000;

function vec2(v: unknown, what: string): Vec2 {
  if (!Array.isArray(v) || v.length !== 2) return fail(`${what}: a pair of numbers is expected`);
  return [finite(v[0], what), finite(v[1], what)];
}

export const OUTLINE_LIMITS = { curves: 2000, control: 2000, splinePoints: 64, localId: 32, arc: 1e-9, arcMost: 1e-7 } as const;
const OWN = new WeakSet<object>();
const polygon = (points: Vec2[]): number => points.slice(1).reduce((sum, p, i) => sum + dist(points[i], p), 0);
// What the validator refuses of one curve, or undefined. The rule the readers and the weld are held
// to: a curve has an extent. Control points of a spline may stand at one place (a node without a
// handle); the spline as a whole may not.
export function curveProblem(curve: ImportedCurve): string | undefined {
  switch (curve.type) {
    case 'line':
      return dist(curve.a, curve.b) < 1e-6 ? 'the line has no length' : undefined;
    case 'circle':
      return curve.radius < 1e-6 ? 'the radius is under the length tolerance' : undefined;
    case 'arc': {
      const [rs, re] = [dist(curve.start, curve.center), dist(curve.end, curve.center)];
      if (rs < 1e-6) return 'the radius is under the length tolerance';
      if (curve.start[0] === curve.end[0] && curve.start[1] === curve.end[1]) return 'the start and the end of the arc are one place; a whole turn is a circle';
      const scale = Math.max(1, ...[curve.center, curve.start, curve.end].flatMap((p) => [Math.abs(p[0]), Math.abs(p[1])]));
      // by the size of the coordinates, and never more than a tenth of the join: far from the origin the
      // placement would otherwise move the end past it
      const most = Math.min(OUTLINE_LIMITS.arc * scale, OUTLINE_LIMITS.arcMost);
      return Math.abs(rs - re) > most ? `the start and the end of the arc are ${Math.abs(rs - re)} mm off one radius (at most ${most})` : undefined;
    }
    case 'spline': {
      const n = curve.points.length;
      if (n < 3 || n > OUTLINE_LIMITS.splinePoints) return `a spline has 3 to ${OUTLINE_LIMITS.splinePoints} control points`;
      const [first, last] = [curve.points[0], curve.points[n - 1]];
      const closed = first[0] === last[0] && first[1] === last[1];
      if (closed && n < 4) return 'a closed spline has at least 4 control points';
      if (!closed && dist(first, last) < 1e-6) return 'the ends of the spline are within the length tolerance and not one place: close it by its first point again';
      return polygon(curve.points) < 1e-6 ? 'the spline has no extent' : undefined;
    }
  }
}
function validate(context: ValidationContext, _sketch: unknown, id: Id, o: Dict, what: string): SketchOutline {
  onlyFields(o, ['type', 'name', 'curves', 'x', 'y', 'turn', 'anchor', 'regions'], what, 'an outline');
  const given = object(o.curves, `${what}.curves`);
  // An object this validator made is taken as it is. Anything else is copied once and the copy is
  // frozen, so the document never holds an object of the caller, and what it holds cannot be
  // written into and sent back unchecked.
  let curves = given as Record<string, ImportedCurve>;
  if (!OWN.has(given)) {
    const keys = Object.keys(given);
    if (keys.length === 0 || keys.length > OUTLINE_LIMITS.curves) fail(`${what}.curves: an outline has 1 to ${OUTLINE_LIMITS.curves} curves, not ${keys.length}`);
    const made: Record<string, ImportedCurve> = {};
    let control = 0;
    for (const key of keys) {
      if (!/^[A-Za-z0-9_]{1,32}$/.test(key) || key in Object.prototype) fail(`${what}.curves: "${key}" is no local ID (letters, digits and underscores, at most ${OUTLINE_LIMITS.localId}, and no name every object has)`);
      const c = object(given[key], `${what}.curves.${key}`);
      const type = oneOf(c.type, ['line', 'circle', 'arc', 'spline'] as const, `${what}.curves.${key}.type`);
      const at = (name: string): Vec2 => Object.freeze(vec2(c[name], `${what}.curves.${key}.${name}`)) as Vec2;
      let curve: ImportedCurve;
      if (type === 'line') curve = { type, a: at('a'), b: at('b') };
      else if (type === 'circle') curve = { type, center: at('center'), radius: finite(c.radius, `${what}.curves.${key}.radius`) };
      else if (type === 'arc') curve = { type, center: at('center'), start: at('start'), end: at('end') };
      else {
        if (!Array.isArray(c.points)) fail(`${what}.curves.${key}.points: a list of positions is expected`);
        curve = { type, points: Object.freeze((c.points as unknown[]).map((p, i) => Object.freeze(vec2(p, `${what}.curves.${key}.points[${i}]`)) as Vec2)) as Vec2[] };
        control += curve.points.length;
      }
      const problem = curveProblem(curve);
      if (problem) fail(`${what}.curves.${key}: ${problem}`);
      made[key] = Object.freeze(curve);
    }
    if (control > OUTLINE_LIMITS.control) fail(`${what}.curves: the splines of an outline have at most ${OUTLINE_LIMITS.control} control points together, not ${control}`);
    curves = Object.freeze(made);
    OWN.add(curves);
  }
  const { fields } = context;
  return {
    type: 'outline',
    ...(typeof o.name === 'string' && o.name !== '' ? { name: o.name } : {}),
    curves,
    x: fields.number(o.x ?? 0, `external/${id}/x`, PLACE, `${what}.x`),
    y: fields.number(o.y ?? 0, `external/${id}/y`, PLACE, `${what}.y`),
    turn: fields.number(o.turn ?? 0, `external/${id}/turn`, TURN, `${what}.turn`),
    anchor: o.anchor === undefined ? 'origin' : oneOf(o.anchor, ['origin', 'center'] as const, `${what}.anchor`),
    regions: o.regions === undefined ? true : boolean(o.regions, `${what}.regions`),
  };
}

export const outlineKind = {
  source: 'reference',
  title: 'Imported outline',
  summary: 'prototype',
  example: { id: 'o', ref: { type: 'outline', curves: { l1: { type: 'line', a: [0, 0], b: [10, 0] } }, x: 0, y: 0, turn: 0, anchor: 'origin', regions: true } },
  validate,
  refs: () => [],
  faces: () => [],
  entities: outlineEntities,
  compute: (ref: SketchOutline) => placeOutline(ref),
  value: (stored: unknown) => (typeof stored === 'object' && stored !== null && (stored as { kind?: string }).kind === 'outline' ? (stored as PlacedOutline) : undefined),
  geometry: outlineGeometry,
  // the stored value is kept when neither the place nor the curves change (the flag, the name)
  keepsValue: (before: SketchOutline, after: SketchOutline): boolean => before.x === after.x && before.y === after.y && before.turn === after.turn && before.anchor === after.anchor && before.curves === after.curves,
};

// Puts the prototype of the kind into the registry of the engine.
export function installOutlineKind(): void {
  (REFERENCE_KINDS as unknown as Record<string, unknown>).outline = outlineKind;
}

// ---------------------------------------------------------------- the reader of DXF

import { type ReadCurve, type ReadOutline, readDxf } from './dxf';
export { type ReadCurve, type ReadOutline, readDxf };

export interface OutlineReport {
  curves: number;
  byKind: Record<string, number>;
  control: number; // the control points of the splines kept
  otherKind: { id: string; type: string }[]; // IDs whose letter is not their type: an arc read as a circle (at most 20)
  welded: number; // ends moved onto another end
  moved: number; // the furthest an end was moved, mm: never more than the weld
  reshaped: number; // arcs whose end moved onto an end of another arc: their circle is through the new ends and the old middle
  reshapedArcs: { id: string; was: number; radius: number }[]; // those arcs with their radius before and after (at most 20, the largest change first)
  bent: number; // the furthest the arc of the file lies off such a circle, mm: never more than the weld
  radius: number; // the largest change of a radius of such an arc, mm (without a bound for a shallow arc)
  closed: number; // arcs of nearly a whole turn read as circles, splines closed onto their start
  dropped: number; // curves with no extent, in the file or after the weld
  duplicates: number; // curves that lay on an earlier curve of the file, left out
  blocked: number; // open ends with another end within the weld that could not be put on it
  crowded: number; // open ends in a crowd (more than CROWD open ends within the weld, or more than SEARCH ends around): not welded
  gaps: { at: Vec2; distance: number; atMost?: true }[]; // open ends with another end near, the nearest first
  open: number; // ends that are the end of no other curve
  bounds?: { min: Vec2; max: Vec2 };
  about: ReadOutline['about'];
}

// The tolerance of a join of the sketch: ends this close are one place to the profile.
export const JOIN = 1e-6;
// An open end with more open ends than this within the weld is in a crowd the weld does not
// resolve; and a search around a place looks at no more than SEARCH candidates, whatever they are.
export const CROWD = 8;
const SEARCH = 64;
// The weld reaches this much further than its number, in mm, and pairs are ordered by their
// distance in this unit: a gap equal to the weld, or two equal gaps, are then not decided by the
// last bit of a difference of two coordinates (a thousandth of the join; the last bit of a
// coordinate is under it up to some kilometres from the origin of the file).
const SLACK = 1e-9;
const angleOf = (center: Vec2, p: Vec2): number => Math.atan2(p[1] - center[1], p[0] - center[0]);
const sweepOf = (center: Vec2, start: Vec2, end: Vec2): number => positive(angleOf(center, end) - angleOf(center, start)) || TAU;
const onArc = (center: Vec2, start: Vec2, sweep: number, part: number): Vec2 => {
  const [r, a] = [dist(start, center), angleOf(center, start) + sweep * part];
  return [center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)];
};
// The centre of the circle through three points, computed from the first of them (so that it does
// not lose its digits far from the origin of the file); undefined when they are nearly in one
// line: the middle less than JOIN off the chord, or a radius of more than FLAT chords.
const FLAT = 1e6;
const circleThrough = (a: Vec2, b: Vec2, c: Vec2): Vec2 | undefined => {
  const [bx, by, cx, cy] = [b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]];
  const d = 2 * (bx * cy - by * cx);
  const chord = Math.hypot(cx, cy);
  if (!(chord > 0) || !(Math.abs(d) / (2 * chord) > JOIN)) return undefined; // |d| / (2 chord) is how far b is off the line a c
  const [b2, c2] = [bx * bx + by * by, cx * cx + cy * cy];
  const [ux, uy] = [(cy * b2 - by * c2) / d, (bx * c2 - cx * b2) / d];
  if (Math.hypot(ux, uy) > FLAT * chord) return undefined;
  return [a[0] + ux, a[1] + uy];
};
// How far the arc of the file lies off a circle, exactly: at its ends, and where it is furthest
// from and nearest to the centre of that circle when it passes there.
const offCircle = (arc: { center: Vec2; start: Vec2; sweep: number }, center: Vec2, radius: number): number => {
  const from = angleOf(arc.center, arc.start);
  const towards = Math.atan2(arc.center[1] - center[1], arc.center[0] - center[0]);
  const parts = [0, 1, ...[towards, towards + Math.PI].map((angle) => positive(angle - from) / arc.sweep).filter((part) => part < 1)];
  return Math.max(...parts.map((part) => Math.abs(dist(onArc(arc.center, arc.start, arc.sweep, part), center) - radius)));
};
const polygonOf = (points: Vec2[]): number => points.slice(1).reduce((sum, p, i) => sum + dist(points[i], p), 0);
// A curve with no extent: what the validator of the kind would refuse for it.
const noExtent = (curve: ImportedCurve): boolean => {
  switch (curve.type) {
    case 'line':
      return dist(curve.a, curve.b) <= JOIN;
    case 'circle':
      return !(curve.radius > JOIN);
    case 'arc':
      return !(dist(curve.start, curve.center) > JOIN) || (dist(curve.start, curve.end) <= JOIN && sweepOf(curve.center, curve.start, curve.end) <= Math.PI);
    case 'spline':
      return polygonOf(curve.points) <= JOIN || (curve.points.length === 3 && dist(curve.points[0], curve.points[2]) <= JOIN);
  }
};
// A curve whose two ends are within `reach` of each other, read as closed: an arc of more than a
// half turn as a circle, a spline of four points or more closed onto its start.
const closedOnto = (curve: ImportedCurve, reach: number): ImportedCurve | undefined => {
  if (curve.type === 'arc' && dist(curve.start, curve.end) <= reach && sweepOf(curve.center, curve.start, curve.end) > Math.PI) return { type: 'circle', center: curve.center, radius: dist(curve.start, curve.center) };
  if (curve.type === 'spline') {
    const [n, first] = [curve.points.length, curve.points[0]];
    const gap = dist(first, curve.points[n - 1]);
    if (n >= 4 && gap > 0 && gap <= reach) return { type: 'spline', points: [...curve.points.slice(0, -1), first] };
  }
  return undefined;
};
// Points in cells, for "what is within a distance of here" with a bound on the work: a search
// stops when it has looked at SEARCH items, whatever they are, and says so (`full`). A search that
// is full has proved nothing about what it did not reach.
export const work = { looked: 0 };
class Cells<T> {
  private readonly cells = new Map<string, { at: Vec2; item: T }[]>();
  constructor(private readonly size: number) {}
  add(at: Vec2, item: T): void {
    const key = `${Math.floor(at[0] / this.size)},${Math.floor(at[1] / this.size)}`;
    const list = this.cells.get(key);
    if (list) list.push({ at, item });
    else this.cells.set(key, [{ at, item }]);
  }
  // the items within `reach` (at most the size of a cell) of a place that `take` accepts
  near(p: Vec2, reach: number, take: (item: T) => boolean, most = Infinity): { found: { item: T; d: number }[]; full: boolean } {
    const found: { item: T; d: number }[] = [];
    let looked = 0;
    const [cx, cy] = [Math.floor(p[0] / this.size), Math.floor(p[1] / this.size)];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const { at, item } of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (++looked > SEARCH) return { found, full: true };
          work.looked++;
          const d = dist(at, p);
          if (d <= reach && take(item) && found.push({ item, d }) >= most) return { found, full: false };
        }
    return { found, full: false };
  }
}
const samePlace = (a: Vec2, b: Vec2): boolean => dist(a, b) <= JOIN;
// Two curves at the same places within JOIN; a line or a spline either way round.
export const sameCurve = (a: ImportedCurve, b: ImportedCurve): boolean => {
  if (a.type === 'line' && b.type === 'line') return (samePlace(a.a, b.a) && samePlace(a.b, b.b)) || (samePlace(a.a, b.b) && samePlace(a.b, b.a));
  if (a.type === 'circle' && b.type === 'circle') return samePlace(a.center, b.center) && Math.abs(a.radius - b.radius) <= JOIN;
  if (a.type === 'arc' && b.type === 'arc') return samePlace(a.center, b.center) && samePlace(a.start, b.start) && samePlace(a.end, b.end);
  if (a.type === 'spline' && b.type === 'spline' && a.points.length === b.points.length) return a.points.every((p, i) => samePlace(p, b.points[i])) || a.points.every((p, i) => samePlace(p, b.points[b.points.length - 1 - i]));
  return false;
};
// Curves found by all that places them, not by one of their points, a step at a time: a line by
// one end, then the other (either way round); a circle by its centre, then its radius; an arc by
// its start, its end, then its centre; a spline by the count of its points and one end, the other
// end (either way round), then the mean of its points. Each step looks into the nine cells around
// (three for a radius), so a twin is found wherever the cells fall, a curve with nothing at its
// first place costs nine looks, and curves that share one point, one centre or two ends only are
// not compared: 2000 lines from one point, 2000 circles about one centre or 2000 arcs between two
// points cost as 2000 curves apart.
type TwinEntry<T> = { curve: ImportedCurve; item: T; order: number };
class Twins<T> {
  private readonly root = new Map<string, unknown>();
  private count = 0;
  private static keys(curve: ImportedCurve): string[][][] {
    const of = (...values: number[]): number[] => values.map((v) => Math.floor(v / JOIN));
    const named = (name: string, ...steps: number[][]): string[][] => steps.map((step, level) => [-1, 0, 1].flatMap((dx) => (step.length === 1 ? [`${level === 0 ? name : ''}${step[0] + dx}`] : [-1, 0, 1].map((dy) => `${level === 0 ? name : ''}${step[0] + dx},${step[1] + dy}`))));
    if (curve.type === 'line') return [named('l', of(...curve.a), of(...curve.b)), named('l', of(...curve.b), of(...curve.a))];
    if (curve.type === 'circle') return [named('c', of(...curve.center), of(curve.radius))];
    if (curve.type === 'arc') return [named('a', of(...curve.start), of(...curve.end), of(...curve.center))];
    const n = curve.points.length;
    const [first, last] = [curve.points[0], curve.points[n - 1]];
    const mean = of(curve.points.reduce((sum, p) => sum + p[0], 0) / n, curve.points.reduce((sum, p) => sum + p[1], 0) / n);
    return [named(`s${n}|`, of(...first), of(...last), mean), named(`s${n}|`, of(...last), of(...first), mean)];
  }
  // each step of a key lists its cell and those around it; the cell itself is the middle one
  private static own = (step: string[]): string => step[(step.length - 1) / 2];
  add(curve: ImportedCurve, item: T): void {
    const order = this.count++;
    for (const steps of Twins.keys(curve)) {
      let node = this.root;
      steps.forEach((step, level) => {
        const [key, last] = [Twins.own(step), level === steps.length - 1];
        let next = node.get(key);
        if (!next) node.set(key, (next = last ? [] : new Map<string, unknown>()));
        if (last) (next as TwinEntry<T>[]).push({ curve, item, order });
        else node = next as Map<string, unknown>;
      });
    }
  }
  // the earliest curve added that lies on this one and that `take` accepts
  find(curve: ImportedCurve, take: (item: T) => boolean = () => true): T | undefined {
    const [steps] = Twins.keys(curve);
    let best: TwinEntry<T> | undefined;
    const walk = (node: Map<string, unknown>, level: number): void => {
      for (const key of steps[level]) {
        const next = node.get(key);
        if (!next) continue;
        if (level < steps.length - 1) walk(next as Map<string, unknown>, level + 1);
        else
          for (const entry of next as TwinEntry<T>[]) {
            work.looked++;
            if ((!best || entry.order < best.order) && take(entry.item) && sameCurve(curve, entry.curve)) best = entry;
          }
      }
    };
    walk(this.root, 0);
    return (best as TwinEntry<T> | undefined)?.item;
  }
}
// The curves of a list that lie on an earlier one, by their index.
function duplicatesOf(curves: (ImportedCurve | undefined)[]): number[] {
  const kept = new Twins<number>();
  const out: number[] = [];
  curves.forEach((curve, index) => {
    if (!curve) return;
    if (kept.find(curve) !== undefined) out.push(index);
    else kept.add(curve, index);
  });
  return out;
}

// The weld (design.md, "The weld"). In this order:
// 0. What has no extent is left out; then a curve whose own ends are within JOIN is closed (an arc
//    of more than a half turn a circle), whatever the tolerance; until nothing changes. A curve
//    that lies on an earlier one is left out, before the ends are looked at.
// 1. With a tolerance: an arc of more than a half turn, or a spline, whose own two ends are within
//    it, with no end of another curve near them, is closed. A search that was cut short proves
//    nothing: the curve is then left as it is.
// 2. An end is met when an end of another curve is within JOIN of it. Met ends never move.
// 3. The pairs of an open end and an end of another curve within the tolerance, the nearest first.
//    An end of a line or a spline goes onto the other end; an end of an arc only onto an end of
//    another arc. An end never goes further than the tolerance from where the file had it, nor to
//    the place its own other end stands at. An open end with more than CROWD open ends around it,
//    or whose search was cut short, is left alone; of the met ends around it only the nearest is
//    a partner.
// 4. What has no extent then is left out, and what lies on an earlier curve; and, as the last
//    thing, whatever the validator of the kind would refuse.
// The result is aligned with the input: undefined where a curve was left out.
export interface Welded {
  curves: (ImportedCurve | undefined)[];
  welded: number;
  moved: number;
  reshaped: number;
  reshapedArcs: { index: number; was: number; radius: number }[];
  bent: number;
  radius: number;
  closed: number;
  dropped: number;
  duplicates: number;
  blocked: number;
  crowded: number;
}
export function weld(read: ReadCurve[], tolerance: number): Welded {
  const w = tolerance >= JOIN ? tolerance : 0;
  const curves: (ImportedCurve | undefined)[] = read.map(({ curve }) => curve);
  const count = { welded: 0, moved: 0, reshaped: 0, bent: 0, radius: 0, closed: 0, dropped: 0, duplicates: 0, blocked: 0, crowded: 0 };
  const reshapedArcs: Welded['reshapedArcs'] = [];
  // what has no extent goes first, whatever its ends; then what closes onto itself; again, since a
  // curve that was closed is another curve (a circle with no radius). A curve is counted once.
  const tidy = (): void => {
    curves.forEach((curve, index) => {
      let now = curve;
      let closed = false;
      for (let round = 0; now && round < 3; round++) {
        if (noExtent(now)) {
          now = undefined;
          break;
        }
        const next = closedOnto(now, JOIN);
        if (!next) break;
        now = next;
        closed = true;
      }
      if (now === curve) return;
      curves[index] = now;
      if (!now) count.dropped++;
      else if (closed) count.closed++;
    });
    for (const index of duplicatesOf(curves)) (curves[index] = undefined), count.duplicates++;
  };
  // the last thing: nothing leaves the weld that the validator of the kind would refuse
  const done = (): Welded => {
    curves.forEach((curve, index) => {
      if (curve && curveProblem(curve)) (curves[index] = undefined), count.dropped++;
    });
    reshapedArcs.sort((p, q) => Math.abs(q.radius - q.was) - Math.abs(p.radius - p.was));
    return { curves, ...count, reshapedArcs };
  };
  tidy();
  if (w === 0) return done();
  interface End {
    curve: number;
    which: 0 | 1;
    was: Vec2;
    at: Vec2;
    settled: boolean;
    crowded: boolean;
    wanted: boolean;
  }
  const endsOf = (curve: ImportedCurve): Vec2[] => (curve.type === 'line' ? [curve.a, curve.b] : curve.type === 'arc' ? [curve.start, curve.end] : curve.type === 'spline' && dist(curve.points[0], curve.points[curve.points.length - 1]) > 0 ? [curve.points[0], curve.points[curve.points.length - 1]] : []);
  const collect = (): End[] => curves.flatMap((curve, index) => (curve ? endsOf(curve).map((p, which): End => ({ curve: index, which: which as 0 | 1, was: p, at: p, settled: false, crowded: false, wanted: false })) : []));
  // within the weld: its number and the slack
  const reach = w + SLACK;
  const cellsOf = (ends: End[], size = reach): Cells<End> => {
    const cells = new Cells<End>(size);
    for (const e of ends) cells.add(e.at, e);
    return cells;
  };
  // 1. curves that close onto themselves within the weld, with nothing else near their ends
  {
    const all = cellsOf(collect());
    curves.forEach((curve, index) => {
      if (!curve || (curve.type !== 'arc' && curve.type !== 'spline')) return;
      const closed = closedOnto(curve, reach);
      if (!closed || noExtent(closed)) return;
      // another end near, or a search that could not say: the curve stays as it is
      if (endsOf(curve).some((p) => ((near) => near.full || near.found.length > 0)(all.near(p, reach, (e) => e.curve !== index, 1)))) return;
      if (curve.type === 'spline') (count.welded++, (count.moved = Math.max(count.moved, dist(curve.points[0], curve.points[curve.points.length - 1]))));
      curves[index] = closed;
      count.closed++;
    });
  }
  // 2. the ends: met, in a crowd, open
  const ends = collect();
  const cells = cellsOf(ends);
  const fine = cellsOf(ends, JOIN); // "met" is asked in cells of the join: a dense place does not cut that search short
  const order = new Map(ends.map((e, i) => [e, i]));
  const partner = new Map<End, End>();
  for (let i = 0; i + 1 < ends.length; i++) if (ends[i].curve === ends[i + 1].curve) (partner.set(ends[i], ends[i + 1]), partner.set(ends[i + 1], ends[i]));
  const arcs = new Map<number, { center: Vec2; radius: number; sweep: number; start: Vec2; now: Vec2; moved: boolean }>();
  curves.forEach((curve, index) => {
    if (curve?.type === 'arc') arcs.set(index, { center: curve.center, radius: dist(curve.start, curve.center), sweep: sweepOf(curve.center, curve.start, curve.end), start: curve.start, now: curve.center, moved: false });
  });
  const unknown = new Set<End>();
  for (const e of ends) {
    const met = fine.near(e.at, JOIN, (f) => f.curve !== e.curve, 1);
    e.settled = met.found.length > 0;
    if (!e.settled && met.full) unknown.add(e);
  }
  const pairs: { a: End; b: End; d: number }[] = [];
  const candidates = new Map<End, { item: End; d: number }[]>();
  for (const e of ends) {
    if (e.settled) continue;
    const around = cells.near(e.at, reach, (f) => f.curve !== e.curve);
    e.wanted = around.found.length > 0;
    const open = around.found.filter(({ item }) => !item.settled);
    // a crowd is of open ends: the met ends around (the vertices of a polyline of short segments) are not it
    e.crowded = unknown.has(e) || around.full || open.length > CROWD;
    const nearestMet = around.found.filter(({ item }) => item.settled).sort((p, q) => p.d - q.d)[0];
    candidates.set(e, [...open, ...(nearestMet ? [nearestMet] : [])]);
  }
  for (const a of ends) {
    if (a.settled || a.crowded) continue;
    for (const { item: b, d } of candidates.get(a) ?? []) {
      if (b.crowded) continue;
      if (!b.settled && (order.get(b) as number) < (order.get(a) as number)) continue; // two open ends: once
      pairs.push({ a, b, d });
    }
  }
  const unit = (d: number): number => Math.round(d / SLACK);
  pairs.sort((p, q) => unit(p.d) - unit(q.d) || (order.get(p.a) as number) - (order.get(q.a) as number) || (order.get(p.b) as number) - (order.get(q.b) as number));
  const isArc = (e: End): boolean => curves[e.curve]?.type === 'arc';
  // 3. whether an end may go onto the end `stay`, and for an arc the centre it then has
  const mayGo = (e: End, stay: End): { center?: Vec2; change?: number } | undefined => {
    const to = stay.at;
    const mate = partner.get(e) as End;
    if (dist(e.was, to) > reach || dist(mate.at, to) <= JOIN) return undefined;
    const curve = curves[e.curve] as ImportedCurve;
    if (curve.type !== 'arc') return {};
    // an arc gives way to another arc only: beside a line or a spline it keeps the digits of its file
    if (!isArc(stay)) return undefined;
    const arc = arcs.get(e.curve) as { center: Vec2; radius: number; sweep: number; start: Vec2 };
    const [start, end] = e.which === 0 ? [to, mate.at] : [mate.at, to];
    // the circle through the two ends and the middle of the arc of the file
    const middle = onArc(arc.center, arc.start, arc.sweep, 0.5);
    const center = circleThrough(start, middle, end);
    if (!center) return undefined;
    const r = dist(start, center);
    // the arc it makes is one the validator takes (its two ends on one radius), the middle is
    // between the ends the same way round, and the arc of the file is nowhere further than the
    // weld from the new circle
    if (curveProblem({ type: 'arc', center, start, end })) return undefined;
    if (!(positive(angleOf(center, middle) - angleOf(center, start)) < sweepOf(center, start, end))) return undefined;
    if (offCircle(arc, center, r) > reach) return undefined;
    return { center, change: Math.abs(r - arc.radius) / arc.radius };
  };
  for (const { a, b } of pairs) {
    if (a.settled && b.settled) continue;
    const free = [a, b].filter((e) => !e.settled);
    // who moves: of two open ends a line or a spline before an arc; of two arcs the one whose
    // radius changes less in proportion, then the later of the file
    const later = [a, b].sort((p, q) => (order.get(q) as number) - (order.get(p) as number));
    let movers = free.length === 2 ? (isArc(a) !== isArc(b) ? (isArc(a) ? [b, a] : [a, b]) : later) : free;
    if (free.length === 2 && isArc(a) && isArc(b)) {
      const change = (e: End): number => mayGo(e, e === a ? b : a)?.change ?? Infinity;
      movers = [...later].sort((p, q) => unit(change(p)) - unit(change(q)));
    }
    for (const mover of movers) {
      const stay = mover === a ? b : a;
      const how = mayGo(mover, stay);
      if (!how) continue;
      mover.at = stay.at;
      if (how.center) Object.assign(arcs.get(mover.curve) as object, { now: how.center, moved: true });
      a.settled = b.settled = true;
      break;
    }
  }
  for (const e of ends) {
    const d = dist(e.was, e.at);
    if (d > 0) (count.welded++, (count.moved = Math.max(count.moved, d)));
    if (e.settled) continue;
    if (e.crowded) count.crowded++;
    else if (e.wanted) count.blocked++;
  }
  // the curves again
  const at = new Map<number, [Vec2, Vec2]>();
  for (let i = 0; i + 1 < ends.length; i++) if (ends[i].curve === ends[i + 1].curve) at.set(ends[i].curve, [ends[i].at, ends[i + 1].at]);
  curves.forEach((curve, index) => {
    const pair = at.get(index);
    if (!curve || !pair) return;
    const [first, last] = pair;
    if (curve.type === 'line') curves[index] = { type: 'line', a: first, b: last };
    else if (curve.type === 'spline') curves[index] = { type: 'spline', points: [first, ...curve.points.slice(1, -1), last] };
    else if (curve.type === 'arc') {
      // an arc whose ends stayed is the arc of the file, to the digit
      const arc = arcs.get(index) as { center: Vec2; radius: number; sweep: number; start: Vec2; now: Vec2; moved: boolean };
      if (!arc.moved) return;
      const r = dist(first, arc.now);
      count.reshaped++;
      reshapedArcs.push({ index, was: arc.radius, radius: r });
      count.radius = Math.max(count.radius, Math.abs(r - arc.radius));
      count.bent = Math.max(count.bent, offCircle(arc, arc.now, r));
      curves[index] = { type: 'arc', center: arc.now, start: first, end: last };
    }
  });
  tidy();
  return done();
}

// The ends of an outline that are the end of no other curve, and of them at most 20 with another
// end within a hundred tolerances, the nearest first. The nearest other end is looked for outward:
// in cells of one tolerance, then of ten, then of a hundred, and the first size that has one gives
// it, so a dense place a millimetre away does not hide a gap beside the end (the third review).
// Every search is bounded; one that was cut short gives a distance that is an upper bound
// (`atMost`), and an end whose search for a met end was cut short is counted as open.
export function openEnds(curves: Iterable<ImportedCurve>, tolerance: number): { open: number; gaps: OutlineReport['gaps'] } {
  const step = Math.max(tolerance, JOIN);
  type E = { curve: number; at: Vec2 };
  const ends: E[] = [];
  let index = 0;
  for (const curve of curves) {
    const own = curve.type === 'line' ? [curve.a, curve.b] : curve.type === 'arc' ? [curve.start, curve.end] : curve.type === 'spline' && dist(curve.points[0], curve.points[curve.points.length - 1]) > 0 ? [curve.points[0], curve.points[curve.points.length - 1]] : [];
    for (const at of own) ends.push({ curve: index, at });
    index++;
  }
  const fine = new Cells<E>(JOIN);
  const rings = [1, 10, 100].map((times) => ({ reach: times * step, cells: new Cells<E>(times * step) }));
  for (const e of ends) (fine.add(e.at, e), rings.forEach((ring) => ring.cells.add(e.at, e)));
  const gaps: OutlineReport['gaps'] = [];
  let open = 0;
  for (const e of ends) {
    if (fine.near(e.at, JOIN, (f) => f.curve !== e.curve, 1).found.length > 0) continue;
    open++;
    let cut = false;
    for (const ring of rings) {
      const { found, full } = ring.cells.near(e.at, ring.reach, (f) => f.curve !== e.curve);
      cut ||= full;
      if (found.length === 0) continue;
      gaps.push({ at: e.at, distance: Math.min(...found.map(({ d }) => d)), ...(cut ? { atMost: true as const } : {}) });
      break;
    }
  }
  gaps.sort((p, q) => p.distance - q.distance);
  return { open, gaps: gaps.slice(0, 20) };
}

// The whole import: read, name, weld. The local IDs are given first, from the curves as the reader
// gave them: by the kind of the file and its order (`l1`, `a1`, `c1`, `s1`). Nothing after that
// renames a curve: one that is left out leaves its number unused, and an arc of nearly a whole turn
// that is read as a circle keeps the ID the file gave it (`a3` is then a circle).
export function assemble(read: ReadOutline, tolerance = 1e-2): { curves: Record<string, ImportedCurve>; report: OutlineReport } {
  const counts: Record<string, number> = { line: 0, arc: 0, circle: 0, spline: 0 };
  const ids = read.curves.map(({ curve }) => `${curve.type[0]}${++counts[curve.type]}`);
  const made = weld(read.curves, tolerance);
  const byKind: Record<string, number> = { line: 0, arc: 0, circle: 0, spline: 0 };
  const curves: Record<string, ImportedCurve> = {};
  const otherKind: OutlineReport['otherKind'] = [];
  let control = 0;
  made.curves.forEach((curve, index) => {
    if (!curve) return;
    curves[ids[index]] = curve;
    byKind[curve.type]++;
    if (curve.type[0] !== ids[index][0] && otherKind.length < 20) otherKind.push({ id: ids[index], type: curve.type });
    if (curve.type === 'spline') control += curve.points.length;
  });
  const kept = Object.values(curves);
  // the limits of an outline before anything is computed for the report
  if (kept.length > OUTLINE_LIMITS.curves) throw new Error(`tooLarge: ${kept.length} curves, more than the ${OUTLINE_LIMITS.curves} an outline holds`);
  if (control > OUTLINE_LIMITS.control) throw new Error(`tooLarge: ${control} control points of splines, more than the ${OUTLINE_LIMITS.control} an outline holds`);
  const bounds = outlineBox(kept);
  const { curves: _, reshapedArcs, ...numbers } = made;
  return { curves, report: { curves: kept.length, byKind, control, otherKind, ...numbers, reshapedArcs: reshapedArcs.slice(0, 20).map(({ index, was, radius }) => ({ id: ids[index], was, radius })), ...openEnds(kept, tolerance), ...(bounds ? { bounds } : {}), about: read.about } };
}
export const importOutline = (text: string, options: { layers?: string[]; unit?: string; weld?: number } = {}): { curves: Record<string, ImportedCurve>; report: OutlineReport } => assemble(readDxf(text, options), options.weld);

// What a revised outline does to the IDs of the one before it.
// - `kept`: the IDs both have; `changed`: of them, those whose curve is at no place a curve of the
//   old outline had (it moved, or it is a new curve under an old ID).
// - `added`, `removed`: the IDs only the new, only the old outline has.
// - `renamed`: an ID, old or new, whose curve is where the old outline had the curve of another ID
//   (a swap in the order of the file, a curve put in before it). Places are compared by distance
//   (within JOIN), a line or a spline either way round.
export function outlineRevision(before: Record<string, ImportedCurve>, after: Record<string, ImportedCurve>): { kept: number; changed: number; added: string[]; removed: string[]; renamed: { id: string; was: string }[] } {
  const old = new Twins<string>();
  for (const [id, curve] of Object.entries(before)) old.add(curve, id);
  const has = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);
  const renamed: { id: string; was: string }[] = [];
  let [kept, changed] = [0, 0];
  for (const [id, curve] of Object.entries(after)) {
    const here = has(before, id);
    if (here) kept++;
    if (here && sameCurve(before[id], curve)) continue;
    const was = old.find(curve, (other) => other !== id);
    if (was !== undefined) renamed.push({ id, was });
    else if (here) changed++;
  }
  return { kept, changed, added: Object.keys(after).filter((id) => !has(before, id)), removed: Object.keys(before).filter((id) => !has(after, id)), renamed };
}

export const outlineEntry = (curves: Record<string, ImportedCurve>, more: Partial<SketchOutline> = {}): SketchOutline => ({ type: 'outline', curves, x: 0, y: 0, turn: 0, anchor: 'origin', regions: true, ...more });
