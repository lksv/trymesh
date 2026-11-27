// The probes (design of 6h, "The probes"): a document is changed away from today's values and every
// state is judged. The document's probe runs after the conversion over every stored studio document
// that has a sketch; the sketch's probe (check.ts) runs inside the converter over one sketch. Both
// take their changes and their steps from here.
import { CONSTRAINTS, type Command, type Constraint, type Engine, GENERATORS, type Id, checkNumber, isDimension } from '../../packages/engine/src/index';
import { NUMBER } from './common';

// ---------------------------------------------------------------- what the conversion promised

// What the converter promised and did not write as one constraint of the engine, by studio: the
// assertions of the probe read it.
export interface PatternPromise {
  sketch: Id;
  constraint: string; // the key of the Onshape constraint
  pivot: Id; // a point of the sketch, `origin` or a projected point
  count: number;
  rows: Id[][]; // rows[i][j]: point i of instance j (0 the seed), as points of trymesh
}
export interface StudioPromises {
  patterns: PatternPromise[];
  pairs: { sketch: Id; a: Id; b: Id; constraint: string }[]; // two lines of a "distance of two lines"
  removed: { sketch: Id; id: Id; constraint: Constraint }[]; // constraints removed as implied
  derived: Record<Id, string>; // a derived copy -> its source (`<studio>/<feature>`), the same in every studio
  helpers: Id[]; // helper copies
  notChanged: string[]; // `<sketch> <constraint>`: dimensions that are no literal of the design (angles of spokes)
}
export const emptyPromises = (): StudioPromises => ({ patterns: [], pairs: [], removed: [], derived: {}, helpers: [], notChanged: [] });

// ---------------------------------------------------------------- changes

export interface Change {
  group: 'parameters' | 'dimensions' | 'helper dimensions' | 'counts up' | 'counts down';
  key: string; // the same change in two studios has the same key (parameters only)
  label: string;
  steps: Command[]; // executed one after another, each from the state the one before left
  back?: Command; // the command that sets the loaded value again
  notAvailable?: string; // the direction the range does not allow
  count?: { sketch: Id; entry: Id; from: number; to: number };
}

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/g;
const NOT_NAMES = new Set(['pi', 'deg', 'rad', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sqrt', 'abs', 'min', 'max', 'round', 'floor', 'ceil', 'e', 'mm', 'if']);
// the numbers taken out first, so the exponent of `1E-3` names no parameter `E`
export const namesIn = (expr: string): string[] => (String(expr).replace(new RegExp(NUMBER, 'g'), ' 0 ').match(IDENT) ?? []).filter((n) => !NOT_NAMES.has(n));

// The parameters an expression of the document names (and those their expressions name), and which
// of them are read as a count (of an entry, a pattern or a generator).
export function parametersNamed(doc: any, features: any[] = doc.features): { names: Set<string>; counts: Set<string> } {
  const names = new Set<string>();
  const counts = new Set<string>();
  for (const f of features)
    for (const [path, expr] of Object.entries((f.expressions ?? {}) as Record<string, string>)) {
      const found = namesIn(expr);
      for (const n of found) names.add(n);
      const param = /^profile\/params\/(\w+)$/.exec(path)?.[1];
      const integer = param && f.profile?.generator ? (GENERATORS as any)[f.profile.generator]?.params?.[param]?.integer : false;
      if (/(^|\/)count$/.test(path) || integer) for (const n of found) counts.add(n);
    }
  const params: any[] = doc.parameters ?? [];
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of params) if (names.has(p.name)) for (const n of namesIn(p.expr)) if (!names.has(n) && params.some((q) => q.name === n)) { names.add(n); grew = true; }
  }
  for (const n of [...names]) if (!params.some((p) => p.name === n)) names.delete(n);
  return { names, counts };
}

const num = (s: string) => (/^-?[0-9.]+(e-?[0-9]+)?$/i.test(String(s).trim()) ? Number(s) : undefined);
const fmt = (v: number) => String(+v.toFixed(9));

