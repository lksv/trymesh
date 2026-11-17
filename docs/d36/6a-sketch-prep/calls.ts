// Package 6a (D64) as calls against its contract. Only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). 6a changes no behaviour and has no part of validation
// scenario 15, so the calls show two things:
// a. Existing documents and calls behave as on `master`: a sketch with own curves and two
//    projected edges, its solution, its regions, its commands and what the app and MCP read of it.
// b. to g. How the packages of step 6 plug in: a kind of reference (6b), the axes of the origin
//    (6b), a kind of derived geometry with its joins and regions (6c), a curve kind that the
//    exhaustive switches stop (6d), an entry of several entities (6f), and a tool of the app (6e).
// Lines marked `@ts-expect-error` must not compile.
//
// The entries of b. to g. are written as values of the contract's types and are not merged into
// the shared maps (`ReferenceKinds`, `DerivedKinds`): all contracts are type-checked together, and
// an entry merged here would be one every later contract has to handle. Their names start with
// `plug`; the real names belong to 6b, 6c, 6d, 6e and 6f.

import type { CurveShape, Id, IssueCode, Point2, Projected, SketchFeature, SolveInput } from '../../../packages/engine/src/index';
import type { EntityKind } from '../../../packages/engine/src/catalog';
import type { CommandAfter, EngineAfter, StateAfter } from '../00-prep/contract';
import type { DerivedKindSpec, EntryGeometry, PlaceStandIn, ReferenceKindSpec, ResolvedReference, ResultCurve, SketchCurve, SketchPlaceTool, SketchResultAfter } from './contract';
import { REFERENCE_KINDS, entityOf, joinPairs, joinsOf, profileOf, referenceEntities, resolveReferences, sketchCurves, solverSetup, unreachable } from './contract';

declare const engine: EngineAfter;
declare function fail(message: string): never;
const done = (result: ReturnType<EngineAfter['execute']>): StateAfter => (result.ok ? result.state : fail(`${result.error.code}: ${result.error.message}`));
const run = (...commands: CommandAfter[]): StateAfter => done(engine.execute(commands.length === 1 ? commands[0] : { type: 'batch', commands }));
const sketchOf = (state: StateAfter, id: Id): SketchFeature => {
  const feature = state.document.features.find((f) => f.id === id);
  return feature?.type === 'sketch' ? (feature as SketchFeature) : fail(`no sketch "${id}"`);
};
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// ================================================================ a. what stays as it is

// A plate and a sketch on its top: an own rectangle tied to the projections of two edges of the
// plate, a straight one (`x1`) and the rim of a bore (`x2`). Every command is one of today.
const XY = { kind: 'base', plane: 'XY' } as const;
export function plate(): StateAfter {
  const line = (id: Id, a: Id, b: Id): CommandAfter => ({ type: 'addCurve', sketch: 's1', id, curve: { type: 'line', a, b } });
  const point = (id: Id, x: number, y: number): CommandAfter => ({ type: 'addPoint', sketch: 's1', id, x, y });
  run(
    { type: 'addFeature', feature: { id: 's1', name: 'Plate', suppressed: false, type: 'sketch', plane: XY, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } },
    point('p1', 0, 0),
    point('p2', 80, 0),
    point('p3', 80, 50),
    point('p4', 0, 50),
    point('pc', 40, 25),
    line('l1', 'p1', 'p2'),
    line('l2', 'p2', 'p3'),
    line('l3', 'p3', 'p4'),
    line('l4', 'p4', 'p1'),
    { type: 'addCurve', sketch: 's1', id: 'bore', curve: { type: 'circle', center: 'pc' }, radius: 6 },
  );
  run({ type: 'addFeature', feature: { id: 'E', name: 'Plate', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's1', regions: [{ outerLoop: ['l1', 'l2', 'l3', 'l4'] }] }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'new' } });
  run({ type: 'addFeature', feature: { id: 's2', name: 'Top', suppressed: false, type: 'sketch', plane: { kind: 'face', body: 'E', face: { feature: 'E', role: 'endCap' } }, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } });
  return run(
    { type: 'addExternal', sketch: 's2', id: 'x1', ref: { type: 'edge', body: 'E', edge: { a: { feature: 'E', role: 'endCap' }, b: { feature: 'E', role: 'side', curve: 'l1' } }, kind: 'line' } },
    { type: 'addExternal', sketch: 's2', id: 'x2', ref: { type: 'edge', body: 'E', edge: { a: { feature: 'E', role: 'endCap' }, b: { feature: 'E', role: 'side', curve: 'bore' } }, kind: 'circle' } },
    { type: 'addPoint', sketch: 's2', id: 'q1', x: 5, y: 5 },
    { type: 'addConstraint', sketch: 's2', id: 'k1', constraint: { type: 'distancePointLine', point: 'q1', line: 'x1', value: 5, driving: true } },
    { type: 'addConstraint', sketch: 's2', id: 'k2', constraint: { type: 'distance', a: 'q1', b: 'x1/a', value: 8, driving: true } },
    { type: 'addConstraint', sketch: 's2', id: 'k3', constraint: { type: 'radius', curve: 'x2', value: 6, driving: false } },
  );
}

