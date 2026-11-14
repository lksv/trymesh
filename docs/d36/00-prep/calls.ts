// The contract of the preparatory step written out as calls: what a caller of the engine, a new
// query and the MCP server do with it. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`).
// A step that cannot be written here is a hole in the contract.

import type { Command, Id, InterferenceReport, NumberSpec } from '../../../packages/engine/src/index';
import type { ArgSpecs, BodyDescription, DataCatalog, EngineAfter, EntityRef, ExportFile, QueryContext, QueryName, QueryOutcome, QuerySpec, Surface } from './contract';
import { QUERIES, QueryFailure, UPGRADES, queryTools } from './contract';

declare const engine: EngineAfter;
declare function fail(message: string): never;
const unwrap = <T>(outcome: QueryOutcome<T>): T => (outcome.ok ? outcome.result : fail(`${outcome.error.code}: ${outcome.error.message}`));

// ---------------------------------------------------------------- a. the three existing queries

// Collisions, as the app's panel and `check_interference` ask today.
export function collisions(marker?: Id): InterferenceReport {
  return unwrap(engine.query('interference', { threshold: 0.001 }, { at: marker }));
}

// A wrong argument is an answer, not an exception.
export function wrongArgument(): string {
  const outcome = engine.query('interference', { bodies: ['housing'] }); // one body has nothing to collide with
  if (outcome.ok) return fail('expected invalidArguments');
  return `${outcome.error.code} in "${outcome.error.arg}": ${outcome.error.message}`;
}

// The sketch diagnosis and the explanation of one constraint, as the sketch panel uses them.
export function redundantBecause(sketch: Id, constraint: Id): Id[] {
  const diagnosis = unwrap(engine.query('sketchDiagnosis', { sketch }));
  if (!diagnosis.redundant.includes(constraint)) return [];
  return unwrap(engine.query('constraintExplanation', { sketch, constraint })).impliedBy;
}

// ---------------------------------------------------------------- b. a body, described by the engine

// The radius of every hole of a body: cylindrical faces, read from the surface instead of being
// fitted to vertices.
export function holeRadii(body: Id): number[] {
  const description: BodyDescription = unwrap(engine.query('body', { body }));
  const radii: number[] = [];
  for (const face of description.faces) {
    const surface: Surface = face.surface;
    if (surface.kind === 'cylinder') radii.push(surface.radius);
  }
  return radii;
}

// The rim of a countersink is a circle although one of its faces is a cone.
export function countersinkRims(body: Id): { radius: number; center: [number, number, number] }[] {
  const description = unwrap(engine.query('body', { body }));
  const conical = (ref: BodyDescription['faces'][number]) => ref.surface.kind === 'cone';
  const cones = new Set(description.faces.filter(conical).map((face) => JSON.stringify(face.name)));
  return description.edges
    .filter((edge) => edge.kind === 'circle' && (cones.has(JSON.stringify(edge.name.a)) || cones.has(JSON.stringify(edge.name.b))))
    .map((edge) => ({ radius: edge.circle!.radius, center: edge.circle!.center }));
}

// ---------------------------------------------------------------- c. a query over a previewed state

// Step a parameter and ask about collisions at each value; nothing is written and the history
// is not touched. This is the sweep the pose of step 5 needs.
export function sweep(parameter: string, values: number[]): { value: number; collisions: number }[] {
  const out: { value: number; collisions: number }[] = [];
  for (const value of values) {
    const command: Command = { type: 'setParameter', name: parameter, expr: String(value) };
    const preview = engine.preview(command);
    if (!preview.ok) return fail(preview.error.message);
    const report = unwrap(engine.query('interference', {}, { state: preview.state }));
    out.push({ value, collisions: report.pairs.length });
  }
  return out;
}

// ---------------------------------------------------------------- d. adding a query is one module

