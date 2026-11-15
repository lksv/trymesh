// Package 3a written out as calls: its part of validation scenario 13 (a link of an arm between
// two joints), "bodies with materials and a motor as a reference part with the mass of its data
// sheet", and what a caller of the engine, an export, the mass query and the MCP server do with
// the section. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`). Lines marked
// `@ts-expect-error` are calls that must not compile. After the implementation it becomes
// a test in packages/scenarios.

import type { Id } from '../../../packages/engine/src/index';
import type { CommandAfter, DocumentAfter, EngineAfter, ExportFile, QueryContext, QueryOutcome, QueryToolInput, StateAfter } from '../00-prep/contract';
import { DATA_CATALOGS, QueryFailure, SCHEMA_PENDING, UPGRADES } from '../00-prep/contract';
import type { BodyProperties, BodyPropertiesResult, SectionInfo } from './contract';
import { BODY_PROPERTIES_STEP, SECTION_INFO, bodyPropertiesWithoutBody, printedBodies } from './contract';

declare const engine: EngineAfter;
declare function fail(message: string): never;
const unwrap = <T>(outcome: QueryOutcome<T>): T => (outcome.ok ? outcome.result : fail(`${outcome.error.code}: ${outcome.error.message}`));
function run(...commands: CommandAfter[]): StateAfter {
  const result = engine.execute(commands.length === 1 ? commands[0] : { type: 'batch', commands });
  return result.ok ? result.state : fail(result.error.message);
}

// ---------------------------------------------------------------- the model of the scenario

// Built with the commands of today; the shapes are simplified to discs, because the scenario is
// about what the bodies are, not about their form. `layout` holds the two points the joints of
// 5a turn about. The bodies: `base`, `upper` (the link of the arm), `forearm`, `motor` (a block
// where the motor sits) and four screws, the body `screw` and the pattern `screws` that copies
// it three times (`screws/1` to `screws/3`).
const sketch = (id: Id): CommandAfter => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'sketch', plane: { kind: 'base', plane: 'XY' }, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } },
});
const fixedPoint = (sketchId: Id, point: Id, x: number, y: number): CommandAfter[] => [
  { type: 'addPoint', sketch: sketchId, id: point, x, y },
  { type: 'addConstraint', sketch: sketchId, id: `${point}Fix`, constraint: { type: 'fixed', point, x, y } },
];
function disc(body: Id, x: number, y: number, radius: number, start: number, height: number): CommandAfter[] {
  const [sketchId, circle] = [`${body}Sketch`, `${body}Circle`];
  return [
    sketch(sketchId),
    ...fixedPoint(sketchId, `${body}Centre`, x, y),
    { type: 'addCurve', sketch: sketchId, id: circle, curve: { type: 'circle', center: `${body}Centre` }, radius },
    { type: 'addConstraint', sketch: sketchId, id: `${body}Radius`, constraint: { type: 'radius', curve: circle, value: radius, driving: true } },
    { type: 'addFeature', feature: { id: body, name: body, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: sketchId, regions: [{ outerLoop: [circle] }] }, extent: { type: 'distance', start, distance: height }, operation: 'new' } },
  ];
}
export function build(): Id[] {
  const state = run(
    sketch('layout'),
    ...fixedPoint('layout', 'shoulder', 0, 0),
    ...fixedPoint('layout', 'elbow', 120, 0),
    ...disc('base', 0, 0, 30, -10, 10),
    ...disc('upper', 60, 0, 12, 0, 8),
    ...disc('motor', 0, 0, 14, 8, 30),
    ...disc('forearm', 180, 0, 10, 8, 8),
    ...disc('screw', 15, 0, 1.5, 8, 6),
    { type: 'addFeature', feature: { id: 'screws', name: 'Screws', suppressed: false, type: 'pattern', source: { type: 'body', body: 'screw' }, transform: { type: 'circular', axis: { kind: 'sketchPoint', sketch: 'layout', point: 'shoulder' }, count: 4, span: { type: 'full' } } } },
  );
  return Object.keys(state.evaluation.bodies); // base, upper, motor, forearm, screw, screws/1, screws/2, screws/3
}

// ---------------------------------------------------------------- a. the catalog fills the fields

// Code reads the table with its row type; an AI asks the query `catalog` and gets the same row.
export const petgDensity = (): number => DATA_CATALOGS.materials.rows['PETG'].density;
export const whereFrom = (): string => DATA_CATALOGS.materials.rows['PETG'].source;
export const materialsForAi = () => unwrap(engine.query('catalog', { name: 'materials' })).rows;
// @ts-expect-error a column the catalog does not have
export const noSuchColumn = (): number => DATA_CATALOGS.materials.rows['PETG'].youngsModulus;