// Every parameter named, whose own expression is a number: +3 %, +6 %, back; −3 %, −6 %, back (a
// count ±1, ±2, a step under 1 left out; a zero ±0.1, ±0.2).
export function parameterChanges(doc: any, only?: Set<string>): Change[] {
  const { names, counts } = parametersNamed(doc);
  const out: Change[] = [];
  for (const p of doc.parameters ?? []) {
    if (!names.has(p.name) || (only && !only.has(p.name))) continue;
    const v = num(p.expr);
    if (v === undefined) continue;
    const count = counts.has(p.name) && Number.isInteger(v);
    for (const sg of [1, -1]) {
      const values = count ? [v + sg, v + 2 * sg].filter((x) => x >= 1) : v === 0 ? [sg * 0.1, sg * 0.2] : [v * (1 + sg * 0.03), v * (1 + sg * 0.06)];
      const dir = sg > 0 ? 'up' : 'down';
      if (!values.length) { out.push({ group: 'parameters', key: `${p.name} ${dir}`, label: `${p.name} ${dir}`, steps: [], notAvailable: 'a count under 1' }); continue; }
      out.push({ group: 'parameters', key: `${p.name} ${dir}`, label: `${p.name} ${dir}`, steps: values.map((x) => ({ type: 'setParameter', name: p.name, expr: fmt(x) }) as Command), back: { type: 'setParameter', name: p.name, expr: p.expr } as Command });
    }
  }
  return out;
}

// The literal driving dimensions of a sketch: a number, or an expression without a parameter; not
// the angles of spokes. +3 % and back, −3 % and back; a
// zero takes an absolute step (0.1 mm, 1°); a direction the range does not allow is not available.
export function dimensionChanges(sketch: any, notChanged: Set<string>, group: Change['group'] = 'dimensions'): Change[] {
  const out: Change[] = [];
  for (const [cid, c] of Object.entries(sketch.constraints ?? {}) as [Id, any][]) {
    if (!isDimension(c) || !(c as any).driving || typeof c.value !== 'number') continue;
    if (notChanged.has(`${sketch.id} ${cid}`)) continue;
    const expr: string | undefined = sketch.expressions?.[`constraints/${cid}/value`];
    if (expr !== undefined && namesIn(expr).length) continue; // a parameter drives it
    const spec = (CONSTRAINTS as any)[c.type].values.value;
    const angle = spec.unit === 'rad';
    for (const sg of [1, -1]) {
      const dir = sg > 0 ? 'up' : 'down';
      const to = c.value === 0 ? sg * (angle ? Math.PI / 180 : 0.1) : c.value * (1 + sg * 0.03);
      const label = `${sketch.id} ${cid} (${c.type} ${+c.value.toFixed(4)}) ${dir}`;
      const step: Change = { group, key: label, label, steps: [{ type: 'setConstraintValue', sketch: sketch.id, id: cid, value: to } as Command], back: { type: 'setConstraintValue', sketch: sketch.id, id: cid, value: expr ?? c.value } as Command };
      if (!checkNumber(to, spec).ok) { step.steps = []; step.notAvailable = `${fmt(to)} is outside the range`; }
      out.push(step);
    }
  }
  return out;
}

// The count of every circular entry: +1; −1.
export function countChanges(sketch: any): Change[] {
  const out: Change[] = [];
  for (const [id, x] of Object.entries(sketch.external ?? {}) as [Id, any][]) {
    if (x.type !== 'pattern' || x.transform.type !== 'circular') continue;
    for (const dn of [1, -1]) {
      const to = x.transform.count + dn;
      const label = `${sketch.id} ${id} count ${x.transform.count} -> ${to}`;
      const change: Change = { group: dn > 0 ? 'counts up' : 'counts down', key: label, label, steps: [{ type: 'updateExternal', sketch: sketch.id, id, ref: { ...x, transform: { ...x.transform, count: to } } } as Command], count: { sketch: sketch.id, entry: id, from: x.transform.count, to } };
      if (to < 1) { change.steps = []; change.notAvailable = 'a count under 1'; }
      out.push(change);
    }
  }
  return out;
}

