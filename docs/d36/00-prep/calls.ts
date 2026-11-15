// The contract of the preparatory step written out as calls: what a caller of the engine, a new
// query, an export format, an operation of the app and the MCP server do with it. Only
// type-checked (`npx tsc -p docs/d36/tsconfig.json`). A step that cannot be written here is
// a hole in the contract. Lines marked `@ts-expect-error` are calls that must not compile.
//
// The examples add entries to the shared maps under names that start with `example`, so that
// the contract of a real package (which is type-checked together with this file) can use the
// real names.

import type { Id, InterferenceReport, Vec3 } from '../../../packages/engine/src/index';
import type { ArgSpecs, ArgsOf, BodyDescription, CatalogTable, CommandAfter, PlaneRefAfter, DataCatalog, EngineAfter, ExportFile, ExportToolInput, Exported, FaceNameAfter, HostOperation, QuantitySpec, QueryArgs, QueryContext, QueryName, QueryOutcome, QueryResult, QuerySpec, QueryToolInput, RunArgsOf, Queries, StateAfter, Surface, Truncated } from './contract';
import { CONSTRAINT_ARGS, DATA_CATALOGS, EXPORT_FORMATS, FACE_ROLES, INTERFERENCE_ARGS, QUERIES, QueryFailure, SCHEMA_PENDING, SKETCH_ARGS, UPGRADES, describedQueries } from './contract';
// Internal modules of the engine, as a query module inside the engine imports them.
import { UNAVAILABLE, diagnose, explain } from '../../../packages/engine/src/diagnose';

declare const engine: EngineAfter;
declare const context: QueryContext;
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

// A body that does not exist: the engine finds it before the query runs and names the argument.
export function unknownBody(): string {
  const outcome = engine.query('interference', { bodies: ['housing', 'nope'] });
  if (outcome.ok) return fail('expected an error');
  return `${outcome.error.code} in "${outcome.error.arg}": ${outcome.error.message}`; // notAvailable in "bodies"
}

// The methods of today stay, with their own checks and texts, and throw as today; they share
// `run` of the entry with `query`.
export const asToday = (): InterferenceReport => engine.interference({ bodies: ['housing', 'lid'] });

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

// The entries of the registry can be called, and the engine's own `query` needs no cast to
// dispatch by name.
export const direct: InterferenceReport = QUERIES.interference.run(context, { bodies: ['a', 'b'], threshold: 0.001 }); // `run` gets the default filled in
export const directExport: Exported = EXPORT_FORMATS.stl.run(context, {});
export function dispatch<N extends QueryName>(name: N, args: RunArgsOf<Queries[N]['spec']>): QueryResult<N> {
  return QUERIES[name].run(context, args);
}

// The two sketch queries as entries: what `diagnoseSketch` and `explainConstraint` of engine.ts
// do today, over the context. The diagnosis of one solved sketch is computed once.
export const sketchDiagnosis: (typeof QUERIES)['sketchDiagnosis'] = {
  title: 'Sketch diagnosis',
  summary: 'Redundant and conflicting constraints of a sketch and what is still free in it.',
  returns: 'status, degreesOfFreedom and lists of constraint and entity IDs; status `unavailable` when the sketch did not evaluate.',
  args: SKETCH_ARGS,
  run(context, args) {
    const sketch = context.sketch(args.sketch);
    return sketch ? context.memo([sketch], 'diagnosis', () => diagnose(sketch)) : UNAVAILABLE;
  },
};
export const constraintExplanation: (typeof QUERIES)['constraintExplanation'] = {
  title: 'Explanation of a constraint',
  summary: 'The constraints a redundant constraint follows from.',
  returns: 'redundant and impliedBy, a list of constraint IDs.',
  args: CONSTRAINT_ARGS,
  run(context, args) {
    // That the constraint is in the sketch was checked before `run`.
    const sketch = context.sketch(args.sketch);
    return sketch ? explain(sketch, args.constraint) : { redundant: false, impliedBy: [] };
  },
};

