// The sketch tool `projectSketch` (D69): entities of an earlier sketch projected into the sketch of
// the context, each by one `addExternal` of the kind `sketch`, with the role the projected curves
// have here; with `as: 'own'` an own outline drawn over the projections and held on them.
// docs/d36/6b-sketch-projection/design.md, "The sketch tool projectSketch". The catalog entry is
// in sketch-tools.ts, which calls `projectSketch`.
import { entryOrder, occupies } from './references/derive';
import { entityIndex, kindOf } from './references/index';
import { type ProjectedKind, degreesText, projectFromSketch, sketchMap } from './references/projection';
import { sketchWorld, toolBase } from './references/world';
import { type SketchCurve, type SketchGeometry, solvedCurves } from './sketch';
import { renamePatches } from './sketch-cut';
import { curvePoints } from './sketch-content';
import type { NewId, SketchToolCall, SketchToolResult } from './sketch-tools';
import type { Command, Constraint, CurveShape, Id, Projected, SketchFeature, SketchProjection, SketchResult, Vec2 } from './types';
import { LENGTH_TOLERANCE, ORIGIN, has, underOrigin, unreachable } from './util';

export interface ProjectSketchInput {
  sketch: Id;
  entities?: Id[];
  as?: 'source' | 'reference' | 'regions' | 'own';
}

// What the tool returns in `ids`, in this order; what it leaves out is one list per reason.
export const PROJECT_SKETCH_IDS = {
  entries: 'the entries of external, one per projected entity, in the order of `sources`: the new ones, and with `as: "own"` those in `taken`',
  sources: 'the entity of the source sketch each entry projects',
  skipped: 'entities of the source this sketch projects already; nothing was made for them (with `as: "own"`, see `taken` for an entry with the flag `regions`)',
  doubled: 'with `as: "own"`: curves of the source at the place of a curve before them in the list, or of an own curve that forms regions in this sketch already (one own curve is drawn per place); nothing was made for them',
  taken: 'with `as: "own"` and `entities`: the entries of this sketch that projected a curve named in `entities` with the flag `regions` already (they are not cut); their flag is switched off and an own curve is drawn over each and held on it, so the regions along it and its side face are named by the own curve',
  curves: 'with `as: "own"`: the own curves, `curves[i]` over the i-th entry that is a curve',
  points: 'with `as: "own"`: the own points (the ends, one per place, then the centres)',
  helpers: 'with `as: "own"`: the construction lines from the centre of each own arc to its start',
  constraints: 'with `as: "own"`: the constraints that hold the own curves on the projected ones',
  patched: 'with `taken`: the features that named a region along a taken entry or a side face of it, renamed to its own curve in the same batch (the regions of an extrusion or a revolve, the edges of a chamfer or a fillet, the plane of a sketch and the edges it projects, the base or midplane of a plane)',
} as const;

export const TILTED = (sketch: Id, degrees: number): string => `the plane of ${sketch} is at ${degreesText(degrees)} to this sketch; only a sketch on a parallel plane is projected`;
export const LYING = (a: Id, b: Id, sketch: Id): string => `${a} and ${b} of ${sketch} lie on each other: projected with regions both would bound the same regions; name the entities, or use as: "source"`;

// An entry to take over whose place an own curve holds already (drawn by hand over it).
// `readers`: what names a region along the entry or its side face (features, then section entries).
export const COVERED = (entry: Id, ref: SketchProjection, own: Id, sketch: Id, readers: readonly Id[]): string =>
  `${entry} has the own curve ${own} over it already: switch the flag of ${entry} off instead, updateExternal { sketch: "${sketch}", id: "${entry}", ref: { type: "sketch", sketch: "${ref.sketch}", entity: "${ref.entity}", kind: "${ref.kind}", regions: false } }; the regions along it and its side face are then named by ${own}, so ${readers.length > 0 ? `rename them in ${readers.join(', ')}` : 'nothing has to be renamed'}`;
