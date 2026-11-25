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
export type OutlineCurve =
  | { type: 'line'; a: Vec2; b: Vec2 }
  | { type: 'circle'; center: Vec2; radius: number }
  | { type: 'arc'; center: Vec2; start: Vec2; end: Vec2 } // counter-clockwise from start to end
  | { type: 'spline'; points: Vec2[] }; // the control points of a spline of 6d (3 to 64)

export interface SketchOutline {
  type: 'outline';
  name?: string;
  curves: Record<string, OutlineCurve>;
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
export function outlineBox(curves: Iterable<OutlineCurve>): { min: Vec2; max: Vec2 } | undefined {
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
function described(curves: Record<string, OutlineCurve>): { data: string; center: Vec2 } {
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
const pointNames = (curve: OutlineCurve): string[] => (curve.type === 'line' ? ['a', 'b'] : curve.type === 'circle' ? ['center'] : curve.type === 'arc' ? ['center', 'start', 'end'] : curve.points.map((_, i) => String(i)));

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

function validate(context: ValidationContext, _sketch: unknown, id: Id, o: Dict, what: string): SketchOutline {
  onlyFields(o, ['type', 'name', 'curves', 'x', 'y', 'turn', 'anchor', 'regions'], what, 'an outline');
  const given = object(o.curves, `${what}.curves`);
  const keys = Object.keys(given);
  if (keys.length === 0 || keys.length > MAX_OUTLINE_CURVES) fail(`${what}.curves: an outline has 1 to ${MAX_OUTLINE_CURVES} curves, not ${keys.length}`);
  const curves: Record<string, OutlineCurve> = {};
  for (const key of keys) {
    if (!/^[A-Za-z0-9_]+$/.test(key)) fail(`${what}.curves: "${key}" is no local ID (letters, digits and underscores)`);
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
    // the object given is kept when it is already canonical, so what is computed per list is kept
    curves: stableStringify(curves) === stableStringify(given) ? (given as Record<string, OutlineCurve>) : curves,
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
};

// Puts the prototype of the kind into the registry of the engine.
export function installOutlineKind(): void {
  (REFERENCE_KINDS as unknown as Record<string, unknown>).outline = outlineKind;
}

// ---------------------------------------------------------------- the reader of DXF

export interface ReadCurve {
  curve: OutlineCurve;
  layer: string;
}
export interface ReadOutline {
  curves: ReadCurve[];
  about: { unit: string; insunits?: number; layers: Record<string, number>; skipped: Record<string, number> };
}

const INSUNITS: Record<number, [string, number]> = { 1: ['in', 25.4], 2: ['ft', 304.8], 4: ['mm', 1], 5: ['cm', 10], 6: ['m', 1000] };
const UNITS: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

type Group = [number, string];
function groups(text: string): Group[] {
  if (text.startsWith('AutoCAD Binary DXF')) throw new Error('unreadable: a binary DXF; save it as ASCII (text) DXF');
  const lines = text.split(/\r\n|\r|\n/);
  const out: Group[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (lines[i].trim() === '' || !Number.isInteger(code)) throw new Error(`unreadable: line ${i + 1}: a group code is expected, not "${lines[i].slice(0, 20)}"`);
    out.push([code, lines[i + 1].trim()]);
  }
  return out;
}

// An arc from `p` to `q` with the bulge `b` (the tangent of a quarter of the angle it turns by,
// positive counter-clockwise), as a counter-clockwise arc.
function bulgeArc(p: Vec2, q: Vec2, b: number): OutlineCurve {
  const [dx, dy] = [q[0] - p[0], q[1] - p[1]];
  const k = (1 - b * b) / (4 * b);
  const center: Vec2 = [(p[0] + q[0]) / 2 - k * dy, (p[1] + q[1]) / 2 + k * dx];
  return b > 0 ? { type: 'arc', center, start: p, end: q } : { type: 'arc', center, start: q, end: p };
}

function chain(vertices: { at: Vec2; bulge: number }[], closed: boolean): OutlineCurve[] {
  const out: OutlineCurve[] = [];
  const n = vertices.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [v, w] = [vertices[i], vertices[(i + 1) % n]];
    if (dist(v.at, w.at) === 0) continue;
    out.push(v.bulge === 0 ? { type: 'line', a: v.at, b: w.at } : bulgeArc(v.at, w.at, v.bulge));
  }
  return out;
}

export function readDxf(text: string, options: { layers?: string[]; unit?: string } = {}): ReadOutline {
  const all = groups(text);
  let insunits: number | undefined;
  let section = '';
  const entities: Group[][] = [];
  for (let i = 0; i < all.length; i++) {
    const [code, value] = all[i];
    if (code === 0 && value === 'SECTION') {
      section = all[i + 1]?.[0] === 2 ? all[i + 1][1] : '';
      i++;
      continue;
    }
    if (code === 0 && value === 'ENDSEC') {
      section = '';
      continue;
    }
    if (section === 'HEADER' && code === 9 && value === '$INSUNITS' && all[i + 1]?.[0] === 70) insunits = Number(all[i + 1][1]);
    if (section === 'ENTITIES') {
      if (code === 0) entities.push([[code, value]]);
      else entities[entities.length - 1]?.push([code, value]);
    }
  }
  if (entities.length === 0 && !all.some(([code, value]) => code === 0 && value === 'EOF')) throw new Error('unreadable: not a DXF file (no ENTITIES section and no EOF)');
  const fromHeader = insunits !== undefined ? INSUNITS[insunits] : undefined;
  if (options.unit === undefined && insunits !== undefined && insunits !== 0 && !fromHeader) throw new Error(`unreadable: the unit $INSUNITS ${insunits} is not read; give the option unit`);
  const [unit, scale] = options.unit !== undefined ? [options.unit, UNITS[options.unit]] : (fromHeader ?? ['mm', 1]);
  const mm = (v: number): number => v * scale;
  const curves: ReadCurve[] = [];
  const layers: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  const skip = (what: string): void => void (skipped[what] = (skipped[what] ?? 0) + 1);
  const number = (entity: Group[], code: number, fallback?: number): number => {
    const found = entity.find(([c]) => c === code);
    if (!found) {
      if (fallback !== undefined) return fallback;
      throw new Error(`unreadable: ${entity[0][1]} without the group ${code}`);
    }
    const value = Number(found[1]);
    if (!Number.isFinite(value)) throw new Error(`unreadable: ${entity[0][1]}: the group ${code} is "${found[1]}", not a number`);
    return value;
  };
  const take = (layer: string, made: OutlineCurve[]): void => {
    for (const curve of made) curves.push({ curve, layer });
  };
  let polyline: { layer: string; closed: boolean; vertices: { at: Vec2; bulge: number }[]; wanted: boolean } | undefined;
  for (const entity of entities) {
    const type = entity[0][1];
    const layer = entity.find(([c]) => c === 8)?.[1] ?? '0';
    if (type === 'VERTEX' && polyline) {
      polyline.vertices.push({ at: [mm(number(entity, 10)), mm(number(entity, 20))], bulge: number(entity, 42, 0) });
      continue;
    }
    if (type === 'SEQEND' && polyline) {
      if (polyline.wanted) take(polyline.layer, chain(polyline.vertices, polyline.closed));
      polyline = undefined;
      continue;
    }
    layers[layer] = (layers[layer] ?? 0) + 1;
    const wanted = options.layers === undefined || options.layers.includes(layer);
    // an entity drawn in a plane seen from below (extrusion 0, 0, −1) has its x mirrored
    const mirrored = number(entity, 230, 1) < 0;
    const sx = mirrored ? -1 : 1;
    switch (type) {
      case 'LINE':
        if (wanted) take(layer, [{ type: 'line', a: [mm(number(entity, 10)), mm(number(entity, 20))], b: [mm(number(entity, 11)), mm(number(entity, 21))] }]);
        break;
      case 'CIRCLE':
        if (wanted) take(layer, [{ type: 'circle', center: [sx * mm(number(entity, 10)), mm(number(entity, 20))], radius: mm(number(entity, 40)) }]);
        break;
      case 'ARC': {
        if (!wanted) break;
        const center: Vec2 = [sx * mm(number(entity, 10)), mm(number(entity, 20))];
        const r = mm(number(entity, 40));
        const [a0, a1] = [(number(entity, 50) * Math.PI) / 180, (number(entity, 51) * Math.PI) / 180];
        const [from, to] = mirrored ? [Math.PI - a1, Math.PI - a0] : [a0, a1];
        if (positive(to - from) === 0) take(layer, [{ type: 'circle', center, radius: r }]);
        else take(layer, [{ type: 'arc', center, start: [center[0] + r * Math.cos(from), center[1] + r * Math.sin(from)], end: [center[0] + r * Math.cos(to), center[1] + r * Math.sin(to)] }]);
        break;
      }
      case 'LWPOLYLINE': {
        if (!wanted) break;
        const vertices: { at: Vec2; bulge: number }[] = [];
        for (const [code, value] of entity) {
          if (code === 10) vertices.push({ at: [sx * mm(Number(value)), 0], bulge: 0 });
          else if (code === 20 && vertices.length) vertices[vertices.length - 1].at[1] = mm(Number(value));
          else if (code === 42 && vertices.length) vertices[vertices.length - 1].bulge = sx * Number(value);
        }
        take(layer, chain(vertices, (number(entity, 70, 0) & 1) === 1));
        break;
      }
      case 'POLYLINE': {
        const flags = number(entity, 70, 0);
        if (flags & (8 | 16 | 32 | 64)) {
          if (wanted) skip('POLYLINE (3D or mesh)');
          polyline = { layer, closed: false, vertices: [], wanted: false };
        } else polyline = { layer, closed: (flags & 1) === 1, vertices: [], wanted };
        break;
      }
      case 'SPLINE': {
        if (!wanted) break;
        const flags = number(entity, 70, 0);
        const degree = number(entity, 71);
        const knots = entity.filter(([c]) => c === 40).map(([, v]) => Number(v));
        const weights = entity.filter(([c]) => c === 41).map(([, v]) => Number(v));
        const xs = entity.filter(([c]) => c === 10).map(([, v]) => mm(Number(v)));
        const ys = entity.filter(([c]) => c === 20).map(([, v]) => mm(Number(v)));
        const control = xs.map((x, i): Vec2 => [x, ys[i]]);
        if (flags & 4 || weights.some((w) => w !== weights[0])) skip('SPLINE (rational)');
        else if (degree > 3 || degree < 1) skip(`SPLINE (degree ${degree})`);
        else if (control.length < degree + 1 || knots.length !== control.length + degree + 1) skip('SPLINE (fit points only, or a wrong count of knots)');
        else if (knots[degree] !== knots[0] || knots[knots.length - 1 - degree] !== knots[knots.length - 1]) skip('SPLINE (periodic: its knots are not clamped)');
        else for (const piece of bsplineBeziers(control, knots, degree)) take(layer, [degree === 1 ? { type: 'line', a: piece[0], b: piece[1] } : { type: 'spline', points: piece }]);
        break;
      }
      default:
        if (wanted) skip(type);
    }
  }
  return { curves, about: { unit, ...(insunits === undefined ? {} : { insunits }), layers, skipped } };
}

// ---------------------------------------------------------------- the weld and the report

export interface OutlineReport {
  curves: number;
  byKind: Record<string, number>;
  welded: number; // ends moved onto another end
  moved: number; // the furthest an end was moved, mm
  dropped: number; // curves with no extent after the weld
  gaps: { at: Vec2; distance: number }[]; // open ends with another end near, beyond the weld
  open: number; // ends that are the end of no other curve
  bounds?: { min: Vec2; max: Vec2 };
  about: ReadOutline['about'];
}

const ends = (curve: OutlineCurve): Vec2[] => (curve.type === 'line' ? [curve.a, curve.b] : curve.type === 'arc' ? [curve.start, curve.end] : curve.type === 'spline' ? [curve.points[0], curve.points[curve.points.length - 1]] : []);

// Ends within `tolerance` of each other, transitively, are put at the position of the first of
// them in the order of the file; an arc then gets its centre moved onto the bisector of its chord,
// so that both ends are on one radius; a curve with no extent left is dropped.
export function weld(read: ReadCurve[], tolerance: number): { curves: OutlineCurve[]; welded: number; moved: number; dropped: number; gaps: OutlineReport['gaps']; open: number } {
  const all: Vec2[] = read.flatMap(({ curve }) => ends(curve));
  const cell = (v: number): number => Math.floor(v / tolerance);
  const grid = new Map<string, number[]>();
  const parent = all.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i];
    return i;
  };
  all.forEach((p, i) => {
    const [cx, cy] = [cell(p[0]), cell(p[1])];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (dist(all[j], p) > tolerance) continue;
          const [a, b] = [find(j), find(i)];
          if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
        }
    const key = `${cx},${cy}`;
    const list = grid.get(key);
    if (list) list.push(i);
    else grid.set(key, [i]);
  });
  let welded = 0;
  let moved = 0;
  const members = new Map<number, number>();
  const snapped = all.map((p, i): Vec2 => {
    const root = find(i);
    members.set(root, (members.get(root) ?? 0) + 1);
    if (root === i) return p;
    const d = dist(all[root], p);
    if (d > 0) {
      welded++;
      moved = Math.max(moved, d);
    }
    return all[root];
  });
  let at = 0;
  const curves: OutlineCurve[] = [];
  let dropped = 0;
  for (const { curve } of read) {
    switch (curve.type) {
      case 'line': {
        const [a, b] = [snapped[at], snapped[at + 1]];
        at += 2;
        if (dist(a, b) === 0) dropped++;
        else curves.push({ type: 'line', a, b });
        break;
      }
      case 'arc': {
        const [start, end] = [snapped[at], snapped[at + 1]];
        at += 2;
        const chord = dist(start, end);
        if (chord === 0) {
          dropped++;
          break;
        }
        const mid: Vec2 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
        const d: Vec2 = [(end[0] - start[0]) / chord, (end[1] - start[1]) / chord];
        const along = (curve.center[0] - mid[0]) * d[0] + (curve.center[1] - mid[1]) * d[1];
        curves.push({ type: 'arc', center: [curve.center[0] - along * d[0], curve.center[1] - along * d[1]], start, end });
        break;
      }
      case 'spline': {
        const points = [snapped[at], ...curve.points.slice(1, -1), snapped[at + 1]];
        at += 2;
        curves.push({ type: 'spline', points });
        break;
      }
      case 'circle':
        if (curve.radius > 0) curves.push(curve);
        else dropped++;
        break;
    }
  }
  // open ends: a group of one end; a gap is an open end with another end within a hundred tolerances
  const gaps: OutlineReport['gaps'] = [];
  let open = 0;
  all.forEach((p, i) => {
    if (members.get(find(i)) !== 1) return;
    open++;
    let near = Infinity;
    const reach = 100 * tolerance;
    // the grid has cells of the tolerance; a linear scan is enough for a report
    for (let j = 0; j < all.length; j++) if (j !== i && find(j) !== find(i)) near = Math.min(near, dist(all[j], p));
    if (near <= reach && gaps.length < 20) gaps.push({ at: p, distance: near });
  });
  return { curves, welded, moved, dropped, gaps, open };
}