// ---------------------------------------------------------------- the state of a document

interface FeatureState {
  type: string;
  status: string;
  code?: string;
  warnings: string[];
  conflicting: number;
  valid?: boolean;
  regions?: number;
}
export interface Snapshot {
  features: Record<Id, FeatureState>;
  bodies: Record<Id, number>; // volume of every body
  points: Record<Id, Record<Id, { x: number; y: number }>>;
  radii: Record<Id, Record<Id, number>>;
}
export function snapshot(engine: Engine): Snapshot {
  const st = engine.getState();
  const s: Snapshot = { features: {}, bodies: {}, points: {}, radii: {} };
  for (const f of st.document.features) {
    const r = st.evaluation.features[f.id];
    if (!r) continue;
    s.features[f.id] = { type: f.type, status: r.status, code: r.error?.code, warnings: r.warnings.map((w) => w.code), conflicting: r.sketch?.conflicting.length ?? 0, valid: r.sketch?.valid, regions: r.sketch?.regions.length };
    if (r.sketch) { s.points[f.id] = { ...r.sketch.points }; s.radii[f.id] = { ...r.sketch.radii }; }
  }
  for (const [b, body] of Object.entries(st.evaluation.bodies)) s.bodies[b] = (body as any).volume ?? 0;
  return s;
}

// The verdicts of a state against the loaded one (every one that applies; the order is only the
// order of the report).
export function verdicts(base: Snapshot, now: Snapshot): { kind: Verdict; text: string }[] {
  const out: { kind: Verdict; text: string }[] = [];
  const conflict: string[] = [];
  const invalid: string[] = [];
  const ref: string[] = [];
  const other: string[] = [];
  const part: string[] = [];
  const kernel: string[] = [];
  for (const [id, n] of Object.entries(now.features)) {
    const a = base.features[id];
    if (!a) continue;
    if (n.type === 'sketch') {
      if ((a.status === 'ok' && n.status !== 'ok') || (n.conflicting && !a.conflicting)) conflict.push(`${id} ${n.status}${n.warnings.length ? ` ${n.warnings.join(',')}` : ''}${n.conflicting ? `, ${n.conflicting} conflicting` : ', nothing named'}`);
      if (a.valid && n.valid === false) invalid.push(id);
      continue;
    }
    if (n.status === 'error' && (a.status !== 'error' || a.code !== n.code)) {
      const t = `${id}:${n.code}`;
      if (n.code === 'kernelFailure') kernel.push(t);
      else if (n.code === 'noProfile' || n.code === 'brokenReference') ref.push(t);
      else other.push(t);
    } else if (a.status === 'ok' && n.status === 'warning') part.push(`${id}:${n.warnings.join(',')}`);
  }
  if (Object.keys(now.bodies).length !== Object.keys(base.bodies).length) ref.push(`bodies ${Object.keys(base.bodies).length} -> ${Object.keys(now.bodies).length}`);
  if (conflict.length) out.push({ kind: 'cannot follow', text: conflict.slice(0, 3).join('; ') });
  if (invalid.length) out.push({ kind: 'invalid profile', text: invalid.slice(0, 3).join(' ') });
  if (ref.length) out.push({ kind: 'reference', text: ref.slice(0, 4).join(' ') });
  if (other.length) out.push({ kind: 'other', text: other.slice(0, 3).join(' ') });
  if (part.length) out.push({ kind: 'fails in part', text: part.slice(0, 3).join(' ') });
  if (kernel.length) out.push({ kind: 'kernel', text: kernel.slice(0, 3).join(' ') });
  return out;
}
export type Verdict = 'refused' | 'cannot follow' | 'invalid profile' | 'reference' | 'other' | 'fails in part' | 'an assertion fails' | 'not back' | 'kernel' | 'drives nothing' | 'followed' | 'not available';
// verdicts that fail the acceptance for a parameter
export const FAILING: Verdict[] = ['refused', 'cannot follow', 'invalid profile', 'reference', 'other', 'fails in part', 'an assertion fails', 'not back'];

