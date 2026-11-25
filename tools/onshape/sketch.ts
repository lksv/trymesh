// An Onshape sketch as a sketch of trymesh: its points, lines and circles in the frame of a base plane,
// the curves split where they cross, and the constraints that have a counterpart.
import type { Command, Engine, Id, PlaneRef, RegionRef } from '../../packages/engine/src/index';
import { emptySketch } from '../../packages/engine/src/index';
import { type Report, type V2, type V3, dot, exec, expression, sane } from './common';
import { type MapContext, mapConstraints, onshapeKind, params } from './constraints';
import { type ConstraintRecord, FATES, type Fate, type SketchSummary, finalFate, sketchLines } from './fates';
import { ORIGIN_ID, type StudioOperations, decode } from './operands';

// The frame of an Onshape sketch (world, mm) and the base plane of trymesh it is drawn on.
export interface SketchFrame {
  origin: V3;
  x: V3;
  y: V3;
  normal: V3; // the normal of the Onshape sketch
  base: { plane: 'XY' | 'XZ' | 'YZ'; x: V3; y: V3; normal: V3 };
  offset: number; // of the base plane, along its normal
  sign: 1 | -1; // +1 when the Onshape normal is the normal of the base plane, −1 against it
}
const BASES = [
  { plane: 'XY', x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] },
  { plane: 'XZ', x: [1, 0, 0], y: [0, 0, 1], normal: [0, -1, 0] },
  { plane: 'YZ', x: [0, 1, 0], y: [0, 0, 1], normal: [1, 0, 0] },
] as const;

// `sketchMatrix` of the endpoint `sketches`: row-major 4×4 in metres, the columns the X, Y and
// normal of the sketch and its origin. Only sketches parallel to a base plane are taken: trymesh
// has tilted planes (D60), but this converter does not build them.
export function sketchFrame(matrix: number[]): SketchFrame | undefined {
  const col = (c: number): V3 => [matrix[c], matrix[4 + c], matrix[8 + c]];
  const [x, y, normal] = [col(0), col(1), col(2)];
  const origin = col(3).map((v) => v * 1000) as V3;
  for (const b of BASES) {
    const d = dot(normal, b.normal as V3);
    if (Math.abs(Math.abs(d) - 1) < 1e-9) return { origin, x, y, normal, base: b as SketchFrame['base'], offset: dot(origin, b.normal as V3), sign: d > 0 ? 1 : -1 };
  }
  return undefined;
}
// A point of the Onshape sketch (its own 2D, mm) in the 2D of the base plane.
export const toBase = (f: SketchFrame, [u, v]: V2): V2 => {
  const w: V3 = [f.origin[0] + u * f.x[0] + v * f.y[0], f.origin[1] + u * f.x[1] + v * f.y[1], f.origin[2] + u * f.x[2] + v * f.y[2]];
  return [dot(w, f.base.x as V3), dot(w, f.base.y as V3)];
};
// A point of the model (mm) in the 2D of the base plane.
export const worldToBase = (f: SketchFrame, w: V3): V2 => [dot(w, f.base.x as V3), dot(w, f.base.y as V3)];

export interface Converted {
  id: Id;
  frame: SketchFrame;
  kind: Map<string, 'point' | 'line' | 'circle'>; // Onshape entity -> what it is (curves that were split are not here)
  rep: Map<string, Id>; // Onshape point -> point of trymesh
}

type C = { id: string; src: string; construction: boolean; line?: [string, string]; circle?: { c: string; r: number }; arc?: [string, string, string] };

// Where a sketch is converted: its studio, the decode of external IDs there, and its key.
export interface SketchPlace {
  studio: string;
  ops: StudioOperations; // the operations of the studio that holds the Onshape feature
  helper: boolean;
  onshapeRegions?: number; // the faces the Onshape sketch feature created
  derivedFrom?: string; // `<source studio>/<source feature>` of a derived copy
}

