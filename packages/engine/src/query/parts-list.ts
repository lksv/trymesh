// The query `partsList` (D57): what to print and what to buy. The bodies of the state as rows of
// parts (a body and its unchanged copies one row with a count), and the hardware of the hole
// features, counted from the holes the model has. The design is docs/d36/3e-parts-list/design.md.
import { featuresWithInserted, sourceRoot } from '../features/index';
import { partName } from '../sections/body-properties';
import { shapeOrigin } from '../solid';
import type { BodyPropertiesResult, Document, FaceName, Id, Solid, Surface, Vec3 } from '../types';
import { ANGLE_TOLERANCE, LENGTH_TOLERANCE, cross3, dot3, len3, sub3 } from '../util';
import type { ArgSpecs } from './args';
import type { QueryContext, QuerySpec } from './spec';

// ---------------------------------------------------------------- the arguments

// No argument: the parts list is of the whole state asked about (now, `at` a feature, or a state
// a preview returned).
export const PARTS_LIST_ARGS = {} as const satisfies ArgSpecs;

// ---------------------------------------------------------------- the result

// One kind of part and the bodies that are it.
// - `name`: the name of the part (`partName`): the three copies of "M3x6 screw" are "M3x6 screw",
//   not "Screws / 1". Every body of a row has the name of the row.
// - `count`, `bodies`: how many, and which, in the order of the model.
// - `material`, `color`, `density` (g/cm3): of the body properties, own or inherited; the same for
//   every body of the row.
// - `volume`: mm3, of the first body of the row (the bodies are one mesh, moved).
// - `mass`, `massFrom`: g, of the first body, and where it came from (`mass`: a weighed part or
//   a data sheet; `density`: density times volume), as `evaluation.bodyProperties` has them.
// - `noMass`, in place of `mass`: `notStated` (the properties state neither a mass nor a density)
//   or `inError` (the one that would be used cannot be evaluated; `get_model` has the message).
// - `totalMass`: g, the sum over the bodies of the row; absent with `noMass`.
// - `copyOf`: the body the chain of sources of the bodies starts at (`sourceRoot`), when it is
//   a body of the state and not in this row. With it, one of:
//   - nothing more: the row is the mesh of that body, with other properties or another name;
//   - `mirrored`: the row is the mesh of that body, mirrored;
//   - `differs`: the row is not that body's mesh any more: a feature changed the row's bodies, or
//     that body, after the copy. A changed row says no hand: its shape is its own.
export interface PartRow {
  name: string;
  count: number;
  bodies: Id[];
  material?: string;
  color?: string;
  volume: number;
  density?: number;
  mass?: number;
  massFrom?: 'mass' | 'density';
  noMass?: 'notStated' | 'inError';
  totalMass?: number;
  copyOf?: Id;
  mirrored?: true;
  differs?: true;
}
// A hole feature and the holes of it that the model has.
export interface HoleCount {
  feature: Id;
  count: number;
}
// The holes that carry one label: a piece of hardware per hole.
// - `label`: the label of the hole features, as it is written (rows are joined by the exact text).
// - `count`: the holes of the model with that label.
// - `holes`: the hole features with the label and the holes of each, in the order of the timeline.
export interface HardwareRow {
  label: string;
  count: number;
  holes: HoleCount[];
}
// The sums of a list of rows of bodies: `count` bodies, `mass` in g of those that have one,
// `withoutMass` how many have none and are not in `mass`.
export interface PartsSum {
  count: number;
  mass: number;
  withoutMass: number;
}
// The answer. Every body of the state is in exactly one place: a row of `printed`, a row of
// `bought`, or `auxiliary`.
// - `printed`: the bodies with the use `part` (the default), what is to be printed.
// - `bought`: the bodies with the use `reference`: bought or given parts, with the mass of their
//   data sheet.
// - `hardware`: what goes into the labelled holes: screws, nuts, inserts. No masses.
// - `unlabelled`: hole features without a label that made holes; only when there are some.
// - `auxiliary`: the bodies with the use `auxiliary`, which are no parts; only when there are some.
// - `totals`: the sums; `hardware.count` is the number of labelled holes.
export interface PartsList {
  printed: PartRow[];
  bought: PartRow[];
  hardware: HardwareRow[];
  unlabelled?: HoleCount[];
  auxiliary?: Id[];
  totals: { printed: PartsSum; bought: PartsSum; hardware: { count: number } };
}

