// The catalog of outline formats and the import of an outline (D72), beside the catalog of mesh
// formats (`IMPORT_FORMATS`, import/index.ts). A format is a module in this directory and one line
// of `OUTLINE_FORMATS`; what follows the reading is shared: the local IDs, the weld of the open ends
// a file with few digits leaves apart, the limits of an outline and the report. `importOutline` is
// a function without a state: the curves enter a document by addExternal or updateExternal of an
// entry `outline`. docs/d36/6f-outline-import/design.md, "The import" and "The weld".
import { emptyDocument } from '../document';
import { OUTLINE_LIMITS, curveProblem, outlineBox } from '../imported-curve';
import { checkArgs } from '../query/check';
import { documentIds } from '../sketch-content';
import type { ArgPath, Document, Evaluation, Id, ImportedCurve, OutlineReadWith, SketchFeature, Vec2 } from '../types';
import { has } from '../util';
import { dxf } from './dxf';
import { fileStemOf, importFormatOf } from './index';
import { type AnyImportFormat, type AnyOutlineFormat, ImportFailure, type OutlineCatalog, type OutlineFormat, type OutlineOptions, type ReadOutline } from './spec';
import { svg } from './svg';

export const OUTLINE_FORMATS: OutlineCatalog = { dxf, svg };

// The outline format of a path by its extension, as `importFormatOf` names a mesh format.
export const outlineFormatOf = (path: string): OutlineFormat | undefined => importFormatOf(path, OUTLINE_FORMATS as unknown as Record<string, AnyImportFormat>) as OutlineFormat | undefined;

// The ID of a new entry of an outline from the name of its file: its stem reduced to the characters
// of an ID (`o_` before a leading digit), numbered while the document or the sketch has it. The
// app's draft and the tool import_outline both name an entry so.
export function outlineEntryId(document: Document, sketch: SketchFeature, file: string): Id {
  const stem = fileStemOf(file).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'outline';
  const base = /^[A-Za-z_]/.test(stem) ? stem : `o_${stem}`;
  const used = new Set([...documentIds(document), ...Object.keys(sketch.external)]);
  let id = base;
  for (let n = 2; used.has(id) || id === 'origin'; n++) id = `${base}_${n}`;
  return id;
}

// ---------------------------------------------------------------- the report

// What an import says about the outline it read.
// - `curves`, `byKind`, `control`: what the outline holds after the weld (by the `type` of each
//   curve), and the control points of its splines.
// - `ids`: the last number given of each kind, and the numbers not used (at most 20, and their
//   count): `l1` to `l<lines>` but for `unused`. When `unusedCount` is over the list, `ids.more`
//   names the query that lists every ID. `otherKind`: the IDs whose letter is not their type, at
//   most 20 (an arc of nearly a whole turn read as a circle keeps `a<n>`).
// - `welded`: ends moved onto another end; `moved`: the furthest any end was moved, mm, from where
//   the file had it: never more than the weld (and its slack of 1e-9 mm).
// - `reshaped`: arcs whose end was moved onto an end of another arc; `bent`: the furthest the arc of
//   the file lies off the new circle of such an arc, over its whole length; `radius`: the largest
//   change of a radius among them, without a bound; `reshapedArcs`: those arcs with the radius
//   before and after, at most 20, the largest change first (the centre moved with the radius).
// - `closed`: arcs of nearly a whole turn read as circles, splines closed onto their start.
// - `dropped`: curves left out because they have no extent; `duplicates`: curves left out because
//   they lie on an earlier curve of the file.
// - `blocked`: open ends with another end within the weld that could not be put on it; `crowded`:
//   open ends the weld leaves alone because it cannot tell their partner.
// - `open`: ends that are the end of no other curve; `gaps`: at most 20 of them that have another
//   end within a hundred weld tolerances, the nearest first; `atMost`: the search around that end
//   was cut short, so a nearer end may exist.
// - `bounds`: mm, in the coordinates of the file.
// - `notes`: in words, for the caller to read.
export interface OutlineReport {
  format: OutlineFormat;
  readWith: OutlineReadWith;
  about: ReadOutline['about'];
  curves: number;
  byKind: Record<ImportedCurve['type'], number>;
  control: number;
  ids: { lines: number; arcs: number; circles: number; splines: number; unused: Id[]; unusedCount: number; otherKind: { id: Id; type: ImportedCurve['type'] }[]; more?: string };
  welded: number;
  moved: number;
  reshaped: number;
  reshapedArcs: { id: Id; was: number; radius: number }[];
  bent: number;
  radius: number;
  closed: number;
  dropped: number;
  duplicates: number;
  blocked: number;
  crowded: number;
  open: number;
  gaps: { at: Vec2; distance: number; atMost?: true }[];
  bounds: { min: Vec2; max: Vec2 };
  notes: string[];
}

// - `invalidArguments`: no such format, or an option of the wrong shape (`arg` names it).
// - `unreadable`: the bytes are not a whole file of the format; the message has the place.
// - `empty`: the file, or the layers asked for, hold no curve the format reads.
// - `tooLarge`: more bytes, curves or control points than a reader takes, or after the weld more
//   than an outline holds.
export type OutlineOutcome =
  | { ok: true; curves: Record<Id, ImportedCurve>; report: OutlineReport }
  | { ok: false; error: { code: 'invalidArguments' | 'unreadable' | 'empty' | 'tooLarge'; message: string; arg?: ArgPath; about?: ReadOutline['about'] } };

