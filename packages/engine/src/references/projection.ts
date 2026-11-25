// The projection of one point, line, circle or arc of an earlier sketch into a sketch on a parallel
// plane (D69): the reference kind `sketch` of `external`. Its value follows the solved source at
// every recompute; the map between the two planes is a rigid motion (`sketchMap`), and a projected
// arc is made exact. docs/d36/6b-sketch-projection/design.md.
import type { EntityKind } from '../catalog';
import { lookup } from '../recompute/services';
import type { SketchState } from '../recompute/state';
import { toPlane, toWorld } from '../solid';
import { CURVE_POINTS } from '../sketch-content';
import type { Frame, Id, Projected, SketchProjection, Vec2 } from '../types';
import { ANGLE_TOLERANCE, LENGTH_TOLERANCE, ORIGIN, cross3, dot3, has, len3, underOrigin, unreachable } from '../util';
import { boolean, fail, oneOf, onlyFields, string } from '../validation';
import { type EntryGeometry, type ReferenceFailure, type ReferenceKindSpec, projected } from './spec';

export type ProjectedKind = SketchProjection['kind'];
export const PROJECTED_KINDS = ['point', 'line', 'circle', 'arc'] as const satisfies readonly ProjectedKind[];
// The flag of a projection when a command leaves it out (the convention of a flag of an entry: the
// document always holds it, the kind has the default).
export const REGIONS_DEFAULT = false;

// ---------------------------------------------------------------- the texts

export const UNDER_ORIGIN = (entity: Id, sketch: Id): string => `${entity} of ${sketch} is not projected: this sketch has its own axes origin/x and origin/y; project the origin of ${sketch} for a point at its origin`;
export const REGIONS_ON_A_POINT = 'a projected point forms no regions; regions is for a line, a circle or an arc';
export const DUPLICATE = (entity: Id, sketch: Id, entry: Id): string => `${entity} of ${sketch} is projected already as ${entry}`;
export const SOURCE_NOT_EVALUATED = (sketch: Id): string => `${sketch} is not evaluated before this sketch: removed, suppressed, in error, or later on the timeline`;
// An angle in degrees as the texts say it: three significant digits, so a tilt just above the
// tolerance (1e-4 rad) does not read "0.0°".
export const degreesText = (degrees: number): string => `${Number(degrees.toPrecision(3))}°`;
export const NOT_PARALLEL = (sketch: Id, degrees: number): string => `the plane of ${sketch} is at ${degreesText(degrees)} to this sketch; only a parallel plane is projected`;
export const ENTITY_GONE = (sketch: Id, entity: Id, kind: ProjectedKind): string => `${sketch} has no ${kind} ${entity}`;
const article = (kind: string): string => `${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind}`;
export const KIND_CHANGED = (sketch: Id, entity: Id, now: string, kind: ProjectedKind): string => `${entity} of ${sketch} is ${article(now)} now, not ${article(kind)}`;
export const NO_EXTENT = (sketch: Id, entity: Id, kind: ProjectedKind): string => `the ${kind} ${entity} of ${sketch} cannot be projected as it stands: it has no length or no radius, or a position that is not a number`;

// ---------------------------------------------------------------- the map between two planes

