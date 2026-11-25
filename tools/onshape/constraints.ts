// The mapping of Onshape's sketch constraints to those of trymesh: one record per Onshape constraint
// (fates.ts), whose commands are its unit.
import { CONSTRAINTS, type Id, constraintKey, expressionValue } from '../../packages/engine/src/index';
import { expression, numberOr, sane, type V2 } from './common';
import { CAUSES, type Category, type Cause, type ConstraintRecord, type OperandRecord } from './fates';
import { DEFAULT_PLANES, ORIGIN_ID, type StudioOperations, categoryOf, classText } from './operands';
import { namesIn } from './probe';
import type { EntryPlan } from './derived';
import type { SketchFrame } from './sketch';

// What the mapping needs of the sketch being converted.
export interface MapContext {
  studio: string;
  sketch: Id;
  name: string;
  helper: boolean;
  kind: Map<string, 'point' | 'line' | 'circle' | 'arc'>; // Onshape entity -> what it is in trymesh
  rep: Map<string, Id>; // Onshape point -> point of trymesh
  pos: Map<Id, V2>;
  curves: { id: string; src: string; line?: [string, string]; circle?: { c: string; r: number }; arc?: [string, string, string] }[];
  entityType: Map<string, string>; // Onshape entity -> its sketchEntityType (with arcs told from circles)
  split: Set<string>; // Onshape curves the converter split (the baseline only; none since the cut by the tool)
  curveOf: Map<string, { id: Id; reversed: boolean }>; // an exact duplicate -> the curve written for it
  ops: StudioOperations; // the decode of external IDs, in the studio that holds the constraint's own feature
  frame: SketchFrame;
  parameters: readonly { name: string; expr: string }[];
  resolve: ExternalResolver;
  plans: EntryPlan[]; // the patterns and mirrors of curves, and which are entries
  chains: Map<string, { curves: Id[]; points: Id[] }>; // the splines written, by Onshape entity
  spokes: Set<Id>; // the spokes made so far
  entities: Map<string, any>; // the Onshape entities of the geometry endpoint
}

// An Onshape entity as Onshape has it: a point, a line, a circle, an arc or something else.
export const onshapeKind = (e: any): 'point' | 'line' | 'circle' | 'arc' | 'other' =>
  e.sketchEntityType === 'skPoint' ? 'point' : e.sketchEntityType === 'skLineSegment' ? 'line' : e.sketchEntityType === 'skCircle' && !e.startPointId ? 'circle' : e.sketchEntityType === 'skCircle' || e.sketchEntityType === 'skArc' ? 'arc' : 'other';

export const params = (c: any): Record<string, any> => Object.fromEntries(c.parameters.map((q: any) => [q.parameterId, q]));
const externalIds = (q: any): string[] => (q?.queries ?? []).flatMap((x: any) => x.deterministicIds ?? []);

// The rows of an Onshape pattern: rows[i][j] is entity i of instance j (0 the seed).
export function instanceRows(c: any): string[][] {
  const rows: string[][] = [];
  for (const q of c.parameters) { const m = /^localInstance(\d+),(\d+)$/.exec(q.parameterId); if (m) (rows[+m[1]] ??= [])[+m[2]] = q.value; }
  return rows.filter(Boolean);
}

// The Onshape type with its form, as the tables count it.
export function whatOf(c: any, entityType: Map<string, string>): string {
  const p = params(c);
  const t: string = c.constraintType;
  const k = (v: any) => (typeof v?.value === 'string' ? entityType.get(v.value) : undefined);
  if (t === 'DISTANCE' && p.direction?.value && p.direction.value !== 'MINIMUM') return `DISTANCE (${String(p.direction.value).toLowerCase()})`;
  if (t === 'DISTANCE' && k(p.localFirst) === 'line' && k(p.localSecond) === 'line') return 'DISTANCE of two lines';
  if ((t === 'HORIZONTAL' || t === 'VERTICAL') && k(p.localFirst) === 'point' && k(p.localSecond) === 'point') return `${t} of two points`;
  if (t === 'MIDPOINT' && (p.localMidpoint || (k(p.localEntity1) === 'point' && k(p.localEntity2) === 'point'))) return 'MIDPOINT of two points';
  return t;
}

