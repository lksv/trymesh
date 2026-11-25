// The world of a sketch (D65): the curves, the positions and the joins every profile of a sketch is
// built from, by one core for the sketch step and for every sketch tool, so that the profile a tool
// sees is the profile the recompute makes (docs/d36/6e-trim-extend-split/design.md, "One world of
// a sketch").
// - `SketchBase` is the sketch before the stage after the solver: the curves that are not derived
//   (the own ones and the reference ones, with the axes of the origin), the positions, and the
//   joins before that stage as pairs of points (the `coincident` constraints, and for a tool what
//   its batch joins).
// - `sketchWorld` is the core: the curves of the base with the copies of the derived entries made
//   from it (`deriveAll` of derive.ts, the stage after the solver, D68), the positions with theirs,
//   and the joins of the pairs of the base with those of the joins by position. `derived` is what
//   the stage made, which the sketch step writes into its result.
// - `stepBase` builds the base of the sketch step, `toolBase` that of a tool, which has only the
//   sketch and its result.
// - `cutInMemory` cuts curves of a world at their contacts with each other, in memory alone: the
//   faces of a cut sketch and a region as it was are built so (sketch-cut.ts).
import { type CurveEnd, type SketchCurve, type SketchGeometry, curveContacts, joinPairs, joinsOf, placedCurve, sketchCurves, solvedCurves } from '../sketch';
import type { CurveShape, Id, Point2, SketchFeature, SketchResult, Vec2 } from '../types';
import { LENGTH_TOLERANCE, dist2, has, unreachable } from '../util';
import { deriveAll } from './derive';
import type { DerivedGeometry, ResolvedReference } from './spec';

export interface SketchBase {
  sketch: SketchFeature; // read for its entries of `external` only (6c computes the copies from them)
  curves: readonly SketchCurve[];
  geometry: SketchGeometry;
  pairs: readonly [Id, Id][];
}
// `pairs`: the joins the world was made of, for a reader that adds to them (a cut in memory).
// `derived`: the copies of the derived entries, the joins by position, the warnings and the open
// ends (a world made by `cutInMemory` keeps that of the world it cut).
export interface SketchWorld {
  curves: ReadonlyMap<Id, SketchCurve>;
  geometry: SketchGeometry;
  joins(id: Id): Id;
  pairs: readonly [Id, Id][];
  derived: DerivedGeometry;
}

export function sketchWorld(base: SketchBase): SketchWorld {
  const derived = deriveAll(base);
  const curves = new Map(base.curves.map((curve) => [curve.id, curve]));
  const points = { ...base.geometry.points };
  const radii = { ...base.geometry.radii };
  for (const geometry of Object.values(derived.entries)) {
    Object.assign(points, geometry.points);
    Object.assign(radii, geometry.radii);
    for (const [id, shape] of Object.entries(geometry.curves)) curves.set(id, { id, shape, source: 'derived', regions: geometry.regions.includes(id) });
  }
  const geometry: SketchGeometry = Object.keys(derived.entries).length ? { points, radii } : base.geometry;
  const pairs = derived.joins.length ? [...base.pairs, ...derived.joins] : base.pairs;
  return { curves, geometry, joins: joinsOf(pairs, geometry), pairs, derived };
}

// The base of the sketch step: the curves of the sketch with those of its resolved entries and the
// axes of the origin (`sketchCurves`), the positions after the solver, the coincident pairs.
export function stepBase(feature: SketchFeature, references: Record<Id, ResolvedReference>, geometry: SketchGeometry): SketchBase {
  return { sketch: feature, curves: sketchCurves(feature, references), geometry, pairs: joinPairs(feature, references) };
}

