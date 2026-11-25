// The check (design of 6h, "The check"): what passes, the units, the ladder, the sketch's probe and
// the removal of implied constraints.
import type { Command, Constraint, Engine, Id, SketchResult } from '../../packages/engine/src/index';
import type { Report, V2 } from './common';
import type { ConstraintRecord } from './fates';
import { type Change, dimensionChanges, holds, parametersNamed } from './probe';

// What a sketch must hold to pass: Onshape's place of every own point and Onshape's radius of every
// circle (an arc is its three points), within 1e-6.
export const TOLERANCE = 1e-6;
export interface Expected {
  points: Map<Id, V2>;
  radii: Map<Id, number>;
}

export interface Judged {
  ok: boolean;
  why?: string;
  conflicting?: Id[];
  drift?: number;
  result?: SketchResult;
}

// The sketch as a result holds it: status `ok` (no warning: a solver that fails leaves a warning
// with possibly nothing named), no conflict, every point and radius where Onshape has it.
export function judge(sketch: Id, r: any, expected: Expected): Judged {
  const res = r.state.evaluation.features[sketch];
  if (!res) return { ok: false, why: 'the sketch is not evaluated' };
  if (res.status !== 'ok' || !res.sketch) return { ok: false, why: `${res.status}${res.error ? ` ${res.error.code}` : ''}${res.warnings.length ? ` ${res.warnings.map((w: any) => w.code).join(',')}` : ''}`, conflicting: res.sketch?.conflicting ?? [] };
  if (res.sketch.conflicting.length) return { ok: false, why: 'conflict', conflicting: res.sketch.conflicting };
  let drift = 0;
  for (const [pid, [x, y]] of expected.points) { const q = res.sketch.points[pid]; drift = Math.max(drift, q ? Math.hypot(q.x - x, q.y - y) : Infinity); }
  for (const [cid, r0] of expected.radii) drift = Math.max(drift, Math.abs((res.sketch.radii[cid] ?? Infinity) - r0));
  if (!(drift <= TOLERANCE)) return { ok: false, why: `a point or a radius moved by ${drift.toExponential(1)} mm`, drift };
  return { ok: true, drift, result: res.sketch };
}

export function previewJudge(engine: Engine, sketch: Id, commands: Command[], expected: Expected): Judged {
  const r = engine.preview({ type: 'batch', commands });
  if (!r.ok) return { ok: false, why: `refused: ${r.error.message.slice(0, 200)}` };
  return judge(sketch, r, expected);
}

// A command of a unit as the converter makes it: the command, and what a dimension measures.
export const strip = ({ measured, record, dupOf, ...c }: any): Command => c;

// The ladder: all units with their expressions; else one by one in Onshape's order, a unit with its
// expressions, else with its dimensions as their measured numbers, else refused. A unit is kept or
// dropped whole. Sets the fates of the records it writes or refuses.
export function ladder(engine: Engine, sketch: Id, base: Command[], units: ConstraintRecord[], expected: Expected): { commands: Command[]; step: string; previews: number; drift: number } {
  const all = units.flatMap((u) => u.commands.map(strip));
  let previews = 1;
  const first = previewJudge(engine, sketch, [...base, ...all], expected);
  if (first.ok) {
    for (const u of units) Object.assign(u, { fate: 'written', written: 'expressions', ids: idsOf(u) });
    return { commands: all, step: 'all units', previews, drift: first.drift ?? 0 };
  }
  const kept: Command[] = [];
  let drift = 0;
  for (const u of units) {
    const own = u.commands.map(strip);
    previews++;
    let j = previewJudge(engine, sketch, [...base, ...kept, ...own], expected);
    let written: 'expressions' | 'number' = 'expressions';
    if (!j.ok && (u.commands as any[]).some((c) => typeof c.constraint?.value === 'string')) {
      const numbers = (u.commands as any[]).map((c) => (typeof c.constraint?.value === 'string' ? strip({ ...c, constraint: { ...c.constraint, value: c.measured } }) : strip(c)));
      previews++;
      const k = previewJudge(engine, sketch, [...base, ...kept, ...numbers], expected);
      if (k.ok) {
        j = k;
        written = 'number';
        for (const c of u.commands as any[]) if (typeof c.constraint?.value === 'string') (u.numbers ??= []).push(`${c.id}: \`${c.constraint.value}\` as ${+c.measured.toFixed(9)}: the geometry does not have the expression's value (${first.why})`);
        u.commands = (u.commands as any[]).map((c) => (typeof c.constraint?.value === 'string' ? { ...c, constraint: { ...c.constraint, value: c.measured } } : c));
        own.splice(0, own.length, ...numbers);
      }
    }
    if (!j.ok) { Object.assign(u, { fate: 'lost', cause: 'refused', detail: `${j.why}${j.conflicting?.length ? `; conflicting: ${j.conflicting.join(', ')}` : ''}` }); continue; }
    drift = Math.max(drift, j.drift ?? 0);
    kept.push(...own);
    Object.assign(u, { fate: 'written', written, ids: idsOf(u) });
  }
  return { commands: kept, step: `one by one (${first.why})`, previews, drift };
}
const idsOf = (u: ConstraintRecord) => (u.commands as any[]).filter((c) => c.type === 'addConstraint').map((c) => c.id as Id);

