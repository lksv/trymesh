// The count by cause (design of 6h, "The count by cause"): one record per Onshape constraint of every
// converted sketch, with its fate; the tally, the tables of the report, `summary.json` and its
// comparator.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Command, Id } from '../../packages/engine/src/index';

// The fate of an Onshape constraint, final only after the last step of its sketch.
export type Fate = 'written' | 'entry' | 'shared' | 'twice' | 'implied' | 'lost';
export const FATES: Fate[] = ['written', 'entry', 'shared', 'twice', 'implied', 'lost'];

// Why a constraint is lost, the first of the list that applies.
export type Cause = 'refused' | 'pattern' | 'origin' | 'plane' | 'sketch' | 'edge' | 'unknown' | 'mirror' | 'spline' | 'arc' | 'split' | 'kind';
export const CAUSES: Cause[] = ['refused', 'pattern', 'origin', 'plane', 'sketch', 'edge', 'unknown', 'mirror', 'spline', 'arc', 'split', 'kind'];
export const CAUSE_TEXT: Record<Cause, string> = {
  refused: 'Refused by the check',
  pattern: 'A pattern',
  origin: 'The origin',
  plane: 'A default plane',
  sketch: 'An entity of another sketch',
  edge: 'An edge of a body',
  unknown: 'An operand whose ID does not decode to a known feature',
  mirror: 'A mirror of curves about a line of the sketch',
  spline: 'A spline',
  arc: 'An arc',
  split: 'A curve the converter split',
  kind: 'A kind without a counterpart',
};

// What an operand is: the column of the detail, kept apart from the cause.
export type Category = 'origin' | 'plane' | 'sketch' | 'edge' | 'unknown' | 'spline' | 'arc' | 'split';

export interface OperandRecord {
  param: string; // localFirst, externalSecond, …
  id: string; // the Onshape entity or deterministic ID
  external: boolean;
  category?: Category;
  decoded?: string; // what the decode says an external ID is
  resolved?: string; // what it became in the sketch (`origin`, `origin/x`, an entry, a point)
  candidates?: string[];
  inferred?: boolean; // picked by geometry within what the decode allows
  note?: string;
}

export interface ConstraintRecord {
  key: string; // `<studio>/<sketch>#<index>`
  studio: string;
  sketch: Id;
  sketchName: string;
  helper: boolean; // of a helper copy, counted apart
  index: number; // in Onshape's list
  type: string; // Onshape's constraintType
  what: string; // the type with its form: `HORIZONTAL of two points`
  operands: OperandRecord[];
  commands: Command[]; // the unit: everything made for it (not in the summary)
  ids: Id[]; // the constraints of trymesh that stand for it in the document
  written?: 'expressions' | 'number';
  fate?: Fate;
  detail?: string; // how a `shared` was realised, why a `lost` is lost, …
  cause?: Cause;
  category?: Category;
  twiceOf?: string; // the key of the record whose constraint says the same
  implied?: number; // constraints of the unit removed as implied
  numbers?: string[]; // dimensions written as numbers, with why
  extra?: Record<string, unknown>; // the angle's flags and form, a pattern's way, …
}

// The fate of a `twice` is read through the record it repeats.
export function finalFate(r: ConstraintRecord, byKey: Map<string, ConstraintRecord>): { fate: Fate; cause?: Cause; detail?: string } {
  if (r.fate !== 'twice' || !r.twiceOf) return { fate: r.fate!, cause: r.cause, detail: r.detail };
  const of = byKey.get(r.twiceOf);
  if (!of) return { fate: 'twice', detail: r.detail };
  const f = finalFate(of, byKey);
  if (f.fate === 'shared' || f.fate === 'implied' || (f.fate === 'lost' && f.cause === 'refused')) return { fate: f.fate, cause: f.cause, detail: `as ${of.key}${f.detail ? `: ${f.detail}` : ''}` };
  return { fate: 'twice', detail: r.detail };
}

export interface Tally {
  constraints: number;
  fates: Record<Fate, number>;
  causes: Record<Cause, number>;
  byCause: Record<Cause, Record<string, number>>; // cause -> Onshape type (with form) -> count
  shared: Record<string, number>; // how a shared was realised
  twice: Record<string, number>;
}

export function tally(records: ConstraintRecord[]): Tally {
  const byKey = new Map(records.map((r) => [r.key, r]));
  const t: Tally = { constraints: 0, fates: Object.fromEntries(FATES.map((f) => [f, 0])) as Record<Fate, number>, causes: Object.fromEntries(CAUSES.map((c) => [c, 0])) as Record<Cause, number>, byCause: Object.fromEntries(CAUSES.map((c) => [c, {}])) as Record<Cause, Record<string, number>>, shared: {}, twice: {} };
  for (const r of records) {
    t.constraints++;
    const f = finalFate(r, byKey);
    t.fates[f.fate]++;
    if (f.fate === 'lost') {
      const cause = f.cause ?? 'kind';
      t.causes[cause]++;
      t.byCause[cause][r.what] = (t.byCause[cause][r.what] ?? 0) + 1;
    }
    if (f.fate === 'shared') t.shared[f.detail ?? ''] = (t.shared[f.detail ?? ''] ?? 0) + 1;
    if (f.fate === 'twice') t.twice[r.what] = (t.twice[r.what] ?? 0) + 1;
  }
  return t;
}