// The base of a tool: the own curves of `sketch` (the sketch after a batch, or one that exists in
// memory alone), the curves of the result that are reference geometry (the derived ones are made
// again by the core), the axes of the origin (`solvedCurves`); the positions of the result with
// `more.points` and `more.radii` over them; the coincident pairs of `sketch` with `more.pairs`.
export function toolBase(sketch: SketchFeature, result: SketchResult, more?: { points?: Record<Id, Point2>; radii?: Record<Id, number>; pairs?: readonly [Id, Id][] }): SketchBase {
  const solved = solvedCurves(sketch, result);
  const curves = [...solved.curves.values()].filter((curve) => curve.source === 'own' || curve.source === 'reference');
  const geometry: SketchGeometry = { points: { ...solved.geometry.points, ...more?.points }, radii: { ...solved.geometry.radii, ...more?.radii } };
  return { sketch, curves, geometry, pairs: [...joinPairs(sketch, {}), ...(more?.pairs ?? [])] };
}

// ---------------------------------------------------------------- cuts in memory

const TAU = 2 * Math.PI;
const positive = (angle: number): number => ((angle % TAU) + TAU) % TAU;
const xy = (p: Point2): Vec2 => [p.x, p.y];

// The ends of a shape (a line `a`, `b`; an arc `start`, `end`; none for a circle).
function endIds(shape: CurveShape): Id[] {
  switch (shape.type) {
    case 'line':
      return [shape.a, shape.b];
    case 'arc':
      return [shape.start, shape.end];
    case 'circle':
      return [];
    default:
      return unreachable(shape, 'curve');
  }
}