// The whole import: read, weld, name. Local IDs by kind and by the order of the file: `l1`, `a1`,
// `c1`, `s1`.
export function assemble(read: ReadOutline, tolerance = 1e-2): { curves: Record<string, OutlineCurve>; report: OutlineReport } {
  const made = weld(read.curves, tolerance);
  if (made.curves.length > MAX_OUTLINE_CURVES) throw new Error(`tooLarge: ${made.curves.length} curves, more than the ${MAX_OUTLINE_CURVES} an outline holds`);
  const counts: Record<string, number> = { line: 0, arc: 0, circle: 0, spline: 0 };
  const curves: Record<string, OutlineCurve> = {};
  for (const curve of made.curves) curves[`${curve.type[0]}${++counts[curve.type]}`] = curve;
  const bounds = outlineBox(made.curves);
  return { curves, report: { curves: made.curves.length, byKind: counts, welded: made.welded, moved: made.moved, dropped: made.dropped, gaps: made.gaps, open: made.open, ...(bounds ? { bounds } : {}), about: read.about } };
}
export const importOutline = (text: string, options: { layers?: string[]; unit?: string; weld?: number } = {}): { curves: Record<string, OutlineCurve>; report: OutlineReport } => assemble(readDxf(text, options), options.weld);

export const outlineEntry = (curves: Record<string, OutlineCurve>, more: Partial<SketchOutline> = {}): SketchOutline => ({ type: 'outline', curves, x: 0, y: 0, turn: 0, anchor: 'origin', regions: true, ...more });
