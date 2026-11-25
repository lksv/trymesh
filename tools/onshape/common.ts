// What the parts of the converter share: reading the downloaded data, the engine, the report,
// small geometry.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPakoDeflater } from '../../packages/deflate-pako/src/index';
import { type Command, type Engine, type EngineDeps, createEngine } from '../../packages/engine/src/index';
import { createManifoldKernel } from '../../packages/kernel-manifold/src/index';
import { createPlanegcsSolver } from '../../packages/solver-planegcs/src/index';
import type { ConstraintRecord, OutcomeSummary, PartSummary, SketchSummary } from './fates';
import { type StudioPromises, emptyPromises } from './probe';

export type V3 = [number, number, number];
export type V2 = [number, number];

// ---------------------------------------------------------------- input

export class Input {
  constructor(readonly dir: string) {}
  json(file: string): any {
    return JSON.parse(readFileSync(join(this.dir, file), 'utf8'));
  }
  bytes(file: string): Uint8Array {
    return new Uint8Array(readFileSync(join(this.dir, file)));
  }
  get meta() {
    return this.json('meta.json');
  }
  elementName(id: string): string {
    return (this.json('elements.json') as any[]).find((e) => e.id === id)?.name ?? id;
  }
  // The variables of every variable studio of the document, as parameters (`3.4 mm` -> `3.4`).
  variables(): { name: string; expr: string }[] {
    const out: { name: string; expr: string }[] = [];
    for (const e of (this.json('elements.json') as any[]).filter((e) => e.elementType === 'VARIABLESTUDIO'))
      for (const v of this.json(`variables/${e.id}.json`)[0]?.variables ?? []) {
        const expr = expression(v.expression);
        if (expr !== undefined) out.push({ name: v.name, expr });
      }
    return out;
  }
}

// ---------------------------------------------------------------- engine

let deps: EngineDeps | undefined;
export async function newEngine(): Promise<Engine> {
  deps ??= { solver: await createPlanegcsSolver(), kernel: await createManifoldKernel(), deflater: createPakoDeflater() };
  return createEngine(deps);
}
// The settings of a run, by the environment: ONSHAPE_HELPERS=0 leaves the helper copies out (the
// design's "no" to its question 2, for a comparison).
export const settings = { helpers: process.env.ONSHAPE_HELPERS !== '0' };

// An engine once `newEngine` has loaded the adapters.
export function engineNow(): Engine {
  if (!deps) throw new Error('engineNow before newEngine');
  return createEngine(deps);
}

// ---------------------------------------------------------------- report

// What a run collects besides its lines: the records of the constraints and what `summary.json`
// holds (fates.ts), and what the conversion promised for the document's probe (probe.ts).
export class Report {
  readonly lines: string[] = [];
  readonly records: ConstraintRecord[] = [];
  readonly sketches: Record<string, SketchSummary> = {};
  readonly parts: Record<string, PartSummary> = {};
  readonly outcomes: Record<string, OutcomeSummary> = {};
  readonly promises: Record<string, StudioPromises> = {};
  readonly parametersInUse: Record<string, string[]> = {};
  // the sections at the end of the report, by title
  readonly tail: Record<string, string[]> = {};
  promisesOf(studio: string): StudioPromises {
    return (this.promises[studio] ??= emptyPromises());
  }
  later(section: string, line: string) {
    (this.tail[section] ??= []).push(line);
  }
  section(title: string) {
    this.lines.push('', `## ${title}`, '');
  }
  note(text: string) {
    this.lines.push(`- ${text}`);
  }
  text(): string {
    return this.lines.join('\n') + '\n';
  }
}

// Runs a command; a refused one is noted and false.
export function exec(engine: Engine, report: Report, cmd: Command, what: string): boolean {
  const r = engine.execute(cmd);
  if (!r.ok) report.note(`REFUSED ${what}: ${r.error.message.slice(0, 300)}`);
  return r.ok;
}

// ---------------------------------------------------------------- expressions and IDs