// The operands of a constraint, local and external, with what each is.
export function operandsOf(c: any, ctx: MapContext): OperandRecord[] {
  const out: OperandRecord[] = [];
  for (const q of c.parameters) {
    if (/^localInstance/.test(q.parameterId)) continue;
    if (/^local/.test(q.parameterId) && typeof q.value === 'string') {
      const k = ctx.entityType.get(q.value);
      const category: Category | undefined = ctx.split.has(q.value) ? 'split' : k === 'arc' && !ctx.kind.has(q.value) ? 'arc' : k === 'other' ? 'spline' : undefined;
      out.push({ param: q.parameterId, id: q.value, external: false, ...(category ? { category } : {}) });
    } else if (/^external/.test(q.parameterId))
      for (const id of externalIds(q)) {
        const cls = ctx.ops.classify(id);
        out.push({ param: q.parameterId, id, external: true, category: categoryOf(cls), decoded: classText(cls) });
      }
  }
  return out;
}

// The cause of a loss: the first of the list that applies.
export function causeOf(rec: ConstraintRecord, mirrorOfCurves: boolean): { cause: Cause; category?: Category } {
  const applies = new Set<Cause>(['kind']);
  if (/PATTERN/.test(rec.type)) applies.add('pattern');
  if (mirrorOfCurves) applies.add('mirror');
  for (const o of rec.operands) if (o.category) applies.add(o.category);
  const cause = CAUSES.find((c) => applies.has(c))!;
  const category = rec.operands.find((o) => o.category)?.category;
  return { cause, category };
}

// An operand as the mapping uses it: what it is in trymesh, its ID, and where it is.
export interface Operand {
  k: 'point' | 'line' | 'circle' | 'arc';
  id: Id;
  ext?: 'origin' | 'axis' | 'sketch' | 'edge'; // not own geometry
  at?: V2; // a point: its place
  ends?: [V2, V2]; // a line: its two ends in its direction (an axis: from the origin along +X or +Y)
  center?: V2; // a circle or an arc
  radius?: number;
  own?: Id[]; // the own points of a curve (a line's ends, an arc's start and end)
}
export type Resolved = Operand | { lost: Cause; detail: string };
// Resolves an external ID for a use (the local operands beside it): the origin, an axis, an entry.
export type ExternalResolver = (id: string, op: OperandRecord, locals: Operand[], type: string) => Resolved;