// ---------------------------------------------------------------- the sketch's probe

// The parameters a sketch reads, itself or through what its entries name (an earlier sketch it
// projects from, the bodies an edge comes from).
export function parametersRead(engine: Engine, sketch: Id): Set<string> {
  const doc: any = engine.getState().document;
  const seen = new Set<Id>();
  const features: any[] = [];
  const reads = (fid: Id) => {
    if (seen.has(fid)) return;
    seen.add(fid);
    const f = doc.features.find((x: any) => x.id === fid);
    if (!f) return;
    features.push(f);
    for (const x of Object.values(f.external ?? {}) as any[]) {
      if (x.type === 'sketch') reads(x.sketch);
      if (x.type === 'edge') for (const g of doc.features) { if (g.id === fid) break; reads(g.id); }
    }
    if (f.profile?.sketch) reads(f.profile.sketch);
  };
  reads(sketch);
  return parametersNamed(doc, features).names;
}

// The changes of the sketch's probe: every parameter it reads and every literal driving dimension,
// +3 %, +6 %, back; −3 %, −6 %, back.
export function sketchChanges(engine: Engine, sketch: Id, notChanged: Set<string>): Change[] {
  const doc: any = engine.getState().document;
  const names = parametersRead(engine, sketch);
  const out: Change[] = [];
  for (const p of doc.parameters ?? []) {
    if (!names.has(p.name)) continue;
    const v = Number(p.expr);
    if (!Number.isFinite(v) || !/^-?[0-9.]+(e-?[0-9]+)?$/i.test(String(p.expr).trim())) continue;
    for (const sg of [1, -1]) {
      const values = v === 0 ? [sg * 0.1, sg * 0.2] : [v * (1 + sg * 0.03), v * (1 + sg * 0.06)];
      out.push({ group: 'parameters', key: `parameter ${p.name} ${sg > 0 ? 'up' : 'down'}`, label: `parameter ${p.name} ${sg > 0 ? 'up' : 'down'}`, steps: values.map((x) => ({ type: 'setParameter', name: p.name, expr: String(+x.toFixed(9)) }) as Command), back: { type: 'setParameter', name: p.name, expr: p.expr } as Command });
    }
  }
  const f = doc.features.find((x: any) => x.id === sketch);
  for (const ch of dimensionChanges(f, notChanged)) {
    if (ch.notAvailable) continue;
    const step = ch.steps[0] as any;
    const v0 = f.constraints[step.id].value;
    const second = v0 === 0 ? 2 * step.value : v0 + 2 * (step.value - v0);
    out.push({ ...ch, label: `dimension ${ch.label}`, steps: [step, { ...step, value: second }] });
  }
  return out;
}

