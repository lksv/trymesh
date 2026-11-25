// The sketch tool `projectSketch` (D69): entities of an earlier sketch projected into the sketch of
// the context, each by one `addExternal` of the kind `sketch`, with the role the projected curves
// have here; with `as: 'own'` an own outline drawn over the projections and held on them.
// docs/d36/6b-sketch-projection/design.md, "The sketch tool projectSketch". The catalog entry is
// in sketch-tools.ts, which calls `projectSketch`.
import { entryOrder, occupies } from './references/derive';
import { entityIndex, kindOf } from './references/index';
import { type ProjectedKind, projectFromSketch, sketchMap } from './references/projection';
import { type SketchCurve, type SketchGeometry, solvedCurves } from './sketch';
import { curvePoints } from './sketch-content';
import type { NewId, SketchToolCall, SketchToolResult } from './sketch-tools';
import type { Command, Constraint, Id, Projected, SketchFeature, SketchProjection, Vec2 } from './types';
import { LENGTH_TOLERANCE, ORIGIN, has, underOrigin, unreachable } from './util';

export interface ProjectSketchInput {
  sketch: Id;
  entities?: Id[];
  as?: 'source' | 'reference' | 'regions' | 'own';
}

// What the tool returns in `ids`, in this order; what it leaves out is one list per reason.
export const PROJECT_SKETCH_IDS = {
  entries: 'the new entries of external, one per projected entity, in the order of `sources`',
  sources: 'the entity of the source sketch each entry projects',
  skipped: 'entities of the source this sketch projects already; nothing was made for them',
  doubled: 'with `as: "own"`: curves of the source at the place of a curve before them in the list, or of an own curve that forms regions in this sketch already (one own curve is drawn per place); nothing was made for them',
  curves: 'with `as: "own"`: the own curves, `curves[i]` over the i-th entry that is a curve',
  points: 'with `as: "own"`: the own points (the ends, one per place, then the centres)',
  helpers: 'with `as: "own"`: the construction lines from the centre of each own arc to its start',
  constraints: 'with `as: "own"`: the constraints that hold the own curves on the projected ones',
} as const;

export const TILTED = (sketch: Id, degrees: number): string => `the plane of ${sketch} is at ${degrees.toFixed(1)}° to this sketch; only a sketch on a parallel plane is projected`;
export const LYING = (a: Id, b: Id, sketch: Id): string => `${a} and ${b} of ${sketch} lie on each other: projected with regions both would bound the same regions; name the entities, or use as: "source"`;

const failed = (message: string): SketchToolResult => ({ ok: false, message });

// One entity of the source to project: its kind, whether it forms regions there, and its curve.
interface Item {
  id: Id;
  kind: ProjectedKind;
  regions: boolean;
  curve?: SketchCurve;
}

// The source's entities the whole-sketch form takes, in its order: the own curves that are not
// construction curves; the curves of the entries in their order (of a reference entry every curve,
// of a derived entry the copies that form regions); the lone points (an own point no own curve
// names, a point entry). Nothing under `origin/`.
function wholeSketch(source: SketchFeature, curves: ReadonlyMap<Id, SketchCurve>): Id[] {
  const out: Id[] = [];
  for (const [id, curve] of Object.entries(source.curves)) if (!curve.construction && curves.has(id)) out.push(id);
  const index = entityIndex(source);
  const points: Id[] = [];
  for (const entry of entryOrder(source)) {
    const ref = source.external[entry];
    const derived = kindOf(ref).source === 'derived';
    for (const id of index.byEntry.get(entry) ?? []) {
      const curve = curves.get(id);
      if (curve) {
        if (!derived || curve.regions) out.push(id);
      } else if (!derived && id === entry && index.entities.get(id)?.kind === 'point') points.push(id);
    }
  }
  const named = new Set(Object.values(source.curves).flatMap(curvePoints));
  const lone = Object.keys(source.points).filter((id) => !named.has(id));
  return [...out, ...lone, ...points].filter((id) => !underOrigin(id));
}

// The place of a projected curve in the coordinates of the target, as a curve over points of its
// own (`<key>/…`) for `occupies`.
function placed(key: Id, value: Projected, geometry: SketchGeometry): SketchCurve | undefined {
  const put = (name: string, p: Vec2): Id => {
    const id = `${key}/${name}`;
    geometry.points[id] = { x: p[0], y: p[1] };
    return id;
  };
  switch (value.kind) {
    case 'point':
      return undefined;
    case 'line':
      return { id: key, shape: { type: 'line', a: put('a', value.a), b: put('b', value.b) }, source: 'reference', regions: true };
    case 'circle':
      geometry.radii[key] = value.radius;
      return { id: key, shape: { type: 'circle', center: put('center', value.center) }, source: 'reference', regions: true };
    case 'arc':
      return { id: key, shape: { type: 'arc', center: put('center', value.center), start: put('start', value.start), end: put('end', value.end) }, source: 'reference', regions: true };
    default:
      return unreachable(value, 'projected value');
  }
}