// Whether the solved state differs from the loaded one (a volume, a point outside a helper copy).
function differs(base: Snapshot, now: Snapshot, helpers: Set<Id>): boolean {
  for (const [b, v] of Object.entries(now.bodies)) if (base.bodies[b] === undefined || Math.abs(v - base.bodies[b]) > 1e-9 * Math.max(1, Math.abs(v))) return true;
  for (const [s, pts] of Object.entries(now.points)) {
    if (helpers.has(s)) continue;
    for (const [p, q] of Object.entries(pts)) { const b = base.points[s]?.[p]; if (!b || Math.hypot(b.x - q.x, b.y - q.y) > 1e-9) return true; }
    for (const [c, r] of Object.entries(now.radii[s] ?? {})) { const b = base.radii[s]?.[c]; if (b === undefined || Math.abs(b - r) > 1e-9) return true; }
  }
  return false;
}

// After the return: the document is the loaded one (no verdict, the same volumes, the same regions).
function notBack(base: Snapshot, now: Snapshot): string | undefined {
  const v = verdicts(base, now);
  if (v.length) return v.map((x) => `${x.kind} (${x.text})`).join(' + ');
  for (const [b, vol] of Object.entries(base.bodies)) if (now.bodies[b] === undefined || Math.abs(now.bodies[b] - vol) > 1e-6 * Math.max(1, Math.abs(vol))) return `volume of ${b} ${vol.toFixed(4)} -> ${now.bodies[b]?.toFixed(4)}`;
  for (const [id, f] of Object.entries(base.features)) if (f.regions !== undefined && now.features[id]?.regions !== f.regions) return `regions of ${id} ${f.regions} -> ${now.features[id]?.regions}`;
  return undefined;
}

// ---------------------------------------------------------------- assertions

// What the conversion promised, checked on the solved geometry of a state: instances of an Onshape
// pattern are their seeds turned (in the sense read off the loaded positions), the lines of a
// distance of two lines are parallel, a constraint removed as implied still holds, and after a
// change of a count the new copy's regions are named by a feature.
export class Assertions {
  private readonly sense = new Map<string, number>();
  checks = 0; // removed relations checked
  constructor(private readonly engine: Engine, private readonly promises: StudioPromises, private readonly base: Snapshot) {}

  private senseOf(p: PatternPromise, row: Id[]): number | undefined {
    const key = `${p.sketch} ${row.join(',')}`;
    if (!this.sense.has(key)) {
      const pts = this.base.points[p.sketch];
      const o = p.pivot === 'origin' ? { x: 0, y: 0 } : pts?.[p.pivot];
      const [a, b] = [pts?.[row[0]], pts?.[row[1]]];
      if (!o || !a || !b) return undefined;
      const s = Math.sign((a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x));
      // a count of 2 is a turn of π: either sense
      this.sense.set(key, s || 1);
    }
    return this.sense.get(key);
  }