export interface SketchProbe {
  breaks: Set<string>;
  wander: string[]; // a sketch with freedom that came back elsewhere: a note
  checked: Map<Id, number>; // removed constraints: at how many changed states they were checked
  failedHold: Id[]; // removed constraints that did not hold at a state that solves
  solves: number;
}

const areas = (res: SketchResult) => res.regions.map((r) => regionAreaOf(r.loops)).sort((a, b) => a - b);
function regionAreaOf(loops: Float64Array[]) {
  return loops.reduce((s, l, i) => { let a = 0; for (let q = 0; q < l.length; q += 2) { const w = (q + 2) % l.length; a += l[q] * l[w + 1] - l[w] * l[q + 1]; } return s + (i === 0 ? 1 : -1) * Math.abs(a / 2); }, 0);
}

// Two lines that must stay parallel (a "distance of two lines" written as a point–line distance).
export type Pair = { a: Id; b: Id; label: string };

export function probeSketch(engine: Engine, sketch: Id, changes: Change[], gone: { id: Id; constraint: Constraint }[], pairs: Pair[] = []): SketchProbe {
  const out: SketchProbe = { breaks: new Set(), wander: [], checked: new Map(), failedHold: [], solves: 0 };
  const now = () => engine.getState().evaluation.features[sketch];
  const base = now().sketch!;
  const baseValid = base.valid;
  const free = base.degreesOfFreedom > 0;
  const baseAreas = areas(base);
  for (const ch of changes) {
    let done = 0;
    for (let i = 0; i < ch.steps.length; i++) {
      const r = engine.execute(ch.steps[i]);
      out.solves++;
      if (!r.ok) { out.breaks.add(`${ch.label}: refused`); break; }
      done++;
      const res = now();
      if (res.status !== 'ok' || !res.sketch || res.sketch.conflicting.length) { out.breaks.add(`${ch.label}: cannot follow`); continue; }
      if (baseValid && !res.sketch.valid) out.breaks.add(`${ch.label}: invalid profile`);
      const f: any = engine.getState().document.features.find((x) => x.id === sketch);
      for (const p of pairs) if (!parallel(f, res.sketch, p)) out.breaks.add(`${ch.label}: ${p.label} no longer parallel`);
      for (const g of gone) {
        out.solves++;
        out.checked.set(g.id, (out.checked.get(g.id) ?? 0) + 1);
        if (!holds(engine, sketch, g.id, g.constraint) && !out.failedHold.includes(g.id)) out.failedHold.push(g.id);
      }
    }
    if (ch.back && done === ch.steps.length) {
      const r = engine.execute(ch.back);
      out.solves++;
      if (!r.ok) out.breaks.add(`${ch.label}: refused on the return`);
      else {
        done++;
        const res = now();
        if (res.status !== 'ok' || !res.sketch || res.sketch.conflicting.length) out.breaks.add(`${ch.label}: not back (cannot follow)`);
        else {
          let d = 0;
          for (const [pid, q] of Object.entries(base.points)) { const w = res.sketch.points[pid]; d = Math.max(d, w ? Math.hypot(w.x - q.x, w.y - q.y) : Infinity); }
          const a = areas(res.sketch);
          const da = a.length === baseAreas.length ? Math.max(0, ...baseAreas.map((x, i) => Math.abs(x - a[i]))) : Infinity;
          if (d > TOLERANCE || da > TOLERANCE) {
            if (free) out.wander.push(ch.label);
            else out.breaks.add(`${ch.label}: not back`);
          }
        }
      }
    }
    for (let i = 0; i < done; i++) engine.undo();
  }
  return out;
}

function parallel(f: any, res: SketchResult, p: Pair): boolean {
  const [la, lb] = [f?.curves?.[p.a], f?.curves?.[p.b]];
  const q = res.points;
  if (!la || !lb || !q[la.a] || !q[lb.a]) return true;
  const [ux, uy, vx, vy] = [q[la.b].x - q[la.a].x, q[la.b].y - q[la.a].y, q[lb.b].x - q[lb.a].x, q[lb.b].y - q[lb.a].y];
  return Math.abs(ux * vy - uy * vx) <= 1e-9 * Math.hypot(ux, uy) * Math.hypot(vx, vy);
}