// The default of the option `weld`, mm.
export const WELD_DEFAULT = 0.01;

// ---------------------------------------------------------------- the weld

// The tolerance of a join of the sketch: ends this close are one place to the profile.
const JOIN = 1e-6;
// An open end with more open ends than this within the weld is in a crowd the weld does not
// resolve; and a search around a place looks at no more than SEARCH candidates, whatever they are.
const CROWD = 8;
const SEARCH = 64;
// The weld reaches this much further than its number, in mm, and pairs are ordered by their distance
// in this unit: a gap equal to the weld, or two equal gaps, are then not decided by the last bit of a
// difference of two coordinates.
const SLACK = 1e-9;
// A circle through three points is no move when its radius is more than this many chords.
const FLAT = 1e6;
const TAU = 2 * Math.PI;
const positive = (angle: number): number => ((angle % TAU) + TAU) % TAU;
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const angleOf = (center: Vec2, p: Vec2): number => Math.atan2(p[1] - center[1], p[0] - center[0]);
const sweepOf = (center: Vec2, start: Vec2, end: Vec2): number => positive(angleOf(center, end) - angleOf(center, start)) || TAU;
const onArc = (center: Vec2, start: Vec2, sweep: number, part: number): Vec2 => {
  const [r, a] = [dist(start, center), angleOf(center, start) + sweep * part];
  return [center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)];
};
// The centre of the circle through three points, computed from the first of them (so that it does
// not lose its digits far from the origin of the file); undefined when they are nearly in one line:
// the middle less than JOIN off the chord, or a radius of more than FLAT chords.
function circleThrough(a: Vec2, b: Vec2, c: Vec2): Vec2 | undefined {
  const [bx, by, cx, cy] = [b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]];
  const d = 2 * (bx * cy - by * cx);
  const chord = Math.hypot(cx, cy);
  if (!(chord > 0) || !(Math.abs(d) / (2 * chord) > JOIN)) return undefined;
  const [b2, c2] = [bx * bx + by * by, cx * cx + cy * cy];
  const [ux, uy] = [(cy * b2 - by * c2) / d, (bx * c2 - cx * b2) / d];
  if (Math.hypot(ux, uy) > FLAT * chord) return undefined;
  return [a[0] + ux, a[1] + uy];
}
// How far the arc of the file lies off a circle, exactly: at its ends, and where it is furthest from
// and nearest to the centre of that circle when it passes there.
function offCircle(arc: { center: Vec2; start: Vec2; sweep: number }, center: Vec2, radius: number): number {
  const from = angleOf(arc.center, arc.start);
  const towards = Math.atan2(arc.center[1] - center[1], arc.center[0] - center[0]);
  const parts = [0, 1, ...[towards, towards + Math.PI].map((angle) => positive(angle - from) / arc.sweep).filter((part) => part < 1)];
  return Math.max(...parts.map((part) => Math.abs(dist(onArc(arc.center, arc.start, arc.sweep, part), center) - radius)));
}
const polygonOf = (points: Vec2[]): number => points.slice(1).reduce((sum, p, i) => sum + dist(points[i], p), 0);
// A curve with no extent.
function noExtent(curve: ImportedCurve): boolean {
  switch (curve.type) {
    case 'line':
      return dist(curve.a, curve.b) <= JOIN;
    case 'circle':
      return !(curve.radius > JOIN);
    case 'arc':
      return !(dist(curve.start, curve.center) > JOIN) || (dist(curve.start, curve.end) <= JOIN && sweepOf(curve.center, curve.start, curve.end) <= Math.PI);
    case 'spline':
      return polygonOf(curve.points) <= JOIN || (curve.points.length === 3 && dist(curve.points[0], curve.points[2]) <= JOIN);
  }
}
// A curve whose two ends are within `reach` of each other, read as closed: an arc of more than a
// half turn as a circle, a spline of four points or more closed onto its start.
function closedOnto(curve: ImportedCurve, reach: number): ImportedCurve | undefined {
  if (curve.type === 'arc' && dist(curve.start, curve.end) <= reach && sweepOf(curve.center, curve.start, curve.end) > Math.PI) return { type: 'circle', center: curve.center, radius: dist(curve.start, curve.center) };
  if (curve.type === 'spline') {
    const [n, first] = [curve.points.length, curve.points[0]];
    const gap = dist(first, curve.points[n - 1]);
    if (n >= 4 && gap > 0 && gap <= reach) return { type: 'spline', points: [...curve.points.slice(0, -1), first] };
  }
  return undefined;
}
// The two ends of a curve that has them: a line, an arc, a spline that is not closed.
const endsOf = (curve: ImportedCurve): Vec2[] =>
  curve.type === 'line' ? [curve.a, curve.b] : curve.type === 'arc' ? [curve.start, curve.end] : curve.type === 'spline' && dist(curve.points[0], curve.points[curve.points.length - 1]) > 0 ? [curve.points[0], curve.points[curve.points.length - 1]] : [];