export function convertSketch(engine: Engine, report: Report, id: Id, name: string, plane: PlaneRef, frame: SketchFrame, feature: any, geom: any, place: SketchPlace): Converted | undefined {
  const P = (s: string) => `${id}.${sane(s)}`; // entity IDs are unique in the whole document
  // Onshape gives every curve its own end points, held together by coincident constraints; points
  // at one position become one point (that is what trymesh needs to close a region).
  const pos = new Map<Id, V2>();
  const rep = new Map<string, Id>();
  const byKey = new Map<string, Id>();
  const keyOf = ([x, y]: V2) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)}`;
  const pointAt = (p: V2, want: Id): Id => {
    const k = keyOf(p);
    if (!byKey.has(k)) { byKey.set(k, want); pos.set(want, p); }
    return byKey.get(k)!;
  };
  const kind = new Map<string, 'point' | 'line' | 'circle'>();
  for (const e of geom.entities) if (e.sketchEntityType === 'skPoint') { rep.set(e.sketchEntityId, pointAt(toBase(frame, [e.position2d.x * 1000, e.position2d.y * 1000]), P(e.sketchEntityId))); kind.set(e.sketchEntityId, 'point'); }
  const list: C[] = [];
  const skipped: Record<string, number> = {};
  for (const e of geom.entities) {
    const cid = P(e.sketchEntityId);
    if (e.sketchEntityType === 'skLineSegment') {
      const [a, b] = [rep.get(e.startPointId)!, rep.get(e.endPointId)!];
      if (a === b) continue;
      kind.set(e.sketchEntityId, 'line');
      list.push({ id: cid, src: e.sketchEntityId, line: [a, b], construction: e.isConstruction });
    } else if (e.sketchEntityType === 'skCircle' && !e.startPointId) {
      kind.set(e.sketchEntityId, 'circle');
      list.push({ id: cid, src: e.sketchEntityId, circle: { c: rep.get(e.centerId)!, r: e.geometry.radius * 1000 }, construction: e.isConstruction });
    } else if (e.sketchEntityType === 'skCircle' || e.sketchEntityType === 'skArc') {
      // an arc: centre, start and end; trymesh turns counter-clockwise from the start
      const [s, t] = [rep.get(e.startPointId)!, rep.get(e.endPointId)!];
      const turned = e.geometry?.clockWise !== (frame.sign < 0);
      list.push({ id: cid, src: e.sketchEntityId, arc: [rep.get(e.centerId)!, turned ? t : s, turned ? s : t], construction: e.isConstruction });
    } else if (e.sketchEntityType !== 'skPoint') skipped[e.sketchEntityType] = (skipped[e.sketchEntityType] ?? 0) + 1;
  }
  if (Object.keys(skipped).length) report.note(`${name}: entities without a counterpart, left out: ${JSON.stringify(skipped)} (splines and ellipses: step 6)`);

  // Onshape makes regions of curves that cross; trymesh refuses such a profile (no trim yet, step 6).
  // Every visible curve is split where another one crosses or touches it.
  const curves = splitAtCrossings(list, pos, pointAt, id);
  const split = list.filter((c) => !curves.some((x) => x.id === c.id));
  if (split.length) {
    report.note(`${name}: ${split.length} curve(s) split where curves cross (constraints on them dropped)`);
    for (const c of split) kind.delete(c.src);
  }
  const base: Command[] = [
    { type: 'addFeature', feature: emptySketch(id, name, plane) },
    ...[...pos].map(([pid, [x, y]]): Command => ({ type: 'addPoint', sketch: id, id: pid, x, y })),
    ...curves.map((c): Command => ({
      type: 'addCurve',
      sketch: id,
      id: c.id,
      curve: { ...(c.line ? { type: 'line', a: c.line[0], b: c.line[1] } : c.arc ? { type: 'arc', center: c.arc[0], start: c.arc[1], end: c.arc[2] } : { type: 'circle', center: c.circle!.c }), ...(c.construction ? { construction: true } : {}) } as any,
      ...(c.circle ? { radius: c.circle.r } : {}),
    })),
  ];
  const conv: Converted = { id, frame, kind, rep };
  const entityType = new Map<string, string>((geom.entities as any[]).map((e) => [e.sketchEntityId, onshapeKind(e)]));
  const ctx: MapContext = { studio: place.studio, sketch: id, name, helper: place.helper, kind, rep, pos, curves, entityType, split: new Set(split.map((c) => c.src)), ops: place.ops };
  const { records, commands: cons } = mapConstraints(ctx, feature.constraints ?? []);
  report.records.push(...records);
  // The constraints are kept only when the solver leaves the geometry where Onshape had it; else
  // dimensions as numbers; else the bare geometry.
  const strip = ({ measured, record, dupOf, ...c }: any) => c;
  const numeric = cons.map((c: any) => (typeof c.constraint.value === 'string' ? { ...c, constraint: { ...c.constraint, value: c.measured } } : c));
  for (const [label, set] of [['with expressions', cons], ['dimensions as numbers', numeric], ['without constraints', []]] as const) {
    const commands = [...base, ...set.map(strip)];
    const r = engine.preview({ type: 'batch', commands });
    if (!r.ok) { report.note(`${name}: constraints ${label} refused: ${r.error.message.slice(0, 200)}`); continue; }
    const res = r.state.evaluation.features[id];
    const moved = [...pos].filter(([pid, [x, y]]) => { const q = res.sketch?.points[pid]; return !q || Math.hypot(q.x - x, q.y - y) > 1e-4; }).length;
    if (res.status === 'error' || moved) { report.note(`${name}: constraints ${label}: ${res.status} ${res.error?.message ?? ''}, ${moved} point(s) moved`); continue; }
    exec(engine, report, { type: 'batch', commands }, name);
    // the records: what was written, and how
    for (const r of records) {
      if (r.fate) continue;
      if (label === 'without constraints') Object.assign(r, { fate: 'lost', cause: 'refused', detail: 'the sketch passes only without constraints' });
      else {
        r.fate = 'written';
        r.ids = r.commands.map((c: any) => c.id);
        r.written = label === 'with expressions' ? 'expressions' : 'number';
        if (label !== 'with expressions') for (const c of r.commands as any[]) if (typeof c.constraint.value === 'string') (r.numbers ??= []).push(`${c.id}: every dimension of the sketch as a number`);
      }
    }
    finishSketch(engine, report, conv, name, place, geom, feature, records, label, pos.size, curves.length);
    return conv;
  }
  return undefined;
}

// What a converted sketch reports and records: its line, the summary, the welds, the promises.
function finishSketch(engine: Engine, report: Report, conv: Converted, name: string, place: SketchPlace, geom: any, feature: any, records: ConstraintRecord[], ladder: string, points: number, curves: number) {
  const id = conv.id;
  const res = engine.getState().evaluation.features[id];
  const sk = res.sketch;
  const all = new Map(report.records.map((r) => [r.key, r]));
  for (const line of sketchLines(name, points, curves, records, all, sk?.degreesOfFreedom)) report.note(line);
  let diagnosis: number | undefined;
  try { diagnosis = engine.diagnoseSketch(id).redundant.length; } catch { diagnosis = undefined; }
  const counts = Object.fromEntries(FATES.map((f) => [f, records.filter((r) => finalFate(r, all).fate === f).length])) as Record<Fate, number>;
  const welds = weldsOf(conv, geom, feature);
  for (const w of welds.listed) report.later('Welds', `${place.studio}, ${name}: ${w}`);
  const key = `${place.studio}/${id}`;
  report.sketches[key] = {
    key, studio: place.studio, id, name, helper: place.helper, status: res.status, warnings: res.warnings.map((w) => w.code), freedom: sk?.degreesOfFreedom, redundant: sk?.redundant ?? [], diagnosisRedundant: diagnosis, valid: sk?.valid,
    regions: sk?.regions.length ?? 0, onshapeRegions: place.onshapeRegions, areas: (sk?.regions ?? []).map((r) => regionArea(r.loops)).sort((a, b) => a - b), welds, ladder, entries: [], counts,
  };
  if (sk?.redundant.length) report.later('Redundant constraints', `${place.studio}, ${name}: the solver lists ${sk.redundant.join(', ')}; the diagnosis counts ${diagnosis ?? '?'}`);
  // what the probe asserts: every Onshape pattern's instances are its seeds turned
  const pr = report.promisesOf(place.studio);
  if (place.helper) pr.helpers.push(id);
  if (place.derivedFrom) pr.derived[id] = place.derivedFrom;
  for (const [index, c] of (feature.constraints ?? []).entries()) {
    if (c.constraintType !== 'CIRCULAR_PATTERN') continue;
    const p = params(c);
    const count = Number(expression(p.patternc1?.expression));
    const pivot = conv.rep.get(p.localPivot?.value);
    if (p.openPattern?.value || !pivot || !Number.isFinite(count)) continue;
    const isPoint = (v: string) => (geom.entities as any[]).some((e) => e.sketchEntityId === v && e.sketchEntityType === 'skPoint');
    const rows = instanceRows(c).filter((r) => r && isPoint(r[0])).map((r) => r.map((v) => conv.rep.get(v) ?? ''));
    pr.patterns.push({ sketch: id, constraint: `${place.studio}/${id}#${index}`, pivot, count, rows });
  }
}