// The entities of a sketch are those of today, now read through the registry.
export function entitiesStay(state: StateAfter): boolean {
  const s2 = sketchOf(state, 's2');
  return (
    same(entityOf(s2, 'x1'), { kind: 'line', own: false }) &&
    same(entityOf(s2, 'x1/a'), { kind: 'point', own: false }) &&
    same(entityOf(s2, 'x2/center'), { kind: 'point', own: false }) &&
    entityOf(s2, 'x2/a') === undefined &&
    entityOf(s2, 'origin/x') === undefined && // reserved for 6b, no entity yet
    same(Object.entries(referenceEntities(s2, 'x1')), [['x1', 'line'], ['x1/a', 'point'], ['x1/b', 'point']]) &&
    same(Object.entries(referenceEntities(s2, 'x2')), [['x2', 'circle'], ['x2/center', 'point']])
  );
}

// The solver gets what it gets today, the stamp is the stored one (a loaded document is not solved
// again), and the profile is that of the own curves.
export function solveStays(state: StateAfter, frame: import('../../../packages/engine/src/index').Frame, before: import('../../../packages/engine/src/recompute/state').State): boolean {
  const s2 = sketchOf(state, 's2');
  const { resolved, lost } = resolveReferences(s2, { state: before, frame });
  const setup = solverSetup(s2, resolved);
  const input: SolveInput = setup.input;
  const line: Projected | undefined = resolved.x1?.value;
  return (
    lost.length === 0 &&
    line?.kind === 'line' &&
    same(input.curves.x1, { type: 'line', a: 'x1/a', b: 'x1/b' }) &&
    same(input.curves.x2, { type: 'circle', center: 'x2/center' }) &&
    same(input.fixed, ['origin', 'x1/a', 'x1/b', 'x2/center', 'x2']) &&
    setup.stamp === s2.solved.inputs
  );
}

// The profile from the list of curves: the projected curves are in the list and form no regions,
// so the regions are those `detectProfile` finds in the own curves.
export function profileStays(state: StateAfter): boolean {
  const s1 = sketchOf(state, 's1');
  const result = state.evaluation.features.s1.sketch as SketchResultAfter;
  const curves: SketchCurve[] = sketchCurves(s1, {});
  const geometry = { points: { origin: { x: 0, y: 0 }, ...result.points }, radii: result.radii };
  const profile = profileOf(curves, joinsOf(joinPairs(s1, {}), geometry), geometry, 0.01);
  return profile.valid && same(profile.regions.map((region) => region.ref.outerLoop), [['bore'], ['l1', 'l2', 'l3', 'l4']]) && curves.every((curve) => curve.source === 'own' && curve.regions);
}

// The result carries the projected curves, in the order of `external`; the points and radii are
// those of today.
export function resultCarriesProjections(state: StateAfter): boolean {
  const result = state.evaluation.features.s2.sketch as SketchResultAfter;
  const x1: ResultCurve | undefined = result.curves.x1;
  return (
    same(Object.keys(result.curves), ['x1', 'x2']) &&
    same(x1, { shape: { type: 'line', a: 'x1/a', b: 'x1/b' }, source: 'reference', regions: false }) &&
    result.points['x1/a'] !== undefined &&
    Math.abs(result.radii.x2 - 6) < 1e-9 // the radius of the rim as the analysis of the body gives it
  );
}

// Commands answer as today, with today's texts.
export function commandsStay(): boolean {
  const otherKind = engine.preview({ type: 'updateExternal', sketch: 's2', id: 'x1', ref: { type: 'edge', body: 'E', edge: { a: { feature: 'E', role: 'endCap' }, b: { feature: 'E', role: 'side', curve: 'bore' } }, kind: 'circle' } });
  const removed = engine.preview({ type: 'removeExternal', sketch: 's2', id: 'x1' });
  const removedSketch = removed.ok ? sketchOf(removed.state, 's2') : undefined;
  return (
    !otherKind.ok &&
    /druh promítnutí změnit nejde/.test(otherKind.error.message) &&
    // the constraints on the entry and on its entities go with it, k3 on x2 stays
    same(Object.keys(removedSketch?.constraints ?? {}), ['k3'])
  );
}