// Points in cells, for "what is within a distance of here" with a bound on the work: a search stops
// when it has looked at SEARCH items, whatever they are, and says so (`full`). A search that is full
// has proved nothing about what it did not reach.
class Cells<T> {
  private readonly cells = new Map<string, { at: Vec2; item: T }[]>();
  constructor(private readonly size: number) {}
  add(at: Vec2, item: T): void {
    const key = `${Math.floor(at[0] / this.size)},${Math.floor(at[1] / this.size)}`;
    const list = this.cells.get(key);
    if (list) list.push({ at, item });
    else this.cells.set(key, [{ at, item }]);
  }
  // the items within `reach` (at most the size of a cell) of a place that `take` accepts
  near(p: Vec2, reach: number, take: (item: T) => boolean, most = Infinity): { found: { item: T; d: number }[]; full: boolean } {
    const found: { item: T; d: number }[] = [];
    let looked = 0;
    const [cx, cy] = [Math.floor(p[0] / this.size), Math.floor(p[1] / this.size)];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const { at, item } of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (++looked > SEARCH) return { found, full: true };
          const d = dist(at, p);
          if (d <= reach && take(item) && found.push({ item, d }) >= most) return { found, full: false };
        }
    return { found, full: false };
  }
}
const samePlace = (a: Vec2, b: Vec2): boolean => dist(a, b) <= JOIN;
// Two curves at the same places within JOIN; a line or a spline either way round.
function sameCurve(a: ImportedCurve, b: ImportedCurve): boolean {
  if (a.type === 'line' && b.type === 'line') return (samePlace(a.a, b.a) && samePlace(a.b, b.b)) || (samePlace(a.a, b.b) && samePlace(a.b, b.a));
  if (a.type === 'circle' && b.type === 'circle') return samePlace(a.center, b.center) && Math.abs(a.radius - b.radius) <= JOIN;
  if (a.type === 'arc' && b.type === 'arc') return samePlace(a.center, b.center) && samePlace(a.start, b.start) && samePlace(a.end, b.end);
  if (a.type === 'spline' && b.type === 'spline' && a.points.length === b.points.length) return a.points.every((p, i) => samePlace(p, b.points[i])) || a.points.every((p, i) => samePlace(p, b.points[b.points.length - 1 - i]));
  return false;
}
// Curves found by all that places them, not by one of their points, a step at a time: a line by one
// end, then the other (either way round); a circle by its centre, then its radius; an arc by its
// start, its end, then its centre; a spline by the count of its points and one end, the other end
// (either way round), then the mean of its points. Each step looks into the nine cells around (three
// for a radius), so a twin is found wherever the cells fall, and curves that share one point, one
// centre or two ends only are not compared.
type TwinEntry<T> = { curve: ImportedCurve; item: T; order: number };
class Twins<T> {
  private readonly root = new Map<string, unknown>();
  private count = 0;
  private static keys(curve: ImportedCurve): string[][][] {
    const of = (...values: number[]): number[] => values.map((v) => Math.floor(v / JOIN));
    const named = (name: string, ...steps: number[][]): string[][] =>
      steps.map((step, level) => [-1, 0, 1].flatMap((dx) => (step.length === 1 ? [`${level === 0 ? name : ''}${step[0] + dx}`] : [-1, 0, 1].map((dy) => `${level === 0 ? name : ''}${step[0] + dx},${step[1] + dy}`))));
    if (curve.type === 'line') return [named('l', of(...curve.a), of(...curve.b)), named('l', of(...curve.b), of(...curve.a))];
    if (curve.type === 'circle') return [named('c', of(...curve.center), of(curve.radius))];
    if (curve.type === 'arc') return [named('a', of(...curve.start), of(...curve.end), of(...curve.center))];
    const n = curve.points.length;
    const [first, last] = [curve.points[0], curve.points[n - 1]];
    const mean = of(curve.points.reduce((sum, p) => sum + p[0], 0) / n, curve.points.reduce((sum, p) => sum + p[1], 0) / n);
    return [named(`s${n}|`, of(...first), of(...last), mean), named(`s${n}|`, of(...last), of(...first), mean)];
  }
  // each step of a key lists its cell and those around it; the cell itself is the middle one
  private static own = (step: string[]): string => step[(step.length - 1) / 2];
  add(curve: ImportedCurve, item: T): void {
    const order = this.count++;
    for (const steps of Twins.keys(curve)) {
      let node = this.root;
      steps.forEach((step, level) => {
        const [key, last] = [Twins.own(step), level === steps.length - 1];
        let next = node.get(key);
        if (!next) node.set(key, (next = last ? [] : new Map<string, unknown>()));
        if (last) (next as TwinEntry<T>[]).push({ curve, item, order });
        else node = next as Map<string, unknown>;
      });
    }
  }
  // the earliest curve added that lies on this one and that `take` accepts
  find(curve: ImportedCurve, take: (item: T) => boolean = () => true): T | undefined {
    const [steps] = Twins.keys(curve);
    let best: TwinEntry<T> | undefined;
    const walk = (node: Map<string, unknown>, level: number): void => {
      for (const key of steps[level]) {
        const next = node.get(key);
        if (!next) continue;
        if (level < steps.length - 1) walk(next as Map<string, unknown>, level + 1);
        else for (const entry of next as TwinEntry<T>[]) if ((!best || entry.order < best.order) && take(entry.item) && sameCurve(curve, entry.curve)) best = entry;
      }
    };
    walk(this.root, 0);
    return best?.item;
  }
}
// The curves of a list that lie on an earlier one, by their index.
function duplicatesOf(curves: readonly (ImportedCurve | undefined)[]): number[] {
  const kept = new Twins<number>();
  const out: number[] = [];
  curves.forEach((curve, index) => {
    if (!curve) return;
    if (kept.find(curve) !== undefined) out.push(index);
    else kept.add(curve, index);
  });
  return out;
}

