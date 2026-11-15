// The contract of the preparatory step written out as calls: what a caller of the engine, a new
// query, an export format, an operation of the app and the MCP server do with it. Only
// type-checked (`npx tsc -p docs/d36/tsconfig.json`). A step that cannot be written here is
// a hole in the contract. Lines marked `@ts-expect-error` are calls that must not compile.

import type { Command, EngineState, Id, InterferenceReport, Vec3 } from '../../../packages/engine/src/index';
import type { ArgSpecs, ArgsOf, BodyDescription, EngineAfter, ExportFile, Exported, HostOperation, QueryContext, QueryName, QueryArgs, QueryOutcome, QuerySpec, QuantitySpec, ToolAnswer, Truncated } from './contract';
import { DATA_CATALOGS, QUERIES, QueryFailure, UPGRADES, describedQueries, queryTools } from './contract';

declare const engine: EngineAfter;
declare function fail(message: string): never;
const unwrap = <T>(outcome: QueryOutcome<T>): T => (outcome.ok ? outcome.result : fail(`${outcome.error.code}: ${outcome.error.message}`));

// ---------------------------------------------------------------- a. the three existing queries

// Collisions, as the app's panel and `check_interference` ask today.
export function collisions(marker?: Id): InterferenceReport {
  return unwrap(engine.query('interference', { threshold: 0.001 }, { at: marker }));
}

// What is a successful answer today stays one: one body has nothing to collide with.
export function nothingToCheck(): number {
  return unwrap(engine.query('interference', { bodies: ['housing'] })).checked; // 0
}

// A body that does not exist was an exception; it is an answer now.
export function unknownBody(): string {
  const outcome = engine.query('interference', { bodies: ['housing', 'nope'] });
  if (outcome.ok) return fail('expected an error');
  return `${outcome.error.code} in "${outcome.error.arg}": ${outcome.error.message}`; // notAvailable in "bodies"
}

// The sketch diagnosis and the explanation of one constraint, as the sketch panel uses them.
// A sketch that did not evaluate still answers, with the status `unavailable`.
export function redundantBecause(sketch: Id, constraint: Id): Id[] {
  const diagnosis = unwrap(engine.query('sketchDiagnosis', { sketch }));
  if (diagnosis.status === 'unavailable' || !diagnosis.redundant.includes(constraint)) return [];
  return unwrap(engine.query('constraintExplanation', { sketch, constraint })).impliedBy;
}

// @ts-expect-error a query that does not exist
engine.query('nope', {});
// @ts-expect-error an argument the query does not have
engine.query('interference', { body: 'housing' });
// @ts-expect-error a list of bodies, not a flag
engine.query('interference', { bodies: true });

// ---------------------------------------------------------------- b. a body, described by the engine

// The radius of every hole of a body. A cylindrical face alone does not say whether it is a hole
// or a pin; `convex` does.
export function holeRadii(body: Id): number[] {
  const description: BodyDescription = unwrap(engine.query('body', { body }));
  const radii: number[] = [];
  for (const face of description.faces) if (face.surface.kind === 'cylinder' && face.convex === false) radii.push(face.surface.radius);
  return radii;
}

// Both rims of a countersink are circles: its mouth (a plane and the cone) and its lower rim
// (the cone and the cylinder of the hole). The centre and radius may be missing while they are
// fitted to vertices.
export function countersinkRims(body: Id): { radius: number; center: Vec3 }[] {
  const description = unwrap(engine.query('body', { body }));
  const cones = new Set(description.faces.filter((face) => face.surface.kind === 'cone').map((face) => JSON.stringify(face.name)));
  const rims: { radius: number; center: Vec3 }[] = [];
  for (const edge of description.edges) {
    if (edge.kind !== 'circle' || !edge.circle) continue;
    if (cones.has(JSON.stringify(edge.name.a)) || cones.has(JSON.stringify(edge.name.b))) rims.push(edge.circle);
  }
  return rims;
}

