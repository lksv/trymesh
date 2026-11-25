// Patterns and mirrors (design of 6h, "Patterns and mirrors"): the rule of the entry, by which an
// Onshape pattern or mirror of curves becomes an entry `pattern` (D68) of the sketch, its images
// then the copies of the entry; and what is checked of an entry on the sketch as built.
import type { Id } from '../../packages/engine/src/index';
import { solvedCurves } from '../../packages/engine/src/index';
import { expression, numberOr } from './common';
import { instanceRows, params } from './constraints';

type V2 = [number, number];

export interface EntryPlan {
  index: number; // of the Onshape constraint
  constraint: any;
  type: 'pattern' | 'mirror';
  seeds: string[]; // Onshape entities (curves and points) of the source
  images: Set<string>; // Onshape entities of the copies, with the points of their curves
  imageCurves: string[]; // the image entities themselves (curves and listed points)
  rows: string[][]; // rows[i][j]: entity i of instance j
  info: Map<string, { j: number; seed: string }>; // an image -> its instance and its seed
  exempt: Set<any>; // constraints the copies realise
  why?: string; // the rule that kept it out
  pivot?: string; // a circular pattern: the local pivot (Onshape point)
  pivotExternal?: string;
  axis?: string; // a mirror: the local line (Onshape) or a deterministic ID of a default plane
  axisExternal?: boolean;
  count?: number | string;
}

const points = (E: Map<string, any>, v: string): string[] => {
  const e = E.get(v);
  if (!e) return [];
  if (e.sketchEntityType === 'skPoint') return [v];
  return ['startPointId', 'endPointId', 'centerId'].map((k) => e[k]).filter(Boolean);
};
const withPoints = (E: Map<string, any>, ids: string[]) => new Set(ids.flatMap((v) => [v, ...points(E, v)]));

// The shape of an Onshape entity in its own 2D (mm), for the contacts of rule 2.
type Shape = { k: 'line'; a: V2; b: V2; cons: boolean } | { k: 'circle'; c: V2; r: number; cons: boolean };
function shapeOf(E: Map<string, any>, v: string): Shape | undefined {
  const e = E.get(v);
  if (!e) return undefined;
  const P = (pid: string): V2 => { const q = E.get(pid); return [q.position2d.x * 1000, q.position2d.y * 1000]; };
  if (e.sketchEntityType === 'skLineSegment') return { k: 'line', a: P(e.startPointId), b: P(e.endPointId), cons: !!e.isConstruction };
  if (e.sketchEntityType === 'skCircle' || e.sketchEntityType === 'skArc') return { k: 'circle', c: [e.geometry.center2d.x * 1000, e.geometry.center2d.y * 1000], r: e.geometry.radius * 1000, cons: !!e.isConstruction };
  return undefined;
}
// How two curves meet: they cross, touch, share an end only, or not at all (arcs as their circles:
// a filter, the engine judges by rule 6).
function contactOf(u: Shape, v: Shape): 'cross' | 'touch' | 'ends' | 'same' | false {
  const eps = 1e-5;
  if (u.k === 'line' && v.k === 'line') {
    const [a, b, c, d] = [u.a, u.b, v.a, v.b];
    const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
    if (Math.abs(den) < 1e-12) return false;
    const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
    const w = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
    if (!(t > -1e-9 && t < 1 + 1e-9 && w > -1e-9 && w < 1 + 1e-9)) return false;
    return (t > 1e-7 && t < 1 - 1e-7) || (w > 1e-7 && w < 1 - 1e-7) ? 'cross' : 'ends';
  }
  if (u.k === 'line' || v.k === 'line') {
    const [l, c] = (u.k === 'line' ? [u, v] : [v, u]) as [Shape & { k: 'line' }, Shape & { k: 'circle' }];
    const [dx, dy, fx, fy] = [l.b[0] - l.a[0], l.b[1] - l.a[1], l.a[0] - c.c[0], l.a[1] - c.c[1]];
    const [A, B, C] = [dx * dx + dy * dy, 2 * (fx * dx + fy * dy), fx * fx + fy * fy - c.r * c.r];
    const disc = B * B - 4 * A * C;
    if (disc < -1e-7) return false;
    const ts = [-1, 1].map((sg) => (-B + sg * Math.sqrt(Math.max(0, disc))) / (2 * A)).filter((t) => t > -1e-7 && t < 1 + 1e-7);
    return ts.length ? (Math.abs(disc) < 1e-7 ? 'touch' : 'cross') : false;
  }
  const d = Math.hypot(u.c[0] - v.c[0], u.c[1] - v.c[1]);
  if (d < 1e-9) return Math.abs(u.r - v.r) < eps ? 'same' : false;
  if (d > u.r + v.r + eps || d < Math.abs(u.r - v.r) - eps) return false;
  return Math.abs(d - (u.r + v.r)) < eps || Math.abs(d - Math.abs(u.r - v.r)) < eps ? 'touch' : 'cross';
}