// The collisions as an entry: volumes and depths may be small on purpose, so a tool prints them
// to significant digits, as `check_interference` does today.
declare function report(context: QueryContext, bodies: Id[] | undefined, threshold: number): InterferenceReport;
export const interference: (typeof QUERIES)['interference'] = {
  title: 'Collisions',
  summary: 'Which bodies share a volume.',
  returns: 'pairs, fits and failed pairs with volume in mm3 and depth in mm, and the number of pairs checked.',
  args: INTERFERENCE_ARGS,
  significant: { volume: 6, depth: 4 },
  run: (context, args) => report(context, args.bodies, args.threshold),
};

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

// The key of a face, built from the catalog of roles: the feature, the role, the fields that
// tell the faces of the role apart in the alphabetical order of their names, and the copy tags.
export const sideParts: { readonly curve: { title: string; kind: 'text' } } = FACE_ROLES.side.parts;
export function faceKeyOf(name: FaceNameAfter): string {
  const fields = name as unknown as Record<string, string | number>;
  const parts = Object.keys(FACE_ROLES[name.role].parts).sort().map((part) => String(fields[part]));
  return [name.feature, name.role, ...parts].join('/') + (name.copy ?? []).map((tag) => `/@${tag.pattern}:${tag.index}`).join('');
}

// A query reads the surface of a face from its context, by body, so that it answers for a pose;
// and it learns from the context why a plane does not resolve.
export function axisOfHole(context: QueryContext, body: Id, face: FaceNameAfter): Vec3 {
  const surface: Surface | undefined = context.surface(body, face);
  if (surface?.kind !== 'cylinder') throw new QueryFailure('failed', 'the face is not a cylinder', ['face']);
  return surface.axis;
}
export function normalOf(context: QueryContext, plane: PlaneRefAfter): Vec3 {
  const frame = context.frame(plane);
  if ('problem' in frame) throw new QueryFailure(frame.problem === 'nonPlanarFace' ? 'failed' : 'notAvailable', frame.problem === 'nonPlanarFace' ? 'the face is not planar' : 'the plane is not in this state', ['plane']);
  return frame.normal;
}

// The surfaces are in every state the engine returns, next to the names of the faces.
export const fromState = (): string[] => engine.getState().evaluation.faceSurfaces.map((surface) => surface.kind);
export function fromPreview(command: CommandAfter): number {
  const preview = engine.preview(command);
  return preview.ok ? preview.state.evaluation.faceSurfaces.length : 0;
}
export const fromSubscription = engine.subscribe((state) => void state.evaluation.faceSurfaces);

// ---------------------------------------------------------------- c. a query over a previewed state

// Step a parameter and ask about collisions at each value; nothing is written and the history
// is not touched. This is the sweep the pose of step 5 needs.
export function sweep(parameter: string, values: number[]): { value: number; collisions: number }[] {
  const out: { value: number; collisions: number }[] = [];
  for (const value of values) {
    const command: CommandAfter = { type: 'setParameter', name: parameter, expr: String(value) };
    const preview = engine.preview(command);
    if (!preview.ok) return fail(preview.error.message);
    const report = unwrap(engine.query('interference', {}, { state: preview.state }));
    out.push({ value, collisions: report.pairs.length });
  }
  return out;
}

declare const somePreview: { state: StateAfter };
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
  args: gapArgs,
  run(context, args) {
    // The bodies exist: the engine checked the arguments. They come from the context, so the
    // same code answers for a pose. `within` has its default filled in.
    const [a, b] = [context.bodies[args.a], context.bodies[args.b]];
    if (a.volume === 0 || b.volume === 0) throw new QueryFailure('failed', 'a body is empty');
    const searched: number = args.within;
    // Both solids own the answer: it is forgotten when either body changes.
    return context.memo([a.solid, b.solid], `within:${searched}`, () => ({ distance: null }));
  },
};
declare module './contract' {
  interface Queries {
    exampleGap: { spec: typeof gapArgs; result: GapResult };
  }
}
// The entry goes into the registry as it is; an entry that disagrees with the map does not.
export const registered: Pick<typeof QUERIES, 'exampleGap'> = { exampleGap: gap };
// @ts-expect-error the entry of another query
export const misplaced: Pick<typeof QUERIES, 'exampleGap'> = { exampleGap: QUERIES.body };

export function clearance(a: Id, b: Id): number | null {
  return unwrap(engine.query('exampleGap', { a, b })).distance; // `within` may be left out by a caller
}
// @ts-expect-error `within` is a number
engine.query('exampleGap', { a: 'a', b: 'b', within: '2' });

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

