// Trim, extend and split (D65): sketch curves cut at the points where other curves meet them, as
// batches of commands every build knows (addPoint, addCurve, setCurvePoint, removeEntity,
// addConstraint, removeConstraint, updateFeature). The design is docs/d36/6e-trim-extend-split/
// design.md; the rules are in docs/architecture/sketch.md, "Sketch tools".
//
// The work goes in three stages:
// 1. The contacts (`curveContacts` of sketch.ts) become events: a place, the curves cut there and
//    the curves the point is held on. The points of a circle are pooled over the batch; a circle
//    with one point is not cut. Each place gets one point, used or made.
// 2. A model of the sketch after the batch: the curves cut into pieces (the keeper keeps the ID),
//    the constraints moved to where they belong, the holds, the ends cut off, the joins. The batch
//    is the difference between the sketch and the model, in a fixed order.
// 3. The features over the sketch: their regions followed by the faces of the cut sketch (the face
//    rule) and their walls patched, and the lists of what reads a changed curve.
//
// The table of the feature types that read a profile (`PROFILE_SOURCES`) and the helpers of face
// names live here, so that the fillet (sketch-tools.ts) and the cuts read one table.
import { MAX_NUMBER } from './catalog';
import { applyCommand } from './document';
import { evaluateNumber } from './expression';
import { inside } from './recompute/outline';
import { kindOf } from './references/index';
import { DOCUMENT_SECTIONS, namedBySections } from './sections/index';
import { type Profile, type Region, type ShapeContacts, type SketchCurve, type SketchGeometry, curveContacts, curvesTouch, joinsOf, profileOf, sameRegion } from './sketch';
import { constraintKey, constraintOperands, constraintPath, curvePoints, isDimension, isDriving } from './sketch-content';
import type { NewId, SketchToolCall, SketchToolContext, SketchToolResult } from './sketch-tools';
import type { Command, Constraint, Curve, CurvePointName, Document, Expr, FaceName, Feature, FeaturePatch, Id, ParameterResult, PlaneRef, Point2, ProfileSource, RegionRef, SketchFeature, Vec2 } from './types';
import { LENGTH_TOLERANCE, ORIGIN, dist2, has, unreachable } from './util';

// ---------------------------------------------------------------- what reads a profile (D52)

// Which features read a profile from a sketch, by feature type: a feature type added later does
// not compile until it says whether it has a profile source (the fillet and the cuts patch its
// regions and walls).
const PROFILE_SOURCES: { [T in Feature['type']]: (feature: Extract<Feature, { type: T }>) => ProfileSource | undefined } = {
  plane: () => undefined,
  sketch: () => undefined,
  extrude: (feature) => feature.profile,
  pattern: () => undefined,
  mesh: () => undefined,
  hole: () => undefined,
  combine: () => undefined,
  split: () => undefined,
  revolve: (feature) => feature.profile,
  chamfer: () => undefined,
  fillet: () => undefined,
  insert: () => undefined,
};
export const profileSourceOf = (feature: Feature): ProfileSource | undefined => (PROFILE_SOURCES[feature.type] as (f: Feature) => ProfileSource | undefined)(feature);

// The side faces of a line and of a wall along it are named by the curve.
export const sideOf = (face: FaceName, curves: readonly Id[]): boolean => (face.role === 'side' || face.role === 'wallSide') && curves.includes(face.curve);
export const planeOn = (plane: PlaneRef, curves: readonly Id[]): boolean => plane.kind === 'face' && sideOf(plane.face, curves);

// Every face name in a value (a feature, a section entry): every object with a `feature` and
// a `role`, at any depth (planes, projected edges, extents up to a face, edges of chamfers).
function facesIn(value: unknown, into: FaceName[] = []): FaceName[] {
  if (Array.isArray(value)) for (const item of value) facesIn(item, into);
  else if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>;
    if (typeof o.feature === 'string' && typeof o.role === 'string') into.push(o as unknown as FaceName);
    for (const item of Object.values(o)) facesIn(item, into);
  }
  return into;
}
// Every axis on a line of a sketch in a value (`sketchLine` of AxisRef), at any depth.
function sketchLinesIn(value: unknown, sketch: Id, into: Id[] = []): Id[] {
  if (Array.isArray(value)) for (const item of value) sketchLinesIn(item, sketch, into);
  else if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>;
    if (o.kind === 'sketchLine' && o.sketch === sketch && typeof o.line === 'string') into.push(o.line);
    for (const item of Object.values(o)) sketchLinesIn(item, sketch, into);
  }
  return into;
}
// Every text in a value.
function textsIn(value: unknown, into: Set<string>): Set<string> {
  if (typeof value === 'string') into.add(value);
  else if (Array.isArray(value)) for (const item of value) textsIn(item, into);
  else if (typeof value === 'object' && value !== null) for (const item of Object.values(value)) textsIn(item, into);
  return into;
}

// ---------------------------------------------------------------- the inputs

export interface TrimInput {
  curve: Id;
  at: Vec2;
  with?: Id;
}
export interface ExtendInput {
  curve: Id;
  end: Exclude<CurvePointName, 'center'>;
  with?: Id;
}
export interface SplitInput {
  curve?: Id;
  with?: Id;
  at?: Vec2;
}
export type CutRequest = ({ tool: 'trim' } & TrimInput) | ({ tool: 'extend' } & ExtendInput) | ({ tool: 'split' } & SplitInput);

// The lists every cut returns (the `ids` of the three tools), each always there.
export const CUT_IDS = {
  changed: 'curves that keep their ID and were changed: re-pointed, cut into pieces, or a circle that became an arc (the keeper of each cut curve), in the order of their IDs',
  added: 'new curves: for each changed curve in the order of `changed`, its new pieces in its own direction (a line from `a` to `b`, an arc counter-clockwise); span lines are in `span`, not here',
  span: 'construction lines over the old ends of a line that was cut or re-pointed and carried equalLength or midpoint; those constraints were moved onto them; in the order of `changed`',
  points: 'the points at the cuts, new or already there, each once, at its first place in the order of `changed`, each curve in its own direction (extend: the new end last)',
  constraints: 'the constraints the tool added, in the order of the batch: a piece held on the line of its curve, an old end held on the line or circle of its curve, a cut point held on a curve that is not cut there, equalRadius of arcs of one circle that share no end, coincident of two ends at one place',
  reattached: 'constraints that keep their ID and now name another curve, in the order of their IDs: a tangency moved to the piece that has the common end, constraints moved to a sibling piece or to a span line, the constraints of a circle that became an arc',
  removed: 'curves, points and constraints the batch removes for good, in that order and each by ID: the trimmed piece when it was a whole curve, cut-off ends nothing else names, constraints that went with them, became identities, would repeat one the sketch has (a driving constraint of the same kind and operands; the one there stays, unless only the moved one has an expression, which then stays instead) or would name one curve twice',
  uncut: 'curves left whole although something touches them: a circle touched at one point only, a circle a generated profile names as an operand (the profile stays invalid there), in the order of their IDs',
  patched: 'features whose regions or wall the batch changed (updateFeature in the same batch), in the order of the timeline',
  dropped:
    'features of which a region is gone: no region after the batch holds any of it (its outline was opened), or a region left with no curve by the rewrite of `pending`; dropped from the feature when it has other regions (the feature is then also in `patched`), else left and the feature ends in noProfile. Also features with a region that could not be rebuilt as it was, or whose faces could not be built while the sketch after the batch is valid: that region is left in their list as it is. In the order of the timeline',
  pending:
    'features whose regions name a changed curve while the sketch still has crossings after the batch (one the tools do not cut, or one that split with `with` or `at` was not asked to cut): their regions were rewritten by names (each changed curve replaced by its pieces; the feature is also in `patched`) and are followed by the next tool that leaves the sketch valid; in the order of the timeline',
  moved: 'sketches and plane features on a side face of a line whose start `a` was re-pointed: their plane moved along the line; in the order of the timeline',
  shortened: 'features that read a face of a changed curve directly and are not in `moved`: walls along a curve that lost a piece (also in `patched`), sketches that project an edge of such a face, chamfers and fillets of such an edge; in the order of the timeline',
  broken: 'features and sections that name what the batch removes or renames: a removed curve or a face of it, an axis on it (also of a joint), a wall left with no curve, the straight end of a wall (wallEnd) whose chain no longer ends at that point; features in the order of the timeline, then the IDs of section entries',
} as const;
export type CutIds = { [K in keyof typeof CUT_IDS]: Id[] };

// ---------------------------------------------------------------- the sketch as the tools read it

const TAU = 2 * Math.PI;
const positive = (angle: number): number => ((angle % TAU) + TAU) % TAU;
const tol = LENGTH_TOLERANCE;

// The carrier of a curve with its parameter: a line from `a` (0) to `b` (1), beyond both; an arc by
// the angle from its start counter-clockwise; a circle by the angle from the x axis, in [0, 2π).
type Carrier = { type: 'line'; a: Vec2; b: Vec2 } | { type: 'arc'; c: Vec2; r: number; from: number; sweep: number } | { type: 'circle'; c: Vec2; r: number };

function paramOf(carrier: Carrier, p: Vec2): number {
  switch (carrier.type) {
    case 'line': {
      const [dx, dy] = [carrier.b[0] - carrier.a[0], carrier.b[1] - carrier.a[1]];
      return ((p[0] - carrier.a[0]) * dx + (p[1] - carrier.a[1]) * dy) / (dx * dx + dy * dy);
    }
    case 'arc':
      return positive(Math.atan2(p[1] - carrier.c[1], p[0] - carrier.c[0]) - carrier.from);
    case 'circle':
      return positive(Math.atan2(p[1] - carrier.c[1], p[0] - carrier.c[0]));
    default:
      return unreachable(carrier, 'carrier');
  }
}
function pointOn(carrier: Carrier, t: number): Vec2 {
  switch (carrier.type) {
    case 'line':
      return [carrier.a[0] + t * (carrier.b[0] - carrier.a[0]), carrier.a[1] + t * (carrier.b[1] - carrier.a[1])];
    case 'arc':
      return [carrier.c[0] + carrier.r * Math.cos(carrier.from + t), carrier.c[1] + carrier.r * Math.sin(carrier.from + t)];
    case 'circle':
      return [carrier.c[0] + carrier.r * Math.cos(t), carrier.c[1] + carrier.r * Math.sin(t)];
    default:
      return unreachable(carrier, 'carrier');
  }
}
// The length of the carrier between two parameters (an arc or a circle by its radius).
const lengthOf = (carrier: Carrier, from: number, to: number): number => Math.abs(to - from) * (carrier.type === 'line' ? dist2(carrier.a, carrier.b) : carrier.r);

// The piece of a curve as the app draws it.
export type PieceShape = { type: 'line'; a: Vec2; b: Vec2 } | { type: 'arc'; center: Vec2; radius: number; from: number; sweep: number } | { type: 'circle'; center: Vec2; radius: number };
function pieceShape(carrier: Carrier, from: number, to: number): PieceShape {
  switch (carrier.type) {
    case 'line':
      return { type: 'line', a: pointOn(carrier, from), b: pointOn(carrier, to) };
    case 'arc':
      return { type: 'arc', center: carrier.c, radius: carrier.r, from: carrier.from + from, sweep: to - from };
    case 'circle':
      return to - from >= TAU - 1e-12 ? { type: 'circle', center: carrier.c, radius: carrier.r } : { type: 'arc', center: carrier.c, radius: carrier.r, from, sweep: to - from };
    default:
      return unreachable(carrier, 'carrier');
  }
}

