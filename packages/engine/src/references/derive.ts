// The stage after the solver (D68): the geometry of the derived entries of `external` (the copies of
// a mirror or a pattern), computed from the base of `sketchWorld` (world.ts), the sketch with its
// curves that are not derived and the positions after the solver. It is the inside of
// `sketchWorld`, which the sketch step and every sketch tool call, so the step and the tools have
// the same copies. docs/d36/6c-sketch-mirror-pattern/design.md, "The registry, split by source".
import { type SketchCurve, type SketchGeometry, curveEnds, joinsOf } from '../sketch';
import type { CurveShape, Id, OpenEnd, OpenEnds, Point2, SketchFeature } from '../types';
import { LENGTH_TOLERANCE, has, unreachable } from '../util';
import { kindOf } from './index';
import type { DerivedFailure, DerivedGeometry, EntryGeometry } from './spec';
import type { SketchBase } from './world';

// The order of the entries of a sketch: the keys of `external` as the document holds them, which is
// the order they were added in, except that JavaScript puts a key that is a whole number before
// every other key, in numeric order. A function of the document alone, so a save and a load keep
// it; the stage after the solver, the result's curves, the sketch tools and the lists of the app
// and of `get_sketch` read it.
export const entryOrder = (sketch: SketchFeature): Id[] => Object.keys(sketch.external);

const isFailure = (answer: EntryGeometry | DerivedFailure): answer is DerivedFailure => 'code' in answer;

// Every derived entry in the order of the entries, its `derive` over the base; then the occupation
// pass over all their copies, and the joins by position of the ends of every curve that is not own
// and forms regions, with the open ends. A failure of an entry is a warning of the sketch, with the
// geometry the entry could make.
export function deriveAll(base: SketchBase): DerivedGeometry {
  const entries: Record<Id, EntryGeometry> = {};
  const warnings: DerivedFailure[] = [];
  for (const id of entryOrder(base.sketch)) {
    const ref = base.sketch.external[id];
    const kind = kindOf(ref);
    if (kind.source !== 'derived') continue;
    const answer = kind.derive(id, ref, base);
    if (isFailure(answer)) {
      warnings.push(answer);
      if (answer.geometry) entries[id] = answer.geometry;
    } else entries[id] = answer;
  }
  if (Object.keys(entries).length === 0 && !base.curves.some((curve) => curve.source === 'reference' && curve.regions)) return { entries, joins: [], warnings };
  const points: Record<Id, Point2> = { ...base.geometry.points };
  const radii: Record<Id, number> = { ...base.geometry.radii };
  for (const geometry of Object.values(entries)) {
    Object.assign(points, geometry.points);
    Object.assign(radii, geometry.radii);
  }
  const geometry: SketchGeometry = { points, radii };
  occupation(entries, base, geometry);
  const curves: SketchCurve[] = [...base.curves];
  for (const entry of Object.values(entries)) for (const [id, shape] of Object.entries(entry.curves)) curves.push({ id, shape, source: 'derived', regions: entry.regions.includes(id) });
  const { joins, openEnds } = positionJoins(curves, geometry, base.pairs);
  return { entries, joins, warnings, ...(openEnds ? { openEnds } : {}) };
}

// ---------------------------------------------------------------- a grid of cells of the tolerance

// Places within the length tolerance of each other are in one cell or in two next to each other.
class Cells<T> {
  private readonly cells = new Map<string, T[]>();
  private key(x: number, y: number): string {
    return `${Math.floor(x / LENGTH_TOLERANCE)},${Math.floor(y / LENGTH_TOLERANCE)}`;
  }
  add(at: Point2, item: T): void {
    const key = this.key(at.x, at.y);
    const list = this.cells.get(key);
    if (list) list.push(item);
    else this.cells.set(key, [item]);
  }
  // what lies in the cell of `at` and in the eight around it
  near(at: Point2): T[] {
    const [cx, cy] = [Math.floor(at.x / LENGTH_TOLERANCE), Math.floor(at.y / LENGTH_TOLERANCE)];
    const out: T[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) out.push(...(this.cells.get(`${cx + dx},${cy + dy}`) ?? []));
    return out;
  }
}
const close = (p: Point2, q: Point2): boolean => Math.hypot(p.x - q.x, p.y - q.y) <= LENGTH_TOLERANCE;
const distance = (p: Point2, q: Point2): number => Math.hypot(p.x - q.x, p.y - q.y);