// ================================================================ b. a kind of reference (6b)

// How 6b adds the projection of an entity of another sketch: a member of `ExternalRef`, a value
// (the projected curve, now also an arc or a point), an entry of the registry. Written as a value
// of the type of an entry; 6b names it `sketch` and decides its fields.
interface PlugSketchRef {
  type: 'plugSketch';
  sketch: Id;
  entity: Id;
  kind: 'point' | 'line' | 'circle' | 'arc';
  regions?: boolean; // the flag of question 4: a projected curve forms regions only with it
}
// The value carries the join key of each projected point (the source sketch and the vertex of the
// source point there), since `geometry` does not see the source sketch; it is stored and stamped
// with the value, and a frozen value keeps it.
type PlugValue = (Projected | { kind: 'arc'; center: [number, number]; start: [number, number]; end: [number, number] } | { kind: 'point'; at: [number, number] }) & { keys?: Record<string, string> };
const at = (v: [number, number]): Point2 => ({ x: v[0], y: v[1] });

export const plugSketch: ReferenceKindSpec<PlugSketchRef, PlugValue> = {
  source: 'reference',
  title: 'Projection of an entity of another sketch',
  validate: (_context, _sketch, _id, entry) => entry as unknown as PlugSketchRef,
  faces: () => [],
  refs: (ref, path) => [
    { path, id: ref.sketch, kind: 'sketch' },
    { path, id: ref.entity, kind: 'entity', sketch: ref.sketch, accepts: [ref.kind] },
  ],
  // the single-curve scheme: the entry is the curve (or the point), its points by the names of the kind
  entities: (id, ref): Record<Id, EntityKind> =>
    ref.kind === 'point' ? { [id]: 'point' } : ref.kind === 'line' ? { [id]: 'line', [`${id}/a`]: 'point', [`${id}/b`]: 'point' } : ref.kind === 'circle' ? { [id]: 'circle', [`${id}/center`]: 'point' } : { [id]: 'arc', [`${id}/center`]: 'point', [`${id}/start`]: 'point', [`${id}/end`]: 'point' },
  compute: (ref, context): PlugValue | IssueCode => (context.state.sketches[ref.sketch] ? fail('6b computes it') : 'brokenProjection'),
  value: (stored, ref) => ((stored as PlugValue).kind === ref.kind ? (stored as PlugValue) : undefined),
  // Each projected point is keyed by its source (6b: the sketch and the vertex of the point there,
  // read from the value), so two entries that project the two ends of one corner join, and
  // a projected outline closes.
  geometry: (id, ref, value): EntryGeometry => {
    const regions = ref.regions === true && value.kind !== 'point' ? [id] : [];
    const geometry = shapes(id, value, regions);
    // `value.keys` maps the local name of a point (`a`, `center`, or '' for a projected point) to
    // its vertex in the source sketch
    const local = (point: Id): string => (point === id ? '' : point.slice(id.length + 1));
    return { ...geometry, keys: Object.fromEntries(Object.keys(geometry.points).map((point) => [point, JSON.stringify(['sketch', ref.sketch, value.keys?.[local(point)] ?? point])])) };
  },
};
function shapes(id: Id, value: PlugValue, regions: Id[]): EntryGeometry {
  {
    switch (value.kind) {
      case 'point':
        // a projected point is a point entity and no curve
        return { points: { [id]: at(value.at) }, curves: {}, radii: {}, regions: [] };
      case 'line':
        return { points: { [`${id}/a`]: at(value.a), [`${id}/b`]: at(value.b) }, curves: { [id]: { type: 'line', a: `${id}/a`, b: `${id}/b` } }, radii: {}, regions };
      case 'circle':
        return { points: { [`${id}/center`]: at(value.center) }, curves: { [id]: { type: 'circle', center: `${id}/center` } }, radii: { [id]: value.radius }, regions };
      case 'arc':
        return {
          points: { [`${id}/center`]: at(value.center), [`${id}/start`]: at(value.start), [`${id}/end`]: at(value.end) },
          curves: { [id]: { type: 'arc', center: `${id}/center`, start: `${id}/start`, end: `${id}/end` } },
          radii: {},
          regions,
        };
      default:
        return unreachable(value, 'projected value');
    }
  }
}