// The printed bodies get their material from the catalog, in one batch and one undo step. The
// command writes the label and the number into the document; no later change of the catalog
// reaches this model.
export function materials(): BodyProperties {
  const state = run(
    { type: 'setBodyMaterial', body: 'base', material: 'PETG' },
    { type: 'setBodyMaterial', body: 'upper', material: 'PETG' },
    { type: 'setBodyMaterial', body: 'forearm', material: 'PLA' },
  );
  return state.document.bodyProperties['upper']; // { material: 'PETG', density: <the catalog's number> }
}

// A material the catalog does not have is an invalid command; the message lists the keys.
export function unknownMaterial(): string {
  const result = engine.execute({ type: 'setBodyMaterial', body: 'upper', material: 'unobtainium' });
  return result.ok ? fail('expected an invalid command') : result.error.message;
}

// ---------------------------------------------------------------- b. a reference part with the mass of its data sheet

// The motor is a block that stands for a bought part: it is named, shown dark, not printed, and
// weighs what its data sheet says. Its volume and a density would give a wrong mass.
export function motor(): BodyPropertiesResult {
  const state = run({ type: 'setBodyProperties', body: 'motor', patch: { name: 'NEMA 17 motor', color: '#30343a', use: 'reference', mass: 280 } });
  return state.evaluation.bodyProperties['motor']; // { name: 'NEMA 17 motor', use: 'reference', mass: 280, massFrom: 'mass', ... }
}

// The screws are bought, and the caller knows what one weighs. Only the source body is given
// properties; the copies of the pattern take them over, so no copy is printed by mistake.
export function screws(): { use: string; from: Id | undefined; mass: number | undefined } {
  const state = run({ type: 'setBodyProperties', body: 'screw', patch: { use: 'reference', material: 'steel', mass: 0.9 } });
  const copy = state.evaluation.bodyProperties['screws/2'];
  return { use: copy.use, from: copy.from, mass: copy.mass }; // 'reference', 'screw', 0.9
}
// A copy can differ in a field of its own; the rest stays inherited.
export const oneBlackScrew = (): StateAfter => run({ type: 'setBodyProperties', body: 'screws/2', patch: { color: '#000000' } });
// A copy in another material: the density and the mass are inherited as a pair, so a copy that
// states its own density is weighed by it and no longer by the mass of its source.
export function nylonScrew(): string | undefined {
  const state = run({ type: 'setBodyMaterial', body: 'screws/3', material: 'PA12' });
  return state.evaluation.bodyProperties['screws/3'].massFrom; // 'density'; `use` is still inherited: 'reference'
}

// A density by an expression over the parameters: the printed link is lighter than solid
// material. The field keeps its number; the expression is kept beside it in the entry.
export function effectiveDensity(): { number: number | undefined; expression: string | undefined } {
  const state = run({ type: 'setParameter', name: 'infill', expr: '0.45' }, { type: 'setBodyProperties', body: 'upper', patch: { density: '1.27 * infill' } });
  const entry = state.document.bodyProperties['upper'];
  return { number: entry.density, expression: entry.expressions?.density }; // 0.5715, '1.27 * infill'
}
// The expression follows the parameter: the number in the document is rewritten by the
// recompute, in the same undo step, as for a field of a feature.
export const denser = (): number | undefined => run({ type: 'setParameter', name: 'infill', expr: '0.6' }).document.bodyProperties['upper'].density; // 0.762

// A weighed value wins over the density and leaves it in place; removing it returns to the density.
export function weighed(): [string | undefined, string | undefined] {
  const withMass = run({ type: 'setBodyProperties', body: 'upper', patch: { mass: 41.5 } }).evaluation.bodyProperties['upper'].massFrom;
  const without = run({ type: 'setBodyProperties', body: 'upper', patch: { mass: null } }).evaluation.bodyProperties['upper'].massFrom;
  return [withMass, without]; // ['mass', 'density']
}

// A mass whose expression stops evaluating: the body has no mass, although its density is fine.
// The density does not step in for a weighed value that cannot be read; the result says why.
export function brokenMass(): { mass: number | undefined; why: string | undefined; stillInDocument: number | undefined } {
  run({ type: 'setParameter', name: 'scale', expr: '41.5' }, { type: 'setBodyProperties', body: 'upper', patch: { mass: 'scale' } });
  const state = run({ type: 'removeParameter', name: 'scale' });
  const result = state.evaluation.bodyProperties['upper'];
  return { mass: result.mass, why: result.fieldErrors?.mass?.message, stillInDocument: state.document.bodyProperties['upper'].mass }; // undefined, 'unknown name "scale"', 41.5
}