declare module './spec' {
  interface Queries {
    partsList: { spec: typeof PARTS_LIST_ARGS; result: PartsList };
  }
}

// ---------------------------------------------------------------- the holes of the model

// Holes are counted from the model, not from the document, by where they are and how far along
// their axes they reach.
// - A hole is there when its bore or its head (`holeBore`, `holeHead`: a cylinder or a cone, so
//   a face with an axis) is a face of one of `bodies`.
// - A cut is what one build of a hole feature left in the bodies of one placement: the faces of
//   that feature with the same point and the same copy tags, in whichever bodies they are. One
//   build gives one face number in every target, so a bore through two bodies, or through the two
//   flanges of one body, is one cut, and a cut is always one hole. A copy of a pattern of features
//   starts its tags with that pattern, a copy of a body made afterwards adds one: each is a cut of
//   its own.
// - A cut has a line, the axis of its surfaces (a cylinder's `origin`, a cone's `apex`, `axis`),
//   and per body an interval of it: from the lowest to the highest point of the triangles of its
//   faces in that body, measured along the line. The gap between two bodies of one cut is in no
//   interval.
// - Two cuts of one feature are one hole when they lie on one line (`sameLine`) and an interval of
//   one touches or overlaps an interval of the other (`touch`); joined one after the other (a stack
//   of three copies is one hole). The count of a feature is the number of its holes.
// So a point whose hole missed every body, a copy of a pattern that ran off the part, a hole
// a later cut removed whole and a suppressed feature count nothing; a copy of a pattern of the
// feature that cuts its own hole again adds nothing; a plate copied onto itself, or a half mirrored
// in its parting plane, continues the hole; copies of a body at other places, also on the same line
// and in the gap of a cut through two bodies, have holes of their own. Two bodies of one cut with
// a gap between them, both copied by patterns, are two holes per copied pair (a known limit).
//
// `bodies` are the bodies to look in (the caller leaves the auxiliary ones out), with their solids
// (the triangles of a face are those whose `faceIds` entry is its number); `surface` answers the
// surface of a face of a body by its number. The cost is a pass over the triangles of the bodies
// that have a bore or a head, and a comparison of the cuts of each feature that may lie on one
// line (sorted by where their lines pass the origin; 5000 cuts of one feature on a grid take tens
// of milliseconds).
interface Span {
  from: number;
  to: number;
  reach: Vec3; // the largest coordinate of the triangles of the span along each axis, as a magnitude
}
interface Cut {
  point: Vec3;
  direction: Vec3; // a unit vector
  offAxis: number; // the distance of the line from the origin
  spans: Map<Id, Span>;
}
// One line: parallel within the angle tolerance, the point of one on the other within
// max(`LENGTH_TOLERANCE`, 1e-9 × the larger distance of the two lines from the origin). The
// surfaces are moved in double precision, and where on a line its point lies does not matter.
// It runs for many pairs of cuts of a feature, so it reads the lines from one array of numbers
// (`linesOf`: per cut the point, the direction and the distance from the origin) and compares
// squares. It asks whether the point of `b` lies on the line of `a`; the caller passes the cut
// that comes first in the list as `a`.
const LINE = 7;
// The direction the feet of the lines are sorted along: none of the axes of the model, so that
// holes in a grid along them do not pile up at one key.
const SWEEP: Vec3 = [0.8017837257372732, 0.5345224838248488, 0.2672612419124244]; // (3, 2, 1) / √14
function linesOf(cuts: readonly Cut[]): Float64Array {
  const lines = new Float64Array(LINE * cuts.length);
  cuts.forEach((cut, i) => lines.set([...cut.point, ...cut.direction, cut.offAxis], LINE * i));
  return lines;
}
function sameLine(lines: Float64Array, a: number, b: number): boolean {
  const i = LINE * a;
  const j = LINE * b;
  const ax = lines[i + 3];
  const ay = lines[i + 4];
  const az = lines[i + 5];
  const bx = lines[j + 3];
  const by = lines[j + 4];
  const bz = lines[j + 5];
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  if (cx * cx + cy * cy + cz * cz > ANGLE_TOLERANCE * ANGLE_TOLERANCE) return false;
  const dx = lines[j] - lines[i];
  const dy = lines[j + 1] - lines[i + 1];
  const dz = lines[j + 2] - lines[i + 2];
  const ex = dy * az - dz * ay;
  const ey = dz * ax - dx * az;
  const ez = dx * ay - dy * ax;
  const precision = Math.max(LENGTH_TOLERANCE, 1e-9 * Math.max(lines[i + 6], lines[j + 6]));
  return ex * ex + ey * ey + ez * ez <= precision * precision;
}
// An interval of one touches or overlaps an interval of the other, within max(`LENGTH_TOLERANCE`,
// 1e-6 × the coordinates of their triangles as the line sees them): the sum over the axes of the
// component of the direction times the largest coordinate along that axis. The triangles are
// float32, and only the coordinates along the line move a point along it.
function touch(a: Cut, b: Cut): boolean {
  const offset = dot3(sub3(b.point, a.point), a.direction);
  const alike = dot3(a.direction, b.direction) > 0;
  for (const p of a.spans.values())
    for (const q of b.spans.values()) {
      const [from, to] = alike ? [offset + q.from, offset + q.to] : [offset - q.to, offset - q.from];
      const along = Math.abs(a.direction[0]) * Math.max(p.reach[0], q.reach[0]) + Math.abs(a.direction[1]) * Math.max(p.reach[1], q.reach[1]) + Math.abs(a.direction[2]) * Math.max(p.reach[2], q.reach[2]);
      const precision = Math.max(LENGTH_TOLERANCE, 1e-6 * along);
      if (from <= p.to + precision && p.from <= to + precision) return true;
    }
  return false;
}
export function holeCounts(doc: Document, bodies: Readonly<Record<Id, { solid: Solid; faces: readonly { id: number }[] }>>, faceNames: readonly FaceName[], surface: (body: Id, face: number) => Surface | undefined): Map<Id, number> {
  // the hole features of the document and of the documents it inserts, under their prefixed IDs (D62)
  const holes = new Set(featuresWithInserted(doc).filter((f) => f.feature.type === 'hole').map((f) => f.id));
  // feature → cut (its point and its copy tags) → where it is
  const cuts = new Map<Id, Map<string, Cut>>();
  for (const [id, body] of Object.entries(bodies)) {
    const mine = new Map<number, { cut: Cut; span: Span }>(); // the bores and heads of this body
    for (const face of body.faces) {
      const name = faceNames[face.id];
      if (!name || !holes.has(name.feature) || (name.role !== 'holeBore' && name.role !== 'holeHead')) continue;
      const shape = surface(id, face.id);
      if (shape?.kind !== 'cylinder' && shape?.kind !== 'cone') continue;
      const length = len3(shape.axis);
      const point = shape.kind === 'cylinder' ? shape.origin : shape.apex;
      // a surface without a direction or with a number that is not finite has no line (the review of D57:
      // one such cut made the bound of the comparison below NaN for its whole feature)
      if (!(length > 0) || !Number.isFinite(length) || !point.every(Number.isFinite)) continue;
      let ofFeature = cuts.get(name.feature);
      if (!ofFeature) cuts.set(name.feature, (ofFeature = new Map()));
      const key = JSON.stringify([name.point, name.copy ?? []]);
      let cut = ofFeature.get(key);
      if (!cut) {
        const direction: Vec3 = [shape.axis[0] / length, shape.axis[1] / length, shape.axis[2] / length];
        ofFeature.set(key, (cut = { point, direction, offAxis: len3(cross3(point, direction)), spans: new Map() }));
      }
      let span = cut.spans.get(id);
      if (!span) cut.spans.set(id, (span = { from: Infinity, to: -Infinity, reach: [0, 0, 0] }));
      mine.set(face.id, { cut, span });
    }
    if (mine.size === 0) continue;
    const { positions, triangles, faceIds } = body.solid;
    for (let t = 0; t < faceIds.length; t++) {
      const found = mine.get(faceIds[t]);
      if (found === undefined) continue;
      const { cut, span } = found;
      for (let corner = 0; corner < 3; corner++) {
        const v = 3 * triangles[3 * t + corner];
        const [x, y, z] = [positions[v], positions[v + 1], positions[v + 2]];
        const along = (x - cut.point[0]) * cut.direction[0] + (y - cut.point[1]) * cut.direction[1] + (z - cut.point[2]) * cut.direction[2];
        if (along < span.from) span.from = along;
        if (along > span.to) span.to = along;
        const { reach } = span;
        if (Math.abs(x) > reach[0]) reach[0] = Math.abs(x);
        if (Math.abs(y) > reach[1]) reach[1] = Math.abs(y);
        if (Math.abs(z) > reach[2]) reach[2] = Math.abs(z);
      }
    }
  }
  const counts = new Map<Id, number>();
  for (const [feature, ofFeature] of cuts) {
    // a face without a triangle covers nothing
    const list = [...ofFeature.values()].filter((cut) => [...cut.spans.values()].some((span) => span.from <= span.to));
    // a cut is one hole; cuts on one line with intervals that touch are one hole, joined one after the other
    const lines = linesOf(list);
    const group = Int32Array.from(list, (_, index) => index);
    const find = (index: number): number => {
      let root = index;
      while (group[root] !== root) root = group[root];
      for (let at = index; group[at] !== root; ) {
        const next = group[at];
        group[at] = root;
        at = next;
      }
      return root;
    };
    // Only pairs that can lie on one line are compared: the cuts sorted by where their lines pass
    // the origin (`foot`), along one direction, and a pair compared while they are within the
    // bound `reach` of each other there. Two cuts on one line (`sameLine`) have feet at most
    // 2 × its precision + the sine of the angle between them × the distance of a point of one from
    // the origin apart, so the bound keeps every such pair and the count is that of all pairs.
    // The bound is one for the whole feature, from its cut furthest from the origin: one cut far
    // away widens it for all, and the work tends back towards all pairs (the counts do not change).
    const along = (cut: Cut): number => {
      const [px, py, pz] = cut.point;
      const [dx, dy, dz] = cut.direction;
      const t = px * dx + py * dy + pz * dz;
      return (px - t * dx) * SWEEP[0] + (py - t * dy) * SWEEP[1] + (pz - t * dz) * SWEEP[2];
    };
    const keys = list.map(along);
    const order = list.map((_, index) => index).sort((a, b) => keys[a] - keys[b]);
    const far = list.reduce((most, cut) => Math.max(most, len3(cut.point), cut.offAxis), 0);
    const reach = 4 * Math.max(LENGTH_TOLERANCE, 1e-9 * far) + 2 * ANGLE_TOLERANCE * far;
    for (let x = 0; x < order.length; x++)
      for (let y = x + 1; y < order.length && keys[order[y]] - keys[order[x]] <= reach; y++) {
        const [a, b] = order[x] < order[y] ? [order[x], order[y]] : [order[y], order[x]];
        if (sameLine(lines, a, b) && touch(list[a], list[b])) {
          const ra = find(a);
          const rb = find(b);
          if (ra !== rb) group[ra] = rb;
        }
      }
    const count = new Set(list.map((_, index) => find(index))).size;
    if (count > 0) counts.set(feature, count);
  }
  return counts;
}