// Taken entries whose side face something names that the takeover does not rename.
export const UNPATCHED = (taken: readonly Id[], readers: readonly Id[]): string =>
  `${taken.join(', ')} ${taken.length === 1 ? 'is' : 'are'} not taken over: the own curve would rename ${taken.length === 1 ? 'its side face' : 'their side faces'}, which ${readers.join(', ')} ${readers.length === 1 ? 'names' : 'name'} where the takeover cannot rename it (for example an extent up to the face, an axis or a frame on it, a section entry, or a projected edge whose faces would swap); make ${readers.length === 1 ? 'it' : 'them'} name another face first`;

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
export function wholeSketch(source: SketchFeature, curves: ReadonlyMap<Id, SketchCurve>): Id[] {
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
  // then the skip: what this sketch projects already; with own, an entry of the same kind with the
  // flag whose entity `entities` names is taken over (its flag switched off, an own curve drawn over
  // it), not skipped. A run over the whole sketch skips it: taking it over renames the regions along
  // it and its side face, which only a request that names it asks for.
  const projected = new Map(Object.entries(target.external).flatMap(([id, ref]) => (ref.type === 'sketch' && ref.sketch === from ? [[ref.entity, { id, ref }] as const] : [])));
  const takes = (item: Item): boolean => {
    const entry = projected.get(item.id);
    return as === 'own' && input.entities !== undefined && entry !== undefined && entry.ref.regions && entry.ref.kind === item.kind;
  };
  const skipped = items.filter((item) => projected.has(item.id) && !doubled.has(item.id) && !takes(item)).map((item) => item.id);
  // the values, as the projection gives them (a degenerate one refused)
  const values = new Map<Id, Projected>();
  for (const item of items) {
    if (doubled.has(item.id) || skipped.includes(item.id)) continue;
    const ref: SketchProjection = { type: 'sketch', sketch: from, entity: item.id, kind: item.kind, regions: false };
    const value = projectFromSketch(ref, state, targetResult.plane);
    if ('code' in value) return failed(`${item.id} of ${from} cannot be projected: ${value.detail}`);
    values.set(item.id, value);
  }
  // then, for own, a place this sketch already holds with an own curve that forms regions; a
  // flagged entry to take over there is told how to switch its flag off instead
  const covered: string[] = [];
  if (as === 'own') {
    const mine = solvedCurves(target, targetResult.sketch);
    const own = [...mine.curves.values()].filter((curve) => curve.source === 'own' && curve.regions);
    const geometry: SketchGeometry = { points: { ...mine.geometry.points }, radii: { ...mine.geometry.radii } };
    for (const [id, value] of values) {
      const curve = placed(`\u0000${id}`, value, geometry);
      const other = curve && own.find((o) => occupies(curve, o, geometry));
      if (!other) continue;
      doubled.add(id);
      values.delete(id);
      const item = items.find((i) => i.id === id) as Item;
      const entry = projected.get(id);
      if (entry && takes(item)) {
        const readers = renamePatches(context.document, target, { [entry.id]: other.id });
        covered.push(COVERED(entry.id, entry.ref, other.id, target.id, [...readers.patched, ...readers.unpatched]));
      }
    }
  }
  const made = items.filter((item) => values.has(item.id));
  if (made.length === 0) return failed(`nothing to project: of ${from} ${skipped.length} ${skipped.length === 1 ? 'entity is' : 'entities are'} projected already${doubled.size ? `, ${doubled.size} at a place another curve has` : ''}${covered.map((text) => `; ${text}`).join('')}`);

  const sketch = target.id;
  const commands: Command[] = [];
  const out = { entries: [] as Id[], sources: [] as Id[], skipped, doubled: items.filter((item) => doubled.has(item.id)).map((item) => item.id), taken: [] as Id[], curves: [] as Id[], points: [] as Id[], helpers: [] as Id[], constraints: [] as Id[], patched: [] as Id[] };
  const entryOf = new Map<Id, Id>();
  for (const item of made) {
    const ref: SketchProjection = { type: 'sketch', sketch: from, entity: item.id, kind: item.kind, regions: as === 'own' ? false : role(item) };
    const taken = takes(item) ? projected.get(item.id)?.id : undefined;
    const id = taken ?? newId('x');
    entryOf.set(item.id, id);
    out.entries.push(id);
    out.sources.push(item.id);
    if (taken === undefined) commands.push({ type: 'addExternal', sketch, id, ref });
    else {
      // the same source: the update keeps the entry's last values and checks no reference
      out.taken.push(taken);
      commands.push({ type: 'updateExternal', sketch, id, ref });
    }
  }
  if (as === 'own') commands.push(...ownOutline(sketch, made, values, entryOf, out, newId, heldEnds(target, targetResult.sketch)));
  // a taken entry is renamed to its own curve in the regions along it and on its side face: what
  // reads them is patched in the same batch, or the takeover is refused
  if (out.taken.length > 0) {
    const renames: Record<Id, Id> = {};
    const overCurves = made.filter((item) => item.kind !== 'point');
    overCurves.forEach((item, i) => {
      const entry = entryOf.get(item.id) as Id;
      if (out.taken.includes(entry)) renames[entry] = out.curves[i];
    });
    const patches = renamePatches(context.document, target, renames);
    if (patches.unpatched.length > 0) return failed(UNPATCHED(out.taken, patches.unpatched));
    commands.push(...patches.commands);
    out.patched.push(...patches.patched);
  }
  return { ok: true, commands, ids: out };
}