// ---------------------------------------------------------------- implied constraints

export interface Implied {
  probed: boolean;
  why?: string; // why the probe ran
  listedBySolver: Id[];
  listedByDiagnosis: Id[];
  changes: number;
  breaksBefore: string[];
  breaksAfter: string[];
  tried: number;
  removed: { id: Id; type: string; record: string; checked: number }[];
  putBack: Id[];
  wander: string[];
  solves: number;
  note?: string;
}

// Constraints removed as implied (design of 6h, "Implied constraints"): only where the sketch's
// probe shows that the sketch cannot follow, the candidates from the engine's diagnosis, a removal
// kept only when the probe then has fewer breaks and the removed relation still holds; a last
// pass puts back what is not needed.
export function impliedConstraints(engine: Engine, sketch: Id, records: ConstraintRecord[], expected: Expected, opts: { notChanged: Set<string>; pairs?: Pair[]; force?: boolean }): Implied {
  const res = () => engine.getState().evaluation.features[sketch];
  const feat = (): any => engine.getState().document.features.find((f) => f.id === sketch);
  const diag = () => { try { return engine.diagnoseSketch(sketch).redundant; } catch { return []; } };
  const out: Implied = { probed: false, listedBySolver: res().sketch?.redundant ?? [], listedByDiagnosis: diag(), changes: 0, breaksBefore: [], breaksAfter: [], tried: 0, removed: [], putBack: [], wander: [], solves: 0 };
  const pairs = opts.pairs ?? [];
  if (!out.listedByDiagnosis.length && !pairs.length && !opts.force) return out;
  out.probed = true;
  out.why = out.listedByDiagnosis.length ? 'the diagnosis lists redundant constraints' : 'a distance of two lines';
  const recordOf = new Map<Id, ConstraintRecord>();
  for (const r of records) for (const id of r.ids) recordOf.set(id, r);
  const order = new Map<Id, number>(records.flatMap((r) => r.ids).map((id, i) => [id, i]));
  const changes = sketchChanges(engine, sketch, opts.notChanged);
  out.changes = changes.length;
  const first = probeSketch(engine, sketch, changes, [], pairs);
  out.solves += first.solves;
  out.wander = first.wander;
  out.breaksBefore = [...first.breaks];
  out.breaksAfter = [...first.breaks];
  if (!first.breaks.size) return out;
  const isDriving = (c: any) => c && 'value' in c && c.driving !== false;
  const passesNow = () => {
    const r = res();
    if (r.status !== 'ok' || !r.sketch || r.sketch.conflicting.length || r.sketch.valid !== true) return false;
    for (const [pid, [x, y]] of expected.points) { const q = r.sketch.points[pid]; if (!q || Math.hypot(q.x - x, q.y - y) > TOLERANCE) return false; }
    return true;
  };
  const gone: { id: Id; constraint: Constraint }[] = [];
  let cur = first.breaks;
  let applied = 0; // commands executed here that are still in effect
  const worse = (b: Set<string>, than: Set<string>) => [...b].some((k) => !first.breaks.has(k)) || b.size > than.size;
  for (let guard = 0; guard < 60 && cur.size; guard++) {
    const f = feat();
    const candidates = diag().filter((id) => recordOf.has(id) && !isDriving(f.constraints[id])).sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
    let best: { id: Id; b: Set<string>; c: Constraint } | undefined;
    for (const id of candidates) {
      const c = f.constraints[id];
      out.tried++;
      const r = engine.execute({ type: 'removeConstraint', sketch, id } as Command);
      if (!r.ok) continue;
      let b: Set<string> | undefined;
      if (passesNow()) {
        const p = probeSketch(engine, sketch, changes, [...gone, { id, constraint: c }], pairs);
        out.solves += p.solves;
        if (!p.failedHold.length) b = p.breaks;
      }
      engine.undo();
      if (!b || worse(b, cur)) continue;
      if (!best || b.size < best.b.size) best = { id, b, c };
    }
    if (!best) break;
    engine.execute({ type: 'removeConstraint', sketch, id: best.id } as Command);
    applied++;
    gone.push({ id: best.id, constraint: best.c });
    cur = best.b;
  }
  let kept = false;
  if (cur.size < first.breaks.size) {
    // the last pass: every removal put back in turn stays back when the probe is then no worse
    for (const g of [...gone]) {
      const r = engine.execute({ type: 'addConstraint', sketch, id: g.id, constraint: g.constraint } as Command);
      if (!r.ok) continue;
      const others = gone.filter((x) => x !== g);
      let b: Set<string> | undefined;
      const st = res();
      if (st.status === 'ok' && st.sketch && !st.sketch.conflicting.length) {
        const p = probeSketch(engine, sketch, changes, others, pairs);
        out.solves += p.solves;
        if (!p.failedHold.length) b = p.breaks;
      }
      if (!b || worse(b, cur)) { engine.undo(); continue; }
      // it stays in the sketch
      applied++;
      gone.splice(gone.indexOf(g), 1);
      out.putBack.push(g.id);
      cur = b;
    }
    const last = probeSketch(engine, sketch, changes, gone, pairs);
    out.solves += last.solves;
    const unchecked = gone.filter((g) => !last.checked.get(g.id));
    if (last.breaks.size < first.breaks.size && !unchecked.length && !last.failedHold.length) {
      kept = true;
      cur = last.breaks;
      for (const g of gone) {
        const r = recordOf.get(g.id)!;
        r.implied = (r.implied ?? 0) + 1;
        r.ids = r.ids.filter((x) => x !== g.id);
        if (!r.ids.length) Object.assign(r, { fate: 'implied', detail: 'removed as implied' });
        out.removed.push({ id: g.id, type: g.constraint.type, record: r.key, checked: last.checked.get(g.id) ?? 0 });
      }
    } else out.note = unchecked.length ? `not kept: ${unchecked.map((g) => g.id).join(', ')} not checked at a changed state that solves` : 'not kept: the probe at the end has no fewer breaks';
  }
  if (!kept) {
    // back to the sketch as written
    for (let i = 0; i < applied; i++) engine.undo();
    cur = first.breaks;
  }
  out.breaksAfter = [...cur];
  out.listedBySolver = res().sketch?.redundant ?? [];
  return out;
}