  check(now: Snapshot, count?: Change['count']): string[] {
    const out: string[] = [];
    const ok = (sketch: Id) => now.features[sketch]?.status === 'ok' && !now.features[sketch].conflicting;
    for (const p of this.promises.patterns) {
      if (!ok(p.sketch)) continue;
      const q = now.points[p.sketch];
      const o = p.pivot === 'origin' ? { x: 0, y: 0 } : q?.[p.pivot];
      if (!q || !o) continue;
      let worst = 0;
      for (const row of p.rows) {
        if (row.length < 2 || row[0] === p.pivot) continue;
        const s = this.senseOf(p, row);
        if (s === undefined) continue;
        const th = (s * 2 * Math.PI) / p.count;
        for (let j = 1; j < row.length; j++) {
          const [a, b] = [q[row[j - 1]], q[row[j]]];
          if (!a || !b) continue;
          const x = o.x + (a.x - o.x) * Math.cos(th) - (a.y - o.y) * Math.sin(th);
          const y = o.y + (a.x - o.x) * Math.sin(th) + (a.y - o.y) * Math.cos(th);
          worst = Math.max(worst, Math.hypot(x - b.x, y - b.y));
        }
      }
      if (worst > 1e-6) out.push(`an instance of ${p.constraint} is not its seed turned (${p.sketch}, off by ${worst.toExponential(1)} mm)`);
    }
    const st = this.engine.getState();
    for (const pr of this.promises.pairs) {
      if (!ok(pr.sketch)) continue;
      const f: any = st.document.features.find((x) => x.id === pr.sketch);
      const q = now.points[pr.sketch];
      const [la, lb] = [f?.curves?.[pr.a], f?.curves?.[pr.b]];
      if (!la || !lb || !q[la.a] || !q[lb.a]) continue;
      const [ux, uy, vx, vy] = [q[la.b].x - q[la.a].x, q[la.b].y - q[la.a].y, q[lb.b].x - q[lb.a].x, q[lb.b].y - q[lb.a].y];
      if (Math.abs(ux * vy - uy * vx) > 1e-9 * Math.hypot(ux, uy) * Math.hypot(vx, vy)) out.push(`the lines of ${pr.constraint} are no longer parallel (${pr.sketch})`);
    }
    for (const g of this.promises.removed) {
      if (!ok(g.sketch)) continue;
      const held = holds(this.engine, g.sketch, g.id, g.constraint);
      this.checks++;
      if (!held) out.push(`a constraint removed as implied does not hold (${g.sketch} ${g.id})`);
    }
    if (count && count.to > count.from) {
      const sketch: any = st.evaluation.features[count.sketch]?.sketch;
      const named = new Set<string>();
      for (const f of st.document.features as any[]) for (const r of f.profile?.regions ?? []) named.add(JSON.stringify([...r.outerLoop].sort()));
      const key = (r: any) => JSON.stringify([...r.ref.outerLoop].sort());
      const of = (k: number) => (sketch?.regions ?? []).filter((r: any) => r.ref.outerLoop.some((c: Id) => c.startsWith(`${count.entry}/${k}/`)));
      const siblings = of(1);
      const fresh = of(count.from);
      if (siblings.some((r: any) => named.has(key(r)))) {
        if (!fresh.length) out.push('the new copy bounds no region');
        else if (fresh.some((r: any) => !named.has(key(r)))) out.push('the new copy bounds a region that no feature names');
      }
    }
    return out;
  }
}

// A removed constraint holds when, put back on a preview, it changes no point and no radius by more
// than 1e-6 and leaves the status `ok`.
export function holds(engine: Engine, sketch: Id, id: Id, constraint: Constraint): boolean {
  const st = engine.getState();
  const before = st.evaluation.features[sketch]?.sketch;
  if (!before) return false;
  const t = engine.preview({ type: 'addConstraint', sketch, id, constraint } as Command);
  if (!t.ok) return false;
  const r = t.state.evaluation.features[sketch];
  if (r.status !== 'ok' || !r.sketch || r.sketch.conflicting.length) return false;
  for (const [p, q] of Object.entries(before.points)) { const w = r.sketch.points[p]; if (!w || Math.hypot(w.x - q.x, w.y - q.y) > 1e-6) return false; }
  for (const [c, v] of Object.entries(before.radii)) { const w = r.sketch.radii[c]; if (w === undefined || Math.abs(w - v) > 1e-6) return false; }
  return true;
}

// ---------------------------------------------------------------- the document's probe

export interface ChangeResult {
  studio: string;
  group: Change['group'];
  label: string;
  verdicts: Verdict[];
  text: string; // every verdict with its detail, by step
}
export interface DocumentProbe {
  changes: ChangeResult[];
  derived: { pairs: number; moved: number; worst: number; studios: string[] };
  several: number; // states with several verdicts
  removedChecks: number;
  seconds: number;
}

type Copies = Record<string, Record<string, Record<Id, { points: Record<Id, { x: number; y: number }>; radii: Record<Id, number>; moved: boolean }>>>;