// Onshape's horizontal is the X of the sketch's matrix: along the base's X it is trymesh's
// horizontal, along the base's Y its vertical; turned otherwise, nothing (the sense does not matter).
export function horizontalOf(frame: { x: number[]; base: { x: readonly number[]; y: readonly number[] } }): 'x' | 'y' | undefined {
  const d = (u: readonly number[], v: readonly number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  if (Math.abs(Math.abs(d(frame.x, frame.base.x)) - 1) < 1e-9) return 'x';
  if (Math.abs(Math.abs(d(frame.x, frame.base.y)) - 1) < 1e-9) return 'y';
  return undefined;
}

const AXIS_ENDS: Record<string, [V2, V2]> = { 'origin/x': [[0, 0], [1, 0]], 'origin/y': [[0, 0], [0, 1]] };

// The mapping (design of 6h, "The constraint on it" and "Kinds taken along"): every operand, own or
// external, is resolved to an entity of the sketch, and the constraint goes through one table. A
// dimension carries the value measured on the geometry (`measured`) for the fall-back to numbers.
export function mapConstraints(ctx: MapContext, list: any[]): { records: ConstraintRecord[]; commands: any[] } {
  const out: any[] = [];
  const records: ConstraintRecord[] = [];
  const curveId = (v: string) => ctx.curveOf.get(v)?.id ?? `${ctx.sketch}.${sane(v)}`;
  const curve = (v: string) => ctx.curves.find((c) => c.id === curveId(v));
  const P = (i: Id): V2 => (i === 'origin' ? [0, 0] : ctx.pos.get(i)!);
  const value = (q: any) => { const e = expression(q?.expression); return e === undefined ? undefined : numberOr(e); };
  const horizontal = horizontalOf(ctx.frame);
  // a local operand
  const local = (v: string): Operand | undefined => {
    const k = ctx.kind.get(v);
    if (k === 'point') { const id = ctx.rep.get(v)!; return { k, id, at: P(id) }; }
    const c = curve(v);
    if (!c) return undefined;
    if (c.line) return { k: 'line', id: c.id, ends: [P(c.line[0]), P(c.line[1])], own: c.line };
    if (c.circle) return { k: 'circle', id: c.id, center: P(c.circle.c), radius: c.circle.r, own: [c.circle.c] };
    if (c.arc) { const [o, s0] = [P(c.arc[0]), P(c.arc[1])]; return { k: 'arc', id: c.id, center: o, radius: Math.hypot(s0[0] - o[0], s0[1] - o[1]), own: c.arc }; }
    return undefined;
  };
  let n = 0;
  let rec!: ConstraintRecord;
  const add = (constraint: any, measured?: number, extra: Record<string, unknown> = {}) => {
    const cmd = { type: 'addConstraint', sketch: ctx.sketch, id: `${ctx.sketch}.t${n++}`, constraint, measured, record: rec, ...extra };
    out.push(cmd);
    rec.commands.push(cmd as any);
  };
  const lose = (detail?: string, extraCause?: Cause) => {
    const { cause, category } = causeOf(rec, extraCause === 'mirror');
    const chosen = extraCause && extraCause !== 'mirror' && CAUSES.indexOf(extraCause) < CAUSES.indexOf(cause) ? extraCause : cause;
    Object.assign(rec, { fate: 'lost', cause: chosen, ...(category ? { category } : {}), ...(detail ? { detail } : {}) });
  };
  list.forEach((c, index) => {
    const p = params(c);
    const t: string = c.constraintType;
    rec = { key: `${ctx.studio}/${ctx.sketch}#${index}`, studio: ctx.studio, sketch: ctx.sketch, sketchName: ctx.name, helper: ctx.helper, index, type: t, what: whatOf(c, ctx.entityType), operands: operandsOf(c, ctx), commands: [], ids: [] };
    records.push(rec);
    // a pattern or a mirror written as an entry, and what its copies realise
    const plan = ctx.plans.find((x) => x.constraint === c);
    if (plan && !plan.why) return void Object.assign(rec, { fate: 'entry', detail: plan.type });
    if (ctx.plans.some((x) => !x.why && x.exempt.has(c))) return void Object.assign(rec, { fate: 'shared', detail: 'by copies' });
    if (plan?.why) rec.extra = { ...(rec.extra ?? {}), entry: plan.why };
    // a pattern that is no entry: by spokes
    if (/PATTERN/.test(t)) {
      if (!plan || c.constraintType !== 'CIRCULAR_PATTERN' || p.openPattern?.value) return lose(plan?.why);
      return spokes(plan);
    }
    // FIX of a spline written: every control point of its chain fixed at its place, each once
    const chain = t === 'FIX' && typeof p.localFirst?.value === 'string' ? ctx.chains.get(p.localFirst.value) : undefined;
    if (chain) {
      for (const pid of new Set(chain.points)) { const [x, y] = P(pid); add({ type: 'fixed', point: pid, x, y }); }
      rec.detail = 'every control point';
      return;
    }
    // the operands, local first, then the external ones resolved against them
    const slot = (name: string): Operand | undefined | { lost: Cause; detail: string } => {
      const q = p[`local${name}`];
      if (typeof q?.value === 'string') return local(q.value);
      const x = p[`external${name}`];
      const id = x?.queries?.flatMap((y: any) => y.deterministicIds ?? [])[0];
      if (id === undefined) return undefined;
      const op = rec.operands.find((o) => o.external && o.id === id && o.param === `external${name}`)!;
      const locals = [p.localFirst, p.localSecond].map((y) => (typeof y?.value === 'string' ? local(y.value) : undefined)).filter(Boolean) as Operand[];
      const r = ctx.resolve(id, op, locals, t);
      if ('lost' in r) { op.note = r.detail; return r; }
      op.resolved = r.id;
      return r;
    };
    const [A0, B0, M0] = [slot('First'), slot('Second'), slot('Mirror')];
    for (const x of [A0, B0, M0]) if (x && 'lost' in x) return lose(x.detail, x.lost);
    const [A, B, M] = [A0, B0, M0] as (Operand | undefined)[];
    const before = out.length;
    const ownPoint = (o: Operand) => !o.ext;
    const direction = p.direction?.value ?? 'MINIMUM';
    const isRound = (o?: Operand) => o?.k === 'circle' || o?.k === 'arc';
    const isCurve = (o?: Operand) => o?.k === 'line' || isRound(o);
    if (t === 'COINCIDENT' && A && B) {
      if (A.k === 'point' && B.k === 'point') {
        // `shared` is established, not assumed: two points that are not one point get a coincident
        if (A.id === B.id) return void Object.assign(rec, { fate: 'shared', detail: 'by a point' });
        add({ type: 'coincident', a: A.id, b: B.id });
      } else if ((A.k === 'point') !== (B.k === 'point')) {
        const [pp, cc] = A.k === 'point' ? [A, B] : [B, A];
        // a point "on" a curve it is an end of is realised by the curve
        if (cc.k !== 'circle' && cc.own && (cc.k === 'line' ? cc.own : cc.own.slice(1)).includes(pp.id)) return void Object.assign(rec, { fate: 'shared', detail: 'an end of the curve' });
        add({ type: 'pointOnCurve', point: pp.id, curve: cc.id });
      }
    } else if ((t === 'HORIZONTAL' || t === 'VERTICAL') && A?.k === 'line' && !B) {
      if (!horizontal) return lose('the sketch is turned in its plane', 'kind');
      const along = (t === 'HORIZONTAL') === (horizontal === 'x') ? 'horizontal' : 'vertical';
      add({ type: along, line: A.id });
    } else if ((t === 'HORIZONTAL' || t === 'VERTICAL') && A?.k === 'point' && B?.k === 'point') {
      if (!horizontal) return lose('the sketch is turned in its plane', 'kind');
      // Onshape's horizontal of two points: the same Y of the sketch
      const sameY = (t === 'HORIZONTAL') === (horizontal === 'x'); // the same base Y
      const origin = A.id === 'origin' ? B : B.id === 'origin' ? A : undefined;
      if (origin) add({ type: 'pointOnCurve', point: origin.id, curve: sameY ? 'origin/x' : 'origin/y' });
      else if (A.id !== B.id) add({ type: sameY ? 'verticalDistance' : 'horizontalDistance', a: A.id, b: B.id, value: 0, driving: true }, 0, { zero: true });
      else return void Object.assign(rec, { fate: 'shared', detail: 'by a point' });
    } else if ((t === 'PARALLEL' || t === 'PERPENDICULAR') && A?.k === 'line' && B?.k === 'line') add({ type: t.toLowerCase(), a: A.id, b: B.id });
    else if (t === 'EQUAL' && A?.k === 'line' && B?.k === 'line') {
      if (A.ext === 'axis' || B.ext === 'axis') return lose('equalLength does not take an axis', 'plane');
      add({ type: 'equalLength', a: A.id, b: B.id });
    } else if (t === 'EQUAL' && isRound(A) && isRound(B)) add({ type: 'equalRadius', a: A!.id, b: B!.id });
    else if (t === 'TANGENT' && isCurve(A) && isCurve(B) && !(A!.k === 'line' && B!.k === 'line')) add({ type: 'tangent', a: A!.id, b: B!.id });
    else if ((t === 'DIAMETER' || t === 'RADIUS') && isRound(A) && !A!.ext) add({ type: t.toLowerCase(), curve: A!.id, value: value(p.length), driving: true }, t === 'DIAMETER' ? 2 * A!.radius! : A!.radius!);
    else if (t === 'MIDPOINT' && !p.localMidpoint) {
      const [e1, e2] = [p.localEntity1?.value, p.localEntity2?.value].map((v) => (typeof v === 'string' ? local(v) : undefined));
      const [pt, ln] = e1?.k === 'point' && e2?.k === 'line' ? [e1, e2] : e2?.k === 'point' && e1?.k === 'line' ? [e2, e1] : [undefined, undefined];
      if (pt && ln) add({ type: 'midpoint', point: pt.id, line: ln.id });
    } else if (t === 'MIRROR' && A?.k === 'point' && B?.k === 'point' && M?.k === 'line') {
      // a mirror of two points: symmetric about the line; a pair that is one point is on the line;
      // the image of a point of the line (an end of it, the origin on an axis) is that point
      const onAxis = (q: Operand) => (M.ext === 'axis' ? q.id === 'origin' : (M.own ?? []).includes(q.id));
      if (A.id === B.id) {
        if (onAxis(A)) return void Object.assign(rec, { fate: 'shared', detail: M.ext === 'axis' ? 'the origin on the mirror axis' : 'an end of the mirror line' });
        add({ type: 'pointOnCurve', point: A.id, curve: M.id });
      } else if (onAxis(A) || onAxis(B)) add({ type: 'coincident', a: A.id, b: B.id });
      else add({ type: 'symmetric', a: A.id, b: B.id, line: M.id });
    } else if (t === 'MIRROR' && A && B && A.k !== 'point' && B.k !== 'point' && M?.k === 'line') {
      // a mirror of two curves that is no entry: the symmetry of their points
      if (!mirror(A, B, M)) return;
    } else if (t === 'MIRROR') return lose(undefined, M?.ext === 'axis' ? 'plane' : 'mirror');
    else if (t === 'DISTANCE' && A?.k === 'point' && B?.k === 'point' && direction === 'MINIMUM') {
      add({ type: 'distance', a: A.id, b: B.id, value: value(p.length), driving: true }, Math.hypot(A.at![0] - B.at![0], A.at![1] - B.at![1]));
    } else if (t === 'DISTANCE' && A?.k === 'point' && B?.k === 'point' && (direction === 'HORIZONTAL' || direction === 'VERTICAL')) {
      if (!horizontal) return lose('the sketch is turned in its plane', 'kind');
      const alongX = (direction === 'HORIZONTAL') === (horizontal === 'x');
      const d = alongX ? B.at![0] - A.at![0] : B.at![1] - A.at![1];
      add({ type: alongX ? 'horizontalDistance' : 'verticalDistance', ...(d >= 0 ? { a: A.id, b: B.id } : { a: B.id, b: A.id }), value: value(p.length), driving: true }, Math.abs(d));
    } else if (t === 'DISTANCE' && direction === 'MINIMUM' && ((A?.k === 'point' && B?.k === 'line') || (A?.k === 'line' && B?.k === 'point'))) {
      const [pt, ln] = A!.k === 'point' ? [A!, B!] : [B!, A!];
      add({ type: 'distancePointLine', point: pt.id, line: ln.id, value: value(p.length), driving: true }, pointLine(pt.at!, ln.ends!));
    } else if (t === 'DISTANCE' && direction === 'MINIMUM' && A?.k === 'line' && B?.k === 'line' && !A.ext && !B.ext) {
      // a distance of two lines: the start of the first to the second, while the two are parallel
      const [da, db] = [sub2(A.ends![1], A.ends![0]), sub2(B.ends![1], B.ends![0])];
      if (Math.abs(da[0] * db[1] - da[1] * db[0]) > 1e-9 * Math.hypot(...da) * Math.hypot(...db)) return lose('the two lines are not parallel', 'kind');
      add({ type: 'distancePointLine', point: A.own![0], line: B.id, value: value(p.length), driving: true }, pointLine(A.ends![0], B.ends!), { pair: [A.id, B.id] });
    } else if (t === 'LENGTH' && A?.k === 'line' && !A.ext) {
      add({ type: 'distance', a: A.own![0], b: A.own![1], value: value(p.length), driving: true }, Math.hypot(A.ends![1][0] - A.ends![0][0], A.ends![1][1] - A.ends![0][1]));
    } else if (t === 'ANGLE' && A?.k === 'line' && B?.k === 'line') angle(A, B, p);
    else if (t === 'FIX' && A?.k === 'point' && !A.ext) add({ type: 'fixed', point: A.id, x: A.at![0], y: A.at![1] });
    if (out.length === before) lose();
  });
  // A mirror of two curves as the symmetry of their points: the ends of two lines paired by
  // reflecting the positions, the centres of two circles with equalRadius, the centre and the
  // swapped ends of two arcs. A pair that is one point is on the mirror line: nothing when it is an
  // end of that line or the origin on an axis, else pointOnCurve. A pair whose positions do not
  // mirror refuses the unit.
  function mirror(A: Operand, B: Operand, M: Operand): boolean {
    const [a, b] = M.ends!;
    const reflect = ([x, y]: V2): V2 => { const [dx, dy] = [b[0] - a[0], b[1] - a[1]]; const t = ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy); return [2 * (a[0] + t * dx) - x, 2 * (a[1] + t * dy) - y]; };
    const near = (u: V2, v: V2) => Math.hypot(u[0] - v[0], u[1] - v[1]) <= 1e-6;
    let bad = false;
    const pair = (p: Id, q: Id) => {
      if (p === q) {
        if ((M.own ?? []).includes(p) || (M.ext === 'axis' && p === 'origin')) return;
        if (!near(reflect(P(p)), P(p))) { bad = true; return; }
        add({ type: 'pointOnCurve', point: p, curve: M.id });
        return;
      }
      if (!near(reflect(P(p)), P(q))) { bad = true; return; }
      add({ type: 'symmetric', a: p, b: q, line: M.id });
    };
    if (A.k === 'line' && B.k === 'line') {
      const straight = near(reflect(P(A.own![0])), P(B.own![0]));
      pair(A.own![0], straight ? B.own![0] : B.own![1]);
      pair(A.own![1], straight ? B.own![1] : B.own![0]);
    } else if (A.k === 'circle' && B.k === 'circle') {
      pair(A.own![0], B.own![0]);
      add({ type: 'equalRadius', a: A.id, b: B.id });
    } else if (A.k === 'arc' && B.k === 'arc') {
      pair(A.own![0], B.own![0]);
      pair(A.own![1], B.own![2]);
      pair(A.own![2], B.own![1]);
    } else bad = true;
    if (bad) { rec.commands = []; Object.assign(rec, { fate: 'lost', cause: 'refused', detail: 'the positions do not mirror' }); return false; }
    rec.detail = 'by symmetric';
    return true;
  }

  // A circular pattern that is no entry, by spokes: a construction line from the pivot to every
  // point Onshape lists in an instance; the spoke of an image point has equalLength with the spoke
  // of its seed point and an angle of 2π/n to the spoke of the instance before (the angles tie the
  // spokes as a tree, never as a ring); an image circle has equalRadius with its seed. The sense is
  // read off the written positions; the count is a number.
  function spokes(plan: EntryPlan) {
    const E = ctx.entities;
    const p = params(plan.constraint);
    const isPoint = (v: string) => E.get(v)?.sketchEntityType === 'skPoint';
    let pivot: Id | undefined = plan.pivot ? ctx.rep.get(plan.pivot) : undefined;
    if (!pivot && plan.pivotExternal) { const k = knownOperand(plan.pivotExternal, ctx.frame); if (k && !('lost' in k) && k.k === 'point') pivot = k.id; }
    if (!pivot) return lose(`${plan.why}; the pivot is not a point of the sketch or the origin`);
    let n = typeof plan.count === 'number' ? plan.count : expressionValue(String(plan.count), ctx.parameters as any);
    if (n === undefined || !Number.isInteger(n) || n < 2) return lose(`${plan.why}; the count ${plan.count} is no whole number of at least 2`);
    if (typeof plan.count === 'string') (rec.numbers ??= []).push(`the count \`${plan.count}\` of the pattern as ${n}: a pattern by spokes cannot be counted again`);
    // the rows of points: as Onshape lists them, or the points of the curve rows in the order start, end, centre
    let rows = plan.rows.filter((r) => isPoint(r[0]));
    if (!rows.length) rows = plan.rows.flatMap((r) => ['startPointId', 'endPointId', 'centerId'].map((k) => r.map((v) => E.get(v)?.[k])).filter((x) => x.every(Boolean)));
    const pts = rows.map((r) => r.map((v) => ctx.rep.get(v)));
    if (pts.some((r) => r.some((v) => !v))) return lose(`${plan.why}; a point of an instance is not in the sketch`);
    const O = P(pivot);
    const step = (2 * Math.PI) / n;
    const spoke = (q: Id): Id | undefined => {
      if (q === pivot) return undefined; // a point of an instance at the pivot is the same in every instance
      // a spoke of each pattern of its own: two patterns that share a point (about one pivot or two)
      // never share a spoke, so a unit dropped takes only its own curves
      const sid = `${ctx.sketch}.spoke${plan.index}.${q.slice(ctx.sketch.length + 1)}`;
      if (!ctx.spokes.has(sid)) { ctx.spokes.add(sid); rec.commands.push({ type: 'addCurve', sketch: ctx.sketch, id: sid, curve: { type: 'line', a: pivot, b: q, construction: true } } as any); }
      return sid;
    };
    const parent = new Map<Id, Id>();
    const root = (x: Id): Id => { while (parent.has(x)) x = parent.get(x)!; return x; };
    let sense = 0;
    for (const row of pts as Id[][]) {
      const s0 = spoke(row[0]);
      if (!s0) continue;
      for (let j = 1; j < row.length; j++) {
        const [qa, qb] = [row[j - 1], row[j]];
        const [sa, sb] = [spoke(qa), spoke(qb)];
        if (!sa || !sb || sa === sb || root(sa) === root(sb)) continue;
        const [da, db] = [sub2(P(qa), O), sub2(P(qb), O)];
        const th = Math.atan2(da[0] * db[1] - da[1] * db[0], da[0] * db[0] + da[1] * db[1]);
        const s = n === 2 ? 1 : Math.sign(th);
        if (Math.abs(Math.abs(th) - step) > 1e-6) { rec.commands = []; return lose(`${plan.why}; a point of instance ${j} does not land on its seed turned`); }
        sense ||= s;
        parent.set(root(sa), root(sb));
        if (sb !== s0) add({ type: 'equalLength', a: s0, b: sb });
        const value = n === 2 ? 'pi' : s > 0 ? `2 * pi / ${n}` : `-(2 * pi / ${n})`;
        add({ type: 'angle', a: sa, b: sb, value, driving: true }, n === 2 ? Math.PI : s * step, { spoke: true });
      }
    }
    // the image circles have the radius of their seeds
    for (const r of plan.rows) {
      const s0 = local(r[0]);
      if (s0?.k !== 'circle' && s0?.k !== 'arc') continue;
      for (let j = 1; j < r.length; j++) { const im = local(r[j]); if (im && (im.k === 'circle' || im.k === 'arc')) add({ type: 'equalRadius', a: s0.id, b: im.id }); }
    }
    rec.detail = 'by spokes';
    rec.extra = { ...(rec.extra ?? {}), count: n, sense };
  }

  // an angle of two lines: trymesh measures from the direction of `a` to that of `b`,
  // counter-clockwise, in (−π, π]; Onshape gives an unsigned value and three flags. Of the forms
  // `e`, `-(e)`, `pi - (e)`, `(e) - pi` those whose value is the measured angle fit.
  function angle(A: Operand, B: Operand, p: Record<string, any>) {
    const [da, db] = [sub2(A.ends![1], A.ends![0]), sub2(B.ends![1], B.ends![0])];
    let th = Math.atan2(da[0] * db[1] - da[1] * db[0], da[0] * db[0] + da[1] * db[1]);
    if (th <= -Math.PI) th += 2 * Math.PI; // atan2(-0, -1): the half turn is π in (−π, π]
    const e = expression(p.angle?.expression);
    const v = e === undefined ? undefined : expressionValue(e, ctx.parameters as any);
    const forms: [string, number][] = v === undefined ? [] : [[e!, v], [`-(${e})`, -v], [`pi - (${e})`, Math.PI - v], [`(${e}) - pi`, v - Math.PI]];
    const fit = forms.filter(([, x]) => Math.abs(x - th) < 1e-6);
    const flags = { clockwise: p.clockwise?.value, aligned: p.aligned?.value, flipped: p.flipped?.value, frameSign: ctx.frame.sign };
    let written: number | string = th;
    let form: string;
    if (fit.length === 1 || (fit.length > 1 && !namesIn(e!).length)) { written = numberOr(fit[0][0]); form = fit[0][0] === e ? 'e' : fit[0][0].replace(e!, 'e'); }
    else if (fit.length > 1) { form = 'ambiguous'; (rec.numbers ??= []).push(`the angle \`${e}\` fits ${fit.map(([f]) => `\`${f}\``).join(' and ')} at ${+th.toFixed(9)}: ambiguous, written as the number`); }
    else { form = 'none'; (rec.numbers ??= []).push(`the angle \`${e ?? p.angle?.expression}\` fits no form at ${+th.toFixed(9)}: written as the number`); }
    rec.extra = { ...flags, form };
    add({ type: 'angle', a: A.id, b: B.id, value: written, driving: true }, th);
  }
  // A number that does not match the geometry (a sign, a direction measured otherwise) takes the
  // measured value; a value whose expression does not convert, too.
  for (const c of out) {
    const k = c.constraint;
    if (!('driving' in k)) continue;
    if (k.value === undefined) { k.value = c.measured; (c.record.numbers ??= []).push(`${c.id}: the expression does not convert, the measured ${+c.measured.toFixed(9)}`); }
    if (typeof k.value === 'number' && Math.abs(k.value - c.measured) > 1e-6) { (c.record.numbers ??= []).push(`${c.id}: ${k.value} does not match the geometry, the measured ${+c.measured.toFixed(9)}`); k.value = c.measured; }
  }
  return { records, commands: out };
}