// What the weld did, aligned with its input: `curves` undefined where a curve was left out.
export interface Welded {
  curves: (ImportedCurve | undefined)[];
  welded: number;
  moved: number;
  reshaped: number;
  reshapedArcs: { index: number; was: number; radius: number }[]; // every one, the largest change first
  bent: number;
  radius: number;
  closed: number;
  dropped: number;
  duplicates: number;
  blocked: number;
  crowded: number;
}

// The weld (design.md, "The weld"), bounded in what it moves and in what it costs:
// 0. What has no extent is left out; then a curve whose own ends are within JOIN is closed (an arc of
//    more than a half turn a circle), whatever the tolerance; until nothing changes, and a curve is
//    counted once. A curve that lies on an earlier one is left out, before the ends are looked at.
// 1. With a tolerance: an arc of more than a half turn, or a spline of four points or more, whose
//    own two ends are within it, with no end of another curve near them, is closed. A search that
//    was cut short proves nothing: the curve is then left as it is.
// 2. An end is met when an end of another curve is within JOIN of it. Met ends never move.
// 3. The pairs of an open end and an end of another curve within the tolerance, the nearest first.
//    An end of a line or a spline goes onto the other end; an end of an arc only onto an end of
//    another arc (of two, the arc whose radius changes less in proportion gives way, then the later
//    in the file). No end goes further than the tolerance from where the file had it, nor to the
//    place its own other end stands at. An open end with more than CROWD open ends around it, or
//    whose search was cut short, is left alone; of the met ends around it only the nearest is a
//    partner.
// 4. An arc whose end went onto another arc's is the circle through its two ends and the middle of
//    the arc of the file, when the arc of the file lies within the tolerance of it over its whole
//    length; an arc whose ends stayed is the arc of the file, to the digit.
// 5. Step 0 again; and, as the last thing, whatever the validator of the kind would refuse.
// With a tolerance under JOIN only steps 0 and 5 run.
export function weldOutline(input: readonly ImportedCurve[], tolerance: number): Welded {
  const w = tolerance >= JOIN ? tolerance : 0;
  const curves: (ImportedCurve | undefined)[] = [...input];
  const count = { welded: 0, moved: 0, reshaped: 0, bent: 0, radius: 0, closed: 0, dropped: 0, duplicates: 0, blocked: 0, crowded: 0 };
  const reshapedArcs: Welded['reshapedArcs'] = [];
  // what has no extent goes first, whatever its ends; then what closes onto itself; again, since a
  // curve that was closed is another curve (a circle with no radius). A curve is counted once.
  const tidy = (): void => {
    curves.forEach((curve, index) => {
      let now = curve;
      let closed = false;
      for (let round = 0; now && round < 3; round++) {
        if (noExtent(now)) {
          now = undefined;
          break;
        }
        const next = closedOnto(now, JOIN);
        if (!next) break;
        now = next;
        closed = true;
      }
      if (now === curve) return;
      curves[index] = now;
      if (!now) count.dropped++;
      else if (closed) count.closed++;
    });
    for (const index of duplicatesOf(curves)) {
      curves[index] = undefined;
      count.duplicates++;
    }
  };
  // the last thing: nothing leaves the weld that the validator of the kind would refuse
  const done = (): Welded => {
    curves.forEach((curve, index) => {
      if (curve && curveProblem(curve, 'curve')) {
        curves[index] = undefined;
        count.dropped++;
      }
    });
    reshapedArcs.sort((p, q) => Math.abs(q.radius - q.was) - Math.abs(p.radius - p.was));
    return { curves, ...count, reshapedArcs };
  };
  tidy();
  if (w === 0) return done();
  interface End {
    curve: number;
    which: 0 | 1;
    was: Vec2;
    at: Vec2;
    settled: boolean;
    crowded: boolean;
    wanted: boolean;
  }
  const collect = (): End[] => curves.flatMap((curve, index) => (curve ? endsOf(curve).map((p, which): End => ({ curve: index, which: which as 0 | 1, was: p, at: p, settled: false, crowded: false, wanted: false })) : []));
  // within the weld: its number and the slack
  const reach = w + SLACK;
  const cellsOf = (ends: End[], size = reach): Cells<End> => {
    const cells = new Cells<End>(size);
    for (const e of ends) cells.add(e.at, e);
    return cells;
  };
  // 1. curves that close onto themselves within the weld, with nothing else near their ends
  {
    const all = cellsOf(collect());
    curves.forEach((curve, index) => {
      if (!curve || (curve.type !== 'arc' && curve.type !== 'spline')) return;
      const closed = closedOnto(curve, reach);
      if (!closed || noExtent(closed)) return;
      // another end near, or a search that could not say: the curve stays as it is
      const busy = endsOf(curve).some((p) => {
        const near = all.near(p, reach, (e) => e.curve !== index, 1);
        return near.full || near.found.length > 0;
      });
      if (busy) return;
      if (curve.type === 'spline') {
        count.welded++;
        count.moved = Math.max(count.moved, dist(curve.points[0], curve.points[curve.points.length - 1]));
      }
      curves[index] = closed;
      count.closed++;
    });
  }
  // 2. the ends: met, in a crowd, open
  const ends = collect();
  const cells = cellsOf(ends);
  const fine = cellsOf(ends, JOIN); // "met" is asked in cells of the join: a dense place does not cut that search short
  const order = new Map(ends.map((e, i) => [e, i]));
  const partner = new Map<End, End>();
  for (let i = 0; i + 1 < ends.length; i++)
    if (ends[i].curve === ends[i + 1].curve) {
      partner.set(ends[i], ends[i + 1]);
      partner.set(ends[i + 1], ends[i]);
    }
  type ArcState = { center: Vec2; radius: number; sweep: number; start: Vec2; now: Vec2; moved: boolean };
  const arcs = new Map<number, ArcState>();
  curves.forEach((curve, index) => {
    if (curve?.type === 'arc') arcs.set(index, { center: curve.center, radius: dist(curve.start, curve.center), sweep: sweepOf(curve.center, curve.start, curve.end), start: curve.start, now: curve.center, moved: false });
  });
  const unknown = new Set<End>();
  for (const e of ends) {
    const met = fine.near(e.at, JOIN, (f) => f.curve !== e.curve, 1);
    e.settled = met.found.length > 0;
    if (!e.settled && met.full) unknown.add(e);
  }
  const candidates = new Map<End, { item: End; d: number }[]>();
  for (const e of ends) {
    if (e.settled) continue;
    const around = cells.near(e.at, reach, (f) => f.curve !== e.curve);
    e.wanted = around.found.length > 0;
    const open = around.found.filter(({ item }) => !item.settled);
    // a crowd is of open ends: the met ends around (the vertices of a polyline of short segments) are not it
    e.crowded = unknown.has(e) || around.full || open.length > CROWD;
    const nearestMet = around.found.filter(({ item }) => item.settled).sort((p, q) => p.d - q.d)[0];
    candidates.set(e, [...open, ...(nearestMet ? [nearestMet] : [])]);
  }
  const pairs: { a: End; b: End; d: number }[] = [];
  for (const a of ends) {
    if (a.settled || a.crowded) continue;
    for (const { item: b, d } of candidates.get(a) ?? []) {
      if (b.crowded) continue;
      if (!b.settled && (order.get(b) as number) < (order.get(a) as number)) continue; // two open ends: once
      pairs.push({ a, b, d });
    }
  }
  const unit = (d: number): number => Math.round(d / SLACK);
  pairs.sort((p, q) => unit(p.d) - unit(q.d) || (order.get(p.a) as number) - (order.get(q.a) as number) || (order.get(p.b) as number) - (order.get(q.b) as number));
  const isArc = (e: End): boolean => curves[e.curve]?.type === 'arc';
  // 3. whether an end may go onto the end `stay`, and for an arc the centre it then has
  const mayGo = (e: End, stay: End): { center?: Vec2; change?: number } | undefined => {
    const to = stay.at;
    const mate = partner.get(e) as End;
    if (dist(e.was, to) > reach || dist(mate.at, to) <= JOIN) return undefined;
    const curve = curves[e.curve] as ImportedCurve;
    if (curve.type !== 'arc') return {};
    // an arc gives way to another arc only: beside a line or a spline it keeps the digits of its file
    if (!isArc(stay)) return undefined;
    const arc = arcs.get(e.curve) as ArcState;
    const [start, end] = e.which === 0 ? [to, mate.at] : [mate.at, to];
    // the circle through the two ends and the middle of the arc of the file
    const middle = onArc(arc.center, arc.start, arc.sweep, 0.5);
    const center = circleThrough(start, middle, end);
    if (!center) return undefined;
    const r = dist(start, center);
    // the arc it makes is one the validator takes, the middle is between the ends the same way
    // round, and the arc of the file is nowhere further than the weld from the new circle
    if (curveProblem({ type: 'arc', center, start, end }, 'arc')) return undefined;
    if (!(positive(angleOf(center, middle) - angleOf(center, start)) < sweepOf(center, start, end))) return undefined;
    if (offCircle(arc, center, r) > reach) return undefined;
    return { center, change: Math.abs(r - arc.radius) / arc.radius };
  };
  for (const { a, b } of pairs) {
    if (a.settled && b.settled) continue;
    const free = [a, b].filter((e) => !e.settled);
    // who moves: of two open ends a line or a spline before an arc; of two arcs the one whose radius
    // changes less in proportion, then the later of the file
    const later = [a, b].sort((p, q) => (order.get(q) as number) - (order.get(p) as number));
    let movers = free.length === 2 ? (isArc(a) !== isArc(b) ? (isArc(a) ? [b, a] : [a, b]) : later) : free;
    if (free.length === 2 && isArc(a) && isArc(b)) {
      const change = (e: End): number => mayGo(e, e === a ? b : a)?.change ?? Infinity;
      movers = [...later].sort((p, q) => unit(change(p)) - unit(change(q)));
    }
    for (const mover of movers) {
      const stay = mover === a ? b : a;
      const how = mayGo(mover, stay);
      if (!how) continue;
      mover.at = stay.at;
      if (how.center) Object.assign(arcs.get(mover.curve) as ArcState, { now: how.center, moved: true });
      a.settled = b.settled = true;
      break;
    }
  }
  for (const e of ends) {
    const d = dist(e.was, e.at);
    if (d > 0) {
      count.welded++;
      count.moved = Math.max(count.moved, d);
    }
    if (e.settled) continue;
    if (e.crowded) count.crowded++;
    else if (e.wanted) count.blocked++;
  }
  // the curves again
  const at = new Map<number, [Vec2, Vec2]>();
  for (let i = 0; i + 1 < ends.length; i++) if (ends[i].curve === ends[i + 1].curve) at.set(ends[i].curve, [ends[i].at, ends[i + 1].at]);
  curves.forEach((curve, index) => {
    const pair = at.get(index);
    if (!curve || !pair) return;
    const [first, last] = pair;
    if (curve.type === 'line') curves[index] = first === curve.a && last === curve.b ? curve : { type: 'line', a: first, b: last };
    else if (curve.type === 'spline') curves[index] = first === curve.points[0] && last === curve.points[curve.points.length - 1] ? curve : { type: 'spline', points: [first, ...curve.points.slice(1, -1), last] };
    else if (curve.type === 'arc') {
      // an arc whose ends stayed is the arc of the file, to the digit
      const arc = arcs.get(index) as ArcState;
      if (!arc.moved) return;
      const r = dist(first, arc.now);
      count.reshaped++;
      reshapedArcs.push({ index, was: arc.radius, radius: r });
      count.radius = Math.max(count.radius, Math.abs(r - arc.radius));
      count.bent = Math.max(count.bent, offCircle(arc, arc.now, r));
      curves[index] = { type: 'arc', center: arc.now, start: first, end: last };
    }
  });
  tidy();
  return done();
}