// The line of a sketch in the report, and one line per cause under it.
export function sketchLines(name: string, points: number, curves: number, records: ConstraintRecord[], all: Map<string, ConstraintRecord>, freedom: number | undefined): string[] {
  const t = { written: 0, entry: 0, shared: 0, twice: 0, implied: 0, lost: 0 } as Record<Fate, number>;
  const lost = new Map<string, number>();
  for (const r of records) {
    const f = finalFate(r, all);
    t[f.fate]++;
    if (f.fate === 'lost') lost.set(`${r.what} (${f.cause ?? 'kind'}${r.category && r.category !== f.cause ? `, on ${r.category}` : ''})`, (lost.get(`${r.what} (${f.cause ?? 'kind'}${r.category && r.category !== f.cause ? `, on ${r.category}` : ''})`) ?? 0) + 1);
  }
  const parts = FATES.filter((f) => t[f]).map((f) => `${t[f]} ${f === 'entry' ? (t[f] === 1 ? 'entry' : 'entries') : f}`);
  const head = `${name}: ${points} points, ${curves} curves; of ${records.length} constraints ${parts.join(', ') || 'none'}; ${freedom ?? '?'} degrees of freedom`;
  return [head, ...[...lost].map(([k, n]) => `${name}: lost: ${n} ${k}`)];
}

// The two tables of "The count by cause", as Markdown.
export function tallyTables(t: Tally, helperTally?: Tally): string[] {
  const out = ['| Fate | Count |', '|---|---|'];
  for (const f of FATES) {
    let extra = '';
    if (f === 'shared' && t.fates.shared) extra = ` (${Object.entries(t.shared).map(([k, n]) => `${n} ${k || 'by a point'}`).join(', ')})`;
    out.push(`| ${f[0].toUpperCase()}${f.slice(1)} | ${t.fates[f]}${extra} |`);
  }
  out.push('', '| Cause of the loss | Count | By Onshape type |', '|---|---|---|');
  for (const c of CAUSES) {
    if (!t.causes[c]) continue;
    out.push(`| ${CAUSE_TEXT[c]} (\`${c}\`) | ${t.causes[c]} | ${Object.entries(t.byCause[c]).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')} |`);
  }
  if (helperTally?.constraints) out.push('', `Helper copies, counted apart: ${helperTally.constraints} constraints, ${FATES.filter((f) => helperTally.fates[f]).map((f) => `${helperTally.fates[f]} ${f}`).join(', ')}.`);
  return out;
}

// ---------------------------------------------------------------- summary.json

export interface SketchSummary {
  key: string; // `<studio>/<Onshape feature>`, a derived copy by the feature that derives it and its source
  studio: string;
  id: Id;
  name: string;
  helper: boolean;
  status: string;
  warnings: string[];
  freedom?: number;
  redundant: Id[]; // what the solver still lists
  diagnosisRedundant?: number; // what the engine's diagnosis counts
  valid?: boolean;
  regions: number;
  onshapeRegions?: number;
  areas: number[];
  welds: { places: number; tied: number; untied: Record<string, number>; listed: string[]; wide: string[] };
  ladder: string; // the step of the check that passed
  drift?: { before: number; after?: number };
  cut?: Record<string, unknown>;
  entries: { constraint: string; type: string; entry: boolean; why?: string }[];
  probe?: unknown;
  counts: Record<Fate, number>;
}

export interface PartSummary {
  studio: string;
  part: string;
  body?: Id;
  volume?: number | null;
  onshape: number | null;
}

export interface OutcomeSummary {
  studio: string;
  feature: string;
  type: string;
  asked?: number;
  converted?: number[]; // which of Onshape's edges (by their place in its list) a kept feature holds
  start?: 'from' | 'number';
}

export interface Summary {
  run: { commit: string; dirty: boolean; fingerprint: string; overrides?: string; settings: Record<string, unknown>; seconds?: number };
  tally: Tally;
  helperTally: Tally;
  perSketch: Record<string, Record<Fate, number>>;
  constraints: Omit<ConstraintRecord, 'commands'>[];
  sketches: Record<string, SketchSummary>;
  parts: Record<string, PartSummary>;
  outcomes: Record<string, OutcomeSummary>;
  loaded: { loads: boolean; inError: string[]; bodies: number };
  parametersInUse: Record<string, string[]>;
  promises: Record<string, unknown>;
  probe?: unknown;
}

export const recordForSummary = ({ commands: _commands, ...r }: ConstraintRecord) => r;