// The surfaces are in the evaluation as well, next to the names of the faces.
export function surfaceKinds(context: QueryContext): string[] {
  return context.state.evaluation.faceSurfaces.map((surface) => surface.kind);
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

declare const somePreview: { state: EngineState };
// @ts-expect-error either a previewed state or a place on the timeline, not both
engine.query('interference', {}, { state: somePreview.state, at: 'housing' });

// ---------------------------------------------------------------- d. adding a query is one module

// What a package of step 1 writes (here the smallest gap of 1c, shortened): the description of
// its arguments, its result, its entry and one line of declaration merging. The type of the
// arguments comes from the description. No shared type is edited.
const LENGTH = { title: 'Search distance', unit: 'mm', min: { value: 0, open: true }, default: 10 } as const satisfies QuantitySpec;
const gapArgs = {
  a: { kind: 'body', title: 'First body' },
  b: { kind: 'body', title: 'Second body' },
  within: { kind: 'number', title: 'Search distance', optional: true, spec: LENGTH },
} as const satisfies ArgSpecs;
interface GapResult {
  distance: number | null; // null: farther apart than `within`
  between?: { a: Vec3; b: Vec3 };
}
export const gap: QuerySpec<typeof gapArgs, GapResult> = {
  title: 'Smallest gap',
  summary: 'The smallest distance between two bodies that do not intersect.',
  returns: 'distance in mm and the two closest points; distance null when the bodies are farther apart than `within`.',
  tool: 'check_gap',
  args: gapArgs,
  run(context, args) {
    const bodies = context.state.evaluation.bodies;
    const [a, b] = [bodies[args.a], bodies[args.b]];
    if (!a || !b) throw new QueryFailure('notAvailable', 'a body does not exist');
    // Both solids own the answer: it is forgotten when either body changes.
    return context.memo([a.solid, b.solid], `gap:${args.within ?? LENGTH.default}`, () => ({ distance: null }));
  },
};
declare module './contract' {
  interface Queries {
    gap: { spec: typeof gapArgs; result: GapResult };
  }
}
export function clearance(a: Id, b: Id): number | null {
  return unwrap(engine.query('gap', { a, b, within: 2 })).distance;
}
// @ts-expect-error `within` is a number
engine.query('gap', { a: 'a', b: 'b', within: '2' });

// ---------------------------------------------------------------- e. arguments with structure

// A reference to a named entity (the measuring of 1b, shortened). The description says which
// kinds are accepted and the type follows.
const measureArgs = {
  from: { kind: 'entity', title: 'From', accepts: ['face', 'edge', 'sketchPoint'] },
  to: { kind: 'entity', title: 'To', accepts: ['face', 'edge', 'sketchPoint'] },
} as const satisfies ArgSpecs;
type MeasureArgs = ArgsOf<typeof measureArgs>;
export const wallOfHousing: MeasureArgs = {
  from: { kind: 'face', body: 'housing', face: { feature: 'housing', role: 'side', curve: 'outer' } },
  to: { kind: 'face', body: 'housing', face: { feature: 'pocket', role: 'side', curve: 'bore' } },
};
export const notMeasurable: MeasureArgs = {
  // @ts-expect-error a whole body is not accepted here
  from: { kind: 'body', body: 'housing' },
  to: { kind: 'sketchPoint', sketch: 'gears', point: 'origin' },
};

// A section by a plane (1a, shortened): the plane is a `PlaneRef` as features use it, and the
// answer says when it was cut short.
const sectionArgs = {
  plane: { kind: 'plane', title: 'Cutting plane' },
  offset: { kind: 'number', title: 'Offset along the normal', optional: true, spec: { title: 'Offset', unit: 'mm', default: 0 } },
  bodies: { kind: 'list', of: { kind: 'body' }, title: 'Bodies', optional: true },
  maxPoints: { kind: 'number', title: 'Most points to return', optional: true, spec: { title: 'Points', unit: 'count', integer: true, min: { value: 1 }, default: 2000 } },
} as const satisfies ArgSpecs;
interface SectionResult extends Truncated {
  loops: { body: Id; area: number; points: Vec3[] }[];
}
export const sectionExample: ArgsOf<typeof sectionArgs> = { plane: { kind: 'base', plane: 'XZ' }, offset: 12, maxPoints: 500 };
export const cutShort = (result: SectionResult): boolean => result.truncated !== undefined && result.truncated.shown < result.truncated.total;

// Print queries (1e, shortened): several orientations in one call, each a direction or a face
// that lies on the bed; the size of the bed is a vector.
const printArgs = {
  bodies: { kind: 'list', of: { kind: 'body' }, title: 'Bodies', optional: true },
  orientations: {
    kind: 'list',
    min: 1,
    title: 'Orientations to compare',
    of: { kind: 'oneOf', options: { up: { kind: 'vector' }, onBed: { kind: 'entity', accepts: ['face'] } } },
  },
  bed: { kind: 'vector', title: 'Size of the bed in mm' },
  overhang: { kind: 'number', title: 'Overhang angle from the vertical', optional: true, spec: { title: 'Overhang', unit: 'rad', min: { value: 0 }, max: { value: Math.PI / 2 }, default: Math.PI / 4 } },
} as const satisfies ArgSpecs;
export const printExample: ArgsOf<typeof printArgs> = {
  orientations: [{ up: [0, 0, 1] }, { onBed: { kind: 'face', body: 'housing', face: { feature: 'housing', role: 'startCap' } } }],
  bed: [220, 220, 250],
};

// A pose (5a, shortened): joint values by joint name.
const poseArgs = { joints: { kind: 'record', of: { kind: 'number', spec: { title: 'Joint value', unit: 'rad' } }, title: 'Joint values' } } as const satisfies ArgSpecs;
export const poseExample: ArgsOf<typeof poseArgs> = { joints: { shoulder: 0.5, elbow: -1.2 } };

// Mass properties (1d, shortened): a density, in a unit the numeric fields did not have.
const massArgs = {
  bodies: { kind: 'list', of: { kind: 'body' }, title: 'Bodies taken as one piece' },
  density: { kind: 'number', title: 'Density', spec: { title: 'Density', unit: 'g/cm3', min: { value: 0, open: true }, default: 1.24 } },
} as const satisfies ArgSpecs;
export const massExample: ArgsOf<typeof massArgs> = { bodies: ['carrier', 'pins/1'], density: 1.27 };

// ---------------------------------------------------------------- f. export

// A file per body; the caller decides where the bytes go.
export function printFiles(bodies: Id[]): ExportFile[] {
  const exported: Exported = unwrap(engine.export('stl', { bodies, perBody: true }));
  return exported.layout === 'directory' ? exported.files : fail('expected a file per body');
}

// A format added by a package (the robot description of 5b, shortened): several files, some in
// a folder.
const urdfOptions = { name: { kind: 'text', title: 'Name of the robot' } } as const satisfies ArgSpecs;
declare module './contract' {
  interface ExportFormats {
    urdf: typeof urdfOptions;
  }
}
export function robotFiles(): string[] {
  return unwrap(engine.export('urdf', { name: 'arm' })).files.map((file) => file.path); // ['arm.urdf', 'meshes/base.stl', ...]
}
// @ts-expect-error a format that does not exist
engine.export('step', {});

// ---------------------------------------------------------------- g. a data catalog

// A catalog added by a package (the hardware of 2c, shortened). Code reads the table with its
// own row type; an untyped caller asks the query.
interface ScrewRow extends Record<string, number | string> {
  clearanceHole: number;
  headDiameter: number;
  headHeight: number;
}
declare module './contract' {
  interface Catalogs {
    socketHeadScrews: ScrewRow;
  }
}
export const clearanceHole = (size: string): number => DATA_CATALOGS.socketHeadScrews.rows[size].clearanceHole;
export const catalogForAi = (size: string) => unwrap(engine.query('catalog', { name: 'socketHeadScrews', key: size })).rows[size];

// ---------------------------------------------------------------- h. an operation of the app

// The view image of 1f, shortened. The capability it needs is added to the host by the package;
// the operation is asynchronous and answers with an image, not with data.
declare module './contract' {
  interface AppHost {
    viewport: { image(view: 'front' | 'top' | 'iso', width: number): Promise<string> }; // base64 PNG
  }
}
const imageArgs = {
  view: { kind: 'choice', options: ['front', 'top', 'iso'], title: 'View' },
  width: { kind: 'number', title: 'Width in pixels', optional: true, spec: { title: 'Width', unit: 'count', integer: true, min: { value: 64 }, max: { value: 2048 }, default: 800 } },
} as const satisfies ArgSpecs;
export const viewImage: HostOperation<typeof imageArgs> = {
  tool: 'view_image',
  title: 'View image',
  summary: 'A picture of the model as the app shows it. Needs a connected app.',
  returns: 'A PNG image.',
  args: imageArgs,
  async run(host, args): Promise<ToolAnswer> {
    return { kind: 'image', mediaType: 'image/png', base64: await host.viewport.image(args.view, args.width ?? 800) };
  },
};

// ---------------------------------------------------------------- i. MCP and the guards

// The server offers one tool per query that names one. An AI steps a parameter through the tool
// by giving the command to preview.
export const toolNames = (): string[] => queryTools().map((tool) => tool.name);
export const steppedCall = { name: 'check_gap', arguments: { a: 'planet', b: 'carrier', after: { type: 'setParameter', name: 'backlash', expr: '0.2' } satisfies Command } };

// Every query has a fixture in the tests, by name, with arguments of its own type and the tool
// call that reaches it: a query added without one does not compile. (The same trick as the table
// over the methods of `Engine` in packages/mcp/test/coverage.test.ts.)
export const FIXTURES: { [N in QueryName]: { args: QueryArgs<N>; through: { tool: string; arguments: Record<string, unknown> } } } = {
  interference: { args: {}, through: { tool: 'check_interference', arguments: {} } },
  sketchDiagnosis: { args: { sketch: 's' }, through: { tool: 'get_sketch', arguments: { sketch: 's' } } },
  constraintExplanation: { args: { sketch: 's', constraint: 'r' }, through: { tool: 'explain_constraint', arguments: { sketch: 's', constraint: 'r' } } },
  body: { args: { body: 'a' }, through: { tool: 'get_body', arguments: { body: 'a' } } },
  catalog: { args: { name: 'socketHeadScrews' }, through: { tool: 'get_catalog', arguments: { name: 'socketHeadScrews' } } },
  gap: { args: { a: 'a', b: 'b' }, through: { tool: 'check_gap', arguments: { a: 'a', b: 'b' } } },
};

// The description for the AI lists the queries from the catalog.
export const describedForAi: string[] = describedQueries().map((query) => `${query.tool ?? query.name}: ${query.summary} Returns: ${query.returns}`);
export const titles: string[] = Object.values(QUERIES).map((spec) => spec.title);

// The version of the schema follows from the list of upgrade steps.
export const SCHEMA_VERSION: number = UPGRADES.length + 1;