// ---------------------------------------------------------------- a copy that lies on its source

// The one place a curve is filed under: a line its middle, an arc its start, a circle its centre;
// two curves that occupy the same have it within the tolerance. Undefined without positions.
function placeOf(shape: CurveShape, points: Record<Id, Point2>): Point2 | undefined {
  switch (shape.type) {
    case 'line': {
      const [a, b] = [points[shape.a], points[shape.b]];
      return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : undefined;
    }
    case 'arc':
      return points[shape.start];
    case 'circle':
      return points[shape.center];
    default:
      return unreachable(shape, 'curve');
  }
}

// Whether two curves occupy the same, within the length tolerance: a line its segment (either way),
// a circle its centre and radius, an arc its centre and its two ends in order (both run
// counter-clockwise).
export function occupies(a: SketchCurve, b: SketchCurve, geometry: SketchGeometry): boolean {
  const at = (id: Id): Point2 | undefined => (has(geometry.points, id) ? geometry.points[id] : undefined);
  const same = (p: Id, q: Id): boolean => {
    const [x, y] = [at(p), at(q)];
    return x !== undefined && y !== undefined && close(x, y);
  };
  const [sa, sb] = [a.shape, b.shape];
  switch (sa.type) {
    case 'line':
      return sb.type === 'line' && ((same(sa.a, sb.a) && same(sa.b, sb.b)) || (same(sa.a, sb.b) && same(sa.b, sb.a)));
    case 'circle':
      return sb.type === 'circle' && same(sa.center, sb.center) && has(geometry.radii, a.id) && has(geometry.radii, b.id) && Math.abs(geometry.radii[a.id] - geometry.radii[b.id]) <= LENGTH_TOLERANCE;
    case 'arc':
      return sb.type === 'arc' && same(sa.center, sb.center) && same(sa.start, sb.start) && same(sa.end, sb.end);
    default:
      return unreachable(sa, 'curve');
  }
}

// The occupation pass: a copy that occupies what a curve before it that forms regions occupies
// (an own curve that is not construction, a reference curve with `regions`, an earlier copy that
// kept them; in the order of the entries and within an entry by copy number) forms no regions; it
// stays under its ID. Construction curves, projected edges and the axes bound nothing and do not
// count. Changes `regions` of the entries in place; answers the copies it took them from.
export function occupation(entries: Record<Id, EntryGeometry>, base: SketchBase, geometry: SketchGeometry): Set<Id> {
  const cells = new Cells<SketchCurve>();
  const file = (curve: SketchCurve): void => {
    const at = placeOf(curve.shape, geometry.points);
    if (at) cells.add(at, curve);
  };
  for (const curve of base.curves) if (curve.regions) file(curve);
  const demoted = new Set<Id>();
  for (const entry of Object.values(entries)) {
    const kept = new Set(entry.regions);
    for (const [id, shape] of Object.entries(entry.curves)) {
      if (!kept.has(id)) continue;
      const curve: SketchCurve = { id, shape, source: 'derived', regions: true };
      const at = placeOf(shape, geometry.points);
      if (at && cells.near(at).some((other) => occupies(curve, other, geometry))) {
        kept.delete(id);
        demoted.add(id);
      } else file(curve);
    }
    if (kept.size !== entry.regions.length) entry.regions = entry.regions.filter((id) => kept.has(id));
  }
  return demoted;
}

// ---------------------------------------------------------------- joins by position

interface End {
  point: Id;
  curve: Id;
  at: Point2;
}
const MAX_OPEN_ENDS = 20;