// Every stored studio document that has a sketch, alone, by its name.
export function studioDocuments(root: any): { name: string; document: any }[] {
  const out = new Map<string, any>();
  const walk = (d: any) => {
    for (const [id, v] of Object.entries(d.documents ?? {}) as [string, any][]) {
      const inner = v.document;
      const name = v.name ?? id;
      if (inner.features.some((f: any) => f.type === 'sketch') && !out.has(name)) out.set(name, inner);
      walk(inner);
    }
  };
  if (root.features?.some((f: any) => f.type === 'sketch')) out.set('(root)', root);
  walk(root);
  return [...out].map(([name, document]) => ({ name, document }));
}

export function documentProbe(newEngine: () => Engine, root: any, promises: Record<string, StudioPromises>, only?: { parameters?: Set<string>; groups?: Set<string> }): DocumentProbe {
  const t0 = performance.now();
  const result: DocumentProbe = { changes: [], derived: { pairs: 0, moved: 0, worst: 0, studios: [] }, several: 0, removedChecks: 0, seconds: 0 };
  const copies: Copies = {};
  for (const { name, document } of studioDocuments(root)) {
    const engine = newEngine();
    const loaded = engine.load(JSON.stringify(document));
    if (!loaded.ok) { result.changes.push({ studio: name, group: 'parameters', label: 'load', verdicts: ['refused'], text: loaded.error.message }); continue; }
    const pr = promises[name] ?? emptyPromises();
    const helpers = new Set(pr.helpers);
    const base = snapshot(engine);
    const asserts = new Assertions(engine, pr, base);
    const notChanged = new Set(pr.notChanged);
    const changes: Change[] = [];
    if (!only?.groups || only.groups.has('parameters')) changes.push(...parameterChanges(document, only?.parameters));
    for (const f of document.features) if (f.type === 'sketch') {
      if (!only?.groups || only.groups.has('dimensions')) changes.push(...dimensionChanges(f, notChanged, helpers.has(f.id) ? 'helper dimensions' : 'dimensions'));
      if (!only?.groups || only.groups.has('counts')) changes.push(...countChanges(f));
    }
    for (const ch of changes) {
      const r = runChange(engine, base, ch, asserts, helpers, (step, now) => {
        if (ch.group !== 'parameters') return;
        for (const [sid, src] of Object.entries(pr.derived)) {
          if (!now.points[sid]) continue;
          const moved = Object.entries(now.points[sid]).some(([p, q]) => { const b = base.points[sid]?.[p]; return !b || Math.hypot(b.x - q.x, b.y - q.y) > 1e-9; }) || Object.entries(now.radii[sid] ?? {}).some(([c, v]) => Math.abs(v - (base.radii[sid]?.[c] ?? NaN)) > 1e-9 || Number.isNaN(base.radii[sid]?.[c]));
          (((copies[`${ch.key} step ${step}`] ??= {})[src] ??= {})[name] = { points: now.points[sid], radii: now.radii[sid] ?? {}, moved });
        }
      });
      if (r.several) result.several++;
      result.changes.push({ studio: name, group: ch.group, label: ch.label, verdicts: r.verdicts, text: r.text });
    }
    result.removedChecks += asserts.checks;
  }
  // the copies of one derived sketch in two studios, after the same change
  const studios = new Set<string>();
  for (const bySource of Object.values(copies))
    for (const byStudio of Object.values(bySource)) {
      const names = Object.keys(byStudio);
      for (let i = 0; i < names.length; i++)
        for (let j = i + 1; j < names.length; j++) {
          const [a, b] = [byStudio[names[i]], byStudio[names[j]]];
          studios.add(names[i]).add(names[j]);
          result.derived.pairs++;
          if (a.moved || b.moved) result.derived.moved++;
          for (const p of Object.keys(a.points)) if (b.points[p]) result.derived.worst = Math.max(result.derived.worst, Math.hypot(a.points[p].x - b.points[p].x, a.points[p].y - b.points[p].y));
          for (const c of Object.keys(a.radii)) if (b.radii[c] !== undefined) result.derived.worst = Math.max(result.derived.worst, Math.abs(a.radii[c] - b.radii[c]));
        }
    }
  result.derived.studios = [...studios];
  if (result.derived.worst > 1e-6) result.changes.push({ studio: [...studios].join(', '), group: 'parameters', label: 'derived copies', verdicts: ['an assertion fails'], text: `the copies of a derived sketch differ by ${result.derived.worst.toExponential(2)} mm after the same change` });
  result.seconds = (performance.now() - t0) / 1000;
  return result;
}