// ================================================================ c. the axes of the origin (6b)

// `origin/x` and `origin/y` are lines through `origin`; their far points are no entities. They are
// in the list of curves and the geometry of every sketch (a mirror, a revolve, a joint about an
// axis finds them), and in the input of the solver only when a constraint names one, so the stamp
// of every sketch of today stays.
export function axes(): EntryGeometry {
  const geometry: EntryGeometry = { points: {}, curves: {}, radii: {}, regions: [], hidden: [] };
  for (const [axis, far] of [['origin/x', { x: 1, y: 0 }], ['origin/y', { x: 0, y: 1 }]] as const) {
    geometry.points[`${axis}/b`] = far;
    geometry.curves[axis] = { type: 'line', a: 'origin', b: `${axis}/b` };
    geometry.hidden?.push(`${axis}/b`);
  }
  return geometry;
}
// What the solver gets of them: a resolved reference without a value under `origin`, only when
// a constraint of the sketch names an axis.
export const axesForSolver = (sketch: SketchFeature): Record<Id, ResolvedReference> =>
  Object.values(sketch.constraints).some((c) => Object.values(c).some((v) => v === 'origin/x' || v === 'origin/y')) ? { origin: { geometry: axes() } } : {};

// ================================================================ d. a kind of derived geometry (6c)

// A mirror of own curves about a line, computed after the solver. Its copies are
// `<entry>/1/<source>`; a copy forms regions as its source does; every copied point may join its
// source, which is what closes a half drawn up to the axis into one region with its image.
interface PlugMirrorRef {
  type: 'plugMirror';
  curves: Id[];
  axis: Id; // an own or reference line, or `origin/y`
}
const mirrorPoint = (p: Point2, a: Point2, b: Point2): Point2 => {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  return { x: 2 * (a.x + t * dx) - p.x, y: 2 * (a.y + t * dy) - p.y };
};
export const plugMirror: DerivedKindSpec<PlugMirrorRef> = {
  source: 'derived',
  title: 'Mirror of own curves',
  validate: (_context, _sketch, _id, entry) => entry as unknown as PlugMirrorRef,
  refs: () => [], // only entities of its own sketch
  faces: () => [],
  entities: (id, ref, sketch) => {
    const out: Record<Id, EntityKind> = {};
    for (const curve of ref.curves) {
      const shape = sketch.curves[curve];
      if (!shape) continue; // a source curve that was removed: the step reports it
      out[`${id}/1/${curve}`] = shape.type;
      for (const point of Object.entries(shape).filter(([key]) => key !== 'type' && key !== 'construction').map(([, value]) => value as Id)) out[`${id}/1/${point}`] = 'point';
    }
    return out;
  },
  // The axis is any line of the list: own, projected, or an axis of the origin.
  derive: (id, ref, { sketch, curves, geometry, joins: vertex }) => {
    const axis = curves.get(ref.axis)?.shape;
    if (axis?.type !== 'line') return { code: 'brokenReference', refs: [ref.axis] };
    const [a, b] = [geometry.points[axis.a], geometry.points[axis.b]];
    const out: EntryGeometry = { points: {}, curves: {}, radii: {}, regions: [], joins: [], keys: {} };
    const copy = (point: Id): Id => {
      const image = `${id}/1/${point}`;
      if (!out.points[image]) {
        out.points[image] = mirrorPoint(geometry.points[point], a, b);
        out.joins?.push([image, point]); // one point of the profile when it falls on its source
        if (out.keys) out.keys[image] = JSON.stringify(['mirror', id, 1, vertex(point)]); // images of joined points join
      }
      return image;
    };
    for (const curve of ref.curves) {
      const source = sketch.curves[curve];
      if (!source) return { code: 'brokenReference', refs: [curve] };
      const image = `${id}/1/${curve}`;
      let shape: CurveShape;
      switch (source.type) {
        case 'line':
          shape = { type: 'line', a: copy(source.a), b: copy(source.b) };
          break;
        case 'circle':
          shape = { type: 'circle', center: copy(source.center) };
          out.radii[image] = geometry.radii[curve];
          break;
        case 'arc':
          // a mirror turns the sense: the image runs counter-clockwise from the image of `end`
          shape = { type: 'arc', center: copy(source.center), start: copy(source.end), end: copy(source.start) };
          break;
        default:
          return unreachable(source, 'curve');
      }
      // a copy that occupies what its source occupies (a line on the axis) is left out; a half
      // circle with its centre and ends on the axis is the other half and stays
      if (liesOnSource(shape, source, out.points, geometry)) continue;
      out.curves[image] = shape;
      if (!source.construction) out.regions.push(image);
    }
    return out;
  },
};