const sub2 = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const pointLine = (q: V2, [a, b]: [V2, V2]) => Math.abs((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);

// The origin and the default planes (design of 6h, "What an external ID is", 1 and 2): `IB` is the
// origin; a default plane perpendicular to the sketch plane is the axis along which it is seen
// edge-on (its normal along the base's Y: `origin/x`; along the base's X: `origin/y`); a plane
// parallel to the sketch is no operand.
export function knownOperand(id: string, frame: { base: { x: readonly number[]; y: readonly number[]; normal: readonly number[] } }): Resolved | undefined {
  if (id === ORIGIN_ID) return { k: 'point', id: 'origin', ext: 'origin', at: [0, 0] };
  const plane = DEFAULT_PLANES[id];
  if (!plane) return undefined;
  const d = (u: readonly number[]) => u[0] * plane.normal[0] + u[1] * plane.normal[1] + u[2] * plane.normal[2];
  if (Math.abs(d(frame.base.normal)) > 1e-9) return { lost: 'plane', detail: `the ${plane.name} plane is not seen edge-on in the sketch` };
  const axis = Math.abs(Math.abs(d(frame.base.y)) - 1) < 1e-9 ? 'origin/x' : Math.abs(Math.abs(d(frame.base.x)) - 1) < 1e-9 ? 'origin/y' : undefined;
  if (!axis) return { lost: 'plane', detail: `the ${plane.name} plane is not along an axis of the sketch` };
  return { k: 'line', id: axis, ext: 'axis', ends: AXIS_ENDS[axis] };
}

// `twice` by meaning (design of 6h, "Fates"): the engine's key says which constraint the sketch
// cannot hold twice; the converter compares in a canonical form: the operands in the key's order,
// for the kinds whose two operands the catalog calls unordered (an angle, a horizontal and
// a vertical distance) the value negated when the key swapped them, an angle back into (−π, π],
// no negative zero, and the values at today's parameters. Equal is `twice` (an expression is kept
// over a number); another value for the same key is `refused`. A unit is twice when every
// constraint it would write is.
const SIGNED = new Set(['angle', 'horizontalDistance', 'verticalDistance']);
export function canonicalValue(c: any, parameters: readonly any[]): number | undefined {
  if (!('value' in c)) return undefined;
  let v = typeof c.value === 'number' ? c.value : expressionValue(c.value, parameters as any);
  if (v === undefined) return undefined;
  const spec = (CONSTRAINTS as any)[c.type];
  if (SIGNED.has(c.type) && spec.unordered?.length === 2) {
    const [f1, f2] = spec.unordered;
    if (c[f1] > c[f2]) v = -v;
    if (c.type === 'angle') { while (v <= -Math.PI) v += 2 * Math.PI; while (v > Math.PI) v -= 2 * Math.PI; }
  }
  return v === 0 ? 0 : v;
}
export function twiceByMeaning(records: ConstraintRecord[], parameters: readonly any[]) {
  const keep = new Map<string, any>(); // key -> the command written for it
  for (const r of records) {
    if (r.fate) continue;
    for (const c of r.commands as any[]) {
      if (c.type !== 'addConstraint') continue;
      const key = constraintKey(c.constraint);
      const there = keep.get(key);
      if (!there) { keep.set(key, c); continue; }
      const [a, b] = [canonicalValue(there.constraint, parameters), canonicalValue(c.constraint, parameters)];
      const same = a === undefined && b === undefined ? true : a !== undefined && b !== undefined && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
      if (!same) { c.conflictsWith = there; continue; }
      if (typeof there.constraint.value === 'number' && typeof c.constraint.value === 'string') {
        // the expression is the one written
        there.dupOf = c;
        keep.set(key, c);
      } else c.dupOf = there;
    }
  }
  for (const r of records) {
    if (r.fate) continue;
    const cons = (r.commands as any[]).filter((c) => c.type === 'addConstraint');
    const conflict = cons.find((c) => c.conflictsWith);
    if (conflict) { Object.assign(r, { fate: 'lost', cause: 'refused', detail: `another value for the same operands as ${conflict.conflictsWith.record.key}` }); continue; }
    if (cons.length && cons.every((c) => c.dupOf)) {
      let of = cons[0].dupOf;
      while (of.dupOf) of = of.dupOf;
      Object.assign(r, { fate: 'twice', twiceOf: of.record.key });
      continue;
    }
    r.commands = (r.commands as any[]).filter((c) => !c.dupOf);
  }
}

// The constraints numbered zero padded in the order written (the solver takes them in the string
// order of their IDs, which is then the order of writing).
export function numberConstraints(records: ConstraintRecord[], sketch: Id) {
  const live = records.filter((r) => !r.fate).flatMap((r) => (r.commands as any[]).filter((c) => c.type === 'addConstraint'));
  const width = Math.max(3, String(live.length).length);
  live.forEach((c, i) => { c.id = `${sketch}.c${String(i).padStart(width, '0')}`; });
}