export function projectSketch(context: SketchToolCall, input: ProjectSketchInput, newId: NewId): SketchToolResult {
  const target = context.sketch;
  const from = input.sketch;
  const as = input.as ?? 'source';
  // the source: an earlier sketch of the document, evaluated
  const features = context.document.features;
  const at = features.findIndex((f) => f.id === from);
  const here = features.findIndex((f) => f.id === target.id);
  if (at < 0 || features[at].type !== 'sketch') return failed(`the document has no sketch "${from}"`);
  if (from === target.id) return failed(`${from} is this sketch; only an earlier sketch is projected`);
  if (here >= 0 && at > here) return failed(`${from} is after this sketch; only an earlier sketch is projected`);
  const source = features[at] as SketchFeature;
  const [sourceResult, targetResult] = [context.features[from], context.features[target.id]];
  if (!sourceResult?.sketch || !sourceResult.plane) return failed(`${from} is not evaluated: suppressed, in error, or its plane is broken`);
  if (!targetResult?.plane) return failed('this sketch is not evaluated: suppressed, in error, or its plane is broken');
  const map = sketchMap(sourceResult.plane, targetResult.plane);
  if (!map.parallel) return failed(TILTED(from, (map.angle * 180) / Math.PI));
  const solved = solvedCurves(source, sourceResult.sketch);
  const curves = new Map([...solved.curves].filter(([id]) => !underOrigin(id)));
  const state = { frame: sourceResult.plane, geometry: solved.geometry, curves };

  // what is projected, in order
  let ids: Id[];
  if (input.entities !== undefined) {
    ids = [...new Set(input.entities)];
    for (const id of ids) {
      if (underOrigin(id)) return failed(`${id} of ${from} is not projected: this sketch has its own axes origin/x and origin/y; project the origin of ${from} for a point at its origin`);
      if (!curves.has(id) && !has(solved.geometry.points, id) && id !== ORIGIN) return failed(`${from} has no point or curve "${id}"`);
    }
  } else ids = wholeSketch(source, curves);
  const items: Item[] = ids.map((id) => {
    const curve = curves.get(id);
    return curve ? { id, kind: curve.shape.type, regions: curve.regions, curve } : { id, kind: 'point', regions: false };
  });
  if (items.length === 0) return failed(`${from} has nothing to project`);

  // the role of the curves here
  const role = (item: Item): boolean => item.kind !== 'point' && (as === 'source' ? item.regions : as === 'regions');
  if (as === 'regions') {
    const listed = items.filter((item) => item.curve);
    for (let i = 0; i < listed.length; i++) for (let j = i + 1; j < listed.length; j++) if (occupies(listed[i].curve as SketchCurve, listed[j].curve as SketchCurve, solved.geometry)) return failed(LYING(listed[i].id, listed[j].id, from));
  }

  // own: one curve per place, decided over the whole list first
  const doubled = new Set<Id>();
  if (as === 'own') {
    const listed = items.filter((item) => item.curve);
    for (let j = 0; j < listed.length; j++) for (let i = 0; i < j; i++) if (!doubled.has(listed[i].id) && occupies(listed[j].curve as SketchCurve, listed[i].curve as SketchCurve, solved.geometry)) {
      doubled.add(listed[j].id);
      break;
    }
  }
  // then the skip: what this sketch projects already
  const projected = new Set(Object.values(target.external).flatMap((ref) => (ref.type === 'sketch' && ref.sketch === from ? [ref.entity] : [])));
  const skipped = items.filter((item) => projected.has(item.id) && !doubled.has(item.id)).map((item) => item.id);
  // the values, as the projection gives them (a degenerate one refused)
  const values = new Map<Id, Projected>();
  for (const item of items) {
    if (doubled.has(item.id) || skipped.includes(item.id)) continue;
    const ref: SketchProjection = { type: 'sketch', sketch: from, entity: item.id, kind: item.kind, regions: false };
    const value = projectFromSketch(ref, state, targetResult.plane);
    if ('code' in value) return failed(`${item.id} of ${from} cannot be projected: ${value.detail}`);
    values.set(item.id, value);
  }
  // then, for own, a place this sketch already holds with an own curve that forms regions
  if (as === 'own') {
    const mine = solvedCurves(target, targetResult.sketch);
    const own = [...mine.curves.values()].filter((curve) => curve.source === 'own' && curve.regions);
    const geometry: SketchGeometry = { points: { ...mine.geometry.points }, radii: { ...mine.geometry.radii } };
    for (const [id, value] of values) {
      const curve = placed(`\u0000${id}`, value, geometry);
      if (curve && own.some((other) => occupies(curve, other, geometry))) {
        doubled.add(id);
        values.delete(id);
      }
    }
  }
  const made = items.filter((item) => values.has(item.id));
  if (made.length === 0) return failed(`nothing to project: of ${from} ${skipped.length} ${skipped.length === 1 ? 'entity is' : 'entities are'} projected already${doubled.size ? `, ${doubled.size} at a place another curve has` : ''}`);

  const sketch = target.id;
  const commands: Command[] = [];
  const out = { entries: [] as Id[], sources: [] as Id[], skipped, doubled: items.filter((item) => doubled.has(item.id)).map((item) => item.id), curves: [] as Id[], points: [] as Id[], helpers: [] as Id[], constraints: [] as Id[] };
  const entryOf = new Map<Id, Id>();
  for (const item of made) {
    const id = newId('x');
    entryOf.set(item.id, id);
    out.entries.push(id);
    out.sources.push(item.id);
    commands.push({ type: 'addExternal', sketch, id, ref: { type: 'sketch', sketch: from, entity: item.id, kind: item.kind, regions: as === 'own' ? false : role(item) } });
  }
  if (as === 'own') commands.push(...ownOutline(sketch, made, values, entryOf, out, newId));
  return { ok: true, commands, ids: out };
}