// The local IDs of the curves of a reader, in their order: `l<n>`, `a<n>`, `c<n>`, `s<n>` by the kind
// the file gave and its order, from 1. Given before the weld and not changed by it.
export function outlineIds(curves: readonly ImportedCurve[]): Id[] {
  const counts: Record<ImportedCurve['type'], number> = { line: 0, arc: 0, circle: 0, spline: 0 };
  return curves.map((curve) => `${curve.type[0]}${++counts[curve.type]}`);
}

// The ends of an outline that are the end of no other curve, and of them at most 20 with another end
// within a hundred tolerances, the nearest first. The nearest other end is looked for outward: in
// cells of one tolerance, then of ten, then of a hundred, and the first size that has one gives it.
// Every search is bounded; one that was cut short gives a distance that is an upper bound (`atMost`).
export function openEnds(curves: Iterable<ImportedCurve>, tolerance: number): { open: number; gaps: OutlineReport['gaps'] } {
  const step = Math.max(tolerance, JOIN);
  type E = { curve: number; at: Vec2 };
  const ends: E[] = [];
  let index = 0;
  for (const curve of curves) {
    for (const at of endsOf(curve)) ends.push({ curve: index, at });
    index++;
  }
  const fine = new Cells<E>(JOIN);
  const rings = [1, 10, 100].map((times) => ({ reach: times * step, cells: new Cells<E>(times * step) }));
  for (const e of ends) {
    fine.add(e.at, e);
    for (const ring of rings) ring.cells.add(e.at, e);
  }
  const gaps: OutlineReport['gaps'] = [];
  let open = 0;
  for (const e of ends) {
    if (fine.near(e.at, JOIN, (f) => f.curve !== e.curve, 1).found.length > 0) continue;
    open++;
    let cut = false;
    for (const ring of rings) {
      const { found, full } = ring.cells.near(e.at, ring.reach, (f) => f.curve !== e.curve);
      cut ||= full;
      if (found.length === 0) continue;
      gaps.push({ at: e.at, distance: Math.min(...found.map(({ d }) => d)), ...(cut ? { atMost: true as const } : {}) });
      break;
    }
  }
  gaps.sort((p, q) => p.distance - q.distance);
  return { open, gaps: gaps.slice(0, 20) };
}