// ---------------------------------------------------------------- the rows of bodies

// What a body weighs by, for the key of a row: the mass the properties resolved, by its source and
// its number; without one, whether a field is in error or nothing is stated. (A mass that is stated
// beside a density in error is a mass.)
const weighsBy = (p: BodyPropertiesResult): string => (p.mass !== undefined ? (p.massFrom === 'mass' ? `mass ${p.mass}` : `density ${p.density}`) : p.fieldErrors ? 'error' : 'none');

// Two bodies are in one row when all of this holds:
// 1. their solids have the same origin (`shapeOrigin`: one mesh, moved) and the same hand; a body
//    whose volume is not above zero (a copy float32 could not hold) is taken for no copy;
// 2. their properties say the same: `use`, `material`, `color`, `density`, and what they weigh by;
// 3. they have the same name (`partName`).
// The rows are in the order of their first bodies in the model. Nothing is measured.
function partsListOf(context: QueryContext): PartsList {
  const { document: doc, evaluation } = context.state;
  const properties = evaluation.bodyProperties;
  const originOf = (id: Id) => (context.bodies[id].volume > 0 ? shapeOrigin(context.bodies[id].solid) : { solid: context.bodies[id].solid, mirrored: false });
  // a number per mesh, for the key of a row
  const meshes = new Map<Solid, number>();
  const numberOf = (solid: Solid): number => {
    let number = meshes.get(solid);
    if (number === undefined) meshes.set(solid, (number = meshes.size));
    return number;
  };
  const groups = new Map<string, Id[]>(); // in the order of their first bodies
  const auxiliary: Id[] = [];
  for (const id of Object.keys(context.bodies)) {
    const result = properties[id];
    if (result.use === 'auxiliary') {
      auxiliary.push(id);
      continue;
    }
    const origin = originOf(id);
    const key = JSON.stringify([numberOf(origin.solid), origin.mirrored, result.use, result.material ?? null, result.color ?? null, result.density ?? null, weighsBy(result), partName(doc, id)]);
    const group = groups.get(key);
    if (group) group.push(id);
    else groups.set(key, [id]);
  }
  const row = (bodies: Id[]): PartRow => {
    const first = properties[bodies[0]];
    const root = sourceRoot(doc, bodies[0]);
    // what the row comes from, when that body is in the state and not in the row, and whether the
    // row is still its mesh
    const origin = originOf(bodies[0]);
    const source = bodies.includes(root) || !Object.hasOwn(context.bodies, root) ? undefined : originOf(root);
    const same = source !== undefined && source.solid === origin.solid;
    return {
      name: partName(doc, bodies[0]),
      count: bodies.length,
      bodies,
      ...(first.material === undefined ? {} : { material: first.material }),
      ...(first.color === undefined ? {} : { color: first.color }),
      volume: context.bodies[bodies[0]].volume,
      ...(first.density === undefined ? {} : { density: first.density }),
      // the bodies of a row weigh by the same, so all of them have a mass or none has
      ...(first.mass === undefined || first.massFrom === undefined
        ? { noMass: first.fieldErrors ? ('inError' as const) : ('notStated' as const) }
        : { mass: first.mass, massFrom: first.massFrom, totalMass: bodies.reduce((sum, id) => sum + (properties[id].mass ?? 0), 0) }),
      ...(source === undefined ? {} : { copyOf: root }),
      ...(same && source.mirrored !== origin.mirrored ? { mirrored: true as const } : {}),
      ...(source !== undefined && !same ? { differs: true as const } : {}),
    };
  };
  const rowsOf = (use: 'part' | 'reference'): PartRow[] => [...groups.values()].filter((bodies) => properties[bodies[0]].use === use).map(row);
  const sum = (rows: PartRow[]): PartsSum => ({
    count: rows.reduce((total, r) => total + r.count, 0),
    mass: rows.reduce((total, r) => total + (r.totalMass ?? 0), 0),
    withoutMass: rows.reduce((total, r) => total + (r.totalMass === undefined ? r.count : 0), 0),
  });
  const [printed, bought] = [rowsOf('part'), rowsOf('reference')];

  // the hardware: the holes the bodies that are parts have, by the label of their feature
  const parts = Object.fromEntries(Object.entries(context.bodies).filter(([id]) => properties[id].use !== 'auxiliary'));
  const counts = holeCounts(doc, parts, evaluation.faceNames, (body, face) => context.surface(body, evaluation.faceNames[face]));
  const hardware: HardwareRow[] = [];
  const unlabelled: HoleCount[] = [];
  // an inserted hole feature (D62) stands at the place of its insertion, under its prefixed ID
  for (const { id, feature } of featuresWithInserted(doc)) {
    const count = counts.get(id);
    if (feature.type !== 'hole' || count === undefined) continue;
    const hole: HoleCount = { feature: id, count };
    const { label } = feature;
    if (label === undefined) {
      unlabelled.push(hole);
      continue;
    }
    const existing = hardware.find((candidate) => candidate.label === label);
    if (existing) {
      existing.count += count;
      existing.holes.push(hole);
    } else hardware.push({ label, count, holes: [hole] });
  }
  return {
    printed,
    bought,
    hardware,
    ...(unlabelled.length ? { unlabelled } : {}),
    ...(auxiliary.length ? { auxiliary } : {}),
    totals: { printed: sum(printed), bought: sum(bought), hardware: { count: hardware.reduce((total, r) => total + r.count, 0) } },
  };
}