// The sketch, its positions and its curves (own first, then those of the result that are not own).
interface World {
  doc: Document;
  sketch: SketchFeature;
  geometry: SketchGeometry;
  curves: Map<Id, SketchCurve>;
  joins: (id: Id) => Id;
  generated: Set<Id>; // circles a generated profile names as an operand
  parameters?: Record<Id, ParameterResult>;
  contacts(a: Id, b: Id): ShapeContacts;
}

const xy = (p: Point2): Vec2 => [p.x, p.y];

function worldOf(doc: Document, sketch: SketchFeature, geometry: SketchGeometry, others: SketchCurve[]): World {
  const curves = new Map<Id, SketchCurve>();
  for (const [id, c] of Object.entries(sketch.curves)) {
    const { construction, ...shape } = c;
    curves.set(id, { id, shape: shape as SketchCurve['shape'], source: 'own', regions: construction !== true });
  }
  for (const curve of others) if (!curves.has(curve.id)) curves.set(curve.id, curve);
  const pairs = Object.values(sketch.constraints).flatMap((c): [Id, Id][] => (c.type === 'coincident' ? [[c.a, c.b]] : []));
  const joins = joinsOf(pairs, geometry);
  const generated = new Set<Id>();
  for (const feature of doc.features) {
    const source = profileSourceOf(feature);
    if (source?.type === 'generated' && source.sketch === sketch.id) for (const operand of Object.values(source.operands)) generated.add(operand);
  }
  const cache = new Map<string, ShapeContacts>();
  const none: ShapeContacts = { points: [], ends: [], lying: false };
  // a box around each curve, so that pairs far apart are not tested (a sketch of many curves)
  const boxes = new Map<Id, [number, number, number, number] | undefined>();
  const boxOf = (id: Id): [number, number, number, number] | undefined => {
    if (boxes.has(id)) return boxes.get(id);
    const curve = curves.get(id);
    let box: [number, number, number, number] | undefined;
    if (curve) {
      const shape = curve.shape;
      const at = (p: Id): Point2 | undefined => (has(geometry.points, p) ? geometry.points[p] : undefined);
      if (shape.type === 'line') {
        const [a, b] = [at(shape.a), at(shape.b)];
        if (a && b) box = [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
      } else {
        const c = at(shape.center);
        const r = shape.type === 'circle' ? geometry.radii[id] : (() => {
          const s = at(shape.start);
          return c && s ? Math.hypot(s.x - c.x, s.y - c.y) : undefined;
        })();
        if (c && r !== undefined) box = [c.x - r, c.y - r, c.x + r, c.y + r];
      }
    }
    boxes.set(id, box);
    return box;
  };
  const apart = (a: Id, b: Id): boolean => {
    const [p, q] = [boxOf(a), boxOf(b)];
    const margin = 10 * LENGTH_TOLERANCE;
    return p !== undefined && q !== undefined && (p[2] + margin < q[0] || q[2] + margin < p[0] || p[3] + margin < q[1] || q[3] + margin < p[1]);
  };
  return {
    doc,
    sketch,
    geometry,
    curves,
    joins,
    generated,
    contacts(a, b) {
      const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
      let found = cache.get(key);
      if (!found) {
        const [ca, cb] = [curves.get(a), curves.get(b)];
        const raw = ca && cb && !apart(a, b) ? curveContacts(ca, cb, joins, geometry) : undefined;
        // the ends are given as those of the first curve asked, then of the second
        found = raw ?? none;
        cache.set(key, a < b ? found : { ...found, ends: found.ends.map(([i, j]): [number, number] => [j, i]) });
      }
      return a < b ? found : { ...found, ends: found.ends.map(([i, j]): [number, number] => [j, i]) };
    },
  };
}

function worldOfContext(context: SketchToolCall): World | string {
  const { sketch, result, document } = context;
  if (!result) return `the sketch "${sketch.id}" has no solved state`;
  const others: SketchCurve[] = Object.entries(result.curves).map(([id, c]) => ({ id, shape: c.shape, source: c.source, regions: c.regions }));
  return { ...worldOf(document, sketch, { points: result.points, radii: result.radii }, others), parameters: context.parameters };
}

const isOwn = (world: World, id: Id): boolean => has(world.sketch.curves, id);
const isProfile = (world: World, id: Id): boolean => isOwn(world, id) && world.sketch.curves[id].construction !== true;
const position = (world: World, id: Id): Vec2 | undefined => (has(world.geometry.points, id) ? xy(world.geometry.points[id]) : undefined);

function carrierOf(world: World, id: Id): Carrier | undefined {
  const curve = world.curves.get(id);
  if (!curve) return undefined;
  const shape = curve.shape;
  switch (shape.type) {
    case 'line': {
      const [a, b] = [position(world, shape.a), position(world, shape.b)];
      return a && b && dist2(a, b) > tol ? { type: 'line', a, b } : undefined;
    }
    case 'circle': {
      const c = position(world, shape.center);
      const r = has(world.geometry.radii, id) ? world.geometry.radii[id] : undefined;
      return c && r !== undefined && r > tol ? { type: 'circle', c, r } : undefined;
    }
    case 'arc': {
      const [c, s, e] = [position(world, shape.center), position(world, shape.start), position(world, shape.end)];
      if (!c || !s || !e) return undefined;
      const from = Math.atan2(s[1] - c[1], s[0] - c[0]);
      const sweep = positive(Math.atan2(e[1] - c[1], e[0] - c[0]) - from) || TAU;
      const r = dist2(c, s);
      return r > tol && dist2(s, e) > tol ? { type: 'arc', c, r, from, sweep } : undefined;
    }
    default:
      return unreachable(shape, 'curve');
  }
}

// The points at the ends of a curve (a line `a`, `b`; an arc `start`, `end`; none for a circle).
function endsOf(curve: Curve | SketchCurve['shape']): Id[] {
  switch (curve.type) {
    case 'line':
      return [curve.a, curve.b];
    case 'arc':
      return [curve.start, curve.end];
    case 'circle':
      return [];
    default:
      return unreachable(curve, 'curve');
  }
}
const endPositions = (world: World, id: Id): Vec2[] => {
  const curve = world.curves.get(id);
  return curve ? endsOf(curve.shape).flatMap((p): Vec2[] => {
    const q = position(world, p);
    return q ? [q] : [];
  }) : [];
};
const atEnd = (world: World, id: Id, p: Vec2): boolean => endPositions(world, id).some((q) => dist2(p, q) <= tol);

// The curves whose contacts with X are cuts of X: the other outline curves for an outline curve;
// every other curve, own or not, for a construction curve; only `with` when it is given.
function cuttersOf(world: World, X: Id, withId?: Id): Id[] {
  if (withId !== undefined) return [withId];
  const all = [...world.curves.keys()].filter((id) => id !== X);
  return isProfile(world, X) ? all.filter((id) => isProfile(world, id)) : all;
}

// The cuts of X with the given curves: contacts away from the ends of X, one per place, each with
// the curve it is a contact with (the first one found), sorted along X.
interface Cut {
  at: Vec2;
  t: number;
  with: Id;
}
function cutsOf(world: World, X: Id, cutters: Id[], carrier: Carrier): Cut[] {
  const out: Cut[] = [];
  for (const C of cutters) {
    for (const p of world.contacts(X, C).points) {
      if (atEnd(world, X, p) || out.some((cut) => dist2(cut.at, p) <= tol)) continue;
      out.push({ at: p, t: paramOf(carrier, p), with: C });
    }
  }
  return out.sort((p, q) => p.t - q.t);
}

// The piece of X around the parameter `t` between the cuts: its bounds as cuts (undefined at an end
// of a line or an arc), and its range of parameters. A circle with no cut or one cut is one piece
// from the cut round to itself (the whole circle).
interface Piece {
  lo?: Cut;
  hi?: Cut;
  from: number;
  to: number;
}
function pieceAround(carrier: Carrier, cuts: Cut[], t: number): Piece {
  switch (carrier.type) {
    case 'line':
    case 'arc': {
      const end = carrier.type === 'line' ? 1 : carrier.sweep;
      const lo = [...cuts].reverse().find((cut) => cut.t < t);
      const hi = cuts.find((cut) => cut.t >= t);
      return { lo, hi, from: lo?.t ?? 0, to: hi?.t ?? end };
    }
    case 'circle': {
      if (cuts.length < 2) return { from: cuts[0]?.t ?? 0, to: (cuts[0]?.t ?? 0) + TAU };
      const hiIndex = cuts.findIndex((cut) => cut.t >= t);
      const hi = hiIndex < 0 ? cuts[0] : cuts[hiIndex];
      const lo = hiIndex <= 0 ? cuts[cuts.length - 1] : cuts[hiIndex - 1];
      const from = lo.t;
      const to = hi.t > lo.t ? hi.t : hi.t + TAU;
      return { lo, hi, from, to };
    }
    default:
      return unreachable(carrier, 'carrier');
  }
}
// Is a place on the piece of X a trim removes? Strictly between its bounds; an end of X belongs to
// the piece when no bound is on its side (it goes with the piece), so a contact there is not cut.
function inPiece(world: World, X: Id, carrier: Carrier, piece: Piece, p: Vec2): boolean {
  if (!curveHas(carrier, p)) return false;
  if ((piece.lo && dist2(piece.lo.at, p) <= tol) || (piece.hi && dist2(piece.hi.at, p) <= tol)) return false;
  if (carrier.type === 'circle') {
    if (!piece.lo) return true; // the whole circle
    let t = paramOf(carrier, p);
    if (t < piece.from) t += TAU;
    return t > piece.from && t < piece.to;
  }
  const [start, end] = endPositions(world, X);
  if (start && dist2(start, p) <= tol) return !piece.lo;
  if (end && dist2(end, p) <= tol) return !piece.hi;
  const t = paramOf(carrier, p);
  return t > piece.from && t < piece.to;
}
function curveHas(carrier: Carrier, p: Vec2): boolean {
  switch (carrier.type) {
    case 'line': {
      const t = paramOf(carrier, p);
      return t >= -1e-12 && t <= 1 + 1e-12 && dist2(pointOn(carrier, t), p) <= tol;
    }
    case 'arc':
      return Math.abs(dist2(carrier.c, p) - carrier.r) <= tol && (paramOf(carrier, p) <= carrier.sweep || dist2(pointOn(carrier, 0), p) <= tol);
    case 'circle':
      return Math.abs(dist2(carrier.c, p) - carrier.r) <= tol;
    default:
      return unreachable(carrier, 'carrier');
  }
}

// ---------------------------------------------------------------- stage 1: events and points

// A place where curves are cut (`cut`: each gets a node there unless it ends there) and where the
// point is held on curves that are not cut (`hold`). A `bound` is a place a trim cuts its curve at,
// or the new end of an extension: there the curve is cut even when the other one cannot be.
interface Event {
  at: Vec2;
  cut: Id[];
  hold: Id[];
  bound: boolean;
  involved: Id[]; // every curve the event names, for finding a point that is there already
}
const event = (at: Vec2, cut: Id[], hold: Id[], bound = false): Event => ({ at, cut, hold, bound, involved: [...cut, ...hold] });

interface Node {
  point: Id;
  at: Vec2;
}
interface Resolved {
  nodes: Map<Id, Node[]>; // the points a curve is cut at, by curve
  holds: [Id, Id][]; // a point held on a curve that is not cut there
  added: Map<Id, Vec2>; // new points
  uncut: Set<Id>;
  pointOf(at: Vec2): Id | undefined; // the point made or found at a place of an event
}

// Pools the points of the circles, drops what cannot be cut and gives each place one point.
function resolve(world: World, events: Event[], newId: NewId, extra: { at: Vec2; involved: Id[] }[] = []): Resolved {
  const uncut = new Set<Id>();
  // a curve that ends at the place is not cut there
  for (const e of events) e.cut = e.cut.filter((id) => !atEnd(world, id, e.at));
  // the circles: cut when they get two points or more over the batch, never when a generated profile names them
  for (;;) {
    const counts = new Map<Id, Vec2[]>();
    for (const e of events) {
      for (const id of e.cut) {
        if (world.curves.get(id)?.shape.type !== 'circle') continue;
        const list = counts.get(id) ?? [];
        if (!list.some((p) => dist2(p, e.at) <= tol)) list.push(e.at);
        counts.set(id, list);
      }
    }
    const bad = [...counts.entries()].filter(([id, list]) => list.length < 2 || world.generated.has(id)).map(([id]) => id);
    if (bad.length === 0) break;
    for (const e of events) {
      const lost = e.cut.filter((id) => bad.includes(id));
      if (lost.length === 0) continue;
      for (const id of lost) uncut.add(id);
      e.cut = e.cut.filter((id) => !lost.includes(id));
      if (e.bound) e.hold.push(...lost);
      else [e.cut, e.hold] = [[], []];
    }
  }
  const live = events.filter((e) => e.cut.length > 0 || (e.bound && e.hold.length > 0));
  // one point per place: one already there that a curve of the place ends at or holds, or a new one
  const places: { at: Vec2; point: Id }[] = [];
  const added = new Map<Id, Vec2>();
  const own = (id: Id): boolean => id === ORIGIN || has(world.sketch.points, id);
  const pointFor = (at: Vec2, involved: Id[]): Id => {
    const known = places.find((place) => dist2(place.at, at) <= tol);
    if (known) return known.point;
    const candidates = new Set<Id>();
    for (const id of involved) {
      const curve = world.curves.get(id);
      if (curve) for (const p of endsOf(curve.shape)) if (own(p)) candidates.add(p);
    }
    for (const c of Object.values(world.sketch.constraints)) if (c.type === 'pointOnCurve' && involved.includes(c.curve) && own(c.point)) candidates.add(c.point);
    let best: Id | undefined;
    let distance = tol;
    for (const id of [...candidates].sort()) {
      const p = position(world, id);
      if (p && dist2(p, at) <= distance) [best, distance] = [id, dist2(p, at)];
    }
    const point = best ?? newId('p');
    if (!best) added.set(point, at);
    places.push({ at, point });
    return point;
  };
  const nodes = new Map<Id, Node[]>();
  const holds: [Id, Id][] = [];
  for (const place of extra) pointFor(place.at, place.involved);
  for (const e of live) {
    const point = pointFor(e.at, e.involved);
    for (const id of e.cut) {
      const list = nodes.get(id) ?? [];
      if (!list.some((n) => n.point === point)) list.push({ point, at: e.at });
      nodes.set(id, list);
    }
    for (const id of e.hold) if (!holds.some(([p, c]) => p === point && c === id)) holds.push([point, id]);
  }
  return { nodes, holds, added, uncut, pointOf: (at) => places.find((place) => dist2(place.at, at) <= tol)?.point };
}

// The contacts of every two outline curves of the sketch (the repair), apart from those `skip`
// leaves out, and the ends of two outline curves at one place that are not joined.
function repairEvents(world: World, skip: (at: Vec2, a: Id, b: Id) => boolean = () => false): { events: Event[]; ends: [Id, Id][] } {
  const profile = [...world.curves.keys()].filter((id) => isProfile(world, id)).sort();
  const events: Event[] = [];
  const ends: [Id, Id][] = [];
  for (let i = 0; i < profile.length; i++) {
    for (let j = i + 1; j < profile.length; j++) {
      const [a, b] = [profile[i], profile[j]];
      const found = world.contacts(a, b);
      for (const p of found.points) if (!skip(p, a, b)) events.push(event(p, [a, b], []));
      const [ea, eb] = [endsOf(world.sketch.curves[a]), endsOf(world.sketch.curves[b])];
      for (const [x, y] of found.ends) ends.push([ea[x], eb[y]]);
    }
  }
  return { events, ends };
}

// ---------------------------------------------------------------- stage 2: the model after the batch

interface CutCurve {
  id: Id;
  original: Curve;
  pieces: { id: Id; from: Id; to: Id }[]; // the pieces that stay, in the order of the curve; the keeper is the one with `id`
  cutOff: Id[]; // ends of the curve as it was that no piece has
  lostPiece: boolean; // a piece was trimmed away
  whole?: { sibling?: Id }; // the curve was removed whole
  nodes: Id[]; // the points it was cut at, in its own direction
}

class Model {
  readonly points: Map<Id, Point2>;
  readonly newPoints = new Map<Id, Vec2>();
  readonly curves: Map<Id, Curve>;
  readonly newCurves: Id[] = [];
  readonly constraints: Map<Id, Constraint>;
  readonly newConstraints: Id[] = [];
  readonly moved = new Set<Id>(); // constraints removed and added again under their ID
  readonly expressions: Record<string, Expr>;
  constructor(
    readonly sketch: SketchFeature,
    private readonly newId: NewId,
  ) {
    this.points = new Map(Object.entries(sketch.points));
    this.curves = new Map(Object.entries(sketch.curves));
    this.constraints = new Map(Object.entries(sketch.constraints));
    this.expressions = { ...(sketch.expressions ?? {}) } as Record<string, Expr>;
  }
  addPoint(id: Id, at: Vec2): void {
    this.points.set(id, { x: at[0], y: at[1] });
    this.newPoints.set(id, at);
  }
  addCurve(curve: Curve): Id {
    const id = this.newId('c');
    this.curves.set(id, curve);
    this.newCurves.push(id);
    return id;
  }
  constrain(c: Constraint): Id | undefined {
    if (this.identity(c) || this.repeated(c) !== undefined) return undefined;
    const id = this.newId('k');
    this.constraints.set(id, c);
    this.newConstraints.push(id);
    return id;
  }
  // A constraint that says nothing: a point held on a curve it is an end of, or a constraint of one
  // curve with itself.
  identity(c: Constraint): boolean {
    const operands = constraintOperands(c);
    if (new Set(operands).size < operands.length) return true;
    if (c.type === 'pointOnCurve') {
      const curve = this.curves.get(c.curve);
      return curve !== undefined && endsOf(curve).includes(c.point);
    }
    return false;
  }
  repeated(c: Constraint, except?: Id): Id | undefined {
    if (!isDriving(c)) return undefined;
    const key = constraintKey(c);
    for (const [id, other] of this.constraints) if (id !== except && isDriving(other) && constraintKey(other) === key) return id;
    return undefined;
  }
  usesPoint(point: Id, except: (curve: Id) => boolean = () => false): boolean {
    for (const [id, curve] of this.curves) if (!except(id) && curvePoints(curve).includes(point)) return true;
    return false;
  }
}

// What names a point besides the curves and constraints of the sketch: a feature of the document
// (other than the sketch) or a section.
function namedOutside(doc: Document, sketch: Id): Set<Id> {
  const texts = new Set<string>(namedBySections(doc));
  for (const feature of doc.features) if (feature.id !== sketch) textsIn(feature, texts);
  return texts;
}

// ---------------------------------------------------------------- the cut, as one plan

interface Plan {
  commands: Command[]; // the sketch commands, without the patches
  model: Model;
  cuts: Map<Id, CutCurve>;
  joined: [Id, Id][]; // pairs of points the batch joins (a coincident or a re-point)
  repointed: Id[]; // curves re-pointed onto another point (ends at one place)
  uncut: Set<Id>;
  pointsAtCuts: Id[];
  newEnd?: Id; // the new end of an extension
  extended?: Id;
  refusal?: string;
}

interface CutSpec {
  // events of the batch
  events: Event[];
  // pairs of ends at one place to join
  ends: [Id, Id][];
  // the curve a trim cuts, with the piece it removes (its bounds are among the events)
  trim?: { X: Id; carrier: Carrier; piece: Piece; whole: boolean };
  // the curve an extension moves, with its end and the place it moves to
  extend?: { X: Id; end: 'a' | 'b' | 'start' | 'end'; at: Vec2; target: Id; stretch: Event[] };
}

function failedPlan(message: string): Plan {
  return { commands: [], model: undefined as unknown as Model, cuts: new Map(), joined: [], repointed: [], uncut: new Set(), pointsAtCuts: [], refusal: message };
}

function makePlan(world: World, spec: CutSpec, newId: NewId): Plan {
  const { sketch, doc } = world;
  const outside = namedOutside(doc, sketch.id);
  const extendExtra = spec.extend ? [{ at: spec.extend.at, involved: [spec.extend.X, spec.extend.target] }] : [];
  const resolved = resolve(world, [...spec.events, ...(spec.extend?.stretch ?? [])], newId, extendExtra);
  const model = new Model(sketch, newId);
  for (const [id, at] of resolved.added) model.addPoint(id, at);
  const newEnd = spec.extend ? resolved.pointOf(spec.extend.at) : undefined;

  // ---- ends at one place: re-pointed onto one point, or joined by a coincident
  const joined: [Id, Id][] = [];
  const repointed: Id[] = [];
  const coincidents: [Id, Id][] = [];
  {
    const parent = new Map<Id, Id>();
    const find = (p: Id): Id => {
      while (parent.has(p) && parent.get(p) !== p) p = parent.get(p) as Id;
      return p;
    };
    for (const [p, q] of spec.ends) {
      if (world.joins(p) === world.joins(q)) continue;
      const [rp, rq] = [find(p), find(q)];
      if (rp !== rq) parent.set(rp < rq ? rq : rp, rp < rq ? rp : rq);
      if (!parent.has(p)) parent.set(p, p);
      if (!parent.has(q)) parent.set(q, q);
    }
    const clusters = new Map<Id, Id[]>();
    for (const p of parent.keys()) clusters.set(find(p), [...(clusters.get(find(p)) ?? []), p]);
    const curvesUsing = (p: Id): Id[] => Object.keys(sketch.curves).filter((id) => curvePoints(sketch.curves[id]).includes(p));
    const orphan = (p: Id): boolean => p !== ORIGIN && curvesUsing(p).length === 1 && !Object.values(sketch.constraints).some((c) => constraintOperands(c).includes(p)) && !outside.has(p);
    for (const members of clusters.values()) {
      const sorted = [...new Set(members)].sort();
      const named = sorted.filter((p) => !orphan(p));
      const rep = named[0] ?? sorted[0];
      for (const p of sorted) {
        if (p === rep || world.joins(p) === world.joins(rep)) continue;
        joined.push([rep, p]);
        if (orphan(p)) {
          const [curveId] = curvesUsing(p);
          const curve = model.curves.get(curveId) as Curve;
          const field = (Object.keys(curve) as (keyof Curve)[]).find((key) => key !== 'type' && (curve as unknown as Record<string, Id>)[key] === p) as string;
          model.curves.set(curveId, { ...curve, [field]: rep } as Curve);
          model.points.delete(p);
          repointed.push(curveId);
        } else coincidents.push([rep, p]);
      }
    }
  }

  // ---- the curves cut into pieces
  const cuts = new Map<Id, CutCurve>();
  const pointsAtCuts: Id[] = [];
  const cutIds = new Set<Id>([...resolved.nodes.keys(), ...(spec.trim && !spec.trim.whole ? [spec.trim.X] : []), ...(spec.extend ? [spec.extend.X] : [])]);
  for (const X of [...cutIds].sort()) {
    if (!isOwn(world, X)) continue;
    const curve = model.curves.get(X) as Curve;
    const carrier = carrierOf(world, X);
    if (!carrier) continue;
    const nodes = [...(resolved.nodes.get(X) ?? [])];
    const order = (n: Node): number => {
      let t = paramOf(carrier, n.at);
      if (spec.extend?.X === X && carrier.type === 'arc' && spec.extend.end === 'start' && t > carrier.sweep + 1e-12) t -= TAU;
      return t;
    };
    nodes.sort((p, q) => order(p) - order(q));
    let chain: Id[];
    let cyclic = false;
    const ends = endsOf(curve);
    if (curve.type === 'circle') {
      chain = nodes.map((n) => n.point);
      cyclic = true;
      if (chain.length < 2) continue;
    } else if (spec.extend?.X === X) {
      const atStart = spec.extend.end === 'a' || spec.extend.end === 'start';
      chain = atStart ? [newEnd as Id, ...nodes.map((n) => n.point), ends[1]] : [ends[0], ...nodes.map((n) => n.point), newEnd as Id];
    } else chain = [ends[0], ...nodes.map((n) => n.point), ends[1]];
    for (const n of nodes) if (!pointsAtCuts.includes(n.point)) pointsAtCuts.push(n.point);
    const count = cyclic ? chain.length : chain.length - 1;
    const pairs = Array.from({ length: count }, (_, i): [Id, Id] => [chain[i], chain[(i + 1) % chain.length]]);
    // the piece a trim removes: the one whose middle lies in the piece of the trim
    let removed: number | undefined;
    if (spec.trim?.X === X && !spec.trim.whole) {
      const { piece, carrier: c } = spec.trim;
      const mid = (piece.from + piece.to) / 2;
      const midPoint = pointOn(c, c.type === 'circle' ? positive(mid) : mid);
      const at = (p: Id): Vec2 => model.newPoints.get(p) ?? position(world, p) ?? [NaN, NaN];
      removed = pairs.findIndex(([p, q]) => {
        const tp = paramOf(c, at(p));
        let tq = paramOf(c, at(q));
        let tm = paramOf(c, midPoint);
        if (c.type === 'circle') {
          if (tq <= tp) tq += TAU;
          if (tm < tp) tm += TAU;
        } else if (c.type === 'arc') {
          if (p === ends[1]) return false;
          if (q === ends[1]) tq = c.sweep;
          if (p === ends[0]) return tm < tq;
        }
        return tm > tp && tm < tq;
      });
      if (removed < 0) removed = undefined;
    }
    const kept = pairs.map((_, i) => i).filter((i) => i !== removed);
    if (kept.length === 0) continue;
    const keeperIndex = kept[0];
    const pieces = kept.map((i) => ({ i, from: pairs[i][0], to: pairs[i][1], id: '' }));
    const construction = curve.construction === true ? { construction: true } : {};
    for (const piece of pieces) {
      const shape: Curve =
        curve.type === 'line' ? { ...construction, type: 'line', a: piece.from, b: piece.to } : { ...construction, type: 'arc', center: curve.type === 'arc' || curve.type === 'circle' ? curve.center : '', start: piece.from, end: piece.to };
      if (piece.i === keeperIndex) {
        piece.id = X;
        model.curves.set(X, shape);
      } else piece.id = model.addCurve(shape);
    }
    const keptPoints = new Set(pieces.flatMap((piece) => [piece.from, piece.to]));
    const originalEnds = endsOf(sketch.curves[X]);
    cuts.set(X, {
      id: X,
      original: sketch.curves[X],
      pieces: pieces.map(({ id, from, to }) => ({ id, from, to })),
      cutOff: originalEnds.filter((p) => !keptPoints.has(p) && !(repointed.includes(X) && !endsOf(curve).includes(p))),
      lostPiece: removed !== undefined || spec.extend?.X === X,
      nodes: nodes.map((n) => n.point),
    });
  }
  if (spec.extend && newEnd && !pointsAtCuts.includes(newEnd)) pointsAtCuts.push(newEnd);
  else if (spec.extend && newEnd) pointsAtCuts.push(...pointsAtCuts.splice(pointsAtCuts.indexOf(newEnd), 1));

  // ---- a whole piece removed
  if (spec.trim?.whole) {
    const X = spec.trim.X;
    const curve = sketch.curves[X];
    const sibling = siblingOf(world, model, X);
    model.curves.delete(X);
    cuts.set(X, { id: X, original: curve, pieces: [], cutOff: curve.type === 'circle' ? [] : endsOf(curve), lostPiece: true, whole: { sibling }, nodes: [] });
  }

  // ---- the constraints that name a cut curve
  const refusal = moveConstraints(world, model, cuts, newEnd);
  if (refusal) return failedPlan(refusal);

  // ---- the holds: pieces on the line of their curve, arcs of one circle that share no end
  for (const cut of cuts.values()) {
    if (cut.whole) continue;
    const keeper = model.curves.get(cut.id) as Curve;
    if (keeper.type === 'line') {
      const keeperEnds = endsOf(keeper);
      const heldOnX = (p: Id): boolean => [...model.constraints.values()].some((c) => c.type === 'pointOnCurve' && c.point === p && c.curve === cut.id);
      // a midpoint moved to the span whose point is on X holds the far end on the line already
      const spanned = [...model.constraints.values()].some((c) => {
        if (c.type !== 'midpoint') return false;
        const span = model.curves.get(c.line);
        if (!span || span.type !== 'line' || !model.newCurves.includes(c.line) || !endsOf(cut.original).every((p) => endsOf(span).includes(p))) return false;
        return cut.pieces.some((piece) => piece.from === c.point || piece.to === c.point) || heldOnX(c.point);
      });
      let skipped = false;
      const points = cut.pieces.flatMap((piece) => [piece.from, piece.to]).filter((p, i, list) => list.indexOf(p) === i && !keeperEnds.includes(p));
      for (const p of points) {
        if (heldOnX(p)) continue;
        if (spanned && !skipped && endsOf(cut.original).includes(p)) {
          skipped = true;
          continue;
        }
        model.constrain({ type: 'pointOnCurve', point: p, curve: cut.id });
      }
    } else {
      // groups of pieces that share an end; each group after the first tied to the keeper
      const groups: (typeof cut.pieces)[] = [];
      for (const piece of cut.pieces) {
        const group = groups.find((g) => g.some((other) => other.to === piece.from || other.from === piece.to));
        if (group) group.push(piece);
        else groups.push([piece]);
      }
      // a circle's chain closes: the last group may join the first
      if (groups.length > 1 && groups[groups.length - 1].some((p) => groups[0].some((q) => q.from === p.to || q.to === p.from))) groups[0].push(...(groups.pop() as typeof cut.pieces));
      for (const group of groups) if (!group.some((piece) => piece.id === cut.id)) model.constrain({ type: 'equalRadius', a: group[0].id, b: cut.id });
    }
  }

  // ---- the ends cut off: held on the line or circle of the curve when anything else names them
  for (const cut of cuts.values()) {
    const sibling = cut.whole?.sibling;
    const carrierOwn = new Set<Id>([cut.id, ...cut.pieces.map((piece) => piece.id), ...(sibling ? [sibling] : [])]);
    const holder = cut.whole ? sibling : cut.id;
    const candidates = [...cut.cutOff, ...(cut.whole && !sibling && cut.original.type !== 'line' ? [(cut.original as { center: Id }).center] : [])];
    for (const p of candidates) {
      if (!model.points.has(p) && p !== ORIGIN) continue;
      const named =
        p === ORIGIN ||
        model.usesPoint(p) ||
        [...model.constraints.values()].some((c) => constraintOperands(c).includes(p) && !(c.type === 'pointOnCurve' && c.point === p && carrierOwn.has(c.curve))) ||
        outside.has(p);
      if (!named) {
        model.points.delete(p);
        for (const [id, c] of [...model.constraints]) if (constraintOperands(c).includes(p)) model.constraints.delete(id);
        continue;
      }
      if (holder && !p.includes('/') && model.curves.has(holder)) {
        const held = [...model.constraints.values()].some((c) => c.type === 'pointOnCurve' && c.point === p && c.curve === holder);
        if (!held) model.constrain({ type: 'pointOnCurve', point: p, curve: holder });
      }
    }
  }

  // ---- a point at a cut held on a curve that is not cut there; ends at one place joined
  for (const [p, C] of resolved.holds) {
    if (!model.points.has(p) && p !== ORIGIN) continue;
    if (cuts.has(C) && !cuts.get(C)?.whole) continue;
    if ([...model.constraints.values()].some((c) => c.type === 'pointOnCurve' && c.point === p && c.curve === C)) continue;
    const shape = model.curves.get(C) ?? world.curves.get(C)?.shape;
    if (shape && endsOf(shape).includes(p)) continue;
    model.constrain({ type: 'pointOnCurve', point: p, curve: C });
  }
  for (const [a, b] of coincidents) model.constrain({ type: 'coincident', a, b });

  const commands = emit(world, model);
  return { commands, model, cuts, joined, repointed, uncut: resolved.uncut, pointsAtCuts, newEnd, extended: spec.extend?.X };
}

// A sibling of a curve removed whole: another own curve on its carrier held there by constraints
// (a line both of whose ends are ends of X or held on X, or the reverse, running the same way; an
// arc with the same centre point that shares an end with X or is tied to it by equalRadius). One
// with the construction flag of X first, then one that shares an end, then the first by ID.
function siblingOf(world: World, model: Model, X: Id): Id | undefined {
  const curve = world.sketch.curves[X];
  if (curve.type === 'circle') return undefined;
  const heldOn = (p: Id, on: Id): boolean => [...model.constraints.values()].some((c) => c.type === 'pointOnCurve' && c.point === p && c.curve === on);
  const ends = endsOf(curve);
  const found: { id: Id; sameFlag: boolean; shares: boolean }[] = [];
  for (const [id, other] of model.curves) {
    if (id === X || other.type !== curve.type) continue;
    const otherEnds = endsOf(other);
    const shares = ends.some((p) => otherEnds.includes(p));
    if (curve.type === 'line' && other.type === 'line') {
      const onX = otherEnds.every((p) => ends.includes(p) || heldOn(p, X));
      const onOther = ends.every((p) => otherEnds.includes(p) || heldOn(p, id));
      if (!onX && !onOther) continue;
      const [a, b, c, d] = [position(world, curve.a), position(world, curve.b), model.newPoints.get(other.a) ?? position(world, other.a), model.newPoints.get(other.b) ?? position(world, other.b)];
      if (!a || !b || !c || !d || (b[0] - a[0]) * (d[0] - c[0]) + (b[1] - a[1]) * (d[1] - c[1]) <= 0) continue;
    } else if (curve.type === 'arc' && other.type === 'arc') {
      if (other.center !== curve.center) continue;
      const tied = [...model.constraints.values()].some((c) => c.type === 'equalRadius' && ((c.a === X && c.b === id) || (c.a === id && c.b === X)));
      if (!shares && !tied) continue;
    } else continue;
    found.push({ id, sameFlag: (other.construction === true) === (curve.construction === true), shares });
  }
  found.sort((p, q) => Number(q.sameFlag) - Number(p.sameFlag) || Number(q.shares) - Number(p.shares) || (p.id < q.id ? -1 : 1));
  return found[0]?.id;
}

// The common end of a tangency by the rule of the solver adapter (D52): the same point, or two
// points one coincident of the sketch names together; for a line and an arc only.
function commonEnd(model: Model, a: Id, b: Id): Id | undefined {
  const [ca, cb] = [model.curves.get(a), model.curves.get(b)];
  if (!ca || !cb) return undefined;
  const [line, arc] = ca.type === 'line' && cb.type === 'arc' ? [ca, cb] : cb.type === 'line' && ca.type === 'arc' ? [cb, ca] : [undefined, undefined];
  if (!line || !arc) return undefined;
  const lineEnds = [line.a, line.b];
  const shared = [arc.start, arc.end].find((p) => lineEnds.includes(p));
  if (shared !== undefined) return shared;
  const joins = [...model.constraints.values()].filter((c): c is Extract<Constraint, { type: 'coincident' }> => c.type === 'coincident');
  return [arc.start, arc.end].find((p) => joins.some((c) => (c.a === p && lineEnds.includes(c.b)) || (c.b === p && lineEnds.includes(c.a))));
}

// Each constraint on a cut curve where it belongs (design.md, "What happens to the constraints").
// A refusal as text.
function moveConstraints(world: World, model: Model, cuts: Map<Id, CutCurve>, newEnd: Id | undefined): string | undefined {
  const { sketch } = world;
  const spans = new Map<Id, Id>();
  const spanOf = (X: Id): Id => {
    let span = spans.get(X);
    if (!span) {
      const original = cuts.get(X)?.original as Extract<Curve, { type: 'line' }>;
      span = model.addCurve({ construction: true, type: 'line', a: original.a, b: original.b });
      spans.set(X, span);
    }
    return span;
  };
  const piecesOf = (X: Id): Id[] => {
    const cut = cuts.get(X);
    if (!cut) return [X];
    if (cut.whole) return cut.whole.sibling ? [cut.whole.sibling] : [];
    return cut.pieces.map((piece) => piece.id);
  };
  // before the moves: the common ends of the tangencies as they were
  const before = new Model(sketch, () => '');
  for (const id of Object.keys(sketch.constraints).sort()) {
    const c = sketch.constraints[id];
    const named = constraintOperands(c).filter((operand) => cuts.has(operand));
    if (named.length === 0) continue;
    const X = named[0];
    const cut = cuts.get(X) as CutCurve;
    const circleTurned = cut.original.type === 'circle';
    let next: Constraint | undefined = c;
    const swap = (from: Id, to: Id): void => {
      if (!next) return;
      const fields = Object.fromEntries(Object.entries(next).map(([key, value]) => [key, key !== 'type' && value === from ? to : value]));
      next = fields as unknown as Constraint;
    };
    // the operands one by one
    for (const operand of named) {
      const own = cuts.get(operand) as CutCurve;
      if (own.whole) {
        const sibling = own.whole.sibling;
        if (!sibling || c.type === 'equalLength' || c.type === 'midpoint') {
          next = undefined;
          break;
        }
        swap(operand, sibling);
        continue;
      }
      if (c.type === 'equalLength' || c.type === 'midpoint') {
        if (own.original.type === 'line') swap(operand, spanOf(operand));
      }
    }
    if (next && c.type === 'tangent') {
      const [a, b] = [c.a, c.b];
      const was = commonEnd(before, a, b);
      const pairs = piecesOf(a).flatMap((p) => piecesOf(b).map((q): [Id, Id] => [p, q]));
      const hit = pairs.find(([p, q]) => commonEnd(model, p, q) !== undefined);
      if (hit) next = { ...c, a: hit[0], b: hit[1] };
      else if (was !== undefined) return `the tangency "${id}" holds "${a}" and "${b}" at their common end "${was}", which the trim takes off; remove the tangency first`;
      else next = { ...c, a: piecesOf(a)[0] ?? a, b: piecesOf(b)[0] ?? b };
    }
    if (!next) {
      model.constraints.delete(id);
      continue;
    }
    const changed = circleTurned || JSON.stringify(next) !== JSON.stringify(c);
    if (!changed) continue;
    model.constraints.set(id, next);
    model.moved.add(id);
  }
  // identities, repeats and constraints of one curve with itself go; a moved one with an expression
  // wins over a repeat without one
  for (const id of [...model.moved].sort()) {
    const c = model.constraints.get(id);
    if (!c) continue;
    if (model.identity(c)) {
      model.constraints.delete(id);
      model.moved.delete(id);
      continue;
    }
    const twin = model.repeated(c, id);
    if (twin === undefined) continue;
    const mine = model.expressions[constraintPath(id)] !== undefined;
    const theirs = model.expressions[constraintPath(twin)] !== undefined;
    if (mine && !theirs) {
      model.constraints.delete(twin);
      model.moved.delete(twin);
    } else {
      model.constraints.delete(id);
      model.moved.delete(id);
    }
  }
  // the identities of constraints that stay on the keeper (a point held on a line it now ends)
  for (const [id, c] of [...model.constraints]) {
    if (c.type !== 'pointOnCurve' || !cuts.has(c.curve)) continue;
    const cut = cuts.get(c.curve) as CutCurve;
    if (cut.whole) continue;
    const keeper = model.curves.get(c.curve) as Curve;
    const vertex = (p: Id): Id => world.joins(p);
    const ends = keeper.type === 'line' ? endsOf(keeper) : cut.pieces.flatMap((piece) => [piece.from, piece.to]);
    if (ends.some((p) => p === c.point || vertex(p) === vertex(c.point))) {
      model.constraints.delete(id);
      model.moved.delete(id);
    }
  }
  // a moved dimension with an expression must be added again by it
  for (const id of model.moved) {
    const expr = model.expressions[constraintPath(id)];
    if (expr === undefined) continue;
    if (!world.parameters) continue;
    const value = evaluateNumber(expr, world.parameters);
    if (!value.ok) return `the dimension "${id}" has to move to another curve, but its expression "${expr}" does not evaluate: ${value.error.message}`;
  }
  void newEnd;
  return undefined;
}


// The batch: the difference between the sketch and the model, in the order of design.md: new
// points; constraints removed or moved; re-points, circles turned into arcs, new curves; curves and
// points removed; constraints added and added again.
function emit(world: World, model: Model): Command[] {
  const { sketch } = world;
  const s = sketch.id;
  const out: Command[] = [];
  for (const [id, at] of model.newPoints) out.push({ type: 'addPoint', sketch: s, id, x: at[0], y: at[1] });
  const turned = Object.keys(sketch.curves).filter((id) => model.curves.has(id) && model.curves.get(id)?.type !== sketch.curves[id].type);
  for (const id of Object.keys(sketch.constraints).sort()) {
    const c = sketch.constraints[id];
    const gone = !model.constraints.has(id) || model.moved.has(id) || constraintOperands(c).some((operand) => turned.includes(operand));
    if (gone) out.push({ type: 'removeConstraint', sketch: s, id });
  }
  for (const id of Object.keys(sketch.curves).sort()) {
    const was = sketch.curves[id];
    const now = model.curves.get(id);
    if (!now) continue;
    if (now.type !== was.type) {
      out.push({ type: 'removeEntity', sketch: s, id }, { type: 'addCurve', sketch: s, id, curve: now });
      continue;
    }
    for (const name of ['a', 'b', 'start', 'end'] as const) {
      const [from, to] = [(was as unknown as Record<string, Id>)[name], (now as unknown as Record<string, Id>)[name]];
      if (from !== undefined && to !== undefined && from !== to) out.push({ type: 'setCurvePoint', sketch: s, id, point: name, to });
    }
  }
  for (const id of model.newCurves) if (model.curves.has(id)) out.push({ type: 'addCurve', sketch: s, id, curve: model.curves.get(id) as Curve });
  for (const id of Object.keys(sketch.curves).sort()) if (!model.curves.has(id)) out.push({ type: 'removeEntity', sketch: s, id });
  for (const id of Object.keys(sketch.points).sort()) if (!model.points.has(id)) out.push({ type: 'removeEntity', sketch: s, id });
  const again = [...model.constraints.keys()].filter((id) => has(sketch.constraints, id) && (model.moved.has(id) || constraintOperands(sketch.constraints[id]).some((operand) => turned.includes(operand))));
  for (const id of again.sort()) out.push({ type: 'addConstraint', sketch: s, id, constraint: inputOf(model, id) });
  for (const id of model.newConstraints) if (model.constraints.has(id)) out.push({ type: 'addConstraint', sketch: s, id, constraint: model.constraints.get(id) as Constraint });
  return out;
}

// A constraint in the form a command takes: a driving dimension with its expression, when it has one.
function inputOf(model: Model, id: Id): Extract<Command, { type: 'addConstraint' }>['constraint'] {
  const c = model.constraints.get(id) as Constraint;
  const expr = model.expressions[constraintPath(id)];
  return isDimension(c) && c.driving && expr !== undefined ? ({ ...c, value: expr } as Extract<Command, { type: 'addConstraint' }>['constraint']) : c;
}

// ---------------------------------------------------------------- the three tools

const failed = (message: string): SketchToolResult => ({ ok: false, message });

// The nearest place of a carrier to a point, by its parameter (a line within its ends, an arc within
// its sweep).
function nearestParam(carrier: Carrier, p: Vec2): number {
  switch (carrier.type) {
    case 'line':
      return Math.min(1, Math.max(0, paramOf(carrier, p)));
    case 'arc': {
      const t = paramOf(carrier, p);
      if (t <= carrier.sweep) return t;
      return t - carrier.sweep < TAU - t ? carrier.sweep : 0;
    }
    case 'circle':
      return paramOf(carrier, p);
    default:
      return unreachable(carrier, 'carrier');
  }
}

// The checks every tool makes on the curve it is given.
function curveProblem(world: World, X: Id, withId?: Id): string | undefined {
  if (!isOwn(world, X)) return world.curves.has(X) ? `"${X}" is not an own curve of the sketch; projected geometry is not trimmed, extended or split` : `the sketch has no curve "${X}"`;
  if (world.generated.has(X)) return `the circle "${X}" is an operand of a generated profile, which takes a whole circle; it is not trimmed, extended or split`;
  if (!carrierOf(world, X)) return `"${X}" has no solved position or no length`;
  if (withId !== undefined) {
    if (withId === X) return '`with` names the curve itself';
    if (!world.curves.has(withId)) return `with: the sketch has no curve "${withId}"`;
  }
  return undefined;
}

// A contact of X with a curve C, as an event: both cut when both take part in the profile; else X
// cut and the point held on C (a construction or projected curve, or an outline curve when X is
// a construction curve).
const contactEvent = (world: World, X: Id, C: Id, at: Vec2, bound: boolean): Event => (isProfile(world, X) && isProfile(world, C) ? event(at, [X, C], [], bound) : event(at, [X], [C], bound));

function trimSpec(world: World, input: TrimInput): CutSpec | string {
  const X = input.curve;
  const carrier = carrierOf(world, X) as Carrier;
  const cuts = cutsOf(world, X, cuttersOf(world, X, input.with), carrier);
  const piece = pieceAround(carrier, cuts, nearestParam(carrier, input.at));
  const whole = !piece.lo && !piece.hi;
  const events: Event[] = [];
  for (const bound of [piece.lo, piece.hi]) if (bound) events.push(contactEvent(world, X, bound.with, bound.at, true));
  let ends: [Id, Id][] = [];
  if (isProfile(world, X)) {
    const repair = repairEvents(world, (at) => inPiece(world, X, carrier, piece, at));
    events.push(...repair.events);
    ends = repair.ends;
  }
  return { events, ends, trim: { X, carrier, piece, whole } };
}

// Where the extension of an end of X first meets a curve: the place, the curve, and the contacts
// with outline curves before it (with `with` only). Undefined parts are said as text.
interface Reach {
  at: Vec2;
  target: Id;
  before: { at: Vec2; with: Id }[];
}
function reachOf(world: World, X: Id, end: ExtendInput['end'], withId?: Id): Reach | string {
  const curve = world.sketch.curves[X];
  const carrier = carrierOf(world, X) as Carrier;
  const E = (curve as unknown as Record<string, Id>)[end];
  const e = position(world, E) as Vec2;
  // the stretch the end moves along, as a curve of its own with two points that are not in the sketch
  const [far, near] = ['\u0000far', '\u0000near'];
  let stretch: SketchCurve;
  const points = { ...world.geometry.points };
  let along: (p: Vec2) => number;
  if (carrier.type === 'line') {
    const other = end === 'a' ? carrier.b : carrier.a;
    const length = dist2(e, other);
    const u: Vec2 = [(e[0] - other[0]) / length, (e[1] - other[1]) / length];
    let size = 1;
    for (const p of Object.values(world.geometry.points)) size = Math.max(size, Math.abs(p.x), Math.abs(p.y));
    for (const r of Object.values(world.geometry.radii)) size = Math.max(size, r);
    const reach = 8 * size + 10;
    points[far] = { x: e[0] + u[0] * reach, y: e[1] + u[1] * reach };
    stretch = { id: '\u0000stretch', shape: { type: 'line', a: E, b: far }, source: 'own', regions: true };
    along = (p) => (p[0] - e[0]) * u[0] + (p[1] - e[1]) * u[1];
  } else if (carrier.type === 'arc') {
    // the rest of the circle, from the end of the arc counter-clockwise to its start
    const arc = curve as Extract<Curve, { type: 'arc' }>;
    points[near] = world.geometry.points[arc.end];
    points[far] = world.geometry.points[arc.start];
    stretch = { id: '\u0000stretch', shape: { type: 'arc', center: arc.center, start: end === 'end' ? E : near, end: end === 'end' ? far : E }, source: 'own', regions: true };
    const rest = TAU - carrier.sweep;
    const angle = (p: Vec2): number => positive(Math.atan2(p[1] - carrier.c[1], p[0] - carrier.c[0]) - (carrier.from + carrier.sweep));
    along = (p) => (end === 'end' ? angle(p) : rest - angle(p)) * carrier.r;
  } else return 'a circle has no end to extend';
  const geometry = { points, radii: world.geometry.radii };
  const joins = (id: Id): Id => (id.startsWith('\u0000') ? id : world.joins(id));
  const found: { at: Vec2; with: Id; d: number }[] = [];
  for (const C of cuttersOf(world, X, withId)) {
    const curveC = world.curves.get(C);
    if (!curveC) continue;
    const contacts = curveContacts(stretch, curveC, joins, geometry);
    for (const p of contacts?.points ?? []) {
      const d = along(p);
      if (d <= tol || dist2(p, e) <= tol) continue;
      if (carrier.type === 'arc' && dist2(p, end === 'end' ? xy(points[far]) : xy(points[near])) <= tol) continue;
      found.push({ at: p, with: C, d });
    }
  }
  found.sort((p, q) => p.d - q.d);
  const stop = found[0];
  if (!stop) {
    if (carrier.type === 'arc') return `the extension of the arc "${X}" comes round to the arc itself before it meets ${withId ? `"${withId}"` : 'another curve'}`;
    return `the extension of "${X}" beyond "${E}" meets ${withId ? `no "${withId}"` : 'nothing'}`;
  }
  if (Math.abs(stop.at[0]) > MAX_NUMBER || Math.abs(stop.at[1]) > MAX_NUMBER) return `the new end of "${X}" would be out of the range ±${MAX_NUMBER}`;
  // with `with`, the outline curves the stretch crosses before it stops
  const before: { at: Vec2; with: Id }[] = [];
  if (withId !== undefined && isProfile(world, X)) {
    for (const C of cuttersOf(world, X)) {
      const curveC = world.curves.get(C);
      if (!curveC || C === stop.with) continue;
      for (const p of curveContacts(stretch, curveC, joins, geometry)?.points ?? []) {
        const d = along(p);
        if (d > tol && d < stop.d - tol && dist2(p, e) > tol) before.push({ at: p, with: C });
      }
    }
  }
  return { at: stop.at, target: stop.with, before };
}

// Why the end of X cannot be extended, if it cannot.
function endProblem(world: World, X: Id, end: string): string | undefined {
  const curve = world.sketch.curves[X];
  const names: readonly string[] = curve.type === 'line' ? ['a', 'b'] : curve.type === 'arc' ? ['start', 'end'] : [];
  if (curve.type === 'circle') return `"${X}" is a circle and has no end to extend`;
  if (!names.includes(end)) return `a ${curve.type} has the ends ${names.join(' and ')}, not "${end}"`;
  const E = (curve as unknown as Record<string, Id>)[end];
  const vertex = world.joins(E);
  for (const [id, other] of Object.entries(world.sketch.curves)) {
    if (id === X) continue;
    if (endsOf(other).some((p) => world.joins(p) === vertex)) return `"${id}" ends at "${E}" too; extending "${X}" would leave the end of "${id}" in its middle`;
  }
  const e = position(world, E) as Vec2;
  for (const id of Object.keys(world.sketch.curves)) {
    if (id === X || !isProfile(world, id)) continue;
    const carrier = carrierOf(world, id);
    if (carrier && curveHas(carrier, e) && !atEnd(world, id, e)) return `"${E}" lies on "${id}" away from its ends; the extension would pass through "${id}"`;
  }
  return undefined;
}

function extendSpec(world: World, input: ExtendInput): CutSpec | string {
  const X = input.curve;
  const problem = endProblem(world, X, input.end);
  if (problem) return problem;
  const reach = reachOf(world, X, input.end, input.with);
  if (typeof reach === 'string') return reach;
  const events: Event[] = [];
  let ends: [Id, Id][] = [];
  if (isProfile(world, X)) {
    const repair = repairEvents(world);
    events.push(...repair.events);
    ends = repair.ends;
  }
  const stretch = reach.before.map((b) => event(b.at, [X, b.with], []));
  // the curve met: cut there when both take part in the profile, else the new end held on it
  const meets = isProfile(world, X) && isProfile(world, reach.target) ? event(reach.at, [reach.target], [], true) : event(reach.at, [], [reach.target], true);
  return { events: [...events, meets], ends, extend: { X, end: input.end, at: reach.at, target: reach.target, stretch } };
}

function splitSpec(world: World, input: SplitInput): CutSpec | string {
  if (input.curve === undefined) {
    if (input.with !== undefined || input.at !== undefined) return '`with` and `at` need `curve`';
    return repairEvents(world);
  }
  const X = input.curve;
  const carrier = carrierOf(world, X) as Carrier;
  if (input.at !== undefined && carrier.type === 'circle') return `at: one point does not split the circle "${X}"; split it without \`at\` (at two points or more)`;
  let cuts = cutsOf(world, X, cuttersOf(world, X, input.with), carrier);
  if (cuts.length === 0) return input.with !== undefined ? `"${X}" has no contact with "${input.with}" away from its ends` : `nothing crosses or touches "${X}" away from its ends`;
  if (input.at !== undefined) {
    const at = input.at;
    cuts = [cuts.reduce((best, cut) => (dist2(cut.at, at) < dist2(best.at, at) ? cut : best))];
  }
  return { events: cuts.map((cut) => contactEvent(world, X, cut.with, cut.at, false)), ends: [] };
}

// ---------------------------------------------------------------- stage 3: the features over the sketch

// A point inside a region away from its boundary: stepped in from the middle of a curve of its outer
// loop (the material is on the left), tested on the exact curves. Smaller steps for a thin region.
function sampleOf(region: Region): Vec2 | undefined {
  const outer = region.outer.exact;
  if (!outer) return undefined;
  const length = (c: (typeof outer)[number]): number => (c.type === 'line' ? dist2(c.from, c.to) : c.type === 'arc' ? Math.abs(c.sweep) * c.radius : TAU * c.radius);
  const curves = [...outer].sort((p, q) => length(q) - length(p));
  for (const k of [8, 64, 512, 4096, 32768]) {
    for (const c of curves) {
      const d = length(c) / k;
      if (d < 10 * tol) continue;
      let p: Vec2;
      if (c.type === 'line') {
        const [dx, dy] = [c.to[0] - c.from[0], c.to[1] - c.from[1]];
        const l = Math.hypot(dx, dy);
        p = [(c.from[0] + c.to[0]) / 2 - (dy / l) * d, (c.from[1] + c.to[1]) / 2 + (dx / l) * d];
      } else if (c.type === 'arc') {
        const angle = c.start + c.sweep / 2;
        const inward = c.sweep > 0 ? -1 : 1;
        p = [c.center[0] + (c.radius + inward * d) * Math.cos(angle), c.center[1] + (c.radius + inward * d) * Math.sin(angle)];
      } else p = [c.center[0] + c.radius + (c.ccw ? -d : d), c.center[1]];
      if (inRegion(p, region)) return p;
    }
  }
  return undefined;
}
const inRegion = (p: Vec2, region: Region): boolean => region.outer.exact !== undefined && inside(p, region.outer.exact) && !region.holes.some((hole) => hole.exact !== undefined && inside(p, hole.exact));

// A region of a feature as it was: rebuilt from its curves and the outline curves that cross none of
// them nor any curve kept, left out in three stages (design.md, "Regions").
function regionAsItWas(world: World, joins: (id: Id) => Id, region: RegionRef, chord: number): Region | undefined {
  const own = region.outerLoop;
  const curve = (id: Id): SketchCurve | undefined => world.curves.get(id);
  if (!own.every((id) => curve(id)?.regions)) return undefined;
  let others = [...world.curves.values()].filter((c) => c.regions && !own.includes(c.id));
  // 1. what touches a curve of the region apart from a common point
  others = others.filter((o) => own.every((id) => !curvesTouch(curve(id) as SketchCurve, o, joins, world.geometry)));
  // 2. what has a free end, counted among the curves left that are not the region's
  for (;;) {
    const count = new Map<Id, number>();
    for (const o of others) for (const p of endsOf(o.shape)) count.set(joins(p), (count.get(joins(p)) ?? 0) + 1);
    const free = others.filter((o) => endsOf(o.shape).some((p) => (count.get(joins(p)) ?? 0) < 2));
    if (free.length === 0) break;
    others = others.filter((o) => !free.includes(o));
  }
  // 3. what still touches another
  for (;;) {
    const bad = others.filter((o) => others.some((q) => q !== o && curvesTouch(o, q, joins, world.geometry)));
    if (bad.length === 0) break;
    others = others.filter((o) => !bad.includes(o));
  }
  const profile = profileOf([...own.map((id) => curve(id) as SketchCurve), ...others], joins, world.geometry, chord);
  return profile.valid ? profile.regions.find((r) => sameRegion(r.ref, region)) : undefined;
}

// The faces of the cut sketch: the sketch after the batch with the trimmed piece put back, every
// contact of outline curves cut in memory (design.md, "Regions"). Undefined when they are not
// a valid profile.
function facesOf(after: World, putBack: SketchCurve[], extraPoints: Record<Id, Point2>, chord: number): Profile {
  const sketch: SketchFeature = { ...after.sketch, curves: { ...after.sketch.curves }, points: { ...after.sketch.points, ...extraPoints } };
  for (const curve of putBack) sketch.curves[curve.id] = curve.shape as Curve;
  const geometry = { points: { ...after.geometry.points, ...extraPoints }, radii: { ...after.geometry.radii } };
  const nonOwn = [...after.curves.values()].filter((c) => c.source !== 'own');
  const world = worldOf(after.doc, sketch, geometry, nonOwn);
  let counter = 0;
  const temp: NewId = (kind) => `\u0000face${kind}${++counter}`;
  const repair = repairEvents(world);
  const resolved = resolve(world, repair.events, temp);
  for (const [id, at] of resolved.added) geometry.points[id] = { x: at[0], y: at[1] };
  const curves: SketchCurve[] = [];
  for (const c of world.curves.values()) {
    const nodes = resolved.nodes.get(c.id);
    const carrier = carrierOf(world, c.id);
    if (!nodes || !carrier || c.source !== 'own') {
      curves.push(c);
      continue;
    }
    const sorted = [...nodes].sort((p, q) => paramOf(carrier, p.at) - paramOf(carrier, q.at)).map((n) => n.point);
    const shape = c.shape;
    if (shape.type === 'circle') {
      if (sorted.length < 2) curves.push(c);
      else sorted.forEach((p, i) => curves.push({ ...c, id: `${c.id}\u0000${i}`, shape: { type: 'arc', center: shape.center, start: p, end: sorted[(i + 1) % sorted.length] } }));
      continue;
    }
    const chain = [endsOf(shape)[0], ...sorted, endsOf(shape)[1]];
    for (let i = 0; i + 1 < chain.length; i++) {
      curves.push({ ...c, id: `${c.id}\u0000${i}`, shape: shape.type === 'line' ? { type: 'line', a: chain[i], b: chain[i + 1] } : { type: 'arc', center: shape.center, start: chain[i], end: chain[i + 1] } });
    }
  }
  const pairs: [Id, Id][] = [...Object.values(sketch.constraints).flatMap((c): [Id, Id][] => (c.type === 'coincident' ? [[c.a, c.b]] : [])), ...repair.ends];
  return profileOf(curves, joinsOf(pairs, geometry), geometry, chord);
}

// The geometry of the piece a trim removes, to put back into the faces: a curve over points of the
// sketch after the batch where they are there, else over points of its own.
function removedPiece(world: World, plan: Plan, spec: CutSpec, afterSketch: SketchFeature): { curves: SketchCurve[]; points: Record<Id, Point2> } {
  const trim = spec.trim;
  if (!trim) return { curves: [], points: {} };
  const { X, carrier, piece } = trim;
  const points: Record<Id, Point2> = {};
  let counter = 0;
  const pointAt = (at: Vec2, known?: Id): Id => {
    if (known !== undefined && (known === ORIGIN || has(afterSketch.points, known))) return known;
    const id = `\u0000put${++counter}`;
    points[id] = { x: at[0], y: at[1] };
    return id;
  };
  const original = world.sketch.curves[X];
  const ends = endsOf(original);
  const from = piece.lo ? pointAt(piece.lo.at, findPoint(plan, piece.lo.at, world)) : pointAt(pointOn(carrier, piece.from), ends[0]);
  const to = piece.hi ? pointAt(piece.hi.at, findPoint(plan, piece.hi.at, world)) : pointAt(pointOn(carrier, carrier.type === 'arc' ? carrier.sweep : piece.to), ends[1]);
  const id = '\u0000putback';
  let shape: SketchCurve['shape'];
  switch (original.type) {
    case 'line':
      shape = { type: 'line', a: from, b: to };
      break;
    case 'arc':
      shape = { type: 'arc', center: pointAt(position(world, original.center) as Vec2, original.center), start: from, end: to };
      break;
    case 'circle': {
      const center = pointAt(position(world, original.center) as Vec2, original.center);
      if (trim.whole) return { curves: [{ id, shape: { type: 'circle', center }, source: 'own', regions: true }], points: { ...points } };
      shape = { type: 'arc', center, start: from, end: to };
      break;
    }
    default:
      return unreachable(original, 'curve');
  }
  return { curves: [{ id, shape, source: 'own', regions: true }], points };
}
const findPoint = (plan: Plan, at: Vec2, world: World): Id | undefined => {
  for (const [id, p] of plan.model.points) if (dist2(xy(p), at) <= tol) return id;
  return position(world, ORIGIN) && dist2([0, 0], at) <= tol ? ORIGIN : undefined;
};

interface Patches {
  commands: Command[];
  patched: Id[];
  dropped: Id[];
  pending: Id[];
  shortened: Id[];
  broken: Id[];
}

// The regions and walls of the features over the sketch, patched in the same batch.
function patchFeatures(world: World, plan: Plan, spec: CutSpec, afterDoc: Document, request: CutRequest): Patches {
  const { sketch, doc } = world;
  const chord = doc.settings.chordTolerance;
  const out: Patches = { commands: [], patched: [], dropped: [], pending: [], shortened: [], broken: [] };
  const afterSketch = afterDoc.features.find((f) => f.id === sketch.id) as SketchFeature;
  const afterPoints: Record<Id, Point2> = { ...world.geometry.points };
  for (const [id, at] of plan.model.newPoints) afterPoints[id] = { x: at[0], y: at[1] };
  const nonOwn = [...world.curves.values()].filter((c) => c.source !== 'own');
  const after = worldOf(afterDoc, afterSketch, { points: afterPoints, radii: world.geometry.radii }, nonOwn);
  let profileAfter: Profile | undefined;
  let faces: Profile | undefined;
  const changed = new Set<Id>([...plan.cuts.keys(), ...plan.repointed]);
  const piecesOf = (X: Id): Id[] => {
    const cut = plan.cuts.get(X);
    return cut ? cut.pieces.map((piece) => piece.id) : [X];
  };
  const joinsBefore = joinsOf([...Object.values(sketch.constraints).flatMap((c): [Id, Id][] => (c.type === 'coincident' ? [[c.a, c.b]] : [])), ...plan.joined], world.geometry);
  for (const feature of doc.features) {
    const source = profileSourceOf(feature);
    if (!source || source.sketch !== sketch.id) continue;
    if (source.type === 'regions') {
      if (!source.regions.some((region) => region.outerLoop.some((id) => changed.has(id)))) {
        // untouched by name; it may still have been cut by a curve it does not name
        profileAfter ??= profileOf([...after.curves.values()], after.joins, after.geometry, chord);
        if (!profileAfter.valid || source.regions.every((region) => profileAfter?.regions.some((r) => sameRegion(r.ref, region)))) continue;
      }
      profileAfter ??= profileOf([...after.curves.values()], after.joins, after.geometry, chord);
      let regions: RegionRef[];
      let dropped = false;
      if (!profileAfter.valid) {
        // still crossed: rewritten by names, followed by the next tool that leaves the sketch valid
        regions = [];
        for (const region of source.regions) {
          if (!region.outerLoop.some((id) => changed.has(id))) {
            regions.push(region);
            continue;
          }
          const outerLoop = [...new Set(region.outerLoop.flatMap(piecesOf))].sort();
          if (outerLoop.length > 0) regions.push({ ...region, outerLoop });
          else dropped = true;
        }
        if (regions.length === 0) regions = source.regions;
        out.pending.push(feature.id);
      } else {
        const kept: RegionRef[] = [];
        const added: RegionRef[] = [];
        for (const region of source.regions) {
          if (profileAfter.regions.some((r) => sameRegion(r.ref, region))) {
            kept.push(region);
            continue;
          }
          // nothing was removed (a split, an extension): the faces are the regions after
          if (!spec.trim) faces ??= profileAfter;
          faces ??= (() => {
            const put = removedPiece(world, plan, spec, afterSketch);
            const duplicate = put.curves.length > 0 && lyingOnKept(after, put, chord);
            return facesOf(after, duplicate ? [] : put.curves, duplicate ? {} : put.points, chord);
          })();
          const was = regionAsItWas(world, joinsBefore, region, chord);
          if (!was || !faces.valid) {
            kept.push(region);
            dropped = true;
            continue;
          }
          const into: RegionRef[] = [];
          for (const face of faces.regions) {
            const p = sampleOf(face);
            if (!p || !inRegion(p, was)) continue;
            const hit = profileAfter.regions.find((r) => inRegion(p, r));
            if (hit && !into.some((r) => sameRegion(r, hit.ref))) into.push(hit.ref);
          }
          if (into.length === 0) dropped = true;
          for (const r of into) if (!kept.some((k) => sameRegion(k, r)) && !added.some((a) => sameRegion(a, r))) added.push(r);
        }
        regions = [...kept, ...added.filter((a) => !kept.some((k) => sameRegion(k, a)))];
        if (regions.length === 0) regions = source.regions;
      }
      if (dropped) out.dropped.push(feature.id);
      if (JSON.stringify(regions) !== JSON.stringify(source.regions)) {
        out.commands.push({ type: 'updateFeature', id: feature.id, patch: { profile: { regions } } as FeaturePatch });
        out.patched.push(feature.id);
      }
    } else if (source.type === 'wall') {
      if (!source.curves.some((id) => changed.has(id))) continue;
      const curves = source.curves.flatMap((id) => (plan.cuts.has(id) ? piecesOf(id) : [id]));
      if (curves.length === 0) {
        out.broken.push(feature.id);
        continue;
      }
      if (source.curves.some((id) => plan.cuts.get(id)?.lostPiece)) out.shortened.push(feature.id);
      if (JSON.stringify(curves) !== JSON.stringify(source.curves)) {
        out.commands.push({ type: 'updateFeature', id: feature.id, patch: { profile: { curves } } as FeaturePatch });
        out.patched.push(feature.id);
      }
    }
  }
  void request;
  return out;
}

// Does the put-back piece lie along a curve that stays (a duplicate)? It bounds nothing the other
// does not, and put back it would make the faces invalid.
function lyingOnKept(after: World, put: { curves: SketchCurve[]; points: Record<Id, Point2> }, chord: number): boolean {
  void chord;
  const [curve] = put.curves;
  const points = { ...after.geometry.points, ...put.points };
  const world = worldOf(after.doc, { ...after.sketch, points: { ...after.sketch.points, ...put.points } }, { points, radii: after.geometry.radii }, [...after.curves.values()].filter((c) => c.source !== 'own'));
  world.curves.set(curve.id, curve);
  return [...after.curves.values()].some((c) => c.regions && world.contacts(curve.id, c.id).lying);
}

// ---------------------------------------------------------------- the lists

function lists(world: World, plan: Plan, patches: Patches): CutIds {
  const { sketch, doc } = world;
  const model = plan.model;
  const changed = [...new Set([...[...plan.cuts.values()].filter((cut) => !cut.whole).map((cut) => cut.id), ...plan.repointed])].sort();
  const added: Id[] = [];
  for (const X of changed) for (const piece of plan.cuts.get(X)?.pieces ?? []) if (piece.id !== X) added.push(piece.id);
  const span = model.newCurves.filter((id) => model.curves.get(id)?.construction === true && !added.includes(id));
  const points = plan.pointsAtCuts.filter((p) => model.points.has(p) || p === ORIGIN);
  const constraints = model.newConstraints.filter((id) => model.constraints.has(id));
  const reattached = [...model.constraints.keys()].filter((id) => has(sketch.constraints, id) && (model.moved.has(id) || constraintOperands(sketch.constraints[id]).some((operand) => model.curves.get(operand)?.type !== sketch.curves[operand]?.type && has(sketch.curves, operand)))).sort();
  const removedCurves = Object.keys(sketch.curves).filter((id) => !model.curves.has(id)).sort();
  const removedPoints = Object.keys(sketch.points).filter((id) => !model.points.has(id)).sort();
  const removedConstraints = Object.keys(sketch.constraints).filter((id) => !model.constraints.has(id)).sort();
  // the start of a line re-pointed: a plane on its side face moves along the line
  const starts = Object.keys(sketch.curves).filter((id) => {
    const [was, now] = [sketch.curves[id], model.curves.get(id)];
    return was.type === 'line' && now?.type === 'line' && was.a !== now.a;
  });
  const moved: Id[] = [];
  const shortened: Id[] = [...patches.shortened];
  const broken: Id[] = [...patches.broken];
  const removedSet = new Set(removedCurves);
  for (const feature of doc.features) {
    if (feature.id === sketch.id) continue;
    if ((feature.type === 'sketch' && planeOn(feature.plane, starts)) || (feature.type === 'plane' && planeOn(feature.base, starts))) moved.push(feature.id);
    // what a feature reads directly: a sketch its plane and the edges it projects, another feature
    // every face it names
    const read = feature.type === 'sketch' ? Object.values(feature.external).flatMap((ref) => kindOf(ref).faces(ref)) : facesIn(feature);
    const faces = feature.type === 'sketch' ? [...facesIn(feature.plane), ...read] : read;
    if (faces.some((face) => sideOf(face, removedCurves)) || sketchLinesIn(feature, sketch.id).some((line) => removedSet.has(line)) || wallEndBroken(world, model, faces)) {
      if (!broken.includes(feature.id)) broken.push(feature.id);
      continue;
    }
    if ((feature.type === 'sketch' || feature.type === 'chamfer' || feature.type === 'fillet') && read.some((face) => sideOf(face, changed)) && !moved.includes(feature.id) && !shortened.includes(feature.id)) shortened.push(feature.id);
  }
  const order = (ids: Id[]): Id[] => doc.features.map((f) => f.id).filter((id) => ids.includes(id));
  // the entries of the sections that name what goes: an axis on a removed line or point
  const sectionEntries: Id[] = [];
  for (const name of Object.keys(DOCUMENT_SECTIONS) as (keyof typeof DOCUMENT_SECTIONS)[]) {
    const section = doc[name] as unknown;
    if (typeof section !== 'object' || section === null) continue;
    for (const group of Object.values(section as Record<string, unknown>)) {
      if (typeof group !== 'object' || group === null || Array.isArray(group)) continue;
      for (const [key, entry] of Object.entries(group as Record<string, unknown>)) {
        const lines = sketchLinesIn(entry, sketch.id);
        const pointsOf = sketchPointsIn(entry, sketch.id);
        if (lines.some((line) => removedSet.has(line)) || pointsOf.some((p) => removedPoints.includes(p)) || facesIn(entry).some((face) => sideOf(face, removedCurves))) sectionEntries.push(key);
      }
    }
  }
  return {
    changed,
    added,
    span,
    points,
    constraints,
    reattached,
    removed: [...removedCurves, ...removedPoints, ...removedConstraints],
    uncut: [...plan.uncut].sort(),
    patched: order(patches.patched),
    dropped: order(patches.dropped),
    pending: order(patches.pending),
    moved: order(moved),
    shortened: order(shortened.filter((id) => !moved.includes(id))),
    broken: [...order(broken), ...[...new Set(sectionEntries)].sort()],
  };
}

function sketchPointsIn(value: unknown, sketch: Id, into: Id[] = []): Id[] {
  if (Array.isArray(value)) for (const item of value) sketchPointsIn(item, sketch, into);
  else if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>;
    if (o.kind === 'sketchPoint' && o.sketch === sketch && typeof o.point === 'string') into.push(o.point);
    for (const item of Object.values(o)) sketchPointsIn(item, sketch, into);
  }
  return into;
}