export function impliedLines(name: string, i: Implied): string[] {
  if (!i.probed) return i.listedByDiagnosis.length || i.listedBySolver.length ? [`${name}: the diagnosis lists ${i.listedByDiagnosis.length}${i.listedByDiagnosis.length ? ` (${i.listedByDiagnosis.join(', ')})` : ''}, the solver ${i.listedBySolver.length}${i.listedBySolver.length ? ` (${i.listedBySolver.join(', ')})` : ''}; not probed`] : [];
  const out = [`${name}: ${i.why}; the diagnosis lists ${i.listedByDiagnosis.length}, the solver ${i.listedBySolver.length} (${i.listedBySolver.join(', ') || 'none'}); ${i.changes} changes, ${i.breaksBefore.length} breaks with the full set${i.breaksBefore.length ? ` (${i.breaksBefore.slice(0, 8).join('; ')})` : ''}`];
  if (i.breaksBefore.length) out.push(`${name}: ${i.tried} trial removals; removed ${i.removed.length ? i.removed.map((r) => `${r.id} (${r.type}, of ${r.record}, checked at ${r.checked} states)`).join(', ') : 'none'}${i.putBack.length ? `; put back ${i.putBack.join(', ')}` : ''}; ${i.breaksAfter.length} breaks after${i.breaksAfter.length ? ` (${i.breaksAfter.slice(0, 8).join('; ')})` : ''}${i.note ? `; ${i.note}` : ''}`);
  if (i.wander.length) out.push(`${name}: comes back elsewhere after ${i.wander.join(', ')} (a sketch with freedom; a note)`);
  out.push(`${name}: ${i.solves} solves`);
  return out;
}

export type { Report };
