// A mirror or a pattern of own geometry of a sketch (D68): the derived kind `pattern` of `external`,
// with the transforms of a pattern of features (D53) in the plane of the sketch. Its copies are
// made after the solver from the solved positions (`derive`), under `<entry>/<n>/<source>`.
// docs/d36/6c-sketch-mirror-pattern/design.md.
import type { EntityKind } from '../catalog';
import { GRID_STRIDE, MAX_PATTERN_COUNT, MAX_PATTERN_PLACES, PATTERN_ANGLE, PATTERN_COUNT, PATTERN_LENGTH, PATTERN_SPACING } from '../pattern-numbers';
import type { SketchCurve } from '../sketch';
import { curvePoints } from '../sketch-content';
import type { Entity } from '../sketch-content';
import type { CurveShape, Id, LinearSpan, Point2, SketchFeature, SketchPattern, SketchTransform } from '../types';
import { LENGTH_TOLERANCE, ORIGIN, has, isOriginAxis, unreachable } from '../util';
import { type Dict, type ValidationContext, fail, object, oneOf, onlyFields, string } from '../validation';
import type { DerivedFailure, DerivedKindSpec, EntryGeometry } from './spec';
import type { SketchBase } from './world';

// ---------------------------------------------------------------- the form

function validate(context: ValidationContext, _sketch: SketchFeature, id: Id, o: Dict, what: string): SketchPattern {
  onlyFields(o, ['type', 'sources', 'transform'], what, 'a mirror or pattern of the sketch');
  if (!Array.isArray(o.sources) || o.sources.length === 0) return fail(`${what}.sources: a non-empty list of IDs of own curves and points of the sketch is expected`);
  const sources = (o.sources as unknown[]).map((source, i) => string(source, `${what}.sources[${i}]`));
  if (new Set(sources).size < sources.length) fail(`${what}.sources: an ID is listed twice`);
  return { type: 'pattern', sources, transform: transform(context, id, object(o.transform, `${what}.transform`), `${what}.transform`) };
}

function transform(context: ValidationContext, id: Id, t: Dict, what: string): SketchTransform {
  const { fields } = context;
  const type = oneOf(t.type, ['mirror', 'linear', 'circular'] as const, `${what}.type`);
  const owner = `a transform of the type ${type}`;
  const path = `external/${id}/transform`;
  switch (type) {
    case 'mirror':
      // the name a pattern of features has for it, said with the name the sketch has
      if (t.plane !== undefined) fail(`${what}.plane: a mirror in a sketch is about a line: \`axis\`, not \`plane\``);
      onlyFields(t, ['type', 'axis'], what, owner);
      return { type, axis: string(t.axis, `${what}.axis`) };
    case 'linear': {
      onlyFields(t, ['type', 'direction', 'count', 'span', 'second'], what, owner);
      const first = direction(context, t, path, what);
      if (t.second === undefined) return { type, ...first };
      const given = object(t.second, `${what}.second`);
      onlyFields(given, ['direction', 'count', 'span'], `${what}.second`, 'a second direction');
      return { type, ...first, second: direction(context, given, `${path}/second`, `${what}.second`) };
    }
    case 'circular': {
      if (t.axis !== undefined) fail(`${what}.axis: a circular pattern in a sketch turns about a point: \`center\`, not \`axis\``);
      onlyFields(t, ['type', 'center', 'count', 'span'], what, owner);
      const center = string(t.center, `${what}.center`);
      const count = fields.number(t.count, `${path}/count`, PATTERN_COUNT, `${what}.count`);
      const span = object(t.span, `${what}.span`);
      const full = oneOf(span.type, ['full', 'angle'] as const, `${what}.span.type`) === 'full';
      onlyFields(span, full ? ['type'] : ['type', 'angle'], `${what}.span`, `a span of the type ${full ? 'full' : 'angle'}`);
      return { type, center, count, span: full ? { type: 'full' } : { type: 'angle', angle: fields.number(span.angle, `${path}/span/angle`, PATTERN_ANGLE, `${what}.span.angle`) } };
    }
    default:
      return unreachable(type, `${what}.type`);
  }
}