// The map from the plane of one sketch to the plane of another, as the projection, the sketch tool
// projectSketch and the query sketchSources use it.
// - `parallel`: the normals parallel or opposite within ANGLE_TOLERANCE (1e-4 rad); `flips` when
//   they are opposite; `angle` the angle between the planes, in [0, π/2] rad.
// - `at`, for planes that are parallel in that sense, is a rigid motion of the plane:
//   `o + p.x · u + p.y · v`, where `o` is the source's origin dropped into the target, `u` the
//   direction of the source's x axis in the target made a unit vector, and `v` a quarter turn from
//   `u`, to the left, or to the right when the map flips (it then reflects, and an arc swaps its
//   ends). Lengths, radii and the joints of a chain are kept exactly whatever the tilt inside the
//   tolerance; a point lies within `d · angle² / 2` of where a projection along the normal would put
//   it, `d` its distance from the source's origin. On exactly parallel planes it is that projection.
// - For planes that are not parallel `at` is the projection along the normal of the target, for
//   a picture; nothing is projected through it.
export interface SketchMap {
  at(p: Vec2): Vec2;
  parallel: boolean;
  flips: boolean;
  angle: number;
}
export function sketchMap(from: Frame, to: Frame): SketchMap {
  const cos = dot3(from.normal, to.normal);
  const angle = Math.atan2(len3(cross3(from.normal, to.normal)), Math.abs(cos));
  const flips = cos < 0;
  const parallel = angle <= ANGLE_TOLERANCE;
  if (!parallel) return { parallel, flips, angle, at: (p) => toPlane(to, toWorld(from, p[0], p[1])) };
  const o = toPlane(to, toWorld(from, 0, 0));
  const [ux, uy] = [dot3(from.x, to.x), dot3(from.x, to.y)];
  const length = Math.hypot(ux, uy);
  const u: Vec2 = [ux / length, uy / length];
  const v: Vec2 = flips ? [u[1], -u[0]] : [-u[1], u[0]];
  return { parallel, flips, angle, at: (p) => [o[0] + p[0] * u[0] + p[1] * v[0], o[1] + p[0] * u[1] + p[1] * v[1]] };
}

// ---------------------------------------------------------------- the value

const finitePair = (p: Vec2): boolean => Number.isFinite(p[0]) && Number.isFinite(p[1]);
const distance = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

// The value of a projection from the solved source (`source`, its state in the recompute; absent
// when it did not evaluate before this sketch) into the sketch of the frame `frame`, or why not:
// - the sketch not evaluated: `brokenProjection`; planes not parallel: `unsupportedProjection`;
// - no such point or curve, or one of another kind now (a circle trimmed into an arc):
//   `brokenProjection`;
// - a curve with no extent (a position that is not a number, a line shorter than the length
//   tolerance, a circle whose radius is under it, an arc whose start or end is within it of its
//   centre): `degenerateProjection`. Checked before the arc is made exact.
// An arc's ends swap across a flip of the normal (it stays counter-clockwise), and its end is put
// on the circle of its start: end = center + |start − center| · (end − center) / |end − center|.
// `source` is what the recompute keeps of the solved source (its state), or the same read from its
// result by a sketch tool (`solvedCurves`).
export type ProjectionSource = Pick<SketchState, 'frame' | 'geometry' | 'curves'>;
export function projectFromSketch(ref: SketchProjection, source: ProjectionSource | undefined, frame: Frame): Projected | ReferenceFailure {
  const { sketch, entity, kind } = ref;
  if (!source) return { code: 'brokenProjection', detail: SOURCE_NOT_EVALUATED(sketch) };
  const map = sketchMap(source.frame, frame);
  if (!map.parallel) return { code: 'unsupportedProjection', detail: NOT_PARALLEL(sketch, (map.angle * 180) / Math.PI) };
  const points = source.geometry.points;
  const position = (id: Id): Vec2 | undefined => (has(points, id) ? map.at([points[id].x, points[id].y]) : id === ORIGIN ? map.at([0, 0]) : undefined);
  const curve = source.curves.get(entity);
  const gone: ReferenceFailure = { code: 'brokenProjection', detail: ENTITY_GONE(sketch, entity, kind) };
  const flat: ReferenceFailure = { code: 'degenerateProjection', detail: NO_EXTENT(sketch, entity, kind) };
  if (kind === 'point') {
    if (curve) return { code: 'brokenProjection', detail: KIND_CHANGED(sketch, entity, curve.shape.type, kind) };
    const at = position(entity);
    if (!at) return gone;
    return finitePair(at) ? { kind: 'point', at } : flat;
  }
  if (!curve) return has(points, entity) || entity === ORIGIN ? { code: 'brokenProjection', detail: KIND_CHANGED(sketch, entity, 'point', kind) } : gone;
  const shape = curve.shape;
  if (shape.type !== kind) return { code: 'brokenProjection', detail: KIND_CHANGED(sketch, entity, shape.type, kind) };
  switch (shape.type) {
    case 'line': {
      const [a, b] = [position(shape.a), position(shape.b)];
      if (!a || !b || !finitePair(a) || !finitePair(b) || !(distance(a, b) >= LENGTH_TOLERANCE)) return flat;
      return { kind: 'line', a, b };
    }
    case 'circle': {
      const center = position(shape.center);
      const radius = has(source.geometry.radii, entity) ? source.geometry.radii[entity] : undefined;
      if (!center || !finitePair(center) || radius === undefined || !(radius >= LENGTH_TOLERANCE) || !Number.isFinite(radius)) return flat;
      return { kind: 'circle', center, radius };
    }
    case 'arc': {
      const center = position(shape.center);
      const [first, second] = [position(shape.start), position(shape.end)];
      const [start, end] = map.flips ? [second, first] : [first, second];
      if (!center || !start || !end || !finitePair(center) || !finitePair(start) || !finitePair(end)) return flat;
      return exactArc(center, start, end) ?? flat;
    }
    default:
      return unreachable(shape, 'curve');
  }
}

