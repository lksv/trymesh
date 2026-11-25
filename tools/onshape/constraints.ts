// The mapping of Onshape's sketch constraints to those of trymesh: one record per Onshape constraint
// (fates.ts), whose commands are its unit.
import type { Id } from '../../packages/engine/src/index';
import { expression, numberOr, sane, type V2 } from './common';
import { CAUSES, type Category, type Cause, type ConstraintRecord, type OperandRecord } from './fates';
import { type StudioOperations, categoryOf, classText } from './operands';

// What the mapping needs of the sketch being converted.
export interface MapContext {
  studio: string;
  sketch: Id;
  name: string;
  helper: boolean;
  kind: Map<string, 'point' | 'line' | 'circle'>; // Onshape entity -> what it is in trymesh
  rep: Map<string, Id>; // Onshape point -> point of trymesh
  pos: Map<Id, V2>;
  curves: { id: string; src: string; line?: [string, string]; circle?: { c: string; r: number }; arc?: [string, string, string] }[];
  entityType: Map<string, string>; // Onshape entity -> its sketchEntityType (with arcs told from circles)
  split: Set<string>; // Onshape curves the converter split
  ops: StudioOperations; // the decode of external IDs, in the studio that holds the constraint's own feature
}

// An Onshape entity as Onshape has it: a point, a line, a circle, an arc or something else.
export const onshapeKind = (e: any): 'point' | 'line' | 'circle' | 'arc' | 'other' =>
  e.sketchEntityType === 'skPoint' ? 'point' : e.sketchEntityType === 'skLineSegment' ? 'line' : e.sketchEntityType === 'skCircle' && !e.startPointId ? 'circle' : e.sketchEntityType === 'skCircle' || e.sketchEntityType === 'skArc' ? 'arc' : 'other';

export const params = (c: any): Record<string, any> => Object.fromEntries(c.parameters.map((q: any) => [q.parameterId, q]));
const externalIds = (q: any): string[] => (q?.queries ?? []).flatMap((x: any) => x.deterministicIds ?? []);

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
      const category: Category | undefined = ctx.split.has(q.value) ? 'split' : k === 'arc' ? 'arc' : k === 'other' ? 'spline' : undefined;
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

