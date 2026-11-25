// An imported outline (D72): the reference kind `outline` of `external`. The curves of a drawing,
// stored in the entry in the coordinates of their file and placed in the sketch by three numeric
// fields and an anchor. Its value is the placement and the fingerprint of the curves, never
// positions; the geometry is computed from the entry and the value. docs/d36/6f-outline-import.
import type { EntityKind, NumberSpec } from '../catalog';
import { OUTLINE_LIMITS, OUTLINE_REFUSALS, curveProblem, outlineBox, splineClosed } from '../imported-curve';
import type { CurveShape, Id, ImportedCurve, OutlineReadWith, PlacedOutline, Point2, SketchOutline, Vec2 } from '../types';
import { fingerprint, has, stableStringify } from '../util';
import { type Dict, boolean, fail, finite, object, oneOf, onlyFields, string } from '../validation';
import type { EntryGeometry, ReferenceKindSpec } from './spec';

export const OUTLINE_ANCHORS = ['origin', 'center'] as const satisfies readonly SketchOutline['anchor'][];
// The flag of an outline when a command leaves it out (the convention of a flag of an entry, D69:
// the document always holds it, the kind has the default; owner, answer 2).
export const OUTLINE_REGIONS_DEFAULT = true;
export const OUTLINE_PLACE: NumberSpec = { title: 'Place', unit: 'mm', default: 0 };
export const OUTLINE_TURN: NumberSpec = { title: 'Turn', unit: 'rad', min: { value: -2 * Math.PI }, max: { value: 2 * Math.PI }, default: 0 };
export const OUTLINE_FIELDS = ['type', 'name', 'readWith', 'curves', 'x', 'y', 'turn', 'anchor', 'regions'] as const;
const CURVE_FIELDS: Record<ImportedCurve['type'], readonly string[]> = { line: ['type', 'a', 'b'], circle: ['type', 'center', 'radius'], arc: ['type', 'center', 'start', 'end'], spline: ['type', 'points'] };
const LOCAL_ID = /^[A-Za-z0-9_]{1,32}$/;

// ---------------------------------------------------------------- the curves as stored

// The objects of curves this validator made: copied once from what it was given, frozen (the
// record, each curve, each position), and taken as they are at every later validation. A caller
// that holds the document's object cannot write into it and send it back unchecked.
const OWN = new WeakSet<object>();

function position(v: unknown, what: string): Vec2 {
  if (typeof v === 'string') fail(OUTLINE_REFUSALS.expression(what));
  if (!Array.isArray(v) || v.length !== 2) return fail(`${what}: a pair of numbers is expected`);
  const pair = v as unknown[];
  if (typeof pair[0] === 'string' || typeof pair[1] === 'string') fail(OUTLINE_REFUSALS.expression(what));
  return Object.freeze([finite(pair[0], what), finite(pair[1], what)]) as Vec2;
}

function storedCurve(v: unknown, what: string): ImportedCurve {
  const c = object(v, what);
  const type = oneOf(c.type, ['line', 'circle', 'arc', 'spline'] as const, `${what}.type`);
  onlyFields(c, CURVE_FIELDS[type], what, `a curve of the kind ${type}`);
  switch (type) {
    case 'line':
      return { type, a: position(c.a, `${what}.a`), b: position(c.b, `${what}.b`) };
    case 'circle':
      if (typeof c.radius === 'string') fail(OUTLINE_REFUSALS.expression(`${what}.radius`));
      return { type, center: position(c.center, `${what}.center`), radius: finite(c.radius, `${what}.radius`) };
    case 'arc':
      return { type, center: position(c.center, `${what}.center`), start: position(c.start, `${what}.start`), end: position(c.end, `${what}.end`) };
    case 'spline':
      if (!Array.isArray(c.points)) return fail(OUTLINE_REFUSALS.points(what));
      return { type, points: Object.freeze((c.points as unknown[]).map((p, i) => position(p, `${what}.points[${i}]`))) as Vec2[] };
  }
}