// An arc with its end put on the circle of its start, or undefined when its start or end is within
// the length tolerance of its centre (no extent: the division would give NaN).
function exactArc(center: Vec2, start: Vec2, end: Vec2): Projected | undefined {
  const [rs, re] = [distance(start, center), distance(end, center)];
  if (!(rs >= LENGTH_TOLERANCE) || !(re >= LENGTH_TOLERANCE)) return undefined;
  return { kind: 'arc', center, start, end: [center[0] + (rs * (end[0] - center[0])) / re, center[1] + (rs * (end[1] - center[1])) / re] };
}

// How far the end of a stored arc may lie off the circle of its start, relative to its radius, and
// still be read as it is: `exactArc` is not idempotent in floating point (applied to its own output
// it moves the end by an ulp in about a third of cases), so a value `compute` wrote is kept bit for
// bit and a frozen projection stays the same at every recompute, save and load.
const ARC_STORED_TOLERANCE = 1e-12;

// A stored value read back: the stored object itself when it is of the entry's kind and has the
// extent `compute` requires of a fresh one, so a hand-written value is never a fixed curve the
// solver rejects. A line with no length, a circle with a radius under the length tolerance or an
// arc with no extent does not fit the entry (load refuses it; no command writes one); an arc whose
// end is off the circle of its start by more than an ulp or so (`ARC_STORED_TOLERANCE`) is made exact.
function storedValue(stored: unknown, ref: SketchProjection, what: string): Projected | undefined {
  const value = projected(stored, what);
  if (value.kind !== ref.kind) return undefined;
  switch (value.kind) {
    case 'point':
      return stored as Projected;
    case 'circle':
      return value.radius >= LENGTH_TOLERANCE ? (stored as Projected) : undefined;
    case 'line':
      return distance(value.a, value.b) >= LENGTH_TOLERANCE ? (stored as Projected) : undefined;
    case 'arc': {
      const exact = exactArc(value.center, value.start, value.end);
      if (exact?.kind !== 'arc') return undefined;
      const [rs, re] = [distance(value.start, value.center), distance(value.end, value.center)];
      return Math.abs(re - rs) <= ARC_STORED_TOLERANCE * rs ? (stored as Projected) : exact;
    }
    default:
      return unreachable(value, 'projected value');
  }
}

// The entities of an entry projecting `kind` under the ID `id`: the entity itself, then the points
// of a curve by the names its shape has.
export function projectionEntities(id: Id, kind: ProjectedKind): Record<Id, EntityKind> {
  if (kind === 'point') return { [id]: 'point' };
  const out: Record<Id, EntityKind> = { [id]: kind };
  for (const name of CURVE_POINTS[kind]) out[`${id}/${name}`] = 'point';
  return out;
}

