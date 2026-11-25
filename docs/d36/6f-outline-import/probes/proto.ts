// A prototype of 6f (D72) for the probes of its design: the stored outline, the kind `outline` of
// `external`, the reader of DXF and the weld. Not the implementation: it validates little, its
// texts are short, and it is put into the registry of kinds at run time (`installOutlineKind`).
// What the probes measure with it is recorded in design.md, "Measured".
import type { EntityKind } from '../../../../packages/engine/src/catalog';
import { REFERENCE_KINDS } from '../../../../packages/engine/src/references/index';
import type { EntryGeometry } from '../../../../packages/engine/src/references/spec';
import { bsplineBeziers, splineBox } from '../../../../packages/engine/src/spline';
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

const GEOMETRIES = new WeakMap<object, { key: string; geometry: EntryGeometry }>();
export function outlineGeometry(id: Id, ref: SketchOutline, value: PlacedOutline): EntryGeometry {
  const key = `${id}|${value.at[0]}|${value.at[1]}|${value.turn}|${ref.regions}`;
  const kept = GEOMETRIES.get(ref.curves);
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
  GEOMETRIES.set(ref.curves, { key, geometry });
  return geometry;
}

const PLACE = { title: 'Place', unit: 'mm' } as const;
const TURN = { title: 'Turn', unit: 'rad', min: { value: -TAU }, max: { value: TAU } } as const;
export const MAX_OUTLINE_CURVES = 2000;

function vec2(v: unknown, what: string): Vec2 {
  if (!Array.isArray(v) || v.length !== 2) return fail(`${what}: a pair of numbers is expected`);
  return [finite(v[0], what), finite(v[1], what)];
}