// The curves of an entry as the document holds them: the object itself when this validator made
// it, else a checked and frozen copy.
export function storedCurves(v: unknown, what: string): Record<Id, ImportedCurve> {
  if (v === undefined) return fail(OUTLINE_REFUSALS.missingCurves(what));
  const given = object(v, `${what}.curves`);
  if (OWN.has(given)) return given as Record<Id, ImportedCurve>;
  const keys = Object.keys(given);
  if (keys.length === 0 || keys.length > OUTLINE_LIMITS.curves) fail(OUTLINE_REFUSALS.count(what, keys.length));
  const made: Record<Id, ImportedCurve> = {};
  let control = 0;
  for (const key of keys) {
    if (!LOCAL_ID.test(key) || key in Object.prototype) fail(OUTLINE_REFUSALS.localId(what, key));
    const at = `${what}.curves.${key}`;
    const curve = storedCurve(given[key], at);
    const problem = curveProblem(curve, at);
    if (problem) fail(problem);
    if (curve.type === 'spline') control += curve.points.length;
    made[key] = Object.freeze(curve);
  }
  if (control > OUTLINE_LIMITS.control) fail(OUTLINE_REFUSALS.control(what, control));
  const curves = Object.freeze(made);
  OWN.add(curves);
  return curves;
}

// A text of an entry, bounded.
function text(v: unknown, what: string): string {
  const out = string(v, what);
  if (out.length > OUTLINE_LIMITS.text) fail(OUTLINE_REFUSALS.text(what));
  return out;
}

function readWith(v: unknown, what: string): OutlineReadWith | undefined {
  if (v === undefined || v === null) return undefined;
  const o = object(v, what);
  onlyFields(o, ['format', 'layers', 'unit', 'weld'], what, 'the options of an import');
  const out: OutlineReadWith = { format: text(o.format, `${what}.format`) };
  if (o.layers !== undefined) {
    if (!Array.isArray(o.layers) || o.layers.length === 0 || o.layers.length > OUTLINE_LIMITS.layers) fail(OUTLINE_REFUSALS.layers(`${what}.layers`));
    out.layers = (o.layers as unknown[]).map((layer, i) => text(layer, `${what}.layers[${i}]`));
  }
  if (o.unit !== undefined) out.unit = text(o.unit, `${what}.unit`);
  if (o.weld !== undefined) {
    out.weld = finite(o.weld, `${what}.weld`);
    if (out.weld < 0) fail(`${what}.weld: a tolerance is not negative`);
  }
  return out;
}

// ---------------------------------------------------------------- entities

// The points of a curve of an outline by the names its shape has; a spline numbers its control
// points from 0, and a closed one lists its first point once.
export function outlinePointNames(curve: ImportedCurve): string[] {
  switch (curve.type) {
    case 'line':
      return ['a', 'b'];
    case 'circle':
      return ['center'];
    case 'arc':
      return ['center', 'start', 'end'];
    case 'spline':
      return Array.from({ length: splineClosed(curve.points) ? curve.points.length - 1 : curve.points.length }, (_, i) => String(i));
  }
}

// Every entity of an entry in the order of its curves, a curve before its points.
export function outlineEntities(id: Id, ref: SketchOutline): Record<Id, EntityKind> {
  const out: Record<Id, EntityKind> = {};
  for (const [local, curve] of Object.entries(ref.curves)) {
    out[`${id}/${local}`] = curve.type;
    for (const name of outlinePointNames(curve)) out[`${id}/${local}/${name}`] = 'point';
  }
  return out;
}

// One ID under an entry, with one look-up: `<entry>/<local>` is the kind of that curve,
// `<entry>/<local>/<name>` a point when the curve has a point of that name. The curve is looked up
// as an own property, never through the prototype.
export function outlineEntity(id: Id, ref: SketchOutline, entry: Id): EntityKind | undefined {
  if (!id.startsWith(`${entry}/`)) return undefined;
  const rest = id.slice(entry.length + 1);
  const slash = rest.indexOf('/');
  const local = slash < 0 ? rest : rest.slice(0, slash);
  if (!has(ref.curves, local)) return undefined;
  const curve = ref.curves[local];
  if (slash < 0) return curve.type;
  const name = rest.slice(slash + 1);
  if (curve.type === 'spline') {
    if (!/^(0|[1-9][0-9]*)$/.test(name)) return undefined;
    const count = splineClosed(curve.points) ? curve.points.length - 1 : curve.points.length;
    return Number(name) < count ? 'point' : undefined;
  }
  return outlinePointNames(curve).includes(name) ? 'point' : undefined;
}

// ---------------------------------------------------------------- the value and the geometry

// What is computed once per stored object of curves (the document is immutable): its fingerprint
// and the centre of its box.
const DESCRIBED = new WeakMap<object, { data: string; center: Vec2 }>();
function described(curves: Record<Id, ImportedCurve>): { data: string; center: Vec2 } {
  let found = DESCRIBED.get(curves);
  if (!found) {
    const box = outlineBox(Object.values(curves));
    found = { data: fingerprint(stableStringify(curves)), center: box ? [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2] : [0, 0] };
    DESCRIBED.set(curves, found);
  }
  return found;
}