// Print queries (1e, shortened): several orientations in one call. Each says what is up or
// which face lies on the bed, and may add a turn about the vertical; the size of the bed is
// a vector.
const printArgs = {
  bodies: { kind: 'list', of: { kind: 'body' }, title: 'Bodies', optional: true },
  orientations: {
    kind: 'list',
    min: 1,
    max: 12,
    title: 'Orientations to compare',
    of: {
      kind: 'fields',
      fields: {
        by: { kind: 'oneOf', options: { up: { kind: 'vector' }, onBed: { kind: 'entity', accepts: ['face'] } } },
        turn: { kind: 'number', optional: true, spec: { title: 'Turn about the vertical', unit: 'rad', default: 0 } },
      },
    },
  },
  bed: { kind: 'vector', title: 'Size of the bed in mm' },
  overhang: { kind: 'number', title: 'Overhang angle from the vertical', optional: true, spec: { title: 'Overhang', unit: 'rad', min: { value: 0 }, max: { value: Math.PI / 2 }, default: Math.PI / 4 } },
} as const satisfies ArgSpecs;
type PrintArgs = ArgsOf<typeof printArgs>;
export const printExample: PrintArgs = {
  orientations: [{ by: { up: [0, 0, 1] } }, { by: { onBed: { kind: 'face', body: 'housing', face: { feature: 'housing', role: 'startCap' } } }, turn: 0.5 }],
  bed: [220, 220, 250],
};
// What `run` gets has the defaults filled in at every depth.
declare const printRun: RunArgsOf<typeof printArgs>;
export const turnInRun: number = printRun.orientations[0].turn;
export const overhangInRun: number = printRun.overhang;
export const twoAtOnce: PrintArgs = {
  // @ts-expect-error one of the alternatives, not both
  orientations: [{ by: { up: [0, 0, 1], onBed: { kind: 'face', body: 'housing', face: { feature: 'housing', role: 'startCap' } } } }],
  bed: [220, 220, 250],
};

// Values by ID (mass properties with a density per body, shortened). A pose is not asked this
// way: it is a state of the document, asked with `after` (section j).
const densityArgs = { densities: { kind: 'record', keys: 'body', of: { kind: 'number', spec: { title: 'Density', unit: 'g/cm3', min: { value: 0, open: true } } }, title: 'Density by body' } } as const satisfies ArgSpecs;
export const densityExample: ArgsOf<typeof densityArgs> = { densities: { carrier: 1.27, 'pins/1': 7.85 } };

// Mass properties (1d, shortened): a density, in a unit the numeric fields did not have.
const massArgs = {
  bodies: { kind: 'list', of: { kind: 'body' }, title: 'Bodies taken as one piece' },
  density: { kind: 'number', title: 'Density', spec: { title: 'Density', unit: 'g/cm3', min: { value: 0, open: true } } },
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
    exampleUrdf: typeof urdfOptions;
  }
}
export function robotFiles(): string[] {
  return unwrap(engine.export('exampleUrdf', { name: 'arm' })).files.map((file) => file.path); // ['arm.urdf', 'meshes/base.stl', ...]
}
// @ts-expect-error a format that does not exist
engine.export('step', {});

// ---------------------------------------------------------------- g. a data catalog

// A catalog added by a package (the hardware of 2c, shortened). Code reads the table with its
// own row type; an untyped caller asks the query.
interface ScrewRow {
  clearanceHole: number;
  headDiameter: number;
  headHeight: number;
}
declare module './contract' {
  interface Catalogs {
    exampleScrews: ScrewRow;
  }
}
export const clearanceHole = (size: string): number => DATA_CATALOGS.exampleScrews.rows[size].clearanceHole;
// @ts-expect-error a column the catalog does not have
export const typo = (size: string): number => DATA_CATALOGS.exampleScrews.rows[size].clearenceHole;
export const catalogForAi = (size: string) => unwrap(engine.query('catalog', { name: 'exampleScrews', key: size })).rows[size];
// The entry of the query hands out any catalog without its row type; the rows are copied.
export function tableOf<Row extends { [K in keyof Row]: number | string }>(catalog: DataCatalog<Row>, key?: string): CatalogTable {
  const rows = Object.entries(catalog.rows).filter(([name]) => key === undefined || name === key);
  return { title: catalog.title, summary: catalog.summary, source: catalog.source, columns: { ...catalog.columns }, rows: Object.fromEntries(rows.map(([name, row]) => [name, { ...row }])) };
}
export const screwsTable: CatalogTable = tableOf(DATA_CATALOGS.exampleScrews, 'M3');