const OWN = new WeakSet<object>();
const remembered = <T extends object>(made: T): T => (OWN.add(made), made);
function validate(context: ValidationContext, _sketch: unknown, id: Id, o: Dict, what: string): SketchOutline {
  onlyFields(o, ['type', 'name', 'curves', 'x', 'y', 'turn', 'anchor', 'regions'], what, 'an outline');
  const given = object(o.curves, `${what}.curves`);
  const own = OWN.has(given);
  const keys = own ? [] : Object.keys(given);
  if (!own && (keys.length === 0 || keys.length > MAX_OUTLINE_CURVES)) fail(`${what}.curves: an outline has 1 to ${MAX_OUTLINE_CURVES} curves, not ${keys.length}`);
  // an object this validator made is taken as it is; anything else is copied once (the document
  // never holds an object of the caller)
  const curves: Record<string, ImportedCurve> = own ? (given as Record<string, ImportedCurve>) : Object.create(null);
  for (const key of keys) {
    if (!/^[A-Za-z0-9_]+$/.test(key) || key in Object.prototype) fail(`${what}.curves: "${key}" is no local ID (letters, digits and underscores, and no name every object has)`);
    const c = object(given[key], `${what}.curves.${key}`);
    const type = oneOf(c.type, ['line', 'circle', 'arc', 'spline'] as const, `${what}.curves.${key}.type`);
    const at = (name: string): Vec2 => vec2(c[name], `${what}.curves.${key}.${name}`);
    if (type === 'line') curves[key] = { type, a: at('a'), b: at('b') };
    else if (type === 'circle') curves[key] = { type, center: at('center'), radius: finite(c.radius, `${what}.curves.${key}.radius`) };
    else if (type === 'arc') curves[key] = { type, center: at('center'), start: at('start'), end: at('end') };
    else curves[key] = { type, points: (c.points as unknown[]).map((p, i) => vec2(p, `${what}.curves.${key}.points[${i}]`)) };
  }
  const { fields } = context;
  return {
    type: 'outline',
    ...(typeof o.name === 'string' ? { name: o.name } : {}),
    curves: own ? curves : remembered({ ...curves }),
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
  welded: number; // ends moved onto another end
  moved: number; // the furthest an end was moved, mm: never more than the weld
  shifted: number; // the furthest the centre of an arc was moved, mm: never more than the weld
  closed: number; // arcs of nearly a whole turn read as circles, splines closed onto their start
  dropped: number; // curves with no extent after the weld
  duplicates: number; // curves that lay on an earlier curve of the file, left out
  blocked: number; // welds not made: they would move an end or an arc further than the weld
  gaps: { at: Vec2; distance: number }[]; // open ends with another end near, the nearest first
  open: number; // ends that are the end of no other curve
  bounds?: { min: Vec2; max: Vec2 };
  about: ReadOutline['about'];
}

// The tolerance of a join of the sketch: ends this close are one place to the profile.
export const JOIN = 1e-6;
const sweepOf = (center: Vec2, start: Vec2, end: Vec2): number => positive(Math.atan2(end[1] - center[1], end[0] - center[0]) - Math.atan2(start[1] - center[1], start[0] - center[0])) || TAU;
// The centre of an arc put onto the bisector of its chord, at the point nearest to where it was.
const recentred = (center: Vec2, start: Vec2, end: Vec2): Vec2 => {
  const chord = dist(start, end);
  if (chord === 0) return center;
  const mid: Vec2 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  const d: Vec2 = [(end[0] - start[0]) / chord, (end[1] - start[1]) / chord];
  const along = (center[0] - mid[0]) * d[0] + (center[1] - mid[1]) * d[1];
  return [center[0] - along * d[0], center[1] - along * d[1]];
};

// The weld (design.md, "The weld"). Nothing is merged transitively and no end moves further than
// the tolerance:
// 1. An arc of more than a half turn whose own two ends are within the tolerance, with no end of
//    another curve near them, is a circle; an open spline likewise is closed onto its start.
// 2. An end is met when an end of another curve is within JOIN of it. Met ends never move.
// 3. The pairs of an open end and an end of another curve within the tolerance, the nearest first:
//    of two open ends one moves onto the other (an end of an arc stays where a line or a spline
//    can move; otherwise the later in the file moves); an open end moves onto an end that is
//    settled only when that keeps it within the tolerance of where the file had it.
// 4. An arc whose end moved gets its centre onto the bisector of its chord; the move is made only
//    when the centre and the radius change by no more than the tolerance and the sweep keeps its
//    branch, measured against the arc of the file.
// 5. A line whose ends became one place is dropped; a curve that lies on an earlier one is left out.
// The result is aligned with the input: undefined where a curve was left out.
export function weld(read: ReadCurve[], tolerance: number): { curves: (ImportedCurve | undefined)[]; welded: number; moved: number; shifted: number; closed: number; dropped: number; duplicates: number; blocked: number; gaps: OutlineReport['gaps']; open: number } {
  const w = tolerance >= JOIN ? tolerance : 0;
  const curves: (ImportedCurve | undefined)[] = read.map(({ curve }) => curve);
  let [welded, moved, shifted, closed, dropped, duplicates, blocked] = [0, 0, 0, 0, 0, 0, 0];
  interface End {
    curve: number;
    which: 0 | 1;
    was: Vec2;
    at: Vec2;
    settled: boolean;
  }
  const endsOf = (curve: ImportedCurve): Vec2[] => (curve.type === 'line' ? [curve.a, curve.b] : curve.type === 'arc' ? [curve.start, curve.end] : curve.type === 'spline' && dist(curve.points[0], curve.points[curve.points.length - 1]) > 0 ? [curve.points[0], curve.points[curve.points.length - 1]] : []);
  const collect = (): End[] => curves.flatMap((curve, index) => (curve ? endsOf(curve).map((p, which): End => ({ curve: index, which: which as 0 | 1, was: p, at: p, settled: false })) : []));
  const gridOf = (ends: End[], size: number): ((p: Vec2, reach: number) => End[]) => {
    const grid = new Map<string, End[]>();
    const cell = (v: number): number => Math.floor(v / size);
    for (const e of ends) {
      const key = `${cell(e.at[0])},${cell(e.at[1])}`;
      const list = grid.get(key);
      if (list) list.push(e);
      else grid.set(key, [e]);
    }
    return (p, reach) => {
      const found: End[] = [];
      const n = Math.ceil(reach / size);
      for (let dx = -n; dx <= n; dx++) for (let dy = -n; dy <= n; dy++) for (const e of grid.get(`${cell(p[0]) + dx},${cell(p[1]) + dy}`) ?? []) if (dist(e.at, p) <= reach) found.push(e);
      return found;
    };
  };
  const size = Math.max(w, JOIN);
  // 1. curves that close onto themselves
  if (w > 0) {
    const near = gridOf(collect(), size);
    curves.forEach((curve, index) => {
      if (!curve || (curve.type !== 'arc' && curve.type !== 'spline')) return;
      const [first, last] = endsOf(curve);
      if (!first || dist(first, last) > w) return;
      if ([first, last].some((p) => near(p, w).some((e) => e.curve !== index))) return;
      if (curve.type === 'arc') {
        if (sweepOf(curve.center, curve.start, curve.end) <= Math.PI) return;
        curves[index] = { type: 'circle', center: curve.center, radius: dist(curve.start, curve.center) };
      } else {
        const n = curve.points.length;
        if (n < 4 || dist(curve.points[n - 2], first) <= JOIN) return;
        curves[index] = { type: 'spline', points: [...curve.points.slice(0, -1), first] };
        moved = Math.max(moved, dist(first, last));
        welded++;
      }
      closed++;
    });
  }
  // 2. and 3. the ends
  const ends = collect();
  const near = gridOf(ends, size);
  const arcs = new Map<number, { center: Vec2; radius: number; sweep: number; now: Vec2 }>();
  curves.forEach((curve, index) => {
    if (curve?.type === 'arc') arcs.set(index, { center: curve.center, radius: dist(curve.start, curve.center), sweep: sweepOf(curve.center, curve.start, curve.end), now: curve.center });
  });
  for (const e of ends) e.settled = near(e.at, JOIN).some((f) => f.curve !== e.curve);
  const partner = new Map<End, End>();
  for (let i = 0; i + 1 < ends.length; i++) if (ends[i].curve === ends[i + 1].curve) (partner.set(ends[i], ends[i + 1]), partner.set(ends[i + 1], ends[i]));
  // whether an end may go to a place: an end of an arc only when its arc stays within the weld of the arc of the file
  const mayGo = (e: End, to: Vec2): { center?: Vec2 } | undefined => {
    if (dist(e.was, to) > w) return undefined;
    const curve = curves[e.curve] as ImportedCurve;
    const mate = partner.get(e) as End;
    if (curve.type === 'line') return {};
    if (curve.type === 'spline') {
      const inner = e.which === 0 ? curve.points[1] : curve.points[curve.points.length - 2];
      return dist(inner, to) > JOIN && dist(mate.at, to) > JOIN ? {} : undefined;
    }
    if (curve.type !== 'arc') return undefined;
    const arc = arcs.get(e.curve) as { center: Vec2; radius: number; sweep: number };
    const [start, end] = e.which === 0 ? [to, mate.at] : [mate.at, to];
    if (dist(start, end) <= JOIN) return undefined;
    const center = recentred(arc.center, start, end);
    if (dist(center, arc.center) > w || Math.abs(dist(start, center) - arc.radius) > w || Math.abs(sweepOf(center, start, end) - arc.sweep) >= Math.PI) return undefined;
    return { center };
  };
  const go = (e: End, to: Vec2, how: { center?: Vec2 }): void => {
    e.at = to;
    if (how.center) (arcs.get(e.curve) as { now: Vec2 }).now = how.center;
  };
  if (w > 0) {
    const order = new Map(ends.map((e, i) => [e, i]));
    const pairs: { a: End; b: End; d: number }[] = [];
    ends.forEach((a, i) => {
      if (a.settled) return;
      for (const b of near(a.at, w)) {
        if (b.curve === a.curve) continue;
        if (!b.settled && (order.get(b) as number) < i) continue; // two open ends: once
        pairs.push({ a, b, d: dist(a.at, b.at) });
      }
    });
    pairs.sort((p, q) => p.d - q.d || (order.get(p.a) as number) - (order.get(q.a) as number) || (order.get(p.b) as number) - (order.get(q.b) as number));
    for (const { a, b } of pairs) {
      if (a.settled && b.settled) continue;
      const isArc = (e: End): boolean => curves[e.curve]?.type === 'arc';
      // who may move: an open end; of two, a line or a spline before an arc, then the later of the file
      const free = [a, b].filter((e) => !e.settled);
      const movers = free.length === 2 ? (isArc(a) !== isArc(b) ? (isArc(a) ? [b, a] : [a, b]) : [b, a].sort((p, q) => (order.get(q) as number) - (order.get(p) as number))) : free;
      let made = false;
      for (const mover of movers) {
        const stay = mover === a ? b : a;
        const how = mayGo(mover, stay.at);
        if (!how) continue;
        go(mover, stay.at, how);
        made = true;
        break;
      }
      if (made) a.settled = b.settled = true;
      else blocked++;
    }
  }
  for (const e of ends) {
    const d = dist(e.was, e.at);
    if (d > 0) {
      welded++;
      moved = Math.max(moved, d);
    }
  }
  // 4. and 5. the curves again
  const at = new Map<number, [Vec2, Vec2]>();
  for (let i = 0; i + 1 < ends.length; i++) if (ends[i].curve === ends[i + 1].curve) at.set(ends[i].curve, [ends[i].at, ends[i + 1].at]);
  curves.forEach((curve, index) => {
    if (!curve) return;
    const pair = at.get(index);
    if (curve.type === 'circle') {
      if (!(curve.radius > JOIN)) (curves[index] = undefined), dropped++;
      return;
    }
    if (!pair) return; // a closed spline
    const [first, last] = pair;
    if (curve.type === 'line') {
      if (dist(first, last) <= JOIN) (curves[index] = undefined), dropped++;
      else curves[index] = { type: 'line', a: first, b: last };
    } else if (curve.type === 'arc') {
      const arc = arcs.get(index) as { center: Vec2; now: Vec2; sweep: number };
      if (dist(first, last) <= JOIN) {
        (curves[index] = undefined), dropped++;
        return;
      }
      // an arc of the file whose ends stayed keeps its digits unless they are off one radius
      const scale = Math.max(1, Math.abs(first[0]), Math.abs(first[1]), Math.abs(last[0]), Math.abs(last[1]));
      const exact = Math.abs(dist(first, arc.now) - dist(last, arc.now)) <= 1e-12 * scale;
      const center = exact ? arc.now : recentred(arc.now, first, last);
      shifted = Math.max(shifted, dist(center, arc.center));
      curves[index] = { type: 'arc', center, start: first, end: last };
    } else curves[index] = { type: 'spline', points: [first, ...curve.points.slice(1, -1), last] };
  });
  // curves that lie on an earlier one: the same places within JOIN, a line or a spline either way round
  const seen = new Set<string>();
  const r = (p: Vec2): string => `${Math.round(p[0] / JOIN)},${Math.round(p[1] / JOIN)}`;
  curves.forEach((curve, index) => {
    if (!curve) return;
    const way = (points: Vec2[]): string => {
      const [f, b] = [points.map(r).join(';'), [...points].reverse().map(r).join(';')];
      return f < b ? f : b;
    };
    const key = curve.type === 'line' ? `l${way([curve.a, curve.b])}` : curve.type === 'circle' ? `c${r(curve.center)};${Math.round(curve.radius / JOIN)}` : curve.type === 'arc' ? `a${r(curve.center)};${r(curve.start)};${r(curve.end)}` : `s${way(curve.points)}`;
    if (seen.has(key)) (curves[index] = undefined), duplicates++;
    else seen.add(key);
  });
  // the report: the ends that are still the end of no other curve
  const last = collect();
  const nearLast = gridOf(last, size);
  const gaps: OutlineReport['gaps'] = [];
  let open = 0;
  for (const e of last) {
    if (nearLast(e.at, JOIN).some((f) => f.curve !== e.curve)) continue;
    open++;
    const others = nearLast(e.at, 100 * size).filter((f) => f.curve !== e.curve);
    if (others.length > 0) gaps.push({ at: e.at, distance: Math.min(...others.map((f) => dist(f.at, e.at))) });
  }
  gaps.sort((p, q) => p.distance - q.distance);
  return { curves, welded, moved, shifted, closed, dropped, duplicates, blocked, gaps: gaps.slice(0, 20), open };
}

// The whole import: read, name, weld. Local IDs by kind and by the order of the file (`l1`, `a1`,
// `c1`, `s1`), given before the weld: a curve the weld leaves out leaves a gap and renames nothing.
// (A near-whole arc read as a circle is numbered as a circle.)
export function assemble(read: ReadOutline, tolerance = 1e-2): { curves: Record<string, ImportedCurve>; report: OutlineReport } {
  const made = weld(read.curves, tolerance);
  const counts: Record<string, number> = { line: 0, arc: 0, circle: 0, spline: 0 };
  const byKind: Record<string, number> = { line: 0, arc: 0, circle: 0, spline: 0 };
  const curves: Record<string, ImportedCurve> = {};
  read.curves.forEach(({ curve: was }, index) => {
    const curve = made.curves[index];
    const type = curve?.type ?? was.type;
    const id = `${type[0]}${++counts[type]}`;
    if (!curve) return;
    curves[id] = curve;
    byKind[type]++;
  });
  const kept = Object.values(curves);
  if (kept.length > MAX_OUTLINE_CURVES) throw new Error(`tooLarge: ${kept.length} curves, more than the ${MAX_OUTLINE_CURVES} an outline holds`);
  const bounds = outlineBox(kept);
  const { curves: _, ...numbers } = made;
  return { curves, report: { curves: kept.length, byKind, ...numbers, ...(bounds ? { bounds } : {}), about: read.about } };
}
export const importOutline = (text: string, options: { layers?: string[]; unit?: string; weld?: number } = {}): { curves: Record<string, ImportedCurve>; report: OutlineReport } => assemble(readDxf(text, options), options.weld);

// What a revised outline does to the IDs of the one before it. `renamed`: an ID whose curve is, in
// the new file, where the old file had the curve of another ID of its kind (a swap in the order of
// the file); found by the places rounded to JOIN, with no matching by geometry beyond that.
export function outlineRevision(before: Record<string, ImportedCurve>, after: Record<string, ImportedCurve>): { kept: number; added: string[]; removed: string[]; renamed: { id: string; was: string }[] } {
  const r = (p: Vec2): string => `${Math.round(p[0] / JOIN)},${Math.round(p[1] / JOIN)}`;
  const key = (curve: ImportedCurve): string => (curve.type === 'line' ? `l${r(curve.a)};${r(curve.b)}` : curve.type === 'circle' ? `c${r(curve.center)};${Math.round(curve.radius / JOIN)}` : curve.type === 'arc' ? `a${r(curve.center)};${r(curve.start)};${r(curve.end)}` : `s${curve.points.map(r).join(';')}`);
  const was = new Map(Object.entries(before).map(([id, curve]) => [key(curve), id]));
  const renamed: { id: string; was: string }[] = [];
  for (const [id, curve] of Object.entries(after)) {
    const old = was.get(key(curve));
    if (old !== undefined && old !== id && before[id] && key(before[id]) !== key(curve)) renamed.push({ id, was: old });
  }
  return { kept: Object.keys(after).filter((id) => id in before).length, added: Object.keys(after).filter((id) => !(id in before)), removed: Object.keys(before).filter((id) => !(id in after)), renamed };
}

export const outlineEntry = (curves: Record<string, ImportedCurve>, more: Partial<SketchOutline> = {}): SketchOutline => ({ type: 'outline', curves, x: 0, y: 0, turn: 0, anchor: 'origin', regions: true, ...more });