// The own outline over the projected curves: one own point per place where ends of the projected
// curves lie, coincident with the first projected end there; an own line between two of them; an
// own circle with its centre coincident with the projected centre and equalRadius; an own arc with
// a centre of its own started at the projected centre, a construction line from that centre to its
// start, and the projected centre on that line (pointOnCurve): the ends put the centre on the
// bisector of the chord, the line crosses it once, at the projected centre.
function ownOutline(sketch: Id, made: Item[], values: Map<Id, Projected>, entryOf: Map<Id, Id>, out: { curves: Id[]; points: Id[]; helpers: Id[]; constraints: Id[] }, newId: NewId): Command[] {
  const points: Command[] = [];
  const centres: Command[] = [];
  const curves: Command[] = [];
  const constraints: Command[] = [];
  const centreIds: Id[] = [];
  const places: { at: Vec2; point: Id }[] = [];
  const constrain = (constraint: Constraint): void => {
    const id = newId('k');
    out.constraints.push(id);
    constraints.push({ type: 'addConstraint', sketch, id, constraint });
  };
  // the own point at the place of a projected end, made once per place
  const end = (at: Vec2, projected: Id): Id => {
    const known = places.find((place) => Math.hypot(place.at[0] - at[0], place.at[1] - at[1]) <= LENGTH_TOLERANCE);
    if (known) return known.point;
    const point = newId('p');
    places.push({ at, point });
    out.points.push(point);
    points.push({ type: 'addPoint', sketch, id: point, x: at[0], y: at[1] });
    constrain({ type: 'coincident', a: point, b: projected });
    return point;
  };
  const centre = (at: Vec2): Id => {
    const point = newId('p');
    centreIds.push(point);
    centres.push({ type: 'addPoint', sketch, id: point, x: at[0], y: at[1] });
    return point;
  };
  for (const item of made) {
    const value = values.get(item.id) as Projected;
    const entry = entryOf.get(item.id) as Id;
    switch (value.kind) {
      case 'point':
        break;
      case 'line': {
        const [a, b] = [end(value.a, `${entry}/a`), end(value.b, `${entry}/b`)];
        const id = newId('c');
        out.curves.push(id);
        curves.push({ type: 'addCurve', sketch, id, curve: { type: 'line', a, b } });
        break;
      }
      case 'circle': {
        const c = centre(value.center);
        const id = newId('c');
        out.curves.push(id);
        curves.push({ type: 'addCurve', sketch, id, curve: { type: 'circle', center: c }, radius: value.radius });
        constrain({ type: 'coincident', a: c, b: `${entry}/center` });
        constrain({ type: 'equalRadius', a: id, b: entry });
        break;
      }
      case 'arc': {
        const [s, e] = [end(value.start, `${entry}/start`), end(value.end, `${entry}/end`)];
        const c = centre(value.center);
        const id = newId('c');
        out.curves.push(id);
        curves.push({ type: 'addCurve', sketch, id, curve: { type: 'arc', center: c, start: s, end: e } });
        const helper = newId('c');
        out.helpers.push(helper);
        curves.push({ type: 'addCurve', sketch, id: helper, curve: { type: 'line', a: c, b: s, construction: true } });
        constrain({ type: 'pointOnCurve', point: `${entry}/center`, curve: helper });
        break;
      }
      default:
        unreachable(value, 'projected value');
    }
  }
  out.points.push(...centreIds);
  return [...points, ...centres, ...curves, ...constraints];
}