// What the commands refuse (each compiles: the engine validates them).
export function refused(): string[] {
  const commands: CommandAfter[] = [
    { type: 'setBodyProperties', body: 'nope', patch: { use: 'reference' } }, // no feature creates such a body
    { type: 'setBodyProperties', body: 'screws/0', patch: { use: 'reference' } }, // copies are numbered from 1
    { type: 'setBodyProperties', body: 'upper', patch: { density: 1240 } }, // kg/m3 by mistake: above the range
    { type: 'setBodyProperties', body: 'upper', patch: { density: 'nope * 2' } }, // an expression that does not evaluate
    { type: 'setBodyProperties', body: 'upper', patch: { color: 'red' } }, // #rrggbb
    { type: 'removeBodyProperties', body: 'nope' }, // no such entry
  ];
  return commands.map((command) => {
    const result = engine.execute(command);
    return result.ok ? fail('expected an invalid command') : result.error.message;
  });
}
// @ts-expect-error a use that does not exist
engine.execute({ type: 'setBodyProperties', body: 'motor', patch: { use: 'bought' } });
// @ts-expect-error a field the properties do not have
engine.execute({ type: 'setBodyProperties', body: 'motor', patch: { weight: 280 } });
// @ts-expect-error a command no package added
engine.execute({ type: 'setBodyColour', body: 'motor', color: '#000000' });

// ---------------------------------------------------------------- c. what reads the properties

// A query or an export format reads the properties from its context: they are in the evaluation
// of the state it answers for and do not depend on the pose. This is the rule the mass query
// follows for one body, and the list a print export takes when it is given none.
export function massOfBody(context: QueryContext, body: Id, density: number | undefined): { mass: number; from: 'mass' | 'density' | 'argument' } | undefined {
  const properties = context.state.evaluation.bodyProperties[body];
  if (properties.use === 'auxiliary') return undefined; // adds nothing; the query lists it as skipped
  if (properties.mass !== undefined && properties.massFrom !== undefined) return { mass: properties.mass, from: properties.massFrom };
  const why = properties.fieldErrors?.mass ?? properties.fieldErrors?.density;
  if (why) throw new QueryFailure('failed', `the body "${body}" has a property in error: ${why.message}`, ['bodies']);
  if (density !== undefined) return { mass: (density * context.bodies[body].volume) / 1000, from: 'argument' };
  throw new QueryFailure('failed', `the body "${body}" states neither a density nor a mass`, ['bodies']);
}
export const printedOf = (context: QueryContext): Id[] => printedBodies(context.state.evaluation.bodyProperties);

// The mass query (1d, here its stand-in): the link with its motor as one piece. Every body
// states its mass or its density, so no density is passed.
export function massOfLink(): number {
  const result = unwrap(engine.query('standInMass', { bodies: ['upper', 'motor', 'screw', 'screws/1', 'screws/2', 'screws/3'] }));
  return result.mass; // the motor counts with 280 g (`from: 'mass'`), the link with density · volume
}
// A body that states neither fails the query, which names it; the caller sets the property or
// passes a density for such bodies.
export function unknownMass(body: Id): string {
  const outcome = engine.query('standInMass', { bodies: [body] });
  return outcome.ok ? fail('expected an error') : `${outcome.error.code}: ${outcome.error.message}`; // failed: the body "…" states neither a density nor a mass
}
export const withFallback = (body: Id): number => unwrap(engine.query('standInMass', { bodies: [body], density: DATA_CATALOGS.materials.rows['PLA'].density })).mass;

// A what-if without a change of the document: the mass of the link if it were printed in PLA.
// The same command goes into `after` of the tool `query` over MCP.
export function ifPla(): number {
  const preview = engine.preview({ type: 'setBodyMaterial', body: 'upper', material: 'PLA' });
  if (!preview.ok) return fail(preview.error.message);
  return unwrap(engine.query('standInMass', { bodies: ['upper', 'motor'] }, { state: preview.state })).mass;
}
export const ifPlaOverMcp: QueryToolInput = { query: 'standInMass', args: { bodies: ['upper', 'motor'] }, after: { type: 'setBodyMaterial', body: 'upper', material: 'PLA' } };