// ---------------------------------------------------------------- h. an operation of the app

// The view image of 1f, shortened. The capability it needs is added to the host by the package;
// the operation is asynchronous and answers with an image, or with the reason why it cannot.
declare module './contract' {
  interface AppHost {
    exampleViewport?: { image(view: 'front' | 'top' | 'iso', width: number): Promise<string> }; // base64 PNG
  }
  interface HostOperations {
    example_view_image: typeof imageArgs;
  }
}
const imageArgs = {
  view: { kind: 'choice', options: ['front', 'top', 'iso'], title: 'View' },
  width: { kind: 'number', title: 'Width in pixels', optional: true, spec: { title: 'Width', unit: 'count', integer: true, min: { value: 64 }, max: { value: 2048 }, default: 800 } },
} as const satisfies ArgSpecs;
export const viewImage: HostOperation<typeof imageArgs> = {
  title: 'View image',
  summary: 'A picture of the model as the app shows it. Needs a connected app.',
  returns: 'A PNG image.',
  args: imageArgs,
  async run(host, args) {
    if (!host.exampleViewport) return { ok: false, error: { code: 'notAvailable', message: 'no app is connected' } };
    return { ok: true, result: { kind: 'image', mediaType: 'image/png', base64: await host.exampleViewport.image(args.view, args.width) } };
  },
};

// ---------------------------------------------------------------- i. MCP and the guards

// One tool reaches every query. An AI steps a parameter by giving the command to preview; that
// works for the existing queries as well.
export const steppedCall: QueryToolInput = { query: 'interference', args: { bodies: ['planet', 'carrier'] }, after: { type: 'setParameter', name: 'backlash', expr: '0.2' } };
export const anotherCall: QueryToolInput = { query: 'exampleGap', args: { a: 'planet', b: 'carrier' }, at: 'carrier' };
// The export tool takes the same two: the files of the model as it was after a feature.
export const earlierExport: ExportToolInput = { format: 'stl', path: 'out/housing.stl', options: { bodies: ['housing'] }, at: 'housing' };

// A fixture per query in the tests, with arguments of the query's own type: the real table is
// over all of `QueryName`, so a query added without a fixture does not compile (the same trick
// as the table over the methods of `Engine` in packages/mcp/test/coverage.test.ts). Here it is
// over the names of this file only, so that the contracts of the packages do not have to edit it.
type Shown = 'interference' | 'sketchDiagnosis' | 'constraintExplanation' | 'body' | 'catalog' | 'exampleGap';
export const FIXTURES: { [N in Shown]: { args: QueryArgs<N> } } = {
  interference: { args: {} },
  sketchDiagnosis: { args: { sketch: 's' } },
  constraintExplanation: { args: { sketch: 's', constraint: 'r' } },
  body: { args: { body: 'a' } },
  catalog: { args: { name: 'exampleScrews' } },
  exampleGap: { args: { a: 'a', b: 'b' } },
};

// The description for the AI lists the queries from the catalog.
export const describedForAi: string[] = describedQueries().map((query) => `${query.name}: ${query.summary} Returns: ${query.returns}`);

// The version of the schema follows from the list of upgrade steps. A build of a branch saves
// the version of the `master` it started from and the names of its pending steps.
export const SCHEMA_VERSION: number = UPGRADES.length + 1;
export const savedByThisBuild = { schemaVersion: SCHEMA_VERSION - SCHEMA_PENDING, schemaSteps: UPGRADES.slice(UPGRADES.length - SCHEMA_PENDING).map((step) => step.name) };

// ---------------------------------------------------------------- j. what a package adds to the unions