// What a package of step 1 writes (here the smallest gap of 1c, shortened): its types, its entry
// and one line of declaration merging. No shared type is edited.
interface GapArgs {
  a: Id;
  b: Id;
  within?: number;
}
interface GapResult {
  distance: number | null; // null: farther apart than `within`
  between?: { a: [number, number, number]; b: [number, number, number] };
}
const LENGTH: NumberSpec = { title: 'Search distance', unit: 'mm', min: { value: 0, open: true }, default: 10 };
const gapArgs: ArgSpecs<GapArgs> = {
  a: { kind: 'body', title: 'First body' },
  b: { kind: 'body', title: 'Second body' },
  within: { kind: 'number', title: 'Search distance', optional: true, spec: LENGTH },
};
export const gap: QuerySpec<GapArgs, GapResult> = {
  title: 'Smallest gap',
  summary: 'The smallest distance between two bodies that do not intersect.',
  tool: 'check_gap',
  args: gapArgs,
  run(context: QueryContext, args: GapArgs): GapResult {
    const bodies = context.state.evaluation.bodies;
    const [a, b] = [bodies[args.a], bodies[args.b]];
    // computed once per pair of solids, however often it is asked
    return context.memo(a.solid, `gap:${args.b}:${args.within}`, () => {
      if (a.volume === 0 || b.volume === 0) throw new QueryFailure('failed', 'a body is empty');
      return { distance: null };
    });
  },
};
declare module './contract' {
  interface Queries {
    gap: { args: GapArgs; result: GapResult };
  }
}
export function clearance(a: Id, b: Id): number | null {
  return unwrap(engine.query('gap', { a, b, within: 2 })).distance;
}

// A reference to a named entity in an argument (the measuring of 1b, shortened).
interface MeasureArgs {
  from: EntityRef;
  to: EntityRef;
}
export const measureArgs: ArgSpecs<MeasureArgs> = {
  from: { kind: 'entity', title: 'From', accepts: ['face', 'edge', 'sketchPoint', 'plane', 'axis'] },
  to: { kind: 'entity', title: 'To', accepts: ['face', 'edge', 'sketchPoint', 'plane', 'axis'] },
};
export const wallOfHousing: MeasureArgs = {
  from: { kind: 'face', body: 'housing', face: { feature: 'housing', role: 'side', curve: 'outer' } },
  to: { kind: 'face', body: 'housing', face: { feature: 'pocket', role: 'side', curve: 'bore' } },
};

// ---------------------------------------------------------------- e. export

// One file with chosen bodies, or a file per body; the caller decides where the bytes go.
export function printFiles(bodies: Id[]): ExportFile[] {
  return unwrap(engine.export('stl', { bodies, perBody: true }));
}

// ---------------------------------------------------------------- f. a data catalog

interface ScrewRow extends Record<string, number | string> {
  clearanceHole: number;
  headDiameter: number;
  headHeight: number;
}
export function clearanceHole(size: string): number {
  const catalog = unwrap(engine.query('catalog', { name: 'socketHeadScrews', key: size })) as DataCatalog<ScrewRow>;
  return catalog.rows[size].clearanceHole;
}

// ---------------------------------------------------------------- g. MCP and the guards

// The server offers one tool per query that names one.
export function toolNames(): string[] {
  return queryTools().map((tool) => tool.name);
}

// Every query has a fixture in the tests, by name: a query added without one does not compile.
// (The same trick as the table over the methods of `Engine` in packages/mcp/test/coverage.test.ts.)
export const FIXTURES: Record<QueryName, { args: unknown }> = {
  interference: { args: {} },
  sketchDiagnosis: { args: { sketch: 's' } },
  constraintExplanation: { args: { sketch: 's', constraint: 'r' } },
  body: { args: { body: 'a' } },
  catalog: { args: { name: 'socketHeadScrews' } },
  gap: { args: { a: 'a', b: 'b' } },
};
export const describedQueries: string[] = Object.entries(QUERIES).map(([name, spec]) => `${name}: ${spec.title}. ${spec.summary}`);

// The version of the schema follows from the list of upgrade steps.
export const SCHEMA_VERSION: number = UPGRADES.length + 1;