// Cuts `ids` of the world at their contacts with each other, in memory: a crossing, a touch, an end
// on a curve, an end of an overlap. A circle with one such point is cut there and at the point
// opposite (harmless where nothing is solved); of two curves lying on each other the later by ID is
// left out; two ends at one place among them are joined. The pieces are curves `<id>\u0000<n>` over
// the points of the world and points `\u0000cut<n>` of their own; the other curves of the world stay.
export function cutInMemory(world: SketchWorld, ids: readonly Id[]): SketchWorld {
  const points: Record<Id, Point2> = { ...world.geometry.points };
  const geometry: SketchGeometry = { points, radii: world.geometry.radii };
  const list = [...new Set(ids)].filter((id) => world.curves.has(id)).sort();
  const left = new Set<Id>();
  // the joins of the world seeded point by point, so that a join the core makes without a pair
  // (6c's joins by position) is kept in memory as well
  const pairs: [Id, Id][] = [...world.pairs];
  for (const p of Object.keys(world.geometry.points)) if (world.joins(p) !== p) pairs.push([p, world.joins(p)]);
  const nodes = new Map<Id, { point: Id; at: Vec2 }[]>(list.map((id) => [id, []]));
  const places: { at: Vec2; point: Id }[] = [];
  let counter = 0;
  const position = (id: Id): Vec2 | undefined => (has(points, world.joins(id)) ? xy(points[world.joins(id)]) : undefined);
  const endsAt = (id: Id): { point: Id; at: Vec2 }[] =>
    endIds((world.curves.get(id) as SketchCurve).shape).flatMap((p) => {
      const at = position(p);
      return at ? [{ point: world.joins(p), at }] : [];
    });
  // one point per place: an end of one of the two curves there, else a new one
  const pointAt = (at: Vec2, a: Id, b: Id): Id => {
    const known = places.find((place) => dist2(place.at, at) <= LENGTH_TOLERANCE);
    if (known) return known.point;
    const end = [...endsAt(a), ...endsAt(b)].find((e) => dist2(e.at, at) <= LENGTH_TOLERANCE);
    const point = end?.point ?? `\u0000cut${++counter}`;
    if (!end) points[point] = { x: at[0], y: at[1] };
    places.push({ at, point });
    return point;
  };
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [a, b] = [list[i], list[j]];
      if (left.has(a) || left.has(b)) continue;
      const found = curveContacts(world.curves.get(a) as SketchCurve, world.curves.get(b) as SketchCurve, world.joins, world.geometry);
      if (!found) continue;
      if (found.lying && found.points.length === 0) {
        left.add(b);
        continue;
      }
      if (found.lying) left.add(b);
      const [ea, eb] = [endIds((world.curves.get(a) as SketchCurve).shape), endIds((world.curves.get(b) as SketchCurve).shape)];
      for (const [x, y] of found.ends) pairs.push([ea[x], eb[y]]);
      if (found.lying) continue;
      for (const contact of found.points) {
        const point = pointAt(contact.at, a, b);
        for (const id of [a, b]) {
          const mine = nodes.get(id) as { point: Id; at: Vec2 }[];
          // a place where three or more curves meet is one point of each curve, once
          if (!endsAt(id).some((e) => dist2(e.at, contact.at) <= LENGTH_TOLERANCE) && !mine.some((n) => n.point === point)) mine.push({ point, at: contact.at });
        }
      }
    }
  }
  const curves = new Map(world.curves);
  for (const id of list) {
    const curve = world.curves.get(id) as SketchCurve;
    curves.delete(id);
    if (left.has(id)) continue;
    const mine = nodes.get(id) as { point: Id; at: Vec2 }[];
    const placed = placedCurve(
      curve,
      geometry.radii,
      (p): CurveEnd | undefined => {
        const at = position(p);
        return at ? { key: world.joins(p), p: at } : undefined;
      },
      (p) => (has(points, p) ? xy(points[p]) : undefined),
    );
    if (!placed || mine.length === 0) {
      curves.set(id, curve);
      continue;
    }
    const piece = (n: number, shape: CurveShape): void => void curves.set(`${id}\u0000${n}`, { ...curve, id: `${id}\u0000${n}`, shape });
    switch (placed.type) {
      case 'line': {
        const d: Vec2 = [placed.b.p[0] - placed.a.p[0], placed.b.p[1] - placed.a.p[1]];
        const along = (p: Vec2): number => (p[0] - placed.a.p[0]) * d[0] + (p[1] - placed.a.p[1]) * d[1];
        const chain = [placed.a.key, ...[...mine].sort((p, q) => along(p.at) - along(q.at)).map((n) => n.point), placed.b.key];
        for (let k = 0; k + 1 < chain.length; k++) piece(k, { type: 'line', a: chain[k], b: chain[k + 1] });
        break;
      }
      case 'arc': {
        const shape = curve.shape as Extract<CurveShape, { type: 'arc' }>;
        const angle = (p: Vec2): number => positive(Math.atan2(p[1] - placed.center[1], p[0] - placed.center[0]) - placed.start);
        const chain = [placed.a.key, ...[...mine].sort((p, q) => angle(p.at) - angle(q.at)).map((n) => n.point), placed.b.key];
        for (let k = 0; k + 1 < chain.length; k++) piece(k, { type: 'arc', center: shape.center, start: chain[k], end: chain[k + 1] });
        break;
      }
      case 'circle': {
        const shape = curve.shape as Extract<CurveShape, { type: 'circle' }>;
        const angle = (p: Vec2): number => positive(Math.atan2(p[1] - placed.center[1], p[0] - placed.center[0]));
        const sorted = [...mine].sort((p, q) => angle(p.at) - angle(q.at));
        if (sorted.length === 1) {
          // one point: cut there and at the point opposite
          const t = angle(sorted[0].at) + Math.PI;
          const opposite = `\u0000cut${++counter}`;
          points[opposite] = { x: placed.center[0] + placed.radius * Math.cos(t), y: placed.center[1] + placed.radius * Math.sin(t) };
          sorted.push({ point: opposite, at: xy(points[opposite]) });
        }
        sorted.forEach((n, k) => piece(k, { type: 'arc', center: shape.center, start: n.point, end: sorted[(k + 1) % sorted.length].point }));
        break;
      }
      default:
        unreachable(placed, 'curve');
    }
  }
  return { curves, geometry, joins: joinsOf(pairs, geometry), pairs, derived: world.derived };
}
