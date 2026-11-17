// What the parts of the converter share: reading the downloaded data, the engine, the report,
// small geometry.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPakoDeflater } from '../../packages/deflate-pako/src/index';
import { type Command, type Engine, type EngineDeps, createEngine } from '../../packages/engine/src/index';
import { createManifoldKernel } from '../../packages/kernel-manifold/src/index';
import { createPlanegcsSolver } from '../../packages/solver-planegcs/src/index';

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

// ---------------------------------------------------------------- report

export class Report {
  readonly lines: string[] = [];
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

// An Onshape expression to one of trymesh: `#var` -> `var`, `3 mm` -> `3`, `30 deg` -> `deg(30)`.
// Units other than millimetres and degrees are not converted (undefined).
export function expression(e: string | undefined): string | undefined {
  if (e === undefined) return undefined;
  let s = e.trim().replace(/#/g, '');
  s = s.replace(/([0-9.]+)\s*deg\b/g, 'deg($1)').replace(/([0-9.]+)\s*mm\b/g, '$1').replace(/\s*\bmm\b/g, '');
  if (/\b(in|inch|cm|meter|m|ft|rad|radian)\b/.test(s)) return undefined;
  return s;
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