// An Onshape expression to one of trymesh: `#var` -> `var`, a unit as a factor: `3 mm` and `3*mm`
// -> `3`, `30 deg` and `30.0*deg` -> `deg(30)`, `(a + b) * deg` -> `(a + b) * deg(1)`, `2 in` ->
// `2 * 25.4`. Onshape names a variable with `#`; any other word is a unit, a function or a constant,
// and a unit the converter does not know leaves the expression unconverted (undefined).
const UNITS: Record<string, string | undefined> = { mm: '', millimeter: '', cm: '10', centimeter: '10', m: '1000', meter: '1000', in: '25.4', inch: '25.4', ft: '304.8', foot: '304.8', deg: 'deg', degree: 'deg', rad: '', radian: '' };
const WORDS = new Set(['pi', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sqrt', 'abs', 'min', 'max', 'round', 'floor', 'ceil', 'exp', 'log', 'deg']);
export function expression(e: string | undefined): string | undefined {
  if (e === undefined) return undefined;
  let s = e.trim();
  let unknown = false;
  // a number or a closing bracket followed by a unit, with or without `*`
  s = s.replace(/((?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:e[-+]?[0-9]+)?|\))\s*\*?\s*([A-Za-z]+)\b(?!\s*\()/g, (all, value: string, word: string) => {
    if (!(word in UNITS)) return all;
    const f = UNITS[word]!;
    if (f === 'deg') return value === ')' ? ') * deg(1)' : `deg(${value})`;
    return f ? `${value} * ${f}` : value;
  });
  // a word that is no variable (`#`), no unit taken above, no function and no constant
  for (const m of s.matchAll(/(#?)([A-Za-z_][A-Za-z0-9_]*)/g)) if (!m[1] && !WORDS.has(m[2])) unknown = true;
  if (unknown) return undefined;
  return s.replace(/#/g, '');
}
export const isNumber = (s: string) => /^-?[0-9.]+(e-?[0-9]+)?$/i.test(s);
export const numberOr = (s: string): number | string => (isNumber(s) ? Number(s) : s);

// An Onshape ID or name as an ID of trymesh: no `/`, no spaces.
export const sane = (s: string) => s.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '');

// ---------------------------------------------------------------- geometry

export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const near = (a: V3, b: V3, tol = 1e-3) => Math.hypot(...sub(a, b)) < tol;

// A transform of an assembly (16 numbers, row-major, metres) as rows in millimetres.
export function transform(t: number[]): number[][] {
  return [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => (c === 3 && r < 3 ? t[r * 4 + c] * 1000 : t[r * 4 + c])));
}
export const identity = (): number[][] => [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => (r === c ? 1 : 0)));
export function multiply(a: number[][], b: number[][]): number[][] {
  return a.map((row) => [0, 1, 2, 3].map((c) => row.reduce((s, v, k) => s + v * b[k][c], 0)));
}
// The inverse of a rigid transform.
export function invert(m: number[][]): number[][] {
  const r = [0, 1, 2].map((i) => [0, 1, 2].map((j) => m[j][i]));
  const t = [0, 1, 2].map((i) => -(r[i][0] * m[0][3] + r[i][1] * m[1][3] + r[i][2] * m[2][3]));
  return [[...r[0], t[0]], [...r[1], t[1]], [...r[2], t[2]], [0, 0, 0, 1]];
}
// A rigid transform as the placement of trymesh: a turn Rz·Ry·Rx (roll, pitch, yaw) and a shift.
export function placementOf(m: number[][]): Record<string, number> {
  const clean = (n: number) => (Math.abs(n) < 1e-9 ? 0 : Math.round(n * 1e9) / 1e9);
  const ry = -Math.asin(Math.max(-1, Math.min(1, m[2][0])));
  const [rx, rz] = Math.abs(Math.cos(ry)) < 1e-9 ? [Math.atan2(-m[1][2], m[1][1]), 0] : [Math.atan2(m[2][1], m[2][2]), Math.atan2(m[1][0], m[0][0])];
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries({ x: m[0][3], y: m[1][3], z: m[2][3], rx, ry, rz })) if (clean(v) !== 0) out[k] = clean(v);
  return out;
}