function direction(context: ValidationContext, given: Dict, path: string, what: string): { direction: Id; count: number; span: LinearSpan } {
  const { fields } = context;
  const line = string(given.direction, `${what}.direction`);
  const count = fields.number(given.count, `${path}/count`, PATTERN_COUNT, `${what}.count`);
  const span = object(given.span, `${what}.span`);
  const kind = oneOf(span.type, ['spacing', 'length'] as const, `${what}.span.type`);
  onlyFields(span, ['type', kind], `${what}.span`, `a span of the type ${kind}`);
  return {
    direction: line,
    count,
    span: kind === 'spacing' ? { type: kind, spacing: fields.number(span.spacing, `${path}/span/spacing`, PATTERN_SPACING, `${what}.span.spacing`) } : { type: kind, length: fields.number(span.length, `${path}/span/length`, PATTERN_LENGTH, `${what}.span.length`) },
  };
}

// ---------------------------------------------------------------- the copies by number

// The copy numbers the counts of the document make, in their order: a mirror 1; a row and a circle
// 1 to count − 1; a grid i + 1000 · j row by row without (0, 0), none above 200 places.
export function copyNumbers(t: SketchTransform): number[] {
  switch (t.type) {
    case 'mirror':
      return [1];
    case 'circular':
      return Array.from({ length: t.count - 1 }, (_, i) => i + 1);
    case 'linear': {
      if (!t.second) return Array.from({ length: t.count - 1 }, (_, i) => i + 1);
      if (t.count * t.second.count > MAX_PATTERN_PLACES) return [];
      const out: number[] = [];
      for (let j = 0; j < t.second.count; j++) for (let i = 0; i < t.count; i++) if (i || j) out.push(i + GRID_STRIDE * j);
      return out;
    }
    default:
      return unreachable(t, 'transform');
  }
}

// Whether a number is one the transform may have, whatever its count.
function possibleNumber(t: SketchTransform, n: number): boolean {
  switch (t.type) {
    case 'mirror':
      return n === 1;
    case 'circular':
      return n >= 1 && n < MAX_PATTERN_COUNT;
    case 'linear':
      if (!t.second) return n >= 1 && n < MAX_PATTERN_COUNT;
      return n >= 1 && n % GRID_STRIDE < MAX_PATTERN_COUNT && Math.floor(n / GRID_STRIDE) < MAX_PATTERN_COUNT;
    default:
      return unreachable(t, 'transform');
  }
}

// What one copy of the sources holds, by the ID of what it copies: a listed own curve with its
// points after it, a listed own point or `origin`; each point once. The sources that are not own
// curves or points are left out (`missing`).
function copied(sketch: SketchFeature, ref: SketchPattern): { order: [Id, EntityKind][]; missing: Id[] } {
  const order: [Id, EntityKind][] = [];
  const seen = new Set<Id>();
  const missing: Id[] = [];
  const point = (p: Id): void => {
    if (seen.has(p)) return;
    seen.add(p);
    order.push([p, 'point']);
  };
  for (const source of ref.sources) {
    if (has(sketch.curves, source)) {
      const curve = sketch.curves[source];
      order.push([source, curve.type]);
      for (const p of curvePoints(curve)) point(p);
    } else if (has(sketch.points, source) || source === ORIGIN) point(source);
    else missing.push(source);
  }
  return { order, missing };
}

function entities(id: Id, ref: SketchPattern, sketch: SketchFeature): Record<Id, EntityKind> {
  const { order } = copied(sketch, ref);
  const out: Record<Id, EntityKind> = {};
  for (const n of copyNumbers(ref.transform)) for (const [source, kind] of order) out[`${id}/${n}/${source}`] = kind;
  return out;
}