// The value of an outline: `at` is where the origin of the file lands, so a point p of the file is
// at `at + R(turn) · p`; with the anchor `center` the centre of the box of the curves lands at
// (x, y), and the outline turns about it.
export function placeOutline(ref: SketchOutline): PlacedOutline {
  const { data, center } = described(ref.curves);
  const anchor: Vec2 = ref.anchor === 'center' ? center : [0, 0];
  const [c, s] = ref.turn === 0 ? [1, 0] : [Math.cos(ref.turn), Math.sin(ref.turn)];
  return { kind: 'outline', at: [ref.x - (c * anchor[0] - s * anchor[1]), ref.y - (s * anchor[0] + c * anchor[1])], turn: ref.turn, data };
}

// The geometry of an entry from its value: every curve placed, an arc with its end put on the
// circle of its start (6b's `exactArc`); `regions` every curve, or none. A turn of exactly 0 moves
// no digit of the file but by the addition of `at`. Kept per entry object, with the ID and the
// value it was made for, so a drag in the sketch does not place the outline again and two entries
// that share one object of curves do not push each other out.
const GEOMETRIES = new WeakMap<object, { key: string; geometry: EntryGeometry }>();
export function outlineGeometry(id: Id, ref: SketchOutline, value: PlacedOutline): EntryGeometry {
  const key = `${id}|${value.at[0]}|${value.at[1]}|${value.turn}|${value.data}`;
  const kept = GEOMETRIES.get(ref);
  if (kept?.key === key) return kept.geometry;
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
        const [rs, re] = [Math.hypot(start.x - center.x, start.y - center.y), Math.hypot(end.x - center.x, end.y - center.y)];
        points[`${k}/center`] = center;
        points[`${k}/start`] = start;
        points[`${k}/end`] = rs === re ? end : { x: center.x + (rs * (end.x - center.x)) / re, y: center.y + (rs * (end.y - center.y)) / re };
        curves[k] = { type: 'arc', center: `${k}/center`, start: `${k}/start`, end: `${k}/end` };
        break;
      }
      case 'spline': {
        const n = curve.points.length;
        const closed = splineClosed(curve.points);
        const ids = curve.points.map((_, i) => `${k}/${closed && i === n - 1 ? 0 : i}`);
        curve.points.forEach((p, i) => {
          if (!(closed && i === n - 1)) points[ids[i]] = at(p);
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

// The box of an outline as placed in its sketch: its curves at their places (`outlineGeometry`),
// an arc by the extremes of its circle within its sweep and a spline by the box of its curve
// (`outlineBox`), not by the points of the entry alone.
export function placedOutlineBox(id: Id, ref: SketchOutline): { min: Vec2; max: Vec2 } | undefined {
  const geometry = outlineGeometry(id, ref, placeOutline(ref));
  const at = (point: Id): Vec2 => [geometry.points[point].x, geometry.points[point].y];
  const placed = Object.entries(ref.curves).map(([local, curve]): ImportedCurve => {
    const k = `${id}/${local}`;
    switch (curve.type) {
      case 'line':
        return { type: 'line', a: at(`${k}/a`), b: at(`${k}/b`) };
      case 'circle':
        return { type: 'circle', center: at(`${k}/center`), radius: curve.radius };
      case 'arc':
        return { type: 'arc', center: at(`${k}/center`), start: at(`${k}/start`), end: at(`${k}/end`) };
      case 'spline':
        return { type: 'spline', points: (geometry.curves[k] as Extract<CurveShape, { type: 'spline' }>).points.map(at) };
    }
  });
  return outlineBox(placed);
}

// A stored value read back: an outline's placement by its form.
function storedPlacement(stored: unknown, what: string): PlacedOutline | undefined {
  const o = object(stored, what);
  if (o.kind !== 'outline') return undefined;
  return placedOutline(o, what);
}
// The form of a stored placement of an outline (`solved.external`), for the reader of stored values.
export function placedOutline(o: Dict, what: string): PlacedOutline {
  if (!Array.isArray(o.at) || o.at.length !== 2) return fail(`${what}.at: a pair of numbers is expected`);
  const pair = o.at as unknown[];
  return { kind: 'outline', at: [finite(pair[0], `${what}.at`), finite(pair[1], `${what}.at`)], turn: finite(o.turn, `${what}.turn`), data: string(o.data, `${what}.data`) };
}

// ---------------------------------------------------------------- the kind

function validate(context: Parameters<ReferenceKindSpec<SketchOutline, PlacedOutline>['validate']>[0], id: Id, o: Dict, what: string): SketchOutline {
  onlyFields(o, OUTLINE_FIELDS, what, 'an imported outline');
  const curves = storedCurves(o.curves, what);
  const { fields } = context;
  const name = o.name === undefined ? '' : text(o.name, `${what}.name`);
  const options = readWith(o.readWith, `${what}.readWith`);
  return {
    type: 'outline',
    ...(name !== '' ? { name } : {}),
    ...(options ? { readWith: options } : {}),
    curves,
    // left out is the default; `null` is no number and is refused, not read as 0
    x: fields.number(o.x === undefined ? 0 : o.x, `external/${id}/x`, OUTLINE_PLACE, `${what}.x`),
    y: fields.number(o.y === undefined ? 0 : o.y, `external/${id}/y`, OUTLINE_PLACE, `${what}.y`),
    turn: fields.number(o.turn === undefined ? 0 : o.turn, `external/${id}/turn`, OUTLINE_TURN, `${what}.turn`),
    anchor: o.anchor === undefined ? 'origin' : oneOf(o.anchor, OUTLINE_ANCHORS, `${what}.anchor`),
    regions: o.regions === undefined ? OUTLINE_REGIONS_DEFAULT : boolean(o.regions, `${what}.regions`),
  };
}

export const outline: ReferenceKindSpec<SketchOutline, PlacedOutline> = {
  source: 'reference',
  title: 'Imported outline',
  summary:
    'The curves of a DXF or SVG drawing (lines, arcs, circles, splines) stored in the entry in the coordinates of their file, in mm, and placed in this sketch: fixed for the solver, so constraints and dimensions may name its entities and a later sketch may project them. Usually written by the MCP tool import_outline, which reads the file and sends the command; read the report it gives first. `curves` by local ID (`l1` … lines, `a1` … arcs, `c1` … circles, `s1` … splines, numbered by kind in the order of the file; an unused number is a curve the import left out, and `a3` may be a circle: an arc of nearly a whole turn); the entities are the curve `<id>/<local>` and its points `<id>/<local>/a`, `/b` (a line), `/center` (a circle), `/center`, `/start`, `/end` (an arc), `/0`, `/1`, … (the control points of a spline). `x`, `y` (mm) and `turn` (rad) are numeric fields: the `anchor` (`origin` of the file, or `center` of the box of its curves) lands at (x, y) and the outline turns about it. With `regions` (default true) the curves bound regions and name side faces (`{ role: "side", curve: "<id>/<local>" }`), and their ends join at their place within 1e-6 mm. A revised file is updateExternal with the new `curves` (fields left out keep what the entry has; the tool import_outline with `replace`): an entity keeps its ID when the file lists it at the same place among the curves of its kind, and the update is refused while a constraint names an entity that goes or changes its kind. Never cut by the sketch tools; a spline of it is not constrained to or projected; get_sketch lists the first curves, the query entryCurves the rest.',
  example: {
    id: 'plate',
    ref: {
      type: 'outline',
      name: 'plate.dxf',
      curves: {
        l1: { type: 'line', a: [0, 0], b: [20, 0] },
        l2: { type: 'line', a: [20, 0], b: [20, 10] },
        l3: { type: 'line', a: [20, 10], b: [0, 10] },
        l4: { type: 'line', a: [0, 10], b: [0, 0] },
        c1: { type: 'circle', center: [10, 5], radius: 2 },
      },
      x: 100,
      y: 0,
      turn: 0,
      anchor: 'center',
      regions: true,
    },
  },
  validate: (context, _sketch, id, o, what) => validate(context, id, o, what),
  refs: () => [],
  faces: () => [],
  entities: outlineEntities,
  entity: (id, ref, _sketch, entry) => outlineEntity(id, ref, entry),
  compute: (ref) => placeOutline(ref),
  value: (stored, _ref, what) => storedPlacement(stored, what),
  geometry: outlineGeometry,
  // the stored value is kept when the update changes neither the place nor the curves (the flag,
  // the name, `readWith`); a stale placement is not kept (a document saved in conflict)
  keepsValue: (before, after) => before.x === after.x && before.y === after.y && before.turn === after.turn && before.anchor === after.anchor && before.curves === after.curves,
  narrow: true,
  partial: true,
};