// The rows of an Onshape pattern: rows[i][j] is entity i of instance j (0 the seed).
export function instanceRows(c: any): string[][] {
  const rows: string[][] = [];
  for (const q of c.parameters) { const m = /^localInstance(\d+),(\d+)$/.exec(q.parameterId); if (m) (rows[+m[1]] ??= [])[+m[2]] = q.value; }
  return rows.filter(Boolean);
}

// The places where the converter made one point of several Onshape points, and whether a constraint
// ties them. A weld without a constraint is a relation the converter adds; it is classed by what it
// joins: points of the instances of one pattern or mirror, an instance and an entity outside, two
// plain entities. The last two classes are listed one by one.
export function weldsOf(conv: Converted, geom: any, feature: any): SketchSummary['welds'] {
  const E = new Map<string, any>((geom.entities as any[]).map((e) => [e.sketchEntityId, e]));
  const parent = new Map<string, string>();
  const find = (x: string): string => { while (parent.has(x) && parent.get(x) !== x) x = parent.get(x)!; return x; };
  const join = (a: string, b: string) => { const [x, y] = [find(a), find(b)]; if (x !== y) parent.set(x, y); };
  const pointsOf = (v: string): string[] => { const e = E.get(v); if (!e) return []; if (e.sketchEntityType === 'skPoint') return [v]; return ['startPointId', 'endPointId', 'centerId'].map((k) => e[k]).filter(Boolean); };
  // groups of a pattern or mirror: its seeds and images, with the points of their curves
  const groups: { members: Set<string>; images: Set<string> }[] = [];
  for (const c of feature.constraints ?? []) {
    const p = params(c);
    if (c.constraintType === 'COINCIDENT' && E.get(p.localFirst?.value)?.sketchEntityType === 'skPoint' && E.get(p.localSecond?.value)?.sketchEntityType === 'skPoint') join(p.localFirst.value, p.localSecond.value);
    // two points held on one external point (the origin) are tied too
    if (c.constraintType === 'COINCIDENT') {
      const local = [p.localFirst, p.localSecond].find((q) => E.get(q?.value)?.sketchEntityType === 'skPoint')?.value;
      const ext = [p.externalFirst, p.externalSecond].flatMap((q) => (q?.queries ?? []).flatMap((x: any) => x.deterministicIds ?? []))[0];
      if (local && ext && (ext === ORIGIN_ID || decode(ext)?.kind === 'vertex')) join(local, `external ${ext}`);
    }
    if (c.constraintType === 'CONCENTRIC') { const [a, b] = [E.get(p.localFirst?.value)?.centerId, E.get(p.localSecond?.value)?.centerId]; if (a && b) join(a, b); }
    if (/PATTERN/.test(c.constraintType)) {
      const rows = instanceRows(c);
      const members = new Set<string>(), images = new Set<string>();
      for (const r of rows) r.forEach((v, j) => { for (const q of pointsOf(v)) { members.add(q); if (j) images.add(q); } });
      groups.push({ members, images });
    } else if (c.constraintType === 'MIRROR' && p.localFirst && p.localSecond && E.get(p.localFirst.value)?.sketchEntityType !== 'skPoint') {
      groups.push({ members: new Set([...pointsOf(p.localFirst.value), ...pointsOf(p.localSecond.value)]), images: new Set(pointsOf(p.localSecond.value)) });
    }
  }
  const byPlace = new Map<Id, string[]>();
  for (const e of geom.entities as any[]) if (e.sketchEntityType === 'skPoint') { const r = conv.rep.get(e.sketchEntityId); if (r) byPlace.set(r, [...(byPlace.get(r) ?? []), e.sketchEntityId]); }
  const out: SketchSummary['welds'] = { places: 0, tied: 0, untied: {}, listed: [], wide: [] };
  for (const [place, pts] of byPlace) {
    if (pts.length < 2) continue;
    out.places++;
    if (pts.every((q) => find(q) === find(pts[0]))) { out.tied++; continue; }
    const images = pts.filter((q) => groups.some((g) => g.images.has(q)));
    const cls = !images.length ? 'two plain entities' : groups.some((g) => pts.every((q) => g.members.has(q))) ? 'among the instances of one pattern or mirror' : 'an instance and an entity outside';
    out.untied[cls] = (out.untied[cls] ?? 0) + 1;
    if (cls !== 'among the instances of one pattern or mirror') out.listed.push(`${cls}: ${place} (${pts.join(', ')})`);
  }
  return out;
}