// One ID under the entry: `<entry>/<n>/<s>`, `n` a number the transform may have written in decimal
// without leading zeros, `s` a listed own curve, a listed own point or `origin`, or a point of
// a listed own curve.
function entity(id: Id, ref: SketchPattern, sketch: SketchFeature, entry: Id): EntityKind | undefined {
  if (!id.startsWith(`${entry}/`)) return undefined;
  const rest = id.slice(entry.length + 1);
  const slash = rest.indexOf('/');
  if (slash < 0) return undefined;
  const [number, source] = [rest.slice(0, slash), rest.slice(slash + 1)];
  if (!/^[1-9][0-9]*$/.test(number) || !possibleNumber(ref.transform, Number(number))) return undefined;
  if (ref.sources.includes(source)) {
    if (has(sketch.curves, source)) return sketch.curves[source].type;
    if (has(sketch.points, source) || source === ORIGIN) return 'point';
    return undefined;
  }
  return ref.sources.some((s) => has(sketch.curves, s) && curvePoints(sketch.curves[s]).includes(source)) ? 'point' : undefined;
}

// ---------------------------------------------------------------- what the commands refuse

// The IDs of the entry by their role; an update asks only an ID that is new in its role.
function roles(ref: SketchPattern): [role: 'source' | 'axis' | 'direction' | 'second' | 'center', id: Id][] {
  const t = ref.transform;
  const out: ['source' | 'axis' | 'direction' | 'second' | 'center', Id][] = ref.sources.map((s) => ['source', s]);
  switch (t.type) {
    case 'mirror':
      out.push(['axis', t.axis]);
      break;
    case 'linear':
      out.push(['direction', t.direction]);
      if (t.second) out.push(['second', t.second.direction]);
      break;
    case 'circular':
      out.push(['center', t.center]);
      break;
    default:
      unreachable(t, 'transform');
  }
  return out;
}

function commandProblem(sketch: SketchFeature, ref: SketchPattern, before: SketchPattern | undefined, entityOf: (id: Id) => Entity | undefined): string | undefined {
  const had = new Set(before ? roles(before).map(([role, id]) => `${role}\u0000${id}`) : []);
  for (const [role, id] of roles(ref)) {
    if (had.has(`${role}\u0000${id}`)) continue;
    const entity = entityOf(id);
    const what = !entity ? 'not in the sketch' : entity.derived ? `a copy of the mirror or pattern "${id.slice(0, id.indexOf('/'))}"` : isOriginAxis(id) ? 'an axis of the origin' : id === ORIGIN ? 'the origin' : entity.own ? `an own ${entity.kind}` : `a projected ${entity.kind}`;
    switch (role) {
      case 'source':
        if (!entity || entity.derived || (!entity.own && id !== ORIGIN)) return `the source "${id}" is ${what}; a mirror or pattern copies own curves and points of the sketch (and \`origin\`)`;
        break;
      case 'axis':
      case 'direction':
      case 'second':
        if (!entity || entity.derived || entity.kind !== 'line') return `the ${role === 'second' ? 'second direction' : role} "${id}" is ${what}; it has to be a line of the sketch (own, projected, or an axis of the origin) that is not a copy`;
        break;
      case 'center':
        if (!entity || entity.derived || entity.kind !== 'point') return `the center "${id}" is ${what}; it has to be a point of the sketch (own, \`origin\`, or projected) that is not a copy`;
        break;
      default:
        unreachable(role, 'role');
    }
  }
  return undefined;
}

// ---------------------------------------------------------------- the copies