// What a curve occupies, compared within the length tolerance: a line its segment, a circle its
// centre and radius, an arc also its sweep (6c writes it).
declare function liesOnSource(image: CurveShape, source: CurveShape, imagePoints: Record<Id, Point2>, geometry: SketchGeometryOf): boolean;
type SketchGeometryOf = { points: Record<Id, Point2>; radii: Record<Id, number> };

// The half of a lid drawn up to the Y axis and mirrored: the ends on the axis join their images,
// so the profile has one region whose outer loop holds both halves, and its side faces are named
// by the IDs of the curves, the images included: `{ feature: 'lid', role: 'side', curve: 'm/1/c2' }`
// (naming.md: a text field of a role holds any ID of a sketch).
export const LID_REGION: Id[] = ['c1', 'c2', 'c3', 'm/1/c1', 'm/1/c2', 'm/1/c3'].sort();

// ================================================================ e. an entry of several entities (6f)

// An imported outline: its entities are `<entry>/<local>` and are listed in the entry, so that
// a command naming one is validated from the sketch alone; all its curves form regions.
interface PlugOutlineRef {
  type: 'plugOutline';
  outline: Id; // a stored outline of the document (6f decides where it is)
  entities: Record<Id, EntityKind>; // the local IDs and kinds, copied from the stored outline
}
export const plugOutlineEntities = (id: Id, ref: PlugOutlineRef): Record<Id, EntityKind> => Object.fromEntries(Object.entries(ref.entities).map(([local, kind]) => [`${id}/${local}`, kind]));
export const plugOutlineRegions = (geometry: EntryGeometry): Id[] => Object.keys(geometry.curves);

// ================================================================ f. a curve kind the switches stop (6d)

// A switch of today with its `never` case compiles; the same switch over a union with one more
// kind does not, until it has its case. That is part 3: every such place decides.
type PlugSpline = { type: 'plugSpline'; poles: Id[] };
export function pointsOf(shape: CurveShape): Id[] {
  switch (shape.type) {
    case 'line':
      return [shape.a, shape.b];
    case 'circle':
      return [shape.center];
    case 'arc':
      return [shape.center, shape.start, shape.end];
    default:
      return unreachable(shape, 'curve');
  }
}
export function pointsOfWithSpline(shape: CurveShape | PlugSpline): Id[] {
  switch (shape.type) {
    case 'line':
      return [shape.a, shape.b];
    case 'circle':
      return [shape.center];
    case 'arc':
      return [shape.center, shape.start, shape.end];
    default:
      // @ts-expect-error the spline has no case
      return unreachable(shape, 'curve');
  }
}

// ================================================================ g. a tool of the app (6e)

// The tool Trim of 6e as a row of the table: one click on a curve (curves only, so a click near
// a crossing point still gives the curve), the batch of the engine's
// sketch tool run as it is (not through `drawn`: its curves are not drawn ones), and the piece
// the click would remove drawn while the pointer moves. 6e decides the engine side.
declare function trimBatch(context: unknown, at: PlaceStandIn): { ok: true; commands: unknown[]; piece: [number, number][] } | { ok: false; message: string };
export const plugTrim: SketchPlaceTool<undefined> = {
  label: 'Trim',
  picks: 'curve',
  eligible: (curve, context) => context.feature.curves[curve] !== undefined, // own curves only
  hint: 'Click the piece of a curve to remove, between its crossings with other curves.',
  click: (host, _m, places, context) => {
    const place = places[places.length - 1];
    if (place.snap?.kind !== 'curve') return host.say('Click a curve.', true);
    const made = trimBatch(context, place);
    if (!made.ok) return host.say(`Trim: ${made.message}`, true);
    host.run({ type: 'batch', commands: made.commands }, 'Trimmed.'); // keeps no place
  },
  draw: (_places, cursor, context) => {
    const made = cursor.snap?.kind === 'curve' ? trimBatch(context, cursor) : undefined;
    return made?.ok ? [made.piece] : [];
  },
};

// The registry is typed by the union of kinds: today one entry, the edge.
export const kindsOfToday: (keyof typeof REFERENCE_KINDS)[] = ['edge'];
// @ts-expect-error a kind that is not in the union has no entry
export const notAKind: (keyof typeof REFERENCE_KINDS)[] = ['plugSketch'];