// ---------------------------------------------------------------- crossings

function splitAtCrossings(list: C[], pos: Map<Id, V2>, pointAt: (p: V2, want: Id) => Id, sketch: Id): C[] {
  const P = (i: Id) => pos.get(i)!;
  const visible = list.filter((c) => !c.construction && !c.arc); // arcs of Onshape are rare here; they stay as they are
  const cuts = new Map<C, V2[]>();
  const add = (c: C, p: V2) => { if (!cuts.has(c)) cuts.set(c, []); cuts.get(c)!.push(p); };
  const onSeg = (c: C, [x, y]: V2) => {
    const [a, b] = c.line!.map(P);
    const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
    const t = ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / L2;
    return Math.abs((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) / Math.sqrt(L2) < 1e-5 && t > -1e-6 && t < 1 + 1e-6;
  };
  const onCirc = (c: C, [x, y]: V2) => { const o = P(c.circle!.c); return Math.abs(Math.hypot(x - o[0], y - o[1]) - c.circle!.r) < 1e-5; };
  const on = (c: C, p: V2) => (c.line ? onSeg(c, p) : onCirc(c, p));
  for (let i = 0; i < visible.length; i++)
    for (let j = i + 1; j < visible.length; j++) {
      const [u, v] = [visible[i], visible[j]];
      const cand: V2[] = [];
      if (u.line && v.line) {
        const [a, b] = u.line.map(P), [c, d] = v.line.map(P);
        const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
        if (Math.abs(den) > 1e-12) { const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den; cand.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); }
        else cand.push(a, b, c, d); // collinear: the ends of each split the other
      } else if (u.line || v.line) {
        const [l, ci] = u.line ? [u, v] : [v, u];
        const [a, b] = l.line!.map(P), o = P(ci.circle!.c), r = ci.circle!.r;
        const [dx, dy, fx, fy] = [b[0] - a[0], b[1] - a[1], a[0] - o[0], a[1] - o[1]];
        const [A, B, Cc] = [dx * dx + dy * dy, 2 * (fx * dx + fy * dy), fx * fx + fy * fy - r * r];
        const disc = B * B - 4 * A * Cc;
        if (disc >= -1e-9) for (const s of [-1, 1]) { const t = (-B + s * Math.sqrt(Math.max(0, disc))) / (2 * A); cand.push([a[0] + t * dx, a[1] + t * dy]); }
      } else {
        const [o1, o2, r1, r2] = [P(u.circle!.c), P(v.circle!.c), u.circle!.r, v.circle!.r];
        const d = Math.hypot(o2[0] - o1[0], o2[1] - o1[1]);
        if (d > 1e-9 && d <= r1 + r2 + 1e-9 && d >= Math.abs(r1 - r2) - 1e-9) {
          const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
          const [ex, ey] = [(o2[0] - o1[0]) / d, (o2[1] - o1[1]) / d];
          for (const s of [-1, 1]) cand.push([o1[0] + a * ex - s * h * ey, o1[1] + a * ey + s * h * ex]);
        }
      }
      for (const p of cand) if (on(u, p) && on(v, p)) { add(u, p); add(v, p); }
    }
  let n = 0;
  const out: C[] = [];
  for (const c of list) {
    const cs = cuts.get(c) ?? [];
    if (c.line) {
      const [a, b] = c.line.map(P);
      const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
      const ts = [...new Set(cs.map(([x, y]) => ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / L2).filter((t) => t > 1e-7 && t < 1 - 1e-7).map((t) => Math.round(t * 1e9) / 1e9))].sort((p, q) => p - q);
      if (!ts.length) { out.push(c); continue; }
      const ids = [c.line[0], ...ts.map((t) => pointAt([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], `${sketch}.x${n++}`)), c.line[1]];
      for (let k = 0; k + 1 < ids.length; k++) if (ids[k] !== ids[k + 1]) out.push({ ...c, id: `${c.id}~${k}`, line: [ids[k], ids[k + 1]] });
    } else if (c.circle) {
      const o = P(c.circle.c);
      const angles = [...new Set(cs.map(([x, y]) => Math.round(Math.atan2(y - o[1], x - o[0]) * 1e9) / 1e9))].sort((p, q) => p - q);
      const ids = [...new Set(angles.map((t) => pointAt([o[0] + c.circle!.r * Math.cos(t), o[1] + c.circle!.r * Math.sin(t)], `${sketch}.x${n++}`)))];
      if (ids.length < 2) { out.push(c); continue; } // touched at one point (a tangent) stays whole
      ids.forEach((s, k) => out.push({ ...c, id: `${c.id}~${k}`, circle: undefined, arc: [c.circle!.c, s, ids[(k + 1) % ids.length]] }));
    } else out.push(c);
  }
  // collinear overlaps leave a segment twice
  const seen = new Set<string>();
  return out.filter((c) => {
    const k = (c.construction ? 'k' : 's') + (c.line ? [...c.line].sort().join('|') : c.arc ? c.arc.join('|') : `${c.circle!.c}|${c.circle!.r.toFixed(6)}`);
    return !seen.has(k) && !!seen.add(k);
  });
}