// The ends of a shape: a line's `a` and `b`, an arc's `start` and `end`; a circle has none.
const endsOf = (shape: CurveShape): Id[] => (shape.type === 'line' ? [shape.a, shape.b] : shape.type === 'arc' ? [shape.start, shape.end] : []);

// The own vertices this sketch has where an own outline may end: for a place, the own point there
// that ends an own curve forming regions, when the own ends there are one vertex (by the joins of
// the sketch); undefined when there is none, or two vertices (which the outline cannot join).
// The tool reuses that point, with no constraint added: it is how a second run meets the outline of
// the first, whose ends are held on their projections already.
function heldEnds(sketch: SketchFeature, result: SketchResult | undefined): (at: Vec2) => Id | undefined {
  if (!result) return () => undefined;
  const world = sketchWorld(toolBase(sketch, result));
  const ends: { at: Vec2; point: Id; vertex: Id }[] = [];
  for (const curve of world.curves.values()) {
    if (curve.source !== 'own' || !curve.regions) continue;
    for (const point of endsOf(curve.shape)) {
      const p = world.geometry.points[point];
      if (p) ends.push({ at: [p.x, p.y], point, vertex: world.joins(point) });
    }
  }
  return (at) => {
    const here = ends.filter((end) => Math.hypot(end.at[0] - at[0], end.at[1] - at[1]) <= LENGTH_TOLERANCE);
    return here.length > 0 && here.every((end) => end.vertex === here[0].vertex) ? here[0].point : undefined;
  };
}

// The own outline over the projected curves: one own point per place where ends of the projected
// curves lie, coincident with the first projected end there; an own line between two of them; an
// own circle with its centre coincident with the projected centre and equalRadius; an own arc with
// a centre of its own started at the projected centre, a construction line from that centre to its
// start, and the projected centre on that line (pointOnCurve): the ends put the centre on the
// bisector of the chord, the line crosses it once, at the projected centre.
function ownOutline(sketch: Id, made: Item[], values: Map<Id, Projected>, entryOf: Map<Id, Id>, out: { curves: Id[]; points: Id[]; helpers: Id[]; constraints: Id[] }, newId: NewId, held: (at: Vec2) => Id | undefined): Command[] {
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
  // the own point at the place of a projected end: the own vertex this sketch has there, or one
  // made once per place
  const end = (at: Vec2, projected: Id): Id => {
    const mine = held(at);
    if (mine !== undefined) return mine;
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