// One change: its steps, each judged, then the return, then everything undone.
export function runChange(engine: Engine, base: Snapshot, ch: Change, asserts: Assertions | undefined, helpers: Set<Id>, onStep?: (step: number, now: Snapshot) => void): { verdicts: Verdict[]; text: string; several: boolean } {
  if (ch.notAvailable) return { verdicts: ['not available'], text: ch.notAvailable, several: false };
  const kinds = new Set<Verdict>();
  const texts: string[] = [];
  let done = 0;
  let drives = false;
  let several = false;
  for (let i = 0; i < ch.steps.length; i++) {
    const r = engine.execute(ch.steps[i]);
    if (!r.ok) { kinds.add('refused'); texts.push(`step ${i + 1}: refused: ${r.error.message.slice(0, 160)}`); break; }
    done++;
    const now = snapshot(engine);
    const v = verdicts(base, now);
    const a = asserts?.check(now, ch.count) ?? [];
    if (a.some((x) => x.startsWith('the new copy'))) v.push({ kind: 'reference', text: a.filter((x) => x.startsWith('the new copy')).join('; ') });
    const failed = a.filter((x) => !x.startsWith('the new copy'));
    if (failed.length) v.push({ kind: 'an assertion fails', text: failed.slice(0, 3).join('; ') });
    if (v.length > 1) several = true;
    for (const x of v) kinds.add(x.kind);
    if (v.length) texts.push(`step ${i + 1}: ${v.map((x) => `${x.kind} (${x.text})`).join(' + ')}`);
    if (differs(base, now, helpers)) drives = true;
    onStep?.(i + 1, now);
  }
  if (ch.back && done) {
    const r = engine.execute(ch.back);
    if (!r.ok) { kinds.add('refused'); texts.push(`back: refused: ${r.error.message.slice(0, 160)}`); }
    else {
      done++;
      const b = notBack(base, snapshot(engine));
      if (b) { kinds.add('not back'); texts.push(`back: ${b}`); }
    }
  }
  for (let i = 0; i < done; i++) engine.undo();
  if (!kinds.size) kinds.add(drives ? 'followed' : 'drives nothing');
  return { verdicts: [...kinds], text: texts.join(' | '), several };
}

// The probe as lines of the report, and its totals by group and verdict.
export function probeLines(p: DocumentProbe): { lines: string[]; totals: Record<string, Record<string, number>> } {
  const totals: Record<string, Record<string, number>> = {};
  const lines: string[] = [];
  for (const c of p.changes) {
    const t = (totals[c.group] ??= { changes: 0 });
    t.changes++;
    for (const v of c.verdicts) t[v] = (t[v] ?? 0) + 1;
    if (!(c.verdicts.length === 1 && c.verdicts[0] === 'followed')) lines.push(`${c.studio} | ${c.group} | ${c.label}: ${c.verdicts.join(' + ')}${c.text ? ` — ${c.text}` : ''}`);
  }
  lines.push(`derived copies compared across studios (${p.derived.studios.join(', ') || 'none'}): ${p.derived.pairs} pairs of a change and a sketch, ${p.derived.moved} of them moved, the largest difference of a point or a radius ${p.derived.worst.toExponential(2)} mm`);
  lines.push(`states with several verdicts: ${p.several}; removed constraints checked at ${p.removedChecks} states; ${p.seconds.toFixed(0)} s`);
  return { lines, totals };
}