// ---------------------------------------------------------------- regions

const loopArea = (l: Float64Array) => { let s = 0; for (let i = 0; i < l.length; i += 2) { const j = (i + 2) % l.length; s += l[i] * l[j + 1] - l[j] * l[i + 1]; } return Math.abs(s / 2); };
export const regionArea = (loops: Float64Array[]) => loops.reduce((s, l, i) => s + (i === 0 ? loopArea(l) : -loopArea(l)), 0);

// The region of a trymesh sketch that is the Onshape region (a face of the sketch body, as the dump
// gives it, in model coordinates): the area agrees (to 2 % or 0.05 mm², the polygons of circles
// are smaller), the middle of every curve of its outer loop lies on an edge of the Onshape region,
// and the middle of every edge of the Onshape region lies on the boundary of the region.
export function matchRegion(engine: Engine, conv: Converted, region: any): RegionRef | undefined {
  const st = engine.getState();
  const res = st.evaluation.features[conv.id]?.sketch;
  const doc = st.document.features.find((f) => f.id === conv.id) as any;
  if (!res || !doc) return undefined;
  const pt = (id: Id): V2 => { const q = res.points[id]; return [q.x, q.y]; };
  const edges = (region.edges as any[]).map((e) => ({ ...e, a2: worldToBase(conv.frame, e.a), m2: worldToBase(conv.frame, e.m), b2: worldToBase(conv.frame, e.b), c2: e.center && worldToBase(conv.frame, e.center) }));
  const middle = (cid: Id): V2 | undefined => {
    const c = doc.curves[cid];
    if (c.type === 'line') { const [a, b] = [pt(c.a), pt(c.b)]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
    if (c.type === 'arc') {
      const [o, s, e] = [pt(c.center), pt(c.start), pt(c.end)];
      const t0 = Math.atan2(s[1] - o[1], s[0] - o[0]);
      let t1 = Math.atan2(e[1] - o[1], e[0] - o[0]);
      while (t1 <= t0) t1 += 2 * Math.PI;
      const r = Math.hypot(s[0] - o[0], s[1] - o[1]);
      return [o[0] + r * Math.cos((t0 + t1) / 2), o[1] + r * Math.sin((t0 + t1) / 2)];
    }
    return undefined;
  };
  const norm = (t: number) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const onEdge = (e: any, [x, y]: V2): boolean => {
    if (e.curve === 'line') {
      const [a, b] = [e.a2, e.b2];
      const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
      const t = ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / L2;
      return Math.abs((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) / Math.sqrt(L2) < 1e-3 && t > -1e-6 && t < 1 + 1e-6;
    }
    if (e.curve !== 'circle' || Math.abs(Math.hypot(x - e.c2[0], y - e.c2[1]) - e.radius) > 1e-3) return false;
    if (Math.hypot(e.a2[0] - e.b2[0], e.a2[1] - e.b2[1]) < 1e-6) return true; // a whole circle
    const ang = (p: V2) => Math.atan2(p[1] - e.c2[1], p[0] - e.c2[0]);
    const [ta, tm, tb, tp] = [ang(e.a2), ang(e.m2), ang(e.b2), ang([x, y])];
    return norm(tm - ta) < norm(tb - ta) ? norm(tp - ta) <= norm(tb - ta) + 1e-9 : norm(ta - tp) <= norm(ta - tb) + 1e-9;
  };
  const curveOnRegion = (cid: Id): boolean => {
    const c = doc.curves[cid];
    if (c.type === 'circle') return edges.some((e) => e.curve === 'circle' && Math.hypot(pt(c.center)[0] - e.c2[0], pt(c.center)[1] - e.c2[1]) < 1e-3 && Math.abs(res.radii[cid] - e.radius) < 1e-3);
    const m = middle(cid)!;
    return edges.some((e) => onEdge(e, m));
  };
  const nearLoops = (loops: Float64Array[], [x, y]: V2) =>
    loops.some((l) => {
      for (let i = 0; i < l.length; i += 2) {
        const j = (i + 2) % l.length;
        const [ax, ay, bx, by] = [l[i], l[i + 1], l[j], l[j + 1]];
        const L2 = (bx - ax) ** 2 + (by - ay) ** 2;
        const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2)) : 0;
        if (Math.hypot(ax + t * (bx - ax) - x, ay + t * (by - ay) - y) < 0.1) return true;
      }
      return false;
    });
  let best: { ref: RegionRef; err: number } | undefined;
  for (const r of res.regions) {
    const err = Math.abs(regionArea(r.loops) - region.area);
    if (err > Math.max(0.02 * region.area, 0.05) || !r.ref.outerLoop.every(curveOnRegion) || !edges.every((e) => nearLoops(r.loops, e.m2))) continue;
    if (!best || err < best.err) best = { ref: r.ref, err };
  }
  return best?.ref;
}