// What a revised outline does to the entities of the one before it, for the answer of a tool and the
// draft of the app.
// - `kept`: the IDs both have; `changed`: of them, those whose curve is at no place a curve of the
//   old outline had (it moved, or it is a new curve under an old ID, or it changed its kind).
// - `added`, `removed`: the IDs only the new, only the old outline has.
// - `renamed`: an ID, old or new, whose curve is where the old outline had the curve of another ID.
// Places are compared by distance (within 1e-6 mm, in the cells around them), a line or a spline
// either way round. Nothing is matched by geometry for the IDs: the caller is told.
export interface OutlineRevision {
  kept: number;
  changed: number;
  added: Id[];
  removed: Id[];
  renamed: { id: Id; was: Id }[];
}
export function outlineRevision(before: Record<Id, ImportedCurve>, after: Record<Id, ImportedCurve>): OutlineRevision {
  const old = new Twins<Id>();
  for (const [id, curve] of Object.entries(before)) old.add(curve, id);
  const renamed: { id: Id; was: Id }[] = [];
  let [kept, changed] = [0, 0];
  for (const [id, curve] of Object.entries(after)) {
    const here = has(before, id);
    if (here) kept++;
    if (here && sameCurve(before[id], curve)) continue;
    const was = old.find(curve, (other) => other !== id);
    if (was !== undefined) renamed.push({ id, was });
    else if (here) changed++;
  }
  return { kept, changed, added: Object.keys(after).filter((id) => !has(before, id)), removed: Object.keys(before).filter((id) => !has(after, id)), renamed };
}