// The joins by position (owner, answers 12 and 19 of D36 step 6):
// 1. only ends of curves join by position (`curveEnds`): a point alone and a centre are no vertex;
// 2. the ends of the curves that are not own and form regions (copies that kept their regions,
//    flagged reference curves) are paired when they are within the length tolerance, each pair as
//    found; those pairs, transitively, form groups;
// 3. a group is paired with the ends of the own curves that form regions within the tolerance of
//    one of its members, each pair from the member it is near, when those ends are one vertex by the
//    joins before the stage (`pairs`), and with none of them otherwise. Ends of curves that form no
//    regions neither join nor prevent a join.
// So two own points that are two vertices stay two, and a profile changes only where the ends of
// curves that are not own are. Also the open ends: an end of a curve that is not own and forms
// regions which, after every join, is the end of no other curve that forms regions.
export function positionJoins(curves: readonly SketchCurve[], geometry: SketchGeometry, pairs: readonly [Id, Id][]): { joins: [Id, Id][]; openEnds?: OpenEnds } {
  const before = joinsOf(pairs, geometry);
  const endsOf = (curve: SketchCurve): End[] =>
    (curveEnds(curve.shape) ?? []).flatMap((point) => (has(geometry.points, point) ? [{ point, curve: curve.id, at: geometry.points[point] }] : []));
  const free: End[] = curves.filter((curve) => curve.source !== 'own' && curve.regions).flatMap(endsOf);
  if (free.length === 0) return { joins: [] };
  const own: End[] = curves.filter((curve) => curve.source === 'own' && curve.regions).flatMap(endsOf);
  const joins: [Id, Id][] = [];
  // rule 2: the free ends with each other, through the grid; groups by a union of point IDs
  const parent = new Map<Id, Id>(free.map((end) => [end.point, end.point]));
  const find = (id: Id): Id => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as Id;
    return root;
  };
  const freeCells = new Cells<End>();
  for (const end of free) {
    for (const other of freeCells.near(end.at)) {
      if (other.point === end.point || !close(other.at, end.at)) continue;
      joins.push([other.point, end.point]);
      const [ra, rb] = [find(other.point), find(end.point)];
      if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
    }
    freeCells.add(end.at, end);
  }
  // rule 3: each group with the own ends at its place, when those are one vertex
  const ownCells = new Cells<End>();
  for (const end of own) ownCells.add(end.at, end);
  const groups = new Map<Id, End[]>();
  for (const end of free) {
    const root = find(end.point);
    const list = groups.get(root);
    if (list) list.push(end);
    else groups.set(root, [end]);
  }
  const refused = new Map<Id, Id[]>(); // a group's root → the own ends that are two vertices or more
  for (const [root, members] of groups) {
    const found: [Id, Id][] = []; // [member, own end]
    for (const member of members) for (const other of ownCells.near(member.at)) if (close(other.at, member.at) && !found.some(([m, o]) => m === member.point && o === other.point)) found.push([member.point, other.point]);
    if (found.length === 0) continue;
    if (new Set(found.map(([, o]) => before(o))).size === 1) joins.push(...found);
    else refused.set(root, [...new Set(found.map(([, o]) => o))].sort());
  }
  // the open ends, after every join
  const after = joinsOf([...pairs, ...joins], geometry);
  const regionEnds = [...own, ...free];
  const atVertex = new Map<Id, Set<Id>>();
  for (const end of regionEnds) {
    const vertex = after(end.point);
    const set = atVertex.get(vertex);
    if (set) set.add(end.curve);
    else atVertex.set(vertex, new Set([end.curve]));
  }
  const open: OpenEnd[] = [];
  for (const end of free) {
    const at = atVertex.get(after(end.point)) as Set<Id>;
    if ([...at].some((curve) => curve !== end.curve)) continue;
    const vertices = refused.get(find(end.point));
    if (vertices) {
      const nearest = Math.min(...vertices.map((v) => distance(geometry.points[v], end.at)));
      open.push({ end: end.point, reason: 'twoVertices', near: vertices, distance: nearest });
      continue;
    }
    let best: End | undefined;
    for (const other of regionEnds) if (other.curve !== end.curve && (!best || distance(other.at, end.at) < distance(best.at, end.at))) best = other;
    open.push({ end: end.point, reason: 'apart', near: best ? [best.point] : [], distance: best ? distance(best.at, end.at) : 0 });
  }
  if (open.length === 0) return { joins };
  // a point that two copied curves share is one end: listed once
  const unique = [...new Map(open.map((end) => [end.end, end])).values()];
  unique.sort((p, q) => (p.reason === q.reason ? 0 : p.reason === 'twoVertices' ? -1 : 1) || p.distance - q.distance || (p.end < q.end ? -1 : p.end > q.end ? 1 : 0));
  return { joins, openEnds: { count: unique.length, ends: unique.slice(0, MAX_OPEN_ENDS) } };
}