// What the rule of the entry needs of the sketch: the axis a default plane is seen as (undefined:
// none), whether an external pivot is a point the sketch has (the origin), and the 2D of the base
// plane (a reflection about an axis is one there, not in the Onshape sketch's own 2D).
export interface EntryContext {
  axisOf: (id: string) => 'origin/x' | 'origin/y' | undefined;
  pivotKnown: (id: string) => boolean;
  toBase: (p: V2) => V2;
}
// The kinds an entry copies; a seed or an image of another kind (a spline) keeps the plan out.
const COPIED = new Set(['skPoint', 'skLineSegment', 'skCircle', 'skArc']);

// The rule of the entry, rules 1 to 4, on Onshape's IDs before any point is welded. `forbidden`:
// entries that rule 5 or 6 dropped on an earlier build of the sketch.
export function planEntries(feature: any, geom: any, forbidden: Set<number>, ec: EntryContext): EntryPlan[] {
  const E = new Map<string, any>((geom.entities as any[]).map((e) => [e.sketchEntityId, e]));
  const at = (v: string): V2 | undefined => { const e = E.get(v); return e?.position2d ? [e.position2d.x * 1000, e.position2d.y * 1000] : undefined; };
  const same = (a?: V2, b?: V2) => !!a && !!b && Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-6;
  const list: any[] = feature.constraints ?? [];
  const plans: EntryPlan[] = [];
  list.forEach((c, index) => {
    const p = params(c);
    if (/PATTERN/.test(c.constraintType)) {
      const rows = instanceRows(c);
      const info = new Map<string, { j: number; seed: string }>();
      const seeds: string[] = [];
      const imgs: string[] = [];
      for (const r of rows) r.forEach((v, j) => { if (j === 0) seeds.push(v); else { imgs.push(v); info.set(v, { j, seed: r[0] }); } });
      const plan: EntryPlan = { index, constraint: c, type: 'pattern', seeds, images: withPoints(E, imgs), imageCurves: imgs, rows, info, exempt: new Set() };
      // the points of an image curve, as images of the points of its seed
      for (const r of rows) for (let j = 1; j < r.length; j++) { const [s, im] = [E.get(r[0]), E.get(r[j])]; if (s && im) for (const k of ['startPointId', 'endPointId', 'centerId']) if (s[k] && im[k] && !info.has(im[k])) info.set(im[k], { j, seed: s[k] }); }
      const count = expression(p.patternc1?.expression);
      plan.count = count === undefined ? undefined : numberOr(count);
      if (c.constraintType !== 'CIRCULAR_PATTERN') plan.why = 'a linear pattern (not on the model; lost)';
      else if (p.openPattern?.value) plan.why = 'an open pattern (its angle is not in the dump)';
      else if (count === undefined) plan.why = 'its count does not convert';
      else if (p.localPivot?.value) {
        plan.pivot = p.localPivot.value;
        if (E.get(plan.pivot!)?.sketchEntityType !== 'skPoint') plan.why = 'the pivot is not a point of the sketch';
      } else {
        const ext = p.externalPivot?.queries?.[0]?.deterministicIds?.[0];
        if (ext) plan.pivotExternal = ext;
        // a projected pivot (an own point tied by coincident to an entry) is not implemented
        if (!ext) plan.why = 'no pivot';
        else if (!ec.pivotKnown(ext)) plan.why = 'the pivot is a projected point (not implemented: only the origin or a point of the sketch)';
      }
      plans.push(plan);
    } else if (c.constraintType === 'MIRROR' && p.localFirst && p.localSecond && E.get(p.localFirst.value)?.sketchEntityType !== 'skPoint') {
      const ext = p.externalMirror?.queries?.[0]?.deterministicIds?.[0];
      const plan: EntryPlan = { index, constraint: c, type: 'mirror', seeds: [p.localFirst.value], images: new Set(), imageCurves: [p.localSecond.value], rows: [[p.localFirst.value, p.localSecond.value]], info: new Map(), exempt: new Set() };
      if (p.localMirror?.value) plan.axis = p.localMirror.value;
      else if (ext && ec.axisOf(ext)) { plan.axis = ext; plan.axisExternal = true; }
      else plan.why = 'the mirror line is not identified';
      plans.push(plan);
    }
  });
  // only points, lines, circles and arcs are copied
  for (const plan of plans) if (!plan.why && [...plan.seeds, ...plan.imageCurves].some((v) => !COPIED.has(E.get(v)?.sketchEntityType))) plan.why = 'a seed or an image is not a point, a line, a circle or an arc';
  // rules 1 and 2 for a plan as it stands (a mirror is tried both ways round); the reflection takes
  // a point of the Onshape sketch to its image in the 2D of the base plane
  const reflectFn = (plan: EntryPlan): ((p: V2) => V2) => {
    if (plan.axisExternal) {
      const axis = ec.axisOf(plan.axis!);
      return (p: V2): V2 => { const [x, y] = ec.toBase(p); return axis === 'origin/x' ? [x, -y] : [-x, y]; };
    }
    const ax = E.get(plan.axis!);
    const [a, b] = [at(ax.startPointId)!, at(ax.endPointId)!];
    return ([x, y]: V2): V2 => { const [dx, dy] = [b[0] - a[0], b[1] - a[1]]; const t = ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy); return ec.toBase([2 * (a[0] + t * dx) - x, 2 * (a[1] + t * dy) - y]); };
  };
  const orient = (plan: EntryPlan, seed: string, image: string) => {
    plan.seeds = [seed];
    plan.imageCurves = [image];
    plan.rows = [[seed, image]];
    plan.images = withPoints(E, [image]);
    plan.info = new Map([[image, { j: 1, seed }]]);
    const refl = reflectFn(plan);
    for (const ip of points(E, image)) for (const sp of points(E, seed)) { const [u, v] = [at(ip), at(sp)]; if (u && v && same(ec.toBase(u), refl(v))) plan.info.set(ip, { j: 1, seed: sp }); }
  };
  const rule12 = (plan: EntryPlan): string | undefined => {
    plan.exempt = new Set();
    const seedSet = withPoints(E, plan.seeds);
    for (const o of list) {
      if (o === plan.constraint) continue;
      const q = params(o);
      const ops = o.parameters.filter((x: any) => /^local/.test(x.parameterId) && typeof x.value === 'string' && !/^localInstance/.test(x.parameterId)).map((x: any) => x.value as string);
      const instanceOps = o.parameters.filter((x: any) => /^localInstance/.test(x.parameterId)).map((x: any) => x.value as string);
      const hit = [...ops, ...instanceOps].filter((v) => plan.images.has(v));
      if (!hit.length) continue;
      if (/PATTERN|MIRROR/.test(o.constraintType) && instanceOps.length + ops.length && (/PATTERN/.test(o.constraintType) || E.get(q.localFirst?.value)?.sketchEntityType !== 'skPoint')) return `an image is a seed or an instance of another ${/PATTERN/.test(o.constraintType) ? 'pattern' : 'mirror'}`;
      const external = o.parameters.some((x: any) => /^external/.test(x.parameterId));
      // the copies of one point are one point: a coincidence of two images of one instance whose seed points are one point
      if (o.constraintType === 'COINCIDENT' && hit.length === 2 && ops.length === 2 && !external) {
        const [ia, ib] = hit.map((v) => plan.info.get(v));
        if (ia && ib && ia.j === ib.j && same(at(ia.seed), at(ib.seed))) { plan.exempt.add(o); continue; }
        return `an image is named by COINCIDENT${ia && ib && ia.j !== ib.j ? ' of two instances' : ''}`;
      }
      // a mirrored line comes with the MIRROR of each of its ends about the same line
      if (o.constraintType === 'MIRROR' && plan.type === 'mirror') {
        const key = q.localMirror?.value ?? q.externalMirror?.queries?.[0]?.deterministicIds?.[0];
        const [a, b] = [q.localFirst?.value, q.localSecond?.value];
        const [img, sd] = plan.images.has(a) ? [a, b] : [b, a];
        if (key === plan.axis && plan.info.get(img)?.seed === sd) { plan.exempt.add(o); continue; }
      }
      return `an image is named by ${o.constraintType}`;
    }
    // no own curve outside the entry uses a point of an image
    for (const e of geom.entities as any[]) if (!plan.images.has(e.sketchEntityId) && !seedSet.has(e.sketchEntityId) && points(E, e.sketchEntityId).some((q) => q !== e.sketchEntityId && plan.images.has(q))) return 'a curve outside uses a point of an image';
    // rule 2: no curve but a neighbour of its own instance meets an image
    for (const x of plan.imageCurves) {
      const u = shapeOf(E, x);
      if (!u || u.cons) continue;
      for (const e of geom.entities as any[]) {
        const y = e.sketchEntityId;
        if (y === x) continue;
        const v = shapeOf(E, y);
        if (!v || v.cons) continue;
        const k = contactOf(u, v);
        if (!k) continue;
        const inside = plan.images.has(y) || seedSet.has(y);
        if (inside && (k === 'ends' || (plan.info.get(x)?.j !== undefined && plan.info.get(x)?.j === plan.info.get(y)?.j))) continue;
        return `an image ${k === 'ends' ? 'shares an end with' : k === 'touch' ? 'touches' : 'crosses'} ${plan.images.has(y) ? 'an image of another instance' : seedSet.has(y) ? 'a seed' : 'a curve outside'}`;
      }
    }
    return undefined;
  };
  for (const plan of plans) {
    if (plan.why) continue;
    if (forbidden.has(plan.index)) { plan.why = 'dropped by rule 5 or 6 on an earlier build'; continue; }
    if (plan.type === 'mirror') {
      // no fixed seed: the curve that something names or meets stays own, the other is the copy
      const [first, second] = [plan.seeds[0], plan.imageCurves[0]];
      orient(plan, first, second);
      let why = rule12(plan);
      if (why) { orient(plan, second, first); const other = rule12(plan); if (other) { orient(plan, first, second); rule12(plan); } else why = undefined; }
      if (why) plan.why = why;
    } else {
      const why = rule12(plan);
      if (why) plan.why = why;
    }
  }
  // rule 3: an image may be a copy of one entry only, and no source may be a copy; the pivot of a
  // pattern is a point the sketch has, so no copy of another entry (an image is not made). A plan is
  // judged before its images become copies, so a plan kept out adds none.
  const copies = new Set<string>();
  const pivots = new Set<string>(); // the pivots of the plans taken so far
  for (const plan of plans) {
    if (plan.why) continue;
    if ([...plan.images].some((v) => copies.has(v))) plan.why = 'an image is a copy of another entry';
    else if (plan.pivot && copies.has(plan.pivot)) plan.why = 'the pivot is a copy of another entry';
    else if ([...plan.images].some((v) => pivots.has(v))) plan.why = 'an image is the pivot of another entry';
    else { for (const v of plan.images) copies.add(v); if (plan.pivot) pivots.add(plan.pivot); }
  }
  for (const plan of plans) if (!plan.why && [...withPoints(E, plan.seeds)].some((v) => copies.has(v))) plan.why = 'a seed is a copy of another entry';
  return plans;
}