// The print export: without a list it takes the printed bodies, so the motor and the screws are
// not in it. A caller that lists the motor gets the motor.
export function printFiles(): string[] {
  const exported = unwrap(engine.export('stl', { perBody: true }));
  return exported.files.map((file: ExportFile) => file.path); // base.stl, upper.stl, forearm.stl
}
export const toPrint = (): Id[] => printedBodies(engine.getState().evaluation.bodyProperties); // ['base', 'upper', 'forearm']
export const motorAnyway = (): number => unwrap(engine.export('stl', { bodies: ['motor'] })).files.length; // 1

// ---------------------------------------------------------------- d. an entry whose body is gone

const withoutBody = (state: StateAfter): Id[] => bodyPropertiesWithoutBody(state.document.bodyProperties, state.evaluation.bodyProperties);

// Removing the feature leaves the entry in the document: a suppressed feature and a lower count
// of a pattern get their properties back with the body. The entry is listed, and one command
// removes it.
export function orphan(): { listed: Id[]; after: Id[] } {
  const removed = run({ type: 'removeFeature', id: 'motor' });
  const listed = withoutBody(removed); // ['motor']
  // the body can no longer be given properties (no feature creates it), only relieved of them
  const refusedNow = !engine.execute({ type: 'setBodyProperties', body: 'motor', patch: { mass: 300 } }).ok;
  const cleaned = run({ type: 'removeBodyProperties', body: 'motor' });
  return refusedNow ? { listed, after: withoutBody(cleaned) } : fail('expected an invalid command'); // after: []
}
// A feature added under an ID that an entry still names takes the entry over: the new body
// `motor` is a reference part of 280 g at once. That is wanted when a feature is made again and
// a trap when the ID is reused for something else, so a caller that sees the entry listed
// removes it first, and the answer of `execute` over MCP names the bodies that took entries over.
export function adopted(): string {
  run({ type: 'removeFeature', id: 'motor' });
  const state = run(...disc('motor', 0, 0, 20, 8, 5).slice(-1));
  return state.evaluation.bodyProperties['motor'].use; // 'reference'
}

// ---------------------------------------------------------------- e. save, load and the version of the schema

// The step of the package is the last of the list while the branch is not merged.
export const stepIsPending = (): boolean => SCHEMA_PENDING >= 1 && UPGRADES.some((step) => step.name === BODY_PROPERTIES_STEP.name);

// A document of today (version 2, no section) gets the empty section; one that has the field,
// whatever it holds, keeps it for the validation to judge.
const today = { schemaVersion: 2, settings: { chordTolerance: 0.01 }, parameters: [], checks: [], features: [] };
export const upgraded = BODY_PROPERTIES_STEP.run(today); // { ..., bodyProperties: {} }
export const kept = BODY_PROPERTIES_STEP.run({ ...today, bodyProperties: { motor: { mass: 280 } } });
export const keptNull = BODY_PROPERTIES_STEP.run({ ...today, bodyProperties: null }); // null stays, and the validation refuses it

// What a build of the branch saves: the version of the `master` it started from and the name of
// the step. Loaded again, the step is not run a second time.
export function roundTrip(): boolean {
  const saved = JSON.parse(engine.save()) as DocumentAfter & { schemaSteps?: string[] };
  const marked = SCHEMA_PENDING === 0 || (saved.schemaSteps ?? []).includes(BODY_PROPERTIES_STEP.name);
  const loaded = engine.load(JSON.stringify(saved));
  return marked && loaded.ok && loaded.state.document.bodyProperties['motor']?.mass === 280;
}
// A field of an entry that this build does not know (added by a later package) is refused, not
// dropped: the validator of an entry lists the fields it allows.
export function unknownField(): boolean {
  const saved = JSON.parse(engine.save()) as Record<string, unknown>;
  const tampered = { ...saved, bodyProperties: { motor: { mass: 280, printOrientation: 'up' } } };
  return !engine.load(JSON.stringify(tampered)).ok; // true: invalidDocument
}

// ---------------------------------------------------------------- f. the description for the AI

// The section, its commands and its numeric fields reach `describe_api` from the registry of
// sections; the types of the section and of the commands reach it with the text of types.ts.
export const described: SectionInfo = SECTION_INFO.bodyProperties;
export const numericFields = (): string[] => SECTION_INFO.bodyProperties.fields.map((field) => `${field.owner}: ${field.path} (${field.spec.unit})`); // body: density (g/cm3), body: mass (g)