// The baseline's mapping (the converter before 6h), with a record per constraint. A dimension
// carries the value measured on the geometry (`measured`) for the fall-back without expressions.
export function mapConstraints(ctx: MapContext, list: any[]): { records: ConstraintRecord[]; commands: any[] } {
  const out: any[] = [];
  const records: ConstraintRecord[] = [];
  const curve = (id: string) => ctx.curves.find((c) => c.id === `${ctx.sketch}.${sane(id)}`);
  const ent = (v: string | undefined) => (v === undefined ? undefined : { k: ctx.kind.get(v), id: `${ctx.sketch}.${sane(v)}` });
  const pt = (v: string) => ctx.rep.get(v) ?? `${ctx.sketch}.${sane(v)}`;
  const value = (q: any) => { const e = expression(q?.expression); return e === undefined ? undefined : numberOr(e); };
  const P = (i: Id) => ctx.pos.get(i)!;
  let n = 0;
  let rec!: ConstraintRecord;
  const add = (constraint: any, measured?: number) => {
    const cmd = { type: 'addConstraint', sketch: ctx.sketch, id: `${ctx.sketch}.c${n++}`, constraint, measured, record: rec };
    out.push(cmd);
    rec.commands.push(cmd as any);
  };
  list.forEach((c, index) => {
    const p = params(c);
    const t: string = c.constraintType;
    rec = { key: `${ctx.studio}/${ctx.sketch}#${index}`, studio: ctx.studio, sketch: ctx.sketch, sketchName: ctx.name, helper: ctx.helper, index, type: t, what: whatOf(c, ctx.entityType), operands: operandsOf(c, ctx), commands: [], ids: [] };
    records.push(rec);
    const [f, s] = [p.localFirst?.value, p.localSecond?.value];
    const [A, B] = [ent(f), ent(s)];
    const before = out.length;
    const lose = (detail?: string, mirrorOfCurves = false) => {
      const { cause, category } = causeOf(rec, mirrorOfCurves);
      Object.assign(rec, { fate: 'lost', cause, ...(category ? { category } : {}), ...(detail ? { detail } : {}) });
    };
    const direction = p.direction?.value ?? 'MINIMUM';
    if (p.externalFirst || p.externalSecond || p.externalMirror) return lose();
    if (t === 'COINCIDENT' && A?.k && B?.k) {
      if (A.k === 'point' && B.k === 'point') {
        if (pt(f) === pt(s)) Object.assign(rec, { fate: 'shared', detail: 'by a point' });
        else lose('two points that stand apart');
        return;
      }
      if (A.k === 'point' && B.k !== 'point') add({ type: 'pointOnCurve', point: pt(f), curve: B.id });
      else if (B.k === 'point' && A.k !== 'point') add({ type: 'pointOnCurve', point: pt(s), curve: A.id });
    } else if ((t === 'HORIZONTAL' || t === 'VERTICAL') && A?.k === 'line' && !B) add({ type: t.toLowerCase(), line: A.id });
    else if ((t === 'PARALLEL' || t === 'PERPENDICULAR') && A?.k === 'line' && B?.k === 'line') add({ type: t.toLowerCase(), a: A.id, b: B.id });
    else if (t === 'EQUAL' && A?.k === 'line' && B?.k === 'line') add({ type: 'equalLength', a: A.id, b: B.id });
    else if (t === 'EQUAL' && A?.k === 'circle' && B?.k === 'circle') add({ type: 'equalRadius', a: A.id, b: B.id });
    else if (t === 'TANGENT' && A?.k && B?.k && A.k !== 'point' && B.k !== 'point' && !(A.k === 'line' && B.k === 'line')) add({ type: 'tangent', a: A.id, b: B.id });
    else if ((t === 'DIAMETER' || t === 'RADIUS') && A?.k === 'circle') { const r = curve(f)!.circle!.r; add({ type: t.toLowerCase(), curve: A.id, value: value(p.length) ?? 0, driving: true }, t === 'DIAMETER' ? 2 * r : r); }
    else if (t === 'MIDPOINT') {
      const [e1, e2] = [ent(p.localEntity1?.value), ent(p.localEntity2?.value)];
      if (e1?.k === 'point' && e2?.k === 'line') add({ type: 'midpoint', point: pt(p.localEntity1.value), line: e2.id });
      else if (e2?.k === 'point' && e1?.k === 'line') add({ type: 'midpoint', point: pt(p.localEntity2.value), line: e1.id });
    } else if (t === 'MIRROR' && A?.k === 'point' && B?.k === 'point' && ent(p.localMirror?.value)?.k === 'line') {
      const axis = curve(p.localMirror.value)!.line!;
      if (pt(f) !== pt(s) && !axis.includes(pt(f)) && !axis.includes(pt(s))) add({ type: 'symmetric', a: pt(f), b: pt(s), line: ent(p.localMirror.value)!.id });
      else if (axis.includes(pt(f)) || axis.includes(pt(s))) return void Object.assign(rec, { fate: 'shared', detail: 'an end of the mirror line' });
      else return lose('a point mirrored onto itself');
    } else if (t === 'DISTANCE' && A?.k === 'point' && B?.k === 'point' && direction === 'MINIMUM') {
      const [a, b] = [P(pt(f)), P(pt(s))];
      add({ type: 'distance', a: pt(f), b: pt(s), value: value(p.length), driving: true }, Math.hypot(a[0] - b[0], a[1] - b[1]));
    } else if (t === 'DISTANCE' && direction === 'MINIMUM' && ((A?.k === 'point' && B?.k === 'line') || (A?.k === 'line' && B?.k === 'point'))) {
      const [point, line] = A!.k === 'point' ? [pt(f), s] : [pt(s), f];
      const [a, b] = curve(line)!.line!.map(P), q = P(point);
      add({ type: 'distancePointLine', point, line: ent(line)!.id, value: value(p.length), driving: true }, Math.abs((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]));
    } else if (t === 'LENGTH' && A?.k === 'line') {
      const [a, b] = curve(f)!.line!;
      add({ type: 'distance', a, b, value: value(p.length), driving: true }, Math.hypot(P(a)[0] - P(b)[0], P(a)[1] - P(b)[1]));
    }
    if (out.length === before) lose(undefined, t === 'MIRROR' && !!p.localMirror && ent(f)?.k !== 'point');
  });
  // A number that does not match the geometry (a sign, a direction measured otherwise) takes the
  // measured value; the same constraint twice is kept once.
  const seen = new Map<string, any>();
  const commands = out.filter((c) => {
    const k = c.constraint;
    if ('driving' in k) {
      if (k.value === undefined) { k.value = c.measured; (c.record.numbers ??= []).push(`${c.id}: no expression that converts`); }
      if (typeof k.value === 'number' && Math.abs(k.value - c.measured) > 1e-6) { (c.record.numbers ??= []).push(`${c.id}: ${k.value} does not match the geometry (${c.measured})`); k.value = c.measured; }
    }
    const sig = JSON.stringify({ ...k, value: undefined, a: [k.a, k.b].sort()[0], b: [k.a, k.b].sort()[1] });
    if (seen.has(sig)) { c.dupOf = seen.get(sig); return false; }
    seen.set(sig, c);
    return true;
  });
  for (const r of records) {
    if (r.fate) continue;
    const live = r.commands.filter((c: any) => !c.dupOf);
    if (r.commands.length && !live.length) Object.assign(r, { fate: 'twice', twiceOf: (r.commands[0] as any).dupOf.record.key });
    r.commands = live;
  }
  return { records, commands };
}