// ---------------------------------------------------------------- the entry

export const partsList: QuerySpec<typeof PARTS_LIST_ARGS, PartsList> = {
  title: 'Parts list',
  // a parts list does not depend on a pose, and with this the entry reads every body, also one
  // whose pose is not known (D49)
  geometry: 'modelled',
  summary:
    'What to print and what to buy: the bodies of the model as rows of parts, and the hardware of the hole features. A printed part is a body with the use `part`, a bought part one with the use `reference` (body properties); auxiliary bodies are no parts. ' +
    'A body and its copies made by a pattern are one row with a count while they are the same part: a mirror image is another part, and so is a copy with another material, colour, mass or name, and a body that a feature changed after the pattern (so model what every copy should have before the pattern). ' +
    'Hardware is counted from the labels of the hole features: one piece per hole the model has, by where the holes are (a hole through several bodies is one hole, and so are holes that continue one another on one line; a copy of a body at another place has its holes too, also one further along the same line; a hole that missed or was cut away is not counted). ' +
    'So the label of a hole should name the piece that goes into it, with what the catalog does not know ("M3x10 countersunk screw"), and a hole that takes no piece of its own should have none. Every copy counts, also one laid out for printing. The answer is for the model as modelled, whatever the pose.',
  returns:
    '`printed` and `bought` (rows: `name`, `count`, `bodies`, `material`, `color`, `volume` in mm3 of one, `density` in g/cm3, `mass` in g of one with `massFrom` (`mass` or `density`), or `noMass` (`notStated`, `inError`), `totalMass` in g, `copyOf` (the body the chain of sources starts at, when it is a body of the model and not in this row), `mirrored` (the mesh of that body, mirrored), `differs` (no longer the mesh of that body)), ' +
    '`hardware` (rows: `label`, `count`, `holes`: the hole features with the label and the holes of each), `unlabelled` (hole features without a label, with their holes), `auxiliary` (bodies that are no parts), ' +
    '`totals` (`printed` and `bought`: `count` of bodies, `mass` in g of those that have one, `withoutMass`: how many have none; `hardware.count`). Hardware has no mass.',
  args: PARTS_LIST_ARGS,
  significant: { mass: 6, totalMass: 6 },
  units: { volume: 'mm3', density: 'g/cm3', mass: 'g', totalMass: 'g' },
  run: (context) => partsListOf(context),
};