// A transform of the plane of a sketch: a map of points and whether it reflects (a mirror turns the
// sense of an arc: its image runs from the image of `end` to the image of `start`).
interface PlaneMap {
  at(p: Point2): Point2;
  reflects: boolean;
}
const shiftBy = (dx: number, dy: number): PlaneMap => ({ at: (p) => ({ x: p.x + dx, y: p.y + dy }), reflects: false });
const turnAbout = (c: Point2, angle: number): PlaneMap => {
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  return { at: (p) => ({ x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos }), reflects: false };
};
const reflectIn = (a: Point2, u: { x: number; y: number }): PlaneMap => ({
  at: (p) => {
    const [vx, vy] = [p.x - a.x, p.y - a.y];
    const along = vx * u.x + vy * u.y;
    return { x: a.x + 2 * along * u.x - vx, y: a.y + 2 * along * u.y - vy };
  },
  reflects: true,
});

// The line of the base by its ID: its two points and its unit direction from `a` to `b`, or why not.
function lineOf(base: SketchBase, curves: ReadonlyMap<Id, SketchCurve>, id: Id): { a: Point2; u: { x: number; y: number } } | string {
  const curve = curves.get(id);
  if (!curve || curve.source === 'derived') return `"${id}" is not a line of the sketch`;
  if (curve.shape.type !== 'line') return `"${id}" is a${curve.shape.type === 'arc' ? 'n' : ''} ${curve.shape.type}, not a line`;
  const [a, b] = [base.geometry.points[curve.shape.a], base.geometry.points[curve.shape.b]];
  if (!a || !b) return `the line "${id}" has no position`;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(length > LENGTH_TOLERANCE)) return `the line "${id}" has no length`;
  return { a, u: { x: (b.x - a.x) / length, y: (b.y - a.y) / length } };
}

const stepOf = (count: number, span: LinearSpan): number => (span.type === 'spacing' ? span.spacing : count > 1 ? span.length / (count - 1) : 0);

// The maps of the copies in the order of their numbers, or why there are none.
function copiesOf(id: Id, t: SketchTransform, base: SketchBase, curves: ReadonlyMap<Id, SketchCurve>): { copy: number; map: PlaneMap }[] | DerivedFailure {
  const path = `external/${id}/transform`;
  switch (t.type) {
    case 'mirror': {
      const line = lineOf(base, curves, t.axis);
      if (typeof line === 'string') return { code: 'brokenCopies', refs: [id, t.axis], detail: `the axis: ${line}` };
      return [{ copy: 1, map: reflectIn(line.a, line.u) }];
    }
    case 'circular': {
      const c = base.geometry.points[t.center];
      if (!c || !has(base.geometry.points, t.center)) return { code: 'brokenCopies', refs: [id, t.center], detail: `the center: "${t.center}" is not a point of the sketch with a position` };
      const step = t.span.type === 'full' ? (2 * Math.PI) / t.count : t.count > 1 ? t.span.angle / (t.count - 1) : 0;
      return Array.from({ length: t.count - 1 }, (_, i) => ({ copy: i + 1, map: turnAbout(c, step * (i + 1)) }));
    }
    case 'linear': {
      const line = lineOf(base, curves, t.direction);
      if (typeof line === 'string') return { code: 'brokenCopies', refs: [id, t.direction], detail: `the direction: ${line}` };
      const step = stepOf(t.count, t.span);
      if (!t.second) return Array.from({ length: t.count - 1 }, (_, i) => ({ copy: i + 1, map: shiftBy(line.u.x * step * (i + 1), line.u.y * step * (i + 1)) }));
      const other = lineOf(base, curves, t.second.direction);
      if (typeof other === 'string') return { code: 'brokenCopies', refs: [id, t.second.direction], detail: `the second direction: ${other}` };
      const places = t.count * t.second.count;
      if (places > MAX_PATTERN_PLACES) return { code: 'brokenCopies', refs: [id, `${path}/count`, `${path}/second/count`], detail: `${t.count} × ${t.second.count} is ${places} places; a pattern has at most ${MAX_PATTERN_PLACES}, the source included` };
      const second = stepOf(t.second.count, t.second.span);
      const seen: { copy: number; x: number; y: number }[] = [{ copy: 0, x: 0, y: 0 }];
      const out: { copy: number; map: PlaneMap }[] = [];
      for (let j = 0; j < t.second.count; j++) {
        for (let i = 0; i < t.count; i++) {
          if (i === 0 && j === 0) continue;
          const copy = i + GRID_STRIDE * j;
          const [x, y] = [line.u.x * step * i + other.u.x * second * j, line.u.y * step * i + other.u.y * second * j];
          const met = seen.find((place) => Math.hypot(place.x - x, place.y - y) <= LENGTH_TOLERANCE);
          if (met) {
            const refs = [id, `${path}/direction`, `${path}/count`, `${path}/span/${t.span.type}`, `${path}/second/direction`, `${path}/second/count`, `${path}/second/span/${t.second.span.type}`];
            return { code: 'brokenCopies', refs, detail: met.copy === 0 ? `the copy ${copy} would stand in the place of the source` : `the copies ${met.copy} and ${copy} would stand in one place` };
          }
          seen.push({ copy, x, y });
          out.push({ copy, map: shiftBy(x, y) });
        }
      }
      return out;
    }
    default:
      return unreachable(t, 'transform');
  }
}