// Rule 5: the copies are Onshape's images, both ways: every image matched by exactly one copy of
// the same kind and construction flag (a line by its two ends, a circle by centre and radius, an
// arc by centre and ends, a point by its place) within 1e-6, and every copy by one image.
export function copiesMatch(engine: any, sketch: Id, entry: Id, plan: EntryPlan, geom: any, toBase: (p: V2) => V2): string | undefined {
  const st = engine.getState();
  const f = st.document.features.find((x: any) => x.id === sketch);
  const res = st.evaluation.features[sketch]?.sketch;
  if (!f || !res) return 'the sketch is not evaluated';
  const sc = solvedCurves(f, res);
  const P = (i: Id): V2 | undefined => { const q = sc.geometry.points[i]; return q ? [q.x, q.y] : undefined; };
  const E = new Map<string, any>((geom.entities as any[]).map((e) => [e.sketchEntityId, e]));
  const O = (pid: string): V2 => { const q = E.get(pid); return toBase([q.position2d.x * 1000, q.position2d.y * 1000]); };
  const near = (a?: V2, b?: V2) => !!a && !!b && Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-6;
  type Item = { kind: string; cons: boolean; pts: V2[]; r?: number };
  const images: Item[] = [];
  for (const v of plan.imageCurves) {
    const e = E.get(v);
    if (!e) continue;
    const cons = !!e.isConstruction;
    if (e.sketchEntityType === 'skPoint') images.push({ kind: 'point', cons: false, pts: [O(v)] });
    else if (e.sketchEntityType === 'skLineSegment') images.push({ kind: 'line', cons, pts: [O(e.startPointId), O(e.endPointId)] });
    else if (e.sketchEntityType === 'skCircle' && !e.startPointId) images.push({ kind: 'circle', cons, pts: [O(e.centerId)], r: e.geometry.radius * 1000 });
    else if (e.sketchEntityType === 'skCircle' || e.sketchEntityType === 'skArc') images.push({ kind: 'arc', cons, pts: [O(e.centerId), O(e.startPointId), O(e.endPointId)] });
  }
  const copies: Item[] = [];
  for (const [cid, c] of sc.curves) {
    if (!cid.startsWith(`${entry}/`)) continue;
    const sh: any = c.shape;
    const cons = !c.regions;
    if (sh.type === 'line') copies.push({ kind: 'line', cons, pts: [P(sh.a)!, P(sh.b)!] });
    else if (sh.type === 'circle') copies.push({ kind: 'circle', cons, pts: [P(sh.center)!], r: sc.geometry.radii[cid] });
    else if (sh.type === 'arc') copies.push({ kind: 'arc', cons, pts: [P(sh.center)!, P(sh.start)!, P(sh.end)!] });
  }
  // the copies of points that no copy of a curve has
  const curvePoints = new Set<string>();
  for (const [cid, c] of sc.curves) if (cid.startsWith(`${entry}/`)) for (const k of ['a', 'b', 'center', 'start', 'end']) if (typeof (c.shape as any)[k] === 'string') curvePoints.add((c.shape as any)[k]);
  for (const pid of Object.keys(sc.geometry.points)) if (pid.startsWith(`${entry}/`) && !curvePoints.has(pid)) copies.push({ kind: 'point', cons: false, pts: [P(pid)!] });
  const matches = (a: Item, b: Item) =>
    a.kind === b.kind && a.cons === b.cons && (a.r === undefined || Math.abs(a.r - b.r!) <= 1e-6) &&
    (a.kind === 'line' ? (near(a.pts[0], b.pts[0]) && near(a.pts[1], b.pts[1])) || (near(a.pts[0], b.pts[1]) && near(a.pts[1], b.pts[0])) : a.kind === 'arc' ? near(a.pts[0], b.pts[0]) && ((near(a.pts[1], b.pts[1]) && near(a.pts[2], b.pts[2])) || (near(a.pts[1], b.pts[2]) && near(a.pts[2], b.pts[1]))) : near(a.pts[0], b.pts[0]));
  // an image point is matched by the copy point at its place (a copy of a curve's point too)
  const copyPoints: V2[] = [];
  for (const pid of Object.keys(sc.geometry.points)) if (pid.startsWith(`${entry}/`)) { const q = P(pid)!; if (!copyPoints.some((x) => near(x, q))) copyPoints.push(q); }
  const lonelyImage = images.filter((i) => (i.kind === 'point' ? copyPoints.filter((q) => near(q, i.pts[0])).length : copies.filter((c) => matches(i, c)).length) !== 1).length;
  const lonelyCopy = copies.filter((c) => images.filter((i) => matches(i, c)).length !== 1).length;
  if (lonelyImage || lonelyCopy) return `${lonelyImage} image(s) without exactly one copy, ${lonelyCopy} copy(ies) without exactly one image`;
  return undefined;
}