// A straight end of a wall over the sketch (`wallEnd` with a point) whose chain no longer ends there.
function wallEndBroken(world: World, model: Model, faces: FaceName[]): boolean {
  for (const face of faces) {
    if (face.role !== 'wallEnd') continue;
    const wall = world.doc.features.find((f) => f.id === face.feature);
    const source = wall ? profileSourceOf(wall) : undefined;
    if (source?.type !== 'wall' || source.sketch !== world.sketch.id) continue;
    // the curves of the wall after the batch: the pieces of a cut curve in its place
    const curves = source.curves.flatMap((id) => {
      const out: Id[] = [];
      if (model.curves.has(id)) out.push(id);
      return out;
    });
    let count = 0;
    for (const id of curves) for (const p of endsOf(model.curves.get(id) as Curve)) if (p === face.point) count++;
    const before = source.curves.filter((id) => endsOf(world.sketch.curves[id] ?? { type: 'circle', center: '' }).includes(face.point)).length;
    if (before === 1 && count !== 1) return true;
  }
  return false;
}

// ---------------------------------------------------------------- the entry

// Runs trim, extend or split: the batch with its patches and the lists, or the reason it cannot.
export function cutTool(context: SketchToolCall, request: CutRequest, newId: NewId): SketchToolResult {
  const world = worldOfContext(context);
  if (typeof world === 'string') return failed(world);
  let spec: CutSpec | string;
  switch (request.tool) {
    case 'trim': {
      const problem = curveProblem(world, request.curve, request.with);
      if (problem) return failed(problem);
      spec = trimSpec(world, request);
      break;
    }
    case 'extend': {
      const problem = curveProblem(world, request.curve, request.with);
      if (problem) return failed(problem);
      spec = extendSpec(world, request);
      break;
    }
    case 'split': {
      if (request.curve !== undefined) {
        const problem = curveProblem(world, request.curve, request.with);
        if (problem) return failed(problem);
      } else if (request.with !== undefined || request.at !== undefined) return failed('`with` and `at` need `curve`');
      spec = splitSpec(world, request);
      break;
    }
    default:
      return unreachable(request, 'tool');
  }
  if (typeof spec === 'string') return failed(spec);
  const plan = makePlan(world, spec, newId);
  if (plan.refusal) return failed(plan.refusal);
  if (plan.commands.length === 0) {
    if (request.tool === 'split' && request.curve !== undefined) {
      const uncut = [...plan.uncut];
      return failed(uncut.includes(request.curve) ? `the circle "${request.curve}" is touched at one point only; one point does not split a circle` : `nothing can be cut on "${request.curve}"`);
    }
    if (request.tool === 'split') {
      const reason = invalidReason(world);
      if (reason) return failed(reason);
    }
  }
  let afterDoc: Document;
  try {
    afterDoc = applyCommand(context.document, { type: 'batch', commands: plan.commands });
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
  const patches = patchFeatures(world, plan, spec, afterDoc, request);
  const ids = lists(world, plan, patches);
  return { ok: true, commands: [...plan.commands, ...patches.commands], ids };
}

// Why the profile of the sketch is invalid although no contact can be cut, if it is: what split
// without a curve refuses with, and what the app says when it marks no contact.
function invalidReason(world: World): string | undefined {
  const profile = [...world.curves.values()].filter((c) => c.regions);
  const valid = profileOf(profile, world.joins, world.geometry, world.doc.settings.chordTolerance).valid;
  if (valid) return undefined;
  for (const c of profile) if (!carrierOf(world, c.id)) return `the curve "${c.id}" has no length`;
  for (let i = 0; i < profile.length; i++) {
    for (let j = i + 1; j < profile.length; j++) {
      const found = world.contacts(profile[i].id, profile[j].id);
      if (found.lying) return `"${profile[i].id}" and "${profile[j].id}" lie on each other; trim or remove one of them`;
    }
  }
  const touched = [...world.curves.values()].filter((c) => c.shape.type === 'circle' && c.regions);
  for (const c of touched) {
    for (const other of profile) {
      if (other.id !== c.id && world.contacts(c.id, other.id).points.length > 0) return `the circle "${c.id}" is touched at one point only, or by a curve that is not cut; a circle is cut at two points or more`;
    }
  }
  return 'the curves come too close to each other for the chord tolerance (a tessellation problem); move them apart or lower the chord tolerance';
}

// ---------------------------------------------------------------- what the app draws

// The piece `trim` would remove, from the cuts that select it only (not the repair of the sketch);
// undefined where the tool would refuse.
export function trimPiece(context: SketchToolCall, input: TrimInput): PieceShape | undefined {
  const world = worldOfContext(context);
  if (typeof world === 'string' || curveProblem(world, input.curve, input.with)) return undefined;
  const carrier = carrierOf(world, input.curve) as Carrier;
  const cuts = cutsOf(world, input.curve, cuttersOf(world, input.curve, input.with), carrier);
  const piece = pieceAround(carrier, cuts, nearestParam(carrier, input.at));
  return pieceShape(carrier, piece.from, piece.to);
}

// The end of a line or an arc nearest to a place: what the app offers for extend under the pointer.
export function extendEnd(context: SketchToolContext, curve: Id, at: Vec2): ExtendInput['end'] | undefined {
  if (!has(context.sketch.curves, curve)) return undefined;
  const c = context.sketch.curves[curve];
  const names = c.type === 'line' ? (['a', 'b'] as const) : c.type === 'arc' ? (['start', 'end'] as const) : [];
  const points = context.result?.points ?? context.sketch.points;
  let best: ExtendInput['end'] | undefined;
  let distance = Infinity;
  for (const name of names) {
    const id = (c as unknown as Record<string, Id>)[name];
    const p = has(points, id) ? points[id] : undefined;
    if (p && Math.hypot(p.x - at[0], p.y - at[1]) < distance) [best, distance] = [name, Math.hypot(p.x - at[0], p.y - at[1])];
  }
  return best;
}

// Where `extend` would move the end; undefined where it would refuse.
export function extendReach(context: SketchToolCall, input: ExtendInput): Vec2 | undefined {
  const world = worldOfContext(context);
  if (typeof world === 'string' || curveProblem(world, input.curve, input.with) || endProblem(world, input.curve, input.end)) return undefined;
  const reach = reachOf(world, input.curve, input.end, input.with);
  return typeof reach === 'string' ? undefined : reach.at;
}

// The contacts of the outline curves of a sketch, to be marked while its profile is invalid, and the
// reason when it is invalid without any.
export function profileContacts(context: SketchToolCall): { points: Vec2[]; reason?: string } {
  const world = worldOfContext(context);
  if (typeof world === 'string') return { points: [] };
  const { events, ends } = repairEvents(world);
  const points: Vec2[] = [];
  const add = (p: Vec2): void => {
    if (!points.some((q) => dist2(p, q) <= tol)) points.push(p);
  };
  for (const e of events) add(e.at);
  for (const [p] of ends) {
    const at = position(world, p);
    if (at) add(at);
  }
  return points.length > 0 ? { points } : { points, reason: invalidReason(world) };
}