// The copies of one entry over the base: the points of every copy of every point of the listed
// curves and every listed point; every listed curve over the copies of its points (a circle with
// the radius of its source, a reflected arc with its ends swapped); a copy of a curve that forms
// regions forms regions (the occupation pass of derive.ts may take them). A source that is not an
// own curve or point is skipped and named in the warning, with the copies of the rest made.
function derive(id: Id, ref: SketchPattern, base: SketchBase): EntryGeometry | DerivedFailure {
  const curves = new Map(base.curves.map((curve) => [curve.id, curve]));
  const copies = copiesOf(id, ref.transform, base, curves);
  if (!Array.isArray(copies)) return copies;
  const sketch = base.sketch;
  const { order, missing } = copied(sketch, ref);
  const geometry: EntryGeometry = { points: {}, curves: {}, radii: {}, regions: [] };
  for (const { copy, map } of copies) {
    const name = (source: Id): Id => `${id}/${copy}/${source}`;
    for (const [source, kind] of order) {
      if (kind !== 'point') continue;
      const p = base.geometry.points[source];
      if (p && has(base.geometry.points, source)) geometry.points[name(source)] = map.at(p);
    }
    for (const [source, kind] of order) {
      if (kind === 'point') continue;
      const curve = sketch.curves[source];
      const { construction, ...shape } = curve;
      geometry.curves[name(source)] = copyOf(shape as CurveShape, name, map.reflects);
      if (shape.type === 'circle' && has(base.geometry.radii, source)) geometry.radii[name(source)] = base.geometry.radii[source];
      if (construction !== true) geometry.regions.push(name(source));
    }
  }
  if (missing.length) return { code: 'brokenCopies', refs: [id, ...missing], detail: `${missing.map((m) => `"${m}"`).join(', ')} ${missing.length === 1 ? 'is' : 'are'} not an own curve or point of the sketch; the other sources are copied`, geometry };
  return geometry;
}

function copyOf(shape: CurveShape, name: (source: Id) => Id, reflects: boolean): CurveShape {
  switch (shape.type) {
    case 'line':
      return { type: 'line', a: name(shape.a), b: name(shape.b) };
    case 'circle':
      return { type: 'circle', center: name(shape.center) };
    case 'arc':
      // an arc runs counter-clockwise: its mirror image runs from the image of its end
      return reflects ? { type: 'arc', center: name(shape.center), start: name(shape.end), end: name(shape.start) } : { type: 'arc', center: name(shape.center), start: name(shape.start), end: name(shape.end) };
    default:
      return unreachable(shape, 'curve');
  }
}

export const pattern: DerivedKindSpec<SketchPattern> = {
  source: 'derived',
  title: 'Mirror or pattern',
  validate,
  refs: () => [],
  faces: () => [],
  entities,
  entity,
  commandProblem,
  derive,
};