// A feature type with faces in a role of its own (the hole of 2c, shortened): a wall per point
// of the sketch and per step of a counterbore, so two fields tell its faces apart.
interface ExampleHole {
  id: Id;
  name: string;
  suppressed: boolean;
  type: 'exampleHole';
  sketch: Id;
  points: Id[];
  diameter: number;
  targets: Id[];
}
declare module './contract' {
  interface FeatureTypes {
    exampleHole: ExampleHole;
  }
  interface FeaturePatches {
    exampleHole: { points?: Id[]; diameter?: number | string; targets?: Id[] };
  }
  interface FaceRoles {
    exampleWall: { point: Id; step: number };
  }
  interface IssueCodes {
    exampleHoleMissesBody: true;
  }
  // a command and a section of the document (the body properties of 3a, shortened)
  interface Commands {
    exampleSetDensity: { type: 'exampleSetDensity'; body: Id; density: number | string };
  }
  interface DocumentSections {
    exampleDensities?: Record<Id, number>;
  }
}
export const wallParts: { readonly point: { kind: 'text' }; readonly step: { kind: 'integer' } } = FACE_ROLES.exampleWall.parts;
export const wallKey = faceKeyOf({ feature: 'h1', role: 'exampleWall', point: 'p3', step: 2 }); // h1/exampleWall/p3/2
// @ts-expect-error an entry that leaves out a field of the name
export const halfWall: (typeof FACE_ROLES)['exampleWall'] = { title: 'Wall of a hole', parts: { point: { title: 'Point', kind: 'text' } } };
export const wrongKind: (typeof FACE_ROLES)['exampleWall'] = {
  title: 'Wall of a hole',
  // @ts-expect-error the step is a number, not a text
  parts: { point: { title: 'Point', kind: 'text' }, step: { title: 'Step', kind: 'text' } },
};

export function addHole(): boolean {
  const added = engine.execute({ type: 'addFeature', feature: { id: 'h1', name: 'Holes', suppressed: false, type: 'exampleHole', sketch: 's', points: ['p1', 'p2'], diameter: 'clearance', targets: ['lid'] } });
  return added.ok && added.state.document.features.some((feature) => feature.type === 'exampleHole');
}
export const densityOf = (body: Id): number | undefined => engine.getState().document.exampleDensities?.[body];
// The patch of the new type, its own warning in the result, and its faces in the state.
export function widenHoles(): boolean {
  const changed = engine.execute({ type: 'updateFeature', id: 'h1', patch: { diameter: 6 } });
  if (!changed.ok) return false;
  const missed = changed.state.evaluation.features['h1'].warnings.some((warning) => warning.code === 'exampleHoleMissesBody');
  const walls = changed.state.evaluation.faceNames.filter((name) => name.role === 'exampleWall').length;
  return !missed && walls > 0;
}
// Commands of packages go into a batch like any other, also in `after` of the query tool.
export const twoAtOnceInBatch = (): boolean => engine.execute({ type: 'batch', commands: [{ type: 'exampleSetDensity', body: 'carrier', density: 1.27 }, { type: 'exampleSetDensity', body: 'lid', density: '1.2' }] }).ok;
// A sketch is put on a face in a role of a package like on any other.
export const sketchOnFloor = (): boolean => engine.execute({ type: 'setSketchPlane', sketch: 's2', plane: { kind: 'face', body: 'lid', face: { feature: 'h1', role: 'exampleWall', point: 'p1', step: 1 } } }).ok;
// A face in a role of a package is a plane to a query like any other: the floor of a counterbore
// given as an entity, turned into a frame.
export function floorNormal(context: QueryContext, floor: Extract<ArgsOf<typeof measureArgs>['from'], { kind: 'face' }>): Vec3 {
  return normalOf(context, { kind: 'face', body: floor.body, face: floor.face });
}

// A pose is a state of the document, so stepping it is a preview of the command that sets it
// and a query over the previewed state; over MCP the same command goes into `after`.
export function sweepDensity(body: Id, values: number[]): number[] {
  return values.map((density) => {
    const preview = engine.preview({ type: 'exampleSetDensity', body, density });
    if (!preview.ok) return fail(preview.error.message);
    return unwrap(engine.query('interference', {}, { state: preview.state })).pairs.length;
  });
}
export const steppedOverMcp: QueryToolInput = { query: 'interference', after: { type: 'batch', commands: [{ type: 'exampleSetDensity', body: 'carrier', density: 1.27 }] } };
// @ts-expect-error a command no package added
engine.execute({ type: 'exampleNope' });