// ---------------------------------------------------------------- the import

// The options of an import name nothing of a model, so they are checked against an empty one.
const NO_STATE = { document: emptyDocument(), evaluation: { features: {}, bodies: {}, faceNames: [] } as unknown as Evaluation };
const KINDS: ImportedCurve['type'][] = ['line', 'arc', 'circle', 'spline'];
const PLURAL: Record<ImportedCurve['type'], string> = { line: 'lines', arc: 'arcs', circle: 'circles', spline: 'splines' };
const figure = (v: number): number => Number(v.toPrecision(4));

// Reads a file into the curves of an outline.
// 1. The size of the bytes; the options checked against the description of the format; the format
//    reads (its limits apply while it reads).
// 2. The local IDs (`outlineIds`): from the curves as the reader gave them. Nothing after this step
//    renames a curve, so the IDs depend on the file and the layers alone.
// 3. The weld (`weldOutline`).
// 4. `empty`, and the limits of an outline (`tooLarge`), before anything is computed for the report.
// 5. The report.
// The same bytes and options give the same curves under the same IDs.
export function importOutline<F extends OutlineFormat>(format: F, bytes: Uint8Array, options?: OutlineOptions<F>, formats: Record<string, AnyOutlineFormat> = OUTLINE_FORMATS): OutlineOutcome {
  type Code = Extract<OutlineOutcome, { ok: false }>['error']['code'];
  const refused = (code: Code, message: string, more: { arg?: ArgPath; about?: ReadOutline['about'] } = {}): OutlineOutcome => ({ ok: false, error: { code, message, ...more } });
  if (typeof format !== 'string' || !has(formats, format)) return refused('invalidArguments', `there is no outline format ${typeof format === 'string' ? `"${format}"` : 'of that name (a text is expected)'}; the formats are ${Object.keys(formats).join(', ')}`, { arg: ['format'] });
  if (!(bytes instanceof Uint8Array)) return refused('invalidArguments', 'the bytes of the file are expected', { arg: ['bytes'] });
  if (bytes.length > OUTLINE_LIMITS.bytes) return refused('tooLarge', `${format}: the file has ${bytes.length} bytes, more than ${OUTLINE_LIMITS.bytes}`);
  const spec = formats[format];
  const checked = checkArgs(spec.options, options, NO_STATE);
  if (!checked.ok) return refused('invalidArguments', `${format}: ${checked.message}`, { arg: checked.arg });
  const given = checked.value as { layers?: string[]; unit?: string; weld?: number };
  // a name of a layer is stored in `readWith`, which the validator of the kind bounds
  const long = given.layers?.findIndex((layer) => layer.length > OUTLINE_LIMITS.text) ?? -1;
  if (long >= 0) return refused('invalidArguments', `${format}: a name of a layer has at most ${OUTLINE_LIMITS.text} characters`, { arg: ['layers', long] });
  let read: ReadOutline;
  try {
    read = spec.read(bytes, checked.value as never);
  } catch (error) {
    if (error instanceof ImportFailure) return refused(error.code, `${format}: ${error.message}`);
    throw error;
  }
  const tolerance = given.weld ?? WELD_DEFAULT;
  const source = read.curves.map(({ curve }) => curve);
  const ids = outlineIds(source);
  const made = weldOutline(source, tolerance);
  const curves: Record<Id, ImportedCurve> = {};
  const byKind: Record<ImportedCurve['type'], number> = { line: 0, arc: 0, circle: 0, spline: 0 };
  let control = 0;
  made.curves.forEach((curve, index) => {
    if (!curve) return;
    curves[ids[index]] = curve;
    byKind[curve.type]++;
    if (curve.type === 'spline') control += curve.points.length;
  });
  const kept = Object.values(curves);
  if (kept.length === 0) {
    const layers = Object.entries(read.about.layers).map(([layer, types]) => `${layer} (${Object.entries(types).map(([type, n]) => `${n} ${type}`).join(', ')})`);
    const skipped = Object.entries(read.about.skipped).map(([what, n]) => `${n} ${what}`);
    return refused('empty', `${format}: no curve to read${given.layers ? ` on the layers ${given.layers.join(', ')}` : ''}; the layers of the file: ${layers.join('; ') || 'none'}${skipped.length ? `; left out: ${skipped.join(', ')}` : ''}`, { about: read.about });
  }
  if (kept.length > OUTLINE_LIMITS.curves) return refused('tooLarge', `${format}: ${kept.length} curves, more than the ${OUTLINE_LIMITS.curves} an outline holds; read fewer layers`, { about: read.about });
  if (control > OUTLINE_LIMITS.control) return refused('tooLarge', `${format}: ${control} control points of splines, more than the ${OUTLINE_LIMITS.control} an outline holds`, { about: read.about });
  // the IDs: the last number of each kind and the numbers not used
  const given_ = { line: 0, arc: 0, circle: 0, spline: 0 } as Record<ImportedCurve['type'], number>;
  for (const curve of source) given_[curve.type]++;
  const unusedAll = ids.filter((id) => !has(curves, id));
  const otherKind = ids.filter((id) => has(curves, id) && curves[id].type[0] !== id[0]).map((id) => ({ id, type: curves[id].type }));
  const bounds = outlineBox(kept) as { min: Vec2; max: Vec2 };
  const ends = openEnds(kept, tolerance);
  const notes = [...read.about.notes];
  const beyond = ends.gaps.filter((gap) => gap.distance > tolerance + SLACK);
  if (ends.gaps.length > 0) {
    const nearest = ends.gaps[0];
    notes.push(
      `${ends.open} open ${ends.open === 1 ? 'end' : 'ends'}; the nearest gap is ${figure(nearest.distance)} mm${nearest.atMost ? ' or less' : ''} at (${figure(nearest.at[0])}, ${figure(nearest.at[1])})${beyond.length > 0 ? `: import again with weld ${figure(Math.min(1, beyond[0].distance * 1.01))} to close the gaps up to it` : ''}, or end an own curve at an open end`,
    );
  } else if (ends.open > 0) notes.push(`${ends.open} open ${ends.open === 1 ? 'end' : 'ends'} with no other end within ${figure(100 * Math.max(tolerance, JOIN))} mm`);
  if (made.blocked > 0) notes.push(`${made.blocked} open ${made.blocked === 1 ? 'end has' : 'ends have'} another end within the weld that could not be put on it (an end of an arc beside a line keeps its place, and no end goes further than the weld): more digits in the file, or own curves there`);
  if (made.crowded > 0) notes.push(`${made.crowded} open ${made.crowded === 1 ? 'end lies' : 'ends lie'} among too many other ends to be welded: a smaller weld, or other layers`);
  const pulled = made.reshapedArcs.filter((arc) => Math.abs(arc.radius - arc.was) > tolerance);
  if (pulled.length > 0)
    notes.push(`the radius of ${pulled.length === 1 ? 'an arc' : `${pulled.length} arcs`} changed by more than the weld where it met another arc: ${pulled.slice(0, 20).map((arc) => `${ids[arc.index]}: ${figure(arc.was)} to ${figure(arc.radius)}`).join(', ')}; ${pulled.length === 1 ? 'its centre' : 'their centres'} moved with ${pulled.length === 1 ? 'it' : 'them'}, so build on the ends of such an arc, not on its centre`);
  const size = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]);
  if (size < 1 || size > 10_000) notes.push(`the larger side of the bounds is ${figure(size)} mm: is the unit right (the option unit)?`);
  if (kept.length > OUTLINE_LIMITS.note || control > OUTLINE_LIMITS.note)
    notes.push(`${kept.length} curves${control ? ` and ${control} control points of splines` : ''}: every change in the sketch that holds the outline places it again in its profile (about 100 ms for 2000 lines and circles that form regions); a later sketch that projects what it needs costs nothing of it`);
  // what the caller gave, not the defaults the check filled in: an import again with the same
  // options reads the same file the same way also if a default changes
  const raw = (options ?? {}) as { layers?: string[]; unit?: string; weld?: number };
  const readWith: OutlineReadWith = { format, ...(raw.layers !== undefined ? { layers: [...given.layers!] } : {}), ...(raw.unit !== undefined ? { unit: given.unit } : {}), ...(raw.weld !== undefined ? { weld: given.weld } : {}) };
  return {
    ok: true,
    curves,
    report: {
      format,
      readWith,
      about: read.about,
      curves: kept.length,
      byKind,
      control,
      ids: {
        lines: given_.line,
        arcs: given_.arc,
        circles: given_.circle,
        splines: given_.spline,
        unused: unusedAll.slice(0, 20),
        unusedCount: unusedAll.length,
        otherKind: otherKind.slice(0, 20),
        ...(unusedAll.length > 20 ? { more: 'the query entryCurves lists every ID once the outline is in a sketch' } : {}),
      },
      welded: made.welded,
      moved: made.moved,
      reshaped: made.reshaped,
      reshapedArcs: made.reshapedArcs.slice(0, 20).map(({ index, was, radius }) => ({ id: ids[index], was, radius })),
      bent: made.bent,
      radius: made.radius,
      closed: made.closed,
      dropped: made.dropped,
      duplicates: made.duplicates,
      blocked: made.blocked,
      crowded: made.crowded,
      open: ends.open,
      gaps: ends.gaps,
      bounds,
      notes,
    },
  };
}

// The words of the report for the kinds, for the readers of it (the app's draft, the tool).
export const curveCounts = (byKind: Record<ImportedCurve['type'], number>): string =>
  KINDS.flatMap((kind) => (byKind[kind] > 0 ? [`${byKind[kind]} ${byKind[kind] === 1 ? kind : PLURAL[kind]}`] : [])).join(', ');