// The fingerprint of the dump: a hash over the raw input files that fetch.ts writes (not over the
// folder, which by default also holds the converter's output).
const INPUT_FILES = [/^meta\.json$/, /^elements\.json$/, /^assembly\.json$/, /^studios\/[^/]+\/(features|sketches|parts|mass|fs)\.json$/, /^variables\/[^/]+\.json$/, /^stl\/[^/]+\.stl$/];
export function fingerprint(dir: string): string {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const rel = relative(dir, p).split('\\').join('/');
        if (INPUT_FILES.some((re) => re.test(rel))) files.push(rel);
      }
    }
  };
  walk(dir);
  const h = createHash('sha256');
  for (const f of files.sort()) h.update(`${f}\0${createHash('sha256').update(readFileSync(join(dir, f))).digest('hex')}\n`);
  return h.digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------- the comparator

export interface Comparison {
  strict: string[]; // differences that fail
  grown: string[]; // additions that are allowed, each listed
  changed: string[]; // fates and causes, to compare with the prediction of the point
}

const near = (a: number | null | undefined, b: number | null | undefined, tol: number) => typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;

// Compares a run's summary with a baseline's, by scope (design of 6h, "The report and summary.json").
export function compareSummaries(base: Summary, run: Summary): Comparison {
  const c: Comparison = { strict: [], grown: [], changed: [] };
  // the parts: volume within 1e-3 mm³, none missing, none not finite
  for (const [k, p] of Object.entries(base.parts)) {
    const q = run.parts[k];
    if (!q) c.strict.push(`part ${k}: missing`);
    else if (typeof q.volume !== 'number' || !Number.isFinite(q.volume)) c.strict.push(`part ${k}: volume not finite (${q.volume})`);
    else if (!near(p.volume, q.volume, 1e-3)) c.strict.push(`part ${k}: volume ${p.volume} -> ${q.volume}`);
  }
  for (const k of Object.keys(run.parts)) if (!base.parts[k]) c.strict.push(`part ${k}: new`);
  // the features that can fail in part: which of Onshape's edges are converted, starts
  for (const [k, o] of Object.entries(base.outcomes)) {
    const q = run.outcomes[k];
    if (!q) { c.strict.push(`outcome ${k}: missing`); continue; }
    if (JSON.stringify(o.converted ?? null) !== JSON.stringify(q.converted ?? null)) c.strict.push(`outcome ${k}: edges converted ${JSON.stringify(o.converted)} -> ${JSON.stringify(q.converted)}`);
    if ((o.start ?? null) !== (q.start ?? null)) c.strict.push(`outcome ${k}: start ${o.start} -> ${q.start}`);
  }
  for (const k of Object.keys(run.outcomes)) if (!base.outcomes[k]) c.strict.push(`outcome ${k}: new`);
  // the sketches of the source: regions and their areas
  for (const [k, s] of Object.entries(base.sketches)) {
    if (s.helper) continue;
    const q = run.sketches[k];
    if (!q) { c.strict.push(`sketch ${k}: missing`); continue; }
    if (s.regions !== q.regions) c.strict.push(`sketch ${k}: regions ${s.regions} -> ${q.regions}`);
    else {
      const worst = Math.max(0, ...s.areas.map((a, i) => Math.abs(a - q.areas[i])));
      if (!(worst <= 1e-6)) c.strict.push(`sketch ${k}: an area differs by ${worst.toExponential(2)} mm²`);
    }
  }
  for (const [k, s] of Object.entries(run.sketches)) if (!base.sketches[k]) (s.helper ? c.grown : c.strict).push(`sketch ${k}: new${s.helper ? ' (a helper copy)' : ''}`);
  // the loaded document
  if (base.loaded.loads !== run.loaded.loads) c.strict.push(`loads: ${base.loaded.loads} -> ${run.loaded.loads}`);
  if (base.loaded.bodies !== run.loaded.bodies) c.strict.push(`bodies: ${base.loaded.bodies} -> ${run.loaded.bodies}`);
  for (const f of run.loaded.inError) if (!base.loaded.inError.includes(f)) c.strict.push(`newly in error: ${f}`);
  // allowed to grow
  for (const [studio, list] of Object.entries(run.parametersInUse)) for (const p of list) if (!(base.parametersInUse[studio] ?? []).includes(p)) c.grown.push(`parameter in use: ${studio}/${p}`);
  for (const [k, s] of Object.entries(run.sketches)) {
    const b = base.sketches[k];
    const [ne, nb] = [s.entries.filter((e) => e.entry).length, b?.entries.filter((e) => e.entry).length ?? 0];
    if (ne > nb) c.grown.push(`sketch ${k}: entries ${nb} -> ${ne}`);
  }
  // expected to change
  for (const f of FATES) if (base.tally.fates[f] !== run.tally.fates[f]) c.changed.push(`${f}: ${base.tally.fates[f]} -> ${run.tally.fates[f]}`);
  for (const k of CAUSES) if (base.tally.causes[k] !== run.tally.causes[k]) c.changed.push(`lost by ${k}: ${base.tally.causes[k]} -> ${run.tally.causes[k]}`);
  return c;
}