function geometry(id: Id, ref: SketchProjection, value: Projected): EntryGeometry {
  const xy = (p: Vec2) => ({ x: p[0], y: p[1] });
  const regions = ref.regions ? [id] : [];
  switch (value.kind) {
    case 'point':
      return { points: { [id]: xy(value.at) }, curves: {}, radii: {}, regions: [] };
    case 'line':
      return { points: { [`${id}/a`]: xy(value.a), [`${id}/b`]: xy(value.b) }, curves: { [id]: { type: 'line', a: `${id}/a`, b: `${id}/b` } }, radii: {}, regions };
    case 'circle':
      return { points: { [`${id}/center`]: xy(value.center) }, curves: { [id]: { type: 'circle', center: `${id}/center` } }, radii: { [id]: value.radius }, regions };
    case 'arc':
      return {
        points: { [`${id}/center`]: xy(value.center), [`${id}/start`]: xy(value.start), [`${id}/end`]: xy(value.end) },
        curves: { [id]: { type: 'arc', center: `${id}/center`, start: `${id}/start`, end: `${id}/end` } },
        radii: {},
        regions,
      };
    default:
      return unreachable(value, 'projected value');
  }
}

// ---------------------------------------------------------------- the kind

export const projection: ReferenceKindSpec<SketchProjection, Projected> = {
  source: 'reference',
  title: 'Projection from a sketch',
  summary:
    'One point, line, circle or arc of an earlier sketch on a parallel plane (either normal, any offset), projected into this sketch: fixed geometry that follows its source at every recompute. `entity` is an own point or curve of `sketch` (a construction curve too), its `origin`, or an entity of one of its entries (a projected curve or point, a copy of a mirror `m/1/c2`), never one under `origin/`; `kind` is its kind (`point`, `line`, `circle`, `arc`; get_sketch of the source and the query sketchSources list them). The entry is the projected entity; a curve has the derived points `<id>/a`, `<id>/b` (a line), `<id>/center` (a circle), `<id>/center`, `<id>/start`, `<id>/end` (an arc, counter-clockwise; across opposite normals its ends swap). With `regions: true` (default false, refused on a point) the curve bounds regions of this sketch and names its side face, and the ends of such curves join at their place with each other and with an own end there. A source that is gone, not evaluated, or of another kind now freezes it at its last values (brokenProjection); a tilted plane is unsupportedProjection. One entry per entity of the source. To get an outline the sketch tools can cut, use the sketch tool projectSketch with `as: "own"`.',
  example: { id: 'pb', ref: { type: 'sketch', sketch: 'base', entity: 'b1', kind: 'line', regions: false } },
  validate: (context, sketch, id, o, what) => {
    onlyFields(o, ['type', 'sketch', 'entity', 'kind', 'regions'], what, 'a projection from a sketch');
    const source = string(o.sketch, `${what}.sketch`);
    const entity = string(o.entity, `${what}.entity`);
    const kind = oneOf(o.kind, PROJECTED_KINDS, `${what}.kind`);
    if (underOrigin(entity)) fail(`${what}.entity: ${UNDER_ORIGIN(entity, source)}`);
    const regions = o.regions === undefined ? REGIONS_DEFAULT : boolean(o.regions, `${what}.regions`);
    if (regions && kind === 'point') fail(`${what}.regions: ${REGIONS_ON_A_POINT}`);
    const twin = Object.entries(sketch.external).find(([other, ref]) => other !== id && ref.type === 'sketch' && ref.sketch === source && ref.entity === entity);
    if (twin) fail(`${what}: ${DUPLICATE(entity, source, twin[0])}`);
    // a command: earlier on the timeline, and the entity there of that kind (load checks neither)
    context.requireRef({ id: source, kind: 'sketch' }, `${what}.sketch`);
    context.requireRef({ id: entity, kind: 'entity', sketch: source, accepts: [kind] }, `${what}.entity`);
    return { type: 'sketch', sketch: source, entity, kind, regions };
  },
  refs: (ref, path) => [
    { path, id: ref.sketch, kind: 'sketch' },
    { path, id: ref.entity, kind: 'entity', sketch: ref.sketch, accepts: [ref.kind] },
  ],
  faces: () => [],
  entities: (id, ref) => projectionEntities(id, ref.kind),
  compute: (ref, { state, frame }) => projectFromSketch(ref, lookup(state.sketches, ref.sketch), frame),
  value: storedValue,
  geometry,
  keepsValue: (before, after) => before.sketch === after.sketch && before.entity === after.entity && before.kind === after.kind,
};
